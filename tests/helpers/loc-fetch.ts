/**
 * @fileoverview A `fetch` stub that answers each LOC host with one JSON body, matched by exact
 * hostname; a request to any other host rejects.
 * @module tests/helpers/loc-fetch
 */

import { type Mock, vi } from 'vitest';

/**
 * Stubs global `fetch` to answer each host in `bodies` (e.g. `www.loc.gov`, `tile.loc.gov`,
 * `id.loc.gov`) with its body as JSON, and returns the stub. Unlisted hosts reject.
 */
export function serveByHost(
  bodies: Record<string, unknown>,
): Mock<(url: string | URL) => Promise<Response>> {
  const fetchSpy = vi.fn(async (url: string | URL) => {
    const { hostname } = new URL(String(url));
    if (!Object.hasOwn(bodies, hostname)) throw new Error(`unmocked fetch: ${hostname}`);
    return new Response(JSON.stringify(bodies[hostname]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}
