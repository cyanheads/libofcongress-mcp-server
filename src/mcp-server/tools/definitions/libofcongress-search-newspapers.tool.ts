/**
 * @fileoverview libofcongress_search_newspapers tool — search historical newspaper pages in the Chronicling America corpus.
 * @module mcp-server/tools/definitions/libofcongress-search-newspapers.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, validationError } from '@cyanheads/mcp-ts-core/errors';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';

export const locSearchNewspapers = tool('libofcongress_search_newspapers', {
  title: 'Search Historical Newspapers',
  description:
    'Search historical newspaper pages in the Chronicling America corpus. Returns matching pages with OCR text excerpts (~500 characters), publication title, date, state, and the page URL needed for libofcongress_get_newspaper_page. Filters by keyword, date range, US state, and newspaper title. The OCR excerpts are sufficient for relevance assessment — call libofcongress_get_newspaper_page with the returned url field to read the full page text. OCR quality varies: 19th-century and degraded materials may contain fragmented or garbled text.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe('Keyword search across OCR text and newspaper metadata.'),
    date_start: z
      .number()
      .int()
      .optional()
      .describe('Start year for date filter, inclusive (e.g., 1900). Omit for no lower bound.'),
    date_end: z
      .number()
      .int()
      .optional()
      .describe('End year for date filter, inclusive (e.g., 1920). Omit for no upper bound.'),
    state: z
      .string()
      .optional()
      .describe(
        'Filter to newspapers published in this US state. Use the full state name, lowercase (e.g., "oklahoma", "new york").',
      ),
    newspaper_title: z
      .string()
      .optional()
      .describe('Filter to a specific newspaper by title (partial match accepted).'),
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
            url: z
              .string()
              .describe(
                'LOC resource URL for this page — pass to libofcongress_get_newspaper_page to get full OCR text.',
              ),
            title: z.string().describe('Page or issue title.'),
            description: z
              .string()
              .optional()
              .describe('OCR text excerpt (~500 chars) for relevance assessment.'),
            date: z.string().optional().describe('Issue publication date.'),
            state: z.string().optional().describe('State where the newspaper was published.'),
            newspaper_title: z.string().optional().describe('Newspaper publication title.'),
          })
          .describe('A single newspaper page search result.'),
      )
      .describe('Newspaper page results matching the search query and filters.'),
    total: z.number().describe('Total number of matching newspaper pages in the result set.'),
    page: z.number().describe('Current 1-indexed page number.'),
    pages: z.number().describe('Total number of pages available.'),
    has_next: z.boolean().describe('True when more pages are available after this one.'),
    message: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty — echoes the applied filters and suggests how to broaden. Absent on non-empty result pages.',
      ),
  }),

  errors: [
    {
      reason: 'empty_results',
      code: JsonRpcErrorCode.NotFound,
      when: 'No newspaper pages matched the query and filters.',
      recovery:
        'Broaden the date range, remove the state filter, or try different keywords. OCR search is approximate — spelling variations in historical text are common.',
    },
    {
      reason: 'rate_limit_exceeded',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'LOC API rate limit exceeded; requests are blocked for approximately 1 hour.',
      recovery:
        'Wait approximately 1 hour before retrying. Reduce request frequency to stay under 20 req/min.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('libofcongress_search_newspapers', {
      query: input.query,
      state: input.state,
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
    const result = await svc.searchNewspapers(
      {
        query: input.query,
        ...(input.date_start !== undefined && { dateStart: input.date_start }),
        ...(input.date_end !== undefined && { dateEnd: input.date_end }),
        ...(input.state?.trim() && { state: input.state.trim() }),
        ...(input.newspaper_title?.trim() && { newspaperTitle: input.newspaper_title.trim() }),
        limit: input.limit,
        page: input.page,
      },
      ctx,
    );

    const { total, page, pages, hasNext } = result.pagination;

    if (result.items.length === 0) {
      // pages === 0 is the sentinel for a LOC 400 (out-of-range page request).
      if (pages === 0 && page > 1) {
        return {
          items: [],
          total: 0,
          page,
          pages: 0,
          has_next: false,
          message: `Page ${page} is out of range for query "${input.query}". Try a smaller page number.`,
        };
      }
      return {
        items: [],
        total: 0,
        page,
        pages: 0,
        has_next: false,
        message:
          `No newspaper pages matched "${input.query}"` +
          (input.state ? ` in state "${input.state}"` : '') +
          (input.date_start || input.date_end
            ? ` in dates ${input.date_start ?? ''}–${input.date_end ?? ''}`
            : '') +
          '. Try broadening the date range, removing the state filter, or using different keywords. Historical OCR is approximate — variant spellings are common.',
      };
    }

    if (pages > 0 && page > pages) {
      return {
        items: [],
        total,
        page,
        pages,
        has_next: false,
        message: `No results on page ${page} — query has ${pages} page(s) total (${total} items). Use a page number between 1 and ${pages}.`,
      };
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
    if (result.message) lines.push(`\n> ${result.message}`);
    for (const item of result.items) {
      lines.push(`\n## ${item.title}`);
      if (item.newspaper_title) lines.push(`**Publication:** ${item.newspaper_title}`);
      if (item.date) lines.push(`**Date:** ${item.date}`);
      if (item.state) lines.push(`**State:** ${item.state}`);
      if (item.description) lines.push(item.description);
      lines.push(`**URL:** ${item.url}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
