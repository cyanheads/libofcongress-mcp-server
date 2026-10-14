/**
 * @fileoverview id.loc.gov `/authorities/subjects/suggest2/` responses captured live, trimmed to the
 * first hits and to the hit fields the subject service reads (the per-hit `more` block is dropped).
 * The top-level fields are verbatim, so `count` is the upstream match total and `pagesize` the
 * page size the request asked for. Each export names the request it answered.
 * @module tests/fixtures/lc-subject-suggest
 */

/** `q=world war 1939&searchtype=keyword&count=50` — 1,341 matches; the base heading ranks first. */
export const WORLD_WAR_1939_KEYWORD = {
  q: 'world war 1939*',
  count: 1341,
  pagesize: 50,
  start: 1,
  sortmethod: 'rank',
  searchtype: 'keyword',
  directory: '/authorities/subjects/',
  hits: [
    {
      suggestLabel: 'World War, 1939-1945',
      uri: 'http://id.loc.gov/authorities/subjects/sh85148273',
      aLabel: 'World War, 1939-1945',
      vLabel: 'Second World War, 1939-1945',
      token: 'sh85148273',
      rank: '4983',
    },
    {
      suggestLabel: 'Romani Genocide, 1939-1945',
      uri: 'http://id.loc.gov/authorities/subjects/sh85148419',
      aLabel: 'Romani Genocide, 1939-1945',
      vLabel: '',
      token: 'sh85148419',
      rank: '2995',
    },
    {
      suggestLabel: 'World War, 1939-1945, on postage stamps',
      uri: 'http://id.loc.gov/authorities/subjects/sh93003336',
      aLabel: 'World War, 1939-1945, on postage stamps',
      vLabel: '',
      token: 'sh93003336',
      rank: '2697',
    },
    {
      suggestLabel: 'Reconstruction (1939-1951)',
      uri: 'http://id.loc.gov/authorities/subjects/sh85111866',
      aLabel: 'Reconstruction (1939-1951)',
      vLabel: '',
      token: 'sh85111866',
      rank: '1750',
    },
    {
      suggestLabel: 'Reconstruction (1914-1939)',
      uri: 'http://id.loc.gov/authorities/subjects/sh85111865',
      aLabel: 'Reconstruction (1914-1939)',
      vLabel: '',
      token: 'sh85111865',
      rank: '1387',
    },
  ],
};

