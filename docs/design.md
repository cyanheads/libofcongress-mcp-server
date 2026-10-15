# libofcongress-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations | Errors |
|:-----|:------------|:-----------|:------------|:-------|
| `libofcongress_search_items` | Search LOC digital collections by keyword with format, date, subject, and collection filters. Returns item summaries with titles, dates, descriptions, and LOC IDs for follow-up retrieval. | `query`, `format`, `date_start`, `date_end`, `subject`, `location`, `collection_slug`, `include_facets`, `limit`, `page` | `readOnlyHint: true`, `openWorldHint: true` | `invalid_date_range` (ValidationError), `incompatible_filters` (ValidationError), `collection_not_found` (NotFound), `rate_limit_exceeded` (RateLimited, 1hr block), `server_busy` (RateLimited, retryable), `request_timed_out` (Timeout), `upstream_unavailable` (ServiceUnavailable) |
| `libofcongress_get_item` | Retrieve full metadata for a specific LOC item by ID — imprint, contributors, subjects, summary, languages, locations, rights, call number, formats, access restrictions, digital resources, a paged list of its pages, and related items. | `item_id`, `page_offset`, `page_limit`, `include_files` | `readOnlyHint: true`, `openWorldHint: true` | `invalid_item_id` (ValidationError), `item_not_found` (NotFound), `rate_limit_exceeded` (RateLimited, 1hr block), `server_busy` (RateLimited, retryable), `request_timed_out` (Timeout), `upstream_unavailable` (ServiceUnavailable) |
| `libofcongress_search_newspapers` | Search historical newspaper pages (Chronicling America corpus) with full-text OCR content. Returns matching pages with the opening of each page's text and publication details. Accepts keyword, date range, state, and newspaper title filters. | `query`, `date_start`, `date_end`, `state`, `newspaper_title`, `limit`, `page` | `readOnlyHint: true`, `openWorldHint: true` | `invalid_date` (ValidationError), `invalid_date_range` (ValidationError), `rate_limit_exceeded` (RateLimited, 1hr block), `server_busy` (RateLimited, retryable), `request_timed_out` (Timeout), `upstream_unavailable` (ServiceUnavailable) |
| `libofcongress_get_newspaper_page` | Retrieve the full text of one page — a newspaper page, or a book or manuscript page. Pass the `url` field from a `libofcongress_search_newspapers` result (two hops total: search, then this tool) or a `pages[].page_url` from `libofcongress_get_item`; with `match`, returns the passages around the search terms instead of the whole page. Returns `ocr_available: false` when the page has no digitized text. | `page_url`, `match` | `readOnlyHint: true`, `openWorldHint: true` | `invalid_page_url` (ValidationError), `page_not_found` (NotFound), `rate_limit_exceeded` (RateLimited, 1hr block), `server_busy` (RateLimited, retryable), `request_timed_out` (Timeout), `upstream_unavailable` (ServiceUnavailable) |
| `libofcongress_search_subjects` | Search LC Subject Headings (LCSH) by keyword — the controlled vocabulary used to categorize LOC items. Returns subject labels and their URIs, which can be used as filters in `libofcongress_search_items`. | `query`, `limit` | `readOnlyHint: true`, `openWorldHint: true` | `request_timed_out` (Timeout), `upstream_unavailable` (ServiceUnavailable) |
| `libofcongress_browse_collections` | List and browse LOC curated digital collections with descriptions and item counts. Optionally filter by subject keyword. | `query`, `limit`, `page` | `readOnlyHint: true`, `openWorldHint: true` | `rate_limit_exceeded` (RateLimited, 1hr block), `server_busy` (RateLimited, retryable), `request_timed_out` (Timeout), `upstream_unavailable` (ServiceUnavailable) |

### Resources

| URI Template | Description | Pagination | Errors |
|:-------------|:------------|:-----------|:-------|
| `libofcongress://item/{+item_id}` | LOC item metadata by ID — stable URI for injecting item context. Reserved expansion (`+`) so multi-segment newspaper IDs keep their slashes; the handler decodes the captured value once, so percent-encoded slashes resolve too. | Default page window (first 50 pages); `libofcongress_get_item`'s `page_offset` continues | `invalid_item_id` (ValidationError), `item_not_found` (NotFound), `rate_limit_exceeded` (RateLimited, 1hr block), `server_busy` (RateLimited, retryable), `request_timed_out` (Timeout), `upstream_unavailable` (ServiceUnavailable) |

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
- LOC JSON API rate limit: 20 req/min; violations blocked for 1 hour. Server must pace requests, concurrent ones included.
- Every tool call must end inside the MCP TypeScript SDK client's 60 s default request timeout, so the caller receives this server's typed error rather than the client's own `Request timed out`.
- Deep pagination capped at 100,000 items per query. Date/subject faceting required to navigate large result sets.
- Results per page: default 25, recommended maximum 1,000.
- Newspaper OCR text quality varies by digitization batch and publication era — older papers and poor condition yields fragmented or garbled text. Surface text as-is; don't repair.
- Items exist in many formats (image, audio, video, manuscript scan). Non-text items return metadata and description only — no binary content.
- LC Linked Data (`id.loc.gov`): no published rate limits, but polite use expected. The subject suggest endpoint (`suggest2`) returns `{ count, hits[] }` with the total match count.

---

## Upstream Text

- **Character references are decoded once, at normalization.** `www.loc.gov` sends HTML references in search descriptions (`&#8217;`, `&hellip;`, `&#xA0;`), collection descriptions (`&rsquo;`, `&eacute;`), and item rights (`&amp;`); every `www.loc.gov` text field the service returns, the newspaper search excerpts included, goes through `decodeText` (`src/services/loc-api/loc-text.ts`, `decodeHTMLStrict` from the `entities` package). One pass: `&amp;lt;` becomes `&lt;`, never `<`. Strict mode decodes only `;`-terminated references, so `a=1&copy=2` and `&c.` stay as written. Result IDs and URLs are read as sent; none carried a reference across the captured records. `id.loc.gov` labels are raw text (`AT&T PC 6300 (Computer)`), so they are not decoded — a label is the exact subject filter value. The `tile.loc.gov` page text (`ocr_text`) is not decoded either: it is not HTML-escaped (captured bodies carry raw `<` such as `p<ured` and bare `&` such as `books &c.`, and no references), so a `&name;` in it is the page's own text.
- **`item.rights` becomes plain text.** Records without `rights_information` (manuscripts, maps, books, audio, newspapers) carry `item.rights`, an HTML statement with paragraphs, `<a href="/legal/">` links, and CRLF line ends. `htmlToText` drops the tags in one forward pass, keeps each link's target as an absolute URL after its text (`Copyright and other Restrictions (https://www.loc.gov/legal/)`), and collapses whitespace. Tag stripping applies to rights only: `notes` hold literal catalog brackets (`1866-<1899>.`) that a strip would delete.
- **`content[]` escapes only what Markdown would read as markup; `structuredContent` is verbatim.** Catalog text in an inline `format()` slot passes through `inlineText` (`src/mcp-server/tools/render-text.ts`): line breaks become spaces, and a `<` that opens a tag, comment, or autolink, or an `&` that opens a character reference, is backslash-escaped, so a decoded `<b>` renders as text and `1866-<1899>.` renders unchanged. Backslashes before such an opener, or ending the value, are doubled, so a value ending in `\` never escapes the line break or `**` the template writes after it. Underscores, asterisks, IDs, and URLs are left alone, since callers copy them out. OCR text (`get_newspaper_page` `ocr_text`, the `search_newspapers` excerpts) goes in a fenced block from `markdown().codeBlock()`, whose fence outgrows any backtick run in the text; the fenced text is `ocr_text` byte for byte. Why: OCR noise such as `p<ured` or a line starting `#` reads as Markdown structure, and escaping it piecemeal would make the two surfaces diverge.

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `LocApiService` | LOC JSON API (`www.loc.gov`) | `libofcongress_search_items`, `libofcongress_get_item`, `libofcongress_search_newspapers`, `libofcongress_get_newspaper_page`, `libofcongress_browse_collections` |
| `LcLinkedDataService` | LC Linked Data (`id.loc.gov`) | `libofcongress_search_subjects` |

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `LOC_USER_AGENT` | No | Custom User-Agent for LOC requests. Default: `libofcongress-mcp-server/0.5.1`. Recommended by LOC for polite access. |
| `LOC_REQUEST_DELAY_MS` | No | Minimum gap in ms between the starts of consecutive `www.loc.gov` requests, to stay within the 20 req/min limit. Default: `3100` (~19/min). The 20-per-minute window is enforced separately, whatever this is set to. |

