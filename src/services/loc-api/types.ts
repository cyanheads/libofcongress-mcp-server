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
  /** State-level location facet (e.g. "new york (state)") — more precise than location[] for newspapers */
  location_state?: string[];
  language?: string[];
  /** Canonical publication title for Chronicling America results (e.g. "The Evening World") */
  partof_title?: string[];
  /** Hierarchy of containing collections/publications */
  partof?: string[];
  /** Number of digitized items */
  item?: Record<string, unknown>;
};

/** Raw pagination object from LOC search responses */
export type RawLocPagination = {
  from?: number;
  to?: number;
  total?: number;
  perpage?: number;
  results?: number;
  page?: number;
  last?: number;
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

/** Raw LOC item detail response */
export type RawLocItemResponse = {
  item?: {
    id?: string;
    title?: string | string[];
    date?: string;
    created_published?: string | string[];
    contributor?: string[];
    subject?: string[];
    notes?: string[];
    rights?: string | string[];
    rights_information?: string | string[];
    medium?: string | string[];
    physical_description?: string | string[];
    summary?: string | string[];
    language?: string[];
    location?: string[];
    related_items?: string[];
    url?: string;
    other_title?: string[];
    number_former_id?: string[];
    call_number?: string[];
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
  related_items?: Array<{
    id?: string;
    title?: string;
    url?: string;
  }>;
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
};

/** Normalized full item record */
export type LocItemDetail = {
  item_id: string;
  title: string;
  date?: string;
  contributors: string[];
  subject_headings: string[];
  notes: string[];
  rights_information?: string;
  physical_description?: string;
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
  state?: string;
  newspaper_title?: string;
};

/** Normalized newspaper page full detail */
export type LocNewspaperPageDetail = {
  page_url: string;
  newspaper_title?: string;
  date?: string;
  state?: string;
  edition?: string;
  sequence?: number;
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
