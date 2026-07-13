/**
 * @fileoverview libofcongress_browse_collections tool — list and browse LOC curated digital collections.
 * @module mcp-server/tools/definitions/libofcongress-browse-collections.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';

export const locBrowseCollections = tool('libofcongress_browse_collections', {
  title: 'Browse LOC Collections',
  description:
    'List and browse Library of Congress curated digital collections. Returns collection names, descriptions, item counts, slugs, and URLs. Optionally filter by keyword. Collections are curated subsets of the digital holdings with specific focuses (e.g., "Civil War Glass Negatives", "Baseball Cards", "WPA Posters"). Use the returned URL to navigate directly to a collection on loc.gov.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    query: z
      .string()
      .optional()
      .describe(
        'Optional keyword to filter collections by name or description. Omit to list all collections.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe('Maximum number of collections to return. Default 25, max 100.'),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('1-indexed page number for paginating results.'),
  }),
  output: z.object({
    collections: z
      .array(
        z
          .object({
            slug: z
              .string()
              .describe('Collection URL slug — identifies the collection within loc.gov URLs.'),
            title: z.string().describe('Collection name.'),
            description: z
              .string()
              .optional()
              .describe("Description of the collection's scope and contents."),
            item_count: z
              .number()
              .optional()
              .describe(
                'Approximate number of items in this collection. Omitted when unavailable.',
              ),
            url: z.string().describe('Collection URL on loc.gov.'),
          })
          .describe('A single LOC curated digital collection.'),
      )
      .describe(
        'LOC curated collections matching the keyword filter, or all collections when no keyword is specified.',
      ),
    total: z.number().describe('Total number of matching collections across all pages.'),
    page: z.number().describe('Current 1-indexed page number.'),
    pages: z.number().describe('Total number of pages available.'),
    has_next: z.boolean().describe('True when more pages are available after this one.'),
  }),

  // Agent-facing success-path context — result count and empty-result guidance. Reaches
  // both structuredContent and content[] automatically; kept out of the domain output.
  // No effectiveQuery: query is optional (browse-all default) so the echo is N/A when absent.
  // Keys are disjoint from output (total vs totalCount).
  enrichment: {
    totalCount: z
      .number()
      .describe('Total matching collections — mirrors output.total for agent reasoning.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty or a page is out of range — suggests broadening the keyword or removing filters. Absent on successful result pages.',
      ),
  },

  errors: [
    {
      reason: 'rate_limit_exceeded',
      code: JsonRpcErrorCode.RateLimited,
      retryable: false,
      when: 'LOC API rate limit exceeded; requests are blocked for approximately 1 hour.',
      recovery:
        'Wait approximately 1 hour before retrying. Reduce request frequency to stay under 20 req/min.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('libofcongress_browse_collections', { query: input.query, page: input.page });
    const svc = getLocApiService();
    let result: Awaited<ReturnType<typeof svc.browseCollections>>;
    try {
      result = await svc.browseCollections(
        {
          ...(input.query?.trim() && { query: input.query.trim() }),
          limit: input.limit,
          page: input.page,
        },
        ctx,
      );
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.RateLimited) {
        throw ctx.fail('rate_limit_exceeded', err.message);
      }
      throw err;
    }

    const { total, page, pages, hasNext } = result.pagination;

    // Mirror the upstream total for agent reasoning. The empty-result branches below return
    // total: 0 and re-enrich with 0 so totalCount never contradicts the returned total — LOC
    // reports a nonzero pagination.total even for no-match keywords. Last write wins.
    ctx.enrich.total(total);

    if (result.items.length === 0) {
      // Out-of-range page: service returned null (LOC 400) — pages is 0 here.
      // Distinguish from a genuine empty result by checking page > 1.
      if (page > 1 && pages === 0) {
        ctx.enrich.notice(`Page ${page} is out of range. Try a smaller page number.`);
        ctx.enrich.total(0);
        return { collections: [], total: 0, page, pages: 0, has_next: false };
      }
      ctx.enrich.notice(
        input.query
          ? `No collections matched "${input.query}". Try a broader keyword or call without a query to list all LOC digital collections.`
          : 'No collections found. The LOC collections endpoint may be temporarily unavailable.',
      );
      ctx.enrich.total(0);
      return { collections: [], total: 0, page, pages: 0, has_next: false };
    }

    // Detect contradictory pagination: LOC sometimes returns items on out-of-range pages.
    if (pages > 0 && page > pages) {
      ctx.enrich.notice(
        `No results on page ${page} — there are ${pages} page(s) total (${total} collections). Use a page number between 1 and ${pages}.`,
      );
      return { collections: [], total, page, pages, has_next: false };
    }

    return {
      collections: result.items,
      total,
      page,
      pages,
      has_next: hasNext,
    };
  },

  format: (result) => {
    const lines: string[] = [];
    lines.push(
      `**Total:** ${result.total} | **Page:** ${result.page} of ${result.pages} | **has_next:** ${result.has_next}`,
    );
    for (const col of result.collections) {
      lines.push(`\n## ${col.title}`);
      lines.push(`**Slug:** ${col.slug}`);
      if (col.item_count !== undefined) lines.push(`**Items:** ${col.item_count}`);
      if (col.description) lines.push(col.description);
      lines.push(`**URL:** ${col.url}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
