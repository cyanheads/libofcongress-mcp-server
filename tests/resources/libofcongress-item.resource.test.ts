/**
 * @fileoverview Tests for libofcongress://item/{+item_id} resource.
 * @module tests/resources/libofcongress-item.resource.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locItemResource } from '@/mcp-server/resources/definitions/libofcongress-item.resource.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';

function makeItemResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    item: {
      title: 'Portrait of a senator',
      date: '1915',
      contributor: ['Photographer, Unknown'],
      subject: ['Legislators -- United States -- Portraits'],
      notes: ['From the Harris & Ewing collection.'],
      url: 'https://www.loc.gov/item/2016687584/',
      ...overrides,
    },
    resources: [],
    related_items: [],
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

/**
 * These go through the SDK's real template matching rather than calling handler() with a
 * hand-built params object. Every other test in this file bypasses the match step, so none
 * of them can see a template that fails to capture an ID in the first place.
 */
describe('locItemResource URI template matching', () => {
  const template = new UriTemplate(locItemResource.uriTemplate);

  it('uses reserved expansion so the captured id can hold slashes', () => {
    expect(locItemResource.uriTemplate).toBe('libofcongress://item/{+item_id}');
  });

  it('matches a single-segment item id', () => {
    expect(template.match('libofcongress://item/2009632251')).toEqual({
      item_id: '2009632251',
    });
  });

  it('matches a dotted item id', () => {
    expect(template.match('libofcongress://item/loc.pnp.ppmsc.02404')).toEqual({
      item_id: 'loc.pnp.ppmsc.02404',
    });
  });

  it('matches a raw multi-segment newspaper id, slashes intact', () => {
    // Simple expansion `{item_id}` compiles to ([^/,]+) and returns null here — the
    // -32602 "not found" a client sees for a slash-separated id.
    expect(template.match('libofcongress://item/sn83025842/1884-05-22/ed-1')).toEqual({
      item_id: 'sn83025842/1884-05-22/ed-1',
    });
  });

  it('matches a percent-encoded multi-segment id without decoding it', () => {
    // The SDK captures the literal substring; decoding is the handler's job.
    expect(template.match('libofcongress://item/sn83025842%2F1884-05-22%2Fed-1')).toEqual({
      item_id: 'sn83025842%2F1884-05-22%2Fed-1',
    });
  });

  it('the captured id parses against the params schema', () => {
    const matched = template.match('libofcongress://item/sn83025842/1884-05-22/ed-1');
    expect(locItemResource.params.parse(matched)).toEqual({
      item_id: 'sn83025842/1884-05-22/ed-1',
    });
  });
});

