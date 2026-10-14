/**
 * @fileoverview Tests for libofcongress_get_newspaper_page tool.
 * @module tests/tools/libofcongress-get-newspaper-page.tool.test
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
import { locGetItem } from '@/mcp-server/tools/definitions/libofcongress-get-item.tool.js';
import { locGetNewspaperPage } from '@/mcp-server/tools/definitions/libofcongress-get-newspaper-page.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';
import { MANUSCRIPT_ITEM_MM77093930 } from '../fixtures/loc-items.js';
import {
  BOOK_PAGE_11,
  BOOK_PAGE_11_TEXT,
  MANUSCRIPT_PAGE_3,
  MANUSCRIPT_PAGE_3_TEXT,
  MANUSCRIPT_PAGE_4,
  MANUSCRIPT_PAGE_4_TEXT,
  NEWSPAPER_ED2_PAGE_2,
  NEWSPAPER_PAGE_1,
} from '../fixtures/loc-pages.js';
import { TITANIC_OCR_EXCERPT } from '../fixtures/loc-text.js';
import { serveByHost } from '../helpers/loc-fetch.js';
import { contentText, contractRecovery, structured, wireError } from '../helpers/tool-result.js';

const PAGE_URL = 'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/?sp=1';

/**
 * The `item` block of a `?fo=json&at=item,resource` page response, keyed and shaped as LOC
 * sends it: facets are arrays, `place_of_publication` a plain string.
 */
const PAGE_ITEM = {
  newspaper_title: ['The daily Oklahoman'],
  partof_title: ['the daily oklahoman (oklahoma city, okla.) 1894-current'],
  location_state: ['oklahoma'],
  place_of_publication: 'Oklahoma City, Okla.',
  number_edition: ['1'],
  date_issued: '1900-01-01',
};

const PAGE_TEXT_SERVICE =
  'https://tile.loc.gov/text-services/word-coordinates-service?segment=%2Ffiles%2Fsn84026749%2F1900-01-01%2Fed-1%2Fseq-1&format=alto_xml&full_text=1';

/**
 * The service makes two fetches when the page response carries `fulltext_service`:
 * 1. Page JSON — the `item` block (publication metadata), the `resource` block (segment_count),
 *    and the top-level `fulltext_service` (the page's text service)
 * 2. tile.loc.gov JSON for the text (shape: { "<key>": { full_text: "..." } })
 *
 * fetchSpy is called sequentially; we alternate responses via mockImplementation.
 * `overrides` patch the resource block, except `fulltext_service`, which is top-level as LOC
 * sends it (pass `fulltext_service: undefined` for a page without text). Pass `item: null` to
 * omit the item block. On a newspaper page `resource.fulltext_file` is the same URL.
 */
function makeResourceResponse(
  overrides: Record<string, unknown> = {},
  item: Record<string, unknown> | null = PAGE_ITEM,
) {
  const { fulltext_service, ...resource } = { fulltext_service: PAGE_TEXT_SERVICE, ...overrides };
  return JSON.stringify({
    ...(item && { item }),
    resource: {
      url: 'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/',
      segment_count: 8,
      fulltext_file: PAGE_TEXT_SERVICE,
      ...resource,
    },
    ...(fulltext_service !== undefined && { fulltext_service }),
  });
}

/** tile.loc.gov returns JSON, not ALTO XML. */
const OCR_JSON = JSON.stringify({
  '/service/ndnp/batch/0088.xml': { full_text: 'Hello World', height: 1000, width: 800 },
});

function mockFetchSequence(...responses: Array<{ body: string; status?: number }>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const { body, status = 200 } = responses[callIndex % responses.length] ?? { body: '' };
    callIndex++;
    return Promise.resolve(
      new Response(body, { status, headers: { 'Content-Type': 'application/json' } }),
    );
  });
}

