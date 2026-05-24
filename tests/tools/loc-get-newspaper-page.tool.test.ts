/**
 * @fileoverview Tests for loc_get_newspaper_page tool.
 * @module tests/tools/loc-get-newspaper-page.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locGetNewspaperPage } from '@/mcp-server/tools/definitions/loc-get-newspaper-page.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';

const PAGE_URL = 'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/?sp=1';

/**
 * The service makes two fetches when fulltext_file is present:
 * 1. Resource JSON (with fulltext_file pointer)
 * 2. ALTO XML for OCR text
 *
 * fetchSpy is called sequentially; we alternate responses via mockImplementation.
 */
function makeResourceResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    resource: {
      title: 'The Daily Oklahoman',
      date_issued: '1900-01-01',
      sequence: 1,
      part_of: 'Oklahoma newspapers',
      fulltext_file: '/files/sn84026749/1900-01-01/ed-1/seq-1.txt',
      ...overrides,
    },
  });
}

const ALTO_XML = `<alto><String CONTENT="Hello" /><String CONTENT="World" /></alto>`;

function mockFetchSequence(...responses: Array<{ body: string; status?: number }>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const { body, status = 200 } = responses[callIndex % responses.length] ?? { body: '' };
    callIndex++;
    return Promise.resolve(
      new Response(body, { status, headers: { 'Content-Type': 'application/json' } }),
    );
  });
}

describe('locGetNewspaperPage', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
  });

  it('returns page metadata and OCR text when fulltext_file is present', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({ body: makeResourceResponse() }, { body: ALTO_XML }));
    const ctx = createMockContext();
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    const result = await locGetNewspaperPage.handler(input, ctx);

    expect(result.page_url).toBe(PAGE_URL);
    expect(result.newspaper_title).toBe('The Daily Oklahoman');
    expect(result.date).toBe('1900-01-01');
    expect(result.state).toBe('Oklahoma');
    expect(result.sequence).toBe(1);
    expect(result.ocr_available).toBe(true);
    expect(result.ocr_text).toContain('Hello');
    expect(result.ocr_text).toContain('World');
  });

  it('marks ocr_available false and returns empty ocr_text when fulltext_file is absent', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchSequence({
        body: makeResourceResponse({ fulltext_file: undefined }),
      }),
    );
    const ctx = createMockContext();
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    const result = await locGetNewspaperPage.handler(input, ctx);

    expect(result.ocr_available).toBe(false);
    expect(result.ocr_text).toBe('');
  });

  it('still returns page metadata when OCR fetch fails (graceful degradation)', async () => {
    // First call: resource JSON; second call: OCR fetch errors
    vi.stubGlobal(
      'fetch',
      mockFetchSequence({ body: makeResourceResponse() }, { body: 'Service error', status: 503 }),
    );
    const ctx = createMockContext();
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    const result = await locGetNewspaperPage.handler(input, ctx);

    expect(result.ocr_available).toBe(true);
    expect(result.ocr_text).toBe(''); // OCR unavailable but not an error
    expect(result.newspaper_title).toBe('The Daily Oklahoman');
  });

  it('throws NotFound when resource key is missing from response', async () => {
    vi.stubGlobal('fetch', mockFetchSequence({ body: JSON.stringify({}) }));
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    await expect(locGetNewspaperPage.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('throws NotFound on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    await expect(locGetNewspaperPage.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('appends ?fo=json when URL has no existing query', async () => {
    const fetchSpy = mockFetchSequence({
      body: makeResourceResponse({ fulltext_file: undefined }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    const bareUrl = 'https://www.loc.gov/resource/sn84026749/1900-01-01/ed-1/';
    const ctx = createMockContext();
    const input = locGetNewspaperPage.input.parse({ page_url: bareUrl });
    await locGetNewspaperPage.handler(input, ctx);

    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('fo=json');
  });

  it('format() renders title, URL, date, state, sequence, and OCR text', () => {
    const output = locGetNewspaperPage.output.parse({
      page_url: PAGE_URL,
      newspaper_title: 'The Daily Oklahoman',
      date: '1900-01-01',
      state: 'Oklahoma',
      edition: 'Oklahoma newspapers',
      sequence: 1,
      ocr_text: 'Train derailment near Guthrie.',
      ocr_available: true,
    });
    const blocks = locGetNewspaperPage.format!(output);
    expect(blocks[0].type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('The Daily Oklahoman');
    expect(text).toContain(PAGE_URL);
    expect(text).toContain('1900-01-01');
    expect(text).toContain('Oklahoma');
    expect(text).toContain('Train derailment');
    expect(text).toContain('Yes');
  });

  it('format() notes image-only digitization when ocr_available is false', () => {
    const output = locGetNewspaperPage.output.parse({
      page_url: PAGE_URL,
      ocr_text: '',
      ocr_available: false,
    });
    const blocks = locGetNewspaperPage.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('No');
    expect(text).toContain('image-only');
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil
  it('throws RateLimited on HTTP 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })),
    );
    const ctx = createMockContext({ errors: locGetNewspaperPage.errors });
    const input = locGetNewspaperPage.input.parse({ page_url: PAGE_URL });
    await expect(locGetNewspaperPage.handler(input, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
    });
  });
});
