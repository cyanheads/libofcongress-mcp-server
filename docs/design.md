# libofcongress-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations | Errors |
|:-----|:------------|:-----------|:------------|:-------|
| `loc_search` | Search LOC digital collections by keyword with format, date, and subject filters. Returns item summaries with titles, dates, descriptions, and LOC IDs for follow-up retrieval. | `query`, `format`, `date_start`, `date_end`, `subject`, `location`, `limit`, `page` | `readOnlyHint: true`, `openWorldHint: true` | `empty_results` (NotFound), `rate_limit_exceeded` (ServiceUnavailable, 1hr block) |
| `loc_get_item` | Retrieve full metadata for a specific LOC item by ID — contributors, subjects, rights, resource links, and related items. | `item_id` | `readOnlyHint: true`, `openWorldHint: true` | `item_not_found` (NotFound), `rate_limit_exceeded` (ServiceUnavailable, 1hr block) |
| `loc_search_newspapers` | Search historical newspaper pages (Chronicling America corpus) with full-text OCR content. Returns matching pages with article snippets and publication details. Accepts keyword, date range, state, and newspaper title filters. | `query`, `date_start`, `date_end`, `state`, `newspaper_title`, `limit`, `page` | `readOnlyHint: true`, `openWorldHint: true` | `empty_results` (NotFound), `rate_limit_exceeded` (ServiceUnavailable, 1hr block) |
| `loc_get_newspaper_page` | Retrieve the full OCR text of a specific newspaper page. Pass the `url` field from a `loc_search_newspapers` result — two hops total: search, then this tool. Returns `ocr_available: false` when the page has no digitized text. | `page_url` | `readOnlyHint: true`, `openWorldHint: true` | `page_not_found` (NotFound), `rate_limit_exceeded` (ServiceUnavailable, 1hr block) |
| `loc_search_subjects` | Search LC Subject Headings (LCSH) by keyword — the controlled vocabulary used to categorize LOC items. Returns subject labels and their URIs, which can be used as filters in `loc_search`. | `query`, `limit` | `readOnlyHint: true`, `openWorldHint: true` | `empty_results` (NotFound) |
| `loc_browse_collections` | List and browse LOC curated digital collections with descriptions and item counts. Optionally filter by subject keyword. | `query`, `limit`, `page` | `readOnlyHint: true`, `openWorldHint: true` | `empty_results` (NotFound), `rate_limit_exceeded` (ServiceUnavailable, 1hr block) |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `loc://item/{item_id}` | LOC item metadata by ID — stable URI for injecting item context. | None (single item) |

### Prompts

None — purely data-oriented server.

---

## Overview

`libofcongress-mcp-server` exposes the Library of Congress digital collections to LLM agents, covering millions of digitized historical items: newspapers (Chronicling America corpus), photographs, maps, manuscripts, audio recordings, and more. The primary audience is agents doing historical research — finding primary sources, reading contemporary newspaper accounts, and discovering what the LOC holds on a topic.

Two APIs underpin the server:

1. **LOC JSON API** (`www.loc.gov`) — unified access to all digital collections. Format-specific endpoints (`/newspapers/`, `/photos/`, `/maps/`) narrow results by material type. Item and resource endpoints deliver full metadata and digital resource links.
2. **LC Linked Data** (`id.loc.gov`) — Library of Congress Subject Headings (LCSH) and Name Authority File (LCNAF). Used for controlled-vocabulary subject search and authority lookups.

Chronicling America's standalone API (`chroniclingamerica.loc.gov`) has been redirected into the main LOC API as of 2026. Newspaper content (including OCR full text) is now fully accessible via `/newspapers/` endpoint with the standard LOC JSON API pattern.

---

## Requirements

- No authentication required on either API. Custom `User-Agent` header recommended.
- LOC JSON API rate limit: 20 req/min; violations blocked for 1 hour. Server must pace requests.
- Deep pagination capped at 100,000 items per query. Date/subject faceting required to navigate large result sets.
- Results per page: default 25, recommended maximum 1,000.
- Newspaper OCR text quality varies by digitization batch and publication era — older papers and poor condition yields fragmented or garbled text. Surface text as-is; don't repair.
- Items exist in many formats (image, audio, video, manuscript scan). Non-text items return metadata and description only — no binary content.
- LC Linked Data (`id.loc.gov`): no published rate limits, but polite use expected. Subject suggest endpoint returns `[query, labels[], counts[], uris[]]` shape.

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `LocApiService` | LOC JSON API (`www.loc.gov`) | `loc_search`, `loc_get_item`, `loc_search_newspapers`, `loc_get_newspaper_page`, `loc_browse_collections` |
| `LcLinkedDataService` | LC Linked Data (`id.loc.gov`) | `loc_search_subjects` |

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `LOC_USER_AGENT` | No | Custom User-Agent for LOC requests. Default: `libofcongress-mcp-server/0.1.0`. Recommended by LOC for polite access. |
| `LOC_REQUEST_DELAY_MS` | No | Delay in ms between requests to stay within 20 req/min limit. Default: `3100` (~19/min). |

