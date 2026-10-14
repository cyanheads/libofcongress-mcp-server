/**
 * @fileoverview Tests for the `format()` text helpers — inline escaping of upstream metadata and
 * fenced OCR text — checked against a Markdown renderer, plus worst-case scan timing.
 * @module tests/tools/render-text.test
 */

import { decodeHTML } from 'entities';
import { marked } from 'marked';
import { describe, expect, it } from 'vitest';
import { fencedText, inlineText, lineText } from '@/mcp-server/tools/render-text.js';
import { TITANIC_OCR_EXCERPT } from '../fixtures/loc-text.js';
import { cpuScaling, repeatTo } from '../helpers/cpu-scaling.js';

/** `html` without its tags. The renderer escapes a literal `<` in text, so every `<` here opens a tag. */
function withoutTags(html: string): string {
  let text = '';
  let inTag = false;
  for (const char of html) {
    if (char === '<') inTag = true;
    else if (char === '>' && inTag) inTag = false;
    else if (!inTag) text += char;
  }
  return text;
}

/** The text a reader sees for an inline Markdown line: rendered, tags dropped, references decoded. */
function renderedInlineText(markdownLine: string): string {
  return decodeHTML(withoutTags(marked.parseInline(markdownLine) as string));
}

describe('inlineText', () => {
  it.each([
    ['a decoded escaped tag', '<b>bold</b>', '\\<b>bold\\</b>'],
    ['a closing tag', 'x</p>', 'x\\</p>'],
    ['a comment', '<!-- note -->', '\\<!-- note -->'],
    ['a declaration', '<!DOCTYPE html>', '\\<!DOCTYPE html>'],
    ['a processing instruction', '<?xml version="1.0"?>', '\\<?xml version="1.0"?>'],
    ['an autolink', '<https://www.loc.gov/>', '\\<https://www.loc.gov/>'],
    ['a call number holding a tag-like word', 'LOT 6668 <item> [P&P]', 'LOT 6668 \\<item> [P&P]'],
    ['a named reference', 'AT&amp;T', 'AT\\&amp;T'],
    ['decimal and hex references', '&#60; &#x3C;', '\\&#60; \\&#x3C;'],
    ['a backslash before an opener is doubled', 'a\\<b>', 'a\\\\\\<b>'],
    ['two backslashes before an opener', 'a\\\\&lt;', 'a\\\\\\\\\\&lt;'],
    ['CRLF, CR, and LF become spaces', 'one\r\ntwo\rthree\nfour', 'one two three four'],
    ['a trailing backslash is doubled', 'Lot 12\\', 'Lot 12\\\\'],
    ['a trailing backslash run is doubled', 'a\\\\', 'a\\\\\\\\'],
    ['a trailing backslash after a line break', 'a\n\\', 'a \\\\'],
    ['a trailing `<` the next slot could complete', 'x<', 'x\\<'],
    ['a trailing unterminated reference', 'AT&lt', 'AT\\&lt'],
  ])('escapes %s', (_name, value, rendered) => {
    expect(inlineText(value)).toBe(rendered);
  });

  it.each([
    ['catalog brackets around a year', 'Semiweekly ed.: New-York tribune, 1866-<1899>.'],
    ['a `<` before a digit or space', 'a < b, <1900>-1903, x<5'],
    ['an ampersand that opens no reference', 'AT&T P&P &c. a=1&b=2 & so on'],
    ['an unterminated or overlong name', '&nbsp &abcdefghijabcdefghijabcdefghijabc;'],
    ['underscores, asterisks, brackets, and backslashes elsewhere', 'a_b *c* [d](e) \\f #g'],
    ['a URL', 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1&q=jazz'],
  ])('leaves %s unchanged', (_name, value) => {
    expect(inlineText(value)).toBe(value);
  });

  it.each([
    '<b>bold</b>',
    'x</p> and <em>',
    '<!-- note --> <?php ?> <!DOCTYPE html>',
    'LOT 6668 <item> [P&P]',
    'Semiweekly ed.: New-York tribune, 1866-<1899>.',
    '&lt;b&gt; &amp; &#60; &#x3C;',
    'a\\<b> and c\\\\<d>',
    'AT&T P&P',
    'line one\r\nline two',
    'Lot 12\\',
    'a\\\\',
    'c\\<d>\\',
  ])('renders %j as the value itself, line breaks as spaces', (value) => {
    const flat = value.replace(/\r\n|\r|\n/g, ' ');
    const html = marked.parseInline(inlineText(value)) as string;
    expect(html).not.toMatch(/<(?!\/?a[\s>])[A-Za-z/!?]/);
    expect(renderedInlineText(inlineText(value))).toBe(flat);
    // In the slots format() writes: a field line the template continues past, and a bold span.
    expect(renderedInlineText(`**Title:** ${inlineText(value)}\n**Date:** 1912`)).toBe(
      `Title: ${flat}\nDate: 1912`,
    );
    expect(renderedInlineText(`**${inlineText(value)}**`)).toBe(flat);
  });

  it('renders differently without the escape — the renderer would read the markup', () => {
    expect(renderedInlineText('<b>bold</b> &lt;')).toBe('bold <');
  });
});

describe('lineText', () => {
  /** Block-level tags a catalog value must never open. */
  const BLOCK_TAG = /<(?:h\d|blockquote|ol|ul|pre|hr)\b/g;

  it.each([
    '# h',
    '> q',
    '1. x',
    '1898. Photo shows the parade.',
    '1898) x',
    '- x',
    '+ x',
    '* x',
    '```',
    '~~~',
    '---',
    '===',
    '    indented',
  ])('keeps %j one paragraph line and one list entry, its text intact', (value) => {
    const paragraph = marked.parse(`**Format:** photo\n${lineText(value)}`, { async: false });
    expect(paragraph).not.toMatch(BLOCK_TAG);
    const list = marked.parse(`- ${lineText(value)}\n- next`, { async: false });
    expect(list.match(BLOCK_TAG)).toEqual(['<ul']);
    expect(renderedInlineText(lineText(value))).toBe(value.trimStart());
  });

  it('writes a value with no leading marker as inlineText does', () => {
    expect(lineText('Title from item. <b>')).toBe(inlineText('Title from item. <b>'));
  });
});

describe('fencedText', () => {
  it('holds OCR noise that reads as a tag outside a fence, byte for byte', () => {
    const block = fencedText(TITANIC_OCR_EXCERPT);
    expect(block).toBe(`\`\`\`\n${TITANIC_OCR_EXCERPT}\n\`\`\``);
    const [token] = marked.lexer(block);
    expect(token).toMatchObject({ type: 'code', text: TITANIC_OCR_EXCERPT });
  });

  it.each([
    ['a run of three backticks', 'before ``` after\n```\nstill inside'],
    ['a longer run on its own line', 'a\n`````\nb'],
    ['a line that looks like a heading or rule', '# Not a heading\n---\n* not a list'],
    ['leading and trailing blank lines', '\n\n  indented\n\n'],
  ])('keeps %s inside one block', (_name, text) => {
    const block = fencedText(text);
    const fence = block.slice(0, block.indexOf('\n'));
    expect(block).toBe(`${fence}\n${text}\n${fence}`);
    const tokens = marked.lexer(block);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: 'code' });
    expect((tokens[0] as { raw: string }).raw).toBe(block);
  });
});

describe('scan time stays linear in the input (5k → 320k characters)', () => {
  it.each<[string, (length: number) => string]>([
    ['repeated tag openers', (n) => repeatTo('<a', n)],
    ['repeated `<` that opens nothing', (n) => repeatTo('<', n)],
    ['repeated reference openers', (n) => repeatTo('&a', n)],
    ['a long name with no closing `;`', (n) => `&${repeatTo('a', n - 1)}`],
    ['a backslash run before one opener', (n) => `${repeatTo('\\', n - 2)}<a`],
    ['backslash runs before many openers', (n) => repeatTo('\\\\\\\\<a', n)],
    ['a value that is one trailing backslash run', (n) => repeatTo('\\', n)],
    ['repeated line breaks', (n) => repeatTo('\r\n', n)],
  ])('inlineText: %s', (_name, make) => {
    const { largeMs, ratio } = cpuScaling(inlineText, make);
    expect(ratio).toBeLessThan(256);
    expect(largeMs).toBeLessThan(250);
  });
});
