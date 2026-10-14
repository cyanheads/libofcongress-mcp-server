/**
 * @fileoverview libofcongress_get_item tool — retrieve full metadata for a LOC digital item.
 * @module mcp-server/tools/definitions/libofcongress-get-item.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { noticeWriter } from '@/mcp-server/tools/notices.js';
import { inlineText, lineText } from '@/mcp-server/tools/render-text.js';
import {
  getLocApiService,
  ITEM_PAGE_LIMIT_DEFAULT,
  ITEM_PAGE_LIMIT_MAX,
} from '@/services/loc-api/loc-api-service.js';
import { normalizeItemId } from '@/services/loc-api/loc-urls.js';

export const locGetItem = tool('libofcongress_get_item', {
  title: 'Get LOC Item',
  description:
    "Retrieve the full metadata record for a specific LOC digital item. Returns contributors, LCSH subject headings and the subject terms the search subject filter accepts, summary, languages, locations, rights information, physical description, call number, original and online formats, access restrictions, former catalog IDs, notes, and related items, plus the item's digital resources (each with its page count, representative image, PDF, and audio) and a window of its pages. Each page has a page_url and has_text; pass a page_url with has_text true to libofcongress_get_newspaper_page to read that page's text (newspaper, book, and manuscript pages alike). A long item lists 50 pages per call: continue with page_offset set to next_page_offset. Set include_files for each listed page's downloadable files (TIFF, JP2, JPEG sizes, text). Use after libofcongress_search_items on a result whose is_item is true. Pass the result id — a simple ID or a slash-separated newspaper path — or a loc.gov item link (`https://www.loc.gov/item/<id>/`), which is read as its id. Non-item results (is_item: false) — collections, exhibits, guides, newspaper pages — have no item record and cannot be retrieved here.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    item_id: z
      .string()
      .min(1)
      .describe(
        'LOC item id from a libofcongress_search_items result\'s "id" field (where is_item is true): a simple ID ("2009632251", "2005691065") or a slash-separated path for newspaper issues ("sn95047246/1935-09-05/ed-1"). A loc.gov item link is also read as its id: "https://www.loc.gov/item/2009632251/", http or without "www.", or "item/2009632251". Any other URL, such as a /resource/ page URL, is rejected.',
      ),
    page_offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        "Index of the first page to list, 0-based across all of the item's resources. Default 0. Pass next_page_offset from the previous response to continue.",
      ),
    page_limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(ITEM_PAGE_LIMIT_DEFAULT)
      .describe(
        `Pages to list. Default ${ITEM_PAGE_LIMIT_DEFAULT}. A response lists at most ${ITEM_PAGE_LIMIT_MAX} pages: a larger page_limit (up to 1000) is served as ${ITEM_PAGE_LIMIT_MAX}.`,
      ),
    include_files: z
      .boolean()
      .default(false)
      .describe(
        "Also list the download URLs of each listed page's files — every JPEG size, the JP2 and TIFF masters, OCR XML, and text files. Default false.",
      ),
  }),
  output: z.object({
    item_id: z
      .string()
      .describe(
        'LOC item ID: the input item_id, or the id read from the loc.gov item link passed as item_id.',
      ),
    title: z.string().describe('Item title.'),
    date: z
      .string()
      .optional()
      .describe(
        'Publication or creation date as LOC catalogs it: free text, a year, or a full date (e.g., "1936 Apr.", "1909-1911.", "1894", "1912-04-16").',
      ),
    contributors: z
      .array(z.string())
      .describe(
        'Contributors, creators, or photographers as LOC catalogs them, role included (e.g., "Washington, George, 1732-1799 (Author)"). One person can appear once per role. Empty when LOC lists none.',
      ),
    subject_headings: z
      .array(z.string())
      .describe(
        'Library of Congress Subject Headings (LCSH) assigned to this item, as cataloged (e.g., "United States--History--Civil War, 1861-1865"). Empty when the record carries none.',
      ),
    subject_terms: z
      .array(z.string())
      .describe(
        'Subject terms LOC indexes this item under: lowercase heading components without dates (e.g., "civil war", "united states"). Each is a value the libofcongress_search_items subject filter accepts.',
      ),
    notes: z.array(z.string()).describe('Descriptive notes and annotations from catalogers.'),
    summary: z
      .string()
      .optional()
      .describe("Cataloger's abstract of the item's subject and historical context."),
    rights_information: z
      .string()
      .optional()
      .describe('Rights and reproduction statement for this item.'),
    physical_description: z
      .string()
      .optional()
      .describe('Physical or technical description of the original item.'),
    call_number: z
      .string()
      .optional()
      .describe('LOC call number — the shelf location for requesting the physical original.'),
    languages: z.array(z.string()).describe('Languages of the item (e.g., "english").'),
    locations: z
      .array(z.string())
      .describe('Places the item depicts or originates from (e.g., "united states").'),
    former_ids: z
      .array(z.string())
      .describe('Superseded catalog identifiers or URLs this item was previously known by.'),
    original_formats: z
      .array(z.string())
      .describe('Material types of the original (e.g., "photo, print, drawing").'),
    online_formats: z
      .array(z.string())
      .describe('Formats the digitized surrogate is available in (e.g., "image").'),
    access_restricted: z
      .boolean()
      .optional()
      .describe('True when LOC restricts access to the original. Absent when upstream omits it.'),
    resources: z
      .array(
        z
          .object({
            url: z.string().describe('LOC resource URL; its pages are this URL plus ?sp=N.'),
            page_count: z.number().describe('Pages (file groups) in this resource.'),
            image: z
              .string()
              .optional()
              .describe('Representative image URL. Absent when LOC gives none.'),
            pdf: z
              .string()
              .optional()
              .describe('PDF of the whole resource. Absent when LOC gives none.'),
            audio: z
              .string()
              .optional()
              .describe('Audio stream (MP3) of a sound recording. Absent when LOC gives none.'),
          })
          .describe('One digital resource of the item, such as a photo, a volume, or a recording.'),
      )
      .describe(
        "The item's digital resources, in LOC order. Empty when no digital surrogate exists.",
      ),
    pages: z
      .array(
        z
          .object({
            page_url: z
              .string()
              .describe(
                'LOC page URL. Pass to libofcongress_get_newspaper_page to read its text when has_text is true.',
              ),
            has_text: z
              .boolean()
              .describe('True when LOC holds OCR or transcribed text for this page.'),
            files: z
              .array(z.string().describe('Download URL; its extension names the format.'))
              .optional()
              .describe(
                "Download URLs of the page's files: JPEG sizes, JP2 and TIFF masters, OCR XML, text. Present only when include_files is true.",
              ),
          })
          .describe('One page of the item.'),
      )
      .describe(
        "The window of the item's pages starting at page_offset, across every resource in order. Empty when the item has no pages or page_offset is past the last page.",
      ),
    page_total: z.number().describe("Pages across all of the item's resources."),
    next_page_offset: z
      .number()
      .optional()
      .describe(
        'page_offset for the next window of pages. Absent when this window reaches the last page.',
      ),
    related_items: z
      .array(z.string())
      .describe(
        'IDs or URLs of related LOC records for follow-up retrieval; a title stands in for a related record LOC gives neither for.',
      ),
    url: z.string().describe('Canonical LOC item URL.'),
  }),

  enrichment: {
    totalCount: z
      .number()
      .describe('Pages across all resources — mirrors output.page_total for agent reasoning.'),
    effectivePageLimit: z
      .number()
      .optional()
      .describe(
        `The page_limit actually served when page_limit exceeded the per-call cap of ${ITEM_PAGE_LIMIT_MAX}. Absent when page_limit was within the cap.`,
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Set when page_offset is past the last page, or when page_limit was capped. Absent otherwise.',
      ),
  },

  errors: [
    {
      reason: 'invalid_item_id',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      when: 'item_id is neither a LOC item ID nor a loc.gov /item/ link: a URL on another loc.gov path (such as a /resource/ page URL) or another host, or text with characters or segments no LOC ID has.',
      recovery:
        'Pass the id from a libofcongress_search_items result, or a loc.gov item link (`https://www.loc.gov/item/<id>/`). To read a /resource/ page URL, pass it to libofcongress_get_newspaper_page instead.',
    },
    {
      reason: 'item_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No item exists for the given ID.',
      recovery:
        'Verify the ID from libofcongress_search_items results. IDs are not guessable — use libofcongress_search_items to find a valid ID.',
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
      when: 'The Library of Congress did not respond within the 50-second request budget.',
      recovery: 'Retry in a few minutes; the Library of Congress is responding slowly.',
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
    ctx.log.info('libofcongress_get_item', { item_id: input.item_id });
    const itemId = normalizeItemId(input.item_id);
    if (itemId === undefined) {
      throw ctx.fail(
        'invalid_item_id',
        'item_id must be a LOC item ID or a loc.gov item link (`https://www.loc.gov/item/<id>/`).',
        { field: 'item_id', received: input.item_id },
      );
    }
    // A page_limit past the per-call cap is a workload request, not an error: serve the cap.
    const pageLimit = Math.min(input.page_limit, ITEM_PAGE_LIMIT_MAX);
    const svc = getLocApiService();
    let result: Awaited<ReturnType<typeof svc.getItem>>;
    try {
      result = await svc.getItem(itemId, ctx, {
        pageOffset: input.page_offset,
        pageLimit,
        includeFiles: input.include_files,
      });
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('item_not_found', `No LOC item has the ID "${itemId}".`, { itemId });
      }
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

    // The page list is a window over page_total; mirror the total so a capped list is disclosed.
    ctx.enrich.total(result.page_total);
    const addNotice = noticeWriter(ctx);
    if (pageLimit < input.page_limit) {
      ctx.enrich({ effectivePageLimit: pageLimit });
      addNotice(
        `Requested page_limit ${input.page_limit} exceeds the per-call cap of ${ITEM_PAGE_LIMIT_MAX}; this response lists up to ${ITEM_PAGE_LIMIT_MAX} pages.` +
          (result.next_page_offset === undefined
            ? ''
            : ` Request page_offset ${result.next_page_offset} for the next pages.`),
      );
    }
    if (result.pages.length === 0 && input.page_offset > 0) {
      addNotice(
        `page_offset ${input.page_offset} is past the last page: this item has ${result.page_total} page(s). ` +
          (result.page_total > 0
            ? `Use a page_offset from 0 to ${result.page_total - 1}.`
            : 'It has no pages to list.'),
      );
    }
    return result;
  },

  format: (result) => {
    // Catalog text goes through inlineText; IDs and URLs render as sent.
    const list = (values: string[], separator: string) => values.map(inlineText).join(separator);
    const lines: string[] = [];
    lines.push(`# ${inlineText(result.title)}`);
    lines.push(`**ID:** ${result.item_id}`);
    if (result.date) lines.push(`**Date:** ${inlineText(result.date)}`);
    if (result.contributors.length > 0)
      lines.push(`**Contributors:** ${list(result.contributors, ', ')}`);
    // Headings and terms can carry commas ("World War, 1939-1945"), so entries join with "; ".
    if (result.subject_headings.length > 0)
      lines.push(`**Subject headings:** ${list(result.subject_headings, '; ')}`);
    if (result.subject_terms.length > 0)
      lines.push(`**Subject terms:** ${list(result.subject_terms, '; ')}`);
    if (result.languages.length > 0) lines.push(`**Languages:** ${list(result.languages, ', ')}`);
    if (result.locations.length > 0) lines.push(`**Locations:** ${list(result.locations, ', ')}`);
    if (result.summary) lines.push(`**Summary:** ${inlineText(result.summary)}`);
    if (result.physical_description)
      lines.push(`**Physical description:** ${inlineText(result.physical_description)}`);
    if (result.original_formats.length > 0)
      lines.push(`**Original format:** ${list(result.original_formats, ', ')}`);
    if (result.online_formats.length > 0)
      lines.push(`**Online format:** ${list(result.online_formats, ', ')}`);
    if (result.call_number) lines.push(`**Call number:** ${inlineText(result.call_number)}`);
    if (result.access_restricted !== undefined)
      lines.push(`**Access restricted:** ${result.access_restricted ? 'yes' : 'no'}`);
    if (result.rights_information)
      lines.push(`**Rights:** ${inlineText(result.rights_information)}`);
    if (result.former_ids.length > 0) lines.push(`**Former IDs:** ${result.former_ids.join(', ')}`);
    if (result.notes.length > 0) {
      lines.push('**Notes:**');
      for (const note of result.notes) lines.push(`- ${lineText(note)}`);
    }
    // Every list renders in full: a content[]-only client (Claude Desktop) sees nothing but
    // content[], so any entry omitted here is unreachable for it while structuredContent clients
    // get the whole array. The page list is bounded by the window, not here.
    if (result.resources.length > 0) {
      lines.push(`**Resources (${result.resources.length}):**`);
      for (const r of result.resources) {
        const parts = [`${r.page_count} page(s)`];
        if (r.image) parts.push(`image: ${r.image}`);
        if (r.pdf) parts.push(`pdf: ${r.pdf}`);
        if (r.audio) parts.push(`audio: ${r.audio}`);
        lines.push(`- ${r.url} — ${parts.join('; ')}`);
      }
    }
    if (result.pages.length > 0) {
      // A non-empty window ends at next_page_offset, or at the last page when none follows.
      const end = result.next_page_offset ?? result.page_total;
      const first = end - result.pages.length + 1;
      const next =
        result.next_page_offset === undefined
          ? ''
          : ` — next_page_offset: ${result.next_page_offset}`;
      lines.push(`**Pages ${first}–${end} of ${result.page_total}${next}:**`);
      for (const page of result.pages) {
        lines.push(`- ${page.page_url}${page.has_text ? ' (has text)' : ''}`);
        for (const file of page.files ?? []) lines.push(`  - ${file}`);
      }
    } else {
      lines.push(`**Pages:** none listed of ${result.page_total}`);
    }
    // A related record can be known by title alone, so the list is catalog text.
    if (result.related_items.length > 0) {
      lines.push(`**Related items:** ${list(result.related_items, ', ')}`);
    }
    lines.push(`**URL:** ${result.url}`);
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
