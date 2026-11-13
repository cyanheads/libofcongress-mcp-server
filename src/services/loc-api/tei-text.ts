/**
 * @fileoverview The reading text of a Library of Congress TEI transcription — the American Memory
 * `<tei2>` files LOC keeps as a resource's `fulltext_file` (Lincoln papers, Bell family papers,
 * California Gold, Rare Book printed ephemera, the African American Pamphlet Collection). Only
 * `<body>` is read. In a `<text type="manuscript">` the editors' apparatus and the wording the
 * writer canceled are left out; in a printed `<text>` (`type="publication"`) the same markup is
 * what the page prints — a footnote mark, a printed footnote, display type — and is kept:
 *
 * | element | reading text |
 * |:--|:--|
 * | `<teiheader>`, `<pageinfo>`, `<illus>` | dropped with their content |
 * | `<anchor>` (a footnote mark) | dropped in a manuscript; kept in print |
 * | `<note anchor.ids=…>` (an editors' footnote; a printed one in print) | dropped in a manuscript; kept in print |
 * | `<hi rend="other">` (canceled wording; display type in print) | dropped in a manuscript; kept in print |
 * | `<note>` without `anchor.ids` (text written on the item) | kept |
 * | `<lb/>` | line break |
 * | `<hsep/>` (a gap within a printed line) | space |
 * | `<item>` | line break before it |
 * | `<p>`, `<div>`, `<head>`, `<list>` | paragraph break |
 * | any other element (`<hi>` in other renditions, `<handwritten>`, `<superscript>`) | its text kept |
 *
 * No DTD or external entity is resolved: a DOCTYPE is skipped unread, and character and entity
 * references in text are decoded exactly once, as HTML named and numeric references. Whitespace in
 * text collapses to one space, as XML renders it.
 *
 * One forward pass over the file: each `<` opens markup that is read to its end, and the scan
 * never returns to an earlier character, so the work is linear in the file's length.
 * @module services/loc-api/tei-text
 */

import { decodeText } from './loc-text.js';

/** Root element name of a transcription; any other root is not one. */
const ROOT = 'tei2';
/** Elements whose content never reaches the reading text. */
const DROPPED = new Set(['teiheader', 'pageinfo', 'illus']);
/** Elements that set their content apart as a paragraph. */
const PARAGRAPH = new Set(['p', 'div', 'head', 'list']);

/** XML whitespace: space, tab, line feed, carriage return. */
function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/** A character that may continue an XML name. */
function isNameChar(code: number): boolean {
  return (
    (code >= 97 && code <= 122) || // a-z
    (code >= 65 && code <= 90) || // A-Z
    (code >= 48 && code <= 57) || // 0-9
    code === 45 || // -
    code === 46 || // .
    code === 58 || // :
    code === 95 // _
  );
}

/** A character that may start an XML name. */
function isNameStart(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 58 || code === 95;
}

/** One open element on the stack. */
interface OpenElement {
  /** Whether this element's content is left out of the reading text. */
  drops: boolean;
  /** Whether this element sits in a `<text type="manuscript">`. */
  manuscript: boolean;
  name: string;
}

/**
 * The reading text of a TEI transcription file, or undefined when `xml` is not one: its root
 * element is not `tei2`, it has no `<body>`, or its markup does not parse (an unclosed tag,
 * comment, or attribute value; a close tag that does not match; a stray `<`; content after the
 * root). The text is the `<body>`'s, per the table in this module's header, with paragraphs
 * separated by a blank line and `<lb/>` lines by a line break.
 */
