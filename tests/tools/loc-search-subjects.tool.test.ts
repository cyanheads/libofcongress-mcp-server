/**
 * @fileoverview Tests for loc_search_subjects tool.
 * @module tests/tools/loc-search-subjects.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locSearchSubjects } from '@/mcp-server/tools/definitions/loc-search-subjects.tool.js';
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
  });

  it('returns message field and empty subjects when no results', async () => {
    vi.stubGlobal('fetch', mockFetch(makeSuggestResponse([])));
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'xyzzy_no_match' });
    const result = await locSearchSubjects.handler(input, ctx);

    expect(result.subjects).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.message).toBeDefined();
    expect(result.message).toContain('xyzzy_no_match');
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

  it('respects the limit parameter', async () => {
    const fetchSpy = mockFetch(makeSuggestResponse([]));
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearchSubjects.input.parse({ query: 'music', limit: 5 });
    await locSearchSubjects.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('count=5');
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

  it('throws ServiceUnavailable on non-OK HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Server Error', { status: 503 })),
    );
    const ctx = createMockContext({ errors: locSearchSubjects.errors });
    const input = locSearchSubjects.input.parse({ query: 'music' });
    await expect(locSearchSubjects.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
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

  it('format() renders the message when results are empty', () => {
    const output = locSearchSubjects.output.parse({
      subjects: [],
      total: 0,
      message: 'No LCSH headings matched "xyzzy".',
    });
    const blocks = locSearchSubjects.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No LCSH headings matched');
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
