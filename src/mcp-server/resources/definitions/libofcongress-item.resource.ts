/**
 * @fileoverview libofcongress://item/{+item_id} resource — stable LOC item metadata URI for agent context injection.
 * @module mcp-server/resources/definitions/libofcongress-item.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getLocApiService } from '@/services/loc-api/loc-api-service.js';
import { normalizeItemId } from '@/services/loc-api/loc-urls.js';

/**
 * `value` percent-decoded, or undefined when an escape is malformed — a truncated escape
 * (`%E0%A4%A`), a lone `%`, or bytes that are not UTF-8 — where `decodeURIComponent` throws.
 */
function percentDecoded(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return;
  }
}

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
    'LOC digital item metadata by ID. Returns the same full record as libofcongress_get_item with its default page window: the first 50 pages, without per-page files. When next_page_offset is present, call libofcongress_get_item with page_offset to list the rest. Item IDs with internal slashes (newspaper pages) are written with their slashes intact: libofcongress://item/sn95047246/1935-09-05/ed-1. Use libofcongress_search_items to discover item IDs first.',
  mimeType: 'application/json',
  params: z.object({
    item_id: z
      .string()
      .describe(
        'LOC item ID (e.g., "2005691065" or "2009632251"). Same ID as in libofcongress_search_items result "id" field. Multi-segment newspaper IDs ("sn95047246/1935-09-05/ed-1") are supported — write the slashes literally rather than percent-encoding them. A loc.gov item link or an lccn.loc.gov permalink ("https://lccn.loc.gov/2005567251") is read as its id, a permalink LCCN in normalized form ("lccn.loc.gov/2005-568294" reads as 2005568294).',
      ),
  }),

  errors: [
    {
      reason: 'invalid_item_id',
      code: JsonRpcErrorCode.ValidationError,
      retryable: false,
      when: 'item_id is not a LOC item ID, a loc.gov /item/ link, or an lccn.loc.gov permalink to an LCCN: a URL on another loc.gov or lccn.loc.gov path or another host, an LCCN that does not normalize to up to three lowercase letters and 8 or 10 digits, or text with characters or segments no LOC ID has.',
      recovery:
        'Use the id from a libofcongress_search_items result, written with its slashes intact (libofcongress://item/sn95047246/1935-09-05/ed-1), or a loc.gov item link or lccn.loc.gov permalink in its place; blanks and a hyphen in a permalink LCCN are normalized. An LCCN that still fails is malformed: find the item with libofcongress_search_items.',
    },
    {
      reason: 'item_not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No item exists for the given ID.',
      recovery:
        'Verify the ID from libofcongress_search_items results. IDs are not guessable — use libofcongress_search_items to find a valid ID.',
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
      when: "More Library of Congress requests are queued on this server than can start within this read's time budget.",
      recovery:
        'Wait the number of seconds given in retryAfter, then retry. Send requests to this server one at a time rather than in parallel.',
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

  async handler(params, ctx) {
    ctx.log.debug('libofcongress://item resource', { item_id: params.item_id });
    const svc = getLocApiService();
    // The SDK's template match captures the raw substring without decoding it, so a
    // percent-encoded ID still reads as literal "%2F" text here. Decode once to hand
    // getItem() real slashes to split on — a no-op for the canonical raw-slash form,
    // which carries no escape sequences.
    // The decoded ID then passes the get_item tool's check, so a dot segment or a foreign URL
    // never becomes a request path. A malformed escape decodes to nothing and fails the same way.
    const decoded = percentDecoded(params.item_id);
    const itemId = decoded === undefined ? undefined : normalizeItemId(decoded);
    if (itemId === undefined) {
      throw ctx.fail(
        'invalid_item_id',
        `"${params.item_id}" is not a LOC item ID, a loc.gov item link, or an LCCN permalink.`,
        { field: 'item_id', received: params.item_id },
      );
    }
    try {
      return await svc.getItem(itemId, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('item_not_found', `No LOC item has the ID "${itemId}".`, { itemId });
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
  },
});
