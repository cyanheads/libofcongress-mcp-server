/**
 * @fileoverview Tests for libofcongress_search_newspapers tool.
 * @module tests/tools/libofcongress-search-newspapers.tool.test
 */

import { z } from '@cyanheads/mcp-ts-core';
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
import {
  type DateBound,
  parseDateBound,
  resolveDateRange,
  yearBound,
} from '@/services/loc-api/date-range.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';
import {
  BOSTON_THROUGH_1769,
  LUSITANIA_1915_FACETS,
  LUSITANIA_1915_GERMAN,
  LUSITANIA_1915_KLINGON_EMPTY,
  TITANIC_1912_04_16,
  TITANIC_1912_SHORT_TITLE_EMPTY,
  TITANIC_1912_WASHINGTON_STATE,
} from '../fixtures/loc-newspaper-search.js';
import { TITANIC_OCR_EXCERPT } from '../fixtures/loc-text.js';
import { serveByHost } from '../helpers/loc-fetch.js';
import {
  contentText,
  contractRecovery,
  renderedContentText,
  structured,
  wireError,
} from '../helpers/tool-result.js';

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

/** The `dates` value of the one request a fetch stub received. */
function sentDates(fetchSpy: ReturnType<typeof vi.fn>): string | null {
  return new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('dates');
}

/** The parsed bound of a date the test expects to be valid, or undefined when it is unset. */
function parsedBound(value: number | string | undefined): DateBound | undefined {
  if (value === undefined) return undefined;
  const parsed = parseDateBound(value);
  if (!parsed.ok) throw new Error(`expected ${value} to parse: ${parsed.problem}`);
  return parsed.bound;
}

/** The `dates` value resolveDateRange gives for a range the test expects to be valid. */
function resolvedDates(start: DateBound | undefined, end: DateBound | undefined) {
  const range = resolveDateRange(start, end);
  if (!range.ok) throw new Error(range.message);
  return range.dates;
}

/** The `fa` value of the one request a fetch stub received. */
function sentFacets(fetchSpy: ReturnType<typeof vi.fn>): string | null {
  return new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('fa');
}

describe('locSearchNewspapers upstream text (#65)', () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    initLocApiService(config, await createInMemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fences each OCR excerpt and escapes markup in the catalog text, in content[] only', async () => {
    const excerpt = `${TITANIC_OCR_EXCERPT} \`\`\` run`;
    serveByHost({
      'www.loc.gov': {
        results: [
          {
            url: 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1',
            title: 'Image 1 of New-York tribune &lt;i&gt;',
            description: [excerpt],
            partof_title: ['new-york tribune &lt;b&gt; (new york [n.y.]) 1866-<1924>'],
            location_state: ['new york <x>'],
            date: '1912-04-16',
          },
        ],
        pagination: { of: 1, perpage: 25, pages: 1 },
      },
    });
    const result = await runToolContract(locSearchNewspapers, { query: 'titanic' });
    expect(structured(result).items).toEqual([
      {
        url: 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1',
        title: 'Image 1 of New-York tribune <i>',
        description: excerpt,
        newspaper_title: 'new-york tribune <b> (new york [n.y.]) 1866-<1924>',
        states: ['new york <x>'],
        date: '1912-04-16',
      },
    ]);
    const text = contentText(result);
    expect(text).toContain('\n## Image 1 of New-York tribune \\<i>\n');
    expect(text).toContain(
      '**Publication:** new-york tribune \\<b> (new york \\[n.y.\\]) 1866-<1924>\n',
    );
    expect(text).toContain('**States:** new york \\<x>\n');
    expect(text).toContain(`\n\`\`\`\`\n${excerpt}\n\`\`\`\`\n`);
    expect(text).toContain(
      '**URL:** https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1',
    );
  });
});

