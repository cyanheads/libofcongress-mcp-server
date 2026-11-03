/**
 * @fileoverview Bundle selectors distinguish package-root agent docs from SDK runtime modules.
 * @module tests/packaging/clean-mcpb.test
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_DOC_ENTRY, filterAgentDocEntries } from '../../scripts/clean-mcpb.js';

describe('bundle agent-document pruning', () => {
  it('removes only package-root documentation across scoped and nested packages', () => {
    const docs = [
      'node_modules/@cyanheads/mcp-ts-core/framework-skills/add-tool/SKILL.md',
      'node_modules/a/skills/search/SKILL.md',
      'node_modules/a/node_modules/@scope/b/.claude/skills/search/SKILL.md',
      'node_modules/@scope/a/node_modules/b/SKILL.md',
    ];
    const runtime = [
      'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.js',
      'node_modules/@scope/a/node_modules/@modelcontextprotocol/server/dist/ext/skills/loader.js',
      'node_modules/a/dist/skills/index.js',
    ];
    expect(filterAgentDocEntries([...docs, ...runtime])).toEqual(docs);
    expect(
      readFileSync(new URL('../../scripts/lint-packaging.ts', import.meta.url), 'utf8'),
    ).toContain(AGENT_DOC_ENTRY.toString());
  });
});
