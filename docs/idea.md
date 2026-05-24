# libofcongress-mcp-server

MCP server for the Library of Congress digital collections — historical newspapers, photographs, maps, manuscripts, and more.

## Why

Primary historical sources. The Library of Congress holds millions of digitized items spanning US history: newspapers from the 1700s–1900s (Chronicling America), historical photographs, maps, legislative documents, recorded sound metadata, and manuscripts. No existing server covers culture, history, or primary-source research.

## Source

- **API:** Library of Congress JSON API (https://www.loc.gov/apis/)
- **Auth:** None
- **Rate limits:** Polite usage — no published hard limit, custom User-Agent recommended
- **Docs:** https://www.loc.gov/apis/json-and-yaml/

### Additional endpoints

| Endpoint | Docs | Description |
|---|---|---|
| Chronicling America | https://chroniclingamerica.loc.gov/about/api/ | Historical newspaper pages — OCR full text, page images |
| LC Linked Data | https://id.loc.gov/ | Authority records — subjects, names, genres, languages (LCSH, LCNAF) |

## Scope

### Core tools

| Tool | Description |
|---|---|
| `loc_search` | Search across all LOC digital collections — returns items with titles, dates, subjects, thumbnails |
| `loc_get_item` | Full metadata for a specific item by LOC ID — description, contributors, dates, related items, format details |
| `loc_search_newspapers` | Search Chronicling America — historical newspaper pages by keyword, date range, state, newspaper title |
| `loc_get_newspaper_page` | OCR text content of a specific newspaper page — the actual readable text |
| `loc_browse_collections` | List and browse LOC digital collections (e.g., "Baseball Cards", "Civil War Photographs") |
| `loc_search_subjects` | Search LC Subject Headings — the controlled vocabulary used to categorize items |

### Potential additions

- **`loc_get_newspaper_titles`** — browse available newspaper titles by state/date range
- **`loc_search_maps`** — search the map collection specifically (geographic, historical, military maps)
- **`loc_search_photos`** — search photographs and prints (FSA/OWI collection, Civil War, etc.)
- Authority record lookups via id.loc.gov (LCSH, LCNAF)

## Design notes

- The main LOC JSON API uses a URL-based query pattern: `https://www.loc.gov/search/?q=keyword&fo=json`. Collections, formats, and dates are query parameters.
- Chronicling America is a separate API with its own URL structure and search syntax. It returns OCR text per page — quality varies by source material age and condition.
- Items can be in many formats: text, image, audio, video, map, manuscript. Focus on text-accessible formats for agent utility. Image/audio items should return metadata and description, not binary content.
- The LOC collections are enormous and heterogeneous. Good filtering (by collection, date range, format, subject) is important to avoid overwhelming results.
- Subject headings (LCSH) are a powerful discovery tool — they're a controlled vocabulary that cross-references related topics. Worth exposing as a first-class tool.
