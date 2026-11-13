/**
 * @fileoverview `/newspapers/` search responses captured from www.loc.gov (`fo=json`), trimmed to
 * the first records and to the fields the search normalizer reads; a facet block keeps the facet
 * types named in its body's comment. Each body names the query and the `dates`/`fa` it answered.
 * @module tests/fixtures/loc-newspaper-search
 */

/** `q=boston&dates=0000/1769` — the open-start range: pre-1770 pages, 1,075 matches. */
export const BOSTON_THROUGH_1769 = JSON.stringify({
  results: [
    {
      url: 'https://www.loc.gov/resource/sn83025582/1768-04-22/ed-1/?sp=2&q=boston',
      title:
        'Image 2 of The New-Hampshire gazette and historical chronicle (Portsmouth, N.H.), April 22, 1768',
      date: '1768-04-22',
      description: [
        'Last Wek arviwed at Bofion the Captains Dawier Skilitng Fenkins Freeman all from London L O N D O NJaduary 26 By some late adviges from Paris we are informed sh',
      ],
      location: [
        'rockingham',
        'greenland',
        'new hampshire',
        'rockingham county',
        'united states',
        'portsmouth',
      ],
      location_state: ['new hampshire'],
      partof_title: [
        'the new-hampshire gazette and historical chronicle (portsmouth, n.h.) 1763-1776',
      ],
    },
    {
      url: 'https://www.loc.gov/resource/sn83025582/1769-02-03/ed-1/?sp=3&q=boston',
      title:
        'Image 3 of The New-Hampshire gazette and historical chronicle (Portsmouth, N.H.), February 3, 1769',
      date: '1769-02-03',
      description: [
        '3 B O ST ON Januay 26 v LAT Night was fennight arrived at New York X 4 thePacket Capt Jefferies in 7 Weeks and Days from London The Mails are to the Igth of Nov',
      ],
      location: [
        'rockingham',
        'greenland',
        'new hampshire',
        'rockingham county',
        'united states',
        'portsmouth',
      ],
      location_state: ['new hampshire'],
      partof_title: [
        'the new-hampshire gazette and historical chronicle (portsmouth, n.h.) 1763-1776',
      ],
    },
  ],
  pagination: { current: 1, from: 1, of: 1075, perpage: 3, results: '1 - 3', to: 3, total: 359 },
});

/** `q=titanic&dates=1912-04-16/1912-04-16` — a single issue date: 280 matches. */
export const TITANIC_1912_04_16 = JSON.stringify({
  results: [
    {
      url: 'https://www.loc.gov/resource/sn82014248/1912-04-16/ed-1/?sp=12&q=titanic',
      title: 'Image 12 of Daily Kennebec journal (Augusta, Me.), April 16, 1912',
      date: '1912-04-16',
      description: [
        'WARRANT ISSUED IN THE LYNN MURDER CASE Continued from Page One Moss left Stockton about four welts ago His aunt Miss Orpha Marsh adopted daughter of the late Ja',
      ],
      location: ['augusta', 'maine', 'united states', 'kennebec county'],
      location_state: ['maine'],
      partof_title: ['daily kennebec journal (augusta, me.) 1870-1975 [microfilm reel]'],
    },
    {
      url: 'https://www.loc.gov/resource/sn87065167/1912-04-16/ed-1/?sp=4&q=titanic',
      title: 'Image 4 of The Hattiesburg news (Hattiesburg, Miss.), April 16, 1912',
      date: '1912-04-16',
      description: [
        'THE HATTIESBURG NEWS Published Every Afternoon Except Sunday Entered a secondclass matter on May 22 1907 at the postoffice at Hat tieaburg Mias under the Act of',
      ],
      location: ['forrest', 'united states', 'mississippi', 'perry', 'hattiesburg'],
      location_state: ['mississippi'],
      partof_title: ['the hattiesburg news (hattiesburg, miss.) 1908-1917'],
    },
  ],
  pagination: { current: 1, from: 1, of: 280, perpage: 3, results: '1 - 3', to: 3, total: 94 },
});

