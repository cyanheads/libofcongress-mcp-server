/**
 * @fileoverview Item records and item-search rows captured live from www.loc.gov (2026-10-14,
 * 2026-10-15, and 2026-11-13).
 * Item records are `/item/{id}/?fo=json&at=item,resources,related_items` responses with the `item`
 * block cut to the fields the tests read and some file groups cut to a few representative entries;
 * resource keys and file-entry keys are LOC's own. Multi-page resources keep one captured file
 * group and repeat it for every page with the page number substituted, so each record carries
 * LOC's real page count.
 * @module tests/fixtures/loc-items
 */

type FileGroup = Array<Record<string, unknown>>;

/**
 * `count` file groups built from a captured `template` group: every occurrence of `token` (the
 * template page's own zero-padded number) becomes page N's number. Pages listed in `withoutText`
 * (1-based) drop their `text/plain` entry, as LOC sends untranscribed pages.
 */
function pageGroups(
  template: FileGroup,
  token: string,
  count: number,
  { firstNumber = 1, withoutText = [] }: { firstNumber?: number; withoutText?: number[] } = {},
): FileGroup[] {
  const json = JSON.stringify(template);
  return Array.from({ length: count }, (_, i) => {
    const group = JSON.parse(
      json.replaceAll(token, String(firstNumber + i).padStart(token.length, '0')),
    ) as FileGroup;
    return withoutText.includes(i + 1) ? group.filter((f) => f.mimetype !== 'text/plain') : group;
  });
}

/**
 * FSA photo `2017760320`: `item.date` is the padded sort key, `created_published_date` the cataloged
 * date. `contributor_names` holds the name with dates and role, `contributors` the same person in
 * the contributor facet's form (captured 2026-11-13).
 */
export const PHOTO_ITEM_2017760320 = {
  item: {
    title: 'Adobe farmhouse of rehabilitation client. Cimarron County, Oklahoma. Dust bowl',
    date: '1936-01-01',
    created_published_date: '1936 Apr.',
    contributor_names: ['Rothstein, Arthur, 1915-1985, photographer'],
    contributors: [
      {
        'rothstein, arthur': 'https://www.loc.gov/search/?fa=contributor:rothstein,+arthur&fo=json',
      },
    ],
    url: 'https://www.loc.gov/item/2017760320/',
  },
  resources: [
    {
      caption: 'digital file from original neg.',
      files: [
        [
          {
            height: 0,
            levels: 1,
            mimetype: 'image/tiff',
            size: 24150606,
            url: 'https://tile.loc.gov/storage-services/master/pnp/fsa/8b27000/8b27500/8b27547u.tif',
            width: 0,
          },
          {
            height: 0,
            levels: 1,
            mimetype: 'image/tiff',
            size: 48223646,
            url: 'https://tile.loc.gov/storage-services/master/pnp/fsa/8b27000/8b27500/8b27547a.tif',
            width: 0,
          },
          {
            height: 142,
            levels: 1,
            mimetype: 'image/jpeg',
            size: 4659,
            url: 'https://tile.loc.gov/storage-services/service/pnp/fsa/8b27000/8b27500/8b27547_150px.jpg',
            width: 150,
          },
          {
            height: 144,
            levels: 1,
            mimetype: 'image/gif',
            size: 17104,
            url: 'https://tile.loc.gov/storage-services/service/pnp/fsa/8b27000/8b27500/8b27547t.gif',
            width: 150,
          },
          {
            height: 607,
            levels: 1,
            mimetype: 'image/jpeg',
            size: 42674,
            url: 'https://tile.loc.gov/storage-services/service/pnp/fsa/8b27000/8b27500/8b27547r.jpg',
            width: 640,
          },
          {
            height: 972,
            levels: 1,
            mimetype: 'image/jpeg',
            size: 314603,
            url: 'https://tile.loc.gov/storage-services/service/pnp/fsa/8b27000/8b27500/8b27547v.jpg',
            width: 1024,
          },
        ],
      ],
      image:
        'https://tile.loc.gov/storage-services/service/pnp/fsa/8b27000/8b27500/8b27547_150px.jpg',
      url: 'https://www.loc.gov/resource/fsa.8b27547/',
    },
  ],
  related_items: [],
};

/** Baseball card `2008676581`: two one-page resources (front and back), a cataloged date range. */
export const BASEBALL_CARD_ITEM_2008676581 = {
  item: {
    title: '[Ty Cobb, Detroit Tigers, baseball card portrait]',
    date: '1909-01-01',
    created_published_date: '1909-1911.',
    url: 'https://www.loc.gov/item/2008676581/',
  },
  resources: [
    {
      caption: 'digital file from original, front',
      files: [
        [
          {
            mimetype: 'image/tiff',
            size: 15212762,
            url: 'https://tile.loc.gov/storage-services/master/pnp/bbc/0900/0940/0941fu.tif',
          },
          {
            mimetype: 'image/jpeg',
            size: 330271,
            url: 'https://tile.loc.gov/storage-services/service/pnp/bbc/0900/0940/0941fv.jpg',
          },
        ],
      ],
      image: 'https://tile.loc.gov/storage-services/service/pnp/bbc/0900/0940/0941f_150px.jpg',
      url: 'https://www.loc.gov/resource/bbc.0941f/',
    },
    {
      caption: 'digital file from original, back',
      files: [
        [
          {
            mimetype: 'image/tiff',
            size: 15302762,
            url: 'https://tile.loc.gov/storage-services/master/pnp/bbc/0900/0940/0941bu.tif',
          },
          {
            mimetype: 'image/jpeg',
            size: 311163,
            url: 'https://tile.loc.gov/storage-services/service/pnp/bbc/0900/0940/0941bv.jpg',
          },
        ],
      ],
      image: 'https://tile.loc.gov/storage-services/service/pnp/bbc/0900/0940/0941b_150px.jpg',
      url: 'https://www.loc.gov/resource/bbc.0941b/',
    },
  ],
  related_items: [],
};

