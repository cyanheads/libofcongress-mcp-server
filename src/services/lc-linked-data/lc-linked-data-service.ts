/**
 * @fileoverview LC Linked Data service — wraps id.loc.gov for LCSH subject heading lookups.
 * @module services/lc-linked-data/lc-linked-data-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { getServerConfig } from '@/config/server-config.js';
import type { LcSubjectHeading } from './types.js';

const LC_LINKED_DATA_BASE = 'https://id.loc.gov';
const SUBJECTS_SCHEME = 'http://id.loc.gov/authorities/subjects';

/**
 * Response shape from the id.loc.gov suggest endpoint:
 * [query, labels[], counts[], uris[]]
 */
type SuggestResponse = [string, string[], string[], string[]];

export class LcLinkedDataService {
  private readonly userAgent: string;

  constructor(_config: AppConfig, _storage: StorageService) {
    const serverConfig = getServerConfig();
    this.userAgent = serverConfig.userAgent;
  }

  /** Search LCSH subject headings via the suggest endpoint */
  async searchSubjects(query: string, limit: number, ctx: Context): Promise<LcSubjectHeading[]> {
    // `memberOf` is an unenforced hint: the suggest endpoint interleaves /authorities/names/
    // and childrensSubjects records with real LCSH headings. We drop the non-subject records
    // below, so over-fetch (bounded by the endpoint's 50-suggestion cap) to reduce the chance
    // a names-heavy response yields fewer than `limit` headings after filtering.
    const qs = new URLSearchParams({
      q: query,
      memberOf: SUBJECTS_SCHEME,
      count: String(Math.min(limit * 3, 50)),
    });
    const url = `${LC_LINKED_DATA_BASE}/suggest/?${qs}`;
    ctx.log.debug('LC Linked Data subject suggest', { url });

    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      signal: ctx.signal,
    });
    if (!response.ok) {
      throw serviceUnavailable(`LC Linked Data returned HTTP ${response.status}`, {
        url,
        status: response.status,
      });
    }

    const text = await response.text();
    if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
      throw serviceUnavailable('LC Linked Data returned HTML — temporarily unavailable.', { url });
    }

    const data = JSON.parse(text) as SuggestResponse;
    if (!Array.isArray(data) || data.length < 4) {
      return [];
    }

    const [, labels, counts, uris] = data;
    const results: LcSubjectHeading[] = [];
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      const uri = uris[i];
      if (!label || !uri) continue;
      // Keep only true LCSH subject headings. Name-authority and childrensSubjects labels are
      // not valid input for the `fa=subject:<value>` filter these results feed downstream.
      if (!uri.startsWith(`${SUBJECTS_SCHEME}/`)) continue;
      const countStr = counts[i];
      const count = countStr ? parseInt(countStr, 10) : undefined;
      results.push({
        label,
        uri,
        ...(count !== undefined && !Number.isNaN(count) && { count }),
      });
    }
    return results.slice(0, limit);
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
