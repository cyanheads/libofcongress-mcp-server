/**
 * @fileoverview libofcongress://item/{item_id} resource — stable LOC item metadata URI for agent context injection.
 * @module mcp-server/resources/definitions/libofcongress-item.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';

export const locItemResource = resource('libofcongress://item/{item_id}', {
  name: 'loc-item',
  title: 'LOC Item',
  description:
    'LOC digital item metadata by ID. Stable URI for injecting item context into agent conversations. Returns the same full record as libofcongress_get_item. Use libofcongress_search to discover item IDs first.',
  mimeType: 'application/json',
  params: z.object({
    item_id: z
      .string()
      .describe(
        'LOC item ID (e.g., "loc.pnp.ppmsc.02404" or "2009632251"). Same ID as in libofcongress_search result "id" field.',
      ),
  }),

  handler(params, ctx) {
    ctx.log.debug('libofcongress://item resource', { item_id: params.item_id });
    const svc = getLocApiService();
    // Service throws notFound when the item doesn't exist — let it bubble.
    return svc.getItem(params.item_id, ctx);
  },
});