/** Map `98688514`: a year-only `item.date` and no `created_published_date`. */
export const MAP_ITEM_98688514 = {
  item: {
    title: 'Railroad map of New Hampshire accompanying report of the railroad commissioners, 1894',
    date: '1894',
    created_published: ['Boston, 1894.'],
    url: 'https://www.loc.gov/item/98688514/',
  },
  resources: [
    {
      download_restricted: false,
      files: [
        [
          {
            height: 6488,
            info: 'https://tile.loc.gov/image-services/iiif/service:gmd:gmd374:g3741:g3741p:rr002540/info.json',
            levels: 6,
            mimetype: 'image/jp2',
            size: 5169779,
            url: 'https://tile.loc.gov/storage-services/service/gmd/gmd374/g3741/g3741p/rr002540.jp2',
            width: 4784,
          },
          {
            height: null,
            levels: 1,
            mimetype: 'image/tiff',
            size: 93115964,
            url: 'https://tile.loc.gov/storage-services/master/gmd/gmd374/g3741/g3741p/rr002540.tif',
            width: null,
          },
        ],
      ],
      image: 'https://tile.loc.gov/storage-services/service/gmd/gmd374/g3741/g3741p/rr002540.gif',
      resource_items: false,
      url: 'https://www.loc.gov/resource/g3741p.rr002540/',
    },
  ],
  related_items: [],
};

/** Sound recording `jukebox-68453`: the MP3 is `resources[0].audio`; its file entry has no `url`. */
export const AUDIO_ITEM_JUKEBOX_68453 = {
  item: {
    title: 'Oklahoma Indian jazz',
    date: '1923-11-07',
    url: 'https://www.loc.gov/item/jukebox-68453/',
  },
  resources: [
    {
      audio:
        'https://tile.loc.gov/streaming-services/iiif/service:mbrsrs:mbrsjukebox:ucsb_victor_19257_01_b28883_02:ucsb_victor_19257_01_b28883_02/full/full/0/full/default.mp3',
      files: [
        [
          {
            canDownload: true,
            download:
              'https://tile.loc.gov/streaming-services/iiif/service:mbrsrs:mbrsjukebox:ucsb_victor_19257_01_b28883_02:ucsb_victor_19257_01_b28883_02/full/full/0/full/default.mp3',
            duration: 162.0,
            filename:
              'https://tile.loc.gov/storage-services/service/mbrsrs/mbrsjukebox/ucsb_victor_19257_01_b28883_02/ucsb_victor_19257_01_b28883_02.mp3',
            mediaType: 'A',
            mimetype: 'audio/mpeg',
          },
          {
            height: null,
            levels: 1,
            mimetype: 'audio/wav',
            size: 28633716,
            url: 'https://tile.loc.gov/storage-services/master/mbrsrs/mbrsjukebox/ucsb_victor_19257_01_b28883_02/ucsb_victor_19257_01_b28883_02.wav',
            width: null,
          },
        ],
      ],
      url: 'https://www.loc.gov/resource/jukebox-68453.0',
    },
    {
      files: [
        [
          {
            height: 789,
            mimetype: 'image/jpeg',
            url: 'https://tile.loc.gov/image-services/iiif/service:mbrsrs:mbrsjukebox:ucsb_victor_19257_01_b28883_02:ucsb_victor_19257_01_b28883_02/full/pct:100/0/default.jpg',
            width: 793,
          },
        ],
      ],
      image:
        'https://tile.loc.gov/image-services/iiif/service:mbrsrs:mbrsjukebox:ucsb_victor_19257_01_b28883_02:ucsb_victor_19257_01_b28883_02/full/pct:100/0/default.jpg',
      mimetype: 'image/jpeg',
      url: 'https://www.loc.gov/resource/jukebox-68453.1',
    },
  ],
  related_items: [],
};

