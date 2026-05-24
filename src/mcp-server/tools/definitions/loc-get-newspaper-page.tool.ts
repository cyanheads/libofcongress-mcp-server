/**
 * @fileoverview loc_get_newspaper_page tool — retrieve full OCR text for a specific newspaper page.
 * @module mcp-server/tools/definitions/loc-get-newspaper-page.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';

export const locGetNewspaperPage = tool('loc_get_newspaper_page', {
  title: 'Get Newspaper Page',
  description:
    'Retrieve the full OCR text of a specific historical newspaper page along with publication metadata. Pass the url field from a loc_search_newspapers result — do not construct this URL manually. OCR quality varies by digitization batch and era: 19th-century and degraded materials may contain fragmented text, garbled words, and line-break artifacts that are surfaced as-is. When a page exists but has no digitized text, ocr_available is false and ocr_text is empty — this is a data property, not an error.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    page_url: z
      .string()
      .describe(
        'The url field from a loc_search_newspapers result. Format: https://www.loc.gov/resource/sn{number}/{date-id}.{seq}/. Always pass the value directly from search results — do not construct or modify this URL.',
      ),
  }),
  output: z.object({
    page_url: z.string().describe('The LOC resource URL for this newspaper page.'),
    newspaper_title: z.string().optional().describe('Title of the newspaper publication.'),
    date: z.string().optional().describe('Issue publication date.'),
    state: z.string().optional().describe('State where the newspaper was published.'),
    edition: z.string().optional().describe('Edition or publication context identifier.'),
    sequence: z.number().optional().describe('Page sequence number within the issue.'),
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

  errors: [
    {
      reason: 'page_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The URL does not resolve to a valid LOC newspaper page resource.',
      recovery:
        'Re-run loc_search_newspapers to get a fresh url from current results. Do not modify or guess page URLs.',
    },
    {
      reason: 'rate_limit_exceeded',
      code: JsonRpcErrorCode.ServiceUnavailable,
      when: 'LOC API rate limit exceeded; requests are blocked for approximately 1 hour.',
      recovery:
        'Wait approximately 1 hour before retrying. Reduce request frequency to stay under 20 req/min.',
    },
  ],

  handler(input, ctx) {
    ctx.log.info('loc_get_newspaper_page', { page_url: input.page_url });
    const svc = getLocApiService();
    return svc.getNewspaperPage(input.page_url, ctx);
  },

  format: (result) => {
    const lines: string[] = [];
    if (result.newspaper_title) lines.push(`# ${result.newspaper_title}`);
    lines.push(`**URL:** ${result.page_url}`);
    if (result.date) lines.push(`**Date:** ${result.date}`);
    if (result.state) lines.push(`**State:** ${result.state}`);
    if (result.edition) lines.push(`**Edition:** ${result.edition}`);
    if (result.sequence !== undefined) lines.push(`**Sequence:** ${result.sequence}`);
    lines.push(`**OCR available:** ${result.ocr_available ? 'Yes' : 'No'}`);
    if (result.ocr_available && result.ocr_text) {
      lines.push('\n---\n');
      lines.push(result.ocr_text);
    } else if (!result.ocr_available) {
      lines.push(
        '\n_No digitized OCR text available for this page (image-only digitization batch)._',
      );
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
