/**
 * @fileoverview Tests for the LocApiService — init/accessor guard, pure helpers,
 * HTTP error classification, rate-limit state, and security invariants.
 * @module tests/services/loc-api-service.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLocApiService,
  initLocApiService,
  LocApiService,
} from '@/services/loc-api/loc-api-service.js';

function mockFetch(body: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function makeSearchResponse(overrides: { results?: object[]; pagination?: object } = {}) {
  return JSON.stringify({
    results: overrides.results ?? [
      {
        id: 'https://www.loc.gov/item/2009632251/',
        title: 'Test Photo',
        date: '1920',
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

describe('LocApiService init/accessor', () => {
  it('getLocApiService() returns the initialized instance', async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    const svc = getLocApiService();
    expect(svc).toBeInstanceOf(LocApiService);
  });
});

describe('LocApiService.search', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes protocol-relative URLs in item url field to https:', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              id: 'https://www.loc.gov/item/proto-id/',
              title: 'Proto Item',
              url: '//lccn.loc.gov/proto-id',
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1, page: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', page: 1 }, ctx);
    expect(result.items[0].url).toMatch(/^https:/);
  });

  it('extracts item id from full URL when id field is a URL', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              id: 'https://www.loc.gov/item/2009632251/',
              title: 'Photo',
              url: 'https://www.loc.gov/item/2009632251/',
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'civil war', page: 1 }, ctx);
    // Should extract '2009632251', not the full URL
    expect(result.items[0].id).toBe('2009632251');
    expect(result.items[0].id).not.toContain('https://');
  });

  it('falls back to url field when id is absent from search result', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              // id absent; service should fall back to url
              url: 'https://www.loc.gov/item/fallback-id/',
              title: 'Fallback Item',
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', page: 1 }, ctx);
    expect(result.items[0].id).toBe('fallback-id');
  });

  it('coerces array title to first string', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              id: 'https://www.loc.gov/item/arr-title/',
              title: ['First Title', 'Second Title'],
              url: 'https://www.loc.gov/item/arr-title/',
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', page: 1 }, ctx);
    expect(result.items[0].title).toBe('First Title');
  });

  it('uses Untitled when title is absent from search result', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              id: 'https://www.loc.gov/item/no-title/',
              url: 'https://www.loc.gov/item/no-title/',
              // title absent
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', page: 1 }, ctx);
    expect(result.items[0].title).toBe('Untitled');
  });

  it('reads pagination from nested content envelope when top-level is absent', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          content: {
            results: [
              {
                id: 'https://www.loc.gov/item/nested/',
                title: 'Nested Item',
                url: 'https://www.loc.gov/item/nested/',
              },
            ],
            pagination: { total: 5, perpage: 25, pages: 1 },
          },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', page: 1 }, ctx);
    expect(result.items).toHaveLength(1);
    expect(result.pagination.total).toBe(5);
  });

  it('throws ServiceUnavailable on non-OK, non-404, non-429 HTTP status', async () => {
    vi.stubGlobal('fetch', mockFetch('Internal Server Error', 500));
    const ctx = createMockContext();
    const svc = getLocApiService();
    await expect(svc.search({ query: 'test', page: 1 }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
  });

  it('returns empty items and pages:0 sentinel on HTTP 400 (out-of-range page)', async () => {
    vi.stubGlobal('fetch', mockFetch('', 400));
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', page: 99999 }, ctx);
    expect(result.items).toHaveLength(0);
    expect(result.pagination.pages).toBe(0);
  });

  it('returns empty items and pages:0 sentinel on HTTP 520 (out-of-range page)', async () => {
    vi.stubGlobal('fetch', mockFetch('', 520));
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', page: 50000 }, ctx);
    expect(result.items).toHaveLength(0);
    expect(result.pagination.pages).toBe(0);
  });

  it('reads total from `of` (item count) and caps pages at the ~100k retrieval ceiling (#33)', async () => {
    // Live LOC pagination: `of` is the item count, `total` the page count, and there is no `pages`
    // key — the inverse of the intuitive names. ~1.78M items span ~17,800 pages, but only ~100,000
    // items (1,000 pages at this size) are retrievable.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            { id: 'https://www.loc.gov/item/x/', title: 'X', url: 'https://www.loc.gov/item/x/' },
          ],
          pagination: { of: 1779931, total: 17800, perpage: 100, results: '1 - 100' },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'civil rights', limit: 100, page: 1 }, ctx);

    expect(result.pagination.total).toBe(1779931);
    expect(result.pagination.pages).toBe(1000);
    expect(result.pagination.ceilingReached).toBe(true);
    expect(result.pagination.hasNext).toBe(true);
  });

  it('trusts a served deep page over a low computed page count, keeping page <= pages (#33)', async () => {
    // No `of`, a small `total`, but LOC served real items past the computed count — advertise at
    // least the reached page rather than a count that contradicts the served data.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            { id: 'https://www.loc.gov/item/y/', title: 'Y', url: 'https://www.loc.gov/item/y/' },
          ],
          pagination: { total: 50, perpage: 25, results: '226 - 250' },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', limit: 25, page: 10 }, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.pagination.pages).toBe(10);
    expect(result.pagination.page).toBe(10);
  });

  it('flags ceilingReached on the 400 sentinel only when the page is past the retrieval ceiling (#33)', async () => {
    vi.stubGlobal('fetch', mockFetch('', 400));
    const ctx = createMockContext();
    const svc = getLocApiService();

    const past = await svc.search({ query: 'test', limit: 25, page: 5000 }, ctx);
    expect(past.pagination.pages).toBe(0);
    expect(past.pagination.ceilingReached).toBe(true); // 5000 > 100000 / 25

    const within = await svc.search({ query: 'test', limit: 25, page: 8 }, ctx);
    expect(within.pagination.ceilingReached).toBe(false); // 8 <= 100000 / 25
  });

  it('throws ServiceUnavailable when HTML is returned', async () => {
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Rate limited</body></html>'));
    const ctx = createMockContext();
    const svc = getLocApiService();
    await expect(svc.search({ query: 'test', page: 1 }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
  });

  it('joins description array into a single string', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              id: 'https://www.loc.gov/item/desc-arr/',
              title: 'Desc Array Item',
              description: ['Part one.', 'Part two.'],
              url: 'https://www.loc.gov/item/desc-arr/',
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', page: 1 }, ctx);
    expect(result.items[0].description).toContain('Part one.');
    expect(result.items[0].description).toContain('Part two.');
  });

  it('injection string in query is percent-encoded in the request URL', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();
    const injection = "'; DROP TABLE items; --";
    await svc.search({ query: injection, page: 1 }, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    // Injection chars must be percent-encoded, not raw
    expect(calledUrl).not.toContain("'; DROP TABLE");
    expect(calledUrl).toContain('fo=json');
  });

  it('userAgent env var value is never surfaced in search result data', async () => {
    const secretAgent = 'my-secret-user-agent-string';
    process.env.LOC_USER_AGENT = secretAgent;
    vi.stubGlobal('fetch', mockFetch(makeSearchResponse()));
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', page: 1 }, ctx);

    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain(secretAgent);
    delete process.env.LOC_USER_AGENT;
  });

  it('flags non-item results (collection, exhibit, newspaper page) is_item:false; /item/ results is_item:true', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              id: 'http://www.loc.gov/collections/civil-war/about-this-collection/',
              title: 'Civil War Collection',
              url: 'http://www.loc.gov/collections/civil-war/about-this-collection/',
              original_format: ['collection', 'web page'],
            },
            {
              // Exhibit page — not a collection, but still not a get_item item
              id: 'https://www.loc.gov/exhibits/lincoln/',
              title: 'Abraham Lincoln Exhibit',
              url: 'https://www.loc.gov/exhibits/lincoln/',
              original_format: ['web page'],
            },
            {
              // Chronicling America newspaper-page /resource/ URL — get_item cannot consume it
              id: 'https://www.loc.gov/resource/gdc.00519798608/?sp=102',
              title: "Frank Leslie's Illustrated Newspaper",
              url: 'https://www.loc.gov/resource/gdc.00519798608/?sp=102',
              original_format: ['newspaper'],
            },
            {
              id: 'https://www.loc.gov/item/2009632251/',
              title: 'A Photograph',
              url: 'https://www.loc.gov/item/2009632251/',
              original_format: ['photo'],
            },
          ],
          pagination: { total: 4, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'civil war', page: 1 }, ctx);
    const [collection, exhibit, newspaperPage, item] = result.items;
    expect(collection.is_item).toBe(false);
    expect(collection.id).toBe('collections/civil-war/about-this-collection');
    expect(exhibit.is_item).toBe(false);
    expect(newspaperPage.is_item).toBe(false);
    expect(item.is_item).toBe(true);
    expect(item.id).toBe('2009632251');
  });

  it('preserves the full multi-segment path for deep /item/ newspaper URLs', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              id: 'https://www.loc.gov/item/sn95047246/1935-09-05/ed-1/',
              title: 'The Evening Star',
              url: 'https://www.loc.gov/item/sn95047246/1935-09-05/ed-1/',
              original_format: ['newspaper'],
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'newspaper', page: 1 }, ctx);
    // Full path retained — not truncated to the last segment, no leading item/ prefix
    expect(result.items[0].id).toBe('sn95047246/1935-09-05/ed-1');
    expect(result.items[0].is_item).toBe(true);
  });

  it('routes a collection-scoped search through the collection endpoint', async () => {
    // Live shape of /collections/{slug}/: the same results[]/pagination envelope /search/
    // returns, with `results` as a display range and no `pages` key.
    const fetchSpy = mockFetch(
      JSON.stringify({
        results: [
          {
            id: 'http://www.loc.gov/item/2023781133/',
            url: 'https://www.loc.gov/item/2023781133/',
            title: 'Letter from Aaron Copland to Serge Koussevitzky, April 1932',
          },
        ],
        pagination: { total: 232, perpage: 3, results: '1 - 3' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search(
      { query: 'correspondence', collectionSlug: 'aaron-copland', page: 1 },
      ctx,
    );

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/collections/aaron-copland/');
    expect(calledUrl).not.toContain('/search/');
    expect(calledUrl).toContain('q=correspondence');
    // Normalizes through the existing path — no parallel parser for the collection envelope
    expect(result.items[0].id).toBe('2023781133');
    expect(result.items[0].is_item).toBe(true);
    expect(result.pagination.total).toBe(232);
  });

  it('percent-encodes a collection slug so it cannot escape the collections path', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();
    await svc.search({ query: 'test', collectionSlug: '../../item/2009632251', page: 1 }, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/collections/');
    expect(calledUrl).not.toContain('/collections/../');
    expect(new URL(calledUrl).pathname).toBe('/collections/..%2F..%2Fitem%2F2009632251/');
  });

  it('throws NotFound when an unrecognized collection slug 404s upstream', async () => {
    vi.stubGlobal('fetch', mockFetch(JSON.stringify({ exception: 'not found' }), 404));
    const ctx = createMockContext();
    const svc = getLocApiService();
    await expect(
      svc.search({ query: 'test', collectionSlug: 'no-such-collection-xyz9', page: 1 }, ctx),
    ).rejects.toMatchObject({ code: JsonRpcErrorCode.NotFound });
  });

  it('NotFound from an upstream 404 carries no internal request URL', async () => {
    // The search path's query string echoes the caller's own search terms back in the URL.
    vi.stubGlobal('fetch', mockFetch(JSON.stringify({ exception: 'not found' }), 404));
    const ctx = createMockContext();
    const svc = getLocApiService();
    const err = await svc
      .search({ query: 'secret terms', collectionSlug: 'no-such-collection-xyz9', page: 1 }, ctx)
      .catch((e: unknown) => e);

    expect(err).toMatchObject({ code: JsonRpcErrorCode.NotFound });
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('secret');
    expect(JSON.stringify(data)).not.toContain('www.loc.gov');
    expect((err as Error).message).not.toContain('www.loc.gov');
  });

  it('ServiceUnavailable from an HTML body carries no internal request URL', async () => {
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Rate limited</body></html>'));
    const ctx = createMockContext();
    const svc = getLocApiService();
    const err = await svc.search({ query: 'secret terms', page: 1 }, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('secret');
    expect((err as Error).message).not.toContain('www.loc.gov');
  });
});

describe('LocApiService.getItem', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws NotFound when item property is missing from response envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(JSON.stringify({ resources: [], related_items: [] })));
    const ctx = createMockContext();
    const svc = getLocApiService();
    await expect(svc.getItem('missing-id', ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('extracts rights from rights_information array', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Rights Array Item',
            url: 'https://www.loc.gov/item/rights-arr/',
            rights_information: ['No known restrictions.', 'Public domain.'],
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('rights-arr', ctx);
    expect(result.rights_information).toContain('No known restrictions.');
  });

  it('falls back to rights field when rights_information is absent', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Rights Fallback',
            url: 'https://www.loc.gov/item/rights-fallback/',
            rights: 'CC0 Public Domain',
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('rights-fallback', ctx);
    expect(result.rights_information).toBe('CC0 Public Domain');
  });

  it('extracts physical_description from medium when physical_description absent', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Medium Item',
            url: 'https://www.loc.gov/item/medium/',
            medium: '1 photograph',
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('medium', ctx);
    expect(result.physical_description).toBe('1 photograph');
  });

  it('collects resource_links from nested files array', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Files Item',
            url: 'https://www.loc.gov/item/files/',
          },
          resources: [
            {
              files: [
                [
                  { url: 'https://tile.loc.gov/file1.tif' },
                  { url: 'https://tile.loc.gov/file2.jpg' },
                ],
              ],
            },
          ],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('files', ctx);
    expect(result.resource_links).toContain('https://tile.loc.gov/file1.tif');
    expect(result.resource_links).toContain('https://tile.loc.gov/file2.jpg');
  });

  it('collects related_items from top-level related_items array and item.related_items', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Related Item',
            url: 'https://www.loc.gov/item/related/',
            related_items: ['related-item-a'],
          },
          resources: [],
          related_items: [
            { id: 'related-item-b' },
            { url: 'https://www.loc.gov/item/related-item-c/' },
          ],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('related', ctx);
    expect(result.related_items).toContain('related-item-a');
    expect(result.related_items).toContain('related-item-b');
    // URL from top-level related_items when id absent
    expect(result.related_items.some((r) => r.includes('related-item-c'))).toBe(true);
  });

  it('deduplicates resource_links when url and image point to the same resource', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: { title: 'Dup', url: 'https://www.loc.gov/item/dup/' },
          resources: [
            {
              url: 'https://tile.loc.gov/same-resource.jpg',
              image: 'https://tile.loc.gov/same-resource.jpg',
            },
          ],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('dup', ctx);
    const count = result.resource_links.filter(
      (l) => l === 'https://tile.loc.gov/same-resource.jpg',
    ).length;
    expect(count).toBe(1);
  });

  it('userAgent env var value is never surfaced in item result data', async () => {
    const secretAgent = 'my-secret-item-agent';
    process.env.LOC_USER_AGENT = secretAgent;
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: { title: 'Item', url: 'https://www.loc.gov/item/secret-test/' },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('secret-test', ctx);

    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain(secretAgent);
    delete process.env.LOC_USER_AGENT;
  });

  it('normalizes a protocol-relative item.url to https:', async () => {
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
    const svc = getLocApiService();
    const result = await svc.getItem('2009632251', ctx);
    expect(result.url).toBe('https://lccn.loc.gov/2009632251');
  });

  it('encodes multi-segment item IDs per segment, preserving internal slashes', async () => {
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
    const svc = getLocApiService();
    const result = await svc.getItem('sn95047246/1935-09-05/ed-1', ctx);
    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    // Slashes stay literal (not %2F), so LOC can route the deep item path
    expect(calledUrl).toContain('/item/sn95047246/1935-09-05/ed-1/');
    expect(calledUrl).not.toContain('%2F');
    expect(result.item_id).toBe('sn95047246/1935-09-05/ed-1');
  });

  it('builds a single-segment item URL unchanged (no regression)', async () => {
    const fetchSpy = mockFetch(
      JSON.stringify({
        item: { title: 'Photo', url: 'https://www.loc.gov/item/2009632251/' },
        resources: [],
        related_items: [],
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();
    await svc.getItem('2009632251', ctx);
    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/item/2009632251/');
    expect(calledUrl).not.toContain('%2F');
  });

  it('normalizes the curated metadata fields from a dense upstream record', async () => {
    // Field shapes mirror live item 2005680380: summary and call_number arrive as plain
    // strings, the rest as arrays, and the former-id key is singular (number_former_id).
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Political cartoon',
            url: 'https://www.loc.gov/item/2005680380/',
            summary: 'A political cartoon commenting on the 1884 election.',
            language: ['english'],
            location: ['united states'],
            call_number: 'Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]',
            number_former_id: ['http://www.loc.gov/item/13903333'],
            original_format: ['photo, print, drawing'],
            online_format: ['image'],
            access_restricted: true,
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('2005680380', ctx);

    expect(result.summary).toBe('A political cartoon commenting on the 1884 election.');
    expect(result.languages).toEqual(['english']);
    expect(result.locations).toEqual(['united states']);
    expect(result.call_number).toBe('Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]');
    expect(result.former_ids).toEqual(['http://www.loc.gov/item/13903333']);
    expect(result.original_formats).toEqual(['photo, print, drawing']);
    expect(result.online_formats).toEqual(['image']);
    expect(result.access_restricted).toBe(true);
  });

  it('omits the curated fields entirely on a sparse upstream record', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: { title: 'Sparse', url: 'https://www.loc.gov/item/sparse/' },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('sparse', ctx);

    expect(result.languages).toEqual([]);
    expect(result.locations).toEqual([]);
    expect(result.former_ids).toEqual([]);
    expect(result.original_formats).toEqual([]);
    expect(result.online_formats).toEqual([]);
    expect(result.summary).toBeUndefined();
    expect(result.call_number).toBeUndefined();
    expect(result.access_restricted).toBeUndefined();
    expect(result).not.toHaveProperty('access_restricted');
  });

  it('extracts call_number when upstream sends it as an array', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Array call number',
            url: 'https://www.loc.gov/item/arr-call/',
            call_number: ['LOT 1234', 'Alternate shelf mark'],
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('arr-call', ctx);
    expect(result.call_number).toBe('LOT 1234');
  });

  it('keeps access_restricted when upstream reports false', async () => {
    // A truthiness guard would drop this; an unrestricted item is a fact, not a gap.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Open item',
            url: 'https://www.loc.gov/item/open/',
            access_restricted: false,
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('open', ctx);
    expect(result.access_restricted).toBe(false);
  });

  it('joins a multi-entry summary array instead of dropping the tail', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Two-part summary',
            url: 'https://www.loc.gov/item/summary-arr/',
            summary: ['First paragraph.', 'Second paragraph.'],
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getItem('summary-arr', ctx);
    expect(result.summary).toContain('First paragraph.');
    expect(result.summary).toContain('Second paragraph.');
  });

  it('NotFound from an upstream 404 carries no internal request URL', async () => {
    // fetchJson's 404 throw fires before getItem's own item-missing check, and the resource
    // has no rewrite layer — whatever data is attached here reaches the client verbatim.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const ctx = createMockContext();
    const svc = getLocApiService();
    const err = await svc.getItem('TOTALLY_FAKE_ID', ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: JsonRpcErrorCode.NotFound });
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect(JSON.stringify(data)).not.toContain('www.loc.gov');
    expect((err as Error).message).not.toContain('www.loc.gov');
  });

  it('ServiceUnavailable from an HTML body carries no internal request URL', async () => {
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Rate limited</body></html>'));
    const ctx = createMockContext();
    const svc = getLocApiService();
    const err = await svc.getItem('2009632251', ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect((err as Error).message).not.toContain('www.loc.gov');
  });
});

describe('LocApiService.searchNewspapers', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses location_state for state, not location[0]', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/resource/sn000/1910/ed-1/?sp=1',
              title: 'Test Page',
              location: ['new york', 'united states'],
              location_state: ['new york (state)'],
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.searchNewspapers({ query: 'test', page: 1 }, ctx);
    // location_state takes precedence over location[0]
    expect(result.items[0].state).toContain('new york');
    expect(result.items[0].state).not.toBe('united states');
  });

  it('uses partof_title for newspaper_title, not subject', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/resource/sn000/1910/ed-1/?sp=1',
              title: 'Test Page',
              subject: ['united states', 'newspapers'],
              partof_title: ['the evening world (new york, n.y.) 1887-1931'],
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.searchNewspapers({ query: 'test', page: 1 }, ctx);
    expect(result.items[0].newspaper_title).toContain('evening world');
    expect(result.items[0].newspaper_title).not.toBe('united states');
  });

  it('falls back to last partof entry when partof_title is absent', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/resource/sn000/1910/ed-1/?sp=1',
              title: 'Test Page',
              partof: ['chronicling america', 'the daily herald 1880-1920'],
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.searchNewspapers({ query: 'test', page: 1 }, ctx);
    // Should use last partof entry
    expect(result.items[0].newspaper_title).toContain('daily herald');
  });

  it('truncates description to 500 chars from 3 description array entries', async () => {
    const longDesc = 'A'.repeat(300);
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/resource/sn000/1910/ed-1/?sp=1',
              title: 'Long Desc',
              description: [longDesc, longDesc, longDesc],
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.searchNewspapers({ query: 'test', page: 1 }, ctx);
    // Truncated at 500 chars
    expect(result.items[0].description).toBeDefined();
    expect(result.items[0].description!.length).toBeLessThanOrEqual(500);
  });
});

describe('LocApiService.browseCollections', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts the route slug from a URL carrying a trailing collection subpath', async () => {
    // Live shape: LOC points every browse result at /about-this-collection/, and pagination
    // sends `results` as a display range with no `pages` key. The title deliberately does not
    // match the route — a title-derived slug would read "aaron-copland-collection".
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/collections/aaron-copland/about-this-collection/',
              title: 'Aaron Copland Collection',
            },
          ],
          pagination: { total: 1, perpage: 25, results: '1 - 1' },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.browseCollections({ page: 1 }, ctx);
    expect(result.items[0].slug).toBe('aaron-copland');
  });

  it('extracts slug from a bare collection URL with no subpath', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/collections/civil-war-glass-negatives/',
              title: 'Civil War Glass Negatives',
            },
          ],
          pagination: { total: 1, perpage: 25, results: '1 - 1' },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.browseCollections({ page: 1 }, ctx);
    expect(result.items[0].slug).toBe('civil-war-glass-negatives');
  });

  it('maps the upstream collection count to item_count', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/collections/tenth-to-sixteenth-century-liturgical-chants/about-this-collection/',
              title: '10th-16th Century Liturgical Chants',
              count: 57,
            },
          ],
          pagination: { total: 1, perpage: 25, results: '1 - 1' },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.browseCollections({ page: 1 }, ctx);
    expect(result.items[0].item_count).toBe(57);
  });

  it('reads item_count from the top-level count, not the nested item.total', async () => {
    // Live, these disagree: the same result reports count: 57 and item.total: 5000. The
    // collection-level count is the one that answers "how big is this collection".
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/collections/tenth-to-sixteenth-century-liturgical-chants/about-this-collection/',
              title: '10th-16th Century Liturgical Chants',
              count: 57,
              item: { total: 5000, digitized: 5000 },
            },
          ],
          pagination: { total: 1, perpage: 25, results: '1 - 1' },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.browseCollections({ page: 1 }, ctx);
    expect(result.items[0].item_count).toBe(57);
  });

  it('keeps item_count when the upstream count is 0', async () => {
    // A truthiness guard would drop this; an empty collection is a fact, not a missing value.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/collections/empty-collection/about-this-collection/',
              title: 'Empty Collection',
              count: 0,
            },
          ],
          pagination: { total: 1, perpage: 25, results: '1 - 1' },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.browseCollections({ page: 1 }, ctx);
    expect(result.items[0].item_count).toBe(0);
  });

  it('omits item_count when the upstream count is absent (sparse payload)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/collections/sparse-collection/about-this-collection/',
              title: 'Sparse Collection',
            },
          ],
          pagination: { total: 1, perpage: 25, results: '1 - 1' },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.browseCollections({ page: 1 }, ctx);
    expect(result.items[0].item_count).toBeUndefined();
  });

  it('ignores the results display range when pagination omits total', async () => {
    // `results` is a range string ("1 - 3"), not a count. Treating it as a total fallback
    // yields a string total and NaN pages, so it only applies when LOC sends a number.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/collections/aaron-copland/about-this-collection/',
              title: 'Aaron Copland Collection',
            },
          ],
          pagination: { perpage: 25, results: '1 - 3' },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.browseCollections({ page: 1 }, ctx);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.pages).toBe(1);
    expect(Number.isNaN(result.pagination.pages)).toBe(false);
  });

  it('generates slug from title when URL does not match collections pattern', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/other/strange-path/',
              title: 'My Collection',
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.browseCollections({ page: 1 }, ctx);
    expect(result.items[0].slug).toBe('my-collection');
  });
});

describe('LocApiService.getNewspaperPage', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives date and sequence from the page URL when the resource endpoint omits them', async () => {
    // The ?fo=json&at=resource endpoint structurally omits date_issued/sequence — both live only
    // in the page URL (date = path segment after the LCCN, sequence = sp param).
    const resourceBody = JSON.stringify({
      resource: {
        url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/',
        fulltext_file: 'https://tile.loc.gov/text-services/full_text.json',
      },
    });
    const ocrBody = JSON.stringify({ 'batch/0001.xml': { full_text: 'Hair Falling?' } });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(resourceBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(ocrBody, { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getNewspaperPage(
      'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=12&q=titanic',
      ctx,
    );

    expect(result.date).toBe('1912-04-18');
    expect(result.sequence).toBe(12);
    expect(result.ocr_available).toBe(true);
    expect(result.ocr_text).toContain('Hair Falling');
  });

  it('prefers upstream date_issued/sequence over URL-derived values when present', async () => {
    const resourceBody = JSON.stringify({
      resource: {
        url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/',
        date_issued: '1899-12-31',
        sequence: 5,
      },
    });
    vi.stubGlobal('fetch', mockFetch(resourceBody));
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.getNewspaperPage(
      'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=12',
      ctx,
    );

    // Upstream values win over the URL's 1912-04-18 / sp=12.
    expect(result.date).toBe('1899-12-31');
    expect(result.sequence).toBe(5);
  });

  it('omits date and sequence when neither the resource nor the URL provides them', async () => {
    const resourceBody = JSON.stringify({
      resource: { url: 'https://www.loc.gov/resource/gdc.00519798608/' },
    });
    vi.stubGlobal('fetch', mockFetch(resourceBody));
    const ctx = createMockContext();
    const svc = getLocApiService();
    // No date-shaped path segment; sp=0 is not a positive integer.
    const result = await svc.getNewspaperPage(
      'https://www.loc.gov/resource/gdc.00519798608/?sp=0',
      ctx,
    );

    expect(result.date).toBeUndefined();
    expect(result.sequence).toBeUndefined();
  });

  it('retries a transient OCR fetch failure and still returns the text', async () => {
    // The OCR fetch (tile.loc.gov) is a bare fetch the issue flagged as easy to miss — it now
    // carries the same retry + timeout as the primary path. Real timers (one ~1.1s backoff).
    const resourceBody = JSON.stringify({
      resource: {
        url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/',
        fulltext_file: 'https://tile.loc.gov/text-services/full_text.json',
      },
    });
    const ocrBody = JSON.stringify({ 'batch/0001.xml': { full_text: 'Recovered OCR text' } });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(resourceBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockRejectedValueOnce(new TypeError('The socket connection was closed unexpectedly'))
      .mockResolvedValueOnce(
        new Response(ocrBody, { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();

    const result = await svc.getNewspaperPage(
      'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=12',
      ctx,
    );

    // 3 fetches: resource (1) + OCR transient failure (2) + OCR retry success (3).
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.ocr_available).toBe(true);
    expect(result.ocr_text).toContain('Recovered OCR text');
  });
});

// Retry uses real timers with a single ~1.1s backoff — cheap, and it avoids fake-timer state
// bleeding into the module-level rate-limit test below. Timeout firing is covered in isolation
// by tests/services/http.test.ts (its own file, so fake timers can't leak here).
describe('LocApiService retry', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries a transient network fault, then succeeds', async () => {
    const good = new Response(makeSearchResponse(), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('The socket connection was closed unexpectedly'))
      .mockResolvedValueOnce(good);
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();

    const result = await svc.search({ query: 'test', page: 1 }, ctx);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(1);
  });

  it('does not retry a non-transient upstream error (500)', async () => {
    const fetchSpy = mockFetch('Internal Server Error', 500);
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();

    await expect(svc.search({ query: 'test', page: 1 }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
    // A 5xx is status-derived, not a transient network fault — fail fast, no retry.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// Rate-limit test last — sets module-level rateLimitBlockedUntil which bleeds across
// describe blocks in the same worker. Keep this as the final test in the file.
describe('LocApiService rate-limit state', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws RateLimited on HTTP 429, sets the block, and does not retry the 429', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 }));
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();
    await expect(svc.search({ query: 'test', page: 1 }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
    });
    // Retrying a 429 would deepen LOC's ~1-hour IP block — the predicate must never retry it.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
