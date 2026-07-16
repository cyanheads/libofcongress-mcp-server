/**
 * @fileoverview Shared HTTP resilience for the LOC upstreams — a timeout ceiling composed
 * with the request's abort signal, plus a retry predicate scoped to the transient-network
 * class only (never LOC's rate-limit path).
 * @module services/http
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import type { RequestContextLike, RetryOptions } from '@cyanheads/mcp-ts-core/utils';

/** Per-request timeout ceiling (ms) for every LOC upstream call. */
export const LOC_TIMEOUT_MS = 30_000;

/**
 * Backoff base (ms) for transient-fault retries. Composes with — rather than replaces —
 * each service's own request pacing; the two delays stack, both protecting the upstream.
 */
const RETRY_BASE_DELAY_MS = 1_100;

/**
 * Retry predicate scoped to the transient-network class. LOC blocks the caller's IP for
 * ~1 hour once its 20 req/min limit trips, so any status-derived error — rate limit,
 * service-unavailable, HTML soft-block, not-found — must fail fast rather than re-hit a
 * possibly blocked endpoint. Raw `fetch` rejections (socket drops, connection resets, DNS
 * failures) surface as non-`McpError` throws and are the class worth retrying, alongside
 * our own {@link timedFetch} timeout.
 */
export function isTransientNetworkFault(error: unknown): boolean {
  if (error instanceof McpError) return error.code === JsonRpcErrorCode.Timeout;
  return true;
}

/** `withRetry` options for a LOC upstream call: transient-only predicate, cancel-aware, paced backoff. */
export function locRetryOptions(ctx: Context, operation: string): RetryOptions {
  return {
    operation,
    // Handler `Context` lacks the open index signature of `RequestContext`; the framework's
    // sanctioned cast to the closed `RequestContextLike` projection lets it pass for log correlation.
    context: ctx as unknown as RequestContextLike,
    signal: ctx.signal,
    isTransient: isTransientNetworkFault,
    baseDelayMs: RETRY_BASE_DELAY_MS,
  };
}

/**
 * `fetch` with a timeout ceiling composed with the request's abort signal.
 *
 * On timeout, rejects with a `Timeout` `McpError` whose message carries no URL — preserving
 * the services' no-internal-URL invariant (the framework's own `fetchWithTimeout` embeds
 * `origin + pathname` in its thrown message, which would leak `www.loc.gov`). A caller-side
 * cancel (`ctx.signal`) propagates its own reason unchanged, so `withRetry` stops on cancel
 * rather than treating it as a transient fault.
 */
export async function timedFetch(url: string, init: RequestInit, ctx: Context): Promise<Response> {
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () =>
      timeoutController.abort(
        new McpError(
          JsonRpcErrorCode.Timeout,
          `LOC request exceeded the ${LOC_TIMEOUT_MS}ms timeout ceiling.`,
        ),
      ),
    LOC_TIMEOUT_MS,
  );
  const signal = ctx.signal
    ? AbortSignal.any([timeoutController.signal, ctx.signal])
    : timeoutController.signal;
  try {
    return await fetch(url, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }
}
