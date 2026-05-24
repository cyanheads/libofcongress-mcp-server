/**
 * @fileoverview Tests for libofcongress_get_item tool.
 * @module tests/tools/libofcongress-get-item.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locGetItem } from '@/mcp-server/tools/definitions/libofcongress-get-item.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';

/** Full LOC item response fixture */
function makeItemResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    item: {
      id: 'https://www.loc.gov/item/2009632251/',
      title: 'Portrait of a man',
      date: '1920',
      contributor: ['Smith, John', 'Jones, Mary'],
      subject: ['Portraits', 'Men -- Photographs'],
      notes: ['From the Bain collection.'],
      rights_information: 'No known restrictions.',
      physical_description: '1 photograph : silver gelatin ; 5 x 4 in.',
      url: 'https://www.loc.gov/item/2009632251/',
      ...overrides,
    },
    resources: [
      {
        url: 'https://tile.loc.gov/image-services/iiif/service:pnp:2009632251/full/pct:12.5/0/default.jpg',
        image:
          'https://tile.loc.gov/image-services/iiif/service:pnp:2009632251/full/!512,512/0/default.jpg',
      },
    ],
    related_items: [],
  });
}

function mockFetch(body: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('locGetItem', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
  });

  it('returns full item metadata for a valid ID', async () => {
    vi.stubGlobal('fetch', mockFetch(makeItemResponse()));
    const ctx = createMockContext();
    const input = locGetItem.input.parse({ item_id: '2009632251' });
    const result = await locGetItem.handler(input, ctx);

    expect(result.item_id).toBe('2009632251');
    expect(result.title).toBe('Portrait of a man');
    expect(result.date).toBe('1920');
    expect(result.contributors).toEqual(['Smith, John', 'Jones, Mary']);
    expect(result.subject_headings).toContain('Portraits');
    expect(result.notes).toContain('From the Bain collection.');
    expect(result.rights_information).toBe('No known restrictions.');
    expect(result.physical_description).toBe('1 photograph : silver gelatin ; 5 x 4 in.');
    expect(result.resource_links.length).toBeGreaterThan(0);
    expect(result.url).toBe('https://www.loc.gov/item/2009632251/');
  });

  it('returns empty arrays for optional array fields omitted from upstream', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Minimal Item',
            url: 'https://www.loc.gov/item/min-id/',
            // contributor, subject, notes all absent
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locGetItem.input.parse({ item_id: 'min-id' });
    const result = await locGetItem.handler(input, ctx);

    expect(result.contributors).toEqual([]);
    expect(result.subject_headings).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.resource_links).toEqual([]);
    expect(result.related_items).toEqual([]);
    expect(result.date).toBeUndefined();
    expect(result.rights_information).toBeUndefined();
    expect(result.physical_description).toBeUndefined();
  });

  it('throws NotFound when item is absent from the response envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(JSON.stringify({ resources: [], related_items: [] })));
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: 'nonexistent-id' });
    await expect(locGetItem.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('throws NotFound on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: 'bad-id' });
    await expect(locGetItem.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('deduplicates resource_links', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: { title: 'Dup test', url: 'https://www.loc.gov/item/dup/' },
          resources: [
            { url: 'https://tile.loc.gov/same.jpg', image: 'https://tile.loc.gov/same.jpg' },
          ],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locGetItem.input.parse({ item_id: 'dup' });
    const result = await locGetItem.handler(input, ctx);
    const unique = new Set(result.resource_links);
    expect(unique.size).toBe(result.resource_links.length);
  });

  it('format() renders title, ID, subjects, and URL', () => {
    const output = locGetItem.output.parse({
      item_id: 'loc.pnp.ppmsc.02404',
      title: 'Portrait of Abraham Lincoln',
      date: '1865',
      contributors: ['Brady, Mathew B.'],
      subject_headings: ['Presidents -- United States -- Portraits'],
      notes: [],
      resource_links: ['https://tile.loc.gov/lincoln.jpg'],
      related_items: [],
      url: 'https://www.loc.gov/item/loc.pnp.ppmsc.02404/',
    });
    const blocks = locGetItem.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('loc.pnp.ppmsc.02404');
    expect(text).toContain('Portrait of Abraham Lincoln');
    expect(text).toContain('Brady, Mathew B.');
    expect(text).toContain('Presidents -- United States -- Portraits');
    expect(text).toContain('https://www.loc.gov/item/loc.pnp.ppmsc.02404/');
  });

  it('format() renders sparse item without optional fields', () => {
    const output = locGetItem.output.parse({
      item_id: 'sparse-id',
      title: 'Sparse Item',
      contributors: [],
      subject_headings: [],
      notes: [],
      resource_links: [],
      related_items: [],
      url: 'https://www.loc.gov/item/sparse-id/',
    });
    const blocks = locGetItem.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('sparse-id');
    expect(text).toContain('Sparse Item');
  });

  it('rejects empty item_id at schema level', () => {
    expect(() => locGetItem.input.parse({ item_id: '' })).toThrow();
  });

  it('format() shows truncation note when related_items > 5', () => {
    const related = Array.from({ length: 7 }, (_, i) => `https://www.loc.gov/item/rel${i}/`);
    const output = locGetItem.output.parse({
      item_id: 'many-related',
      title: 'Item with many related',
      contributors: [],
      subject_headings: [],
      notes: [],
      resource_links: [],
      related_items: related,
      url: 'https://www.loc.gov/item/many-related/',
    });
    const blocks = locGetItem.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('and 2 more');
    // The 6th item should not appear in the text
    expect(text).not.toContain('rel5');
  });

  it('format() truncates resource_links to 5 and shows overflow count', () => {
    const links = Array.from({ length: 8 }, (_, i) => `https://tile.loc.gov/file${i}.jpg`);
    const output = locGetItem.output.parse({
      item_id: 'multi-resource',
      title: 'Item with many resources',
      contributors: [],
      subject_headings: [],
      notes: [],
      resource_links: links,
      related_items: [],
      url: 'https://www.loc.gov/item/multi-resource/',
    });
    const blocks = locGetItem.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('and 3 more');
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil
  it('throws RateLimited on HTTP 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Rate limited', { status: 429 })),
    );
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: '2009632251' });
    await expect(locGetItem.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
    });
  });
});
