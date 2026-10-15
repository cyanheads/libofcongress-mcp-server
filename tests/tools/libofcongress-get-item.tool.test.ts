/**
 * @fileoverview Tests for libofcongress_get_item tool.
 * @module tests/tools/libofcongress-get-item.tool.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locGetItem } from '@/mcp-server/tools/definitions/libofcongress-get-item.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';
import { htmlToText } from '@/services/loc-api/loc-text.js';
import {
  AUDIO_ITEM_2023622861,
  AUDIO_ITEM_JUKEBOX_68453,
  BASEBALL_CARD_ITEM_2008676581,
  BOOK_ITEM_00003348,
  BOOK_ITEM_02007458,
  BOOK_ITEM_2005567251,
  BOOK_ITEM_2024769398,
  MANUSCRIPT_ITEM_MM77093930,
  MAP_ITEM_98688514,
  NEWSPAPER_ISSUE_SN83030214_1912_04_16,
  PHOTO_ITEM_2017760320,
} from '../fixtures/loc-items.js';
import { MAP_ITEM_77694805 } from '../fixtures/loc-subjects.js';
import { MANUSCRIPT_RIGHTS_MM77093930, NEWSPAPER_NOTES_SN83030214 } from '../fixtures/loc-text.js';
import { serveByHost } from '../helpers/loc-fetch.js';
import { contentText, contractRecovery, structured, wireError } from '../helpers/tool-result.js';

/** Full LOC item response fixture */
function makeItemResponse(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    item: {
      id: 'https://www.loc.gov/item/2009632251/',
      title: 'Portrait of a man',
      date: '1920',
      // Live item JSON carries names-with-roles in contributor_names and the same people as
      // { name: facet-url } objects in contributors — never a `contributor` key.
      contributor_names: ['Smith, John (Photographer)', 'Jones, Mary (Publisher)'],
      contributors: [
        { 'smith, john': 'https://www.loc.gov/search/?fa=contributor:smith,+john&fo=json' },
        { 'jones, mary': 'https://www.loc.gov/search/?fa=contributor:jones,+mary&fo=json' },
      ],
      // Live item JSON: `subject` holds the lowercase facet terms, `subject_headings` the LCSH
      // headings the terms were split from.
      subject: ['portraits', 'men', 'photographs'],
      subject_headings: ['Portraits', 'Men--Photographs'],
      notes: ['From the Bain collection.'],
      rights_information: 'No known restrictions.',
      physical_description: '1 photograph : silver gelatin ; 5 x 4 in.',
      url: 'https://www.loc.gov/item/2009632251/',
      ...overrides,
    },
    resources: [
      {
        url: 'https://tile.loc.gov/image-services/iiif/service:pnp:2009632251/full/pct:12.5/0/default.jpg',
        image:
          'https://tile.loc.gov/image-services/iiif/service:pnp:2009632251/full/!512,512/0/default.jpg',
      },
    ],
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

describe('locGetItem upstream text (#65)', () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unmocked fetch'));
    initLocApiService(config, await createInMemoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the captured HTML rights as plain text on both surfaces', async () => {
    serveByHost({
      'www.loc.gov': {
        item: { ...MANUSCRIPT_ITEM_MM77093930.item, rights: MANUSCRIPT_RIGHTS_MM77093930 },
        resources: [],
      },
    });
    const result = await runToolContract(locGetItem, { item_id: 'mm77093930' });
    // The HTML-to-text reduction is tabled in loc-text.test.ts; this proves item.rights reaches it.
    const rights = htmlToText(MANUSCRIPT_RIGHTS_MM77093930.join(' '));
    expect(structured(result).rights_information).toBe(rights);
    expect(contentText(result)).toContain(`\n**Rights:** ${rights}\n`);
  });

  it('escapes markup in catalog text in content[] only; notes keep their catalog brackets', async () => {
    serveByHost({
      'www.loc.gov': {
        item: {
          title: 'Diary &lt;i&gt;draft&lt;/i&gt;',
          created_published_date: '1861 <Apr.>',
          contributor_names: ['Maury, Betty &lt;b&gt;'],
          subject_headings: ['Diaries\r\n--Virginia'],
          subject: ['diaries <i>'],
          summary: ['A diary &amp;lt;b&amp;gt;.'],
          medium: ['1 v. <u>'],
          call_number: ['LOT 6668 <item> [P&amp;P]'],
          language: ['english <x>'],
          location: ['virginia <y>'],
          original_format: ['manuscript/mixed material'],
          online_format: ['image <z>'],
          notes: [...NEWSPAPER_NOTES_SN83030214, 'Gift &lt;b&gt;', '1898. Gift of the family.'],
          number_former_id: ['https://hdl.loc.gov/loc.mss/mm.77093930?a=1&b=2'],
          related_items: [{ title: 'Related &lt;i&gt;' }, 'Related string &lt;u&gt;'],
          rights_information: ['Public domain &lt;b&gt;.'],
          url: 'https://www.loc.gov/item/mm77093930/',
        },
      },
    });
    const result = await runToolContract(locGetItem, { item_id: 'mm77093930' });
    expect(structured(result)).toMatchObject({
      title: 'Diary <i>draft</i>',
      call_number: 'LOT 6668 <item> [P&P]',
      subject_headings: ['Diaries\r\n--Virginia'],
      summary: 'A diary &lt;b&gt;.',
      notes: [...NEWSPAPER_NOTES_SN83030214, 'Gift <b>', '1898. Gift of the family.'],
      rights_information: 'Public domain <b>.',
      related_items: ['Related <i>', 'Related string <u>'],
    });
    const text = contentText(result);
    for (const line of [
      '# Diary \\<i>draft\\</i>\n',
      '**Date:** 1861 \\<Apr.>\n',
      '**Contributors:** Maury, Betty \\<b>\n',
      '**Subject headings:** Diaries --Virginia\n',
      '**Subject terms:** diaries \\<i>\n',
      '**Languages:** english \\<x>\n',
      '**Locations:** virginia \\<y>\n',
      '**Summary:** A diary \\&lt;b\\&gt;.\n',
      '**Physical description:** 1 v. \\<u>\n',
      '**Original format:** manuscript/mixed material\n',
      '**Online format:** image \\<z>\n',
      '**Call number:** LOT 6668 \\<item> [P&P]\n',
      '**Former IDs:** https://hdl.loc.gov/loc.mss/mm.77093930?a=1&b=2\n',
      '- Semiweekly ed.: New-York tribune (New York, N.Y. : 1866 : Semiweekly), 1866-<1899>.\n',
      '- Gift \\<b>\n',
      '- 1898\\. Gift of the family.\n',
      '**Rights:** Public domain \\<b>.\n',
      '**Related items:** Related \\<i>, Related string \\<u>\n',
      '**URL:** https://www.loc.gov/item/mm77093930/',
    ]) {
      expect(text).toContain(line);
    }
  });
});

