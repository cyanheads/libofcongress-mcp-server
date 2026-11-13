/**
 * @fileoverview Tests for the TEI transcription reader: the reading text of captured Lincoln, Bell,
 * California Gold, and Rare Book files, each element of its handling table in manuscript and in
 * print, the bodies it refuses as not a transcription, and its scan time over upstream-sized worst
 * cases.
 * @module tests/services/tei-text.test
 */

import { describe, expect, it } from 'vitest';
import { teiReadingText } from '@/services/loc-api/tei-text.js';
import {
  BELL_CARD_TEI,
  CALIFORNIA_GOLD_ABALONE_TEI,
  CORNING_DRAFT_TEI_EXCERPT,
  FIRST_INAUGURAL_TEI_EXCERPT,
  GETTYSBURG_NICOLAY_TEI,
  MANUSCRIPT_PAGE_3_TEXT,
  RARE_BOOK_LICENSE_TEI,
  RARE_BOOK_PAMPHLET_TEI_EXCERPT,
} from '../fixtures/loc-pages.js';
import { cpuScaling, LARGE_INPUT, SMALL_INPUT } from '../helpers/cpu-scaling.js';

/** A minimal transcription: a header the reader drops, then `body` as the `<body>` content. */
const doc = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><tei2><teiheader><title>Header title</title></teiheader><text type="manuscript"><body>${body}</body></text></tei2>`;
/** {@link doc} for a printed text: `<text type="publication">`. */
const printed = (body: string) => doc(body).replace('type="manuscript"', 'type="publication"');

describe('teiReadingText on captured transcriptions', () => {
  it('reads the Gettysburg Address (Nicolay copy) without its editors’ notes, footnote numerals, or canceled wording', () => {
    expect(teiReadingText(GETTYSBURG_NICOLAY_TEI)).toBe(
      [
        'Abraham Lincoln, Draft of Gettysburg Address, Nicolay Copy, [November 1863]',
        '[Page one]',
        'Executive Mansion,',
        'Washington, , 186 .',
        'Four score and seven years ago our fathers brought forth, upon this continent, a new nation, conceived in liberty, and dedicated to the proposition that “all men are created equal”',
        'Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived, and so dedicated, can long endure. We are met on a great battle field of that war. We have come to dedicate a portion of it, as a final resting place for those who died here, that the nation might live. This we may, in all propriety do. But, in a larger sense, we can not dedicate — we can not consecrate — we can not hallow, this ground— The brave men, living and dead, who struggled here, have hallowed it, far above our poor power to add or detract. The world will little note, nor long remember what we say here; while it can never forget what they did here.',
        'It is rather for us, the living, we here be dedica-',
        '[Page 2]',
        'ted to the great task remaining before us — that, from these honored dead we take increased devotion to that cause for which they here, gave the last full measure of devotion — that we here highly resolve these dead shall not have died in vain; that the nation, shall have a new birth of freedom, and that government of the people by the people for the people, shall not perish from the earth.',
      ].join('\n\n'),
    );
  });

  it('keeps the Bell card’s handwritten note and its <lb/> lines, behind a commented-out DOCTYPE', () => {
    expect(teiReadingText(BELL_CARD_TEI)).toBe(
      [
        '1875\n1st',
        "“These letters to Mrs. A. Melville Bell were found in an old Japanese desk where they had apparently been kept by themselves. They cover all the years of my acquaintance with my husband's mother, and form a record of his life and mine.",
        '“Please do not destroy them. If no one cares for them now perhaps one of the grandchildren may, years hence.',
        '“To me old letters are sacred, when they deal with the family life. I would value old letters revealing the personality of any of my ancestors beyond any amount of old furniture or bric-a-brac.”',
        'MABEL G. BELL\nJune 1913',
        'Many letters from Mrs. Alexander Graham Bell to Mr. and Mrs. Alexander Melville Bell found in other places than those referred to by Mrs. Bell in the above note are included in this series.',
        'G.H.G.',
      ].join('\n\n'),
    );
  });

  it('keeps each <lb/> line of a California Gold song separate, with no page numbers or illustration', () => {
    expect(teiReadingText(CALIFORNIA_GOLD_ABALONE_TEI)).toBe(
      [
        [
          'Abalone',
          '1. In Carmel Bay the people say,',
          'We feed the Lazzaroni',
          'On caramels[,?] and cockle-shells',
          'And hunks of abalone.',
          '2. O, some folks boast of quail on toast,',
          "Because they think it's tony;",
          'But my tom-cat gets nice and fat',
          'On hunks of abalone.',
          '3. He hides in caves, beneath the waves,',
          'His ancient patrimony:',
          "Race suicide will ne'er betide",
          'The fertile abalone.',
          '4. I telegraph my better half',
          'By Morse or by Marconi',
          'But when in need of greater speed',
          'I send an abalone.',
          '5. Some folks say that pain is real',
          "And some say that it's phoney;",
          "But as for me, when I can't agree,",
          'I eat an abalone.',
          '6. Our naval hero, best of all,',
          'His name was Pauley Joney;',
          'He sailed the seas as he darn pleased.',
          'But he never ate abalone.',
        ].join('\n'),
        'Abalone',
      ].join('\n\n'),
    );
  });

  it('leaves out the Corning draft’s canceled “soon followed” and every editors’ note', () => {
    const text = teiReadingText(CORNING_DRAFT_TEI_EXCERPT) ?? '';
    expect(text).toContain(
      'The rebellion, thus began soon ran into the present civil war; ; and, in certain respects, it began on very unequal terms between the parties— The insurgents had been preparing for it more than thirty years, while the government had taken no steps to resist them. The former',
    );
    expect(text).not.toContain('soon followed');
    for (const noteText of [
      "This is Lincoln's handwritten inscription",
      'Lincoln originally wrote',
      'Lincoln first wrote',
      'The striking of',
    ]) {
      expect(text).not.toContain(noteText);
    }
    // Canceled spans elsewhere in the paragraph: the wording that replaced each one stays.
    for (const canceled of ['May I be indulged', 'raise a squabble', 'howl', 'were commenced']) {
      expect(text).not.toContain(canceled);
    }
    expect(text).toContain('a clamor could be raised');
    // The one &amp; in the kept text, decoded once.
    expect(text).toContain('\n\n& something about Proclamation.\n\n');
    expect(text).not.toMatch(/[A-Za-z.;][0-9]/);
  });

  it('leaves out canceled wording that holds emphasized words, and keeps the emphasized words elsewhere', () => {
    expect(teiReadingText(FIRST_INAUGURAL_TEI_EXCERPT)).toBe(
      [
        'My countrymen, one and all, think calmly and well, upon this whole subject. Nothing valuable can be lost by taking time. If there be an object to hurry any of you, in hot haste, to a step which you would never take deliberately, that object will be frustrated by taking time; but no good object can be frustrated by it. Such of you as are now dissatisfied, still have the old Constitution unimpaired, and, on the sensitive point, the laws of your own framing under it; while the new administration will have no immediate power, if it would, to change either. If it were admitted that you who are dissatisfied, hold the right side in the dispute, there still is no single good reason for precipitate action. Intelligence, patriotism, Christianity, and a firm reliance on Him, who has never yet forsaken this favored land, are still competent to adjust, in the best way, all our present difficulty.',
        'In your hands, my dissatisfied fellow countrymen, and not in mine, is the momentous issue of civil war. The government will not assail you. You can have no conflict, without being yourselves the aggressors. You have no oath registered in Heaven to destroy the government, while I shall have the most solemn one to “preserve, protect and defend” it.',
      ].join('\n\n'),
    );
  });

  it('reads a printed license form: its superscript, its <hsep/> gap as a space, its handwritten note, and nothing for an <omit/>', () => {
    expect(teiReadingText(RARE_BOOK_LICENSE_TEI)).toBe(
      [
        'ETAT DE LA LOUISIANE.',
        "Cité et Paroisse d'Orléans.",
        'N o.',
        'MAIRIE DE LA NOUVELLE-ORLEANS.',
        "Vu l'Article Premier de l'Ordonnance du Conseil de Ville approuvée le 28 Mai 1812, additionnelle à celle relative aux Tueries; vu pareillement le Cautionnement de cinq cents Piastres fourni en cet Office par Mr.\nqui réunit d'ailleurs les qualités exigées par ladite Ordonnance.",
        'Il est permis audit Sieur\nde tenir une Tuerie sur',
        "Et ce pour le temps et espace d'une année, á compter de ce jour; à\nl'effet de quoi, je lui ai délivré la présente Licence sous le N o.\npour lui servir et valoir ce que de droit.",
        'Nouvelle - Orléans, le',
        '5r/5198\n51 39',
      ].join('\n\n'),
    );
  });

  it('keeps a printed pamphlet’s footnote mark, its printed footnote, and its display type, which a manuscript would drop', () => {
    expect(teiReadingText(RARE_BOOK_PAMPHLET_TEI_EXCERPT)).toBe(
      [
        'LETTER FROM HON. SALMON P. CHASE, CHIEF JUSTICE OF THE UNITED STATES.',
        'Wakefield, R. I., Aug. 16, 1865.',
        'Gentlemen: Your letter, of the 28th ult., reached me here, after some delay. I did not receive your invitation to the celebration on the 4th, or I should have thanked you for it earlier. I enclose a letter which expresses my sentiments.*',
        '* New Orleans, June 6, 1865.',
        'Gentlemen: I should hardly feel at liberty to decline the invitation you have tendered me in behalf of the loyal colored Americans of New Orleans, to speak to them on the subject of their rights and duties as citizens, if I had not quite recently expressed my views at Charleston, in an address, reported with substantial accuracy, and already published in one of the most widely circulated journals of this city. But it seems superfluous to repeat them before another audience.',
        'It is proper to say, however, that those views, having been formed years since, on much reflection, and confirmed, in a new and broader application, by the events of the civil war now happily ended, are not likely to undergo, hereafter, any material change.',
        'That native freemen, of whatever complexion, are citizens of the United States; that all men held as slaves in the States which joined in rebellion against the United States have become freemen through executive and legislative acts during the war: and that these freemen are now citizens, and consequently entitled to the rights of citizens, are propositions which, in my judgment, cannot be successfully controverted. And it is both natural and right that colored Americans, entitled to the rights of citizens, should claim their exercise. They should persist in this claim respectfully, but firmly, taking care to bring no discredit upon it by their own action. Its justice is already acknowledged by great numbers of their white fellow citizens, and these numbers constantly increase.',
        'The peculiar conditions, however, under which these rights arise, seem to impose on those who assert them peculiar duties, or rather special obligations to the discharge of common duties. They should strive for distinction by economy, by industry, by sobriety, by patient perseverance in well-doing, by constant improvement in religious instruction, and by the constant practice of Christian virtues. In this way they will surely overcome unjust hostility, and convince even the most prejudiced that the denial to them of any right which citizens may properly exercise, is equally unwise and wrong.',
        'Our national experience has demonstrated that public order reposes most securely on the broad basis of universal suffrage. It has proved, also, that universal suffrage is the surest guarantee and most powerful stimulus of individual, social, and political progress. May it not prove, moreover, in that work of re-organization which now engages the thoughts of all patriotic men, that universal suffrage is the best reconciler of the most comprehensive lenity with the most perfect public security and the most speedy and certain revival of general prosperity?',
        'Very respectfully, yours, S. P. CHASE.',
        'Messrs. J. B. Roudanez, L. Gois, and L. Banks, Committee.',
        'To-morrow morning, I shall be in Washington, if nothing unforeseen shall prevent.',
        'Yours truly, S. P. CHASE.',
        'OFFICERS\nOF THE\nNational Lincoln Monument Association.',
        'PRESIDENT.',
        'Rev. HENRY H. GARNET.',
        'VICE PRESIDENT.',
        'JAMES WORMLEY.',
        'APPEAL\nTO THE FRIENDS OF PROGRESS EVERYWHERE.',
      ].join('\n\n'),
    );
  });
});

describe('teiReadingText element handling', () => {
  it.each([
    ['drops <teiheader>', doc('<p>Body.</p>'), 'Body.'],
    [
      'drops an <anchor> footnote numeral without gluing it to the word',
      doc('<p>Nicolay Copy<anchor id="i443">1</anchor>, [November 1863]</p>'),
      'Nicolay Copy, [November 1863]',
    ],
    [
      'drops <pageinfo> page numbers',
      doc('<pageinfo><controlpgno>0001</controlpgno><printpgno/></pageinfo><p>Text</p>'),
      'Text',
    ],
    [
      'drops <illus>, empty or not',
      doc('<p>Caption <illus entity="x" map="no"/></p><p><illus entity="y">alt</illus>End</p>'),
      'Caption\n\nEnd',
    ],
    [
      'drops a <note anchor.ids> editors’ footnote with its paragraphs',
      doc('<p>Text.</p><note anchor.ids="i1"><p>1 Editors.</p><p>More.</p></note><p>After.</p>'),
      'Text.\n\nAfter.',
    ],
    [
      'keeps a <note> without anchor.ids',
      doc('<note><handwritten>1875<lb/>1st</handwritten></note><p>Card.</p>'),
      '1875\n1st\n\nCard.',
    ],
    [
      'drops <hi rend="other"> canceled wording',
      doc('<p>the living, <hi rend="other">to stand here,</hi> we here</p>'),
      'the living, we here',
    ],
    [
      'drops <hi rend="other"> with every element nested in it',
      doc('<p>a <hi rend="other">b <hi rend="italics">c</hi> <hi rend="other">d</hi> e</hi> f</p>'),
      'a f',
    ],
    ["reads rend='other' in single quotes", doc("<p>a <hi rend='other'>b</hi> c</p>"), 'a c'],
    [
      'keeps the text of <hi> in other renditions',
      doc('<p>what they <hi rend="underscore">did</hi> here, <hi rend="italics">Century</hi></p>'),
      'what they did here, Century',
    ],
    [
      'keeps the text of an element the table does not name',
      doc('<p><unclear>word</unclear> more</p>'),
      'word more',
    ],
    ['breaks a line at <lb/>', doc('<p>one<lb/>two<lb />three</p>'), 'one\ntwo\nthree'],
    ['leaves a blank line at two <lb/> in a row', doc('<p>one<lb/><lb/>two</p>'), 'one\n\ntwo'],
    [
      'breaks a paragraph at <p>, <div>, and <head>',
      doc('<div><head>Title</head><p>One</p><p>Two</p></div><div>Three</div>'),
      'Title\n\nOne\n\nTwo\n\nThree',
    ],
    [
      'collapses each whitespace run to one space, trimmed at breaks',
      doc('<p>  a \n\n\t b  </p><p>\r\n c<lb/>  d </p>'),
      'a b\n\nc\nd',
    ],
    [
      'decodes character and entity references once',
      doc('<p>Simon &amp; Schuster &amp;lt;b&amp;gt; &#8220;q&#x201D; &mdash;</p>'),
      'Simon & Schuster &lt;b&gt; “q” —',
    ],
    [
      'keeps a printed footnote mark and its printed <note anchor.ids> footnote',
      printed(
        '<p>sentiments.<anchor id="n1">*</anchor></p><note anchor.ids="n1" place="bottom"><p>* New Orleans.</p></note>',
      ),
      'sentiments.*\n\n* New Orleans.',
    ],
    [
      'keeps printed display type in <hi rend="other">',
      printed('<head><hi rend="other">OFFICERS</hi><lb/>OF THE</head>'),
      'OFFICERS\nOF THE',
    ],
    [
      'keeps the apparatus in print however deep it sits',
      printed(
        '<div><list><item><p>a <hi rend="other">b</hi><anchor id="x">*</anchor></p></item></list></div>',
      ),
      'a b*',
    ],
    [
      'keeps the apparatus in a <text> that names no type',
      '<tei2><text><body><p>a<anchor id="i1">1</anchor> <hi rend="other">b</hi></p><note anchor.ids="i1">n</note></body></text></tei2>',
      'a1 b\n\nn',
    ],
    [
      'sets a <list> apart as a paragraph and breaks a line before each <item>',
      printed('<p>Before</p><list><item>One</item><item>Two</item></list><p>After</p>'),
      'Before\n\nOne\nTwo\n\nAfter',
    ],
    [
      'reads an <hsep/> gap as a space',
      printed('<p>Yours truly,<hsep/>S. P. CHASE.</p>'),
      'Yours truly, S. P. CHASE.',
    ],
    [
      'keeps <superscript> text in place',
      printed('<p>N<superscript>o.</superscript> 5</p>'),
      'No. 5',
    ],
    [
      'leaves nothing for an <omit/>',
      printed('<p>le <omit reason="illegible" extent="1w"/> jour</p>'),
      'le jour',
    ],
    ['keeps CDATA literal', doc('<p><![CDATA[a &amp; <b>]]></p>'), 'a &amp; <b>'],
    [
      'skips comments and processing instructions in the body',
      doc('<p>a<!-- b <p>c</p> -->d<?pi e?>f</p>'),
      'adf',
    ],
    ['reads an empty body as empty text', doc(''), ''],
  ])('%s', (_name, xml, text) => {
    expect(teiReadingText(xml)).toBe(text);
  });

  it('skips a DOCTYPE and its internal subset, resolving no entity it declares', () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE tei2 SYSTEM "ammem2.dtd" [<!ENTITY % images SYSTEM "x_upd.ent"> %images; <!ENTITY sig "SIGNED">]><tei2><text><body><p>Text &sig;</p></body></text></tei2>';
    expect(teiReadingText(xml)).toBe('Text &sig;');
  });

  it('reads only <body>, not text elsewhere under the root', () => {
    const xml =
      '<tei2><text><front><p>Front</p></front><body><p>Body</p></body><back><p>Back</p></back></text></tei2>';
    expect(teiReadingText(xml)).toBe('Body');
  });
});

describe('teiReadingText on a body that is not a transcription', () => {
  it.each([
    ['an empty body', ''],
    ['plain text', 'Maury, Betty Herndon (Maury) 1835-1903.\n'],
    ["a text service's JSON", MANUSCRIPT_PAGE_3_TEXT],
    ['a TEI P5 root', '<TEI><text><body><p>x</p></body></text></TEI>'],
    ['an ALTO file', '<?xml version="1.0"?><alto><Layout><String CONTENT="x"/></Layout></alto>'],
    ['an HTML page', '<html><body><p>x</p></body></html>'],
    ['a tei2 root with no body', '<tei2><text><p>x</p></text></tei2>'],
    ['a self-closing root', '<tei2/>'],
    ['a file cut off mid-body', GETTYSBURG_NICOLAY_TEI.slice(0, GETTYSBURG_NICOLAY_TEI.length / 2)],
    ['a close tag that does not match', doc('<p>a</div>')],
    ['an unclosed comment', doc('<p>a<!-- b</p>')],
    ['a stray < in text', doc('<p>a < b</p>')],
    ['a < in an attribute value', doc('<hi rend="a<b">x</hi>')],
    ['an unclosed attribute value', doc('<hi rend="other>x</hi>')],
    ['attributes with no space between them', doc('<hi rend="a"id="b">x</hi>')],
    ['an unclosed start tag', doc('<p>a<note anchor.ids="i1"')],
    ['a second root', `${doc('<p>x</p>')}<tei2/>`],
    ['text after the root', `${doc('<p>x</p>')}trailing`],
    ['text before the root', `junk${doc('<p>x</p>')}`],
    ['a DOCTYPE inside the root', '<tei2><!DOCTYPE x><text><body><p>x</p></body></text></tei2>'],
  ])('returns undefined for %s', (_name, body) => {
    expect(teiReadingText(body)).toBeUndefined();
  });
});

describe('teiReadingText scan time stays linear in the input (5k → 320k characters, by doubling)', () => {
  const PREFIX = '<?xml version="1.0"?><tei2><text><body><p>';
  const SUFFIX = '</p></body></text></tei2>';
  /** `PREFIX`, as many whole `unit`s as fill `length`, then `SUFFIX`. */
  const filled = (unit: string, length: number) =>
    `${PREFIX}${unit.repeat(Math.max(1, Math.round((length - PREFIX.length - SUFFIX.length) / unit.length)))}${SUFFIX}`;
  /** The `<body>` content of a captured transcription. */
  const bodyOf = (xml: string) => xml.slice(xml.indexOf('<body>') + 6, xml.indexOf('</body>'));
  const BODY = bodyOf(GETTYSBURG_NICOLAY_TEI);
  const PRINTED_BODY = bodyOf(RARE_BOOK_PAMPHLET_TEI_EXCERPT);

  /**
   * Times `make`'s shape at 5k against 10k, 20k, … 320k characters, each larger size beside a
   * re-timed 5k baseline, checking the bound before the next size runs.
   */
  function expectLinear(make: (length: number) => string) {
    for (let step = 1; step <= 6; step++) {
      const size = SMALL_INPUT * 2 ** step;
      const { ratio, largeMs } = cpuScaling(teiReadingText, (length) =>
        make(length === SMALL_INPUT ? SMALL_INPUT : size),
      );
      expect(ratio, `${size} characters`).toBeLessThan(256);
      if (size === LARGE_INPUT) expect(largeMs).toBeLessThan(250);
    }
  }

  it.each<[string, (length: number) => string]>([
    ['a real transcription body repeated', (n) => filled(`</p>${BODY}<p>`, n)],
    [
      'a real manuscript body repeated, its notes and canceled wording dropped',
      (n) => filled(`</p>${BODY}<p>`, n).replace('<text>', '<text type="manuscript">'),
    ],
    ['a real printed pamphlet body repeated', (n) => filled(`</p>${PRINTED_BODY}<p>`, n)],
    ['an unclosed note opener', (n) => `${PREFIX}<note anchor.ids="${'x'.repeat(n)}`],
    ['a start tag repeated with no closer', (n) => filled('<note>', n)],
    [
      'nested canceled-wording openers, each closed at the end',
      (n) => {
        const depth = Math.round((n - PREFIX.length - SUFFIX.length) / 22);
        return `${PREFIX}${'<hi rend="other">'.repeat(depth)}x${'</hi>'.repeat(depth)}${SUFFIX}`;
      },
    ],
    ['nested openers in one tag (<a<a<a…>>>)', (n) => `${PREFIX}${'<a'.repeat(n / 2)}>>>`],
    ['a long run of <lb/>', (n) => filled('<lb/>', n)],
    ['one long line ending in a break', (n) => filled('x ', n).replace(SUFFIX, `\ny${SUFFIX}`)],
    ['breaks throughout', (n) => filled('  \r\n', n)],
    ['comments throughout', (n) => filled('<!--x-->', n)],
    ['an unclosed comment', (n) => `${PREFIX}<!--${'-'.repeat(n)}`],
    ['repeated references', (n) => filled('&amp;', n)],
    ['repeated unterminated references', (n) => filled('&a', n)],
    [
      'many attributes in one tag',
      (n) => `${PREFIX.replace('<p>', `<p ${'a="1" '.repeat(n / 6)}>`)}x${SUFFIX}`,
    ],
    [
      'a DOCTYPE internal subset of brackets',
      (n) => `<!DOCTYPE tei2 [${'['.repeat(n)}]>${PREFIX}x${SUFFIX}`,
    ],
  ])(
    '%s',
    (_name, make) => {
      expectLinear(make);
    },
    0,
  );
});
