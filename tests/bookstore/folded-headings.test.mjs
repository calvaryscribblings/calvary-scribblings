// The folded-headings audit, proven against fixtures before its clean result is trusted.
//
//   node --test tests/bookstore/folded-headings.test.mjs      (npm run test:purchases)
//
// All Shadows Are Black shipped with chapters 32–37 set as body paragraphs inside chapter 31.
// scripts/audit-folded-headings.mjs looks for that fault in every Book Store EPUB; these show
// it catches both shapes of heading, and passes a correctly split book.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { analyseEpub, headingTest, parseNumber, openerNumber, skipReason } from '../../scripts/audit-folded-headings.mjs';
import { FIXTURES } from '../fixtures/folded-headings-fixtures.mjs';

describe('folded headings · the fixtures', () => {
  test('"CHAPTER THIRTY-TWO" as a body paragraph is flagged', () => {
    const r = analyseEpub(FIXTURES.foldedWords());
    assert.deepEqual(r.flags.map((f) => [f.file, f.text, f.test]), [['EPUB/text/ch06.xhtml', 'CHAPTER THIRTY-TWO', 'whole']]);
    assert.equal(r.flags[0].index, 3);
  });

  test('"Chapter 32: The Return" as a body paragraph is flagged', () => {
    const r = analyseEpub(FIXTURES.foldedTitled());
    assert.deepEqual(r.flags.map((f) => [f.file, f.text, f.test]), [['EPUB/text/ch06.xhtml', 'Chapter 32: The Return', 'titled']]);
  });

  test('a run of folded chapters is flagged, and the chapter that swallowed them is oversized', () => {
    const r = analyseEpub(FIXTURES.foldedRun());
    assert.deepEqual(r.flags.map((f) => f.text), ['CHAPTER FOUR', 'CHAPTER FIVE', 'CHAPTER SIX']);
    assert.deepEqual(r.numbered, { first: 1, last: 3, gaps: [], repeats: [] });
    assert.deepEqual(r.oversized.map((o) => o.label), ['Three']);
  });

  test('a correctly split book passes', () => {
    const r = analyseEpub(FIXTURES.clean());
    assert.deepEqual(r.flags, []);
    assert.deepEqual(r.oversized, []);
    assert.deepEqual(r.numbered, { first: 1, last: 6, gaps: [], repeats: [] });
    assert.deepEqual(r.chapters.map((c) => c.label), ['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
  });

  test('a book with no openers is read by its headings, not passed for having none', () => {
    const r = analyseEpub(FIXTURES.foldedNoOpeners());
    assert.equal(r.source, 'headings');
    assert.deepEqual(r.chapters.map((c) => c.label), ['I', 'II', 'IV', 'V']);   // "Part I" left out
    assert.deepEqual(r.numbered, { first: 1, last: 5, gaps: ['2→4'], repeats: [] });
    assert.deepEqual(r.oversized.map((o) => o.label), ['II']);
    assert.deepEqual(r.flags.map((f) => f.text), ['III']);
  });

  test('a part numbering afresh is a new run; a mislabelled opener is a gap and a repeat', () => {
    const r = analyseEpub(FIXTURES.restartsAndMislabel());
    assert.deepEqual(r.numbered.gaps, ['3→3', '3→5']);
    assert.deepEqual(r.numbered.repeats, [3]);
    assert.deepEqual(r.chapters.map((c) => c.number), [1, 2, 3, 1, 2, 3, 3, 5]);
  });

  test('a book with openers says so', () => assert.equal(analyseEpub(FIXTURES.clean()).source, 'openers'));

  test('the nav, title page, copyright, contents and colophon are not read (each carries a heading-shaped line)', () => {
    const r = analyseEpub(FIXTURES.clean());
    assert.deepEqual(r.skipped.map((s) => s.why).sort(), ['colophon', 'contents', 'copyright', 'title page']);
  });

  test('the opener and part-page blocks are removed before the paragraphs are read', () => {
    // Every opener holds a bare number word and every part page a "PART ONE" — none is flagged.
    const r = analyseEpub(FIXTURES.clean());
    assert.ok(!r.flags.some((f) => /^(part|one|two|three)/i.test(f.text)));
  });
});

describe('folded headings · the tests', () => {
  const flagged = [
    'CHAPTER THIRTY-TWO', 'Chapter Thirty-Two.', 'chapter twenty nine', 'TWENTY-NINE', 'Thirty', 'Seventeen:',
    'Chapter 32', '32', 'XIV', 'Chapter xiv', 'PART TWO', 'Book Three', 'Act V', 'Section 4', 'PROLOGUE', 'Epilogue.',
    'Interlude', 'Afterword', 'Foreword', 'Introduction',
    'Chapter 32: The Return', 'CHAPTER THIRTY-TWO — THE RETURN', 'Part II. The Town', 'Book 3 - Arrivals', 'Act IV—Night',
  ];
  for (const s of flagged) test(`flags ${JSON.stringify(s)}`, () => assert.ok(headingTest(s), s));

  const passed = [
    'He turned the page.', 'Chapter and verse, she said.', 'One more thing.', 'Thirty-two of them came.',
    'The prologue was long.', '* * *', '❦', 'Chapter 32 The Return', 'Twenty-zero',
    `Chapter 32: ${'a long title that goes on '.repeat(3)}`, // over 60
  ];
  for (const s of passed) test(`passes ${JSON.stringify(s)}`, () => assert.equal(headingTest(s), null, s));

  test('numbers in all three forms', () => {
    assert.equal(parseNumber('thirty-two'), 32);
    assert.equal(parseNumber('Twenty Nine'), 29);
    assert.equal(parseNumber('seventeen'), 17);
    assert.equal(parseNumber('ninety-nine'), 99);
    assert.equal(parseNumber('XIV'), 14);
    assert.equal(parseNumber('mcmxc'), 1990);
    assert.equal(parseNumber('37'), 37);
    assert.equal(parseNumber('thirty-ten'), null);
  });

  test('an opener’s number, or null for a named one', () => {
    assert.equal(openerNumber('Thirty-One'), 31);
    assert.equal(openerNumber('Chapter 4: The Gull'), 4);
    assert.equal(openerNumber('Prologue'), null);
    assert.equal(openerNumber('The Tortoise and the Hare'), null);
    assert.equal(openerNumber('I Hope They Won’t See Us'), null);   // a title, not chapter one
    assert.equal(openerNumber('XXIII'), 23);
    assert.equal(openerNumber('Chapter Twenty-Seven'), 27);
  });

  test('skip list', () => {
    assert.equal(skipReason({ properties: 'nav' }, ''), 'nav');
    assert.equal(skipReason({ properties: '' }, '<section id="toc">'), 'contents');
    assert.equal(skipReason({ properties: '' }, '<section id="imprint" epub:type="imprint">'), 'copyright');
    assert.equal(skipReason({ properties: '' }, '<section id="one">'), null);
  });
});
