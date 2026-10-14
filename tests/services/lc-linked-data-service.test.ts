/**
 * @fileoverview Tests for the LcLinkedDataService — init/accessor guard, the id.loc.gov
 * `suggest2` keyword search and its left-anchored fallback, hit normalization, the shared call
 * budget across both requests, error classification, and security invariants.
 * @module tests/services/lc-linked-data-service.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { getServerConfig } from '@/config/server-config.js';
import {
  getLcLinkedDataService,
  initLcLinkedDataService,
  LcLinkedDataService,
} from '@/services/lc-linked-data/lc-linked-data-service.js';
import {
  AERIAL_PHOTOG_KEYWORD,
  AERIAL_PHOTOG_LEFT_ANCHORED,
  CIVIL_WAR_KEYWORD,
  CIVIL_WAR_LEFT_ANCHORED,
  WORLD_WAR_1939_KEYWORD,
} from '../fixtures/lc-subject-suggest.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/x-suggestions+json; charset=utf-8' },
  });

/** A suggest2 page with no hits, as the endpoint answers an unmatched query. */
const noHits = (searchtype: 'keyword' | 'left-anchored') => ({
  q: 'xyzzy',
  count: 0,
  pagesize: 10,
  start: 1,
  sortmethod: searchtype === 'keyword' ? 'rank' : 'alpha',
  searchtype,
  directory: '/authorities/subjects/',
  hits: [],
});

/** Never answers; rejects with the signal's reason once the request's signal aborts. */
function hangUntilAborted(_url: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
}

/** Routes id.loc.gov requests by search type: keyword when `searchtype=keyword`, else left-anchored. */
function routeBySearchType(keyword: () => Response, leftAnchored: () => Response) {
  return async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    if (parsed.hostname !== 'id.loc.gov') throw new Error(`unexpected host ${parsed.hostname}`);
    return parsed.searchParams.get('searchtype') === 'keyword' ? keyword() : leftAnchored();
  };
}

const requestUrl = (spy: MockInstance<typeof fetch>, call: number) =>
  new URL(String(spy.mock.calls[call]![0]));

describe('LcLinkedDataService init/accessor', () => {
  it('getLcLinkedDataService() returns the initialized instance', async () => {
    const storage = await createInMemoryStorage();
    initLcLinkedDataService(config, storage);
    const svc = getLcLinkedDataService();
    expect(svc).toBeInstanceOf(LcLinkedDataService);
  });
});

