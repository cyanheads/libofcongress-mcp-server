/**
 * @fileoverview LOC JSON API service — wraps www.loc.gov with rate limiting, retry, and response
 * normalization. Normalization decodes every upstream text value exactly once (LOC sends HTML
 * character references in descriptions, rights, and collection blurbs) and reduces the HTML
 * `item.rights` statement to plain text; result IDs and URLs are read as sent.
 * @module services/loc-api/loc-api-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  McpError,
  notFound,
  rateLimited,
  serviceUnavailable,
  validationError,
} from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createPacer, type Pacer, type RetryAttempt } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig, type ServerConfig } from '@/config/server-config.js';
import {
  LOC_CALL_BUDGET_MS,
  LOC_REQUEST_RESERVE_MS,
  readText,
  retryWithinBudget,
  UPSTREAM_UNAVAILABLE,
} from '@/services/http.js';
import { daysInMonth } from './date-range.js';
import { decodeText, htmlToText } from './loc-text.js';
import {
  lccnFromPermalink,
  newspaperIssueId,
  normalizeItemId,
  normalizePageUrl,
} from './loc-urls.js';
import { locationStateName } from './state-names.js';
import { teiReadingText } from './tei-text.js';
import type {
  LocCollection,
  LocFacetValue,
  LocItemDetail,
  LocItemPage,
  LocItemResource,
  LocItemSummary,
  LocNewspaperFacets,
  LocNewspaperPage,
  LocNewspaperPageDetail,
  LocPagination,
  LocSearchFacets,
  OcrMiss,
  RawLocFacet,
  RawLocItemResponse,
  RawLocNewspaperPageResponse,
  RawLocPagination,
  RawLocRelatedItem,
  RawLocSearchResponse,
  RawLocSearchResult,
} from './types.js';

const LOC_BASE = 'https://www.loc.gov';

/**
 * LOC serves search results only through roughly the first 100,000 matches. A deeper page
 * 302-redirects to an error page that terminates as HTTP 400 (absorbed by
 * {@link LocApiService.fetchSearchPage}'s `allowStatus`), so pages past this depth are
 * unretrievable regardless of the reported total — pagination must not advertise them.
 */
const RETRIEVAL_CEILING = 100_000;

/**
 * Results per page this server requests (`c`), whatever `limit` asks for. LOC honors larger
 * pages; the cap is this server's own bound on response size.
 */
export const LOC_MAX_PAGE_SIZE = 100;

/** The deepest page whose items still fall within the retrieval ceiling at a given page size. */
function maxRetrievablePage(perPage: number): number {
  return Math.max(1, Math.floor(RETRIEVAL_CEILING / perPage));
}

/** True when a page lies entirely beyond LOC's ~100k-item retrieval ceiling (LOC will 400 it). */
function isBeyondRetrievalCeiling(page: number, perPage: number): boolean {
  return page > maxRetrievablePage(perPage);
}

/**
 * The status LOC answered a search page it would not serve with — see
 * {@link LocApiService.fetchSearchPage}. 404: the result set ends before the page. 400: the
 * terminal status of the retrieval-ceiling redirect, accepted only for a page past the ceiling.
 */
type OutOfRangeStatus = 400 | 404;

/**
 * The empty result for a page LOC would not serve. `pages: 0` is the sentinel handlers key their
 * out-of-range notice on; `ceilingReached` separates "asked past the ~100k retrieval ceiling"
 * (recovery: partition by facet) from an overshoot (recovery: page within the reported count).
 * A 400 reaches here only past the ceiling, so it always means the ceiling. A 404 is always an
 * overshoot — LOC is saying the results ran out, so facet-partition advice would be wrong even
 * for a page number past the ceiling.
 */
function outOfRangePage(
  page: number,
  perPage: number,
  status: OutOfRangeStatus,
): { items: never[]; pagination: LocPagination } {
  return {
    items: [],
    pagination: {
      total: 0,
      page,
      perPage,
      pages: 0,
      hasNext: false,
      ceilingReached: status === 400,
    },
  };
}

/**
 * Matches an HTML response body. On a 2xx this is LOC's documented soft block ("HTML pages with
 * CAPTCHAs" under heavy load) or a maintenance page.
 */
const HTML_RESPONSE_RE = /^\s*<(!DOCTYPE\s+html|html[\s>])/i;

/**
 * How long www.loc.gov requests pause after a soft block. LOC names no pause length for its
 * CAPTCHA responses and its limits are per minute, so one minute clears any window, and a
 * challenge that persists costs at most one request a minute.
 */
const SOFT_BLOCK_PAUSE_MS = 60_000;

/** Format slug → LOC endpoint path segment */
const FORMAT_SLUG_MAP: Record<string, string> = {
  photo: 'photos',
  map: 'maps',
  newspaper: 'newspapers',
  manuscript: 'manuscripts',
  audio: 'audio',
  film: 'film-and-videos',
  book: 'books',
  'notated-music': 'notated-music',
};

/** Original-format facets preserve collection routing when a material filter is also given. */
const FORMAT_FACET_MAP: Record<string, string> = {
  photo: 'photo, print, drawing',
  map: 'map',
  newspaper: 'newspaper',
  manuscript: 'manuscript/mixed material',
  audio: 'sound recording',
  film: 'film, video',
  book: 'book',
  'notated-music': 'notated music',
};

/**
 * Rate-limiting state: tracks when the 1-hour block expires.
 * Stored in module-level variable (single service instance per process).
 */
let rateLimitBlockedUntil = 0;

/** Names the www.loc.gov pacer in telemetry and in the shed message a caller reads. */
const UPSTREAM_NAME = 'Library of Congress';

/** Subject of the budget-expiry message — the upstream by name, never by host or URL. */
const LOC_UPSTREAM = `The ${UPSTREAM_NAME}`;

/** LOC's documented JSON/YAML API ceiling: 20 requests per minute, or a 1-hour IP block. */
const LOC_RATE_LIMIT = { requests: 20, perMs: 60_000 };

/**
 * The JSON object a www.loc.gov response body holds. Any other JSON value — `null`, a string, a
 * number, an array — is an outage, not a record: read as an object it would fail as a TypeError,
 * or read as a missing item (the wrong recovery) or an empty search.
 */
function parseJsonObject<T>(text: string): T {
  const json: unknown = JSON.parse(text);
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw serviceUnavailable(`${LOC_UPSTREAM} returned an unexpected response.`, {
      reason: UPSTREAM_UNAVAILABLE,
    });
  }
  return json as T;
}

/** The first value of a string-or-array field, decoded. */
function extractFirstString(value: string | string[] | undefined): string | undefined {
  if (!value) return;
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined ? undefined : decodeText(first);
}

/** Every value of a string-or-array field, decoded. */
function extractStringArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map(decodeText);
}

/** A string-or-array prose field as one decoded string, its entries space-joined. */
function joinedText(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return;
  return extractStringArray(value).join(' ');
}

