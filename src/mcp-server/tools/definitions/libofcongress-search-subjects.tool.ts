/**
 * @fileoverview libofcongress_search_subjects tool — search Library of Congress Subject Headings (LCSH).
 * @module mcp-server/tools/definitions/libofcongress-search-subjects.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import {
  getLcLinkedDataService,
  SUGGEST_MAX_COUNT,
} from '@/services/lc-linked-data/lc-linked-data-service.js';

export const locSearchSubjects = tool('libofcongress_search_subjects', {
  title: 'Search LC Subject Headings',
  description:
    'Search Library of Congress Subject Headings (LCSH) by keyword. Returns controlled-vocabulary subject labels and their URIs. Use the returned label as the subject filter in libofcongress_search — LCSH uses precise, standardized terms that differ from natural language (e.g., "World War, 1939-1945" not "World War II"; "Photography, Aerial" not "Aerial photography"). Running this tool before a subject-filtered libofcongress_search dramatically improves result quality.',
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
      .max(50)
      .default(10)
      .describe('Maximum number of subject headings to return. Default 10, max 50.'),
  }),
  output: z.object({
    subjects: z
      .array(
        z
          .object({
            label: z
              .string()
              .describe(
                'Standardized LCSH heading — use this exact string in the libofcongress_search subject filter.',
              ),
            uri: z
              .string()
              .describe('Stable LOC URI identifying this subject heading in the authority file.'),
            count: z
              .number()
              .optional()
              .describe(
                'Approximate number of LOC items carrying this heading. Omitted when unavailable.',
              ),
          })
          .describe('A single LCSH subject heading record.'),
      )
      .describe('LCSH subject headings matching the query, ordered by relevance.'),
    total: z.number().describe('Number of subject headings returned.'),
  }),

  // Agent-facing success-path context — query echo, truncation disclosure, and empty-result
  // guidance. Reaches both structuredContent and content[] automatically; kept out of the
  // domain output.
  enrichment: {
    effectiveQuery: z
      .string()
      .describe(
        'The keyword query as submitted to the id.loc.gov suggest endpoint, after trimming.',
      ),
    truncated: z
      .boolean()
      .optional()
      .describe(
        'True when results were capped at the requested limit. Increase limit or refine the query to surface additional headings.',
      ),
    shown: z.number().optional().describe('Number of subject headings returned in this response.'),
    cap: z
      .number()
      .optional()
      .describe('The limit applied to this response — maximum headings the API will return.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty, or when the upstream candidate cap under-filled the request. Distinguishes "exhausted by ranking" (retry with a more specific query) from "no LCSH coverage", and suggests inverted-form strategies. Absent when the full requested set was returned.',
      ),
  },

  async handler(input, ctx) {
    ctx.log.info('libofcongress_search_subjects', { query: input.query, limit: input.limit });
    const svc = getLcLinkedDataService();
    const { subjects, matchCount, poolCapReached } = await svc.searchSubjects(
      input.query,
      input.limit,
      ctx,
    );

    ctx.enrich.echo(input.query);

    if (subjects.length === 0) {
      ctx.enrich.notice(
        poolCapReached
          ? `No LCSH heading surfaced for "${input.query}" within the top ${SUGGEST_MAX_COUNT} id.loc.gov suggestions — the endpoint ranks name-authority and other non-subject records ahead of subject headings and caps its candidate pool, so a heading may exist but rank below the cutoff. Use a more specific query, or the LCSH inverted form (e.g. "Photography, Aerial" for "aerial photography").`
          : `No LCSH headings matched "${input.query}". Try broader or different terms. LCSH uses inverted forms for many headings — for example, "Photography, Aerial" instead of "Aerial photography", or "World War, 1939-1945" instead of "World War II".`,
      );
      return { subjects: [], total: 0 };
    }

    if (matchCount > input.limit) {
      ctx.enrich.truncated({
        shown: subjects.length,
        cap: input.limit,
        guidance: 'Increase limit or refine the query to surface additional headings.',
      });
    } else if (poolCapReached && subjects.length < input.limit) {
      // Under-filled because the candidate pool was exhausted by non-subject ranking, not for lack
      // of coverage — disclose the deterministic recovery path (a more specific query).
      ctx.enrich.notice(
        `Returned ${subjects.length} LCSH heading(s), fewer than the requested ${input.limit}. The id.loc.gov suggest pool (capped at ${SUGGEST_MAX_COUNT} candidates) was exhausted by non-subject records ranked ahead, so additional headings may exist beyond it. Use a more specific query to surface them.`,
      );
    }

    return {
      subjects,
      total: subjects.length,
    };
  },

  format: (result) => {
    const lines: string[] = [];
    lines.push(`**${result.total} subject heading(s) found**`);
    for (const s of result.subjects) {
      lines.push(`\n## ${s.label}`);
      lines.push(`**URI:** ${s.uri}`);
      if (s.count !== undefined) lines.push(`**Items:** ${s.count}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
