# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.2.16](changelog/0.2.x/0.2.16.md) — 2026-07-16

Honest search pagination: total now reports matching items not pages, pages/has_next stop at LOC's ~100,000-item retrieval ceiling with partition guidance, and the guard that discarded valid deep-page results is removed across all three search tools; content/structuredContent parity closed in search and get_newspaper_page

## [0.2.15](changelog/0.2.x/0.2.15.md) — 2026-07-16

search_subjects stops reporting false empties when LCSH headings rank below name-authority records; LOC fetches gain a 30s timeout ceiling and a transient-only retry that never re-hits the rate-limit path; the mocked test suite no longer pays live request pacing (~137s → ~2.8s)

## [0.2.14](changelog/0.2.x/0.2.14.md) — 2026-07-16

libofcongress_get_item exposes eight previously-discarded metadata fields and renders all resource_links/related_items without truncation; the item resource reads multi-segment newspaper IDs; the internal LOC request URL is no longer attached to error data

## [0.2.13](changelog/0.2.x/0.2.13.md) — 2026-07-15

Add collection_slug to libofcongress_search for collection-scoped search; fix browse_collections returning slugs that do not match LOC routes and discarding upstream item counts

## [0.2.12](changelog/0.2.x/0.2.12.md) — 2026-07-13

Fix search_subjects returning non-LCSH authority records and empty-result totalCount mismatches across three tools; derive newspaper page date/sequence from the page URL

## [0.2.11](changelog/0.2.x/0.2.11.md) — 2026-07-13

Fix the search→get_item id contract: results flag is_item, multi-segment newspaper ids resolve via get_item, and get_item urls normalize protocol-relative links to https. Also adopts mcp-ts-core ^0.10.14 and supply-chain install hardening.

## [0.2.10](changelog/0.2.x/0.2.10.md) — 2026-06-20

Maintenance: @cyanheads/mcp-ts-core ^0.10.6 → ^0.10.9, dev-dependency refresh, vendored skill + devcheck-script re-sync; new dependency-specifier and plugin-manifest devcheck guards

## [0.2.9](changelog/0.2.x/0.2.9.md) — 2026-06-12

Adopt @cyanheads/mcp-ts-core ^0.10.6 — explicit name/title identity, subject-search truncation disclosure, bundle-content cleaning, and a Docker HEALTHCHECK

## [0.2.8](changelog/0.2.x/0.2.8.md) — 2026-06-04

Rate-limit errors now route through ctx.fail() for contract-correlation; error code corrected to JsonRpcErrorCode.RateLimited and retryable: false added across all 5 tools

## [0.2.7](changelog/0.2.x/0.2.7.md) — 2026-06-02

@cyanheads/mcp-ts-core ^0.9.16 → ^0.9.21: per-request log context fix, secret-scrubbing in error messages, withRetry fail-fast

## [0.2.6](changelog/0.2.x/0.2.6.md) — 2026-05-30

Enrichment adoption — search/browse tools surface query echoes, result totals, and empty-result guidance in a typed enrichment block; removed dead empty_results error contracts

## [0.2.5](changelog/0.2.x/0.2.5.md) — 2026-05-28 · 🛡️ Security

mcp-ts-core ^0.9.9 → ^0.9.13: HTTP 413 body cap, session-init gate, quieter 401/403/400/404 logs, GET /mcp keywords; landing page auth fix; dep refresh

## [0.2.4](changelog/0.2.x/0.2.4.md) — 2026-05-26

Add .github/FUNDING.yml, hosted server URL to README, trim changelog/ and AGENTS.md from npm files array.

## [0.2.3](changelog/0.2.x/0.2.3.md) — 2026-05-24

Drop tsx devDependency, align all scripts to bun-native execution, revert Dockerfile build stage from node:24-slim to oven/bun:1.3.

## [0.2.2](changelog/0.2.x/0.2.2.md) — 2026-05-24

Field-test fixes: rights crash, OCR extraction, out-of-range pagination, URL normalization, and tool-definition improvements

## [0.2.1](changelog/0.2.x/0.2.1.md) — 2026-05-24

npm package scoped to @cyanheads/libofcongress-mcp-server

## [0.2.0](changelog/0.2.x/0.2.0.md) — 2026-05-24 · ⚠️ Breaking

Tool prefix renamed loc_* → libofcongress_*; resource URI renamed loc:// → libofcongress://

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-05-24

Initial npm publish — 6 tools, 1 resource, 81 tests, field-test fixes, and pre-launch polish

## [0.1.0](changelog/0.1.x/0.1.0.md) — 2026-05-24

Initial release — LOC digital collections, Chronicling America newspaper search with full OCR, LCSH subject heading lookup, and collection browsing via MCP.
