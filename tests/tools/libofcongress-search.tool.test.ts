/**
 * @fileoverview Tests for libofcongress_search tool.
 * @module tests/tools/libofcongress-search.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  getEnrichment,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locSearch } from '@/mcp-server/tools/definitions/libofcongress-search.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';

/** Minimal mock search response from the LOC JSON API */
function makeSearchResponse(overrides: { results?: object[]; pagination?: object } = {}) {
  return JSON.stringify({
    results: overrides.results ?? [
      {
        id: 'https://www.loc.gov/item/2009632251/',
        title: 'Test Photo',
        date: '1920',
        description: 'A test description',
        original_format: ['photo'],
        url: 'https://www.loc.gov/item/2009632251/',
      },
    ],
    pagination: overrides.pagination ?? {
      total: 1,
      perpage: 25,
      pages: 1,
      page: 1,
    },
  });
}

/** Return a fetch stub that resolves a single response body */
function mockFetch(body: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('locSearch', () => {
  beforeEach(async () => {
    // Reset rate-limit state by re-initializing the service
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    // Default to a small request delay in tests
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
  });

  it('returns items and pagination for a basic keyword search', async () => {
    vi.stubGlobal('fetch', mockFetch(makeSearchResponse()));
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'civil war photos' });
    const result = await locSearch.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('2009632251');
    expect(result.items[0].title).toBe('Test Photo');
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.has_next).toBe(false);
    // Enrichment echoes query and total for both structuredContent and content[] clients
    const enrichment = getEnrichment(ctx);
    expect(enrichment.effectiveQuery).toBe('civil war photos');
    expect(enrichment.totalCount).toBe(1);
  });

  it('populates enrichment.notice and returns empty items on zero results', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({ results: [], pagination: { total: 0, perpage: 25, pages: 0 } }),
      ),
    );
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'xyzzy_no_match_expected' });
    const result = await locSearch.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.has_next).toBe(false);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('xyzzy_no_match_expected');
    expect(enrichment.effectiveQuery).toBe('xyzzy_no_match_expected');
    expect(enrichment.totalCount).toBe(0);
  });

  it('applies format filter — passes format slug in the URL', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'maps', format: 'map' });
    await locSearch.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/maps/');
  });

  it('applies date range filter in querystring', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'war', date_start: 1920, date_end: 1945 });
    await locSearch.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('dates=1920%2F1945');
  });

  it('applies subject and location facets in querystring', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearch.input.parse({
      query: 'photos',
      subject: 'World War, 1939-1945',
      location: 'oklahoma',
    });
    await locSearch.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('fa=');
    expect(calledUrl).toContain('subject%3AWorld');
    expect(calledUrl).toContain('location%3Aoklahoma');
  });

  it('strips empty subject/location strings (form-client payload)', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'photos', subject: '', location: '' });
    await locSearch.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).not.toContain('fa=');
  });

  it('computes has_next correctly for multi-page results', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({
          pagination: { total: 50, perpage: 25, pages: 2, page: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'test', page: 1 });
    const result = await locSearch.handler(input, ctx);
    expect(result.has_next).toBe(true);
    expect(result.pages).toBe(2);
  });

  it('throws on HTML response (rate-limited proxy page)', async () => {
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Error</body></html>', 200));
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'test' });
    await expect(locSearch.handler(input, ctx)).rejects.toThrow();
  });

  it('format() renders title, ID, and URL in output text', () => {
    const output = locSearch.output.parse({
      items: [
        {
          id: 'loc.pnp.ppmsc.02404',
          title: 'Sample Photo',
          date: '1920',
          format: 'photo',
          is_item: true,
          url: 'https://www.loc.gov/item/loc.pnp.ppmsc.02404/',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearch.format!(output);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('loc.pnp.ppmsc.02404');
    expect(text).toContain('Sample Photo');
    expect(text).toContain('https://www.loc.gov/item/loc.pnp.ppmsc.02404/');
  });

  it('format() renders pagination summary even when items are empty', () => {
    const output = locSearch.output.parse({
      items: [],
      total: 0,
      page: 1,
      pages: 0,
      has_next: false,
    });
    const blocks = locSearch.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    // Pagination summary line must always be present (notice is in the enrichment trailer, not here)
    expect(text).toContain('Total:');
    expect(text).toContain('Page:');
  });

  it('format() renders sparse item — no date or format', () => {
    const output = locSearch.output.parse({
      items: [
        {
          id: 'sparse-id',
          title: 'Sparse Item',
          is_item: true,
          url: 'https://www.loc.gov/item/sparse-id/',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearch.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('sparse-id');
    expect(text).toContain('Sparse Item');
  });

  it('rejects inverted date range with ValidationError', async () => {
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'history', date_start: 1950, date_end: 1920 });
    await expect(locSearch.handler(input, ctx)).rejects.toSatisfy(
      (e: unknown) => (e as { code?: number }).code === JsonRpcErrorCode.ValidationError,
    );
  });

  it('returns empty result with enrichment.notice when page > pages', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({
          results: [
            {
              id: 'https://www.loc.gov/item/2009632251/',
              title: 'Some Item',
              url: 'https://www.loc.gov/item/2009632251/',
            },
          ],
          pagination: { total: 100, perpage: 25, pages: 4, page: 999 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'test', page: 999 });
    const result = await locSearch.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.has_next).toBe(false);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(String(enrichment.notice)).toContain('999');
    expect(String(enrichment.notice)).toContain('4');
    expect(enrichment.effectiveQuery).toBe('test');
    expect(enrichment.totalCount).toBe(100);
  });

  it('returns empty result when LOC API returns HTTP 400 (out-of-range page)', async () => {
    vi.stubGlobal('fetch', mockFetch('', 400));
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'test', page: 99999 });
    const result = await locSearch.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.has_next).toBe(false);
  });

  it('rejects empty query at schema level', () => {
    expect(() => locSearch.input.parse({ query: '' })).toThrow();
  });

  it('returns empty result with enrichment.notice when page > pages and items present', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({
          results: [
            {
              id: 'https://www.loc.gov/item/someitem/',
              title: 'Some Item',
              url: 'https://www.loc.gov/item/someitem/',
            },
          ],
          pagination: { total: 50, perpage: 25, pages: 2, page: 5 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'history', page: 5 });
    const result = await locSearch.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.has_next).toBe(false);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(String(enrichment.notice)).toContain('5');
    expect(String(enrichment.notice)).toContain('2');
  });

  it('query with injection chars is handled without URL structure breakage', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearch.input.parse({
      query: "'; DROP TABLE items; SELECT * FROM items WHERE '1'='1",
    });
    await locSearch.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    // URL must remain parseable and not contain raw SQL injection
    expect(() => new URL(calledUrl)).not.toThrow();
    expect(calledUrl).toContain('fo=json');
    expect(calledUrl).not.toContain("'; DROP TABLE");
  });

  it('rejects limit=0 at schema level (below min)', () => {
    expect(() => locSearch.input.parse({ query: 'test', limit: 0 })).toThrow();
  });

  it('rejects limit=101 at schema level (above max)', () => {
    expect(() => locSearch.input.parse({ query: 'test', limit: 101 })).toThrow();
  });

  it('rejects page=0 at schema level (below min)', () => {
    expect(() => locSearch.input.parse({ query: 'test', page: 0 })).toThrow();
  });

  it('format() includes description in output text when present', () => {
    const output = locSearch.output.parse({
      items: [
        {
          id: 'desc-item',
          title: 'Described Item',
          date: '1940',
          format: 'photo',
          description: 'This is a photograph of the subject.',
          is_item: true,
          url: 'https://www.loc.gov/item/desc-item/',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearch.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('photograph of the subject');
  });

  it('format() includes format label in output when present', () => {
    const output = locSearch.output.parse({
      items: [
        {
          id: 'fmt-item',
          title: 'Map Item',
          format: 'map',
          is_item: true,
          url: 'https://www.loc.gov/item/fmt-item/',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearch.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('map');
  });

  it('surfaces is_item:false for collection landing pages and is_item:true for items', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({
          results: [
            {
              id: 'http://www.loc.gov/collections/civil-war/about-this-collection/',
              title: 'Civil War Collection',
              url: 'http://www.loc.gov/collections/civil-war/about-this-collection/',
              original_format: ['collection'],
            },
            {
              id: 'https://www.loc.gov/item/2009632251/',
              title: 'A Photograph',
              url: 'https://www.loc.gov/item/2009632251/',
              original_format: ['photo'],
            },
          ],
          pagination: { total: 2, perpage: 25, pages: 1, page: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'civil war' });
    const result = await locSearch.handler(input, ctx);
    expect(result.items[0].is_item).toBe(false);
    expect(result.items[0].id).toBe('collections/civil-war/about-this-collection');
    expect(result.items[1].is_item).toBe(true);
    expect(result.items[1].id).toBe('2009632251');
  });

  it('format() flags collection landing pages as non-get_item targets', () => {
    const output = locSearch.output.parse({
      items: [
        {
          id: 'collections/civil-war/about-this-collection',
          title: 'Civil War Collection',
          format: 'collection',
          is_item: false,
          url: 'https://www.loc.gov/collections/civil-war/about-this-collection/',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearch.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Non-item result');
    expect(text).toContain('not a libofcongress_get_item target');
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil, must not bleed into other tests
  it('throws RateLimited on HTTP 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Rate limited', { status: 429 })),
    );
    const ctx = createMockContext({ errors: locSearch.errors });
    const input = locSearch.input.parse({ query: 'anything' });
    await expect(locSearch.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
    });
  });
});
