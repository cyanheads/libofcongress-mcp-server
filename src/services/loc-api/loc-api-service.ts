/**
 * @fileoverview LOC JSON API service — wraps www.loc.gov with rate limiting, retry, and response normalization.
 * @module services/loc-api/loc-api-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { notFound, rateLimited, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { withRetry } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';
import { locRetryOptions, timedFetch } from '@/services/http.js';
import type {
  LocCollection,
  LocItemDetail,
  LocItemSummary,
  LocNewspaperPage,
  LocNewspaperPageDetail,
  LocPagination,
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
 * terminal status of the retrieval-ceiling redirect. 520: an older out-of-range answer.
 */
type OutOfRangeStatus = 400 | 404 | 520;

/**
 * The empty result for a page LOC would not serve. `pages: 0` is the sentinel handlers key their
 * out-of-range notice on; `ceilingReached` separates "asked past the ~100k retrieval ceiling"
 * (recovery: partition by facet) from an overshoot (recovery: page within the reported count).
 * A 404 is always an overshoot — LOC is saying the results ran out, so facet-partition advice
 * would be wrong even for a page number past the ceiling.
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
      ceilingReached: status !== 404 && isBeyondRetrievalCeiling(page, perPage),
    },
  };
}

/** Matches an HTML response body — indicates rate-limiting or a maintenance page. */
const HTML_RESPONSE_RE = /^\s*<(!DOCTYPE\s+html|html[\s>])/i;

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

/**
 * Rate-limiting state: tracks when the 1-hour block expires.
 * Stored in module-level variable (single service instance per process).
 */
let rateLimitBlockedUntil = 0;

/** Paces requests to stay under 20 req/min: resolves after the configured delay. */
let lastRequestAt = 0;

async function pace(delayMs: number): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < delayMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs - elapsed));
  }
  lastRequestAt = Date.now();
}

function extractFirstString(value: string | string[] | undefined): string | undefined {
  if (!value) return;
  if (Array.isArray(value)) return value[0];
  return value;
}

function extractStringArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

/**
 * A related-record reference as one string: a string entry as-is, an object entry by `id`, then
 * `url`, then `title`. Undefined when the entry carries none of them.
 */
