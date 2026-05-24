/**
 * @fileoverview Domain types for the LC Linked Data service (id.loc.gov).
 * @module services/lc-linked-data/types
 */

/** Normalized LCSH subject heading record */
export type LcSubjectHeading = {
  label: string;
  uri: string;
  count?: number;
};