/**
 * A related-record reference as one string: a string entry decoded, an object entry by `id`, then
 * `url`, then its decoded `title`. Undefined when the entry carries none of them. A link (a string
 * entry, `id`, or `url`) LOC sends relative is resolved by {@link normalizeUrl}
 * (`/item/lomaxbib000840` → `https://www.loc.gov/item/lomaxbib000840`), which the get_item tool
 * then accepts; a title is never a link and stays as sent.
 */
function relatedItemRef(rel: RawLocRelatedItem): string | undefined {
  if (typeof rel === 'string') return normalizeUrl(decodeText(rel)) || undefined;
  const link = rel.id || rel.url;
  if (link) return normalizeUrl(link);
  return (rel.title && decodeText(rel.title)) || undefined;
}

function extractId(result: RawLocSearchResult): string {
  // LOC IDs come as full URLs like https://www.loc.gov/item/2009632251/
  // or as short strings like 2005691065. Item paths can be multi-segment
  // (newspaper pages: /item/sn95047246/1935-09-05/ed-1/) — capture the whole path
  // after /item/, preserving internal slashes so getItem can rebuild the URL.
  const rawId = result.id ?? result.url ?? '';
  const itemMatch = rawId.match(/\/item\/([^?#]+)/);
  if (itemMatch?.[1]) return itemMatch[1].replace(/\/+$/, '');
  return rawId.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '');
}

/**
 * A LOC URL made absolute: protocol-relative (`//lccn.loc.gov/…`, `//tile.loc.gov/…`) on https,
 * root-relative (`/static/images/…`, `/item/<id>`) against `https://www.loc.gov`. Any other value —
 * an absolute URL, a bare ID — is returned exactly as sent.
 */
function normalizeUrl(raw: string): string {
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `${LOC_BASE}${raw}`;
  return raw;
}

/**
 * True for a coded catalog value LOC sends in a date field in place of a date: a MARC date with
 * `u` or `|` placeholders (`uuuu`, `185u`, `||||`), a compact sort number of seven or more digits
 * (`18950000`, `1860000`), or a MARC time-period code holding a `d`-plus-year token
 * (`0w0 d1804 d1806`). A plain year (`800`, `1867`) and every cataloged form (`185?`,
 * `c1915 Feb. 19.`) are dates.
 */
export function isCodedDate(value: string): boolean {
  return (
    /^\d*[u|][\d|u]*$/.test(value) || /^\d{7,}$/.test(value) || /(?:^|\s)d\d{4}(?=\s|$)/.test(value)
  );
}

/**
 * The date an eight-digit compact sort number names, at its own precision: `YYYY0000` → `YYYY`,
 * `YYYYMM00` → `YYYY-MM`, `YYYYMMDD` → `YYYY-MM-DD`. Undefined for any other value and for a number
 * that is no calendar date (year `0000`, month 13, day 32, 30 February, a `00` month with a day). LOC sends the
 * number where the readable date is padded to a day it never recorded (`18631100` beside
 * `1863-11-01`). A year can stand for a cataloged range (`19660000` for `[Between 1966 and 1968]`):
 * it is the year LOC indexes, and the range stays in the imprint.
 */
export function compactDate(value: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return;
  const [, year = '', month = '', day = ''] = match;
  if (year === '0000') return;
  if (month === '00') return day === '00' ? year : undefined;
  if (day === '00') return Number(month) <= 12 ? `${year}-${month}` : undefined;
  return Number(month) <= 12 && Number(day) <= daysInMonth(Number(year), Number(month))
    ? `${year}-${month}-${day}`
    : undefined;
}

/** The first of `candidates` that holds a date: decoded, non-empty, and not {@link isCodedDate}. */
function catalogedDate(...candidates: Array<string | string[] | undefined>): string | undefined {
  return candidates.map(extractFirstString).find((date) => date && !isCodedDate(date));
}

function normalizeSearchResult(result: RawLocSearchResult): LocItemSummary {
  const title = extractFirstString(result.title) ?? 'Untitled';
  const description = joinedText(result.description);
  const format = extractFirstString(result.original_format ?? result.online_format);
  // libofcongress_get_item resolves /item/ resources, which include the records LOC search keys by
  // an lccn.loc.gov permalink (served at /item/<lccn>/). LOC search also mixes in collections
  // (/collections/), exhibit and research-guide pages, newspaper-page /resource/ URLs,
  // catalog.loc.gov records, and hdl.loc.gov finding aids — none of which get_item can consume.
  // Flag the difference so callers don't pass a non-item id to get_item (which 404s).
  const lccn = lccnFromPermalink(result.id ?? result.url ?? '');
  const is_item = Boolean(lccn || result.url?.includes('/item/') || result.id?.includes('/item/'));
  const id = lccn ?? extractId(result);
  const url = normalizeUrl(result.url ?? `${LOC_BASE}/item/${id}/`);
  const normalizedPage = normalizePageUrl(url);
  const page_url =
    normalizedPage && newspaperIssueId(new URL(normalizedPage).pathname)
      ? normalizedPage
      : undefined;
  const link_notice =
    URL.canParse(url) && new URL(url).hostname === 'catalog.loc.gov'
      ? 'This retired catalog link does not open its record; it redirects to the replacement catalog home page.'
      : undefined;
  // The top-level date can be LOC's padded sort key ("1915-01-01"); the row's item block carries
  // the date as cataloged ("c1915 Feb. 19.") when it has one, but on scores, manuscripts, maps,
  // and catalog-only books a coded value instead: a compact sort number, read at its own precision
  // ("18631100" → "1863-11", where the top-level date is "1863-11-01"), or a MARC placeholder
  // ("185u", "uuuu"), where the top-level date ("185?") stands in. The item block's shape varies
  // by endpoint, so only a string there is read.
  const rawItemDate = result.item?.date;
  const itemDate = typeof rawItemDate === 'string' ? rawItemDate : undefined;
  const date = catalogedDate(itemDate, itemDate && compactDate(itemDate), result.date);
  // Passed through whole: the long lists are collection landing rows, and the contributor facet's
  // top 10 cannot stand in for a collection's full list.
  const contributorTerms = extractStringArray(result.contributor);
  return {
    id,
    title,
    ...(date && { date }),
    ...(description && { description }),
    ...(format && { format }),
    is_item,
    ...(contributorTerms.length > 0 && { contributor_terms: contributorTerms }),
    url,
    ...(page_url && { page_url }),
    ...(link_notice && { link_notice }),
  };
}

/** The values of the facet of `type`, each with its item count; entries missing either are skipped. */
function facetValues(facets: RawLocFacet[], type: string): LocFacetValue[] {
  return (facets.find((facet) => facet.type === type)?.filters ?? []).flatMap(({ value, count }) =>
    typeof value === 'string' && typeof count === 'number'
      ? [{ value: decodeText(value), count }]
      : [],
  );
}

/**
 * One `fa` segment, `<facet>:<value>` — every caller-supplied filter value is sent through here
 * (the `original-format` segment carries a fixed catalog value). LOC splits `fa` at `|`, so a
 * value holding one would be cut short and the rest read as a separate filter (a keyless remainder
 * is silently dropped). An empty segment at either end is no filter to LOC (`location:oklahoma|`
 * answers as `location:oklahoma` does), so `|` and spaces at the ends of `value` are dropped. A
 * value with `|` anywhere else, or with nothing left, is refused before any request, as a
 * validation error naming `field`, the caller's input name for the filter. `toFacetValue` turns
 * the cleaned value into the form the facet indexes (a postal code into its state name).
 *
 * @throws McpError ValidationError with `data.reason: 'invalid_filter_value'` when `value` holds
 *   `|` between other characters or holds nothing else.
 */
export function facetSegment(
  field: string,
  facet: string,
  value: string,
  toFacetValue: (term: string) => string = (term) => term,
): string {
  const isEdge = (char: string | undefined) => char === '|' || char?.trim() === '';
  let start = 0;
  let end = value.length;
  while (start < end && isEdge(value[start])) start += 1;
  while (end > start && isEdge(value[end - 1])) end -= 1;
  const term = value.slice(start, end);
  if (term === '' || term.includes('|')) {
    throw validationError(
      `The ${field} value cannot contain "|", which the Library of Congress reads as a separator between filters.`,
      { reason: 'invalid_filter_value', field, retryable: false },
    );
  }
  return `${facet}:${toFacetValue(term)}`;
}

function normalizePagination(
  raw: RawLocPagination | undefined,
  page: number,
  limit: number,
  itemCount: number,
): LocPagination {
  // LOC's live envelope reports the item count in `of` and the page count in `total` (inverse of
  // the intuitive names). Prefer `of`; fall back to `total`, then a numeric `results` display
  // range — a string `results` would flow into Math.ceil below and yield NaN pages. Mocked and
  // legacy shapes without `of` keep their `total`-as-count meaning through the fallback.
  const total = raw?.of ?? raw?.total ?? (typeof raw?.results === 'number' ? raw.results : 0);
  const perPage = raw?.perpage ?? limit;
  const rawPages = raw?.pages ?? (total > 0 ? Math.ceil(total / perPage) : 1);

  // LOC stops serving past ~RETRIEVAL_CEILING items, so pages beyond that depth are unretrievable
  // even though the total implies they exist. Cap the advertised page count so `hasNext` never
  // promises a page the API will reject.
  const cap = maxRetrievablePage(perPage);
  const ceilingReached = rawPages > cap;
  let pages = ceilingReached ? cap : rawPages;

  // Trust a real served page over the computed count: when LOC returns items past the computed
  // last page (its total under-reported the retrievable depth), advertise at least the reached
  // page so `page <= pages` stays consistent — but never claim a page past the ceiling.
  if (itemCount > 0 && page > pages && !isBeyondRetrievalCeiling(page, perPage)) {
    pages = page;
  }

  const hasNext = page < pages;
  return { total, page, perPage, pages, hasNext, ceilingReached };
}

/** Pages an item response lists by default. */
export const ITEM_PAGE_LIMIT_DEFAULT = 50;

/** Most pages one item response lists — this server's bound on response size. */
export const ITEM_PAGE_LIMIT_MAX = 100;

/** Which of an item's pages a response lists, and whether each carries its files. */
export type ItemPageWindow = { pageOffset: number; pageLimit: number; includeFiles: boolean };

type RawItemResource = NonNullable<RawLocItemResponse['resources']>[number];
type RawFileGroup = NonNullable<RawItemResource['files']>[number];

/**
 * Whether a resource's `fulltext_file` is a TEI document transcription: an https tile.loc.gov URL
 * with no port or credentials whose path ends `.xml` (the American Memory `<tei2>` files of the
 * Lincoln and Bell papers, California Gold, and the Rare Book printed ephemera and pamphlets).
 * `itemPages` lists such a resource with `has_transcription` and `getNewspaperPage` reads the file,
 * so the two never disagree. The path is tested, not the whole string: a newspaper page's ALTO
 * text-service URL carries `.xml` only in its query. Book and By the People resources name a `.txt`
 * file, which is not read, and a file anywhere else is never fetched. The URL parser drops the
 * default port, so an explicit `:443` names the same request and passes.
 */
function isTranscriptionFile(fulltextFile: string): boolean {
  const link = normalizeUrl(fulltextFile);
  if (!URL.canParse(link)) return false;
  const { protocol, hostname, port, username, password, pathname } = new URL(link);
  return (
    protocol === 'https:' &&
    hostname === 'tile.loc.gov' &&
    port === '' &&
    username === '' &&
    password === '' &&
    pathname.endsWith('.xml')
  );
}

/**
 * An item's resources and the window of its pages. Pages run across every resource in order;
 * page N of a resource is its `files[N-1]` group, addressed as the resource URL plus `?sp=N` (a
 * one-page resource by its bare URL — LOC's own page links). Every resource is listed. One without
 * a URL — a recording, tape side, or film reel, sent with only its `audio` or `video` — has no
 * addressable page: its one file group is the player config and the media file it already names,
 * so it lists with `page_count` 0 and `page_total` stays the sum of `page_count`.
 */
function itemPages(
  rawResources: RawItemResource[],
  window: ItemPageWindow,
): { resources: LocItemResource[]; pages: LocItemPage[]; pageTotal: number } {
  const resources: LocItemResource[] = [];
  const all: Array<{ pageUrl: string; group: RawFileGroup }> = [];
  for (const raw of rawResources) {
    const url = raw.url ? normalizeUrl(raw.url) : undefined;
    const groups = url ? (raw.files ?? []) : [];
    resources.push({
      ...(url && { url }),
      page_count: groups.length,
      ...(raw.image && { image: normalizeUrl(raw.image) }),
      ...(raw.pdf && { pdf: normalizeUrl(raw.pdf) }),
      ...(raw.audio && { audio: normalizeUrl(raw.audio) }),
      ...(raw.video && { video: normalizeUrl(raw.video) }),
      // typeof-guarded: an unrestricted download is a fact, not a missing value.
      ...(typeof raw.download_restricted === 'boolean' && {
        download_restricted: raw.download_restricted,
      }),
      ...(raw.fulltext_file &&
        isTranscriptionFile(raw.fulltext_file) && { has_transcription: true }),
    });
    if (!url) continue;
    groups.forEach((group, i) => {
      all.push({ pageUrl: groups.length === 1 ? url : withSequence(url, i + 1), group });
    });
  }
  const pages = all
    .slice(window.pageOffset, window.pageOffset + window.pageLimit)
    .map(({ pageUrl, group }) => ({
      page_url: pageUrl,
      has_text: group.some((file) => file.mimetype === 'text/plain'),
      ...(window.includeFiles && { files: group.flatMap((file) => file.url ?? []) }),
    }));
  return { resources, pages, pageTotal: all.length };
}

/**
 * What tile.loc.gov's text service sends as `full_text` for a page whose text file holds no words
 * (a blank book page): a placeholder, not page content.
 */
const BLANK_PAGE_PLACEHOLDER = '[NO TEXT AVAILABLE FOR THIS PAGE]';

/**
 * The page text in a tile.loc.gov text-service body — `{ "<segment>": { "full_text": "…" } }`,
 * the same shape for newspaper, book, and manuscript pages — or undefined when the body is not
 * that shape (a plain-text file, truncated JSON). The text is returned as sent: tile.loc.gov does
 * not HTML-escape it (raw `<`, bare `&`), so decoding would corrupt a literal `&name;`. A body that
 * is the blank-page placeholder alone, surrounding whitespace aside, reads as empty text.
 */
function parseFullText(body: string): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return;
  }
  if (typeof json !== 'object' || json === null) return;
  const segment = Object.values(json)[0] as { full_text?: unknown } | undefined;
  if (typeof segment?.full_text !== 'string') return;
  return segment.full_text.trim() === BLANK_PAGE_PLACEHOLDER ? '' : segment.full_text;
}