---

## Implementation Order

1. Config (`server-config.ts`) — User-Agent, request delay
2. `LocApiService` — HTTP client with a `www.loc.gov` request queue, a per-call time budget, retry on raw network faults only (429, HTML soft-block, and 5xx fail fast), response parsing
3. `LcLinkedDataService` — Subject suggest and authority lookup
4. `libofcongress_search_items` tool — unified search with format/date/subject/location filters
5. `libofcongress_get_item` tool — single-item metadata retrieval
6. `libofcongress_search_newspapers` tool — newspaper-specific search via `/newspapers/` endpoint
7. `libofcongress_get_newspaper_page` tool — full OCR text via resource endpoint
8. `libofcongress_search_subjects` tool — LCSH autocomplete and lookup
9. `libofcongress_browse_collections` tool — collection listing
10. `libofcongress://item/{+item_id}` resource

---

## Tool Detail

### `libofcongress_search_items`

**Description:** Search the Library of Congress digital collections by keyword. Optionally filter by material format (photos, maps, newspapers, audio, etc.), date range, subject heading, or geographic location, or scope the search to a single curated collection. Returns item summaries with titles, dates, descriptions, LOC IDs, and format tags. Use `libofcongress_get_item` to retrieve full metadata for a specific result.

**Input:**
- `query: string` — full-text search across metadata and available descriptive text
- `format?: string` — material type: `photo`, `map`, `newspaper`, `manuscript`, `audio`, `film`, `book`, `notated-music` (maps to LOC format endpoint slugs)
- `date_start?: number` — start year (e.g., 1920); inclusive
- `date_end?: number` — end year (e.g., 1930); inclusive. Sent as `dates=<start>/<end>`. An open start is sent as `0000` and an open end as the current year: LOC reads `dates=/<end>` as the end year alone, a later floor drops items dated before it, and a fixed fill past a given bound inverts the range, which LOC answers with results outside it instead of an error. Years only — `/search/` ignores month and day precision.
- `subject?: string` — an LCSH heading (from `libofcongress_search_subjects`) or a subject facet term. LOC's subject facet holds each heading's components, lowercased and without date qualifiers (`United States--History--Civil War, 1861-1865` is indexed as `united states`, `history`, `civil war`), and no facet key or query form matches a full heading. So the value is split at `--` (spaced or not), each component lowercased with a trailing `, <year or year range>` stripped, date-only components dropped, and the terms ANDed as `fa=subject:a|subject:b|…` (`src/services/loc-api/subject-terms.ts`). `World War, 1939-1945` and `world war` send the same filter. The applied terms are echoed as `enrichment.effectiveSubjectTerms`.
- `location?: string` — geographic location filter (e.g., "oklahoma", "washington d.c.")
- `collection_slug?: string` — scope the search to one curated collection, via its `/collections/{slug}/` endpoint; slugs come from `libofcongress_browse_collections`. Mutually exclusive with `format`
- `include_facets?: boolean` — default `false`; when true, the response adds `subject_facets` and `location_facets` (see Output)
- `limit?: number` — results per page, default 25; at most 100 per page. Accepts up to 1000: a larger value is served as one 100-result page (`c=100`), with `enrichment.effectiveLimit: 100` and a notice that page numbers count 100-result pages. Above 1000 is a schema rejection.
- `page?: number` — 1-indexed page number

**Output:** Array of item summaries, each with `id` (use in `libofcongress_get_item`), `title`, `date`, `description`, `format`, `is_item`, `url`. Includes `total` count and `pagination` object. If `total > limit`, indicates truncation with next-page info. With `include_facets: true`, `subject_facets` and `location_facets` are LOC's top 10 values of each facet across every match, as `{ value, count }`, from `at=results,pagination,facets`; without it both fields are absent and the request is `at=results,pagination`. `enrichment.effectiveCollectionSlug` echoes the applied collection scope; absent when the search covered all of LOC.

`date` is the row's nested `item.date` (the date as cataloged: `c1915 Feb. 19.`), falling back to the top-level `date`. Why: on Prints & Photographs rows the top-level `date` is LOC's sort key padded to `YYYY-01-01` (`1915-01-01`), a day and month LOC never recorded; rows without a nested date keep the top-level value. A coded `item.date` is skipped the same way, so the top-level `date` stands in, or the row has none: on scores and manuscripts `item.date` is a compact sort number (`18950000`, `19130600` beside `1895`, `1913-06-01`), on maps and catalog-only books a MARC placeholder (`185u` beside `185?`; `uuuu` and `||||` with no top-level date). Coded means only digits, `u`, and `|` with at least one `u` or `|`; seven or more digits; or a `d`-plus-four-digit period token (`0w0 d1804 d1806`) — the forms seen on 130 of 1,187 rows across 12 searches. A plain three- or four-digit year is never coded, and every other value is returned as LOC sends it. No separate sort field: `date_start`/`date_end` already filter by year upstream.

`is_item` is true when the row's `id` resolves through `libofcongress_get_item`: an `/item/` row, or a row keyed by an `lccn.loc.gov` permalink (`id: "http://lccn.loc.gov/2005567251"`, returned as `id: "2005567251"`, `url: "https://lccn.loc.gov/2005567251"`), which `www.loc.gov/item/<lccn>/` serves. Why: 220 of 1,187 rows across 12 searches (18.5%, mostly books, sound recordings, and films) were permalink rows, and every one sampled resolved to a titled record. Collections, exhibit and guide pages, newspaper pages, `catalog.loc.gov` records (keyed by a catalog bib ID with no LCCN), and `hdl.loc.gov` finding aids stay `false`.

Facets are opt-in. Why: `at` cannot select facet types (`at=facets.subject` returns the whole block under another key), so a facet request carries all ten types — about 21 KB more upstream per response (11% of a 25-result `/photos/` page) and 0.6–2.8 s more LOC response time in paired measurements (3.9 s vs 1.1 s on one query), on an upstream that already approaches the 50-second call budget. A caller wants filter values on a minority of searches, so it asks for them.

**Empty results with filters:** the notice names every applied filter, subject terms and location included, and says that every subject term must match.