const NEWSPAPER_PAGE_GROUP: FileGroup = [
  {
    height: 9520,
    info: 'https://tile.loc.gov/image-services/iiif/service:ndnp:dlc:batch_dlc_keady_ver01:data:sn83030214:00206531526:1912041601:0303/info.json',
    mimetype: 'image/jp2',
    size: 7445720,
    url: 'https://tile.loc.gov/storage-services/service/ndnp/dlc/batch_dlc_keady_ver01/data/sn83030214/00206531526/1912041601/0303.jp2',
    use: '',
    width: 6256,
  },
  {
    mimetype: 'application/pdf',
    url: 'https://tile.loc.gov/storage-services/service/ndnp/dlc/batch_dlc_keady_ver01/data/sn83030214/00206531526/1912041601/0303.pdf',
    use: '',
  },
  {
    mimetype: 'text/xml',
    url: 'https://tile.loc.gov/storage-services/service/ndnp/dlc/batch_dlc_keady_ver01/data/sn83030214/00206531526/1912041601/0303.xml',
    use: '',
  },
  {
    height: 1190,
    levels: 1,
    mimetype: 'image/jpeg',
    url: 'https://tile.loc.gov/image-services/iiif/service:ndnp:dlc:batch_dlc_keady_ver01:data:sn83030214:00206531526:1912041601:0303/full/pct:12.5/0/default.jpg',
    width: 782,
  },
  {
    height: 9520,
    info: 'https://tile.loc.gov/image-services/iiif/service:ndnp:dlc:batch_dlc_keady_ver01:data:sn83030214:00206531526:1912041601:0303/info.json',
    mimetype: 'application/json',
    size: 7445720,
    width: 6256,
  },
  {
    fulltext_service:
      'https://tile.loc.gov/text-services/word-coordinates-service?segment=/service/ndnp/dlc/batch_dlc_keady_ver01/data/sn83030214/00206531526/1912041601/0303.xml&format=alto_xml&full_text=1',
    mimetype: 'text/plain',
    use: 'text',
  },
];

/** Newspaper issue `sn83030214/1912-04-16/ed-1`: one 14-page resource. */
export const NEWSPAPER_ISSUE_SN83030214_1912_04_16 = {
  item: {
    title: 'New-York tribune (New York [N.Y.]), April 16, 1912',
    date: '1912-04-16',
    created_published: ['New York [N.Y.], April 16, 1912'],
    url: 'https://www.loc.gov/item/sn83030214/1912-04-16/ed-1/',
  },
  resources: [
    {
      files: pageGroups(NEWSPAPER_PAGE_GROUP, '0303', 14, { firstNumber: 303 }),
      image:
        'https://tile.loc.gov/image-services/iiif/service:ndnp:dlc:batch_dlc_keady_ver01:data:sn83030214:00206531526:1912041601:0303/full/pct:3.125/0/default.jpg',
      url: 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/',
    },
  ],
  related_items: [],
};

const BOOK_PAGE_GROUP: FileGroup = [
  {
    mimetype: 'text/xml',
    size: 47760,
    url: 'https://tile.loc.gov/storage-services/public/gdcmassbookdig/popularhistoryof00chen/popularhistoryof00chen_0001.alto.xml',
    use: 'ocr',
  },
  {
    fulltext_service:
      'https://tile.loc.gov/text-services/word-coordinates-service?segment=/public/gdcmassbookdig/popularhistoryof00chen/popularhistoryof00chen_0001.alto.xml&format=alto_xml&full_text=1',
    mimetype: 'text/plain',
    use: 'text',
    word_coordinates:
      'https://tile.loc.gov/text-services/word-coordinates-service?segment=/public/gdcmassbookdig/popularhistoryof00chen/popularhistoryof00chen_0001.alto.xml&format=alto_xml',
  },
  {
    height: '2998',
    info: 'https://tile.loc.gov/image-services/iiif/public:gdcmassbookdig:popularhistoryof00chen:popularhistoryof00chen_0001/info.json',
    levels: '5',
    mimetype: 'image/jp2',
    other_name: 'popularhistoryof00chen_0001.jp2',
    size: 452132,
    url: 'https://tile.loc.gov/storage-services/public/gdcmassbookdig/popularhistoryof00chen/popularhistoryof00chen_0001.jp2',
    width: '1920',
  },
  {
    height: 2998,
    levels: 1,
    mimetype: 'image/jpeg',
    url: 'https://tile.loc.gov/image-services/iiif/public:gdcmassbookdig:popularhistoryof00chen:popularhistoryof00chen_0001/full/pct:100.0/0/default.jpg',
    width: 1920,
  },
  {
    height: 1499,
    levels: 1,
    mimetype: 'image/jpeg',
    url: 'https://tile.loc.gov/image-services/iiif/public:gdcmassbookdig:popularhistoryof00chen:popularhistoryof00chen_0001/full/pct:50.0/0/default.jpg',
    width: 960,
  },
  {
    height: 749,
    levels: 1,
    mimetype: 'image/jpeg',
    url: 'https://tile.loc.gov/image-services/iiif/public:gdcmassbookdig:popularhistoryof00chen:popularhistoryof00chen_0001/full/pct:25.0/0/default.jpg',
    width: 480,
  },
  {
    height: 374,
    levels: 1,
    mimetype: 'image/jpeg',
    url: 'https://tile.loc.gov/image-services/iiif/public:gdcmassbookdig:popularhistoryof00chen:popularhistoryof00chen_0001/full/pct:12.5/0/default.jpg',
    width: 240,
  },
];