/** `q=civil war&searchtype=keyword&count=50` — 488 matches; the exact heading `Civil war` ranks 10th. */
export const CIVIL_WAR_KEYWORD = {
  q: 'civil war*',
  count: 488,
  pagesize: 50,
  start: 1,
  sortmethod: 'rank',
  searchtype: 'keyword',
  directory: '/authorities/subjects/',
  hits: [
    {
      suggestLabel: 'Border States (U.S. Civil War)',
      uri: 'http://id.loc.gov/authorities/subjects/sh2006006444',
      aLabel: 'Border States (U.S. Civil War)',
      vLabel: '',
      token: 'sh2006006444',
      rank: '3436',
    },
    {
      suggestLabel: 'War of the Castilian Succession, 1475-1479',
      uri: 'http://id.loc.gov/authorities/subjects/sh2009009291',
      aLabel: 'War of the Castilian Succession, 1475-1479',
      vLabel: '',
      token: 'sh2009009291',
      rank: '3070',
    },
    {
      suggestLabel: 'Yugoslav War, 1991-1995',
      uri: 'http://id.loc.gov/authorities/subjects/sh93005149',
      aLabel: 'Yugoslav War, 1991-1995',
      vLabel: '',
      token: 'sh93005149',
      rank: '2650',
    },
    {
      suggestLabel: 'Unionists (United States Civil War)',
      uri: 'http://id.loc.gov/authorities/subjects/sh98003666',
      aLabel: 'Unionists (United States Civil War)',
      vLabel: '',
      token: 'sh98003666',
      rank: '2332',
    },
    {
      suggestLabel: 'Civil War Campaign Medal',
      uri: 'http://id.loc.gov/authorities/subjects/sh90004165',
      aLabel: 'Civil War Campaign Medal',
      vLabel: '',
      token: 'sh90004165',
      rank: '2332',
    },
    {
      suggestLabel: 'Kosovo War, 1998-1999',
      uri: 'http://id.loc.gov/authorities/subjects/sh99000446',
      aLabel: 'Kosovo War, 1998-1999',
      vLabel: '',
      token: 'sh99000446',
      rank: '2222',
    },
    {
      suggestLabel: 'Civil war in literature',
      uri: 'http://id.loc.gov/authorities/subjects/sh97007058',
      aLabel: 'Civil war in literature',
      vLabel: '',
      token: 'sh97007058',
      rank: '1961',
    },
    {
      suggestLabel: 'Soldiers and Sailors Monument (Portland, Me.)',
      uri: 'http://id.loc.gov/authorities/subjects/sh2009001090',
      aLabel: 'Soldiers and Sailors Monument (Portland, Me.)',
      vLabel: '',
      token: 'sh2009001090',
      rank: '1657',
    },
    {
      suggestLabel: 'Civil war in motion pictures',
      uri: 'http://id.loc.gov/authorities/subjects/sh2012000916',
      aLabel: 'Civil war in motion pictures',
      vLabel: '',
      token: 'sh2012000916',
      rank: '1568',
    },
    {
      suggestLabel: 'Civil war',
      uri: 'http://id.loc.gov/authorities/subjects/sh85026421',
      aLabel: 'Civil war',
      vLabel: 'Civil wars',
      token: 'sh85026421',
      rank: '1510',
    },
  ],
};

/** `q=aerial photography&searchtype=keyword&count=50` — 37 matches; `Aerial photography` first. */
export const AERIAL_PHOTOGRAPHY_KEYWORD = {
  q: 'aerial photography*',
  count: 37,
  pagesize: 50,
  start: 1,
  sortmethod: 'rank',
  searchtype: 'keyword',
  directory: '/authorities/subjects/',
  hits: [
    {
      suggestLabel: 'Aerial photography',
      uri: 'http://id.loc.gov/authorities/subjects/sh85101264',
      aLabel: 'Aerial photography',
      vLabel: '',
      token: 'sh85101264',
      rank: '4300',
    },
    {
      suggestLabel: 'Aerial photography in geography',
      uri: 'http://id.loc.gov/authorities/subjects/sh85001263',
      aLabel: 'Aerial photography in geography',
      vLabel: '',
      token: 'sh85001263',
      rank: '4016',
    },
    {
      suggestLabel: 'Aerial photography in agriculture',
      uri: 'http://id.loc.gov/authorities/subjects/sh85001254',
      aLabel: 'Aerial photography in agriculture',
      vLabel: '',
      token: 'sh85001254',
      rank: '2590',
    },
  ],
};

/** `q=aerial photog&searchtype=keyword&count=50` — a partial word: no keyword match. */
export const AERIAL_PHOTOG_KEYWORD = {
  q: 'aerial photog*',
  count: 0,
  pagesize: 50,
  start: 1,
  sortmethod: 'rank',
  searchtype: 'keyword',
  directory: '/authorities/subjects/',
  hits: [],
};