**Errors:** every declared reason forwards its recovery hint — `data.recovery.hint` on `structuredContent.error`, and a `Recovery:` line in `content[]`.
- `invalid_date_range` (ValidationError, non-retryable) — `date_start` is later than `date_end`, or `date_start` is given alone and is later than the current year (the open end it would run to). Rejected before any request; `data` carries `field`, `date_start`, and `date_end` or `current_year`. Recovery: put the earlier bound first and keep a lone `date_start` no later than the current year; omit a bound to leave that side open.
- `incompatible_filters` (ValidationError, non-retryable) — `format` and `collection_slug` were both supplied. Each selects a different LOC base path (`/{format}/` vs `/collections/{slug}/`), so no single request can honor both. Recovery: drop one — omit `format` and filter on each result's `format` field, or omit `collection_slug`.
- `collection_not_found` (NotFound) — `collection_slug` does not resolve to a LOC collection (upstream 404 on page 1). Recovery: call `libofcongress_browse_collections` and pass a slug exactly as returned; slugs are not derivable from the collection title.
- `rate_limit_exceeded` (RateLimited, non-retryable for 1 hour) — 20 req/min exceeded; LOC blocks for 1 hour. The recovery hint carries the service's runtime state, not the contract's static text: "wait at least 1 hour, until <time>" on the 429 itself, and the minutes left plus the expiry time for calls made during the block (`data.blockedUntil` holds the ISO timestamp).
- `server_busy` (RateLimited, retryable) — this server's `www.loc.gov` queue cannot start the request within the call's time budget, so the call is shed at once and nothing is sent. `data.retryAfter` carries the seconds until a slot opens, and the recovery hint names that wait. Recovery: wait `retryAfter` seconds, then retry; send calls one at a time rather than in parallel. Never reported as `rate_limit_exceeded`: a local queue clears in seconds, LOC's block lasts an hour.
- `request_timed_out` (Timeout) — the Library of Congress did not answer within the call's 50-second budget. The message names the upstream only, never a URL or host. Recovery: add a `format`, `subject`, or `location` filter, or a tighter `date_start`/`date_end` range, then retry; if a narrow search also times out, retry in a few minutes.
- `upstream_unavailable` (ServiceUnavailable) — the Library of Congress could not be reached after the retry ladder (connection refused or reset, DNS, proxy refusal), answered with a status outside the 404/429/out-of-range branches (5xx, 403), or answered 200 with HTML, an empty or truncated body, or JSON that is not a response object (`null`, a string, an array). Thrown by the service with `data.reason`, so the framework fills the contract recovery; status-derived failures carry the bare `data.status`. The message names the upstream and any HTTP status, never a URL, host, or transport text (that stays on the error's `cause`, for the log). Recovery: retry in a few minutes. A soft block (a `cf-mitigated: challenge` response or an HTML 200) also starts a 60-second pause on `www.loc.gov` requests: that call and every call during the pause carry `data.retryAfter` (seconds left) and a hint naming that wait in place of the contract text.

**Empty results:** returned as success with `enrichment.notice` populated — the handler returns `{ items: [], total: 0, ... }` with a contextual recovery hint in `enrichment.notice` rather than throwing an error.

**Out-of-range pages:** a page LOC will not serve returns the same empty success with `pages: 0` and a notice naming the page, rather than an error. LOC answers a page past the end of any search-family endpoint (`/search/`, the format endpoints, `/collections/{slug}/`, `/newspapers/`, `/collections/`) with 404, so a 404 on `page > 1` takes this path; the notice points back to page 1 for the total and page count. A page past the ~100,000-item retrieval ceiling redirects to a terminal 400 even when the query matches only a handful of items, so its notice also points back to page 1 first, then recommends partitioning by date, subject, or location when the targets really lie past the first 100,000.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `libofcongress_get_item`

**Description:** Retrieve the full metadata record for a specific LOC digital item. Returns the imprint, contributors, LCSH subject headings and subject facet terms, summary, languages, locations, rights information, physical description, call number, formats, access restrictions, notes, related items, the item's digital resources, and a window of its pages, each addressable by `libofcongress_get_newspaper_page`. Use after `libofcongress_search_items` to get complete details on a result.

**Input:**
- `item_id: string` — LOC item ID from a search result's `id` field (e.g., `"2005691065"`, or `"sn95047246/1935-09-05/ed-1"` for a newspaper issue). A loc.gov item link — `https://www.loc.gov/item/<id>/`, over `http://`, without `www.` or a scheme, or `item/<id>` — is read as its bare ID before any request, query and fragment dropped, multi-segment IDs keeping their slashes. An LCCN permalink — `https://lccn.loc.gov/<lccn>`, over `http://` or without a scheme, trailing slash optional, query and fragment dropped — is read as `<lccn>`, the form `related_items` and search rows carry. `/item/` answers an unnormalized LCCN (`2005-568294`, `sn 83030214`) with 404 and serves its normalized form (`2005568294`), so the permalink's LCCN is normalized by LC's fixed one-to-one rule: every blank (` ` or `%20`) removed; a hyphen removed and the one to six digits after it left-padded with zeros to six. A result that is not up to three lowercase letters and then 8 or 10 digits is rejected, as is a written LCCN over 64 characters, which bounds the scan. Why normalize rather than reject: the rejection's recovery pointed the caller back at a permalink, so a caller holding a hyphenated LCCN looped. Bare item IDs are never normalized, since real ones carry hyphens (`afc1981004-b42`). Another permalink path (`/marcxml`) is not an item record. Any other URL is rejected (`invalid_item_id`), as is text no LOC ID has: each segment is letters, digits, `.`, `_`, `-`, starting with a letter or digit, so dot segments, percent-escapes, and empty segments never reach a request path. Why reject rather than pass through: a pasted URL used to become `/item/https%3A//…` and spend a paced request on a certain `item_not_found`, and a `/resource/` URL has no derivable item ID (`mss93930.mss93930-001` belongs to `mm77093930`).
- `page_offset?: number` — 0-based index of the first page to list, across every resource; default 0
- `page_limit?: number` — pages to list, default 50; at most 100 per call. Accepts up to 1000: a larger value is served as 100 with `enrichment.effectivePageLimit: 100` and a notice, the same rule as the list tools' `limit`
- `include_files?: boolean` — default `false`; when true, each listed page carries `files`, the URL of every file in its group

**Output:** Full item record including `item_id`, `title`, `date`, `imprint`, `contributors`, `subject_headings`, `subject_terms`, `notes`, `summary`, `rights_information`, `physical_description`, `call_number`, `languages`, `locations`, `former_ids`, `original_formats`, `online_formats`, `access_restricted`, `resources`, `pages`, `page_total`, `next_page_offset`, and `related_items` (array of IDs for follow-up). The curated metadata comes from the same upstream response as the rest of the record — no extra request.

`resources` has one entry per `resources[]` record: `url`, `page_count` (its file groups), and `image`, `pdf`, `audio` (the MP3 of a sound recording) when LOC sends them. `pages` runs across every resource in order; LOC's `files[]` holds one file group per page, so page N of a resource is `files[N-1]`, addressed as the resource `url` plus `?sp=N` (a one-page resource by its bare `url`, as LOC links it). `has_text` is true when the group holds a `text/plain` entry (LOC's key is `mimetype`). `page_total` counts every page; `next_page_offset` is present while pages follow the window. A `page_offset` past the last page returns an empty `pages` with a notice naming the valid range. A resource without a `url` has no addressable page and is left out.

Why a window: a flat list of every file of every page (each IIIF size, JP2, TIFF, text) grows with page count and has no bound — 3,494 links and 476 KB per surface on the 582-page book `02007458`. The default window of 50 pages is 7.1 KB in `structuredContent` and 6.1 KB in `content[]` text for that book; `include_files` raises it to 48.4 KB / 47.5 KB, and a 100-page window with files to 94.9 KB / 93.3 KB. Per-page entries carry no image URL: it would double the default cost, and the resource-level `image` already gives a representative one. `files` is a list of URLs without MIME types; each URL's extension names its format, and MIME types added about 10 KB to a 50-page window. Offsets rather than a cursor: the page list is a deterministic local set, and "page 300" is a meaningful jump (`page_offset: 299`).

`date` is `item.created_published_date` (the date as cataloged: `1936 Apr.`, `1909-1911.`), falling back to `item.date`. On Prints & Photographs records `item.date` is the `YYYY-01-01` sort key; other formats send no `created_published_date` and keep `item.date` (`1894`, `1923-11-07`, `1912-04-16`). A coded `item.date` (`uuuu`, `||||`, `0w0 d1804 d1806` — the same test as the search rows) is omitted rather than returned: the record has no readable date to fall back to. No year is parsed out of `item.created_published`, a publication statement rather than a date; it is returned verbatim as `imprint`.

`imprint` is `item.created_published` — place, publisher, and date as cataloged (`Boston : Estes and Lauriat, 1894.`), a string or an array whose entries are space-joined (`Millwood, NY : ZOHO Music, [2017] ℗2017`), absent when LOC sends none. Its entries are decoded once and never tag-stripped: imprints carry literal cataloging brackets (`Roma : Carocci, 2013-<2021>`) and bare `&` (`Rowman & Littlefield`). On photos and manuscripts it is often a date alone (`1936 Apr.`), returned as sent. It costs no request (the field is in the `item` block already fetched) and 21–86 bytes per surface on sampled records. For some books it is the only readable publication date: `00003348` has `New York : Werner School Book Company, c1900.` while its `item.date` is coded. Why not LOC's `cite_this` APA, MLA, and Chicago strings instead: they need `cite_this` in the request's `at` list, add 385–1,292 bytes per surface, and 15 of 25 sampled records had a malformed citation — an empty year `()`, a year read from a coded date (`00003348` cited as `1804`), truncated imprints (`Harper, -70`). A caller formats a citation from `contributors`, `title`, `imprint`, and `date`.

`subject_headings` is `item.subject_headings` verbatim — the LCSH headings as cataloged (`Transportation--Oklahoma--Maps`; some collections space the separator, `World War, 1939-1945 -- Personal Narratives`), empty when the record carries none. `subject_terms` is `item.subject`: the lowercase facet terms (`maps`, `transportation`, `oklahoma`) that the `libofcongress_search_items` `subject` filter matches. The item JSON has no top-level subject key; `item.subjects` maps each term to LOC's own filter link and is not read.