/** Book `02007458`: one 582-page resource with a whole-volume PDF; every page has text. */
export const BOOK_ITEM_02007458 = {
  item: {
    title: 'Popular history of the civil war',
    date: '1894',
    created_published: ['Boston : Estes and Lauriat, 1894.'],
    url: 'https://www.loc.gov/item/02007458/',
  },
  resources: [
    {
      caption: null,
      files: pageGroups(BOOK_PAGE_GROUP, '0001', 582),
      fulltext_file:
        'https://tile.loc.gov/storage-services/public/gdcmassbookdig/popularhistoryof00chen/popularhistoryof00chen.text.txt',
      image:
        'https://tile.loc.gov/image-services/iiif/public:gdcmassbookdig:popularhistoryof00chen:popularhistoryof00chen_0009/full/pct:12.5/0/default.jpg',
      pdf: 'https://tile.loc.gov/storage-services/public/gdcmassbookdig/popularhistoryof00chen/popularhistoryof00chen.pdf',
      url: 'https://www.loc.gov/resource/gdcmassbookdig.popularhistoryof00chen/',
    },
  ],
  related_items: [],
};

const MANUSCRIPT_PAGE_GROUP: FileGroup = [
  {
    height: 2188,
    levels: 1,
    mimetype: 'image/jpeg',
    url: 'https://tile.loc.gov/image-services/iiif/service:mss:mss93930:mss93930-001:0000:0001/full/pct:100/0/default.jpg',
    width: 2876,
  },
  {
    height: 2188,
    info: 'https://tile.loc.gov/image-services/iiif/service:mss:mss93930:mss93930-001:0000:0001/info.json',
    levels: 6,
    mimetype: 'image/jp2',
    size: 410371,
    url: 'https://tile.loc.gov/storage-services/service/mss/mss93930/mss93930-001/0000/0001.jp2',
    width: 2876,
  },
  {
    height: null,
    levels: 1,
    mimetype: 'image/tiff',
    size: 6293075,
    url: 'https://tile.loc.gov/storage-services/master/mss/mss93930/mss93930-001/0000/0001.tif',
    width: null,
  },
  {
    fulltext_service:
      'https://tile.loc.gov/text-services/word-coordinates-service?segment=/service/gdc/gdccrowd/mss/mss93930/mss93930-001/0000/0001.txt&format=plain_text&full_text=1',
    mimetype: 'text/plain',
    url: 'https://tile.loc.gov/storage-services/service/gdc/gdccrowd/mss/mss93930/mss93930-001/0000/0001.txt',
    use: 'text',
  },
];

/** Diary `mm77093930`: one 122-page resource; pages 5 and 72 carry no transcription. */
export const MANUSCRIPT_ITEM_MM77093930 = {
  item: {
    title: 'Betty Herndon Maury Maury diary,',
    date: '1861',
    url: 'https://www.loc.gov/item/mm77093930/',
  },
  resources: [
    {
      caption: 'Betty Herndon Maury Maury Diary at the Library of Congress',
      files: pageGroups(MANUSCRIPT_PAGE_GROUP, '0001', 122, { withoutText: [5, 72] }),
      fulltext_file:
        'https://tile.loc.gov/storage-services/service/gdc/gdccrowd/mss/mss93930/mss93930-001/mss93930-001.txt',
      image:
        'https://tile.loc.gov/image-services/iiif/service:mss:mss93930:mss93930-001:0000:0006/full/pct:6.25/0/default.jpg',
      url: 'https://www.loc.gov/resource/mss93930.mss93930-001/',
    },
  ],
  related_items: [],
};

/**
 * Two `/photos/?q=cobb detroit baseball card&fo=json&c=10` rows, where the top-level `date` is
 * LOC's padded sort key and the nested `item.date` the cataloged date, and one `/search/?q=jazz`
 * row with no item block. Cut to the fields the normalizer reads.
 */
export const COBB_PHOTO_SEARCH = {
  results: [
    {
      id: 'http://www.loc.gov/item/2008676581/',
      url: 'https://www.loc.gov/item/2008676581/',
      title: '[Ty Cobb, Detroit Tigers, baseball card portrait]',
      date: '1909-01-01',
      original_format: ['photo, print, drawing'],
      item: { date: '1909-1911.' },
    },
    {
      id: 'http://www.loc.gov/item/2001704373/',
      url: 'https://www.loc.gov/item/2001704373/',
      title: '[Ty Cobb, Detroit AL (baseball)]',
      date: '1915-01-01',
      original_format: ['photo, print, drawing'],
      item: { date: 'c1915 Feb. 19.' },
    },
    {
      id: 'https://www.loc.gov/exhibits/jazz-singers/slideshow/',
      url: 'https://www.loc.gov/exhibits/jazz-singers/slideshow/',
      title: 'Gallery - Jazz Singers',
      date: '2016-02-11',
      original_format: ['web page'],
      item: null,
    },
  ],
  pagination: { of: 3, perpage: 10, total: 1 },
};

/**
 * Item-search rows captured live (2026-10-15) from `/books/`, `/manuscripts/`, and `/search/`
 * searches, one per identity shape: `lccn.loc.gov` permalinks (a 10-digit LCCN and an
 * `unk`-prefixed one), an `/item/` row whose `url` is a permalink, a `catalog.loc.gov` record, an
 * `hdl.loc.gov` finding aid, and a collection page. Cut to the fields the normalizer reads.
 */
