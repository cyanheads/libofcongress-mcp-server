/**
 * @fileoverview libofcongress_search_subjects tool — search Library of Congress Subject Headings (LCSH).
 * @module mcp-server/tools/definitions/libofcongress-search-subjects.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { noticeWriter, renderNotice } from '@/mcp-server/tools/notices.js';
import { inlineText } from '@/mcp-server/tools/render-text.js';
import { getLcLinkedDataService } from '@/services/lc-linked-data/lc-linked-data-service.js';

/** Most headings one call returns, matching id.loc.gov's page cap. */
const MAX_HEADINGS_PER_CALL = 250;

export const locSearchSubjects = tool('libofcongress_search_subjects', {
  title: 'Search LC Subject Headings',
  description:
    'Search Library of Congress Subject Headings (LCSH) by keyword. Returns authorized subject headings and their URIs in a stable paged order, promoting an exact match from the first 50 results to the start; a partial word with no keyword match returns the headings that begin with it. Use the returned label as the subject filter in libofcongress_search_items — LCSH uses precise, standardized terms that differ from natural language (e.g., "World War, 1939-1945" not "World War II"; "Aerial photography" not "Photography, Aerial"). Running this tool before a subject-filtered libofcongress_search_items dramatically improves result quality.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Keyword or partial subject heading to search for (e.g., "civil war", "immigration", "jazz").',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(10)
      .describe(
        'Maximum number of subject headings to return. Default 10. A call returns at most 250 headings; a larger limit (up to 1000) returns up to 250.',
      ),
    offset: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - MAX_HEADINGS_PER_CALL)
      .default(0)
      .describe(
        'Zero-based position in the matching headings. Continue with next_offset from the previous response.',
      ),
  }),
  output: z.object({
    subjects: z
      .array(
        z
          .object({
            label: z
              .string()
              .describe(
                'Standardized LCSH heading — use this exact string in the libofcongress_search_items subject filter.',
              ),
            uri: z
              .string()
              .describe('Stable LOC URI identifying this subject heading in the authority file.'),
          })
          .describe('A single LCSH subject heading record.'),
      )
      .describe(
        'A page of matching LCSH headings in the same order across offsets and limits. An exact match from the initial 50 entries is promoted to the start. To see how many LOC items carry a heading, pass its label as the libofcongress_search_items subject filter and read total.',
      ),
    total: z.number().describe('Number of subject headings returned.'),
    next_offset: z
      .number()
      .optional()
      .describe('Zero-based position to request next. Absent on the final or past-end page.'),
  }),

  // Agent-facing success-path context — query echo, truncation disclosure, and empty-result
  // guidance. Reaches both structuredContent and content[] automatically; kept out of the
  // domain output.
  enrichment: {
    effectiveQuery: z
      .string()
      .describe(
        'The query as submitted to the id.loc.gov subject suggest endpoint, after trimming.',
      ),
    truncated: z
      .boolean()
      .optional()
      .describe(
        'True when another page follows. Continue with next_offset to see the remaining headings.',
      ),
    shown: z.number().optional().describe('Number of subject headings returned in this response.'),
    cap: z.number().optional().describe('The heading limit applied to this response.'),
    effectiveLimit: z
      .number()
      .optional()
      .describe(
        'The heading count actually applied when limit exceeded the per-call cap of 250. Absent when limit was within the cap.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Continuation instructions, a past-end or no-match recovery hint, and disclosure of a capped limit. Absent on an uncapped final page.',
      ),
  },

  enrichmentTrailer: { notice: { render: renderNotice } },

  errors: [
    {
      reason: 'request_timed_out',
      code: JsonRpcErrorCode.Timeout,
      when: 'The Library of Congress subject heading service did not respond within the 50-second request budget.',
      recovery:
        'Retry in a few minutes; the Library of Congress subject heading service is responding slowly.',
    },
    {
      reason: 'upstream_unavailable',
      code: JsonRpcErrorCode.ServiceUnavailable,
      thrownBy: 'service',
      when: 'The Library of Congress subject heading service could not be reached, or answered with an error status, an HTML page, or an unreadable response instead of its JSON.',
      recovery:
        'Retry in a few minutes; the Library of Congress subject heading service is temporarily unavailable.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('libofcongress_search_subjects', { query: input.query, limit: input.limit });
    const limit = Math.min(input.limit, MAX_HEADINGS_PER_CALL);
    const svc = getLcLinkedDataService();
    let result: Awaited<ReturnType<typeof svc.searchSubjects>>;
    try {
      result = await svc.searchSubjects(input.query, limit, ctx, input.offset);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.Timeout) {
        throw ctx.fail('request_timed_out', err.message);
      }
      throw err;
    }
    const { subjects, matchCount, nextOffset } = result;
    const addNotice = noticeWriter(ctx);

    ctx.enrich.echo(input.query);
    if (limit < input.limit) {
      ctx.enrich({ effectiveLimit: limit });
      addNotice(
        `Requested limit ${input.limit} exceeds the per-call cap of ${MAX_HEADINGS_PER_CALL} headings.`,
      );
    }

    if (matchCount > 0 && input.offset >= matchCount) {
      addNotice(
        `Offset ${input.offset} is past the ${matchCount} matching headings. Request offset 0 to start again.`,
      );
      return { subjects: [], total: 0 };
    }
    if (matchCount === 0) {
      addNotice(
        `No LCSH headings matched "${input.query}". Try broader or different terms. LCSH words headings in its own standardized form — for example, "World War, 1939-1945" rather than "World War II", and "Aerial photography" rather than "Photography, Aerial".`,
      );
      return { subjects: [], total: 0 };
    }

    if (nextOffset !== undefined) {
      // The truncation fields without `ctx.enrich.truncated`, which would overwrite the notice.
      ctx.enrich({ truncated: true, shown: subjects.length, cap: limit });
      addNotice(
        `Showing ${subjects.length} of ${matchCount} matching headings at offset ${input.offset}. Request offset ${nextOffset} with limit ${limit} to continue.`,
      );
    }

    return {
      subjects,
      total: subjects.length,
      ...(nextOffset !== undefined && { next_offset: nextOffset }),
    };
  },

  format: (result) => {
    const lines: string[] = [];
    lines.push(`**${result.total} subject heading(s) found**`);
    if (result.next_offset !== undefined) lines.push(`Next offset: ${result.next_offset}`);
    // Labels are id.loc.gov's raw text, escaped for the heading; the URI renders as sent.
    for (const s of result.subjects) {
      lines.push(`\n## ${inlineText(s.label)}`);
      lines.push(`**URI:** ${s.uri}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
