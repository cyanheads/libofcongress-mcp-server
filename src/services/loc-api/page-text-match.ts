/**
 * @fileoverview The `match` scan of `libofcongress_get_newspaper_page`: the passages of a page's
 * text around each occurrence of the caller's terms, and how many occurrences there are.
 *
 * Terms match case-insensitively as literal substrings, with every whitespace run on either side
 * read as one space, so a phrase split across an OCR line break still matches. Matching is
 * `indexOf` over a folded copy of the text — no regex is built from caller text — so the scan is
 * linear in the page length for each term, and a term list is at most 200 characters.
 * @module services/loc-api/page-text-match
 */

/** Characters of context kept on each side of an occurrence. */
export const MATCH_CONTEXT_CHARS = 300;
/** Longest passage: overlapping windows merge only up to this length. */
export const MAX_PASSAGE_CHARS = 1200;
/** Most passages one response carries. */
export const MAX_PASSAGES = 10;

/** The passages around a match and the count of every occurrence. */
export interface PageTextMatch {
  /** True when more passages followed the {@link MAX_PASSAGES} returned. */
  cut: boolean;
  /** Occurrences of every term on the page, shown or not. */
  matchCount: number;
  /** Passages of the page text in page order, never overlapping, each at most 1,200 characters. */
  passages: string[];
}

/** Text reduced for matching, with each of its characters' offset in the original text. */
interface FoldedText {
  folded: string;
  /** `offsets[i]` is where folded character `i` starts in the original text. */
  offsets: Int32Array;
}

const WHITESPACE = /\s/;

/** Whether the UTF-16 unit `code` is whitespace: the ASCII fast path, then `\s` for the rest. */
function isWhitespace(code: number): boolean {
  if (code < 128) return code === 32 || (code >= 9 && code <= 13);
  return WHITESPACE.test(String.fromCharCode(code));
}

/** `code` lower-cased when its lower case is one UTF-16 unit, so offsets stay one to one. */
function lowerUnit(code: number): string {
  if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
  const char = String.fromCharCode(code);
  if (code < 128) return char;
  const lower = char.toLowerCase();
  return lower.length === 1 ? lower : char;
}

/** `text` lower-cased per UTF-16 unit, every whitespace run reduced to one space. One pass. */
function fold(text: string): FoldedText {
  const units: string[] = [];
  const offsets = new Int32Array(text.length);
  let i = 0;
  while (i < text.length) {
    offsets[units.length] = i;
    if (isWhitespace(text.charCodeAt(i))) {
      units.push(' ');
      while (i < text.length && isWhitespace(text.charCodeAt(i))) i++;
    } else {
      units.push(lowerUnit(text.charCodeAt(i)));
      i++;
    }
  }
  return { folded: units.join(''), offsets };
}

/**
 * The distinct folded terms of `match`: each double-quoted span is one phrase (an unclosed quote
 * runs to the end), every other whitespace-separated word one term. Empty terms are dropped.
 */
export function matchTerms(match: string): string[] {
  const terms = new Set<string>();
  let i = 0;
  while (i < match.length) {
    if (isWhitespace(match.charCodeAt(i))) {
      i++;
      continue;
    }
    let end: number;
    let raw: string;
    if (match[i] === '"') {
      const close = match.indexOf('"', i + 1);
      end = close === -1 ? match.length : close + 1;
      raw = match.slice(i + 1, close === -1 ? match.length : close);
    } else {
      end = i;
      while (end < match.length && !isWhitespace(match.charCodeAt(end))) end++;
      raw = match.slice(i, end);
    }
    const term = fold(raw).folded.trim();
    if (term) terms.add(term);
    i = end;
  }
  return [...terms];
}

/** Context window of an occurrence `[start, end)`, clipped to the text and to one passage. */
function windowOf(start: number, end: number, length: number): [number, number] {
  const context = Math.max(
    0,
    Math.min(MATCH_CONTEXT_CHARS, (MAX_PASSAGE_CHARS - (end - start)) >> 1),
  );
  return [Math.max(0, start - context), Math.min(length, end + context, start + MAX_PASSAGE_CHARS)];
}