export const IDENTITY_SHAPES_SEARCH = {
  results: [
    {
      id: 'http://lccn.loc.gov/2005567251',
      url: '//lccn.loc.gov/2005567251',
      title: 'WWW guide to Civil War prisons',
      original_format: ['book'],
      item: { date: 'uuuu' },
    },
    {
      id: 'http://lccn.loc.gov/unk82079773',
      url: '//lccn.loc.gov/unk82079773',
      title: 'Our liberties in danger.',
      date: '1835',
      original_format: ['book'],
      item: { date: '1835' },
    },
    {
      id: 'http://www.loc.gov/item/2024681443/',
      url: '//lccn.loc.gov/2024681443',
      title: 'Pacific railroad. April 16, 1860. -- Ordered to be printed',
      date: '1860',
      original_format: ['book'],
      item: { date: '1860' },
    },
    {
      id: 'http://catalog.loc.gov/cgi-bin/Pwebrecon.cgi?DB=local&BBID=13839143&v3=1',
      url: 'https://catalog.loc.gov/vwebv/holdingsInfo?bibId=13839143',
      title: 'US Civil War generals',
      original_format: ['book'],
      item: { date: 'uuuu' },
    },
    {
      id: 'http://hdl.loc.gov/loc.mss/eadmss.ms013110',
      url: '//hdl.loc.gov/loc.mss/eadmss.ms013110',
      title: 'National Society of Arts and Letters records, 1944-1987',
      date: '1944',
      original_format: ['manuscript/mixed material'],
      item: {},
    },
    {
      id: 'http://www.loc.gov/collections/civil-war-maps/about-this-collection/',
      url: 'https://www.loc.gov/collections/civil-war-maps/about-this-collection/',
      title: 'Civil War Maps',
      date: '1999',
      original_format: ['collection', 'map'],
      item: {},
    },
  ],
  pagination: { of: 6, perpage: 100, total: 1 },
};

/**
 * Item-search rows captured live (2026-10-15) whose nested `item.date` is a coded catalog value: a
 * compact sort number on a score and on a manuscript, a MARC `u` placeholder on a map, and `||||`
 * on a book collection with no top-level `date`. Cut to the fields the normalizer reads.
 */
export const CODED_DATE_SEARCH = {
  results: [
    {
      id: 'http://www.loc.gov/item/scsm000191/',
      url: 'https://www.loc.gov/item/scsm000191/',
      title: 'March, Lincoln Park: for pianoforte by Henry Wannemacher.',
      date: '1895',
      original_format: ['notated music'],
      item: { date: '18950000' },
    },
    {
      id: 'http://www.loc.gov/item/magbell.02800101/',
      url: 'https://www.loc.gov/item/magbell.02800101/',
      title: 'Card by Mabel Hubbard Bell, June 1913',
      date: '1913-06-01',
      original_format: ['manuscript/mixed material'],
      item: { date: '19130600' },
    },
    {
      id: 'http://www.loc.gov/item/98688858/',
      url: 'https://www.loc.gov/item/98688858/',
      title: 'Map of the Williamsport and Elmira Railroad with its connections',
      date: '185?',
      original_format: ['map'],
      item: { date: '185u' },
    },
    {
      id: 'http://www.loc.gov/item/2024769398/',
      url: 'https://www.loc.gov/item/2024769398/',
      title: 'Railroad Safety Advisory Committee',
      original_format: ['book', 'collection'],
      item: { date: '||||' },
    },
  ],
  pagination: { of: 4, perpage: 100, total: 1 },
};

/**
 * Book `00003348` (captured 2026-10-15): `item.date` is a coded time-period value and the imprint
 * carries the publication year. Resources cut to none; one top-level related record is an
 * `lccn.loc.gov` permalink.
 */
export const BOOK_ITEM_00003348 = {
  item: {
    title: 'The story of Captain Meriwether Lewis and Captain William Clark : for young readers',
    date: '0w0 d1804 d1806',
    created_published: ['New York : Werner School Book Company, c1900.'],
    call_number: ['F592.7 .K55'],
    url: 'https://www.loc.gov/item/00003348/',
  },
  resources: [],
  related_items: [
    { id: 'http://www.loc.gov/item/2003627086/' },
    { id: 'http://lccn.loc.gov/2003542660' },
  ],
};

/** Book `2005567251` (captured 2026-10-15): an LCCN-permalink record with a `uuuu` date and no imprint. */
export const BOOK_ITEM_2005567251 = {
  item: {
    title: 'WWW guide to Civil War prisons',
    date: 'uuuu',
    call_number: ['E611'],
    url: '//lccn.loc.gov/2005567251',
  },
  resources: [],
  related_items: [],
};

/** Book collection `2024769398` (captured 2026-10-15): a `||||` date and a bracketed imprint. Resources cut to none. */
export const BOOK_ITEM_2024769398 = {
  item: {
    title: 'Railroad Safety Advisory Committee',
    date: '||||',
    created_published: ['[197-?]-'],
    call_number: ['FAC 2099'],
    url: 'https://www.loc.gov/item/2024769398/',
  },
  resources: [],
  related_items: [],
};

