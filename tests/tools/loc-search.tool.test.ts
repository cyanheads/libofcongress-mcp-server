/**
 * @fileoverview Tests for loc_search tool.
 * @module tests/tools/loc-search.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locSearch } from '@/mcp-server/tools/definitions/loc-search.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';

/** Minimal mock search response from the LOC JSON API */
function makeSearchResponse(overrides: { results?: object[]; pagination?: object } = {}) {
  return JSON.stringify({
    results: overrides.results ?? [
      {
        id: 'https://www.loc.gov/item/2009632251/',
        title: 'Test Photo',
        date: '1920',
        description: 'A test description',
        original_format: ['photo'],
        url: 'https://www.loc.gov/item/2009632251/',
      },
    ],
    pagination: overrides.pagination ?? {
      total: 1,
      perpage: 25,
      pages: 1,
      page: 1,
    },
  });
}

/** Return a fetch stub that resolves a single response body */
function mockFetch(body: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('locSearch', () => {
  beforeEach(async () => {
    // Reset rate-limit state by re-initializing the service
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    // Default to a small request delay in tests
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
  });

  it('returns items and pagination for a basic keyword search', async () => {
    vi.stubGlobal('fetch', mockFetch(makeSearchResponse()));
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'civil war photos' });
    const result = await locSearch.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('2009632251');
    expect(result.items[0].title).toBe('Test Photo');
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.has_next).toBe(false);
  });

  it('returns message field and empty items on zero results', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({ results: [], pagination: { total: 0, perpage: 25, pages: 0 } }),
      ),
    );
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'xyzzy_no_match_expected' });
    const result = await locSearch.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.has_next).toBe(false);
    expect(result.message).toBeDefined();
    expect(result.message).toContain('xyzzy_no_match_expected');
  });

  it('applies format filter — passes format slug in the URL', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'maps', format: 'map' });
    await locSearch.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/maps/');
  });

  it('applies date range filter in querystring', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'war', date_start: 1920, date_end: 1945 });
    await locSearch.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('dates=1920%2F1945');
  });

  it('applies subject and location facets in querystring', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearch.input.parse({
      query: 'photos',
      subject: 'World War, 1939-1945',
      location: 'oklahoma',
    });
    await locSearch.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('fa=');
    expect(calledUrl).toContain('subject%3AWorld');
    expect(calledUrl).toContain('location%3Aoklahoma');
  });

  it('strips empty subject/location strings (form-client payload)', async () => {
    const fetchSpy = mockFetch(makeSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'photos', subject: '', location: '' });
    await locSearch.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).not.toContain('fa=');
  });

  it('computes has_next correctly for multi-page results', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSearchResponse({
          pagination: { total: 50, perpage: 25, pages: 2, page: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'test', page: 1 });
    const result = await locSearch.handler(input, ctx);
    expect(result.has_next).toBe(true);
    expect(result.pages).toBe(2);
  });

  it('throws on HTML response (rate-limited proxy page)', async () => {
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Error</body></html>', 200));
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'test' });
    await expect(locSearch.handler(input, ctx)).rejects.toThrow();
  });

  it('format() renders title, ID, and URL in output text', () => {
    const output = locSearch.output.parse({
      items: [
        {
          id: 'loc.pnp.ppmsc.02404',
          title: 'Sample Photo',
          date: '1920',
          format: 'photo',
          url: 'https://www.loc.gov/item/loc.pnp.ppmsc.02404/',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearch.format!(output);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('loc.pnp.ppmsc.02404');
    expect(text).toContain('Sample Photo');
    expect(text).toContain('https://www.loc.gov/item/loc.pnp.ppmsc.02404/');
  });

  it('format() renders the message when results are empty', () => {
    const output = locSearch.output.parse({
      items: [],
      total: 0,
      page: 1,
      pages: 0,
      has_next: false,
      message: 'No items matched "xyzzy".',
    });
    const blocks = locSearch.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No items matched');
  });

  it('format() renders sparse item — no date or format', () => {
    const output = locSearch.output.parse({
      items: [
        {
          id: 'sparse-id',
          title: 'Sparse Item',
          url: 'https://www.loc.gov/item/sparse-id/',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearch.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('sparse-id');
    expect(text).toContain('Sparse Item');
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil, must not bleed into other tests
  it('throws RateLimited on HTTP 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Rate limited', { status: 429 })),
    );
    const ctx = createMockContext();
    const input = locSearch.input.parse({ query: 'anything' });
    await expect(locSearch.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
    });
  });
});
