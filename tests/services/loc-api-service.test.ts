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
  compactDate,
  facetSegment,
  getLocApiService,
  initLocApiService,
  isCodedDate,
  LocApiService,
} from '@/services/loc-api/loc-api-service.js';
import type { LocPagination } from '@/services/loc-api/types.js';
import { LOC_CHALLENGE_BODY } from '../fixtures/loc-challenge.js';
import {
  AUDIO_ITEM_2020729028,
  AUDIO_ITEM_JUKEBOX_68453,
  AUDIO_ITEM_LOMAXBIB000571,
  BASEBALL_CARD_ITEM_2008676581,
  BOOK_ITEM_00003348,
  BOOK_ITEM_02007458,
  BOOK_ITEM_2005567251,
  BOOK_ITEM_2024769398,
  COBB_PHOTO_SEARCH,
  CODED_DATE_SEARCH,
  FILM_ITEM_00694298,
  IDENTITY_SHAPES_SEARCH,
  LINCOLN_GETTYSBURG_1863_SEARCH,
  MANUSCRIPT_ITEM_MAL4356500,
  MANUSCRIPT_ITEM_MM77093930,
  NEWSPAPER_ISSUE_SN83030214_1912_04_16,
  SCORE_ITEM_AFCREED000001,
  SLEEVE_ITEM_LOMAXBIB000840,
  VIDEO_ITEM_NCR002372,
} from '../fixtures/loc-items.js';
import {
  LUSITANIA_1915_FACETS,
  LUSITANIA_1915_GERMAN,
  LUSITANIA_1915_KLINGON_EMPTY,
} from '../fixtures/loc-newspaper-search.js';
import {
  BELL_CARD_PAGE_2,
  BELL_CARD_TEI,
  BOOK_BLANK_PAGE_3,
  BOOK_BLANK_PAGE_3_TEXT,
  GETTYSBURG_NICOLAY_PAGE_1,
  GETTYSBURG_NICOLAY_TEI,
  MANUSCRIPT_IMAGE_ONLY_PAGE_2,
  MANUSCRIPT_PAGE_3,
  MANUSCRIPT_PAGE_3_TEXT,
  NEWSPAPER_ED2_PAGE_2,
  NEWSPAPER_PAGE_1,
} from '../fixtures/loc-pages.js';
import {
  LANGE_PHOTOS_1936_SEARCH,
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
import { cpuScaling, repeatTo } from '../helpers/cpu-scaling.js';
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

describe('isCodedDate (#69)', () => {
  it.each(['uuuu', '185u', '15uu', '||||', '18950000', '19130600', '1860000', '0w0 d1804 d1806'])(
    'reads %j as coded',
    (value) => {
      expect(isCodedDate(value)).toBe(true);
    },
  );

  it.each([
    '800',
    '1867',
    '1894',
    '185?',
    '15??',
    '200?',
    'c1915 Feb. 19.',
    '1936 Apr.',
    '1909-1911.',
    '1913-06-01',
    '1860-01-01',
    '[between 1861 and 1865]',
    '[ca. 1911]',
    '3 June 1902.',
    '186500',
  ])('reads %j as a date', (value) => {
    expect(isCodedDate(value)).toBe(false);
  });

  it.each<[string, (length: number) => string]>([
    ['a digit run', (n) => repeatTo('1', n)],
    ['a digit run ending in a letter', (n) => `${repeatTo('1', n - 1)}x`],
    ['a u-placeholder run ending in a letter', (n) => `${repeatTo('u', n - 1)}x`],
    ['repeated d-prefixed digit runs', (n) => repeatTo('d123 ', n)],
    ['repeated spaced d letters', (n) => repeatTo(' d', n)],
  ])('scans %s in linear time (5k → 320k characters)', (_name, make) => {
    const { largeMs, ratio } = cpuScaling(isCodedDate, make);
    expect(ratio).toBeLessThan(256);
    expect(largeMs).toBeLessThan(250);
  });
});

describe('compactDate (#88)', () => {
  it.each([
    ['18630000', '1863'],
    ['19660000', '1966'],
    ['18631100', '1863-11'],
    ['19130600', '1913-06'],
    ['18631120', '1863-11-20'],
    ['19390604', '1939-06-04'],
    ['18631231', '1863-12-31'],
    ['20000229', '2000-02-29'],
    ['18640229', '1864-02-29'],
  ])('reads %j as %j', (value, date) => {
    expect(compactDate(value)).toBe(date);
  });

  it.each([
    ['seven digits', '1860000'],
    ['nine digits', '186311000'],
    ['a 00 month with a day', '18630015'],
    ['month 13', '18631300'],
    ['month 13 with a day', '18631305'],
    ['day 32', '18631132'],
    ['30 February', '18630230'],
    ['29 February in a common year', '18630229'],
    ['29 February 1900', '19000229'],
    ['31 April', '18630431'],
    ['a dashed date', '1863-11-01'],
    ['a plain year', '1863'],
    ['a MARC placeholder', '186u0000'],
    ['a padded number', ' 18631100'],
    ['an empty string', ''],
    ['year zero', '00000000'],
    ['year zero with a month', '00001100'],
  ])('leaves %s (%j) unconverted', (_name, value) => {
    expect(compactDate(value)).toBeUndefined();
  });

  it.each<[string, (length: number) => string]>([
    ['a digit run', (n) => repeatTo('1', n)],
    ['a digit run ending in a letter', (n) => `${repeatTo('1', n - 1)}x`],
    ['a repeated compact date', (n) => repeatTo('18631100', n)],
  ])('reads %s in linear time (5k → 320k characters)', (_name, make) => {
    const { largeMs, ratio } = cpuScaling(compactDate, make);
    expect(ratio).toBeLessThan(256);
    expect(largeMs).toBeLessThan(250);
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

  it('keeps relevance requests and upstream order unchanged', async () => {
    const fetchSpy = mockFetch(
      makeSearchResponse({
        results: [
          { id: 'https://www.loc.gov/item/later/', title: 'Later', date: '1920' },
          { id: 'https://www.loc.gov/item/earlier/', title: 'Earlier', date: '1863' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const result = await getLocApiService().search(
      { query: '*', format: 'photo', page: 2 },
      createMockContext(),
    );
    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.pathname).toBe('/photos/');
    expect(url.searchParams.get('sb')).toBeNull();
    expect(url.searchParams.get('q')).toBe('*');
    expect(url.searchParams.get('sp')).toBe('2');
    expect(result.items.map((item) => item.id)).toEqual(['later', 'earlier']);
  });

  it.each([
    ['photo', 'photo, print, drawing'],
    ['map', 'map'],
    ['newspaper', 'newspaper'],
    ['manuscript', 'manuscript/mixed material'],
    ['audio', 'sound recording'],
    ['film', 'film, video'],
    ['book', 'book'],
    ['notated-music', 'notated music'],
  ])('combines collection and %s using its original-format facet', async (format, facet) => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    await getLocApiService().search(
      {
        query: '*',
        collectionSlug: 'aaron-copland',
        format,
        subjectTerms: ['music'],
        location: 'new york',
        dates: '1863/1863',
        includeFacets: true,
        limit: 3,
        page: 2,
      },
      createMockContext(),
    );
    const url = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(url.pathname).toBe('/collections/aaron-copland/');
    expect(url.searchParams.get('fa')).toBe(
      `subject:music|location:new york|original-format:${facet}`,
    );
    expect(url.searchParams.get('dates')).toBe('1863/1863');
    expect(url.searchParams.get('at')).toBe('results,pagination,facets');
    expect(url.searchParams.get('sp')).toBe('2');
  });

  it.each(['date', 'date_desc'] as const)(
    'forwards %s through every search route',
    async (sort) => {
      const fetchSpy = vi
        .fn()
        .mockImplementation(
          () =>
            new Response(makeSearchResponse(), { headers: { 'Content-Type': 'application/json' } }),
        );
      vi.stubGlobal('fetch', fetchSpy);
      const svc = getLocApiService();
      vi.useFakeTimers();
      for (const scope of [
        {},
        { format: 'photo' },
        { collectionSlug: 'aaron-copland', format: 'photo' },
      ]) {
        const pending = svc.search({ query: '*', sort, ...scope, page: 2 }, createMockContext());
        await vi.runAllTimersAsync();
        await pending;
      }
      const pending = svc.searchNewspapers(
        {
          query: 'train',
          sort,
          dates: '1912/1912',
          state: 'OK',
          newspaperTitle: 'full title',
          page: 2,
        },
        createMockContext(),
      );
      await vi.runAllTimersAsync();
      await pending;
      vi.useRealTimers();
      const urls = fetchSpy.mock.calls.map((call) => new URL(String(call[0])));
      expect(urls.map((url) => url.pathname)).toEqual([
        '/search/',
        '/photos/',
        '/collections/aaron-copland/',
        '/newspapers/',
      ]);
      expect(urls.map((url) => url.searchParams.get('sb'))).toEqual([sort, sort, sort, sort]);
      expect(urls.map((url) => url.searchParams.get('sp'))).toEqual(['2', '2', '2', '2']);
      expect(urls[3]!.searchParams.get('fa')).toBe(
        'location_state:oklahoma|partof_title:full title',
      );
    },
  );

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

  it('returns empty items and pages:0 sentinel on HTTP 400 past the retrieval ceiling', async () => {
    vi.stubGlobal('fetch', mockFetch('', 400));
    const ctx = createMockContext();
    const svc = getLocApiService();
    const result = await svc.search({ query: 'test', page: 99999 }, ctx);
    expect(result.items).toHaveLength(0);
    expect(result.pagination.pages).toBe(0);
  });

  it.each([1, 3, 50000])(
    'fails HTTP 520 on page %i as upstream_unavailable carrying the status, sent once (#86)',
    async (page) => {
      // LOC's live answer to an origin error on an in-range page (2026-11-13): Cloudflare's 520.
      const fetchSpy = mockFetch('error code: 520', 520);
      vi.stubGlobal('fetch', fetchSpy);
      const err = await getLocApiService()
        .search({ query: 'test', page }, createMockContext())
        .catch((e: unknown) => e);
      expect(err).toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        message: 'LOC API returned HTTP 520',
      });
      expect((err as { data?: unknown }).data).toEqual({
        status: 520,
        reason: 'upstream_unavailable',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['search', (svc: LocApiService) => svc.search({ query: 'x', page: 1 }, createMockContext())],
    [
      'searchNewspapers',
      (svc: LocApiService) => svc.searchNewspapers({ query: 'x', page: 2 }, createMockContext()),
    ],
    [
      'browseCollections',
      (svc: LocApiService) => svc.browseCollections({ query: 'x', page: 1 }, createMockContext()),
    ],
  ])(
    '%s fails an HTTP 414 as the non-retryable query_too_long validation error, sent once',
    async (_name, call) => {
      // LOC's answer to an 8,870-character search URL: Apache's "414 Request-URI Too Long" page.
      const fetchSpy = mockFetch('<title>414 Request-URI Too Long</title>', 414);
      vi.stubGlobal('fetch', fetchSpy);
      const err = await call(getLocApiService()).catch((e: unknown) => e);
      expect(err).toMatchObject({
        code: JsonRpcErrorCode.ValidationError,
        message: 'The Library of Congress refused this search as too long (HTTP 414).',
      });
      expect((err as { data?: unknown }).data).toEqual({
        reason: 'query_too_long',
        status: 414,
        retryable: false,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('fails a page-1 HTTP 400 as upstream_unavailable carrying the status, sent once (#86)', async () => {
    const fetchSpy = mockFetch('', 400);
    vi.stubGlobal('fetch', fetchSpy);
    const err = await getLocApiService()
      .search({ query: 'test', page: 1 }, createMockContext())
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'LOC API returned HTTP 400',
    });
    expect((err as { data?: unknown }).data).toEqual({
      status: 400,
      reason: 'upstream_unavailable',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // The page size reaches the ceiling check as the `c` sent — `limit`, served as at most 100.
  it.each([
    { limit: 3, last: 33_333 },
    { limit: 25, last: 4_000 },
    { limit: 100, last: 1_000 },
    { limit: 250, last: 1_000 },
  ])(
    'reads a 400 as the retrieval ceiling only past page $last at limit $limit (#86)',
    async ({ limit, last }) => {
      const fetchSpy = mockFetch('', 400);
      vi.stubGlobal('fetch', fetchSpy);
      const svc = getLocApiService();

      await expect(
        svc.search({ query: 'test', limit, page: last }, createMockContext()),
      ).rejects.toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: { status: 400, reason: 'upstream_unavailable' },
      });
      const past = await svc.search({ query: 'test', limit, page: last + 1 }, createMockContext());
      expect(past).toEqual({
        items: [],
        pagination: {
          total: 0,
          page: last + 1,
          perPage: Math.min(limit, 100),
          pages: 0,
          hasNext: false,
          ceilingReached: true,
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    },
  );

  it('fails a within-ceiling 400 challenge as a soft block, as it does any other status (#86)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(LOC_CHALLENGE_BODY, {
          status: 400,
          headers: { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge' },
        }),
      ),
    );
    await expect(
      getLocApiService().search({ query: 'test', limit: 25, page: 8 }, createMockContext()),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: { reason: 'upstream_unavailable', retryAfter: 60 },
    });
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

  it('flags ceilingReached on a 400 past the retrieval ceiling, and fails one within it (#33, #86)', async () => {
    vi.stubGlobal('fetch', mockFetch('', 400));
    const ctx = createMockContext();
    const svc = getLocApiService();

    const past = await svc.search({ query: 'test', limit: 25, page: 5000 }, ctx);
    expect(past.pagination.pages).toBe(0);
    expect(past.pagination.ceilingReached).toBe(true); // 5000 > 100000 / 25

    // 8 <= 100000 / 25: LOC sends a 400 there for no known reason, so it is an upstream failure.
    await expect(svc.search({ query: 'test', limit: 25, page: 8 }, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: { status: 400, reason: 'upstream_unavailable' },
    });
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

  describe('row identity shapes (#68)', () => {
    const identities = async () => {
      serveByHost({ 'www.loc.gov': IDENTITY_SHAPES_SEARCH });
      const result = await getLocApiService().search(
        { query: 'civil war', page: 1 },
        createMockContext(),
      );
      return result.items.map(({ id, is_item, url }) => ({ id, is_item, url }));
    };

    it('flags lccn.loc.gov permalink rows is_item:true, keeping the bare LCCN id and https url', async () => {
      expect((await identities()).slice(0, 3)).toEqual([
        { id: '2005567251', is_item: true, url: 'https://lccn.loc.gov/2005567251' },
        { id: 'unk82079773', is_item: true, url: 'https://lccn.loc.gov/unk82079773' },
        { id: '2024681443', is_item: true, url: 'https://lccn.loc.gov/2024681443' },
      ]);
    });

    it('keeps catalog.loc.gov, hdl.loc.gov, and collection rows is_item:false', async () => {
      expect((await identities()).slice(3)).toEqual([
        {
          id: 'cgi-bin/Pwebrecon.cgi?DB=local&BBID=13839143&v3=1',
          is_item: false,
          url: 'https://catalog.loc.gov/vwebv/holdingsInfo?bibId=13839143',
        },
        {
          id: 'loc.mss/eadmss.ms013110',
          is_item: false,
          url: 'https://hdl.loc.gov/loc.mss/eadmss.ms013110',
        },
        {
          id: 'collections/civil-war-maps/about-this-collection',
          is_item: false,
          url: 'https://www.loc.gov/collections/civil-war-maps/about-this-collection/',
        },
      ]);
    });
  });

  describe('coded item.date on rows (#69)', () => {
    const dates = async (body: unknown) => {
      serveByHost({ 'www.loc.gov': body });
      const result = await getLocApiService().search(
        { query: 'railroads', page: 1 },
        createMockContext(),
      );
      return result.items.map((item) => [item.id, item.date]);
    };

    it('falls back to the top-level date, or none, when item.date is coded', async () => {
      expect(await dates(CODED_DATE_SEARCH)).toEqual([
        ['scsm000191', '1895'],
        ['magbell.02800101', '1913-06'],
        ['98688858', '185?'],
        ['2024769398', undefined],
      ]);
      const identity = await dates(IDENTITY_SHAPES_SEARCH);
      expect(identity[0]).toEqual(['2005567251', undefined]);
      expect(identity[3]).toEqual(['cgi-bin/Pwebrecon.cgi?DB=local&BBID=13839143&v3=1', undefined]);
    });

    it('keeps a cataloged item.date, and the top-level date of a row without one', async () => {
      expect(await dates(COBB_PHOTO_SEARCH)).toEqual([
        ['2008676581', '1909-1911.'],
        ['2001704373', 'c1915 Feb. 19.'],
        ['exhibits/jazz-singers/slideshow', '2016-02-11'],
      ]);
      const identity = await dates(IDENTITY_SHAPES_SEARCH);
      expect(identity.slice(1, 3)).toEqual([
        ['unk82079773', '1835'],
        ['2024681443', '1860'],
      ]);
      expect(identity[4]).toEqual(['loc.mss/eadmss.ms013110', '1944']);
    });
  });

  describe('compact item.date on rows (#88)', () => {
    // The conversion is tabled under compactDate; these prove the row precedence around it.
    const dates = async (body: unknown) => {
      serveByHost({ 'www.loc.gov': body });
      const result = await getLocApiService().search(
        { query: 'gettysburg', page: 1 },
        createMockContext(),
      );
      return result.items.map((item) => [item.id, item.date]);
    };
    const [month, day, year] = LINCOLN_GETTYSBURG_1863_SEARCH.results;

    it('reads a compact item.date at its own precision, not the padded top-level date', async () => {
      expect(await dates(LINCOLN_GETTYSBURG_1863_SEARCH)).toEqual([
        ['mal4356500', '1863-11'],
        ['mal2812800', '1863-11-20'],
        ['mal2910600', '1863'],
      ]);
    });

    it('falls back to the top-level date when the compact number is no calendar date', async () => {
      const body = {
        ...LINCOLN_GETTYSBURG_1863_SEARCH,
        results: [
          { ...month, item: { date: '18631300' } },
          { ...day, item: { date: '18630230' } },
          { ...year, item: { date: '1863000' } },
        ],
      };
      expect(await dates(body)).toEqual([
        ['mal4356500', '1863-11-01'],
        ['mal2812800', '1863-11-20'],
        ['mal2910600', '1863-01-01'],
      ]);
    });
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

    expect(facets).toEqual({
      subject: [{ value: 'jazz', count: 4 }],
      location: [],
      contributor: [],
    });
  });

  it('returns empty facets for a page LOC will not serve', async () => {
    fetchSpy.mockImplementation(async () => new Response('', { status: 400 }));

    // Page 4001 at the default 25 per page lies past the ~100k retrieval ceiling.
    const { facets } = await getLocApiService().search(
      { query: 'posters', page: 4001, includeFacets: true },
      createMockContext(),
    );

    expect(facets).toEqual({ subject: [], location: [], contributor: [] });
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

  describe('facetSegment — one fa segment, the seam every filter value passes through', () => {
    it.each([
      ['location', 'location', 'oklahoma', 'location:oklahoma'],
      [
        'newspaper_title',
        'partof_title',
        'world war history : daily records and comments as appeared in american and foreign newspapers, 1914-1926 (new york) 1928-',
        'partof_title:world war history : daily records and comments as appeared in american and foreign newspapers, 1914-1926 (new york) 1928-',
      ],
      [
        'newspaper_title',
        'partof_title',
        'tägliches cincinnatier volksblatt (cincinnati [ohio]) 1885-1919',
        'partof_title:tägliches cincinnatier volksblatt (cincinnati [ohio]) 1885-1919',
      ],
      ['language', 'language', 'german', 'language:german'],
    ])('builds %s as %s:<value>, colons and commas included', (field, facet, value, segment) => {
      expect(facetSegment(field, facet, value)).toBe(segment);
    });

    // LOC reads an empty segment at either end of `fa` as no filter: `fa=location:oklahoma|`
    // answers exactly as `fa=location:oklahoma` does, so a stray edge "|" is dropped, not refused.
    it.each([
      ['oklahoma|', 'location:oklahoma'],
      ['|oklahoma', 'location:oklahoma'],
      ['||oklahoma||', 'location:oklahoma'],
      [' | new york | ', 'location:new york'],
    ])('drops "|" and spaces at the ends of %j, sending %s', (value, segment) => {
      expect(facetSegment('location', 'location', value)).toBe(segment);
    });

    it.each(['oklahoma|tulsa', 'a|b|c', '|', ' | | ', '|a|b|', 'x|subject:civil war'])(
      'refuses %j with a validation error naming the field, since LOC splits fa at "|"',
      (value) => {
        let thrown: unknown;
        try {
          facetSegment('location', 'location', value);
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toMatchObject({
          code: JsonRpcErrorCode.ValidationError,
          message:
            'The location value cannot contain "|", which the Library of Congress reads as a separator between filters.',
        });
        expect((thrown as { data?: unknown }).data).toEqual({
          reason: 'invalid_filter_value',
          field: 'location',
          retryable: false,
        });
      },
    );
  });

  describe('contributor filter, facet, and row terms (#92)', () => {
    const sentFa = () => new URL(String(fetchSpy.mock.calls[0]![0])).searchParams.get('fa');

    // One value per character class the captured contributor values carry: commas, parentheses,
    // an inner " : ", and non-ASCII letters.
    const values = [
      'lange, dorothea',
      'lomax, john a. (john avery)',
      'wgbh (television station : boston, mass.)',
      'dvořák, antonín',
    ];

    it.each(values)('sends %j as contributor:<value>, unchanged', async (contributor) => {
      fetchSpy.mockImplementation(async () => json(LANGE_PHOTOS_1936_SEARCH));

      await getLocApiService().search({ query: 'lange', contributor }, createMockContext());

      expect(sentFa()).toBe(`contributor:${contributor}`);
    });

    it.each(values)(
      'ANDs %j with the subject terms, the location, and a collection original-format in one fa value',
      async (contributor) => {
        fetchSpy.mockImplementation(async () => json(LANGE_PHOTOS_1936_SEARCH));

        await getLocApiService().search(
          {
            query: 'lange',
            collectionSlug: 'fsa-owi-black-and-white-negatives',
            format: 'photo',
            subjectTerms: ['migrants'],
            location: 'california',
            contributor,
          },
          createMockContext(),
        );

        expect(sentFa()).toBe(
          `subject:migrants|location:california|contributor:${contributor}|original-format:photo, print, drawing`,
        );
      },
    );

    it('percent-encodes a diacritic as UTF-8 on the wire', async () => {
      fetchSpy.mockImplementation(async () => json(LANGE_PHOTOS_1936_SEARCH));

      await getLocApiService().search(
        { query: 'dvorak', format: 'notated-music', contributor: 'dvořák, antonín' },
        createMockContext(),
      );

      expect(String(fetchSpy.mock.calls[0]![0])).toContain(
        'fa=contributor%3Advo%C5%99%C3%A1k%2C+anton%C3%ADn',
      );
    });

    it('returns the contributor facet in LOC order beside the location facet, from the one request', async () => {
      fetchSpy.mockImplementation(async () => json(LANGE_PHOTOS_1936_SEARCH));

      const { facets } = await getLocApiService().search(
        { query: 'lange', format: 'photo', dates: '1936/1936', includeFacets: true },
        createMockContext(),
      );

      expect(facets?.contributor).toEqual([
        { value: 'lange, dorothea', count: 776 },
        { value: 'united states. resettlement administration', count: 27 },
        { value: 'united states. farm security administration', count: 22 },
        { value: 'rothstein, arthur', count: 12 },
        { value: 'lee, russell', count: 6 },
        { value: 'mydans, carl', count: 3 },
        { value: 'united states. office of war information', count: 2 },
        {
          value: 'united states. office of coordinator of information. foreign information service',
          count: 1,
        },
      ]);
      expect(facets?.location[1]).toEqual({ value: 'california', count: 333 });
      expect(facets?.location).toHaveLength(10);
      expect(facets?.subject).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("carries a row's contributor list in LOC order, and nothing on a row LOC sends none for", async () => {
      fetchSpy.mockImplementation(async () => json(LANGE_PHOTOS_1936_SEARCH));

      const { items } = await getLocApiService().search({ query: 'lange' }, createMockContext());

      expect(items[0]).not.toHaveProperty('contributor_terms');
      expect(items[1]!.contributor_terms).toEqual([
        'lange, dorothea',
        'united states. resettlement administration',
      ]);
      expect(items[2]!.contributor_terms).toEqual(['lange, dorothea']);
    });

    it('keeps a long contributor list whole', async () => {
      const names = Array.from({ length: 130 }, (_, i) => `contributor ${i + 1}`);
      fetchSpy.mockImplementation(async () =>
        json({
          results: [
            {
              id: 'http://www.loc.gov/collections/a/about-this-collection/',
              url: 'https://www.loc.gov/collections/a/about-this-collection/',
              title: 'A collection',
              original_format: ['collection'],
              contributor: names,
            },
          ],
          pagination: { of: 1, perpage: 25 },
        }),
      );

      const { items } = await getLocApiService().search({ query: 'a' }, createMockContext());

      expect(items[0]!.contributor_terms).toEqual(names);
    });
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

  describe('coded item.date (#69)', () => {
    it.each([
      ['00003348', BOOK_ITEM_00003348],
      ['2005567251', BOOK_ITEM_2005567251],
      ['2024769398', BOOK_ITEM_2024769398],
    ])('omits the coded date of %s', async (itemId, body) => {
      serveByHost({ 'www.loc.gov': body });
      const result = await getLocApiService().getItem(itemId, createMockContext());
      expect(result).toMatchObject({ item_id: itemId });
      expect(result).not.toHaveProperty('date');
    });

    it.each([
      ['a placeholder-free estimate', { date: '200?' }, '200?'],
      ['a three-digit year', { date: '800' }, '800'],
      [
        'a cataloged date over the sort key',
        { date: '1936-01-01', created_published_date: '1936 Apr.' },
        '1936 Apr.',
      ],
      ['a padded key with no cataloged date', { date: '1860-01-01' }, '1860-01-01'],
    ])('keeps %s', async (_name, dates, expected) => {
      serveByHost({
        'www.loc.gov': {
          item: { title: 'Dated', url: 'https://www.loc.gov/item/dated/', ...dates },
          resources: [],
          related_items: [],
        },
      });
      const result = await getLocApiService().getItem('dated', createMockContext());
      expect(result.date).toBe(expected);
    });
  });

  describe('compact item.item.date (#88)', () => {
    it.each([
      ['mal4356500', MANUSCRIPT_ITEM_MAL4356500, '1863-11'],
      ['afcreed000001', SCORE_ITEM_AFCREED000001, '1966'],
      ['lomaxbib000571', AUDIO_ITEM_LOMAXBIB000571, '1939-06-04'],
      ['ncr002372', VIDEO_ITEM_NCR002372, '1979-10-01'],
    ])('reads %s at the precision of its nested compact date', async (itemId, body, date) => {
      serveByHost({ 'www.loc.gov': body });
      const result = await getLocApiService().getItem(itemId, createMockContext());
      expect(result.date).toBe(date);
    });

    it.each([
      ['00003348', BOOK_ITEM_00003348, '0w0 d1804 d1806'],
      ['2024769398', BOOK_ITEM_2024769398, '||||'],
    ])(
      'still omits the date of %s, whose nested date is the same coded value',
      async (itemId, body, coded) => {
        serveByHost({ 'www.loc.gov': { ...body, item: { ...body.item, item: { date: coded } } } });
        const result = await getLocApiService().getItem(itemId, createMockContext());
        expect(result).toMatchObject({ item_id: itemId });
        expect(result).not.toHaveProperty('date');
      },
    );

    it.each([
      [
        'the cataloged date over the compact one',
        { date: '1936-01-01', created_published_date: '1936 Apr.', item: { date: '19360400' } },
        '1936 Apr.',
      ],
      [
        'the item.date when the compact number is no calendar date',
        { date: '1863-11-01', item: { date: '18631300' } },
        '1863-11-01',
      ],
      [
        'the item.date when the nested date is not a compact number',
        { date: '1894', item: { date: '1894?' } },
        '1894',
      ],
      [
        'the item.date when the nested date is not a string',
        { date: '1863-11-01', item: { date: 18631100 } },
        '1863-11-01',
      ],
    ])('keeps %s', async (_name, fields, expected) => {
      serveByHost({
        'www.loc.gov': {
          item: { title: 'Dated', url: 'https://www.loc.gov/item/dated/', ...fields },
          resources: [],
          related_items: [],
        },
      });
      const result = await getLocApiService().getItem('dated', createMockContext());
      expect(result.date).toBe(expected);
    });

    it('reads no date out of a nested cataloged text when item.date is coded', async () => {
      serveByHost({
        'www.loc.gov': {
          item: {
            title: 'Coded',
            url: 'https://www.loc.gov/item/coded/',
            date: 'uuuu',
            created_published: ['November 1863'],
            item: { date: 'November 1863' },
          },
          resources: [],
          related_items: [],
        },
      });
      const result = await getLocApiService().getItem('coded', createMockContext());
      expect(result).not.toHaveProperty('date');
      expect(result.imprint).toBe('November 1863');
    });
  });

  describe('imprint (#71)', () => {
    /** getItem's result for a record whose `item` block carries `fields`. */
    const itemWith = (fields: Record<string, unknown>) => {
      serveByHost({
        'www.loc.gov': {
          item: { title: 'Imprinted', url: 'https://www.loc.gov/item/imprinted/', ...fields },
          resources: [],
          related_items: [],
        },
      });
      return getLocApiService().getItem('imprinted', createMockContext());
    };

    it('reads the captured imprint of 00003348 from the item block, with no extra request', async () => {
      const fetchSpy = serveByHost({ 'www.loc.gov': BOOK_ITEM_00003348 });

      const result = await getLocApiService().getItem('00003348', createMockContext());

      expect(result.imprint).toBe('New York : Werner School Book Company, c1900.');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(new URL(String(fetchSpy.mock.calls[0]![0])).searchParams.get('at')).toBe(
        'item,resources,related_items',
      );
    });

    it.each([
      [
        'a two-entry array, space-joined',
        ['Millwood, NY : ZOHO Music, [2017]', '℗2017'],
        'Millwood, NY : ZOHO Music, [2017] ℗2017',
      ],
      ['a string', '1946.', '1946.'],
      [
        'cataloging brackets, verbatim',
        ['Roma : Carocci, 2013-<2021>'],
        'Roma : Carocci, 2013-<2021>',
      ],
      [
        'a character reference, decoded once',
        ['Lanham : Rowman &amp; Littlefield, [2023]'],
        'Lanham : Rowman & Littlefield, [2023]',
      ],
      [
        'a bare ampersand, unchanged',
        ['Philadelphia : J.B. Lippincott & co., 1867.'],
        'Philadelphia : J.B. Lippincott & co., 1867.',
      ],
      ['an escaped reference, decoded only once', ['A &amp;amp; B'], 'A &amp; B'],
    ])('returns %s', async (_name, createdPublished, imprint) => {
      const result = await itemWith({ created_published: createdPublished });
      expect(result.imprint).toBe(imprint);
    });

    it.each([
      ['absent', {}],
      ['an empty array', { created_published: [] }],
    ])('omits imprint when created_published is %s', async (_name, fields) => {
      const result = await itemWith(fields);
      expect(result).toMatchObject({ item_id: 'imprinted', title: 'Imprinted' });
      expect(result).not.toHaveProperty('imprint');
    });
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

  it('resolves a root-relative related_items link against www.loc.gov, keeping titles and absolute links as sent (#87)', async () => {
    serveByHost({ 'www.loc.gov': AUDIO_ITEM_LOMAXBIB000571 });
    const lomax = await getLocApiService().getItem('lomaxbib000571', createMockContext());
    expect(lomax.related_items).toEqual([
      'http://www.loc.gov/item/lomaxbib000831/',
      'https://www.loc.gov/item/lomaxbib000840',
    ]);

    serveByHost({ 'www.loc.gov': SLEEVE_ITEM_LOMAXBIB000840 });
    const sleeve = await getLocApiService().getItem('lomaxbib000840', createMockContext());
    expect(sleeve.related_items).toEqual([
      'https://www.loc.gov/item/lomaxbib000571',
      'https://www.loc.gov/item/lomaxbib000572',
      'https://www.loc.gov/item/lomaxbib000573',
      'https://www.loc.gov/item/lomaxbib000574',
    ]);

    serveByHost({
      'www.loc.gov': {
        item: {
          title: 'Mixed',
          url: 'https://www.loc.gov/item/mixed/',
          related_items: [
            '/item/string-entry',
            { title: '/A title that starts with a slash' },
            { title: 'Linked', url: '//lccn.loc.gov/2014659017' },
            { title: 'Absolute', url: 'https://www.loc.gov/item/absolute/' },
          ],
        },
        resources: [],
        related_items: [],
      },
    });
    const mixed = await getLocApiService().getItem('mixed', createMockContext());
    expect(mixed.related_items).toEqual([
      'https://www.loc.gov/item/string-entry',
      '/A title that starts with a slash',
      'https://lccn.loc.gov/2014659017',
      'https://www.loc.gov/item/absolute/',
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

  describe('contributor_terms (#92)', () => {
    it('reads the keys of the captured item.contributors in LOC order, leaving contributors as cataloged', async () => {
      vi.stubGlobal('fetch', mockFetch(JSON.stringify(FILM_ITEM_00694298)));

      const result = await getLocApiService().getItem('00694298', createMockContext());

      expect(result.contributor_terms).toEqual([
        'dickson, w. k.-l. (william kennedy-laurie)',
        'heise, william',
        'hendricks (gordon) collection (library of congress)',
        'sandow, eugen',
        'thomas a. edison, inc',
      ]);
      expect(result.contributors).toEqual([
        'Dickson, W. K.-L. (William Kennedy-Laurie), 1860-1935, production',
        'Sandow, Eugen, 1867-1925, performer',
        'Heise, William, camera',
        'Thomas A. Edison, Inc',
        'Hendricks (Gordon) Collection (Library of Congress)',
      ]);
    });

    it('returns none when item.contributors is absent, whatever contributor_names holds', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch(
          JSON.stringify({
            item: {
              title: 'Names only',
              url: 'https://www.loc.gov/item/z/',
              contributor_names: ['Rothstein, Arthur, 1915-1985, photographer'],
            },
          }),
        ),
      );

      const result = await getLocApiService().getItem('z', createMockContext());

      expect(result.contributor_terms).toEqual([]);
      expect(result.contributors).toEqual(['Rothstein, Arthur, 1915-1985, photographer']);
    });

    it('reads a lone item.contributors object as it reads one entry of the array', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch(
          JSON.stringify({
            item: {
              title: 'Lone object',
              url: 'https://www.loc.gov/item/w/',
              contributors: {
                'rothstein, arthur':
                  'https://www.loc.gov/search/?fa=contributor:rothstein,+arthur&fo=json',
              },
            },
          }),
        ),
      );

      const result = await getLocApiService().getItem('w', createMockContext());

      expect(result.contributor_terms).toEqual(['rothstein, arthur']);
    });

    it('skips item.contributors entries that are not keyed objects and still returns the record', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch(
          JSON.stringify({
            item: {
              title: 'Mixed entries',
              url: 'https://www.loc.gov/item/v/',
              contributor_names: ['Lange, Dorothea.'],
              contributors: [
                null,
                'lee, russell',
                ['mydans, carl'],
                7,
                { 'lange, dorothea': 'https://www.loc.gov/search/?fa=contributor:lange,+dorothea' },
              ],
            },
          }),
        ),
      );

      const result = await getLocApiService().getItem('v', createMockContext());

      expect(result.contributor_terms).toEqual(['lange, dorothea']);
      expect(result.contributors).toEqual(['Lange, Dorothea.']);
    });
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
      { page_count: 0 },
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

  it('keeps a 414 an upstream_unavailable failure: only a search reads it as an over-long query', async () => {
    const fetchSpy = mockFetch('<title>414 Request-URI Too Long</title>', 414);
    vi.stubGlobal('fetch', fetchSpy);
    const err = await getLocApiService()
      .getItem('2009632251', createMockContext())
      .catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'LOC API returned HTTP 414',
    });
    expect((err as { data?: unknown }).data).toEqual({
      status: 414,
      reason: 'upstream_unavailable',
    });
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

  describe('resources without a url (#87)', () => {
    const lomaxRestricted = AUDIO_ITEM_LOMAXBIB000571.resources[0]!;
    const lomaxOpen = AUDIO_ITEM_LOMAXBIB000571.resources[1]!;
    const sideA = AUDIO_ITEM_2020729028.resources[0]!;
    const sideB = AUDIO_ITEM_2020729028.resources[1]!;

    it('lists every url-less recording with its audio and download_restricted, and no pages', async () => {
      serve(AUDIO_ITEM_LOMAXBIB000571);

      const result = await getLocApiService().getItem('lomaxbib000571', createMockContext());

      expect(result.resources).toEqual([
        {
          page_count: 0,
          audio:
            'https://tile.loc.gov/storage-services/media/ingested/api/loc.afc.afcss39.2718a2.mp3',
          download_restricted: true,
        },
        {
          page_count: 0,
          audio: 'https://tile.loc.gov/storage-services/media/afc/lomax/afc1939001_02718a2.mp3',
          download_restricted: false,
        },
      ]);
      expect(result.pages).toEqual([]);
      expect(result.page_total).toBe(0);
      expect(result).not.toHaveProperty('next_page_offset');
    });

    it('lists tape side B beside side A, paging side A alone', async () => {
      serve(AUDIO_ITEM_2020729028);

      const result = await getLocApiService().getItem('2020729028', createMockContext());

      expect(result.resources).toEqual([
        {
          url: 'https://www.loc.gov/resource/2020729028/',
          page_count: 1,
          audio: 'https://tile.loc.gov/storage-services/service/rbc/stmarks/014B106A/014B106A.mp3',
          download_restricted: true,
        },
        {
          page_count: 0,
          audio: 'https://tile.loc.gov/storage-services/service/rbc/stmarks/014B106B/014B106B.mp3',
          download_restricted: true,
        },
      ]);
      expect(result.pages).toEqual([
        { page_url: 'https://www.loc.gov/resource/2020729028/', has_text: false },
      ]);
      expect(result.page_total).toBe(1);
    });

    it('lists a url-less video, its root-relative image resolved against www.loc.gov', async () => {
      serve(VIDEO_ITEM_NCR002372);

      const result = await getLocApiService().getItem('ncr002372', createMockContext());

      expect(result.resources).toEqual([
        {
          page_count: 0,
          image: 'https://www.loc.gov/static/images/original-format/film-video.svg',
          video: 'https://tile.loc.gov/storage-services/media/ammem/Buckaroos/001.mp4',
        },
      ]);
      expect(result.page_total).toBe(0);
    });

    it("lists a film's video and download_restricted: false, its protocol-relative image on https", async () => {
      serve(FILM_ITEM_00694298);

      const result = await getLocApiService().getItem('00694298', createMockContext());

      expect(result.resources).toEqual([
        {
          url: 'https://www.loc.gov/resource/ntscrm.00179292/',
          page_count: 1,
          image: 'https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00179292/00179292.gif',
          video: 'https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00179292/00179292.mp4',
          download_restricted: false,
        },
      ]);
    });

    it.each([
      ['protocol-relative', '//tile.loc.gov/x/a.mp3', 'https://tile.loc.gov/x/a.mp3'],
      ['root-relative', '/static/a.mp3', 'https://www.loc.gov/static/a.mp3'],
      [
        'absolute, kept as sent',
        'http://tile.loc.gov/x/a%20b.mp3',
        'http://tile.loc.gov/x/a%20b.mp3',
      ],
    ])('resolves a %s media URL in every media field', async (_name, sent, returned) => {
      serve({
        item: { title: 'Media', url: 'https://www.loc.gov/item/media/' },
        resources: [{ image: sent, pdf: sent, audio: sent, video: sent }],
        related_items: [],
      });

      const result = await getLocApiService().getItem('media', createMockContext());

      expect(result.resources).toEqual([
        { page_count: 0, image: returned, pdf: returned, audio: returned, video: returned },
      ]);
    });

    it('runs the page window across url-less resources without a gap', async () => {
      // A four-page manuscript, a url-less recording, a one-page tape side, a url-less recording.
      serve({
        ...MANUSCRIPT_ITEM_MAL4356500,
        resources: [MANUSCRIPT_ITEM_MAL4356500.resources[0], lomaxRestricted, sideA, lomaxOpen],
      });
      const svc = getLocApiService();
      const urls = (pages: Array<{ page_url: string }>) => pages.map((p) => p.page_url);
      const manuscriptPage = (n: number) => `https://www.loc.gov/resource/mal.4356500/?sp=${n}`;

      const all = await svc.getItem('mal4356500', createMockContext(), window(0, 50));
      expect(all.resources.map((r) => r.page_count)).toEqual([4, 0, 1, 0]);
      expect(all.page_total).toBe(5);
      expect(urls(all.pages)).toEqual([
        manuscriptPage(1),
        manuscriptPage(2),
        manuscriptPage(3),
        manuscriptPage(4),
        sideA.url,
      ]);

      const before = await svc.getItem('mal4356500', createMockContext(), window(2, 2));
      expect(urls(before.pages)).toEqual([manuscriptPage(3), manuscriptPage(4)]);
      expect(before.next_page_offset).toBe(4);

      const across = await svc.getItem('mal4356500', createMockContext(), window(3, 2));
      expect(urls(across.pages)).toEqual([manuscriptPage(4), sideA.url]);
      expect(across).not.toHaveProperty('next_page_offset');

      const after = await svc.getItem('mal4356500', createMockContext(), window(4, 2));
      expect(urls(after.pages)).toEqual([sideA.url]);
      expect(after).not.toHaveProperty('next_page_offset');

      const past = await svc.getItem('mal4356500', createMockContext(), window(5, 2));
      expect(past.pages).toEqual([]);
      expect(past.page_total).toBe(5);
    });

    it("keeps a url-less resource's file group out of the page list even with files requested", async () => {
      serve({ ...AUDIO_ITEM_2020729028, resources: [sideB] });

      const result = await getLocApiService().getItem(
        '2020729028',
        createMockContext(),
        window(0, 50, true),
      );

      expect(result.resources).toEqual([
        { page_count: 0, audio: sideB.audio, download_restricted: true },
      ]);
      expect(result.pages).toEqual([]);
      expect(result.page_total).toBe(0);
      expect(JSON.stringify(result)).not.toContain(sideB.media_object_id);
    });
  });

  describe('has_transcription (#90)', () => {
    const manuscript = MANUSCRIPT_ITEM_MAL4356500.resources[0]!;
    /** The first resource getItem returns for mal4356500 with its fulltext_file set to `file`. */
    const resourceWith = async (file: string | undefined) => {
      serve({
        ...MANUSCRIPT_ITEM_MAL4356500,
        resources: [{ ...manuscript, fulltext_file: file }],
      });
      return (await getLocApiService().getItem('mal4356500', createMockContext())).resources[0]!;
    };

    it('flags the resource whose fulltext_file is a TEI transcription; its pages keep has_text false', async () => {
      serve(MANUSCRIPT_ITEM_MAL4356500);

      const result = await getLocApiService().getItem('mal4356500', createMockContext());

      expect(result.resources).toEqual([
        {
          url: 'https://www.loc.gov/resource/mal.4356500/',
          page_count: 4,
          image: manuscript.image,
          pdf: manuscript.pdf,
          has_transcription: true,
        },
      ]);
      expect(result.pages.map((p) => p.has_text)).toEqual([false, false, false, false]);
    });

    it('flags a protocol-relative tile.loc.gov .xml file, read on https like every LOC link', async () => {
      expect(await resourceWith(manuscript.fulltext_file.replace('https:', ''))).toMatchObject({
        has_transcription: true,
      });
    });

    it.each([
      ['a book volume .txt file', BOOK_ITEM_02007458.resources[0]!.fulltext_file],
      ['a crowd transcription .txt file', MANUSCRIPT_ITEM_MM77093930.resources[0]!.fulltext_file],
      ['a newspaper ALTO word-coordinates URL', NEWSPAPER_PAGE_1.resource.fulltext_file],
      [
        'a URL whose query, not its path, ends .xml',
        'https://tile.loc.gov/text-services/word-coordinates-service?segment=/service/ndnp/dlc/batch_dlc_keady_ver01/data/sn83030214/00206531526/1912041601/0303.xml',
      ],
      [
        'a URL whose fragment, not its path, ends .xml',
        'https://tile.loc.gov/storage-services/service/mss/mal/435/4356500/4356500.txt#4356500.xml',
      ],
      ['an .xml file on another host', 'https://example.org/mss/mal/435/4356500/4356500.xml'],
      ['an .xml file over http', 'http://tile.loc.gov/storage-services/service/mss/4356500.xml'],
      // The page read refuses these two, so a listing that flagged them would promise text it never returns.
      [
        'an .xml file on a port',
        'https://tile.loc.gov:8443/storage-services/service/mss/4356500.xml',
      ],
      [
        'an .xml file with credentials',
        'https://user:secret@tile.loc.gov/storage-services/service/mss/4356500.xml',
      ],
      [
        'an .xml file with a username alone',
        'https://reader@tile.loc.gov/storage-services/service/mss/4356500.xml',
      ],
      ['an .xml file with a password alone', 'https://:secret@tile.loc.gov/4356500.xml'],
      ['a bare file name', '4356500.xml'],
      ['no fulltext_file', undefined],
    ])('leaves has_transcription absent for %s', async (_name, file) => {
      const resource = await resourceWith(file);

      expect(resource).toMatchObject({ page_count: 4, url: manuscript.url });
      expect(resource).not.toHaveProperty('has_transcription');
    });
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

  it('drops a "|" at the end of a state before reading it as a postal code', async () => {
    const fetchSpy = mockFetch(JSON.stringify({ results: [], pagination: { of: 0, total: 1 } }));
    vi.stubGlobal('fetch', fetchSpy);
    await getLocApiService().searchNewspapers(
      { query: 'titanic', state: 'NY|' },
      createMockContext(),
    );

    expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('fa')).toBe(
      'location_state:new york',
    );
  });

  describe('language filter and facets (#91)', () => {
    /** One facet's values from a captured body, as the service should return them. */
    const capturedFacet = (body: string, type: string) =>
      (
        JSON.parse(body) as {
          facets: { type: string; filters: { value: string; count: number }[] }[];
        }
      ).facets
        .find((facet) => facet.type === type)!
        .filters.map(({ value, count }) => ({ value, count }));

    it('sends language after state and title in the one fa value', async () => {
      const fetchSpy = mockFetch(LUSITANIA_1915_GERMAN);
      vi.stubGlobal('fetch', fetchSpy);
      await getLocApiService().searchNewspapers(
        {
          query: 'lusitania',
          dates: '1915-05-07/1915-05-09',
          state: 'OH',
          newspaperTitle: 'tägliches cincinnatier volksblatt (cincinnati [ohio]) 1885-1919',
          language: 'german',
        },
        createMockContext(),
      );

      const params = new URL(fetchSpy.mock.calls[0]![0] as string).searchParams;
      expect(params.get('fa')).toBe(
        'location_state:ohio|partof_title:tägliches cincinnatier volksblatt (cincinnati [ohio]) 1885-1919|language:german',
      );
      expect(params.get('at')).toBe('results,pagination');
    });

    it('with includeFacets, requests the facet block and returns the title, state, and language facets in LOC order', async () => {
      const fetchSpy = mockFetch(LUSITANIA_1915_FACETS);
      vi.stubGlobal('fetch', fetchSpy);
      const result = await getLocApiService().searchNewspapers(
        { query: 'lusitania', dates: '1915-05-07/1915-05-09', includeFacets: true },
        createMockContext(),
      );

      expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('at')).toBe(
        'results,pagination,facets',
      );
      expect(result.facets).toEqual({
        newspaper_title: capturedFacet(LUSITANIA_1915_FACETS, 'partof_title'),
        state: capturedFacet(LUSITANIA_1915_FACETS, 'location_state'),
        language: capturedFacet(LUSITANIA_1915_FACETS, 'language'),
      });
      expect(result.facets?.newspaper_title).toHaveLength(10);
      expect(result.facets?.newspaper_title[1]).toEqual({
        value: 'evening star (washington, d.c.) 1854-1972',
        count: 23,
      });
      expect(result.facets?.state[1]).toEqual({ value: 'district of columbia', count: 47 });
      // subject_ethnicity also lists "german" (5); the language facet's own count is 52.
      expect(result.facets?.language).toContainEqual({ value: 'german', count: 52 });
      expect(result.facets?.language).toHaveLength(6);
    });

    it('without includeFacets, returns no facets even when the body carries a facet block', async () => {
      vi.stubGlobal('fetch', mockFetch(LUSITANIA_1915_FACETS));
      const result = await getLocApiService().searchNewspapers(
        { query: 'lusitania' },
        createMockContext(),
      );
      expect(result).not.toHaveProperty('facets');
      expect(result.items).toHaveLength(2);
    });

    it('returns each facet empty when LOC lists none of them', async () => {
      vi.stubGlobal('fetch', mockFetch(LUSITANIA_1915_KLINGON_EMPTY));
      const result = await getLocApiService().searchNewspapers(
        { query: 'lusitania', language: 'klingon', includeFacets: true },
        createMockContext(),
      );
      expect(result.items).toEqual([]);
      expect(result.facets).toEqual({ newspaper_title: [], state: [], language: [] });
    });

    it("carries each row's language array as languages, absent when LOC sends none", async () => {
      const captured = (JSON.parse(LUSITANIA_1915_GERMAN) as { results: object[] }).results;
      const [first] = captured as Array<Record<string, unknown>>;
      const { language: _dropped, ...sparse } = first!;
      vi.stubGlobal(
        'fetch',
        mockFetch(
          JSON.stringify({
            results: [...captured, sparse, { ...sparse, language: [] }],
            pagination: { of: 4, perpage: 25 },
          }),
        ),
      );
      const result = await getLocApiService().searchNewspapers(
        { query: 'lusitania' },
        createMockContext(),
      );

      expect(result.items[0]!.languages).toEqual(['german']);
      expect(result.items[1]!.languages).toEqual(['english', 'german']);
      expect(result.items[2]).not.toHaveProperty('languages');
      expect(result.items[3]).not.toHaveProperty('languages');
    });
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
      item_id: 'sn87065702/1927-06-16/ed-1',
      item_title: 'Southern Christian advocate (Charleston, S.C.), June 16, 1927',
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
      item_id: 'sn82014248/1912-04-18/ed-1',
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

  describe('image-only pages (#75)', () => {
    const IMAGE_ONLY_PAGE_URL = 'https://www.loc.gov/resource/magbell.02800101/?sp=2';
    const { fulltext_service: _captured, ...imageOnlyPage } = MANUSCRIPT_IMAGE_ONLY_PAGE_2;

    it.each([
      { name: 'an empty object, as LOC sends it', service: _captured },
      { name: 'an empty string', service: '' },
      { name: 'a blank string', service: '  ' },
      { name: 'null', service: null },
      { name: 'absent', service: undefined },
    ])(
      'reads a fulltext_service of $name as no text, with no text request',
      async ({ service }) => {
        const fetchSpy = serveByHost({
          'www.loc.gov': {
            ...imageOnlyPage,
            ...(service !== undefined && { fulltext_service: service }),
          },
        });

        const result = await getLocApiService().getNewspaperPage(
          IMAGE_ONLY_PAGE_URL,
          createMockContext(),
        );

        expect(result).toEqual({
          page_url: IMAGE_ONLY_PAGE_URL,
          item_id: 'magbell.02800101',
          item_title: 'Card by Mabel Hubbard Bell, June 1913',
          sequence: 2,
          segment_count: 3,
          ocr_text: '',
          ocr_available: false,
        });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('text source of the page (#90)', () => {
    const MANUSCRIPT_PAGE_URL = 'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3';
    const NEWSPAPER_PAGE_URL = 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1';
    const PROJECTION = '&fo=json&at=item,resource,fulltext_service';
    const MANUSCRIPT_PAGE_3_FULL_TEXT = (
      Object.values(JSON.parse(MANUSCRIPT_PAGE_3_TEXT))[0] as { full_text: string }
    ).full_text;
    /** Every URL the stub was asked for, in order. */
    const requested = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.map(([url]) => String(url));

    it('reads a page with a fulltext_service string from that service alone, as before', async () => {
      const spy = serveByHost({
        'www.loc.gov': MANUSCRIPT_PAGE_3,
        'tile.loc.gov': JSON.parse(MANUSCRIPT_PAGE_3_TEXT),
      });

      const result = await getLocApiService().getNewspaperPage(
        MANUSCRIPT_PAGE_URL,
        createMockContext(),
      );

      expect(result).toMatchObject({
        page_url: MANUSCRIPT_PAGE_URL,
        item_id: 'mm77093930',
        item_title: 'Betty Herndon Maury Maury diary,',
        sequence: 3,
        segment_count: 122,
        ocr_text: MANUSCRIPT_PAGE_3_FULL_TEXT,
        ocr_available: true,
      });
      expect(result).not.toHaveProperty('ocrMiss');
      expect(result).not.toHaveProperty('text_attribution');
      expect(requested(spy)).toEqual([
        `${MANUSCRIPT_PAGE_URL}${PROJECTION}`,
        'https://tile.loc.gov/text-services/word-coordinates-service?segment=%2Fservice%2Fgdc%2Fgdccrowd%2Fmss%2Fmss93930%2Fmss93930-001%2F0000%2F0003.txt&format=plain_text&full_text=1',
      ]);
    });

    it.each([
      {
        name: "a volume's .txt fulltext_file",
        page: MANUSCRIPT_PAGE_3,
        pageUrl: MANUSCRIPT_PAGE_URL,
        expected: {
          item_id: 'mm77093930',
          item_title: 'Betty Herndon Maury Maury diary,',
          sequence: 3,
          segment_count: 122,
        },
      },
      {
        name: 'an ALTO fulltext_file, whose path ends in the service name, not .xml',
        page: NEWSPAPER_PAGE_1,
        pageUrl: NEWSPAPER_PAGE_URL,
        expected: {
          item_id: 'sn83030214/1912-04-16/ed-1',
          item_title: 'New-York tribune (New York [N.Y.]), April 16, 1912',
          newspaper_title: 'New-York tribune',
          date: '1912-04-16',
          states: ['new york'],
          place_of_publication: 'New York [N.Y.]',
          edition: '1',
          sequence: 1,
          segment_count: 14,
        },
      },
    ])(
      'reads a page with no fulltext_service and $name as having no text, with no text request, as before',
      async ({ page, pageUrl, expected }) => {
        const { fulltext_service: _omit, ...withoutService } = page;
        const spy = serveByHost({ 'www.loc.gov': withoutService });

        const result = await getLocApiService().getNewspaperPage(pageUrl, createMockContext());

        expect(result).toEqual({
          page_url: pageUrl,
          ...expected,
          ocr_text: '',
          ocr_available: false,
        });
        expect(requested(spy)).toEqual([`${pageUrl}${PROJECTION}`]);
      },
    );

    it('reads a newspaper page from its per-page service alone, as before', async () => {
      const spy = serveByHost({
        'www.loc.gov': NEWSPAPER_PAGE_1,
        'tile.loc.gov': { '/0303.xml': { full_text: 'Text.' } },
      });

      const result = await getLocApiService().getNewspaperPage(
        NEWSPAPER_PAGE_URL,
        createMockContext(),
      );

      expect(result).toMatchObject({ ocr_text: 'Text.', ocr_available: true, sequence: 1 });
      expect(result).not.toHaveProperty('text_attribution');
      expect(requested(spy)).toEqual([
        `${NEWSPAPER_PAGE_URL}${PROJECTION}`,
        'https://tile.loc.gov/text-services/word-coordinates-service?segment=%2Fservice%2Fndnp%2Fdlc%2Fbatch_dlc_keady_ver01%2Fdata%2Fsn83030214%2F00206531526%2F1912041601%2F0303.xml&format=alto_xml&full_text=1',
      ]);
    });

    it.each([
      { name: 'a manuscript page', page: MANUSCRIPT_PAGE_3, pageUrl: MANUSCRIPT_PAGE_URL },
      { name: 'a newspaper page', page: NEWSPAPER_PAGE_1, pageUrl: NEWSPAPER_PAGE_URL },
    ])("scopes the text of $name's own text service to the page", async ({ page, pageUrl }) => {
      serveByHost({ 'www.loc.gov': page, 'tile.loc.gov': { '/x.xml': { full_text: 'Text.' } } });
      const result = await getLocApiService().getNewspaperPage(pageUrl, createMockContext());
      expect(result).toMatchObject({ ocr_text: 'Text.', text_scope: 'page' });
    });

    it('scopes no text on a page with neither a text service nor a transcription', async () => {
      serveByHost({ 'www.loc.gov': MANUSCRIPT_IMAGE_ONLY_PAGE_2 });
      const result = await getLocApiService().getNewspaperPage(
        'https://www.loc.gov/resource/magbell.02800101/?sp=2',
        createMockContext(),
      );
      expect(result).toMatchObject({ ocr_available: false, ocr_text: '' });
      expect(result).not.toHaveProperty('text_scope');
    });

    describe('a document transcription in resource.fulltext_file', () => {
      const GETTYSBURG_PAGE_URL = 'https://www.loc.gov/resource/mal.4356500/?sp=1';
      const GETTYSBURG_FILE =
        'https://tile.loc.gov/storage-services/service/mss/mal/435/4356500/4356500.xml';
      const KNOX_COLLEGE =
        'Transcribed and annotated by the Lincoln Studies Center, Knox College. Galesburg, Illinois.';
      const fileResponse = (body: string, status = 200, contentType = 'text/xml') =>
        new Response(body, { status, headers: { 'Content-Type': contentType } });
      /**
       * Serves `page` from www.loc.gov and answers every tile.loc.gov request with `tile`. Returns
       * the stub; its calls list each requested URL.
       */
      function serveTranscription(
        page: unknown,
        tile: (init?: RequestInit) => Promise<Response> | Response = () =>
          fileResponse(GETTYSBURG_NICOLAY_TEI),
      ) {
        const spy = vi.fn(async (url: string | URL, init?: RequestInit) => {
          const { hostname } = new URL(String(url));
          if (hostname === 'www.loc.gov') {
            return new Response(JSON.stringify(page), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (hostname === 'tile.loc.gov') return tile(init);
          throw new Error(`unmocked fetch: ${hostname}`);
        });
        vi.stubGlobal('fetch', spy);
        return spy;
      }
      /** `page` with its `resource.fulltext_file` set to `file`. */
      const withFile = (page: typeof GETTYSBURG_NICOLAY_PAGE_1, file: unknown) => ({
        ...page,
        resource: { ...page.resource, fulltext_file: file },
      });

      it('reads the same address text, without notes or footnote numerals, on pages 1 and 3 of the Gettysburg Address', async () => {
        const spy = serveTranscription(GETTYSBURG_NICOLAY_PAGE_1);
        const svc = getLocApiService();

        const page1 = await svc.getNewspaperPage(GETTYSBURG_PAGE_URL, createMockContext());
        const page3 = await svc.getNewspaperPage(
          'https://www.loc.gov/resource/mal.4356500/?sp=3',
          createMockContext(),
        );

        expect(page1).toMatchObject({
          page_url: GETTYSBURG_PAGE_URL,
          item_id: 'mal4356500',
          sequence: 1,
          segment_count: 4,
          ocr_available: true,
          text_scope: 'document',
          text_attribution: KNOX_COLLEGE,
        });
        expect(page1).not.toHaveProperty('ocrMiss');
        expect(page3).toMatchObject({ sequence: 3, text_scope: 'document' });
        expect(page3.ocr_text).toBe(page1.ocr_text);
        const text = page1.ocr_text;
        expect(text).toMatch(
          /^Abraham Lincoln, Draft of Gettysburg Address, Nicolay Copy, \[November 1863\]\n\n\[Page one\]\n\nExecutive Mansion,\n\n/,
        );
        expect(text).toContain(
          'Four score and seven years ago our fathers brought forth, upon this continent, a new nation',
        );
        expect(text).toContain('It is rather for us, the living, we here be dedica-\n\n[Page 2]');
        expect(text).toMatch(/shall not perish from the earth\.$/);
        for (const absent of [
          'President Lincoln was invited',
          'This partial sentence',
          'to stand here',
          'Copy1',
          'dedica-2',
        ]) {
          expect(text).not.toContain(absent);
        }
        expect(requested(spy)).toEqual([
          `${GETTYSBURG_PAGE_URL}${PROJECTION}`,
          GETTYSBURG_FILE,
          `https://www.loc.gov/resource/mal.4356500/?sp=3${PROJECTION}`,
          GETTYSBURG_FILE,
        ]);
      });

      it('keeps the Bell card’s handwritten note, with no attribution when LOC names no one', async () => {
        const spy = serveTranscription(BELL_CARD_PAGE_2, () => fileResponse(BELL_CARD_TEI));

        const result = await getLocApiService().getNewspaperPage(
          'https://www.loc.gov/resource/magbell.02800101/?sp=2',
          createMockContext(),
        );

        expect(result).toMatchObject({
          item_id: 'magbell.02800101',
          ocr_available: true,
          text_scope: 'document',
        });
        expect(result.ocr_text).toMatch(/^1875\n1st\n\n“These letters to Mrs\. A\. Melville Bell/);
        expect(result.ocr_text).toContain('MABEL G. BELL\nJune 1913');
        expect(result).not.toHaveProperty('text_attribution');
        expect(requested(spy)[1]).toBe(BELL_CARD_PAGE_2.resource.fulltext_file);
      });

      it('decodes the character references in fulltext_attribution once', async () => {
        serveTranscription({
          ...GETTYSBURG_NICOLAY_PAGE_1,
          resource: {
            ...GETTYSBURG_NICOLAY_PAGE_1.resource,
            fulltext_attribution: 'Smith &amp; Co. &amp;amp; sons&#8217; center',
          },
        });
        const result = await getLocApiService().getNewspaperPage(
          GETTYSBURG_PAGE_URL,
          createMockContext(),
        );
        expect(result.text_attribution).toBe('Smith & Co. &amp; sons’ center');
      });

      it.each([
        ['http, not https', 'http://tile.loc.gov/storage-services/service/mss/mal/x.xml'],
        ['another host', 'https://example.com/storage-services/service/mss/mal/x.xml'],
        ['a host that only starts with tile.loc.gov', 'https://tile.loc.gov.example.com/x.xml'],
        ['a port', 'https://tile.loc.gov:8443/storage-services/service/mss/mal/x.xml'],
        ['a username', 'https://reader@tile.loc.gov/storage-services/service/mss/mal/x.xml'],
        [
          'a username and password',
          'https://reader:secret@tile.loc.gov/storage-services/service/mss/mal/x.xml',
        ],
        ['an empty username and a password', 'https://:secret@tile.loc.gov/x.xml'],
        ['a root-relative path', '/storage-services/service/mss/mal/x.xml'],
        ['a .txt path', 'https://tile.loc.gov/storage-services/service/mss/mal/x.txt'],
        ['an ALTO text-service URL', NEWSPAPER_PAGE_1.resource.fulltext_file],
        [
          'a query, not a path, ending .xml',
          'https://tile.loc.gov/text-services/word-coordinates-service?segment=/service/mss/mal/x.xml',
        ],
        [
          'a fragment, not a path, ending .xml',
          'https://tile.loc.gov/storage-services/service/mss/mal/x.txt#x.xml',
        ],
        ['not a URL', 'storage-services/service/mss/mal/x.xml'],
        ['not a string', { url: GETTYSBURG_FILE }],
      ])(
        'never fetches a fulltext_file on %s: the page has no text',
        async (_name, fulltextFile) => {
          const spy = serveTranscription(withFile(GETTYSBURG_NICOLAY_PAGE_1, fulltextFile));

          const result = await getLocApiService().getNewspaperPage(
            GETTYSBURG_PAGE_URL,
            createMockContext(),
          );

          expect(result).toMatchObject({ ocr_available: false, ocr_text: '' });
          expect(result).not.toHaveProperty('text_scope');
          expect(result).not.toHaveProperty('text_attribution');
          expect(requested(spy)).toEqual([`${GETTYSBURG_PAGE_URL}${PROJECTION}`]);
        },
      );

      it('reads a protocol-relative tile.loc.gov fulltext_file over https', async () => {
        const spy = serveTranscription(
          withFile(GETTYSBURG_NICOLAY_PAGE_1, GETTYSBURG_FILE.replace('https:', '')),
        );
        const result = await getLocApiService().getNewspaperPage(
          GETTYSBURG_PAGE_URL,
          createMockContext(),
        );
        expect(result).toMatchObject({ ocr_available: true, text_scope: 'document' });
        expect(result.ocr_text).toContain('Four score and seven years ago');
        expect(requested(spy)[1]).toBe(GETTYSBURG_FILE);
      });

      it('reads the page’s own text service, never the transcription, when the page has both', async () => {
        const spy = serveTranscription(
          { ...GETTYSBURG_NICOLAY_PAGE_1, fulltext_service: MANUSCRIPT_PAGE_3.fulltext_service },
          () => fileResponse(MANUSCRIPT_PAGE_3_TEXT, 200, 'application/json'),
        );

        const result = await getLocApiService().getNewspaperPage(
          GETTYSBURG_PAGE_URL,
          createMockContext(),
        );

        expect(result).toMatchObject({ ocr_text: MANUSCRIPT_PAGE_3_FULL_TEXT, text_scope: 'page' });
        expect(result).not.toHaveProperty('text_attribution');
        expect(requested(spy)).toHaveLength(2);
        expect(requested(spy)).not.toContain(GETTYSBURG_FILE);
      });

      /** The page fields every failed transcription read keeps. */
      const DEGRADED = {
        page_url: GETTYSBURG_PAGE_URL,
        item_id: 'mal4356500',
        sequence: 1,
        segment_count: 4,
        ocr_text: '',
        ocr_available: true,
        text_scope: 'document',
        text_attribution: KNOX_COLLEGE,
      };

      it.each([
        { name: 'a 404', response: () => fileResponse('<html>Not Found</html>', 404, 'text/html') },
        { name: 'a 403', response: () => fileResponse('Forbidden', 403, 'text/plain') },
        { name: 'a 429', response: () => fileResponse('', 429) },
        { name: 'a 500', response: () => fileResponse('', 500) },
        { name: 'a 503', response: () => fileResponse('Service Unavailable', 503, 'text/plain') },
        {
          name: 'an HTML page with a 200',
          response: () =>
            fileResponse(
              '<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>',
              200,
              'text/html',
            ),
        },
      ])(
        'returns the page with no text and a retryable miss on $name, without failing the call',
        async ({ response }) => {
          serveTranscription(GETTYSBURG_NICOLAY_PAGE_1, response);
          const result = await getLocApiService().getNewspaperPage(
            GETTYSBURG_PAGE_URL,
            createMockContext(),
          );
          expect(result).toEqual({
            ...DEGRADED,
            item_title: GETTYSBURG_NICOLAY_PAGE_1.item.title,
            ocrMiss: 'unavailable',
          });
        },
      );

      it.each([
        { name: 'an ALTO file', body: '<?xml version="1.0"?><alto><Layout/></alto>' },
        { name: "a text service's JSON", body: MANUSCRIPT_PAGE_3_TEXT },
        { name: 'plain text', body: 'Four score and seven years ago' },
        {
          name: 'a transcription cut off mid-body',
          body: GETTYSBURG_NICOLAY_TEI.slice(0, 3000),
        },
      ])(
        'returns the page with no text and an unparseable miss when the file is $name',
        async ({ body }) => {
          serveTranscription(GETTYSBURG_NICOLAY_PAGE_1, () => fileResponse(body));
          const result = await getLocApiService().getNewspaperPage(
            GETTYSBURG_PAGE_URL,
            createMockContext(),
          );
          expect(result).toEqual({
            ...DEGRADED,
            item_title: GETTYSBURG_NICOLAY_PAGE_1.item.title,
            ocrMiss: 'unparseable',
          });
        },
      );

      it('reads a transcription with an empty body as empty text with no miss', async () => {
        serveTranscription(GETTYSBURG_NICOLAY_PAGE_1, () =>
          fileResponse('<tei2><text><body><div><p> </p></div></body></text></tei2>'),
        );
        const result = await getLocApiService().getNewspaperPage(
          GETTYSBURG_PAGE_URL,
          createMockContext(),
        );
        expect(result).toMatchObject({ ocr_text: '', ocr_available: true, text_scope: 'document' });
        expect(result).not.toHaveProperty('ocrMiss');
      });

      describe('under the call budget', () => {
        beforeEach(async () => {
          vi.useFakeTimers();
          initLocApiService(config, await createInMemoryStorage());
        });

        afterEach(() => {
          vi.useRealTimers();
        });

        /** Rejects with the signal's reason once the request's signal aborts; never answers. */
        const hangUntilAborted = (init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
          });

        it('retries a network fault, then returns the page with a retryable miss once retries run out', async () => {
          const spy = serveTranscription(GETTYSBURG_NICOLAY_PAGE_1, () => {
            throw new TypeError('The socket connection was closed unexpectedly');
          });

          const pending = getLocApiService().getNewspaperPage(
            GETTYSBURG_PAGE_URL,
            createMockContext(),
          );
          await vi.advanceTimersByTimeAsync(50_100);

          expect(await pending).toMatchObject({ ...DEGRADED, ocrMiss: 'unavailable' });
          expect(requested(spy).filter((url) => url === GETTYSBURG_FILE).length).toBeGreaterThan(1);
        });

        it('gives the file read only what the page fetch left of the budget, then a retryable miss', async () => {
          const spy = vi.fn((url: string, init?: RequestInit) =>
            new URL(url).hostname === 'www.loc.gov'
              ? new Promise<Response>((resolve) => {
                  setTimeout(
                    () => resolve(new Response(JSON.stringify(GETTYSBURG_NICOLAY_PAGE_1))),
                    40_000,
                  );
                })
              : hangUntilAborted(init),
          );
          vi.stubGlobal('fetch', spy);

          let settled = false;
          const pending = getLocApiService()
            .getNewspaperPage(GETTYSBURG_PAGE_URL, createMockContext())
            .finally(() => {
              settled = true;
            });
          await vi.advanceTimersByTimeAsync(50_100);

          expect(settled).toBe(true);
          expect(await pending).toMatchObject({ ...DEGRADED, ocrMiss: 'unavailable' });
          expect(spy.mock.calls.map(([url]) => String(url))).toContain(GETTYSBURG_FILE);
        });

        it('rethrows a caller cancel during the file read rather than degrading', async () => {
          serveTranscription(GETTYSBURG_NICOLAY_PAGE_1, hangUntilAborted);
          const controller = new AbortController();

          const pending = getLocApiService()
            .getNewspaperPage(GETTYSBURG_PAGE_URL, createMockContext({ signal: controller.signal }))
            .then(
              () => undefined,
              (error: unknown) => error,
            );
          await vi.advanceTimersByTimeAsync(1_000);
          controller.abort(new DOMException('caller went away', 'AbortError'));
          await vi.advanceTimersByTimeAsync(0);

          expect(await pending).toMatchObject({ name: 'AbortError' });
        });
      });
    });
  });

  describe('item_id of the page (#72)', () => {
    const NEWSPAPER_PAGE_URL = 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1';
    const BOOK_PAGE_URL =
      'https://www.loc.gov/resource/gdcmassbookdig.storyofcaptainme00king/?sp=3';
    /** Serves `page` from www.loc.gov and a one-line text body from tile.loc.gov. */
    const servePage = (page: unknown) =>
      serveByHost({ 'www.loc.gov': page, 'tile.loc.gov': { '/x.xml': { full_text: 'Text.' } } });
    /** `page` with its item block's `url` replaced by `url`, or removed when `url` is undefined. */
    const withItemUrl = (page: { item: Record<string, unknown> }, url?: string) => {
      const { url: _omit, ...item } = page.item;
      return { ...page, item: { ...item, ...(url !== undefined && { url }) } };
    };

    it.each([
      {
        name: 'a newspaper page',
        page: NEWSPAPER_PAGE_1,
        pageUrl: NEWSPAPER_PAGE_URL,
        itemId: 'sn83030214/1912-04-16/ed-1',
      },
      {
        name: 'an ed-2 newspaper page',
        page: NEWSPAPER_ED2_PAGE_2,
        pageUrl: 'https://www.loc.gov/resource/sn93067777/1902-01-24/ed-2/?sp=2',
        itemId: 'sn93067777/1902-01-24/ed-2',
      },
      {
        name: 'a manuscript page',
        page: MANUSCRIPT_PAGE_3,
        pageUrl: 'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
        itemId: 'mm77093930',
      },
      { name: 'a book page', page: BOOK_BLANK_PAGE_3, pageUrl: BOOK_PAGE_URL, itemId: '00003348' },
    ])('reads item.url as the item ID for $name', async ({ page, pageUrl, itemId }) => {
      servePage(page);
      const result = await getLocApiService().getNewspaperPage(pageUrl, createMockContext());
      expect(result.item_id).toBe(itemId);
    });

    it.each([
      { name: 'without url', page: withItemUrl(NEWSPAPER_PAGE_1) },
      { name: 'with an empty url', page: withItemUrl(NEWSPAPER_PAGE_1, '') },
      { name: 'absent', page: { ...NEWSPAPER_PAGE_1, item: undefined } },
    ])(
      'falls back to the issue path of a newspaper page_url when the item block is $name',
      async ({ page }) => {
        servePage(page);
        const result = await getLocApiService().getNewspaperPage(
          NEWSPAPER_PAGE_URL,
          createMockContext(),
        );
        expect(result.item_id).toBe('sn83030214/1912-04-16/ed-1');
      },
    );

    it.each([
      ['//lccn.loc.gov/2005567251', '2005567251'],
      ['//lccn.loc.gov/2005-567251/', '2005567251'],
      ['//www.loc.gov/item/00003348/', '00003348'],
    ])(
      'resolves a protocol-relative item.url %j to https before reading item ID %j',
      async (url, itemId) => {
        servePage(withItemUrl(BOOK_BLANK_PAGE_3, url));
        const result = await getLocApiService().getNewspaperPage(
          BOOK_PAGE_URL,
          createMockContext(),
        );
        expect(result.item_id).toBe(itemId);
      },
    );

    it("falls back to an ed-2 page's own edition, never ed-1", async () => {
      servePage(withItemUrl(NEWSPAPER_ED2_PAGE_2));
      const result = await getLocApiService().getNewspaperPage(
        'https://www.loc.gov/resource/sn93067777/1902-01-24/ed-2/?sp=2',
        createMockContext(),
      );
      expect(result.item_id).toBe('sn93067777/1902-01-24/ed-2');
    });

    it('omits item_id for a book page whose item block carries no url', async () => {
      servePage(withItemUrl(BOOK_BLANK_PAGE_3));
      const result = await getLocApiService().getNewspaperPage(BOOK_PAGE_URL, createMockContext());
      expect(result).toMatchObject({ page_url: BOOK_PAGE_URL, sequence: 3 });
      expect(result).not.toHaveProperty('item_id');
    });

    it.each([
      'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/',
      'https://evil.example.com/item/sn83030214/',
      'https://www.loc.gov/item/../../etc/passwd/',
      'not a url',
    ])(
      'omits item_id when normalizeItemId rejects item.url %j, even on a newspaper page',
      async (url) => {
        servePage(withItemUrl(NEWSPAPER_PAGE_1, url));
        const result = await getLocApiService().getNewspaperPage(
          NEWSPAPER_PAGE_URL,
          createMockContext(),
        );
        expect(result).toMatchObject({ page_url: NEWSPAPER_PAGE_URL, ocr_text: 'Text.' });
        expect(result).not.toHaveProperty('item_id');
      },
    );
  });

  describe('item_title of the page (#74)', () => {
    /** Serves `page` from www.loc.gov and a one-line text body from tile.loc.gov. */
    const servePage = (page: unknown) =>
      serveByHost({ 'www.loc.gov': page, 'tile.loc.gov': { '/x.xml': { full_text: 'Text.' } } });

    it.each([
      {
        name: 'a book page',
        page: BOOK_BLANK_PAGE_3,
        pageUrl: 'https://www.loc.gov/resource/gdcmassbookdig.storyofcaptainme00king/?sp=3',
        itemTitle:
          'The story of Captain Meriwether Lewis and Captain William Clark : for young readers',
      },
      {
        name: 'a manuscript page',
        page: MANUSCRIPT_PAGE_3,
        pageUrl: 'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
        itemTitle: 'Betty Herndon Maury Maury diary,',
      },
    ])(
      'reads item.title as item_title for $name, which has no newspaper_title',
      async ({ page, pageUrl, itemTitle }) => {
        servePage(page);
        const result = await getLocApiService().getNewspaperPage(pageUrl, createMockContext());
        expect(result.item_title).toBe(itemTitle);
        expect(result).not.toHaveProperty('newspaper_title');
      },
    );

    it('reads item.title beside the unchanged newspaper_title on a newspaper page', async () => {
      servePage(NEWSPAPER_PAGE_1);
      const result = await getLocApiService().getNewspaperPage(
        'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1',
        createMockContext(),
      );
      expect(result).toMatchObject({
        item_title: 'New-York tribune (New York [N.Y.]), April 16, 1912',
        newspaper_title: 'New-York tribune',
      });
    });

    it('decodes character references in item.title once', async () => {
      servePage({
        ...MANUSCRIPT_PAGE_3,
        item: { ...MANUSCRIPT_PAGE_3.item, title: 'Smith &amp; Co. &amp;amp; sons&#8217; papers' },
      });
      const result = await getLocApiService().getNewspaperPage(
        'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
        createMockContext(),
      );
      expect(result.item_title).toBe('Smith & Co. &amp; sons’ papers');
    });

    it.each([
      { name: 'no title', item: { url: 'https://www.loc.gov/item/mm77093930/' } },
      { name: 'an empty title', item: { title: '', url: 'https://www.loc.gov/item/mm77093930/' } },
      { name: 'no item block', item: undefined },
    ])('omits item_title for an item block with $name', async ({ item }) => {
      servePage({ ...MANUSCRIPT_PAGE_3, item });
      const result = await getLocApiService().getNewspaperPage(
        'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
        createMockContext(),
      );
      expect(result).toMatchObject({ sequence: 3, ocr_text: 'Text.' });
      expect(result).not.toHaveProperty('item_title');
    });
  });

  describe("LOC's blank-page placeholder (#70)", () => {
    const BOOK_PAGE_URL =
      'https://www.loc.gov/resource/gdcmassbookdig.storyofcaptainme00king/?sp=3';
    /** Serves the blank book page with a text-service body whose `full_text` is `fullText`. */
    const serveText = (fullText: string) =>
      serveByHost({
        'www.loc.gov': BOOK_BLANK_PAGE_3,
        'tile.loc.gov': { '/x.alto.xml': { full_text: fullText } },
      });

    it('reads the captured placeholder body as empty text with no miss', async () => {
      serveByHost({
        'www.loc.gov': BOOK_BLANK_PAGE_3,
        'tile.loc.gov': JSON.parse(BOOK_BLANK_PAGE_3_TEXT),
      });
      const result = await getLocApiService().getNewspaperPage(BOOK_PAGE_URL, createMockContext());
      expect(result).toMatchObject({ ocr_text: '', ocr_available: true });
      expect(result).not.toHaveProperty('ocrMiss');
    });

    it.each([
      ' [NO TEXT AVAILABLE FOR THIS PAGE] ',
      '[NO TEXT AVAILABLE FOR THIS PAGE]\n',
      '\n\t[NO TEXT AVAILABLE FOR THIS PAGE]\r\n',
    ])('reads the placeholder with surrounding whitespace %j as empty text', async (fullText) => {
      serveText(fullText);
      const result = await getLocApiService().getNewspaperPage(BOOK_PAGE_URL, createMockContext());
      expect(result.ocr_text).toBe('');
      expect(result).not.toHaveProperty('ocrMiss');
    });

    it.each([
      '[NO TEXT AVAILABLE FOR THIS PAGE]\nCHAPTER I',
      'See [NO TEXT AVAILABLE FOR THIS PAGE]',
      '[no text available for this page]',
      '[No Text Available For This Page]',
      'NO TEXT AVAILABLE FOR THIS PAGE',
    ])('returns text that is not the placeholder alone, %j, as sent', async (fullText) => {
      serveText(fullText);
      const result = await getLocApiService().getNewspaperPage(BOOK_PAGE_URL, createMockContext());
      expect(result.ocr_text).toBe(fullText);
    });
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
  const noFacets = { facets: { subject: [], location: [], contributor: [] } };

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
      name: 'newspaper search with facets',
      path: '/newspapers/',
      call: (svc, ctx, page) =>
        svc.searchNewspapers({ query: 'zyzzyva', includeFacets: true, limit: 3, page }, ctx),
      extra: { facets: { newspaper_title: [], state: [], language: [] } },
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
      contributor: [],
    });
  });

  it('decodes row and item contributor_terms once (#92)', async () => {
    serveHosts({
      results: [
        {
          id: 'a',
          title: 'A',
          url: 'https://www.loc.gov/item/a/',
          contributor: ['harris &amp; ewing', 'p&amp;amp;p', 'carri&egrave;re, fred'],
        },
      ],
      pagination: { of: 1, perpage: 25, pages: 1 },
    });
    const { items } = await getLocApiService().search({ query: 'a' }, createMockContext());
    expect(items[0]!.contributor_terms).toEqual(['harris & ewing', 'p&amp;p', 'carrière, fred']);

    serveHosts({
      item: {
        title: 'Theatre',
        contributors: [
          { 'ch&acirc;telet, th&eacute;&acirc;tre': 'https://www.loc.gov/search/?fa=contributor' },
        ],
        url: 'https://www.loc.gov/item/theatre/',
      },
    });
    const item = await getLocApiService().getItem('theatre', createMockContext());
    expect(item.contributor_terms).toEqual(['châtelet, théâtre']);
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
