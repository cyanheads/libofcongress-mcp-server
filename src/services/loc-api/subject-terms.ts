/**
 * @fileoverview The `subject` filter grammar of LOC item searches: an LCSH heading or a facet term
 * becomes the lowercase, date-free terms LOC's subject facet indexes.
 * @module services/loc-api/subject-terms
 */

/** A year or year range: `1861`, `1861-1865`, or the open `1945-`. */
const YEARS = String.raw`\d{3,4}(?:-\d{0,4})?`;
const DATE_ONLY = new RegExp(`^${YEARS}$`);
const TRAILING_DATE = new RegExp(`,\\s*${YEARS}$`);

/**
 * The terms to AND into `fa=subject:…`. LOC indexes each heading's components, lowercased and
 * without date qualifiers — `United States--History--Civil War, 1861-1865` is filed under
 * `united states`, `history`, and `civil war` — and matches no full heading. Splits at `--` with or
 * without surrounding spaces, strips a trailing `, <year or range>`, lowercases, and drops
 * components that are only a date. A value with no term left (a bare date) is kept whole,
 * lowercased, so the filter still applies rather than silently widening the search.
 */
export function subjectFacetTerms(subject: string): string[] {
  const terms = subject
    .split(/\s*--\s*/)
    .map((part) => part.trim().replace(TRAILING_DATE, '').toLowerCase())
    .filter((term) => term !== '' && !DATE_ONLY.test(term));
  return terms.length > 0 ? terms : [subject.trim().toLowerCase()];
}