/** `url` with its `sp` (page sequence) query parameter set to `sequence`. */
function withSequence(url: string, sequence: number): string {
  const parsed = new URL(url);
  parsed.searchParams.set('sp', String(sequence));
  return parsed.toString();
}

export class LocApiService {
  private readonly userAgent: string;
  /**
   * One FIFO queue in front of www.loc.gov. `minStartGapMs` spaces consecutive starts by the
   * configured delay; the window holds LOC's documented 20-per-minute ceiling whatever that delay
   * is, since a window alone admits all 20 starts in the same millisecond. id.loc.gov and the
   * tile.loc.gov OCR and transcription fetches are different hosts under different limits and
   * stay off it.
   */
  private readonly pacer: Pacer;
  /**
   * When the soft-block pause ends (epoch ms) — see {@link softBlock}. Held per instance rather
   * than module-level like the 1-hour block, so re-initializing the service clears it.
   */
  private pausedUntil = 0;

  constructor(
    _config: AppConfig,
    _storage: StorageService,
    serverConfig: ServerConfig = getServerConfig(),
  ) {
    this.userAgent = serverConfig.userAgent;
    this.pacer = createPacer({
      name: UPSTREAM_NAME,
      minStartGapMs: serverConfig.requestDelayMs,
      limits: [LOC_RATE_LIMIT],
    });
  }

