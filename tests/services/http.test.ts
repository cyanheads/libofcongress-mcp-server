/**
 * @fileoverview Tests for the shared LOC HTTP resilience helpers — the raw-network-fault retry
 * predicate, the per-call budget ladder, and the signal-bounded body read (kept in its own file
 * so fake timers can't bleed into the module-level rate-limit state exercised in
 * loc-api-service.test.ts).
 * @module tests/services/http.test
 */

import {
  JsonRpcErrorCode,
  McpError,
  rateLimited,
  requestCancelled,
  serviceUnavailable,
} from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { createPacer, defaultIsTransient } from '@cyanheads/mcp-ts-core/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isTransientNetworkFault,
  LOC_CALL_BUDGET_MS,
  readText,
  retryWithinBudget,
} from '@/services/http.js';

describe('isTransientNetworkFault', () => {
  it('retries raw network errors (non-McpError socket drops)', () => {
    expect(isTransientNetworkFault(new TypeError('The socket connection was closed'))).toBe(true);
  });

  it('never retries a JSON SyntaxError — a complete but malformed body parses the same way again', () => {
    expect(isTransientNetworkFault(new SyntaxError('Unexpected end of JSON input'))).toBe(false);
  });

  it('never retries a Timeout McpError — a spent budget ends the ladder instead of re-sending', () => {
    expect(isTransientNetworkFault(new McpError(JsonRpcErrorCode.Timeout, 'timed out'))).toBe(
      false,
    );
  });

  it('never retries a RateLimited McpError — LOC blocks the IP for ~1 hour', () => {
    expect(isTransientNetworkFault(rateLimited('rate limited'))).toBe(false);
  });

  it('never retries a pacer shed — the caller waits out retryAfter, not this loop', async () => {
    const pacer = createPacer({ name: 'test', minStartGapMs: 60_000 });
    await pacer.run(async () => 'first');
    const shed = await pacer.run(async () => 'second', { maxWaitMs: 0 }).catch((e: unknown) => e);
    pacer.dispose();

    expect(shed).toMatchObject({ data: { reason: 'pacer_shed' } });
    expect(isTransientNetworkFault(shed)).toBe(false);
  });

  it('never retries a ServiceUnavailable McpError (5xx / HTML soft-block)', () => {
    expect(isTransientNetworkFault(serviceUnavailable('unavailable'))).toBe(false);
  });

  it('never retries a RequestCancelled McpError — the caller went away', () => {
    expect(isTransientNetworkFault(requestCancelled('cancelled'))).toBe(false);
  });
});

