/**
 * @fileoverview Tests for the LcLinkedDataService — init/accessor guard, suggest API
 * normalization, error classification, and security invariants.
 * @module tests/services/lc-linked-data-service.test
 */

import { config } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLcLinkedDataService,
  initLcLinkedDataService,
  LcLinkedDataService,
} from '@/services/lc-linked-data/lc-linked-data-service.js';

function mockFetch(body: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

/** Minimal well-formed 4-tuple suggest response */
function makeSuggest(entries: Array<{ label: string; uri: string; count?: string }>) {
  return JSON.stringify([
    'query',
    entries.map((e) => e.label),
    entries.map((e) => e.count ?? ''),
    entries.map((e) => e.uri),
  ]);
}

describe('LcLinkedDataService init/accessor', () => {
  it('getLcLinkedDataService() returns the initialized instance', async () => {
    const storage = await createInMemoryStorage();
    initLcLinkedDataService(config, storage);
    const svc = getLcLinkedDataService();
    expect(svc).toBeInstanceOf(LcLinkedDataService);
  });
});

describe('LcLinkedDataService.searchSubjects', () => {
  beforeEach(async () => {
    const storage = await createInMemoryStorage();
    initLcLinkedDataService(config, storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps the 4-tuple suggest response to LcSubjectHeading records', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSuggest([
          {
            label: 'World War, 1939-1945',
            uri: 'http://id.loc.gov/authorities/subjects/sh85148273',
            count: '1500',
          },
        ]),
      ),
    );
    const ctx = createMockContext();
    const svc = getLcLinkedDataService();
    const results = await svc.searchSubjects('world war', 10, ctx);

    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('World War, 1939-1945');
    expect(results[0].uri).toBe('http://id.loc.gov/authorities/subjects/sh85148273');
    expect(results[0].count).toBe(1500);
  });

  it('omits count when count string is empty', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSuggest([
          {
            label: 'Photography, Aerial',
            uri: 'http://id.loc.gov/authorities/subjects/sh85101360',
            count: '',
          },
        ]),
      ),
    );
    const ctx = createMockContext();
    const svc = getLcLinkedDataService();
    const results = await svc.searchSubjects('aerial', 10, ctx);
    expect(results[0].count).toBeUndefined();
  });

  it('omits count when count string is non-numeric', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify([
          'query',
          ['Photography'],
          ['not-a-number'],
          ['http://id.loc.gov/authorities/subjects/sh85101360'],
        ]),
      ),
    );
    const ctx = createMockContext();
    const svc = getLcLinkedDataService();
    const results = await svc.searchSubjects('photo', 10, ctx);
    expect(results[0].count).toBeUndefined();
  });

  it('returns empty array when suggest response has fewer than 4 elements', async () => {
    vi.stubGlobal('fetch', mockFetch(JSON.stringify(['query', [], []])));
    const ctx = createMockContext();
    const svc = getLcLinkedDataService();
    const results = await svc.searchSubjects('short', 10, ctx);
    expect(results).toHaveLength(0);
  });

  it('skips entries where label or uri is empty/falsy', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(
        JSON.stringify([
          'query',
          ['Valid Label', '', 'Another Valid'],
          ['', '', ''],
          [
            'http://id.loc.gov/authorities/subjects/sh1',
            'http://id.loc.gov/authorities/subjects/sh2',
            'http://id.loc.gov/authorities/subjects/sh3',
          ],
        ]),
      ),
    );
    const ctx = createMockContext();
    const svc = getLcLinkedDataService();
    const results = await svc.searchSubjects('test', 10, ctx);
    // Entry with empty label should be skipped
    expect(results.every((r) => r.label !== '')).toBe(true);
  });

  it('throws ServiceUnavailable on non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', mockFetch('Service Error', 503));
    const ctx = createMockContext();
    const svc = getLcLinkedDataService();
    await expect(svc.searchSubjects('test', 10, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
  });

  it('throws ServiceUnavailable on HTML response (outage)', async () => {
    vi.stubGlobal('fetch', mockFetch('<!DOCTYPE html><html><body>Maintenance</body></html>'));
    const ctx = createMockContext();
    const svc = getLcLinkedDataService();
    await expect(svc.searchSubjects('test', 10, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
  });

  it('passes count param capped at 50 to the suggest endpoint', async () => {
    const fetchSpy = mockFetch(makeSuggest([]));
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLcLinkedDataService();
    await svc.searchSubjects('jazz', 200, ctx); // limit of 200 exceeds cap
    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    expect(calledUrl).toContain('count=50');
    expect(calledUrl).not.toContain('count=200');
  });

  it('injection string in query is percent-encoded in the request URL', async () => {
    const fetchSpy = mockFetch(makeSuggest([]));
    vi.stubGlobal('fetch', fetchSpy);
    const ctx = createMockContext();
    const svc = getLcLinkedDataService();
    const injection = '<script>alert(1)</script>';
    await svc.searchSubjects(injection, 10, ctx);
    const calledUrl = (fetchSpy.mock.calls[0][0] as string) ?? '';
    // Raw angle brackets must not appear unencoded
    expect(calledUrl).not.toContain('<script>');
  });

  it('userAgent env var value is never surfaced in subject result data', async () => {
    const secretAgent = 'my-secret-subject-agent';
    process.env.LOC_USER_AGENT = secretAgent;
    vi.stubGlobal(
      'fetch',
      mockFetch(
        makeSuggest([
          {
            label: 'World War, 1939-1945',
            uri: 'http://id.loc.gov/authorities/subjects/sh85148273',
            count: '500',
          },
        ]),
      ),
    );
    const ctx = createMockContext();
    const svc = getLcLinkedDataService();
    const results = await svc.searchSubjects('war', 10, ctx);

    const resultStr = JSON.stringify(results);
    expect(resultStr).not.toContain(secretAgent);
    delete process.env.LOC_USER_AGENT;
  });
});
