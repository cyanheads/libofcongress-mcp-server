/**
 * @fileoverview Wire-shape tests for the failure reasons every LOC-backed definition declares for
 * its upstream: `server_busy` (this server's www.loc.gov queue cannot start the request within the
 * call's budget), `request_timed_out` (the upstream did not answer within the 50 s per-call
 * budget), and `upstream_unavailable` (the upstream could not be reached, or answered with an
 * error status, HTML, or an unreadable body). Each runs the real service under the definition
 * through `runToolContract`, so both `structuredContent` and `content[]` are checked.
 * @module tests/tools/loc-upstream-failure-reasons.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { locItemResource } from '@/mcp-server/resources/definitions/libofcongress-item.resource.js';
import { locBrowseCollections } from '@/mcp-server/tools/definitions/libofcongress-browse-collections.tool.js';
import { locGetItem } from '@/mcp-server/tools/definitions/libofcongress-get-item.tool.js';
import { locGetNewspaperPage } from '@/mcp-server/tools/definitions/libofcongress-get-newspaper-page.tool.js';
import { locSearchItems } from '@/mcp-server/tools/definitions/libofcongress-search-items.tool.js';
import { locSearchNewspapers } from '@/mcp-server/tools/definitions/libofcongress-search-newspapers.tool.js';
import { locSearchSubjects } from '@/mcp-server/tools/definitions/libofcongress-search-subjects.tool.js';
import { initLcLinkedDataService } from '@/services/lc-linked-data/lc-linked-data-service.js';
import { getLocApiService, initLocApiService } from '@/services/loc-api/loc-api-service.js';
import { LOC_CHALLENGE_BODY as CHALLENGE_BODY } from '../fixtures/loc-challenge.js';
import { readItemResourceError } from '../helpers/item-resource-read.js';
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
      resource: { url: 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/' },
      fulltext_service: 'https://tile.loc.gov/text-services/full_text.json',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        new URL(url).hostname === 'tile.loc.gov'
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

/** Bun's own error for a refused connection: a code-prefixed message carrying transport advice. */
const refusedConnection = () =>
  Object.assign(
    new Error('ECONNREFUSED: Unable to connect. Is the computer able to access the url?'),
    {
      code: 'ECONNREFUSED',
    },
  );

/** Upstream outage shapes, each with how many requests one call sends before giving up. */
const outages = [
  {
    name: 'a refused connection',
    respond: (): Promise<Response> => Promise.reject(refusedConnection()),
    sends: 4,
  },
  {
    name: 'a 503',
    respond: async () => new Response('Service Unavailable', { status: 503 }),
    sends: 1,
  },
  {
    name: 'an empty 200',
    respond: async () => new Response('', { status: 200 }),
    sends: 1,
  },
  // JSON that parses but is not the response object: read as one, it fails as a TypeError (null),
  // a not-found (a string or array has no item or resource), or an empty search (an array).
  {
    name: 'a null 200',
    respond: async () => new Response('null', { status: 200 }),
    sends: 1,
  },
  {
    name: 'a bare-string 200',
    respond: async () => new Response('"Service temporarily unavailable"', { status: 200 }),
    sends: 1,
  },
  {
    name: 'an array 200',
    respond: async () => new Response('[]', { status: 200 }),
    sends: 1,
  },
] as const;

/** Nothing in what a caller reads may carry a URL, host, or transport error text. */
const TRANSPORT_LEAK = /loc\.gov|https?:|ECONN|Unable to connect|failed after/;

describe('upstream_unavailable — the upstream cannot be reached or answers with something other than its JSON', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.unstubAllGlobals();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    initLcLinkedDataService(config, storage);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const definitions = [
    ...wwwTools,
    { definition: locSearchSubjects, input: { query: 'influenza' } },
  ];
  const cases = definitions.flatMap(({ definition, input }) =>
    outages.map((outage) => ({ name: definition.name, definition, input, outage })),
  );

  it.each(cases)(
    '$name reports $outage.name as upstream_unavailable on both surfaces',
    async ({ definition, input, outage }) => {
      fetchSpy.mockImplementation(outage.respond);

      const call = track(runToolContract(definition, input as never));
      await vi.advanceTimersByTimeAsync(20_000);

      expect(call.done).toBe(true);
      const result = call.value!;
      const error = wireError(result);
      const hint = contractRecovery(definition, 'upstream_unavailable');
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: { reason: 'upstream_unavailable', recovery: { hint } },
      });
      expect(hint).toMatch(/retry in a few minutes/i);
      const text = contentText(result);
      expect(text).toContain(`Recovery: ${hint}`);
      expect(text).toContain('reason upstream_unavailable');
      expect(`${text} ${JSON.stringify(error)}`).not.toMatch(TRANSPORT_LEAK);
      expect(fetchSpy).toHaveBeenCalledTimes(outage.sends);
    },
  );

  it.each(outages)(
    'the item resource reports $name as upstream_unavailable with the contract recovery',
    async (outage) => {
      fetchSpy.mockImplementation(outage.respond);

      const call = track(readItemResourceError('libofcongress://item/2009632251'));
      await vi.advanceTimersByTimeAsync(20_000);

      expect(call.done).toBe(true);
      expect(call.value).toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: {
          reason: 'upstream_unavailable',
          recovery: { hint: contractRecovery(locItemResource, 'upstream_unavailable') },
        },
      });
      expect(JSON.stringify(call.value)).not.toMatch(TRANSPORT_LEAK);
      expect(fetchSpy).toHaveBeenCalledTimes(outage.sends);
    },
  );

  it('libofcongress_search_subjects reports an HTML 200 as upstream_unavailable with the contract recovery', async () => {
    fetchSpy.mockImplementation(
      async () =>
        new Response('<!DOCTYPE html><html><body>Maintenance</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    );

    const error = wireError(await runToolContract(locSearchSubjects, { query: 'influenza' }));

    expect(error).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: {
        reason: 'upstream_unavailable',
        recovery: { hint: contractRecovery(locSearchSubjects, 'upstream_unavailable') },
      },
    });
    expect(error.data).not.toHaveProperty('retryAfter');
  });

  it.each(outages)(
    'libofcongress_search_subjects reports $name on the left-anchored retry as upstream_unavailable',
    async (outage) => {
      // The keyword search matches nothing, so the call sends its one left-anchored retry.
      fetchSpy.mockImplementation(async (url) =>
        new URL(String(url)).searchParams.get('searchtype') === 'keyword'
          ? new Response(JSON.stringify({ q: 'aerial photog*', count: 0, hits: [] }), {
              status: 200,
            })
          : outage.respond(),
      );

      const call = track(runToolContract(locSearchSubjects, { query: 'aerial photog' }));
      await vi.advanceTimersByTimeAsync(20_000);

      expect(call.done).toBe(true);
      const result = call.value!;
      const hint = contractRecovery(locSearchSubjects, 'upstream_unavailable');
      expect(wireError(result)).toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: { reason: 'upstream_unavailable', recovery: { hint } },
      });
      expect(contentText(result)).toContain('reason upstream_unavailable');
      expect(contentText(result)).not.toMatch(TRANSPORT_LEAK);
      expect(fetchSpy).toHaveBeenCalledTimes(1 + outage.sends);
    },
  );

  it('names the subject heading service, not the item API, in the subjects recovery', () => {
    expect(contractRecovery(locSearchSubjects, 'upstream_unavailable')).toMatch(
      /subject heading service/,
    );
  });
});