  /** Rejects every caller still queued for www.loc.gov. Called from the server's teardown. */
  dispose(): void {
    this.pacer.dispose();
  }

  /**
   * Refuses a www.loc.gov request while the 1-hour block or the soft-block pause holds. Every
   * throw carries the most specific recovery the server can give — how long is left — in
   * `data.recovery.hint`, which wins over the contract's static hint.
   */
  private checkRateLimit(): void {
    if (rateLimitBlockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((rateLimitBlockedUntil - Date.now()) / 60_000);
      const blockedUntil = new Date(rateLimitBlockedUntil).toISOString();
      throw rateLimited(
        `LOC API rate limit exceeded; requests are blocked for approximately ${minutesLeft} more minute(s).`,
        {
          reason: 'rate_limit_exceeded',
          blockedUntil,
          recovery: {
            hint: `Wait about ${minutesLeft} more minute(s), until ${blockedUntil}, before retrying. Then keep requests under 20 per minute.`,
          },
        },
      );
    }
    if (this.pausedUntil > Date.now()) throw this.pauseError();
  }

  /**
   * Handles LOC's soft block — a Cloudflare challenge (`cf-mitigated: challenge`, any status) or an
   * HTML page on a 2xx: starts a {@link SOFT_BLOCK_PAUSE_MS} pause on www.loc.gov requests and
   * returns the error that fails the challenged call. Checked by {@link checkRateLimit} on arrival
   * and at dispatch, so later and already-queued callers fail without sending. It is
   * `upstream_unavailable`, not `RateLimited`: every handler relabels a `RateLimited` error as the
   * hour-long `rate_limit_exceeded`.
   */
  private softBlock(): McpError {
    this.pausedUntil = Date.now() + SOFT_BLOCK_PAUSE_MS;
    return this.pauseError();
  }

  private pauseError(): McpError {
    const retryAfter = Math.ceil((this.pausedUntil - Date.now()) / 1000);
    return serviceUnavailable(
      `${LOC_UPSTREAM} is challenging automated requests; this server holds requests to it for ${retryAfter} more second(s).`,
      {
        reason: UPSTREAM_UNAVAILABLE,
        retryAfter,
        recovery: { hint: `Wait ${retryAfter} seconds, then retry.` },
      },
    );
  }

  /**
   * Sends one www.loc.gov request through the pacer, as one attempt of a retry ladder. The queue
   * wait is charged to the call's budget: a caller may wait only for the time left minus
   * {@link LOC_REQUEST_RESERVE_MS}, and one the queue cannot start in time is shed at once
   * (`RateLimited`, `data.reason: 'pacer_shed'`) with a hint naming the wait. The 1-hour block is
   * checked on arrival, so a blocked caller neither queues nor is shed with a seconds-long wait,
   * and again when the request is dispatched, so callers already waiting when a 429 lands fail
   * without sending anything. The soft-block pause is checked at the same two points.
   */
  private async fetch(
    url: string,
    ctx: Context,
    attempt: RetryAttempt,
    opts?: { allowStatus?: number[] },
  ): Promise<Response> {
    this.checkRateLimit();
    try {
      return await this.pacer.run((signal) => this.send(url, ctx, signal, opts), {
        signal: attempt.signal,
        maxWaitMs: Math.max(0, attempt.remainingMs - LOC_REQUEST_RESERVE_MS),
      });
    } catch (err) {
      if (err instanceof McpError && err.data?.reason === 'pacer_shed') {
        throw rateLimited(
          `${LOC_UPSTREAM} request queue cannot start this call in time.`,
          {
            ...err.data,
            recovery: {
              hint: `Wait ${String(err.data.retryAfter)} seconds, then retry. Send calls to this server one at a time rather than in parallel.`,
            },
          },
          { cause: err },
        );
      }
      throw err;
    }
  }

