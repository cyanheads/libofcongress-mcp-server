/**
 * @fileoverview Tests for the caller-supplied link forms of LOC item IDs and page URLs — the
 * one-to-one forms each reduces to, and the forms that reduce to nothing.
 * @module tests/services/loc-urls.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocApiService, initLocApiService } from '@/services/loc-api/loc-api-service.js';
import { normalizeItemId, normalizePageUrl } from '@/services/loc-api/loc-urls.js';
import {
  AUDIO_ITEM_JUKEBOX_68453,
  BASEBALL_CARD_ITEM_2008676581,
  BOOK_ITEM_02007458,
  MANUSCRIPT_ITEM_MM77093930,
  MAP_ITEM_98688514,
  NEWSPAPER_ISSUE_SN83030214_1912_04_16,
  PHOTO_ITEM_2017760320,
} from '../fixtures/loc-items.js';
import { cpuScaling, repeatTo } from '../helpers/cpu-scaling.js';

describe('normalizeItemId', () => {
  it.each([
    ['2017760320', '2017760320'],
    ['2017760320/', '2017760320'],
    [' 2017760320 ', '2017760320'],
    ['afc9999005.23712', 'afc9999005.23712'],
    ['sn83030214/1912-04-16/ed-1', 'sn83030214/1912-04-16/ed-1'],
    [
      'prn-06-092/rare-jazz-recordings-uncovered/2006-04-14',
      'prn-06-092/rare-jazz-recordings-uncovered/2006-04-14',
    ],
    ['https://www.loc.gov/item/2017760320/', '2017760320'],
    ['http://www.loc.gov/item/2017760320/', '2017760320'],
    ['lcwaN0032026', 'lcwaN0032026'],
    ['https://loc.gov/item/2017760320', '2017760320'],
    ['https://loc.gov/item/2017760320/', '2017760320'],
    ['www.loc.gov/item/2017760320/', '2017760320'],
    ['www.loc.gov/item/2017760320', '2017760320'],
    ['loc.gov/item/2017760320/', '2017760320'],
    ['item/2017760320', '2017760320'],
    ['https://www.loc.gov/item/2017760320/?sp=3&st=gallery#top', '2017760320'],
    ['https://www.loc.gov/item/sn83030214/1912-04-16/ed-1/', 'sn83030214/1912-04-16/ed-1'],
  ])('reads %j as %j', (raw, id) => {
    expect(normalizeItemId(raw)).toBe(id);
  });

  it.each([
    '',
    'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
    'www.loc.gov/resource/sn83030214/1912-04-16/ed-1/',
    'https://www.loc.gov/collections/civil-war-maps/',
    'https://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1/',
    'loc.gov',
    'www.loc.gov',
    'tile.loc.gov/storage-services/x',
    'https://evil.example/item/2017760320/',
    'https://loc.gov.evil.example/item/2017760320/',
    'https://loc.gov@evil.example/item/2017760320/',
    'https://www.loc.gov:8443/item/2017760320/',
    'evil.example/loc.gov/item/2017760320/',
    'ftp://www.loc.gov/item/2017760320/',
    '../../collections',
    './2017760320',
    'sn83030214/../../collections',
    'https://www.loc.gov/item/../collections/',
    '%2e%2e/%2e%2e/collections',
    'sn83030214//1912-04-16',
    '2017760320?fo=html',
    '2017760320#x',
    'sn83030214\\..\\collections',
    '2017 760320',
  ])('rejects %j', (raw) => {
    expect(normalizeItemId(raw)).toBeUndefined();
  });
});

describe('normalizePageUrl', () => {
  const PAGE_1 = 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1';

  it.each([
    [PAGE_1, PAGE_1],
    ['http://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1', PAGE_1],
    ['https://loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1', PAGE_1],
    ['www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1', PAGE_1],
    ['https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1&q=titanic#x', PAGE_1],
    ['https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?q=titanic&fo=html&sp=1', PAGE_1],
    ['https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/seq-1/', PAGE_1],
    ['https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/seq-1', PAGE_1],
    ['https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/seq-1/?sp=9&fo=json', PAGE_1],
    ['https://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1/', PAGE_1],
    ['http://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1', PAGE_1],
    ['http://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1/#ocr', PAGE_1],
    ['chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1/#ocr', PAGE_1],
    ['https://www.loc.gov/chroniclingamerica/lccn/sn83030214/1912-04-16/ed-1/seq-1/', PAGE_1],
    [
      'https://chroniclingamerica.loc.gov/lccn/sn93067777/1902-01-24/ed-2/seq-2/',
      'https://www.loc.gov/resource/sn93067777/1902-01-24/ed-2/?sp=2',
    ],
    [
      'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/',
      'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/',
    ],
    [
      'https://www.loc.gov/resource/jukebox-68453.0',
      'https://www.loc.gov/resource/jukebox-68453.0',
    ],
    [
      'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3&st=text',
      'https://www.loc.gov/resource/mss93930.mss93930-001/?sp=3',
    ],
  ])('reads %j as %j', (raw, pageUrl) => {
    expect(normalizePageUrl(raw)).toBe(pageUrl);
  });

  it.each([
    '',
    'not-a-url-at-all',
    'https://www.loc.gov/item/2017760320/',
    'https://www.loc.gov/../../etc/passwd',
    'https://www.loc.gov/resource/../../etc/passwd',
    'https://www.loc.gov/resource/./sn83030214/',
    'https://www.loc.gov/resource/%2e%2e/%2e%2e/etc/passwd',
    'https://www.loc.gov/resource/sn83030214/..%2f..%2fcollections/',
    'https://www.loc.gov/resource\\..\\..\\collections\\',
    'https://www.loc.gov/resource//sn83030214/',
    'https://www.loc.gov.evil.example/resource/sn83030214/1912-04-16/ed-1/?sp=1',
    'https://loc.gov@evil.example/resource/sn83030214/1912-04-16/ed-1/?sp=1',
    'https://evil.example/www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1',
    'https://www.loc.gov:8443/resource/sn83030214/1912-04-16/ed-1/?sp=1',
    'https://tile.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1',
    'ftp://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=1',
    'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=first',
    'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=0',
    'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/?sp=',
    'https://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/',
    'https://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1/ocr/',
    'https://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1.pdf',
    'https://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1.jp2',
    'https://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1.json',
    'https://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-0/',
    'https://chroniclingamerica.loc.gov/lccn/sn83030214/1912-04-16/ed-1/seq-1/../../../',
    'https://www.loc.gov/chroniclingamerica/lccn/sn83030214/1912-04-16/ed-1/seq-1/ocr/',
    'https://chroniclingamerica.loc.gov.evil.example/lccn/sn83030214/1912-04-16/ed-1/seq-1/',
    'https://evil.example/chroniclingamerica/lccn/sn83030214/1912-04-16/ed-1/seq-1/',
  ])('rejects %j', (raw) => {
    expect(normalizePageUrl(raw)).toBeUndefined();
  });

  describe('every get_item page_url (#63)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      ['photo 2017760320', '2017760320', PHOTO_ITEM_2017760320],
      ['baseball card 2008676581', '2008676581', BASEBALL_CARD_ITEM_2008676581],
      ['map 98688514', '98688514', MAP_ITEM_98688514],
      ['recording jukebox-68453', 'jukebox-68453', AUDIO_ITEM_JUKEBOX_68453],
      [
        'newspaper issue sn83030214/1912-04-16/ed-1',
        'sn83030214/1912-04-16/ed-1',
        NEWSPAPER_ISSUE_SN83030214_1912_04_16,
      ],
      ['book 02007458', '02007458', BOOK_ITEM_02007458],
      ['diary mm77093930', 'mm77093930', MANUSCRIPT_ITEM_MM77093930],
    ])('reads each page of the %s as given', async (_name, itemId, body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL | Request) => {
          if (new URL(String(url)).hostname !== 'www.loc.gov') throw new Error('unmocked fetch');
          return new Response(JSON.stringify(body), { status: 200 });
        }),
      );
      initLocApiService(config, await createInMemoryStorage());

      const item = await getLocApiService().getItem(itemId, createMockContext(), {
        pageOffset: 0,
        pageLimit: 1000,
        includeFiles: false,
      });

      expect(item.pages.length).toBeGreaterThan(0);
      for (const { page_url } of item.pages) expect(normalizePageUrl(page_url)).toBe(page_url);
    });
  });
});

describe('scan time stays linear in the input (5k → 320k characters)', () => {
  it.each<[string, (length: number) => string]>([
    ['a dotted name with no slash', (n) => repeatTo('www.', n)],
    ['repeated loc.gov labels with no slash', (n) => repeatTo('x.loc.gov', n)],
    ['one letter and a run of dots', (n) => `a${repeatTo('.', n - 1)}`],
  ])('normalizeItemId: %s', (_name, make) => {
    const { largeMs, ratio } = cpuScaling(normalizeItemId, make);
    expect(ratio).toBeLessThan(256);
    expect(largeMs).toBeLessThan(250);
  });
});
