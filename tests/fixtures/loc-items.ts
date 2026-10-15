/**
 * @fileoverview Item records and item-search rows captured live from www.loc.gov (2026-10-14 and
 * 2026-10-15).
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

/** FSA photo `2017760320`: `item.date` is the padded sort key, `created_published_date` the cataloged date. */
export const PHOTO_ITEM_2017760320 = {
  item: {
    title: 'Adobe farmhouse of rehabilitation client. Cimarron County, Oklahoma. Dust bowl',
    date: '1936-01-01',
    created_published_date: '1936 Apr.',
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
