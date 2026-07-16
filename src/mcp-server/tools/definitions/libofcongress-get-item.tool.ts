/**
 * @fileoverview libofcongress_get_item tool — retrieve full metadata for a LOC digital item.
 * @module mcp-server/tools/definitions/libofcongress-get-item.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';

export const locGetItem = tool('libofcongress_get_item', {
  title: 'Get LOC Item',
  description:
    'Retrieve the full metadata record for a specific LOC digital item. Returns contributors, subjects, summary, languages, locations, rights information, physical description, call number, original and online formats, access restrictions, former catalog IDs, notes, related items, and links to digital resources (TIFF, JPEG, PDF) for items with digital surrogates. Use after libofcongress_search on a result whose is_item is true. Pass the result id verbatim — it may be a simple ID or a slash-separated newspaper path; do not prepend the loc.gov URL. Non-item results (is_item: false) — collections, exhibits, guides, newspaper pages — have no item record and cannot be retrieved here.',
  annotations: { readOnlyHint: true, openWorldHint: true },
  input: z.object({
    item_id: z
      .string()
      .min(1)
      .describe(
        'LOC item id from a libofcongress_search result\'s "id" field (where is_item is true). A simple ID ("2009632251", "loc.pnp.ppmsc.02404") or a slash-separated path for newspaper pages ("sn95047246/1935-09-05/ed-1"). Pass the id verbatim; do not prepend the loc.gov URL or an "item/" prefix.',
      ),
  }),
  output: z.object({
    item_id: z
      .string()
      .describe('LOC item ID as resolved by the service (matches the input item_id).'),
    title: z.string().describe('Item title.'),
    date: z.string().optional().describe('Publication or creation date.'),
    contributors: z
      .array(z.string())
      .describe('Names of contributors, creators, or photographers.'),
    subject_headings: z.array(z.string()).describe('LCSH subject headings assigned to this item.'),
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
        'Verify the ID from libofcongress_search results. IDs are not guessable — use libofcongress_search to find a valid ID.',
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
    ctx.log.info('libofcongress_get_item', { item_id: input.item_id });
    const svc = getLocApiService();
    try {
      return await svc.getItem(input.item_id, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('item_not_found', err.message, { itemId: input.item_id });
      }
      if (err instanceof McpError && err.code === JsonRpcErrorCode.RateLimited) {
        throw ctx.fail('rate_limit_exceeded', err.message);
      }
      throw err;
    }
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
    if (result.languages.length > 0) lines.push(`**Languages:** ${result.languages.join(', ')}`);
    if (result.locations.length > 0) lines.push(`**Locations:** ${result.locations.join(', ')}`);
    if (result.summary) lines.push(`**Summary:** ${result.summary}`);
    if (result.physical_description)
      lines.push(`**Physical description:** ${result.physical_description}`);
    if (result.original_formats.length > 0)
      lines.push(`**Original format:** ${result.original_formats.join(', ')}`);
    if (result.online_formats.length > 0)
      lines.push(`**Online format:** ${result.online_formats.join(', ')}`);
    if (result.call_number) lines.push(`**Call number:** ${result.call_number}`);
    if (result.access_restricted !== undefined)
      lines.push(`**Access restricted:** ${result.access_restricted ? 'yes' : 'no'}`);
    if (result.rights_information) lines.push(`**Rights:** ${result.rights_information}`);
    if (result.former_ids.length > 0) lines.push(`**Former IDs:** ${result.former_ids.join(', ')}`);
    if (result.notes.length > 0) {
      lines.push('**Notes:**');
      for (const note of result.notes) lines.push(`- ${note}`);
    }
    // Both lists render in full: a content[]-only client (Claude Desktop) sees nothing but
    // content[], so any entry omitted here is unreachable for it while structuredContent
    // clients get the whole array. An overflow count discloses the gap without closing it.
    if (result.resource_links.length > 0) {
      lines.push(`**Digital resources (${result.resource_links.length}):**`);
      for (const link of result.resource_links) lines.push(`- ${link}`);
    }
    if (result.related_items.length > 0) {
      lines.push(`**Related items:** ${result.related_items.join(', ')}`);
    }
    lines.push(`**URL:** ${result.url}`);
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