---

## Implementation Order

1. Config (`server-config.ts`) — User-Agent, request delay
2. `LocApiService` — HTTP client with rate pacing, retry on 429/5xx, response parsing
3. `LcLinkedDataService` — Subject suggest and authority lookup
4. `loc_search` tool — unified search with format/date/subject/location filters
5. `loc_get_item` tool — single-item metadata retrieval
6. `loc_search_newspapers` tool — newspaper-specific search via `/newspapers/` endpoint
7. `loc_get_newspaper_page` tool — full OCR text via resource endpoint
8. `loc_search_subjects` tool — LCSH autocomplete and lookup
9. `loc_browse_collections` tool — collection listing
10. `loc://item/{item_id}` resource

---

## Tool Detail

### `loc_search`

**Description:** Search the Library of Congress digital collections by keyword. Optionally filter by material format (photos, maps, newspapers, audio, etc.), date range, subject heading, or geographic location. Returns item summaries with titles, dates, descriptions, LOC IDs, and format tags. Use `loc_get_item` to retrieve full metadata for a specific result.

**Input:**
- `query: string` — full-text search across metadata and available descriptive text
- `format?: string` — material type: `photo`, `map`, `newspaper`, `manuscript`, `audio`, `film`, `book`, `notated-music` (maps to LOC format endpoint slugs)
- `date_start?: number` — start year (e.g., 1920); inclusive
- `date_end?: number` — end year (e.g., 1930); inclusive
- `subject?: string` — subject heading filter; use `loc_search_subjects` to find exact headings
- `location?: string` — geographic location filter (e.g., "oklahoma", "washington d.c.")
- `limit?: number` — results per page, default 25, max 100
- `page?: number` — 1-indexed page number

**Output:** Array of item summaries, each with `id` (use in `loc_get_item`), `title`, `date`, `description`, `format`, `url`. Includes `total` count and `pagination` object. If `total > limit`, indicates truncation with next-page info.

**Errors:**
- `empty_results` (NotFound) — no items matched. Recovery: broaden the query, widen the date range, or use `loc_search_subjects` to find the correct subject heading spelling.
- `rate_limit_exceeded` (ServiceUnavailable, non-retryable for 1 hour) — 20 req/min exceeded; LOC blocks for 1 hour. Message: "LOC API rate limit exceeded. Requests are blocked for approximately 1 hour. Reduce request frequency to stay under 20 req/min."

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `loc_get_item`

**Description:** Retrieve the full metadata record for a specific LOC digital item. Returns contributors, subjects, rights information, physical description, notes, related items, and links to digital resources. Use after `loc_search` to get complete details on a result.

**Input:**
- `item_id: string` — LOC item ID from a search result's `id` field (e.g., `"loc.pnp.ppmsc.02404"` or a numeric ID like `"2009632251"`). Do not include URL path segments — pass the bare ID only.

**Output:** Full item record including `item_id`, `title`, `date`, `contributors`, `subject_headings`, `notes`, `rights_information`, `physical_description`, `resource_links` (digital file URLs), and `related_items` (array of IDs for follow-up). `resource_links` contains URLs to downloadable digital files (TIFF, JPEG, PDF) for items with digital surrogates.

**Errors:**
- `item_not_found` (NotFound) — no item exists for the given ID. Recovery: verify the ID from `loc_search` results; IDs are not guessable. Use `loc_search` to find a valid ID.
- `rate_limit_exceeded` (ServiceUnavailable, non-retryable for 1 hour) — see `loc_search` error above.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `loc_search_newspapers`

**Description:** Search historical newspaper pages in the Chronicling America corpus. Returns matching pages with OCR text excerpts (~500 characters), publication title, date, state, and the page URL needed for `loc_get_newspaper_page`. Filters by keyword, date range, state, and newspaper title. The OCR excerpts are sufficient for relevance assessment; call `loc_get_newspaper_page` to read the full page text.

