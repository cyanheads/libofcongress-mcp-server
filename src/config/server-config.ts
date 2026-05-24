/**
 * @fileoverview Server-specific configuration for libofcongress-mcp-server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  userAgent: z
    .string()
    .default('libofcongress-mcp-server/0.2.0')
    .describe(
      'User-Agent header sent with LOC API requests. LOC recommends a descriptive value for polite access.',
    ),
  requestDelayMs: z.coerce
    .number()
    .default(3100)
    .describe(
      'Delay in milliseconds between LOC API requests to stay under the 20 req/min rate limit (~19/min at default).',
    ),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    userAgent: 'LOC_USER_AGENT',
    requestDelayMs: 'LOC_REQUEST_DELAY_MS',
  });
  return _config;
}
