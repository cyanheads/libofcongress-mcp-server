/**
 * @fileoverview Tests for the shared response-notice helpers — the writer that keeps every notice a
 * response raises, and the page-size clamp disclosure.
 * @module tests/tools/notices.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { describe, expect, it } from 'vitest';
import { noticeWriter, pageSizeClampNotice } from '@/mcp-server/tools/notices.js';

describe('noticeWriter', () => {
  it('writes a single notice as-is', () => {
    const ctx = createMockContext();
    const addNotice = noticeWriter(ctx);

    addNotice('First sentence.');

    expect(getEnrichment(ctx).notice).toBe('First sentence.');
  });

  it('keeps every notice raised on one response, in order, where ctx.enrich.notice keeps only the last', () => {
    const ctx = createMockContext();
    const addNotice = noticeWriter(ctx);

    addNotice('Clamp disclosure.');
    addNotice('Empty-result guidance.');
    addNotice('Third source.');

    expect(getEnrichment(ctx).notice).toBe(
      'Clamp disclosure. Empty-result guidance. Third source.',
    );
  });

  it('writes nothing when no notice is raised', () => {
    const ctx = createMockContext();
    noticeWriter(ctx);

    expect(getEnrichment(ctx)).not.toHaveProperty('notice');
  });
});

describe('pageSizeClampNotice', () => {
  it('names the requested limit, the cap, and the next page when one follows', () => {
    expect(pageSizeClampNotice(500, 100, 3, true)).toBe(
      'Requested limit 500 exceeds the per-call cap of 100; this page holds up to 100 results, and page numbers count 100-result pages. Request page 4 with limit 100 for the next results.',
    );
  });

  it('drops the next-page sentence when no page follows', () => {
    expect(pageSizeClampNotice(101, 100, 1, false)).toBe(
      'Requested limit 101 exceeds the per-call cap of 100; this page holds up to 100 results, and page numbers count 100-result pages.',
    );
  });
});
