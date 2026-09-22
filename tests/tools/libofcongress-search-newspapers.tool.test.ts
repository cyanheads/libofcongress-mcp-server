/**
 * @fileoverview Tests for libofcongress_search_newspapers tool.
 * @module tests/tools/libofcongress-search-newspapers.tool.test
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
import { locSearchNewspapers } from '@/mcp-server/tools/definitions/libofcongress-search-newspapers.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';
import { contentText, contractRecovery, structured, wireError } from '../helpers/tool-result.js';

function makeNewspaperSearchResponse(overrides: { results?: object[]; pagination?: object } = {}) {
  return JSON.stringify({
    results: overrides.results ?? [
      {
        url: 'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/?sp=1',
        title: 'The Daily Oklahoman, 1900-01-01, Edition 1, Page 1',
        date: '1900-01-01',
        description: ['Text excerpt about train wreck...'],
        location: ['Oklahoma'],
        subject: ['The Daily Oklahoman'],
      },
    ],
    pagination: overrides.pagination ?? {
      total: 1,
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

describe('locSearchNewspapers', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns newspaper pages for a basic keyword search', async () => {
    vi.stubGlobal('fetch', mockFetch(makeNewspaperSearchResponse()));
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({ query: 'train wreck' });
    const result = await locSearchNewspapers.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.url).toBe(
      'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/?sp=1',
    );
    expect(result.items[0]!.date).toBe('1900-01-01');
    expect(result.total).toBe(1);
    expect(result.has_next).toBe(false);
    // Enrichment echoes query and total for both structuredContent and content[] clients
    const enrichment = getEnrichment(ctx);
    expect(enrichment.effectiveQuery).toBe('train wreck');
    expect(enrichment.totalCount).toBe(1);
  });

  it('populates enrichment.notice and returns empty items when no results', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeNewspaperSearchResponse({
          results: [],
          pagination: { total: 0, perpage: 25, pages: 0 },
        }),
      ),
    );
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({
      query: 'xyzzy_nope',
      state: 'oklahoma',
    });
    const result = await locSearchNewspapers.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(String(enrichment.notice)).toContain('xyzzy_nope');
    expect(String(enrichment.notice)).toContain('oklahoma');
    expect(enrichment.effectiveQuery).toBe('xyzzy_nope');
    expect(enrichment.totalCount).toBe(0);
  });

  it('enriches totalCount 0 when upstream reports a nonzero total with empty results', async () => {
    // LOC returns pagination.total: 1 with results: [] for some no-match queries. The enriched
    // totalCount must agree with the returned total (0), not the raw upstream count.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeNewspaperSearchResponse({
          results: [],
          pagination: { total: 1, perpage: 25, pages: 0 },
        }),
      ),
    );
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({ query: 'zzzz_no_such_page_abcdef' });
    const result = await locSearchNewspapers.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.totalCount).toBe(0);
  });

  it('hits the /newspapers/ endpoint', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({ query: 'election' });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('/newspapers/');
  });

  it('applies state filter as a location facet', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({ query: 'flood', state: 'texas' });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('location%3Atexas');
  });

  it('applies newspaper_title filter as partof_title facet', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({
      query: 'congress',
      newspaper_title: 'New York Times',
    });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('partof_title');
  });

  it('strips empty state/newspaper_title (form-client payload)', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({
      query: 'fire',
      state: '',
      newspaper_title: '',
    });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).not.toContain('fa=');
  });

  it('applies date range filter', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({
      query: 'prohibition',
      date_start: 1920,
      date_end: 1933,
    });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('dates=1920%2F1933');
  });

  it('format() renders publication title, date, states, and URL', () => {
    const output = locSearchNewspapers.output.parse({
      items: [
        {
          url: 'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/?sp=1',
          title: 'The Daily Oklahoman, 1900-01-01',
          description: 'Train derailment near Guthrie causes injuries...',
          date: '1900-01-01',
          states: ['oklahoma'],
          newspaper_title: 'The Daily Oklahoman',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearchNewspapers.format!(output);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('The Daily Oklahoman');
    expect(text).toContain('1900-01-01');
    expect(text).toContain('**States:** oklahoma');
    expect(text).toContain('https://www.loc.gov/resource/');
  });

  it('format() renders sparse item — only url and title present', () => {
    const output = locSearchNewspapers.output.parse({
      items: [
        {
          url: 'https://www.loc.gov/resource/sn000/1910-06-01/ed-1/?sp=1',
          title: 'Sparse Newspaper Page',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearchNewspapers.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Sparse Newspaper Page');
    expect(text).toContain('https://www.loc.gov/resource/');
    expect(text).not.toContain('States:');
  });

  it('carries every location_state entry on both surfaces, and omits states when LOC sends none (#43)', async () => {
    // Live `lindbergh flight` 1927 shapes: a two-state facet (the Charleston, S.C. title that the
    // old state field reported as "georgia"), a single-state facet, and no facet at all.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeNewspaperSearchResponse({
          results: [
            {
              url: 'https://www.loc.gov/resource/sn87065702/1927-06-16/ed-1/?sp=10&q=lindbergh+flight',
              title: 'Image 10 of Southern Christian advocate (Charleston, S.C.), June 16, 1927',
              date: '1927-06-16',
              location: ['georgia', 'charleston', 'united states', 'south carolina'],
              location_state: ['georgia', 'south carolina'],
              partof_title: ['southern christian advocate (charleston, s.c.) 1837-1948'],
            },
            {
              url: 'https://www.loc.gov/resource/sn83045293/1927-06-13/ed-1/?sp=1&q=lindbergh+flight',
              title:
                'Image 1 of The Milwaukee leader (Milwaukee, Wis.), June 13, 1927, (Mail Edition)',
              location: ['milwaukee', 'united states', 'wisconsin'],
              location_state: ['wisconsin'],
            },
            {
              url: 'https://www.loc.gov/resource/sn000/1927-06-13/ed-1/?sp=1',
              title: 'Page with no state facet',
              location: ['united states'],
            },
          ],
          pagination: { of: 3, total: 1, perpage: 25 },
        }),
      ),
    );
    const result = await runToolContract(locSearchNewspapers, {
      query: 'lindbergh flight',
      date_start: 1927,
      date_end: 1927,
    });

    expect(result.isError).toBeFalsy();
    const items = structured(result).items as Array<Record<string, unknown>>;
    expect(items[0]!.states).toEqual(['georgia', 'south carolina']);
    expect(items[1]!.states).toEqual(['wisconsin']);
    expect(items[2]).not.toHaveProperty('states');
    for (const item of items) expect(item).not.toHaveProperty('state');

    const text = contentText(result);
    expect(text).toContain('**States:** georgia, south carolina');
    expect(text).toContain('**States:** wisconsin');
    expect(text.match(/\*\*States:\*\*/g)).toHaveLength(2);
    expect(text).not.toContain('**State:**');
  });

  it('maps newspaper_title from partof_title, not subject', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/resource/sn83030214/1910-10-15/ed-1/?sp=14',
              title: 'The Evening World, 1910-10-15',
              date: '1910-10-15',
              subject: ['united states', 'new york (state)', 'newspapers'],
              location: ['new york', 'new york county', 'united states'],
              location_state: ['new york'],
              partof_title: ['the evening world (new york, n.y.) 1887-1931'],
              partof: [
                'chronicling america',
                'serial and government publications division',
                'the evening world (new york, n.y.) 1887-1931',
              ],
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({ query: 'election' });
    const result = await locSearchNewspapers.handler(input, ctx);

    expect(result.items[0]!.newspaper_title).toContain('evening world');
    expect(result.items[0]!.newspaper_title).not.toBe('united states');
    // states comes from location_state alone — location's "united states" never stands in
    expect(result.items[0]!.states).toEqual(['new york']);
  });

  it('rejects empty query at schema level', () => {
    expect(() => locSearchNewspapers.input.parse({ query: '' })).toThrow();
  });

  it('returns real pages served beyond the computed count instead of discarding them (#33 Bug B)', async () => {
    // A page past the computed count can still carry real pages — the old guard discarded them.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeNewspaperSearchResponse({
          results: [
            {
              url: 'https://www.loc.gov/resource/sn000/1900-01-01/ed-1/?sp=1',
              title: 'Deep-page Result',
            },
          ],
          pagination: { total: 100, perpage: 25, pages: 4, page: 10 },
        }),
      ),
    );
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({ query: 'election', page: 10 });
    const result = await locSearchNewspapers.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.page).toBe(10);
    expect(result.pages).toBeGreaterThanOrEqual(result.page);
    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('caps pages at the ~100k ceiling and discloses it for the huge newspaper corpus (#33 Bug A)', async () => {
    // Chronicling America "the" reports ~22.7M pages in `of`; `total` is the page count.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeNewspaperSearchResponse({
          results: [
            {
              url: 'https://www.loc.gov/resource/sn000/1900-01-01/ed-1/?sp=1',
              title: 'Deep page within the ceiling',
            },
          ],
          pagination: { of: 22730762, total: 227308, perpage: 100, results: '24901 - 25000' },
        }),
      ),
    );
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({ query: 'the', limit: 100, page: 250 });
    const result = await locSearchNewspapers.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(22730762);
    expect(result.pages).toBe(1000);
    expect(result.has_next).toBe(true);
    expect(String(getEnrichment(ctx).notice)).toMatch(/100,000|partition/);
  });

  it('empty result enrichment.notice includes state filter when state was provided', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeNewspaperSearchResponse({
          results: [],
          pagination: { total: 0, perpage: 25, pages: 0 },
        }),
      ),
    );
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({
      query: 'blizzard',
      date_start: 1888,
      date_end: 1889,
    });
    const result = await locSearchNewspapers.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    // The notice should mention the date filter
    expect(String(enrichment.notice)).toContain('1888');
  });

  it('format() renders pagination summary even when items are empty', () => {
    const output = locSearchNewspapers.output.parse({
      items: [],
      total: 0,
      page: 1,
      pages: 0,
      has_next: false,
    });
    const blocks = locSearchNewspapers.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Total:');
    expect(text).toContain('Page:');
  });

  it('rejects limit=0 at schema level', () => {
    expect(() => locSearchNewspapers.input.parse({ query: 'test', limit: 0 })).toThrow();
  });

  it('rejects page=0 at schema level', () => {
    expect(() => locSearchNewspapers.input.parse({ query: 'test', page: 0 })).toThrow();
  });

  it('query with unicode characters passes through correctly', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({ query: 'café société' });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(() => new URL(calledUrl)).not.toThrow();
  });

  it('pins the retrieval-ceiling notice on both surfaces for a 400 past ~100k pages (#33)', async () => {
    vi.stubGlobal('fetch', mockFetch('', 400));
    const result = await runToolContract(locSearchNewspapers, {
      query: 'the',
      limit: 100,
      page: 1500,
    });

    expect(result.isError).toBeFalsy();
    const sc = structured(result);
    expect(sc).toMatchObject({ items: [], total: 0, page: 1500, pages: 0, has_next: false });
    expect(sc.notice).toBe(
      `Page 1500 is past LOC's ~100,000-item retrieval ceiling for query "the" — Chronicling America serves nothing that deep, however few pages match. Re-run with page 1 to see the real total and page count; if the target pages lie past the first 100,000, narrow the search with a date range (date_start/date_end) or state.`,
    );
    expect(contentText(result)).toContain(String(sc.notice));
  });

  it('returns the out-of-range sentinel for a 400 within the ceiling', async () => {
    vi.stubGlobal('fetch', mockFetch('', 400));
    const result = await runToolContract(locSearchNewspapers, { query: 'blizzard', page: 8 });

    expect(result.isError).toBeFalsy();
    const sc = structured(result);
    expect(sc).toMatchObject({ items: [], total: 0, page: 8, pages: 0, has_next: false });
    expect(String(sc.notice)).toContain('Page 8');
    expect(String(sc.notice)).toContain('out of range');
    expect(String(sc.notice)).not.toContain('ceiling');
    expect(contentText(result)).toContain(String(sc.notice));
  });

  it('returns the out-of-range notice, not an error, for a 404 on a later page (#40)', async () => {
    const fetchSpy = mockFetch(JSON.stringify({ exception: 'not found' }), 404);
    vi.stubGlobal('fetch', fetchSpy);
    const result = await runToolContract(locSearchNewspapers, {
      query: 'zyzzyva',
      state: 'oklahoma',
      limit: 3,
      page: 50,
    });

    expect(result.isError).toBeFalsy();
    const sc = structured(result);
    expect(sc).toMatchObject({
      items: [],
      total: 0,
      page: 50,
      pages: 0,
      has_next: false,
      totalCount: 0,
    });
    const notice = String(sc.notice);
    expect(notice).toContain('Page 50');
    expect(notice).toContain('"zyzzyva"');
    expect(notice).toContain('state "oklahoma"');
    expect(notice).toContain('page 1');
    expect(notice).not.toContain('ceiling');
    expect(contentText(result)).toContain(notice);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects an inverted date range as invalid_date_range, keeping its data and forwarding recovery (#45)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await runToolContract(locSearchNewspapers, {
      query: 'election',
      date_start: 1930,
      date_end: 1900,
    });

    const error = wireError(result);
    const hint = contractRecovery(locSearchNewspapers, 'invalid_date_range');
    expect(error).toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
      data: {
        reason: 'invalid_date_range',
        field: 'date_start',
        date_start: 1930,
        date_end: 1900,
        recovery: { hint },
      },
    });
    const text = contentText(result);
    expect(text).toContain(`Recovery: ${hint}`);
    expect(text).toContain('reason invalid_date_range');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil
  it('forwards the most specific rate-limit hint on both surfaces: a fresh 429, then the running block (#44)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 }));
    vi.stubGlobal('fetch', fetchSpy);

    const fresh = await runToolContract(locSearchNewspapers, { query: 'news' });
    const freshError = wireError(fresh);
    expect(freshError).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'rate_limit_exceeded', retryable: false },
    });
    const freshHint = String(freshError.data?.recovery?.hint);
    expect(freshHint).toMatch(/1 hour/);
    expect(contentText(fresh)).toContain(`Recovery: ${freshHint}`);

    const blocked = await runToolContract(locSearchNewspapers, { query: 'news' });
    const blockedError = wireError(blocked);
    const blockedHint = String(blockedError.data?.recovery?.hint);
    expect(blockedError.data).toMatchObject({ reason: 'rate_limit_exceeded' });
    expect(blockedHint).toMatch(/60 more minute/);
    expect(contentText(blocked)).toContain(`Recovery: ${blockedHint}`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