`contributors` is `item.contributor_names` verbatim — names with roles (`"Washington, George, 1732-1799 (Author)"`), one entry per person per role. The item JSON carries no `contributor` key; `item.contributors` holds the same people as `{ name: facet-url }` objects without roles, so it is not read.

`related_items` merges the top-level `related_items` array with `item.related_items`. The latter mixes plain strings with `{ title, url }` objects; every object entry, in either array, normalizes to its `id`, then `url`, then `title`, so one malformed auxiliary entry never fails output validation for the whole record.

**Response parity:** `format()` renders `resources`, the window of `pages` (with `files` when requested), `page_total`, `next_page_offset`, and `related_items` in full. Both surfaces carry the same values, so a `content[]`-only client can reach every entry `structuredContent` holds; the page window, not `format()`, bounds the size.

The `libofcongress://item/{+item_id}` resource has no paging input, so it returns the default window (50 pages, no files); its description points at `libofcongress_get_item`'s `page_offset` for the rest.

**Errors:**
- `invalid_item_id` (ValidationError, non-retryable) — `item_id` is not a LOC item ID, a loc.gov `/item/` link, or an `lccn.loc.gov` permalink to an LCCN that normalizes. Rejected before any request; `data` carries `field` and `received`. Recovery: pass a search result's `id`, an item link, or an LCCN permalink; an LCCN that still fails is malformed, so find the item with `libofcongress_search_items`; a `/resource/` page URL goes to `libofcongress_get_newspaper_page`, which returns the page's `item_id`.
- `item_not_found` (NotFound) — no item exists for the given ID; the message names the ID. Recovery: verify the ID from `libofcongress_search_items` results; IDs are not guessable. Use `libofcongress_search_items` to find a valid ID.
- `rate_limit_exceeded` (RateLimited, non-retryable for 1 hour) — see `libofcongress_search_items` error above.
- `server_busy` (RateLimited, retryable) — see `libofcongress_search_items` error above.
- `request_timed_out` (Timeout) — the Library of Congress did not answer within the call's 50-second budget. Recovery: retry in a few minutes.
- `upstream_unavailable` (ServiceUnavailable) — see `libofcongress_search_items` error above.

The `libofcongress://item/{+item_id}` resource runs the same `item_id` check on the decoded ID and declares the same six reasons; its `invalid_item_id` recovery shows the URI form instead.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `libofcongress_search_newspapers`

**Description:** Search historical newspaper pages in the Chronicling America corpus. Returns matching pages with the opening of each page's OCR text (~500 characters), publication title, date, the states LOC indexes the title under, and the page URL needed for `libofcongress_get_newspaper_page`. Filters by keyword, date range, state, and newspaper title. The excerpt is the page's first lines, not the text around the match (the Pine Bluff `sn89051168/1912-04-16/ed-1/?sp=1` row begins `I VOL XVIII A MEMBER OF THE INTERNATIONAL NEWS SERVICE PINE BLUFF…`, the page masthead); to read where the query occurs, call `libofcongress_get_newspaper_page` with the result's `url` and the query as `match`.

**Input:**
- `query: string` — keyword search across OCR text and metadata
- `date_start?: number | string` — start of the range, inclusive: an integer year (e.g., 1900) or a `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` string (e.g., `"1912-04-15"`); the advertised schema carries the string `pattern`. A year or month starts on its first day.
- `date_end?: number | string` — end of the range, inclusive, in the same forms; a year or month ends on its last day. Sent as `dates=<start>/<end>`, which `/newspapers/` honors to the day (`titanic`: 280 pages on `1912-04-16/1912-04-16`, 5,990 on `1912-04/1912-04`). Integer years send the same value as before. Month and day are zero-padded first (`1912-4-6` → `1912-04-06`), since LOC answers an unpadded date differently; a string naming no calendar day fails as `invalid_date`, since LOC answers `1912-02-30` as February 29. Open sides fill as on `libofcongress_search_items` (`0000` / current year), and precisions mix (`0000/1912-04-16`, `1912/1912-04-16`). A blank string is treated as unset.
- `state?: string` — US state name (e.g., "oklahoma", "new york") or two-letter postal code, case-insensitive; sent as `fa=location_state:<lowercase full name>`. Postal codes map to full names for the 50 states, `DC` (`"district of columbia"`), `PR` (`"puerto rico"`), and `VI` (`"virgin islands"`) — the two territories with Chronicling America titles; any other value is sent lowercased as given. `location_state` rather than `location`, because `location` also matches city and county names: `fa=location:washington` returns D.C. papers and Washington-County papers in other states (`titanic` in 1912: 2,188 pages, 1,453 of them D.C.), `fa=location_state:washington` only Washington-state titles (477)
- `newspaper_title?: string` — filter to one newspaper, sent unchanged as `fa=partof_title:<value>`. LOC matches only the full catalog title with place and run, case-insensitively and without wildcards (`"new-york tribune (new york [n.y.]) 1866-1924"`: 440 pages for `titanic` in 1912; `"New-York Tribune"`: 0), so the description names a search result's `newspaper_title` as the source. Resolving a partial title is out of reach: a facets response lists only the top 10 titles in scope, and each lookup would cost an extra paced request. `libofcongress_get_newspaper_page` returns the display-cased short title, which does not work here. An empty result with a title filter carries a notice naming the filter and the exact-value requirement, since one response cannot tell a wrong title from a right one with no keyword hits
- `limit?: number` — results per page, default 25; at most 100 per page, with the same above-the-cap handling as `libofcongress_search_items`
- `page?: number` — 1-indexed page number

