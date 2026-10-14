/**
 * @fileoverview Response notices shared by the LOC tools — a writer that keeps every notice one
 * response raises, and the disclosure for a `limit` served at the per-call page-size cap.
 * @module mcp-server/tools/notices
 */

import type { Context } from '@cyanheads/mcp-ts-core';

/**
 * Returns a writer that adds `text` to this response's `notice`. `ctx.enrich.notice` (and
 * `ctx.enrich.truncated`, which also writes `notice`) keeps only the last write, so a handler with
 * more than one notice source routes every one through a single writer: each sentence survives,
 * space-joined in the order raised. Create one writer per handler call.
 */
export function noticeWriter(ctx: Context): (text: string) => void {
  const parts: string[] = [];
  return (text) => {
    parts.push(text);
    ctx.enrich.notice(parts.join(' '));
  };
}

/**
 * Discloses a paged `limit` above the per-call cap: the page holds `cap` results and page numbers
 * count `cap`-result pages. Names the next page only when one follows.
 */
export function pageSizeClampNotice(
  requested: number,
  cap: number,
  page: number,
  hasNext: boolean,
): string {
  const clamp = `Requested limit ${requested} exceeds the per-call cap of ${cap}; this page holds up to ${cap} results, and page numbers count ${cap}-result pages.`;
  return hasNext
    ? `${clamp} Request page ${page + 1} with limit ${cap} for the next results.`
    : clamp;
}