**Input:**
- `query: string` — keyword search across OCR text and metadata
- `date_start?: number` — start year (e.g., 1900); inclusive
- `date_end?: number` — end year (e.g., 1920); inclusive
- `state?: string` — US state name (e.g., "oklahoma", "new york"); filters to papers published in that state
- `newspaper_title?: string` — filter to a specific newspaper by title (partial match)
- `limit?: number` — results per page, default 25, max 100
- `page?: number` — 1-indexed page number

**Output:** Array of page results, each with `url` (pass to `loc_get_newspaper_page`), `title` (page title/date), `description` (OCR excerpt, ~500 chars), `date`, `state`, `newspaper_title`, and `edition_label`. Includes `total` count and `pagination` object.

**Errors:**
- `empty_results` (NotFound) — no pages matched. Recovery: broaden the date range, remove the state filter, or try different keywords. OCR search is approximate — spelling variations in historical text are common.
- `rate_limit_exceeded` (ServiceUnavailable, non-retryable for 1 hour) — see `loc_search` error above.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `loc_get_newspaper_page`

**Description:** Retrieve the full OCR text of a specific historical newspaper page along with publication metadata. Pass the `url` field from a `loc_search_newspapers` result — do not construct this URL manually. OCR quality varies by digitization batch and era — 19th-century and degraded materials may contain garbled text, which is surfaced as-is. When a page exists but has no digitized text, `ocr_available` is `false` and `ocr_text` is empty; this is a data property, not an error.

**Input:**
- `page_url: string` — the `url` field from a `loc_search_newspapers` result. Format: `https://www.loc.gov/resource/sn{number}/{date-id}.{seq}/`. Always pass the value directly from search results; do not construct or modify this URL.

**Output:** `{ page_url, newspaper_title, date, state, edition, sequence, ocr_text, ocr_available }`. `ocr_text` is the full plain-text content for the page; empty string when `ocr_available: false`. `ocr_available: false` when the page has no digitized text (image-only digitization batches — not all corpus pages have been OCR-processed). `ocr_text` may contain fragmented words, line-break artifacts, and misspellings inherent to historical OCR — do not attempt to repair.

**Errors:**
- `page_not_found` (NotFound) — the URL does not resolve to a valid LOC resource. Recovery: re-run `loc_search_newspapers` to get a fresh `url` from current results; do not modify or guess page URLs.
- `rate_limit_exceeded` (ServiceUnavailable, non-retryable for 1 hour) — see `loc_search` error above.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `loc_search_subjects`

**Description:** Search Library of Congress Subject Headings (LCSH) by keyword. Returns controlled-vocabulary subject labels and their URIs. Use the returned labels as the `subject` filter value in `loc_search` — LCSH uses precise, standardized terms that differ from natural language (e.g., "World War, 1939-1945" not "World War II"). Running this tool before a subject-filtered `loc_search` dramatically improves result quality.

**Input:**
- `query: string` — keyword or partial subject heading (e.g., "civil war", "immigration", "jazz")
- `limit?: number` — max results to return, default 10, max 50

**Output:** Array of subject records, each with `label` (the standardized heading — use this in `loc_search subject` filter), `uri` (stable LOC URI for the heading), and `count` (approximate number of LOC items carrying this heading). Ordered by relevance.

**Errors:**
- `empty_results` (NotFound) — no headings matched the query. Recovery: try broader or different terms; LCSH uses inverted forms for many headings (e.g., "Photography, Aerial" not "Aerial photography").

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `loc_browse_collections`

**Description:** List and browse the Library of Congress curated digital collections. Returns collection names, descriptions, item counts, and slugs. Optionally filter by keyword. Collections are curated subsets of the digital holdings — each has a specific focus (e.g., "Civil War Glass Negatives", "Baseball Cards", "WPA Posters"). Use the collection slug with `loc_search` to scope searches to a single collection.

**Input:**
- `query?: string` — optional keyword to filter collections by name or description
- `limit?: number` — max results, default 25, max 100
- `page?: number` — 1-indexed page number

**Output:** Array of collection summaries, each with `slug` (use in `loc_search` partof filter), `title`, `description`, `item_count`, and `url`. Includes `total` count.

**Errors:**
- `empty_results` (NotFound) — no collections matched the keyword. Recovery: broaden the keyword or call without a query to list all collections.
- `rate_limit_exceeded` (ServiceUnavailable, non-retryable for 1 hour) — see `loc_search` error above.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

