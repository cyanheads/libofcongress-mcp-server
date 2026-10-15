/**
 * @fileoverview Tests for the `match` scan of libofcongress_get_newspaper_page: term grammar,
 * passage windows, merging, the passage cap, and linear scan time.
 * @module tests/services/page-text-match.test
 */

import { describe, expect, it } from 'vitest';
import {
  MATCH_CONTEXT_CHARS,
  MAX_PASSAGE_CHARS,
  MAX_PASSAGES,
  matchPageText,
  matchTerms,
} from '@/services/loc-api/page-text-match.js';
import { NEWSPAPER_PAGE_12_EXCERPT } from '../fixtures/loc-page-12-text.js';
import { HERALD_PAGE_1_TEXT } from '../fixtures/loc-page-herald-text.js';
import { cpuScaling, repeatTo } from '../helpers/cpu-scaling.js';

/** `length` characters of filler text with no letter of the match terms used below. */
const filler = (length: number) => repeatTo('0123456789 ', length);

/**
 * Asserts the passage invariants on `text`: at most 10, each at most 1,200 characters, in page
 * order and never overlapping. Returns each passage's offset in `text`.
 */
function passageOffsets(text: string, passages: string[]): number[] {
  expect(passages.length).toBeLessThanOrEqual(MAX_PASSAGES);
  const offsets: number[] = [];
  let from = 0;
  for (const passage of passages) {
    expect(passage.length).toBeGreaterThan(0);
    expect(passage.length).toBeLessThanOrEqual(MAX_PASSAGE_CHARS);
    const at = text.indexOf(passage, from);
    expect(at).toBeGreaterThanOrEqual(from);
    offsets.push(at);
    from = at + passage.length;
  }
  return offsets;
}

describe('matchTerms', () => {
  it.each([
    ['titanic', ['titanic']],
    ['Titanic ICEBERG', ['titanic', 'iceberg']],
    ['"the titanic"', ['the titanic']],
    ['"the\n\t titanic"  iceberg', ['the titanic', 'iceberg']],
    ['titanic "lost at sea" iceberg', ['titanic', 'lost at sea', 'iceberg']],
    ['"unclosed phrase here', ['unclosed phrase here']],
    ['titanic Titanic TITANIC', ['titanic']],
    ['"" " " titanic', ['titanic']],
    ['a.*b ( [', ['a.*b', '(', '[']],
    ['', []],
    ['   ', []],
  ])('reads %j as %j', (match, terms) => {
    expect(matchTerms(match)).toEqual(terms);
  });
});

