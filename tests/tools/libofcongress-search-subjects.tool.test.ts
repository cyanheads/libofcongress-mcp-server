/**
 * @fileoverview Tests for libofcongress_search_subjects tool.
 * @module tests/tools/libofcongress-search-subjects.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  getEnrichment,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locSearchSubjects } from '@/mcp-server/tools/definitions/libofcongress-search-subjects.tool.js';
import { initLcLinkedDataService } from '@/services/lc-linked-data/lc-linked-data-service.js';

/**
 * The id.loc.gov suggest endpoint returns a 4-tuple:
 * [query, labels[], counts[], uris[]]
 */
function makeSuggestResponse(entries: Array<{ label: string; uri: string; count?: string }>) {
  const labels = entries.map((e) => e.label);
  const counts = entries.map((e) => e.count ?? '');
  const uris = entries.map((e) => e.uri);
  return JSON.stringify(['query', labels, counts, uris]);
}

function mockFetch(body: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('locSearchSubjects', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLcLinkedDataService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns subject headings for a keyword query', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSuggestResponse([
          {
            label: 'World War, 1939-1945',
            uri: 'http://id.loc.gov/authorities/subjects/sh85148273',
            count: '1500',
          },
          {
            label: 'World War, 1914-1918',
            uri: 'http://id.loc.gov/authorities/subjects/sh85148248',
            count: '800',
          },
        ]),
      ),
    );
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'world war' });
    const result = await locSearchSubjects.handler(input, ctx);

    expect(result.subjects).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.subjects[0].label).toBe('World War, 1939-1945');
    expect(result.subjects[0].uri).toBe('http://id.loc.gov/authorities/subjects/sh85148273');
    expect(result.subjects[0].count).toBe(1500);
    // Enrichment echoes query for both structuredContent and content[] clients
    const enrichment = getEnrichment(ctx);
    expect(enrichment.effectiveQuery).toBe('world war');
  });

  it('populates enrichment.notice and returns empty subjects when no results', async () => {
    vi.stubGlobal('fetch', mockFetch(makeSuggestResponse([])));
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'xyzzy_no_match' });
    const result = await locSearchSubjects.handler(input, ctx);

    expect(result.subjects).toHaveLength(0);
    expect(result.total).toBe(0);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toBeDefined();
    expect(String(enrichment.notice)).toContain('xyzzy_no_match');
    expect(enrichment.effectiveQuery).toBe('xyzzy_no_match');
  });

  it('omits count when upstream count string is empty', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSuggestResponse([
          {
            label: 'Photography, Aerial',
            uri: 'http://id.loc.gov/authorities/subjects/sh85101360',
            // count omitted
          },
        ]),
      ),
    );
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'aerial photo' });
    const result = await locSearchSubjects.handler(input, ctx);

    expect(result.subjects[0].count).toBeUndefined();
  });

  it('requests the full candidate cap regardless of limit and slices results to the requested limit', async () => {
    // The tool requests the endpoint's 50-candidate cap (not limit*3) so namespace filtering can
    // reach a heading ranked deep in the pool, then trims to `limit` (issue #25).
    const fetchSpy = mockFetch(
      makeSuggestResponse(
        Array.from({ length: 15 }, (_, i) => ({
          label: `Subject ${i}`,
          uri: `http://id.loc.gov/authorities/subjects/sh${i}`,
        })),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'music', limit: 5 });
    const result = await locSearchSubjects.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('count=50');
    expect(result.subjects).toHaveLength(5);
  });

  it('caps the count param at 50 for the suggest endpoint', async () => {
    const fetchSpy = mockFetch(makeSuggestResponse([]));
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'music', limit: 50 });
    await locSearchSubjects.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('count=50');
    expect(calledUrl).not.toContain('count=100');
  });

  it('discloses ranking exhaustion — not no-coverage — when the cap is all non-subjects (issue #25)', async () => {
    // 50 name-authority records, zero real headings: the empty-result notice must explain the
    // candidate-pool ranking exhaustion (recoverable via a more specific query), not the generic
    // "no coverage / try broader terms" message.
    const entries = Array.from({ length: 50 }, (_, i) => ({
      label: `Name authority ${i}`,
      uri: `http://id.loc.gov/authorities/names/no${i}`,
    }));
    vi.stubGlobal('fetch', mockFetch(makeSuggestResponse(entries)));
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'world war', limit: 3 });
    const result = await locSearchSubjects.handler(input, ctx);

    expect(result.subjects).toHaveLength(0);
    const enrichment = getEnrichment(ctx);
    expect(String(enrichment.notice)).toContain('candidate pool');
    expect(String(enrichment.notice)).not.toContain('Try broader or different terms');
  });

  it('under-fills below limit and discloses the pool-cap recovery path via notice (issue #25)', async () => {
    // 50 candidates, only 1 a real heading, limit 5: returns the 1 heading with a notice that more
    // may exist beyond the pool cap — the deterministic recovery disclosure, not a truncation.
    const entries = [
      {
        label: 'Civil War Campaign Medal',
        uri: 'http://id.loc.gov/authorities/subjects/sh90004165',
        count: '3',
      },
      ...Array.from({ length: 49 }, (_, i) => ({
        label: `Name authority ${i}`,
        uri: `http://id.loc.gov/authorities/names/no${i}`,
      })),
    ];
    vi.stubGlobal('fetch', mockFetch(makeSuggestResponse(entries)));
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'civil war', limit: 5 });
    const result = await locSearchSubjects.handler(input, ctx);

    expect(result.subjects).toHaveLength(1);
    expect(result.total).toBe(1);
    const enrichment = getEnrichment(ctx);
    expect(String(enrichment.notice)).toContain('fewer than the requested 5');
    expect(enrichment.truncated).toBeUndefined();
  });

  it('fires the truncated enrichment when in-pool matches exceed the requested limit', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      label: `Subject ${i}`,
      uri: `http://id.loc.gov/authorities/subjects/sh${i}`,
    }));
    vi.stubGlobal('fetch', mockFetch(makeSuggestResponse(entries)));
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'music', limit: 3 });
    const result = await locSearchSubjects.handler(input, ctx);

    expect(result.subjects).toHaveLength(3);
    const enrichment = getEnrichment(ctx);
    expect(enrichment.truncated).toBe(true);
    expect(enrichment.cap).toBe(3);
  });

  it('throws ServiceUnavailable on non-OK HTTP status, carrying no internal request URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Server Error', { status: 503 })),
    );
    const ctx = createMockContext({ errors: locSearchSubjects.errors });
    const input = locSearchSubjects.input.parse({ query: 'confidential-term' });
    const err = await locSearchSubjects.handler(input, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
    // The suggest URL embeds the caller's query — it must not surface in error data or message.
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('id.loc.gov');
    expect(JSON.stringify(data)).not.toContain('confidential-term');
    expect((err as Error).message).not.toContain('id.loc.gov');
  });

  it('throws ServiceUnavailable when HTML is returned (outage)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch('<!DOCTYPE html><html><body>Service Unavailable</body></html>', 200),
    );
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'jazz' });
    await expect(locSearchSubjects.handler(input, ctx)).rejects.toThrow();
  });

  it('format() renders label, URI, and count', () => {
    const output = locSearchSubjects.output.parse({
      subjects: [
        {
          label: 'World War, 1939-1945',
          uri: 'http://id.loc.gov/authorities/subjects/sh85148273',
          count: 1500,
        },
      ],
      total: 1,
    });
    const blocks = locSearchSubjects.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('World War, 1939-1945');
    expect(text).toContain('http://id.loc.gov/authorities/subjects/sh85148273');
    expect(text).toContain('1500');
  });

  it('format() renders the total count even when results are empty', () => {
    const output = locSearchSubjects.output.parse({
      subjects: [],
      total: 0,
    });
    const blocks = locSearchSubjects.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    // Count line must always be present; notice is in the enrichment trailer, not here
    expect(text).toContain('0 subject heading(s) found');
  });

  it('rejects empty query at schema level', () => {
    expect(() => locSearchSubjects.input.parse({ query: '' })).toThrow();
  });

  it('rejects limit=0 at schema level (below min)', () => {
    expect(() => locSearchSubjects.input.parse({ query: 'test', limit: 0 })).toThrow();
  });

  it('rejects limit=51 at schema level (above max)', () => {
    expect(() => locSearchSubjects.input.parse({ query: 'test', limit: 51 })).toThrow();
  });

  it('passes limit=50 (max boundary) without throwing', () => {
    expect(() => locSearchSubjects.input.parse({ query: 'test', limit: 50 })).not.toThrow();
  });

  it('passes limit=1 (min boundary) without throwing', () => {
    expect(() => locSearchSubjects.input.parse({ query: 'test', limit: 1 })).not.toThrow();
  });

  it('format() renders sparse subject — no count', () => {
    const output = locSearchSubjects.output.parse({
      subjects: [
        {
          label: 'Photography, Aerial',
          uri: 'http://id.loc.gov/authorities/subjects/sh85101360',
        },
      ],
      total: 1,
    });
    const blocks = locSearchSubjects.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Photography, Aerial');
    expect(text).toContain('http://id.loc.gov/authorities/subjects/sh85101360');
  });
});
