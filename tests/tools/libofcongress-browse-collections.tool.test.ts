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

function makeCollectionsResponse(overrides: { results?: object[]; pagination?: object } = {}) {
  return JSON.stringify({
    results: overrides.results ?? [
      {
        url: 'https://www.loc.gov/collections/civil-war-glass-negatives/',
        title: 'Civil War Glass Negatives',
        description: 'Glass negatives from the Civil War era.',
      },
      {
        url: 'https://www.loc.gov/collections/baseball-cards/',
        title: 'Baseball Cards',
        description: 'Historic baseball card collection.',
      },
    ],
    pagination: overrides.pagination ?? {
      total: 2,
      perpage: 25,
      pages: 1,
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
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
  });

  it('returns collections when called without a query', async () => {
    vi.stubGlobal('fetch', mockFetch(makeCollectionsResponse()));
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({});
    const result = await locBrowseCollections.handler(input, ctx);

    expect(result.collections).toHaveLength(2);
    expect(result.collections[0].slug).toBe('civil-war-glass-negatives');
    expect(result.collections[0].title).toBe('Civil War Glass Negatives');
    expect(result.collections[0].url).toContain('civil-war-glass-negatives');
    expect(result.total).toBe(2);
    // Enrichment echoes total for both structuredContent and content[] clients
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(2);
  });

  it('extracts slug from collection URL', async () => {
    vi.stubGlobal('fetch', mockFetch(makeCollectionsResponse()));
    const ctx = createMockContext();
    const input = locBrowseCollections.input.parse({});
    const result = await locBrowseCollections.handler(input, ctx);

    for (const col of result.collections) {
      expect(col.slug).toBeTruthy();
      expect(col.slug).not.toContain('/');
    }
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

  it('returns empty result with enrichment.notice when page > pages (contradictory pagination)', async () => {
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

    expect(result.collections).toHaveLength(0);
    expect(result.has_next).toBe(false);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(String(enrichment.notice)).toContain('10');
    expect(String(enrichment.notice)).toContain('2');
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