describe('matchPageText', () => {
  it('matches case-insensitively and returns the original text around the occurrence', () => {
    const text = `${filler(1000)}The TITANIC sank${filler(1000)}`;
    const at = text.indexOf('TITANIC');
    for (const match of ['titanic', 'Titanic', 'TITANIC', 'tItAnIc']) {
      expect(matchPageText(text, match)).toEqual({
        cut: false,
        matchCount: 1,
        passages: [
          text.slice(at - MATCH_CONTEXT_CHARS, at + 'TITANIC'.length + MATCH_CONTEXT_CHARS),
        ],
      });
    }
  });

  it('clips the window at the start and end of the text', () => {
    const text = `titanic${filler(100)}iceberg`;
    expect(matchPageText(text, 'titanic iceberg')).toEqual({
      cut: false,
      matchCount: 2,
      passages: [text],
    });
  });

  it('reads every whitespace run in the text as one space, so a phrase matches across a line break', () => {
    const text = `${filler(700)}the\nTitanic and the  \r\n\tTitanic, then the titanic${filler(700)}`;
    const first = text.indexOf('the\nTitanic');
    const lastEnd = text.lastIndexOf('titanic') + 'titanic'.length;
    // One passage from 300 before the first occurrence to 300 after the third, in the original text.
    expect(matchPageText(text, '"the titanic"')).toEqual({
      cut: false,
      matchCount: 3,
      passages: [text.slice(first - MATCH_CONTEXT_CHARS, lastEnd + MATCH_CONTEXT_CHARS)],
    });
  });

  it('counts an unquoted pair as two terms and a quoted pair only where adjacent', () => {
    const text = `titanic struck an iceberg${filler(2000)}titanic iceberg`;
    expect(matchPageText(text, 'titanic iceberg').matchCount).toBe(4);
    expect(matchPageText(text, '"titanic iceberg"').matchCount).toBe(1);
    expect(matchPageText(text, '"iceberg titanic"')).toEqual({
      cut: false,
      matchCount: 0,
      passages: [],
    });
  });

  it('matches a term as a substring and counts each term without overlapping itself', () => {
    expect(matchPageText('icebergs', 'iceberg').matchCount).toBe(1);
    expect(matchPageText('aaaa', 'aa').matchCount).toBe(2);
    // Each term counts on its own, so an occurrence of both is counted once per term.
    expect(matchPageText('Titanic', 'titan titanic').matchCount).toBe(2);
  });

  it.each([
    ['a.*b', 'xa.*by and ab', 1],
    ['(', 'f(x) (y', 2],
    ['[', 'a [b] [', 2],
    ['\\d+', 'a \\d+ 12', 1],
    ['$^|?', 'x$^|?y', 1],
  ])('matches %j literally, never as a pattern', (match, text, count) => {
    expect(matchPageText(text, match).matchCount).toBe(count);
  });

  it('returns no passages and no count when nothing matches, the text is empty, or match holds no term', () => {
    const none = { cut: false, matchCount: 0, passages: [] };
    expect(matchPageText(filler(5000), 'titanic')).toEqual(none);
    expect(matchPageText('', 'titanic')).toEqual(none);
    expect(matchPageText('titanic', '""')).toEqual(none);
  });

  it('merges overlapping windows into one passage while it stays within 1,200 characters', () => {
    // Occurrences 200 apart: their windows overlap and the whole run spans under 1,200.
    const text = `${filler(1000)}titanic${filler(193)}titanic${filler(193)}titanic${filler(1000)}`;
    const first = text.indexOf('titanic');
    const last = text.lastIndexOf('titanic');
    expect(matchPageText(text, 'titanic')).toEqual({
      cut: false,
      matchCount: 3,
      passages: [text.slice(first - MATCH_CONTEXT_CHARS, last + 7 + MATCH_CONTEXT_CHARS)],
    });
  });

  it('starts a new passage where merging would pass 1,200 characters, without overlap or a split occurrence', () => {
    // Occurrences at 1000, 1450, 1900, and 2350: windows overlap, but three of them span 1,507
    // characters. The first two merge into [700, 1757); the third opens a passage at its own
    // window start, 1600, past the second occurrence's end (1457), cutting the first back to 1600;
    // the fourth merges into [1600, 2657).
    const text = `${filler(1000)}${[1, 2, 3, 4].map(() => `titanic${filler(443)}`).join('')}${filler(1000)}`;
    const result = matchPageText(text, 'titanic');
    expect(result).toEqual({
      cut: false,
      matchCount: 4,
      passages: [text.slice(700, 1600), text.slice(1600, 2657)],
    });
    const offsets = passageOffsets(text, result.passages);
    // Every occurrence lies whole inside exactly one passage.
    for (let at = text.indexOf('titanic'); at !== -1; at = text.indexOf('titanic', at + 1)) {
      const holders = offsets.filter((o, i) => o <= at && at + 7 <= o + result.passages[i]!.length);
      expect(holders).toHaveLength(1);
    }
  });

  it('cuts the passage before an occurrence that starts inside its trailing context, never through it', () => {
    // Occurrences at 1000, 1300, and 1603: the third starts 4 characters before the passage
    // [700, 1607) ends, and merging it would make the passage 1,210 characters.
    const text = `${filler(1000)}titanic${filler(293)}titanic${filler(296)}titanic${filler(1000)}`;
    expect(matchPageText(text, 'titanic')).toEqual({
      cut: false,
      matchCount: 3,
      passages: [text.slice(700, 1307), text.slice(1307, 1910)],
    });
  });

  it('adds no passage for an occurrence already inside the current one', () => {
    // Two occurrences fill a passage to its cap; a third lies inside its trailing context.
    const text = `${filler(1000)}titanic${filler(586)}titanic${filler(100)}titanic${filler(1000)}`;
    expect(matchPageText(text, 'titanic')).toEqual({
      cut: false,
      matchCount: 3,
      passages: [text.slice(700, 1900)],
    });
  });

  it('keeps a passage within 1,200 characters when one occurrence spans a long whitespace run', () => {
    const text = `${filler(2000)}the${' '.repeat(3000)}titanic${filler(2000)}`;
    const result = matchPageText(text, '"the titanic"');
    expect(result.matchCount).toBe(1);
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]!.length).toBe(MAX_PASSAGE_CHARS);
    expect(result.passages[0]!.startsWith('the ')).toBe(true);
  });

  it('returns 10 passages and no cut for exactly 10 separate occurrences', () => {
    const text = repeatTo(`${filler(1000)}titanic`, 10 * 1007) + filler(1000);
    const result = matchPageText(text, 'titanic');
    expect(result).toMatchObject({ cut: false, matchCount: 10 });
    expect(result.passages).toHaveLength(10);
  });

  it('cuts passages at 10 and still counts every occurrence', () => {
    const text = repeatTo(`${filler(1000)}titanic`, 25 * 1007) + filler(1000);
    const result = matchPageText(text, 'titanic');
    expect(result).toMatchObject({ cut: true, matchCount: 25 });
    expect(result.passages).toHaveLength(10);
    passageOffsets(text, result.passages);
    expect(result.passages.join('').length).toBeLessThanOrEqual(MAX_PASSAGES * MAX_PASSAGE_CHARS);
  });

  it.each([
    ['a term on every word', 'the', ['the'], 'the the the '],
    ['two terms of uneven length', 'ti titanic', ['ti', 'titanic'], 'titanic ti '],
    ['overlapping terms across terms', 'titan tanic an', ['titan', 'tanic', 'an'], 'titanic '],
    ['a phrase over line breaks', '"the titanic"', ['the titanic'], 'the\ntitanic the  titanic '],
  ])('holds the passage invariants on a dense page: %s', (_name, match, terms, unit) => {
    const text = `${filler(37)}${repeatTo(`${unit}${filler(53)}`, 50_000)}`;
    // Every occurrence on the page, shown or not: each term's non-overlapping count in the
    // lower-cased text with whitespace runs read as one space.
    const folded = text.toLowerCase().replace(/\s+/g, ' ');
    const everyOccurrence = terms.reduce((sum, term) => sum + folded.split(term).length - 1, 0);
    expect(everyOccurrence).toBeGreaterThan(1000);
    const result = matchPageText(text, match);
    expect(result.matchCount).toBe(everyOccurrence);
    expect(result.cut).toBe(true);
    expect(result.passages).toHaveLength(MAX_PASSAGES);
    passageOffsets(text, result.passages);
  });
});

