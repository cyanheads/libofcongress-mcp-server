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
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(result.languages).toEqual([]);
    expect(result.locations).toEqual([]);
    expect(result.former_ids).toEqual([]);
    expect(result.original_formats).toEqual([]);
    expect(result.online_formats).toEqual([]);
    expect(result.summary).toBeUndefined();
    expect(result.call_number).toBeUndefined();
    expect(result.access_restricted).toBeUndefined();
  });

  it('returns the curated metadata fields for a dense item', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeItemResponse({
          summary: 'A political cartoon commenting on the 1884 election.',
          language: ['english'],
          location: ['united states'],
          call_number: 'Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]',
          number_former_id: ['http://www.loc.gov/item/13903333'],
          original_format: ['photo, print, drawing'],
          online_format: ['image'],
          access_restricted: true,
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locGetItem.input.parse({ item_id: '2005680380' });
    const result = await locGetItem.handler(input, ctx);

    expect(result.summary).toBe('A political cartoon commenting on the 1884 election.');
    expect(result.languages).toEqual(['english']);
    expect(result.locations).toEqual(['united states']);
    expect(result.call_number).toBe('Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]');
    expect(result.former_ids).toEqual(['http://www.loc.gov/item/13903333']);
    expect(result.original_formats).toEqual(['photo, print, drawing']);
    expect(result.online_formats).toEqual(['image']);
    expect(result.access_restricted).toBe(true);
    // The result satisfies the declared output contract, not just the type.
    expect(() => locGetItem.output.parse(result)).not.toThrow();
  });

  it('NotFound data carries the caller-facing id, never the internal request URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: 'TOTALLY_FAKE_ID' });
    const err = await locGetItem.handler(input, ctx).catch((e: unknown) => e);

    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect(data.reason).toBe('item_not_found');
    expect(data.itemId).toBe('TOTALLY_FAKE_ID');
  });

  it('ServiceUnavailable from an HTML body does not leak the internal request URL', async () => {
    // Neither tool's catch block remaps ServiceUnavailable, so this error reaches the
    // client with whatever data the service attached — the fix has to be at the source.
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Rate limited</body></html>'));
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: '2009632251' });
    const err = await locGetItem.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect((err as Error).message).not.toContain('www.loc.gov');
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
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
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
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      resource_links: [],
      related_items: [],
      url: 'https://www.loc.gov/item/sparse-id/',
    });
    const blocks = locGetItem.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('sparse-id');
    expect(text).toContain('Sparse Item');
    // Nothing fabricated for absent upstream data.
    expect(text).not.toContain('Summary:');
    expect(text).not.toContain('Call number:');
    expect(text).not.toContain('Access restricted:');
    expect(text).not.toContain('Languages:');
  });

  it('format() renders every curated metadata field', () => {
    const output = locGetItem.output.parse({
      item_id: '2005680380',
      title: 'Political cartoon',
      summary: 'A political cartoon commenting on the 1884 election.',
      contributors: [],
      subject_headings: [],
      notes: [],
      languages: ['english'],
      locations: ['united states'],
      call_number: 'Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]',
      former_ids: ['http://www.loc.gov/item/13903333'],
      original_formats: ['photo, print, drawing'],
      online_formats: ['image'],
      access_restricted: true,
      resource_links: [],
      related_items: [],
      url: 'https://www.loc.gov/item/2005680380/',
    });
    const text = (locGetItem.format!(output)[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('A political cartoon commenting on the 1884 election.');
    expect(text).toContain('english');
    expect(text).toContain('united states');
    expect(text).toContain('Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]');
    expect(text).toContain('http://www.loc.gov/item/13903333');
    expect(text).toContain('photo, print, drawing');
    expect(text).toContain('image');
    expect(text).toContain('**Access restricted:** yes');
  });

  it('format() renders access_restricted: false rather than omitting it', () => {
    const output = locGetItem.output.parse({
      item_id: 'open-item',
      title: 'Open Item',
      contributors: [],
      subject_headings: [],
      notes: [],
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      access_restricted: false,
      resource_links: [],
      related_items: [],
      url: 'https://www.loc.gov/item/open-item/',
    });
    const text = (locGetItem.format!(output)[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('**Access restricted:** no');
  });

  it('rejects empty item_id at schema level', () => {
    expect(() => locGetItem.input.parse({ item_id: '' })).toThrow();
  });

  /**
   * A content[]-only client (Claude Desktop) never sees structuredContent, so an entry
   * format() omits is unreachable for it — an overflow count discloses the gap without
   * closing it. The format-parity lint rule injects a single-element array, so it cannot
   * see truncation; these assertions are the only thing holding the arrays complete.
   */
  it('format() renders every related_items entry, not a truncated head', () => {
    const related = Array.from({ length: 7 }, (_, i) => `https://www.loc.gov/item/rel${i}/`);
    const output = locGetItem.output.parse({
      item_id: 'many-related',
      title: 'Item with many related',
      contributors: [],
      subject_headings: [],
      notes: [],
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      resource_links: [],
      related_items: related,
      url: 'https://www.loc.gov/item/many-related/',
    });
    const blocks = locGetItem.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    for (const entry of related) expect(text).toContain(entry);
    expect(text).not.toContain('more');
  });

  it('format() renders every resource_links entry, not a truncated head', () => {
    const links = Array.from({ length: 8 }, (_, i) => `https://tile.loc.gov/file${i}.jpg`);
    const output = locGetItem.output.parse({
      item_id: 'multi-resource',
      title: 'Item with many resources',
      contributors: [],
      subject_headings: [],
      notes: [],
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      resource_links: links,
      related_items: [],
      url: 'https://www.loc.gov/item/multi-resource/',
    });
    const blocks = locGetItem.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    for (const link of links) expect(text).toContain(link);
    expect(text).toContain('**Digital resources (8):**');
    expect(text).not.toContain('more');
  });

  it('format() reaches every structuredContent array value on a dense item', () => {
    // Live worst case measured on item mgw1b.721 (342 resource_links); 342 entries here
    // keeps the reachability contract honest at the size that motivated the cap.
    const links = Array.from({ length: 342 }, (_, i) => `https://tile.loc.gov/mgw1b.721/${i}.jp2`);
    const related = Array.from({ length: 6 }, (_, i) => `https://www.loc.gov/item/rel${i}/`);
    const output = locGetItem.output.parse({
      item_id: 'mgw1b.721',
      title: 'Diary, January 1 - December 31, 1772',
      contributors: [],
      subject_headings: [],
      notes: [],
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      resource_links: links,
      related_items: related,
      url: 'https://www.loc.gov/item/mgw1b.721/',
    });
    const text = (locGetItem.format!(output)[0] as { type: 'text'; text: string }).text;
    for (const value of [...links, ...related]) expect(text).toContain(value);
  });

  it('returns an absolute https url when upstream item.url is protocol-relative', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: { title: 'Samples of German endpapers', url: '//lccn.loc.gov/2009632251' },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locGetItem.input.parse({ item_id: '2009632251' });
    const result = await locGetItem.handler(input, ctx);
    expect(result.url).toBe('https://lccn.loc.gov/2009632251');
    expect(result.url.startsWith('//')).toBe(false);
  });

  it('resolves a multi-segment newspaper item_id without mangling slashes', async () => {
    const fetchSpy = mockFetch(
      JSON.stringify({
        item: {
          title: 'The Evening Star',
          url: 'https://www.loc.gov/item/sn95047246/1935-09-05/ed-1/',
        },
        resources: [],
        related_items: [],
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locGetItem.input.parse({ item_id: 'sn95047246/1935-09-05/ed-1' });
    const result = await locGetItem.handler(input, ctx);
    expect(result.item_id).toBe('sn95047246/1935-09-05/ed-1');
    expect(result.title).toBe('The Evening Star');
    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/item/sn95047246/1935-09-05/ed-1/');
    expect(calledUrl).not.toContain('%2F');
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