describe('locGetItem', () => {
  beforeEach(async () => {
    // A test that forgets its stub fails here instead of reaching LOC, which blocks for an hour.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unmocked fetch')));
    const storage = await createInMemoryStorage();
    initLocApiService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns full item metadata for a valid ID', async () => {
    vi.stubGlobal('fetch', mockFetch(makeItemResponse()));
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: '2009632251' });
    const result = await locGetItem.handler(input, ctx);

    expect(result.item_id).toBe('2009632251');
    expect(result.title).toBe('Portrait of a man');
    expect(result.date).toBe('1920');
    expect(result.contributors).toEqual(['Smith, John (Photographer)', 'Jones, Mary (Publisher)']);
    expect(result.subject_headings).toEqual(['Portraits', 'Men--Photographs']);
    expect(result.subject_terms).toEqual(['portraits', 'men', 'photographs']);
    expect(result.notes).toContain('From the Bain collection.');
    expect(result.rights_information).toBe('No known restrictions.');
    expect(result.physical_description).toBe('1 photograph : silver gelatin ; 5 x 4 in.');
    expect(result.resources).toHaveLength(1);
    expect(result.url).toBe('https://www.loc.gov/item/2009632251/');
  });

  it('returns empty arrays for optional array fields omitted from upstream', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Minimal Item',
            url: 'https://www.loc.gov/item/min-id/',
            // contributor_names, subject, notes all absent
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: 'min-id' });
    const result = await locGetItem.handler(input, ctx);

    expect(result.contributors).toEqual([]);
    expect(result.subject_headings).toEqual([]);
    expect(result.subject_terms).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.resources).toEqual([]);
    expect(result.pages).toEqual([]);
    expect(result.page_total).toBe(0);
    expect(result.next_page_offset).toBeUndefined();
    expect(result.related_items).toEqual([]);
    expect(result.date).toBeUndefined();
    expect(result.rights_information).toBeUndefined();
    expect(result.physical_description).toBeUndefined();
    expect(result.languages).toEqual([]);
    expect(result.locations).toEqual([]);
    expect(result.former_ids).toEqual([]);
    expect(result.original_formats).toEqual([]);
    expect(result.online_formats).toEqual([]);
    expect(result.summary).toBeUndefined();
    expect(result.call_number).toBeUndefined();
    expect(result.access_restricted).toBeUndefined();
  });

  it('returns the curated metadata fields for a dense item', async () => {
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
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: '2005680380' });
    const result = await locGetItem.handler(input, ctx);

    expect(result.summary).toBe('A political cartoon commenting on the 1884 election.');
    expect(result.languages).toEqual(['english']);
    expect(result.locations).toEqual(['united states']);
    expect(result.call_number).toBe('Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]');
    expect(result.former_ids).toEqual(['http://www.loc.gov/item/13903333']);
    expect(result.original_formats).toEqual(['photo, print, drawing']);
    expect(result.online_formats).toEqual(['image']);
    expect(result.access_restricted).toBe(true);
    // The result satisfies the declared output contract, not just the type.
    expect(() => locGetItem.output.parse(result)).not.toThrow();
  });

  it('NotFound data carries the caller-facing id, never the internal request URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: 'TOTALLY_FAKE_ID' });
    const err = await Promise.resolve(locGetItem.handler(input, ctx)).catch((e: unknown) => e);

    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect(data.reason).toBe('item_not_found');
    expect(data.itemId).toBe('TOTALLY_FAKE_ID');
  });

  it('ServiceUnavailable from an HTML body does not leak the internal request URL', async () => {
    // Neither tool's catch block remaps ServiceUnavailable, so this error reaches the
    // client with whatever data the service attached — the fix has to be at the source.
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Rate limited</body></html>'));
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: '2009632251' });
    const err = await Promise.resolve(locGetItem.handler(input, ctx)).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
    const data = (err as { data?: Record<string, unknown> }).data ?? {};
    expect(data).not.toHaveProperty('url');
    expect(JSON.stringify(data)).not.toContain('fo=json');
    expect((err as Error).message).not.toContain('www.loc.gov');
  });

  it('lists each resource once, its url and image as separate fields (#63)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: { title: 'Dup test', url: 'https://www.loc.gov/item/dup/' },
          resources: [
            { url: 'https://tile.loc.gov/same.jpg', image: 'https://tile.loc.gov/same.jpg' },
          ],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: 'dup' });
    const result = await locGetItem.handler(input, ctx);
    expect(result.resources).toEqual([
      {
        url: 'https://tile.loc.gov/same.jpg',
        page_count: 0,
        image: 'https://tile.loc.gov/same.jpg',
      },
    ]);
  });

  it('format() renders title, ID, subjects, and URL', () => {
    const output = locGetItem.output.parse({
      item_id: 'loc.pnp.ppmsc.02404',
      title: 'Portrait of Abraham Lincoln',
      date: '1865',
      contributors: ['Brady, Mathew B.'],
      subject_headings: ['Presidents--United States--Portraits', 'Lincoln, Abraham, 1809-1865'],
      subject_terms: ['presidents', 'united states', 'portraits', 'lincoln, abraham'],
      notes: [],
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      resources: [{ url: 'https://www.loc.gov/resource/ppmsc.02404/', page_count: 1 }],
      pages: [{ page_url: 'https://www.loc.gov/resource/ppmsc.02404/', has_text: false }],
      page_total: 1,
      related_items: [],
      url: 'https://www.loc.gov/item/loc.pnp.ppmsc.02404/',
    });
    const blocks = locGetItem.format!(output);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('loc.pnp.ppmsc.02404');
    expect(text).toContain('Portrait of Abraham Lincoln');
    expect(text).toContain('Brady, Mathew B.');
    // Headings carry commas, so they are joined with semicolons.
    expect(text).toContain(
      '**Subject headings:** Presidents--United States--Portraits; Lincoln, Abraham, 1809-1865',
    );
    expect(text).toContain(
      '**Subject terms:** presidents; united states; portraits; lincoln, abraham',
    );
    expect(text).toContain('https://www.loc.gov/item/loc.pnp.ppmsc.02404/');
  });

  it('returns the LCSH headings and the facet terms as separate fields on both surfaces (#57)', async () => {
    // Live 77694805: the facet terms the old subject_headings carried are now subject_terms.
    vi.stubGlobal('fetch', mockFetch(JSON.stringify(MAP_ITEM_77694805)));

    const result = await runToolContract(locGetItem, { item_id: '77694805' });

    const sc = structured(result);
    expect(sc.subject_headings).toEqual([
      'Transportation--Oklahoma--Maps',
      'Railroads--Oklahoma--Maps',
      'United States--Oklahoma',
    ]);
    expect(sc.subject_terms).toEqual([
      'maps',
      'transportation',
      'united states',
      'railroads',
      'oklahoma',
    ]);
    const text = contentText(result);
    expect(text).toContain(
      '**Subject headings:** Transportation--Oklahoma--Maps; Railroads--Oklahoma--Maps; United States--Oklahoma',
    );
    expect(text).toContain(
      '**Subject terms:** maps; transportation; united states; railroads; oklahoma',
    );
  });

  describe('date as cataloged (#62)', () => {
    /** Answers www.loc.gov item requests with `body`; anything else stays unmocked. */
    const serveItem = (body: unknown) =>
      vi.fn(async (url: string | URL | Request) => {
        if (new URL(String(url)).hostname !== 'www.loc.gov') throw new Error('unmocked fetch');
        return new Response(JSON.stringify(body), { status: 200 });
      });

    it.each([
      { name: 'FSA photo', id: '2017760320', body: PHOTO_ITEM_2017760320, date: '1936 Apr.' },
      {
        name: 'baseball card',
        id: '2008676581',
        body: BASEBALL_CARD_ITEM_2008676581,
        date: '1909-1911.',
      },
      { name: 'book', id: '02007458', body: BOOK_ITEM_02007458, date: '1894' },
      { name: 'map', id: '98688514', body: MAP_ITEM_98688514, date: '1894' },
      { name: 'manuscript', id: 'mm77093930', body: MANUSCRIPT_ITEM_MM77093930, date: '1861' },
      {
        name: 'sound recording',
        id: 'jukebox-68453',
        body: AUDIO_ITEM_JUKEBOX_68453,
        date: '1923-11-07',
      },
      {
        name: 'newspaper issue',
        id: 'sn83030214/1912-04-16/ed-1',
        body: NEWSPAPER_ISSUE_SN83030214_1912_04_16,
        date: '1912-04-16',
      },
    ])('returns the $name date LOC catalogs on both surfaces', async ({ id, body, date }) => {
      vi.stubGlobal('fetch', serveItem(body));

      const result = await runToolContract(locGetItem, { item_id: id });

      expect(structured(result).date).toBe(date);
      expect(contentText(result)).toContain(`**Date:** ${date}\n`);
    });

    it('describes date as the cataloged value', () => {
      expect(locGetItem.output.shape.date.description).toMatch(/as LOC catalogs it/);
    });
  });

  describe('coded item.date (#69)', () => {
    it.each([
      ['00003348', BOOK_ITEM_00003348, '0w0 d1804 d1806'],
      ['2005567251', BOOK_ITEM_2005567251, 'uuuu'],
      ['2024769398', BOOK_ITEM_2024769398, '||||'],
    ])('omits the coded date of %s on both surfaces', async (itemId, body, coded) => {
      serveByHost({ 'www.loc.gov': body });

      const result = await runToolContract(locGetItem, { item_id: itemId });

      expect(result.isError).toBeFalsy();
      expect(structured(result)).not.toHaveProperty('date');
      const text = contentText(result);
      expect(text).not.toContain('**Date:**');
      expect(text).not.toContain(coded);
      expect(text).toContain(`**ID:** ${itemId}\n`);
    });

    it('keeps a placeholder-free estimate such as 200? on both surfaces', async () => {
      vi.stubGlobal('fetch', mockFetch(makeItemResponse({ date: '200?' })));

      const result = await runToolContract(locGetItem, { item_id: '2004533406' });

      expect(structured(result).date).toBe('200?');
      expect(contentText(result)).toContain('**Date:** 200?\n');
    });

    it('describes date as absent when LOC records only a coded value', () => {
      expect(locGetItem.output.shape.date.description).toMatch(
        /[Aa]bsent when LOC records only a coded value/,
      );
    });
  });

  describe('imprint (#71)', () => {
    it('returns the imprint of 00003348 on both surfaces, next to the title and ID', async () => {
      serveByHost({ 'www.loc.gov': BOOK_ITEM_00003348 });

      const result = await runToolContract(locGetItem, { item_id: '00003348' });

      expect(structured(result).imprint).toBe('New York : Werner School Book Company, c1900.');
      expect(contentText(result)).toContain(
        [
          '# The story of Captain Meriwether Lewis and Captain William Clark : for young readers',
          '**ID:** 00003348',
          '**Imprint:** New York : Werner School Book Company, c1900.',
          '**Call number:** F592.7 .K55',
        ].join('\n'),
      );
    });

    it('joins a two-entry imprint on both surfaces', async () => {
      serveByHost({ 'www.loc.gov': AUDIO_ITEM_2023622861 });

      const result = await runToolContract(locGetItem, { item_id: '2023622861' });

      expect(structured(result).imprint).toBe('Millwood, NY : ZOHO Music, [2017] ℗2017');
      expect(contentText(result)).toContain(
        '**Date:** 2017\n**Imprint:** Millwood, NY : ZOHO Music, [2017] ℗2017\n',
      );
    });

    it.each([
      [
        'cataloging brackets',
        'Roma : Carocci, 2013-<2021>',
        'Roma : Carocci, 2013-<2021>',
        // A "<" before a digit opens no tag, so it renders as sent.
        'Roma : Carocci, 2013-<2021>',
      ],
      [
        'a decoded tag-like reference',
        'Paris : &lt;i&gt;Gallimard, 1950.',
        'Paris : <i>Gallimard, 1950.',
        'Paris : \\<i>Gallimard, 1950.',
      ],
    ])(
      'keeps %s verbatim in structuredContent and escapes only a tag opener in content[]',
      async (_name, raw, imprint, rendered) => {
        vi.stubGlobal('fetch', mockFetch(makeItemResponse({ created_published: [raw] })));

        const result = await runToolContract(locGetItem, { item_id: '2009632251' });

        expect(structured(result).imprint).toBe(imprint);
        expect(contentText(result)).toContain(`\n**Imprint:** ${rendered}\n`);
      },
    );

    it('omits imprint and its line when the record carries none', async () => {
      serveByHost({ 'www.loc.gov': BOOK_ITEM_2005567251 });

      const result = await runToolContract(locGetItem, { item_id: '2005567251' });

      expect(result.isError).toBeFalsy();
      expect(structured(result)).not.toHaveProperty('imprint');
      expect(contentText(result)).not.toContain('**Imprint:**');
    });

    it('describes imprint in the output schema and the tool description', () => {
      expect(locGetItem.output.shape.imprint.description).toMatch(/place, publisher, and date/);
      expect(locGetItem.description).toContain('imprint');
    });
  });

  describe('page window (#63)', () => {
    const serveItem = (body: unknown) => {
      const spy = vi.fn(async (url: string | URL | Request) => {
        if (new URL(String(url)).hostname !== 'www.loc.gov') throw new Error('unmocked fetch');
        return new Response(JSON.stringify(body), { status: 200 });
      });
      vi.stubGlobal('fetch', spy);
      return spy;
    };
    const bytes = (value: unknown) =>
      Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));

    it('lists 50 of 582 book pages with next_page_offset, each surface under 8 KB', async () => {
      serveItem(BOOK_ITEM_02007458);

      const result = await runToolContract(locGetItem, { item_id: '02007458' });

      const sc = structured(result);
      expect(sc).toMatchObject({ page_total: 582, next_page_offset: 50 });
      expect(sc.pages).toHaveLength(50);
      expect(sc).not.toHaveProperty('resource_links');
      expect((sc.pages as Array<Record<string, unknown>>)[0]).toEqual({
        page_url: 'https://www.loc.gov/resource/gdcmassbookdig.popularhistoryof00chen/?sp=1',
        has_text: true,
      });
      const text = contentText(result);
      expect(text).toContain('**Pages 1–50 of 582 — next_page_offset: 50:**');
      expect(text).toContain(
        '- https://www.loc.gov/resource/gdcmassbookdig.popularhistoryof00chen/?sp=50 (has text)',
      );
      expect(text).not.toContain('?sp=51');
      expect(text).toContain(BOOK_ITEM_02007458.resources[0]!.pdf);
      expect(bytes(sc)).toBeLessThan(8_000);
      expect(bytes(text)).toBeLessThan(8_000);
      expect(sc).not.toHaveProperty('notice');
    });

    it('adds each page file on include_files, scoped to the window', async () => {
      serveItem(BOOK_ITEM_02007458);

      const result = await runToolContract(locGetItem, {
        item_id: '02007458',
        page_offset: 10,
        page_limit: 2,
        include_files: true,
      });

      const pages = structured(result).pages as Array<{ page_url: string; files: string[] }>;
      expect(pages.map((p) => p.page_url)).toEqual([
        'https://www.loc.gov/resource/gdcmassbookdig.popularhistoryof00chen/?sp=11',
        'https://www.loc.gov/resource/gdcmassbookdig.popularhistoryof00chen/?sp=12',
      ]);
      // The text/plain entry has no url of its own, so six of the seven entries list.
      expect(pages[0]!.files).toHaveLength(6);
      expect(pages[0]!.files[0]).toBe(
        'https://tile.loc.gov/storage-services/public/gdcmassbookdig/popularhistoryof00chen/popularhistoryof00chen_0011.alto.xml',
      );
      const text = contentText(result);
      expect(text).toContain('**Pages 11–12 of 582 — next_page_offset: 12:**');
      for (const file of [...pages[0]!.files, ...pages[1]!.files])
        expect(text).toContain(`  - ${file}`);
      expect(text).not.toContain('popularhistoryof00chen_0013');
    });

    it('serves a page_limit past 100 as 100 pages and discloses it on both surfaces', async () => {
      serveItem(BOOK_ITEM_02007458);

      const result = await runToolContract(locGetItem, { item_id: '02007458', page_limit: 300 });

      const sc = structured(result);
      expect(sc.pages).toHaveLength(100);
      expect(sc).toMatchObject({ effectivePageLimit: 100, next_page_offset: 100 });
      const notice =
        'Requested page_limit 300 exceeds the per-call cap of 100; this response lists up to 100 pages. Request page_offset 100 for the next pages.';
      expect(sc.notice).toBe(notice);
      expect(contentText(result)).toContain(notice);
    });

    it('rejects a page_limit above 1000 and a negative page_offset at the schema', () => {
      expect(() => locGetItem.input.parse({ item_id: '1', page_limit: 1001 })).toThrow();
      expect(() => locGetItem.input.parse({ item_id: '1', page_limit: 0 })).toThrow();
      expect(() => locGetItem.input.parse({ item_id: '1', page_offset: -1 })).toThrow();
    });

    it('returns an empty page list with a notice for an offset past the last page', async () => {
      serveItem(BOOK_ITEM_02007458);

      const result = await runToolContract(locGetItem, { item_id: '02007458', page_offset: 600 });

      const sc = structured(result);
      expect(sc).toMatchObject({ pages: [], page_total: 582 });
      expect(sc).not.toHaveProperty('next_page_offset');
      const notice =
        'page_offset 600 is past the last page: this item has 582 page(s). Use a page_offset from 0 to 581.';
      expect(sc.notice).toBe(notice);
      const text = contentText(result);
      expect(text).toContain(notice);
      expect(text).toContain('**Pages:** none listed of 582');
    });

    it('keeps both notices when a capped page_limit also lands past the last page', async () => {
      serveItem(BASEBALL_CARD_ITEM_2008676581);

      const sc = structured(
        await runToolContract(locGetItem, {
          item_id: '2008676581',
          page_offset: 5,
          page_limit: 500,
        }),
      );

      expect(sc.notice).toBe(
        'Requested page_limit 500 exceeds the per-call cap of 100; this response lists up to 100 pages. page_offset 5 is past the last page: this item has 2 page(s). Use a page_offset from 0 to 1.',
      );
    });

    it("lists a recording's MP3 as its resource audio on both surfaces", async () => {
      serveItem(AUDIO_ITEM_JUKEBOX_68453);

      const result = await runToolContract(locGetItem, { item_id: 'jukebox-68453' });

      const mp3 = AUDIO_ITEM_JUKEBOX_68453.resources[0]!.audio;
      expect((structured(result).resources as Array<{ audio?: string }>)[0]!.audio).toBe(mp3);
      expect(contentText(result)).toContain(
        `- https://www.loc.gov/resource/jukebox-68453.0 — 1 page(s); audio: ${mp3}`,
      );
    });

    it('lists the diary page 3 url with has_text for the page reader', async () => {
      serveItem(MANUSCRIPT_ITEM_MM77093930);

      const sc = structured(await runToolContract(locGetItem, { item_id: 'mm77093930' }));

      expect((sc.pages as unknown[])[2]).toEqual({
        page_url: 'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
        has_text: true,
      });
      expect((sc.pages as unknown[])[4]).toMatchObject({ has_text: false });
    });
  });

  it('describes subject_terms as values the search subject filter accepts', () => {
    expect(locGetItem.output.shape.subject_terms.description).toMatch(
      /libofcongress_search_items subject filter/,
    );
  });

  it('format() renders sparse item without optional fields', () => {
    const output = locGetItem.output.parse({
      item_id: 'sparse-id',
      title: 'Sparse Item',
      contributors: [],
      subject_headings: [],
      subject_terms: [],
      notes: [],
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      resources: [],
      pages: [],
      page_total: 0,
      related_items: [],
      url: 'https://www.loc.gov/item/sparse-id/',
    });
    const blocks = locGetItem.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('sparse-id');
    expect(text).toContain('Sparse Item');
    // Nothing fabricated for absent upstream data.
    expect(text).not.toContain('Summary:');
    expect(text).not.toContain('Call number:');
    expect(text).not.toContain('Access restricted:');
    expect(text).not.toContain('Languages:');
  });

  it('format() renders every curated metadata field', () => {
    const output = locGetItem.output.parse({
      item_id: '2005680380',
      title: 'Political cartoon',
      summary: 'A political cartoon commenting on the 1884 election.',
      contributors: [],
      subject_headings: [],
      subject_terms: [],
      notes: [],
      languages: ['english'],
      locations: ['united states'],
      call_number: 'Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]',
      former_ids: ['http://www.loc.gov/item/13903333'],
      original_formats: ['photo, print, drawing'],
      online_formats: ['image'],
      access_restricted: true,
      resources: [],
      pages: [],
      page_total: 0,
      related_items: [],
      url: 'https://www.loc.gov/item/2005680380/',
    });
    const text = (locGetItem.format!(output)[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('A political cartoon commenting on the 1884 election.');
    expect(text).toContain('english');
    expect(text).toContain('united states');
    expect(text).toContain('Unprocessed in PR 13 CN 2001:055-4 [item] [P&P]');
    expect(text).toContain('http://www.loc.gov/item/13903333');
    expect(text).toContain('photo, print, drawing');
    expect(text).toContain('image');
    expect(text).toContain('**Access restricted:** yes');
  });

  it('format() renders access_restricted: false rather than omitting it', () => {
    const output = locGetItem.output.parse({
      item_id: 'open-item',
      title: 'Open Item',
      contributors: [],
      subject_headings: [],
      subject_terms: [],
      notes: [],
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      access_restricted: false,
      resources: [],
      pages: [],
      page_total: 0,
      related_items: [],
      url: 'https://www.loc.gov/item/open-item/',
    });
    const text = (locGetItem.format!(output)[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('**Access restricted:** no');
  });

  it('rejects empty item_id at schema level', () => {
    expect(() => locGetItem.input.parse({ item_id: '' })).toThrow();
  });

  /**
   * A content[]-only client (Claude Desktop) never sees structuredContent, so an entry
   * format() omits is unreachable for it — an overflow count discloses the gap without
   * closing it. The format-parity lint rule injects a single-element array, so it cannot
   * see truncation; these assertions are the only thing holding the arrays complete.
   */
  it('format() renders every related_items entry, not a truncated head', () => {
    const related = Array.from({ length: 7 }, (_, i) => `https://www.loc.gov/item/rel${i}/`);
    const output = locGetItem.output.parse({
      item_id: 'many-related',
      title: 'Item with many related',
      contributors: [],
      subject_headings: [],
      subject_terms: [],
      notes: [],
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      resources: [],
      pages: [],
      page_total: 0,
      related_items: related,
      url: 'https://www.loc.gov/item/many-related/',
    });
    const blocks = locGetItem.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    for (const entry of related) expect(text).toContain(entry);
    expect(text).not.toContain('more');
  });

  it('format() renders every resource field, not a truncated head (#63)', () => {
    const resources = Array.from({ length: 8 }, (_, i) => ({
      url: `https://www.loc.gov/resource/multi.${i}/`,
      page_count: i,
      image: `https://tile.loc.gov/multi/${i}.jpg`,
      pdf: `https://tile.loc.gov/multi/${i}.pdf`,
      audio: `https://tile.loc.gov/multi/${i}.mp3`,
    }));
    const output = locGetItem.output.parse({
      item_id: 'multi-resource',
      title: 'Item with many resources',
      contributors: [],
      subject_headings: [],
      subject_terms: [],
      notes: [],
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      resources,
      pages: [],
      page_total: 0,
      related_items: [],
      url: 'https://www.loc.gov/item/multi-resource/',
    });
    const blocks = locGetItem.format!(output);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    for (const r of resources) {
      for (const value of [r.url, r.image, r.pdf, r.audio, `${r.page_count} page(s)`])
        expect(text).toContain(value);
    }
    expect(text).toContain('**Resources (8):**');
    expect(text).toContain('**Pages:** none listed of 0');
  });

  it('format() reaches every structuredContent array value on a full window with files (#63)', () => {
    // A full window: the 100-page cap, each page with its files, plus related items.
    const pages = Array.from({ length: 100 }, (_, i) => ({
      page_url: `https://www.loc.gov/resource/mgw1b.721/?sp=${i + 201}`,
      has_text: i % 2 === 0,
      files: [
        `https://tile.loc.gov/mgw1b.721/${i + 201}.jp2`,
        `https://tile.loc.gov/mgw1b.721/${i + 201}.txt`,
      ],
    }));
    const related = Array.from({ length: 6 }, (_, i) => `https://www.loc.gov/item/rel${i}/`);
    const output = locGetItem.output.parse({
      item_id: 'mgw1b.721',
      title: 'Diary, January 1 - December 31, 1772',
      contributors: [],
      subject_headings: [],
      subject_terms: [],
      notes: [],
      languages: [],
      locations: [],
      former_ids: [],
      original_formats: [],
      online_formats: [],
      resources: [{ url: 'https://www.loc.gov/resource/mgw1b.721/', page_count: 342 }],
      pages,
      page_total: 342,
      next_page_offset: 300,
      related_items: related,
      url: 'https://www.loc.gov/item/mgw1b.721/',
    });
    const text = (locGetItem.format!(output)[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('**Pages 201–300 of 342 — next_page_offset: 300:**');
    for (const page of pages) {
      expect(text).toContain(`- ${page.page_url}${page.has_text ? ' (has text)' : ''}\n`);
      for (const file of page.files) expect(text).toContain(`  - ${file}\n`);
    }
    for (const value of related) expect(text).toContain(value);
  });

  it('returns an absolute https url when upstream item.url is protocol-relative', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: { title: 'Samples of German endpapers', url: '//lccn.loc.gov/2009632251' },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: '2009632251' });
    const result = await locGetItem.handler(input, ctx);
    expect(result.url).toBe('https://lccn.loc.gov/2009632251');
    expect(result.url.startsWith('//')).toBe(false);
  });

  it('resolves a multi-segment newspaper item_id without mangling slashes', async () => {
    const fetchSpy = mockFetch(
      JSON.stringify({
        item: {
          title: 'The Evening Star',
          url: 'https://www.loc.gov/item/sn95047246/1935-09-05/ed-1/',
        },
        resources: [],
        related_items: [],
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext({ errors: locGetItem.errors });
    const input = locGetItem.input.parse({ item_id: 'sn95047246/1935-09-05/ed-1' });
    const result = await locGetItem.handler(input, ctx);
    expect(result.item_id).toBe('sn95047246/1935-09-05/ed-1');
    expect(result.title).toBe('The Evening Star');
    const calledUrl = (fetchSpy.mock.calls[0]![0] as string) ?? '';
    expect(calledUrl).toContain('/item/sn95047246/1935-09-05/ed-1/');
    expect(calledUrl).not.toContain('%2F');
  });

  describe('item_id link forms (#66)', () => {
    /** Serves `body` for www.loc.gov requests; anything else rejects. */
    const serve = (body: unknown) => {
      const spy = vi.fn(async (url: string | URL | Request) => {
        if (new URL(String(url)).hostname !== 'www.loc.gov') throw new Error('unmocked fetch');
        return new Response(JSON.stringify(body), { status: 200 });
      });
      vi.stubGlobal('fetch', spy);
      return spy;
    };
    const requestedPath = (spy: ReturnType<typeof serve>) =>
      new URL(String(spy.mock.calls[0]![0])).pathname;

    // The accepted and rejected link forms are tabled in loc-urls.test.ts; these prove the tool
    // requests and returns the id normalizeItemId reads, and fails before any request on none.
    it('requests the id read from an item link and returns the bare id on both surfaces', async () => {
      const spy = serve(PHOTO_ITEM_2017760320);

      const result = await runToolContract(locGetItem, {
        item_id: 'https://www.loc.gov/item/2017760320/?st=gallery#top',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(requestedPath(spy)).toBe('/item/2017760320/');
      expect(structured(result).item_id).toBe('2017760320');
      expect(contentText(result)).toContain('**ID:** 2017760320\n');
    });

    it('keeps the slashes of a multi-segment newspaper id given as its item URL', async () => {
      const spy = serve(NEWSPAPER_ISSUE_SN83030214_1912_04_16);

      const result = await runToolContract(locGetItem, {
        item_id: 'https://www.loc.gov/item/sn83030214/1912-04-16/ed-1/',
      });

      expect(requestedPath(spy)).toBe('/item/sn83030214/1912-04-16/ed-1/');
      expect(structured(result).item_id).toBe('sn83030214/1912-04-16/ed-1');
    });

    it('requests a non-newspaper multi-segment bare id as given', async () => {
      const itemId = 'prn-06-092/rare-jazz-recordings-uncovered/2006-04-14';
      const spy = serve(PHOTO_ITEM_2017760320);

      await runToolContract(locGetItem, { item_id: itemId });

      expect(requestedPath(spy)).toBe(`/item/${itemId}/`);
    });

    it.each([
      ['a /resource/ page URL', 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1'],
      ["another host's /item/ URL", 'https://evil.example/item/2017760320/'],
    ])('rejects %s as invalid_item_id before any request', async (_name, itemId) => {
      const spy = vi.fn();
      vi.stubGlobal('fetch', spy);

      const result = await runToolContract(locGetItem, { item_id: itemId });

      const error = wireError(result);
      const hint = contractRecovery(locGetItem, 'invalid_item_id');
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.ValidationError,
        data: { reason: 'invalid_item_id', field: 'item_id', received: itemId, recovery: { hint } },
      });
      expect(error.message).toContain('`https://www.loc.gov/item/<id>/`');
      const text = contentText(result);
      expect(text).toContain(`Recovery: ${hint}`);
      // A placeholder outside a code span renders as an HTML tag and vanishes.
      expect(text.replace(/`[^`]*`/g, '')).not.toMatch(/<[a-z]+>/);
      expect(spy).not.toHaveBeenCalled();
    });

    it('names the accepted forms in the item_id description and the invalid_item_id contract', () => {
      const description = String(locGetItem.input.shape.item_id.description);
      expect(description).toContain('https://www.loc.gov/item/');
      expect(description).not.toMatch(/do not prepend/);
      expect(locGetItem.description).not.toMatch(/do not prepend/);
      const entry = locGetItem.errors!.find((e) => e.reason === 'invalid_item_id')!;
      expect(entry).toMatchObject({ code: JsonRpcErrorCode.ValidationError, retryable: false });
      expect(entry.recovery).toContain('https://www.loc.gov/item/');
      expect(entry.recovery).toContain('libofcongress_get_newspaper_page');
    });
  });

  describe('lccn.loc.gov permalinks as item_id (#68)', () => {
    /** Serves `body` for www.loc.gov requests; anything else rejects. */
    const serve = (body: unknown) => {
      const spy = vi.fn(async (url: string | URL | Request) => {
        if (new URL(String(url)).hostname !== 'www.loc.gov') throw new Error('unmocked fetch');
        return new Response(JSON.stringify(body), { status: 200 });
      });
      vi.stubGlobal('fetch', spy);
      return spy;
    };

    it.each([
      ['https://lccn.loc.gov/2005567251', '2005567251'],
      ['http://lccn.loc.gov/2005567251', '2005567251'],
      ['lccn.loc.gov/2005567251/', '2005567251'],
      ['https://lccn.loc.gov/sn83030214?x=1#y', 'sn83030214'],
      ['lccn.loc.gov/2005-568294', '2005568294'],
      ['https://lccn.loc.gov/sn 83030214', 'sn83030214'],
      ['https://lccn.loc.gov/sn%2083030214', 'sn83030214'],
    ])(
      'requests /item/<lccn>/ for %s and returns item_id %s on both surfaces',
      async (itemId, lccn) => {
        const spy = serve(BOOK_ITEM_2005567251);

        const result = await runToolContract(locGetItem, { item_id: itemId });

        expect(spy).toHaveBeenCalledTimes(1);
        expect(new URL(String(spy.mock.calls[0]![0])).pathname).toBe(`/item/${lccn}/`);
        expect(structured(result)).toMatchObject({
          item_id: lccn,
          url: 'https://lccn.loc.gov/2005567251',
        });
        expect(contentText(result)).toContain(`**ID:** ${lccn}\n`);
      },
    );

    it('accepts the lccn.loc.gov link a record lists in related_items', async () => {
      serve(BOOK_ITEM_00003348);
      const first = await runToolContract(locGetItem, { item_id: '00003348' });
      const related = structured(first).related_items as string[];
      expect(related).toContain('http://lccn.loc.gov/2003542660');

      const spy = serve(BOOK_ITEM_2005567251);
      const result = await runToolContract(locGetItem, {
        item_id: 'http://lccn.loc.gov/2003542660',
      });

      expect(result.isError).toBeFalsy();
      expect(new URL(String(spy.mock.calls[0]![0])).pathname).toBe('/item/2003542660/');
      expect(structured(result).item_id).toBe('2003542660');
    });

    it.each([
      'https://lccn.loc.gov/2005567251/marcxml',
      'lccn.loc.gov/2005-5682940',
      'lccn.loc.gov/sn%2B83030214',
      'https://lccn.loc.gov.evil.example/2005567251',
      'https://evil.example/lccn.loc.gov/2005567251',
    ])('rejects %s as invalid_item_id before any request', async (itemId) => {
      const spy = vi.fn();
      vi.stubGlobal('fetch', spy);

      const result = await runToolContract(locGetItem, { item_id: itemId });

      expect(wireError(result)).toMatchObject({
        code: JsonRpcErrorCode.ValidationError,
        data: {
          reason: 'invalid_item_id',
          received: itemId,
          recovery: { hint: contractRecovery(locGetItem, 'invalid_item_id') },
        },
      });
      expect(spy).not.toHaveBeenCalled();
    });

    it('names the lccn.loc.gov form in the description, item_id, and invalid_item_id contract', () => {
      expect(locGetItem.description).toContain('https://lccn.loc.gov/<lccn>');
      expect(String(locGetItem.input.shape.item_id.description)).toContain(
        'https://lccn.loc.gov/2005567251',
      );
      const entry = locGetItem.errors!.find((e) => e.reason === 'invalid_item_id')!;
      expect(entry.when).toContain('lccn.loc.gov');
      expect(entry.recovery).toContain('lccn.loc.gov');
    });

    it('describes LCCN normalization in item_id and the invalid_item_id contract, and breaks the retry loop', () => {
      expect(String(locGetItem.input.shape.item_id.description)).toContain(
        '"lccn.loc.gov/2005-568294" reads as 2005568294',
      );
      const entry = locGetItem.errors!.find((e) => e.reason === 'invalid_item_id')!;
      expect(entry.when).toBe(
        'item_id is not a LOC item ID, a loc.gov /item/ link, or an lccn.loc.gov permalink to an LCCN: a URL on another loc.gov or lccn.loc.gov path (such as a /resource/ page URL) or another host, an LCCN that does not normalize to up to three lowercase letters and 8 or 10 digits, or text with characters or segments no LOC ID has.',
      );
      expect(entry.recovery).toBe(
        'Pass the id from a libofcongress_search_items result, a loc.gov item link (`https://www.loc.gov/item/<id>/`), or an LCCN permalink (`https://lccn.loc.gov/<lccn>`; blanks and a hyphen in the LCCN are normalized). An LCCN that still fails is malformed: find the item with libofcongress_search_items. To read a /resource/ page URL, pass it to libofcongress_get_newspaper_page instead.',
      );
    });
  });

  it('succeeds on both surfaces for an item whose item.related_items holds objects (#39, #47)', async () => {
    // afc9999005.10348's live shape: item.related_items mixes in { title, url } objects, and
    // the contributors live in contributor_names. Before the fix the object entries reached
    // output validation and failed the call outright.
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'Dust bowl refugees',
            url: 'https://www.loc.gov/item/afc9999005.10348/',
            contributor_names: [
              'Lomax, Alan (1915-2002) (Recordist)',
              'Guthrie, Woody (1912-1967) (Performer)',
            ],
            related_items: [
              'string-related-id',
              {
                title: 'Alan Lomax Collection of Woody Guthrie Recordings (AFC 1940/007)',
                url: 'https://lccn.loc.gov/2009655315',
              },
            ],
          },
          resources: [],
          related_items: [
            { id: 'http://lccn.loc.gov/2002522665', url: '//lccn.loc.gov/2002522665' },
          ],
        }),
      ),
    );
    const result = await runToolContract(locGetItem, { item_id: 'afc9999005.10348' });

    expect(result.isError).toBeFalsy();
    const sc = structured(result);
    expect(sc.related_items).toEqual([
      'http://lccn.loc.gov/2002522665',
      'string-related-id',
      'https://lccn.loc.gov/2009655315',
    ]);
    expect(sc.contributors).toEqual([
      'Lomax, Alan (1915-2002) (Recordist)',
      'Guthrie, Woody (1912-1967) (Performer)',
    ]);
    const text = contentText(result);
    expect(text).toContain(
      '**Related items:** http://lccn.loc.gov/2002522665, string-related-id, https://lccn.loc.gov/2009655315',
    );
    expect(text).toContain(
      '**Contributors:** Lomax, Alan (1915-2002) (Recordist), Guthrie, Woody (1912-1967) (Performer)',
    );
  });

  it('returns mgw1b.721 contributors from contributor_names on both surfaces (#47)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify({
          item: {
            title: 'George Washington Papers, Series 1',
            url: 'https://www.loc.gov/item/mgw1b.721/',
            contributor_names: ['Washington, George, 1732-1799 (Author)'],
            contributors: [
              {
                'washington, george':
                  'https://www.loc.gov/search/?fa=contributor:washington,+george&fo=json',
              },
            ],
          },
          resources: [],
          related_items: [],
        }),
      ),
    );
    const result = await runToolContract(locGetItem, { item_id: 'mgw1b.721' });

    expect(structured(result).contributors).toEqual(['Washington, George, 1732-1799 (Author)']);
    expect(contentText(result)).toContain(
      '**Contributors:** Washington, George, 1732-1799 (Author)',
    );
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
    'names the failed id and forwards item_not_found recovery on both surfaces for $name (#44)',
    async ({ fetch }) => {
      vi.stubGlobal('fetch', fetch());
      const result = await runToolContract(locGetItem, { item_id: '99999999999zzz' });

      const error = wireError(result);
      const hint = contractRecovery(locGetItem, 'item_not_found');
      expect(error).toMatchObject({
        code: JsonRpcErrorCode.NotFound,
        data: { reason: 'item_not_found', itemId: '99999999999zzz', recovery: { hint } },
      });
      expect(error.message).toContain('99999999999zzz');
      expect(error.message).not.toBe('LOC resource not found');
      const text = contentText(result);
      expect(text).toContain('99999999999zzz');
      expect(text).toContain(`Recovery: ${hint}`);
    },
  );

  // Rate-limit test last — sets module-level rateLimitBlockedUntil
  it('forwards the most specific rate-limit hint on both surfaces: a fresh 429, then the running block (#44)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('Rate limited', { status: 429 }));
    vi.stubGlobal('fetch', fetchSpy);

    const fresh = await runToolContract(locGetItem, { item_id: '2005691065' });
    const freshError = wireError(fresh);
    expect(freshError).toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'rate_limit_exceeded', retryable: false },
    });
    const freshHint = String(freshError.data?.recovery?.hint);
    expect(freshHint).toMatch(/1 hour/);
    expect(contentText(fresh)).toContain(`Recovery: ${freshHint}`);

    const blocked = await runToolContract(locGetItem, { item_id: '2005691065' });
    const blockedHint = String(wireError(blocked).data?.recovery?.hint);
    expect(blockedHint).toMatch(/60 more minute/);
    expect(contentText(blocked)).toContain(`Recovery: ${blockedHint}`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