/** `q=titanic&dates=1912/1912&fa=location_state:washington` — Washington-state titles only: 477. */
export const TITANIC_1912_WASHINGTON_STATE = JSON.stringify({
  results: [
    {
      url: 'https://www.loc.gov/resource/sn87093407/1912-04-16/ed-1/?sp=1&q=titanic',
      title: 'Image 1 of The Seattle star (Seattle, Wash.), April 16, 1912',
      date: '1912-04-16',
      description: [
        'po You linow How It Feels to Face Death on One of Worlds Mightiest Steamships V FREO jnu ths Olympie sister ship to th Titanic from South Verk laborad for days ',
      ],
      location: ['united states', 'seattle', 'washington', 'king'],
      location_state: ['washington'],
      partof_title: ['the seattle star (seattle, wash.) 1899-1947'],
    },
    {
      url: 'https://www.loc.gov/resource/sn88085187/1912-04-16/ed-1/?sp=1&q=titanic',
      title: 'Image 1 of The Tacoma times (Tacoma, Wash.), April 16, 1912',
      date: '1912-04-16',
      description: [
        'Plrt fOT BUPP rtin Wln ad Wg BUi n asayTsira m m HOME EDITION J _s_rijrf lUJt Mother Jones tells about her _ halt Irs for labor on page tndoy VOL IX NO 100 ASTO',
      ],
      location: ['washington', 'united states', 'pierce', 'tacoma'],
      location_state: ['washington'],
      partof_title: ['the tacoma times (tacoma, wash.) 1903-1949'],
    },
  ],
  pagination: { current: 1, from: 1, of: 477, perpage: 3, results: '1 - 3', to: 3, total: 159 },
});

/**
 * `q=titanic&dates=1912/1912&fa=partof_title:new-york tribune` — a shortened title matches
 * nothing: `of` 0, though LOC still reports `total` 1.
 */
export const TITANIC_1912_SHORT_TITLE_EMPTY = JSON.stringify({
  results: [],
  pagination: { current: 1, from: 0, of: 0, perpage: 1, results: '0 - 0', to: 0, total: 1 },
});

/**
 * `q=lusitania&dates=1915-05-07/1915-05-09&at=results,pagination,facets&c=100` — 609 matches.
 * Of LOC's 19 facet types, kept: the three the newspaper filters take (`partof_title`,
 * `location_state`, `language`, each whole and in LOC order) and `subject_ethnicity`, whose
 * `german` value is not a language. Each facet value keeps `value`, `count`, and display `title`.
 */