describe('retryWithinBudget', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const budget = (ctx = createMockContext()) => ({
    ctx,
    operation: 'loc-api-test-op',
    deadlineAt: Date.now() + LOC_CALL_BUDGET_MS,
    upstream: 'The Library of Congress',
  });

  it('fails a status-derived ServiceUnavailable on the first attempt, unlike the framework default', async () => {
    // The framework's default predicate retries 5xx; LOC's soft-block path must not re-hit the host.
    expect(defaultIsTransient(serviceUnavailable('unavailable'))).toBe(true);
    const fn = vi.fn().mockRejectedValue(serviceUnavailable('unavailable'));

    await expect(retryWithinBudget(fn, budget())).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fails a RateLimited error on the first attempt', async () => {
    const fn = vi.fn().mockRejectedValue(rateLimited('rate limited'));

    await expect(retryWithinBudget(fn, budget())).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a raw network fault and returns the next attempt', async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('The socket connection was closed'))
      .mockResolvedValueOnce('ok');

    const settled = retryWithinBudget(fn, budget());
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(settled).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('hands each attempt the time left and a signal that fires when the budget ends', async () => {
    vi.useFakeTimers();
    const seen: { remainingMs: number; signal: AbortSignal }[] = [];
    const fn = vi.fn(
      (attempt: { remainingMs: number; signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          seen.push(attempt);
          attempt.signal.addEventListener('abort', () => reject(attempt.signal.reason));
        }),
    );

    const settled = retryWithinBudget(fn, budget()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(LOC_CALL_BUDGET_MS + 10);
    const err = await settled;

    expect(seen).toHaveLength(1);
    expect(seen[0]?.remainingMs).toBe(LOC_CALL_BUDGET_MS);
    expect(seen[0]?.signal.aborted).toBe(true);
    expect(err).toBeInstanceOf(McpError);
    expect(err).toMatchObject({ code: JsonRpcErrorCode.Timeout });
    // The caller reads the upstream by name only: no operation label, URL, or host.
    expect((err as McpError).message).toBe(
      'The Library of Congress did not respond within the 50-second request budget.',
    );
    expect(JSON.stringify((err as McpError).data ?? {})).not.toContain('loc-api-test-op');
  });

  it('reports an exhausted network-fault ladder as upstream_unavailable, the transport error kept on cause only', async () => {
    vi.useFakeTimers();
    const transport = new TypeError('getaddrinfo ENOTFOUND www.loc.gov');
    const fn = vi.fn().mockRejectedValue(transport);

    const settled = retryWithinBudget(fn, budget()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await settled;

    expect(fn).toHaveBeenCalledTimes(4);
    expect(err).toBeInstanceOf(McpError);
    expect(err).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'The Library of Congress could not be reached.',
    });
    expect((err as McpError).data).toEqual({ reason: 'upstream_unavailable' });
    // withRetry's exhausted wrapper sits between: its cause is the transport error itself.
    expect(((err as McpError).cause as Error).cause).toBe(transport);
  });

  it('reports a malformed or empty 200 body as upstream_unavailable on the first attempt, not as bad input', async () => {
    const fn = vi.fn().mockRejectedValue(new SyntaxError('JSON Parse error: Unexpected EOF'));

    const err = await retryWithinBudget(fn, budget()).catch((e: unknown) => e);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(err).toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      message: 'The Library of Congress returned an incomplete or malformed response.',
    });
    // The parser's text stays on `cause`; the caller reads the reason alone.
    expect((err as McpError).data).toEqual({ reason: 'upstream_unavailable' });
  });

  it('leaves an McpError from the attempt untouched', async () => {
    const thrown = serviceUnavailable('LOC API returned HTTP 503', {
      status: 503,
      reason: 'upstream_unavailable',
    });
    const fn = vi.fn().mockRejectedValue(thrown);

    await expect(retryWithinBudget(fn, budget())).rejects.toBe(thrown);
  });

  it('rethrows a caller cancel unchanged, never as a timeout', async () => {
    const controller = new AbortController();
    const ctx = createMockContext({ signal: controller.signal });
    const fn = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );

    const settled = retryWithinBudget(fn, budget(ctx)).catch((e: unknown) => e);
    controller.abort(new DOMException('caller went away', 'AbortError'));
    const err = await settled;

    expect(err).toMatchObject({ name: 'AbortError', message: 'caller went away' });
    expect(err).not.toBeInstanceOf(McpError);
  });

  it('rethrows a caller cancel that lands on a network fault unchanged, never as upstream_unavailable', async () => {
    const controller = new AbortController();
    const ctx = createMockContext({ signal: controller.signal });
    const fault = new TypeError('The socket connection was closed unexpectedly');
    const fn = vi.fn(async () => {
      controller.abort(new DOMException('caller went away', 'AbortError'));
      throw fault;
    });

    const err = await retryWithinBudget(fn, budget(ctx)).catch((e: unknown) => e);

    expect(err).toBe(fault);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('readText', () => {
  it('returns the body when it completes before the signal fires', async () => {
    const res = new Response('{"ok":true}', { status: 200 });
    await expect(readText(res, new AbortController().signal)).resolves.toBe('{"ok":true}');
  });

  it('rejects with the signal reason when a body stalls after the headers', async () => {
    const stalled = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial'));
        },
      }),
      { status: 200 },
    );
    const controller = new AbortController();
    const reason = new DOMException('budget spent', 'TimeoutError');

    const settled = readText(stalled, controller.signal).catch((e: unknown) => e);
    controller.abort(reason);

    expect(await settled).toBe(reason);
  });

  it('rejects at once when the signal has already fired', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('budget spent', 'TimeoutError'));
    await expect(
      readText(new Response('{}', { status: 200 }), controller.signal),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
