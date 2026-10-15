/**
 * @fileoverview Caller-supplied LOC identifiers in their one-to-one link forms, reduced to what the
 * service requests: an item ID from a loc.gov `/item/` link or an `lccn.loc.gov` permalink, and a
 * page URL on `https://www.loc.gov/resource/` from the loc.gov and Chronicling America page link
 * forms. A form that maps to no single item or page returns undefined, so no request is built from
 * it.
 *
 * Matching is by anchored pattern on the caller's text, never by URL parsing: a parser resolves
 * `..` and `%2e%2e`, reads `user@host` as a host, and folds backslashes into slashes before any
 * check could see them. Hosts match exactly, and every path segment is restricted to the
 * characters LOC IDs use, so dot segments, percent-escapes, and look-alike hosts cannot match. The
 * one escape read is `%20` in an `lccn.loc.gov` permalink's LCCN, a blank that normalization drops.
 * @module services/loc-api/loc-urls
 */

/** One segment of a LOC ID: letters, digits, `.`, `_`, `-`, starting with a letter or digit. */
const SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]*';
const ID_PATH = `${SEGMENT}(?:/${SEGMENT})*`;
/** An optional http(s) scheme and the loc.gov host, bare or www. */
const LOC_ORIGIN = '(?:https?://)?(?:www\\.)?loc\\.gov';
/** `<lccn>/<date>/ed-N`, the issue path shared by every newspaper page form. */
const NEWSPAPER_ISSUE = '[A-Za-z0-9]+/\\d{4}-\\d{2}-\\d{2}/ed-[1-9]\\d*';

const ITEM_URL = new RegExp(`^(?:${LOC_ORIGIN}/)?item/(${ID_PATH})/?(?:[?#].*)?$`);
/**
 * An `lccn.loc.gov` permalink, capturing its one path segment as written: lowercase letters,
 * digits, hyphens, and blanks (` ` or its `%20` escape), at most 64 of them — a normalized LCCN
 * is 13 characters at most, and the bound keeps a long caller string from being scanned. The
 * permalink's other paths (`/marcxml`) are not item records.
 */
