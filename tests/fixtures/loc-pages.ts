/**
 * @fileoverview Page responses and text-service bodies captured live from www.loc.gov and
 * tile.loc.gov (2026-10-14). Page responses are `/resource/{id}/?sp=N&fo=json&at=item,resource,fulltext_service`
 * cut to the fields the service reads; text bodies are verbatim.
 * @module tests/fixtures/loc-pages
 */

/** Diary `mss93930.mss93930-001` page 3: `fulltext_file` is the whole volume's `.txt`; `fulltext_service` is page 3's. */
export const MANUSCRIPT_PAGE_3 = {
  item: { title: 'Betty Herndon Maury Maury diary,', date: '1861' },
  resource: {
    fulltext_file:
      'https://tile.loc.gov/storage-services/service/gdc/gdccrowd/mss/mss93930/mss93930-001/mss93930-001.txt',
    segment_count: 122,
    url: 'https://www.loc.gov/resource/mss93930.mss93930-001/',
  },
  fulltext_service:
    'https://tile.loc.gov/text-services/word-coordinates-service?segment=/service/gdc/gdccrowd/mss/mss93930/mss93930-001/0000/0003.txt&format=plain_text&full_text=1',
};

/** Page 3's text-service body (application/json). */
export const MANUSCRIPT_PAGE_3_TEXT = JSON.stringify({
  '/service/gdc/gdccrowd/mss/mss93930/mss93930-001/0000/0003.txt': {
    full_text:
      'Maury, Betty Herndon (Maury) 1835-1903.\nDiary, 1861-63. 1 v.\nDaughter of Matthew Fontaine Maury (1806-1873) and wife\nof William Arden Maury (1832-1918). Diary (1861 June 3-\n1863 Feb. 18) written chiefly at Fredericksburg, Va., containing\ndetailed comments on the progress of the Civil War,\nespecially in the local area, the hardships suffered by the\nConfederate soldiers, the military activities of her father\n(including the abortive attempt to capture the U.S.S. Pawnee),\nher cousin, Dabney Herndon Maury (1822-1900), and other\nmembers of the Maury family, and an 1862 visit to Fredericksburg\nby Abraham Lincoln.\nGift of Mrs. James Parmelee, 1928.\nMicrofilmed 1977.\n\nMICROFILMED 1977\nLIBRARY OF CONGRESS\nPHOTODUPLICATION SERVICE',
  },
});

/**
 * Page 4 of the same diary, in the page-3 shape with the segment number advanced. The text body
 * stands in for page 4's transcription; only its difference from page 3 matters.
 */
export const MANUSCRIPT_PAGE_4 = {
  ...MANUSCRIPT_PAGE_3,
  fulltext_service: MANUSCRIPT_PAGE_3.fulltext_service.replace('0000/0003.txt', '0000/0004.txt'),
};
export const MANUSCRIPT_PAGE_4_TEXT = JSON.stringify({
  '/service/gdc/gdccrowd/mss/mss93930/mss93930-001/0000/0004.txt': {
    full_text: 'June 3d 1861\nFredericksburg',
  },
});

/** Book `gdcmassbookdig.popularhistoryof00chen` page 11. */
export const BOOK_PAGE_11 = {
  item: { title: 'Popular history of the civil war', date: '1894' },
  resource: {
    fulltext_file:
      'https://tile.loc.gov/storage-services/public/gdcmassbookdig/popularhistoryof00chen/popularhistoryof00chen.text.txt',
    segment_count: 582,
    url: 'https://www.loc.gov/resource/gdcmassbookdig.popularhistoryof00chen/',
  },
  fulltext_service:
    'https://tile.loc.gov/text-services/word-coordinates-service?segment=/public/gdcmassbookdig/popularhistoryof00chen/popularhistoryof00chen_0011.alto.xml&format=alto_xml&full_text=1',
};

/** Page 11's text-service body (application/json). */
export const BOOK_PAGE_11_TEXT = JSON.stringify({
  '/public/gdcmassbookdig/popularhistoryof00chen/popularhistoryof00chen_0011.alto.xml': {
    full_text:
      'TO MY NEPHEW\nSawn Eo Cree NICY oHY DE,\nFOR WHOSE SAKE ALL BOYS ARE DEAR,\nIN THE HOPE THAT HE MAY SO LOVE HIS COUNTRY AS\nTO LIVE ACCORDING TO ITS LAWS, AND, IF\nNEED BE, TO TAKE UP ARMS\nIN ITS DEFENCE,\nThis Wook is affectionately inscribed\nBY\nAUNT EMM A.',
    height: '2998',
    width: '1920',
  },
});

/** Newspaper `sn83030214/1912-04-16/ed-1` page 1: `fulltext_file` and `fulltext_service` are the same URL. */
export const NEWSPAPER_PAGE_1 = {
  item: {
    newspaper_title: ['New-York tribune'],
    partof_title: ['new-york tribune (new york [n.y.]) 1866-1924'],
    location_state: ['new york'],
    place_of_publication: 'New York [N.Y.]',
    number_edition: ['1'],
    date_issued: '1912-04-16',
  },
  resource: {
    fulltext_file:
      'https://tile.loc.gov/text-services/word-coordinates-service?segment=/service/ndnp/dlc/batch_dlc_keady_ver01/data/sn83030214/00206531526/1912041601/0303.xml&format=alto_xml&full_text=1',
    segment_count: 14,
    url: 'https://www.loc.gov/resource/sn83030214/1912-04-16/ed-1/',
  },
  fulltext_service:
    'https://tile.loc.gov/text-services/word-coordinates-service?segment=/service/ndnp/dlc/batch_dlc_keady_ver01/data/sn83030214/00206531526/1912041601/0303.xml&format=alto_xml&full_text=1',
};

/**
 * Newspaper `sn93067777/1902-01-24/ed-2` page 2, the second edition of a two-edition date.
 * Captured with `at=item,resource`; `fulltext_service` is the page's `fulltext_file`, as on every
 * newspaper page.
 */
export const NEWSPAPER_ED2_PAGE_2 = {
  item: {
    newspaper_title: ['The Newberry herald and news'],
    partof_title: ['the newberry herald and news (newberry, s.c.) 1884-1903'],
    location_state: ['south carolina'],
    place_of_publication: 'Newberry, S.C.',
    number_edition: ['2'],
    date_issued: '1902-01-24',
  },
  resource: {
    fulltext_file:
      'https://tile.loc.gov/text-services/word-coordinates-service?segment=/service/ndnp/scu/batch_scu_garydavis_ver01/data/sn93067777/00237287149/1902012402/0030.xml&format=alto_xml&full_text=1',
    segment_count: 4,
    url: 'https://www.loc.gov/resource/sn93067777/1902-01-24/ed-2/',
  },
  fulltext_service:
    'https://tile.loc.gov/text-services/word-coordinates-service?segment=/service/ndnp/scu/batch_scu_garydavis_ver01/data/sn93067777/00237287149/1902012402/0030.xml&format=alto_xml&full_text=1',
};
