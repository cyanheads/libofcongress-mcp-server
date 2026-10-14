/**
 * @fileoverview Upstream text captured live (2026-10-14) for the text-normalization and rendering
 * tests: search rows, collection rows, and item fields that carry HTML character references or
 * markup, newspaper notes with literal catalog brackets, an OCR excerpt with stray `<`, and an
 * id.loc.gov suggest page whose labels hold a raw `&`. Search and collection rows are cut to the
 * fields the normalizer reads; every string is LOC's own.
 * @module tests/fixtures/loc-text
 */

/** `/search/?q=jazz&fo=json&c=100` rows 13, 31, and 32: descriptions with named, decimal, and hex references. */
export const JAZZ_ENTITY_ROWS = [
  {
    id: 'https://blogs.loc.gov/music/2010/05/shanghai-jazz/',
    title: 'Shanghai Jazz',
    date: '2010-05-14',
    description: [
      '&nbsp; Thanks to Senior Music Specialist Larry Appelbaum for this post. Chinese jazz singers Le Zhang and Coco Zhao recently visited the Music Division, where they were given an overview of the Library&#8217;s jazz collections by Senior Music Specialist Larry Appelbaum. They were especially taken by the scores of Charles Mingus and Gerry Mulligan, the &hellip;',
    ],
    original_format: ['web page'],
    online_format: ['online text', 'web page'],
    url: 'https://blogs.loc.gov/music/2010/05/shanghai-jazz/',
  },
  {
    id: 'https://blogs.loc.gov/loc/2014/01/all-that-jazz/',
    title: 'All That Jazz',
    date: '2014-01-31',
    description: [
      'Jazz&#8217;s greatest drummer once earned D&#8217;s in music in school, once wrote an essay entitled &#8220;I Hate Jazz&#8221; and once even launched a venture to break into the soft-drink market. The Library of Congress on Monday announced the acquisition of the papers of Max Roach, the groundbreaking drummer who helped birth bebop, the adventurous musician &hellip;',
    ],
    original_format: ['web page'],
    online_format: ['online text', 'web page'],
    url: 'https://blogs.loc.gov/loc/2014/01/all-that-jazz/',
  },
  {
    id: 'https://blogs.loc.gov/nls-music-notes/2017/01/le-jazz-hot/',
    title: 'Le Jazz Hot!',
    date: '2017-01-26',
    description: [
      'It&#8217;s always interesting to check the date for famous birthdays or events and see where reflections will lead.&#xA0; Today, January 26, is the birthday of St&#xE8;phane Grappelli, French jazz violinist. That&#8217;s right, violinists can be jazz musicians, and once you hear a sample, you&#8217;ll start appreciating, and I hope, admiring the style.&#xA0; In fact, stringed &hellip;',
    ],
    original_format: ['web page'],
    online_format: ['online text', 'web page'],
    url: 'https://blogs.loc.gov/nls-music-notes/2017/01/le-jazz-hot/',
  },
];

/** `item.rights` of manuscript `mm77093930` (no `rights_information`): HTML with a relative and an absolute link, CRLF line ends. */
export const MANUSCRIPT_RIGHTS_MM77093930 = [
  '<p>The contents of the Library of Congress Betty Herndon Maury Maury collection are in the public domain and are free to use and reuse.</p>\r\n<p>Credit Line: Library of Congress, Manuscript Division, Betty Herndon Maury Maury Diary.</p>\r\n<p>More about <a href="/legal/">Copyright and other Restrictions</a>.</p>\r\n<p>For guidance about compiling full citations consult <a href="https://www.loc.gov/teachers/usingprimarysources/citing.html">Citing  Primary Sources</a>.</p>\r\n',
];

/** `item.rights` of map `98688514`: `<strong>` markup and two relative links. */
export const MAP_RIGHTS_98688514 = [
  '<p><strong>The content of the Library of Congress Geography and Map Division digitized collections is free to use and reuse unless a Rights Advisory statement is present that indicates otherwise.</strong></p>\n<p>Credit Line: Library of Congress, Geography and Map Division.</p>\n<p>More about <a href="/legal/">Copyright and other Restrictions</a>.</p>\n<p>For guidance about compiling full citations consult <a href="/programs/teachers/getting-started-with-primary-sources/citing/">Citing Primary Sources</a>.</p>\n',
];

