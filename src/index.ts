#!/usr/bin/env node
/**
 * @fileoverview libofcongress-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { locItemResource } from './mcp-server/resources/definitions/libofcongress-item.resource.js';
import { locBrowseCollections } from './mcp-server/tools/definitions/libofcongress-browse-collections.tool.js';
import { locGetItem } from './mcp-server/tools/definitions/libofcongress-get-item.tool.js';
import { locGetNewspaperPage } from './mcp-server/tools/definitions/libofcongress-get-newspaper-page.tool.js';
import { locSearch } from './mcp-server/tools/definitions/libofcongress-search.tool.js';
import { locSearchNewspapers } from './mcp-server/tools/definitions/libofcongress-search-newspapers.tool.js';
import { locSearchSubjects } from './mcp-server/tools/definitions/libofcongress-search-subjects.tool.js';
import { initLcLinkedDataService } from './services/lc-linked-data/lc-linked-data-service.js';
import { initLocApiService } from './services/loc-api/loc-api-service.js';

await createApp({
  name: 'libofcongress-mcp-server',
  title: 'libofcongress-mcp-server',
  tools: [
    locSearch,
    locGetItem,
    locSearchNewspapers,
    locGetNewspaperPage,
    locSearchSubjects,
    locBrowseCollections,
  ],
  resources: [locItemResource],
  prompts: [],
  instructions:
    'Library of Congress digital collections server. Use libofcongress_search_subjects to find exact LCSH terms before subject-filtering libofcongress_search. ' +
    'Newspaper research: libofcongress_search_newspapers → libofcongress_get_newspaper_page (two hops). ' +
    'Rate limit: 20 req/min; violations block for 1 hour.',
  landing: {
    // Public hosted catalog — serve full inventory without auth requirement.
    requireAuth: false,
  },
  setup(core) {
    initLocApiService(core.config, core.storage);
    initLcLinkedDataService(core.config, core.storage);
  },
});
