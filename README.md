<div align="center">
  <h1>@cyanheads/libofcongress-mcp-server</h1>
  <p><b>Search LOC digital collections, browse Chronicling America newspapers with full OCR text, and look up LC Subject Headings via MCP. STDIO or Streamable HTTP.</b>
  <div>6 Tools • 1 Resource</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.2.5-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/libofcongress-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/%40cyanheads%2Flibofcongress-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/libofcongress-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^6.0.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.11-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/libofcongress-mcp-server/releases/latest/download/libofcongress-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=libofcongress-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvbGlib2Zjb25ncmVzcy1tY3Atc2VydmVyIl19) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22libofcongress-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Flibofcongress-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://libofcongress.caseyjhand.com/mcp](https://libofcongress.caseyjhand.com/mcp)

</div>

---

## Tools

Six tools covering the Library of Congress digital holdings — general search with format/date/subject/location filters, full item retrieval, Chronicling America newspaper search with OCR, single-page full-text fetch, LCSH subject heading lookup, and curated collection browsing:

| Tool | Description |
|:-----|:------------|
| `libofcongress_search` | Search LOC digital collections by keyword with optional format, date range, subject heading, and geographic location filters. Returns item summaries with IDs for follow-up retrieval. |
| `libofcongress_get_item` | Retrieve full metadata for a specific LOC item — contributors, subjects, rights, physical description, resource links (TIFF/JPEG/PDF), and related items. |
| `libofcongress_search_newspapers` | Search historical newspaper pages in the Chronicling America corpus. Returns pages with OCR text excerpts (~500 chars), publication title, date, state, and the URL needed for `libofcongress_get_newspaper_page`. |
| `libofcongress_get_newspaper_page` | Retrieve the full OCR text of a specific newspaper page. Pass the `url` field from a `libofcongress_search_newspapers` result. Returns `ocr_available: false` when the page has no digitized text. |
| `libofcongress_search_subjects` | Search Library of Congress Subject Headings (LCSH) by keyword. Returns controlled-vocabulary labels and URIs — use the label as the `subject` filter in `libofcongress_search`. |
| `libofcongress_browse_collections` | List and browse LOC curated digital collections with descriptions, item counts, and slugs. Optionally filter by keyword. |

### `libofcongress_search`

Search the LOC digital collections with full-text keyword matching and facet filters.

- Eight material formats: `photo`, `map`, `newspaper`, `manuscript`, `audio`, `film`, `book`, `notated-music`
- Date range filtering by year (inclusive start and end)
- Subject heading filter — use `libofcongress_search_subjects` first to get the exact LCSH spelling
- Geographic location filter (e.g., `"oklahoma"`, `"washington d.c."`)
- Pagination up to 100 results per page; contradictory pages (LOC API edge case) returned with a clear message
- Empty results include a `message` field with recovery hints — echoes the applied filters

---

### `libofcongress_get_item`

Retrieve the full metadata record for a specific LOC digital item.

- Returns contributors, LCSH subject headings, rights information, physical/technical description, and cataloger notes
- `resource_links` contains URLs to downloadable digital files (TIFF, JPEG, PDF) for items with digital surrogates
- `related_items` lists IDs of related LOC items for follow-up retrieval
- Deduplicates resource links from nested `files[]` arrays

---

### `libofcongress_search_newspapers`

Search historical newspaper pages in the Chronicling America corpus via the LOC `/newspapers/` endpoint.

- OCR text excerpts (~500 chars) returned inline for relevance assessment without a second hop
- Filters: keyword, date range, US state (full state name), newspaper publication title (partial match)
- Returns the `url` field needed by `libofcongress_get_newspaper_page` — do not construct these URLs manually
- OCR quality varies by digitization batch and era; 19th-century and degraded materials may contain garbled text
- Empty results include a `message` with recovery suggestions (broaden date, try different keywords, historical OCR caveat)

---

### `libofcongress_get_newspaper_page`

Retrieve the full OCR text and metadata for a specific newspaper page.

