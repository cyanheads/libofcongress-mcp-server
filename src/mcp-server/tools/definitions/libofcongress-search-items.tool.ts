/**
 * @fileoverview libofcongress_search_items tool — search Library of Congress digital collections.
 * @module mcp-server/tools/definitions/libofcongress-search-items.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { noticeWriter, pageSizeClampNotice, renderNotice } from '@/mcp-server/tools/notices.js';
import { inlineText, lineText } from '@/mcp-server/tools/render-text.js';
import { resolveDateRange, yearBound } from '@/services/loc-api/date-range.js';
import { getLocApiService, LOC_MAX_PAGE_SIZE } from '@/services/loc-api/loc-api-service.js';
import { subjectFacetTerms } from '@/services/loc-api/subject-terms.js';

/** `note`, when given, closes the description: what this facet's values mean beyond the filter. */
const facetList = (kind: string, note?: string) =>
  z
    .array(
      z
        .object({
          value: z.string().describe(`The ${kind} term, as the ${kind} filter accepts it.`),
          count: z.number().describe(`Matching items carrying this ${kind} term.`),
        })
        .describe(`One ${kind} facet value.`),
    )
    .optional()
    .describe(
      `LOC's top ${kind} terms across every item matching this search (up to 10), most frequent first. Pass a value as the ${kind} filter to narrow the search. Present only when include_facets is true; empty when LOC reports none.${note ? ` ${note}` : ''}`,
    );

