/**
 * @fileoverview Regression guard for the config-cache seed race — the mocked test
 * suite injects LOC_REQUEST_DELAY_MS=0 via vitest `env` so it lands before any module
 * seeds getServerConfig()'s module-level `??=` cache. If this reads the 3100ms default,
 * the override regressed and the whole suite silently pays live request pacing (~137s).
 * @module tests/config/server-config.test
 */

import { describe, expect, it } from 'vitest';
import { getServerConfig } from '@/config/server-config.js';

describe('server-config in the test environment', () => {
  it('resolves requestDelayMs to 0 from the vitest env override, so mocked suites never pace', () => {
    expect(getServerConfig().requestDelayMs).toBe(0);
  });
});
