/**
 * @fileoverview Wire-shape tests for the two failure reasons every LOC-backed definition declares
 * for its time and queue limits: `server_busy` (this server's www.loc.gov queue cannot start the
 * request within the call's budget) and `request_timed_out` (the upstream did not answer within
 * the 50 s per-call budget). Each runs the real service under the definition through
 * `runToolContract`, so both `structuredContent` and `content[]` are checked.
 * @module tests/tools/loc-upstream-failure-reasons.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locItemResource } from '@/mcp-server/resources/definitions/libofcongress-item.resource.js';
import { locBrowseCollections } from '@/mcp-server/tools/definitions/libofcongress-browse-collections.tool.js';
import { locGetItem } from '@/mcp-server/tools/definitions/libofcongress-get-item.tool.js';
import { locGetNewspaperPage } from '@/mcp-server/tools/definitions/libofcongress-get-newspaper-page.tool.js';
import { locSearchItems } from '@/mcp-server/tools/definitions/libofcongress-search-items.tool.js';
import { locSearchNewspapers } from '@/mcp-server/tools/definitions/libofcongress-search-newspapers.tool.js';
import { locSearchSubjects } from '@/mcp-server/tools/definitions/libofcongress-search-subjects.tool.js';
import { initLcLinkedDataService } from '@/services/lc-linked-data/lc-linked-data-service.js';
import { getLocApiService, initLocApiService } from '@/services/loc-api/loc-api-service.js';
import { contentText, contractRecovery, structured, wireError } from '../helpers/tool-result.js';

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

const PAGE_URL = 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=1';

/** Never answers; rejects with the signal's reason once the request's signal aborts. */
function hangUntilAborted(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
}

/** Observes a promise's settlement without awaiting it, so fake time can be advanced past it. */
function track<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T } = { done: false };
  void promise.then((value) => {
    state.done = true;
    state.value = value;
  });
  return state;
}

/**
 * Uses up the www.loc.gov window — 20 starts per 60 s — on the shared service, so the next
 * request's projected queue wait (~60 s) exceeds what the call's budget allows and is shed.
 */
async function fillTheWindow(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(SEARCH_BODY, { status: 200 })),
  );
  const svc = getLocApiService();
  for (let i = 0; i < 20; i++) await svc.search({ query: `warmup ${i}` }, createMockContext());
}

/** The www.loc.gov-backed tools, each with an input that reaches the upstream. */
const wwwTools = [
  { definition: locSearchItems, input: { query: 'railroad strike' } },
  { definition: locSearchNewspapers, input: { query: 'influenza epidemic' } },
  { definition: locBrowseCollections, input: {} },
  { definition: locGetItem, input: { item_id: '2009632251' } },
  { definition: locGetNewspaperPage, input: { page_url: PAGE_URL } },
] as const;