- Accepts the `url` field from a `libofcongress_search_newspapers` result — validates the URL prefix before any outbound request
- Fetches ALTO XML from the LOC text-services endpoint and extracts plain text from `CONTENT` attributes
- `ocr_available: false` when the page has no digitized text (image-only batch) — not an error, a data property
- Strips echoed `q=` params from fulltext URLs to avoid tile.loc.gov 404s (known LOC API quirk)

---

### `libofcongress_search_subjects`

Search Library of Congress Subject Headings (LCSH) via `id.loc.gov`.

- Returns standardized labels and stable LOC URIs for subjects matching the keyword
- `count` field indicates approximate number of LOC items carrying that heading (when available)
- Use the returned `label` exactly in the `libofcongress_search` `subject` filter — LCSH uses inverted forms ("Photography, Aerial", "World War, 1939-1945") that differ from natural language

---

### `libofcongress_browse_collections`

List and browse LOC curated digital collections.

- Returns collection `slug` — use as a `partof` facet value in `libofcongress_search` to scope searches to a single collection
- Optional keyword filter by collection name/description
- Item counts are approximate; omitted when the API doesn't provide them
- Pagination supported up to 100 collections per page

## Resource

| Type | Name | Description |
|:-----|:-----|:------------|
| Resource | `libofcongress://item/{item_id}` | LOC digital item metadata by ID. Stable URI for injecting item context into agent conversations. Returns the same full record as `libofcongress_get_item`. |

All resource data is also reachable via `libofcongress_get_item`. Use `libofcongress_search` to discover item IDs first.

## Features

Built on [`@cyanheads/mcp-ts-core`](https://www.npmjs.com/package/@cyanheads/mcp-ts-core):

- Declarative tool and resource definitions — single file per primitive, framework handles registration and validation
- Unified error handling — handlers throw, framework catches, classifies, and formats
- Pluggable auth: `none`, `jwt`, `oauth`
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- STDIO and Streamable HTTP transports

LOC-specific:

- Module-level rate-limit enforcement: 20 req/min limit; 429 responses trigger a 1-hour block with per-minute countdown in error messages
- Configurable pacing delay (default 3100ms, ~19 req/min) applied before every outbound LOC API request
- HTML-response detection guards against silent rate-limit proxy pages that return 200 with HTML
- Out-of-range page handling: LOC returns HTTP 400 or 520 for page numbers beyond the result set — treated as empty rather than errors
- ALTO XML parser for newspaper OCR text — extracts `CONTENT` attributes from LOC text-services responses
- Two-service architecture: `LocApiService` for `www.loc.gov` and `LcLinkedDataService` for `id.loc.gov`

Agent-friendly output:

- Empty results always include a `message` field with recovery hints — echoes the applied filters and suggests how to broaden
- Pagination status on every search response: `total`, `page`, `pages`, `has_next`
- `ocr_available` discriminator on newspaper page results so callers can branch on data availability without parsing text
- Recovery hints on all error contracts — actionable next steps for the agent on every failure mode

## Getting started

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "libofcongress": {
      "type": "stdio",
      "command": "bunx",
      "args": ["libofcongress-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
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
    "libofcongress": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "libofcongress-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
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
    "libofcongress": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
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

- [Bun v1.3.2](https://bun.sh/) or higher (or Node.js v24+).
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
| `LOC_USER_AGENT` | User-Agent header sent with LOC API requests. LOC recommends a descriptive value for polite access. | `libofcongress-mcp-server/0.2.0` |
| `LOC_REQUEST_DELAY_MS` | Delay in milliseconds between LOC API requests to stay under the 20 req/min rate limit. | `3100` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for HTTP server. | `3010` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
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

The Dockerfile defaults to HTTP transport and logs to `/var/log/libofcongress-mcp-server`.

## Project structure

| Directory | Purpose |
|:----------|:--------|
| `src/index.ts` | `createApp()` entry point — registers tools, resource, and initializes services. |
| `src/config` | Server-specific environment variable parsing (`LOC_USER_AGENT`, `LOC_REQUEST_DELAY_MS`). |
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`) — six LOC tools. |
| `src/mcp-server/resources` | Resource definitions — `libofcongress://item/{item_id}`. |
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

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
