/**
 * @fileoverview libofcongress_search_newspapers tool — search historical newspaper pages in the Chronicling America corpus.
 * @module mcp-server/tools/definitions/libofcongress-search-newspapers.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { noticeWriter, pageSizeClampNotice, renderNotice } from '@/mcp-server/tools/notices.js';
import { fencedText, inlineText } from '@/mcp-server/tools/render-text.js';
import {
  DATE_STRING_PATTERN,
  type DateBound,
  parseDateBound,
  resolveDateRange,
} from '@/services/loc-api/date-range.js';
import { getLocApiService, LOC_MAX_PAGE_SIZE } from '@/services/loc-api/loc-api-service.js';

/** One date-range bound: a year, a date string, or blank (unset) as form-based clients send it. */
const dateBoundInput = z.union([
  z.number().int().describe('A year, e.g., 1912.'),
  z
    .string()
    .regex(DATE_STRING_PATTERN, 'Use YYYY, YYYY-MM, or YYYY-MM-DD.')
    .describe('A date: "YYYY", "YYYY-MM", or "YYYY-MM-DD", e.g., "1912-04-16".'),
  z.literal(''),
]);

/** Joins the empty-result advice: "a or b", "a, b, or c". */
const DISJUNCTION = new Intl.ListFormat('en', { type: 'disjunction' });

/** One include_facets list: LOC's top values of the facet behind the `filter` input. */
const facetList = (filter: string, noun: string) =>
  z
    .array(
      z
        .object({
          value: z.string().describe(`The ${noun}, exactly as the ${filter} filter accepts it.`),
          count: z.number().describe(`Newspaper pages LOC tallies under this ${noun}.`),
        })
        .describe(`One ${filter} facet value.`),
    )
    .optional()
    .describe(
      `LOC's top ${noun}s across every page matching this search (up to 10), most frequent first. Pass a value unchanged as the ${filter} filter to narrow the search; a count is LOC's tally and can differ from the total that filtered search reports. Present only when include_facets is true; empty when LOC lists none.`,
    );