describe('locGetNewspaperPage upstream text (#65)', () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    initLocApiService(config, await createInMemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Serves `PAGE_URL` with the item block `item` and its text service with `ocr`. */
  function servePage(item: Record<string, unknown>, ocr: string) {
    serveByHost({
      'www.loc.gov': JSON.parse(makeResourceResponse({}, item)),
      'tile.loc.gov': { '/0001.xml': { full_text: ocr } },
    });
  }

  it('fences the OCR text: the fenced text is ocr_text, and nothing in it reads as Markdown', async () => {
    servePage(PAGE_ITEM, TITANIC_OCR_EXCERPT);
    const result = await runToolContract(locGetNewspaperPage, { page_url: PAGE_URL });
    expect(structured(result).ocr_text).toBe(TITANIC_OCR_EXCERPT);
    expect(contentText(result)).toContain(`\n\`\`\`\n${TITANIC_OCR_EXCERPT}\n\`\`\``);
  });

  it('escapes markup in the publication metadata in content[] only', async () => {
    servePage(
      {
        ...PAGE_ITEM,
        newspaper_title: ['The &lt;b&gt;daily&lt;/b&gt; Oklahoman'],
        place_of_publication: 'Oklahoma City,\r\nOkla. <Indian Terr.>',
        location_state: ['oklahoma <i>'],
        number_edition: ['1 <x>'],
      },
      'Text.',
    );
    const result = await runToolContract(locGetNewspaperPage, { page_url: PAGE_URL });
    expect(structured(result)).toMatchObject({
      newspaper_title: 'The <b>daily</b> Oklahoman',
      place_of_publication: 'Oklahoma City,\r\nOkla. <Indian Terr.>',
      states: ['oklahoma <i>'],
      edition: '1 <x>',
    });
    const text = contentText(result);
    expect(text).toContain('# The \\<b>daily\\</b> Oklahoman\n');
    expect(text).toContain('**Place of publication:** Oklahoma City, Okla. \\<Indian Terr.>\n');
    expect(text).toContain('**States:** oklahoma \\<i>\n');
    expect(text).toContain('**Edition:** 1 \\<x>\n');
    expect(text).toContain(`**URL:** ${PAGE_URL}\n`);
  });
});