describe('matchPageText passage selection when occurrences need more than 10 passages', () => {
  /** The `[start, end)` of each passage of `passages` in `text`, asserting the invariants. */
  const spansOf = (text: string, passages: string[]) =>
    passageOffsets(text, passages).map((at, i) => [at, at + passages[i]!.length]);
  /** Every offset of `word` in `text`, case-insensitively. */
  const offsetsOf = (text: string, word: string) => {
    const lower = text.toLowerCase();
    const found: number[] = [];
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) found.push(at);
    return found;
  };

  it.each([
    ['sinking of the titanic', 10],
    ['the titanic iceberg', 8],
  ])(
    'covers both rare occurrences on a real page when common words also match: %j',
    (match, passageCount) => {
      const text = NEWSPAPER_PAGE_12_EXCERPT;
      const titanic = offsetsOf(text, 'titanic');
      expect(titanic).toHaveLength(2);

      const result = matchPageText(text, match);

      expect(result.cut).toBe(true);
      // The common words fill the slots the two rare occurrences leave; each stops at its first
      // occurrence that does not fit, which can leave a slot unfilled.
      expect(result.passages).toHaveLength(passageCount);
      const spans = spansOf(text, result.passages);
      for (const at of titanic) {
        expect(spans.some(([start, end]) => start! <= at && at + 7 <= end!)).toBe(true);
      }
    },
  );

  it('covers every occurrence of the rarest term when its last lies past the crowded passages', () => {
    // The Washington Herald front page: the 5 "sinking"s fit in 5 passages, and the selection
    // takes them and 22 "titanic"s; laying all 27 out again in page order would need 11.
    const text = HERALD_PAGE_1_TEXT;
    const sinking = offsetsOf(text, 'sinking');
    expect(sinking).toHaveLength(5);
    expect(sinking.at(-1)).toBe(21_941);

    const result = matchPageText(text, 'sinking of the titanic');

    expect(result).toMatchObject({ cut: true, matchCount: 688 });
    expect(result.passages).toHaveLength(10);
    const spans = spansOf(text, result.passages);
    for (const at of sinking) {
      expect(spans.some(([start, end]) => start! <= at && at + 7 <= end!)).toBe(true);
    }
  });

  it.each([
    [
      'the',
      105,
      [
        [0, 835],
        [835, 1699],
        [1699, 2611],
        [2611, 3715],
        [7577, 8763],
        [9635, 10238],
        [11362, 12019],
        [12019, 12669],
        [12669, 13657],
        [17636, 18809],
      ],
    ],
    [
      'of',
      50,
      [
        [0, 832],
        [832, 1607],
        [1873, 2816],
        [2816, 3696],
        [3696, 4298],
        [4559, 5513],
        [5652, 6254],
        [7312, 8127],
        [11168, 12150],
        [12150, 12752],
      ],
    ],
  ])(
    'keeps a single term past 10 passages to its first 10 in page order: %j',
    (match, count, spans) => {
      const text = NEWSPAPER_PAGE_12_EXCERPT;
      const result = matchPageText(text, match);
      expect(result).toMatchObject({ cut: true, matchCount: count });
      expect(spansOf(text, result.passages)).toEqual(spans);
    },
  );

  it('fills the slots the rarer term leaves with the common term, in page order', () => {
    // 50 "zz" occurrences, then 3 "qq" ones, each far from the others: 53 passages' worth.
    const text = `${repeatTo(`${filler(2000)}zz`, 50 * 2002)}${repeatTo(`${filler(2000)}qq`, 3 * 2002)}${filler(2000)}`;
    const zz = offsetsOf(text, 'zz');
    const qq = offsetsOf(text, 'qq');
    expect(zz).toHaveLength(50);
    expect(qq).toHaveLength(3);

    const result = matchPageText(text, 'zz qq');

    expect(result).toMatchObject({ cut: true, matchCount: 53 });
    const shown = spansOf(text, result.passages);
    const holds = (at: number) => shown.some(([start, end]) => start! <= at && at + 2 <= end!);
    expect(qq.every(holds)).toBe(true);
    expect(zz.filter(holds)).toEqual(zz.slice(0, 7));
  });

  it('breaks a tie in occurrence count by term order', () => {
    // 15 "zz" and 15 "qq", alternating and far apart.
    const text = `${repeatTo(`${filler(2000)}zz${filler(2000)}qq`, 15 * 4004)}${filler(2000)}`;
    const zz = offsetsOf(text, 'zz');
    const qq = offsetsOf(text, 'qq');
    expect(zz).toHaveLength(15);
    expect(qq).toHaveLength(15);
    const shownIn = (match: string) => {
      const shown = spansOf(text, matchPageText(text, match).passages);
      return (at: number) => shown.some(([start, end]) => start! <= at && at + 2 <= end!);
    };

    const zzFirst = shownIn('zz qq');
    expect(zz.filter(zzFirst)).toEqual(zz.slice(0, 10));
    expect(qq.some(zzFirst)).toBe(false);
    const qqFirst = shownIn('qq zz');
    expect(qq.filter(qqFirst)).toEqual(qq.slice(0, 10));
    expect(zz.some(qqFirst)).toBe(false);
  });
});