export const locSearchItems = tool('libofcongress_search_items', {
  title: 'Search LOC Items',
  description:
    'Search the Library of Congress digital collections by keyword. Optionally filter by material format (photos, maps, newspapers, audio, etc.), date range, subject heading, geographic location, or contributor (a creator, photographer, author, or other credited name), or scope the search to a single curated collection with collection_slug. Returns item summaries with titles, dates, descriptions, LOC IDs, format tags, and the contributors LOC credits. Each result carries is_item: pass the id of a result where is_item is true to libofcongress_get_item for full metadata. Non-item resources include collections, exhibit and research-guide pages, newspaper pages, catalog.loc.gov records, and hdl.loc.gov finding aids. When page_url is present, pass it to libofcongress_get_newspaper_page, optionally using the search query as match; its item_id identifies the issue. A link_notice warns that a retired catalog URL no longer opens its record; otherwise follow a non-item url. Use libofcongress_search_subjects to find an LCSH heading for the subject filter. To discover the subject, location, and contributor values the filters accept for a search, set include_facets to get its top subject_facets, location_facets, and contributor_facets.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Full-text search across metadata and available descriptive text. Use "*" to match all records within the applied filters; relevance order can differ from a queryless LOC browse.',
      ),
    sort: z
      .enum(['relevance', 'date', 'date_desc'])
      .default('relevance')
      .describe(
        'Result order: relevance (default), date (oldest first), or date_desc (newest first). Uses LOC catalog dates and upstream ordering.',
      ),
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
      .describe(
        'End year for date filter, inclusive (e.g., 1930). Omit to run through the current year.',
      ),
    subject: z
      .string()
      .optional()
      .describe(
        'Subject filter: an LCSH heading from libofcongress_search_subjects (e.g., "World War, 1939-1945", "United States--History--Civil War, 1861-1865") or a subject term from subject_facets (include_facets) or libofcongress_get_item subject_terms (e.g., "world war"). LOC indexes headings by their parts, so the value is split at "--" into lowercase terms with dates dropped, and an item must carry every term.',
      ),
    location: z
      .string()
      .optional()
      .describe(
        'Geographic location filter (e.g., "oklahoma", "washington d.c."). Lowercase, matches LOC location facets; location_facets (include_facets) lists values for a search.',
      ),
    contributor: z
      .string()
      .optional()
      .describe(
        'Contributor filter: a creator, photographer, author, or other name LOC credits, in the form LOC indexes it, without dates or roles (e.g., "lange, dorothea", "united states. farm security administration"). Take values from contributor_facets (include_facets), a result\'s contributor_terms, or libofcongress_get_item contributor_terms; libofcongress_get_item contributors, which carry dates and roles, match nothing. Case is ignored; every other character must match, accents included. With format "newspaper", a page\'s contributor is the institution that digitized it, not an author.',
      ),
    include_facets: z
      .boolean()
      .default(false)
      .describe(
        "Also return subject_facets, location_facets, and contributor_facets: LOC's top subject, location, and contributor terms across every match, with counts — the values the subject, location, and contributor filters accept. Default false: facets add time to each search, so request them when you need filter values to narrow by.",
      ),
    collection_slug: z
      .string()
      .optional()
      .describe(
        'Scope the search to one curated collection. Pass a slug exactly as returned by libofcongress_browse_collections to libofcongress_search_items.collection_slug (e.g., "aaron-copland") — slugs are not derivable from the collection title. Combine with format to filter material type; use query "*" to browse every matching record. Omit to search all of LOC.',
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
            id: z
              .string()
              .describe(
                'LOC identifier for this result: an item ID, or the bare LCCN of a record whose url is an lccn.loc.gov permalink. When is_item is true, pass it to libofcongress_get_item for full metadata. When is_item is false it is a non-item resource (a collection, exhibit, guide, newspaper page, catalog.loc.gov record, or hdl.loc.gov finding aid), not a get_item input. Use page_url for newspaper pages, heed link_notice for retired links, and otherwise follow url.',
              ),
            title: z.string().describe('Item title.'),
            date: z
              .string()
              .optional()
              .describe(
                'Publication or creation date as LOC catalogs it: free text, a year, a year and month, or a full date (e.g., "c1915 Feb. 19.", "1912", "1863-11", "1863-11-20"). Absent when LOC records only a coded value ("uuuu", "||||") or none.',
              ),
            description: z.string().optional().describe('Brief description or summary.'),
            format: z
              .string()
              .optional()
              .describe('Material format (e.g., photo, map, manuscript, collection).'),
            is_item: z
              .boolean()
              .describe(
                'True when this result is a catalog item whose id resolves through libofcongress_get_item, including records LOC links by an lccn.loc.gov permalink. False for collections, exhibits, research guides, newspaper pages, catalog.loc.gov records, hdl.loc.gov finding aids, and other non-item results, which have no get_item record. Use page_url for newspaper pages, heed link_notice for retired links, and otherwise follow url. Always present on every result.',
              ),
            contributor_terms: z
              .array(z.string())
              .optional()
              .describe(
                'Every contributor LOC credits this result with, in LOC order, each in the form the contributor filter accepts (e.g., "lange, dorothea"). On a newspaper page, the institution that digitized it. Absent when LOC credits none.',
              ),
            url: z
              .string()
              .describe(
                'Original LOC result URL, preserved even when retired; read link_notice before following it.',
              ),
            page_url: z
              .string()
              .optional()
              .describe(
                'Recognized newspaper page URL: pass to libofcongress_get_newspaper_page as page_url, optionally with this search query as match. That tool returns item_id for the issue.',
              ),
            link_notice: z
              .string()
              .optional()
              .describe(
                'Warning that a retired catalog URL no longer opens its record; no replacement record URL is known.',
              ),
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
    subject_facets: facetList('subject'),
    location_facets: facetList('location'),
    contributor_facets: facetList(
      'contributor',
      'On newspaper pages the contributor is the institution that digitized the page, so institutions can appear here beside creators.',
    ),
  }),

  // Agent-facing success-path context — query echo, result count, and empty-result
  // guidance. Reaches both structuredContent and content[] automatically; kept out of
  // the domain output. Keys are disjoint from output (total vs totalCount).
  enrichment: {
    effectiveSort: z
      .enum(['relevance', 'date', 'date_desc'])
      .describe('Applied LOC result order, including empty and out-of-range pages.'),
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
    effectiveSubjectTerms: z
      .array(z.string())
      .optional()
      .describe(
        'The subject terms the subject filter was sent as, all required to match. Absent when no subject filter was given.',
      ),
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
        'Recovery hint when results are empty or a page is out of range — echoes applied filters, subject terms, location, and contributor included, and suggests how to broaden — plus disclosure of a capped limit or of the retrieval ceiling. Absent on ordinary result pages.',
      ),
  },

  enrichmentTrailer: {
    notice: { render: renderNotice },
    effectiveSubjectTerms: {
      render: (terms = []) => `**Subject terms:** ${terms.map(inlineText).join(' + ')}`,
    },
  },

  errors: [
    {
      reason: 'invalid_date_range',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      when: 'date_start is later than date_end, or date_start is given alone and is later than the current year.',
      recovery:
        'Put the earlier year in date_start and the later one in date_end, and keep a date_start given alone no later than the current year. Omit a bound to leave that side of the range open.',
    },
    {
      reason: 'invalid_filter_value',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      thrownBy: 'service',
      when: 'A subject, location, or contributor value has "|" between other characters, which the Library of Congress reads as a separator between filters. A "|" at either end of a value is dropped.',
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
      reason: 'collection_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'collection_slug does not resolve to a LOC collection. Reported on page 1; a later page gets the out-of-range notice, since LOC answers both cases the same way there.',
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
        'Retry this call once, unchanged; a repeat of a slow request can return faster. If it times out again, narrow the search: add a format, subject, or location filter, or a tighter date_start/date_end range, then retry. If a narrow search also times out, retry in a few minutes.',
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
    // Empty string is what form-based clients send for an untouched optional field — treat it
    // as absent, matching subject/location.
    const collectionSlug = input.collection_slug?.trim() || undefined;
    const subjectTerms = input.subject?.trim() ? subjectFacetTerms(input.subject) : undefined;
    const location = input.location?.trim() || undefined;
    const contributor = input.contributor?.trim() || undefined;

    ctx.log.info('libofcongress_search_items', {
      query: input.query,
      format: input.format,
      collectionSlug,
      page: input.page,
    });

    const range = resolveDateRange(
      input.date_start === undefined ? undefined : yearBound(input.date_start),
      input.date_end === undefined ? undefined : yearBound(input.date_end),
    );
    if (!range.ok) throw ctx.fail('invalid_date_range', range.message, range.data);

    // A limit past the per-call cap is a workload request, not an error: serve one capped page.
    const effectiveLimit = Math.min(input.limit, LOC_MAX_PAGE_SIZE);
    const svc = getLocApiService();
    let result: Awaited<ReturnType<typeof svc.search>>;
    try {
      result = await svc.search(
        {
          query: input.query,
          sort: input.sort,
          ...(input.format !== undefined && { format: input.format }),
          ...(collectionSlug !== undefined && { collectionSlug }),
          ...(range.dates !== undefined && { dates: range.dates }),
          ...(subjectTerms !== undefined && { subjectTerms }),
          ...(location !== undefined && { location }),
          ...(contributor !== undefined && { contributor }),
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
      // LOC 404s an unrecognized collection slug. The service reads a 404 as not-found only on
      // page 1 (a later page's 404 is out of range), so this fires for a bad slug on page 1.
      // Re-throwing as a typed failure keeps the internal request URL out of the wire — an agent
      // needs the slug it got wrong, not our endpoint.
      if (
        collectionSlug !== undefined &&
        err instanceof McpError &&
        err.code === JsonRpcErrorCode.NotFound
      ) {
        throw ctx.fail(
          'collection_not_found',
          `No LOC collection has the slug "${collectionSlug}".`,
          {
            field: 'collection_slug',
            collectionSlug,
          },
        );
      }
      throw err;
    }

    const { total, page, pages, hasNext, ceilingReached } = result.pagination;
    const facets = result.facets && {
      subject_facets: result.facets.subject,
      location_facets: result.facets.location,
      contributor_facets: result.facets.contributor,
    };
    const addNotice = noticeWriter(ctx);

    ctx.enrich.echo(input.query);
    ctx.enrich({ effectiveSort: input.sort });
    if (collectionSlug !== undefined) ctx.enrich({ effectiveCollectionSlug: collectionSlug });
    if (subjectTerms !== undefined) ctx.enrich({ effectiveSubjectTerms: subjectTerms });
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
      const scope =
        (input.format ? ` with format "${input.format}"` : '') +
        (collectionSlug ? ` in collection "${collectionSlug}"` : '') +
        (input.date_start || input.date_end
          ? ` in dates ${input.date_start ?? ''}–${input.date_end ?? ''}`
          : '') +
        (subjectTerms
          ? ` with subject terms ${subjectTerms.map((t) => `"${t}"`).join(' + ')}`
          : '') +
        (location ? ` in location "${location}"` : '') +
        (contributor ? ` with contributor "${contributor}"` : '');
      // pages === 0 is the service's sentinel for a page LOC would not serve (a 404, or a 400
      // past the retrieval ceiling).
      if (pages === 0 && page > 1) {
        addNotice(
          ceilingReached
            ? `Page ${page} is past LOC's ~100,000-item retrieval ceiling for query "${input.query}" — LOC serves nothing that deep, however few items match. Re-run with page 1 to see the real total and page count; if the target items lie past the first 100,000, narrow the search with a date range (date_start/date_end), subject, or location.`
            : `Page ${page} is out of range for "${input.query}"${scope}. Re-run with page 1 to see the total match count and page count, then request a page within that range.` +
                (collectionSlug
                  ? ' Page 1 also checks the slug: an unknown collection fails there with collection_not_found.'
                  : ''),
        );
        ctx.enrich.total(0);
        return { items: [], total: 0, page, pages: 0, has_next: false, ...facets };
      }
      // The other filters every match must also carry, named so the caller can drop one.
      const otherFilters = [location && 'location', contributor && 'contributor']
        .filter(Boolean)
        .join(' or ');
      // A contributor matches only in LOC's indexed form, which get_item's contributors lack; on
      // newspaper pages it is the digitizing institution, so a person's name finds no page.
      const contributorHint = contributor
        ? ` The contributor must match a value LOC indexes, without dates or roles: take it from contributor_facets (include_facets) or contributor_terms.${input.format === 'newspaper' ? ' Newspaper pages credit the institution that digitized them, not an author.' : ''}`
        : '';
      addNotice(
        subjectTerms
          ? `No items matched "${input.query}"${scope}. Every subject term must match; drop one${otherFilters ? `, or the ${otherFilters},` : ''} to widen the search. Also try broadening the query, widening the date range, or running libofcongress_search_subjects to find the subject heading.${contributorHint}`
          : `No items matched "${input.query}"${scope}. Try broadening the query, widening the date range, or running libofcongress_search_subjects to find the exact subject heading.${contributorHint}`,
      );
      ctx.enrich.total(0);
      return { items: [], total: 0, page, pages: 0, has_next: false, ...facets };
    }

    // Non-empty results are always returned: LOC's total can under-report the retrievable depth,
    // so a page beyond the computed count can still carry real items — discarding them (as an
    // earlier "contradictory pagination" guard did) dropped valid data. See #33.
    if (ceilingReached) {
      // The match set is larger than LOC will page through — disclose the cap on both surfaces so
      // the agent knows has_next stops at the ceiling and how to reach the rest.
      addNotice(
        `This query matches ${total.toLocaleString()} items, but LOC pages through only the first ~100,000. Results past page ${pages} at this page size are unretrievable — partition by date range (date_start/date_end), subject, or location and page within each slice to reach the rest.`,
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
      ['Top subjects', result.subject_facets],
      ['Top locations', result.location_facets],
      ['Top contributors', result.contributor_facets],
    ] as const) {
      if (values?.length)
        lines.push(
          `**${label}:** ${values.map((f) => `${inlineText(f.value)} (${f.count})`).join('; ')}`,
        );
    }
    // Catalog text goes through inlineText; IDs and URLs render as sent.
    for (const item of result.items) {
      lines.push(`\n## ${inlineText(item.title)}`);
      lines.push(`**ID:** ${item.id}`);
      // Render both is_item states so a content[]-only client (no structuredContent) can tell a
      // get_item-eligible result from a non-item one — the structured `is_item` flag alone never
      // reaches it. See #31.
      if (item.link_notice) {
        lines.push('_Non-item result — not a libofcongress_get_item target._');
        lines.push(`**link_notice:** ${inlineText(item.link_notice)}`);
      }
      if (item.page_url) {
        lines.push(
          '_Non-item newspaper page — not a libofcongress_get_item target; pass page_url to libofcongress_get_newspaper_page. Optionally use the search query as match. That tool returns item_id for the issue._',
        );
        lines.push(`**page_url:** ${item.page_url}`);
      } else if (!item.link_notice && item.is_item)
        lines.push('_Item — pass this ID to libofcongress_get_item for full metadata._');
      else if (!item.link_notice)
        lines.push(
          '_Non-item result (collection, exhibit, guide, newspaper page, catalog record, or finding aid) — not a libofcongress_get_item target; open the URL._',
        );
      if (item.date) lines.push(`**Date:** ${inlineText(item.date)}`);
      if (item.format) lines.push(`**Format:** ${inlineText(item.format)}`);
      // A term can hold a comma or "; " ("louisiana state university; baton rouge, la") and never
      // "|", LOC's separator between filters, so entries join with " | " and each stays whole.
      if (item.contributor_terms)
        lines.push(`**Contributor terms:** ${item.contributor_terms.map(inlineText).join(' | ')}`);
      if (item.description) lines.push(lineText(item.description));
      lines.push(`**URL:** ${item.url}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
