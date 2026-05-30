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
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
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
});

describe('LocApiService.getItem', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
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
});

describe('LocApiService.searchNewspapers', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
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
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
  });

  it('extracts slug from collection URL path', async () => {
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
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.browseCollections({ page: 1 }, ctx);
    expect(result.items[0].slug).toBe('civil-war-glass-negatives');
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

// Rate-limit test last — sets module-level rateLimitBlockedUntil which bleeds across
// describe blocks in the same worker. Keep this as the final test in the file.
describe('LocApiService rate-limit state', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
  });

  it('throws RateLimited on HTTP 429 and sets module-level block', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })),
    );
    const ctx = createMockContext();
    const svc = getLocApiService();
    await expect(svc.search({ query: 'test', page: 1 }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
    });
  });
});
