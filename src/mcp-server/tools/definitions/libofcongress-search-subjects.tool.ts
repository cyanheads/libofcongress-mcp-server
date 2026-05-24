/**
 * @fileoverview libofcongress_search_subjects tool — search Library of Congress Subject Headings (LCSH).
 * @module mcp-server/tools/definitions/libofcongress-search-subjects.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getLcLinkedDataService } from '@/services/lc-linked-data/lc-linked-data-service.js';

export const locSearchSubjects = tool('libofcongress_search_subjects', {
  title: 'Search LC Subject Headings',
  description:
    'Search Library of Congress Subject Headings (LCSH) by keyword. Returns controlled-vocabulary subject labels and their URIs. Use the returned label as the subject filter in libofcongress_search — LCSH uses precise, standardized terms that differ from natural language (e.g., "World War, 1939-1945" not "World War II"; "Photography, Aerial" not "Aerial photography"). Running this tool before a subject-filtered libofcongress_search dramatically improves result quality.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    query: z
      .string()
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
    message: z
      .string()
      .optional()
      .describe(
        'Recovery hint when results are empty — suggests alternative search strategies. Absent on non-empty result pages.',
      ),
  }),

  errors: [
    {
      reason: 'empty_results',
      code: JsonRpcErrorCode.NotFound,
      when: 'No LCSH headings matched the query.',
      recovery:
        'Try broader or different terms. LCSH uses inverted forms for many headings (e.g., "Photography, Aerial" not "Aerial photography").',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('libofcongress_search_subjects', { query: input.query, limit: input.limit });
    const svc = getLcLinkedDataService();
    const subjects = await svc.searchSubjects(input.query, input.limit, ctx);

    if (subjects.length === 0) {
      return {
        subjects: [],
        total: 0,
        message: `No LCSH headings matched "${input.query}". Try broader or different terms. LCSH uses inverted forms for many headings — for example, "Photography, Aerial" instead of "Aerial photography", or "World War, 1939-1945" instead of "World War II".`,
      };
    }

    return {
      subjects,
      total: subjects.length,
    };
  },

  format: (result) => {
    const lines: string[] = [];
    lines.push(`**${result.total} subject heading(s) found**`);
    if (result.message) lines.push(`\n> ${result.message}`);
    for (const s of result.subjects) {
      lines.push(`\n## ${s.label}`);
      lines.push(`**URI:** ${s.uri}`);
      if (s.count !== undefined) lines.push(`**Items:** ${s.count}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