describe('server_busy — the www.loc.gov queue cannot start a request in time', () => {
  beforeEach(async () => {
    initLocApiService(config, await createInMemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(wwwTools)(
    '$definition.name reports a shed as server_busy on both surfaces, sending nothing',
    async ({ definition, input }) => {
      await fillTheWindow();
      const fetchSpy = vi.fn(async () => new Response('Internal Server Error', { status: 500 }));
      vi.stubGlobal('fetch', fetchSpy);

      const result = await runToolContract(definition, input as never);

      const error = wireError(result);
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.RateLimited,
        data: { reason: 'server_busy', retryable: true, retryAfter: expect.any(Number) },
      });
      const retryAfter = Number(error.data?.retryAfter);
      expect(retryAfter).toBeGreaterThanOrEqual(58);
      // The caller never set a wait budget; the message names the queue, not pacer internals.
      expect(error.message).toBe(
        'The Library of Congress request queue cannot start this call in time.',
      );
      const hint = String(error.data?.recovery?.hint);
      expect(hint).toContain(`Wait ${retryAfter} seconds`);
      const text = contentText(result);
      expect(text).toContain(`Recovery: ${hint}`);
      expect(text).toContain('reason server_busy');
      // A local queue clears in seconds; the 1-hour LOC block advice must not appear.
      expect(text).not.toMatch(/rate_limit_exceeded|hour/);
      expect(contractRecovery(definition, 'server_busy')).toMatch(/retryAfter/);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('the item resource reports a shed as server_busy with the wait in its hint', async () => {
    await fillTheWindow();
    const fetchSpy = vi.fn(async () => new Response('Internal Server Error', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({
      errors: locItemResource.errors,
      uri: new URL('libofcongress://item/2009632251'),
    });

    const err = await Promise.resolve(
      locItemResource.handler(locItemResource.params!.parse({ item_id: '2009632251' }), ctx),
    ).then(
      () => undefined,
      (e: unknown) => e as { code?: number; data?: Record<string, unknown> },
    );

    expect(err).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'server_busy', retryable: true, retryAfter: expect.any(Number) },
    });
    const recovery = err?.data?.recovery as { hint?: string } | undefined;
    expect(String(recovery?.hint)).toContain(`Wait ${String(err?.data?.retryAfter)} seconds`);
    expect(contractRecovery(locItemResource, 'server_busy')).toMatch(/retryAfter/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('request_timed_out — the upstream does not answer within the 50 s budget', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    initLcLinkedDataService(config, storage);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([...wwwTools, { definition: locSearchSubjects, input: { query: 'influenza' } }])(
    '$definition.name fails a hung upstream as request_timed_out within the budget, on both surfaces',
    async ({ definition, input }) => {
      const fetchSpy = vi.fn(hangUntilAborted);
      vi.stubGlobal('fetch', fetchSpy);

      const call = track(runToolContract(definition, input as never));
      await vi.advanceTimersByTimeAsync(50_100);

      expect(call.done).toBe(true);
      const result = call.value!;
      const error = wireError(result);
      const hint = contractRecovery(definition, 'request_timed_out');
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.Timeout,
        data: { reason: 'request_timed_out', recovery: { hint } },
      });
      expect(error.message).toMatch(/did not respond within the 50-second request budget\.$/);
      const text = contentText(result);
      expect(text).toContain(`Recovery: ${hint}`);
      expect(text).toContain('reason request_timed_out');
      expect(`${text} ${JSON.stringify(error)}`).not.toMatch(/loc\.gov|https?:/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('names the narrowing filters in the newspaper search recovery', () => {
    expect(contractRecovery(locSearchNewspapers, 'request_timed_out')).toMatch(
      /date_start\/date_end.*state.*newspaper_title/,
    );
    expect(contractRecovery(locSearchItems, 'request_timed_out')).toMatch(
      /format, subject, or location.*date_start\/date_end/,
    );
    expect(contractRecovery(locSearchSubjects, 'request_timed_out')).toBe(
      'Retry in a few minutes; the Library of Congress subject heading service is responding slowly.',
    );
  });

  it('the item resource fails a hung upstream as request_timed_out', async () => {
    vi.stubGlobal('fetch', vi.fn(hangUntilAborted));
    const ctx = createMockContext({
      errors: locItemResource.errors,
      uri: new URL('libofcongress://item/2009632251'),
    });

    const settled = Promise.resolve(
      locItemResource.handler(locItemResource.params!.parse({ item_id: '2009632251' }), ctx),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    const call = track(settled);
    await vi.advanceTimersByTimeAsync(50_100);

    expect(call.done).toBe(true);
    expect(call.value).toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      message: 'The Library of Congress did not respond within the 50-second request budget.',
      data: { reason: 'request_timed_out' },
    });
  });

  it('libofcongress_search_subjects fails a body stalled after the headers as request_timed_out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('["influenza",["Influ'));
              },
            }),
            { status: 200 },
          ),
      ),
    );

    const call = track(runToolContract(locSearchSubjects, { query: 'influenza' }));
    await vi.advanceTimersByTimeAsync(50_100);

    expect(call.done).toBe(true);
    expect(wireError(call.value!)).toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      data: { reason: 'request_timed_out' },
    });
  });

  it('libofcongress_get_newspaper_page degrades a budget-starved OCR leg to the retry notice on both surfaces', async () => {
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
          ? hangUntilAborted(url, init)
          : new Promise<Response>((resolve) =>
              setTimeout(() => resolve(new Response(pageBody, { status: 200 })), 45_000),
            ),
      ),
    );

    const call = track(runToolContract(locGetNewspaperPage, { page_url: PAGE_URL }));
    await vi.advanceTimersByTimeAsync(50_100);

    expect(call.done).toBe(true);
    const result = call.value!;
    expect(result.isError).toBeFalsy();
    expect(structured(result)).toMatchObject({ ocr_available: true, ocr_text: '' });
    expect(String(structured(result).notice)).toMatch(/full text was not returned this call/);
    expect(contentText(result)).toMatch(/full text was not returned this call/);
  });

  it('keeps a caller cancel a cancel, not a timeout, through the contract runner', async () => {
    vi.stubGlobal('fetch', vi.fn(hangUntilAborted));
    const controller = new AbortController();

    const call = track(
      runToolContract(
        locSearchNewspapers,
        { query: 'influenza epidemic' },
        { context: { signal: controller.signal } },
      ),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(call.done).toBe(true);
    expect(wireError(call.value!).code).toBe(JsonRpcErrorCode.RequestCancelled);
  });
});