## Domain Mapping

| Noun | Operations | LOC Endpoint |
|:-----|:-----------|:-------------|
| Item | search, get-by-id | `/search/?fo=json`, `/{format}/?fo=json`, `/item/{id}/?fo=json` |
| Collection | list, search by name/subject | `/collections/?fo=json`, `/collections/{slug}/?fo=json` |
| Newspaper page (segment) | search with OCR, get-by-url | `/newspapers/?fo=json`, `/resource/{id}/?fo=json` |
| Subject heading | search, get authority record | `id.loc.gov/suggest/`, `id.loc.gov/authorities/subjects/{id}.json` |

**Format endpoint slugs** (all accept `?fo=json&q=...`):
- `/newspapers/` — historical newspaper pages with OCR text
- `/photos/` — photographs, prints, drawings
- `/maps/` — cartographic materials
- `/manuscripts/` — manuscript and mixed materials
- `/audio/` — sound recordings
- `/film-and-videos/` — film and video
- `/books/` — books and printed material

**Facet filters** available on search endpoints:
- `original-format:{value}` — e.g., `photo,+print,+drawing`
- `location:{value}` — e.g., `oklahoma`, `washington+d.c.`
- `subject:{value}` — e.g., `civil+war`
- `contributor:{value}` — e.g., `rothstein,+arthur`
- `language:{value}`

**Date filter**: `dates={start}/{end}` appended to query (year granularity, e.g., `dates=1918/1919`)

---

## Workflow Analysis

### `loc_search_newspapers` + `loc_get_newspaper_page`

The newspaper research workflow is **two agent hops** — search, then get full text. The `fulltext_file` fetch happens inside `loc_get_newspaper_page` and is invisible to the agent.

| Step | Tool | Action |
|:-----|:-----|:-------|
| 1 | `loc_search_newspapers` | GET `/newspapers/?fo=json&q=...&dates=...&fa=location:...` — returns page segments with OCR excerpts (~500 chars) in `description`, publication title, date, state, and a `url` field per result |
| 2 | `loc_get_newspaper_page` | Receives the `url` from step 1. Internally: (a) GET resource endpoint (`/resource/{id}/?fo=json&at=resource`) to obtain the `fulltext_file` URL, then (b) GET the text-services URL to fetch full OCR text. Agent sees only the completed text in the response. |

**What is `page_url`?** It is the `url` field returned by each result object from `loc_search_newspapers`. Format: `https://www.loc.gov/resource/sn{number}/{date-id}.{seq}/` — a LOC resource path. Do not construct this manually; always pass the value directly from search results.

**OCR text access via text-services** (internal to `loc_get_newspaper_page`): `https://tile.loc.gov/text-services/word-coordinates-service?segment=/service/...&format=alto_xml&full_text=1` — rate limit 150 req/min (separate from main API limit). Returns ALTO XML; service extracts plain text. This URL is not surfaced to agents.

### `loc_search` → `loc_get_item`

Standard discovery-to-detail workflow:

| Step | Tool | Action |
|:-----|:-----|:-------|
| 1 | `loc_search` | GET `/search/?fo=json&q=...&fa=original-format:...` — returns result summaries with `id` fields |
| 2 | `loc_get_item` | GET `/item/{id}/?fo=json&at=item,resources` — returns full metadata, `subject_headings`, `rights_information`, `resource_links` |

---

## Design Decisions

### Unified search vs. format-specific tools

The idea doc proposed `loc_search_maps` and `loc_search_photos` as dedicated tools. Decision: **drop format-specific search tools in favor of one `loc_search` with a `format` filter parameter**.

Rationale: The LOC API's format endpoints (`/photos/`, `/maps/`, etc.) use the same response shape and query parameters as `/search/` — they're just pre-filtered. Duplicating the tool for each format would add 5+ tools (photos, maps, manuscripts, audio, maps) with identical shapes. One tool with a `format` enum is equivalent and cuts surface area. The tradeoff is slightly less discoverability, but the format descriptions make the filter obvious.

Exception: `loc_search_newspapers` stays as a dedicated tool. Newspaper search has meaningfully different parameters (state, newspaper title, strong date-range focus) and the OCR text in results is the domain's killer feature. It warrants its own description and separate tool to signal that workflow clearly.

### Chronicling America standalone API