export const LUSITANIA_1915_FACETS = JSON.stringify({
  results: [
    {
      url: 'https://www.loc.gov/resource/sn82014248/1915-05-08/ed-1/?sp=4&q=lusitania',
      title: 'Image 4 of Daily Kennebec journal (Augusta, Me.), May 8, 1915',
      date: '1915-05-08',
      description: [
        'BRITISH STR TRANSYLVANIA SAILS FROM N Y WITHIN FEW HOURS OF DISASTER 1 ___ New York Alay 7The British steamer Transylvania of the Anchor Line sailed late today ',
      ],
      location_state: ['maine'],
      partof_title: ['daily kennebec journal (augusta, me.) 1870-1975 [microfilm reel]'],
      language: ['english'],
    },
    {
      url: 'https://www.loc.gov/resource/sn82014248/1915-05-08/ed-1/?sp=12&q=lusitania',
      title: 'Image 12 of Daily Kennebec journal (Augusta, Me.), May 8, 1915',
      date: '1915-05-08',
      description: [
        'ROYAL BAKING POWDER Absolutely Pure No Alum No Lime Phosphate LAWRENCE HIGH WINS THIRD STRAIGHT VICTORY Fairfield Me May 7SpecialLaw rence high school nine won ',
      ],
      location_state: ['maine'],
      partof_title: ['daily kennebec journal (augusta, me.) 1870-1975 [microfilm reel]'],
      language: ['english'],
    },
  ],
  pagination: { current: 1, from: 1, of: 609, perpage: 100, results: '1 - 100', to: 100, total: 7 },
  facets: [
    {
      type: 'partof_title',
      title: 'Title',
      filters: [
        {
          value:
            'world war history : daily records and comments as appeared in american and foreign newspapers, 1914-1926 (new york) 1928-',
          count: 153,
          title:
            'World War History : Daily Records and Comments as Appeared in American and Foreign Newspapers, 1914 to 1926 (New York) 1928',
        },
        {
          value: 'evening star (washington, d.c.) 1854-1972',
          count: 23,
          title: 'Evening Star (Washington, D.C.) 1854 to 1972',
        },
        {
          value: 'new-york tribune (new york [n.y.]) 1866-1924',
          count: 21,
          title: 'New-York Tribune (New York [N.Y.]) 1866 to 1924',
        },
        {
          value: 'the montgomery advertiser (montgomery, ala.) 1885-1982',
          count: 21,
          title: 'The Montgomery Advertiser (Montgomery, Ala.) 1885 to 1982',
        },
        {
          value: 'the birmingham age-herald (birmingham, ala.) 1902-1950',
          count: 18,
          title: 'The Birmingham Age-Herald (Birmingham, Ala.) 1902 to 1950',
        },
        {
          value: 'the washington times (washington [d.c.]) 1902-1939',
          count: 13,
          title: 'The Washington Times (Washington [D.C.]) 1902 to 1939',
        },
        {
          value: 'the sun (new york [n.y.]) 1833-1916',
          count: 12,
          title: 'The Sun (New York [N.Y.]) 1833 to 1916',
        },
        {
          value: 'the washington herald (washington, d.c.) 1906-1939',
          count: 11,
          title: 'The Washington Herald (Washington, D.C.) 1906 to 1939',
        },
        {
          value: 'omaha daily bee (omaha [neb.]) 187?-1922',
          count: 9,
          title: 'Omaha Daily Bee (Omaha [Neb.]) 187?-1922',
        },
        {
          value: 'the daily telegram (clarksburg, w. va.) 1901-1926',
          count: 9,
          title: 'The Daily Telegram (Clarksburg, W. Va.) 1901 to 1926',
        },
      ],
    },
    {
      type: 'location_state',
      title: 'State/Province',
      filters: [
        { value: 'new york', count: 191, title: 'New York' },
        { value: 'district of columbia', count: 47, title: 'District of Columbia' },
        { value: 'alabama', count: 39, title: 'Alabama' },
        { value: 'texas', count: 22, title: 'Texas' },
        { value: 'illinois', count: 20, title: 'Illinois' },
        { value: 'west virginia', count: 20, title: 'West Virginia' },
        { value: 'connecticut', count: 19, title: 'Connecticut' },
        { value: 'north dakota', count: 17, title: 'North Dakota' },
        { value: 'iowa', count: 16, title: 'Iowa' },
        { value: 'nebraska', count: 14, title: 'Nebraska' },
      ],
    },
    {
      type: 'subject_ethnicity',
      title: 'Ethnicity',
      filters: [
        { value: 'german', count: 5, title: 'German' },
        { value: 'polish', count: 4, title: 'Polish' },
        { value: 'italian', count: 2, title: 'Italian' },
      ],
    },
    {
      type: 'language',
      title: 'Language',
      filters: [
        { value: 'english', count: 498, title: 'English' },
        { value: 'german', count: 52, title: 'German' },
        { value: 'polish', count: 4, title: 'Polish' },
        { value: 'spanish', count: 4, title: 'Spanish' },
        { value: 'italian', count: 2, title: 'Italian' },
        { value: 'lithuanian', count: 2, title: 'Lithuanian' },
      ],
    },
  ],
});

/**
 * The same search with `fa=language:german` — 71 matches, every row tagged `german`, a bilingual
 * page tagged `english` too. The three filter facets narrow to the filtered set. Rows 1 and 3 of
 * the page.
 */
