/**
 * @fileoverview Page responses and text-service bodies captured live from www.loc.gov and
 * tile.loc.gov (2026-10-14). Page responses are `/resource/{id}/?sp=N&fo=json&at=item,resource,fulltext_service`
 * cut to the fields the service reads; text bodies are verbatim.
 * @module tests/fixtures/loc-pages
 */

/** Diary `mss93930.mss93930-001` page 3: `fulltext_file` is the whole volume's `.txt`; `fulltext_service` is page 3's. */
export const MANUSCRIPT_PAGE_3 = {
  item: {
    title: 'Betty Herndon Maury Maury diary,',
    date: '1861',
    url: 'https://www.loc.gov/item/mm77093930/',
  },
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

/**
 * Book `gdcmassbookdig.storyofcaptainme00king` page 3, a blank page (captured 2026-10-15): LOC
 * lists a text file for it, and its text service answers with the blank-page placeholder.
 */
export const BOOK_BLANK_PAGE_3 = {
  item: {
    title: 'The story of Captain Meriwether Lewis and Captain William Clark : for young readers',
    url: 'https://www.loc.gov/item/00003348/',
  },
  resource: {
    fulltext_file:
      'https://tile.loc.gov/storage-services/public/gdcmassbookdig/storyofcaptainme00king/storyofcaptainme00king.text.txt',
    segment_count: 136,
    url: 'https://www.loc.gov/resource/gdcmassbookdig.storyofcaptainme00king/',
  },
  fulltext_service:
    'https://tile.loc.gov/text-services/word-coordinates-service?segment=/public/gdcmassbookdig/storyofcaptainme00king/storyofcaptainme00king_0003.alto.xml&format=alto_xml&full_text=1',
};

/** Page 3's text-service body, verbatim: the placeholder LOC sends for an ALTO file with no words. */
export const BOOK_BLANK_PAGE_3_TEXT =
  '{"/public/gdcmassbookdig/storyofcaptainme00king/storyofcaptainme00king_0003.alto.xml":{"full_text":"[NO TEXT AVAILABLE FOR THIS PAGE]","height":"3059","width":"2191"}}';

/**
 * Manuscript `magbell.02800101` page 2 (captured 2026-10-15): LOC sends its `fulltext_service` as
 * an empty object, not a URL — the page has no text of its own — while `resource.fulltext_file`
 * names the folder's TEI transcription, {@link BELL_CARD_TEI}.
 */
export const BELL_CARD_PAGE_2 = {
  item: {
    title: 'Card by Mabel Hubbard Bell, June 1913',
    url: 'https://www.loc.gov/item/magbell.02800101/',
  },
  resource: {
    fulltext_file:
      'https://tile.loc.gov/storage-services/service/mss/magbell/028/02800101/02800101.xml',
    segment_count: 3,
    url: 'https://www.loc.gov/resource/magbell.02800101/',
  },
  fulltext_service: {},
};

/**
 * {@link BELL_CARD_PAGE_2} without its `resource.fulltext_file`: a page with neither a text
 * service nor a transcription, as an image-only page is.
 */
export const MANUSCRIPT_IMAGE_ONLY_PAGE_2 = {
  item: BELL_CARD_PAGE_2.item,
  resource: { segment_count: 3, url: 'https://www.loc.gov/resource/magbell.02800101/' },
  fulltext_service: {},
};

/** `02800101.xml`, the transcription {@link BELL_CARD_PAGE_2} names (captured 2026-11-13), verbatim. */
export const BELL_CARD_TEI = `<?xml version="1.0" encoding="utf-8"?>

<!--<DOCTYPE tei2 SYSTEM "/itssgml/sgmlstd/dtds/ammem2/ammem2_xml.dtd"> -->
<!--
<!DOCTYPE tei2
  SYSTEM "/itssgml/sgmlstd/dtds/ammem2/ammem2axml_noURLs.dtd"
[<!ENTITY % images SYSTEM "02800101_upd.ent">
%images;]>
-->


<tei2>
   <teiheader type="text" creator="National Digital Library Program, Library of Congress" status="new" date.created="1998/12/13">
      <filedesc>
         <titlestmt>
            <amid type="aggitemid">magbell-02800101</amid>
            <title>Card by Mabel Hubbard Bell, June 1913, with transcript: a machine-readable transcription.</title>
            <amcol>
               <amcolname>The Alexander Graham Bell Collection.</amcolname>
               <amcolid type="aggid"/>
            </amcol>
            <respstmt>
               <resp>Selected and converted.</resp>
               <name>American Memory, Library of Congress.</name>
            </respstmt>
         </titlestmt>
         <publicationstmt>
            <p>Washington, DC, 1998.</p>
            <p>Preceding element provides place and date of transcription only.</p>
            <p>For more information about this text and this American Memory collection, refer to accompanying matter.</p>
         </publicationstmt>
         <sourcedesc>
            <lccn/>
            <sourcecol>The Alexander Graham Bell Family Papers, Manuscript Division, Library of Congress.</sourcecol>
            <copyright>Copyright status not determined; refer to accompanying matter.</copyright>
         </sourcedesc>
      </filedesc>
      <encodingdesc>
         <projectdesc>
            <p>The National Digital Library Program at the Library of Congress makes digitized historical materials available for education and scholarship.</p>
         </projectdesc>
         <editorialdecl>
            <p>This transcription is intended to have an accuracy of 99.95 percent or greater and is not intended to reproduce the appearance of the original work. The accompanying images provide a facsimile of this work and represent the appearance of the original.</p>
         </editorialdecl>
         <encodingdate>1998/12/13</encodingdate>
         <revdate/>
      </encodingdesc>
   </teiheader>
   <text type="manuscript">
      <pageinfo>
         <controlpgno entity="p0003i">0003</controlpgno>
         <printpgno/>
      </pageinfo>
      <body>
         <div>
            <note>
               <handwritten>1875<lb/>
1st</handwritten>
            </note>
            <p>“These letters to Mrs. A. Melville Bell were found in an old Japanese desk where they had apparently been kept by themselves. They cover all the years of my acquaintance with my husband's mother, and form a record of his life and mine.</p>
            <p>“Please do not destroy them. If no one cares for them now perhaps one of the grandchildren may, years hence.</p>
            <p>“To me old letters are sacred, when they deal with the family life. I would value old letters revealing the personality of any of my ancestors beyond any amount of old furniture or bric-a-brac.”</p>
            <p>MABEL G. BELL<lb/>
June 1913</p>
            <p>Many letters from Mrs. Alexander Graham Bell to Mr. and Mrs. Alexander Melville Bell found in other places than those referred to by Mrs. Bell in the above note are included in this series.</p>
            <p>G.H.G.</p>
         </div>
      </body>
   </text>
</tei2>
`;

/**
 * Lincoln papers `mal4356500` (Gettysburg Address, Nicolay copy) page 1 (captured 2026-11-13), cut
 * to the fields the service reads: no per-page text service, and the four-page document's TEI
 * transcription as `resource.fulltext_file`, credited in `resource.fulltext_attribution`. Every
 * page of the document carries the same `resource` block, so `?sp=3` answers the same fields.
 */
export const GETTYSBURG_NICOLAY_PAGE_1 = {
  item: {
    title:
      'Abraham Lincoln papers: Series 3. General Correspondence. 1837-1897: Abraham Lincoln, [November 1863] (Gettysburg Address: Nicolay Copy)',
    url: 'https://www.loc.gov/item/mal4356500/',
  },
  resource: {
    fulltext_attribution:
      'Transcribed and annotated by the Lincoln Studies Center, Knox College. Galesburg, Illinois.',
    fulltext_file: 'https://tile.loc.gov/storage-services/service/mss/mal/435/4356500/4356500.xml',
    segment_count: 4,
    url: 'https://www.loc.gov/resource/mal.4356500/',
  },
  fulltext_service: {},
};

/**
 * `4356500.xml`, the transcription {@link GETTYSBURG_NICOLAY_PAGE_1} names (captured 2026-11-13),
 * with its `<teiheader>` (file lines 3-38) cut; the rest verbatim.
 */
export const GETTYSBURG_NICOLAY_TEI = `<?xml version="1.0" encoding="utf-8"?>
<tei2>

<text type="manuscript">
    <pageinfo>
        <controlpgno>0001</controlpgno>
        <printpgno/>
    </pageinfo>
    <body>
<div id="d4356500">
<p>
<hi rend="underscore">Abraham Lincoln, Draft of Gettysburg Address, Nicolay Copy<anchor id="i443">1</anchor>, [November 1863]</hi>
</p>
<note anchor.ids="i443">
<p>1 President Lincoln was invited to attend the dedication of a military cemetery in Gettysburg, Pennsylvania, the site of a decisive Union victory in July 1863.  The main address had already been assigned to a famous orator, Edward Everett of Massachusetts.  In his letter of invitation, the ceremony's organizer, David Wills, told the President: “It is the desire that, after the Oration, You, as Chief Executive of the Nation, formally set apart these grounds to their Sacred use by a few appropriate remarks” (David Wills to Abraham Lincoln, Nov.2, 1863).  The speech was widely admired at the time and would become perhaps the best known of all Lincoln's writings.  Edward Everett wrote Lincoln the next day: “I should be glad, if I could flatter myself that I came as near to the central idea of the occasion, in two hours, as you did in two minutes” (Everett to Lincoln, November 20, 1863).</p>
<p>There are five known drafts of the Gettysburg Address in Lincoln's hand.  Three were definitely written out for persons requesting them after the address had been delivered.  Of the remaining two, one of these may have been written out after the fact, but at least one was drafted before delivery on November 19, 1863.  This is the one presented here, referred to as the Nicolay copy, because it belonged to his secretary, John G. Nicolay.  Although Nicolay believed that this was the copy Lincoln held in his hand and appeared to read from at the Gettysburg cemetery dedication, he himself recognized that what Lincoln actually said on that occasion differed significantly from the text of this document.  (See John G. Nicolay, “Lincoln's Gettysburg Address,” <hi rend="italics">Century</hi>, XLVII (February 1894), 596-608.)  Nicolay believed that the first page, on Executive Mansion stationery, was the first page of the incomplete draft that Lincoln brought with him to Gettysburg, and that the second page, whose text is in pencil, was composed just before the speech was delivered in Pennsylvania.  While the text of the first page suggests that it belongs to a preliminary draft, the awkward juncture with the text of the second page constitutes a strong reason to doubt that the two leaves belong to the same draft.  (See Garry Wills, <hi rend="italics">Lincoln at Gettysburg</hi> (New York: Simon &amp; Schuster, 1992), 193-94.)  Like the other manuscript of the address thought by some to be a preliminary draft, the Hay copy (<hi rend="italics">q. v</hi>
<hi rend="underscore">.</hi>), this draft conspicuously lacks the phrase “under God,” which Lincoln was heard by reporters to say at the event, and which he included in the three copies made afterwards.  For a full discussion of the five extant manuscripts of this famous address, see  <hi rend="italics">Long Remembered: Facsimiles of the five versions of the Gettysburg Address in the handwriting of Abraham Lincoln</hi> (Washington: Library of Congress, 1963).</p>
</note>
<p>[<hi rend="underscore">Page one</hi>]</p>
<p>Executive Mansion,</p>
<p>Washington, , 186 .</p>
<p>Four score and seven years ago our fathers brought forth, upon this continent, a new nation, conceived in liberty, and dedicated to the proposition that “all men are created equal”</p>
<p>Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived, and so dedicated, can long endure.  We are met on a great battle field of that war.  We have come to dedicate a portion of it, as a final resting place for those who died here, that the nation might live.  This we may, in all propriety do.  But, in a larger sense, we can not dedicate — we can not consecrate — we can not hallow, this ground—  The brave men, living and dead, who struggled here, have hallowed it, far above our poor power to add or detract.  The world will little note, nor long remember what we say here; while it can never forget what they <hi rend="underscore">did</hi> here.</p>
<p>It is rather for us, the living, <hi rend="other">to stand here,</hi> we here be dedica-<anchor id="i444">2</anchor>
</p>
<p>
<note anchor.ids="i444">2 This partial sentence comes at the end of the first page of the manuscript.  In striking “to stand here,” and substituting the awkward “we here be dedica-,” Lincoln may have been attempting both to cancel abandoned language and to form a bridge to an already completed second page of another draft that began in the middle of the word “dedicated.”  This would explain the perhaps inadvertent dropping of the second part of a sentence that, in its latest form would read: “It is for us the living, rather, to be dedicated here to the unfinished work which they who fought here have thus far so nobly advanced.”</note>
</p>
<p>[<hi rend="underscore">Page 2</hi>]</p>
<p>ted to the great task remaining before us — that, from these honored dead we take increased devotion to that cause for which they here, gave the last full measure of devotion — that we here highly resolve these dead shall not have died in vain; that the nation, shall have a new birth of freedom, and that government of the people by the people for the people, shall not perish from the earth.</p>
</div>
        </body>
    </text>
</tei2>
`;

/**
 * `afc1940001_abalo.xml` (California Gold, "Abalone"; captured 2026-11-13), with its
 * `<teiheader>` (file lines 13-41) cut; the rest verbatim, `<pageinfo>` and `<illus>` in the body.
 */
export const CALIFORNIA_GOLD_ABALONE_TEI = `<?xml version="1.0" encoding="utf-8"?>

<!--<DOCTYPE tei2 SYSTEM "/itssgml/sgmlstd/dtds/ammem2/ammem2_xml.dtd"> -->
<!--
<!DOCTYPE tei2
  SYSTEM "/itssgml/sgmlstd/dtds/ammem2/ammem2axml_noURLs.dtd"
[<!ENTITY % images SYSTEM "abalo_upd.ent">
%images;]>
-->


<tei2>
   <text type="manuscript">
      <body>
         <pageinfo>
            <controlpgno entity="IABALO01">0001</controlpgno>
            <printpgno/>
         </pageinfo>
         <div>
            <p>Abalone<lb/>1.  In Carmel Bay the people say,<lb/>We feed the Lazzaroni<lb/>On caramels[,?] and cockle-shells<lb/>And hunks of abalone.<lb/>2.  O, some folks boast of quail on toast,<lb/>Because they think it's tony;<lb/>But my tom-cat gets nice and fat<lb/>On hunks of abalone.<lb/>3.  He hides in caves, beneath the waves,<lb/>His ancient patrimony:<lb/>Race suicide will ne'er betide<lb/>The fertile abalone.<lb/>4.  I telegraph my better half<lb/>By Morse or by Marconi<lb/>But when in need of greater speed<lb/>I send an abalone.<lb/> 5.  Some folks say that pain is real<lb/>And some say that it's phoney;<lb/>But as for me, when I can't agree,<lb/>I eat an abalone.<lb/>6.  Our naval hero, best of all,<lb/>His name was Pauley Joney;<lb/>He sailed the seas as he darn pleased.<lb/>But he never ate abalone.</p>
         </div>
         <pageinfo>
            <controlpgno entity="IABALO02">0002</controlpgno>
            <printpgno/>
         </pageinfo>
         <div>
            <head>Abalone</head>
         </div>
         <div>
            <p>
               <illus entity="Abalo002" map="no"/>
            </p>
         </div>
      </body>
   </text>
</tei2>

`;

/**
 * `2399500.xml` (Lincoln to Erastus Corning and others, draft; captured 2026-11-13), cut to file
 * lines 1-2, 40-50, 56-62, 78-89 and the closing lines: the title, two editors' notes (the first
 * with its paragraphs, lines 51-55, cut), and the paragraph whose canceled wording `soon followed`
 * note 5 records, with notes 5-7.
 */
export const CORNING_DRAFT_TEI_EXCERPT = `<?xml version="1.0" encoding="utf-8"?>
<tei2>
<text type="manuscript">
    <pageinfo>
        <controlpgno>0001</controlpgno>
        <printpgno/>
    </pageinfo>
    <body>
<div id="d2399500">
<p>
<hi rend="underscore">From Abraham Lincoln to Erastus Corning and others [Draft]<anchor id="i250">1</anchor>, [June] 1863</hi>
</p>
<note anchor.ids="i250">
</note>
<p>Albany letter Manuscript</p>
<p>&amp; something about Proclamation.<anchor id="i251">2</anchor>
</p>
<p>
<note anchor.ids="i251">2 This is Lincoln's handwritten inscription on a large envelope in which he presumably kept the manuscript of his letter to Erastus Corning and others.  The document or notes that Lincoln refers to as “something about the Proclamation,”  being absent, cannot be identified with certainty.  For a possible candidate, see Abraham Lincoln, Memorandum on Reunion, [1863?].</note>
</p>
<p>
<hi rend="other">May I be indulged to submit a few general remarks upon this subject of arrests</hi>?  Prior to my instalation here it had been inculcated that any state had a lawful right to secede from the national Union; and that it would be expedient to exercise the right, whenever the devotees of the doctrine should fail to elect a President to their own liking.  I was elected contrary to their liking; and accordingly, so far as it was legally possible, they had taken seven states out of the Union, had seized many of the United States Forts, and had fired upon the United States' Flag, all before I was inaugerated; and, of course, before I had done any official act whatever.  The rebellion, thus began soon ran into the present civil war; <hi rend="other">soon followed</hi>;<anchor id="i254">5</anchor> and, in certain respects, it began on very unequal terms between the parties—  The insurgents had been preparing for it more than thirty years, while the government had <hi rend="other">made no preparation</hi> taken no steps to resist <hi rend="other">it</hi> them.<anchor id="i255">6</anchor>  The former had carefully considered all the means which could be turned to their account.  It undoubtedly was a well pondered reliance with them that in their own unrestricted effort to destroy Union, Constitution, and law, all together, the government would, in great degree, be restrained by the same Constitution and law, from arresting their progress.  Their sympathizers pervaded all departments of the government, and nearly all communities of the people.  From this material, under cover of “Liberty of speech”  “Liberty of the press”  and “<hi rend="underscore">Habeas Corpus</hi>” they hoped to keep on foot amongst us a most efficient corps of Spies, informers, supplyers, and aiders and abettors of their cause in a thousand ways.  They knew that in times such as they were inaugerating, by the Constitution itself, the “Habeas Corpus”  might be suspended; but they also knew they had friends who would <hi rend="other">raise a squabble</hi> make a question as to <hi rend="underscore">who</hi> was to suspend it; meanwhile their spies and others might remain at large to help on their cause.  Or if, as has happened, the executive should suspend the writ, without ruinous waste of time, instances of arresting innocent persons might occur, as <hi rend="other">always do in</hi>
<anchor id="i256">7</anchor> are always likely to occur in such cases; and then a <hi rend="other">howl</hi> clamor could be raised in regard to this, which might be, at least, of some service to the insurgent cause.  It needed no very keen perception to discover this part of the enemie's programme, so soon as by open hostilities <hi rend="other">were commenced</hi>. their machinery was farily put in motion.  Yet, thoroughly imbued with a reverence for the guarrentied rights of individuals, I was slow to adopt the strong measures, which by degrees I have been forced to regard as being within the exceptions of the constitution, and as indispensable to the public Safety.<anchor id="i257">8</anchor>  Nothing is better known to history than that Courts of justice are utterly incompetent to such cases.  <hi rend="other">They</hi> Civil Courts are organized chiefly for trials of individuals, or, at most, a few individuals acting in concert; and this in quiet times, and on charges of crimes well defined in the law.  Even in times of peace, bands of horse-thieves and robbers frequently grow too numerous and powerful for the ordinary Courts of justice.  But what comparison, in numbers, have such bands ever borne to the insurgent sympathizers even in many of the loyal states?  Again, a jury <hi rend="other">can scarcely be empannelled, that will not</hi> too frequently have at least one member, more ready to hang the panel than to hang the traitor.  And yet again, he who dissuades one man from volunteering or induces one soldier to desert, weakens the Union cause as much as he who kills a union soldier in battle.<anchor id="i258">9</anchor>  Yet this dissuasion, or inducement, <hi rend="other">is</hi> may be so conducted as to be no defined crime of which any civil court would take cognizance.</p>
<p>
<note anchor.ids="i254">5 Lincoln originally wrote: “The present civil war soon followed;”</note>
</p>
<p>
<note anchor.ids="i255">6 Lincoln first wrote: “The insurgents had been preparing for it more than thirty years, while the government had made no preparation to resist it.” </note>
</p>
<p>
<note anchor.ids="i256">7 The striking of “in” appears to have been done at the time of first composing the sentence, so that before revision, the sentence read: “Or if, as has happened, the executive should suspend the writ, without ruinous waste of time, instances of arresting innocent persons might occur, as always do <hi rend="other">in</hi> occur in such cases; . . .”</note>
</p>
</div>
        </body>
    </text>
</tei2>
`;

/**
 * `0773800.xml` (First Inaugural Address, final version; captured 2026-11-13), cut to file lines
 * 1-2, 40-46, 321-341 and the closing lines: two paragraphs whose canceled wording nests
 * `<hi rend="italics">` inside `<hi rend="other">`, with their notes 56-59.
 */
export const FIRST_INAUGURAL_TEI_EXCERPT = `<?xml version="1.0" encoding="utf-8"?>
<tei2>
<text type="manuscript">
    <pageinfo>
        <controlpgno>0001</controlpgno>
        <printpgno/>
    </pageinfo>
    <body>
<div id="d0773800">
<p>My countrymen, one and all, <hi rend="other">take <hi rend="italics">time</hi>  and think</hi> think calmly and<anchor id="i76">56</anchor>
<hi rend="italics">well,</hi> upon this whole subject.  Nothing valuable can be lost by taking time.  <hi rend="other">Nothing worth preserving is either breaking or burning.</hi>
<anchor id="i77">57</anchor> If there be an object to <hi rend="italics">hurry</hi> any of you, in hot haste, to a step which you would never take <hi rend="italics">deliberately,</hi> that object will be frustrated by taking time; but no good object can be frustrated by it.  Such of you as are now dissatisfied, still have the old Constitution unimpaired, and, on the sensitive point, the laws of your own framing under it; while the new administration will have no immediate power, if it would, to change either.  If it were admitted that you who are dissatisfied, hold the right side in the dispute, there still is no single good reason for precipitate action.  Intelligence, patriotism, Christianity, and a firm reliance on Him, who has never yet forsaken this favored land, are still competent to adjust, in the best way, all our present difficulty.</p>
<p>
<note anchor.ids="i76">56 “think calmly and” has been substituted for “take <hi rend="italics">time</hi> and think” (Seward).</note>
</p>
<p>
<note anchor.ids="i77">57 The deletion of these words was urged by Seward.</note>
</p>
<p>In <hi rend="italics">your</hi> hands, my dissatisfied fellow countrymen, and not in <hi rend="italics">mine,</hi> is the momentous issue of civil war.  The government will not assail <hi rend="italics">you.</hi>
<hi rend="other">unless you <hi rend="italics">first</hi> assail <hi rend="italics">it</hi>.</hi>
<anchor id="i78">58</anchor> You can have no conflict, without being yourselves the aggressors.  <hi rend="italics">You</hi> have no oath registered in Heaven to destroy the government, while <hi rend="italics">I</hi> shall have the most solemn one to “preserve, protect and defend” it. <hi rend="other">
<hi rend="italics">You</hi> can forbear, the <hi rend="italics">assault</hi> upon it; <hi rend="italics">I</hi> can <hi rend="italics">not</hi> shrink from the <hi rend="italics">defense</hi> of it.  With <hi rend="italics">you,</hi> and not with <hi rend="italics">me,</hi> is the solemn question of “Shall it be peace, or a sword?”</hi>
<anchor id="i79">59</anchor>
</p>
<p>
<note anchor.ids="i78">58 The deletion of these words was urged by Seward.</note>
</p>
<p>
<note anchor.ids="i79">59 The decision to remove the challenge from the original conclusion in favor of conciliation seems clearly to have been influenced by Seward's admonitions, including a recommendation to delete these two sentences.</note>
</p>
</div>
        </body>
    </text>
</tei2>
`;

/**
 * Lincoln papers `mal0773800` (First Inaugural Address, final version) page 1 (captured
 * 2026-11-13), cut to the fields the service reads: no per-page text service, and the 13-page
 * document's TEI transcription as `resource.fulltext_file`, credited in
 * `resource.fulltext_attribution`.
 */
export const FIRST_INAUGURAL_PAGE_1 = {
  item: {
    title:
      'Abraham Lincoln papers: Series 1. General Correspondence. 1833-1916: Abraham Lincoln, [March 1861] (First Inaugural Address, Final Version)',
    url: 'https://www.loc.gov/item/mal0773800/',
  },
  resource: {
    fulltext_attribution:
      'Transcribed and annotated by the Lincoln Studies Center, Knox College. Galesburg, Illinois.',
    fulltext_file: 'https://tile.loc.gov/storage-services/service/mss/mal/077/0773800/0773800.xml',
    segment_count: 13,
    url: 'https://www.loc.gov/resource/mal.0773800/',
  },
  fulltext_service: {},
};

/**
 * `0773800.xml`, the transcription {@link FIRST_INAUGURAL_PAGE_1} names (captured 2026-11-13) and
 * the largest found, with its `<teiheader>` (file lines 3-38) and the paragraphs of editors' note
 * 1 (lines 51-69) cut; the rest verbatim. Both cuts fall in what the reader drops, so its reading
 * text is the whole file's.
 */
export const FIRST_INAUGURAL_TEI = `<?xml version="1.0" encoding="utf-8"?>
<tei2>

<text type="manuscript">
    <pageinfo>
        <controlpgno>0001</controlpgno>
        <printpgno/>
    </pageinfo>
    <body>
<div id="d0773800">
<p>
<hi rend="underscore">Abraham Lincoln, First Inaugural Address, Final Version<anchor id="i21">1</anchor>, [March 1861]</hi>
</p>
<note anchor.ids="i21">
</note>
<p>[Page 1]</p>
<p>In compliance with a custom as old as the government itself, I appear before you to address you briefly, and to take, in your presence, the oath prescribed by the Constitution of the United States, to be taken by the President “before he enters on the execution of his office.”</p>
<p>
<hi rend="other">The more modern custom of electing a Chief Magistrate upon a previously declared platform of principles, supercedes, in a great measure, the necessity of re-stating those principles in an address of this sort.  Upon the plainest grounds of good faith, one so elected is not at liberty to shift his position.  It is necessarily implied, if not expressed, that, in his judgment, the platform which he thus accepts, binds him to nothing either unconstitutional or inexpedient.</hi>
</p>
<p>
<hi rend="other">Having been so elected upon the Chicago Platform, and while I would repeat nothing in it, of aspersion or epithet or question of motive against any man or party, I hold myself bound by duty, as well as impelled by inclination to follow, within the executive sphere, the principles therein declared.  By no other course could I meet the reasonable expectations of the country.</hi>
</p>
<p>
<hi rend="other">I do not consider it necessary at present for me to say more than I have, in relation to those matters of administration, about which there is no special excitement.</hi>
<anchor id="i22">2</anchor>
</p>
<p>
<note anchor.ids="i22">2 The preceding three paragraphs have been eliminated by covering them with a pasted slip, on which Lincoln wrote a rewording of the third paragraph that varies only slightly from the revision he made in the previous version (See Abraham Lincoln, First Inaugural Address, Second Printed Draft, with Changes in Lincoln's Hand [February or March, 1861]).  In eliminating the second and third paragraphs, Lincoln was responding to suggestions made by William H. Seward.</note>
</p>
<p>I do not consider it necessary, at present, for me to discuss those matters of administration about which there is no special anxiety, or excitement.<anchor id="i23">3</anchor>
</p>
<p>
<note anchor.ids="i23">3 This sentence has been written in Lincoln's hand on a slip that is pasted over the second, third, and fourth paragraphs of the printed draft, and is a slight revision of the third paragraph.</note>
</p>
<p>Apprehension seems to exist among the people of the Southern States, that by the accession of a Republican Administration, their property, and their peace, and personal security, are to be endangered.  There has never been any reasonable cause for such apprehension.  Indeed, the most ample evidence to the contrary has all the while existed, and been open to their inspection.  It is found in nearly all the published speeches of him who now addresses you.  I do but quote from one of those speeches when I declare that “I have no purpose, directly or indirectly, to interfere with the institution of slavery in the States where it exists.  I believe I have no lawful right to do so, and I have no inclination to do so.”<anchor id="i24">4</anchor>  Those who nominated and elected me did so with full knowledge that I had made this, and many similar declarations, and had never recanted them.  And more than this, they placed in the platform, for my acceptance, and as a law to themselves, and to me, the clear and emphatic resolution which I now read:</p>
<p>
<note anchor.ids="i24">4 Lincoln made this statement at least three times previously, at Ottawa and Quincy, Illinois, on August 21 and October 23, 1858, during his debates with Douglas, and at Columbus, Ohio, on September 16, 1859.  See <hi rend="italics">Collected Works</hi>, III, 16, 249, 402.</note>
</p>
<p>
<hi rend="italics"> “Resolved,</hi> That the maintenance inviolate of the rights of the States, and especially the right of each State to order and control its own domestic institutions according to its own judgment exclusively, is essential to that balance of power on which the perfection and endurance of our political fabric depend; and we denounce the lawless invasion by armed force of the soil of any State or Territory, no matter under what pretext, as among the gravest of crimes.”<anchor id="i25">5</anchor>
</p>
<p>
<note anchor.ids="i25">5 See the 1860 Republican platform in Kirk H. Porter and Donald B. Johnson, <hi rend="italics">National Party Platforms: 1840-1972</hi> (Urbana: University of Illinois Press, 1973), 32.</note>
</p>
<p>[Page 2]</p>
<p>I now reiterate these sentiments:  and in doing so, I only press upon the public attention the most conclusive evidence of which the case is susceptible, that the property, peace and security of no section are to be in anywise endangered by the now incoming Administration.  I add too, that all the protection which, consistently with the Constitution and the laws, can be given, will be cheerfully given to all the States when lawfully demanded, for whatever cause — as cheerfully to one section, as to another.<anchor id="i26">6</anchor>
</p>
<p>
<note anchor.ids="i26">6 “when lawfully demanded, for whatever cause —” has been added, reflecting the sense, but not the wording, of Seward's suggestion. Lincoln has also added a comma after “section”.</note>
</p>
<p>There is much controversy about the delivering up of fugitives from service or labor.  The clause I now read is as plainly written in the Constitution as any other of its provisions:</p>
<p>“No person held to service or labor in one State, under the laws thereof, escaping into another, shall, in consequence of any law or regulation therein, be discharged from such service or labor, but shall be delivered up on claim of the party to whom such service or labor may be due.”<anchor id="i27">7</anchor>
</p>
<p>
<note anchor.ids="i27">7 <hi rend="italics">The Constitution of the United States</hi>, Article IV, Section 2.</note>
</p>
<p>It is scarcely questioned that this provision was intended by those who made it, for the reclaiming of what we call fugitive slaves; and the intention of the law-giver is the law.  All members of Congress swear their support to the whole Constitution — to this provision as much as to any other.  To the proposition, then, that slaves whose cases come within the terms of this clause, “shall be delivered up,” their oaths are unanimous.  Now, if they would make the effort in good temper, could they not, with nearly equal unanimity, frame and pass a law, by means of which to keep good that unanimous oath?</p>
<p>There is some difference of opinion whether this clause should be enforced by national or by state authority; but surely that difference is not a very material one.  If the slave is to be surrendered, it can be of but little consequence to him, or to others, by which authority it is done.  And should any one, in any case, be content that his oath shall go unkept, on a merely unsubstantial controversy as to <hi rend="italics">how</hi> it shall be kept?</p>
<p>Again, in any law upon this subject, ought not all the safeguards of liberty known in civilized and humane jurisprudence to be introduced, so that a free man be not, in any case, surrendered as a slave?  And might it not be well, at the same time, to provide by law for the enforcement of that clause in the Constitution which guarranties that “The citizens of each State shall be entitled to all previleges and immunities of citizens in the several States”?<anchor id="i28">8</anchor>
</p>
<p>
<note anchor.ids="i28">8 This sentence has been added to the printed text.</note>
</p>
<p>I take the official oath to-day, with no mental reservations, and with no purpose to construe the Constitution or laws, by any hypercritical rules.  And while I do not <hi rend="other">think proper</hi> choose now to specify particular acts of Congress as proper to be enforced, I do suggest, that it will be much safer for all, both in official and private stations, to conform to, and abide by, all those acts which stand unrepealed, than to violate any of them, trusting to find impunity in having them held to be unconstitutional. <anchor id="i29">9</anchor>
</p>
<p>
<note anchor.ids="i29">9 The word “choose” has been substituted for “think proper”; a comma has been added after the word “suggest”.</note>
</p>
<p>[Page 3]</p>
<p>It is <hi rend="other">now</hi> seventy-two years since the first inauguration of a President under our national Constitution.  During that period fifteen different and greatly distinguished citizens, have, in succession, administered the executive branch of the government.  They have conducted it through many perils; and, <hi rend="other">on the whole,</hi> generally,<anchor id="i30">10</anchor> with great success.  Yet, with all this scope for precedent, I now enter upon the same task for the brief constitutional term of four years, under great and peculiar difficulty.  A disruption of the Federal Union <hi rend="other">is menaced, and, so far as can be on paper, is already effected.  The particulars of what has been done are so familiar, and so fresh, that I need not to waste any time in recounting them.</hi> heretofore only menaced, is now formidably attempted.<anchor id="i31">11</anchor>
</p>
<p>
<note anchor.ids="i30">10 “generally” has been substituted for “on the whole” (Seward).</note>
</p>
<p>
<note anchor.ids="i31">11 “heretofore only menaced, is now formidably attempted” has been substituted for the stricken passage that precedes it (Seward).</note>
</p>
<p>I hold, that in contemplation of universal law, and of the Constitution, the Union of these States is perpetual.  Perpetuity is implied, if not expressed, in the fundamental law of all national governments.  It is safe to assert that no government proper, ever had a provision in its organic law for its own termination.  Continue to execute all the express provisions of our national Constitution, and the Union will endure forever — it being impossible to destroy it, except by some action not provided for in the instrument itself.</p>
<p>Again, if the United States be not a government proper, but an association of States in the nature of contract merely, can it, as a contract, be peaceably unmade, by less than all the parties who made it?  One party to a contract may violate it — break it, so to speak; but does it not require all to lawfully rescind it?</p>
<p>Descending from these general principles, we find the proposition that, in legal contemplation, the Union is perpetual, confirmed by the history of the Union itself.  The Union is much older than the Constitution.  It was formed in fact, by the Articles of Association in 1774.  It was matured and continued by the Declaration of Independence in 1776.  It was further matured <hi rend="other">and expressly declared and pledged, to be</hi> and the faith of all the then thirteen States expressly plighted and engaged that it should be perpetual, by the Articles of Confederation in 1778.<anchor id="i32">12</anchor>  And finally, in 1787, one of the declared objects for ordaining and establishing the Constitution, was <hi rend="italics">“to form a more perfect union.”</hi>
</p>
<p>
<note anchor.ids="i32">12 “and the faith of all the then thirteen States expressly plighted and engaged that it should be” has been substituted for the stricken matter that precedes it.</note>
</p>
<p>But if destruction of the Union, by one, or by a part only, of the States, be lawfully possible, the Union is <hi rend="italics">less</hi> perfect than before <hi rend="other">, which contradicts</hi> the Constitution, <hi rend="other">and therefore is absurd.</hi> having lost the vital element of perpetuity—<anchor id="i33">13</anchor>
</p>
<p>
<note anchor.ids="i33">13 “having lost the vital element of perpetuity—” has been added to revise and complete the sentence.</note>
</p>
<p>It follows from these views that no State, upon its own mere motion, can lawfully get out of the Union, — that <hi rend="italics">resolves</hi> and <hi rend="italics">ordinances</hi> to that effect are legally <hi rend="other">nothing;</hi> void; and that acts of violence, within and State or States, against the authority of the United States, are insurrectionary or <hi rend="other">treasonable</hi> revolutionary, according to circumstances. <anchor id="i34">14</anchor>
</p>
<p>
<note anchor.ids="i34">14 In this sentence “void” has been substituted for “nothing”, and “revolutionary” has been substituted for “treasonable” (Seward).</note>
</p>
<p>[Page 4]</p>
<p>
<hi rend="other">I therefore consider that the Union is unbroken; and, to the extent of my ability, I shall take care that the laws of the Union be faithfully executed in all the States.</hi>  I therefore consider that, in view of the constitution and the laws, the Union is unbroken; and, to the extent of my ability, I shall take care, as the constitution itself expressly enjoins upon me, that the laws of the Union be faithfully executed in all the states.<anchor id="i35">15</anchor>  Doing this I deem to be only a simple duty on my part; and I shall perform it, so far as practicable, unless my rightful masters, the American people, shall withhold the requisite means, or, in some <hi rend="other">tangible way</hi> authoritative manner,<anchor id="i36">16</anchor> direct the contrary.  I trust this will not be regarded as a menace, but only as the declared purpose of the Union that it <hi rend="italics">will</hi>
<hi rend="other">have its own, and</hi>
<hi rend="other">
<hi rend="italics">defend</hi> itself.</hi> constitutionally defend, and maintain itself—<anchor id="i37">17</anchor>
</p>
<p>
<note anchor.ids="i35">15 On a slip covering the stricken sentence, Lincoln wrote out the revision that follows it.  This incorporates two phrases suggested by William H. Seward: “in the view of the constitution and the laws,” and “as the constitution itself expressly enjoins upon me.”</note>
</p>
<p>
<note anchor.ids="i36">16 “authoritative manner” has been substituted for “tangible way” (Seward).</note>
</p>
<p>
<note anchor.ids="i37">17 “constitutionally defend, and maintain itself—” has been substituted for the stricken matter (Seward).</note>
</p>
<p>In doing this there needs to be no bloodshed or violence; and there shall be none, unless it be forced upon the national authority.  <hi rend="other">All the power at my disposal will be used to reclaim the public property and places which have fallen; to hold, occupy and possess these, and all other property and places belonging to the government, and to collect the duties on imposts; but beyond what may be necessary for these objects, there will be no invasion of any State.</hi>  The power confided to me, will be used to hold, occupy, and possess the property, and places belonging to the government, and to collect the duties [<hi rend="other">on?</hi>] and imposts; but beyond what may be necessary for these objects, there will be no invasion — no using of force against, or among the people anywhere—<anchor id="i38">18</anchor>  Where hostility to the United States, in any interior locality, shall be so great and so universal, as to prevent competent resident citizens from holding the Federal offices, there will be no attempt to force obnoxious strangers among the people for that object.  While the strict legal right may exist in the government to enforce the exercise of these offices, the attempt to do so would be so irritating, and so nearly impracticable with all, that I deem it better to forego, for the time, the uses of such offices.</p>
<p>
<note anchor.ids="i38">18 “All the power at my disposal will be” has been stricken, and the balance of this sentence as originally printed has been either covered over or cut out of the page and discarded.  Lincoln substituted on a slip a long sentence commencing with a phrase suggested by Seward, “The power confided to me,” ignoring the rest of his suggested wording, while following Orville H. Browning's advice to drop the references to “reclaiming” property that has “fallen.”  On the same slip, he pasted the printed text of the two sentences that follow, then added by hand the sentence beginning “The course here indicated.” (Seward); See also Browning to Lincoln, February 17, 1861.</note>
</p>
<p>The mails, unless <hi rend="other">refused</hi> repelled,<anchor id="i39">19</anchor> will continue to be furnished in all parts of the Union.  So far as possible, the people everywhere shall have that sense of perfect security which is most favorable to calm thought and reflection.  <hi rend="other">This course will be pursued until current experience shall show a modification or change to be proper.</hi>  The course here indicated will be followed, unless current events, and experience, shall show a modification, or change, to be proper; and in every case and exigency, my best discretion will be exercised, according to circumstances actually existing, and with a view and a hope of a peaceful solution of the national troubles, and the restoration of paternal sympathies and, affections—<anchor id="i40">20</anchor>
</p>
<p>
<note anchor.ids="i39">19 “repelled” has been substituted for “refused.”</note>
</p>
<p>
<note anchor.ids="i40">20 The deleted sentence “This course will be pursued . . .” has been cut out of the printed text and discarded.  In its place Lincoln wrote out on the slip described above a substantial revision, which begins “The course here indicated.” </note>
</p>
<p>That there are persons in one section, or another<anchor id="i41">21</anchor> who seek to destroy the Union at all events, and are glad of any pretext to do it, I will neither affirm or deny; but if there be such, I need address no word to them.  To those, however, who really love the Union, may I not speak?</p>
<p>
<note anchor.ids="i41">21 “in one section, or another” has been added, which is very close to Seward's suggestion: “in one section as well as in the other.”</note>
</p>
<p>Before entering upon so grave a matter as the destruction of our national <hi rend="other">Union,</hi> fabric, with all its benefits, it's memories, and it's hopes, would it not be wise to ascertain precisely why we do it?  Will you hazard so desperate a step, while there is any possibility that any portion of the ills you fly from, have no real existence?  Will you, while the certain ills you fly to, are greater than all the real ones you fly from?  Will you risk the commission of so fearful a mistake? <anchor id="i42">22</anchor>
</p>
<p>
<note anchor.ids="i42">22 “fabric, with all its benefits, it's memories, and it's hopes,” has been substituted for “Union,”.  A comma has been after the word “from”.</note>
</p>
<p>All profess to be content in the Union, if all constitutional rights can be maintained.  Is it true, then, that any <hi rend="other">distinct</hi>
<anchor id="i43">23</anchor> right, plainly written in the Constitution, has been denied?  I think not.  Happily the human mind is so <hi rend="other">constructed,</hi> constituted,<anchor id="i44">24</anchor> that no party can reach to the audacity of doing this.  Think, if you can, of a single instance in </p>
<p>[Page 5]</p>
<p>which a plainly written provision of the Constitution has ever been denied.  If, by the mere force of numbers, a majority should deprive a minority of any clearly written constitutional right, it might, in a moral point of view, justify revolution — certainly would, if such right were a vital one<hi rend="other">; — b</hi>.  But such is  not our case.<anchor id="i45">25</anchor>  All the vital rights of minorities, and of individuals, are so plainly assured to them, by affirmations and negations guarranties and prohibitions, <anchor id="i46">26</anchor> in the Constitution, that controversies never arise concerning them.  But no organic law can ever be framed with a provision specifically applicable to every <hi rend="other">possible</hi>
<anchor id="i47">27</anchor> question which may occur in practical administration.  No foresight can anticipate, nor any document of reasonable length contain express provisions for all possible questions.  Shall fugitives from labor be surrendered by national or by State authority?  The Constitution does not expressly say.  <hi rend="italics">May</hi> Congress prohibit slavery in the territories?  The Constitution does not expressly say.  <hi rend="italics">Must</hi> Congress protect slavery in the territories?  The Constitution does not expressly say.</p>
<p>
<note anchor.ids="i43">23 Lincoln first inserted “distinct” (Seward), then struck it out.</note>
</p>
<p>
<note anchor.ids="i44">24 “constituted” has been substituted for “constructed”.</note>
</p>
<p>
<note anchor.ids="i45">25 Lincoln changed “vital one; — but” to “vital one.  But”.</note>
</p>
<p>
<note anchor.ids="i46">26 Lincoln added “guarranties and prohibitions,” (Seward).</note>
</p>
<p>
<note anchor.ids="i47">27 Lincoln first added “possible” (Seward), but then struck it out.</note>
</p>
<p>From questions of this class spring all our constitutional controversies, and we divide upon them into majorities and minorities.  If the minority will not <hi rend="other">submit</hi> acquiesce,<anchor id="i48">28</anchor> the majority must, or the government must cease.  There is no other alternative; for continuing the government, is <hi rend="other">submission</hi> acquiescence<anchor id="i49">29</anchor> on one side or the other.  If a minority, in such case, will secede rather than <hi rend="other">submit</hi> acquiesce, <anchor id="i50">30</anchor> they make a precedent which, in turn, will divide and ruin them; for a minority of their own <hi rend="other">number</hi> will secede from them,<anchor id="i51">31</anchor> whenever a majority refuses to be controlled by such minority.<hi rend="other">For instance, why may not South Carolina, a year or two hence, arbitrarily, secede from a new Southern Confederacy, just as she now claims to secede from the present Union?  Her people, and, indeed, all secession people, are now being educated to the precise temper of doing this.</hi>
<anchor id="i52">32</anchor> For instance, why may not any portion of a new confederacy, a year or two hence, arbitrarily secede again, precisely as portions of the present Union now claim to secede from it.  All who cherish disunion sentiments are now being educated to the exact temper of doing this.  Is there such perfect identity of interests among the States to compose a <hi rend="other">Southern</hi> new<anchor id="i53">33</anchor> Union, as to produce harmony only, and prevent renewed secession?</p>
<p>
<note anchor.ids="i48">28 “acquiesce” is substituted for “submit” (Seward).</note>
</p>
<p>
<note anchor.ids="i49">29 “acquiescence” is substituted for “submission” (Seward).</note>
</p>
<p>
<note anchor.ids="i50">30 “acquiesce” is substituted for “submit” (Seward).</note>
</p>
<p>
<note anchor.ids="i51">31 Comma added.</note>
</p>
<p>
<note anchor.ids="i52">32 In his previous draft (Abraham Lincoln, First Inaugural, Second Printed Draft, with Changes in Lincoln's Hand [February or March, 1851]), Lincoln had revised this same passage to read “For instance, why may not any portion of a  new Confederacy, a year or two hence, arbitrarily, secede again, just as the larger number now claim to secede from the present Union All who cherish secession ideas, are now being educated to the precise temper of doing this.”  The newly revised version, which follows, has been written on a slip that extends the page so as to accommodate this and two additional handwritten revisions, interspersed between clippings of the printed text that have been pasted on the slip.</note>
</p>
<p>
<note anchor.ids="i53">33 “new” has been substituted for “Southern”.</note>
</p>
<p>Plainly, the central idea of secession, is the essence of anarchy.  A majority, held in restraint by constitutional checks, and limitations, and always changing easily, with deliberate changes of popular opinions and sentiments, is the only true sovereign of a free people.<anchor id="i54">34</anchor>  Whoever rejects it, does, of necessity, fly to anarchy or to despotism.  Unanimity is impossible; the rule of a minority, as a permanent arrangement, is wholly inadmissable; so that, rejecting the majority principle, anarchy, or despotism in some form, is all that is left.<anchor id="i55">35</anchor>
</p>
<p>
<note anchor.ids="i54">34 This sentence has been revised along the lines suggested by Seward, who wrote: “After the word ‘anarchy,’ strike out the next sentence and write A majority held in restraint by Constitutional checks and limitations and always changing easily with deliberate changes of popular opinions and sentiments is &amp;c.” See William H. Seward, Suggested Changes to First Inaugural Address [February, 1861].</note>
</p>
<p>
<note anchor.ids="i55">35 Commas have been added after “anarchy” and “form”.</note>
</p>
<p>I do not forget the position assumed by some, that constitutional questions are to be decided by the Supreme Court; nor do I deny that such decisions must be binding in any case, upon the parties to a suit, as to the object of <hi rend="other">the</hi> that suit, while they are also entitled to a very high respect and consideration, in all paralel cases, by all other departments of the government—<anchor id="i56">36</anchor>  And while it is obviously possible that such decision may be erroneous in any given case, still the evil effect following it, being limited to that particular case, with the chance that it may be over-ruled, and never become a precedent for other cases, can better be borne than </p>
<p>[Page 6]</p>
<p>
<hi rend="other">could the greater evils of a different rule</hi> practice<hi rend="other">.</hi>
<anchor id="i57">37</anchor>
<hi rend="other">But if the policy of the government, upon vital questions affecting the whole people, is to be irrevocably fixed by decisions of the Supreme Court, it is plain that the people will have ceased to be their own rulers, having turned their government over to the despotism of the few life-officers composing the Court.  Nor is there, in this view, any assault upon the Court or the judges.  It is a duty from which they may not shrink, to decide cases properly brought before them; and it is no fault of theirs if others seek to turn their decisions to political purposes.</hi>
</p>
<p>
<note anchor.ids="i56">36 This sentence previously ended “the object of the suit.”  In this draft, Lincoln changed the last phrase to “that suit” and added the language that follows, which was suggested by Seward.</note>
</p>
<p>
<note anchor.ids="i57">37 Before deciding to rewrite this sentence and the balance of the paragraph to which it belongs, Lincoln substituted the word “practice” for “rule” (Seward).</note>
</p>
<p>
<hi rend="other">The Republican party, as I understand, have avowed the purpose to prevent, if they can, the extension of slavery, under the national auspices; and upon this arises the only dispute between the sections.</hi>
<anchor id="i58">38</anchor>
</p>
<p>
<note anchor.ids="i58">38 This paragraph, and the portion of the preceding paragraph “could the evils . . .to political purposes,” were covered by the slip on which Lincoln wrote a revision.  The revised passage, which follows, eliminated this paragraph entirely and incorporated three instances of wording suggested by Seward: “At the same time the candid citizen must confess that”; “made in the ordinary course of litigation between parties in personal actions”; “practically <hi rend="other">confided</hi> resigned their government <hi rend="other">to it</hi> into the heands of that eminent tribunal.”</note>
</p>
<p>could the evils of a different practice.  At the same time the candid citizen must confess, that if the policy of the government, upon vital questions, affecting the whole people, is to be irrevocably fixed by decisions of the Supreme Court, the instant they are made, in ordinary litigation between parties, in personal actions, <hi rend="other">it is plain that</hi> the people will have ceased, <hi rend="other">to</hi> to be their own rulers, having, to that extent, practically resigned their government, into the hands of that eminent tribunal.  Nor is there, in this view, any assault upon the Court, or the judges—  It is a duty, from which they may not shrink, to decide cases properly brought before <hi rend="other">brought before</hi> them; and it is no fault of theirs, if others seek to turn their decisions to political purposes.</p>
<p>One section of our country<anchor id="i59">39</anchor> believes slavery is <hi rend="italics">right,</hi> and ought to be extended, while the other believes it is <hi rend="italics">wrong,</hi> and ought not to be extended.  This is the only substantial dispute.  The fugitive slave clause of the Constitution, and the law for the suppression of the foreign slave trade, are each as well enforced, perhaps<anchor id="i60">40</anchor> as any law can ever be in a community where the moral sense of the people <hi rend="other">is against</hi> imperfectly supports<anchor id="i61">41</anchor> the law itself.  The great body of the people abide by the dry legal obligation in both cases, and a few break over in each  This, I think, cannot be perfectly cured; and it would be worse in both cases <hi rend="italics">after</hi> the separation of the sections, than before.  The foreign slave trade, now imperfectly suppressed, would be ultimately<anchor id="i62">42</anchor> revived without restriction, in one section; while fugitive slaves, now only partially surrendered, would not be surrendered at all, by the other.</p>
<p>
<note anchor.ids="i59">39 “of our country” added (Seward).</note>
</p>
<p>
<note anchor.ids="i60">40 “perhaps” added (Seward).</note>
</p>
<p>
<note anchor.ids="i61">41 “imperfectly supports” substituted for “is against” (Seward).</note>
</p>
<p>
<note anchor.ids="i62">42 “ultimately” added (Seward).</note>
</p>
<p>Physically speaking, we cannot separate.  We cannot remove our respective sections from each other, nor build an impassable wall between them.  A husband and wife may be divorced, and go out of the presence, and beyond the reach of each other; but the different parts of our country cannot do this.  They cannot but remain face to face; and intercourse, either amicable or hostile, must continue between them.  Is it possible <hi rend="other">possible</hi> then<anchor id="i63">43</anchor> to make that intercourse more advantageous,<anchor id="i64">44</anchor> or more<anchor id="i65">45</anchor> satisfactory, <hi rend="italics">after</hi> separation than <hi rend="italics">before?</hi> Can aliens make treaties easier than friends can make laws?  Can treaties be more faithfully enforced between aliens,<anchor id="i66">46</anchor> than laws can among friends?  Suppose you go to war, you cannot fight always; and when, after much loss on both sides, and no gain on either, you cease fighting, the identical old questions, as to terms of intercourse, are again upon you.</p>
<p>
<note anchor.ids="i63">43 “<hi rend="other">possible</hi> then” added.</note>
</p>
<p>
<note anchor.ids="i64">44 Comma added.</note>
</p>
<p>
<note anchor.ids="i65">45 “more” added.</note>
</p>
<p>
<note anchor.ids="i66">46 Comma added.</note>
</p>
<p>This country, with its institutions, belongs to the people who inhabit it.  Whenever they shall grow weary of the existing government, they can exercise their <hi rend="italics">constitutional</hi> right of amending it, or their <hi rend="italics">revolutionary</hi> right to dismember, or overthrow [it.]<anchor id="i67">47</anchor>
<hi rend="other">As I am not much impressed with the belief that the present Constitution can be</hi>  I can not be ignorant of the fact that many worthy, and patriotic citizens are desirous <hi rend="other">that</hi> of having the national constitution <hi rend="other">shall be</hi> amended.  While I make no recommendation of amendments, I fully recognize the rightful authority of the people over the whole subject, to be exercised in either of the modes prescribed in the instrument itself; and I should, under existing circumstances, favor, rather than oppose, a fair oppertunity being afforded the people to act upon it—</p>
<p>
<note anchor.ids="i67">47 A comma has been added after the word “dismember”.  The word “it” has been inadvertently covered, along with the partial sentence (completed on the next page) that follows, has been covered over by a slip on which Lincoln has written the replacement text, which begins “I can not be ignorant.”</note>
</p>
<p>[page 7]</p>
<p>
<hi rend="other">improved, I make no recommendations of amendments.  I am, rather, for the old ship, and the chart of the old pilots.  If, however, the people desire a new, or an altered vessel, the matter is exclusively their own, and they can move in the premises, as well without as with an executive recommendation.  I shall place no obstacle in the way of what may appear to be their wishes.</hi>
</p>
<p>I will venture to add that, to me, the Convention mode seems preferable, in that it allows amendments to originate with the people themselves, instead of <hi rend="other">allowing</hi> only permitting them <hi rend="other">merely</hi> to take, or reject, propositions, originated by others, not especially chosen for the purpose, and which might not be precisely such, as they would wish to either accept or <hi rend="other">reject.</hi> refuse.<anchor id="i68">48</anchor> I understand a proposed amendment to the constitution which amendment, however, I have not seen, has passed <hi rend="other">the House of Representatives</hi> Congress, to the effect that the federal government, shall never interfere with the domestic institutions of the States, including that of persons held to service—<anchor id="i69">49</anchor>  To avoid misconstruction of what I have said, I depart from my purpose not to speak of particular amendments, so far as to say that, holding such a provision to now be implied Constitutional law, I have no objection to it's being made express, and irrevocable—</p>
<p>
<note anchor.ids="i68">48 This sentence has been written by Lincoln on a slip that covered the deleted printed text. The two sentences that follow this one have been written on a separate slip, which was apparently attached to the first slip as an addendum.</note>
</p>
<p>
<note anchor.ids="i69">49 A proposed Thirteenth Amendment to the Constitution, affirming the right of states to regulate slavery within their limits, had barely passed both Houses of Congress.  It had passed the Senate just hours before Lincoln's inauguration.</note>
</p>
<p>The Chief Magistrate derives all his authority from the people, and they have conferred none upon him to fix terms for the separation of the States.  The people themselves can do this also<anchor id="i70">50</anchor> if they choose; but the executive, as such, has nothing to do with it.  His duty is to administer the present government, as it came to his hands, and to transmit it, unimpaired by him, to his successor.</p>
<p>
<note anchor.ids="i70">50 “also” has been added.</note>
</p>
<p>Why should there not be a patient confidence in the ultimate justice of the people?  Is there any better, or equal hope, in the world?<anchor id="i71">51</anchor>  In our present differences, is either party without faith of being<anchor id="i72">52</anchor> in the right?  If the Almighty Ruler of nations, with his eternal truth and justice, be on <hi rend="other">our side, or on yours,</hi> on your side of the North, or on yours of the South,<anchor id="i73">53</anchor> that truth, and that justice, will surely prevail, by the judgment of this great tribunal, the American people.</p>
<p>
<note anchor.ids="i71">51 A comma has been added after the word “better”.</note>
</p>
<p>
<note anchor.ids="i72">52 “of being” has been added.</note>
</p>
<p>
<note anchor.ids="i73">53 “on your side of the North, or on yours of the South,” has been substituted for “our side, or on yours”.</note>
</p>
<p>By the frame of the government under which we live, this same people have wisely given their public servants but little power for mischief: and have, with equal wisdom, provided for the return of that little to their own hands at very short intervals.</p>
<p>While the people <hi rend="other">remain patient, and true to themselves, no man, even in the presidential chair</hi> retain their virtue, and vigilence, no administration <hi rend="other">can</hi>,<anchor id="i74">54</anchor> by any extreme of wickedness or folly, can very seriously injure the government,<anchor id="i75">55</anchor> in the short space of four years.</p>
<p>
<note anchor.ids="i74">54 “retain their virtue, and vigilence, no administration <hi rend="other">can,</hi>” has been substituted for “remain patient, and true to themselves, no man, even in the presidential chair” (Seward).</note>
</p>
<p>
<note anchor.ids="i75">55 A comma has been added after the word “government”.</note>
</p>
<p>My countrymen, one and all, <hi rend="other">take <hi rend="italics">time</hi>  and think</hi> think calmly and<anchor id="i76">56</anchor>
<hi rend="italics">well,</hi> upon this whole subject.  Nothing valuable can be lost by taking time.  <hi rend="other">Nothing worth preserving is either breaking or burning.</hi>
<anchor id="i77">57</anchor> If there be an object to <hi rend="italics">hurry</hi> any of you, in hot haste, to a step which you would never take <hi rend="italics">deliberately,</hi> that object will be frustrated by taking time; but no good object can be frustrated by it.  Such of you as are now dissatisfied, still have the old Constitution unimpaired, and, on the sensitive point, the laws of your own framing under it; while the new administration will have no immediate power, if it would, to change either.  If it were admitted that you who are dissatisfied, hold the right side in the dispute, there still is no single good reason for precipitate action.  Intelligence, patriotism, Christianity, and a firm reliance on Him, who has never yet forsaken this favored land, are still competent to adjust, in the best way, all our present difficulty.</p>
<p>
<note anchor.ids="i76">56 “think calmly and” has been substituted for “take <hi rend="italics">time</hi> and think” (Seward).</note>
</p>
<p>
<note anchor.ids="i77">57 The deletion of these words was urged by Seward.</note>
</p>
<p>In <hi rend="italics">your</hi> hands, my dissatisfied fellow countrymen, and not in <hi rend="italics">mine,</hi> is the momentous issue of civil war.  The government will not assail <hi rend="italics">you.</hi>
<hi rend="other">unless you <hi rend="italics">first</hi> assail <hi rend="italics">it</hi>.</hi>
<anchor id="i78">58</anchor> You can have no conflict, without being yourselves the aggressors.  <hi rend="italics">You</hi> have no oath registered in Heaven to destroy the government, while <hi rend="italics">I</hi> shall have the most solemn one to “preserve, protect and defend” it. <hi rend="other">
<hi rend="italics">You</hi> can forbear, the <hi rend="italics">assault</hi> upon it; <hi rend="italics">I</hi> can <hi rend="italics">not</hi> shrink from the <hi rend="italics">defense</hi> of it.  With <hi rend="italics">you,</hi> and not with <hi rend="italics">me,</hi> is the solemn question of “Shall it be peace, or a sword?”</hi>
<anchor id="i79">59</anchor>
</p>
<p>
<note anchor.ids="i78">58 The deletion of these words was urged by Seward.</note>
</p>
<p>
<note anchor.ids="i79">59 The decision to remove the challenge from the original conclusion in favor of conciliation seems clearly to have been influenced by Seward's admonitions, including a recommendation to delete these two sentences.</note>
</p>
<p>I am loth to close.  We are not enemies, but friends—  We must not be enemies.  Though passion may have strained, it must not break our bonds of affection.  The mystic chords of memory<hi rend="other">s</hi>, streching from every battlefield, and patriot grave, to every living heart and hearthstone, all over this broad land, will yet swell the chorus of the Union, when again touched, as surely they will be, by the better angels of our nature.<anchor id="i80">60</anchor>
</p>
<note anchor.ids="i80">
<p>60 The presence of a pointing hand, characteristically drawn by Lincoln, seems to indicate that the handwritten addition “I am loth to close . . .” was intended as a separate paragraph.</p>
<p>Lincoln's indebtedness to, and masterful transformation of, Seward's suggested closing paragraph have long been recognized.  Seward's text is as follows: “I close. We are not we must not be aliens or enemies but <hi rend="other">countrym</hi> fellow countrymen and brethren.  Although passion has strained our bonds of affection too hardly they must not <hi rend="other">be broken — they will not</hi>, I am sure they will not be broken.  The mystic chords which proceeding from <hi rend="other">every ba</hi> so many battle fields and <hi rend="other">patriot</hi> so many patriot graves <hi rend="other">bind</hi> pass through all the hearts and <hi rend="other">hearths</hi> all the hearths in this broad continent of ours will yet <hi rend="other">harmon</hi> again harmonize in their ancient music when <hi rend="other">touched as they surely</hi> breathed upon <hi rend="other">again</hi> by the <hi rend="other">better angel</hi> guardian angel of the nation”. See William H. Seward, Suggested Changes to First Inaugural Address [February, 1861].</p>
<p>That Lincoln took time to ponder the advice of both Browning and Seward before writing out his closing paragraph is suggested by the phrasing of what he wrote on the back of Browning's letter of February 17: “Americans, all, we are not enemies, but friends—  We have sacred ties of affection which, though strained by passions, let us hope can never be broken”.</p>
</note>
</div>
        </body>
    </text>
</tei2>
`;

/**
 * `0240090a.xml` (Rare Book printed ephemera: an 1812 New Orleans license form; captured
 * 2026-11-13), verbatim: a printed `<text type="publication">` holding `<superscript>`, `<hsep/>`,
 * an `<omit/>`, and a handwritten `<note>`.
 */
export const RARE_BOOK_LICENSE_TEI = `<?xml version="1.0" encoding="utf-8"?>

<!--<DOCTYPE tei2 SYSTEM "/itssgml/sgmlstd/dtds/ammem2/ammem2_xml.dtd"> -->
<!--
<!DOCTYPE tei2
  SYSTEM "/itssgml/sgmlstd/dtds/ammem2/ammem2axml_noURLs.dtd"
[<!ENTITY % images SYSTEM "0240090a_upd.ent">
%images;]>
-->


<tei2>
   <teiheader type="text" creator="National Digital Library Program, Library of Congress" status="new" date.created="1998/10/15">
      <filedesc>
         <titlestmt>
            <amid type="aggitemid">rbpe02-0240090a</amid>
            <title>Etat de la Louisiane. Cité et Paroisse d'Orléans. No. [blank] Mairie de la Nouvelle-Orleans. Vu l'article premier de l'ordonnance du Conseil de Ville approuvée le 28 Mai 1812, additionnelle à celle relative aux tueries; vu pareillement le cautionnement de cinq cents piastres fourni en cet office par Mr. [blank] qui réunit d'ailleurs les qualités exigées par ladite ordonnance. Il est permis audit Sieur de tenir une Tuerie sur [blank] Et ce pour le temps et espace d'un année à compter de ce jour; à l'effet de quoi, je lui ai délivré la présente Licence sous le No. [blank] pour lui servir et valoir ce que de droit. Nouvelle-Orleans. [1812].: a machine-readable transcription.</title>
            <amcol>
               <amcolname>An American Time Capsule: Three Centuries of Broadsides and Other Printed Ephemera.</amcolname>
               <amcolid type="aggid"/>
            </amcol>
            <respstmt>
               <resp>Selected and converted.</resp>
               <name>American Memory, Library of Congress.</name>
            </respstmt>
         </titlestmt>
         <publicationstmt>
            <p>Washington, DC, 1998.</p>
            <p>Preceding element provides place and date of transcription only.</p>
            <p>For more information about this text and this American Memory collection, refer to accompanying matter.</p>
         </publicationstmt>
         <sourcedesc>
            <lccn/>
            <sourcecol>Printed Ephemera Collection, Rare Book and Special Collections Division, Library of Congress.</sourcecol>
            <copyright>Copyright status not determined; refer to accompanying matter.</copyright>
         </sourcedesc>
      </filedesc>
      <encodingdesc>
         <projectdesc>
            <p>The National Digital Library Program at the Library of Congress makes digitized historical materials available for education and scholarship.</p>
         </projectdesc>
         <editorialdecl>
            <p>This transcription is intended to have an accuracy of 99.95 percent or greater and is not intended to reproduce the appearance of the original work. The accompanying images provide a facsimile of this work and represent the appearance of the original.</p>
         </editorialdecl>
         <encodingdate>1998/10/15</encodingdate>
         <revdate/>
      </encodingdesc>
   </teiheader>
   <text type="publication">
      <pageinfo>
         <controlpgno entity="p001dr">001</controlpgno>
         <printpgno/>
      </pageinfo>
      <body>
         <div>
            <p>ETAT DE LA LOUISIANE.</p>
            <p>
               <hi rend="italics">Cité et Paroisse d'Orléans.</hi>
            </p>
            <p>N
<superscript>o.</superscript>
            </p>
         </div>
         <div>
            <head>MAIRIE DE LA NOUVELLE-ORLEANS.</head>
            <p>
               <hi rend="smallcaps">Vu</hi>
 l'Article Premier de l'Ordonnance du Conseil de Ville approuvée le 28 Mai 1812, additionnelle à celle relative aux Tueries; vu pareillement le Cautionnement de cinq cents Piastres fourni en cet Office par Mr.<lb/>
qui réunit d'ailleurs les qualités exigées par ladite Ordonnance.</p>
            <p>Il est permis audit Sieur<lb/>
de tenir une Tuerie sur</p>
            <p>Et ce pour le temps et espace d'une année, á compter de ce jour; à<lb/>
l'effet de quoi, je lui ai délivré la présente Licence sous le N
<superscript>o.</superscript>
               <lb/>
pour lui servir et valoir ce que de droit.</p>
            <p>
               <hi rend="italics">Nouvelle - Orléans, le</hi>
            </p>
            <p>
               <handwritten>
                  <omit reason="illegible" extent="1w"/>
               </handwritten>
            </p>
            <note>
               <handwritten>5r/5198<lb/>
51<hsep/>
39</handwritten>
            </note>
         </div>
      </body>
   </text>
</tei2>
`;

/**
 * African American Pamphlet Collection `rbaapc.20300` page 1 (captured 2026-11-13), cut to the
 * fields the service reads: a printed pamphlet with no per-page text service, its TEI transcription
 * as `resource.fulltext_file`, and no `fulltext_attribution`.
 */
export const RARE_BOOK_PAMPHLET_PAGE_1 = {
  item: {
    title:
      "Celebration by the Colored People's Educational Monument Association in memory of Abraham Lincoln, on the Fourth of July, 1865, in the Presidential grounds, Washington, D.C.",
    url: 'https://www.loc.gov/item/12030032/',
  },
  resource: {
    fulltext_file: 'https://tile.loc.gov/storage-services/service/rbc/rbaapc/20300/20300.xml',
    segment_count: 36,
    url: 'https://www.loc.gov/resource/rbaapc.20300/',
  },
  fulltext_service: {},
};

/**
 * `20300.xml`, the transcription {@link RARE_BOOK_PAMPHLET_PAGE_1} names (captured 2026-11-13,
 * 101,233 bytes), cut to file lines 1-12, 49, 104-109, 346-375, 1069-1092, 1157-1161 and the
 * closing lines: a printed letter whose `*` footnote mark (`<anchor>`) and footnote
 * (`<note anchor.ids>`) are printed on the page, a list of officers headed in display type
 * (`<hi rend="other">`), and the APPEAL heading. Five lines end in a space, as captured, each
 * written `\x20`.
 */
export const RARE_BOOK_PAMPHLET_TEI_EXCERPT = `<?xml version="1.0" encoding="utf-8"?>

<!--<DOCTYPE tei2 SYSTEM "/itssgml/sgmlstd/dtds/ammem2/ammem2_xml.dtd"> -->
<!--
<!DOCTYPE tei2
  SYSTEM "/itssgml/sgmlstd/dtds/ammem2/ammem2axml_noURLs.dtd"
[<!ENTITY % images SYSTEM "20300_upd.ent">
%images;]>
-->


<tei2>
   <text type="publication">
      <body>
         <pageinfo>
            <controlpgno entity="p0003z">0003</controlpgno>
            <printpgno/>
            <blankpage/>
         </pageinfo>
            <p>LETTER FROM HON. SALMON P. CHASE, CHIEF JUSTICE OF THE UNITED STATES.</p>
            <p>
               <hi rend="smallcaps">Wakefield, R. I.,</hi>
\x20
               <hi rend="italics">Aug.</hi>
 16, 1865.</p>
            <p>
               <hi rend="smallcaps">Gentlemen:</hi>
 Your letter, of the 28th ult., reached me here, after some delay. I did not receive your invitation to the celebration on the 4th, or I should have thanked you for it earlier. I enclose a letter which expresses my sentiments.<anchor id="n0010-01">*</anchor>
            </p>
            <note anchor.ids="n0010-01" place="bottom">
               <p>* <hi rend="smallcaps">New Orleans,</hi>\x20
                  <hi rend="italics">June</hi> 6, 1865.</p>
               <p>
                  <hi rend="smallcaps">Gentlemen:</hi> I should hardly feel at liberty to decline the invitation you have tendered me in behalf of the loyal colored Americans of New Orleans, to speak to them on the subject of their rights and duties as citizens, if I had not quite recently expressed my views at Charleston, in an address, reported with substantial accuracy, and already published in one of the most widely circulated journals of this city. But it seems superfluous to repeat them before another audience.</p>
               <p>It is proper to say, however, that those views, having been formed years since, on much reflection, and confirmed, in a new and broader application, by the events of the civil war now happily ended, are not likely to undergo, hereafter, any material change.</p>
               <p>That native freemen, of whatever complexion, are citizens of the United States; that all men held as slaves in the States which joined in rebellion against the United States have become freemen through executive and legislative acts during the war: and that these freemen are now citizens, and consequently entitled to the rights of citizens, are propositions which, in my judgment, cannot be successfully controverted. And it is both natural and right that colored Americans, entitled to the rights of citizens, should claim their exercise. They should persist in this claim respectfully, but firmly, taking care to bring no discredit upon it by their own action. Its justice is already acknowledged by great numbers of their white fellow citizens, and these numbers constantly increase.</p>
               <p>The peculiar conditions, however, under which these rights arise, seem to impose on those who assert them peculiar duties, or rather special obligations to the discharge of common duties. They should strive for distinction by economy, by industry, by sobriety, by patient perseverance in well-doing, by constant improvement in religious instruction, and by the constant practice of Christian virtues. In this way they will surely overcome unjust hostility, and convince even the most prejudiced that the denial to them of any right which citizens may properly exercise, is equally unwise and wrong.</p>
               <p>Our national experience has demonstrated that public order reposes most securely on the broad basis of universal suffrage. It has proved, also, that universal suffrage is the surest guarantee and most powerful stimulus of individual, social, and political progress. May it not prove, moreover, in that work of re-organization which now engages the thoughts of all patriotic men, that universal suffrage is the best reconciler of the most comprehensive lenity with the most perfect public security and the most speedy and certain revival of general prosperity?</p>
               <p>Very respectfully, yours,<hsep/>
S. P. CHASE.</p>
               <p>Messrs.\x20
<hi rend="smallcaps">J. B. Roudanez, L. Gois,</hi> and\x20
<hi rend="smallcaps">L. Banks,</hi>\x20
                  <hi rend="italics">Committee.</hi>
               </p>
            </note>
            <p>To-morrow morning, I shall be in Washington, if nothing unforeseen shall prevent.</p>
            <p>Yours truly,<hsep/>
S. P. CHASE.</p>
            <list type="simple">
               <head>
                  <hi rend="other">OFFICERS</hi>
                  <lb/>
OF THE<lb/>
                  <hi rend="other">National Lincoln Monument Association.</hi>
               </head>
               <item>
                  <list type="simple">
                     <head>PRESIDENT.</head>
                     <item>
                        <p>
                           <hi rend="smallcaps">Rev.</hi> HENRY H. GARNET.</p>
                     </item>
                  </list>
               </item>
               <item>
                  <list type="simple">
                     <head>VICE PRESIDENT.</head>
                     <item>
                        <p>JAMES WORMLEY.</p>
                     </item>
                  </list>
               </item>
            </list>
            <p>
               <hi rend="other">APPEAL</hi>
               <lb/>
TO THE FRIENDS OF PROGRESS EVERYWHERE.</p>
      </body>
   </text>
</tei2>
`;

/** Newspaper `sn83030214/1912-04-16/ed-1` page 1: `fulltext_file` and `fulltext_service` are the same URL. */
export const NEWSPAPER_PAGE_1 = {
  item: {
    title: 'New-York tribune (New York [N.Y.]), April 16, 1912',
    newspaper_title: ['New-York tribune'],
    partof_title: ['new-york tribune (new york [n.y.]) 1866-1924'],
    location_state: ['new york'],
    place_of_publication: 'New York [N.Y.]',
    number_edition: ['1'],
    date_issued: '1912-04-16',
    url: 'https://www.loc.gov/item/sn83030214/1912-04-16/ed-1/',
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
    title: 'The Newberry herald and news (Newberry, S.C.), January 24, 1902',
    newspaper_title: ['The Newberry herald and news'],
    partof_title: ['the newberry herald and news (newberry, s.c.) 1884-1903'],
    location_state: ['south carolina'],
    place_of_publication: 'Newberry, S.C.',
    number_edition: ['2'],
    date_issued: '1902-01-24',
    url: 'https://www.loc.gov/item/sn93067777/1902-01-24/ed-2/',
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