const LCCN_PERMALINK = /^(?:https?:\/\/)?lccn\.loc\.gov\/((?:[a-z\d -]|%20){1,64})\/?(?:[?#].*)?$/;
/** A normalized LCCN: up to three lowercase letters, then 8 or 10 digits (`2005567251`, `sn83030214`). */
const NORMALIZED_LCCN = /^[a-z]{0,3}(?:\d{8}|\d{10})$/;
/** The serial after an LCCN's hyphen: one to six digits, left-padded to six on normalizing. */
const LCCN_SERIAL = /^\d{1,6}$/;
const BARE_ITEM_ID = new RegExp(`^${ID_PATH}/?$`);
/** A first segment that is a host: a loc.gov host, or any dotted name with a path after it. */
const HOST_FIRST = /^(?:(?:[A-Za-z0-9-]+\.)*loc\.gov(?:\/|$)|[^/.]*\.[^/]*\/)/;

const RESOURCE_URL = new RegExp(`^${LOC_ORIGIN}(/resource/${ID_PATH}/?)(?:\\?([^#]*))?(?:#.*)?$`);
const RESOURCE_SEQ_PATH = new RegExp(`^/resource/(${NEWSPAPER_ISSUE})/seq-([1-9]\\d*)/?$`);
const CHRONICLING_AMERICA_PAGE = new RegExp(
  `^(?:https?://)?(?:chroniclingamerica\\.loc\\.gov|(?:www\\.)?loc\\.gov/chroniclingamerica)/lccn/(${NEWSPAPER_ISSUE})/seq-([1-9]\\d*)/?(?:[?#].*)?$`,
);
const RESOURCE_ISSUE_PATH = new RegExp(`^/resource/(${NEWSPAPER_ISSUE})/$`);
const PAGE_SEQUENCE = /^[1-9]\d*$/;

const LOC_RESOURCE_ORIGIN = 'https://www.loc.gov';

/**
 * The normalized LCCN an `lccn.loc.gov` permalink names (`https://lccn.loc.gov/<lccn>`,
 * `http://…`, or scheme-less; trailing slash optional; query and fragment dropped), or undefined
 * for any other text. LOC's `/item/` route serves only the normalized form and answers
 * `2005-568294` or `sn 83030214` with 404, so the LCCN is normalized by LC's fixed rule: every
 * blank removed; a hyphen removed and the one to six digits after it left-padded with zeros to
 * six. A result that is still not a normalized LCCN is undefined. Bare item IDs are never
 * normalized: real ones carry hyphens (`afc1981004-b42`).
 */
export function lccnFromPermalink(raw: string): string | undefined {
  const written = LCCN_PERMALINK.exec(raw.trim())?.[1];
  if (written === undefined) return;
  const [prefix = '', serial, ...extra] = written
    .replaceAll('%20', '')
    .replaceAll(' ', '')
    .split('-');
  if (extra.length > 0 || (serial !== undefined && !LCCN_SERIAL.test(serial))) return;
  const lccn = serial === undefined ? prefix : `${prefix}${serial.padStart(6, '0')}`;
  return NORMALIZED_LCCN.test(lccn) ? lccn : undefined;
}

/**
 * The bare item ID for `raw`: a LOC item ID as given (one trailing slash dropped), the ID inside
 * a loc.gov `/item/` link (`https://www.loc.gov/item/<id>/`, `http://…`, scheme-less, `item/<id>`)
 * with its query and fragment dropped, or the LCCN of an `lccn.loc.gov` permalink
 * ({@link lccnFromPermalink}). Multi-segment IDs keep their slashes. Undefined for anything else:
 * another loc.gov path, another host, or characters and segments no LOC ID has.
 */
export function normalizeItemId(raw: string): string | undefined {
  const value = raw.trim();
  const fromLink = ITEM_URL.exec(value)?.[1] ?? lccnFromPermalink(value);
  if (fromLink) return fromLink;
  if (!BARE_ITEM_ID.test(value) || HOST_FIRST.test(value)) return;
  return value.replace(/\/$/, '');
}

/**
 * The issue path (`<lccn>/<date>/ed-N`, the issue's item ID) of a newspaper page's `pathname`
 * (`/resource/<lccn>/<date>/ed-N/`, as {@link normalizePageUrl} returns it), or undefined for any
 * other path.
 */
export function newspaperIssueId(pathname: string): string | undefined {
  return RESOURCE_ISSUE_PATH.exec(pathname)?.[1];
}

/**
 * The `https://www.loc.gov/resource/…` page URL for `raw`, or undefined when `raw` names no single
 * page. Accepts a `/resource/` URL over http or https, with or without `www.` or a scheme, keeping
 * only its `sp` page sequence; a newspaper page path ending `/ed-N/seq-M/` becomes `/ed-N/?sp=M`;
 * a Chronicling America page link (`chroniclingamerica.loc.gov/lccn/…/ed-N/seq-M/`, or
 * `www.loc.gov/chroniclingamerica/lccn/…`) becomes its `/resource/…/ed-N/?sp=M` page, as LOC's own
 * redirects map it. A Chronicling America issue link without `seq-M`, OCR view, or file link names
 * no page; any other well-formed `/resource/` path passes through for LOC to resolve.
 */
export function normalizePageUrl(raw: string): string | undefined {
  const value = raw.trim();
  const chroniclingAmerica = CHRONICLING_AMERICA_PAGE.exec(value);
  if (chroniclingAmerica) {
    return `${LOC_RESOURCE_ORIGIN}/resource/${chroniclingAmerica[1]}/?sp=${chroniclingAmerica[2]}`;
  }
  const resource = RESOURCE_URL.exec(value);
  if (!resource) return;
  const [, path = '', query = ''] = resource;
  const seqPath = RESOURCE_SEQ_PATH.exec(path);
  if (seqPath) return `${LOC_RESOURCE_ORIGIN}/resource/${seqPath[1]}/?sp=${seqPath[2]}`;
  const sequence = new URLSearchParams(query).get('sp');
  if (sequence === null) return `${LOC_RESOURCE_ORIGIN}${path}`;
  return PAGE_SEQUENCE.test(sequence) ? `${LOC_RESOURCE_ORIGIN}${path}?sp=${sequence}` : undefined;
}
