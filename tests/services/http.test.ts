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
  serviceUnavailable,
} from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTransientNetworkFault, LOC_TIMEOUT_MS, timedFetch } from '@/services/http.js';

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