**Output:** Array of page results, each with `url` (pass to `libofcongress_get_newspaper_page`), `title` (page title/date), `description` (the opening ~500 characters of the page's OCR text), `date`, `states`, and `newspaper_title`. Includes `total` count and `pagination` object.

`states` is the whole `location_state` facet in LOC's order, absent when LOC sends none. The facet is multi-valued — a title that relocated or is indexed against its circulation area lists several states (the Charleston, S.C. *Southern Christian advocate* carries `["georgia", "south carolina"]`) — so the output does not single one out as the place of publication, and `location` (cities, counties, "united states") never stands in. LOC does not project `place_of_publication` into `/newspapers/` results; `libofcongress_get_newspaper_page` returns it. The `state` input filter reads the same facet: `fa=location_state:<state>` matches a title indexed under that state among others.

**Errors:**
- `invalid_date` (ValidationError, non-retryable) — `date_start` or `date_end` names no calendar day: a month outside 01–12, or a day past the end of its month. Rejected before any request; the message names the field, the value, and why (`date_start ("1912-02-30") is not a calendar date: 1912-02 has 29 days.`), and `data` carries `field` and the value under the field's name. Recovery: correct the date, or drop its day or month part.
- `invalid_date_range` (ValidationError, non-retryable) — see `libofcongress_search_items` error above. Bounds compare normalized: a start counts as the first day of its precision and an end as the last, so `"1912-04"` to `"1912-04-16"` is valid and `"1912-05"` to `"1912-04-30"` is not.
- `rate_limit_exceeded` (RateLimited, non-retryable for 1 hour) — see `libofcongress_search_items` error above.
- `server_busy` (RateLimited, retryable) — see `libofcongress_search_items` error above.
- `request_timed_out` (Timeout) — the Library of Congress did not answer within the call's 50-second budget. Recovery: narrow the search with a tighter `date_start`/`date_end` range, a `state`, or a `newspaper_title`, then retry; if a narrow search also times out, retry in a few minutes.
- `upstream_unavailable` (ServiceUnavailable) — see `libofcongress_search_items` error above.

**Empty results:** returned as success with `enrichment.notice` populated — the handler returns `{ items: [], total: 0, ... }` with a contextual recovery hint in `enrichment.notice` rather than throwing an error. Out-of-range pages behave as described under `libofcongress_search_items`.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `libofcongress_get_newspaper_page`

**Description:** Retrieve the full text of one LOC page — a historical newspaper page, or a book or manuscript page — or, with `match`, only the passages around the caller's search terms, along with publication metadata and the `item_title` and `item_id` of the issue, book, or manuscript it belongs to, which `libofcongress_get_item` takes to list every page of the item. Pass the `url` field from a `libofcongress_search_newspapers` result, or a `pages[].page_url` from `libofcongress_get_item` — do not construct this URL manually. The tool keeps its newspaper name: renaming it would break existing callers for no functional gain, and every newspaper-specific output field is optional and absent on book and manuscript pages. OCR quality varies by digitization batch and era — 19th-century and degraded materials may contain garbled text, which is surfaced as-is. When a page exists but has no digitized text, `ocr_available` is `false` and `ocr_text` is empty; this is a data property, not an error.

**Input:**
- `page_url: string` — the `url` field from a `libofcongress_search_newspapers` result or a `pages[].page_url` from `libofcongress_get_item`: `https://www.loc.gov/resource/<id>/?sp=N` (`https://www.loc.gov/resource/sn83045462/1905-03-15/ed-1/?sp=1`), or a one-page resource's bare URL. Before any request it is reduced to that form, and the output `page_url` is the reduced URL:

  | input | read as |
  |:--|:--|
  | `http://www.loc.gov/resource/…`, `https://loc.gov/resource/…`, `www.loc.gov/resource/…` | `https://www.loc.gov/resource/…` |
  | `…/resource/<lccn>/<date>/ed-N/seq-M/` | `https://www.loc.gov/resource/<lccn>/<date>/ed-N/?sp=M` |
  | `chroniclingamerica.loc.gov/lccn/<lccn>/<date>/ed-N/seq-M/`, `www.loc.gov/chroniclingamerica/lccn/…/seq-M/` | `https://www.loc.gov/resource/<lccn>/<date>/ed-N/?sp=M` |

  These are LOC's own redirects (`chroniclingamerica.loc.gov` 308s to `www.loc.gov/chroniclingamerica/`, which 301s to the `/resource/…?sp=M` page), applied locally so the request and the `sequence` read the page form. Only `sp` survives from the query: `q=` already broke the text service, and `fo=`/`at=` would collide with the projection the service appends; the fragment is dropped. Rejected (`invalid_page_url`): any other host, a port or userinfo, a dot segment or percent-escape in the path, a non-numeric `sp`, and Chronicling America links that are not one page — an issue link without `seq-M`, `seq-M/ocr/`, and file links (`.pdf`, `.jp2`, `.json`). Matching is by anchored pattern on the caller's text rather than a URL parser, which would resolve `..`, `%2e%2e`, and backslashes before a check could see them.
- `match?: string` — up to 200 characters; blank or whitespace-only is unset. Returns the passages around these terms instead of the whole page; see Match passages below. The `q=` a search result's `url` carries stays stripped rather than read as `match`: reading it would change the response of every existing call that passes a search URL, and the caller already holds the query.

**Output:** `{ page_url, item_id, item_title, newspaper_title, date, states, place_of_publication, edition, sequence, segment_count, ocr_text, ocr_available, matches?, match_count? }` — `matches` and `match_count` only when `match` is set. One request to `?fo=json&at=item,resource,fulltext_service` supplies everything: the top-level `fulltext_service` is the text-service URL for the requested `sp`, `resource` carries `segment_count` (pages in the issue or volume), `item` carries the item's identity and the publication metadata — `item_id` from `item.url` reduced by `normalizeItemId` (`https://www.loc.gov/item/mm77093930/` → `mm77093930`; a book or manuscript resource path does not name its item, so it cannot be parsed from `page_url`), falling back, when the item block carries no `url`, to a newspaper page's `<lccn>/<date>/ed-N` issue path and otherwise absent, and absent too when `item.url` is not an item link; `item_title` from `item.title`, decoded once like every catalog field, on every page type (the only title a book or manuscript page has, so `format()` heads those pages with it; `newspaper_title` keeps its newspaper-only meaning rather than standing in for a book title); `newspaper_title` from `item.newspaper_title[0]` (falling back to `item.partof_title[0]`), `states` from `item.location_state` (same shape as search), `place_of_publication` (e.g. `"Charleston, S.C."`), `edition` from `item.number_edition[0]`, and `date` from `item.date_issued`. The `resource` projection alone carries none of that metadata, which is why `at=resource` left it empty. Neither block carries the page's sequence, so `sequence` comes from the URL's `sp` param, and `date` falls back to the URL's date segment; a sparse or missing `item` block degrades to those fallbacks rather than an error. Every metadata field is absent, never an empty string, when LOC doesn't send it. `ocr_text` is the full plain-text content for the page — OCR, or for crowd-transcribed manuscripts a volunteer transcription; empty string when `ocr_available: false`, when the page is blank or its text could not be retrieved, and under `match`. `ocr_available` is whether the response carries `fulltext_service`; `false` when the page has no digitized text (image-only digitization batches — not all corpus pages have been OCR-processed). `ocr_text` may contain fragmented words, line-break artifacts, and misspellings inherent to historical OCR — do not attempt to repair.

Text source: `fulltext_service` answers `{ "<segment>": { "full_text": "…" } }` for newspaper, book, and manuscript pages alike. Only a non-empty string counts as a text service: image-only manuscript and map pages carry `"fulltext_service": {}` (`magbell.02800101/?sp=2`, which `libofcongress_get_item` lists with `has_text: false`), and they read as `ocr_available: false` with no text request and no notice, as a page without the key does. `resource.fulltext_file` is never read. Why: on books and manuscripts it is the whole volume's `text/plain` file — the same URL for every page, with no page markers (the 122-page diary's is 200 KB), so no window over it lines up with the requested page; on newspaper pages it is byte-identical to `fulltext_service` (checked on two batches, `sn83030214/1912-04-16/ed-1` page 1 and `sn93067777/1902-01-24/ed-2` page 2), so newspaper text is unchanged. A `full_text` that is exactly `[NO TEXT AVAILABLE FOR THIS PAGE]`, surrounding whitespace aside, is the service's placeholder for a page whose ALTO file holds no words (`gdcmassbookdig.storyofcaptainme00king/?sp=3`, which `libofcongress_get_item` lists with `has_text: true`), so it reads as empty `ocr_text` with the empty-page notice; text that merely contains it, or a different-case variant, is returned as sent. A text body that does not parse as that JSON (a plain-text file, truncated JSON) leaves `ocr_text` empty with a notice naming it unparseable, since a retry gets the same body; a text service that fails, runs out of budget, or answers with an HTML page (LOC's documented soft block under load) gets the retry notice.

Match passages: a dense page is large — `sn83030214/1912-04-16/ed-1/?sp=12` returns 50,241 characters of `ocr_text`, 53,205 bytes of `structuredContent` plus 50,486 of `content[]` text — and the search excerpt is the page opening, so finding the matching article meant reading all of it. `match` scans the fetched text in `src/services/loc-api/page-text-match.ts` and costs no request beyond the page and its text. Rules, and why:

