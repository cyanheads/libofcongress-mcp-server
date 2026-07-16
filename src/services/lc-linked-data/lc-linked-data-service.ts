/**
 * @fileoverview LC Linked Data service — wraps id.loc.gov for LCSH subject heading lookups.
 * @module services/lc-linked-data/lc-linked-data-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { withRetry } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';
import { locRetryOptions, timedFetch } from '@/services/http.js';
import type { LcSubjectHeading } from './types.js';

const LC_LINKED_DATA_BASE = 'https://id.loc.gov';
const SUBJECTS_SCHEME = 'http://id.loc.gov/authorities/subjects';

/**
 * Hard ceiling on candidates the id.loc.gov `/suggest/` endpoint returns for any query.
 * Requested on every call regardless of `limit`: the endpoint ranks name-authority and other
 * non-subject records ahead of real LCSH headings, so a valid heading can sit deep in this pool.
 * A limit-scaled request size would miss it and report a false empty (issue #25).
 */
export const SUGGEST_MAX_COUNT = 50;

/**
 * Response shape from the id.loc.gov suggest endpoint:
 * [query, labels[], counts[], uris[]]
 */
type SuggestResponse = [string, string[], string[], string[]];

/** Outcome of a subject-heading search, carrying the disclosure signal the tool turns into recovery hints. */
export interface SubjectSuggestResult {
  /**
   * Count of subject-namespace matches before slicing to `limit`. Greater than `limit` means more
   * headings exist within the candidate pool — the tool surfaces a truncation hint.
   */
  matchCount: number;
  /**
   * True when the endpoint returned its full {@link SUGGEST_MAX_COUNT} candidate cap, so a matching
   * heading may rank beyond the visible pool. Lets the tool distinguish "exhausted by ranking"
   * (recoverable via a more specific query) from "no LCSH coverage" when results are empty or short.
   */
  poolCapReached: boolean;
  /** LCSH subject headings, filtered to the `/authorities/subjects/` namespace and sliced to `limit`. */
  subjects: LcSubjectHeading[];
}

export class LcLinkedDataService {
  private readonly userAgent: string;

  constructor(_config: AppConfig, _storage: StorageService) {
    const serverConfig = getServerConfig();
    this.userAgent = serverConfig.userAgent;
  }

  /** Search LCSH subject headings via the suggest endpoint */
  async searchSubjects(query: string, limit: number, ctx: Context): Promise<SubjectSuggestResult> {
    // Request the endpoint's full candidate cap regardless of `limit`. `memberOf` is an unenforced
    // hint — /suggest/ interleaves /authorities/names/ and childrensSubjects records with real LCSH
    // headings and ranks them ahead, so a valid heading can sit deep in the pool. Decoupling request
    // size from `limit` means a small and a large `limit` draw from the same pool and differ only in
    // how many filtered results get sliced off (issue #25).
    const qs = new URLSearchParams({
      q: query,
      memberOf: SUBJECTS_SCHEME,
      count: String(SUGGEST_MAX_COUNT),
    });
    const url = `${LC_LINKED_DATA_BASE}/suggest/?${qs}`;
    ctx.log.debug('LC Linked Data subject suggest', { url });

    // Retry the transient-network class only, with a timeout ceiling. The non-OK and HTML throws
    // below are ServiceUnavailable, which the predicate treats as non-transient — they fail fast.
    const data = await withRetry(
      async () => {
        const response = await timedFetch(
          url,
          { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } },
          ctx,
        );
        if (!response.ok) {
          // The request `url` carries the caller's query in its string — withhold it from error
          // data (it stays in the debug log above), matching the loc-api service's no-internal-URL
          // invariant. Bare status is safe.
          throw serviceUnavailable(`LC Linked Data returned HTTP ${response.status}`, {
            status: response.status,
          });
        }
        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable('LC Linked Data returned HTML — temporarily unavailable.');
        }
        return JSON.parse(text) as SuggestResponse;
      },
      locRetryOptions(ctx, 'lc-linked-data-suggest'),
    );

    if (!Array.isArray(data) || data.length < 4) {
      return { subjects: [], matchCount: 0, poolCapReached: false };
    }

    const [, labels, counts, uris] = data;
    const matches: LcSubjectHeading[] = [];
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const uri = uris[i];
      if (!label || !uri) continue;
      // Keep only true LCSH subject headings. Name-authority and childrensSubjects labels are
      // not valid input for the `fa=subject:<value>` filter these results feed downstream.
      if (!uri.startsWith(`${SUBJECTS_SCHEME}/`)) continue;
      const countStr = counts[i];
      const count = countStr ? parseInt(countStr, 10) : undefined;
      matches.push({
        label,
        uri,
        ...(count !== undefined && !Number.isNaN(count) && { count }),
      });
    }

    return {
      subjects: matches.slice(0, limit),
      matchCount: matches.length,
      // Endpoint returned its cap → matching headings may exist beyond what it will surface.
      poolCapReached: labels.length >= SUGGEST_MAX_COUNT,
    };
  }
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