/** Sound recording `2023622861` (captured 2026-10-15): a two-entry imprint. */
export const AUDIO_ITEM_2023622861 = {
  item: {
    title: 'Jazz tango',
    date: '2017',
    created_published: ['Millwood, NY : ZOHO Music, [2017]', '℗2017'],
    call_number: ['SDD 64018'],
    url: '//lccn.loc.gov/2023622861',
  },
  resources: [],
  related_items: [],
};

/**
 * Lomax recording `lomaxbib000571` (captured 2026-11-13): two url-less audio resources, two copies
 * of one disc side, the first download-restricted. Each holds one file group: the player config
 * and the MP3 already in `audio`. `item.related_items` links the disc sleeve root-relative
 * (`/item/lomaxbib000840`); the nested `item.item.date` is day-precise. Player configs cut to a few
 * keys; top-level related items cut to one.
 */
export const AUDIO_ITEM_LOMAXBIB000571 = {
  item: {
    title: "Po' Stranger Blues",
    date: '1939-06-04',
    created_published: ['Raiford, Florida, June 4, 1939'],
    item: { date: '19390604' },
    related_items: [{ title: 'Disc sleeve for AFS Disc #2718', url: '/item/lomaxbib000840' }],
    url: 'https://www.loc.gov/item/lomaxbib000571/',
  },
  resources: [
    {
      audio: 'https://tile.loc.gov/storage-services/media/ingested/api/loc.afc.afcss39.2718a2.mp3',
      download_restricted: true,
      files: [
        [
          {
            canDownload: false,
            detailUrl: 'https://www.loc.gov/item/lomaxbib000571/',
            download:
              'https://tile.loc.gov/storage-services/media/ingested/api/loc.afc.afcss39.2718a2.mp3',
            mediaType: 'A',
            mimetype: 'application/x-audio',
          },
          {
            mimetype: 'audio/mp3',
            url: 'https://tile.loc.gov/storage-services/media/ingested/api/loc.afc.afcss39.2718a2.mp3',
          },
        ],
      ],
      media_object_id: 'CEA2B42FC1E40108E0438C93F0280108',
      poster: null,
    },
    {
      audio: 'https://tile.loc.gov/storage-services/media/afc/lomax/afc1939001_02718a2.mp3',
      download_restricted: false,
      files: [
        [
          {
            canDownload: true,
            detailUrl: 'https://www.loc.gov/item/lomaxbib000571/',
            download:
              'https://tile.loc.gov/storage-services/media/afc/lomax/afc1939001_02718a2.mp3',
            mediaType: 'A',
            mimetype: 'application/x-audio',
          },
          {
            mimetype: 'audio/mp3',
            url: 'https://tile.loc.gov/storage-services/media/afc/lomax/afc1939001_02718a2.mp3',
          },
        ],
      ],
      media_object_id: '04344167D6FE0166E0538C93F0280166',
      poster: null,
    },
  ],
  related_items: [
    {
      id: 'http://www.loc.gov/item/lomaxbib000831/',
      title: 'Disc sleeve for AFS Disc #2707',
      url: 'https://www.loc.gov/item/lomaxbib000831/',
    },
  ],
};

/**
 * Disc sleeve `lomaxbib000840` (captured 2026-11-13), the record `lomaxbib000571` links: every
 * `item.related_items` entry is a root-relative `/item/` link. Resources cut to none.
 */
export const SLEEVE_ITEM_LOMAXBIB000840 = {
  item: {
    title: 'Disc sleeve for AFS Disc #2718',
    date: '1939-06-04',
    item: { date: '19390604' },
    related_items: [
      { title: "Po' Stranger Blues", url: '/item/lomaxbib000571' },
      { title: 'Dupree Blues', url: '/item/lomaxbib000572' },
      { title: 'Steal Liza Jane', url: '/item/lomaxbib000573' },
      { title: 'Sissy in de Barn', url: '/item/lomaxbib000574' },
    ],
    url: 'https://www.loc.gov/item/lomaxbib000840/',
  },
  resources: [],
  related_items: [],
};

/**
 * Poetry reading `2020729028` (captured 2026-11-13): tape side A is a one-page resource with a
 * `url`, side B a url-less audio resource whose file group holds the player config and its MP3.
 * Player configs cut to a few keys; related items cut to none.
 */
export const AUDIO_ITEM_2020729028 = {
  item: {
    title: 'Reading: Vincent Katz, Michael Lally',
    date: '1990',
    created_published: ['14-Nov-90.'],
    item: { date: '1990' },
    url: 'https://www.loc.gov/item/2020729028/',
  },
  resources: [
    {
      audio: 'https://tile.loc.gov/storage-services/service/rbc/stmarks/014B106A/014B106A.mp3',
      download_restricted: true,
      files: [
        [
          {
            canDownload: false,
            detailUrl: 'https://www.loc.gov/item/2020729028/',
            download:
              'https://tile.loc.gov/storage-services/service/rbc/stmarks/014B106A/014B106A.mp3',
            mediaType: 'A',
            mimetype: 'application/x-audio',
          },
        ],
      ],
      media_object_id: 'C7D2388A951A1878E053CAE7938CCEB5',
      poster: null,
      url: 'https://www.loc.gov/resource/2020729028/',
    },
    {
      audio: 'https://tile.loc.gov/storage-services/service/rbc/stmarks/014B106B/014B106B.mp3',
      download_restricted: true,
      files: [
        [
          {
            canDownload: false,
            detailUrl: 'https://www.loc.gov/item/2020729028/',
            download:
              'https://tile.loc.gov/storage-services/service/rbc/stmarks/014B106B/014B106B.mp3',
            mediaType: 'A',
            mimetype: 'application/x-audio',
          },
          {
            mimetype: 'audio/mp3',
            url: 'https://tile.loc.gov/storage-services/service/rbc/stmarks/014B106B/014B106B.mp3',
          },
        ],
      ],
      media_object_id: 'C7D2388EB49A187AE053CAE7938CEF5C',
      poster: null,
    },
  ],
  related_items: [],
};

