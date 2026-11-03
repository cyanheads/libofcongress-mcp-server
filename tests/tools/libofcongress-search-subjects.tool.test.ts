/**
 * @fileoverview Tests for libofcongress_search_subjects tool.
 * @module tests/tools/libofcongress-search-subjects.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  getEnrichment,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { locSearchSubjects } from '@/mcp-server/tools/definitions/libofcongress-search-subjects.tool.js';
import { initLcLinkedDataService } from '@/services/lc-linked-data/lc-linked-data-service.js';
import {
  AERIAL_PHOTOG_KEYWORD,
  AERIAL_PHOTOG_LEFT_ANCHORED,
  AERIAL_PHOTOGRAPHY_KEYWORD,
  CIVIL_WAR_KEYWORD,
  WORLD_WAR_1939_KEYWORD,
} from '../fixtures/lc-subject-suggest.js';
import { ATT_SUBJECT_SUGGEST } from '../fixtures/loc-text.js';
import { serveByHost } from '../helpers/loc-fetch.js';
import { contentText, contractRecovery, structured, wireError } from '../helpers/tool-result.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/x-suggestions+json; charset=utf-8' },
  });

/** A suggest2 page of `n` subject hits reporting `count` matches upstream. */
function page(n: number, count: number, searchtype: 'keyword' | 'left-anchored' = 'keyword') {
  return {
    q: 'music*',
    count,
    pagesize: n,
    start: 1,
    sortmethod: searchtype === 'keyword' ? 'rank' : 'alpha',
    searchtype,
    directory: '/authorities/subjects/',
    hits: Array.from({ length: n }, (_, i) => ({
      suggestLabel: `Music ${i}`,
      uri: `http://id.loc.gov/authorities/subjects/sh${i}`,
      aLabel: `Music ${i}`,
      vLabel: '',
      token: `sh${i}`,
      rank: String(1000 - i),
    })),
  };
}

const EMPTY_NOTICE = (q: string) =>
  `No LCSH headings matched "${q}". Try broader or different terms. LCSH words headings in its own standardized form — for example, "World War, 1939-1945" rather than "World War II", and "Aerial photography" rather than "Photography, Aerial".`;

describe('locSearchSubjects upstream text (#65)', () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    initLcLinkedDataService(config, await createInMemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes the raw ampersand of a captured id.loc.gov label through as sent', async () => {
    serveByHost({ 'id.loc.gov': ATT_SUBJECT_SUGGEST });
    const result = await runToolContract(locSearchSubjects, { query: 'AT&T', limit: 3 });
    expect(structured(result).subjects).toEqual(
      ATT_SUBJECT_SUGGEST.hits.map(({ aLabel, uri }) => ({ label: aLabel, uri })),
    );
    expect(contentText(result)).toContain('\n## AT&T PC 6300 Plus (Computer)\n');
  });

  it('escapes markup in a label in content[] only, and keeps the URI as sent', async () => {
    const hit = {
      aLabel: 'Tags <b> &amp; the\r\nweb',
      uri: 'http://id.loc.gov/authorities/subjects/sh1',
    };
    serveByHost({ 'id.loc.gov': { count: 1, hits: [hit] } });
    const result = await runToolContract(locSearchSubjects, { query: 'tags' });
    expect(structured(result).subjects).toEqual([{ label: hit.aLabel, uri: hit.uri }]);
    expect(contentText(result)).toContain(
      '\n## Tags \\<b> \\&amp; the web\n**URI:** http://id.loc.gov/authorities/subjects/sh1',
    );
  });
});