/** An occurrence's `[start, end)` in the original text. */
interface Span {
  end: number;
  start: number;
}

/** A passage under construction: its `[start, end)` and where its last occurrence ends. */
interface Passage {
  end: number;
  lastEnd: number;
  start: number;
}

/** One term's occurrences in page order, as original-text offsets. */
interface TermHits {
  ends: number[];
  starts: number[];
}

/**
 * Adds the occurrence `[start, end)` to `passages`, where it falls after every occurrence already
 * placed. Its window merges into the last passage while that stays within
 * {@link MAX_PASSAGE_CHARS}; an occurrence already inside the last passage adds nothing; otherwise
 * it opens the next passage, which takes the gap after the last passage's final occurrence. False,
 * with `passages` unchanged, when that would be passage {@link MAX_PASSAGES} + 1.
 */
function place(passages: Passage[], start: number, end: number, length: number): boolean {
  const [windowStart, windowEnd] = windowOf(start, end, length);
  const last = passages.at(-1);
  // The passage this window overlaps, if any.
  const current = last && windowStart <= last.end ? last : undefined;
  if (current) {
    if (windowEnd - current.start <= MAX_PASSAGE_CHARS) {
      current.end = Math.max(current.end, windowEnd);
      current.lastEnd = Math.max(current.lastEnd, end);
      return true;
    }
    if (end <= current.end) return true;
  }
  if (passages.length === MAX_PASSAGES) return false;
  let passageStart = windowStart;
  if (current) {
    // Hand the gap after the current passage's last occurrence to the new one, unless the two
    // occurrences overlap; the current passage keeps every occurrence it holds.
    passageStart = current.lastEnd <= start ? Math.max(windowStart, current.lastEnd) : current.end;
    current.end = Math.min(current.end, passageStart);
  }
  passages.push({ start: passageStart, end: windowEnd, lastEnd: end });
  return true;
}

/**
 * The passages of the first `taken[i]` occurrences of each term, placed in page order (ties by
 * term order). `complete` is false when an occurrence would need passage 11; placing stops there.
 */
function layoutTaken(
  terms: TermHits[],
  taken: number[],
  length: number,
): { complete: boolean; passages: Passage[] } {
  const passages: Passage[] = [];
  const next = terms.map(() => 0);
  for (;;) {
    // The earliest unplaced occurrence across the terms, by its position in the text.
    let best = -1;
    let bestStart = 0;
    for (let i = 0; i < terms.length; i++) {
      const k = next[i] as number;
      if (k >= (taken[i] as number)) continue;
      const start = (terms[i] as TermHits).starts[k] as number;
      if (best === -1 || start < bestStart) {
        best = i;
        bestStart = start;
      }
    }
    if (best === -1) return { complete: true, passages };
    const k = next[best] as number;
    next[best] = k + 1;
    if (!place(passages, bestStart, (terms[best] as TermHits).ends[k] as number, length)) {
      return { complete: false, passages };
    }
  }
}

/** The passages of `spans`, given in page order; null when they need more than 10. */
function layoutSpans(spans: Span[], length: number): Passage[] | null {
  const passages: Passage[] = [];
  for (const { start, end } of spans) {
    if (!place(passages, start, end, length)) return null;
  }
  return passages;
}

/** Whether a passage holds the whole of `span`. */
function covered(passages: Passage[], span: Span): boolean {
  return passages.some((p) => p.start <= span.start && span.end <= p.end);
}

/** Whether `a` comes before `b` in page order: by start, then end. */
function before(a: Span, b: Span): boolean {
  return a.start < b.start || (a.start === b.start && a.end < b.end);
}

