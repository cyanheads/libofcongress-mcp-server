/**
 * @fileoverview Search row routing through the real service and both tool output surfaces.
 * @module tests/tools/libofcongress-search-routing.test
 */
import { config } from '@cyanheads/mcp-ts-core/config';
import { createInMemoryStorage, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locSearchItems } from '@/mcp-server/tools/definitions/libofcongress-search-items.tool.js';
import { initLocApiService } from '@/services/loc-api/loc-api-service.js';
import { serveByHost } from '../helpers/loc-fetch.js';
import { contentText, structured } from '../helpers/tool-result.js';

const originalPage =
  'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=12&q=titanic+iceberg';
const retired = 'https://catalog.loc.gov/vwebv/holdingsInfo?bibId=13839143';

describe('search row routing', () => {
  beforeEach(async () => {
    initLocApiService(config, await createInMemoryStorage());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves the upstream page URL and non-item identity', async () => {
    serveByHost({
      'www.loc.gov': { results: [{ id: originalPage, url: originalPage, title: 'Page' }] },
    });
    const result = await runToolContract(locSearchItems, { query: 'titanic iceberg' });
    expect(structured(result).items).toEqual([
      expect.objectContaining({ url: originalPage, is_item: false }),
    ]);
    expect(contentText(result)).toContain(originalPage);
  });

  it('discloses retired links without working-link advice on either surface', async () => {
    const fetch = serveByHost({
      'www.loc.gov': { results: [{ id: retired, url: retired, title: 'Retired record' }] },
    });
    const result = await runToolContract(locSearchItems, { query: 'civil war' });
    expect(structured(result).items).toEqual([
      expect.objectContaining({
        url: retired,
        is_item: false,
        link_notice:
          'This retired catalog link does not open its record; it redirects to the replacement catalog home page.',
      }),
    ]);
    expect(contentText(result)).toContain(
      'This retired catalog link does not open its record; it redirects to the replacement catalog home page.',
    );
    expect(contentText(result)).not.toContain('open the URL');
    expect(contentText(result)).toContain('Non-item result — not a libofcongress_get_item target');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    originalPage,
    'http://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/seq-12/',
    'https://chroniclingamerica.loc.gov/lccn/sn82014248/1912-04-18/ed-1/seq-12/',
  ])('routes the recognized newspaper page %s on both surfaces', async (url) => {
    serveByHost({ 'www.loc.gov': { results: [{ id: url, url, title: 'Page' }] } });
    const result = await runToolContract(locSearchItems, { query: 'titanic iceberg' });
    const page_url = 'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=12';
    expect(structured(result).items).toEqual([
      expect.objectContaining({ url, is_item: false, page_url }),
    ]);
    expect(contentText(result)).toContain(`**page_url:** ${page_url}`);
    expect(contentText(result)).toContain('libofcongress_get_newspaper_page');
    expect(contentText(result)).toContain('Non-item newspaper page');
    expect(contentText(result)).toContain('match');
    expect(contentText(result)).toContain(url);
  });

  it.each([
    'https://www.loc.gov/item/2009632251/',
    'https://lccn.loc.gov/2005567251',
    'https://www.loc.gov/collections/civil-war/',
    'https://www.loc.gov/rr/program/bib/ourdocs/',
    'https://guides.loc.gov/civil-war',
    'https://hdl.loc.gov/loc.mss/eadmss.ms013110',
    'https://www.loc.gov/resource/rbpe.00000100/?sp=2',
    'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=0',
    'https://www.loc.gov.evil.test/resource/sn82014248/1912-04-18/ed-1/?sp=12',
    'https://evil.test/resource/sn82014248/1912-04-18/ed-1/?sp=12',
    'https://catalog.loc.gov.evil.test/vwebv/holdingsInfo?bibId=13839143',
  ])('does not invent newspaper or retired-catalog routing for %s', async (url) => {
    serveByHost({ 'www.loc.gov': { results: [{ id: url, url, title: 'Control' }] } });
    const result = await runToolContract(locSearchItems, { query: 'control' });
    const [row] = locSearchItems.output.parse(structured(result)).items;
    expect(row).not.toHaveProperty('page_url');
    expect(row).not.toHaveProperty('link_notice');
    expect(row?.url).toBe(url);
  });

  it('retains routing when the requested limit is clamped', async () => {
    const fetch = serveByHost({
      'www.loc.gov': {
        results: [{ id: originalPage, url: originalPage, title: 'Page' }],
        pagination: { of: 1, total: 1, perpage: 100, current: 1 },
      },
    });
    const result = await runToolContract(locSearchItems, { query: 'titanic iceberg', limit: 101 });
    expect(locSearchItems.output.parse(structured(result)).items[0]?.page_url).toBe(
      'https://www.loc.gov/resource/sn82014248/1912-04-18/ed-1/?sp=12',
    );
    expect(contentText(result)).toContain('**page_url:**');
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('c')).toBe('100');
  });

  it.each([1, 3])('keeps an empty page %i free of fabricated row routes', async (page) => {
    serveByHost({
      'www.loc.gov': { results: [], pagination: { of: 0, total: 0, perpage: 25, current: page } },
    });
    const result = await runToolContract(locSearchItems, { query: 'missing', page });
    expect(locSearchItems.output.parse(structured(result)).items).toEqual([]);
    expect(contentText(result)).not.toContain('**page_url:**');
    expect(contentText(result)).not.toContain('**link_notice:**');
  });

  it('rejects invalid pagination before requesting rows', async () => {
    const fetch = serveByHost({ 'www.loc.gov': {} });
    const result = await runToolContract(locSearchItems, { query: 'titanic', page: 0 });
    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