describe('locGetNewspaperPage', () => {
  beforeEach(async () => {
    // A test that forgets its stub fails here instead of reaching LOC, which blocks for an hour.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unmocked fetch')));
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns page metadata and OCR text when fulltext_service is present', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({ body: makeResourceResponse() }, { body: OCR_JSON }));
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    const result = await locGetNewspaperPage.handler(input, ctx);

    expect(result.page_url).toBe(PAGE_URL);
    expect(result.newspaper_title).toBe('The daily Oklahoman');
    expect(result.date).toBe('1900-01-01');
    expect(result.states).toEqual(['oklahoma']);
    expect(result.place_of_publication).toBe('Oklahoma City, Okla.');
    expect(result.edition).toBe('1');
    expect(result.segment_count).toBe(8);
    expect(result.sequence).toBe(1);
    expect(result.ocr_available).toBe(true);
    expect(result.ocr_text).toContain('Hello');
    expect(result.ocr_text).toContain('World');
  });

  it('derives date and sequence from page_url when the resource omits them', async () => {
    // The resource block never carries date or sequence; with no item block to supply the date,
    // both come from the page URL (#28).
    vi.stubGlobal(
      'fetch',
      mockFetchSequence({
        body: makeResourceResponse({ fulltext_service: undefined, fulltext_file: undefined }, null),
      }),
    );
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({
      page_url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=12&q=titanic',
    });
    const result = await locGetNewspaperPage.handler(input, ctx);

    expect(result.date).toBe('1912-04-18');
    expect(result.sequence).toBe(12);
  });

  it('marks ocr_available false and returns empty ocr_text when fulltext_service is absent', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchSequence({
        body: makeResourceResponse({ fulltext_service: undefined, fulltext_file: undefined }),
      }),
    );
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    const result = await locGetNewspaperPage.handler(input, ctx);

    expect(result.ocr_available).toBe(false);
    expect(result.ocr_text).toBe('');
  });

  it('still returns page metadata and discloses the OCR retrieval miss when OCR fetch fails (graceful degradation)', async () => {
    // First call: resource JSON; second call: OCR fetch errors
    vi.stubGlobal(
      'fetch',
      mockFetchSequence({ body: makeResourceResponse() }, { body: 'Service error', status: 503 }),
    );
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    const result = await locGetNewspaperPage.handler(input, ctx);

    expect(result.ocr_available).toBe(true);
    expect(result.ocr_text).toBe(''); // OCR unavailable but not an error
    expect(result.newspaper_title).toBe('The daily Oklahoman');
    // The retrieval-miss fact now rides ctx.enrich.notice, reaching structuredContent (notice
    // field) and content[] (enrichment trailer) identically — a structured-only client is no
    // longer blind to it, since the bare ocr_available:true/ocr_text:"" shape is ambiguous. #31
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(String(enrichment.notice)).toContain('OCR');
  });

  it('NotFound data carries the caller-facing page URL, not the internal request URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    const err = await Promise.resolve(locGetNewspaperPage.handler(input, ctx)).catch(
      (e: unknown) => e,
    );

    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    // The caller's own URL is fine to echo; the service's `?fo=json&at=resource` build is not.
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect(data.pageUrl).toBe(PAGE_URL);
  });

  it('ServiceUnavailable from an HTML body does not leak the internal request URL', async () => {
    // The catch block remaps only NotFound and RateLimited, so this bubbles unchanged —
    // it only stays clean if the service never attaches the URL in the first place.
    vi.stubGlobal(
      'fetch',
      mockFetchSequence({ body: '<!DOCTYPE html><html><body>Rate limited</body></html>' }),
    );
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    const err = await Promise.resolve(locGetNewspaperPage.handler(input, ctx)).catch(
      (e: unknown) => e,
    );

    expect(err).toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect((err as Error).message).not.toContain('www.loc.gov');
  });

  it('appends ?fo=json when URL has no existing query', async () => {
    const fetchSpy = mockFetchSequence({
      body: makeResourceResponse({ fulltext_service: undefined, fulltext_file: undefined }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const bareUrl = 'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/';
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: bareUrl });
    await locGetNewspaperPage.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('fo=json');
  });

  it('format() renders title, URL, date, states, place, edition, sequence, page count, and OCR text', () => {
    const output = locGetNewspaperPage.output.parse({
      page_url: PAGE_URL,
      newspaper_title: 'The daily Oklahoman',
      date: '1900-01-01',
      states: ['oklahoma'],
      place_of_publication: 'Oklahoma City, Okla.',
      edition: '1',
      sequence: 1,
      segment_count: 8,
      ocr_text: 'Train derailment near Guthrie.',
      ocr_available: true,
    });
    const blocks = locGetNewspaperPage.format!(output);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('# The daily Oklahoman');
    expect(text).toContain(PAGE_URL);
    expect(text).toContain('**Date:** 1900-01-01');
    expect(text).toContain('**States:** oklahoma');
    expect(text).toContain('**Place of publication:** Oklahoma City, Okla.');
    expect(text).toContain('**Edition:** 1');
    expect(text).toContain('**Sequence:** 1 of 8');
    expect(text).toContain('Train derailment');
    expect(text).toContain('Yes');
  });

  it('pins the populated item block on both surfaces for the Southern Christian Advocate page (#42)', async () => {
    // Live shape of sn87065702/1927-06-16/ed-1/?sp=10 under at=item,resource.
    vi.stubGlobal(
      'fetch',
      mockFetchSequence(
        {
          body: makeResourceResponse(
            {
              url: 'https://www.loc.gov/resource/sn87065702/1927-06-16/ed-1/',
              segment_count: 16,
            },
            {
              title: 'Southern Christian advocate (Charleston, S.C.), June 16, 1927',
              newspaper_title: ['Southern Christian advocate'],
              partof_title: ['southern christian advocate (charleston, s.c.) 1837-1948'],
              location_state: ['georgia', 'south carolina'],
              place_of_publication: 'Charleston, S.C.',
              number_edition: ['1'],
              date_issued: '1927-06-16',
            },
          ),
        },
        { body: OCR_JSON },
      ),
    );
    const pageUrl = 'https://www.loc.gov/resource/sn87065702/1927-06-16/ed-1/?sp=10';
    const result = await runToolContract(locGetNewspaperPage, { page_url: pageUrl });

    expect(result.isError).toBeFalsy();
    const sc = structured(result);
    expect(sc).toMatchObject({
      page_url: pageUrl,
      newspaper_title: 'Southern Christian advocate',
      date: '1927-06-16',
      states: ['georgia', 'south carolina'],
      place_of_publication: 'Charleston, S.C.',
      edition: '1',
      sequence: 10,
      segment_count: 16,
      ocr_text: 'Hello World',
      ocr_available: true,
    });
    expect(sc).not.toHaveProperty('state');
    const text = contentText(result);
    expect(text).toContain('# Southern Christian advocate');
    expect(text).toContain('**States:** georgia, south carolina');
    expect(text).toContain('**Place of publication:** Charleston, S.C.');
    expect(text).toContain('**Edition:** 1');
    expect(text).toContain('**Sequence:** 10 of 16');
    expect(text).not.toContain('**State:**');
  });

  it.each([
    { name: 'an empty item block', item: {} },
    {
      name: 'an item block with empty facets',
      item: { newspaper_title: [], partof_title: [], location_state: [], number_edition: [] },
    },
    { name: 'no item block', item: null },
  ])('degrades to URL fallbacks on both surfaces for $name (#42)', async ({ item }) => {
    vi.stubGlobal(
      'fetch',
      mockFetchSequence({
        body: makeResourceResponse(
          { fulltext_service: undefined, fulltext_file: undefined, segment_count: undefined },
          item,
        ),
      }),
    );
    const pageUrl = 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=12';
    const result = await runToolContract(locGetNewspaperPage, { page_url: pageUrl });

    expect(result.isError).toBeFalsy();
    expect(structured(result)).toEqual({
      page_url: pageUrl,
      date: '1912-04-18',
      sequence: 12,
      ocr_text: '',
      ocr_available: false,
    });
    const text = contentText(result);
    expect(text).toContain('**Date:** 1912-04-18');
    expect(text).toContain('**Sequence:** 12');
    expect(text).not.toContain(' of ');
    for (const label of ['States:', 'Place of publication:', 'Edition:']) {
      expect(text).not.toContain(label);
    }
  });

  it('format() notes image-only digitization when ocr_available is false', () => {
    const output = locGetNewspaperPage.output.parse({
      page_url: PAGE_URL,
      ocr_text: '',
      ocr_available: false,
    });
    const blocks = locGetNewspaperPage.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No');
    expect(text).toContain('image-only');
  });

  it('strips q= param from page_url before constructing resource URL', async () => {
    const fetchSpy = mockFetchSequence({
      body: makeResourceResponse({ fulltext_service: undefined, fulltext_file: undefined }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const urlWithQ = 'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/?sp=1&q=election';
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: urlWithQ });
    await locGetNewspaperPage.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).not.toContain('q=election');
    expect(calledUrl).toContain('sp=1');
  });

  it('uses fulltext_service directly as OCR fetch URL (no double-encoding)', async () => {
    const fetchSpy = mockFetchSequence({ body: makeResourceResponse() }, { body: OCR_JSON });
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    await locGetNewspaperPage.handler(input, ctx);

    const ocrFetchUrl = (fetchSpy.mock.calls[1]![0] as string) ?? '';
    // Should fetch the fulltext_service URL directly (tile.loc.gov)
    expect(ocrFetchUrl).toContain('tile.loc.gov');
    // Should NOT be double-encoded (the old bug wrapped the full URL in a segment= param)
    expect(ocrFetchUrl).not.toContain('segment=https');
  });

  it('emits the OCR retrieval-miss notice only when ocr_available is true and ocr_text is empty (#31)', async () => {
    // Retrieval miss (fulltext_service present, OCR fetch fails) → notice present.
    vi.stubGlobal(
      'fetch',
      mockFetchSequence({ body: makeResourceResponse() }, { body: 'err', status: 503 }),
    );
    let ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    await locGetNewspaperPage.handler(locGetNewspaperPage.input.parse({ page_url: PAGE_URL }), ctx);
    expect(getEnrichment(ctx).notice).toBeDefined();

    // OCR text present → no notice; the text speaks for itself.
    vi.stubGlobal('fetch', mockFetchSequence({ body: makeResourceResponse() }, { body: OCR_JSON }));
    ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    await locGetNewspaperPage.handler(locGetNewspaperPage.input.parse({ page_url: PAGE_URL }), ctx);
    expect(getEnrichment(ctx).notice).toBeUndefined();

    // Image-only page (ocr_available false) → no notice; that state is already honest in
    // structuredContent via ocr_available:false, so no disclosure is needed.
    vi.stubGlobal(
      'fetch',
      mockFetchSequence({
        body: makeResourceResponse({ fulltext_service: undefined, fulltext_file: undefined }),
      }),
    );
    ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    await locGetNewspaperPage.handler(locGetNewspaperPage.input.parse({ page_url: PAGE_URL }), ctx);
    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('format() carries no retrieval-miss prose (the fact rides enrichment, not format) (#31)', () => {
    // format() renders the domain payload only; the retrieval-miss disclosure is enrichment, so
    // it must not also appear here (that would double it on content[] under the enrichment trailer).
    const output = locGetNewspaperPage.output.parse({
      page_url: PAGE_URL,
      ocr_text: '',
      ocr_available: true,
    });
    const blocks = locGetNewspaperPage.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('**OCR available:** Yes');
    expect(text).not.toContain('could not be retrieved');
  });

  describe('per-page text from fulltext_service (#64)', () => {
    /**
     * Serves www.loc.gov page requests from `pages` (keyed by `sp`) and tile.loc.gov text
     * requests from `texts` (keyed by the text-service `segment`). Anything else rejects.
     */
    function route(
      pages: Record<string, unknown>,
      texts: Record<string, string>,
      textContentType = 'application/json',
    ) {
      const spy = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.hostname === 'www.loc.gov') {
          const page = pages[url.searchParams.get('sp') ?? ''];
          if (page) return new Response(JSON.stringify(page), { status: 200 });
        }
        if (url.hostname === 'tile.loc.gov') {
          const text = texts[url.searchParams.get('segment') ?? ''];
          if (text !== undefined)
            return new Response(text, { headers: { 'Content-Type': textContentType } });
        }
        throw new Error(`unmocked fetch ${url.hostname}${url.pathname}`);
      });
      vi.stubGlobal('fetch', spy);
      return spy;
    }
    const segment = (serviceUrl: string) => new URL(serviceUrl).searchParams.get('segment')!;

    it("reads a manuscript page's own transcription, never the whole-volume file, on both surfaces", async () => {
      const spy = route(
        { '3': MANUSCRIPT_PAGE_3, '4': MANUSCRIPT_PAGE_4 },
        {
          [segment(MANUSCRIPT_PAGE_3.fulltext_service)]: MANUSCRIPT_PAGE_3_TEXT,
          [segment(MANUSCRIPT_PAGE_4.fulltext_service)]: MANUSCRIPT_PAGE_4_TEXT,
        },
      );
      const base = 'https://www.loc.gov/resource/mss93930.mss93930-001/';

      const page3 = await runToolContract(locGetNewspaperPage, { page_url: `${base}?sp=3` });
      const page4 = await runToolContract(locGetNewspaperPage, { page_url: `${base}?sp=4` });

      const sc3 = structured(page3);
      expect(String(sc3.ocr_text)).toMatch(/^Maury, Betty Herndon \(Maury\) 1835-1903\.\n/);
      expect(sc3).toMatchObject({ ocr_available: true, sequence: 3, segment_count: 122 });
      expect(sc3).not.toHaveProperty('notice');
      expect(contentText(page3)).toContain('Maury, Betty Herndon (Maury) 1835-1903.');
      expect(structured(page4).ocr_text).toBe('June 3d 1861\nFredericksburg');
      const requested = spy.mock.calls.map(([u]) => String(u));
      expect(requested.some((u) => u.includes('mss93930-001.txt'))).toBe(false);
      expect(new URL(requested[0]!).searchParams.get('at')).toBe('item,resource,fulltext_service');
    });

    it("reads a book page's OCR", async () => {
      route(
        { '11': BOOK_PAGE_11 },
        { [segment(BOOK_PAGE_11.fulltext_service)]: BOOK_PAGE_11_TEXT },
      );

      const result = await runToolContract(locGetNewspaperPage, {
        page_url: 'https://www.loc.gov/resource/gdcmassbookdig.popularhistoryof00chen/?sp=11',
      });

      expect(String(structured(result).ocr_text)).toMatch(/^TO MY NEPHEW\n/);
      expect(contentText(result)).toContain('TO MY NEPHEW');
    });

    it('reads a newspaper page from the same per-page service as before', async () => {
      // On newspaper pages fulltext_service and resource.fulltext_file are the same URL.
      expect(NEWSPAPER_PAGE_1.fulltext_service).toBe(NEWSPAPER_PAGE_1.resource.fulltext_file);
      route({ '1': NEWSPAPER_PAGE_1 }, { [segment(NEWSPAPER_PAGE_1.fulltext_service)]: OCR_JSON });

      const sc = structured(
        await runToolContract(locGetNewspaperPage, {
          page_url: 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1',
        }),
      );

      expect(sc).toMatchObject({
        ocr_text: 'Hello World',
        newspaper_title: 'New-York tribune',
        date: '1912-04-16',
        sequence: 1,
      });
    });

    it('marks a page without fulltext_service as having no text, whatever fulltext_file holds', async () => {
      const { fulltext_service: _omit, ...withoutService } = MANUSCRIPT_PAGE_3;
      const spy = route({ '3': withoutService }, {});

      const sc = structured(
        await runToolContract(locGetNewspaperPage, {
          page_url: 'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
        }),
      );

      expect(sc).toMatchObject({ ocr_available: false, ocr_text: '' });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('names an unparseable text body as unparseable, not a retry, on both surfaces', async () => {
      // A plain-text body where the service's JSON was expected.
      route(
        { '3': MANUSCRIPT_PAGE_3 },
        {
          [segment(MANUSCRIPT_PAGE_3.fulltext_service)]:
            'Maury, Betty Herndon (Maury) 1835-1903.\n',
        },
        'text/plain',
      );

      const result = await runToolContract(locGetNewspaperPage, {
        page_url: 'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
      });

      const sc = structured(result);
      expect(sc).toMatchObject({ ocr_available: true, ocr_text: '' });
      expect(sc.notice).toBe(
        "LOC lists text for this page, but its text service answered with a body that could not be read as text (unparseable). Retrying will not change it; read the page's image at page_url instead.",
      );
      expect(contentText(result)).toContain(String(sc.notice));
    });

    it('reads an HTML text-service body as a transient block — the retry notice, not unparseable', async () => {
      // LOC names HTML pages (CAPTCHAs) as its soft block under load; the next call can succeed.
      route(
        { '3': MANUSCRIPT_PAGE_3 },
        {
          [segment(MANUSCRIPT_PAGE_3.fulltext_service)]:
            '<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>',
        },
        'text/html; charset=UTF-8',
      );

      const result = await runToolContract(locGetNewspaperPage, {
        page_url: 'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
      });

      const sc = structured(result);
      expect(sc).toMatchObject({ ocr_available: true, ocr_text: '' });
      expect(sc.notice).toBe(
        'OCR is digitized for this page, but the full text was not returned this call. Retry libofcongress_get_newspaper_page; a persistent empty result means the OCR text service is temporarily unavailable.',
      );
      expect(contentText(result)).toContain(String(sc.notice));
    });

    it('describes manuscript and book pages in the tool and page_url descriptions', () => {
      expect(locGetNewspaperPage.description).toMatch(/book or manuscript page/);
      expect(locGetNewspaperPage.input.shape.page_url.description).toMatch(
        /libofcongress_get_item for a newspaper, book, or manuscript page/,
      );
    });
  });

  describe('page_url link forms (#66)', () => {
    /**
     * Serves www.loc.gov requests from `responses`, keyed by the requested path plus its `sp`
     * (`/resource/x/?sp=1`, `/item/y/?sp=null`), and every tile.loc.gov text request with
     * OCR_JSON. Anything else rejects.
     */
    function serve(responses: Record<string, unknown>) {
      const spy = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.hostname === 'www.loc.gov') {
          const body = responses[`${url.pathname}?sp=${url.searchParams.get('sp')}`];
          if (body) return new Response(JSON.stringify(body), { status: 200 });
        }
        if (url.hostname === 'tile.loc.gov') return new Response(OCR_JSON);
        throw new Error(`unmocked fetch ${url.hostname}${url.pathname}`);
      });
      vi.stubGlobal('fetch', spy);
      return spy;
    }
    const PAGE_1 = 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1';
    const servePage1 = () =>
      serve({ '/resource/sn83030214/1912-04-16/ed-1/?sp=1': NEWSPAPER_PAGE_1 });

    // The accepted and rejected link forms are tabled in loc-urls.test.ts; these prove the tool
    // requests and returns the page URL normalizePageUrl reads.
    it.each([
      'https://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1/',
      'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/seq-1',
    ])('reads %s as page 1 at its www.loc.gov/resource/ URL on both surfaces', async (pageUrl) => {
      const spy = servePage1();

      const result = await runToolContract(locGetNewspaperPage, { page_url: pageUrl });

      expect(structured(result)).toMatchObject({
        page_url: PAGE_1,
        sequence: 1,
        edition: '1',
        ocr_text: 'Hello World',
      });
      const text = contentText(result);
      expect(text).toContain(`**URL:** ${PAGE_1}`);
      expect(text).toContain('**Sequence:** 1 of 14');
      const requested = new URL(String(spy.mock.calls[0]![0]));
      expect(`${requested.origin}${requested.pathname}`).toBe(
        'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/',
      );
      expect(requested.searchParams.get('sp')).toBe('1');
    });

    it('reads edition 2 page 2 of a two-edition date from its Chronicling America link', async () => {
      serve({ '/resource/sn93067777/1902-01-24/ed-2/?sp=2': NEWSPAPER_ED2_PAGE_2 });

      const result = await runToolContract(locGetNewspaperPage, {
        page_url: 'https://chroniclingamerica.loc.gov/lccn/sn93067777/1902-01-24/ed-2/seq-2/',
      });

      expect(structured(result)).toMatchObject({
        page_url: 'https://www.loc.gov/resource/sn93067777/1902-01-24/ed-2/?sp=2',
        newspaper_title: 'The Newberry herald and news',
        date: '1902-01-24',
        edition: '2',
        sequence: 2,
        segment_count: 4,
      });
      const text = contentText(result);
      expect(text).toContain('**Edition:** 2');
      expect(text).toContain('**Sequence:** 2 of 4');
    });

    it('sends only the page sequence of the query: no caller parameter or fragment reaches the request', async () => {
      const spy = servePage1();

      const result = await runToolContract(locGetNewspaperPage, {
        page_url: `${PAGE_1}&q=titanic&fo=html&at=segments#top`,
      });

      expect(structured(result).page_url).toBe(PAGE_1);
      const requested = new URL(String(spy.mock.calls[0]![0]));
      expect([...requested.searchParams.keys()].sort()).toEqual(['at', 'fo', 'sp']);
      expect(requested.searchParams.getAll('fo')).toEqual(['json']);
      expect(requested.searchParams.getAll('at')).toEqual(['item,resource,fulltext_service']);
      expect(requested.hash).toBe('');
    });

    it('reads a get_item page_url unchanged, its page_url and sequence intact (#63)', async () => {
      serve({
        '/item/mm77093930/?sp=null': MANUSCRIPT_ITEM_MM77093930,
        '/resource/mss93930.mss93930-001/?sp=3': MANUSCRIPT_PAGE_3,
      });
      const item = structured(await runToolContract(locGetItem, { item_id: 'mm77093930' }));
      const pageUrl = (item.pages as Array<{ page_url: string }>)[2]!.page_url;

      const page = structured(await runToolContract(locGetNewspaperPage, { page_url: pageUrl }));

      expect(page).toMatchObject({ page_url: pageUrl, sequence: 3, ocr_available: true });
    });

    it('names the accepted forms in the page_url description and the invalid_page_url contract', () => {
      const description = String(locGetNewspaperPage.input.shape.page_url.description);
      expect(description).toContain('chroniclingamerica.loc.gov/lccn/');
      expect(description).toContain('?sp=1');
      expect(description).not.toMatch(/\/seq-1\/"/);
      const entry = locGetNewspaperPage.errors!.find((e) => e.reason === 'invalid_page_url')!;
      for (const text of [entry.when, entry.recovery]) {
        expect(text).toContain('/resource/');
        expect(text).toMatch(/Chronicling America/);
      }
    });
  });

  it('security: SSRF attempt via non-LOC host is rejected with ValidationError', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({
      page_url: 'https://evil.example.com/steal-data',
    });
    await expect(locGetNewspaperPage.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
    });
    // fetch must NOT be called — validation rejects before any network request
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('format() includes edition when present', () => {
    const output = locGetNewspaperPage.output.parse({
      page_url: PAGE_URL,
      newspaper_title: 'The Daily Paper',
      edition: 'Evening Edition',
      sequence: 3,
      ocr_text: 'Some text.',
      ocr_available: true,
    });
    const blocks = locGetNewspaperPage.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Evening Edition');
    expect(text).toContain('3');
  });

  it('format() omits edition and sequence when absent (sparse page)', () => {
    const output = locGetNewspaperPage.output.parse({
      page_url: PAGE_URL,
      ocr_text: '',
      ocr_available: false,
    });
    const blocks = locGetNewspaperPage.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain(PAGE_URL);
    // Should not crash on missing optional fields
    expect(text).toBeDefined();
  });

  it('adds sp=1 param correctly when URL has existing query params', async () => {
    const fetchSpy = mockFetchSequence({
      body: makeResourceResponse({ fulltext_service: undefined, fulltext_file: undefined }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const urlWithSp = PAGE_URL; // Already has ?sp=1
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: urlWithSp });
    await locGetNewspaperPage.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('sp=1');
    expect(calledUrl).toContain('fo=json');
    // Should not have double question marks
    expect(calledUrl.split('?').length).toBeLessThanOrEqual(2);
  });

  it.each([
    {
      name: 'an upstream 404',
      fetch: () => vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })),
    },
    {
      name: 'a response with no resource record',
      fetch: () => mockFetchSequence({ body: JSON.stringify({}) }),
    },
  ])(
    'names the failed page URL and forwards page_not_found recovery on both surfaces for $name (#44)',
    async ({ fetch }) => {
      vi.stubGlobal('fetch', fetch());
      const result = await runToolContract(locGetNewspaperPage, { page_url: PAGE_URL });

      const error = wireError(result);
      const hint = contractRecovery(locGetNewspaperPage, 'page_not_found');
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.NotFound,
        data: { reason: 'page_not_found', pageUrl: PAGE_URL, recovery: { hint } },
      });
      expect(error.message).toBe(`No LOC page resolves at "${PAGE_URL}".`);
      // Both page sources: newspaper search results and an item's page list.
      expect(hint).toMatch(
        /libofcongress_search_newspapers.*pages\[\]\.page_url from libofcongress_get_item/,
      );
      const text = contentText(result);
      expect(text).toContain(PAGE_URL);
      expect(text).toContain(`Recovery: ${hint}`);
    },
  );

  it.each([
    'https://example.com/not-loc',
    'not-a-url-at-all',
    'https://www.loc.gov/../../etc/passwd',
  ])(
    'rejects page_url %s as invalid_page_url before any fetch, keeping its data and forwarding recovery (#45, #66)',
    async (pageUrl) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const result = await runToolContract(locGetNewspaperPage, { page_url: pageUrl });

      const error = wireError(result);
      const hint = contractRecovery(locGetNewspaperPage, 'invalid_page_url');
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.ValidationError,
        data: {
          reason: 'invalid_page_url',
          field: 'page_url',
          received: pageUrl,
          recovery: { hint },
        },
      });
      const text = contentText(result);
      expect(text).toContain(`Recovery: ${hint}`);
      expect(text).toContain('reason invalid_page_url');
      // A placeholder outside a code span renders as an HTML tag and vanishes.
      expect(text).toContain('`…/lccn/<lccn>/<date>/ed-N/seq-M/`');
      expect(text.replace(/`[^`]*`/g, '')).not.toMatch(/<[a-z]+>/);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  // Rate-limit test last — sets module-level rateLimitBlockedUntil
  it('forwards the most specific rate-limit hint on both surfaces: a fresh 429, then the running block (#44)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 }));
    vi.stubGlobal('fetch', fetchSpy);

    const fresh = await runToolContract(locGetNewspaperPage, { page_url: PAGE_URL });
    const freshError = wireError(fresh);
    expect(freshError).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'rate_limit_exceeded', retryable: false },
    });
    const freshHint = String(freshError.data?.recovery?.hint);
    expect(freshHint).toMatch(/1 hour/);
    expect(contentText(fresh)).toContain(`Recovery: ${freshHint}`);

    const blocked = await runToolContract(locGetNewspaperPage, { page_url: PAGE_URL });
    const blockedHint = String(wireError(blocked).data?.recovery?.hint);
    expect(blockedHint).toMatch(/60 more minute/);
    expect(contentText(blocked)).toContain(`Recovery: ${blockedHint}`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
