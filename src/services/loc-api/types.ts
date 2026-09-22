/**
 * @fileoverview Domain types for the LOC JSON API service.
 * @module services/loc-api/types
 */

/** Raw result item from LOC /search/ and format-specific endpoints */
export type RawLocSearchResult = {
  id?: string;
  url?: string;
  title?: string | string[];
  date?: string;
  description?: string | string[];
  original_format?: string[];
  online_format?: string[];
  subject?: string[];
  contributor?: string[];
  location?: string[];
  /**
   * State-level location facet (e.g. ["georgia", "south carolina"]) — more precise than
   * location[] for newspapers. Multi-valued: a title indexed against several states lists each.
   */
  location_state?: string[];
  language?: string[];
  /** Canonical publication title for Chronicling America results (e.g. "The Evening World") */
  partof_title?: string[];
  /** Hierarchy of containing collections/publications */
  partof?: string[];
  /**
   * Number of items in the collection, on /collections/ browse results. Distinct from the
   * nested `item.total` / `item.digitized`, which report different figures for the same
   * result — read `count` for a collection's size, never `item.*`.
   */
  count?: number;
  /** Per-result detail block (e.g. `total`, `digitized`); shape varies by endpoint */
  item?: Record<string, unknown>;
};

/** Raw pagination object from LOC search responses */
export type RawLocPagination = {
  from?: number;
  to?: number;
  /**
   * Total *page* count for the query — despite the name, NOT the item count. LOC's live
   * /search/, /newspapers/, and /collections/ envelopes report the item count in `of` and the
   * page count here (e.g. `of: 1_780_109`, `total: 17_802`, `perpage: 100`). Read `of` for the
   * result total; this only stands in when `of` is absent (mocked/legacy shapes).
   */
  total?: number;
  perpage?: number;
  /**
   * Display range for the current page ("1 - 3") despite the numeric-sounding name — LOC
   * sends a string on the /search/, /collections/, and /collections/{slug}/ endpoints.
   * Only stands in for a missing total when it is genuinely numeric.
   */
  results?: number | string;
  page?: number;
  last?: number | string;
  /** Total number of matching items ("… of 1,780,109") — the authoritative result count. */
  of?: number;
  pages?: number;
  next?: string;
  previous?: string;
};

/** Raw LOC search API response envelope */
export type RawLocSearchResponse = {
  results?: RawLocSearchResult[];
  pagination?: RawLocPagination;
  content?: {
    results?: RawLocSearchResult[];
    pagination?: RawLocPagination;
  };
};

/**
 * A related-record reference. LOC sends plain strings on some records and `{ title, url }`
 * (sometimes with `id`) objects on others — normalize with `relatedItemRef`.
 */
export type RawLocRelatedItem = string | { id?: string; url?: string; title?: string };

/** Raw LOC item detail response */
export type RawLocItemResponse = {
  item?: {
    id?: string;
    title?: string | string[];
    date?: string;
    created_published?: string | string[];
    /** Contributor names with roles (e.g. "Washington, George, 1732-1799 (Author)"). */
    contributor_names?: string[];
    subject?: string[];
    notes?: string[];
    rights?: string | string[];
    rights_information?: string | string[];
    medium?: string | string[];
    physical_description?: string | string[];
    summary?: string | string[];
    language?: string[];
    location?: string[];
    related_items?: RawLocRelatedItem[];
    url?: string;
    other_title?: string[];
    number_former_id?: string[];
    /** Scalar on some records, array on others — normalize with extractFirstString. */
    call_number?: string | string[];
    type?: string[];
    format?: string[];
    original_format?: string[];
    access_restricted?: boolean;
    online_format?: string[];
  };
  resources?: Array<{
    url?: string;
    caption?: string;
    image?: string;
    pdf?: string;
    files?: Array<
      Array<{ url?: string; mimeType?: string; size?: number; levels?: number; info?: string }>
    >;
  }>;
  related_items?: Array<Exclude<RawLocRelatedItem, string>>;
};

/**
 * Raw LOC newspaper page response under `?fo=json&at=item,resource`. `item` carries the issue's
 * publication metadata; `resource` carries the page-level pointers. Neither block carries the
 * page's sequence, and `resource` carries no date — both are derived from the page URL.
 */
export type RawLocNewspaperPageResponse = {
  item?: {
    /** Display-cased title (e.g. ["Southern Christian advocate"]). */
    newspaper_title?: string[];
    /** Lowercased title with place and run (e.g. ["southern christian advocate (charleston, s.c.) 1837-1948"]). */
    partof_title?: string[];
    location_state?: string[];
    /** Scalar on the records observed (e.g. "Charleston, S.C."). */
    place_of_publication?: string | string[];
    /** Edition number of the issue (e.g. ["1"]). */
    number_edition?: string[];
    date_issued?: string;
  };
  resource?: {
    url?: string;
    fulltext_file?: string;
    /** Number of pages (segments) in the issue. */
    segment_count?: number;
  };
};

/** Normalized item summary returned from search */
export type LocItemSummary = {
  id: string;
  title: string;
  date?: string;
  description?: string;
  format?: string;
  /**
   * True when this result is a catalog item whose `id` resolves through getItem.
   * False for collection landing pages and other non-item results, which are a
   * different LOC resource type with no `/item/` equivalent.
   */
  is_item: boolean;
  url: string;
};

/** Normalized pagination info */
export type LocPagination = {
  total: number;
  page: number;
  perPage: number;
  pages: number;
  hasNext: boolean;
  /**
   * True when the match set is larger than LOC will page through (~100,000 items): `pages`/
   * `hasNext` are capped to the retrieval ceiling, or the requested page already lies beyond it.
   * Handlers surface this as a recovery notice — partition by date/facet to reach the rest.
   */
  ceilingReached: boolean;
};

/** Normalized full item record */
export type LocItemDetail = {
  item_id: string;
  title: string;
  date?: string;
  contributors: string[];
  subject_headings: string[];
  notes: string[];
  summary?: string;
  rights_information?: string;
  physical_description?: string;
  call_number?: string;
  languages: string[];
  locations: string[];
  /** Superseded catalog identifiers, from the raw singular `number_former_id` key. */
  former_ids: string[];
  original_formats: string[];
  online_formats: string[];
  /** Whether LOC restricts access to the original. Absent when upstream omits it. */
  access_restricted?: boolean;
  resource_links: string[];
  related_items: string[];
  url: string;
};

/** Normalized newspaper page search result */
export type LocNewspaperPage = {
  url: string;
  title: string;
  description?: string;
  date?: string;
  /** Every state in LOC's location_state facet, in LOC order. Absent when LOC sends none. */
  states?: string[];
  newspaper_title?: string;
};

/** Normalized newspaper page full detail */
export type LocNewspaperPageDetail = {
  page_url: string;
  newspaper_title?: string;
  date?: string;
  /** Every state in LOC's location_state facet, in LOC order. Absent when LOC sends none. */
  states?: string[];
  place_of_publication?: string;
  edition?: string;
  sequence?: number;
  /** Number of pages in the issue. */
  segment_count?: number;
  ocr_text: string;
  ocr_available: boolean;
};

/** Normalized collection record */
export type LocCollection = {
  slug: string;
  title: string;
  description?: string;
  item_count?: number;
  url: string;
};
