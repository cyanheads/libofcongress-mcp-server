---
name: libofcongress-guide
description: Follow collection, item, and page identifiers with libofcongress_* tools. Use for historical newspaper research, collection browsing, subject-led discovery, and reading book or manuscript pages when OCR availability and search coverage affect the conclusion.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.1"
---

## Scope

Use these tools for Library of Congress digital collections, Chronicling America newspaper pages, and Library of Congress Subject Headings (LCSH). They require no API key. A search result is a discovery lead: it may describe a digital item, a newspaper page, or an external resource rather than readable text.

## Identifiers

| Value | Obtain it from | Next hop |
|:------|:---------------|:---------|
| Collection slug | `libofcongress_browse_collections` | Scope `libofcongress_search_items` to the collection; never derive a slug from its title |
| Item ID | A `libofcongress_search_items` result with `is_item` true, or the `item_id` returned by `libofcongress_get_newspaper_page` | `libofcongress_get_item` |
| Page URL | `libofcongress_search_newspapers`, a newspaper row's `page_url` in `libofcongress_search_items`, or `pages[].page_url` in `libofcongress_get_item` | `libofcongress_get_newspaper_page`; do not construct page URLs |
| Subject label | `libofcongress_search_subjects` | Subject-filter `libofcongress_search_items` with the label, not the authority URI |
| Subject/location/contributor facet value | `subject_facets`, `location_facets`, and `contributor_facets` from `libofcongress_search_items` with `include_facets`; an item's `subject_terms` also supplies subject values, and a search row's or an item's `contributor_terms` supplies contributor values (an item's `contributors` carry dates and roles and match nothing) | Narrow the corresponding item search; a newspaper page or issue credits the institution that digitized it, not an author |
| Newspaper title, state, or language | The full `newspaper_title`, `states`, or `languages` of a `libofcongress_search_newspapers` row, or `newspaper_title_facets`, `state_facets`, and `language_facets` with `include_facets` | Restrict another newspaper search to that value; pass it unchanged |

## Gates

1. **Route the result before fetching.** An `is_item` false row is not a `libofcongress_get_item` target. Use its `page_url` when present for newspaper text. For other rows, inspect the URL and any link notice; a retired catalog link does not establish that the described resource is unavailable.
2. **Read the match before describing the article.** A newspaper search excerpt is the opening of the page, not the passage that matched. Retrieve matching passages before attributing claims to the hit.
3. **Check text state before interpreting a miss.** `ocr_available` describes digitization, not successful retrieval this call. An empty text response with a notice and absent match fields is not evidence of zero occurrences. Follow the notice's retry or image-reading guidance. An image-only page cannot establish textual absence either.
4. **Treat a literal miss as narrower than a search miss.** Page matching does not repair OCR or reproduce LOC's search matching. Try a variant spelling, fewer terms, or read the full page before excluding a plausible hit. Preserve OCR quotations as returned rather than silently correcting them.
5. **Check coverage before claiming completeness.** Follow search pagination and item page offsets. If a notice reports LOC's retrieval ceiling, partition the search by dates or other applicable filters. A single result page, an out-of-range response, or one text page does not exhaust the collection or volume.
6. **Separate indexed geography from publication place.** A newspaper's indexed states can include its circulation area. Use the retrieved page's `place_of_publication` when the question is where the newspaper was published.

## Core chain

Discover candidates → resolve the returned item or page identifier → inspect metadata and readable text → follow the item's page inventory when context or a continuation is needed. Keep the source URL, publication date, and publication title with the evidence you report.

## Workflows

### Find early reporting of an event

Use `libofcongress_search_newspapers` with a bounded date range and ascending date order. Relevance order does not establish the earliest report. Read candidate passages with `libofcongress_get_newspaper_page`, then omit passage matching when the full page is needed. For a continued article, pass the page's `item_id` to `libofcongress_get_item` and choose the continuation from its page inventory.

Passage matching reads space-separated words as independent terms; double quotes make one phrase. For example, `earthquake "san francisco"` finds either term, not necessarily both together. Matching is case-insensitive literal text with whitespace normalized. A search URL's query is not automatically used for passage matching. When a notice says some occurrences fall outside the returned passages, request the full page or narrow the terms.

### Explore a collection or subject

Resolve the collection with `libofcongress_browse_collections`, then search inside its returned slug. Use `"*"` to browse without a keyword, and combine collection scope with a material format when needed. Retrieve metadata only for item rows; route newspaper page rows to page text.

For subject-led discovery, resolve LCSH wording with `libofcongress_search_subjects`, or use facet terms already returned by an item search. Follow `next_offset` when more headings remain. A heading's subdivisions become subject terms that must all match; date qualifiers in the heading do not replace an explicit date filter.

### Read a book or manuscript

Use `libofcongress_get_item` to obtain the page inventory and follow `next_page_offset` until the relevant pages are listed. Read pages marked `has_text` with `libofcongress_get_newspaper_page`, despite that tool's newspaper name. A resource marked `has_transcription` holds one transcription of its whole document: any of its pages returns it, even with `has_text` false, and it is the same on every page (`text_scope` "document"), so read one page rather than each. Otherwise passage matching scans one page at a time; it does not search the whole volume. For citations, use the item's contributors, title, imprint, and cataloged date, retaining uncertainty when a field is absent.
