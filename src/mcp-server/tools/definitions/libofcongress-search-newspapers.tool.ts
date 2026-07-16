/**
 * @fileoverview libofcongress_search_newspapers tool — search historical newspaper pages in the Chronicling America corpus.
 * @module mcp-server/tools/definitions/libofcongress-search-newspapers.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError, validationError } from '@cyanheads/mcp-ts-core/errors';
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
    pages: z
      .number()
      .describe(
        'Total retrievable pages. For result sets larger than LOC will page through (~100,000 pages) this is capped, and a notice discloses how to reach the rest (partition by date/state).',
      ),
    has_next: z
      .boolean()
      .describe(
        "True when a retrievable next page follows this one. Never promises a page past LOC's ~100,000-item retrieval ceiling.",
      ),
  }),

  // Agent-facing success-path context — query echo, result count, and empty-result
  // guidance. Reaches both structuredContent and content[] automatically; kept out of
  // the domain output. Keys are disjoint from output (total vs totalCount).
  enrichment: {
    effectiveQuery: z
      .string()
      .describe('The keyword query as submitted to the Chronicling America API, after trimming.'),
    totalCount: z
      .number()
      .describe('Total matching newspaper pages — mirrors output.total for agent reasoning.'),
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
    let result: Awaited<ReturnType<typeof svc.searchNewspapers>>;
    try {
      result = await svc.searchNewspapers(
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
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.RateLimited) {
        throw ctx.fail('rate_limit_exceeded', err.message);
      }
      throw err;
    }

    const { total, page, pages, hasNext, ceilingReached } = result.pagination;

    ctx.enrich.echo(input.query);
    // Mirror the upstream total for agent reasoning. The empty-result branches below return
    // total: 0 and re-enrich with 0 so totalCount never contradicts the returned total — LOC
    // reports a nonzero pagination.total even for no-match queries. Last write wins.
    ctx.enrich.total(total);

    if (result.items.length === 0) {
      // pages === 0 is the sentinel for a LOC 400 (out-of-range page request).
      if (pages === 0 && page > 1) {
        ctx.enrich.notice(
          ceilingReached
            ? `Page ${page} is past LOC's ~100,000-item retrieval ceiling for query "${input.query}" — Chronicling America serves nothing deeper, regardless of the total match count. Narrow the search with a date range (date_start/date_end) or state so the target pages fall within the first 100,000 results.`
            : `Page ${page} is out of range for query "${input.query}". Try a smaller page number.`,
        );
        ctx.enrich.total(0);
        return { items: [], total: 0, page, pages: 0, has_next: false };
      }
      ctx.enrich.notice(
        `No newspaper pages matched "${input.query}"` +
          (input.state ? ` in state "${input.state}"` : '') +
          (input.date_start || input.date_end
            ? ` in dates ${input.date_start ?? ''}–${input.date_end ?? ''}`
            : '') +
          '. Try broadening the date range, removing the state filter, or using different keywords. Historical OCR is approximate — variant spellings are common.',
      );
      ctx.enrich.total(0);
      return { items: [], total: 0, page, pages: 0, has_next: false };
    }

    // Non-empty results are always returned: LOC's total can under-report the retrievable depth,
    // so a page beyond the computed count can still carry real pages — discarding them (as an
    // earlier "contradictory pagination" guard did) dropped valid data. See #33.
    if (ceilingReached) {
      // The match set is larger than LOC will page through — disclose the cap on both surfaces so
      // the agent knows has_next stops at the ceiling and how to reach the rest.
      ctx.enrich.notice(
        `This query matches ${total.toLocaleString()} pages, but LOC pages through only the first ~100,000. Results past page ${pages} at this page size are unretrievable — partition by date range (date_start/date_end) or state and page within each slice to reach the rest.`,
      );
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
      if (item.newspaper_title) lines.push(`**Publication:** ${item.newspaper_title}`);
      if (item.date) lines.push(`**Date:** ${item.date}`);
      if (item.state) lines.push(`**State:** ${item.state}`);
      if (item.description) lines.push(item.description);
      lines.push(`**URL:** ${item.url}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
