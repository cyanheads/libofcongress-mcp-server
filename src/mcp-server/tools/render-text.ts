/**
 * @fileoverview Upstream text in `format()` output. Catalog metadata interpolated into a line is
 * kept on that line and escaped only where Markdown would read it as HTML, as a character
 * reference, or as an escape of what follows the value; OCR text goes in a fenced code block. `structuredContent` carries every value as is.
 * @module mcp-server/tools/render-text
 */

import { markdown } from '@cyanheads/mcp-ts-core/utils';

const LINE_BREAK = /\r\n|\r|\n/g;

/**
 * A `<` that opens a CommonMark raw-HTML construct or autolink (followed by a letter, `/`, `!`, or
 * `?`), or an `&` that opens a character reference (`&lt;`, `&#60;`, `&#x3C;`). The lookaheads are
 * bounded, so the scan stays linear.
 */
const MARKUP_OPENER =
  /<(?=[A-Za-z/!?]|$)|&(?=#\d{1,7}(?:;|$)|#[xX][0-9A-Fa-f]{1,6}(?:;|$)|[A-Za-z][A-Za-z0-9]{0,31}(?:;|$))/g;

const BACKSLASH = 92;

/**
 * `value` for an inline slot of a Markdown line — a heading, a bold-labeled field, a list entry:
 * line breaks become spaces, and each markup opener is backslash-escaped so it renders as the
 * character it is. Backslashes already standing before an opener are doubled, so they render as
 * themselves and the added escape still applies; so are backslashes ending the value, which would
 * otherwise escape whatever the template writes next — a line break (a hard break) or the `**`
 * closing a bold span. `1866-<1899>.` and other text render unchanged; underscores, asterisks, and
 * every other character are left alone.
 */
export function inlineText(value: string): string {
  const escaped = value
    .replace(LINE_BREAK, ' ')
    .replace(MARKUP_OPENER, (opener, offset: number, text: string) => {
      let start = offset;
      while (start > 0 && text.charCodeAt(start - 1) === BACKSLASH) start--;
      return `${'\\'.repeat(offset - start)}\\${opener}`;
    });
  let end = escaped.length;
  while (end > 0 && escaped.charCodeAt(end - 1) === BACKSLASH) end--;
  return escaped + escaped.slice(end);
}

/**
 * A Markdown block marker opening a line: a heading `#`, quote `>`, bullet or thematic break (`-`,
 * `+`, `*`, `_`), setext underline `=`, code fence (`` ` ``, `~`), or an ordered-list number
 * (`1.`, `1898)`).
 */
const LEADING_BLOCK_MARKER = /^(?:[#>+*_=`~-]|\d{1,9}(?=[.)]))/;

/**
 * `value` for a slot that opens a Markdown line — a paragraph line of its own or a list entry:
 * {@link inlineText}, with leading spaces and tabs dropped and a leading block marker escaped, so
 * catalog text cannot open a heading, quote, list, rule, fence, or indented code block.
 */
export function lineText(value: string): string {
  return inlineText(value)
    .replace(/^[ \t]+/, '')
    .replace(LEADING_BLOCK_MARKER, (marker) => (/\d/.test(marker) ? `${marker}\\` : `\\${marker}`));
}

/**
 * `text` in a fenced code block whose fence is longer than any backtick run in it, so nothing in
 * the text can close the block early. The text between the fences is `text`, byte for byte.
 */
export function fencedText(text: string): string {
  return markdown().codeBlock(text).build();
}
