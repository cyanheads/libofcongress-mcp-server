<div align="center">
  <h1>@cyanheads/libofcongress-mcp-server</h1>
  <p><b>Search LOC digital collections, browse Chronicling America newspapers with full OCR text, and look up LC Subject Headings via MCP. STDIO or Streamable HTTP.</b>
  <div>6 Tools • 1 Resource</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.5.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/libofcongress-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.3.1-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/%40cyanheads%2Flibofcongress-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/libofcongress-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.3%2B-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/libofcongress-mcp-server/releases/latest/download/libofcongress-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=libofcongress-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvbGlib2Zjb25ncmVzcy1tY3Atc2VydmVyIl19) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22libofcongress-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Flibofcongress-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://libofcongress.caseyjhand.com/mcp](https://libofcongress.caseyjhand.com/mcp)

</div>

---

## Overview

Library of Congress digital collections, Chronicling America historic newspapers, and LC Subject Headings. Search items and newspaper pages, read full metadata and OCR text, resolve subject terms, and browse curated collections.

### Tools

| Tool | Description |
|:-----|:------------|
| `libofcongress_search_items` | Search LOC digital collections by keyword with format, date range, subject, location, and collection filters. |
| `libofcongress_get_item` | Retrieve full metadata for a specific LOC digital item — imprint, contributors, subjects, rights, formats, its digital resources, and a paged list of its pages. |
| `libofcongress_search_newspapers` | Search historical newspaper pages in the Chronicling America corpus, with an excerpt of each page's opening OCR text. |
| `libofcongress_get_newspaper_page` | Retrieve the full text and metadata of one page — a newspaper page, or a book or manuscript page from `libofcongress_get_item` — or only the passages around a search term. |
| `libofcongress_search_subjects` | Search Library of Congress Subject Headings (LCSH) by keyword. |
| `libofcongress_browse_collections` | List and browse LOC curated digital collections, optionally filtered by keyword. |

### Resources

| Resource | Description |
|:-----|:------------|
| `libofcongress://item/{+item_id}` | LOC digital item metadata by ID — stable URI for injecting item context into agent conversations. |

All resource data is also reachable via `libofcongress_get_item`. Use `libofcongress_search_items` to discover item IDs first.

## Capability reference

### `libofcongress_search_items` <sub>tool</sub>

