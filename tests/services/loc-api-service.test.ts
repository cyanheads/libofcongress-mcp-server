/**
 * @fileoverview Tests for the LocApiService — init/accessor guard, pure helpers,
 * HTTP error classification, rate-limit state, and security invariants.
 * @module tests/services/loc-api-service.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import {
  getLocApiService,
  initLocApiService,
  LocApiService,
} from '@/services/loc-api/loc-api-service.js';
import type { LocPagination } from '@/services/loc-api/types.js';
import {
  AUDIO_ITEM_JUKEBOX_68453,
  BASEBALL_CARD_ITEM_2008676581,
  BOOK_ITEM_02007458,
  MANUSCRIPT_ITEM_MM77093930,
  NEWSPAPER_ISSUE_SN83030214_1912_04_16,
} from '../fixtures/loc-items.js';
import {
  MAP_ITEM_77694805,
  POSTERS_PHOTOS_SEARCH,
  VHP_ITEM_AFC2001001_119910,
} from '../fixtures/loc-subjects.js';
import {
  COLLECTION_ENTITY_ROWS,
  JAZZ_ENTITY_ROWS,
  MANUSCRIPT_RIGHTS_MM77093930,
  MAP_RIGHTS_98688514,
  NEWSPAPER_NOTES_SN83030214,
  TITANIC_OCR_EXCERPT,
} from '../fixtures/loc-text.js';
import { serveByHost } from '../helpers/loc-fetch.js';

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
    expect(result.items[0]!.url).toMatch(/^https:/);
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
    expect(result.items[0]!.id).toBe('2009632251');
    expect(result.items[0]!.id).not.toContain('https://');
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
    expect(result.items[0]!.id).toBe('fallback-id');
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
    expect(result.items[0]!.title).toBe('First Title');
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
    expect(result.items[0]!.title).toBe('Untitled');
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

  it.each([500, 502, 503, 403])(
    'throws ServiceUnavailable carrying upstream_unavailable and the bare status on HTTP %i',
    async (status) => {
      vi.stubGlobal('fetch', mockFetch('Internal Server Error', status));
      const ctx = createMockContext();
      const svc = getLocApiService();
      const err = await svc.search({ query: 'test', page: 1 }, ctx).catch((e: unknown) => e);
      expect(err).toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        message: `LOC API returned HTTP ${status}`,
      });
      expect((err as { data?: unknown }).data).toEqual({ status, reason: 'upstream_unavailable' });
    },
  );

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

  it('throws ServiceUnavailable carrying upstream_unavailable and a 60 s retryAfter when HTML is returned', async () => {
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Rate limited</body></html>'));
    const ctx = createMockContext();
    const svc = getLocApiService();
    await expect(svc.search({ query: 'test', page: 1 }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: { reason: 'upstream_unavailable', retryAfter: 60 },
    });
  });

  it('throws ServiceUnavailable carrying upstream_unavailable on an empty 200 body, sent once', async () => {
    const fetchSpy = mockFetch('');
    vi.stubGlobal('fetch', fetchSpy);
    const err = await getLocApiService()
      .search({ query: 'test', page: 1 }, createMockContext())
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'The Library of Congress returned an incomplete or malformed response.',
      data: { reason: 'upstream_unavailable' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
    expect(result.items[0]!.description).toContain('Part one.');
    expect(result.items[0]!.description).toContain('Part two.');
  });

  it('injection string in query is percent-encoded in the request URL', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();
    const injection = "'; DROP TABLE items; --";
    await svc.search({ query: injection, page: 1 }, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
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
    const collection = result.items[0]!;
    const exhibit = result.items[1]!;
    const newspaperPage = result.items[2]!;
    const item = result.items[3]!;
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
    expect(result.items[0]!.id).toBe('sn95047246/1935-09-05/ed-1');
    expect(result.items[0]!.is_item).toBe(true);
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

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('/collections/aaron-copland/');
    expect(calledUrl).not.toContain('/search/');
    expect(calledUrl).toContain('q=correspondence');
    // Normalizes through the existing path — no parallel parser for the collection envelope
    expect(result.items[0]!.id).toBe('2023781133');
    expect(result.items[0]!.is_item).toBe(true);
    expect(result.pagination.total).toBe(232);
  });

  it('percent-encodes a collection slug so it cannot escape the collections path', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLocApiService();
    await svc.search({ query: 'test', collectionSlug: '../../item/2009632251', page: 1 }, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
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

describe('LocApiService subjects and facets (#57)', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    initLocApiService(config, await createInMemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('with includeFacets, requests the facet block and returns the subject and location facets as { value, count }', async () => {
    fetchSpy.mockImplementation(async () => json(POSTERS_PHOTOS_SEARCH));

    const result = await getLocApiService().search(
      { query: 'posters', format: 'photo', includeFacets: true },
      createMockContext(),
    );

    const sent = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(sent.searchParams.get('at')).toBe('results,pagination,facets');
    const subject = POSTERS_PHOTOS_SEARCH.facets.find((f) => f.type === 'subject')!;
    expect(result.facets?.subject).toEqual(
      subject.filters.map((f) => ({ value: f.value, count: f.count })),
    );
    expect(result.facets?.location[0]).toEqual({ value: 'united states', count: 3245 });
    expect(result.facets?.location).toHaveLength(10);
  });

  it('without includeFacets, sends the results and pagination projection only and returns no facets', async () => {
    // A facet block in the response (the fixture carries one) is not read either.
    fetchSpy.mockImplementation(async () => json(POSTERS_PHOTOS_SEARCH));

    const result = await getLocApiService().search(
      { query: 'posters', format: 'photo' },
      createMockContext(),
    );

    const sent = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(sent.searchParams.get('at')).toBe('results,pagination');
    expect(result).not.toHaveProperty('facets');
    expect(result.items).toHaveLength(POSTERS_PHOTOS_SEARCH.results.length);
  });

  it('skips facet entries missing a value or count', async () => {
    fetchSpy.mockImplementation(async () =>
      json({
        results: [],
        pagination: { of: 0 },
        facets: [
          {
            type: 'subject',
            filters: [{ value: 'jazz', count: 4 }, { value: 'blues' }, { count: 2 }],
          },
        ],
      }),
    );

    const { facets } = await getLocApiService().search(
      { query: 'music', includeFacets: true },
      createMockContext(),
    );

    expect(facets).toEqual({ subject: [{ value: 'jazz', count: 4 }], location: [] });
  });

  it('returns empty facets for a page LOC will not serve', async () => {
    fetchSpy.mockImplementation(async () => new Response('', { status: 400 }));

    const { facets } = await getLocApiService().search(
      { query: 'posters', page: 3, includeFacets: true },
      createMockContext(),
    );

    expect(facets).toEqual({ subject: [], location: [] });
  });

  it('ANDs subject terms and the location into one fa value', async () => {
    fetchSpy.mockImplementation(async () => json(POSTERS_PHOTOS_SEARCH));

    await getLocApiService().search(
      { query: 'posters', subjectTerms: ['united states', 'history'], location: 'oklahoma' },
      createMockContext(),
    );

    expect(new URL(String(fetchSpy.mock.calls[0]![0])).searchParams.get('fa')).toBe(
      'subject:united states|subject:history|location:oklahoma',
    );
  });

  it('reads subject_headings from item.subject_headings and subject_terms from item.subject', async () => {
    fetchSpy.mockImplementation(async () => json(MAP_ITEM_77694805));

    const result = await getLocApiService().getItem('77694805', createMockContext());

    expect(result.subject_headings).toEqual([
      'Transportation--Oklahoma--Maps',
      'Railroads--Oklahoma--Maps',
      'United States--Oklahoma',
    ]);
    expect(result.subject_terms).toEqual([
      'maps',
      'transportation',
      'united states',
      'railroads',
      'oklahoma',
    ]);
  });

  it('keeps headings verbatim, spaced separators included', async () => {
    fetchSpy.mockImplementation(async () => json(VHP_ITEM_AFC2001001_119910));

    const result = await getLocApiService().getItem('afc2001001.119910', createMockContext());

    expect(result.subject_headings).toEqual(VHP_ITEM_AFC2001001_119910.item.subject_headings);
    expect(result.subject_headings).toContain('World War, 1939-1945 -- Personal Narratives');
  });

  it('returns empty subject_headings when the record carries none, whatever item.subject holds', async () => {
    fetchSpy.mockImplementation(async () =>
      json({ item: { title: 'No headings', subject: ['maps'] }, resources: [] }),
    );

    const result = await getLocApiService().getItem('no-headings', createMockContext());

    expect(result.subject_headings).toEqual([]);
    expect(result.subject_terms).toEqual(['maps']);
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

  it('lists a file group as a page, its files only when requested (#63)', async () => {
    const body = JSON.stringify({
      item: { title: 'Files Item', url: 'https://www.loc.gov/item/files/' },
      resources: [
        {
          url: 'https://www.loc.gov/resource/files.0001/',
          files: [
            [
              { url: 'https://tile.loc.gov/file1.tif', mimetype: 'image/tiff' },
              { url: 'https://tile.loc.gov/file2.jpg' },
              { mimetype: 'application/json' },
            ],
          ],
        },
      ],
      related_items: [],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body)),
    );
    const svc = getLocApiService();

    const bare = await svc.getItem('files', createMockContext());
    expect(bare.pages).toEqual([
      { page_url: 'https://www.loc.gov/resource/files.0001/', has_text: false },
    ]);
    expect(bare).not.toHaveProperty('resource_links');

    const withFiles = await svc.getItem('files', createMockContext(), {
      pageOffset: 0,
      pageLimit: 50,
      includeFiles: true,
    });
    expect(withFiles.pages[0]!.files).toEqual([
      'https://tile.loc.gov/file1.tif',
      'https://tile.loc.gov/file2.jpg',
    ]);
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

  it('normalizes object-form item.related_items entries with the id ?? url ?? title preference (#39)', async () => {
    // item.related_items mixes plain strings with LOC's { title, url } objects — the object
    // entry below is afc9999005.10348's live value. Every entry must reach the output as a string.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Dust bowl recording',
            url: 'https://www.loc.gov/item/afc9999005.10348/',
            related_items: [
              'legacy-string-id',
              {
                title: 'Alan Lomax Collection of Woody Guthrie Recordings (AFC 1940/007)',
                url: 'https://lccn.loc.gov/2009655315',
              },
              {
                id: 'http://www.loc.gov/item/afcwwgbib000002/',
                url: 'https://www.loc.gov/item/afcwwgbib000002/',
                title: 'Letter from Woody Guthrie to Alan Lomax',
              },
              { title: 'A related record known only by title' },
              {},
            ],
          },
          resources: [],
          related_items: [
            { id: 'http://lccn.loc.gov/2002522665', url: '//lccn.loc.gov/2002522665' },
            { title: 'Top-level title-only entry' },
          ],
        }),
      ),
    );
    const ctx = createMockContext();
    const result = await getLocApiService().getItem('afc9999005.10348', ctx);

    expect(result.related_items).toEqual([
      'http://lccn.loc.gov/2002522665',
      'Top-level title-only entry',
      'legacy-string-id',
      'https://lccn.loc.gov/2009655315',
      'http://www.loc.gov/item/afcwwgbib000002/',
      'A related record known only by title',
    ]);
  });

  it('reads contributors from item.contributor_names, the key LOC actually sends (#47)', async () => {
    // Live mgw1b.721 shape: contributor_names carries the names with roles; contributors holds
    // the same people as { name: facet-url } objects without roles; there is no `contributor`.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'George Washington Papers, Series 1',
            url: 'https://www.loc.gov/item/mgw1b.721/',
            contributor_names: ['Washington, George, 1732-1799 (Author)'],
            contributors: [
              {
                'washington, george':
                  'https://www.loc.gov/search/?fa=contributor:washington,+george&fo=json',
              },
            ],
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext();
    const result = await getLocApiService().getItem('mgw1b.721', ctx);

    expect(result.contributors).toEqual(['Washington, George, 1732-1799 (Author)']);
  });

  it('keeps every contributor_names entry in LOC order', async () => {
    // Live afc9999005.10348 shape: one person can appear twice under different roles.
    const names = [
      'Lomax, Alan (1915-2002) (Recordist)',
      'Lomax, Alan (1915-2002) (Speaker)',
      'Guthrie, Woody (1912-1967) (Performer)',
      'Lyttleton, Elizabeth (Recordist)',
    ];
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Recording',
            url: 'https://www.loc.gov/item/x/',
            contributor_names: names,
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const result = await getLocApiService().getItem('x', createMockContext());

    expect(result.contributors).toEqual(names);
  });

  it('returns no contributors when contributor_names is absent, even if contributors objects are present', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Objects only',
            url: 'https://www.loc.gov/item/y/',
            contributors: [{ 'doe, jane': 'https://www.loc.gov/search/?fa=contributor:doe' }],
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const result = await getLocApiService().getItem('y', createMockContext());

    expect(result.contributors).toEqual([]);
  });

  it('lists no pages for a resource without files or without a url (#63)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: { title: 'Sparse', url: 'https://www.loc.gov/item/sparse/' },
          resources: [
            {
              url: 'https://www.loc.gov/resource/sparse.0001/',
              image: 'https://tile.loc.gov/a.jpg',
            },
            { files: [[{ url: 'https://tile.loc.gov/orphan.jpg' }]] },
          ],
          related_items: [],
        }),
      ),
    );
    const result = await getLocApiService().getItem('sparse', createMockContext());

    expect(result.resources).toEqual([
      {
        url: 'https://www.loc.gov/resource/sparse.0001/',
        page_count: 0,
        image: 'https://tile.loc.gov/a.jpg',
      },
    ]);
    expect(result.pages).toEqual([]);
    expect(result.page_total).toBe(0);
    expect(result).not.toHaveProperty('next_page_offset');
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
    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
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
    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
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

    expect(err).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: { reason: 'upstream_unavailable' },
    });
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect((err as Error).message).not.toContain('www.loc.gov');
  });

  it('throws ServiceUnavailable carrying upstream_unavailable on a 5xx, sent once', async () => {
    const fetchSpy = mockFetch('Service Unavailable', 503);
    vi.stubGlobal('fetch', fetchSpy);
    const err = await getLocApiService()
      .getItem('2009632251', createMockContext())
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'LOC API returned HTTP 503',
      data: { status: 503, reason: 'upstream_unavailable' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('LocApiService.getItem page window (#63)', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    initLocApiService(config, await createInMemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Answers www.loc.gov item requests with `body`. */
  const serve = (body: unknown) =>
    fetchSpy.mockImplementation(async (url) => {
      if (new URL(String(url)).hostname !== 'www.loc.gov') throw new Error('unmocked fetch');
      return new Response(JSON.stringify(body), { status: 200 });
    });

  const window = (pageOffset: number, pageLimit: number, includeFiles = false) => ({
    pageOffset,
    pageLimit,
    includeFiles,
  });

  it('lists the first 50 of 582 book pages by default, each addressed by ?sp=N', async () => {
    serve(BOOK_ITEM_02007458);

    const result = await getLocApiService().getItem('02007458', createMockContext());

    expect(result.page_total).toBe(582);
    expect(result.pages).toHaveLength(50);
    expect(result.next_page_offset).toBe(50);
    expect(result.pages[0]).toEqual({
      page_url: 'https://www.loc.gov/resource/gdcmassbookdig.popularhistoryof00chen/?sp=1',
      has_text: true,
    });
    expect(result.pages[49]!.page_url).toMatch(/\?sp=50$/);
    expect(result.resources).toEqual([
      {
        url: 'https://www.loc.gov/resource/gdcmassbookdig.popularhistoryof00chen/',
        page_count: 582,
        image: BOOK_ITEM_02007458.resources[0]!.image,
        pdf: BOOK_ITEM_02007458.resources[0]!.pdf,
      },
    ]);
  });

  it('pages through to the last page and stops advertising a next offset there', async () => {
    serve(BOOK_ITEM_02007458);
    const svc = getLocApiService();

    const middle = await svc.getItem('02007458', createMockContext(), window(299, 100));
    expect(middle.pages[0]!.page_url).toMatch(/\?sp=300$/);
    expect(middle.next_page_offset).toBe(399);

    const tail = await svc.getItem('02007458', createMockContext(), window(550, 100));
    expect(tail.pages).toHaveLength(32);
    expect(tail.pages.at(-1)!.page_url).toMatch(/\?sp=582$/);
    expect(tail).not.toHaveProperty('next_page_offset');
  });

  it('returns an empty window past the last page, with the total', async () => {
    serve(BOOK_ITEM_02007458);

    const result = await getLocApiService().getItem(
      '02007458',
      createMockContext(),
      window(582, 50),
    );

    expect(result.pages).toEqual([]);
    expect(result.page_total).toBe(582);
    expect(result).not.toHaveProperty('next_page_offset');
  });

  it('marks has_text from a text/plain entry and lists the url of every file on request', async () => {
    // Diary pages 5 and 72 carry no transcription.
    serve(MANUSCRIPT_ITEM_MM77093930);

    const result = await getLocApiService().getItem(
      'mm77093930',
      createMockContext(),
      window(0, 100, true),
    );

    expect(result.page_total).toBe(122);
    expect(result.pages[2]!.page_url).toBe(
      'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
    );
    expect(result.pages.filter((p) => !p.has_text).map((p) => p.page_url)).toEqual([
      'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=5',
      'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=72',
    ]);
    expect(result.pages[2]!.files).toEqual([
      'https://tile.loc.gov/image-services/iiif/service:mss:mss93930:mss93930-001:0000:0003/full/pct:100/0/default.jpg',
      'https://tile.loc.gov/storage-services/service/mss/mss93930/mss93930-001/0000/0003.jp2',
      'https://tile.loc.gov/storage-services/master/mss/mss93930/mss93930-001/0000/0003.tif',
      'https://tile.loc.gov/storage-services/service/gdc/gdccrowd/mss/mss93930/mss93930-001/0000/0003.txt',
    ]);
    // An untranscribed page lists its images only.
    expect(result.pages[4]!.files).toHaveLength(3);
  });

  it('runs the window across resources, addressing one-page resources by their bare url', async () => {
    // The card has a front and a back resource, one page each.
    serve(BASEBALL_CARD_ITEM_2008676581);
    const svc = getLocApiService();

    const both = await svc.getItem('2008676581', createMockContext());
    expect(both.pages.map((p) => p.page_url)).toEqual([
      'https://www.loc.gov/resource/bbc.0941f/',
      'https://www.loc.gov/resource/bbc.0941b/',
    ]);
    expect(both.resources.map((r) => r.page_count)).toEqual([1, 1]);

    const back = await svc.getItem('2008676581', createMockContext(), window(1, 1, true));
    expect(back.pages).toEqual([
      {
        page_url: 'https://www.loc.gov/resource/bbc.0941b/',
        has_text: false,
        files: [
          'https://tile.loc.gov/storage-services/master/pnp/bbc/0900/0940/0941bu.tif',
          'https://tile.loc.gov/storage-services/service/pnp/bbc/0900/0940/0941bv.jpg',
        ],
      },
    ]);
    expect(back).not.toHaveProperty('next_page_offset');
  });

  it("lists a recording's MP3 under its resource's audio", async () => {
    serve(AUDIO_ITEM_JUKEBOX_68453);

    const result = await getLocApiService().getItem('jukebox-68453', createMockContext());

    expect(result.resources[0]).toEqual({
      url: 'https://www.loc.gov/resource/jukebox-68453.0',
      page_count: 1,
      audio: AUDIO_ITEM_JUKEBOX_68453.resources[0]!.audio,
    });
    expect(result.resources[1]).toMatchObject({ page_count: 1, image: expect.any(String) });
  });

  it('addresses newspaper pages by the issue resource plus ?sp=N, every page with text', async () => {
    serve(NEWSPAPER_ISSUE_SN83030214_1912_04_16);

    const result = await getLocApiService().getItem(
      'sn83030214/1912-04-16/ed-1',
      createMockContext(),
    );

    expect(result.page_total).toBe(14);
    expect(result.pages.every((p) => p.has_text)).toBe(true);
    expect(result.pages[13]!.page_url).toBe(
      'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=14',
    );
  });
});

