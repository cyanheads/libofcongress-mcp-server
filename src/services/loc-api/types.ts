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
  /**
   * Per-result detail block (e.g. `total`, `digitized`); shape varies by endpoint. On item search
   * rows, `date` is the date as cataloged ("c1915 Feb. 19.") where the top-level `date` can be a
   * padded sort key ("1915-01-01").
   */
  item?: { date?: unknown; [key: string]: unknown };
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

/**
 * One facet of a search response under `at=…,facets`: its `type` (`subject`, `location`,
 * `partof`, …) and its top values, each with `value` (the filter value), `count` (matching items),
 * a display `title`, and `on`/`off`/`not` filter links.
 */
export type RawLocFacet = {
  type?: string;
  filters?: Array<{ value?: string; count?: number }>;
};

/** Raw LOC search API response envelope */
export type RawLocSearchResponse = {
  results?: RawLocSearchResult[];
  pagination?: RawLocPagination;
  /** Present only when the request's `at` names `facets`. */
  facets?: RawLocFacet[];
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
    /** On Prints & Photographs records, a padded sort key ("1936-01-01"); elsewhere the date as cataloged. */
    date?: string;
    /** The date as cataloged ("1936 Apr.", "1909-1911."); sent on Prints & Photographs records. */
    created_published_date?: string;
    created_published?: string | string[];
    /** Contributor names with roles (e.g. "Washington, George, 1732-1799 (Author)"). */
    contributor_names?: string[];
    /** Subject facet terms: lowercase heading components without dates (e.g. "civil war"). */
    subject?: string[];
    /** LCSH headings as cataloged (e.g. "United States--History--Civil War, 1861-1865"). */
    subject_headings?: string[];
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
  /**
   * The item's digital resources (a photo, a scanned volume, a recording). `files` holds one file
   * group per page, in page order: page N is addressed as `url` + `?sp=N`.
   */
  resources?: Array<{
    url?: string;
    caption?: string;
    /** Representative image. */
    image?: string;
    /** Whole-resource PDF. */
    pdf?: string;
    /** Audio stream (MP3) of a sound recording. */
    audio?: string;
    /**
     * One group per page: every derivative of that page (IIIF sizes, JP2, TIFF master, text).
     * A `text/plain` entry carries the page's text service; it may have no `url` of its own.
     */
    files?: Array<Array<{ url?: string; mimetype?: string; fulltext_service?: string }>>;
  }>;
  related_items?: Array<Exclude<RawLocRelatedItem, string>>;
};

/**
 * Raw LOC page response under `?fo=json&at=item,resource,fulltext_service`. `item` carries the
 * publication metadata; `resource` the page count; `fulltext_service` the page's text service.
 * Neither block carries the page's sequence, and `resource` carries no date — both are derived
 * from the page URL.
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
    /**
     * Not read: on books and manuscripts it is the whole volume's text file, the same for every
     * page; on newspaper pages it equals the top-level `fulltext_service`.
     */
    fulltext_file?: string;
    /** Number of pages (segments) in the issue. */
    segment_count?: number;
  };
  /**
   * Text-service URL for the requested page (`sp`), present under `at=…,fulltext_service` when
   * the page has OCR or transcribed text. Answers `{ "<segment>": { "full_text": "…" } }`.
   */
  fulltext_service?: string;
};

/**
 * Why a page with text returned none: `unavailable` — the text service failed, answered with an
 * HTML page, or the call ran out of time (a retry can help); `unparseable` — the service answered
 * with another body that is not its JSON text shape (a retry cannot).
 */
export type OcrMiss = 'unavailable' | 'unparseable';

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

/** One facet value of a search, with the number of matching items that carry it. */
export type LocFacetValue = { value: string; count: number };

/** The subject and location facets of a search, each LOC's top values. */
export type LocSearchFacets = { subject: LocFacetValue[]; location: LocFacetValue[] };

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
  /** LCSH headings as cataloged, from the raw `subject_headings`. */
  subject_headings: string[];
  /** Subject facet terms, from the raw `subject` — values the item search's subject filter matches. */
  subject_terms: string[];
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
  resources: LocItemResource[];
  /** The requested window of the item's pages, across every resource in order. */
  pages: LocItemPage[];
  /** Pages across every resource. */
  page_total: number;
  /** Offset of the page after this window. Absent when the window reaches the last page. */
  next_page_offset?: number;
  related_items: string[];
  url: string;
};

/** One digital resource of an item, e.g. a photo, a scanned volume, or a recording. */
export type LocItemResource = {
  url: string;
  page_count: number;
  image?: string;
  pdf?: string;
  audio?: string;
};

/** One page of an item resource. */
export type LocItemPage = {
  /** The page's `/resource/` URL — the resource URL plus `?sp=N`, bare for a one-page resource. */
  page_url: string;
  /** True when the page's file group carries a `text/plain` entry. */
  has_text: boolean;
  /** URL of every file of the page that has one. Present only when files were requested. */
  files?: string[];
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