- **Terms.** Whitespace-separated words are separate terms (an occurrence of any is a hit) and a double-quoted span is one phrase. This mirrors LOC: a quoted query means adjacency (`"titanic iceberg"`: 1 page on 1912-04-16) while LOC's own snippet service splits an unquoted query into separate highlighted terms, and its unquoted counts follow no boolean rule (`titanic iceberg` 166 > `iceberg` 151).
- **Literal, folded matching.** Each term matches case-insensitively as a substring of a folded copy of the text (lower-cased per UTF-16 unit, every whitespace run read as one space) with an offset map back to the original, by `indexOf`; no regex is built from caller text, so `a.*b`, `(`, and `[` match literally, and the scan is linear in page length for each term. Folding whitespace lets a phrase split across an OCR line break match (`"the titanic"` on page 1 of that issue: 22 occurrences, 2 across a line break). Line-end hyphens are not repaired: the New-York Tribune batch prints `?` for its hyphen (`con?\ndition`) while other batches have none, so no rule works across batches. Substring matching covers plurals (`iceberg` in `icebergs`); there is no stemming.
- **Passages.** 300 characters either side of each occurrence, in page order. Overlapping windows merge only while the passage stays within 1,200 characters, and passages never overlap: a window that cannot merge starts the next passage where the previous one's last occurrence ends, and an occurrence already inside the current passage adds none. Unbounded merging would let a page-wide term become one passage as long as the page; overlap would repeat text.
- **Cap and count.** At most 10 passages (at most 12,000 characters of passage text); `match_count` counts every occurrence of every term, each term's occurrences found left to right without overlapping each other. A notice discloses the cut. No stop-word or short-term filtering: the cap bounds the cost of a noisy term, and a filter would surprise a caller passing a short name.
- **Rarest terms first when the cap binds.** When the occurrences need more than 10 passages, the term with the fewest occurrences on the page is covered first (ties by term order), each term's occurrences taken in page order while the passages stay within 10, so a common word fills only the slots the rarer terms leave; the passages still come out in page order. Why: callers pass their search query, and natural queries carry common words. In page order, `sinking of the titanic` on page 12 filled all 10 slots with "the" and "of" and showed neither of its 2 "titanic" occurrences; rarest first shows both. A term stops at its first occurrence that does not fit, which keeps the selection bounded by what 10 passages hold rather than by page length, and can leave a slot unused (that query returns 9 passages). The chosen occurrences are then laid out in page order, which gives each its full context; when that layout needs an 11th passage, because occurrences the selection found already inside a passage lengthen it, the selection's own passages, which hold every chosen occurrence, are returned instead. Without that fallback, `sinking of the titanic` on the 16 April 1912 Washington Herald front page (`sn83045433/1912-04-16/ed-1/?sp=1`) lost the last of its 5 "sinking"s.
- **`ocr_text` is `""` under `match`** and stays a required string, so the output schema existing structured clients parse is unchanged. Without `match` (or with a blank one) the response is unchanged and carries no `matches` or `match_count` keys.
- **Notices.** On a page with text: one when nothing matched (OCR misreads and line-split words can hide an occurrence, and LOC's search matches more loosely), one when occurrences are left outside the passages. The cut notice sends the caller to the whole page (omit `match`), the one call that holds every occurrence, and says only that a narrower `match` needs fewer passages. Why: narrowing promises nothing. On `sn85035720/1912-04-17/ed-2/?sp=2`, `titanic` counts 34 occurrences and `"the titanic"` 26, and the phrase still leaves 6 outside its 10 passages. A page without text (image-only, the blank-page placeholder, a retrieval miss) returns `matches: []` and `match_count: 0` with only its existing text-state notice; that notice keys on the fetched text, never the returned `ocr_text`.

Measured on that issue's pages: `match: "titanic"` on page 12 returns 2 passages in 1,664 bytes of `structuredContent` and 1,623 of `content[]` text, against 103,691 for the whole page across both surfaces; `the` on the same page, a page-wide term, returns 10 passages (9,226 bytes of `matches` and `match_count`) of 278 occurrences. The scan adds no request and under 1 ms of CPU on that 50,241-character page. Rejected: an `include_text` flag (the full page plus passages is larger than the call it replaces — omit `match` instead), and LOC's `relevant_snippet` service (`word_coordinates_url` on each search row with `&q=<query>&relevant_snippet=1`), which returns one ~600-character snippet per page from an undocumented parameter, at one tile.loc.gov request per search row.

**Errors:**
- `invalid_page_url` (ValidationError, non-retryable) — `page_url` is neither a loc.gov `/resource/` URL nor a Chronicling America page link ending `/ed-N/seq-M/`. Rejected before any request; `data` carries `field` and `received`. Recovery: pass a search result's `url` or a `pages[].page_url` as returned; a Chronicling America link must name one page.
- `page_not_found` (NotFound) — the URL does not resolve to a valid LOC resource; the message names the URL. Recovery: get a fresh page URL — a `libofcongress_search_newspapers` result's `url` or a `pages[].page_url` from `libofcongress_get_item` — and pass it as returned; do not modify or guess page URLs.
- `rate_limit_exceeded` (RateLimited, non-retryable for 1 hour) — see `libofcongress_search_items` error above.
- `server_busy` (RateLimited, retryable) — see `libofcongress_search_items` error above.
- `request_timed_out` (Timeout) — the page fetch did not answer within the call's 50-second budget. Recovery: retry in a few minutes. The page fetch and the OCR fetch share that one budget; an OCR fetch left without budget does not fail the call — the page returns with `ocr_available: true`, empty `ocr_text`, and a `notice` to retry.
- `upstream_unavailable` (ServiceUnavailable) — the page fetch failed; see `libofcongress_search_items` error above. An OCR fetch that fails the same way degrades to the same empty-text `notice` rather than failing the call.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `libofcongress_search_subjects`

**Description:** Search Library of Congress Subject Headings (LCSH) by keyword. Returns authorized subject headings and their URIs, ranked by relevance with a heading that exactly matches the query first; a partial word with no keyword match returns the headings that begin with it. Use the returned labels as the `subject` filter value in `libofcongress_search_items` — LCSH uses precise, standardized terms that differ from natural language (e.g., "World War, 1939-1945" not "World War II"; "Aerial photography" not "Photography, Aerial"). Running this tool before a subject-filtered `libofcongress_search_items` dramatically improves result quality.

**Input:**
- `query: string` — keyword or partial subject heading (e.g., "civil war", "immigration", "jazz")
- `limit?: number` — max results to return, default 10; at most 50 per call (this server's bound; id.loc.gov pages up to 250). Accepts up to 1000: a larger value returns up to 50 headings with `enrichment.effectiveLimit: 50` and a notice. Above 1000 is a schema rejection.

**Output:** Array of subject records, each with `label` (the authorized heading, the hit's `aLabel` — use this in the `libofcongress_search_items` `subject` filter), and `uri` (stable LOC URI for the heading). Ordered by relevance, with a heading equal to the query (case-insensitive) moved to the top. When the upstream `count` exceeds the headings returned, `enrichment.truncated` is set and the notice names both numbers.

Search: `suggest2` with `searchtype=keyword` and `count` = 50 (or the applied limit, when larger), then cut to the applied limit after the exact-label promotion. Why 50: promotion can only lift a heading the page holds, and keyword ranking puts `Civil war` about 10th for `civil war`, so a page of the default 10 can miss it; `id.loc.gov` is fast and off the `www.loc.gov` queue. Truncation still reads the upstream `count`. A keyword search matches whole words, so a partial word (`aerial photog`) returns nothing; on zero hits the call retries once left-anchored (the endpoint's default search type) on the same endpoint, inside the same 50-second budget. A left-anchored hit can be a cross-reference whose `suggestLabel` is the variant (`Civil War Memorial (Portland, Me.) (USE Soldiers and Sailors Monument (Portland, Me.))`); `aLabel` is the authorized heading.

No per-heading item count: the upstream `count` tallies matching authority records, not LOC items, so it carries no research signal. A heading's real item count is `libofcongress_search_items`'s `total` with the heading in the `subject` filter.

**Errors:**
- `request_timed_out` (Timeout) — the subject heading service (`id.loc.gov`) did not answer within the call's 50-second budget. Recovery: retry in a few minutes; the subject heading service is responding slowly. `id.loc.gov` is a different host from `www.loc.gov`, so this tool is not on the request queue and has no `server_busy` or `rate_limit_exceeded` reason.
- `upstream_unavailable` (ServiceUnavailable) — the subject heading service could not be reached, or answered with an error status, HTML, or an unreadable body; the message names the service and any HTTP status. Recovery: retry in a few minutes.

**Empty results:** returned as success with `enrichment.notice` populated — the handler returns `{ subjects: [], total: 0 }` with a contextual recovery hint in `enrichment.notice` rather than throwing an error.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `libofcongress_browse_collections`

**Description:** List and browse the Library of Congress curated digital collections. Returns collection names, descriptions, item counts, and slugs. Optionally filter by keyword. Collections are curated subsets of the digital holdings — each has a specific focus (e.g., "Civil War Glass Negatives", "Baseball Cards", "WPA Posters"). Pass a returned slug to `libofcongress_search_items` as `collection_slug` to search inside one collection.

**Input:**
- `query?: string` — optional keyword to filter collections by name or description
- `limit?: number` — max results, default 25; at most 100 per page, with the same above-the-cap handling as `libofcongress_search_items`
- `page?: number` — 1-indexed page number

**Output:** Array of collection summaries, each with `slug` (pass to `libofcongress_search_items` as `collection_slug`), `title`, `description`, `item_count`, and `url`. Includes `total` count. `slug` is the first path segment after `/collections/` in the collection's route — derived from the URL, not the title, which does not reliably match it ("Aaron Copland Collection" lives at `aaron-copland`). `item_count` comes from the upstream collection-level `count`.

**Errors:**
- `rate_limit_exceeded` (RateLimited, non-retryable for 1 hour) — see `libofcongress_search_items` error above.
- `server_busy` (RateLimited, retryable) — see `libofcongress_search_items` error above.
- `request_timed_out` (Timeout) — the Library of Congress did not answer within the call's 50-second budget. Recovery: retry with a more specific `query` keyword, or retry in a few minutes.
- `upstream_unavailable` (ServiceUnavailable) — see `libofcongress_search_items` error above.

**Empty results:** returned as success with `enrichment.notice` populated — the handler returns `{ collections: [], total: 0, ... }` with a contextual recovery hint in `enrichment.notice` rather than throwing an error. Out-of-range pages behave as described under `libofcongress_search_items`.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

## Domain Mapping

| Noun | Operations | LOC Endpoint |
|:-----|:-----------|:-------------|
| Item | search, get-by-id | `/search/?fo=json`, `/{format}/?fo=json`, `/item/{id}/?fo=json` |
| Collection | list, search by name/subject | `/collections/?fo=json`, `/collections/{slug}/?fo=json` |
| Newspaper page (segment) | search with OCR, get-by-url | `/newspapers/?fo=json`, `/resource/{id}/?fo=json` |
| Subject heading | search, get authority record | `id.loc.gov/authorities/subjects/suggest2/`, `id.loc.gov/authorities/subjects/{id}.json` |

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
- `location:{value}` — e.g., `oklahoma`, `washington+d.c.`; matches city and county names as well as states
- `location_state:{value}` — the state a newspaper title is indexed under, e.g., `washington`, `district+of+columbia`; the newspaper `state` filter uses it
- `subject:{value}` — e.g., `civil+war`; a lowercase heading component, never a full LCSH heading. Case-insensitive; terms joined with `|` are ANDed (`subject:dust storms|subject:oklahoma`)
- `contributor:{value}` — e.g., `rothstein,+arthur`
- `language:{value}`

**Date filter**: `dates={start}/{end}` appended to query (e.g., `dates=1918/1919`). `/newspapers/` also honors `YYYY-MM` and `YYYY-MM-DD` bounds (`dates=1912-04-15/1912-04-16`); `/search/` reads years only

---

## Workflow Analysis

### `libofcongress_search_newspapers` + `libofcongress_get_newspaper_page`

The newspaper research workflow is **two agent hops** — search, then get the page text (or only the passages around the query, with `match`). The text-service fetch happens inside `libofcongress_get_newspaper_page` and is invisible to the agent.

| Step | Tool | Action |
|:-----|:-----|:-------|
| 1 | `libofcongress_search_newspapers` | GET `/newspapers/?fo=json&q=...&dates=...&fa=location_state:...` — returns page segments with the opening ~500 characters of each page's OCR text in `description`, publication title, date, states, and a `url` field per result |
| 2 | `libofcongress_get_newspaper_page` | Receives the `url` from step 1, and the step-1 query as `match` to read only the passages around it. Internally: (a) GET resource endpoint (`/resource/{id}/?fo=json&at=item,resource,fulltext_service`) to obtain the page's `fulltext_service` URL and the issue's publication metadata, then (b) GET the text-services URL to fetch full OCR text, scanned locally for `match`. Agent sees only the completed text or passages in the response, with the `item_id` that leads to the issue's other pages through `libofcongress_get_item`. |

**What is `page_url`?** A LOC resource URL with the page sequence, `https://www.loc.gov/resource/<id>/?sp=M`. Newspaper pages come from the `url` field of each `libofcongress_search_newspapers` result (`https://www.loc.gov/resource/<lccn>/<date>/ed-N/?sp=M`); any item's pages, newspaper, book, or manuscript, come from `pages[].page_url` on `libofcongress_get_item`. Do not construct this manually; pass a value as returned, or a Chronicling America page link, which the tool reads as the same URL.

**OCR text access via text-services** (internal to `libofcongress_get_newspaper_page`): the page response's top-level `fulltext_service` URL on `tile.loc.gov`, with any echoed `q=` stripped — rate limit 150 req/min (separate from main API limit). Returns JSON (`{ "<batch-key>": { "full_text": "..." } }`); the service reads `full_text`. This fetch stays off the `www.loc.gov` request queue but spends what the page fetch left of the call's budget. This URL is not surfaced to agents.

### `libofcongress_search_items` → `libofcongress_get_item`

Standard discovery-to-detail workflow:

| Step | Tool | Action |
|:-----|:-----|:-------|
| 1 | `libofcongress_search_items` | GET `/search/?fo=json&q=...&fa=original-format:...` — returns result summaries with `id` fields |
| 2 | `libofcongress_get_item` | GET `/item/{id}/?fo=json&at=item,resources,related_items` — returns full metadata, `subject_headings`, `subject_terms`, `rights_information`, `resources`, and a window of `pages` |
| 3 | `libofcongress_get_newspaper_page` | Receives a `pages[].page_url` with `has_text: true` and returns that page's text |

---

## Design Decisions

### Unified search vs. format-specific tools

The idea doc proposed `loc_search_maps` and `loc_search_photos` as dedicated tools. Decision: **drop format-specific search tools in favor of one `libofcongress_search_items` with a `format` filter parameter**.

Rationale: The LOC API's format endpoints (`/photos/`, `/maps/`, etc.) use the same response shape and query parameters as `/search/` — they're just pre-filtered. Duplicating the tool for each format would add 5+ tools (photos, maps, manuscripts, audio, maps) with identical shapes. One tool with a `format` enum is equivalent and cuts surface area. The tradeoff is slightly less discoverability, but the format descriptions make the filter obvious.

Exception: `libofcongress_search_newspapers` stays as a dedicated tool. Newspaper search has meaningfully different parameters (state, newspaper title, strong date-range focus) and the OCR text in results is the domain's killer feature. It warrants its own description and separate tool to signal that workflow clearly.

### The general search is named `libofcongress_search_items`

Every tool name carries an object, so the general search sits beside `libofcongress_search_newspapers` and `libofcongress_search_subjects` as `libofcongress_search_items`. A bare search verb would leave "search what?" unanswered, and a caller reading `tools/list` could not tell which of the three searches is the general one. `_items` matches the `libofcongress_get_item` hop its results feed. `_collections` was rejected because `libofcongress_browse_collections` lists collections themselves, which is also why the display title is `Search LOC Items`. The earlier unscoped name was dropped without an alias.

### Chronicling America standalone API

The old `chroniclingamerica.loc.gov/search/pages/results/` endpoint returns 404 as of 2026 — that subdomain redirects to `www.loc.gov/chroniclingamerica/` and then to `/collections/chronicling-america/`. All newspaper content (including OCR text) is now served through the main LOC JSON API via `/newspapers/`. **No separate Chronicling America API integration needed.**

### Subject headings as a tool, not a filter mechanism

`libofcongress_search_subjects` exists as a standalone tool rather than just a hint in `libofcongress_search_items` parameter descriptions. Rationale: LCSH is a controlled vocabulary with ~300,000 headings — agents can't guess the exact spelling. Finding the right heading before searching dramatically improves result quality. The tool's output (subject URIs and labels) feeds directly back as `fa=subject:...` filter values in `libofcongress_search_items`. This chain ("find the heading, then filter by it") is a first-class workflow worth exposing.

### No collection-browsing detail tool

The design considered a `loc_get_collection` tool for detailed collection metadata. Dropped — `libofcongress_browse_collections` returns collection descriptions and item counts inline, and items within a collection are searchable via `libofcongress_search_items`'s `collection_slug` filter. A separate detail-fetch tool would add a round trip without material gain.

### Collection scoping routes through the collection endpoint, not a facet

An earlier iteration of this document claimed collection scoping worked by passing the slug as a `partof` facet (`fa=partof:{slug}`) on `/search/`. It does not — that request returns zero results. The mechanism that works is LOC's own `/collections/{slug}/` endpoint, which accepts the same query string as `/search/` and returns the same `results[]`/`pagination` envelope, so it needed no new parsing path. Hence `collection_slug` as one additive parameter on `libofcongress_search_items` rather than a second search tool.

The consequence is that `format` and `collection_slug` are mutually exclusive: both choose a base path (`/{format}/` vs `/collections/{slug}/`), and there is no verified way to facet by format *within* a collection. The tool rejects the pair with `incompatible_filters` rather than silently picking a winner — a search the caller did not ask for still returns plausible-looking results, which is worse than a failure that names the choice.

An unrecognized slug 404s upstream, which surfaces as `collection_not_found` naming the slug and pointing back at `libofcongress_browse_collections`. Slugs are not pre-validated with an extra request: the 404 already carries the signal, and a speculative round trip would spend the rate-limit budget to learn nothing new.

That signal is only unambiguous on page 1. LOC also answers a page past the end of a valid collection's results with 404, with the same body, so on `page > 1` the page number is the only thing separating the two cases. Page 1 of a real endpoint never 404s (an empty result set is a 200), so a 404 there means the slug is wrong; on a later page the server reads the 404 as out of range and returns the notice, which points the caller back to page 1, where a bad slug fails with `collection_not_found`. Resolving the ambiguity on the later page would take a second request, and the rate limit rules that out.

### One request queue in front of `www.loc.gov`

Every `www.loc.gov` request goes through one framework `createPacer`: a first-in-first-out queue whose `minStartGapMs` is `LOC_REQUEST_DELAY_MS`, plus a `{ requests: 20, perMs: 60_000 }` window. Why: a spacing check that reads the time of the last request releases concurrent callers together, and one parallel burst past 20 per minute blocks every `www.loc.gov` tool for an hour. The window holds LOC's documented ceiling whatever the delay is set to, and the gap stops the window from admitting all 20 starts in one millisecond.

- The pacer runs inside each retry attempt, so a retry re-queues and is paced like any other request.
- The 1-hour block is checked when a call arrives, so a call made during the block fails with `rate_limit_exceeded` without queueing, and again when its queued request is dispatched, so callers already waiting when a 429 lands fail the same way and send nothing.
- Queue wait is charged to the call's budget: a caller may wait only for the budget left minus a 30-second reserve for the request itself. One the queue cannot start in time is shed at once as `server_busy` with `retryAfter`. Why: a shed is local backpressure that clears in seconds, so it gets its own retryable reason rather than the hour-long `rate_limit_exceeded`.
- A soft block pauses `www.loc.gov` requests for 60 seconds, checked at the same two points as the 1-hour block, so arriving and queued callers fail as `upstream_unavailable` with `retryAfter` and send nothing. A soft block is a response carrying `cf-mitigated: challenge` on any status (the Cloudflare challenge `www.loc.gov` actually serves is a 403 `text/html` "Just a moment..." page) or a 2xx with an HTML body (LOC's documented "HTML pages with CAPTCHAs"). It is checked after the 429, 404, and out-of-range (400/520) branches, so those are unchanged, and a 5xx or plain 403 without the header fails without a pause. Why 60 s: LOC names no pause length and its limits are per minute, so one minute clears any window, and a persisting challenge costs at most one request a minute. Why not the pacer's `cooldown`: it reacts only to a `RateLimited` error, which every handler relabels as the hour-long `rate_limit_exceeded`, and callers shed behind its gate would get `server_busy`'s "send calls one at a time" advice. The deadline is a `LocApiService` field, not module state, so a re-initialized service starts unpaused.
- `id.loc.gov` and the `tile.loc.gov` OCR fetch stay off it, the pause included: different hosts under different limits.

### One 50-second budget per tool call

Each tool call gets one wall-clock budget of 50 seconds (`LOC_CALL_BUDGET_MS`), started at service-method entry and shared by every leg: queue wait, each attempt including its body read, retry backoff, and in `libofcongress_get_newspaper_page` the OCR fetch. Why: the MCP TypeScript SDK client gives up at 60 seconds, and a fixed per-request timeout retried several times (formerly 30 s × 4 attempts, about two minutes) outlasts it, so the caller saw only the client's own `Request timed out` and no recovery. With one budget, an attempt may run until the budget ends, and expiry ends the retry ladder instead of re-sending the query.

- Expiry surfaces as `request_timed_out` with a tool-specific recovery (how to narrow that tool's request). The message names the upstream only, never a URL or host.
- The response body is read under the same budget, so a body that stalls after its headers is aborted.
- Raw network faults (socket reset, DNS failure) still retry while budget remains; 429, HTML soft-block, and 5xx still fail fast. A ladder that exhausts its attempts, and a 200 body that will not parse or parses to something other than a JSON object, fail as `upstream_unavailable` naming the upstream only. Why one reason for every outage shape: the caller's next move is the same for all of them (retry later), and the transport text a fault carries can name the host.
- A caller cancel stays a cancel, never a timeout.

### A `limit` past the per-call cap is served, not rejected

`limit` accepts up to 1000 on all four list tools. Past the per-call cap — 100 per page on the three paged tools, 50 headings on `libofcongress_search_subjects` — the call serves one capped page and discloses it on both surfaces (`effectiveLimit` and a notice). Why: a caller asking for more than fits has one obvious reading, so a rejection costs a round trip and returns nothing; 1000 stays as the hard bound on absurd input. LOC itself honors `c=150`, so 100 is this server's own bound on response size, and paging math (`pages`, `has_next`, the page-1000 retrieval ceiling) follows the served page size. A response can raise more than one notice (the clamp plus an empty-result, out-of-range, or ceiling notice); the handlers combine them in order rather than letting the last one overwrite the rest.

### No LC Linked Data authority record detail

The `id.loc.gov/{id}.json` endpoint returns JSON-LD with full authority structure (broader terms, variant labels, classification codes). This is genuinely useful for semantic discovery — but the JSON-LD is verbose and complex to parse. Decision: **exclude for v0.1**. `libofcongress_search_subjects` returns labels and URIs; that's enough to fuel `libofcongress_search_items` filters. The authority detail tool can be added if demand emerges.

### No audio/video content

Sound recordings and films return metadata only (title, contributors, subjects, dates). No audio/video binary streaming — agents can't consume it, and the file links in `resources` are sufficient for human followup. No special handling needed; these items appear in `libofcongress_search_items` results with their metadata.

---

## Known Limitations

- **OCR quality is variable.** Historical newspaper OCR can be garbled, especially for 19th-century papers or degraded materials. Fragments like `"Hil_e"` and `"Alubumt"` appear in real results. The server surfaces text as-is.
- **Rate limit is tight.** 20 req/min on the main LOC API means multi-step workflows (search → item → item → item) hit limits quickly. `www.loc.gov` requests start at least ~3.1 s apart in arrival order, so parallel calls queue rather than run together, and a call that would wait past its budget fails as `server_busy`. Agents should prefer broader searches over repeated narrow ones, and call one at a time.
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
- `dates={start}/{end}` — date range filter (e.g., `dates=1918/1919`); `/newspapers/` honors `YYYY-MM` and `YYYY-MM-DD` bounds, `/search/` years only
- `c={n}` — results per page (default 25, max recommended 1000)
- `sp={n}` — page number (1-indexed)
- `sb={field}` — sort: `date`, `date_desc`, `title_s`, `title_s_desc`
- `at={attributes}` — subset response (e.g., `at=results,pagination`); `facets` adds the top 10 values of each of ten facet types (subject, location, partof, contributor, language, original-format, online-format, dates, digitized, access-restricted), each with `value`, `count`, `title`, and `on`/`off`/`not` links

**Format slugs:** `newspapers`, `photos`, `maps`, `manuscripts`, `audio`, `film-and-videos`, `books`, `notated-music`

**Item endpoint:** `https://www.loc.gov/item/{id}/?fo=json&at=item,resources,related_items`

**Resource endpoint:** `https://www.loc.gov/resource/{id}/?fo=json&at=item,resource,fulltext_service` — `resource` alone carries only the resource pointers (`fulltext_file`, `segment_count`, `image`, `pdf`, IIIF manifest); `item` adds the publication metadata; `fulltext_service` is the text-service URL for the requested `sp`

**Error shape** (404): `{ "exception": "not found", "status": "not found", ... }` — HTTP 404 with JSON body.

### LC Linked Data

**Subject suggest:** `https://id.loc.gov/authorities/subjects/suggest2/?q={term}&searchtype=keyword&count={n}`
- Scoped to the subjects scheme by path; every hit is an `/authorities/subjects/` record
- `searchtype=keyword` ranks by relevance (`sortmethod: rank`); omitting it searches left-anchored, sorted alphabetically
- `count` is the page size (upstream maximum 250); `offset` is 1-based
- Response shape: `{ q, count, pagesize, start, sortmethod, searchtype, directory, hits[] }` — `count` is the total number of matching authority records; each hit carries `suggestLabel`, `aLabel` (the authorized heading), `uri`, `token`, `rank`, and a `more` block (variant labels, broader terms, collections)
- About 1.2 KB per hit

**Rate limits:** None published. Polite use recommended.