describe('LocApiService.searchNewspapers', () => {
  beforeEach(async () => {
    // A test that forgets its stub fails here instead of reaching LOC, which blocks for an hour.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unmocked fetch')));
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('maps the whole location_state facet to states, in LOC order (#43)', async () => {
    // Live shapes from a `lindbergh flight` 1927 search: a multi-state title, a single-state
    // title, a record with no location_state (location alone must not stand in), and an empty facet.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/resource/sn87065702/1927-06-16/ed-1/?sp=10',
              title: 'Image 10 of Southern Christian advocate (Charleston, S.C.), June 16, 1927',
              location: ['georgia', 'charleston', 'united states', 'south carolina'],
              location_state: ['georgia', 'south carolina'],
            },
            {
              url: 'https://www.loc.gov/resource/sn86063730/1927-07-18/ed-1/?sp=4',
              title: 'Image 4 of Brownsville herald (Brownsville, Tex.), July 18, 1927',
              location: ['harlingen', 'united states', 'brownsville', 'texas'],
              location_state: ['texas'],
            },
            {
              url: 'https://www.loc.gov/resource/sn000/1910-01-01/ed-1/?sp=1',
              title: 'No state facet',
              location: ['united states'],
            },
            {
              url: 'https://www.loc.gov/resource/sn001/1910-01-01/ed-1/?sp=1',
              title: 'Empty state facet',
              location_state: [],
            },
          ],
          pagination: { total: 4, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const result = await getLocApiService().searchNewspapers({ query: 'test', page: 1 }, ctx);

    expect(result.items[0]!.states).toEqual(['georgia', 'south carolina']);
    expect(result.items[1]!.states).toEqual(['texas']);
    expect(result.items[2]).not.toHaveProperty('states');
    expect(result.items[3]).not.toHaveProperty('states');
    for (const item of result.items) expect(item).not.toHaveProperty('state');
  });

  it('sends state as a location_state facet by full name, and dates and title as given (#59, #60)', async () => {
    const fetchSpy = mockFetch(JSON.stringify({ results: [], pagination: { of: 0, total: 1 } }));
    vi.stubGlobal('fetch', fetchSpy);
    await getLocApiService().searchNewspapers(
      {
        query: 'titanic',
        dates: '0000/1912-04-16',
        state: 'NY',
        newspaperTitle: 'new-york tribune (new york [n.y.]) 1866-1924',
      },
      createMockContext(),
    );

    const params = new URL(fetchSpy.mock.calls[0]![0] as string).searchParams;
    expect(params.get('dates')).toBe('0000/1912-04-16');
    expect(params.get('fa')).toBe(
      'location_state:new york|partof_title:new-york tribune (new york [n.y.]) 1866-1924',
    );
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
    expect(result.items[0]!.newspaper_title).toContain('evening world');
    expect(result.items[0]!.newspaper_title).not.toBe('united states');
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
    expect(result.items[0]!.newspaper_title).toContain('daily herald');
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
    expect(result.items[0]!.description).toBeDefined();
    expect(result.items[0]!.description!.length).toBeLessThanOrEqual(500);
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
    expect(result.items[0]!.slug).toBe('aaron-copland');
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
    expect(result.items[0]!.slug).toBe('civil-war-glass-negatives');
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
    expect(result.items[0]!.item_count).toBe(57);
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
    expect(result.items[0]!.item_count).toBe(57);
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
    expect(result.items[0]!.item_count).toBe(0);
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
    expect(result.items[0]!.item_count).toBeUndefined();
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
    expect(result.items[0]!.slug).toBe('my-collection');
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
      resource: { url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/' },
      fulltext_service: 'https://tile.loc.gov/text-services/full_text.json',
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
    expect(result.ocr_text).toBe('Hair Falling?');
    // The text comes from the top-level fulltext_service.
    expect(String(fetchSpy.mock.calls[1]![0])).toBe(
      'https://tile.loc.gov/text-services/full_text.json',
    );
  });

  it('requests the item, resource, and fulltext_service projections together in one call (#42, #64)', async () => {
    const fetchSpy = mockFetch(
      JSON.stringify({ resource: { url: 'https://www.loc.gov/resource/sn000/1900-01-01/ed-1/' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await getLocApiService().getNewspaperPage(
      'https://www.loc.gov/resource/sn000/1900-01-01/ed-1/?sp=2',
      createMockContext(),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(fetchSpy.mock.calls[0]![0] as string);
    expect(calledUrl.searchParams.get('at')).toBe('item,resource,fulltext_service');
    expect(calledUrl.searchParams.get('sp')).toBe('2');
  });

  it('reads publication metadata from the item block and segment_count from the resource (#42)', async () => {
    // Live shape of https://www.loc.gov/resource/sn87065702/1927-06-16/ed-1/?sp=10&fo=json&at=item,resource
    const body = JSON.stringify({
      item: {
        title: 'Southern Christian advocate (Charleston, S.C.), June 16, 1927',
        newspaper_title: ['Southern Christian advocate'],
        partof_title: ['southern christian advocate (charleston, s.c.) 1837-1948'],
        location_state: ['georgia', 'south carolina'],
        place_of_publication: 'Charleston, S.C.',
        number_edition: ['1'],
        date_issued: '1927-06-16',
      },
      resource: {
        segment_count: 16,
        url: 'https://www.loc.gov/resource/sn87065702/1927-06-16/ed-1/',
      },
    });
    vi.stubGlobal('fetch', mockFetch(body));
    const result = await getLocApiService().getNewspaperPage(
      'https://www.loc.gov/resource/sn87065702/1927-06-16/ed-1/?sp=10',
      createMockContext(),
    );

    expect(result).toEqual({
      page_url: 'https://www.loc.gov/resource/sn87065702/1927-06-16/ed-1/?sp=10',
      newspaper_title: 'Southern Christian advocate',
      date: '1927-06-16',
      states: ['georgia', 'south carolina'],
      place_of_publication: 'Charleston, S.C.',
      edition: '1',
      sequence: 10,
      segment_count: 16,
      ocr_text: '',
      ocr_available: false,
    });
  });

  it('falls back to partof_title for newspaper_title and prefers item.date_issued over the URL date', async () => {
    const body = JSON.stringify({
      item: {
        partof_title: ['the milwaukee leader (milwaukee, wis.) 1911-1938'],
        location_state: ['wisconsin'],
        date_issued: '1927-06-14',
      },
      resource: { url: 'https://www.loc.gov/resource/sn83045293/1927-06-13/ed-1/' },
    });
    vi.stubGlobal('fetch', mockFetch(body));
    const result = await getLocApiService().getNewspaperPage(
      'https://www.loc.gov/resource/sn83045293/1927-06-13/ed-1/?sp=1',
      createMockContext(),
    );

    expect(result.newspaper_title).toBe('the milwaukee leader (milwaukee, wis.) 1911-1938');
    expect(result.states).toEqual(['wisconsin']);
    expect(result.date).toBe('1927-06-14');
    expect(result.sequence).toBe(1);
  });

  it.each([
    { name: 'an empty item block', item: {} },
    {
      name: 'an item block with empty facets',
      item: { newspaper_title: [], partof_title: [], location_state: [], number_edition: [] },
    },
    { name: 'no item block', item: undefined },
  ])('degrades to the URL-derived fallbacks for $name (#42)', async ({ item }) => {
    const body = JSON.stringify({
      ...(item && { item }),
      resource: { url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/' },
    });
    vi.stubGlobal('fetch', mockFetch(body));
    const result = await getLocApiService().getNewspaperPage(
      'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=12',
      createMockContext(),
    );

    expect(result).toEqual({
      page_url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=12',
      date: '1912-04-18',
      sequence: 12,
      ocr_text: '',
      ocr_available: false,
    });
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
      resource: { url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/' },
      fulltext_service: 'https://tile.loc.gov/text-services/full_text.json',
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
    expect(result.ocr_text).toBe('Recovered OCR text');
  });
});

/**
 * LOC answers a page past the end of a result set with 404 on every search-family endpoint.
 * These drive the real fetchSearchPage through each public search method with only `fetch`
 * stubbed, so the status handling under test actually runs.
 */
describe('LocApiService out-of-range 404 (#40)', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const notFoundBody = JSON.stringify({ exception: 'not found', status: 'not found' });

  type SearchCall = (
    svc: LocApiService,
    ctx: ReturnType<typeof createMockContext>,
    page: number,
  ) => Promise<{ items: unknown[]; pagination: LocPagination }>;

  /** An item search that asks for facets gets empty ones on a page LOC will not serve. */
  const noFacets = { facets: { subject: [], location: [] } };

  const endpoints: { name: string; path: string; call: SearchCall; extra?: object }[] = [
    {
      name: 'bare search with facets',
      path: '/search/',
      call: (svc, ctx, page) =>
        svc.search({ query: 'zyzzyva', includeFacets: true, limit: 3, page }, ctx),
      extra: noFacets,
    },
    {
      name: 'format search',
      path: '/photos/',
      call: (svc, ctx, page) =>
        svc.search({ query: 'dust bowl', format: 'photo', limit: 3, page }, ctx),
    },
    {
      name: 'collection search',
      path: '/collections/baseball-cards/',
      call: (svc, ctx, page) =>
        svc.search({ query: 'cobb', collectionSlug: 'baseball-cards', limit: 3, page }, ctx),
    },
    {
      name: 'newspaper search',
      path: '/newspapers/',
      call: (svc, ctx, page) => svc.searchNewspapers({ query: 'zyzzyva', limit: 3, page }, ctx),
    },
    {
      name: 'collections browse',
      path: '/collections/?',
      call: (svc, ctx, page) => svc.browseCollections({ limit: 3, page }, ctx),
    },
  ];

  describe.each(endpoints)('$name', ({ path, call, extra }) => {
    it.each([2, 900, 9999])(
      'reads a 404 on page %i as an out-of-range page, in one request',
      async (page) => {
        const fetchSpy = mockFetch(notFoundBody, 404);
        vi.stubGlobal('fetch', fetchSpy);
        const result = await call(getLocApiService(), createMockContext(), page);

        expect(result).toEqual({
          items: [],
          pagination: {
            total: 0,
            page,
            perPage: 3,
            pages: 0,
            hasNext: false,
            ceilingReached: false,
          },
          ...extra,
        });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const calledUrl = String(fetchSpy.mock.calls[0]![0]);
        expect(calledUrl).toContain(path);
        expect(new URL(calledUrl).searchParams.get('sp')).toBe(String(page));
      },
    );

    it('keeps a 404 on page 1 as NotFound', async () => {
      const fetchSpy = mockFetch(notFoundBody, 404);
      vi.stubGlobal('fetch', fetchSpy);
      await expect(call(getLocApiService(), createMockContext(), 1)).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('reads a 404 past the retrieval ceiling as past-the-end, while a 400 there still flags the ceiling', async () => {
    // 50,000 × 3 items is past the ~100k ceiling. A 404 says the result set ended first, so
    // partition-by-facet guidance would be wrong; the 400 answer keeps its #33 meaning.
    const svc = getLocApiService();
    vi.stubGlobal('fetch', mockFetch(notFoundBody, 404));
    const pastEnd = await svc.search(
      { query: 'zyzzyva', limit: 3, page: 50_000 },
      createMockContext(),
    );
    expect(pastEnd.pagination).toMatchObject({ pages: 0, ceilingReached: false });

    vi.stubGlobal('fetch', mockFetch('', 400));
    const ceiling = await svc.search(
      { query: 'zyzzyva', limit: 3, page: 50_000 },
      createMockContext(),
    );
    expect(ceiling.pagination).toMatchObject({ pages: 0, ceilingReached: true });
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

describe('LocApiService upstream text (#65)', () => {
  /** A semicolon-closed character reference — what no normalized string may still carry. */
  const CHARACTER_REFERENCE = /&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#[xX][0-9A-Fa-f]+);/;

  /** Answers www.loc.gov with `page` and, when given, tile.loc.gov with `text`. */
  const serveHosts = (page: unknown, text?: unknown) =>
    serveByHost({ 'www.loc.gov': page, ...(text !== undefined && { 'tile.loc.gov': text }) });

  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    initLocApiService(config, await createInMemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('decodes the references in captured search descriptions, once', async () => {
    serveHosts({
      results: [
        ...JAZZ_ENTITY_ROWS,
        {
          id: 'escaped',
          title: 'P&amp;P &amp;lt;b&amp;gt;',
          url: 'https://www.loc.gov/item/escaped/',
        },
      ],
      pagination: { of: 4, perpage: 25, pages: 1 },
    });
    const { items } = await getLocApiService().search({ query: 'jazz' }, createMockContext());

    for (const item of items.slice(0, 3)) {
      expect(JSON.stringify(item)).not.toMatch(CHARACTER_REFERENCE);
    }
    expect(items[0]!.description).toMatch(
      /^  Thanks to .* the Library’s jazz collections .* the …$/,
    );
    expect(items[1]!.description).toContain('entitled “I Hate Jazz” and');
    expect(items[2]!.description).toContain(
      'lead.  Today, January 26, is the birthday of Stèphane',
    );
    expect(items[3]!.title).toBe('P&P &lt;b&gt;');
    // Identifiers and URLs are read as before.
    expect(items[1]).toMatchObject({
      id: 'loc/2014/01/all-that-jazz',
      url: 'https://blogs.loc.gov/loc/2014/01/all-that-jazz/',
      date: '2014-01-31',
      format: 'web page',
    });
  });

  it('decodes facet values', async () => {
    serveHosts({
      results: [{ id: 'a', title: 'A', url: 'https://www.loc.gov/item/a/' }],
      pagination: { of: 1, perpage: 25, pages: 1 },
      facets: [
        { type: 'subject', filters: [{ value: 'arts &amp; crafts', count: 3 }] },
        { type: 'location', filters: [{ value: 'saint-&#xE9;tienne', count: 1 }] },
      ],
    });
    const { facets } = await getLocApiService().search(
      { query: 'crafts', includeFacets: true },
      createMockContext(),
    );
    expect(facets).toEqual({
      subject: [{ value: 'arts & crafts', count: 3 }],
      location: [{ value: 'saint-étienne', count: 1 }],
    });
  });

  it('reduces the captured HTML item.rights to plain text when rights_information is absent', async () => {
    serveHosts({
      item: { ...MANUSCRIPT_ITEM_MM77093930.item, rights: MANUSCRIPT_RIGHTS_MM77093930 },
      resources: [],
    });
    const result = await getLocApiService().getItem('mm77093930', createMockContext());
    expect(result.rights_information).toBe(
      'The contents of the Library of Congress Betty Herndon Maury Maury collection are in the public domain and are free to use and reuse. Credit Line: Library of Congress, Manuscript Division, Betty Herndon Maury Maury Diary. More about Copyright and other Restrictions (https://www.loc.gov/legal/). For guidance about compiling full citations consult Citing Primary Sources (https://www.loc.gov/teachers/usingprimarysources/citing.html).',
    );
  });

  it('decodes item.rights once: an escaped tag stays text, never a tag to strip', async () => {
    serveHosts({
      item: {
        title: 'Map',
        rights: ['<p>P&amp;P &amp;lt;b&amp;gt; &lt;i&gt;</p>', '<p>Second.</p>'],
        url: 'https://www.loc.gov/item/map/',
      },
    });
    const result = await getLocApiService().getItem('map', createMockContext());
    expect(result.rights_information).toBe('P&P &lt;b&gt; <i> Second.');
  });

  it('decodes rights_information without stripping it, and prefers it over item.rights', async () => {
    serveHosts({
      item: {
        title: 'Photo',
        rights_information: 'No known restrictions on publication &amp; reuse. Not 1866-<1899>.',
        rights: MAP_RIGHTS_98688514,
        url: 'https://www.loc.gov/item/photo/',
      },
    });
    const result = await getLocApiService().getItem('photo', createMockContext());
    expect(result.rights_information).toBe(
      'No known restrictions on publication & reuse. Not 1866-<1899>.',
    );
  });

  it('keeps the literal catalog brackets in notes', async () => {
    serveHosts({
      item: { ...NEWSPAPER_ISSUE_SN83030214_1912_04_16.item, notes: NEWSPAPER_NOTES_SN83030214 },
    });
    const result = await getLocApiService().getItem(
      'sn83030214/1912-04-16/ed-1',
      createMockContext(),
    );
    expect(result.notes).toEqual([
      'Semiweekly ed.: New-York tribune (New York, N.Y. : 1866 : Semiweekly), 1866-<1899>.',
      'Triweekly eds.: New-York tri-weekly tribune, <1900>-1903, and: New York tribune (New York, N.Y. : 1903), 1903-<1909>.',
      'Weekly ed.: New-York tribune (New York, N.Y. : 1866 : Weekly), 1866-<1906>.',
    ]);
  });

  it('decodes every item text field and a related record known only by title', async () => {
    serveHosts({
      item: {
        title: 'Caf&eacute; &amp; bar',
        created_published_date: 'c1915 &ndash; 1916',
        contributor_names: ['Ch&acirc;telet, Th&eacute;&acirc;tre (Publisher)'],
        subject_headings: ['Arts &amp; crafts--France'],
        subject: ['arts &amp; crafts'],
        notes: ['Gift of &quot;A. Smith&quot;.'],
        summary: ['First &hellip;', 'second.'],
        medium: ['1 print &times; 2'],
        call_number: ['LOT 6668 <item> [P&amp;P]'],
        language: ['fran&ccedil;ais'],
        location: ['saint-&#xE9;tienne'],
        original_format: ['photo, print &amp; drawing'],
        online_format: ['image'],
        related_items: [{ title: 'Les Caf&eacute;s' }],
        url: 'https://www.loc.gov/item/cafe/',
      },
    });
    const result = await getLocApiService().getItem('cafe', createMockContext());
    expect(JSON.stringify(result)).not.toMatch(CHARACTER_REFERENCE);
    expect(result).toMatchObject({
      title: 'Café & bar',
      date: 'c1915 – 1916',
      contributors: ['Châtelet, Théâtre (Publisher)'],
      subject_headings: ['Arts & crafts--France'],
      subject_terms: ['arts & crafts'],
      notes: ['Gift of "A. Smith".'],
      summary: 'First … second.',
      physical_description: '1 print × 2',
      call_number: 'LOT 6668 <item> [P&P]',
      languages: ['français'],
      locations: ['saint-étienne'],
      original_formats: ['photo, print & drawing'],
      related_items: ['Les Cafés'],
    });
  });

  it('decodes newspaper rows before the excerpt is cut, so no reference is split', async () => {
    // The raw reference straddles character 500; cut first, it would leave "&#82".
    const description = `${'x'.repeat(497)}&#8217;s more text`;
    serveHosts({
      results: [
        {
          url: 'https://www.loc.gov/resource/sn1/1912-04-16/ed-1/?sp=1',
          title: 'Image 1 of The S&amp;B herald',
          description: [description],
          partof_title: ['the s&amp;b herald (smith&#8217;s ferry, idaho) 1910-1920'],
          location_state: ['idaho'],
          date: '1912-04-16',
        },
      ],
      pagination: { of: 1, perpage: 25, pages: 1 },
    });
    const { items } = await getLocApiService().searchNewspapers(
      { query: 'herald' },
      createMockContext(),
    );
    expect(items[0]).toMatchObject({
      title: 'Image 1 of The S&B herald',
      newspaper_title: 'the s&b herald (smith’s ferry, idaho) 1910-1920',
      description: `${'x'.repeat(497)}’s `,
    });
  });

  it('decodes page metadata and passes the page text through verbatim', async () => {
    // tile.loc.gov text is not HTML-escaped — it carries raw `<` (`p<ured`) and bare `&` — so a
    // `&name;` sequence in it is the page's own text, never a reference to decode.
    const ocr = `Smith & Co. paid &amp; signed\n${TITANIC_OCR_EXCERPT}`;
    serveHosts(
      {
        item: {
          newspaper_title: ['The S&amp;B herald'],
          place_of_publication: 'Smith&#8217;s Ferry, Idaho',
          location_state: ['idaho'],
        },
        resource: { url: 'https://www.loc.gov/resource/sn1/1912-04-16/ed-1/' },
        fulltext_service:
          'https://tile.loc.gov/text-services/word-coordinates-service?segment=/x.xml',
      },
      { '/x.xml': { full_text: ocr } },
    );
    const result = await getLocApiService().getNewspaperPage(
      'https://www.loc.gov/resource/sn1/1912-04-16/ed-1/?sp=1',
      createMockContext(),
    );
    expect(result).toMatchObject({
      newspaper_title: 'The S&B herald',
      place_of_publication: 'Smith’s Ferry, Idaho',
      ocr_text: ocr,
    });
  });

  it('decodes the captured collection descriptions', async () => {
    serveHosts({ results: COLLECTION_ENTITY_ROWS, pagination: { of: 2, perpage: 25, pages: 1 } });
    const { items } = await getLocApiService().browseCollections({}, createMockContext());
    for (const item of items) expect(JSON.stringify(item)).not.toMatch(CHARACTER_REFERENCE);
    expect(items[0]!.description).toMatch(
      /^This collection highlights the history of the hymn “Amazing Grace” from/,
    );
    expect(items[1]!.description).toContain('at the Théâtre du Châtelet in May of 1909');
    expect(items[1]!.description).toContain(
      'Schéhérazade, Firebird, Petrouchka, L’Après-midi d’un Faune',
    );
    expect(items[1]!.slug).toBe('ballets-russes-de-serge-diaghilev');
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

  it('fails a call made during the block before any request, with the time left in the hint', async () => {
    // Runs after the 429 above, so the module-level block is live.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const svc = getLocApiService();
    const err = await svc.search({ query: 'test', page: 1 }, createMockContext()).then(
      () => undefined,
      (e: unknown) => e as { code?: number; data?: Record<string, unknown> },
    );

    expect(err).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'rate_limit_exceeded', blockedUntil: expect.any(String) },
    });
    const hint = String((err?.data?.recovery as { hint?: string } | undefined)?.hint);
    expect(hint).toMatch(/60 more minute/);
    expect(hint).toContain(String(err?.data?.blockedUntil));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