The old `chroniclingamerica.loc.gov/search/pages/results/` endpoint returns 404 as of 2026 — that subdomain redirects to `www.loc.gov/chroniclingamerica/` and then to `/collections/chronicling-america/`. All newspaper content (including OCR text) is now served through the main LOC JSON API via `/newspapers/`. **No separate Chronicling America API integration needed.**

### Subject headings as a tool, not a filter mechanism

`loc_search_subjects` exists as a standalone tool rather than just a hint in `loc_search` parameter descriptions. Rationale: LCSH is a controlled vocabulary with ~300,000 headings — agents can't guess the exact spelling. Finding the right heading before searching dramatically improves result quality. The tool's output (subject URIs and labels) feeds directly back as `fa=subject:...` filter values in `loc_search`. This chain ("find the heading, then filter by it") is a first-class workflow worth exposing.

### No collection-browsing detail tool

The design considered a `loc_get_collection` tool for detailed collection metadata. Dropped — `loc_browse_collections` returns collection descriptions and item counts inline, and items within a collection are searchable via `loc_search` with the collection slug in `partof` facet. A separate detail-fetch tool would add a round trip without material gain.

### No LC Linked Data authority record detail

The `id.loc.gov/{id}.json` endpoint returns JSON-LD with full authority structure (broader terms, variant labels, classification codes). This is genuinely useful for semantic discovery — but the JSON-LD is verbose and complex to parse. Decision: **exclude for v0.1**. `loc_search_subjects` returns labels and URIs; that's enough to fuel `loc_search` filters. The authority detail tool can be added if demand emerges.

### No audio/video content

Sound recordings and films return metadata only (title, contributors, subjects, dates). No audio/video binary streaming — agents can't consume it, and the file links in `resources` are sufficient for human followup. No special handling needed; these items appear in `loc_search` results with their metadata.

---

## Known Limitations

- **OCR quality is variable.** Historical newspaper OCR can be garbled, especially for 19th-century papers or degraded materials. Fragments like `"Hil_e"` and `"Alubumt"` appear in real results. The server surfaces text as-is.
- **Rate limit is tight.** 20 req/min on the main LOC API means multi-step workflows (search → item → item → item) hit limits quickly. Request delay of ~3.1s between calls. Agents should prefer broader searches over repeated narrow ones.
- **Chronicling America search parameters**: the old API had precise `andtext`/`ortext` Boolean controls. The `/newspapers/` endpoint uses the standard LOC `q` full-text search, which is less precise. Boolean operators are not documented as supported.
- **Deep pagination cap**: result sets with >100,000 items cannot be fully paginated. LOC recommends facet-based decomposition. For the server's typical use cases (topic-specific searches with date/location filters), this cap is rarely hit.
- **Photo/print/drawing search**: the Prints and Photographs Online Catalog (`www.loc.gov/pictures/`) does not respond to the JSON API pattern. Photos are searchable via `/photos/?fo=json` but that endpoint wraps the digitized-photos collection, not the full P&P catalog. ~164,000 digitized photos vs. millions in the full catalog.

---

## API Reference

### LOC JSON API

Base pattern: `https://www.loc.gov/{endpoint}/?fo=json&{params}`

**Search parameters:**
- `q={keyword}` — full-text search across metadata and available text
- `fa={filter}:{value}` — facet filter; multiple via `|`
- `dates={start}/{end}` — year range filter (e.g., `dates=1918/1919`)
- `c={n}` — results per page (default 25, max recommended 1000)
- `sp={n}` — page number (1-indexed)
- `sb={field}` — sort: `date`, `date_desc`, `title_s`, `title_s_desc`
- `at={attributes}` — subset response (e.g., `at=results,pagination`)

**Format slugs:** `newspapers`, `photos`, `maps`, `manuscripts`, `audio`, `film-and-videos`, `books`, `notated-music`

**Item endpoint:** `https://www.loc.gov/item/{id}/?fo=json&at=item,resources`

**Resource endpoint:** `https://www.loc.gov/resource/{id}/?fo=json&at=resource`

**Error shape** (404): `{ "exception": "not found", "status": "not found", ... }` — HTTP 404 with JSON body.

### LC Linked Data

**Subject suggest:** `https://id.loc.gov/suggest/?q={term}&memberOf={schemeURI}&rdftype={typeURI}`
- Subjects scheme: `http://id.loc.gov/authorities/subjects`
- Topic type: `http://www.loc.gov/mads/rdf/v1%23Topic`
- Names scheme: `http://id.loc.gov/authorities/names`
- Response shape: `[query, labels[], counts[], uris[]]`

**Rate limits:** None published. Polite use recommended.
