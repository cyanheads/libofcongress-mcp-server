/**
 * @fileoverview `/newspapers/` search responses captured from www.loc.gov (`fo=json`), trimmed to
 * the first records and to the fields the search normalizer reads. Each body names the query and
 * the `dates`/`fa` it answered.
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