/**
 * Folklife video `ncr002372` (captured 2026-11-13): one url-less video resource with no
 * `download_restricted`, its `image` a root-relative format placeholder. Player config cut to a few
 * keys; related items cut to none.
 */
export const VIDEO_ITEM_NCR002372 = {
  item: {
    title: 'Roundup: Going to Camp',
    date: '1979-10-01',
    created_published: ['October 1, 1979'],
    item: { date: '19791001' },
    url: 'https://www.loc.gov/item/ncr002372/',
  },
  resources: [
    {
      backgroundimage: null,
      files: [
        [
          {
            canDownload: true,
            detailUrl: 'http://hdl.loc.gov/loc.afc/afc96ran.v001',
            download: 'https://tile.loc.gov/storage-services/media/ammem/Buckaroos/001.mp4',
            mediaType: 'V',
            mimetype: 'application/x-video',
            url: 'https://tile.loc.gov/storage-services/media/ammem/Buckaroos/001.mp4',
          },
        ],
      ],
      image: '/static/images/original-format/film-video.svg',
      media_object_id: 'E3628D894807047AE0438C93F028047A',
      video: 'https://tile.loc.gov/storage-services/media/ammem/Buckaroos/001.mp4',
      video_stream:
        'https://tile.loc.gov/streaming-services/iiif/media:ammem:Buckaroos:001/full/full/0/full/default.m3u8',
    },
  ],
  related_items: [],
};

/**
 * Edison film `00694298` (captured 2026-11-13): one one-page resource with a `url`, its `image` and
 * `poster` protocol-relative, `download_restricted: false`. File group cut to the player config,
 * the MP4, and the GIF; related items cut to none. Its five `contributor_names` (roles after a
 * comma, one with a parenthesized fuller name) and five `contributors` keys list the same names in
 * different orders.
 */
export const FILM_ITEM_00694298 = {
  item: {
    title: 'Sandow',
    date: '1894',
    created_published: ['[United States : Edison Manufacturing Co., 1894?]'],
    item: { date: '1894' },
    contributor_names: [
      'Dickson, W. K.-L. (William Kennedy-Laurie), 1860-1935, production',
      'Sandow, Eugen, 1867-1925, performer',
      'Heise, William, camera',
      'Thomas A. Edison, Inc',
      'Hendricks (Gordon) Collection (Library of Congress)',
    ],
    contributors: [
      {
        'dickson, w. k.-l. (william kennedy-laurie)':
          'https://www.loc.gov/search/?fa=contributor:dickson,+w.+k.-l.+%28william+kennedy-laurie%29&fo=json',
      },
      { 'heise, william': 'https://www.loc.gov/search/?fa=contributor:heise,+william&fo=json' },
      {
        'hendricks (gordon) collection (library of congress)':
          'https://www.loc.gov/search/?fa=contributor:hendricks+%28gordon%29+collection+%28library+of+congress%29&fo=json',
      },
      { 'sandow, eugen': 'https://www.loc.gov/search/?fa=contributor:sandow,+eugen&fo=json' },
      {
        'thomas a. edison, inc':
          'https://www.loc.gov/search/?fa=contributor:thomas+a.+edison,+inc&fo=json',
      },
    ],
    url: 'https://www.loc.gov/item/00694298/',
  },
  resources: [
    {
      caption: 'Digital viewing copy',
      download_restricted: false,
      duration: 54,
      files: [
        [
          {
            canDownload: true,
            detailUrl: 'https://www.loc.gov/item/00694298/',
            download:
              'https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00179292/00179292.mp4',
            mediaType: 'V',
            mimetype: 'application/x-video',
          },
          {
            levels: 1,
            mimetype: 'video/mp4',
            size: 50824142,
            url: 'https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00179292/00179292.mp4',
          },
          {
            height: 375,
            levels: 1,
            mimetype: 'image/gif',
            size: 62935,
            url: 'https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00179292/00179292.gif',
            width: 500,
          },
        ],
      ],
      image: '//tile.loc.gov/storage-services/service/mbrs/ntscrm/00179292/00179292.gif',
      media_object_id: '10E690C49368CE1FE0635D0C938C56DF',
      poster: '//tile.loc.gov/storage-services/service/mbrs/ntscrm/00179292/00179292.jpg',
      url: 'https://www.loc.gov/resource/ntscrm.00179292/',
      video: 'https://tile.loc.gov/storage-services/service/mbrs/ntscrm/00179292/00179292.mp4',
      video_stream:
        'https://tile.loc.gov/streaming-services/iiif/service:mbrs:ntscrm:00179292:00179292/full/full/0/full/default.m3u8',
    },
  ],
  related_items: [],
};

