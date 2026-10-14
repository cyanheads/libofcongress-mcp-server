/**
 * @fileoverview Tests for www.loc.gov request pacing and the per-call time budget — concurrent
 * spacing, the 20-per-minute window, retry re-queueing, the dispatch-time block check, hung and
 * stalled upstreams, and caller cancellation. Drives the real LocApiService with only `fetch`
 * stubbed, under fake timers so a 50 s budget runs in milliseconds. Its own file because the
 * dispatch-time block test leaves the module-level 1-hour block set.
 * @module tests/services/loc-api-pacing-budget.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@/config/server-config.js';
import {
  getLocApiService,
  initLocApiService,
  LocApiService,
} from '@/services/loc-api/loc-api-service.js';

const SEARCH_BODY = JSON.stringify({
  results: [
    {
      id: 'https://www.loc.gov/item/2009632251/',
      title: 'Test Photo',
      url: 'https://www.loc.gov/item/2009632251/',
    },
  ],
  pagination: { total: 1, perpage: 25, pages: 1, page: 1 },
});

const jsonResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'application/json' } });

/** Never answers; rejects with the signal's reason once the request's signal aborts. */
function hangUntilAborted(init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
}

/** Answers with `body` after `delayMs`, or rejects with the signal's reason if it aborts first. */
function answerAfter(delayMs: number, body: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(jsonResponse(body)), delayMs);
    init?.signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(init.signal?.reason);
      },
      { once: true },
    );
  });
}

/** Observes a promise's settlement without awaiting it, so fake time can be advanced past it. */
function track<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  promise.then(
    (value) => {
      state.done = true;
      state.value = value;
    },
    (error: unknown) => {
      state.done = true;
      state.error = error;
    },
  );
  return state;
}

const queryOf = (url: string) => new URL(url).searchParams.get('q');

/** A service paced at `requestDelayMs`, independent of the suite-wide LOC_REQUEST_DELAY_MS=0. */
async function pacedService(requestDelayMs: number): Promise<LocApiService> {
  const serverConfig: ServerConfig = { userAgent: 'pacing-test', requestDelayMs };
  return new LocApiService(config, await createInMemoryStorage(), serverConfig);
}

