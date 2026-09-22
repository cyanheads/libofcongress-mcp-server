/**
 * @fileoverview Readers over a tool's wire result — the `structuredContent` and `content[]`
 * surfaces a client actually receives from `runToolContract`.
 * @module tests/helpers/tool-result
 */

import type { runToolContract } from '@cyanheads/mcp-ts-core/testing';

type ToolResult = Awaited<ReturnType<typeof runToolContract>>;

/** The `structuredContent.error` envelope of a failed call. */
export interface WireError {
  code: number;
  data?: Record<string, unknown> & { recovery?: { hint?: string } };
  message: string;
}

/** Concatenated text of every `content[]` text block. */
export function contentText(result: ToolResult): string {
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

/** `structuredContent` of a successful call. */
export function structured(result: ToolResult): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

/** `structuredContent.error` of a failed call; throws when the call succeeded. */
export function wireError(result: ToolResult): WireError {
  const error = (result.structuredContent as { error?: WireError } | undefined)?.error;
  if (!result.isError || !error) throw new Error('Expected a tool error result.');
  return error;
}

/** The `recovery` text a definition's `errors[]` contract declares for `reason`. */
export function contractRecovery(
  definition: { errors?: readonly { reason: string; recovery: string }[] },
  reason: string,
): string {
  const entry = definition.errors?.find((e) => e.reason === reason);
  if (!entry) throw new Error(`No errors[] entry declares reason '${reason}'.`);
  return entry.recovery;
}