/** `mal4356500` page N's file group: one JPEG size and the JP2 master. */
const malPageGroup = (page: number): FileGroup => {
  const n = String(page).padStart(3, '0');
  return [
    {
      levels: 1,
      mimetype: 'image/jpeg',
      url: `https://tile.loc.gov/image-services/iiif/service:mss:mal:435:4356500:${n}/full/pct:25/0/default.jpg`,
    },
    {
      levels: 7,
      mimetype: 'image/jp2',
      url: `https://tile.loc.gov/storage-services/service/mss/mal/435/4356500/${n}.jp2`,
    },
  ];
};

/**
 * Gettysburg Address, Nicolay copy, `mal4356500` (captured 2026-11-13): a month-precision record
 * whose `item.date` is the padded `1863-11-01` and whose nested `item.item.date` is the compact
 * `18631100`. One four-page resource with no per-page text service; its `fulltext_file` is the
 * document's TEI transcription. Page 1's group also holds a url-less `text/xml` entry (its inline
 * `fulltext` cut). File groups cut to two entries; related items cut to none.
 */
export const MANUSCRIPT_ITEM_MAL4356500 = {
  item: {
    title:
      'Abraham Lincoln papers: Series 3. General Correspondence. 1837-1897: Abraham Lincoln, [November 1863] (Gettysburg Address: Nicolay Copy)',
    date: '1863-11-01',
    created_published: ['November 1863'],
    item: { date: '18631100' },
    url: 'https://www.loc.gov/item/mal4356500/',
  },
  resources: [
    {
      caption: '',
      files: [
        [...malPageGroup(1), { mimetype: 'text/xml', use: 'text' }],
        malPageGroup(2),
        malPageGroup(3),
        malPageGroup(4),
      ],
      fulltext_file:
        'https://tile.loc.gov/storage-services/service/mss/mal/435/4356500/4356500.xml',
      image:
        'https://tile.loc.gov/image-services/iiif/service:mss:mal:435:4356500:001/full/pct:6.25/0/default.jpg',
      pdf: 'https://tile.loc.gov/storage-services/service/mss/mal/435/4356500/4356500.pdf',
      url: 'https://www.loc.gov/resource/mal.4356500/',
    },
  ],
  related_items: [],
};

/**
 * Henry Reed fiddle-tune transcription `afcreed000001` (captured 2026-11-13): a year-precision
 * record cataloged as a range. `item.date` is the padded `1966-01-01`, the nested `item.item.date`
 * the compact `19660000`, and the imprint `[Between 1966 and 1968]`. Resources and related items
 * cut to none.
 */
export const SCORE_ITEM_AFCREED000001 = {
  item: {
    title: '[Rocky Mountain Goat] [music transcription]',
    date: '1966-01-01',
    created_published: ['[Between 1966 and 1968]'],
    item: { date: '19660000' },
    url: 'https://www.loc.gov/item/afcreed000001/',
  },
  resources: [],
  related_items: [],
};

/**
 * Three rows of `/collections/abraham-lincoln-papers/?q=gettysburg&dates=1863/1863&c=12` (captured
 * 2026-11-13), one per precision of the compact `item.date`: month (`18631100`), day
 * (`18631120`), and year (`18630000`), each beside the padded top-level `date`. Cut to the fields
 * the normalizer reads, plus `dates`.
 */
export const LINCOLN_GETTYSBURG_1863_SEARCH = {
  results: [
    {
      id: 'http://www.loc.gov/item/mal4356500/',
      url: 'https://www.loc.gov/item/mal4356500/',
      title:
        'Abraham Lincoln papers: Series 3. General Correspondence. 1837-1897: Abraham Lincoln, [November 1863] (Gettysburg Address: Nicolay Copy)',
      date: '1863-11-01',
      dates: ['1863-11'],
      original_format: ['manuscript/mixed material'],
      item: { date: '18631100', created_published: ['November 1863'] },
    },
    {
      id: 'http://www.loc.gov/item/mal2812800/',
      url: 'https://www.loc.gov/item/mal2812800/',
      title:
        'Abraham Lincoln papers: Series 1. General Correspondence. 1833-1916: Abraham Lincoln to Edward Everett, Friday, November 20, 1863 (Gettysburg Address)',
      date: '1863-11-20',
      dates: ['1863-11-20'],
      original_format: ['manuscript/mixed material'],
      item: { date: '18631120', created_published: ['November 20, 1863'] },
    },
    {
      id: 'http://www.loc.gov/item/mal2910600/',
      url: 'https://www.loc.gov/item/mal2910600/',
      title:
        'Abraham Lincoln papers: Series 1. General Correspondence. 1833-1916: Julia K. Fish to Abraham Lincoln, 1863 (Requests manuscript of Gettysburg Address for sale and New York Sanitary Fair)',
      date: '1863-01-01',
      dates: ['1863'],
      original_format: ['manuscript/mixed material'],
      item: { date: '18630000', created_published: ['1863'] },
    },
  ],
  pagination: { of: 3, perpage: 12, total: 1 },
};
