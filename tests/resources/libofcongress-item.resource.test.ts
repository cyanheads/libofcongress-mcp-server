/**
 * @fileoverview Tests for libofcongress://item/{+item_id} resource.
 * @module tests/resources/libofcongress-item.resource.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { ResourceTemplate } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locItemResource } from '@/mcp-server/resources/definitions/libofcongress-item.resource.js';
import { locGetItem } from '@/mcp-server/tools/definitions/libofcongress-get-item.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';
import type { LocItemDetail } from '@/services/loc-api/types.js';
import {
  BOOK_ITEM_00003348,
  BOOK_ITEM_02007458,
  BOOK_ITEM_2005567251,
  MANUSCRIPT_ITEM_MM77093930,
  PHOTO_ITEM_2017760320,
} from '../fixtures/loc-items.js';
import { MANUSCRIPT_RIGHTS_MM77093930, NEWSPAPER_NOTES_SN83030214 } from '../fixtures/loc-text.js';
import { readItemResourceError } from '../helpers/item-resource-read.js';
import { serveByHost } from '../helpers/loc-fetch.js';
import { contractRecovery } from '../helpers/tool-result.js';

function makeItemResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    item: {
      title: 'Portrait of a senator',
      date: '1915',
      contributor_names: ['Harris & Ewing (Photographer)'],
      contributors: [
        { 'harris & ewing': 'https://www.loc.gov/search/?fa=contributor:harris+%26+ewing&fo=json' },
      ],
      // Live item JSON: `subject` holds the lowercase facet terms, `subject_headings` the LCSH
      // headings the terms were split from.
      subject: ['legislators', 'united states', 'portraits'],
      subject_headings: ['Legislators--United States--Portraits'],
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

const itemUriTemplate = new ResourceTemplate(locItemResource.uriTemplate, {
  list: undefined,
}).uriTemplate;

/**
 * These go through the SDK's real template matching rather than calling handler() with a
 * hand-built params object. Every other test in this file bypasses the match step, so none
 * of them can see a template that fails to capture an ID in the first place.
 */
describe('locItemResource URI template matching', () => {
  it('uses reserved expansion so the captured id can hold slashes', () => {
    expect(locItemResource.uriTemplate).toBe('libofcongress://item/{+item_id}');
  });

  it('matches a single-segment item id', () => {
    expect(itemUriTemplate.match('libofcongress://item/2009632251')).toEqual({
      item_id: '2009632251',
    });
  });

  it('matches a dotted item id', () => {
    expect(itemUriTemplate.match('libofcongress://item/loc.pnp.ppmsc.02404')).toEqual({
      item_id: 'loc.pnp.ppmsc.02404',
    });
  });

  it('matches a raw multi-segment newspaper id, slashes intact', () => {
    // Simple expansion `{item_id}` compiles to ([^/,]+) and returns null here — the
    // -32602 "not found" a client sees for a slash-separated id.
    expect(itemUriTemplate.match('libofcongress://item/sn83025842/1884-05-22/ed-1')).toEqual({
      item_id: 'sn83025842/1884-05-22/ed-1',
    });
  });

  it('matches a percent-encoded multi-segment id without decoding it', () => {
    // The SDK captures the literal substring; decoding is the handler's job.
    expect(itemUriTemplate.match('libofcongress://item/sn83025842%2F1884-05-22%2Fed-1')).toEqual({
      item_id: 'sn83025842%2F1884-05-22%2Fed-1',
    });
  });

  it('the captured id parses against the params schema', () => {
    const matched = itemUriTemplate.match('libofcongress://item/sn83025842/1884-05-22/ed-1');
    expect(locItemResource.params!.parse(matched)).toEqual({
      item_id: 'sn83025842/1884-05-22/ed-1',
    });
  });
});

type MockContextOptions = NonNullable<Parameters<typeof createMockContext>[0]>;

const createResourceContext = (options: MockContextOptions = {}) =>
  createMockContext({ ...options, errors: locItemResource.errors });

const callItemResource = async (
  params: Parameters<typeof locItemResource.handler>[0],
  ctx: Parameters<typeof locItemResource.handler>[1],
): Promise<LocItemDetail> => (await locItemResource.handler(params, ctx)) as LocItemDetail;

