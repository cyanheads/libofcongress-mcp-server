/**
 * @fileoverview Catalog metadata rendered as literal Markdown text, and OCR preserved in fences.
 * @module mcp-server/tools/render-text
 */

import { escapeMarkdownInline, markdown } from '@cyanheads/mcp-ts-core/utils';

/** A catalog value in a single-line heading or labeled field; line breaks become spaces. */
export function inlineText(value: string): string {
  return escapeMarkdownInline(value.replace(/\r\n|\r|\n/g, ' '));
}

/** A paragraph or list value, with its whitespace and Markdown punctuation preserved as text. */
export function lineText(value: string): string {
  return escapeMarkdownInline(value);
}

/** A fence longer than any backtick run in the OCR text keeps every byte inside the block. */
export function fencedText(text: string): string {
  return markdown().codeBlock(text).build();
}
