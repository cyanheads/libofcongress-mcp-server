/**
 * @fileoverview US postal codes mapped to the lowercase names LOC's `location_state` facet carries.
 * @module services/loc-api/state-names
 */

/**
 * Postal code → `location_state` value: the 50 states, the District of Columbia, and the two
 * territories that hold Chronicling America titles (Puerto Rico, the U.S. Virgin Islands). Other
 * territory codes pass through unmapped.
 */
const STATE_NAMES = new Map<string, string>([
  ['al', 'alabama'],
  ['ak', 'alaska'],
  ['az', 'arizona'],
  ['ar', 'arkansas'],
  ['ca', 'california'],
  ['co', 'colorado'],
  ['ct', 'connecticut'],
  ['de', 'delaware'],
  ['dc', 'district of columbia'],
  ['fl', 'florida'],
  ['ga', 'georgia'],
  ['hi', 'hawaii'],
  ['id', 'idaho'],
  ['il', 'illinois'],
  ['in', 'indiana'],
  ['ia', 'iowa'],
  ['ks', 'kansas'],
  ['ky', 'kentucky'],
  ['la', 'louisiana'],
  ['me', 'maine'],
  ['md', 'maryland'],
  ['ma', 'massachusetts'],
  ['mi', 'michigan'],
  ['mn', 'minnesota'],
  ['ms', 'mississippi'],
  ['mo', 'missouri'],
  ['mt', 'montana'],
  ['ne', 'nebraska'],
  ['nv', 'nevada'],
  ['nh', 'new hampshire'],
  ['nj', 'new jersey'],
  ['nm', 'new mexico'],
  ['ny', 'new york'],
  ['nc', 'north carolina'],
  ['nd', 'north dakota'],
  ['oh', 'ohio'],
  ['ok', 'oklahoma'],
  ['or', 'oregon'],
  ['pa', 'pennsylvania'],
  ['pr', 'puerto rico'],
  ['ri', 'rhode island'],
  ['sc', 'south carolina'],
  ['sd', 'south dakota'],
  ['tn', 'tennessee'],
  ['tx', 'texas'],
  ['ut', 'utah'],
  ['vt', 'vermont'],
  ['va', 'virginia'],
  ['vi', 'virgin islands'],
  ['wa', 'washington'],
  ['wv', 'west virginia'],
  ['wi', 'wisconsin'],
  ['wy', 'wyoming'],
]);

/** The lowercase `location_state` value for a state name or a two-letter postal code. */
export function locationStateName(state: string): string {
  const name = state.trim().toLowerCase();
  return STATE_NAMES.get(name) ?? name;
}
