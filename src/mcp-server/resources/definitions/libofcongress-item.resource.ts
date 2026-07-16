/**
 * @fileoverview libofcongress://item/{+item_id} resource — stable LOC item metadata URI for agent context injection.
 * @module mcp-server/resources/definitions/libofcongress-item.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';

/**
 * `{+item_id}` is an RFC 6570 reserved expansion, which the SDK compiles to the match
 * pattern `(.+)` instead of `([^/,]+)`. Plain `{item_id}` excludes `/` by construction, so
 * multi-segment newspaper IDs (`sn95047246/1935-09-05/ed-1`) — which libofcongress_get_item
 * accepts — could never match a URI here.
 */
export const locItemResource = resource('libofcongress://item/{+item_id}', {
  name: 'loc-item',
  title: 'LOC Item',
  description:
    'LOC digital item metadata by ID. Returns the same full record as libofcongress_get_item. Item IDs with internal slashes (newspaper pages) are written with their slashes intact: libofcongress://item/sn95047246/1935-09-05/ed-1. Use libofcongress_search to discover item IDs first.',
  mimeType: 'application/json',
  params: z.object({
    item_id: z
      .string()
      .describe(
        'LOC item ID (e.g., "loc.pnp.ppmsc.02404" or "2009632251"). Same ID as in libofcongress_search result "id" field. Multi-segment newspaper IDs ("sn95047246/1935-09-05/ed-1") are supported — write the slashes literally rather than percent-encoding them.',
      ),
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

  async handler(params, ctx) {
    ctx.log.debug('libofcongress://item resource', { item_id: params.item_id });
    const svc = getLocApiService();
    // The SDK's template match captures the raw substring without decoding it, so a
    // percent-encoded ID still reads as literal "%2F" text here. Decode once to hand
    // getItem() real slashes to split on — a no-op for the canonical raw-slash form,
    // which carries no escape sequences.
    const itemId = decodeURIComponent(params.item_id);
    try {
      return await svc.getItem(itemId, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('item_not_found', err.message, { itemId });
      }
      if (err instanceof McpError && err.code === JsonRpcErrorCode.RateLimited) {
        throw ctx.fail('rate_limit_exceeded', err.message);
      }
      throw err;
    }
  },
});
