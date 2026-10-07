<div align="center">
  <h1>@cyanheads/libofcongress-mcp-server</h1>
  <p><b>Search LOC digital collections, browse Chronicling America newspapers with full OCR text, and look up LC Subject Headings via MCP. STDIO or Streamable HTTP.</b>
  <div>6 Tools • 1 Resource</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.3.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/libofcongress-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.2.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/%40cyanheads%2Flibofcongress-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/libofcongress-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.2%2B-blueviolet.svg?style=flat-square)](https://bun.sh/)

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

Library of Congress digital collections, Chronicling America newspaper archives, and LC Subject Headings (LCSH) authority data. Search items and newspaper pages, retrieve full item metadata and OCR text, resolve LCSH subject terms, and browse curated collections from any MCP client. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

| Tool | Description |
|:-----|:------------|
| `libofcongress_search` | Search LOC digital collections by keyword with format, date range, subject, location, and collection filters. |
| `libofcongress_get_item` | Retrieve full metadata for a specific LOC digital item — contributors, subjects, rights, formats, and resource links. |
| `libofcongress_search_newspapers` | Search historical newspaper pages in the Chronicling America corpus with OCR excerpts. |
| `libofcongress_get_newspaper_page` | Retrieve the full OCR text and metadata for a specific newspaper page. |
| `libofcongress_search_subjects` | Search Library of Congress Subject Headings (LCSH) by keyword. |
| `libofcongress_browse_collections` | List and browse LOC curated digital collections, optionally filtered by keyword. |

### Resources

| Resource | Description |
|:-----|:------------|
| `libofcongress://item/{+item_id}` | LOC digital item metadata by ID — stable URI for injecting item context into agent conversations. |

All resource data is also reachable via `libofcongress_get_item`. Use `libofcongress_search` to discover item IDs first.

## Capability reference

### `libofcongress_search` <sub>tool</sub>

- Filters: eight material formats (`photo`, `map`, `newspaper`, `manuscript`, `audio`, `film`, `book`, `notated-music`), inclusive year range (`date_start`/`date_end`), LCSH subject (exact spelling from `libofcongress_search_subjects`), location, and `collection_slug` (from `libofcongress_browse_collections`, mutually exclusive with `format`); up to 100 results per page
- Each result carries `is_item` — `true` for catalog items whose `id` resolves via `libofcongress_get_item`, `false` for collections, exhibit/guide pages, and newspaper pages, whose `url` should be opened instead

---

### `libofcongress_get_item` <sub>tool</sub>

- Takes a search result's `id` verbatim, simple or multi-segment (newspaper pages: `sn95047246/1935-09-05/ed-1`); returns contributors with their roles, LCSH subject headings, notes, summary, languages, locations, rights, physical description, call number, former IDs, formats, and `access_restricted`
- `resource_links` carries downloadable file URLs (TIFF/JPEG/PDF) and `related_items` related record IDs or URLs, both in full; fields absent upstream are omitted rather than filled

---

### `libofcongress_search_newspapers` <sub>tool</sub>

- Filters: keyword, inclusive date range, US state (full name), and newspaper title (partial match); up to 100 results per page
- Each result carries a ~500-character OCR excerpt for relevance assessment, `states` (every state LOC indexes the title under), and the `url` that `libofcongress_get_newspaper_page` takes verbatim

---

### `libofcongress_get_newspaper_page` <sub>tool</sub>

- Takes the `url` from a `libofcongress_search_newspapers` result; anything outside `https://www.loc.gov/resource/` is rejected as `invalid_page_url` before any request
- Returns `ocr_text` with the issue's `newspaper_title`, `date`, `place_of_publication`, `states`, `edition`, the page's `sequence`, and the issue's `segment_count`; `ocr_available: false` marks an image-only page, and a `notice` flags a page whose OCR exists but did not come back

---

### `libofcongress_search_subjects` <sub>tool</sub>

- Keyword query, up to 50 results per call (default 10); returns LCSH `label` and stable LOC `uri` — pass the label verbatim as `libofcongress_search`'s `subject` filter, since LCSH uses inverted forms ("Photography, Aerial", "World War, 1939-1945")
- When id.loc.gov's ranked suggest pool, rather than a lack of coverage, yields an empty or short result, the response says so with a recovery hint

---

### `libofcongress_browse_collections` <sub>tool</sub>

- Optional keyword filter on collection name and description; up to 100 collections per page
- Each collection carries a `slug` for `libofcongress_search`'s `collection_slug` (taken from the loc.gov route, not derivable from the title); `item_count` is approximate and omitted when LOC doesn't provide it

---

### `libofcongress://item/{+item_id}` <sub>resource</sub>

- Returns the same full record as `libofcongress_get_item`, as `application/json`
- `item_id` comes from a `libofcongress_search` result's `id` field, or from `libofcongress_get_item`
- Multi-segment newspaper IDs keep their slashes intact (e.g. `libofcongress://item/sn95047246/1935-09-05/ed-1`); percent-encoded slashes (`%2F`) also resolve

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

Library of Congress-specific:

- Module-level rate-limit enforcement: 20 req/min limit; 429 responses trigger a 1-hour block, and the error's recovery hint counts down the minutes left and names the time it lifts
- Configurable pacing delay (default 3100ms, ~19 req/min) applied before every outbound LOC API request
- HTML-response detection guards against silent rate-limit proxy pages that return 200 with HTML
- Out-of-range page handling: a page past the end of the results (HTTP 404 on any page after the first) or past the retrieval ceiling (HTTP 400) returns an empty result with a notice, not an error — both point back to page 1 for the real page count, and the ceiling notice also explains how to partition a search that matches more than LOC will page through
- Transient-fault resilience: network drops and timeouts retry with backoff behind a 30s per-request timeout ceiling; the 429 rate-limit path is never retried, since a retry would deepen LOC's 1-hour block
- Newspaper OCR is surfaced as-is: quality varies by digitization batch and era, and 19th-century or degraded pages may contain garbled text

Agent-friendly output:

- Empty results always include a `notice` field with recovery hints — echoes the applied filters and suggests how to broaden
- Pagination status on every search response (`total`, `page`, `pages`, `has_next`), capped at LOC's ~100,000-item retrieval ceiling, with a notice disclosing how to page past it
- `ocr_available` and `is_item` discriminator fields let callers branch on data availability without parsing text
- Recovery hints on every typed error contract — actionable next steps for the agent on every failure mode

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
| `LOC_USER_AGENT` | User-Agent header sent with LOC API requests. LOC recommends a descriptive value for polite access. | `libofcongress-mcp-server/0.3.1` |
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
| `src/services/loc-api` | `LocApiService` wrapping `www.loc.gov` — search, item fetch, newspaper page, collection browser. |
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