  private async send(
    url: string,
    ctx: Context,
    signal: AbortSignal,
    opts?: { allowStatus?: number[] },
  ): Promise<Response> {
    this.checkRateLimit();
    ctx.log.debug('LOC API request', { url });
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      signal,
    });
    if (response.status === 429) {
      rateLimitBlockedUntil = Date.now() + 60 * 60 * 1000;
      const blockedUntil = new Date(rateLimitBlockedUntil).toISOString();
      throw rateLimited(
        'LOC API rate limit exceeded; requests are blocked for approximately 1 hour.',
        {
          reason: 'rate_limit_exceeded',
          blockedUntil,
          recovery: {
            hint: `Wait at least 1 hour, until ${blockedUntil}, before retrying. Then keep requests under 20 per minute.`,
          },
        },
      );
    }
    if (response.status === 404) {
      return response; // Caller handles 404
    }
    // Callers can opt-in to receiving certain non-2xx statuses for graceful handling
    if (opts?.allowStatus?.includes(response.status)) {
      return response;
    }
    if (response.headers.get('cf-mitigated') === 'challenge') {
      throw this.softBlock();
    }
    if (!response.ok) {
      throw serviceUnavailable(`LOC API returned HTTP ${response.status}`, {
        status: response.status,
        reason: UPSTREAM_UNAVAILABLE,
      });
    }
    return response;
  }

  /**
   * Fetch and parse a LOC JSON endpoint within the call's budget, which ends at `deadlineAt`.
   *
   * The retry boundary wraps the full pipeline — queue, fetch, body read, and parse — so a socket
   * drop mid-body is retried, not just a failed connection, and a retry re-queues through the
   * pacer. Only raw network faults retry ({@link isTransientNetworkFault}); the 429 and HTML
   * soft-block throws below fail fast so a retry never re-hits a rate-limited endpoint.
   *
   * Neither failure path attaches the request `url` to its error data — it embeds the
   * internal endpoint and query string, and callers already hold the caller-facing
   * identifier (item ID, page URL) worth reporting. The resource path in particular has
   * no catch block to rewrite the payload, so anything attached here reaches the client
   * verbatim. The URL stays in the debug log above.
   */
  private fetchJson<T>(
    url: string,
    ctx: Context,
    deadlineAt = Date.now() + LOC_CALL_BUDGET_MS,
  ): Promise<T> {
    return retryWithinBudget(
      async (attempt) => {
        const response = await this.fetch(url, ctx, attempt);
        if (response.status === 404) {
          throw notFound('LOC resource not found');
        }
        const text = await readText(response, attempt.signal);
        if (HTML_RESPONSE_RE.test(text)) {
          throw this.softBlock();
        }
        return parseJsonObject<T>(text);
      },
      { ctx, operation: 'loc-api-fetch-json', deadlineAt, upstream: LOC_UPSTREAM },
    );
  }

  /**
   * Fetch page `page` of a LOC search endpoint and normalize each result with `normalize`,
   * returning {@link outOfRangePage} for a page LOC will not serve:
   *
   * - **404 on page > 1** — every search-family endpoint answers a page past the end of its
   *   result set with 404. Page 1 of an existing endpoint is never out of range (an empty
   *   result set is a 200), so a 404 there still throws NotFound — for a `/collections/{slug}/`
   *   search it is the only signal that the slug does not exist.
   * - **400 on a page past the retrieval ceiling** — the ceiling redirect terminates as 400. A
   *   400 on any other page has no known out-of-range cause, so it is not accepted: like a 520
   *   or any other error status, it fails through {@link send} as `upstream_unavailable`.
   *
   * `limit` is the page size sent as `c`, so the ceiling is judged at the size LOC serves.
   *
   * A 414 means the search URL is longer than LOC accepts — in practice an over-long query, the
   * one unbounded input — so it fails as the caller's `query_too_long` validation error rather
   * than an outage an identical retry would hit again.
   *
   * Withholds the request `url` from error data for the same reason as `fetchJson` above —
   * here the query string carries the caller's own search terms.
   */
  private async fetchSearchPage<T>(
    url: string,
    page: number,
    limit: number,
    ctx: Context,
    normalize: (result: RawLocSearchResult) => T,
  ): Promise<{ items: T[]; pagination: LocPagination; facets: RawLocFacet[] }> {
    const allowStatus = isBeyondRetrievalCeiling(page, limit) ? [400, 414] : [414];
    const res = await retryWithinBudget(
      async (
        attempt,
      ): Promise<{ data: RawLocSearchResponse } | { outOfRange: OutOfRangeStatus }> => {
        const response = await this.fetch(url, ctx, attempt, { allowStatus });
        const { status } = response;
        if (status === 414) {
          throw validationError(`${LOC_UPSTREAM} refused this search as too long (HTTP 414).`, {
            reason: 'query_too_long',
            status,
            retryable: false,
          });
        }
        if (status === 404 && page === 1) {
          throw notFound('LOC resource not found');
        }
        if (status === 404 || status === 400) {
          ctx.log.debug('LOC search returned out-of-range page', { status, url });
          return { outOfRange: status };
        }
        const text = await readText(response, attempt.signal);
        if (HTML_RESPONSE_RE.test(text)) {
          throw this.softBlock();
        }
        return { data: parseJsonObject<RawLocSearchResponse>(text) };
      },
      {
        ctx,
        operation: 'loc-api-search-json',
        deadlineAt: Date.now() + LOC_CALL_BUDGET_MS,
        upstream: LOC_UPSTREAM,
      },
    );
    if ('outOfRange' in res) return { ...outOfRangePage(page, limit, res.outOfRange), facets: [] };
    const { data } = res;
    const items = (data.results ?? data.content?.results ?? []).map(normalize);
    const rawPagination = data.pagination ?? data.content?.pagination;
    return {
      items,
      pagination: normalizePagination(rawPagination, page, limit, items.length),
      facets: data.facets ?? [],
    };
  }

  /**
   * Search LOC digital collections.
   *
   * `collectionSlug` scopes the search to one curated collection via its own endpoint, which
   * accepts the same query string and returns the same envelope as /search/. With `format`,
   * the collection endpoint receives an original-format facet; format alone selects its
   * material endpoint. An unrecognized slug 404s, surfacing as NotFound from fetchSearchPage on
   * page 1; on a later page the same 404 reads as out of range (see fetchSearchPage).
   *
   * `subjectTerms` (from `subjectFacetTerms`, ./subject-terms.ts), `location`, and `contributor`
   * are ANDed into one `fa` value, each sent as given. With `includeFacets`, the request also asks
   * for LOC's facet block and the response's subject, location, and contributor facets come back
   * as LOC's top values; without it, `facets` is absent. The facet block costs LOC measurable time
   * per search, so it is opt-in.
   */
  async search(
    params: {
      query: string;
      format?: string;
      collectionSlug?: string;
      sort?: 'relevance' | 'date' | 'date_desc';
      /** A `dates` value from `resolveDateRange` (./date-range.ts), sent as given. */
      dates?: string;
      subjectTerms?: string[];
      location?: string;
      /** A contributor facet value; LOC matches it case-insensitively, every other character exactly. */
      contributor?: string;
      includeFacets?: boolean;
      limit?: number;
      page?: number;
    },
    ctx: Context,
  ): Promise<{ items: LocItemSummary[]; pagination: LocPagination; facets?: LocSearchFacets }> {
    const limit = Math.min(params.limit ?? 25, LOC_MAX_PAGE_SIZE);
    const page = params.page ?? 1;
    const formatSlug = params.format ? FORMAT_SLUG_MAP[params.format] : undefined;
    const endpoint = params.collectionSlug
      ? `${LOC_BASE}/collections/${encodeURIComponent(params.collectionSlug)}/`
      : formatSlug
        ? `${LOC_BASE}/${formatSlug}/`
        : `${LOC_BASE}/search/`;

    // `at=facets` cannot select facet types: it returns all ten (~21 KB), of which three are read.
    const qs = new URLSearchParams({
      fo: 'json',
      q: params.query,
      at: params.includeFacets ? 'results,pagination,facets' : 'results,pagination',
    });
    qs.set('c', String(limit));
    qs.set('sp', String(page));
    if (params.sort && params.sort !== 'relevance') qs.set('sb', params.sort);
    if (params.dates) qs.set('dates', params.dates);
    const fa = (params.subjectTerms ?? []).map((term) => facetSegment('subject', 'subject', term));
    if (params.location) fa.push(facetSegment('location', 'location', params.location));
    if (params.contributor) {
      fa.push(facetSegment('contributor', 'contributor', params.contributor));
    }
    if (params.collectionSlug && params.format) {
      fa.push(`original-format:${FORMAT_FACET_MAP[params.format]}`);
    }
    if (fa.length > 0) qs.set('fa', fa.join('|'));

    const { items, pagination, facets } = await this.fetchSearchPage(
      `${endpoint}?${qs}`,
      page,
      limit,
      ctx,
      normalizeSearchResult,
    );
    return {
      items,
      pagination,
      ...(params.includeFacets && {
        facets: {
          subject: facetValues(facets, 'subject'),
          location: facetValues(facets, 'location'),
          contributor: facetValues(facets, 'contributor'),
        },
      }),
    };
  }

  /**
   * Get full metadata for a single LOC item, with one window of its pages. The window defaults to
   * the first {@link ITEM_PAGE_LIMIT_DEFAULT} pages without per-page files; callers clamp
   * `pageLimit` to {@link ITEM_PAGE_LIMIT_MAX}.
   */
  async getItem(
    itemId: string,
    ctx: Context,
    window: ItemPageWindow = {
      pageOffset: 0,
      pageLimit: ITEM_PAGE_LIMIT_DEFAULT,
      includeFiles: false,
    },
  ): Promise<LocItemDetail> {
    // Encode each path segment independently so multi-segment item IDs (newspaper
    // pages: sn95047246/1935-09-05/ed-1) keep their internal slashes instead of being
    // flattened to %2F, which LOC cannot route.
    const encodedId = itemId.split('/').map(encodeURIComponent).join('/');
    const url = `${LOC_BASE}/item/${encodedId}/?fo=json&at=item,resources,related_items`;
    const data = await this.fetchJson<RawLocItemResponse>(url, ctx);
    const item = data.item;
    if (!item) {
      throw notFound(`LOC item not found: ${itemId}`, { itemId });
    }
    const title = extractFirstString(item.title) ?? 'Untitled';
    const physDesc = extractFirstString(item.physical_description ?? item.medium);
    const callNumber = extractFirstString(item.call_number);

    const { resources, pages, pageTotal } = itemPages(data.resources ?? [], window);
    const nextPageOffset = window.pageOffset + pages.length;

    // Top-level related_items are always objects; item.related_items mixes plain strings with
    // { title, url } objects — both normalize through the same id → url → title preference.
    const relatedItems = [...(data.related_items ?? []), ...(item.related_items ?? [])].flatMap(
      (rel) => relatedItemRef(rel) ?? [],
    );

    // rights_information is plain text. Without it, LOC sends item.rights: an HTML statement with
    // paragraphs and links, which becomes plain text with each link's target kept.
    const rights = item.rights_information
      ? joinedText(item.rights_information)
      : item.rights && htmlToText([item.rights].flat().join(' '));
    // Summary is prose; joining keeps a multi-paragraph record whole where taking the
    // first entry would silently drop the rest.
    const summary = joinedText(item.summary);
    // item.date can be a padded sort key: "1936-01-01" on Prints & Photographs records, whose
    // created_published_date is the date as cataloged ("1936 Apr."), and "1863-11-01" on records
    // cataloged to a month or year, whose nested item.item.date is the compact number read at its
    // own precision ("18631100" → "1863-11"). A coded item.date ("uuuu", "0w0 d1804 d1806") is no
    // date, and is left out.
    const rawNestedDate = item.item?.date;
    const nestedDate = typeof rawNestedDate === 'string' ? rawNestedDate : undefined;
    const date = catalogedDate(
      item.created_published_date,
      nestedDate && compactDate(nestedDate),
      item.date,
    );
    // The publication statement (place, publisher, date) is catalog text: decoded once, its
    // brackets ("2013-<2021>") kept as data.
    const imprint = joinedText(item.created_published);
    // contributor_names carries dates and roles in no one pattern ("Heise, William, camera",
    // "Lomax, John A. (John Avery), 1867-1948 (Collector)"), so the filter form cannot be derived
    // from it; item.contributors keys each contributor by that form. An entry of any other shape
    // names no term and is skipped: the record still returns.
    const contributorTerms = [item.contributors ?? []]
      .flat()
      .filter(
        (entry: unknown) => typeof entry === 'object' && entry !== null && !Array.isArray(entry),
      )
      .flatMap((entry) => Object.keys(entry).map(decodeText));

    return {
      item_id: itemId,
      title,
      ...(date && { date }),
      ...(imprint && { imprint }),
      contributors: extractStringArray(item.contributor_names),
      contributor_terms: contributorTerms,
      subject_headings: extractStringArray(item.subject_headings),
      subject_terms: extractStringArray(item.subject),
      notes: extractStringArray(item.notes),
      ...(summary && { summary }),
      ...(rights && { rights_information: rights }),
      ...(physDesc && { physical_description: physDesc }),
      ...(callNumber && { call_number: callNumber }),
      languages: extractStringArray(item.language),
      locations: extractStringArray(item.location),
      former_ids: extractStringArray(item.number_former_id),
      original_formats: extractStringArray(item.original_format),
      online_formats: extractStringArray(item.online_format),
      // typeof-guarded so a genuine access_restricted: false survives — an unrestricted
      // item is a fact, not a missing value.
      ...(typeof item.access_restricted === 'boolean' && {
        access_restricted: item.access_restricted,
      }),
      resources,
      pages,
      page_total: pageTotal,
      ...(pages.length > 0 && nextPageOffset < pageTotal && { next_page_offset: nextPageOffset }),
      related_items: [...new Set(relatedItems)],
      // Normalize protocol-relative urls (//lccn.loc.gov/...) to https:, matching
      // normalizeSearchResult — LOC returns these for some items (e.g. LCCN records).
      url: normalizeUrl(item.url ?? `${LOC_BASE}/item/${itemId}/`),
    };
  }

  /**
   * Search historical newspaper pages via the /newspapers/ endpoint.
   *
   * `state`, `newspaperTitle`, and `language` are ANDed into one `fa` value. With
   * `includeFacets`, the request also asks for LOC's facet block (35–40 KB on this endpoint) and
   * the title, state, and language facets come back as LOC's top values — each value the form its
   * filter accepts; without it, `facets` is absent.
   */
  async searchNewspapers(
    params: {
      query: string;
      /** A `dates` value from `resolveDateRange` (./date-range.ts), sent as given. */
      dates?: string;
      state?: string;
      newspaperTitle?: string;
      /** A language name as LOC's `language` facet indexes it (e.g. "german"), sent as given. */
      language?: string;
      sort?: 'relevance' | 'date' | 'date_desc';
      includeFacets?: boolean;
      limit?: number;
      page?: number;
    },
    ctx: Context,
  ): Promise<{
    items: LocNewspaperPage[];
    pagination: LocPagination;
    facets?: LocNewspaperFacets;
  }> {
    const limit = Math.min(params.limit ?? 25, LOC_MAX_PAGE_SIZE);
    const page = params.page ?? 1;
    const qs = new URLSearchParams({
      fo: 'json',
      q: params.query,
      at: params.includeFacets ? 'results,pagination,facets' : 'results,pagination',
    });
    qs.set('c', String(limit));
    qs.set('sp', String(page));
    if (params.sort && params.sort !== 'relevance') qs.set('sb', params.sort);
    if (params.dates) qs.set('dates', params.dates);
    const fa: string[] = [];
    // location_state, not location: location also matches city and county names, so "washington"
    // would pull in D.C. and every Washington County. partof_title matches only a title's full
    // catalog string (case-insensitive, no wildcard), so it is sent as given.
    if (params.state) {
      fa.push(facetSegment('state', 'location_state', params.state, locationStateName));
    }
    if (params.newspaperTitle) {
      fa.push(facetSegment('newspaper_title', 'partof_title', params.newspaperTitle));
    }
    if (params.language) fa.push(facetSegment('language', 'language', params.language));
    if (fa.length > 0) qs.set('fa', fa.join('|'));

    const url = `${LOC_BASE}/newspapers/?${qs}`;
    const { items, pagination, facets } = await this.fetchSearchPage(
      url,
      page,
      limit,
      ctx,
      (r): LocNewspaperPage => {
        // Decoded before the cut, so the excerpt never ends inside a character reference.
        const description = extractStringArray(r.description)
          .slice(0, 3)
          .join(' ')
          .substring(0, 500);
        // partof_title holds the canonical publication title for Chronicling America pages.
        // Fall back to last entry of partof if partof_title absent.
        const rawTitle = extractFirstString(r.partof_title) ?? extractStringArray(r.partof).at(-1);
        // location_state is multi-valued (a title indexed against its circulation area lists every
        // state), so no single entry is the place of publication — carry the whole facet. location
        // never stands in: it mixes cities, counties, and "united states".
        const states = extractStringArray(r.location_state);
        const languages = extractStringArray(r.language);
        const date = extractFirstString(r.date);
        return {
          url: r.url ?? '',
          title: extractFirstString(r.title) ?? 'Untitled',
          ...(description && { description }),
          ...(date && { date }),
          ...(states.length > 0 && { states }),
          ...(rawTitle && { newspaper_title: rawTitle }),
          ...(languages.length > 0 && { languages }),
        };
      },
    );
    return {
      items,
      pagination,
      ...(params.includeFacets && {
        facets: {
          newspaper_title: facetValues(facets, 'partof_title'),
          state: facetValues(facets, 'location_state'),
          language: facetValues(facets, 'language'),
        },
      }),
    };
  }

  /**
   * Retrieve the text of one page — newspaper, book, or manuscript — via its resource URL. The
   * text comes from the response's top-level `fulltext_service`, the per-page text service for the
   * requested `sp` (`text_scope: "page"`). A page with no text service whose `resource.fulltext_file`
   * is a TEI transcription on tile.loc.gov ({@link isTranscriptionFile}) reads that file instead: the
   * whole document's transcription, the same text on every page of it (`text_scope: "document"`),
   * credited by `resource.fulltext_attribution`. Any other `fulltext_file` is not read: on books
   * and By the People manuscripts it is the whole volume's plain text (the same file for every
   * page), and on newspaper pages it is the same URL as `fulltext_service`. The page fetch
   * and the text fetch share one call budget; the text leg gets whatever the page fetch left.
   * `ocrMiss`, when set, says why `ocr_text` is empty on a page that has text; a blank page has none.
   */
  async getNewspaperPage(
    pageUrl: string,
    ctx: Context,
  ): Promise<LocNewspaperPageDetail & { ocrMiss?: OcrMiss }> {
    const deadlineAt = Date.now() + LOC_CALL_BUDGET_MS;
    // Strip search-specific params (q=) that LOC echoes into text-service URLs,
    // causing tile.loc.gov OCR requests to 404. Keep sp= (selects the page within a resource).
    const parsed = new URL(pageUrl);
    parsed.searchParams.delete('q');
    const cleanUrl = parsed.toString();

    // One request, three projections: `resource` carries the issue's page count; `item` the
    // publication metadata (title, states, place, edition, date); `fulltext_service` the text
    // service URL for the requested page. `resource` alone has none of the metadata.
    const resourceUrl = cleanUrl.includes('?')
      ? `${cleanUrl}&fo=json&at=item,resource,fulltext_service`
      : `${cleanUrl}?fo=json&at=item,resource,fulltext_service`;

    const data = await this.fetchJson<RawLocNewspaperPageResponse>(resourceUrl, ctx, deadlineAt);

    const res = data.resource;
    if (!res) {
      throw notFound(`LOC newspaper page not found: ${pageUrl}`, { pageUrl });
    }
    // A sparse or missing item block degrades to the URL-derived fallbacks, never an error.
    const item = data.item ?? {};

    // The display-cased newspaper_title reads best; partof_title (lowercased, with place and run)
    // stands in when it is absent.
    const title = extractFirstString(item.newspaper_title) ?? extractFirstString(item.partof_title);
    const itemTitle = extractFirstString(item.title);
    const states = extractStringArray(item.location_state);
    const placeOfPublication = extractFirstString(item.place_of_publication);
    const edition = extractFirstString(item.number_edition);
    const segmentCount = typeof res.segment_count === 'number' ? res.segment_count : undefined;

    // Neither block carries the page's sequence, and a sparse item block can lack date_issued, but
    // both are encoded in the page URL: the date is the path segment after the LCCN, the sequence
    // is the `sp` param.
    const urlDate = parsed.pathname.split('/').find((seg) => /^\d{4}-\d{2}-\d{2}$/.test(seg));
    const date = extractFirstString(item.date_issued) || urlDate;
    const spParam = parsed.searchParams.get('sp');
    const sequence =
      spParam && /^\d+$/.test(spParam) && Number(spParam) > 0 ? Number(spParam) : undefined;
    // item.url names the item on every page type; a book or manuscript resource path does not
    // (`mss93930.mss93930-001` belongs to `mm77093930`). Without it, a newspaper page's issue path
    // is its item ID. A url that is not an item link yields none rather than a guess. LCCN-keyed
    // records send it protocol-relative (`//lccn.loc.gov/<lccn>`), resolved to https first.
    const itemId = item.url
      ? normalizeItemId(normalizeUrl(item.url))
      : newspaperIssueId(parsed.pathname);

    // Only a non-empty string is a text service: pages without one carry `{}` in its place.
    const textService =
      typeof data.fulltext_service === 'string' && data.fulltext_service.trim()
        ? data.fulltext_service
        : undefined;
    const transcription =
      !textService &&
      typeof res.fulltext_file === 'string' &&
      isTranscriptionFile(res.fulltext_file)
        ? normalizeUrl(res.fulltext_file)
        : undefined;
    const attribution = transcription && extractFirstString(res.fulltext_attribution);
    const ocr = textService
      ? await this.fetchOcrText(textService, ctx, deadlineAt)
      : transcription
        ? await this.fetchTranscription(transcription, ctx, deadlineAt)
        : { text: '' };

    return {
      page_url: pageUrl,
      ...(itemId && { item_id: itemId }),
      ...(itemTitle && { item_title: itemTitle }),
      ...(title && { newspaper_title: title }),
      ...(date && { date }),
      ...(states.length > 0 && { states }),
      ...(placeOfPublication && { place_of_publication: placeOfPublication }),
      ...(edition && { edition }),
      ...(sequence !== undefined && { sequence }),
      ...(segmentCount !== undefined && { segment_count: segmentCount }),
      ocr_text: 'text' in ocr ? ocr.text : '',
      ocr_available: textService !== undefined || transcription !== undefined,
      ...(textService && { text_scope: 'page' as const }),
      ...(transcription && { text_scope: 'document' as const }),
      ...(attribution && { text_attribution: attribution }),
      ...('miss' in ocr && { ocrMiss: ocr.miss }),
    };
  }

  /**
   * The text behind a page's `fulltext_service`, or the reason it cannot be had: `unavailable`
   * when {@link fetchTileBody} could not get the body (a retry can help); `unparseable` when the
   * service answered with a body that is not its JSON text shape (a retry cannot). The page
   * reports `ocr_available` either way.
   */
  private async fetchOcrText(
    serviceUrl: string,
    ctx: Context,
    deadlineAt: number,
  ): Promise<{ text: string } | { miss: OcrMiss }> {
    const fetched = await this.fetchTileBody(serviceUrl, ctx, deadlineAt, {
      label: 'OCR text',
      operation: 'loc-api-ocr-text',
    });
    if ('miss' in fetched) return fetched;
    const text = parseFullText(fetched.body);
    if (text === undefined) {
      ctx.log.warning('OCR text service returned an unparseable body', {
        bytes: fetched.body.length,
      });
      return { miss: 'unparseable' };
    }
    return { text };
  }

  /**
   * The reading text of a document's TEI transcription ({@link teiReadingText}), or the reason it
   * cannot be had: `unavailable` when {@link fetchTileBody} could not get the file (a retry can
   * help); `unparseable` when the file is not a `<tei2>` transcription or does not parse (a retry
   * cannot).
   */
  private async fetchTranscription(
    fileUrl: string,
    ctx: Context,
    deadlineAt: number,
  ): Promise<{ text: string } | { miss: OcrMiss }> {
    const fetched = await this.fetchTileBody(fileUrl, ctx, deadlineAt, {
      label: 'Transcription',
      operation: 'loc-api-transcription',
    });
    if ('miss' in fetched) return fetched;
    const text = teiReadingText(fetched.body);
    if (text === undefined) {
      ctx.log.warning('Transcription file is not a TEI transcription or does not parse', {
        bytes: fetched.body.length,
      });
      return { miss: 'unparseable' };
    }
    return { text };
  }

  /**
   * The body of one tile.loc.gov file, or `unavailable` when this call cannot have it: no budget
   * left, a network fault past its retries, an error status (a 404 or 429 included), the budget
   * running out mid-read, or an HTML page in place of the file (LOC's soft block under load). A
   * secondary read beside the page fetch, so every failure degrades rather than failing the call,
   * except a cancelled call, which rethrows. Retried within what the page fetch left of the
   * budget, and off the www.loc.gov pacer and block check: tile.loc.gov is a different host under
   * different limits. An echoed `q=` is stripped first, since tile.loc.gov 404s on it. `read`
   * names the file in logs (`label`) and in retry telemetry (`operation`).
   */
  private async fetchTileBody(
    url: string,
    ctx: Context,
    deadlineAt: number,
    read: { label: string; operation: string },
  ): Promise<{ body: string } | { miss: 'unavailable' }> {
    if (deadlineAt <= Date.now()) {
      ctx.log.warning(`${read.label} fetch skipped — no time left in the call budget`);
      return { miss: 'unavailable' };
    }
    let body: string;
    try {
      const parsedUrl = new URL(url);
      parsedUrl.searchParams.delete('q');
      const fileUrl = parsedUrl.toString();
      ctx.log.debug(`Fetching ${read.label}`, { url: fileUrl });
      const file = await retryWithinBudget(
        async ({ signal }) => {
          const response = await fetch(fileUrl, {
            headers: { 'User-Agent': this.userAgent },
            signal,
          });
          return response.ok
            ? { status: response.status, text: await readText(response, signal) }
            : { status: response.status };
        },
        { ctx, operation: read.operation, deadlineAt, upstream: LOC_UPSTREAM },
      );
      if (file.text === undefined) {
        ctx.log.warning(`${read.label} service returned error`, { status: file.status });
        return { miss: 'unavailable' };
      }
      body = file.text;
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      ctx.log.warning(`${read.label} fetch failed`, { error: String(err) });
      return { miss: 'unavailable' };
    }
    if (HTML_RESPONSE_RE.test(body)) {
      ctx.log.warning(`${read.label} service returned an HTML page — a transient block`);
      return { miss: 'unavailable' };
    }
    return { body };
  }

  /** Browse LOC curated digital collections */
  async browseCollections(
    params: {
      query?: string;
      limit?: number;
      page?: number;
    },
    ctx: Context,
  ): Promise<{ items: LocCollection[]; pagination: LocPagination }> {
    const limit = Math.min(params.limit ?? 25, LOC_MAX_PAGE_SIZE);
    const page = params.page ?? 1;
    const qs = new URLSearchParams({ fo: 'json', at: 'results,pagination' });
    qs.set('c', String(limit));
    qs.set('sp', String(page));
    if (params.query) qs.set('q', params.query);

    const url = `${LOC_BASE}/collections/?${qs}`;
    const { items, pagination } = await this.fetchSearchPage(
      url,
      page,
      limit,
      ctx,
      (r): LocCollection => {
        const title = extractFirstString(r.title) ?? 'Untitled';
        const description = joinedText(r.description);
        const itemUrl = r.url ?? '';
        // The routable slug is the first path segment after /collections/. LOC points browse
        // results at a subpage (…/aaron-copland/about-this-collection/), so anchoring the match
        // to the end of the URL misses every live result and falls through to the title — which
        // is not a route ("Aaron Copland Collection" → aaron-copland-collection, not aaron-copland).
        // The title fallback stays for URLs that genuinely lack a /collections/{slug} segment.
        const slugMatch = itemUrl.match(/\/collections\/([^/?#]+)/);
        const slug = slugMatch?.[1] ?? title.toLowerCase().replace(/\s+/g, '-');
        return {
          slug,
          title,
          ...(description && { description }),
          // Collection size is the top-level `count`; item.total/item.digitized are different
          // figures for the same result. typeof-guarded so a genuine count: 0 survives.
          ...(typeof r.count === 'number' && { item_count: r.count }),
          url: itemUrl,
        };
      },
    );
    return { items, pagination };
  }
}

// --- Init/accessor pattern ---

let _service: LocApiService | undefined;

export function initLocApiService(config: AppConfig, storage: StorageService): void {
  _service = new LocApiService(config, storage);
}

export function getLocApiService(): LocApiService {
  if (!_service) {
    throw new Error('LocApiService not initialized — call initLocApiService() in setup()');
  }
  return _service;
}
