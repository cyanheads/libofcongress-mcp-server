/**
 * @fileoverview LC Linked Data service — wraps id.loc.gov for LCSH subject heading lookups.
 * @module services/lc-linked-data/lc-linked-data-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { getServerConfig } from '@/config/server-config.js';
import {
  LOC_CALL_BUDGET_MS,
  readText,
  retryWithinBudget,
  UPSTREAM_UNAVAILABLE,
} from '@/services/http.js';
import type { LcSubjectHeading } from './types.js';

/** The subject-scoped suggest endpoint: every hit is an `/authorities/subjects/` record. */
const SUGGEST2_URL = 'https://id.loc.gov/authorities/subjects/suggest2/';

const UPSTREAM = 'The Library of Congress subject heading service';

/**
 * Fewest headings requested from suggest2, whatever `limit` asks for. The exact-label promotion
 * can only lift a heading the page holds, and keyword ranking can put the exact heading well past
 * a small limit (`civil war` → `Civil war` near 10th). id.loc.gov is fast and off the www.loc.gov
 * request queue, so the larger page costs little.
 */
const MIN_SUGGEST_COUNT = 50;

/** One hit of a suggest2 page. Only the fields this service reads are typed. */
interface Suggest2Hit {
  /**
   * The authorized heading. A left-anchored cross-reference matches on a variant, so its
   * `suggestLabel` reads `<variant> (USE <heading>)` while `aLabel` is the heading itself.
   */
  aLabel?: string;
  uri?: string;
}

/**
 * A suggest2 page: `{ q, count, pagesize, start, sortmethod, searchtype, directory, hits[] }`.
 * `count` is the total number of matching subject authority records, not the page size.
 */
interface Suggest2Page {
  count: number;
  hits: Suggest2Hit[];
}

/** Outcome of a subject-heading search. */
export interface SubjectSuggestResult {
  /** Upstream total of matching subject headings — more than `subjects.length` means truncation. */
  matchCount: number;
  /** LCSH subject headings, at most the requested `limit`, an exact-label match first. */
  subjects: LcSubjectHeading[];
}

export class LcLinkedDataService {
  private readonly userAgent: string;

  constructor(_config: AppConfig, _storage: StorageService) {
    const serverConfig = getServerConfig();
    this.userAgent = serverConfig.userAgent;
  }

  /**
   * Search LCSH subject headings. A keyword search ranks base headings such as
   * `World War, 1939-1945` at or near the top; a partial word (`aerial photog`) matches nothing by
   * keyword, so a zero-hit keyword search is retried once left-anchored. Both requests share the
   * call's one time budget. Each asks for at least {@link MIN_SUGGEST_COUNT} headings so an exact
   * label ranked past `limit` can still be promoted; the result is then cut to `limit`.
   */
  async searchSubjects(query: string, limit: number, ctx: Context): Promise<SubjectSuggestResult> {
    const deadlineAt = Date.now() + LOC_CALL_BUDGET_MS;
    const count = Math.max(limit, MIN_SUGGEST_COUNT);
    let page = await this.suggest({ q: query, searchtype: 'keyword', count }, ctx, deadlineAt);
    if (page.hits.length === 0) {
      // Omitting `searchtype` selects the endpoint's left-anchored search.
      page = await this.suggest({ q: query, count }, ctx, deadlineAt);
    }

    const subjects: LcSubjectHeading[] = [];
    for (const hit of page.hits) {
      // `aLabel` is the authorized heading — the value the item search's subject filter accepts.
      if (hit.aLabel && hit.uri) subjects.push({ label: hit.aLabel, uri: hit.uri });
    }
    const wanted = query.trim().toLowerCase();
    const exact = subjects.findIndex((s) => s.label.toLowerCase() === wanted);
    if (exact > 0) subjects.unshift(...subjects.splice(exact, 1));

    return { subjects: subjects.slice(0, limit), matchCount: page.count };
  }

  private async suggest(
    params: { q: string; searchtype?: 'keyword'; count: number },
    ctx: Context,
    deadlineAt: number,
  ): Promise<Suggest2Page> {
    const qs = new URLSearchParams({
      q: params.q,
      ...(params.searchtype && { searchtype: params.searchtype }),
      count: String(params.count),
    });
    const url = `${SUGGEST2_URL}?${qs}`;
    ctx.log.debug('LC Linked Data subject suggest', { url });

    // Retry raw network faults only, inside the call's one time budget. The non-OK and HTML throws
    // below are ServiceUnavailable, which the predicate treats as non-transient — they fail fast.
    // Every outage shape carries the upstream_unavailable reason the tool declares.
    const data = await retryWithinBudget(
      async ({ signal }) => {
        const response = await fetch(url, {
          headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
          signal,
        });
        if (!response.ok) {
          // The request `url` carries the caller's query in its string — withhold it from error
          // data (it stays in the debug log above), matching the loc-api service's no-internal-URL
          // invariant. Bare status is safe.
          throw serviceUnavailable(`LC Linked Data returned HTTP ${response.status}`, {
            status: response.status,
            reason: UPSTREAM_UNAVAILABLE,
          });
        }
        const text = await readText(response, signal);
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable('LC Linked Data returned HTML — temporarily unavailable.', {
            reason: UPSTREAM_UNAVAILABLE,
          });
        }
        return JSON.parse(text) as unknown;
      },
      { ctx, operation: 'lc-linked-data-suggest', deadlineAt, upstream: UPSTREAM },
    );

    if (!isSuggest2Page(data)) {
      throw serviceUnavailable(`${UPSTREAM} returned an unexpected response.`, {
        reason: UPSTREAM_UNAVAILABLE,
      });
    }
    return data;
  }
}

function isSuggest2Page(data: unknown): data is Suggest2Page {
  if (typeof data !== 'object' || data === null) return false;
  const page = data as Record<string, unknown>;
  return typeof page.count === 'number' && Array.isArray(page.hits);
}

// --- Init/accessor pattern ---

let _service: LcLinkedDataService | undefined;

export function initLcLinkedDataService(config: AppConfig, storage: StorageService): void {
  _service = new LcLinkedDataService(config, storage);
}

export function getLcLinkedDataService(): LcLinkedDataService {
  if (!_service) {
    throw new Error(
      'LcLinkedDataService not initialized — call initLcLinkedDataService() in setup()',
    );
  }
  return _service;
}