export const locSearchNewspapers = tool('libofcongress_search_newspapers', {
  title: 'Search Historical Newspapers',
  description:
    "Search historical newspaper pages in the Chronicling America corpus. Returns matching pages with the opening of each page's OCR text (~500 characters), publication title, date, the states LOC indexes the title under, the page's languages, and the page URL needed for libofcongress_get_newspaper_page. Filters by keyword, date range, indexed state/province, newspaper title, and language. The excerpt is the page's first lines, not the text around the match: to read where the query occurs, call libofcongress_get_newspaper_page with the returned url field and this query as its match, which returns the passages around each occurrence; omit match for the full page text. OCR quality varies: 19th-century and degraded materials may contain fragmented or garbled text. To discover the newspaper_title, state, and language values the filters accept for a search, set include_facets to get its top newspaper_title_facets, state_facets, and language_facets.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe('Keyword search across OCR text and newspaper metadata.'),
    date_start: dateBoundInput
      .optional()
      .describe(
        'Start of the date filter, inclusive: an integer year (e.g., 1900) or a "YYYY", "YYYY-MM", or "YYYY-MM-DD" string (e.g., "1912-04-15"); month and day may be one or two digits. A year or month starts on its first day. Omit for no lower bound.',
      ),
    date_end: dateBoundInput
      .optional()
      .describe(
        'End of the date filter, inclusive, in the same forms as date_start (e.g., 1920 or "1912-04-16"). A year or month ends on its last day, so "1912-04" runs through April 30. Omit to run through the current year.',
      ),
    sort: z
      .enum(['relevance', 'date', 'date_desc'])
      .default('relevance')
      .describe(
        'Result order: relevance (default), date (oldest first), or date_desc (newest first). Uses LOC catalog dates and upstream ordering.',
      ),
    state: z
      .string()
      .optional()
      .describe(
        'Filter by LOC\'s State/Province facet: a full indexed name (e.g., "oklahoma", "piedmont") or a supported US postal code (e.g., "OK", "NY"), case-insensitive. Use "district of columbia" (or "DC") for Washington, D.C.; "washington" means Washington state. City and county names match nothing. state_facets (include_facets) lists the top states for a search.',
      ),
    newspaper_title: z
      .string()
      .optional()
      .describe(
        'Filter to one newspaper. Pass the newspaper_title value of a libofcongress_search_newspapers result exactly (case-insensitive), e.g., "new-york tribune (new york [n.y.]) 1866-1924" — the full catalog title with place and run. A shortened title such as "New-York Tribune" matches nothing. newspaper_title_facets (include_facets) lists the top titles for a search in this form.',
      ),
    language: z
      .string()
      .optional()
      .describe(
        'Filter by page language, named as LOC indexes it (e.g., "german", "english", "spanish"), case-insensitive. A bilingual page matches each of its languages. language_facets (include_facets) lists the languages a search covers.',
      ),
    include_facets: z
      .boolean()
      .default(false)
      .describe(
        "Also return newspaper_title_facets, state_facets, and language_facets: LOC's top newspaper titles, states, and languages across every matching page, with counts — values the newspaper_title, state, and language filters accept unchanged. Default false: LOC's facet block is large, so request facets when you need filter values to narrow by.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(25)
      .describe(
        'Results per page. Default 25. A page holds at most 100 results: a larger limit (up to 1000) is served as a 100-result page, and page then counts 100-result pages.',
      ),
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
                'LOC resource URL for this page — pass to libofcongress_get_newspaper_page for its full OCR text, or with the query as match for the passages around it.',
              ),
            title: z.string().describe('Page or issue title.'),
            description: z
              .string()
              .optional()
              .describe(
                "Opening of the page's OCR text (~500 chars): the page's first lines, not the text around the match. Pass the query as match to libofcongress_get_newspaper_page for the passages around it.",
              ),
            date: z.string().optional().describe('Issue publication date.'),
            states: z
              .array(z.string())
              .optional()
              .describe(
                'Every State/Province facet value LOC indexes this newspaper title under (e.g., ["georgia", "south carolina"]), in LOC order. A title indexed against its circulation area lists several, so no entry is necessarily the place of publication — libofcongress_get_newspaper_page returns place_of_publication. Absent when LOC lists none.',
              ),
            newspaper_title: z
              .string()
              .optional()
              .describe(
                'The newspaper\'s full catalog title with place and run (e.g., "the seattle star (seattle, wash.) 1899-1947"). Pass it unchanged as newspaper_title to search only this paper.',
              ),
            languages: z
              .array(z.string())
              .optional()
              .describe(
                'Every language LOC tags this page with (e.g., ["english", "german"]), in LOC order; a bilingual page lists each. Pass one as language to search only pages in it. Absent when LOC lists none.',
              ),
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
    newspaper_title_facets: facetList('newspaper_title', 'newspaper title'),
    state_facets: facetList('state', 'state'),
    language_facets: facetList('language', 'language'),
  }),

  // Agent-facing success-path context — query echo, result count, and empty-result
  // guidance. Reaches both structuredContent and content[] automatically; kept out of
  // the domain output. Keys are disjoint from output (total vs totalCount).
  enrichment: {
    effectiveSort: z
      .enum(['relevance', 'date', 'date_desc'])
      .describe('Applied LOC result order, including empty and out-of-range pages.'),
    effectiveQuery: z
      .string()
      .describe('The keyword query as submitted to the Chronicling America API, after trimming.'),
    totalCount: z
      .number()
      .describe('Total matching newspaper pages — mirrors output.total for agent reasoning.'),
    effectiveLimit: z
      .number()
      .optional()
      .describe(
        'The page size actually served when limit exceeded the per-call cap of 100. Absent when limit was within the cap.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty or a page is out of range — echoes applied filters and suggests how to broaden — plus disclosure of a capped limit or of the retrieval ceiling. Absent on ordinary result pages.',
      ),
  },

  enrichmentTrailer: { notice: { render: renderNotice } },

  errors: [
    {
      reason: 'invalid_date',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      when: 'date_start or date_end names no calendar day: a month outside 01-12, or a day past the end of its month (e.g., "1912-02-30").',
      recovery:
        'Correct the date to a real calendar day, or drop its day or month part to search the whole month or year.',
    },
    {
      reason: 'invalid_date_range',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      when: 'date_start is later than date_end, or date_start is given alone and is later than the current year.',
      recovery:
        'Put the earlier date in date_start and the later one in date_end, and keep a date_start given alone no later than the current year. Omit a bound to leave that side of the range open.',
    },
    {
      reason: 'invalid_filter_value',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      thrownBy: 'service',
      when: 'A state, newspaper_title, or language value has "|" between other characters, which the Library of Congress reads as a separator between filters. A "|" at either end of a value is dropped.',
      recovery:
        'Remove the "|" from the value. Each filter takes a single value; to cover two values, run one search for each.',
    },
    {
      reason: 'query_too_long',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      thrownBy: 'service',
      when: 'The Library of Congress refused the search as too long (HTTP 414), which an over-long query causes.',
      recovery:
        'Shorten the query to its most distinctive words, then search again. Resending the same query fails the same way.',
    },
    {
      reason: 'rate_limit_exceeded',
      code: JsonRpcErrorCode.RateLimited,
      retryable: false,
      when: 'LOC API rate limit exceeded; requests are blocked for approximately 1 hour.',
      recovery:
        'Wait approximately 1 hour before retrying. Reduce request frequency to stay under 20 req/min.',
    },
    {
      reason: 'server_busy',
      code: JsonRpcErrorCode.RateLimited,
      retryable: true,
      when: "More Library of Congress requests are queued on this server than can start within this call's time budget.",
      recovery:
        'Wait the number of seconds given in retryAfter, then retry. Send calls to this server one at a time rather than in parallel.',
    },
    {
      reason: 'request_timed_out',
      code: JsonRpcErrorCode.Timeout,
      retryable: true,
      when: 'The Library of Congress did not respond within the 50-second request budget.',
      recovery:
        'Retry this call once, unchanged; a repeat of a slow request can return faster. If it times out again, narrow the search: add a tighter date_start/date_end range, a state, or a newspaper_title, then retry. If a narrow search also times out, retry in a few minutes.',
    },
    {
      reason: 'upstream_unavailable',
      code: JsonRpcErrorCode.ServiceUnavailable,
      thrownBy: 'service',
      when: 'The Library of Congress could not be reached, or answered with an error status, a bot challenge or other HTML page, or an unreadable response instead of its JSON.',
      recovery: 'Retry in a few minutes; the Library of Congress is temporarily unavailable.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('libofcongress_search_newspapers', {
      query: input.query,
      state: input.state,
      page: input.page,
    });

    // A blank date is what form-based clients send for an untouched optional field — treat it as unset.
    const bounds: Partial<Record<'date_start' | 'date_end', DateBound>> = {};
    for (const field of ['date_start', 'date_end'] as const) {
      const value = input[field];
      if (value === undefined || value === '') continue;
      const parsed = parseDateBound(value);
      if (!parsed.ok) {
        throw ctx.fail(
          'invalid_date',
          `${field} ("${value}") is not a calendar date: ${parsed.problem}.`,
          { field, [field]: value },
        );
      }
      bounds[field] = parsed.bound;
    }
    const range = resolveDateRange(bounds.date_start, bounds.date_end);
    if (!range.ok) throw ctx.fail('invalid_date_range', range.message, range.data);
    const language = input.language?.trim() || undefined;

    // A limit past the per-call cap is a workload request, not an error: serve one capped page.
    const effectiveLimit = Math.min(input.limit, LOC_MAX_PAGE_SIZE);
    const svc = getLocApiService();
    let result: Awaited<ReturnType<typeof svc.searchNewspapers>>;
    try {
      result = await svc.searchNewspapers(
        {
          query: input.query,
          sort: input.sort,
          ...(range.dates !== undefined && { dates: range.dates }),
          ...(input.state?.trim() && { state: input.state.trim() }),
          ...(input.newspaper_title?.trim() && { newspaperTitle: input.newspaper_title.trim() }),
          ...(language !== undefined && { language }),
          includeFacets: input.include_facets,
          limit: effectiveLimit,
          page: input.page,
        },
        ctx,
      );
    } catch (err) {
      // A shed is this server's own queue, not LOC's block — checked first, since it is also
      // RateLimited. Its data carries the seconds until a slot opens, in the hint and retryAfter.
      if (err instanceof McpError && err.data?.reason === 'pacer_shed') {
        throw ctx.fail('server_busy', err.message, { ...err.data });
      }
      if (err instanceof McpError && err.code === JsonRpcErrorCode.RateLimited) {
        // The service's data carries the time left on the block; it overrides the contract's
        // static "about an hour" hint, which the framework fills only when no hint is set.
        throw ctx.fail('rate_limit_exceeded', err.message, { ...err.data });
      }
      if (err instanceof McpError && err.code === JsonRpcErrorCode.Timeout) {
        throw ctx.fail('request_timed_out', err.message);
      }
      throw err;
    }

    const { total, page, pages, hasNext, ceilingReached } = result.pagination;
    const facets = result.facets && {
      newspaper_title_facets: result.facets.newspaper_title,
      state_facets: result.facets.state,
      language_facets: result.facets.language,
    };
    const addNotice = noticeWriter(ctx);

    ctx.enrich.echo(input.query);
    ctx.enrich({ effectiveSort: input.sort });
    // Mirror the upstream total for agent reasoning. The empty-result branches below return
    // total: 0 and re-enrich with 0 so totalCount never contradicts the returned total — LOC
    // reports a nonzero pagination.total even for no-match queries. Last write wins.
    ctx.enrich.total(total);
    if (effectiveLimit < input.limit) {
      ctx.enrich({ effectiveLimit });
      addNotice(
        pageSizeClampNotice(input.limit, effectiveLimit, page, result.items.length > 0 && hasNext),
      );
    }

    if (result.items.length === 0) {
      const newspaperTitle = input.newspaper_title?.trim();
      const scope =
        (input.state ? ` in state "${input.state}"` : '') +
        (input.date_start || input.date_end
          ? ` in dates ${input.date_start ?? ''}–${input.date_end ?? ''}`
          : '') +
        (newspaperTitle ? ` with newspaper_title "${newspaperTitle}"` : '') +
        (language ? ` in language "${language}"` : '');
      // pages === 0 is the service's sentinel for a page LOC would not serve (a 404, or a 400
      // past the retrieval ceiling).
      if (pages === 0 && page > 1) {
        addNotice(
          ceilingReached
            ? `Page ${page} is past LOC's ~100,000-item retrieval ceiling for query "${input.query}" — Chronicling America serves nothing that deep, however few pages match. Re-run with page 1 to see the real total and page count; if the target pages lie past the first 100,000, narrow the search with a date range (date_start/date_end) or state.`
            : `Page ${page} is out of range for "${input.query}"${scope}. Re-run with page 1 to see the total match count and page count, then request a page within that range.`,
        );
        ctx.enrich.total(0);
        return { items: [], total: 0, page, pages: 0, has_next: false, ...facets };
      }
      // LOC answers a wrong title and a right title with no keyword hits the same way, so the
      // notice states the exact-value requirement whenever a title filter was set.
      const titleHint = newspaperTitle
        ? ` newspaper_title matches only a newspaper's full catalog title, exactly as the newspaper_title field of a libofcongress_search_newspapers result gives it (e.g., "new-york tribune (new york [n.y.]) 1866-1924"); a shortened title matches nothing. Search without newspaper_title and copy the value from a result.`
        : '';
      const advice = DISJUNCTION.format([
        ...(input.date_start || input.date_end ? ['broadening the date range'] : []),
        ...(input.state ? ['removing the state filter'] : []),
        ...(language ? ['removing the language filter'] : []),
        'using different keywords',
      ]);
      addNotice(
        `No newspaper pages matched "${input.query}"${scope}.${titleHint} Try ${advice}. Historical OCR is approximate — variant spellings are common.`,
      );
      ctx.enrich.total(0);
      return { items: [], total: 0, page, pages: 0, has_next: false, ...facets };
    }

    // Non-empty results are always returned: LOC's total can under-report the retrievable depth,
    // so a page beyond the computed count can still carry real pages — discarding them (as an
    // earlier "contradictory pagination" guard did) dropped valid data. See #33.
    if (ceilingReached) {
      // The match set is larger than LOC will page through — disclose the cap on both surfaces so
      // the agent knows has_next stops at the ceiling and how to reach the rest.
      addNotice(
        `This query matches ${total.toLocaleString()} pages, but LOC pages through only the first ~100,000. Results past page ${pages} at this page size are unretrievable — partition by date range (date_start/date_end) or state and page within each slice to reach the rest.`,
      );
    }

    return {
      items: result.items,
      total,
      page,
      pages,
      has_next: hasNext,
      ...facets,
    };
  },

  format: (result) => {
    const lines: string[] = [];
    lines.push(
      `**Total:** ${result.total} | **Page:** ${result.page} of ${result.pages} | **has_next:** ${result.has_next}`,
    );
    // Facet values can carry commas, so entries join with "; ".
    for (const [label, values] of [
      ['Top newspaper titles', result.newspaper_title_facets],
      ['Top states', result.state_facets],
      ['Top languages', result.language_facets],
    ] as const) {
      if (values?.length)
        lines.push(
          `**${label}:** ${values.map((f) => `${inlineText(f.value)} (${f.count})`).join('; ')}`,
        );
    }
    // Catalog text goes through inlineText, each OCR excerpt into a fenced block; URLs render as sent.
    for (const item of result.items) {
      lines.push(`\n## ${inlineText(item.title)}`);
      if (item.newspaper_title) lines.push(`**Publication:** ${inlineText(item.newspaper_title)}`);
      if (item.date) lines.push(`**Date:** ${inlineText(item.date)}`);
      if (item.states) lines.push(`**States:** ${item.states.map(inlineText).join(', ')}`);
      if (item.languages) lines.push(`**Languages:** ${item.languages.map(inlineText).join(', ')}`);
      if (item.description) lines.push(fencedText(item.description));
      lines.push(`**URL:** ${item.url}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