describe('locItemResource', () => {
  beforeEach(async () => {
    // A test that forgets its stub fails here instead of reaching LOC, which blocks for an hour.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unmocked fetch')));
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns full item metadata for a valid item_id', async () => {
    vi.stubGlobal('fetch', mockFetch(makeItemResponse()));
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params!.parse({ item_id: '2016687584' });
    const result = await callItemResource(params, ctx);

    expect(result.item_id).toBe('2016687584');
    expect(result.title).toBe('Portrait of a senator');
    expect(result.date).toBe('1915');
    expect(result.contributors).toEqual(['Harris & Ewing (Photographer)']);
    expect(result.subject_headings).toEqual(['Legislators--United States--Portraits']);
    expect(result.subject_terms).toEqual(['legislators', 'united states', 'portraits']);
  });

  it('returns the record libofcongress_get_item returns for the same item with its default input', async () => {
    // A 122-page diary, so the default page window and its next offset are part of the record.
    serveByHost({ 'www.loc.gov': MANUSCRIPT_ITEM_MM77093930 });
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/mm77093930') });

    const fromResource = await callItemResource(
      locItemResource.params!.parse({ item_id: 'mm77093930' }),
      ctx,
    );
    const fromTool = await locGetItem.handler(
      locGetItem.input.parse({ item_id: 'mm77093930' }),
      createMockContext({ errors: locGetItem.errors }),
    );

    expect(fromResource).toEqual(fromTool);
    expect(fromResource).toMatchObject({ item_id: 'mm77093930', page_total: 122 });
    expect(fromResource).not.toHaveProperty('resource_links');
  });

  it('returns the default page window with next_page_offset and the cataloged date (#62, #63)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        if (new URL(String(url)).hostname !== 'www.loc.gov') throw new Error('unmocked fetch');
        return new Response(JSON.stringify(BOOK_ITEM_02007458), { status: 200 });
      }),
    );
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/02007458') });
    const result = await callItemResource(
      locItemResource.params!.parse({ item_id: '02007458' }),
      ctx,
    );

    expect(result.pages).toHaveLength(50);
    expect(result.pages.every((p) => !('files' in p))).toBe(true);
    expect(result).toMatchObject({ page_total: 582, next_page_offset: 50, date: '1894' });
    expect(locItemResource.description).toMatch(/libofcongress_get_item with page_offset/);
  });

  it('returns the cataloged date of a Prints & Photographs record (#62)', async () => {
    vi.stubGlobal('fetch', mockFetch(JSON.stringify(PHOTO_ITEM_2017760320)));
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/2017760320') });
    const result = await callItemResource(
      locItemResource.params!.parse({ item_id: '2017760320' }),
      ctx,
    );

    expect(result.date).toBe('1936 Apr.');
  });

  it('omits a coded catalog date (#69)', async () => {
    serveByHost({ 'www.loc.gov': BOOK_ITEM_00003348 });
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/00003348') });
    const result = await callItemResource(
      locItemResource.params!.parse({ item_id: '00003348' }),
      ctx,
    );

    expect(result).toMatchObject({ item_id: '00003348' });
    expect(result).not.toHaveProperty('date');
  });

  it('returns the imprint (#71)', async () => {
    serveByHost({ 'www.loc.gov': BOOK_ITEM_00003348 });
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/00003348') });
    const result = await callItemResource(
      locItemResource.params!.parse({ item_id: '00003348' }),
      ctx,
    );

    expect(result.imprint).toBe('New York : Werner School Book Company, c1900.');
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
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params!.parse({ item_id: '2016687584' });
    const result = await callItemResource(params, ctx);

    expect(result.summary).toBe('A political cartoon commenting on the 1884 election.');
    expect(result.languages).toEqual(['english']);
    expect(result.locations).toEqual(['united states']);
    expect(result.call_number).toBe('Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]');
    expect(result.former_ids).toEqual(['http://www.loc.gov/item/13903333']);
    expect(result.original_formats).toEqual(['photo, print, drawing']);
    expect(result.online_formats).toEqual(['image']);
    expect(result.access_restricted).toBe(true);
  });

  it('returns object-form item.related_items entries as strings, like the tool (#39)', async () => {
    // afc9999005.10348's live item.related_items entry is a { title, url } object; the resource
    // shares getItem() with the tool, so it must hand back the same string[] record.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeItemResponse({
          related_items: [
            'string-related-id',
            {
              title: 'Alan Lomax Collection of Woody Guthrie Recordings (AFC 1940/007)',
              url: 'https://lccn.loc.gov/2009655315',
            },
          ],
        }),
      ),
    );
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/afc9999005.10348') });
    const params = locItemResource.params!.parse({ item_id: 'afc9999005.10348' });
    const result = await callItemResource(params, ctx);

    expect(result.related_items).toEqual(['string-related-id', 'https://lccn.loc.gov/2009655315']);
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
    const matched = itemUriTemplate.match(uri);
    const ctx = createResourceContext({ uri: new URL(uri) });
    const result = await callItemResource(locItemResource.params!.parse(matched), ctx);

    expect(result.item_id).toBe('sn83025842/1884-05-22/ed-1');
    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
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
    const matched = itemUriTemplate.match(uri);
    const ctx = createResourceContext({ uri: new URL(uri) });
    const result = await callItemResource(locItemResource.params!.parse(matched), ctx);

    // Decoded exactly once: no %252F double-encoding, no literal %2F reaching LOC.
    expect(result.item_id).toBe('sn83025842/1884-05-22/ed-1');
    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('/item/sn83025842/1884-05-22/ed-1/');
    expect(calledUrl).not.toContain('%2F');
    expect(calledUrl).not.toContain('%25');
  });

  it('leaves a single-segment id unchanged through the decode step', async () => {
    const fetchSpy = mockFetch(makeItemResponse());
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params!.parse({ item_id: '2016687584' });
    const result = await callItemResource(params, ctx);
    expect(result.item_id).toBe('2016687584');
    expect((fetchSpy.mock.calls[0]![0] as string) ?? '').toContain('/item/2016687584/');
  });

  it('NotFound data carries the caller-facing id, never the internal request URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const ctx = createResourceContext({
      uri: new URL('libofcongress://item/TOTALLY_FAKE_ID'),
    });
    const params = locItemResource.params!.parse({ item_id: 'TOTALLY_FAKE_ID' });
    const err = await callItemResource(params, ctx).catch((e: unknown) => e);

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
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params!.parse({ item_id: '2016687584' });
    const err = await callItemResource(params, ctx).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect((err as Error).message).not.toContain('www.loc.gov');
  });

  it('handles sparse upstream payload — missing contributor_names, subject, notes', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Sparse Item',
            url: 'https://www.loc.gov/item/sparse-id/',
            // contributor_names, subject, notes all absent
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/sparse-id') });
    const params = locItemResource.params!.parse({ item_id: 'sparse-id' });
    const result = await callItemResource(params, ctx);

    expect(result.contributors).toEqual([]);
    expect(result.subject_headings).toEqual([]);
    expect(result.subject_terms).toEqual([]);
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
    expect(() => locItemResource.params!.parse({ item_id: '' })).not.toThrow();
    // item_id has no min() constraint on the resource — confirm the schema accepts empty string
    // (the service will reject it at runtime, not schema level)
  });

  it('resource returns url field in the result', async () => {
    vi.stubGlobal('fetch', mockFetch(makeItemResponse()));
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params!.parse({ item_id: '2016687584' });
    const result = await callItemResource(params, ctx);

    expect(result.url).toContain('loc.gov');
  });

  it('returns an absolute https url when upstream item.url is protocol-relative', async () => {
    vi.stubGlobal('fetch', mockFetch(makeItemResponse({ url: '//lccn.loc.gov/2016687584' })));
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/2016687584') });
    const params = locItemResource.params!.parse({ item_id: '2016687584' });
    const result = await callItemResource(params, ctx);
    // Same service-level fix as libofcongress_get_item covers the resource consumer
    expect(result.url).toBe('https://lccn.loc.gov/2016687584');
    expect(result.url.startsWith('//')).toBe(false);
  });

  it.each([
    {
      name: 'an upstream 404',
      fetch: () => vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })),
    },
    {
      name: 'a response with no item record',
      fetch: () => mockFetch(JSON.stringify({ resources: [], related_items: [] })),
    },
  ])(
    'names the failed id and carries the item_not_found recovery on the wire for $name (#44)',
    async ({ fetch }) => {
      vi.stubGlobal('fetch', fetch());
      const ctx = createResourceContext({ uri: new URL('libofcongress://item/99999999999zzz') });
      const params = locItemResource.params!.parse({ item_id: '99999999999zzz' });

      await expect(callItemResource(params, ctx)).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
        message: expect.stringContaining('99999999999zzz'),
        data: { reason: 'item_not_found', itemId: '99999999999zzz' },
      });

      // The resource factory fills the declared recovery hint, so the client-facing envelope is
      // read through a real `resources/read` rather than off the handler's own throw.
      vi.stubGlobal('fetch', fetch());
      expect(await readItemResourceError('libofcongress://item/99999999999zzz')).toMatchObject({
        code: JsonRpcErrorCode.NotFound,
        message: expect.stringContaining('99999999999zzz'),
        data: {
          reason: 'item_not_found',
          itemId: '99999999999zzz',
          recovery: { hint: contractRecovery(locItemResource, 'item_not_found') },
          requestId: expect.any(String),
        },
      });
    },
  );

  describe('item_id link forms (#66)', () => {
    it('reads a percent-encoded loc.gov item link as its id', async () => {
      const fetchSpy = mockFetch(JSON.stringify(PHOTO_ITEM_2017760320));
      vi.stubGlobal('fetch', fetchSpy);
      const uri = 'libofcongress://item/https%3A%2F%2Fwww.loc.gov%2Fitem%2F2017760320%2F';
      const ctx = createResourceContext({ uri: new URL(uri) });

      const result = await callItemResource(
        locItemResource.params!.parse(itemUriTemplate.match(uri)),
        ctx,
      );

      expect(result.item_id).toBe('2017760320');
      expect(new URL(String(fetchSpy.mock.calls[0]![0])).pathname).toBe('/item/2017760320/');
    });

    it('reads a percent-encoded lccn.loc.gov permalink as its LCCN (#68)', async () => {
      const fetchSpy = mockFetch(JSON.stringify(BOOK_ITEM_2005567251));
      vi.stubGlobal('fetch', fetchSpy);
      const uri = 'libofcongress://item/https%3A%2F%2Flccn.loc.gov%2F2005567251';
      const ctx = createResourceContext({ uri: new URL(uri) });

      const result = await callItemResource(
        locItemResource.params!.parse(itemUriTemplate.match(uri)),
        ctx,
      );

      expect(result).toMatchObject({
        item_id: '2005567251',
        url: 'https://lccn.loc.gov/2005567251',
      });
      expect(new URL(String(fetchSpy.mock.calls[0]![0])).pathname).toBe('/item/2005567251/');
      expect(String(locItemResource.params!.shape.item_id.description)).toContain('lccn.loc.gov');
      const entry = locItemResource.errors!.find((e) => e.reason === 'invalid_item_id')!;
      expect(entry.when).toContain('lccn.loc.gov');
    });

    it.each([
      ['libofcongress://item/lccn.loc.gov/2005-568294', '2005568294'],
      ['libofcongress://item/https%3A%2F%2Flccn.loc.gov%2Fsn%2083030214', 'sn83030214'],
    ])('reads the unnormalized LCCN permalink %s as %s (#68)', async (uri, lccn) => {
      const fetchSpy = mockFetch(JSON.stringify(BOOK_ITEM_2005567251));
      vi.stubGlobal('fetch', fetchSpy);
      const ctx = createResourceContext({ uri: new URL(uri) });

      const result = await callItemResource(
        locItemResource.params!.parse(itemUriTemplate.match(uri)),
        ctx,
      );

      expect(result.item_id).toBe(lccn);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(new URL(String(fetchSpy.mock.calls[0]![0])).pathname).toBe(`/item/${lccn}/`);
    });

    it('names the accepted forms in its invalid_item_id message and recovery on the wire (#68)', async () => {
      vi.stubGlobal('fetch', vi.fn());
      const uri = 'libofcongress://item/lccn.loc.gov/2005-5682940';

      const error = await readItemResourceError(uri);

      expect(error.message).toBe(
        '"lccn.loc.gov/2005-5682940" is not a LOC item ID, a loc.gov item link, or an LCCN permalink.',
      );
      expect(contractRecovery(locItemResource, 'invalid_item_id')).toBe(
        'Use the id from a libofcongress_search_items result, written with its slashes intact (libofcongress://item/sn95047246/1935-09-05/ed-1), or a loc.gov item link or lccn.loc.gov permalink in its place; blanks and a hyphen in a permalink LCCN are normalized. An LCCN that still fails is malformed: find the item with libofcongress_search_items.',
      );
      expect(error.data).toMatchObject({
        recovery: { hint: contractRecovery(locItemResource, 'invalid_item_id') },
      });
      const entry = locItemResource.errors!.find((e) => e.reason === 'invalid_item_id')!;
      expect(entry.when).toBe(
        'item_id is not a LOC item ID, a loc.gov /item/ link, or an lccn.loc.gov permalink to an LCCN: a URL on another loc.gov or lccn.loc.gov path or another host, an LCCN that does not normalize to up to three lowercase letters and 8 or 10 digits, or text with characters or segments no LOC ID has.',
      );
    });

    it.each([
      [
        'an encoded lccn.loc.gov MARC XML link (#68)',
        'libofcongress://item/https%3A%2F%2Flccn.loc.gov%2F2005567251%2Fmarcxml',
      ],
      [
        'an LCCN on lccn.loc.gov that does not normalize (#68)',
        'libofcongress://item/lccn.loc.gov/2005-5682940',
      ],
      ['an encoded dot-segment traversal', 'libofcongress://item/%2e%2e%2f%2e%2e%2fcollections'],
      [
        'an encoded /resource/ page URL',
        'libofcongress://item/https%3A%2F%2Fwww.loc.gov%2Fresource%2Fmss93930.mss93930-001%2F',
      ],
      ['an encoded foreign host', 'libofcongress://item/https%3A%2F%2Fevil.example%2Fitem%2F1%2F'],
      ['a malformed percent-escape', 'libofcongress://item/%E0%A4%A'],
      ['a lone percent sign', 'libofcongress://item/100%'],
      ['well-formed escapes of bytes that are not UTF-8', 'libofcongress://item/%E0%A4'],
    ])('rejects %s as invalid_item_id on the wire before any request', async (_name, uri) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      expect(await readItemResourceError(uri)).toMatchObject({
        code: JsonRpcErrorCode.ValidationError,
        data: {
          reason: 'invalid_item_id',
          field: 'item_id',
          recovery: { hint: contractRecovery(locItemResource, 'invalid_item_id') },
        },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it('returns the captured HTML rights as plain text and keeps the notes brackets (#65)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            ...MANUSCRIPT_ITEM_MM77093930.item,
            rights: MANUSCRIPT_RIGHTS_MM77093930,
            notes: NEWSPAPER_NOTES_SN83030214,
          },
        }),
      ),
    );
    const ctx = createResourceContext({ uri: new URL('libofcongress://item/mm77093930') });
    const result = await callItemResource(
      locItemResource.params!.parse({ item_id: 'mm77093930' }),
      ctx,
    );
    // The reduction itself is tabled in loc-text.test.ts; this proves the resource carries it.
    expect(result.rights_information).toBe(
      'The contents of the Library of Congress Betty Herndon Maury Maury collection are in the public domain and are free to use and reuse. Credit Line: Library of Congress, Manuscript Division, Betty Herndon Maury Maury Diary. More about Copyright and other Restrictions (https://www.loc.gov/legal/). For guidance about compiling full citations consult Citing Primary Sources (https://www.loc.gov/teachers/usingprimarysources/citing.html).',
    );
    expect(result.notes).toEqual(NEWSPAPER_NOTES_SN83030214);
  });

  // Rate-limit test last — sets module-level rateLimitBlockedUntil
  it('forwards the most specific rate-limit hint in the error data: a fresh 429, then the running block (#44)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('Too Many Requests', { status: 429 }));
    vi.stubGlobal('fetch', fetchSpy);
    const params = locItemResource.params!.parse({ item_id: '2016687584' });
    const uri = new URL('libofcongress://item/2016687584');

    await expect(callItemResource(params, createResourceContext({ uri }))).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: {
        reason: 'rate_limit_exceeded',
        retryable: false,
        recovery: { hint: expect.stringMatching(/1 hour/) },
      },
    });
    await expect(callItemResource(params, createResourceContext({ uri }))).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: {
        reason: 'rate_limit_exceeded',
        blockedUntil: expect.any(String),
        recovery: { hint: expect.stringMatching(/60 more minute/) },
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