/**
 * How many of each term's occurrences, in page order, to show when they need more than
 * {@link MAX_PASSAGES} passages: the term with the fewest occurrences first (ties by term order),
 * each term's occurrences taken while the passages stay within {@link MAX_PASSAGES}, so a common
 * word fills only the slots the rarer terms leave.
 *
 * `placed` holds the occurrences the passages are laid out from, in page order. An occurrence
 * after all of them is placed directly. An earlier one already inside a passage is taken without
 * placing it; any other earlier one is tried by laying out `placed` with it again. A term stops at
 * its first occurrence that does not fit, so the work is bounded by the occurrences inside 10
 * passages, not by page length. Returns the counts taken and the passages of `placed`, which hold
 * every taken occurrence.
 */
function selectByRarity(
  terms: TermHits[],
  length: number,
): { passages: Passage[]; taken: number[] } {
  const order = terms
    .map((hit, i) => ({ i, count: hit.starts.length }))
    .sort((a, b) => a.count - b.count || a.i - b.i);
  const taken = terms.map(() => 0);
  let placed: Span[] = [];
  let passages: Passage[] = [];
  for (const { i } of order) {
    const hit = terms[i] as TermHits;
    for (let k = 0; k < hit.starts.length; k++) {
      const span = { start: hit.starts[k] as number, end: hit.ends[k] as number };
      const last = placed.at(-1);
      if (!last || !before(span, last)) {
        if (!place(passages, span.start, span.end, length)) break;
        placed.push(span);
      } else if (!covered(passages, span)) {
        const at = placed.findIndex((p) => before(span, p));
        const candidate = [...placed.slice(0, at), span, ...placed.slice(at)];
        const laidOut = layoutSpans(candidate, length);
        if (!laidOut) break;
        placed = candidate;
        passages = laidOut;
      }
      taken[i] = k + 1;
    }
  }
  return { passages, taken };
}

/**
 * The passages of `text` around the occurrences of the terms of `match`, and the occurrence
 * count. Each term's occurrences are found left to right without overlapping each other. A passage
 * covers {@link MATCH_CONTEXT_CHARS} on each side of its occurrences; windows that overlap merge
 * while the passage stays within {@link MAX_PASSAGE_CHARS}; a window that cannot merge starts the
 * next passage, cutting the previous one back to its last occurrence's end where the window
 * reaches before it, so passages never overlap and an occurrence already shown adds none.
 * When the occurrences fit in {@link MAX_PASSAGES} passages, all are shown; otherwise the rarest
 * terms' occurrences are chosen first ({@link selectByRarity}), and `cut` says whether any
 * occurrence lies outside the passages. Passages are in page order either way; the count covers
 * every occurrence.
 */
export function matchPageText(text: string, match: string): PageTextMatch {
  const { folded, offsets } = fold(text);
  const terms = matchTerms(match).map((term): TermHits => {
    const starts: number[] = [];
    const ends: number[] = [];
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      starts.push(offsets[at] as number);
      ends.push((offsets[at + term.length - 1] as number) + 1);
    }
    return { starts, ends };
  });
  const counts = terms.map((hit) => hit.starts.length);
  const matchCount = counts.reduce((sum, count) => sum + count, 0);

  let { complete, passages } = layoutTaken(terms, counts, text.length);
  let cut = !complete;
  if (cut) {
    const selection = selectByRarity(terms, text.length);
    // Laying out every taken occurrence in page order gives each its full context, but the ones
    // taken without placing can lengthen passages until the last occurrences no longer fit in 10;
    // the selection's own passages, which hold every taken occurrence, stand in then.
    const full = layoutTaken(terms, selection.taken, text.length);
    passages = full.complete ? full.passages : selection.passages;
    cut = terms.some((hit) =>
      hit.starts.some((start, k) => !covered(passages, { start, end: hit.ends[k] as number })),
    );
  }

  return {
    cut,
    matchCount,
    passages: passages.map(({ start, end }) => text.slice(start, end)),
  };
}