export const LUSITANIA_1915_GERMAN = JSON.stringify({
  results: [
    {
      url: 'https://www.loc.gov/resource/sn83045474/1915-05-08/ed-1/?sp=1&q=lusitania',
      title: 'Image 1 of Tägliches Cincinnatier volksblatt (Cincinnati [Ohio]), May 8, 1915',
      date: '1915-05-08',
      description: [''],
      location_state: ['ohio'],
      partof_title: ['tägliches cincinnatier volksblatt (cincinnati [ohio]) 1885-1919'],
      language: ['german'],
    },
    {
      url: 'https://www.loc.gov/resource/sn83045081/1915-05-08/ed-1/?sp=6&q=lusitania',
      title: 'Image 6 of Der Deutsche correspondent (Baltimore, Md.), May 8, 1915',
      date: '1915-05-08',
      description: [
        'tretcicrr wt in 8I8titnt tklbr vastoi rccitlroiio uint 8cct1pe 8iUs8 128 i8t snxzv 1t8 vnelctcU Opiiiu Alcnptiin nncIl nnIki urtiti81n tlLQcZrcncttlxilo 128 vci',
      ],
      location_state: ['maryland'],
      partof_title: ['der deutsche correspondent (baltimore, md.) 1841-1918'],
      language: ['english', 'german'],
    },
  ],
  pagination: { current: 1, from: 1, of: 71, perpage: 100, results: '1 - 71', to: 71, total: 1 },
  facets: [
    {
      type: 'partof_title',
      title: 'Title',
      filters: [
        {
          value:
            'world war history : daily records and comments as appeared in american and foreign newspapers, 1914-1926 (new york) 1928-',
          count: 47,
          title:
            'World War History : Daily Records and Comments as Appeared in American and Foreign Newspapers, 1914 to 1926 (New York) 1928',
        },
        {
          value: 'detroiter abend-post (detroit [mich.]) 18??-19??',
          count: 11,
          title: 'Detroiter Abend-Post (Detroit [Mich.]) 18??-19??',
        },
        {
          value: 'der deutsche correspondent (baltimore, md.) 1841-1918',
          count: 4,
          title: 'Der Deutsche Correspondent (Baltimore, Md.) 1841 to 1918',
        },
        {
          value: 'tägliches cincinnatier volksblatt (cincinnati [ohio]) 1885-1919',
          count: 4,
          title: 'Tägliches Cincinnatier Volksblatt (Cincinnati [Ohio]) 1885 to 1919',
        },
        {
          value: 'freie presse für texas (san antonio, tex.) 1865-1945',
          count: 3,
          title: 'Freie Presse Für Texas (San Antonio, Tex.) 1865 to 1945',
        },
        {
          value: 'tägliche omaha tribüne (omaha, nebr.) 1912-1926',
          count: 2,
          title: 'Tägliche Omaha Tribüne (Omaha, Nebr.) 1912 to 1926',
        },
      ],
    },
    {
      type: 'location_state',
      title: 'State/Province',
      filters: [
        { value: 'new york', count: 47, title: 'New York' },
        { value: 'michigan', count: 11, title: 'Michigan' },
        { value: 'maryland', count: 4, title: 'Maryland' },
        { value: 'ohio', count: 4, title: 'Ohio' },
        { value: 'texas', count: 3, title: 'Texas' },
        { value: 'nebraska', count: 2, title: 'Nebraska' },
      ],
    },
    {
      type: 'language',
      title: 'Language',
      filters: [
        { value: 'german', count: 71, title: 'German' },
        { value: 'english', count: 40, title: 'English' },
      ],
    },
  ],
});

/**
 * `q=lusitania&dates=1915-05-07/1915-05-09&fa=language:klingon` — a language LOC has no pages in:
 * `of` 0, and the facet block lists none of the three filter facets.
 */
export const LUSITANIA_1915_KLINGON_EMPTY = JSON.stringify({
  results: [],
  pagination: { current: 1, from: 0, of: 0, perpage: 100, results: '0 - 0', to: 0, total: 1 },
  facets: [
    {
      type: 'object-type',
      title: 'Display Level',
      filters: [
        { value: 'All', count: 0, title: 'All' },
        { value: 'Titles', count: 0, title: 'Titles' },
        { value: 'Issues', count: 0, title: 'Issues' },
        { value: 'Pages (Full Text)', count: 0, title: 'Pages (Full Text)' },
      ],
    },
    {
      type: 'dates',
      title: 'Date',
      filters: [{ value: 'DAY', count: 0, title: '1915-05-07/1915-05-09' }],
    },
  ],
});
