/**
 * @fileoverview libofcongress_get_newspaper_page tool — retrieve the full text of one LOC page:
 * a newspaper page, or a book or manuscript page.
 * @module mcp-server/tools/definitions/libofcongress-get-newspaper-page.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { fencedText, inlineText } from '@/mcp-server/tools/render-text.js';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';
import { normalizePageUrl } from '@/services/loc-api/loc-urls.js';
import { matchPageText } from '@/services/loc-api/page-text-match.js';

export const locGetNewspaperPage = tool('libofcongress_get_newspaper_page', {
  title: 'Get Newspaper Page',
  description:
    'Retrieve the full text of one LOC page — a historical newspaper page, or a book or manuscript page — or, with match, only the passages around your search terms, with its publication metadata: for newspapers the title, issue date, place of publication, indexed states, and edition; for every page its sequence, the page count, and the item_title and item_id of the issue, book, or manuscript it belongs to — pass item_id to libofcongress_get_item to list every page of the item. Pass the url field from a libofcongress_search_newspapers result, or a pages[].page_url from libofcongress_get_item (has_text true), or a Chronicling America page link (…/ed-N/seq-M/) — do not construct this URL manually. A dense newspaper page runs to 50,000 characters: to find the article a search hit on, pass the search query as match and read the passages around it rather than the whole page. The text is OCR, or for some manuscripts a volunteer transcription; OCR quality varies by digitization batch and era, and 19th-century and degraded materials may contain fragmented text, garbled words, and line-break artifacts that are surfaced as-is. When a page exists but has no digitized text, ocr_available is false and ocr_text is empty — this is a data property, not an error.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    page_url: z
      .string()
      .describe(
        'A LOC page URL: the url field from a libofcongress_search_newspapers result (e.g., "https://www.loc.gov/resource/sn83045462/1905-03-15/ed-1/?sp=1"), or a pages[].page_url from libofcongress_get_item for a newspaper, book, or manuscript page (e.g., "https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3"). Also accepted: the same /resource/ URL over http or without "www.", a newspaper page path ending /ed-N/seq-M/, and a Chronicling America page link (`chroniclingamerica.loc.gov/lccn/<lccn>/<date>/ed-N/seq-M/`); each is read as its https://www.loc.gov/resource/…/?sp=M page. Pass the value as returned — do not construct page URLs.',
      ),
    match: z
      .string()
      .max(200)
      .optional()
      .describe(
        'Return the passages around these terms instead of the whole page — pass the query you gave libofcongress_search_newspapers (e.g., titanic, or "the titanic" iceberg); the q= in a search result url is not read as match. Words separated by spaces are separate terms, any of which matches; a double-quoted span is one phrase. Each matches case-insensitively as literal text, with line breaks read as spaces; OCR misreads are not repaired. When set, ocr_text is empty, matches holds up to 10 passages of about 300 characters either side of each occurrence — when they need more, occurrences of the rarest terms come first, so a common word only fills the slots left — and match_count counts every occurrence. Omit match for the whole page. Up to 200 characters; blank is ignored.',
      ),
  }),
  output: z.object({
    page_url: z
      .string()
      .describe(
        'The LOC resource URL for this page, in the https://www.loc.gov/resource/…?sp=N form the input was read as.',
      ),
    item_id: z
      .string()
      .optional()
      .describe(
        'ID of the item this page belongs to: the newspaper issue (e.g., "sn83030214/1912-04-16/ed-1"), book, or manuscript volume (e.g., "mm77093930"). Pass it to libofcongress_get_item to list every page of the item, each with its page_url and has_text — for an article continued on a later page, or the next page of a book. Absent when LOC names no item.',
      ),
    item_title: z
      .string()
      .optional()
      .describe(
        'Title of the item this page belongs to, on every page type: the book or manuscript title, or for a newspaper page the issue title with place and date (e.g., "New-York tribune (New York [N.Y.]), April 16, 1912"). Absent when LOC gives none.',
      ),
    newspaper_title: z
      .string()
      .optional()
      .describe('Title of the newspaper publication. Absent when LOC gives none.'),
    date: z.string().optional().describe('Issue publication date (YYYY-MM-DD).'),
    states: z
      .array(z.string())
      .optional()
      .describe(
        'Every US state LOC indexes this newspaper title under (e.g., ["georgia", "south carolina"]), in LOC order — possibly more than the state of publication. Absent when LOC lists no state.',
      ),
    place_of_publication: z
      .string()
      .optional()
      .describe(
        'Where the newspaper was published, as LOC catalogs it (e.g., "Charleston, S.C."). Absent when LOC gives none.',
      ),
    edition: z
      .string()
      .optional()
      .describe('Edition number of the issue (e.g., "1"). Absent when LOC gives none.'),
    sequence: z
      .number()
      .optional()
      .describe('Page sequence number within the issue, volume, or folder.'),
    segment_count: z
      .number()
      .optional()
      .describe('Number of pages in the issue, volume, or folder. Absent when LOC gives none.'),
    ocr_text: z
      .string()
      .describe(
        'Full plain text of this page: OCR, or for some manuscripts a volunteer transcription. Empty string when match is set (read matches instead), when ocr_available is false, or when the page is blank or its text could not be retrieved (see notice). May contain fragmented words, line-break artifacts, and misspellings inherent to historical OCR — do not attempt to repair.',
      ),
    ocr_available: z
      .boolean()
      .describe(
        'True when LOC lists OCR or transcribed text for this page, even if the text it returns is empty (see notice). False for image-only pages where no text has been produced.',
      ),
    matches: z
      .array(z.string())
      .optional()
      .describe(
        'Present only when match is set: passages of the page text around the occurrences of the match terms, in page order — about 300 characters either side of each occurrence, overlapping passages merged up to 1,200 characters, never overlapping, at most 10, chosen around the rarest terms first when more would be needed. Empty when nothing matched or the page has no text.',
      ),
    match_count: z
      .number()
      .int()
      .optional()
      .describe(
        'Present only when match is set: occurrences of every match term on the page, including those beyond the passages returned. 0 when nothing matched or the page has no text.',
      ),
  }),

  // Agent-facing retrieval-state disclosure. Reaches structuredContent and content[] identically,
  // so a structured client sees the same fact format() would otherwise render only into text.
  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        "Set when ocr_available is true but the page's text came back empty, saying why: the text service did not answer this call (retry), its answer could not be read as text (retrying will not help), or the page's text is empty — a blank page, including one LOC sends as the placeholder [NO TEXT AVAILABLE FOR THIS PAGE]. Distinguishes these from a genuinely image-only page (where ocr_available is false), which carries no notice. With match set on a page that has text, set instead when nothing matched or when some occurrences fall outside the passages returned — those are read on the whole page, by calling again without match. Absent otherwise.",
      ),
  },

  errors: [
    {
      reason: 'invalid_page_url',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      when: 'page_url is not one LOC page: neither a loc.gov /resource/ URL nor a Chronicling America page link ending /ed-N/seq-M/.',
      recovery:
        'Pass the url from a libofcongress_search_newspapers result or a pages[].page_url from libofcongress_get_item as returned: an https://www.loc.gov/resource/ URL. A Chronicling America link must name one page (`…/lccn/<lccn>/<date>/ed-N/seq-M/`); issue links, /ocr/ views, and file links are not pages.',
    },
    {
      reason: 'page_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The URL does not resolve to a LOC page resource.',
      recovery:
        'Get a fresh page URL — the url from a libofcongress_search_newspapers result, or a pages[].page_url from libofcongress_get_item — and pass it as returned. Do not modify or guess page URLs.',
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
    ctx.log.info('libofcongress_get_newspaper_page', { page_url: input.page_url });

    // Reduced to a www.loc.gov/resource/ page before any outbound request; nothing else is fetched.
    const pageUrl = normalizePageUrl(input.page_url);
    if (pageUrl === undefined) {
      throw ctx.fail(
        'invalid_page_url',
        'page_url must be one LOC page: an https://www.loc.gov/resource/ URL (http or without "www." also read), or a Chronicling America page link ending /ed-N/seq-M/.',
        { field: 'page_url', received: input.page_url },
      );
    }

    const svc = getLocApiService();
    let fetched: Awaited<ReturnType<typeof svc.getNewspaperPage>>;
    try {
      fetched = await svc.getNewspaperPage(pageUrl, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('page_not_found', `No LOC page resolves at "${pageUrl}".`, {
          pageUrl,
        });
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

    // ocr_available true with empty page text is ambiguous in structuredContent alone, so the reason
    // goes out as a notice reaching both surfaces (#31). It keys on the fetched text: under match,
    // the returned ocr_text is empty on every page.
    const { ocrMiss, ...page } = fetched;
    if (page.ocr_available && !page.ocr_text) {
      ctx.enrich.notice(
        ocrMiss === 'unavailable'
          ? 'OCR is digitized for this page, but the full text was not returned this call. Retry libofcongress_get_newspaper_page; a persistent empty result means the OCR text service is temporarily unavailable.'
          : ocrMiss === 'unparseable'
            ? "LOC lists text for this page, but its text service answered with a body that could not be read as text (unparseable). Retrying will not change it; read the page's image at page_url instead."
            : "LOC's text for this page is empty; the page may be blank.",
      );
    }

    const match = input.match?.trim();
    if (!match) return page;
    // A page without text keeps only its text-state notice above; these two need text to scan.
    const found = matchPageText(page.ocr_text, match);
    if (page.ocr_text && found.matchCount === 0) {
      ctx.enrich.notice(
        'Nothing on this page matched the match terms. OCR misreads and words split across a line break can hide an occurrence, and libofcongress_search_newspapers matches more loosely than this literal scan; try another spelling or fewer words, or omit match to read the whole page.',
      );
    } else if (found.cut) {
      ctx.enrich.notice(
        `Showing ${found.passages.length} passages, chosen around the rarest match terms first; match_count counts every occurrence on the page. Omit match to read the whole page, which holds the rest; a narrower match (a quoted phrase or a rarer word) needs fewer passages.`,
      );
    }
    return { ...page, ocr_text: '', matches: found.passages, match_count: found.matchCount };
  },

  format: (result) => {
    // Catalog text goes through inlineText, the page text into a fenced block; the URL renders as sent.
    // A newspaper page is headed by its newspaper; a book or manuscript page by its item's title.
    const lines: string[] = [];
    const heading = result.newspaper_title ?? result.item_title;
    if (heading) lines.push(`# ${inlineText(heading)}`);
    lines.push(`**URL:** ${result.page_url}`);
    if (result.item_id) lines.push(`**Item ID:** ${result.item_id}`);
    if (result.item_title && result.item_title !== heading)
      lines.push(`**Item title:** ${inlineText(result.item_title)}`);
    if (result.date) lines.push(`**Date:** ${inlineText(result.date)}`);
    if (result.place_of_publication)
      lines.push(`**Place of publication:** ${inlineText(result.place_of_publication)}`);
    if (result.states) lines.push(`**States:** ${result.states.map(inlineText).join(', ')}`);
    if (result.edition) lines.push(`**Edition:** ${inlineText(result.edition)}`);
    if (result.sequence !== undefined) {
      const ofTotal = result.segment_count !== undefined ? ` of ${result.segment_count}` : '';
      lines.push(`**Sequence:** ${result.sequence}${ofTotal}`);
    } else if (result.segment_count !== undefined) {
      lines.push(`**Pages in issue:** ${result.segment_count}`);
    }
    lines.push(`**OCR available:** ${result.ocr_available ? 'Yes' : 'No'}`);
    if (result.match_count !== undefined) lines.push(`**Match count:** ${result.match_count}`);
    result.matches?.forEach((passage, i) => {
      lines.push('', `**Passage ${i + 1}**`, fencedText(passage));
    });
    if (result.ocr_available && result.ocr_text) {
      lines.push('', fencedText(result.ocr_text));
    } else if (!result.ocr_available) {
      lines.push(
        '\n_No digitized OCR text available for this page (image-only digitization batch)._',
      );
    }
    // The ocr_available-but-empty (retrieval miss) case is disclosed via ctx.enrich.notice in the
    // handler — appended to content[] as the enrichment trailer and mirrored into
    // structuredContent — so it isn't rendered here; doing both would double it on content[]. #31
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
