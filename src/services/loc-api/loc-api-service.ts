/**
 * @fileoverview LOC JSON API service — wraps www.loc.gov with rate limiting, retry, and response normalization.
 * @module services/loc-api/loc-api-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { notFound, rateLimited, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { getServerConfig } from '@/config/server-config.js';
import type {
  LocCollection,
  LocItemDetail,
  LocItemSummary,
  LocNewspaperPage,
  LocNewspaperPageDetail,
  LocPagination,
  RawLocItemResponse,
  RawLocPagination,
  RawLocSearchResponse,
  RawLocSearchResult,
} from './types.js';

const LOC_BASE = 'https://www.loc.gov';

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

function extractId(result: RawLocSearchResult): string {
  // LOC IDs come as full URLs like https://www.loc.gov/item/2009632251/
  // or as short strings like loc.pnp.ppmsc.02404. Item paths can be multi-segment
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
): LocPagination {
  // `results` is a display range string ("1 - 3") on every observed endpoint, so it can only
  // stand in for a missing `total` when LOC actually sends a number — a string would flow into
  // Math.ceil below and yield NaN pages.
  const total = raw?.total ?? (typeof raw?.results === 'number' ? raw.results : 0);
  const perPage = raw?.perpage ?? limit;
  const pages = raw?.pages ?? (total > 0 ? Math.ceil(total / perPage) : 1);
  const hasNext = page < pages;
  return { total, page, perPage, pages, hasNext };
}

export class LocApiService {
  private readonly userAgent: string;
  private readonly requestDelayMs: number;

  constructor(_config: AppConfig, _storage: StorageService) {
    const serverConfig = getServerConfig();
    this.userAgent = serverConfig.userAgent;
    this.requestDelayMs = serverConfig.requestDelayMs;
  }

  private checkRateLimit(): void {
    if (rateLimitBlockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((rateLimitBlockedUntil - Date.now()) / 60_000);
      throw rateLimited(
        `LOC API rate limit exceeded. Requests are blocked for approximately ${minutesLeft} more minute(s). Reduce request frequency to stay under 20 req/min.`,
        {
          reason: 'rate_limit_exceeded',
          blockedUntil: new Date(rateLimitBlockedUntil).toISOString(),
          recovery: {
            hint: 'Wait for the block to expire before retrying. Reduce the number of API calls per minute.',
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
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      signal: ctx.signal,
    });
    if (response.status === 429) {
      rateLimitBlockedUntil = Date.now() + 60 * 60 * 1000;
      throw rateLimited(
        'LOC API rate limit exceeded. Requests are blocked for approximately 1 hour. Reduce request frequency to stay under 20 req/min.',
        {
          reason: 'rate_limit_exceeded',
          recovery: {
            hint: 'Wait at least 1 hour before retrying. Reduce request frequency to stay under 20 req/min.',
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

  private async fetchJson<T>(url: string, ctx: Context): Promise<T> {
    const response = await this.fetch(url, ctx);
    if (response.status === 404) {
      throw notFound('LOC resource not found', { url });
    }
    const text = await response.text();
    if (HTML_RESPONSE_RE.test(text)) {
      throw serviceUnavailable(
        'LOC API returned HTML — may be rate-limited or temporarily unavailable.',
        { url },
      );
    }
    return JSON.parse(text) as T;
  }

  /**
   * Fetch a LOC search endpoint, treating HTTP 400 and 520 as out-of-range page responses
   * (LOC returns these for page numbers beyond the result set).
   * Returns null when the page is out of range.
   */
  private async fetchSearchJson<T>(url: string, ctx: Context): Promise<T | null> {
    const response = await this.fetch(url, ctx, { allowStatus: [400, 520] });
    if (response.status === 404) {
      throw notFound('LOC resource not found', { url });
    }
    // LOC returns 400 or 520 for out-of-range page numbers — treat as empty
    if (response.status === 400 || response.status === 520) {
      ctx.log.debug('LOC search returned out-of-range page', { status: response.status, url });
      return null;
    }
    const text = await response.text();
    if (HTML_RESPONSE_RE.test(text)) {
      throw serviceUnavailable(
        'LOC API returned HTML — may be rate-limited or temporarily unavailable.',
        { url },
      );
    }
    return JSON.parse(text) as T;
  }

  /**
   * Search LOC digital collections.
   *
   * `collectionSlug` scopes the search to one curated collection via its own endpoint, which
   * accepts the same query string and returns the same envelope as /search/. It selects a base
   * path, so it cannot combine with `format` — callers pick one (the search tool rejects the
   * pair up front). An unrecognized slug 404s, surfacing as NotFound from fetchSearchJson.
   */
  async search(
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

    const url = `${endpoint}?${qs}`;
    const data = await this.fetchSearchJson<RawLocSearchResponse>(url, ctx);
    if (data === null) {
      // LOC returned 400/520 — page is out of range.
      // Return pages: 0 as a sentinel so handlers can emit a distinct message.
      return {
        items: [],
        pagination: { total: 0, page, perPage: limit, pages: 0, hasNext: false },
      };
    }
    const rawResults = data.results ?? data.content?.results ?? [];
    const rawPagination = data.pagination ?? data.content?.pagination;
    const items = rawResults.map(normalizeSearchResult);
    return { items, pagination: normalizePagination(rawPagination, page, limit) };
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

    const relatedItems: string[] = [];
    for (const rel of data.related_items ?? []) {
      if (rel.id) relatedItems.push(rel.id);
      else if (rel.url) relatedItems.push(rel.url);
    }
    relatedItems.push(...(item.related_items ?? []));

    const rawRights = item.rights_information ?? item.rights;
    const rights = Array.isArray(rawRights) ? rawRights.join(' ') : rawRights;

    return {
      item_id: itemId,
      title,
      ...(item.date && { date: item.date }),
      contributors: extractStringArray(item.contributor),
      subject_headings: extractStringArray(item.subject),
      notes: extractStringArray(item.notes),
      ...(rights && { rights_information: rights }),
      ...(physDesc && { physical_description: physDesc }),
      resource_links: [...new Set(resourceLinks)],
      related_items: [...new Set(relatedItems)],
      // Normalize protocol-relative urls (//lccn.loc.gov/...) to https:, matching
      // normalizeSearchResult — LOC returns these for some items (e.g. LCCN records).
      url: normalizeUrl(item.url ?? `${LOC_BASE}/item/${itemId}/`),
    };
  }

  /** Search historical newspaper pages via the /newspapers/ endpoint */
  async searchNewspapers(
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
    const data = await this.fetchSearchJson<RawLocSearchResponse>(url, ctx);
    if (data === null) {
      return {
        items: [],
        pagination: { total: 0, page, perPage: limit, pages: 0, hasNext: false },
      };
    }
    const rawResults = data.results ?? data.content?.results ?? [];
    const rawPagination = data.pagination ?? data.content?.pagination;

    const items: LocNewspaperPage[] = rawResults.map((r) => {
      const descArr = Array.isArray(r.description)
        ? r.description
        : r.description
          ? [r.description]
          : [];
      const description = descArr.slice(0, 3).join(' ').substring(0, 500);
      // partof_title holds the canonical publication title for Chronicling America pages.
      // Fall back to last entry of partof if partof_title absent.
      const rawTitle =
        extractFirstString(r.partof_title) ??
        (Array.isArray(r.partof) ? r.partof[r.partof.length - 1] : r.partof);
      // location_state is the US state; location[0] is often a city or "united states".
      const rawState = extractFirstString(r.location_state) ?? extractFirstString(r.location);
      return {
        url: r.url ?? '',
        title: extractFirstString(r.title) ?? 'Untitled',
        ...(description && { description }),
        ...(r.date && { date: r.date }),
        ...(rawState && { state: rawState }),
        ...(rawTitle && { newspaper_title: rawTitle }),
      };
    });

    return { items, pagination: normalizePagination(rawPagination, page, limit) };
  }

  /** Retrieve full OCR text for a specific newspaper page via its resource URL */
  async getNewspaperPage(pageUrl: string, ctx: Context): Promise<LocNewspaperPageDetail> {
    // Strip search-specific params (q=) that LOC echoes into fulltext_file URLs,
    // causing tile.loc.gov OCR requests to 404. Keep sp= (selects the page within a resource).
    const parsed = new URL(pageUrl);
    parsed.searchParams.delete('q');
    const cleanUrl = parsed.toString();

    const resourceUrl = cleanUrl.includes('?')
      ? `${cleanUrl}&fo=json&at=resource`
      : `${cleanUrl}?fo=json&at=resource`;

    const resourceData = await this.fetchJson<{
      resource?: {
        url?: string;
        title?: string;
        date_issued?: string;
        note?: string[];
        part_of?: string;
        sequence?: number;
        fulltext_file?: string;
      };
    }>(resourceUrl, ctx);

    const res = resourceData.resource;
    if (!res) {
      throw notFound(`LOC newspaper page not found: ${pageUrl}`, { pageUrl });
    }

    const title = res.title;
    const dateIssued = res.date_issued;
    const sequence = res.sequence;

    // The ?fo=json&at=resource endpoint structurally omits date_issued/sequence, but both are
    // encoded in the page URL: the date is the path segment after the LCCN, the sequence is the
    // `sp` param. Derive them as fallbacks so a real upstream value still wins if LOC adds one.
    const urlDate = parsed.pathname.split('/').find((seg) => /^\d{4}-\d{2}-\d{2}$/.test(seg));
    const spParam = parsed.searchParams.get('sp');
    const urlSequence =
      spParam && /^\d+$/.test(spParam) && Number(spParam) > 0 ? Number(spParam) : undefined;

    // part_of is like "Oklahoma newspapers" — extract the state name if present
    let state: string | undefined;
    const partOf = res.part_of;
    if (partOf) {
      const stateMatch = partOf.match(/^([A-Za-z ]+)\s+newspapers?/i);
      if (stateMatch?.[1]) state = stateMatch[1].trim();
    }

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
        const textResponse = await fetch(textUrl, {
          headers: { 'User-Agent': this.userAgent },
          signal: ctx.signal,
        });
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

    const date = dateIssued ?? urlDate;
    const seq = sequence ?? urlSequence;

    return {
      page_url: pageUrl,
      ...(title && { newspaper_title: title }),
      ...(date && { date }),
      ...(state && { state }),
      ...(res.part_of && { edition: res.part_of }),
      ...(seq !== undefined && { sequence: seq }),
      ocr_text: ocrText,
      ocr_available: ocrAvailable,
    };
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
    const limit = Math.min(params.limit ?? 25, 100);
    const page = params.page ?? 1;
    const qs = new URLSearchParams({ fo: 'json', at: 'results,pagination' });
    qs.set('c', String(limit));
    qs.set('sp', String(page));
    if (params.query) qs.set('q', params.query);

    const url = `${LOC_BASE}/collections/?${qs}`;
    const data = await this.fetchSearchJson<RawLocSearchResponse>(url, ctx);
    if (data === null) {
      return {
        items: [],
        pagination: { total: 0, page, perPage: limit, pages: 0, hasNext: false },
      };
    }
    const rawResults = data.results ?? data.content?.results ?? [];
    const rawPagination = data.pagination ?? data.content?.pagination;

    const items: LocCollection[] = rawResults.map((r) => {
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

    return { items, pagination: normalizePagination(rawPagination, page, limit) };
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
