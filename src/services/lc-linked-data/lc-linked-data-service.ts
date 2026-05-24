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
    const qs = new URLSearchParams({
      q: query,
      memberOf: SUBJECTS_SCHEME,
      count: String(Math.min(limit, 50)),
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
      const countStr = counts[i];
      const count = countStr ? parseInt(countStr, 10) : undefined;
      results.push({
        label,
        uri,
        ...(count !== undefined && !Number.isNaN(count) && { count }),
      });
    }
    return results;
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