describe('www.loc.gov request pacing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts concurrent calls in arrival order, at least requestDelayMs apart', async () => {
    const t0 = Date.now();
    const starts: { q: string | null; at: number }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        starts.push({ q: queryOf(url), at: Date.now() - t0 });
        return jsonResponse(SEARCH_BODY);
      }),
    );
    const svc = await pacedService(300);
    const calls = ['a', 'b', 'c', 'd', 'e'].map((query) =>
      track(svc.search({ query }, createMockContext())),
    );

    await vi.advanceTimersByTimeAsync(2_000);

    expect(starts).toEqual([
      { q: 'a', at: 0 },
      { q: 'b', at: 300 },
      { q: 'c', at: 600 },
      { q: 'd', at: 900 },
      { q: 'e', at: 1_200 },
    ]);
    expect(calls.every((c) => c.done && c.error === undefined)).toBe(true);
  });

  it('holds 20 starts per 60 s whatever the spacing, shedding callers the window cannot serve in time', async () => {
    const t0 = Date.now();
    const starts: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        starts.push(Date.now() - t0);
        return jsonResponse(SEARCH_BODY);
      }),
    );
    const svc = await pacedService(100);
    const calls = Array.from({ length: 25 }, (_, i) =>
      track(svc.search({ query: `q${i}` }, createMockContext())),
    );

    await vi.advanceTimersByTimeAsync(70_000);

    // The first 20 start one gap apart; nothing more starts inside the 60 s window.
    expect(starts).toEqual(Array.from({ length: 20 }, (_, i) => i * 100));
    const shed = calls.slice(20);
    for (const call of shed) {
      expect(call.error).toBeInstanceOf(McpError);
      expect(call.error).toMatchObject({
        code: JsonRpcErrorCode.RateLimited,
        data: { reason: 'pacer_shed', retryAfter: expect.any(Number) },
      });
      expect((call.error as McpError).data?.retryAfter).toBeGreaterThanOrEqual(58);
    }
    // Shed at once, never left to wait out the window in line.
    expect(calls.slice(0, 20).every((c) => c.done && c.error === undefined)).toBe(true);
  });

  it('sheds a caller whose queue wait would leave its request under 30 s of the budget', async () => {
    const t0 = Date.now();
    const starts: { q: string | null; at: number }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        starts.push({ q: queryOf(url), at: Date.now() - t0 });
        return jsonResponse(SEARCH_BODY);
      }),
    );
    // A 25 s wait fits the 50 s budget but leaves the request only 25 s, under its 30 s reserve.
    const tooLate = await pacedService(25_000);
    track(tooLate.search({ query: 'first' }, createMockContext()));
    const shed = track(tooLate.search({ query: 'second' }, createMockContext()));
    // A 15 s wait leaves the request 35 s, so that caller queues and is served.
    const inTime = await pacedService(15_000);
    track(inTime.search({ query: 'third' }, createMockContext()));
    const served = track(inTime.search({ query: 'fourth' }, createMockContext()));

    await vi.advanceTimersByTimeAsync(16_000);

    expect(shed.error).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'pacer_shed' },
    });
    expect(served.done && served.error === undefined).toBe(true);
    expect(starts).toEqual([
      { q: 'first', at: 0 },
      { q: 'third', at: 0 },
      { q: 'fourth', at: 15_000 },
    ]);
  });

  it('re-queues a retry through the pacer behind callers already waiting', async () => {
    const t0 = Date.now();
    const starts: { q: string | null; at: number }[] = [];
    let aAttempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const q = queryOf(url);
        starts.push({ q, at: Date.now() - t0 });
        if (q === 'a' && aAttempts++ === 0) {
          throw new TypeError('The socket connection was closed unexpectedly');
        }
        return jsonResponse(SEARCH_BODY);
      }),
    );
    const svc = await pacedService(2_000);
    const a = track(svc.search({ query: 'a' }, createMockContext()));
    const b = track(svc.search({ query: 'b' }, createMockContext()));

    await vi.advanceTimersByTimeAsync(6_000);

    // a's retry (backoff ≈ 1.1 s) joins the queue behind b, so it starts one gap after b.
    expect(starts).toEqual([
      { q: 'a', at: 0 },
      { q: 'b', at: 2_000 },
      { q: 'a', at: 4_000 },
    ]);
    expect(a.done && a.error === undefined).toBe(true);
    expect(b.done && b.error === undefined).toBe(true);
  });

  it('removes a queued caller at once when its request is cancelled, sending nothing for it', async () => {
    const fetchSpy = vi.fn(async (_url: string) => jsonResponse(SEARCH_BODY));
    vi.stubGlobal('fetch', fetchSpy);
    const svc = await pacedService(5_000);
    const controller = new AbortController();
    track(svc.search({ query: 'a' }, createMockContext()));
    const b = track(svc.search({ query: 'b' }, createMockContext({ signal: controller.signal })));
    const c = track(svc.search({ query: 'c' }, createMockContext()));

    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new DOMException('caller went away', 'AbortError'));
    await vi.advanceTimersByTimeAsync(0);

    expect(b.done).toBe(true);
    expect(b.error).toMatchObject({ name: 'AbortError' });
    expect(b.error).not.toBeInstanceOf(McpError);

    // Past the slot b held: b never sends, and c — queued behind it — takes that slot and succeeds.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchSpy.mock.calls.map(([url]) => queryOf(url))).toEqual(['a', 'c']);
    expect(c.done && c.error === undefined).toBe(true);
  });
});