function relatedItemRef(rel: RawLocRelatedItem): string | undefined {
  return (typeof rel === 'string' ? rel : rel.id || rel.url || rel.title) || undefined;
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

function normalizeUrl(raw: string): string {
  // LOC sometimes returns protocol-relative URLs (//lccn.loc.gov/...) — normalize to https:
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
}

function normalizeSearchResult(result: RawLocSearchResult): LocItemSummary {
  const title = extractFirstString(result.title) ?? 'Untitled';
  const description = Array.isArray(result.description)
    ? result.description.join(' ')
    : result.description;
  const format = (result.original_format ?? result.online_format ?? [])[0] ?? undefined;
  // libofcongress_get_item resolves /item/ resources only. LOC search also mixes in
  // collections (/collections/), exhibit and research-guide pages, and newspaper-page
  // /resource/ URLs — none of which get_item can consume. A result is get_item-usable
  // exactly when its canonical URL is an /item/ path; flag that so callers don't pass a
  // non-item id to get_item (which 404s).
  const is_item = Boolean(result.url?.includes('/item/') || result.id?.includes('/item/'));
  const id = extractId(result);
  const url = normalizeUrl(result.url ?? `${LOC_BASE}/item/${id}/`);
  return {
    id,
    title,
    ...(result.date && { date: result.date }),
    ...(description && { description }),
    ...(format && { format }),
    is_item,
    url,
  };
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

export class LocApiService {
  private readonly userAgent: string;
  private readonly requestDelayMs: number;

  constructor(_config: AppConfig, _storage: StorageService) {
    const serverConfig = getServerConfig();
    this.userAgent = serverConfig.userAgent;
    this.requestDelayMs = serverConfig.requestDelayMs;
  }

  /**
   * Both rate-limit throws carry the most specific recovery the server can give — how long the
   * block has left — in `data.recovery.hint`. Handlers forward this `data` over their contract's
   * static hint, which can only say "about an hour".
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
  }

  private async fetch(
    url: string,
    ctx: Context,
    opts?: { allowStatus?: number[] },
  ): Promise<Response> {
    this.checkRateLimit();
    await pace(this.requestDelayMs);
    ctx.log.debug('LOC API request', { url });
    const response = await timedFetch(
      url,
      { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } },
      ctx,
    );
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
    if (!response.ok) {
      throw serviceUnavailable(`LOC API returned HTTP ${response.status}`, {
        status: response.status,
      });
    }
    return response;
  }

  /**
   * Fetch and parse a LOC JSON endpoint.
   *
   * The retry boundary wraps the full pipeline — fetch, body read, and parse — so a socket
   * drop mid-body is retried, not just a failed connection. Only transient network faults and
   * timeouts retry ({@link locRetryOptions}); the 429 and HTML soft-block throws below fail fast
   * so a retry never re-hits a rate-limited endpoint.
   *
   * Neither failure path attaches the request `url` to its error data — it embeds the
   * internal endpoint and query string, and callers already hold the caller-facing
   * identifier (item ID, page URL) worth reporting. The resource path in particular has
   * no catch block to rewrite the payload, so anything attached here reaches the client
   * verbatim. The URL stays in the debug log above.
   */
  private fetchJson<T>(url: string, ctx: Context): Promise<T> {
    return withRetry(
      async () => {
        const response = await this.fetch(url, ctx);
        if (response.status === 404) {
          throw notFound('LOC resource not found');
        }
        const text = await response.text();
        if (HTML_RESPONSE_RE.test(text)) {
          throw serviceUnavailable(
            'LOC API returned HTML — may be rate-limited or temporarily unavailable.',
          );
        }
        return JSON.parse(text) as T;
      },
      locRetryOptions(ctx, 'loc-api-fetch-json'),
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
   * - **400 or 520** — the retrieval-ceiling redirect terminates as 400; 520 is an older
   *   out-of-range answer.
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
  ): Promise<{ items: T[]; pagination: LocPagination }> {
    const res = await withRetry(
      async (): Promise<{ data: RawLocSearchResponse } | { outOfRange: OutOfRangeStatus }> => {
        const response = await this.fetch(url, ctx, { allowStatus: [400, 520] });
        const { status } = response;
        if (status === 404 && page === 1) {
          throw notFound('LOC resource not found');
        }
        if (status === 404 || status === 400 || status === 520) {
          ctx.log.debug('LOC search returned out-of-range page', { status, url });
          return { outOfRange: status };
        }
        const text = await response.text();
        if (HTML_RESPONSE_RE.test(text)) {
          throw serviceUnavailable(
            'LOC API returned HTML — may be rate-limited or temporarily unavailable.',
          );
        }
        return { data: JSON.parse(text) as RawLocSearchResponse };
      },
      locRetryOptions(ctx, 'loc-api-search-json'),
    );
    if ('outOfRange' in res) return outOfRangePage(page, limit, res.outOfRange);
    const { data } = res;
    const items = (data.results ?? data.content?.results ?? []).map(normalize);
    const rawPagination = data.pagination ?? data.content?.pagination;
    return { items, pagination: normalizePagination(rawPagination, page, limit, items.length) };
  }

  /**
   * Search LOC digital collections.
   *
   * `collectionSlug` scopes the search to one curated collection via its own endpoint, which
   * accepts the same query string and returns the same envelope as /search/. It selects a base
   * path, so it cannot combine with `format` — callers pick one (the search tool rejects the
   * pair up front). An unrecognized slug 404s, surfacing as NotFound from fetchSearchPage on
   * page 1; on a later page the same 404 reads as out of range (see fetchSearchPage).
   */
  search(
    params: {
      query: string;
      format?: string;
      collectionSlug?: string;
      dateStart?: number;
      dateEnd?: number;
      subject?: string;
      location?: string;
      limit?: number;
      page?: number;
    },
    ctx: Context,
  ): Promise<{ items: LocItemSummary[]; pagination: LocPagination }> {
    const limit = Math.min(params.limit ?? 25, 100);
    const page = params.page ?? 1;
    const formatSlug = params.format ? FORMAT_SLUG_MAP[params.format] : undefined;
    const endpoint = params.collectionSlug
      ? `${LOC_BASE}/collections/${encodeURIComponent(params.collectionSlug)}/`
      : formatSlug
        ? `${LOC_BASE}/${formatSlug}/`
        : `${LOC_BASE}/search/`;

    const qs = new URLSearchParams({ fo: 'json', q: params.query, at: 'results,pagination' });
    qs.set('c', String(limit));
    qs.set('sp', String(page));
    if (params.dateStart !== undefined || params.dateEnd !== undefined) {
      const start = params.dateStart ?? 1600;
      const end = params.dateEnd ?? new Date().getFullYear();
      qs.set('dates', `${start}/${end}`);
    }
    const fa: string[] = [];
    if (params.subject) fa.push(`subject:${params.subject}`);
    if (params.location) fa.push(`location:${params.location}`);
    if (fa.length > 0) qs.set('fa', fa.join('|'));

    return this.fetchSearchPage(`${endpoint}?${qs}`, page, limit, ctx, normalizeSearchResult);
  }

  /** Get full metadata for a single LOC item */
  async getItem(itemId: string, ctx: Context): Promise<LocItemDetail> {
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

    const resourceLinks: string[] = [];
    for (const resource of data.resources ?? []) {
      if (resource.url) resourceLinks.push(resource.url);
      if (resource.image) resourceLinks.push(resource.image);
      if (resource.pdf) resourceLinks.push(resource.pdf);
      for (const fileGroup of resource.files ?? []) {
        for (const file of fileGroup) {
          if (file.url) resourceLinks.push(file.url);
        }
      }
    }

    // Top-level related_items are always objects; item.related_items mixes plain strings with
    // { title, url } objects — both normalize through the same id → url → title preference.
    const relatedItems = [...(data.related_items ?? []), ...(item.related_items ?? [])].flatMap(
      (rel) => relatedItemRef(rel) ?? [],
    );

    const rawRights = item.rights_information ?? item.rights;
    const rights = Array.isArray(rawRights) ? rawRights.join(' ') : rawRights;
    // Summary is prose; joining keeps a multi-paragraph record whole where taking the
    // first entry would silently drop the rest.
    const summary = Array.isArray(item.summary) ? item.summary.join(' ') : item.summary;

    return {
      item_id: itemId,
      title,
      ...(item.date && { date: item.date }),
      contributors: extractStringArray(item.contributor_names),
      subject_headings: extractStringArray(item.subject),
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
      resource_links: [...new Set(resourceLinks)],
      related_items: [...new Set(relatedItems)],
      // Normalize protocol-relative urls (//lccn.loc.gov/...) to https:, matching
      // normalizeSearchResult — LOC returns these for some items (e.g. LCCN records).
      url: normalizeUrl(item.url ?? `${LOC_BASE}/item/${itemId}/`),
    };
  }

  /** Search historical newspaper pages via the /newspapers/ endpoint */
  searchNewspapers(
    params: {
      query: string;
      dateStart?: number;
      dateEnd?: number;
      state?: string;
      newspaperTitle?: string;
      limit?: number;
      page?: number;
    },
    ctx: Context,
  ): Promise<{ items: LocNewspaperPage[]; pagination: LocPagination }> {
    const limit = Math.min(params.limit ?? 25, 100);
    const page = params.page ?? 1;
    const qs = new URLSearchParams({ fo: 'json', q: params.query, at: 'results,pagination' });
    qs.set('c', String(limit));
    qs.set('sp', String(page));
    if (params.dateStart !== undefined || params.dateEnd !== undefined) {
      const start = params.dateStart ?? 1770;
      const end = params.dateEnd ?? 1963;
      qs.set('dates', `${start}/${end}`);
    }
    const fa: string[] = [];
    if (params.state) fa.push(`location:${params.state.toLowerCase()}`);
    if (params.newspaperTitle) fa.push(`partof_title:${params.newspaperTitle}`);
    if (fa.length > 0) qs.set('fa', fa.join('|'));

    const url = `${LOC_BASE}/newspapers/?${qs}`;
    return this.fetchSearchPage(url, page, limit, ctx, (r): LocNewspaperPage => {
      const description = extractStringArray(r.description).slice(0, 3).join(' ').substring(0, 500);
      // partof_title holds the canonical publication title for Chronicling America pages.
      // Fall back to last entry of partof if partof_title absent.
      const rawTitle =
        extractFirstString(r.partof_title) ??
        (Array.isArray(r.partof) ? r.partof[r.partof.length - 1] : r.partof);
      // location_state is multi-valued (a title indexed against its circulation area lists every
      // state), so no single entry is the place of publication — carry the whole facet. location
      // never stands in: it mixes cities, counties, and "united states".
      const states = extractStringArray(r.location_state);
      return {
        url: r.url ?? '',
        title: extractFirstString(r.title) ?? 'Untitled',
        ...(description && { description }),
        ...(r.date && { date: r.date }),
        ...(states.length > 0 && { states }),
        ...(rawTitle && { newspaper_title: rawTitle }),
      };
    });
  }

  /** Retrieve full OCR text for a specific newspaper page via its resource URL */
  async getNewspaperPage(pageUrl: string, ctx: Context): Promise<LocNewspaperPageDetail> {
    // Strip search-specific params (q=) that LOC echoes into fulltext_file URLs,
    // causing tile.loc.gov OCR requests to 404. Keep sp= (selects the page within a resource).
    const parsed = new URL(pageUrl);
    parsed.searchParams.delete('q');
    const cleanUrl = parsed.toString();

    // One request, two projections: `resource` carries the page's OCR pointer and the issue's
    // page count; `item` carries the issue's publication metadata (title, states, place, edition,
    // date). `resource` alone has none of the metadata.
    const resourceUrl = cleanUrl.includes('?')
      ? `${cleanUrl}&fo=json&at=item,resource`
      : `${cleanUrl}?fo=json&at=item,resource`;

    const data = await this.fetchJson<RawLocNewspaperPageResponse>(resourceUrl, ctx);

    const res = data.resource;
    if (!res) {
      throw notFound(`LOC newspaper page not found: ${pageUrl}`, { pageUrl });
    }
    // A sparse or missing item block degrades to the URL-derived fallbacks, never an error.
    const item = data.item ?? {};

    // The display-cased newspaper_title reads best; partof_title (lowercased, with place and run)
    // stands in when it is absent.
    const title = extractFirstString(item.newspaper_title) ?? extractFirstString(item.partof_title);
    const states = extractStringArray(item.location_state);
    const placeOfPublication = extractFirstString(item.place_of_publication);
    const edition = extractFirstString(item.number_edition);
    const segmentCount = typeof res.segment_count === 'number' ? res.segment_count : undefined;

    // Neither block carries the page's sequence, and a sparse item block can lack date_issued, but
    // both are encoded in the page URL: the date is the path segment after the LCCN, the sequence
    // is the `sp` param.
    const urlDate = parsed.pathname.split('/').find((seg) => /^\d{4}-\d{2}-\d{2}$/.test(seg));
    const date = item.date_issued || urlDate;
    const spParam = parsed.searchParams.get('sp');
    const sequence =
      spParam && /^\d+$/.test(spParam) && Number(spParam) > 0 ? Number(spParam) : undefined;

    let ocrText = '';
    let ocrAvailable = false;

    if (res.fulltext_file) {
      ocrAvailable = true;
      try {
        // fulltext_file is already a fully-qualified URL from the LOC resource API.
        // Strip q= to avoid echoed search terms causing tile.loc.gov 404s.
        const fulltextUrl = new URL(res.fulltext_file);
        fulltextUrl.searchParams.delete('q');
        const textUrl = fulltextUrl.toString();
        ctx.log.debug('Fetching OCR text', { url: textUrl });
        // Retry + timeout this secondary tile.loc.gov fetch too. It intentionally skips the
        // www.loc.gov pace()/checkRateLimit() guards — a different host, already best-effort
        // inside this try/catch — so any residual failure degrades to ocr_available with empty
        // text rather than failing the whole page.
        const textResponse = await withRetry(
          () => timedFetch(textUrl, { headers: { 'User-Agent': this.userAgent } }, ctx),
          locRetryOptions(ctx, 'loc-api-ocr-text'),
        );
        if (textResponse.ok) {
          // tile.loc.gov returns JSON, not ALTO XML. Shape:
          // { "<batch-key>": { "full_text": "...", "height": N, "width": N } }
          const json = (await textResponse.json()) as Record<string, { full_text?: string }>;
          const firstEntry = Object.values(json)[0];
          ocrText = firstEntry?.full_text ?? '';
        } else {
          // OCR service unavailable — return empty text, still mark as available
          ctx.log.warning('OCR text service returned error', {
            status: textResponse.status,
          });
        }
      } catch (err) {
        ctx.log.warning('OCR text fetch failed', { error: String(err) });
      }
    }

    return {
      page_url: pageUrl,
      ...(title && { newspaper_title: title }),
      ...(date && { date }),
      ...(states.length > 0 && { states }),
      ...(placeOfPublication && { place_of_publication: placeOfPublication }),
      ...(edition && { edition }),
      ...(sequence !== undefined && { sequence }),
      ...(segmentCount !== undefined && { segment_count: segmentCount }),
      ocr_text: ocrText,
      ocr_available: ocrAvailable,
    };
  }

  /** Browse LOC curated digital collections */
  browseCollections(
    params: {
      query?: string;
      limit?: number;
      page?: number;
    },
    ctx: Context,
  ): Promise<{ items: LocCollection[]; pagination: LocPagination }> {
    const limit = Math.min(params.limit ?? 25, 100);
    const page = params.page ?? 1;
    const qs = new URLSearchParams({ fo: 'json', at: 'results,pagination' });
    qs.set('c', String(limit));
    qs.set('sp', String(page));
    if (params.query) qs.set('q', params.query);

    const url = `${LOC_BASE}/collections/?${qs}`;
    return this.fetchSearchPage(url, page, limit, ctx, (r): LocCollection => {
      const title = extractFirstString(r.title) ?? 'Untitled';
      const description = Array.isArray(r.description) ? r.description.join(' ') : r.description;
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
    });
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
