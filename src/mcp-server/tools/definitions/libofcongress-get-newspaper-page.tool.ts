/**
 * @fileoverview libofcongress_get_newspaper_page tool — retrieve full OCR text for a specific newspaper page.
 * @module mcp-server/tools/definitions/libofcongress-get-newspaper-page.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';

const LOC_PAGE_URL_PREFIX = 'https://www.loc.gov/resource/';

export const locGetNewspaperPage = tool('libofcongress_get_newspaper_page', {
  title: 'Get Newspaper Page',
  description:
    "Retrieve the full OCR text of a specific historical newspaper page along with publication metadata — newspaper title, issue date, place of publication, indexed states, edition, the page's sequence, and the issue's page count. Pass the url field from a libofcongress_search_newspapers result — do not construct this URL manually. OCR quality varies by digitization batch and era: 19th-century and degraded materials may contain fragmented text, garbled words, and line-break artifacts that are surfaced as-is. When a page exists but has no digitized text, ocr_available is false and ocr_text is empty — this is a data property, not an error.",
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    page_url: z
      .string()
      .describe(
        'The url field from a libofcongress_search_newspapers result (e.g., "https://www.loc.gov/resource/sn83045462/1905-03-15/ed-1/seq-1/"). Always pass the value directly from search results — do not construct or modify this URL.',
      ),
  }),
  output: z.object({
    page_url: z.string().describe('The LOC resource URL for this newspaper page.'),
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
    sequence: z.number().optional().describe('Page sequence number within the issue.'),
    segment_count: z
      .number()
      .optional()
      .describe('Number of pages in the issue. Absent when LOC gives none.'),
    ocr_text: z
      .string()
      .describe(
        'Full plain-text OCR content for the page. Empty string when ocr_available is false. May contain fragmented words, line-break artifacts, and misspellings inherent to historical OCR — do not attempt to repair.',
      ),
    ocr_available: z
      .boolean()
      .describe(
        'True when digitized OCR text exists for this page. False for image-only digitization batches where OCR has not been applied.',
      ),
  }),

  // Agent-facing retrieval-state disclosure. Reaches structuredContent and content[] identically,
  // so a structured client sees the same fact format() would otherwise render only into text.
  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Set when ocr_available is true but ocr_text is empty — the page has digitized OCR, but the text service did not return it this call. Distinguishes a transient retrieval miss from a genuinely image-only page (where ocr_available is false). Absent when OCR text was returned or the page has no OCR.',
      ),
  },

  errors: [
    {
      reason: 'invalid_page_url',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      when: 'page_url does not begin with https://www.loc.gov/resource/.',
      recovery:
        'Pass the url field from a libofcongress_search_newspapers result verbatim. Do not construct, shorten, or edit page URLs.',
    },
    {
      reason: 'page_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The URL does not resolve to a valid LOC newspaper page resource.',
      recovery:
        'Re-run libofcongress_search_newspapers to get a fresh url from current results. Do not modify or guess page URLs.',
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
    ctx.log.info('libofcongress_get_newspaper_page', { page_url: input.page_url });

    // Validate before any outbound request: must be a well-formed URL on www.loc.gov/resource/
    if (!input.page_url.startsWith(LOC_PAGE_URL_PREFIX)) {
      throw ctx.fail('invalid_page_url', `page_url must begin with ${LOC_PAGE_URL_PREFIX}.`, {
        field: 'page_url',
        received: input.page_url,
        ...ctx.recoveryFor('invalid_page_url'),
      });
    }

    const svc = getLocApiService();
    let result: Awaited<ReturnType<typeof svc.getNewspaperPage>>;
    try {
      result = await svc.getNewspaperPage(input.page_url, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('page_not_found', `No LOC newspaper page resolves at "${input.page_url}".`, {
          pageUrl: input.page_url,
          ...ctx.recoveryFor('page_not_found'),
        });
      }
      if (err instanceof McpError && err.code === JsonRpcErrorCode.RateLimited) {
        // The service's data carries the time left on the block; it overrides the contract's
        // static "about an hour" hint, which stays as the fallback.
        throw ctx.fail('rate_limit_exceeded', err.message, {
          ...ctx.recoveryFor('rate_limit_exceeded'),
          ...err.data,
        });
      }
      throw err;
    }

    // ocr_available true with empty ocr_text means the secondary OCR-text fetch came back empty —
    // a retrieval miss, not an image-only page. structuredContent alone shows ocr_available:true,
    // ocr_text:"" (ambiguous), so disclose the state as a notice reaching both surfaces. See #31.
    if (result.ocr_available && !result.ocr_text) {
      ctx.enrich.notice(
        'OCR is digitized for this page, but the full text was not returned this call. Retry libofcongress_get_newspaper_page; a persistent empty result means the OCR text service is temporarily unavailable.',
      );
    }

    return result;
  },

  format: (result) => {
    const lines: string[] = [];
    if (result.newspaper_title) lines.push(`# ${result.newspaper_title}`);
    lines.push(`**URL:** ${result.page_url}`);
    if (result.date) lines.push(`**Date:** ${result.date}`);
    if (result.place_of_publication)
      lines.push(`**Place of publication:** ${result.place_of_publication}`);
    if (result.states) lines.push(`**States:** ${result.states.join(', ')}`);
    if (result.edition) lines.push(`**Edition:** ${result.edition}`);
    if (result.sequence !== undefined) {
      const ofTotal = result.segment_count !== undefined ? ` of ${result.segment_count}` : '';
      lines.push(`**Sequence:** ${result.sequence}${ofTotal}`);
    } else if (result.segment_count !== undefined) {
      lines.push(`**Pages in issue:** ${result.segment_count}`);
    }
    lines.push(`**OCR available:** ${result.ocr_available ? 'Yes' : 'No'}`);
    if (result.ocr_available && result.ocr_text) {
      lines.push('\n---\n');
      lines.push(result.ocr_text);
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
