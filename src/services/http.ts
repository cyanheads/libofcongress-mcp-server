/**
 * @fileoverview Shared HTTP resilience for the LOC upstreams — one wall-clock budget per tool
 * call across every attempt, backoff, queue wait, and body read, plus a retry predicate scoped
 * to raw network faults only (never LOC's rate-limit path).
 * @module services/http
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import { McpError, serviceUnavailable, timeout } from '@cyanheads/mcp-ts-core/errors';
import { type RetryAttempt, withRetry } from '@cyanheads/mcp-ts-core/utils';

/**
 * Wall-clock budget (ms) for one tool call, started at service-method entry and shared by every
 * leg — pacer queue wait, each attempt including its body read, backoff, and a second upstream
 * fetch. Under the MCP SDK client's 60 s default request timeout, so the caller receives this
 * server's typed error rather than the client's own `Request timed out`.
 */
export const LOC_CALL_BUDGET_MS = 50_000;

/**
 * Time (ms) a dispatched request keeps for itself. A caller may wait in the www.loc.gov queue
 * only for the budget left minus this reserve, so a request is never started too late to finish.
 */
export const LOC_REQUEST_RESERVE_MS = 30_000;

/**
 * Backoff base (ms) for transient-fault retries. Composes with — rather than replaces —
 * each service's own request pacing; the two delays stack, both protecting the upstream.
 */
const RETRY_BASE_DELAY_MS = 1_100;

/**
 * Retry predicate scoped to raw network faults. LOC blocks the caller's IP for ~1 hour once its
 * 20 req/min limit trips, so any status-derived error — rate limit, service-unavailable, HTML
 * soft-block, not-found — must fail fast rather than re-hit a possibly blocked endpoint, and a
 * pacer shed is local backpressure the caller waits out, not this loop. Raw `fetch` rejections
 * (socket drops, connection resets, DNS failures) surface as non-`McpError` throws and are the
 * class worth retrying. A `SyntaxError` is not one of them: a socket drop mid-body rejects the
 * body read itself, so a parse failure means a complete but malformed body, which a re-send
 * would only fetch again. There is no per-attempt timer: an attempt may run until the call's
 * budget ends, and a budget expiry ends the ladder rather than re-sending the request.
 */
export function isTransientNetworkFault(error: unknown): boolean {
  return !(error instanceof McpError || error instanceof SyntaxError);
}

/**
 * The `errors[]` reason every LOC-backed definition declares for an upstream that cannot be
 * reached or answers with something other than its JSON. Thrown by the services, never a handler.
 */
export const UPSTREAM_UNAVAILABLE = 'upstream_unavailable';

/**
 * Runs `fn` under `withRetry` with the time left before `deadlineAt` as its total deadline.
 * `fn` must thread `attempt.signal` (the deadline composed with `ctx.signal`) into its fetch and
 * body read. A deadline expiry is rethrown as a `Timeout` naming only `upstream` — no URL, host,
 * or internal operation label reaches the caller. A non-`McpError` the ladder gives up on — an
 * exhausted network fault, or a `SyntaxError` from an unreadable body — becomes
 * `ServiceUnavailable` with reason {@link UPSTREAM_UNAVAILABLE}, naming only `upstream`: transport
 * text (which can carry the host) stays on `cause` for the log. A caller cancel keeps `withRetry`'s
 * precedence and propagates unchanged.
 */
export async function retryWithinBudget<T>(
  fn: (attempt: RetryAttempt) => Promise<T>,
  options: { ctx: Context; operation: string; deadlineAt: number; upstream: string },
): Promise<T> {
  const { ctx, operation, deadlineAt, upstream } = options;
  try {
    return await withRetry(fn, {
      operation,
      context: ctx,
      signal: ctx.signal,
      isTransient: isTransientNetworkFault,
      baseDelayMs: RETRY_BASE_DELAY_MS,
      deadlineMs: Math.max(0, deadlineAt - Date.now()),
    });
  } catch (error) {
    if (error instanceof McpError && error.data?.reason === 'retry_deadline_exceeded') {
      throw timeout(
        `${upstream} did not respond within the ${LOC_CALL_BUDGET_MS / 1000}-second request budget.`,
        undefined,
        { cause: error },
      );
    }
    if (error instanceof McpError || ctx.signal.aborted) throw error;
    throw serviceUnavailable(
      error instanceof SyntaxError
        ? `${upstream} returned an incomplete or malformed response.`
        : `${upstream} could not be reached.`,
      { reason: UPSTREAM_UNAVAILABLE },
      { cause: error },
    );
  }
}

/**
 * Reads a response body as text, rejecting with `signal.reason` the moment `signal` aborts — so a
 * body that stalls after the headers is bounded by the same budget as the request that opened it.
 */
export function readText(response: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    response
      .text()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}
