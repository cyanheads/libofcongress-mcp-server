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
const TILE_BASE = 'https://tile.loc.gov';

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
  // or as short strings like loc.pnp.ppmsc.02404
  const rawId = result.id ?? result.url ?? '';
  // Strip URL to just the path component's last segment
  const urlMatch = rawId.match(/\/item\/([^/]+)\/?$/);
  if (urlMatch?.[1]) return urlMatch[1];
  return rawId.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '');
}

function normalizeSearchResult(result: RawLocSearchResult): LocItemSummary {
  const title = extractFirstString(result.title) ?? 'Untitled';
  const description = Array.isArray(result.description)
    ? result.description.join(' ')
    : result.description;
  const format = (result.original_format ?? result.online_format ?? [])[0] ?? undefined;
  const id = extractId(result);
  const url = result.url ?? `${LOC_BASE}/item/${id}/`;
  return {
    id,
    title,
    ...(result.date && { date: result.date }),
    ...(description && { description }),
    ...(format && { format }),
    url,
  };
}

function normalizePagination(
  raw: RawLocPagination | undefined,
  page: number,
  limit: number,
): LocPagination {
  const total = raw?.total ?? raw?.results ?? 0;
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

  private async fetch(url: string, ctx: Context): Promise<Response> {
    this.checkRateLimit();
    await pace(this.requestDelayMs);
    ctx.log.debug('LOC API request', { url });
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      signal: ctx.signal,
    });
    if (response.status === 429) {
      // Block for 1 hour
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
    if (!response.ok) {
      throw serviceUnavailable(`LOC API returned HTTP ${response.status}`, {
        url,
        status: response.status,
      });
    }
    return response;
  }

  private async fetchJson<T>(url: string, ctx: Context): Promise<T> {
    const response = await this.fetch(url, ctx);
    if (response.status === 404) {
      throw notFound(`LOC resource not found: ${url}`, { url });
    }
    const text = await response.text();
    if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
      throw serviceUnavailable(
        'LOC API returned HTML — may be rate-limited or temporarily unavailable.',
        { url },
      );
    }
    return JSON.parse(text) as T;
  }

  /** Search LOC digital collections */
  async search(
    params: {
      query: string;
      format?: string;
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
    const endpoint = formatSlug ? `${LOC_BASE}/${formatSlug}/` : `${LOC_BASE}/search/`;

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
    const data = await this.fetchJson<RawLocSearchResponse>(url, ctx);
    const rawResults = data.results ?? data.content?.results ?? [];
    const rawPagination = data.pagination ?? data.content?.pagination;
    const items = rawResults.map(normalizeSearchResult);
    return { items, pagination: normalizePagination(rawPagination, page, limit) };
  }

  /** Get full metadata for a single LOC item */
  async getItem(itemId: string, ctx: Context): Promise<LocItemDetail> {
    const url = `${LOC_BASE}/item/${encodeURIComponent(itemId)}/?fo=json&at=item,resources,related_items`;
    const data = await this.fetchJson<RawLocItemResponse>(url, ctx);
    const item = data.item;
    if (!item) {
      throw notFound(`LOC item not found: ${itemId}`, { itemId, reason: 'item_not_found' });
    }
    const title = extractFirstString(item.title) ?? 'Untitled';
    const physDesc = extractFirstString(item.physical_description ?? item.medium);

    // Collect resource links: flatten nested file arrays
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
    // Also check item.related_items
    relatedItems.push(...(item.related_items ?? []));

    const rights = item.rights_information ?? item.rights;

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
      url: item.url ?? `${LOC_BASE}/item/${itemId}/`,
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
    const data = await this.fetchJson<RawLocSearchResponse>(url, ctx);
    const rawResults = data.results ?? data.content?.results ?? [];
    const rawPagination = data.pagination ?? data.content?.pagination;

    const items: LocNewspaperPage[] = rawResults.map((r) => {
      const descArr = Array.isArray(r.description)
        ? r.description
        : r.description
          ? [r.description]
          : [];
      const description = descArr.slice(0, 3).join(' ').substring(0, 500);
      return {
        url: r.url ?? '',
        title: extractFirstString(r.title) ?? 'Untitled',
        ...(description && { description }),
        ...(r.date && { date: r.date }),
        ...(r.location?.[0] && { state: r.location[0] }),
        ...(r.subject?.[0] && { newspaper_title: r.subject[0] }),
      };
    });

    return { items, pagination: normalizePagination(rawPagination, page, limit) };
  }

  /** Retrieve full OCR text for a specific newspaper page via its resource URL */
  async getNewspaperPage(pageUrl: string, ctx: Context): Promise<LocNewspaperPageDetail> {
    // The page URL is like https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/?fo=json
    // We need to fetch the resource endpoint to get fulltext_file
    const resourceUrl = pageUrl.includes('?')
      ? `${pageUrl}&fo=json&at=resource`
      : `${pageUrl}?fo=json&at=resource`;

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
      throw notFound(`LOC newspaper page not found: ${pageUrl}`, {
        pageUrl,
        reason: 'page_not_found',
      });
    }

    // Extract metadata
    const title = res.title;
    const dateIssued = res.date_issued;
    const sequence = res.sequence;

    // Try to get state from part_of or notes
    let state: string | undefined;
    const partOf = res.part_of;
    if (partOf) {
      // part_of is like "Oklahoma newspapers" or a title string
      const stateMatch = partOf.match(/^([A-Za-z ]+)\s+newspapers?/i);
      if (stateMatch?.[1]) state = stateMatch[1].trim();
    }

    // Fetch full OCR text if fulltext_file is available
    let ocrText = '';
    let ocrAvailable = false;

    if (res.fulltext_file) {
      ocrAvailable = true;
      try {
        const textUrl = `${TILE_BASE}/text-services/word-coordinates-service?segment=${encodeURIComponent(res.fulltext_file)}&format=alto_xml&full_text=1`;
        ctx.log.debug('Fetching OCR text', { textUrl: res.fulltext_file });
        const textResponse = await fetch(textUrl, {
          headers: { 'User-Agent': this.userAgent },
          signal: ctx.signal,
        });
        if (textResponse.ok) {
          const altoXml = await textResponse.text();
          // Extract plain text from ALTO XML <String CONTENT="..."> attributes
          ocrText =
            altoXml
              .match(/CONTENT="([^"]*)"/g)
              ?.map((m) => m.slice(9, -1))
              .join(' ') ?? '';
        } else {
          // OCR service unavailable — return empty text, still mark as available
          ctx.log.warning('OCR text service returned error', {
            status: textResponse.status,
            url: res.fulltext_file,
          });
        }
      } catch (err) {
        ctx.log.warning('OCR text fetch failed', { error: String(err) });
      }
    }

    return {
      page_url: pageUrl,
      ...(title && { newspaper_title: title }),
      ...(dateIssued && { date: dateIssued }),
      ...(state && { state }),
      ...(res.part_of && { edition: res.part_of }),
      ...(sequence !== undefined && { sequence }),
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
    const data = await this.fetchJson<RawLocSearchResponse>(url, ctx);
    const rawResults = data.results ?? data.content?.results ?? [];
    const rawPagination = data.pagination ?? data.content?.pagination;

    const items: LocCollection[] = rawResults.map((r) => {
      const title = extractFirstString(r.title) ?? 'Untitled';
      const description = Array.isArray(r.description) ? r.description.join(' ') : r.description;
      const itemUrl = r.url ?? '';
      // Extract slug from URL: https://www.loc.gov/collections/civil-war-glass-negatives/ → civil-war-glass-negatives
      const slugMatch = itemUrl.match(/\/collections\/([^/]+)\/?$/);
      const slug = slugMatch?.[1] ?? title.toLowerCase().replace(/\s+/g, '-');
      return {
        slug,
        title,
        ...(description && { description }),
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