/** `q=aerial photog&count=50` (left-anchored, the default search type) — 45 matches, alphabetical. */
export const AERIAL_PHOTOG_LEFT_ANCHORED = {
  q: 'aerial photog',
  count: 45,
  pagesize: 50,
  start: 1,
  sortmethod: 'alpha',
  searchtype: 'left-anchored',
  directory: '/authorities/subjects/',
  hits: [
    {
      suggestLabel: 'Aerial photogrammetry',
      uri: 'http://id.loc.gov/authorities/subjects/sh85001251',
      aLabel: 'Aerial photogrammetry',
      vLabel: '',
      token: 'sh85001251',
      rank: '',
    },
    {
      suggestLabel: 'Aerial photogrammetry--Abstracts',
      uri: 'http://id.loc.gov/authorities/subjects/sh2007004263',
      aLabel: 'Aerial photogrammetry--Abstracts',
      vLabel: '',
      token: 'sh2007004263',
      rank: '',
    },
    {
      suggestLabel: 'Aerial photogrammetry--Abstracts--Periodicals',
      uri: 'http://id.loc.gov/authorities/subjects/sh2007004264',
      aLabel: 'Aerial photogrammetry--Abstracts--Periodicals',
      vLabel: '',
      token: 'sh2007004264',
      rank: '',
    },
  ],
};

/** `q=civil war&count=10` (left-anchored) — 24 matches; the fifth hit is a cross-reference whose `suggestLabel` is the variant and whose `aLabel` is the authorized heading. */
export const CIVIL_WAR_LEFT_ANCHORED = {
  q: 'civil war',
  count: 24,
  pagesize: 10,
  start: 1,
  sortmethod: 'alpha',
  searchtype: 'left-anchored',
  directory: '/authorities/subjects/',
  hits: [
    {
      suggestLabel: 'Civil war',
      uri: 'http://id.loc.gov/authorities/subjects/sh85026421',
      aLabel: 'Civil war',
      vLabel: 'Civil wars',
      token: 'sh85026421',
      rank: '',
    },
    {
      suggestLabel: 'Civil War Campaign Medal',
      uri: 'http://id.loc.gov/authorities/subjects/sh90004165',
      aLabel: 'Civil War Campaign Medal',
      vLabel: '',
      token: 'sh90004165',
      rank: '',
    },
    {
      suggestLabel: 'Civil war in literature',
      uri: 'http://id.loc.gov/authorities/subjects/sh97007058',
      aLabel: 'Civil war in literature',
      vLabel: '',
      token: 'sh97007058',
      rank: '',
    },
    {
      suggestLabel: 'Civil war in motion pictures',
      uri: 'http://id.loc.gov/authorities/subjects/sh2012000916',
      aLabel: 'Civil war in motion pictures',
      vLabel: '',
      token: 'sh2012000916',
      rank: '',
    },
    {
      suggestLabel:
        'Civil War Memorial (Portland, Me.) (USE Soldiers and Sailors Monument (Portland, Me.))',
      uri: 'http://id.loc.gov/authorities/subjects/sh2009001090',
      aLabel: 'Soldiers and Sailors Monument (Portland, Me.)',
      vLabel: 'Civil War Memorial (Portland, Me.)',
      token: 'sh2009001090',
      rank: '',
    },
    {
      suggestLabel: 'Civil war--Protection of civilians',
      uri: 'http://id.loc.gov/authorities/subjects/sh2001007505',
      aLabel: 'Civil war--Protection of civilians',
      vLabel: '',
      token: 'sh2001007505',
      rank: '',
    },
    {
      suggestLabel: 'Civil war--Religious aspects',
      uri: 'http://id.loc.gov/authorities/subjects/sh2003005334',
      aLabel: 'Civil war--Religious aspects',
      vLabel: '',
      token: 'sh2003005334',
      rank: '',
    },
    {
      suggestLabel: 'Civil war--Religious aspects--Christianity',
      uri: 'http://id.loc.gov/authorities/subjects/sh2020001593',
      aLabel: 'Civil war--Religious aspects--Christianity',
      vLabel: '',
      token: 'sh2020001593',
      rank: '',
    },
    {
      suggestLabel: 'Civil war--Religious aspects--Islam',
      uri: 'http://id.loc.gov/authorities/subjects/sh2020001594',
      aLabel: 'Civil war--Religious aspects--Islam',
      vLabel: '',
      token: 'sh2020001594',
      rank: '',
    },
  ],
};
