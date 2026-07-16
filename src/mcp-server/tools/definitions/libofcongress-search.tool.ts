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
    'Search the Library of Congress digital collections by keyword. Optionally filter by material format (photos, maps, newspapers, audio, etc.), date range, subject heading, or geographic location, or scope the search to a single curated collection with collection_slug. Returns item summaries with titles, dates, descriptions, LOC IDs, and format tags. Each result carries is_item: pass the id of a result where is_item is true to libofcongress_get_item for full metadata; results where is_item is false are non-item resources (collections, exhibit and research-guide pages, newspaper-page results) with no item record — open their url instead. Use libofcongress_search_subjects first to find the exact LCSH heading spelling before applying a subject filter.',
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
    collection_slug: z
      .string()
      .optional()
      .describe(
        'Scope the search to one curated collection. Use a slug exactly as returned by libofcongress_browse_collections (e.g., "aaron-copland") — slugs are not derivable from the collection title. Cannot be combined with format; omit format and read each result\'s format field instead. Omit to search all of LOC.',
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
              .describe(
                'LOC identifier for this result. When is_item is true, pass it to libofcongress_get_item for full metadata. When is_item is false it is a non-item resource (a collection, exhibit, guide, or newspaper page), not a get_item input — open url instead.',
              ),
            title: z.string().describe('Item title.'),
            date: z.string().optional().describe('Publication or creation date.'),
            description: z.string().optional().describe('Brief description or summary.'),
            format: z
              .string()
              .optional()
              .describe('Material format (e.g., photo, map, manuscript, collection).'),
            is_item: z
              .boolean()
              .describe(
                'True when this result is a catalog item whose id resolves through libofcongress_get_item. False for collections, exhibits, research guides, newspaper pages, and other non-item results, which have no get_item record — follow url instead. Always present on every result.',
              ),
            url: z.string().describe('LOC item or collection URL.'),
          })
          .describe('A single LOC item summary.'),
      )
      .describe('Item summaries matching the search query and filters.'),
    total: z.number().describe('Total number of matching items across all pages.'),
    page: z.number().describe('Current 1-indexed page number.'),
    pages: z
      .number()
      .describe(
        'Total retrievable pages. For result sets larger than LOC will page through (~100,000 items) this is capped, and a notice discloses how to reach the rest (partition by date/subject/location).',
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
    effectiveQuery: z.string().describe('The query as submitted to the LOC API, after trimming.'),
    effectiveCollectionSlug: z
      .string()
      .optional()
      .describe(
        'The collection the search was scoped to, after trimming. Absent when the search covered all of LOC.',
      ),
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
      reason: 'incompatible_filters',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      when: 'format and collection_slug were both supplied; each selects a different LOC endpoint, so only one can apply.',
      recovery:
        "Drop one of the two. To search within the collection, omit format and filter on each result's format field; to search one material type across all of LOC, omit collection_slug.",
    },
    {
      reason: 'collection_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'collection_slug does not resolve to a LOC collection.',
      recovery:
        'Call libofcongress_browse_collections and pass a slug exactly as returned; slugs are not derivable from the collection title.',
    },
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
    // Empty string is what form-based clients send for an untouched optional field — treat it
    // as absent, matching subject/location.
    const collectionSlug = input.collection_slug?.trim() || undefined;

    ctx.log.info('libofcongress_search', {
      query: input.query,
      format: input.format,
      collectionSlug,
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

    // format and collection_slug each select a different LOC base path, so no request can honor
    // both. Reject rather than silently dropping one — a search the caller did not ask for that
    // still returns plausible results is worse than a failure naming the choice.
    if (input.format !== undefined && collectionSlug !== undefined) {
      throw ctx.fail(
        'incompatible_filters',
        `format ("${input.format}") and collection_slug ("${collectionSlug}") cannot be combined — each scopes the search to a different LOC endpoint. Omit format to search within the collection and filter on each result's format field, or omit collection_slug to search that format across all of LOC.`,
        { field: 'collection_slug', format: input.format, collectionSlug },
      );
    }

    const svc = getLocApiService();
    let result: Awaited<ReturnType<typeof svc.search>>;
    try {
      result = await svc.search(
        {
          query: input.query,
          ...(input.format !== undefined && { format: input.format }),
          ...(collectionSlug !== undefined && { collectionSlug }),
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
      // LOC 404s an unrecognized collection slug. Only the collection path can 404 here, and
      // re-throwing as a typed failure keeps the internal request URL the service attached out
      // of the wire — an agent needs the slug it got wrong, not our endpoint.
      if (
        collectionSlug !== undefined &&
        err instanceof McpError &&
        err.code === JsonRpcErrorCode.NotFound
      ) {
        throw ctx.fail(
          'collection_not_found',
          `No LOC collection has the slug "${collectionSlug}".`,
          { field: 'collection_slug', collectionSlug },
        );
      }
      throw err;
    }

    const { total, page, pages, hasNext, ceilingReached } = result.pagination;

    ctx.enrich.echo(input.query);
    if (collectionSlug !== undefined) ctx.enrich({ effectiveCollectionSlug: collectionSlug });
    // Mirror the upstream total for agent reasoning. The empty-result branches below return
    // total: 0 and re-enrich with 0 so totalCount never contradicts the returned total — LOC
    // reports a nonzero pagination.total even for no-match queries. Last write wins.
    ctx.enrich.total(total);

    if (result.items.length === 0) {
      // pages === 0 is the sentinel for a LOC 400 (out-of-range page request).
      if (pages === 0 && page > 1) {
        ctx.enrich.notice(
          ceilingReached
            ? `Page ${page} is past LOC's ~100,000-item retrieval ceiling for query "${input.query}" — LOC serves nothing deeper, regardless of the total match count. Narrow the search with a date range (date_start/date_end), subject, or location so the target items fall within the first 100,000 results.`
            : `Page ${page} is out of range for query "${input.query}". Try a smaller page number.`,
        );
        ctx.enrich.total(0);
        return { items: [], total: 0, page, pages: 0, has_next: false };
      }
      ctx.enrich.notice(
        `No items matched "${input.query}"` +
          (input.format ? ` with format "${input.format}"` : '') +
          (collectionSlug ? ` in collection "${collectionSlug}"` : '') +
          (input.date_start || input.date_end
            ? ` in dates ${input.date_start ?? ''}–${input.date_end ?? ''}`
            : '') +
          '. Try broadening the query, widening the date range, or running libofcongress_search_subjects to find the exact subject heading.',
      );
      ctx.enrich.total(0);
      return { items: [], total: 0, page, pages: 0, has_next: false };
    }

    // Non-empty results are always returned: LOC's total can under-report the retrievable depth,
    // so a page beyond the computed count can still carry real items — discarding them (as an
    // earlier "contradictory pagination" guard did) dropped valid data. See #33.
    if (ceilingReached) {
      // The match set is larger than LOC will page through — disclose the cap on both surfaces so
      // the agent knows has_next stops at the ceiling and how to reach the rest.
      ctx.enrich.notice(
        `This query matches ${total.toLocaleString()} items, but LOC pages through only the first ~100,000. Results past page ${pages} at this page size are unretrievable — partition by date range (date_start/date_end), subject, or location and page within each slice to reach the rest.`,
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
      lines.push(`**ID:** ${item.id}`);
      // Render both is_item states so a content[]-only client (no structuredContent) can tell a
      // get_item-eligible result from a non-item one — the structured `is_item` flag alone never
      // reaches it. See #31.
      if (item.is_item)
        lines.push('_Item — pass this ID to libofcongress_get_item for full metadata._');
      else
        lines.push(
          '_Non-item result (collection/exhibit/guide/newspaper page) — not a libofcongress_get_item target; open the URL._',
        );
      if (item.date) lines.push(`**Date:** ${item.date}`);
      if (item.format) lines.push(`**Format:** ${item.format}`);
      if (item.description) lines.push(item.description);
      lines.push(`**URL:** ${item.url}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
