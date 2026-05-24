/**
 * @fileoverview Tests for loc_search_newspapers tool.
 * @module tests/tools/loc-search-newspapers.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locSearchNewspapers } from '@/mcp-server/tools/definitions/loc-search-newspapers.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';

function makeNewspaperSearchResponse(overrides: { results?: object[]; pagination?: object } = {}) {
  return JSON.stringify({
    results: overrides.results ?? [
      {
        url: 'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/?sp=1',
        title: 'The Daily Oklahoman, 1900-01-01, Edition 1, Page 1',
        date: '1900-01-01',
        description: ['Text excerpt about train wreck...'],
        location: ['Oklahoma'],
        subject: ['The Daily Oklahoman'],
      },
    ],
    pagination: overrides.pagination ?? {
      total: 1,
      perpage: 25,
      pages: 1,
    },
  });
}

function mockFetch(body: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('locSearchNewspapers', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
  });

  it('returns newspaper pages for a basic keyword search', async () => {
    vi.stubGlobal('fetch', mockFetch(makeNewspaperSearchResponse()));
    const ctx = createMockContext();
    const input = locSearchNewspapers.input.parse({ query: 'train wreck' });
    const result = await locSearchNewspapers.handler(input, ctx);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].url).toBe(
      'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/?sp=1',
    );
    expect(result.items[0].date).toBe('1900-01-01');
    expect(result.total).toBe(1);
    expect(result.has_next).toBe(false);
  });

  it('returns message field and empty items when no results', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeNewspaperSearchResponse({
          results: [],
          pagination: { total: 0, perpage: 25, pages: 0 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locSearchNewspapers.input.parse({
      query: 'xyzzy_nope',
      state: 'oklahoma',
    });
    const result = await locSearchNewspapers.handler(input, ctx);

    expect(result.items).toHaveLength(0);
    expect(result.message).toBeDefined();
    expect(result.message).toContain('xyzzy_nope');
    expect(result.message).toContain('oklahoma');
  });

  it('hits the /newspapers/ endpoint', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearchNewspapers.input.parse({ query: 'election' });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/newspapers/');
  });

  it('applies state filter as a location facet', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearchNewspapers.input.parse({ query: 'flood', state: 'texas' });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('location%3Atexas');
  });

  it('applies newspaper_title filter as partof_title facet', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearchNewspapers.input.parse({
      query: 'congress',
      newspaper_title: 'New York Times',
    });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('partof_title');
  });

  it('strips empty state/newspaper_title (form-client payload)', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearchNewspapers.input.parse({
      query: 'fire',
      state: '',
      newspaper_title: '',
    });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).not.toContain('fa=');
  });

  it('applies date range filter', async () => {
    const fetchSpy = mockFetch(makeNewspaperSearchResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const input = locSearchNewspapers.input.parse({
      query: 'prohibition',
      date_start: 1920,
      date_end: 1933,
    });
    await locSearchNewspapers.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('dates=1920%2F1933');
  });

  it('format() renders publication title, date, state, and URL', () => {
    const output = locSearchNewspapers.output.parse({
      items: [
        {
          url: 'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/?sp=1',
          title: 'The Daily Oklahoman, 1900-01-01',
          description: 'Train derailment near Guthrie causes injuries...',
          date: '1900-01-01',
          state: 'Oklahoma',
          newspaper_title: 'The Daily Oklahoman',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearchNewspapers.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('The Daily Oklahoman');
    expect(text).toContain('1900-01-01');
    expect(text).toContain('Oklahoma');
    expect(text).toContain('https://www.loc.gov/resource/');
  });

  it('format() renders sparse item — only url and title present', () => {
    const output = locSearchNewspapers.output.parse({
      items: [
        {
          url: 'https://www.loc.gov/resource/sn000/1910-06-01/ed-1/?sp=1',
          title: 'Sparse Newspaper Page',
        },
      ],
      total: 1,
      page: 1,
      pages: 1,
      has_next: false,
    });
    const blocks = locSearchNewspapers.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('Sparse Newspaper Page');
    expect(text).toContain('https://www.loc.gov/resource/');
  });

  it('maps newspaper_title from partof_title, not subject', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          results: [
            {
              url: 'https://www.loc.gov/resource/sn83030214/1910-10-15/ed-1/?sp=14',
              title: 'The Evening World, 1910-10-15',
              date: '1910-10-15',
              subject: ['united states', 'new york (state)', 'newspapers'],
              location: ['new york', 'new york county', 'united states'],
              location_state: ['new york (state)'],
              partof_title: ['the evening world (new york, n.y.) 1887-1931'],
              partof: [
                'chronicling america',
                'serial and government publications division',
                'the evening world (new york, n.y.) 1887-1931',
              ],
            },
          ],
          pagination: { total: 1, perpage: 25, pages: 1 },
        }),
      ),
    );
    const ctx = createMockContext();
    const input = locSearchNewspapers.input.parse({ query: 'election' });
    const result = await locSearchNewspapers.handler(input, ctx);

    expect(result.items[0].newspaper_title).toContain('evening world');
    expect(result.items[0].newspaper_title).not.toBe('united states');
    // state should come from location_state, not location[0]
    expect(result.items[0].state).toContain('new york');
    expect(result.items[0].state).not.toBe('united states');
  });

  it('rejects inverted date range with ValidationError', async () => {
    const ctx = createMockContext();
    const input = locSearchNewspapers.input.parse({
      query: 'election',
      date_start: 1930,
      date_end: 1900,
    });
    await expect(locSearchNewspapers.handler(input, ctx)).rejects.toSatisfy(
      (e: unknown) => (e as { code?: number }).code === JsonRpcErrorCode.ValidationError,
    );
  });

  it('rejects empty query at schema level', () => {
    expect(() => locSearchNewspapers.input.parse({ query: '' })).toThrow();
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil
  it('throws RateLimited on HTTP 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })),
    );
    const ctx = createMockContext({ errors: locSearchNewspapers.errors });
    const input = locSearchNewspapers.input.parse({ query: 'news' });
    await expect(locSearchNewspapers.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
    });
  });
});