/** `item.rights` of newspaper issue `sn83030214/1912-04-16/ed-1`: links whose text is their own URL. */
export const NEWSPAPER_RIGHTS_SN83030214 = [
  '<p>The Library of Congress believes that the newspapers in Chronicling America are in the public domain or have no known copyright restrictions.  Newspapers published in the United States more than 95 years ago are in the public domain in their entirety. Any newspapers in Chronicling America that were published less than 95 years ago are also believed to be in the public domain, but may contain some copyrighted third party materials. Researchers using newspapers published less than 95 years ago should be alert for modern content (for example, registered and renewed for copyright and published with notice) that may be copyrighted.  Responsibility for making an independent legal assessment of an item and securing any necessary permissions ultimately rests with persons desiring to use the item.</p>\n<p>The NEH awardee responsible for producing each digital object is presented in the Chronicling America page display, below the page image  – e.g. Image produced by the Library of Congress. For more information on current NDNP awardees, see <a href="https://www.loc.gov/ndnp/listawardees.html">https://www.loc.gov/ndnp/listawardees.html</a>.</p>\n<p>For more information on Library of Congress policies and disclaimers regarding rights and reproductions, see <a href="https://www.loc.gov/homepage/legal.html">https://www.loc.gov/homepage/legal.html</a></p>',
];

/** `item.notes` entries of newspaper issue `sn83030214/1912-04-16/ed-1` that hold catalog brackets around uncertain years. */
export const NEWSPAPER_NOTES_SN83030214 = [
  'Semiweekly ed.: New-York tribune (New York, N.Y. : 1866 : Semiweekly), 1866-<1899>.',
  'Triweekly eds.: New-York tri-weekly tribune, <1900>-1903, and: New York tribune (New York, N.Y. : 1903), 1903-<1909>.',
  'Weekly ed.: New-York tribune (New York, N.Y. : 1866 : Weekly), 1866-<1906>.',
];

/** `/collections/?fo=json&c=100` rows whose descriptions carry named references. */
export const COLLECTION_ENTITY_ROWS = [
  {
    title: 'Amazing Grace',
    description: [
      'This collection highlights the history of the hymn &ldquo;Amazing Grace&rdquo; from the earliest printing of the song to selected performances of it on published and field recordings. These items have been collected from several divisions in the Library of Congress, including the Music Division, the American Folklife Center, the Motion Picture, Broadcasting and Recorded Sound Division, and the Rare Books Division. Also available here is the Chasanoff/Elozua Amazing Grace Collection of data on published recorded performances of the hymn "Amazing Grace" by more than 3000 different musicians or ensembles. Since its creation in 1779 in England, "Amazing Grace" has grown in popularity to become one of the best-known hymns in America.',
    ],
    url: 'https://www.loc.gov/collections/amazing-grace/about-this-collection/',
    count: 51,
  },
  {
    title: 'Ballets Russes de Serge Diaghilev',
    description: [
      'The world of ballet changed dramatically when the Ballets Russes de Serge Diaghilev took Paris by storm at the Th&eacute;âtre du Châtelet in May of 1909. Armed with ground-breaking choreographic originality and an innovative use of collaborating artists, the Ballets Russes produced some of the most significant ballet masterpieces of the twentieth century, including Les Sylphides, Sch&eacute;h&eacute;razade, Firebird, Petrouchka, L’Apr&egrave;s-midi d’un Faune, Parade, Les Noces, Les Biches, and Apollon Musag&egrave;te.',
    ],
    url: 'https://www.loc.gov/collections/ballets-russes-de-serge-diaghilev/about-this-collection/',
    count: 193,
  },
];

/** `suggest2/?q=AT%26T&searchtype=keyword` from id.loc.gov, cut to the first three hits: labels carry a raw `&`. */
export const ATT_SUBJECT_SUGGEST = {
  count: 7,
  hits: [
    {
      aLabel: 'AT&T PC 6300 Plus (Computer)',
      uri: 'http://id.loc.gov/authorities/subjects/sh90001521',
    },
    {
      aLabel: 'AT&T PC 6300 (Computer)',
      uri: 'http://id.loc.gov/authorities/subjects/sh85009063',
    },
    {
      aLabel: 'AT&T WorldNet (Online service)',
      uri: 'http://id.loc.gov/authorities/subjects/sh98000247',
    },
  ],
};

/** An excerpt of the OCR text of `sn83030214/1912-04-16/ed-1` page 1: `p<ured` reads as an HTML tag in Markdown. */
export const TITANIC_OCR_EXCERPT =
  'Hundredp of telephone rails and tele\ngraphic Inquiries p<ured into the office?\nof the White Star Line in lower Broad?\nway last night, asking Informati';
