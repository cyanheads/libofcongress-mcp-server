/**
 * @fileoverview Tests for the shared LOC HTTP resilience helpers — the transient-network retry
 * predicate and the timeout ceiling (kept in its own file so fake timers can't bleed into the
 * module-level rate-limit state exercised in loc-api-service.test.ts).
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
import { defaultIsTransient, withRetry } from '@cyanheads/mcp-ts-core/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isTransientNetworkFault,
  LOC_TIMEOUT_MS,
  locRetryOptions,
  timedFetch,
} from '@/services/http.js';

describe('isTransientNetworkFault', () => {
  it('retries raw network errors (non-McpError socket drops)', () => {
    expect(isTransientNetworkFault(new TypeError('The socket connection was closed'))).toBe(true);
  });

  it('retries a Timeout McpError', () => {
    expect(isTransientNetworkFault(new McpError(JsonRpcErrorCode.Timeout, 'timed out'))).toBe(true);
  });

  it('never retries a RateLimited McpError — LOC blocks the IP for ~1 hour', () => {
    expect(isTransientNetworkFault(rateLimited('rate limited'))).toBe(false);
  });

  it('never retries a ServiceUnavailable McpError (5xx / HTML soft-block)', () => {
    expect(isTransientNetworkFault(serviceUnavailable('unavailable'))).toBe(false);
  });

  it('never retries a RequestCancelled McpError — the caller went away', () => {
    expect(isTransientNetworkFault(requestCancelled('cancelled'))).toBe(false);
  });
});

describe('withRetry under locRetryOptions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails a status-derived ServiceUnavailable on the first attempt, unlike the framework default', async () => {
    // The framework's default predicate retries 5xx; LOC's soft-block path must not re-hit the host.
    expect(defaultIsTransient(serviceUnavailable('unavailable'))).toBe(true);
    const fn = vi.fn().mockRejectedValue(serviceUnavailable('unavailable'));
    const ctx = createMockContext();

    await expect(withRetry(fn, locRetryOptions(ctx, 'test'))).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fails a RateLimited error on the first attempt', async () => {
    const fn = vi.fn().mockRejectedValue(rateLimited('rate limited'));
    const ctx = createMockContext();

    await expect(withRetry(fn, locRetryOptions(ctx, 'test'))).rejects.toMatchObject({
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
    const ctx = createMockContext();

    const settled = withRetry(fn, locRetryOptions(ctx, 'test'));
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(settled).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('timedFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('resolves with the response when fetch completes within the ceiling', async () => {
    const good = new Response('{"ok":true}', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(good));
    const ctx = createMockContext();
    const res = await timedFetch('https://www.loc.gov/item/x', {}, ctx);
    expect(res.status).toBe(200);
  });

  it('rejects with a Timeout error carrying no internal URL when the ceiling is exceeded', async () => {
    vi.useFakeTimers();
    // Never settles until its signal aborts — mimics a hung connection so the timeout fires.
    const fetchSpy = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();

    const settled = timedFetch('https://www.loc.gov/secret-path', {}, ctx).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(LOC_TIMEOUT_MS + 100);
    const err = await settled;

    expect(err).toMatchObject({ code: JsonRpcErrorCode.Timeout });
    // The framework's own fetchWithTimeout embeds origin+pathname; ours must not leak the host.
    expect((err as Error).message).not.toContain('www.loc.gov');
    expect(JSON.stringify((err as McpError).data ?? {})).not.toContain('www.loc.gov');
  });
});
