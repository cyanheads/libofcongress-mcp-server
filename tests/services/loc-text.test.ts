/**
 * @fileoverview Tests for LOC text normalization — character references decoded once, and the HTML
 * `item.rights` statement reduced to plain text — including worst-case scan timing.
 * @module tests/services/loc-text.test
 */

import { describe, expect, it } from 'vitest';
import { decodeText, htmlToText } from '@/services/loc-api/loc-text.js';
import {
  JAZZ_ENTITY_ROWS,
  MANUSCRIPT_RIGHTS_MM77093930,
  MAP_RIGHTS_98688514,
  NEWSPAPER_RIGHTS_SN83030214,
} from '../fixtures/loc-text.js';
import { cpuScaling, repeatTo } from '../helpers/cpu-scaling.js';

/** A semicolon-closed character reference — what no normalized string may still carry. */
const CHARACTER_REFERENCE = /&(?:[A-Za-z][A-Za-z0-9]*|#\d+|#[xX][0-9A-Fa-f]+);/;

describe('decodeText', () => {
  it.each([
    ['named', 'the &hellip;', 'the …'],
    ['decimal', 'Jazz&#8217;s', 'Jazz’s'],
    ['hex, either case', 'lead.&#xA0; St&#xe8;phane', 'lead.  Stèphane'],
    ['no-break space by name', '&nbsp; Thanks', '  Thanks'],
    ['once: an escaped reference stays one reference', '&amp;lt;b&amp;gt;', '&lt;b&gt;'],
    ['an escaped tag becomes the literal tag text', '&lt;b&gt;', '<b>'],
    [
      'unterminated references stay as written',
      'a=1&copy=2 &c. AT&T &nbsp',
      'a=1&copy=2 &c. AT&T &nbsp',
    ],
    ['an unknown name stays as written', '&notaname; &notit;', '&notaname; &notit;'],
    ['plain text is untouched', '1866-<1899>.', '1866-<1899>.'],
  ])('%s', (_name, raw, decoded) => {
    expect(decodeText(raw)).toBe(decoded);
  });

  it('leaves no reference in the captured search descriptions', () => {
    for (const row of JAZZ_ENTITY_ROWS) {
      const raw = row.description.join(' ');
      expect(raw).toMatch(CHARACTER_REFERENCE);
      expect(decodeText(raw)).not.toMatch(CHARACTER_REFERENCE);
    }
    expect(decodeText(JAZZ_ENTITY_ROWS[1]!.description[0]!)).toContain(
      'Jazz’s greatest drummer once earned D’s in music in school, once wrote an essay entitled “I Hate Jazz” and',
    );
  });
});

describe('htmlToText', () => {
  it('reduces the captured manuscript rights to one plain paragraph with absolute link targets', () => {
    expect(htmlToText(MANUSCRIPT_RIGHTS_MM77093930.join(' '))).toBe(
      'The contents of the Library of Congress Betty Herndon Maury Maury collection are in the public domain and are free to use and reuse. Credit Line: Library of Congress, Manuscript Division, Betty Herndon Maury Maury Diary. More about Copyright and other Restrictions (https://www.loc.gov/legal/). For guidance about compiling full citations consult Citing Primary Sources (https://www.loc.gov/teachers/usingprimarysources/citing.html).',
    );
  });

  it('drops inline markup and resolves every relative link (captured map rights)', () => {
    expect(htmlToText(MAP_RIGHTS_98688514.join(' '))).toBe(
      'The content of the Library of Congress Geography and Map Division digitized collections is free to use and reuse unless a Rights Advisory statement is present that indicates otherwise. Credit Line: Library of Congress, Geography and Map Division. More about Copyright and other Restrictions (https://www.loc.gov/legal/). For guidance about compiling full citations consult Citing Primary Sources (https://www.loc.gov/programs/teachers/getting-started-with-primary-sources/citing/).',
    );
  });

  it('writes a link whose text is its own URL once (captured newspaper rights)', () => {
    expect(htmlToText(NEWSPAPER_RIGHTS_SN83030214.join(' '))).toBe(
      'The Library of Congress believes that the newspapers in Chronicling America are in the public domain or have no known copyright restrictions. Newspapers published in the United States more than 95 years ago are in the public domain in their entirety. Any newspapers in Chronicling America that were published less than 95 years ago are also believed to be in the public domain, but may contain some copyrighted third party materials. Researchers using newspapers published less than 95 years ago should be alert for modern content (for example, registered and renewed for copyright and published with notice) that may be copyrighted. Responsibility for making an independent legal assessment of an item and securing any necessary permissions ultimately rests with persons desiring to use the item. The NEH awardee responsible for producing each digital object is presented in the Chronicling America page display, below the page image – e.g. Image produced by the Library of Congress. For more information on current NDNP awardees, see https://www.loc.gov/ndnp/listawardees.html. For more information on Library of Congress policies and disclaimers regarding rights and reproductions, see https://www.loc.gov/homepage/legal.html',
    );
  });

  it.each([
    [
      'decodes references after the tags are gone, once',
      '<p>P&amp;P &amp;lt;b&amp;gt;</p>',
      'P&P &lt;b&gt;',
    ],
    ['keeps an escaped tag as text', '<p>&lt;b&gt;bold&lt;/b&gt;</p>', '<b>bold</b>'],
    ['keeps a `<` that opens no tag', '<p>1866-<1899>. a < b</p>', '1866-<1899>. a < b'],
    [
      'collapses no-break spaces and line breaks',
      'one&nbsp;&nbsp; two\r\n\r\nthree four',
      'one two three four',
    ],
    ['separates paragraphs and breaks', '<p>one</p><p>two<br/>three</p>', 'one two three'],
    ['joins inline markup without a gap', 'w<em>or</em>d', 'word'],
    [
      'takes a single-quoted or bare href',
      "<a href='/a/'>A</a> <a href=/b/>B</a>",
      'A (https://www.loc.gov/a/) B (https://www.loc.gov/b/)',
    ],
    [
      'decodes a reference inside an href',
      '<a href="/s/?a=1&amp;b=2">S</a>',
      'S (https://www.loc.gov/s/?a=1&b=2)',
    ],
    ['keeps a mailto target', '<a href="mailto:x@loc.gov">write</a>', 'write (mailto:x@loc.gov)'],
    ['drops a script target', '<a href="javascript:alert(1)">run</a>', 'run'],
    ['drops a link with no href', '<a name="top">Top</a>', 'Top'],
    [
      'reads an unclosed tag to the end as text',
      'Credit <a href="/legal/" class',
      'Credit <a href="/legal/" class',
    ],
    ['ends a tag at its first `>`', '<a<a<a>>>x', '>>x'],
    ['empty input', '', ''],
  ])('%s', (_name, html, text) => {
    expect(htmlToText(html)).toBe(text);
  });
});

describe('scan time stays linear in the input (5k → 320k characters)', () => {
  const worstCases: Array<[string, (length: number) => string]> = [
    ['repeated `<` that opens no tag', (n) => repeatTo('<', n)],
    ['repeated tag opener with no closer', (n) => repeatTo('<a', n)],
    ['nested openers closed once at the end', (n) => `${repeatTo('<a', n - 3)}>>>`],
    ['repeated href attributes in one tag', (n) => `<a ${repeatTo('href=', n - 4)}>`],
    ['repeated links', (n) => repeatTo('<a href="/x">t</a>', n)],
    ['one link around many tags', (n) => `<a href="/x">${repeatTo('y</b>', n - 17)}</a>`],
    ['repeated references', (n) => repeatTo('&amp;', n)],
    ['repeated unterminated references', (n) => repeatTo('&a', n)],
  ];

  it.each(worstCases)('htmlToText: %s', (_name, make) => {
    const { largeMs, ratio } = cpuScaling(htmlToText, make);
    expect(ratio).toBeLessThan(256);
    expect(largeMs).toBeLessThan(250);
  });

  it.each(worstCases)('decodeText: %s', (_name, make) => {
    const { largeMs, ratio } = cpuScaling(decodeText, make);
    expect(ratio).toBeLessThan(256);
    expect(largeMs).toBeLessThan(250);
  });
});
