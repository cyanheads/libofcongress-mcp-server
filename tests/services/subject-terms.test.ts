/**
 * @fileoverview Tests for the `subject` filter normalization — an LCSH heading or a facet term
 * becomes the lowercase, date-free terms LOC's subject facet indexes.
 * @module tests/services/subject-terms.test
 */

import { describe, expect, it } from 'vitest';
import { subjectFacetTerms } from '@/services/loc-api/subject-terms.js';

describe('subjectFacetTerms', () => {
  it.each([
    ['World War, 1939-1945', ['world war']],
    ['world war', ['world war']],
    ['United States--History--Civil War, 1861-1865', ['united states', 'history', 'civil war']],
    ['Transportation--Oklahoma--Maps', ['transportation', 'oklahoma', 'maps']],
    ['World War, 1939-1945 -- Personal Narratives', ['world war', 'personal narratives']],
    ['Dust storms --Oklahoma', ['dust storms', 'oklahoma']],
    [
      'United States--Politics and government--1861-1865',
      ['united states', 'politics and government'],
    ],
    ['United States--History--1945-', ['united states', 'history']],
    ['Washington (D.C.)--1812', ['washington (d.c.)']],
    ['Fort Reno (Okla.)', ['fort reno (okla.)']],
    ['  Jazz  ', ['jazz']],
  ])('%j → %j', (subject, terms) => {
    expect(subjectFacetTerms(subject)).toEqual(terms);
  });

  it('keeps a comma that is not followed by a date', () => {
    expect(subjectFacetTerms('Photography, Aerial')).toEqual(['photography, aerial']);
  });

  it('keeps a century, which is not a year or year range', () => {
    expect(subjectFacetTerms('Chicago (Ill.)--History--19th century')).toEqual([
      'chicago (ill.)',
      'history',
      '19th century',
    ]);
  });

  it('keeps a value that is only a date whole, so the filter never silently widens', () => {
    expect(subjectFacetTerms('1861-1865')).toEqual(['1861-1865']);
  });

  it('drops empty components left by doubled or edge separators', () => {
    expect(subjectFacetTerms('--Civil war----Religious aspects--')).toEqual([
      'civil war',
      'religious aspects',
    ]);
  });
});