export function teiReadingText(xml: string): string | undefined {
  const stack: OpenElement[] = [];
  let rootClosed = false;
  let bodyDepth = 0;
  let sawBody = false;
  let dropDepth = 0;

  /** Reading-text chunks, and the separator owed before the next one. */
  const chunks: string[] = [];
  let gap: '' | ' ' | '\n' | '\n\n' = '';
  const reading = () => bodyDepth > 0 && dropDepth === 0;
  const pushText = (text: string) => {
    let i = 0;
    while (i < text.length) {
      if (isSpace(text.charCodeAt(i))) {
        if (gap === '') gap = ' ';
        i++;
        continue;
      }
      let j = i + 1;
      while (j < text.length && !isSpace(text.charCodeAt(j))) j++;
      if (chunks.length > 0 && gap) chunks.push(gap);
      chunks.push(text.slice(i, j));
      gap = '';
      i = j;
    }
  };
  const lineBreak = () => {
    gap = gap === '\n' || gap === '\n\n' ? '\n\n' : '\n';
  };
  const paragraphBreak = () => {
    gap = '\n\n';
  };

  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) {
      if (stack.length === 0) {
        // Only whitespace may stand outside the root element.
        for (let k = i; k < textEnd; k++) if (!isSpace(xml.charCodeAt(k))) return;
      } else if (reading()) {
        pushText(decodeText(xml.slice(i, textEnd)));
      }
    }
    if (lt === -1) break;

    // Comment, processing instruction (the XML declaration among them), CDATA, declaration.
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) return;
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) return;
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      if (stack.length === 0) return;
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) return;
      // CDATA is literal text: no reference in it is decoded.
      if (reading()) pushText(xml.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      // A DOCTYPE stands before the root; it is skipped, its internal subset unread.
      if (stack.length > 0 || rootClosed) return;
      let k = lt + 2;
      while (k < n && xml.charCodeAt(k) !== 62 /* > */) {
        if (xml.charCodeAt(k) === 91 /* [ */) {
          const close = xml.indexOf(']', k + 1);
          if (close === -1) return;
          k = close;
        }
        k++;
      }
      if (k >= n) return;
      i = k + 1;
      continue;
    }

    // Close tag.
    if (xml.charCodeAt(lt + 1) === 47 /* / */) {
      let k = lt + 2;
      if (k >= n || !isNameStart(xml.charCodeAt(k))) return;
      while (k < n && isNameChar(xml.charCodeAt(k))) k++;
      const name = xml.slice(lt + 2, k).toLowerCase();
      while (k < n && isSpace(xml.charCodeAt(k))) k++;
      if (xml.charCodeAt(k) !== 62 /* > */) return;
      const open = stack.pop();
      if (open?.name !== name) return;
      if (PARAGRAPH.has(name) && reading()) paragraphBreak();
      if (open.drops) dropDepth--;
      if (name === 'body') bodyDepth--;
      if (stack.length === 0) rootClosed = true;
      i = k + 1;
      continue;
    }

    // Start tag or empty-element tag, its attributes read for the two that drop content.
    let k = lt + 1;
    if (k >= n || !isNameStart(xml.charCodeAt(k))) return;
    while (k < n && isNameChar(xml.charCodeAt(k))) k++;
    const name = xml.slice(lt + 1, k).toLowerCase();
    let anchored = false;
    let rendOther = false;
    let textType = '';
    let selfClosing = false;
    for (;;) {
      const afterName = k;
      while (k < n && isSpace(xml.charCodeAt(k))) k++;
      if (k >= n) return;
      const code = xml.charCodeAt(k);
      if (code === 62 /* > */) {
        k++;
        break;
      }
      if (code === 47 /* / */) {
        if (xml.charCodeAt(k + 1) !== 62) return;
        selfClosing = true;
        k += 2;
        break;
      }
      // An attribute: whitespace before it, then name = "value" or 'value'.
      if (k === afterName || !isNameStart(code)) return;
      const nameStart = k;
      while (k < n && isNameChar(xml.charCodeAt(k))) k++;
      const attr = xml.slice(nameStart, k).toLowerCase();
      while (k < n && isSpace(xml.charCodeAt(k))) k++;
      if (xml.charCodeAt(k) !== 61 /* = */) return;
      k++;
      while (k < n && isSpace(xml.charCodeAt(k))) k++;
      const quote = xml.charAt(k);
      if (quote !== '"' && quote !== "'") return;
      const valueEnd = xml.indexOf(quote, k + 1);
      if (valueEnd === -1) return;
      const value = xml.slice(k + 1, valueEnd);
      if (value.includes('<')) return;
      if (attr === 'anchor.ids') anchored = true;
      else if (attr === 'rend') rendOther = value.toLowerCase() === 'other';
      else if (attr === 'type') textType = value.toLowerCase();
      k = valueEnd + 1;
    }
    i = k;

    if (stack.length === 0) {
      // The first element is the root: a transcription's is tei2, and there is only one.
      if (rootClosed || name !== ROOT || selfClosing) return;
    }
    const manuscript =
      name === 'text' ? textType === 'manuscript' : (stack.at(-1)?.manuscript ?? false);
    const drops =
      DROPPED.has(name) ||
      (manuscript &&
        (name === 'anchor' || (name === 'note' && anchored) || (name === 'hi' && rendOther)));
    if (reading() && !drops) {
      if (name === 'lb' || name === 'item') lineBreak();
      else if (name === 'hsep') gap ||= ' ';
      else if (PARAGRAPH.has(name)) paragraphBreak();
    }
    if (selfClosing) continue;
    stack.push({ name, drops, manuscript });
    if (drops) dropDepth++;
    if (name === 'body') {
      bodyDepth++;
      sawBody = true;
    }
  }

  if (!rootClosed || !sawBody) return;
  return chunks.join('');
}