describe('locSearchNewspapers', () => {
  it.each([
    ['relevance', 1, 25, 200, false],
    ['date', 1, 25, 200, true],
    ['date_desc', 9, 1000, 404, true],
  ] as const)(
    'discloses %s on both surfaces at page %i',
    async (sort, page, limit, status, empty) => {
      const fetchSpy = mockFetch(makeNewspaperSearchResponse(empty ? { results: [] } : {}), status);
      vi.stubGlobal('fetch', fetchSpy);
      const result = await runToolContract(locSearchNewspapers, {
        query: 'train',
        sort,
        page,
        limit,
        state: 'OK',
        newspaper_title: 'full title',
        date_start: 1912,
        date_end: 1912,
      });
      expect(result.isError).not.toBe(true);
      expect(structured(result)).toMatchObject({ effectiveSort: sort, effectiveQuery: 'train' });
      expect(contentText(result)).toContain(sort);
      const url = new URL(String(fetchSpy.mock.calls[0]![0]));
      expect(url.searchParams.get('sb')).toBe(sort === 'relevance' ? null : sort);
      expect(url.searchParams.get('fa')).toBe('location_state:oklahoma|partof_title:full title');
      expect(url.searchParams.get('c')).toBe(limit > 100 ? '100' : String(limit));
      expect(url.searchParams.get('sp')).toBe(String(page));
      if (empty) expect(structured(result).items).toEqual([]);
    },
  );

  it('rejects invalid sort before making a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // Widen only the test driver's input so the real schema sees malformed client data.
    const result = await runToolContract<Parameters<typeof runToolContract>[0]>(
      locSearchNewspapers,
      {
        query: 'train',
        sort: 'title',
      },
    );
    expect(wireError(result).data?.reason).toBe('invalid_arguments');
    expect(contentText(result)).toContain('sort');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

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

  it('applies the state filter as a location_state facet, not location (#59)', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({ query: 'flood', state: 'texas' });
    await locSearchNewspapers.handler(input, ctx);

    expect(sentFacets(fetchSpy)).toBe('location_state:texas');
  });

  it('filters "washington" to Washington-state titles through location_state, on both surfaces (#59)', async () => {
    const fetchSpy = mockFetch(TITANIC_1912_WASHINGTON_STATE);
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runToolContract(locSearchNewspapers, {
      query: 'titanic',
      date_start: 1912,
      date_end: 1912,
      state: 'washington',
    });

    expect(sentFacets(fetchSpy)).toBe('location_state:washington');
    const sc = structured(result);
    expect(sc.total).toBe(477);
    expect((sc.items as Array<{ states: string[] }>).map((item) => item.states)).toEqual([
      ['washington'],
      ['washington'],
    ]);
    expect(contentText(result)).toContain(
      '**Publication:** the seattle star (seattle, wash.) 1899-1947',
    );
  });

  it.each([
    ['WA', 'washington'],
    ['wa', 'washington'],
    ['DC', 'district of columbia'],
    ['dc', 'district of columbia'],
    ['NY', 'new york'],
    ['pr', 'puerto rico'],
    ['VI', 'virgin islands'],
    ['  Washington ', 'washington'],
    ['New York', 'new york'],
    ['District of Columbia', 'district of columbia'],
    ['zz', 'zz'],
  ])('sends state %j as location_state:%s (#59)', async (state, name) => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);

    await runToolContract(locSearchNewspapers, { query: 'flood', state });

    expect(sentFacets(fetchSpy)).toBe(`location_state:${name}`);
  });

  it('sends newspaper_title unchanged as the partof_title facet, after the state facet (#59)', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);

    await runToolContract(locSearchNewspapers, {
      query: 'titanic',
      state: 'NY',
      newspaper_title: 'New-York Tribune (New York [N.Y.]) 1866-1924',
    });

    expect(sentFacets(fetchSpy)).toBe(
      'location_state:new york|partof_title:New-York Tribune (New York [N.Y.]) 1866-1924',
    );
  });

  // The rule is tabled at facetSegment (loc-api-service.test.ts); these prove each input reaches it.
  it.each([
    ['state', { state: 'ohio|texas' }],
    ['newspaper_title', { newspaper_title: 'evening star (washington, d.c.) 1854-1972|the sun' }],
    ['language', { language: 'german|english' }],
  ])(
    'refuses a %s value holding "|" before any request, naming the field on both surfaces',
    async (field, filter) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const result = await runToolContract(locSearchNewspapers, { query: 'lusitania', ...filter });

      const error = wireError(result);
      const hint = contractRecovery(locSearchNewspapers, 'invalid_filter_value');
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.ValidationError,
        message: `The ${field} value cannot contain "|", which the Library of Congress reads as a separator between filters.`,
        data: { reason: 'invalid_filter_value', field, retryable: false, recovery: { hint } },
      });
      expect(renderedContentText(result)).toContain(`Recovery: ${hint}`);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('names the exact-title requirement when a newspaper_title search comes back empty, on both surfaces (#59)', async () => {
    vi.stubGlobal('fetch', mockFetch(TITANIC_1912_SHORT_TITLE_EMPTY));

    const result = await runToolContract(locSearchNewspapers, {
      query: 'titanic',
      date_start: 1912,
      date_end: 1912,
      newspaper_title: 'New-York Tribune',
    });

    expect(result.isError).toBeFalsy();
    const sc = structured(result);
    expect(sc).toMatchObject({ items: [], total: 0, totalCount: 0 });
    const notice = String(sc.notice);
    expect(notice).toContain('No newspaper pages matched "titanic" in dates 1912–1912');
    expect(notice).toContain('newspaper_title "New-York Tribune"');
    expect(notice).toContain(
      "newspaper_title matches only a newspaper's full catalog title, exactly as the newspaper_title field of a libofcongress_search_newspapers result gives it",
    );
    expect(notice).toContain('"new-york tribune (new york [n.y.]) 1866-1924"');
    expect(renderedContentText(result)).toContain(notice);
  });

  it('leaves the title requirement out of an empty-result notice when no newspaper_title was set (#59)', async () => {
    vi.stubGlobal('fetch', mockFetch(TITANIC_1912_SHORT_TITLE_EMPTY));

    const result = await runToolContract(locSearchNewspapers, { query: 'titanic', state: 'wa' });

    const notice = String(structured(result).notice);
    expect(notice).toContain('in state "wa"');
    expect(notice).not.toContain('newspaper_title');
  });

  it('describes state and newspaper_title by the values LOC matches (#59)', () => {
    const schema = z.toJSONSchema(locSearchNewspapers.input) as {
      properties: Record<string, { description?: string }>;
    };
    const state = String(schema.properties.state!.description);
    expect(state).toMatch(/postal code/i);
    expect(state).toContain('"district of columbia"');
    const title = String(schema.properties.newspaper_title!.description);
    expect(title).not.toMatch(/partial/i);
    expect(title).toContain('newspaper_title');
    expect(title).toContain('"new-york tribune (new york [n.y.]) 1866-1924"');
  });

  it('calls the excerpt the page opening and points to match on get_newspaper_page (#73)', () => {
    expect(locSearchNewspapers.description).toMatch(
      /first lines, not the text around the match.*libofcongress_get_newspaper_page.*this query as its match/,
    );
    const row = locSearchNewspapers.output.shape.items.element.shape.description;
    expect(String(row.description)).toMatch(/^Opening of the page's OCR text.*as match/);
  });

  describe('language filter and facets (#91)', () => {
    /** One facet's values from a captured body, as the tool should return them. */
    const capturedFacet = (body: string, type: string) =>
      (
        JSON.parse(body) as {
          facets: { type: string; filters: { value: string; count: number }[] }[];
        }
      ).facets
        .find((facet) => facet.type === type)!
        .filters.map(({ value, count }) => ({ value, count }));

    it('sends language trimmed, after the state and title facets, case as given', async () => {
      const fetchSpy = mockFetch(LUSITANIA_1915_GERMAN);
      vi.stubGlobal('fetch', fetchSpy);

      await runToolContract(locSearchNewspapers, {
        query: 'lusitania',
        state: 'OH',
        newspaper_title: 'tägliches cincinnatier volksblatt (cincinnati [ohio]) 1885-1919',
        language: '  German ',
      });

      expect(sentFacets(fetchSpy)).toBe(
        'location_state:ohio|partof_title:tägliches cincinnatier volksblatt (cincinnati [ohio]) 1885-1919|language:German',
      );
    });

    it.each(['', '   '])(
      'treats language %j as unset, never sending language:',
      async (language) => {
        const fetchSpy = mockFetch(makeNewspaperSearchResponse());
        vi.stubGlobal('fetch', fetchSpy);

        await runToolContract(locSearchNewspapers, { query: 'fire', language });

        expect(sentFacets(fetchSpy)).toBeNull();
      },
    );

    it("returns each row's languages on both surfaces, a row without them validating", async () => {
      const captured = (JSON.parse(LUSITANIA_1915_GERMAN) as { results: object[] }).results;
      const { language: _dropped, ...sparse } = captured[0] as Record<string, unknown>;
      vi.stubGlobal(
        'fetch',
        mockFetch(
          JSON.stringify({ results: [...captured, sparse], pagination: { of: 3, perpage: 25 } }),
        ),
      );

      const result = await runToolContract(locSearchNewspapers, {
        query: 'lusitania',
        language: 'german',
      });

      expect(result.isError).toBeFalsy();
      const items = structured(result).items as Array<Record<string, unknown>>;
      expect(items.map((item) => item.languages)).toEqual([
        ['german'],
        ['english', 'german'],
        undefined,
      ]);
      expect(items[2]).not.toHaveProperty('languages');
      const text = contentText(result);
      expect(text).toContain('**Languages:** german\n');
      expect(text).toContain('**Languages:** english, german\n');
      expect(text.match(/\*\*Languages:\*\*/g)).toHaveLength(2);
    });

    it('requests the facet block when include_facets is true and returns the three facet lists on both surfaces', async () => {
      const fetchSpy = mockFetch(LUSITANIA_1915_FACETS);
      vi.stubGlobal('fetch', fetchSpy);

      const result = await runToolContract(locSearchNewspapers, {
        query: 'lusitania',
        date_start: '1915-05-07',
        date_end: '1915-05-09',
        include_facets: true,
      });

      expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('at')).toBe(
        'results,pagination,facets',
      );
      const sc = structured(result);
      expect(sc.newspaper_title_facets).toEqual(
        capturedFacet(LUSITANIA_1915_FACETS, 'partof_title'),
      );
      expect(sc.state_facets).toEqual(capturedFacet(LUSITANIA_1915_FACETS, 'location_state'));
      expect(sc.language_facets).toEqual(capturedFacet(LUSITANIA_1915_FACETS, 'language'));
      const rendered = renderedContentText(result);
      expect(rendered).toContain(
        'Top newspaper titles: world war history : daily records and comments as appeared in american and foreign newspapers, 1914-1926 (new york) 1928- (153); evening star (washington, d.c.) 1854-1972 (23); new-york tribune (new york [n.y.]) 1866-1924 (21);',
      );
      expect(rendered).toContain(
        'Top states: new york (191); district of columbia (47); alabama (39);',
      );
      expect(rendered).toContain(
        'Top languages: english (498); german (52); polish (4); spanish (4); italian (2); lithuanian (2)',
      );
    });

    it('by default sends results and pagination only and carries no facet fields on either surface', async () => {
      const fetchSpy = mockFetch(LUSITANIA_1915_FACETS);
      vi.stubGlobal('fetch', fetchSpy);

      const result = await runToolContract(locSearchNewspapers, { query: 'lusitania' });

      expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('at')).toBe(
        'results,pagination',
      );
      const sc = structured(result);
      for (const key of ['newspaper_title_facets', 'state_facets', 'language_facets']) {
        expect(sc).not.toHaveProperty(key);
      }
      expect(contentText(result)).not.toMatch(/Top (newspaper titles|states|languages)/);
    });

    it('returns the three facet lists empty on an out-of-range page', async () => {
      vi.stubGlobal('fetch', mockFetch(JSON.stringify({ exception: 'not found' }), 404));

      const sc = structured(
        await runToolContract(locSearchNewspapers, {
          query: 'lusitania',
          include_facets: true,
          page: 9,
        }),
      );

      expect(sc).toMatchObject({
        items: [],
        pages: 0,
        newspaper_title_facets: [],
        state_facets: [],
        language_facets: [],
      });
      expect(String(sc.notice)).toContain('Page 9 is out of range');
    });

    it('names a language that matches nothing in the empty-result notice, with empty facet lists, on both surfaces', async () => {
      vi.stubGlobal('fetch', mockFetch(LUSITANIA_1915_KLINGON_EMPTY));

      const result = await runToolContract(locSearchNewspapers, {
        query: 'lusitania',
        date_start: '1915-05-07',
        date_end: '1915-05-09',
        language: 'klingon',
        include_facets: true,
      });

      const sc = structured(result);
      expect(sc).toMatchObject({
        items: [],
        total: 0,
        newspaper_title_facets: [],
        state_facets: [],
        language_facets: [],
      });
      expect(sc.notice).toBe(
        'No newspaper pages matched "lusitania" in dates 1915-05-07–1915-05-09 in language "klingon". Try broadening the date range, removing the language filter, or using different keywords. Historical OCR is approximate — variant spellings are common.',
      );
      expect(renderedContentText(result)).toContain(String(sc.notice));
    });

    it('names the language filter in the out-of-range notice', async () => {
      vi.stubGlobal('fetch', mockFetch(JSON.stringify({ exception: 'not found' }), 404));

      const sc = structured(
        await runToolContract(locSearchNewspapers, {
          query: 'lusitania',
          language: 'german',
          page: 9,
        }),
      );

      expect(String(sc.notice)).toContain(
        'Page 9 is out of range for "lusitania" in language "german".',
      );
    });

    it('format() renders the three facet lists and each row’s languages', () => {
      const output = locSearchNewspapers.output.parse({
        items: [
          {
            url: 'https://www.loc.gov/resource/sn83045081/1915-05-08/ed-1/?sp=6&q=lusitania',
            title: 'Image 6 of Der Deutsche correspondent (Baltimore, Md.), May 8, 1915',
            languages: ['english', 'german'],
          },
        ],
        total: 71,
        page: 1,
        pages: 1,
        has_next: false,
        newspaper_title_facets: [
          { value: 'der deutsche correspondent (baltimore, md.) 1841-1918', count: 4 },
        ],
        state_facets: [{ value: 'maryland', count: 4 }],
        language_facets: [
          { value: 'german', count: 71 },
          { value: 'english', count: 40 },
        ],
      });
      const text = (locSearchNewspapers.format!(output)[0] as { type: 'text'; text: string }).text;
      expect(text).toContain(
        '**Top newspaper titles:** der deutsche correspondent (baltimore, md.) 1841-1918 (4)\n',
      );
      expect(text).toContain('**Top states:** maryland (4)\n');
      expect(text).toContain('**Top languages:** german (71); english (40)\n');
      expect(text).toContain('**Languages:** english, german\n');
    });
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

  // The date grammar — bound parsing, open-side fills, range checks — is tabled in
  // date-range.test.ts; the tests below prove the tool parses each bound, sends the range
  // resolveDateRange gives, and fails before any request when it gives none.
  it('sends a lone date_end as the range resolveDateRange gives it, on both surfaces (#60)', async () => {
    const fetchSpy = mockFetch(BOSTON_THROUGH_1769);
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runToolContract(locSearchNewspapers, { query: 'boston', date_end: 1769 });

    expect(sentDates(fetchSpy)).toBe(resolvedDates(undefined, yearBound(1769)));
    const sc = structured(result);
    expect(sc.total).toBe(1075);
    const dates = (sc.items as Array<{ date: string }>).map((item) => item.date);
    expect(dates).toEqual(['1768-04-22', '1769-02-03']);
    expect(contentText(result)).toContain('**Date:** 1768-04-22');
  });

  it('sends a lone date_start as the range resolveDateRange gives it (#60)', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);

    await runToolContract(locSearchNewspapers, { query: 'boston', date_start: 1970 });

    expect(sentDates(fetchSpy)).toBe(resolvedDates(yearBound(1970), undefined));
  });

  it('rejects a lone date_start after the current year as invalid_date_range before any request (#60)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const currentYear = new Date().getFullYear();

    const result = await runToolContract(locSearchNewspapers, {
      query: 'boston',
      date_start: currentYear + 4,
    });

    const error = wireError(result);
    const hint = contractRecovery(locSearchNewspapers, 'invalid_date_range');
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

  it('searches a single issue date given as YYYY-MM-DD strings, on both surfaces (#61)', async () => {
    const fetchSpy = mockFetch(TITANIC_1912_04_16);
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runToolContract(locSearchNewspapers, {
      query: 'titanic',
      date_start: '1912-04-16',
      date_end: '1912-04-16',
    });

    expect(result.isError).toBeFalsy();
    expect(sentDates(fetchSpy)).toBe('1912-04-16/1912-04-16');
    const sc = structured(result);
    expect(sc.total).toBe(280);
    expect((sc.items as Array<{ date: string }>).map((item) => item.date)).toEqual([
      '1912-04-16',
      '1912-04-16',
    ]);
    expect(contentText(result)).toContain('**Date:** 1912-04-16');
  });

  it.each([
    [{ date_start: '1912-4-6', date_end: '1912-4-16' }],
    [{ date_start: 1912, date_end: '1912-4' }],
  ])('sends %j as the range of its parsed bounds (#61)', async (dates) => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runToolContract(locSearchNewspapers, { query: 'titanic', ...dates });

    expect(result.isError).toBeFalsy();
    expect(sentDates(fetchSpy)).toBe(
      resolvedDates(parsedBound(dates.date_start), parsedBound(dates.date_end)),
    );
  });

  it.each([
    ['date_start', '1912-02-30'],
    ['date_end', '1912-13'],
  ] as const)(
    'rejects an impossible %s %s as invalid_date before any request (#61)',
    async (field, value) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const parsed = parseDateBound(value);
      if (parsed.ok) throw new Error(`expected ${value} to fail parsing`);

      const result = await runToolContract(locSearchNewspapers, { query: 'snow', [field]: value });

      const error = wireError(result);
      const hint = contractRecovery(locSearchNewspapers, 'invalid_date');
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.ValidationError,
        data: { reason: 'invalid_date', field, [field]: value, recovery: { hint } },
      });
      expect(error.message).toBe(
        `${field} ("${value}") is not a calendar date: ${parsed.problem}.`,
      );
      const text = contentText(result);
      expect(text).toContain(error.message);
      expect(text).toContain(`Recovery: ${hint}`);
      expect(text).toContain('reason invalid_date');
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('treats a blank date_start/date_end (form-client payload) as unset (#61)', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runToolContract(locSearchNewspapers, {
      query: 'fire',
      date_start: '',
      date_end: '',
    });

    expect(result.isError).toBeFalsy();
    expect(sentDates(fetchSpy)).toBeNull();
  });

  it('rejects date strings outside the three forms at the schema, and advertises the pattern (#61)', () => {
    for (const value of ['1912/04/16', 'April 1912', '12-04-1912', '1912-04-16T00:00', '19120']) {
      expect(() => locSearchNewspapers.input.parse({ query: 'x', date_start: value })).toThrow();
    }
    expect(() => locSearchNewspapers.input.parse({ query: 'x', date_end: 1912.5 })).toThrow();

    const schema = z.toJSONSchema(locSearchNewspapers.input) as {
      properties: Record<string, { anyOf?: Array<{ type?: string; pattern?: string }> }>;
    };
    for (const field of ['date_start', 'date_end']) {
      const variants = schema.properties[field]!.anyOf!;
      expect(variants).toContainEqual(expect.objectContaining({ type: 'integer' }));
      const pattern = variants.find((v) => v.type === 'string' && v.pattern)?.pattern;
      expect(pattern).toBeDefined();
      expect(new RegExp(pattern!).test('1912-4-16')).toBe(true);
      expect(new RegExp(pattern!).test('1912/04/16')).toBe(false);
    }
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

  it.each([
    [
      'dates only',
      { date_start: 1888, date_end: 1889 },
      'Try broadening the date range or using different keywords.',
    ],
    [
      'state and dates',
      { state: 'ny', date_start: 1888, date_end: 1889 },
      'Try broadening the date range, removing the state filter, or using different keywords.',
    ],
    ['state only', { state: 'ny' }, 'Try removing the state filter or using different keywords.'],
    ['no filter', {}, 'Try using different keywords.'],
  ])(
    'advises loosening only the filters an empty search set — %s, on both surfaces',
    async (_name, filters, advice) => {
      vi.stubGlobal(
        'fetch',
        mockFetch(
          makeNewspaperSearchResponse({
            results: [],
            pagination: { total: 0, perpage: 25, pages: 0 },
          }),
        ),
      );

      const result = await runToolContract(locSearchNewspapers, { query: 'blizzard', ...filters });

      const notice = String(structured(result).notice);
      expect(notice).toContain(advice);
      if (!('state' in filters)) expect(notice).not.toContain('state');
      if (!('date_start' in filters)) expect(notice).not.toContain('date range');
      expect(renderedContentText(result)).toContain(notice);
    },
  );

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

  it('accepts limit up to 1000 and rejects limit=1001 at schema level (hard ceiling)', () => {
    expect(locSearchNewspapers.input.parse({ query: 'test', limit: 1000 }).limit).toBe(1000);
    expect(() => locSearchNewspapers.input.parse({ query: 'test', limit: 1001 })).toThrow();
  });

  it('serves a limit above 100 as a 100-result page, combining the clamp and ceiling notices on both surfaces', async () => {
    const fetchSpy = mockFetch(
      makeNewspaperSearchResponse({ pagination: { of: 22814055, total: 228141, perpage: 100 } }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runToolContract(locSearchNewspapers, { query: 'the', limit: 150 });

    expect(new URL(fetchSpy.mock.calls[0]![0] as string).searchParams.get('c')).toBe('100');
    const sc = structured(result);
    expect(sc).toMatchObject({ page: 1, pages: 1000, has_next: true, effectiveLimit: 100 });
    const notice = String(sc.notice);
    expect(notice).toMatch(
      /^Requested limit 150 exceeds the per-call cap of 100; this page holds up to 100 results, and page numbers count 100-result pages\. Request page 2 with limit 100 for the next results\. /,
    );
    expect(notice).toContain('LOC pages through only the first ~100,000');
    expect(renderedContentText(result)).toContain(notice);
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
    expect(renderedContentText(result)).toContain(String(sc.notice));
  });

  it.each([
    [400, 1],
    [400, 8],
    [520, 1],
  ])(
    'fails HTTP %i on page %i (within the ceiling) as upstream_unavailable carrying the status, on both surfaces (#86)',
    async (status, page) => {
      vi.stubGlobal('fetch', mockFetch('', status));
      const result = await runToolContract(locSearchNewspapers, { query: 'blizzard', page });

      const error = wireError(result);
      const hint = contractRecovery(locSearchNewspapers, 'upstream_unavailable');
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: { reason: 'upstream_unavailable', status, recovery: { hint } },
      });
      const text = contentText(result);
      expect(text).toContain(`Recovery: ${hint}`);
      expect(text).not.toMatch(/No newspaper pages matched|out of range/);
    },
  );

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
    expect(renderedContentText(result)).toContain(notice);
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