describe('LcLinkedDataService.searchSubjects', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    const storage = await createInMemoryStorage();
    initLcLinkedDataService(config, storage);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends a keyword search to the subject-scoped suggest2 endpoint for at least 50 headings', async () => {
    fetchSpy.mockResolvedValue(json(WORLD_WAR_1939_KEYWORD));

    await getLcLinkedDataService().searchSubjects('world war 1939', 7, createMockContext());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = requestUrl(fetchSpy, 0);
    expect(url.origin).toBe('https://id.loc.gov');
    expect(url.pathname).toBe('/authorities/subjects/suggest2/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'world war 1939',
      searchtype: 'keyword',
      count: '50',
    });
  });

  it('promotes an exact label ranked past limit, then cuts the page to limit', async () => {
    // suggest2 returns at most `count` hits. Live `civil war`: the exact `Civil war` ranks 10th,
    // so a page of only `limit` (3) hits never holds it.
    fetchSpy.mockImplementation(async (url) => {
      const count = Number(new URL(String(url)).searchParams.get('count'));
      return json({ ...CIVIL_WAR_KEYWORD, hits: CIVIL_WAR_KEYWORD.hits.slice(0, count) });
    });

    const result = await getLcLinkedDataService().searchSubjects(
      'civil war',
      3,
      createMockContext(),
    );

    expect(result.subjects.map((s) => s.label)).toEqual([
      'Civil war',
      'Border States (U.S. Civil War)',
      'War of the Castilian Succession, 1475-1479',
    ]);
    // Truncation still reads the upstream total, not the over-fetched page.
    expect(result.matchCount).toBe(488);
  });

  it('asks for limit headings when limit is above 50', async () => {
    fetchSpy.mockResolvedValue(json(WORLD_WAR_1939_KEYWORD));

    await getLcLinkedDataService().searchSubjects('world war 1939', 80, createMockContext());

    expect(requestUrl(fetchSpy, 0).searchParams.get('count')).toBe('80');
  });

  it('maps keyword hits to { label, uri } and reports the upstream match count', async () => {
    fetchSpy.mockResolvedValue(json(WORLD_WAR_1939_KEYWORD));

    const result = await getLcLinkedDataService().searchSubjects(
      'world war 1939',
      5,
      createMockContext(),
    );

    expect(result.matchCount).toBe(1341);
    expect(result.subjects[0]).toEqual({
      label: 'World War, 1939-1945',
      uri: 'http://id.loc.gov/authorities/subjects/sh85148273',
    });
    expect(result.subjects.map((s) => s.label)).toEqual(
      WORLD_WAR_1939_KEYWORD.hits.map((h) => h.aLabel),
    );
    // No upstream rank or tally leaks into a heading record (#41).
    for (const s of result.subjects) expect(Object.keys(s).sort()).toEqual(['label', 'uri']);
  });

  it('moves a hit whose label equals the query (case-insensitive) to the top, keeping the rest in rank order', async () => {
    // Live `civil war` keyword ranking: the exact heading `Civil war` sits 10th.
    fetchSpy.mockResolvedValue(json(CIVIL_WAR_KEYWORD));

    const { subjects } = await getLcLinkedDataService().searchSubjects(
      '  Civil War ',
      10,
      createMockContext(),
    );

    expect(subjects[0]).toEqual({
      label: 'Civil war',
      uri: 'http://id.loc.gov/authorities/subjects/sh85026421',
    });
    const ranked = CIVIL_WAR_KEYWORD.hits.map((h) => h.aLabel).filter((l) => l !== 'Civil war');
    expect(subjects.slice(1).map((s) => s.label)).toEqual(ranked);
    expect(subjects).toHaveLength(10);
  });

  it('leaves the ranking untouched when no hit equals the query', async () => {
    fetchSpy.mockResolvedValue(json(WORLD_WAR_1939_KEYWORD));

    const { subjects } = await getLcLinkedDataService().searchSubjects(
      'world war 1939',
      5,
      createMockContext(),
    );

    expect(subjects.map((s) => s.uri)).toEqual(WORLD_WAR_1939_KEYWORD.hits.map((h) => h.uri));
  });

  it('sends one request when the keyword search matches', async () => {
    fetchSpy.mockImplementation(
      routeBySearchType(
        () => json(CIVIL_WAR_KEYWORD),
        () => json(CIVIL_WAR_LEFT_ANCHORED),
      ),
    );

    await getLcLinkedDataService().searchSubjects('civil war', 10, createMockContext());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries once left-anchored on the same endpoint when the keyword search matches nothing', async () => {
    // Live `aerial photog`: a partial word — 0 by keyword, 45 left-anchored.
    fetchSpy.mockImplementation(
      routeBySearchType(
        () => json(AERIAL_PHOTOG_KEYWORD),
        () => json(AERIAL_PHOTOG_LEFT_ANCHORED),
      ),
    );

    const result = await getLcLinkedDataService().searchSubjects(
      'aerial photog',
      3,
      createMockContext(),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const retry = requestUrl(fetchSpy, 1);
    expect(retry.pathname).toBe('/authorities/subjects/suggest2/');
    expect(Object.fromEntries(retry.searchParams)).toEqual({ q: 'aerial photog', count: '50' });
    expect(result.matchCount).toBe(45);
    expect(result.subjects.map((s) => s.label)).toEqual(
      AERIAL_PHOTOG_LEFT_ANCHORED.hits.map((h) => h.aLabel).slice(0, 3),
    );
  });

  it('labels a left-anchored cross-reference with its authorized heading (aLabel), not the variant', async () => {
    fetchSpy.mockImplementation(
      routeBySearchType(
        () => json(noHits('keyword')),
        () => json(CIVIL_WAR_LEFT_ANCHORED),
      ),
    );

    const { subjects } = await getLcLinkedDataService().searchSubjects(
      'civil war',
      10,
      createMockContext(),
    );

    const crossRef = subjects.find(
      (s) => s.uri === 'http://id.loc.gov/authorities/subjects/sh2009001090',
    );
    expect(crossRef).toEqual({
      label: 'Soldiers and Sailors Monument (Portland, Me.)',
      uri: 'http://id.loc.gov/authorities/subjects/sh2009001090',
    });
    expect(subjects.some((s) => s.label.includes('(USE '))).toBe(false);
    // The exact heading also leads a left-anchored page.
    expect(subjects[0]!.label).toBe('Civil war');
  });

  it('returns no headings and a zero count when both searches match nothing', async () => {
    fetchSpy.mockImplementation(
      routeBySearchType(
        () => json(noHits('keyword')),
        () => json(noHits('left-anchored')),
      ),
    );

    const result = await getLcLinkedDataService().searchSubjects('xyzzy', 10, createMockContext());

    expect(result).toEqual({ subjects: [], matchCount: 0 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('skips hits whose authorized label or uri is empty', async () => {
    fetchSpy.mockResolvedValue(
      json({
        ...WORLD_WAR_1939_KEYWORD,
        hits: [
          { ...WORLD_WAR_1939_KEYWORD.hits[0], aLabel: '' },
          { ...WORLD_WAR_1939_KEYWORD.hits[1], uri: '' },
          WORLD_WAR_1939_KEYWORD.hits[2],
        ],
      }),
    );

    const { subjects } = await getLcLinkedDataService().searchSubjects(
      'world war 1939',
      10,
      createMockContext(),
    );

    expect(subjects).toEqual([
      {
        label: 'World War, 1939-1945, on postage stamps',
        uri: 'http://id.loc.gov/authorities/subjects/sh93003336',
      },
    ]);
  });

  it('runs both requests inside one 50 s budget — a slow empty keyword leg leaves the retry the remainder', async () => {
    vi.useFakeTimers();
    fetchSpy.mockImplementation((url, init) =>
      new URL(String(url)).searchParams.get('searchtype') === 'keyword'
        ? new Promise((resolve) => setTimeout(() => resolve(json(noHits('keyword'))), 45_000))
        : hangUntilAborted(url, init),
    );

    const settled = getLcLinkedDataService()
      .searchSubjects('aerial photog', 10, createMockContext())
      .catch((e: unknown) => e);
    let error: unknown;
    void settled.then((e) => {
      error = e;
    });
    await vi.advanceTimersByTimeAsync(50_100);

    expect(error).toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      message:
        'The Library of Congress subject heading service did not respond within the 50-second request budget.',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('fails the left-anchored retry leg as upstream_unavailable when it answers 503', async () => {
    fetchSpy.mockImplementation(
      routeBySearchType(
        () => json(noHits('keyword')),
        () => new Response('Service Unavailable', { status: 503 }),
      ),
    );

    await expect(
      getLcLinkedDataService().searchSubjects('aerial photog', 10, createMockContext()),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: { status: 503, reason: 'upstream_unavailable' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws ServiceUnavailable carrying upstream_unavailable and the bare status on non-OK HTTP status', async () => {
    fetchSpy.mockResolvedValue(new Response('Service Error', { status: 503 }));
    await expect(
      getLcLinkedDataService().searchSubjects('test', 10, createMockContext()),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'LC Linked Data returned HTTP 503',
      data: { status: 503, reason: 'upstream_unavailable' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws ServiceUnavailable carrying upstream_unavailable on HTML response (outage), sent once', async () => {
    fetchSpy.mockResolvedValue(
      new Response('<!DOCTYPE html><html><body>Maintenance</body></html>', { status: 200 }),
    );
    await expect(
      getLcLinkedDataService().searchSubjects('test', 10, createMockContext()),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'LC Linked Data returned HTML — temporarily unavailable.',
      data: { reason: 'upstream_unavailable' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws ServiceUnavailable carrying upstream_unavailable on a truncated 200 body, sent once', async () => {
    fetchSpy.mockResolvedValue(new Response('{"q":"jazz*","count":229,"hits":[{"aLab'));
    await expect(
      getLcLinkedDataService().searchSubjects('jazz', 10, createMockContext()),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message:
        'The Library of Congress subject heading service returned an incomplete or malformed response.',
      data: { reason: 'upstream_unavailable' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws upstream_unavailable on JSON that is not a suggest2 page, without a fallback request', async () => {
    // The retired /suggest/ 4-tuple, valid JSON in the wrong shape.
    fetchSpy.mockResolvedValue(json(['jazz', ['Jazz'], ['1 result'], ['http://x']]));
    await expect(
      getLcLinkedDataService().searchSubjects('jazz', 10, createMockContext()),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'The Library of Congress subject heading service returned an unexpected response.',
      data: { reason: 'upstream_unavailable' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('percent-encodes the query, so markup and query-string syntax in it reach id.loc.gov as the q value only', async () => {
    fetchSpy.mockImplementation(async () => json(noHits('keyword')));
    const injection = '<script>alert(1)</script>&searchtype=left&count=1#frag';

    await getLcLinkedDataService().searchSubjects(injection, 10, createMockContext());

    const sent = String(fetchSpy.mock.calls[0]![0]);
    expect(sent).not.toMatch(/[<>#]/);
    expect(Object.fromEntries(new URL(sent).searchParams)).toEqual({
      q: injection,
      searchtype: 'keyword',
      count: '50',
    });
  });

  it('sends the configured User-Agent and keeps it out of the result and of error data', async () => {
    const userAgent = getServerConfig().userAgent;
    fetchSpy.mockResolvedValueOnce(json(WORLD_WAR_1939_KEYWORD));
    const result = await getLcLinkedDataService().searchSubjects('war', 10, createMockContext());

    const init = fetchSpy.mock.calls[0]![1];
    expect(new Headers(init?.headers).get('user-agent')).toBe(userAgent);
    expect(JSON.stringify(result)).not.toContain(userAgent);

    fetchSpy.mockResolvedValueOnce(new Response('Service Error', { status: 503 }));
    const err = await getLcLinkedDataService()
      .searchSubjects('war', 10, createMockContext())
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ data: { reason: 'upstream_unavailable' } });
    expect(
      `${(err as Error).message} ${JSON.stringify((err as { data?: unknown }).data)}`,
    ).not.toContain(userAgent);
  });
});
