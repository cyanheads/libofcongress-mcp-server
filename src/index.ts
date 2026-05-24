#!/usr/bin/env node
/**
 * @fileoverview libofcongress-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { locItemResource } from './mcp-server/resources/definitions/loc-item.resource.js';
import { locBrowseCollections } from './mcp-server/tools/definitions/loc-browse-collections.tool.js';
import { locGetItem } from './mcp-server/tools/definitions/loc-get-item.tool.js';
import { locGetNewspaperPage } from './mcp-server/tools/definitions/loc-get-newspaper-page.tool.js';
import { locSearch } from './mcp-server/tools/definitions/loc-search.tool.js';
import { locSearchNewspapers } from './mcp-server/tools/definitions/loc-search-newspapers.tool.js';
import { locSearchSubjects } from './mcp-server/tools/definitions/loc-search-subjects.tool.js';
import { initLcLinkedDataService } from './services/lc-linked-data/lc-linked-data-service.js';
import { initLocApiService } from './services/loc-api/loc-api-service.js';

await createApp({
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
    'Library of Congress digital collections server. Use loc_search_subjects to find exact LCSH terms before subject-filtering loc_search. ' +
    'Newspaper research: loc_search_newspapers → loc_get_newspaper_page (two hops). ' +
    'Rate limit: 20 req/min; violations block for 1 hour.',
  setup(core) {
    initLocApiService(core.config, core.storage);
    initLcLinkedDataService(core.config, core.storage);
  },
});
