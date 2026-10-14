/**
 * @fileoverview Tests for the LOC date-range grammar — bound parsing, normalization, open-side
 * fills, and the range checks that run before any request.
 * @module tests/services/date-range.test
 */

import { describe, expect, it, vi } from 'vitest';
import {
  type DateBound,
  parseDateBound,
  resolveDateRange,
  yearBound,
} from '@/services/loc-api/date-range.js';

/** Parses a bound the test expects to be valid. */
function bound(value: number | string): DateBound {
  const parsed = parseDateBound(value);
  if (!parsed.ok) throw new Error(`expected ${value} to parse: ${parsed.problem}`);
  return parsed.bound;
}

describe('parseDateBound', () => {
  it.each([
    [1912, '1912'],
    [500, '500'],
    ['1912', '1912'],
    ['1912-04', '1912-04'],
    ['1912-4', '1912-04'],
    ['1912-04-16', '1912-04-16'],
    ['1912-4-6', '1912-04-06'],
    ['0000', '0000'],
    ['1912-02-29', '1912-02-29'],
    ['2000-02-29', '2000-02-29'],
  ])('sends %j as %s', (value, text) => {
    expect(bound(value).text).toBe(text);
  });

  it('keeps the value as given for error reporting', () => {
    expect(bound('1912-4-6').given).toBe('1912-4-6');
    expect(bound(1912).given).toBe(1912);
  });

  it.each([
    ['1912-13', 'month 13 is not between 01 and 12'],
    ['1912-00', 'month 00 is not between 01 and 12'],
    ['1912-0-5', 'month 0 is not between 01 and 12'],
    ['1912-02-30', '1912-02 has 29 days'],
    ['1913-02-29', '1913-02 has 28 days'],
    ['1900-02-29', '1900-02 has 28 days'],
    ['1912-04-31', '1912-04 has 30 days'],
    ['1912-04-00', '1912-04 has 30 days'],
    ['1912-04-16T00', 'it is not in YYYY, YYYY-MM, or YYYY-MM-DD form'],
  ])('rejects %s: %s', (value, problem) => {
    expect(parseDateBound(value)).toEqual({ ok: false, problem });
  });

  it('spans the first through last day of its precision', () => {
    expect(bound('1912')).toMatchObject({ first: 19120101, last: 19121231 });
    expect(bound('1912-02')).toMatchObject({ first: 19120201, last: 19120229 });
    expect(bound('1912-04-16')).toMatchObject({ first: 19120416, last: 19120416 });
    expect(bound(1912)).toMatchObject({ first: 19120101, last: 19121231 });
  });
});

describe('resolveDateRange', () => {
  it('sends nothing when neither bound is set', () => {
    expect(resolveDateRange(undefined, undefined, 2026)).toEqual({ ok: true });
  });

  it.each([
    [yearBound(1920), yearBound(1933), '1920/1933'],
    [undefined, yearBound(1769), '0000/1769'],
    [undefined, yearBound(500), '0000/500'],
    [undefined, bound('1912-04-16'), '0000/1912-04-16'],
    [yearBound(1970), undefined, '1970/2026'],
    [bound('1912-04-16'), undefined, '1912-04-16/2026'],
    [yearBound(2026), undefined, '2026/2026'],
    [bound('2026-12-31'), undefined, '2026-12-31/2026'],
    [bound('1912'), bound('1912-04-16'), '1912/1912-04-16'],
    [bound('1912-04'), bound('1912-04-16'), '1912-04/1912-04-16'],
    [bound('1912-04-16'), bound('1912-04'), '1912-04-16/1912-04'],
    [bound('1912-04-16'), bound('1912-04-16'), '1912-04-16/1912-04-16'],
  ])('sends %j to %j as %s (current year 2026)', (start, end, dates) => {
    expect(resolveDateRange(start, end, 2026)).toEqual({ ok: true, dates });
  });

  it('rejects a start after the end, comparing the start’s first day to the end’s last', () => {
    expect(resolveDateRange(yearBound(1930), yearBound(1900), 2026)).toEqual({
      ok: false,
      message: 'date_start (1930) is later than date_end (1900).',
      data: { field: 'date_start', date_start: 1930, date_end: 1900 },
    });
    expect(resolveDateRange(bound('1912-4-17'), bound('1912-04-16'), 2026)).toEqual({
      ok: false,
      message: 'date_start (1912-04-17) is later than date_end (1912-04-16).',
      data: { field: 'date_start', date_start: '1912-4-17', date_end: '1912-04-16' },
    });
    expect(resolveDateRange(bound('1912-05'), bound('1912-04-30'), 2026).ok).toBe(false);
    expect(resolveDateRange(bound(1913), bound('1912-12-31'), 2026).ok).toBe(false);
  });

  it('rejects a lone start after the current year, naming the year', () => {
    expect(resolveDateRange(yearBound(2030), undefined, 2026)).toEqual({
      ok: false,
      message:
        'date_start (2030) is later than the current year (2026), so the open-ended range it starts can match nothing.',
      data: { field: 'date_start', date_start: 2030, current_year: 2026 },
    });
    expect(resolveDateRange(bound('2027-01-01'), undefined, 2026).ok).toBe(false);
  });

  it('defaults the current year to the clock', () => {
    vi.useFakeTimers({ now: new Date('2031-06-15T12:00:00Z') });
    try {
      expect(resolveDateRange(yearBound(1900), undefined)).toEqual({
        ok: true,
        dates: '1900/2031',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