- Filters: eight material formats (`photo`, `map`, `newspaper`, `manuscript`, `audio`, `film`, `book`, `notated-music`), inclusive year range (`date_start`/`date_end`), `subject` (an LCSH heading from `libofcongress_search_subjects` or a facet term), location, and `collection_slug` (from `libofcongress_browse_collections`, mutually exclusive with `format`); up to 100 results per page — a larger `limit` (up to 1000) is served as 100 with `effectiveLimit` and a notice
- Each result carries `date` as LOC catalogs it and `is_item`: `true` for catalog items whose `id` resolves via `libofcongress_get_item`, `false` for collections, exhibit/guide pages, newspaper pages, `catalog.loc.gov` records, and `hdl.loc.gov` finding aids, whose `url` should be opened instead
- `include_facets: true` adds `subject_facets` and `location_facets` (LOC's top 10 terms across all matches, each with its item count); off by default since it slows every search. A zero-result notice names the subject terms and location applied

---

### `libofcongress_get_item` <sub>tool</sub>

- Takes a search result's `id` (simple or multi-segment, e.g. `sn95047246/1935-09-05/ed-1`), a loc.gov item link, or an `lccn.loc.gov` permalink; any other URL is rejected as `invalid_item_id` before any request
- Returns the `imprint`, contributors with roles, LCSH `subject_headings`, `subject_terms` (the lowercase terms the search `subject` filter accepts), notes, summary, languages, locations, `rights_information` as plain text, physical description, call number, former IDs, formats, and `access_restricted`; fields absent upstream are omitted
- `resources` lists each digital resource with its page count, `image`, `pdf`, and `audio` (MP3). `pages` lists 50 pages at a time by default (`page_offset`, `page_limit`, `page_total`, `next_page_offset`; at most 100 per call — a larger `page_limit`, up to 1000, is served as 100 with `effectivePageLimit` and a notice), each with a `page_url` and `has_text` that read through `libofcongress_get_newspaper_page`. `include_files: true` adds each page's download URLs

---

### `libofcongress_search_newspapers` <sub>tool</sub>

- Filters: keyword, inclusive date range down to the day (`date_start`/`date_end` take an integer year or a `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` string), US state (full name or postal code), and newspaper title (the exact `newspaper_title` of a search result); up to 100 results per page — a larger `limit` (up to 1000) is served as 100 with `effectiveLimit` and a notice
- Each result carries the opening ~500 characters of the page's OCR text, `states`, and the `url` that `libofcongress_get_newspaper_page` takes verbatim
- The excerpt is the page's first lines, not the text around the match; pass the same query as `match` to `libofcongress_get_newspaper_page` for the passages around it

---

### `libofcongress_get_newspaper_page` <sub>tool</sub>

- Takes the `url` from a `libofcongress_search_newspapers` result, or a `pages[].page_url` from `libofcongress_get_item` (newspaper, book, and manuscript pages alike), plus Chronicling America page links; a link that names no single page, any other host, or a malformed path or `sp` is rejected as `invalid_page_url` before any request
- Returns the page's text as `ocr_text` with `newspaper_title`, `date`, `place_of_publication`, `states`, `edition`, `sequence`, `segment_count`, `item_title`, and `item_id` (pass it to `libofcongress_get_item` to list the item's pages). `ocr_available: false` marks an image-only page, and a `notice` explains an empty result: the text service did not answer (retry), the body could not be read as text, or the page is blank
- `match` returns only the passages around a term — pass the query you searched with. Space-separated words are separate terms and a double-quoted span is one phrase, matched case-insensitively. `matches` holds up to 10 passages of about 300 characters either side of each occurrence, `match_count` counts every occurrence, and `ocr_text` is empty; a notice says when nothing matched or some occurrences fall outside the passages

---

### `libofcongress_search_subjects` <sub>tool</sub>

- Keyword query, up to 50 results per call (default 10; a larger `limit`, up to 1000, returns up to 50 with a notice); returns the authorized LCSH `label` and stable LOC `uri`, exact match first
- Pass the label verbatim as `libofcongress_search_items`'s `subject` filter. A partial word (`aerial photog`) falls back to headings that begin with it

---

### `libofcongress_browse_collections` <sub>tool</sub>

- Optional keyword filter on collection name and description; up to 100 collections per page — a larger `limit` (up to 1000) is served as a 100-collection page with `effectiveLimit` and a notice
- Each collection carries a `slug` for `libofcongress_search_items`'s `collection_slug` (taken from the loc.gov route, not derivable from the title); `item_count` is approximate and omitted when LOC doesn't provide it

---

### `libofcongress://item/{+item_id}` <sub>resource</sub>

- Returns the same record as `libofcongress_get_item`, as `application/json`, with the first 50 pages and no files; `next_page_offset` marks where `libofcongress_get_item`'s `page_offset` continues
- `item_id` comes from a `libofcongress_search_items` result's `id`; anything that is not an item ID is rejected as `invalid_item_id`. Multi-segment newspaper IDs keep their slashes (`libofcongress://item/sn95047246/1935-09-05/ed-1`)

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Library of Congress-specific:

- Request queue in front of `www.loc.gov`: calls start in arrival order, at least `LOC_REQUEST_DELAY_MS` apart (default 3100ms, ~19 req/min), never exceeding LOC's 20 per minute. A call that cannot start in time fails as `server_busy` with `retryAfter`
- Rate-limit handling: a 429 triggers LOC's 1-hour block, and calls fail without sending anything until it lifts (never retried); a Cloudflare challenge or HTML page instead of JSON fails as `upstream_unavailable` with `retryAfter: 60`. `libofcongress_search_subjects` (`id.loc.gov`) is unaffected
- A 50-second budget per tool call covers queue wait, retries, and the OCR fetch, so a slow upstream fails as `request_timed_out`; other upstream failures (dropped connections, 5xx or 403, empty or truncated bodies) fail as `upstream_unavailable` with a retry hint
- Pages past the end of the results or past the retrieval ceiling return an empty result with a notice, not an error
- Newspaper OCR is surfaced as-is; 19th-century or degraded pages may contain garbled text

Agent-friendly output:

- Empty results include a `notice` with recovery hints that echo the applied filters
- Every search response carries pagination status (`total`, `page`, `pages`, `has_next`), capped at LOC's ~100,000-item retrieval ceiling
- `ocr_available` and `is_item` let callers branch without parsing text
- Every typed error carries a recovery hint

## Getting started

### Public Hosted Instance

A public instance is available at `https://libofcongress.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP:

```json
{
  "mcpServers": {
    "libofcongress-mcp-server": {
      "type": "streamable-http",
      "url": "https://libofcongress.caseyjhand.com/mcp"
    }
  }
}
```

### Self-Hosted / Local

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "libofcongress-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/libofcongress-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_SESSION_MODE": "stateless",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "libofcongress-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/libofcongress-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_SESSION_MODE": "stateless",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "libofcongress-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
        "-e", "MCP_SESSION_MODE=stateless",
        "ghcr.io/cyanheads/libofcongress-mcp-server:latest"
      ]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
- No API key required — the LOC JSON API and LC Linked Data endpoints are open. LOC recommends a descriptive `LOC_USER_AGENT` for polite access.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/libofcongress-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd libofcongress-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment:**

```sh
cp .env.example .env
# edit .env if you want to set LOC_USER_AGENT or LOC_REQUEST_DELAY_MS
```

## Configuration

All configuration is validated at startup via Zod schemas in `src/config/server-config.ts`.

| Variable | Description | Default |
|:---------|:------------|:--------|
| `LOC_USER_AGENT` | User-Agent header sent with LOC API requests. LOC recommends a descriptive value for polite access. | `libofcongress-mcp-server/0.5.1` |
| `LOC_REQUEST_DELAY_MS` | Delay in milliseconds between LOC API requests to stay under the 20 req/min rate limit. | `3100` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for HTTP server. | `3010` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_SESSION_MODE` | HTTP session mode. This server is explicitly stateless. | `stateless` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `LOG_TOOL_FAILURE_PAYLOADS` | Log each failed tool call's arguments and result, redacted by key name and capped at `LOG_TOOL_FAILURE_PAYLOAD_MAX_BYTES` (default `16384`). A secret inside a free-form value is not redacted. | `false` |
| `STORAGE_PROVIDER_TYPE` | Storage backend. | `in-memory` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry) (spans, metrics, completion logs). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

- **Build and run:**

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security
  bun run test       # Vitest test suite
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

### Docker

```sh
docker build -t libofcongress-mcp-server .
docker run --rm -p 3010:3010 libofcongress-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/libofcongress-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:----------|:--------|
| `src/index.ts` | `createApp()` entry point — registers tools, resource, and initializes services. |
| `src/config` | Server-specific environment variable parsing (`LOC_USER_AGENT`, `LOC_REQUEST_DELAY_MS`). |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`) — six LOC tools. |
| `src/mcp-server/resources` | Resource definitions — `libofcongress://item/{+item_id}`. |
| `src/services/loc-api` | `LocApiService` wrapping `www.loc.gov` — search, item fetch, page text, collection browser. |
| `src/services/lc-linked-data` | `LcLinkedDataService` wrapping `id.loc.gov` — LCSH subject heading suggest. |
| `tests/` | Unit and integration tests mirroring `src/`. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage
- Register new tools and resources via the arrays in `src/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
