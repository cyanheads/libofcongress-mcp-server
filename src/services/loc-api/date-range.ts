/**
 * @fileoverview The date-range grammar of LOC search requests: parses a tool's date bound, fills an
 * open side of the range, and renders the `dates=<start>/<end>` value LOC reads.
 * @module services/loc-api/date-range
 */

/**
 * A date bound string: `YYYY`, `YYYY-M[M]`, or `YYYY-M[M]-D[D]`. Advertised as the input schema's
 * `pattern`; its groups are the year, month, and day.
 */
export const DATE_STRING_PATTERN = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/;

/**
 * An open start is sent as year 0000. LOC reads `dates=/<end>` as the end year alone, and any later
 * floor drops material both corpora hold.
 */
const OPEN_START = '0000';

/** A date bound in the form LOC reads, with the inclusive span of days it covers. */
export interface DateBound {
  /** First day covered, ordered as `year * 10000 + month * 100 + day`. */
  first: number;
  /** The value as the caller gave it — reported back in an error. */
  given: number | string;
  /** Last day covered, in the same order as `first`. */
  last: number;
  /** Sent to LOC: an integer year as given, or a zero-padded `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. */
  text: string;
}

/** The outcome of resolving a range: the `dates` value to send, or why nothing can match. */
export type DateRange =
  | { ok: true; dates?: string }
  | { ok: false; message: string; data: Record<string, number | string> };

function dayKey(year: number, month: number, day: number): number {
  return year * 10_000 + month * 100 + day;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A whole year, sent exactly as given. */
export function yearBound(year: number): DateBound {
  return { given: year, first: dayKey(year, 1, 1), last: dayKey(year, 12, 31), text: String(year) };
}

/**
 * Parses an integer year or a date string, zero-padding month and day: LOC answers `1912-4-16`
 * differently from `1912-04-16`. A string that names no calendar day fails with the reason, since
 * LOC answers an impossible date (`1912-02-30`) as a nearby real one instead of rejecting it.
 */
export function parseDateBound(
  value: number | string,
): { ok: true; bound: DateBound } | { ok: false; problem: string } {
  if (typeof value === 'number') return { ok: true, bound: yearBound(value) };
  const match = DATE_STRING_PATTERN.exec(value);
  if (!match) return { ok: false, problem: 'it is not in YYYY, YYYY-MM, or YYYY-MM-DD form' };
  const [, yearText = '', monthText, dayText] = match;
  const year = Number(yearText);
  if (monthText === undefined) {
    return { ok: true, bound: { ...yearBound(year), given: value, text: yearText } };
  }

  const month = Number(monthText);
  if (month < 1 || month > 12) {
    return { ok: false, problem: `month ${monthText} is not between 01 and 12` };
  }
  const monthEnd = daysInMonth(year, month);
  if (dayText === undefined) {
    return {
      ok: true,
      bound: {
        given: value,
        first: dayKey(year, month, 1),
        last: dayKey(year, month, monthEnd),
        text: `${yearText}-${pad(month)}`,
      },
    };
  }

  const day = Number(dayText);
  if (day < 1 || day > monthEnd) {
    return { ok: false, problem: `${yearText}-${pad(month)} has ${monthEnd} days` };
  }
  const key = dayKey(year, month, day);
  return {
    ok: true,
    bound: { given: value, first: key, last: key, text: `${yearText}-${pad(month)}-${pad(day)}` },
  };
}

/**
 * Resolves the `dates` value for an optional start and end. A start counts as the first day of its
 * precision and an end as the last, so `1912-04` to `1912-04-16` is a valid range. An open start is
 * sent as 0000 and an open end as the current year: LOC answers an inverted range with material
 * outside it rather than an error, so a fixed fill past a given bound must never reach it, and a
 * lone start after the current year — which nothing can match — fails instead of being sent.
 */
export function resolveDateRange(
  start: DateBound | undefined,
  end: DateBound | undefined,
  currentYear = new Date().getFullYear(),
): DateRange {
  if (start === undefined) {
    return end === undefined ? { ok: true } : { ok: true, dates: `${OPEN_START}/${end.text}` };
  }
  if (end !== undefined) {
    return start.first > end.last
      ? {
          ok: false,
          message: `date_start (${start.text}) is later than date_end (${end.text}).`,
          data: { field: 'date_start', date_start: start.given, date_end: end.given },
        }
      : { ok: true, dates: `${start.text}/${end.text}` };
  }
  const openEnd = yearBound(currentYear);
  return start.first > openEnd.last
    ? {
        ok: false,
        message: `date_start (${start.text}) is later than the current year (${currentYear}), so the open-ended range it starts can match nothing.`,
        data: { field: 'date_start', date_start: start.given, current_year: currentYear },
      }
    : { ok: true, dates: `${start.text}/${openEnd.text}` };
}
