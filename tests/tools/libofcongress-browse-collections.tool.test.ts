/**
 * @fileoverview Tests for libofcongress_browse_collections tool.
 * @module tests/tools/libofcongress-browse-collections.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  getEnrichment,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locBrowseCollections } from '@/mcp-server/tools/definitions/libofcongress-browse-collections.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';

/**
 * Live-shaped LOC /collections/ payload: results point at an /about-this-collection/ subpage,
 * carry a top-level `count`, and paginate with a `results` display range and no `pages` key.
 * The Aaron Copland entry is the load-bearing one — its title does not match its route, so a
 * title-derived slug ("aaron-copland-collection") is visibly wrong.
 */
function makeCollectionsResponse(overrides: { results?: object[]; pagination?: object } = {}) {
  return JSON.stringify({
    results: overrides.results ?? [
      {
        url: 'https://www.loc.gov/collections/aaron-copland/about-this-collection/',
        title: 'Aaron Copland Collection',
        description: 'Music manuscripts, correspondence, and photographs of Aaron Copland.',
        count: 982,
        item: { total: 941, digitized: 941 },
      },
      {
        url: 'https://www.loc.gov/collections/baseball-cards/about-this-collection/',
        title: 'Baseball Cards',
        description: 'Historic baseball card collection.',
        count: 2100,
      },
    ],
    pagination: overrides.pagination ?? {
      total: 2,
      perpage: 25,
      results: '1 - 2',
    },
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

describe('locBrowseCollections', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns collections when called without a query', async () => {
    vi.stubGlobal('fetch', mockFetch(makeCollectionsResponse()));
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({});
    const result = await locBrowseCollections.handler(input, ctx);

    expect(result.collections).toHaveLength(2);
    expect(result.collections[0].slug).toBe('aaron-copland');
    expect(result.collections[0].title).toBe('Aaron Copland Collection');
    expect(result.collections[0].url).toContain('aaron-copland');
    expect(result.total).toBe(2);
    // Enrichment echoes total for both structuredContent and content[] clients
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(2);
  });

  it('extracts the route slug, not a title-derived one, from every collection URL', async () => {
    vi.stubGlobal('fetch', mockFetch(makeCollectionsResponse()));
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({});
    const result = await locBrowseCollections.handler(input, ctx);

    expect(result.collections.map((c) => c.slug)).toEqual(['aaron-copland', 'baseball-cards']);
    for (const col of result.collections) {
      expect(col.slug).not.toContain('/');
      // The slug must round-trip to the collection's own route
      expect(col.url).toContain(`/collections/${col.slug}/`);
    }
  });

  it('populates item_count from the upstream count through the full handler path', async () => {
    vi.stubGlobal('fetch', mockFetch(makeCollectionsResponse()));
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({});
    const result = await locBrowseCollections.handler(input, ctx);

    // 982 is the collection-level count; 941 is the nested item.total on the same result
    expect(result.collections[0].item_count).toBe(982);
    expect(result.collections[1].item_count).toBe(2100);
  });

  it('renders item_count from a live-shaped upstream payload in format()', async () => {
    vi.stubGlobal('fetch', mockFetch(makeCollectionsResponse()));
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({});
    const result = await locBrowseCollections.handler(input, ctx);

    const blocks = locBrowseCollections.format!(locBrowseCollections.output.parse(result));
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('**Slug:** aaron-copland');
    expect(text).toContain('**Items:** 982');
  });

  it('sends keyword query param when query is provided', async () => {
    const fetchSpy = mockFetch(makeCollectionsResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({ query: 'civil war' });
    await locBrowseCollections.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('civil');
  });

  it('omits q param when query is empty string (form-client payload)', async () => {
    const fetchSpy = mockFetch(makeCollectionsResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({ query: '' });
    await locBrowseCollections.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).not.toContain('&q=');
  });

  it('populates enrichment.notice and returns empty array on no results with keyword', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeCollectionsResponse({
          results: [],
          pagination: { total: 0, perpage: 25, pages: 0 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({ query: 'xyzzy_no_match' });
    const result = await locBrowseCollections.handler(input, ctx);

    expect(result.collections).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(String(enrichment.notice)).toContain('xyzzy_no_match');
    expect(enrichment.totalCount).toBe(0);
  });

  it('enriches totalCount 0 when upstream reports a nonzero total with empty results', async () => {
    // LOC returns pagination.total: 1 with results: [] for a no-match keyword. The enriched
    // totalCount must agree with the returned total (0), not the raw upstream count.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeCollectionsResponse({
          results: [],
          pagination: { total: 1, perpage: 2, pages: 0 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({
      query: 'zzzz_no_such_collection_abcdef',
      limit: 2,
    });
    const result = await locBrowseCollections.handler(input, ctx);

    expect(result.collections).toHaveLength(0);
    expect(result.total).toBe(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
  });

  it('computes has_next correctly', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(makeCollectionsResponse({ pagination: { total: 50, perpage: 25, pages: 2 } })),
    );
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({ page: 1 });
    const result = await locBrowseCollections.handler(input, ctx);
    expect(result.has_next).toBe(true);
  });

  it('throws ServiceUnavailable on HTML response', async () => {
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Blocked</body></html>', 200));
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({});
    await expect(locBrowseCollections.handler(input, ctx)).rejects.toThrow();
  });

  it('format() renders slug, title, description, item_count, and URL', () => {
    const output = locBrowseCollections.output.parse({
      collections: [
        {
          slug: 'civil-war-glass-negatives',
          title: 'Civil War Glass Negatives',
          description: 'Glass negatives from the Civil War era.',
          item_count: 7616,
          url: 'https://www.loc.gov/collections/civil-war-glass-negatives/',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locBrowseCollections.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('civil-war-glass-negatives');
    expect(text).toContain('Civil War Glass Negatives');
    expect(text).toContain('7616');
    expect(text).toContain('https://www.loc.gov/collections/civil-war-glass-negatives/');
  });

  it('format() renders sparse collection — no description or item_count', () => {
    const output = locBrowseCollections.output.parse({
      collections: [
        {
          slug: 'sparse-col',
          title: 'Sparse Collection',
          url: 'https://www.loc.gov/collections/sparse-col/',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locBrowseCollections.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('sparse-col');
    expect(text).toContain('Sparse Collection');
  });

  it('format() renders pagination summary when results are empty', () => {
    const output = locBrowseCollections.output.parse({
      collections: [],
      total: 0,
      page: 1,
      pages: 0,
      has_next: false,
    });
    const blocks = locBrowseCollections.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    // Pagination summary line must always be present; notice is in the enrichment trailer
    expect(text).toContain('Total:');
    expect(text).toContain('Page:');
  });

  it('returns empty result with enrichment.notice when out-of-range page (page > 1, pages === 0)', async () => {
    vi.stubGlobal('fetch', mockFetch('', 400));
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({ page: 5 });
    const result = await locBrowseCollections.handler(input, ctx);

    expect(result.collections).toHaveLength(0);
    expect(result.has_next).toBe(false);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(String(enrichment.notice)).toContain('5');
  });

  it('returns collections served beyond the computed count instead of discarding them (#33 Bug B)', async () => {
    // A page past the computed count can still carry real collections — the old guard discarded them.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeCollectionsResponse({
          results: [
            {
              url: 'https://www.loc.gov/collections/some-col/',
              title: 'Some Collection',
            },
          ],
          pagination: { total: 50, perpage: 25, pages: 2 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({ page: 10 });
    const result = await locBrowseCollections.handler(input, ctx);

    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].slug).toBe('some-col');
    expect(result.page).toBe(10);
    expect(result.pages).toBeGreaterThanOrEqual(result.page);
    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('reads total from `of` (the collection count), not the LOC page-count `total`', async () => {
    // Live /collections/ shape: `of` is the collection count, `total` the page count.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeCollectionsResponse({
          pagination: { of: 583, total: 24, perpage: 25, results: '1 - 25' },
        }),
      ),
    );
    const ctx = createMockContext();
    const result = await locBrowseCollections.handler(locBrowseCollections.input.parse({}), ctx);

    expect(result.total).toBe(583);
    expect(getEnrichment(ctx).totalCount).toBe(583);
  });

  it('returns empty result with no-query-fallback enrichment.notice when query absent and results empty', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeCollectionsResponse({
          results: [],
          pagination: { total: 0, perpage: 25, pages: 0 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({});
    const result = await locBrowseCollections.handler(input, ctx);

    expect(result.collections).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    // No keyword case — should mention temporary unavailability
    expect(String(enrichment.notice)).toContain('unavailable');
  });

  it('rejects limit=0 at schema level', () => {
    expect(() => locBrowseCollections.input.parse({ limit: 0 })).toThrow();
  });

  it('rejects page=0 at schema level', () => {
    expect(() => locBrowseCollections.input.parse({ page: 0 })).toThrow();
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil
  it('throws RateLimited on HTTP 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })),
    );
    const ctx = createMockContext({ errors: locBrowseCollections.errors });
    const input = locBrowseCollections.input.parse({});
    await expect(locBrowseCollections.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
    });
  });
});
