/**
 * @fileoverview Tests for libofcongress://item/{item_id} resource.
 * @module tests/resources/libofcongress-item.resource.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
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

describe('locItemResource', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
    process.env.LOC_REQUEST_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LOC_REQUEST_DELAY_MS;
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
  });

  it('throws NotFound when item is absent from response envelope', async () => {
    vi.stubGlobal('fetch', mockFetch(JSON.stringify({ resources: [], related_items: [] })));
    const ctx = createMockContext({ uri: new URL('libofcongress://item/nonexistent') });
    const params = locItemResource.params.parse({ item_id: 'nonexistent' });
    await expect(locItemResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('throws NotFound on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const ctx = createMockContext({ uri: new URL('libofcongress://item/bad-id') });
    const params = locItemResource.params.parse({ item_id: 'bad-id' });
    await expect(locItemResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
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
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil
  it('throws RateLimited on HTTP 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 })),
    );
    const ctx = createMockContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params.parse({ item_id: '2016687584' });
    await expect(locItemResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
    });
  });
});