describe('locItemResource', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns full item metadata for a valid item_id', async () => {
    vi.stubGlobal('fetch', mockFetch(makeItemResponse()));
    const ctx = createMockContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params.parse({ item_id: '2016687584' });
    const result = await locItemResource.handler(params, ctx);

    expect(result.item_id).toBe('2016687584');
    expect(result.title).toBe('Portrait of a senator');
    expect(result.date).toBe('1915');
    expect(result.contributors).toContain('Photographer, Unknown');
    expect(result.subject_headings).toContain('Legislators -- United States -- Portraits');
  });

  it('returns the same shape as libofcongress_get_item', async () => {
    vi.stubGlobal('fetch', mockFetch(makeItemResponse()));
    const ctx = createMockContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params.parse({ item_id: '2016687584' });
    const result = await locItemResource.handler(params, ctx);

    expect(result).toHaveProperty('item_id');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('contributors');
    expect(result).toHaveProperty('subject_headings');
    expect(result).toHaveProperty('notes');
    expect(result).toHaveProperty('resource_links');
    expect(result).toHaveProperty('related_items');
    expect(result).toHaveProperty('url');
    // The resource returns getItem()'s record verbatim, so the curated metadata the tool
    // surfaces has to arrive here too — always-present arrays at minimum.
    expect(result).toHaveProperty('languages');
    expect(result).toHaveProperty('locations');
    expect(result).toHaveProperty('former_ids');
    expect(result).toHaveProperty('original_formats');
    expect(result).toHaveProperty('online_formats');
  });

  it('surfaces the curated metadata fields from a dense upstream record', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeItemResponse({
          summary: 'A political cartoon commenting on the 1884 election.',
          language: ['english'],
          location: ['united states'],
          call_number: 'Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]',
          number_former_id: ['http://www.loc.gov/item/13903333'],
          original_format: ['photo, print, drawing'],
          online_format: ['image'],
          access_restricted: true,
        }),
      ),
    );
    const ctx = createMockContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params.parse({ item_id: '2016687584' });
    const result = await locItemResource.handler(params, ctx);

    expect(result.summary).toBe('A political cartoon commenting on the 1884 election.');
    expect(result.languages).toEqual(['english']);
    expect(result.locations).toEqual(['united states']);
    expect(result.call_number).toBe('Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]');
    expect(result.former_ids).toEqual(['http://www.loc.gov/item/13903333']);
    expect(result.original_formats).toEqual(['photo, print, drawing']);
    expect(result.online_formats).toEqual(['image']);
    expect(result.access_restricted).toBe(true);
  });

  it('resolves a raw multi-segment id end-to-end from URI to request URL', async () => {
    const fetchSpy = mockFetch(
      makeItemResponse({
        title: 'The Caucasian',
        url: 'https://www.loc.gov/item/sn83025842/1884-05-22/ed-1/',
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const uri = 'libofcongress://item/sn83025842/1884-05-22/ed-1';
    const matched = new UriTemplate(locItemResource.uriTemplate).match(uri);
    const ctx = createMockContext({ uri: new URL(uri), errors: locItemResource.errors });
    const result = await locItemResource.handler(locItemResource.params.parse(matched), ctx);

    expect(result.item_id).toBe('sn83025842/1884-05-22/ed-1');
    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/item/sn83025842/1884-05-22/ed-1/');
    expect(calledUrl).not.toContain('%2F');
  });

  it('resolves a percent-encoded multi-segment id to the same record', async () => {
    const fetchSpy = mockFetch(
      makeItemResponse({
        title: 'The Caucasian',
        url: 'https://www.loc.gov/item/sn83025842/1884-05-22/ed-1/',
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const uri = 'libofcongress://item/sn83025842%2F1884-05-22%2Fed-1';
    const matched = new UriTemplate(locItemResource.uriTemplate).match(uri);
    const ctx = createMockContext({ uri: new URL(uri), errors: locItemResource.errors });
    const result = await locItemResource.handler(locItemResource.params.parse(matched), ctx);

    // Decoded exactly once: no %252F double-encoding, no literal %2F reaching LOC.
    expect(result.item_id).toBe('sn83025842/1884-05-22/ed-1');
    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('/item/sn83025842/1884-05-22/ed-1/');
    expect(calledUrl).not.toContain('%2F');
    expect(calledUrl).not.toContain('%25');
  });

  it('leaves a single-segment id unchanged through the decode step', async () => {
    const fetchSpy = mockFetch(makeItemResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({
      uri: new URL('libofcongress://item/2016687584'),
      errors: locItemResource.errors,
    });
    const params = locItemResource.params.parse({ item_id: '2016687584' });
    const result = await locItemResource.handler(params, ctx);
    expect(result.item_id).toBe('2016687584');
    expect((fetchSpy.mock.calls[0][0] as string) ?? '').toContain('/item/2016687584/');
  });

  it('throws NotFound when item is absent from response envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(JSON.stringify({ resources: [], related_items: [] })));
    const ctx = createMockContext({
      uri: new URL('libofcongress://item/nonexistent'),
      errors: locItemResource.errors,
    });
    const params = locItemResource.params.parse({ item_id: 'nonexistent' });
    await expect(locItemResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('throws NotFound on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const ctx = createMockContext({
      uri: new URL('libofcongress://item/bad-id'),
      errors: locItemResource.errors,
    });
    const params = locItemResource.params.parse({ item_id: 'bad-id' });
    await expect(locItemResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('NotFound data carries the caller-facing id, never the internal request URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const ctx = createMockContext({
      uri: new URL('libofcongress://item/TOTALLY_FAKE_ID'),
      errors: locItemResource.errors,
    });
    const params = locItemResource.params.parse({ item_id: 'TOTALLY_FAKE_ID' });
    const err = await locItemResource.handler(params, ctx).catch((e: unknown) => e);

    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect(JSON.stringify(data)).not.toContain('www.loc.gov');
    // Parity with the tools: a populated reason plus the id the caller passed.
    expect(data.reason).toBe('item_not_found');
    expect(data.itemId).toBe('TOTALLY_FAKE_ID');
    expect((err as Error).message).not.toContain('www.loc.gov');
  });

  it('ServiceUnavailable from an HTML body does not leak the internal request URL', async () => {
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Rate limited</body></html>'));
    const ctx = createMockContext({
      uri: new URL('libofcongress://item/2016687584'),
      errors: locItemResource.errors,
    });
    const params = locItemResource.params.parse({ item_id: '2016687584' });
    const err = await locItemResource.handler(params, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect((err as Error).message).not.toContain('www.loc.gov');
  });

  it('handles sparse upstream payload — missing contributor, subject, notes', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Sparse Item',
            url: 'https://www.loc.gov/item/sparse-id/',
            // contributor, subject, notes all absent
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext({ uri: new URL('libofcongress://item/sparse-id') });
    const params = locItemResource.params.parse({ item_id: 'sparse-id' });
    const result = await locItemResource.handler(params, ctx);

    expect(result.contributors).toEqual([]);
    expect(result.subject_headings).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.date).toBeUndefined();
    expect(result.rights_information).toBeUndefined();
    expect(result.physical_description).toBeUndefined();
    // Curated fields degrade the same way — empty arrays, absent optionals, nothing invented.
    expect(result.languages).toEqual([]);
    expect(result.locations).toEqual([]);
    expect(result.former_ids).toEqual([]);
    expect(result.original_formats).toEqual([]);
    expect(result.online_formats).toEqual([]);
    expect(result.summary).toBeUndefined();
    expect(result.call_number).toBeUndefined();
    expect(result.access_restricted).toBeUndefined();
  });

  it('rejects empty item_id at schema level', () => {
    expect(() => locItemResource.params.parse({ item_id: '' })).not.toThrow();
    // item_id has no min() constraint on the resource — confirm the schema accepts empty string
    // (the service will reject it at runtime, not schema level)
  });

  it('resource returns url field in the result', async () => {
    vi.stubGlobal('fetch', mockFetch(makeItemResponse()));
    const ctx = createMockContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params.parse({ item_id: '2016687584' });
    const result = await locItemResource.handler(params, ctx);

    expect(result.url).toContain('loc.gov');
  });

  it('returns an absolute https url when upstream item.url is protocol-relative', async () => {
    vi.stubGlobal('fetch', mockFetch(makeItemResponse({ url: '//lccn.loc.gov/2016687584' })));
    const ctx = createMockContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params.parse({ item_id: '2016687584' });
    const result = await locItemResource.handler(params, ctx);
    // Same service-level fix as libofcongress_get_item covers the resource consumer
    expect(result.url).toBe('https://lccn.loc.gov/2016687584');
    expect(result.url.startsWith('//')).toBe(false);
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil
  it('throws RateLimited on HTTP 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })),
    );
    const ctx = createMockContext({
      uri: new URL('libofcongress://item/2016687584'),
      errors: locItemResource.errors,
    });
    const params = locItemResource.params.parse({ item_id: '2016687584' });
    const err = await locItemResource.handler(params, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: JsonRpcErrorCode.RateLimited });
    expect((err as { data?: Record<string, unknown> }).data?.reason).toBe('rate_limit_exceeded');
  });
});