/** www.loc.gov soft blocks: the observed challenge, and LOC's documented HTML page on a 200. */
const softBlocks = [
  {
    name: 'a cf-mitigated challenge 403',
    respond: async () =>
      new Response(CHALLENGE_BODY, {
        status: 403,
        headers: { 'Content-Type': 'text/html; charset=UTF-8', 'cf-mitigated': 'challenge' },
      }),
  },
  {
    name: 'an HTML 200',
    respond: async () =>
      new Response(CHALLENGE_BODY, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      }),
  },
] as const;

describe('upstream_unavailable with retryAfter — www.loc.gov answers with a challenge or an HTML page', () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.unstubAllGlobals();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    initLcLinkedDataService(config, storage);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const cases = wwwTools.flatMap(({ definition, input }) =>
    softBlocks.map((softBlock) => ({ name: definition.name, definition, input, softBlock })),
  );

  it.each(cases)(
    '$name fails $softBlock.name with retryAfter 60 on both surfaces, then refuses the next call without sending',
    async ({ definition, input, softBlock }) => {
      fetchSpy.mockImplementation(softBlock.respond);

      const result = await runToolContract(definition, input as never);

      const error = wireError(result);
      // The timed hint wins over the contract's static "retry in a few minutes".
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: {
          reason: 'upstream_unavailable',
          retryAfter: 60,
          recovery: { hint: 'Wait 60 seconds, then retry.' },
        },
      });
      const text = contentText(result);
      expect(text).toContain('Recovery: Wait 60 seconds, then retry.');
      expect(text).toContain('reason upstream_unavailable');
      expect(`${text} ${JSON.stringify(error)}`).not.toMatch(TRANSPORT_LEAK);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(15_000);
      const next = wireError(await runToolContract(definition, input as never));
      expect(next).toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: {
          reason: 'upstream_unavailable',
          retryAfter: 45,
          recovery: { hint: 'Wait 45 seconds, then retry.' },
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it.each(softBlocks)(
    'the item resource fails $name with retryAfter 60 and its timed hint',
    async ({ respond }) => {
      fetchSpy.mockImplementation(respond);

      const error = await readItemResourceError('libofcongress://item/2009632251');

      expect(error).toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: {
          reason: 'upstream_unavailable',
          retryAfter: 60,
          recovery: { hint: 'Wait 60 seconds, then retry.' },
        },
      });
      expect(JSON.stringify(error)).not.toMatch(TRANSPORT_LEAK);
    },
  );

  it('leaves libofcongress_search_subjects sending to its own host during a www.loc.gov pause', async () => {
    fetchSpy.mockImplementation(softBlocks[0].respond);
    const challenged = await runToolContract(locSearchItems, { query: 'railroad strike' });
    // The www.loc.gov pause is in force: the item search failed with the full 60 s left.
    expect(wireError(challenged).data).toMatchObject({
      reason: 'upstream_unavailable',
      retryAfter: 60,
    });

    fetchSpy.mockImplementation(async (url) =>
      new URL(String(url)).hostname === 'id.loc.gov'
        ? new Response(
            JSON.stringify({
              q: 'influenza*',
              count: 1,
              pagesize: 10,
              start: 1,
              sortmethod: 'rank',
              searchtype: 'keyword',
              directory: '/authorities/subjects/',
              hits: [
                {
                  suggestLabel: 'Influenza',
                  uri: 'http://id.loc.gov/authorities/subjects/sh85066145',
                  aLabel: 'Influenza',
                },
              ],
            }),
            { status: 200 },
          )
        : Promise.reject(new Error('unexpected www.loc.gov request')),
    );
    const result = await runToolContract(locSearchSubjects, { query: 'influenza' });

    expect(result.isError).toBeFalsy();
    expect(structured(result)).toMatchObject({ subjects: [{ label: 'Influenza' }] });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