describe('matchPageText scan time', () => {
  const longTerm = `${'a'.repeat(198)}b`;
  /** 66 distinct two-letter terms: 200 characters with their separators. */
  const manyTerms = Array.from({ length: 66 }, (_, i) =>
    String.fromCharCode(97 + (i % 26), 97 + Math.floor(i / 26)),
  ).join(' ');

  it.each<[string, string, (n: number) => string]>([
    ['every character an occurrence', 'a', (n) => 'a'.repeat(n)],
    ['a long term that misses at its last character', longTerm, (n) => 'a'.repeat(n)],
    ['overlapping prefixes', 'abab aba ab', (n) => repeatTo('ab', n)],
    ['a phrase over whitespace runs', '"a a"', (n) => repeatTo('a \n\t ', n)],
    ['66 terms over text that holds them all', manyTerms, (n) => repeatTo(manyTerms, n)],
    ['a long digit run with no occurrence', 'titanic', (n) => repeatTo('0123456789', n)],
    ['non-ASCII letters', 'é', (n) => repeatTo('ÉéÀà', n)],
    // Selection paths: a rare term placed first, then a single-letter term on every character.
    ['a rare term at the end, a common one everywhere', 'a zq', (n) => `${'a'.repeat(n - 2)}zq`],
    [
      'three rare occurrences spread out, a common one inserted between them',
      'a zq',
      (n) => {
        const quarter = Math.floor(n / 4);
        return `${'a'.repeat(quarter)}zq${'a'.repeat(quarter)}zq${'a'.repeat(quarter)}zq${'a'.repeat(n - 3 * quarter - 6)}`;
      },
    ],
    [
      'a rare term past 10 passages, a common one after it',
      'a zq',
      (n) => repeatTo(`zq${'a'.repeat(998)}`, n),
    ],
  ])('grows linearly with page length: %s', (_name, match, make) => {
    const { largeMs, ratio } = cpuScaling((text) => matchPageText(text, match), make);
    expect(ratio).toBeLessThan(256);
    expect(largeMs).toBeLessThan(250);
  });
});
