/**
 * @fileoverview libofcongress_search tool — search Library of Congress digital collections.
 * @module mcp-server/tools/definitions/libofcongress-search.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError, validationError } from '@cyanheads/mcp-ts-core/errors';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';

export const locSearch = tool('libofcongress_search', {
  title: 'Search LOC Collections',
  description:
    'Search the Library of Congress digital collections by keyword. Optionally filter by material format (photos, maps, newspapers, audio, etc.), date range, subject heading, or geographic location. Returns item summaries with titles, dates, descriptions, LOC IDs, and format tags. Use libofcongress_get_item to retrieve full metadata for a specific result. Use libofcongress_search_subjects first to find the exact LCSH heading spelling before applying a subject filter.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe('Full-text search across metadata and available descriptive text.'),
    format: z
      .enum(['photo', 'map', 'newspaper', 'manuscript', 'audio', 'film', 'book', 'notated-music'])
      .optional()
      .describe(
        'Material type filter. Options: photo, map, newspaper, manuscript, audio, film, book, notated-music. Omit to search all formats.',
      ),
    date_start: z
      .number()
      .int()
      .optional()
      .describe('Start year for date filter, inclusive (e.g., 1920). Omit for no lower bound.'),
    date_end: z
      .number()
      .int()
      .optional()
      .describe('End year for date filter, inclusive (e.g., 1930). Omit for no upper bound.'),
    subject: z
      .string()
      .optional()
      .describe(
        'Subject heading filter. Use the exact label from libofcongress_search_subjects results for best precision. Example: "World War, 1939-1945".',
      ),
    location: z
      .string()
      .optional()
      .describe(
        'Geographic location filter (e.g., "oklahoma", "washington d.c."). Lowercase, matches LOC location facets.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe('Results per page. Default 25, max 100.'),
    page: z
      .number()
      .int()
      .min(1)
      .default(1)
      .describe('1-indexed page number for paginating results.'),
  }),
  output: z.object({
    items: z
      .array(
        z
          .object({
            id: z
              .string()
              .describe('LOC item ID — pass to libofcongress_get_item for full metadata.'),
            title: z.string().describe('Item title.'),
            date: z.string().optional().describe('Publication or creation date.'),
            description: z.string().optional().describe('Brief description or summary.'),
            format: z
              .string()
              .optional()
              .describe('Material format (e.g., photo, map, manuscript).'),
            url: z.string().describe('LOC item URL.'),
          })
          .describe('A single LOC item summary.'),
      )
      .describe('Item summaries matching the search query and filters.'),
    total: z.number().describe('Total number of matching items across all pages.'),
    page: z.number().describe('Current 1-indexed page number.'),
    pages: z.number().describe('Total number of pages available.'),
    has_next: z.boolean().describe('True when more pages are available after this one.'),
  }),

  // Agent-facing success-path context — query echo, result count, and empty-result
  // guidance. Reaches both structuredContent and content[] automatically; kept out of
  // the domain output. Keys are disjoint from output (total vs totalCount).
  enrichment: {
    effectiveQuery: z.string().describe('The query as submitted to the LOC API, after trimming.'),
    totalCount: z
      .number()
      .describe(
        'Total matching items across all pages — mirrors output.total for agent reasoning.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty or a page is out of range — echoes applied filters and suggests how to broaden. Absent on successful result pages.',
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
    ctx.log.info('libofcongress_search', {
      query: input.query,
      format: input.format,
      page: input.page,
    });

    if (
      input.date_start !== undefined &&
      input.date_end !== undefined &&
      input.date_start > input.date_end
    ) {
      throw validationError(
        `date_start (${input.date_start}) must be ≤ date_end (${input.date_end}). Reverse the values to form a valid date range.`,
        { field: 'date_start', date_start: input.date_start, date_end: input.date_end },
      );
    }

    const svc = getLocApiService();
    let result: Awaited<ReturnType<typeof svc.search>>;
    try {
      result = await svc.search(
        {
          query: input.query,
          ...(input.format !== undefined && { format: input.format }),
          ...(input.date_start !== undefined && { dateStart: input.date_start }),
          ...(input.date_end !== undefined && { dateEnd: input.date_end }),
          ...(input.subject?.trim() && { subject: input.subject.trim() }),
          ...(input.location?.trim() && { location: input.location.trim() }),
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

    ctx.enrich.echo(input.query);
    ctx.enrich.total(total);

    if (result.items.length === 0) {
      // pages === 0 is the sentinel for a LOC 400 (out-of-range page request).
      if (pages === 0 && page > 1) {
        ctx.enrich.notice(
          `Page ${page} is out of range for query "${input.query}". Try a smaller page number.`,
        );
        return { items: [], total: 0, page, pages: 0, has_next: false };
      }
      ctx.enrich.notice(
        `No items matched "${input.query}"` +
          (input.format ? ` with format "${input.format}"` : '') +
          (input.date_start || input.date_end
            ? ` in dates ${input.date_start ?? ''}–${input.date_end ?? ''}`
            : '') +
          '. Try broadening the query, widening the date range, or running libofcongress_search_subjects to find the exact subject heading.',
      );
      return { items: [], total: 0, page, pages: 0, has_next: false };
    }

    // Detect contradictory pagination: LOC sometimes returns items on out-of-range pages.
    // Surface a clear message rather than a confusing "Page 999 of 26" display.
    if (pages > 0 && page > pages) {
      ctx.enrich.notice(
        `No results on page ${page} — query has ${pages} page(s) total (${total} items). Use a page number between 1 and ${pages}.`,
      );
      return { items: [], total, page, pages, has_next: false };
    }

    return {
      items: result.items,
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
    for (const item of result.items) {
      lines.push(`\n## ${item.title}`);
      lines.push(`**ID:** ${item.id}`);
      if (item.date) lines.push(`**Date:** ${item.date}`);
      if (item.format) lines.push(`**Format:** ${item.format}`);
      if (item.description) lines.push(item.description);
      lines.push(`**URL:** ${item.url}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
