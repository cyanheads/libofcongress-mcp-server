/**
 * @fileoverview Text normalization for www.loc.gov and tile.loc.gov strings: HTML character
 * references decoded once, and the HTML rights statement LOC sends as `item.rights` reduced to
 * plain text with its link targets kept.
 * @module services/loc-api/loc-text
 */

import { decodeHTMLStrict } from 'entities';

/** Origin LOC's relative links (`/legal/`) resolve against. */
const LOC_ORIGIN = 'https://www.loc.gov';

/** The character after `<` that makes it an HTML tag, comment, declaration, or instruction. */
const TAG_START = /[A-Za-z/!?]/;
/** Tags that separate words: block elements and line breaks. Matched against the tag's text. */
const BREAK_TAG = /^\/?(?:p|br|div|li|ul|ol|h[1-6]|tr|td|th|blockquote)\b/i;
const LINK_OPEN = /^a\b/i;
const LINK_CLOSE = /^\/a\b/i;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/i;
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * `value` with its HTML character references decoded — named (`&hellip;`), decimal (`&#8217;`),
 * and hex (`&#xA0;`). One pass: `&amp;lt;` becomes `&lt;`, never `<`. Only references closed by
 * `;` are decoded, so plain text such as `a=1&copy=2` or `&c.` stays as written.
 */
export function decodeText(value: string): string {
  return decodeHTMLStrict(value);
}

/** An `href` resolved against www.loc.gov, kept only when it is an http(s) or mailto link. */
function linkTarget(tag: string): string | undefined {
  const match = HREF.exec(tag);
  const href = decodeText(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
  if (!href || !URL.canParse(href, LOC_ORIGIN)) return;
  const url = new URL(href, LOC_ORIGIN);
  return LINK_PROTOCOLS.has(url.protocol) ? url.href : undefined;
}

/**
 * Plain text of an HTML fragment: tags removed, character references decoded once, every run of
 * whitespace (line breaks and no-break spaces included) collapsed to one space. A link keeps its
 * target as an absolute URL after its text — `Copyright (https://www.loc.gov/legal/)` — unless the
 * text already is that URL. A `<` that opens no tag (`1866-<1899>`) is text.
 *
 * One forward pass: each `<` that opens a tag is closed by the next `>`, and once no `>` follows,
 * the rest is text, so no character is scanned twice.
 */
export function htmlToText(html: string): string {
  const parts: string[] = [];
  let link: { url: string; from: number } | undefined;
  let i = 0;
  for (;;) {
    let lt = html.indexOf('<', i);
    while (lt !== -1 && !TAG_START.test(html.charAt(lt + 1))) lt = html.indexOf('<', lt + 1);
    const gt = lt === -1 ? -1 : html.indexOf('>', lt + 1);
    if (gt === -1) {
      parts.push(decodeText(html.slice(i)));
      break;
    }
    parts.push(decodeText(html.slice(i, lt)));
    const tag = html.slice(lt + 1, gt);
    if (LINK_OPEN.test(tag)) {
      const url = linkTarget(tag);
      link = url ? { url, from: parts.length } : undefined;
    } else if (LINK_CLOSE.test(tag) && link) {
      const text = parts.slice(link.from).join('').trim();
      if (text !== link.url) parts.push(` (${link.url})`);
      link = undefined;
    } else if (BREAK_TAG.test(tag)) {
      parts.push(' ');
    }
    i = gt + 1;
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}