describe('one per-call budget across attempts, body reads, and both newspaper-page legs', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    initLocApiService(config, await createInMemoryStorage());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('lets one slow attempt run past 30 s instead of cutting and re-sending it', async () => {
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) =>
      answerAfter(35_000, SEARCH_BODY, init),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const call = track(getLocApiService().search({ query: 'slow' }, createMockContext()));
    await vi.advanceTimersByTimeAsync(36_000);

    expect(call.done).toBe(true);
    expect(call.error).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fails a hung upstream as Timeout inside the 50 s budget, after one attempt, with no URL or host', async () => {
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => hangUntilAborted(init));
    vi.stubGlobal('fetch', fetchSpy);

    const call = track(
      getLocApiService().searchNewspapers({ query: 'influenza epidemic' }, createMockContext()),
    );
    await vi.advanceTimersByTimeAsync(49_000);
    expect(call.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);

    expect(call.done).toBe(true);
    expect(call.error).toMatchObject({ code: JsonRpcErrorCode.Timeout });
    const err = call.error as McpError;
    expect(err.message).toBe(
      'The Library of Congress did not respond within the 50-second request budget.',
    );
    expect(`${err.message} ${JSON.stringify(err.data ?? {})}`).not.toMatch(/loc\.gov|https?:/);
    // A timeout spends the budget; the heavy query is not re-sent.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('aborts a response whose body stalls after the headers', async () => {
    const stalledBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"item":{"title":"Par'));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stalledBody, { status: 200 })),
    );

    const call = track(getLocApiService().getItem('2009632251', createMockContext()));
    await vi.advanceTimersByTimeAsync(50_100);

    expect(call.done).toBe(true);
    expect(call.error).toMatchObject({ code: JsonRpcErrorCode.Timeout });
  });

  it('degrades the OCR leg to empty text when the page fetch used most of the shared budget', async () => {
    const pageBody = JSON.stringify({
      resource: {
        url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/',
        fulltext_file: 'https://tile.loc.gov/text-services/full_text.json',
      },
    });
    const fetchSpy = vi.fn((url: string, init?: RequestInit) =>
      url.includes('tile.loc.gov') ? hangUntilAborted(init) : answerAfter(40_000, pageBody, init),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const call = track(
      getLocApiService().getNewspaperPage(
        'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=1',
        createMockContext(),
      ),
    );
    await vi.advanceTimersByTimeAsync(50_100);

    expect(call.done).toBe(true);
    expect(call.error).toBeUndefined();
    expect(call.value).toMatchObject({ ocr_available: true, ocr_text: '' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('bounds an OCR body that stalls after the headers by the same budget, degrading to empty text', async () => {
    const pageBody = JSON.stringify({
      resource: {
        url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/',
        fulltext_file: 'https://tile.loc.gov/text-services/full_text.json',
      },
    });
    const stalledOcr = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"batch":{"full_text":"Par'));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('tile.loc.gov')
          ? new Response(stalledOcr, { status: 200 })
          : jsonResponse(pageBody),
      ),
    );

    const call = track(
      getLocApiService().getNewspaperPage(
        'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=1',
        createMockContext(),
      ),
    );
    await vi.advanceTimersByTimeAsync(50_100);

    expect(call.done).toBe(true);
    expect(call.value).toMatchObject({ ocr_available: true, ocr_text: '' });
  });

  it('reports a cancel during the OCR leg as the cancel, not as a degraded page', async () => {
    const pageBody = JSON.stringify({
      resource: {
        url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/',
        fulltext_file: 'https://tile.loc.gov/text-services/full_text.json',
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        url.includes('tile.loc.gov')
          ? hangUntilAborted(init)
          : Promise.resolve(jsonResponse(pageBody)),
      ),
    );
    const controller = new AbortController();

    const call = track(
      getLocApiService().getNewspaperPage(
        'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=1',
        createMockContext({ signal: controller.signal }),
      ),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort(new DOMException('caller went away', 'AbortError'));
    await vi.advanceTimersByTimeAsync(0);

    expect(call.done).toBe(true);
    expect(call.error).toMatchObject({ name: 'AbortError' });
  });

  it('keeps a cancel during retry backoff a cancel, never a timeout', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('The socket connection was closed unexpectedly');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();

    const call = track(
      getLocApiService().search(
        { query: 'test' },
        createMockContext({ signal: controller.signal }),
      ),
    );
    await vi.advanceTimersByTimeAsync(300);
    controller.abort(new DOMException('caller went away', 'AbortError'));
    await vi.advanceTimersByTimeAsync(0);

    expect(call.done).toBe(true);
    expect(call.error).toMatchObject({ name: 'AbortError' });
    expect(call.error).not.toBeInstanceOf(McpError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sends a request whose 200 body is malformed JSON once, never re-sending it', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse('{"results":[{"title":"Par'));
    vi.stubGlobal('fetch', fetchSpy);

    const call = track(getLocApiService().search({ query: 'garbled' }, createMockContext()));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(call.done).toBe(true);
    expect(call.error).toBeInstanceOf(SyntaxError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries raw network faults while budget remains, then reports the exhausted ladder', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('The socket connection was closed unexpectedly');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const call = track(getLocApiService().search({ query: 'test' }, createMockContext()));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(call.done).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(call.error).not.toBeInstanceOf(McpError);
    expect((call.error as Error).message).toBe(
      'The socket connection was closed unexpectedly (failed after 4 attempts)',
    );
  });
});

// Last in the file: a 429 sets the module-level 1-hour block for the rest of this worker.
describe('www.loc.gov rate-limit block under queueing', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fails callers already queued when a 429 lands, without sending their requests', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async () => new Response('Too Many Requests', { status: 429 }));
    vi.stubGlobal('fetch', fetchSpy);
    const svc = await pacedService(1_000);
    const calls = ['a', 'b', 'c'].map((query) => track(svc.search({ query }, createMockContext())));

    await vi.advanceTimersByTimeAsync(3_000);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const call of calls) {
      expect(call.error).toMatchObject({
        code: JsonRpcErrorCode.RateLimited,
        data: { reason: 'rate_limit_exceeded' },
      });
    }
  });

  it('fails calls arriving during the block at once, never queueing them or shedding them as server_busy', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async () => new Response('Too Many Requests', { status: 429 }));
    vi.stubGlobal('fetch', fetchSpy);
    const svc = await pacedService(3_100);
    // Trips the block, or meets the one an earlier test in this file left set.
    await svc.search({ query: 'trip' }, createMockContext()).catch(() => undefined);
    const sentBefore = fetchSpy.mock.calls.length;

    const calls = Array.from({ length: 8 }, (_, i) =>
      track(svc.search({ query: `during block ${i}` }, createMockContext())),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchSpy).toHaveBeenCalledTimes(sentBefore);
    for (const call of calls) {
      expect(call.done).toBe(true);
      expect(call.error).toMatchObject({
        code: JsonRpcErrorCode.RateLimited,
        data: { reason: 'rate_limit_exceeded' },
      });
    }
  });
});