describe('locSearchSubjects', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  /** Answers every id.loc.gov request: keyword searches with `keyword`, left-anchored with `left`. */
  function answer(keyword: unknown, left: unknown = page(0, 0, 'left-anchored')) {
    fetchSpy.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.hostname !== 'id.loc.gov') throw new Error(`unexpected host ${parsed.hostname}`);
      return json(parsed.searchParams.get('searchtype') === 'keyword' ? keyword : left);
    });
  }

  const sentCount = (call = 0) =>
    new URL(String(fetchSpy.mock.calls[call]![0])).searchParams.get('count');

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    const storage = await createInMemoryStorage();
    initLcLinkedDataService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('pages one stable promoted sequence across changed limits and the initial-window boundary', async () => {
    const raw = page(302, 302).hits;
    raw[9] = { ...raw[9]!, aLabel: 'music' };
    fetchSpy.mockImplementation(async (url) => {
      const params = new URL(String(url)).searchParams;
      const offset = Number(params.get('offset') ?? 1) - 1;
      const count = Math.min(Number(params.get('count')), 250);
      return json({ ...page(0, 302), hits: raw.slice(offset, offset + count) });
    });
    const first = structured(
      await runToolContract(locSearchSubjects, { query: 'music', limit: 1 }),
    );
    expect(first.subjects).toEqual([
      { label: 'music', uri: 'http://id.loc.gov/authorities/subjects/sh9' },
    ]);
    expect(first.next_offset).toBe(1);
    const second = await runToolContract(locSearchSubjects, {
      query: 'music',
      offset: 1,
      limit: 2,
    });
    expect(structured(second).subjects).toEqual([
      { label: 'Music 0', uri: 'http://id.loc.gov/authorities/subjects/sh0' },
      { label: 'Music 1', uri: 'http://id.loc.gov/authorities/subjects/sh1' },
    ]);
    expect(structured(second).next_offset).toBe(3);
    expect(contentText(second)).toContain('Next offset: 3');
    expect(contentText(second)).toContain('offset 3');
    const crossing = structured(
      await runToolContract(locSearchSubjects, { query: 'music', offset: 49, limit: 250 }),
    );
    expect(crossing.subjects).toEqual(
      raw.slice(49, 299).map(({ aLabel, uri }) => ({ label: aLabel, uri })),
    );
    expect(crossing).toMatchObject({ total: 250, next_offset: 299 });
    const last = structured(
      await runToolContract(locSearchSubjects, { query: 'music', offset: 299, limit: 250 }),
    );
    expect(last).toMatchObject({ total: 3 });
    expect(last).not.toHaveProperty('next_offset');
    const past = await runToolContract(locSearchSubjects, {
      query: 'music',
      offset: 302,
      limit: 500,
    });
    expect(structured(past)).toMatchObject({ subjects: [], total: 0, effectiveLimit: 250 });
    expect(structured(past)).not.toHaveProperty('next_offset');
    expect(contentText(past)).toContain('Offset 302 is past the 302 matching headings');
    expect(contentText(past)).not.toContain('No LCSH headings matched');
    expect(
      fetchSpy.mock.calls.every(
        ([url]) => new URL(String(url)).searchParams.get('searchtype') === 'keyword',
      ),
    ).toBe(true);
    const walked: string[] = [];
    let offset = 0;
    for (const limit of [1, 2, 5, 7, 50, 250]) {
      const result = structured(
        await runToolContract(locSearchSubjects, { query: 'music', offset, limit }),
      );
      walked.push(...(result.subjects as Array<{ uri: string }>).map(({ uri }) => uri));
      offset = Number(result.next_offset ?? 302);
    }
    const expected = [
      9,
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      ...Array.from({ length: 292 }, (_, i) => i + 10),
    ];
    expect(walked).toEqual(expected.map((id) => `http://id.loc.gov/authorities/subjects/sh${id}`));
  });

  it('pages the left-anchored fallback at the same position without promoting a later exact label', async () => {
    const raw = page(60, 60, 'left-anchored').hits;
    raw[55] = { ...raw[55]!, aLabel: 'music' };
    fetchSpy.mockImplementation(async (url) => {
      const params = new URL(String(url)).searchParams;
      if (params.get('searchtype') === 'keyword') return json(page(0, 0));
      const offset = Number(params.get('offset') ?? 1) - 1;
      return json({
        ...page(0, 60, 'left-anchored'),
        hits: raw.slice(offset, offset + Number(params.get('count'))),
      });
    });
    const result = await runToolContract(locSearchSubjects, {
      query: 'music',
      offset: 54,
      limit: 2,
    });
    expect(structured(result)).toMatchObject({
      subjects: [
        { label: 'Music 54', uri: 'http://id.loc.gov/authorities/subjects/sh54' },
        { label: 'music', uri: 'http://id.loc.gov/authorities/subjects/sh55' },
      ],
      total: 2,
      next_offset: 56,
    });
    expect(contentText(result)).toContain('Next offset: 56');
    expect(
      fetchSpy.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('offset')),
    ).toEqual(['55', '55']);
  });

  it('advances by upstream entries when a sparse hit cannot be normalized', async () => {
    answer({
      count: 4,
      hits: [
        { aLabel: 'One' },
        { aLabel: 'Two', uri: 'http://id.loc.gov/authorities/subjects/sh2' },
      ],
    });
    const result = await runToolContract(locSearchSubjects, { query: 'music', limit: 2 });
    expect(structured(result)).toMatchObject({
      subjects: [{ label: 'Two', uri: 'http://id.loc.gov/authorities/subjects/sh2' }],
      total: 1,
      next_offset: 2,
    });
    expect(contentText(result)).toContain('Next offset: 2');
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER])(
    'rejects invalid offset %s before fetching',
    async (offset) => {
      const result = await runToolContract(locSearchSubjects, { query: 'music', offset });
      expect(result.isError).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('maps a suffix fetch failure to the declared reason and recovery on both surfaces', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(page(250, 300)))
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    const result = await runToolContract(locSearchSubjects, {
      query: 'music',
      offset: 49,
      limit: 250,
    });
    expect(wireError(result)).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: {
        reason: 'upstream_unavailable',
        recovery: { hint: contractRecovery(locSearchSubjects, 'upstream_unavailable') },
      },
    });
    expect(contentText(result)).toContain(
      contractRecovery(locSearchSubjects, 'upstream_unavailable'),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('shares the deadline with a suffix fetch and renders the declared timeout recovery', async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(json(page(250, 300))), 45_000)),
    );
    fetchSpy.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const pending = runToolContract(locSearchSubjects, { query: 'music', offset: 49, limit: 250 });
    await vi.advanceTimersByTimeAsync(50_001);
    const result = await pending;
    expect(wireError(result)).toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      data: {
        reason: 'request_timed_out',
        recovery: { hint: contractRecovery(locSearchSubjects, 'request_timed_out') },
      },
    });
    expect(contentText(result)).toContain(contractRecovery(locSearchSubjects, 'request_timed_out'));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('propagates cancellation during the suffix fetch and starts no further request', async () => {
    const controller = new AbortController();
    fetchSpy.mockResolvedValueOnce(json(page(250, 300)));
    fetchSpy.mockImplementation(async (_url, init) => {
      controller.abort(new DOMException('Subject pagination cancelled', 'AbortError'));
      expect(init?.signal?.aborted).toBe(true);
      throw init?.signal?.reason;
    });
    const result = await runToolContract(
      locSearchSubjects,
      { query: 'music', offset: 49, limit: 250 },
      { context: { signal: controller.signal } },
    );
    expect(wireError(result).code).toBe(JsonRpcErrorCode.RequestCancelled);
    expect(contentText(result)).toContain('Subject pagination cancelled');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns the base heading first for a keyword query that spans its words', async () => {
    // Live `world war 1939`: the retired left-anchored /suggest/ search matched nothing.
    answer(WORLD_WAR_1939_KEYWORD);
    const ctx = createMockContext({ errors: locSearchSubjects.errors });
    const input = locSearchSubjects.input.parse({ query: 'world war 1939', limit: 5 });
    const result = await locSearchSubjects.handler(input, ctx);

    expect(result.subjects[0]).toEqual({
      label: 'World War, 1939-1945',
      uri: 'http://id.loc.gov/authorities/subjects/sh85148273',
    });
    expect(result.total).toBe(5);
    expect(getEnrichment(ctx).effectiveQuery).toBe('world war 1939');
  });

  it('puts the exact heading first on both surfaces even when the upstream ranks it lower', async () => {
    // Live `civil war`: 488 keyword matches, `Civil war` ranked 10th.
    answer(CIVIL_WAR_KEYWORD);

    const result = await runToolContract(locSearchSubjects, { query: 'civil war' });

    const sc = structured(result);
    expect((sc.subjects as Array<{ label: string }>)[0]).toEqual({
      label: 'Civil war',
      uri: 'http://id.loc.gov/authorities/subjects/sh85026421',
    });
    const text = contentText(result);
    expect(text.indexOf('## Civil war\n')).toBeGreaterThan(-1);
    expect(text.indexOf('## Civil war\n')).toBeLessThan(
      text.indexOf('## Border States (U.S. Civil War)'),
    );
  });

  it('answers a partial word from the left-anchored retry on both surfaces', async () => {
    // Live `aerial photog`: 0 keyword matches, 45 left-anchored.
    answer(AERIAL_PHOTOG_KEYWORD, AERIAL_PHOTOG_LEFT_ANCHORED);

    const result = await runToolContract(locSearchSubjects, { query: 'aerial photog', limit: 3 });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const sc = structured(result);
    expect(sc.subjects).toEqual(
      AERIAL_PHOTOG_LEFT_ANCHORED.hits.map((h) => ({ label: h.aLabel, uri: h.uri })),
    );
    expect(sc).toMatchObject({ total: 3, truncated: true, shown: 3, cap: 3 });
    expect(sc.notice).toBe(
      'Showing 3 of 45 matching headings at offset 0. Request offset 3 with limit 3 to continue.',
    );
    expect(contentText(result)).toContain('## Aerial photogrammetry');
  });

  it('gives the empty-result notice with standardized-wording examples on both surfaces', async () => {
    answer(page(0, 0), page(0, 0, 'left-anchored'));

    const result = await runToolContract(locSearchSubjects, { query: 'xyzzy_no_match' });

    const sc = structured(result);
    expect(sc).toMatchObject({ subjects: [], total: 0, effectiveQuery: 'xyzzy_no_match' });
    expect(sc.notice).toBe(EMPTY_NOTICE('xyzzy_no_match'));
    expect(sc).not.toHaveProperty('truncated');
    expect(contentText(result)).toContain(EMPTY_NOTICE('xyzzy_no_match'));
  });

  it('carries no count on either surface, whatever the upstream hit carries (#41)', async () => {
    // Live `aerial photography` hits carry a `rank` and the page a match `count`.
    answer(AERIAL_PHOTOGRAPHY_KEYWORD);
    const result = await runToolContract(locSearchSubjects, { query: 'aerial photography' });

    expect(result.isError).toBeFalsy();
    const sc = structured(result);
    expect(sc.subjects).toEqual(
      AERIAL_PHOTOGRAPHY_KEYWORD.hits.map((h) => ({ label: h.aLabel, uri: h.uri })),
    );
    const text = contentText(result);
    expect(text).toContain('## Aerial photography\n');
    expect(text).not.toContain('Items:');
    expect(text).not.toContain(AERIAL_PHOTOGRAPHY_KEYWORD.hits[0]!.rank);
    // The advertised output schema no longer declares the field.
    expect(Object.keys(locSearchSubjects.output.shape.subjects.element.shape)).toEqual([
      'label',
      'uri',
    ]);
  });

  it('requests 50 headings from the upstream and returns limit of them', async () => {
    answer(page(50, 120));
    const ctx = createMockContext({ errors: locSearchSubjects.errors });
    const result = await locSearchSubjects.handler(
      locSearchSubjects.input.parse({ query: 'music', limit: 5 }),
      ctx,
    );

    expect(sentCount()).toBe('50');
    expect(result.subjects.map((s) => s.label)).toEqual([
      'Music 0',
      'Music 1',
      'Music 2',
      'Music 3',
      'Music 4',
    ]);
    expect(getEnrichment(ctx)).toMatchObject({ truncated: true, shown: 5, cap: 5 });
  });

  it('returns the exact heading first at the default limit when the upstream ranks it past 10th', async () => {
    // suggest2 returns at most `count` hits; here `Civil war` is moved to 12th of the page.
    const hits = [...CIVIL_WAR_KEYWORD.hits];
    const exact = hits.splice(9, 1)[0]!;
    const ranked = [...hits, ...page(2, 2).hits, exact];
    fetchSpy.mockImplementation(async (url) => {
      const count = Number(new URL(String(url)).searchParams.get('count'));
      return json({ ...CIVIL_WAR_KEYWORD, hits: ranked.slice(0, count) });
    });

    const result = await runToolContract(locSearchSubjects, { query: 'civil war' });

    const sc = structured(result);
    const labels = (sc.subjects as Array<{ label: string }>).map((s) => s.label);
    expect(labels[0]).toBe('Civil war');
    expect(labels).toHaveLength(10);
    expect(sc).toMatchObject({ truncated: true, shown: 10, cap: 10 });
    expect(contentText(result).indexOf('## Civil war\n')).toBeLessThan(
      contentText(result).indexOf('## Border States (U.S. Civil War)'),
    );
  });

  it('discloses truncation from the upstream match count on both surfaces', async () => {
    answer(page(3, 1341));
    const result = await runToolContract(locSearchSubjects, { query: 'music', limit: 3 });

    const sc = structured(result);
    expect(sc.subjects).toHaveLength(3);
    expect(sc).toMatchObject({ truncated: true, shown: 3, cap: 3 });
    const notice =
      'Showing 3 of 1341 matching headings at offset 0. Request offset 3 with limit 3 to continue.';
    expect(sc.notice).toBe(notice);
    expect(contentText(result)).toContain(notice);
  });

  it('carries no notice or truncation when every matching heading is returned', async () => {
    answer(page(3, 3));
    const sc = structured(await runToolContract(locSearchSubjects, { query: 'music', limit: 5 }));

    expect(sc.subjects).toHaveLength(3);
    expect(sc).not.toHaveProperty('notice');
    expect(sc).not.toHaveProperty('truncated');
  });

  it('fails a non-OK status as upstream_unavailable on both surfaces, carrying no internal request URL', async () => {
    fetchSpy.mockImplementation(async () => new Response('Server Error', { status: 503 }));

    const result = await runToolContract(locSearchSubjects, { query: 'confidential-term' });

    const error = wireError(result);
    const hint = contractRecovery(locSearchSubjects, 'upstream_unavailable');
    expect(error).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'LC Linked Data returned HTTP 503',
      data: { reason: 'upstream_unavailable', status: 503, recovery: { hint } },
    });
    expect(contentText(result)).toContain(`Recovery: ${hint}`);
    // The suggest URL embeds the caller's query — neither surface may carry it.
    const surfaces = JSON.stringify(result.structuredContent) + contentText(result);
    expect(surfaces).not.toContain('id.loc.gov');
    expect(surfaces).not.toContain('confidential-term');
  });

  it('fails an HTML outage page as upstream_unavailable on both surfaces', async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response('<!DOCTYPE html><html><body>Service Unavailable</body></html>', {
          status: 200,
        }),
    );

    const result = await runToolContract(locSearchSubjects, { query: 'jazz' });

    const error = wireError(result);
    const hint = contractRecovery(locSearchSubjects, 'upstream_unavailable');
    expect(error).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'LC Linked Data returned HTML — temporarily unavailable.',
      data: { reason: 'upstream_unavailable', recovery: { hint } },
    });
    expect(contentText(result)).toContain(`Recovery: ${hint}`);
  });

  it('format() renders label and URI', () => {
    const output = locSearchSubjects.output.parse({
      subjects: [
        {
          label: 'World War, 1939-1945',
          uri: 'http://id.loc.gov/authorities/subjects/sh85148273',
        },
      ],
      total: 1,
    });
    const blocks = locSearchSubjects.format!(output);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('World War, 1939-1945');
    expect(text).toContain('http://id.loc.gov/authorities/subjects/sh85148273');
  });

  it('format() renders the total count even when results are empty', () => {
    const output = locSearchSubjects.output.parse({
      subjects: [],
      total: 0,
    });
    const blocks = locSearchSubjects.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    // Count line must always be present; notice is in the enrichment trailer, not here
    expect(text).toContain('0 subject heading(s) found');
  });

  it('rejects empty query at schema level', () => {
    expect(() => locSearchSubjects.input.parse({ query: '' })).toThrow();
  });

  it('rejects limit=0 at schema level (below min)', () => {
    expect(() => locSearchSubjects.input.parse({ query: 'test', limit: 0 })).toThrow();
  });

  it('accepts limit up to 1000 and rejects limit=1001 at schema level (hard ceiling)', () => {
    expect(locSearchSubjects.input.parse({ query: 'test', limit: 51 }).limit).toBe(51);
    expect(locSearchSubjects.input.parse({ query: 'test', limit: 1000 }).limit).toBe(1000);
    expect(() => locSearchSubjects.input.parse({ query: 'test', limit: 1001 })).toThrow();
  });

  describe('limit above the per-call cap of 250', () => {
    const CLAMP_NOTICE = (n: number) =>
      `Requested limit ${n} exceeds the per-call cap of 250 headings.`;

    it('requests and returns up to 250 headings with effectiveLimit and the clamp notice on both surfaces', async () => {
      answer(page(250, 250));

      const result = await runToolContract(locSearchSubjects, { query: 'music', limit: 1000 });

      expect(sentCount()).toBe('250');
      const sc = structured(result);
      expect(sc.subjects).toHaveLength(250);
      expect(sc).toMatchObject({ total: 250, effectiveLimit: 250 });
      expect(sc).not.toHaveProperty('truncated');
      expect(sc.notice).toBe(CLAMP_NOTICE(1000));
      expect(contentText(result)).toContain(CLAMP_NOTICE(1000));
    });

    it('leaves a limit at the cap unchanged — no effectiveLimit, no notice', async () => {
      answer(page(1, 1));

      const sc = structured(
        await runToolContract(locSearchSubjects, { query: 'jazz', limit: 250 }),
      );

      expect(sentCount()).toBe('250');
      expect(sc).not.toHaveProperty('effectiveLimit');
      expect(sc).not.toHaveProperty('notice');
    });

    it('combines the clamp notice with the truncation notice, which no longer offers a larger limit', async () => {
      answer(page(250, 1341));

      const result = await runToolContract(locSearchSubjects, { query: 'music', limit: 500 });

      const sc = structured(result);
      expect(sc).toMatchObject({
        truncated: true,
        shown: 250,
        cap: 250,
        effectiveLimit: 250,
        next_offset: 250,
      });
      const notice = String(sc.notice);
      expect(notice).toBe(
        `${CLAMP_NOTICE(500)} Showing 250 of 1341 matching headings at offset 0. Request offset 250 with limit 250 to continue.`,
      );
      expect(contentText(result)).toContain(notice);
    });

    it('combines the clamp notice with the empty-result notice', async () => {
      answer(page(0, 0), page(0, 0, 'left-anchored'));

      const sc = structured(
        await runToolContract(locSearchSubjects, { query: 'xyzzy_no_match', limit: 251 }),
      );

      expect(sc).toMatchObject({ subjects: [], total: 0, effectiveLimit: 250 });
      expect(sc.notice).toBe(`${CLAMP_NOTICE(251)} ${EMPTY_NOTICE('xyzzy_no_match')}`);
    });
  });

  it('passes limit=50 (max boundary) without throwing', () => {
    expect(() => locSearchSubjects.input.parse({ query: 'test', limit: 50 })).not.toThrow();
  });

  it('passes limit=1 (min boundary) without throwing', () => {
    expect(() => locSearchSubjects.input.parse({ query: 'test', limit: 1 })).not.toThrow();
  });

  it('format() renders a subdivided heading verbatim', () => {
    const output = locSearchSubjects.output.parse({
      subjects: [
        {
          label: 'World War, 1939-1945--Aerial operations',
          uri: 'http://id.loc.gov/authorities/subjects/sh85148275',
        },
      ],
      total: 1,
    });
    const blocks = locSearchSubjects.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('## World War, 1939-1945--Aerial operations');
    expect(text).toContain('http://id.loc.gov/authorities/subjects/sh85148275');
  });

  it('describes Aerial photography, not its variant, as the LCSH form', () => {
    expect(locSearchSubjects.description).toContain(
      '"Aerial photography" not "Photography, Aerial"',
    );
  });
});
