/**
 * @fileoverview loc_get_item tool — retrieve full metadata for a LOC digital item.
 * @module mcp-server/tools/definitions/loc-get-item.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';

export const locGetItem = tool('loc_get_item', {
  title: 'Get LOC Item',
  description:
    'Retrieve the full metadata record for a specific LOC digital item. Returns contributors, subjects, rights information, physical description, notes, related items, and links to digital resources (TIFF, JPEG, PDF) for items with digital surrogates. Use after loc_search to get complete details on a result. Pass the bare item ID from the search result — do not include URL path segments.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    item_id: z
      .string()
      .min(1)
      .describe(
        'LOC item ID from a loc_search result\'s "id" field (e.g., "loc.pnp.ppmsc.02404" or "2009632251"). Pass the bare ID only — no URL path segments.',
      ),
  }),
  output: z.object({
    item_id: z.string().describe('The LOC item ID.'),
    title: z.string().describe('Item title.'),
    date: z.string().optional().describe('Publication or creation date.'),
    contributors: z
      .array(z.string())
      .describe('Names of contributors, creators, or photographers.'),
    subject_headings: z.array(z.string()).describe('LCSH subject headings assigned to this item.'),
    notes: z.array(z.string()).describe('Descriptive notes and annotations from catalogers.'),
    rights_information: z
      .string()
      .optional()
      .describe('Rights and reproduction statement for this item.'),
    physical_description: z
      .string()
      .optional()
      .describe('Physical or technical description of the original item.'),
    resource_links: z
      .array(z.string())
      .describe(
        'URLs to downloadable digital files (TIFF, JPEG, PDF). Empty when no digital surrogate exists.',
      ),
    related_items: z
      .array(z.string())
      .describe('IDs or URLs of related LOC items for follow-up retrieval.'),
    url: z.string().describe('Canonical LOC item URL.'),
  }),

  errors: [
    {
      reason: 'item_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No item exists for the given ID.',
      recovery:
        'Verify the ID from loc_search results. IDs are not guessable — use loc_search to find a valid ID.',
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
    ctx.log.info('loc_get_item', { item_id: input.item_id });
    const svc = getLocApiService();
    return svc.getItem(input.item_id, ctx);
  },

  format: (result) => {
    const lines: string[] = [];
    lines.push(`# ${result.title}`);
    lines.push(`**ID:** ${result.item_id}`);
    if (result.date) lines.push(`**Date:** ${result.date}`);
    if (result.contributors.length > 0)
      lines.push(`**Contributors:** ${result.contributors.join(', ')}`);
    if (result.subject_headings.length > 0)
      lines.push(`**Subjects:** ${result.subject_headings.join(', ')}`);
    if (result.physical_description)
      lines.push(`**Physical description:** ${result.physical_description}`);
    if (result.rights_information) lines.push(`**Rights:** ${result.rights_information}`);
    if (result.notes.length > 0) {
      lines.push('**Notes:**');
      for (const note of result.notes) lines.push(`- ${note}`);
    }
    if (result.resource_links.length > 0) {
      lines.push(`**Digital resources (${result.resource_links.length}):**`);
      for (const link of result.resource_links.slice(0, 5)) lines.push(`- ${link}`);
      if (result.resource_links.length > 5)
        lines.push(`- … and ${result.resource_links.length - 5} more`);
    }
    if (result.related_items.length > 0) {
      lines.push(`**Related items:** ${result.related_items.slice(0, 5).join(', ')}`);
      if (result.related_items.length > 5)
        lines.push(`- … and ${result.related_items.length - 5} more`);
    }
    lines.push(`**URL:** ${result.url}`);
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
