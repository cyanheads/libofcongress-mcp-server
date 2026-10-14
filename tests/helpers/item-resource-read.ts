/**
 * @fileoverview Reads the item resource through the production resource factory and returns the
 * JSON-RPC `error` a client receives — the surface where a declared `errors[]` recovery is filled.
 * @module tests/helpers/item-resource-read
 */

import { createWorkerHandler } from '@cyanheads/mcp-ts-core/worker';
import { locItemResource } from '@/mcp-server/resources/definitions/libofcongress-item.resource.js';

const PROTOCOL_VERSION = '2026-07-28';

type WorkerHandler = ReturnType<typeof createWorkerHandler>;

/**
 * Reads `uri` through the production resource factory, served by `createWorkerHandler`, and
 * returns the JSON-RPC `error` the client receives. Calling `handler()` directly skips the
 * factory, which is where a declared `errors[]` recovery hint is filled in.
 */
export async function readItemResourceError(uri: string): Promise<Record<string, unknown>> {
  const worker = createWorkerHandler({
    name: 'libofcongress-mcp-server',
    title: 'libofcongress-mcp-server',
    resources: [locItemResource],
  });
  const response = await worker.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
        'Mcp-Method': 'resources/read',
        'Mcp-Name': uri,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: {
          uri,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientInfo': { name: 'resource-test', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
    {} as Parameters<WorkerHandler['fetch']>[1],
    { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as Parameters<
      WorkerHandler['fetch']
    >[2],
  );
  const text = await response.text();
  const payload =
    text.startsWith('event:') || text.startsWith('data:')
      ? text
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n')
      : text;
  return (JSON.parse(payload) as { error: Record<string, unknown> }).error;
}
