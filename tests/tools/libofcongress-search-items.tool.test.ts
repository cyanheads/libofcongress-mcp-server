/**
 * @fileoverview Tests for libofcongress_search_items tool.
 * @module tests/tools/libofcongress-search-items.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  getEnrichment,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locSearchItems } from '@/mcp-server/tools/definitions/libofcongress-search-items.tool.js';
import { type DateBound, resolveDateRange, yearBound } from '@/services/loc-api/date-range.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';
import { subjectFacetTerms } from '@/services/loc-api/subject-terms.js';
import { COBB_PHOTO_SEARCH } from '../fixtures/loc-items.js';
import { POSTERS_PHOTOS_SEARCH } from '../fixtures/loc-subjects.js';
import { JAZZ_ENTITY_ROWS } from '../fixtures/loc-text.js';
import { serveByHost } from '../helpers/loc-fetch.js';
import { contentText, contractRecovery, structured, wireError } from '../helpers/tool-result.js';

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

/** The `dates` value resolveDateRange gives for a range the test expects to be valid. */
function resolvedDates(start: DateBound | undefined, end: DateBound | undefined) {
  const range = resolveDateRange(start, end);
  if (!range.ok) throw new Error(range.message);
  return range.dates;
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

describe('locSearchItems upstream text (#65)', () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    initLocApiService(config, await createInMemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('decodes the captured descriptions on both surfaces', async () => {
    serveByHost({
      'www.loc.gov': { results: JAZZ_ENTITY_ROWS, pagination: { of: 3, perpage: 25, pages: 1 } },
    });
    const result = await runToolContract(locSearchItems, { query: 'jazz' });
    const items = structured(result).items as Array<{ description: string }>;
    expect(items[1]!.description).toContain('entitled “I Hate Jazz” and');
    expect(contentText(result)).toContain('entitled “I Hate Jazz” and');
    expect(contentText(result)).toContain('the birthday of Stèphane Grappelli');
    expect(JSON.stringify(result)).not.toMatch(/&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#[xX][0-9A-Fa-f]+);/);
  });

  it('escapes markup in catalog text in content[] only, and keeps identifiers and URLs as sent', async () => {
    serveByHost({
      'www.loc.gov': {
        results: [
          {
            id: 'https://www.loc.gov/item/2009632251/',
            title: '&lt;b&gt;Bold&lt;/b&gt; title, 1866-<1899>',
            date: 'c1915 <Feb.>',
            description: ['1. Line one\r\nline two &amp;lt;i&amp;gt;'],
            original_format: ['photo_print'],
            url: 'https://www.loc.gov/item/2009632251/',
          },
        ],
        pagination: { of: 1, perpage: 25, pages: 1 },
        facets: [{ type: 'subject', filters: [{ value: 'arts &lt;b&gt;', count: 2 }] }],
      },
    });
    const result = await runToolContract(locSearchItems, { query: 'bold', include_facets: true });
    expect(structured(result)).toMatchObject({
      items: [
        {
          id: '2009632251',
          title: '<b>Bold</b> title, 1866-<1899>',
          date: 'c1915 <Feb.>',
          description: '1. Line one\r\nline two &lt;i&gt;',
          format: 'photo_print',
        },
      ],
      subject_facets: [{ value: 'arts <b>', count: 2 }],
    });
    const text = contentText(result);
    expect(text).toContain('\n## \\<b>Bold\\</b> title, 1866-<1899>\n');
    expect(text).toContain('**Date:** c1915 \\<Feb.>');
    expect(text).toContain('**Format:** photo_print');
    expect(text).toContain('\n1\\. Line one line two \\&lt;i\\&gt;\n');
    expect(text).toContain('**Top subjects:** arts \\<b> (2)');
    expect(text).toContain('**ID:** 2009632251');
    expect(text).toContain('**URL:** https://www.loc.gov/item/2009632251/');
  });
});

describe('locSearchItems', () => {
  beforeEach(async () => {
    // A test that forgets its stub fails here instead of reaching LOC, which blocks for an hour.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unmocked fetch')));
    // Reset rate-limit state by re-initializing the service
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('registers as libofcongress_search_items with the title Search LOC Items (#49)', () => {
    expect(locSearchItems.name).toBe('libofcongress_search_items');
    expect(locSearchItems.title).toBe('Search LOC Items');
  });

  it('returns items and pagination for a basic keyword search', async () => {
    vi.stubGlobal('fetch', mockFetch(makeSearchResponse()));
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'civil war photos' });
    const result = await locSearchItems.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('2009632251');
    expect(result.items[0]!.title).toBe('Test Photo');
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
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'xyzzy_no_match_expected' });
    const result = await locSearchItems.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.has_next).toBe(false);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(enrichment.notice).toContain('xyzzy_no_match_expected');
    expect(enrichment.effectiveQuery).toBe('xyzzy_no_match_expected');
    expect(enrichment.totalCount).toBe(0);
  });

  it('enriches totalCount 0 when upstream reports a nonzero total with empty results', async () => {
    // LOC returns pagination.total: 1 with results: [] for some no-match queries. The enriched
    // totalCount must agree with the returned total (0), not the raw upstream count.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({ results: [], pagination: { total: 1, perpage: 25, pages: 0 } }),
      ),
    );
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'zzzz_no_such_item_abcdef' });
    const result = await locSearchItems.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
  });

  it('applies format filter — passes format slug in the URL', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'maps', format: 'map' });
    await locSearchItems.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('/maps/');
  });

  it('applies date range filter in querystring', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'war', date_start: 1920, date_end: 1945 });
    await locSearchItems.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('dates=1920%2F1945');
  });

  // The open-side fills are tabled in date-range.test.ts; these prove each lone bound reaches it.
  it('sends a lone date_end as the range resolveDateRange gives it (#60)', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);

    await runToolContract(locSearchItems, { query: 'map', date_end: 1550 });

    expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('dates')).toBe(
      resolvedDates(undefined, yearBound(1550)),
    );
  });

  it('sends a lone date_start as the range resolveDateRange gives it (#60)', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);

    await runToolContract(locSearchItems, { query: 'map', date_start: 1900 });

    expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('dates')).toBe(
      resolvedDates(yearBound(1900), undefined),
    );
  });

  it('rejects a lone date_start after the current year as invalid_date_range before any request (#60)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const currentYear = new Date().getFullYear();

    const result = await runToolContract(locSearchItems, {
      query: 'map',
      date_start: currentYear + 4,
    });

    const error = wireError(result);
    const hint = contractRecovery(locSearchItems, 'invalid_date_range');
    expect(error).toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: {
        reason: 'invalid_date_range',
        field: 'date_start',
        date_start: currentYear + 4,
        current_year: currentYear,
        recovery: { hint },
      },
    });
    expect(error.message).toContain(String(currentYear));
    expect(contentText(result)).toContain(`Recovery: ${hint}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('applies subject and location facets in querystring, the dated heading as its facet term (#57)', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({
      query: 'photos',
      subject: 'World War, 1939-1945',
      location: 'oklahoma',
    });
    await locSearchItems.handler(input, ctx);

    expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('fa')).toBe(
      'subject:world war|location:oklahoma',
    );
  });

  it('strips empty subject/location strings (form-client payload)', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'photos', subject: '', location: '' });
    await locSearchItems.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).not.toContain('fa=');
  });

  it('applies collection_slug — routes the search through the collection endpoint', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({
      query: 'correspondence',
      collection_slug: 'aaron-copland',
    });
    await locSearchItems.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('/collections/aaron-copland/');
    expect(calledUrl).not.toContain('/search/');
  });

  it('strips an empty collection_slug string (form-client payload)', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'photos', collection_slug: '   ' });
    await locSearchItems.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('/search/');
    expect(calledUrl).not.toContain('/collections/');
    expect(getEnrichment(ctx).effectiveCollectionSlug).toBeUndefined();
  });

  it('echoes the applied collection scope in enrichment', async () => {
    vi.stubGlobal('fetch', mockFetch(makeSearchResponse()));
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({
      query: 'correspondence',
      collection_slug: '  aaron-copland  ',
    });
    await locSearchItems.handler(input, ctx);

    expect(getEnrichment(ctx).effectiveCollectionSlug).toBe('aaron-copland');
  });

  it('names the collection scope in the empty-result notice', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({ results: [], pagination: { total: 0, perpage: 25, pages: 0 } }),
      ),
    );
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({
      query: 'zzzz_no_match',
      collection_slug: 'aaron-copland',
    });
    await locSearchItems.handler(input, ctx);

    // A real collection with no matches must read differently from a bad slug, which 404s
    expect(String(getEnrichment(ctx).notice)).toContain('aaron-copland');
  });

  it('rejects format + collection_slug with a typed incompatible_filters failure', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({
      query: 'letters',
      format: 'photo',
      collection_slug: 'aaron-copland',
    });

    const err = await Promise.resolve(locSearchItems.handler(input, ctx)).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: { reason: 'incompatible_filters' },
    });
    // Rejected before any request — never silently pick one filter and search anyway
    expect(fetchSpy).not.toHaveBeenCalled();
    // The message names both conflicting filters; the way out rides the recovery hint
    expect((err as Error).message).toContain('collection_slug');
    expect((err as Error).message).toContain('format');
  });

  it('keeps the internal request URL out of a collection_not_found failure', async () => {
    vi.stubGlobal('fetch', mockFetch(JSON.stringify({ exception: 'not found' }), 404));
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'letters', collection_slug: 'nope-xyz9' });

    const err = (await Promise.resolve(locSearchItems.handler(input, ctx)).catch(
      (e: unknown) => e,
    )) as {
      message: string;
      data?: Record<string, unknown>;
    };
    // The built endpoint embeds the caller's query string; neither the service nor the tool may relay it
    expect(err.data).not.toHaveProperty('url');
    expect(JSON.stringify(err.data)).not.toContain('loc.gov');
    expect(err.message).not.toContain('loc.gov');
  });

  it('does not report a 404 as collection_not_found when no collection_slug was given', async () => {
    vi.stubGlobal('fetch', mockFetch(JSON.stringify({ exception: 'not found' }), 404));
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'letters' });

    const err = (await Promise.resolve(locSearchItems.handler(input, ctx)).catch(
      (e: unknown) => e,
    )) as {
      data?: Record<string, unknown>;
    };
    expect(err.data?.reason).not.toBe('collection_not_found');
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
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'test', page: 1 });
    const result = await locSearchItems.handler(input, ctx);
    expect(result.has_next).toBe(true);
    expect(result.pages).toBe(2);
  });

  it('throws on HTML response (rate-limited proxy page)', async () => {
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Error</body></html>', 200));
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'test' });
    await expect(locSearchItems.handler(input, ctx)).rejects.toThrow();
  });

  it('format() renders title, ID, and URL in output text', () => {
    const output = locSearchItems.output.parse({
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
      subject_facets: [],
      location_facets: [],
    });
    const blocks = locSearchItems.format!(output);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('loc.pnp.ppmsc.02404');
    expect(text).toContain('Sample Photo');
    expect(text).toContain('https://www.loc.gov/item/loc.pnp.ppmsc.02404/');
  });

  it('format() renders pagination summary even when items are empty', () => {
    const output = locSearchItems.output.parse({
      items: [],
      total: 0,
      page: 1,
      pages: 0,
      has_next: false,
      subject_facets: [],
      location_facets: [],
    });
    const blocks = locSearchItems.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    // Pagination summary line must always be present (notice is in the enrichment trailer, not here)
    expect(text).toContain('Total:');
    expect(text).toContain('Page:');
  });

  it('format() renders sparse item — no date or format', () => {
    const output = locSearchItems.output.parse({
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
      subject_facets: [],
      location_facets: [],
    });
    const blocks = locSearchItems.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('sparse-id');
    expect(text).toContain('Sparse Item');
  });

  it('returns real items served on a page beyond the computed count instead of discarding them (#33 Bug B)', async () => {
    // A page past the computed page count can still carry real items — LOC's `total` under-reports
    // the retrievable depth. The old "contradictory pagination" guard discarded these; it must not.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({
          results: [
            {
              id: 'https://www.loc.gov/item/2009632251/',
              title: 'Deep-page Item',
              url: 'https://www.loc.gov/item/2009632251/',
            },
          ],
          pagination: { total: 100, perpage: 25, pages: 4, page: 999 },
        }),
      ),
    );
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'test', page: 999 });
    const result = await locSearchItems.handler(input, ctx);

    // The served item is returned, not thrown away.
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe('2009632251');
    // Pagination stays consistent: page never exceeds pages.
    expect(result.page).toBe(999);
    expect(result.pages).toBeGreaterThanOrEqual(result.page);
    // No false "no results on page 999" notice — the items are real.
    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('caps pages at the ~100k retrieval ceiling, discloses it, and still returns the served items (#33 Bug A)', async () => {
    // Live LOC shape: `of` is the item count, `total` the page count, no `pages` key. A ~1.78M-item
    // query spans ~17,800 pages, but LOC serves only the first ~100,000 items.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({
          results: [
            {
              id: 'https://www.loc.gov/item/2009632251/',
              title: 'Deep result within the ceiling',
              url: 'https://www.loc.gov/item/2009632251/',
            },
          ],
          pagination: { of: 1779931, total: 17800, perpage: 100, results: '24901 - 25000' },
        }),
      ),
    );
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'civil rights', limit: 100, page: 250 });
    const result = await locSearchItems.handler(input, ctx);

    expect(result.items).toHaveLength(1); // served item not discarded
    expect(result.total).toBe(1779931); // total reads from `of`, not the page count
    expect(result.pages).toBe(1000); // capped at 100000 / 100
    expect(result.has_next).toBe(true); // page 250 is within the retrievable ceiling
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(1779931);
    expect(String(enrichment.notice)).toMatch(/100,000|partition/);
  });

  it('reports a generic out-of-range page (400 within the ceiling) without ceiling language', async () => {
    vi.stubGlobal('fetch', mockFetch('', 400));
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'niche query', limit: 25, page: 8 });
    const result = await locSearchItems.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    const notice = String(getEnrichment(ctx).notice);
    expect(notice).toContain('out of range');
    expect(notice).not.toContain('ceiling');
  });

  it('rejects empty query at schema level', () => {
    expect(() => locSearchItems.input.parse({ query: '' })).toThrow();
  });

  it('format() renders a get_item-eligible line for is_item:true results (#31 parity)', () => {
    // is_item:true has no content[] representation before #31 — a text-only client could not tell a
    // get_item target from a non-item result. Both boolean states must render.
    const output = locSearchItems.output.parse({
      items: [
        {
          id: '2009632251',
          title: 'A Photograph',
          is_item: true,
          url: 'https://www.loc.gov/item/2009632251/',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
      subject_facets: [],
      location_facets: [],
    });
    const blocks = locSearchItems.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('libofcongress_get_item');
    expect(text).not.toContain('Non-item result');
  });

  it('query with injection chars is handled without URL structure breakage', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({
      query: "'; DROP TABLE items; SELECT * FROM items WHERE '1'='1",
    });
    await locSearchItems.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    // URL must remain parseable and not contain raw SQL injection
    expect(() => new URL(calledUrl)).not.toThrow();
    expect(calledUrl).toContain('fo=json');
    expect(calledUrl).not.toContain("'; DROP TABLE");
  });

  it('rejects limit=0 at schema level (below min)', () => {
    expect(() => locSearchItems.input.parse({ query: 'test', limit: 0 })).toThrow();
  });

  it('accepts limit up to 1000 and rejects limit=1001 at schema level (hard ceiling)', () => {
    expect(locSearchItems.input.parse({ query: 'test', limit: 101 }).limit).toBe(101);
    expect(locSearchItems.input.parse({ query: 'test', limit: 1000 }).limit).toBe(1000);
    expect(() => locSearchItems.input.parse({ query: 'test', limit: 1001 })).toThrow();
  });

  describe('limit above the per-call cap of 100', () => {
    /** A 100-result page as LOC answers `c=100`, with `perpage` echoing the sent page size. */
    const fullPage = (pagination: object) =>
      makeSearchResponse({
        results: Array.from({ length: 100 }, (_, i) => ({
          id: `https://www.loc.gov/item/clamp${i}/`,
          title: `Result ${i}`,
          url: `https://www.loc.gov/item/clamp${i}/`,
        })),
        pagination,
      });

    it('sends c=100 and discloses the clamp with effectiveLimit and the notice on both surfaces', async () => {
      const fetchSpy = mockFetch(fullPage({ of: 5000, perpage: 100 }));
      vi.stubGlobal('fetch', fetchSpy);

      const result = await runToolContract(locSearchItems, {
        query: 'civil war',
        limit: 500,
        page: 2,
      });

      const calledUrl = new URL(fetchSpy.mock.calls[0]![0] as string);
      expect(calledUrl.searchParams.get('c')).toBe('100');
      expect(calledUrl.searchParams.get('sp')).toBe('2');
      const sc = structured(result);
      expect(sc).toMatchObject({ page: 2, pages: 50, has_next: true, effectiveLimit: 100 });
      expect(sc.items).toHaveLength(100);
      expect(sc.notice).toBe(
        'Requested limit 500 exceeds the per-call cap of 100; this page holds up to 100 results, and page numbers count 100-result pages. Request page 3 with limit 100 for the next results.',
      );
      expect(contentText(result)).toContain(String(sc.notice));
    });

    it('leaves a limit at the cap unchanged — no effectiveLimit, no notice', async () => {
      const fetchSpy = mockFetch(fullPage({ of: 5000, perpage: 100 }));
      vi.stubGlobal('fetch', fetchSpy);

      const sc = structured(
        await runToolContract(locSearchItems, { query: 'civil war', limit: 100 }),
      );

      expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('c')).toBe('100');
      expect(sc).not.toHaveProperty('effectiveLimit');
      expect(sc).not.toHaveProperty('notice');
    });

    it('combines the clamp notice with the retrieval-ceiling notice, and stops pages at page 1000', async () => {
      vi.stubGlobal('fetch', mockFetch(fullPage({ of: 1779931, total: 17800, perpage: 100 })));

      const result = await runToolContract(locSearchItems, {
        query: 'civil rights',
        limit: 1000,
        page: 1000,
      });

      const sc = structured(result);
      expect(sc).toMatchObject({ page: 1000, pages: 1000, has_next: false, effectiveLimit: 100 });
      const notice = String(sc.notice);
      expect(notice).toMatch(/^Requested limit 1000 exceeds the per-call cap of 100;/);
      expect(notice).not.toContain('Request page 1001');
      expect(notice).toContain('LOC pages through only the first ~100,000');
      expect(contentText(result)).toContain(notice);
    });

    it('combines the clamp notice with the ceiling notice for page 1001, which LOC answers 400', async () => {
      const fetchSpy = mockFetch('', 400);
      vi.stubGlobal('fetch', fetchSpy);

      const sc = structured(
        await runToolContract(locSearchItems, { query: 'civil rights', limit: 250, page: 1001 }),
      );

      expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('c')).toBe('100');
      expect(sc).toMatchObject({ items: [], pages: 0, has_next: false, effectiveLimit: 100 });
      const notice = String(sc.notice);
      expect(notice).toContain('Requested limit 250 exceeds the per-call cap of 100');
      expect(notice).toContain("Page 1001 is past LOC's ~100,000-item retrieval ceiling");
    });

    it('combines the clamp notice with the empty-result notice', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch(makeSearchResponse({ results: [], pagination: { of: 0, perpage: 100 } })),
      );

      const result = await runToolContract(locSearchItems, { query: 'zyzzyva', limit: 200 });

      const notice = String(structured(result).notice);
      expect(notice).toContain('Requested limit 200 exceeds the per-call cap of 100');
      expect(notice).toContain('No items matched "zyzzyva"');
      expect(contentText(result)).toContain(notice);
    });
  });

  it('rejects page=0 at schema level (below min)', () => {
    expect(() => locSearchItems.input.parse({ query: 'test', page: 0 })).toThrow();
  });

  it('format() includes description in output text when present', () => {
    const output = locSearchItems.output.parse({
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
      subject_facets: [],
      location_facets: [],
    });
    const blocks = locSearchItems.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('photograph of the subject');
  });

  it('format() includes format label in output when present', () => {
    const output = locSearchItems.output.parse({
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
      subject_facets: [],
      location_facets: [],
    });
    const blocks = locSearchItems.format!(output);
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
    const ctx = createMockContext({ errors: locSearchItems.errors });
    const input = locSearchItems.input.parse({ query: 'civil war' });
    const result = await locSearchItems.handler(input, ctx);
    expect(result.items[0]!.is_item).toBe(false);
    expect(result.items[0]!.id).toBe('collections/civil-war/about-this-collection');
    expect(result.items[1]!.is_item).toBe(true);
    expect(result.items[1]!.id).toBe('2009632251');
  });

  it('format() flags collection landing pages as non-get_item targets', () => {
    const output = locSearchItems.output.parse({
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
      subject_facets: [],
      location_facets: [],
    });
    const blocks = locSearchItems.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Non-item result');
    expect(text).toContain('not a libofcongress_get_item target');
  });

  it('pins the retrieval-ceiling notice on both surfaces for a 400 past ~100k items (#33)', async () => {
    const fetchSpy = mockFetch('', 400);
    vi.stubGlobal('fetch', fetchSpy);
    const result = await runToolContract(locSearchItems, {
      query: 'civil rights',
      limit: 100,
      page: 1500,
    });

    expect(result.isError).toBeFalsy();
    const sc = structured(result);
    expect(sc).toMatchObject({ items: [], total: 0, page: 1500, pages: 0, has_next: false });
    expect(sc.notice).toBe(
      `Page 1500 is past LOC's ~100,000-item retrieval ceiling for query "civil rights" — LOC serves nothing that deep, however few items match. Re-run with page 1 to see the real total and page count; if the target items lie past the first 100,000, narrow the search with a date range (date_start/date_end), subject, or location.`,
    );
    expect(contentText(result)).toContain(String(sc.notice));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps a 520 on page > 1 on the out-of-range path', async () => {
    vi.stubGlobal('fetch', mockFetch('', 520));
    const result = await runToolContract(locSearchItems, { query: 'niche query', page: 3 });

    expect(result.isError).toBeFalsy();
    const sc = structured(result);
    expect(sc).toMatchObject({ items: [], total: 0, page: 3, pages: 0, has_next: false });
    expect(String(sc.notice)).toContain('Page 3');
    expect(String(sc.notice)).toContain('out of range');
    expect(String(sc.notice)).not.toContain('ceiling');
  });

  it.each([
    {
      name: 'a valid collection',
      args: { query: 'cobb', collection_slug: 'baseball-cards', limit: 3, page: 900 },
      mentions: ['Page 900', '"cobb"', 'collection "baseball-cards"'],
    },
    {
      name: 'a format-scoped search',
      args: { query: 'dust bowl', format: 'photo' as const, limit: 3, page: 9999 },
      mentions: ['Page 9999', '"dust bowl"', 'format "photo"'],
    },
    {
      name: 'a bare search',
      args: { query: 'zyzzyva', limit: 3, page: 2 },
      mentions: ['Page 2', '"zyzzyva"'],
    },
  ])(
    'returns the out-of-range notice, not an error, for a 404 on a later page of $name (#40)',
    async ({ args, mentions }) => {
      const fetchSpy = mockFetch(JSON.stringify({ exception: 'not found' }), 404);
      vi.stubGlobal('fetch', fetchSpy);
      const result = await runToolContract(locSearchItems, args);

      expect(result.isError).toBeFalsy();
      const sc = structured(result);
      expect(sc).toMatchObject({
        items: [],
        total: 0,
        page: args.page,
        pages: 0,
        has_next: false,
        totalCount: 0,
      });
      const notice = String(sc.notice);
      for (const m of mentions) expect(notice).toContain(m);
      expect(notice).toContain('page 1');
      expect(notice).not.toContain('ceiling');
      expect(contentText(result)).toContain(notice);
      // No extra request to tell a bad slug from a deep page.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps collection_not_found for a 404 on page 1 and forwards its recovery on both surfaces (#40, #44)', async () => {
    vi.stubGlobal('fetch', mockFetch(JSON.stringify({ exception: 'not found' }), 404));
    const slug = 'zzz-not-a-real-collection-slug-123';
    const result = await runToolContract(locSearchItems, {
      query: 'letters',
      collection_slug: slug,
    });

    const error = wireError(result);
    const hint = contractRecovery(locSearchItems, 'collection_not_found');
    expect(error).toMatchObject({
      code: JsonRpcErrorCode.NotFound,
      data: {
        reason: 'collection_not_found',
        field: 'collection_slug',
        collectionSlug: slug,
        recovery: { hint },
      },
    });
    expect(error.message).toContain(slug);
    expect(contentText(result)).toContain(`Recovery: ${hint}`);
  });

  it('forwards incompatible_filters recovery on both surfaces without repeating it in the message (#44)', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const result = await runToolContract(locSearchItems, {
      query: 'letters',
      format: 'photo',
      collection_slug: 'aaron-copland',
    });

    const error = wireError(result);
    const hint = contractRecovery(locSearchItems, 'incompatible_filters');
    expect(error).toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: {
        reason: 'incompatible_filters',
        retryable: false,
        format: 'photo',
        collectionSlug: 'aaron-copland',
        recovery: { hint },
      },
    });
    // The message names the conflict; the next step is stated once, by the recovery line.
    expect(error.message).not.toMatch(/omit/i);
    expect(contentText(result)).toContain(`Recovery: ${hint}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an inverted date range as invalid_date_range, keeping its data and forwarding recovery (#45)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await runToolContract(locSearchItems, {
      query: 'test',
      date_start: 1950,
      date_end: 1900,
    });

    const error = wireError(result);
    const hint = contractRecovery(locSearchItems, 'invalid_date_range');
    expect(error).toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: {
        reason: 'invalid_date_range',
        field: 'date_start',
        date_start: 1950,
        date_end: 1900,
        recovery: { hint },
      },
    });
    expect(error.message).toContain('1950');
    expect(error.message).toContain('1900');
    const text = contentText(result);
    expect(text).toContain(`Recovery: ${hint}`);
    expect(text).toContain('reason invalid_date_range');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns a row's cataloged item.date, falling back to the top-level date, on both surfaces (#62)", async () => {
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      if (new URL(String(url)).hostname !== 'www.loc.gov') throw new Error('unmocked fetch');
      return new Response(JSON.stringify(COBB_PHOTO_SEARCH), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runToolContract(locSearchItems, {
      query: 'cobb detroit baseball card',
      format: 'photo',
      limit: 10,
    });

    const items = structured(result).items as Array<{ id: string; date?: string }>;
    expect(items.map((i) => i.date)).toEqual(['1909-1911.', 'c1915 Feb. 19.', '2016-02-11']);
    const text = contentText(result);
    expect(text).toContain('**Date:** c1915 Feb. 19.');
    expect(text).not.toContain('1915-01-01');
    expect(text).not.toContain('1909-01-01');
  });

  it.each([
    ['a number', 1915],
    ['an empty string', ''],
    ['null', null],
    ['an object', { start: '1915' }],
  ])(
    "keeps the top-level date when a row's item.date is %s, without failing the page",
    async (_name, itemDate) => {
      const [first, second, third] = COBB_PHOTO_SEARCH.results;
      const body = {
        ...COBB_PHOTO_SEARCH,
        results: [first, { ...second, item: { date: itemDate } }, third],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          if (new URL(String(url)).hostname !== 'www.loc.gov') throw new Error('unmocked fetch');
          return new Response(JSON.stringify(body), { status: 200 });
        }),
      );

      const result = await runToolContract(locSearchItems, {
        query: 'cobb detroit baseball card',
        format: 'photo',
        limit: 10,
      });

      expect(result.isError).toBeFalsy();
      const items = structured(result).items as Array<{ date?: string }>;
      expect(items.map((i) => i.date)).toEqual(['1909-1911.', '1915-01-01', '2016-02-11']);
      expect(contentText(result)).toContain('**Date:** 1915-01-01');
    },
  );

  describe('subject headings and facets (#57)', () => {
    const POSTERS_BODY = JSON.stringify(POSTERS_PHOTOS_SEARCH);
    const facetValues = (type: string) =>
      POSTERS_PHOTOS_SEARCH.facets
        .find((f) => f.type === type)!
        .filters.map((f) => ({ value: f.value, count: f.count }));

    // The heading-to-terms split is tabled in subject-terms.test.ts; this proves its terms reach
    // the request, the echo, and the content[] trailer.
    it('sends a subdivided heading as its ANDed facet terms and echoes them on both surfaces', async () => {
      const fetchSpy = mockFetch(POSTERS_BODY);
      vi.stubGlobal('fetch', fetchSpy);
      const subject = 'United States--History--Civil War, 1861-1865';
      const terms = subjectFacetTerms(subject);

      const result = await runToolContract(locSearchItems, {
        query: 'posters',
        format: 'photo',
        subject,
      });

      expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('fa')).toBe(
        terms.map((term) => `subject:${term}`).join('|'),
      );
      expect(structured(result).effectiveSubjectTerms).toEqual(terms);
      expect(contentText(result)).toContain(`**Subject terms:** ${terms.join(' + ')}`);
    });

    it('sends the same filter for an LCSH heading and its facet term', async () => {
      const fetchSpy = mockFetch(POSTERS_BODY);
      vi.stubGlobal('fetch', fetchSpy);

      await runToolContract(locSearchItems, { query: 'posters', subject: 'World War, 1939-1945' });
      fetchSpy.mockResolvedValue(new Response(POSTERS_BODY, { status: 200 }));
      await runToolContract(locSearchItems, { query: 'posters', subject: 'world war' });

      const sent = fetchSpy.mock.calls.map((c) => new URL(c[0] as string).searchParams.get('fa'));
      expect(sent).toEqual(['subject:world war', 'subject:world war']);
    });

    it('echoes no subject terms when no subject filter is given', async () => {
      vi.stubGlobal('fetch', mockFetch(POSTERS_BODY));

      const sc = structured(await runToolContract(locSearchItems, { query: 'posters' }));

      expect(sc).not.toHaveProperty('effectiveSubjectTerms');
    });

    it('requests the facet block alongside results and pagination when include_facets is true', async () => {
      const fetchSpy = mockFetch(POSTERS_BODY);
      vi.stubGlobal('fetch', fetchSpy);

      await runToolContract(locSearchItems, {
        query: 'posters',
        format: 'photo',
        include_facets: true,
      });

      expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('at')).toBe(
        'results,pagination,facets',
      );
    });

    it('by default sends results and pagination only and carries no facet fields on either surface', async () => {
      // The fixture carries a facet block; with facets off it is neither requested nor read.
      const fetchSpy = mockFetch(POSTERS_BODY);
      vi.stubGlobal('fetch', fetchSpy);

      const result = await runToolContract(locSearchItems, { query: 'posters', format: 'photo' });

      expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('at')).toBe(
        'results,pagination',
      );
      const sc = structured(result);
      expect(sc).not.toHaveProperty('subject_facets');
      expect(sc).not.toHaveProperty('location_facets');
      expect((sc.items as unknown[]).length).toBeGreaterThan(0);
      const text = contentText(result);
      expect(text).not.toContain('Top subjects');
      expect(text).not.toContain('Top locations');
    });

    it('returns the subject and location facets as { value, count } on both surfaces', async () => {
      vi.stubGlobal('fetch', mockFetch(POSTERS_BODY));

      const result = await runToolContract(locSearchItems, {
        query: 'posters',
        format: 'photo',
        include_facets: true,
      });

      const sc = structured(result);
      expect(sc.subject_facets).toEqual(facetValues('subject'));
      expect(sc.location_facets).toEqual(facetValues('location'));
      expect(sc.subject_facets).toHaveLength(10);
      // Only the two facet types are carried; LOC's availability facet ("true") is not.
      expect(JSON.stringify(sc.subject_facets)).not.toContain('"true"');
      const text = contentText(result);
      expect(text).toContain('**Top subjects:** color (11849); american (7834); posters (6621)');
      expect(text).toContain('**Top locations:** united states (3245); california (1274)');
    });

    it('returns empty facet lists when LOC sends no facet block', async () => {
      vi.stubGlobal('fetch', mockFetch(makeSearchResponse()));

      const result = await runToolContract(locSearchItems, {
        query: 'posters',
        include_facets: true,
      });

      const sc = structured(result);
      expect(sc).toMatchObject({ subject_facets: [], location_facets: [] });
      expect(contentText(result)).not.toContain('Top subjects');
    });

    it('names the applied subject terms and location in the zero-result notice on both surfaces', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch(JSON.stringify({ results: [], pagination: { of: 0, perpage: 25 }, facets: [] })),
      );

      const result = await runToolContract(locSearchItems, {
        query: 'posters',
        format: 'photo',
        subject: 'United States--History--Civil War, 1861-1865',
        location: 'oklahoma',
        include_facets: true,
      });

      const sc = structured(result);
      expect(sc).toMatchObject({ items: [], total: 0, subject_facets: [], location_facets: [] });
      const notice = String(sc.notice);
      expect(notice).toBe(
        'No items matched "posters" with format "photo" with subject terms "united states" + "history" + "civil war" in location "oklahoma". Every subject term must match; drop one, or the location, to widen the search. Also try broadening the query, widening the date range, or running libofcongress_search_subjects to find the subject heading.',
      );
      expect(contentText(result)).toContain(notice);
    });

    it('returns empty facet lists on an out-of-range page', async () => {
      vi.stubGlobal('fetch', mockFetch('', 404));

      const sc = structured(
        await runToolContract(locSearchItems, {
          query: 'posters',
          subject: 'world war',
          page: 9,
          include_facets: true,
        }),
      );

      expect(sc).toMatchObject({ items: [], pages: 0, subject_facets: [], location_facets: [] });
      expect(String(sc.notice)).toContain('with subject terms "world war"');
    });
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil, must not bleed into other tests
  it('forwards the most specific rate-limit hint on both surfaces: a fresh 429, then the running block (#44)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('Rate limited', { status: 429 }));
    vi.stubGlobal('fetch', fetchSpy);

    const fresh = await runToolContract(locSearchItems, { query: 'anything' });
    const freshError = wireError(fresh);
    expect(freshError).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'rate_limit_exceeded', retryable: false },
    });
    const freshHint = String(freshError.data?.recovery?.hint);
    expect(freshHint).toMatch(/1 hour/);
    expect(contentText(fresh)).toContain(`Recovery: ${freshHint}`);

    // The block is live now: the next call fails before any request and says how long is left.
    const blocked = await runToolContract(locSearchItems, { query: 'anything' });
    const blockedError = wireError(blocked);
    expect(blockedError).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'rate_limit_exceeded', blockedUntil: expect.any(String) },
    });
    const blockedHint = String(blockedError.data?.recovery?.hint);
    expect(blockedHint).toMatch(/60 more minute/);
    expect(blockedHint).toContain(String(blockedError.data?.blockedUntil));
    expect(contentText(blocked)).toContain(`Recovery: ${blockedHint}`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
