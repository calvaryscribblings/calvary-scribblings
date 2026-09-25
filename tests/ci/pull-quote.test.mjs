// W5 · the pull quote's inner text — app/lib/pullQuote.js, through the bookstore's own
// resolveOpeningLine so every surface that prints an opening line is covered by the same cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullQuoteText } from '../../app/lib/pullQuote.js';
import { resolveOpeningLine } from '../../app/bookstore/components/fields.js';

// The live line, 25 Sep 2026 (bookstore_titles/the-awakening/openingLine), verbatim.
const AWAKENING = 'A green and yellow parrot, which hung in a cage outside the door, kept repeating over and over: "Allez vous-en! Allez vous-en! Sapristi! That\'s all right!"';

test('The Awakening: doubles inside become singles, the apostrophe becomes ’', () => {
  assert.equal(
    resolveOpeningLine({ openingLine: AWAKENING }),
    'A green and yellow parrot, which hung in a cage outside the door, kept repeating over and over: ‘Allez vous-en! Allez vous-en! Sapristi! That’s all right!’',
  );
});

test('never wrapped twice: a line the curator already quoted loses its outer pair', () => {
  assert.equal(pullQuoteText('"Stay here beside her, major."'), 'Stay here beside her, major.');
  assert.equal(pullQuoteText('“Supposing that Truth is a woman — what then?”'), 'Supposing that Truth is a woman — what then?');
  // Starts and ends with a quote but is not ONE quotation: nothing is stripped.
  assert.equal(pullQuoteText('"Go," she said, "now."'), '‘Go,’ she said, ‘now.’');
});

test('apostrophes and curly inner quotes', () => {
  assert.equal(pullQuoteText("I'm writing this from an aircraft."), 'I’m writing this from an aircraft.');
  assert.equal(pullQuoteText('It is one o\'clock in the morning.'), 'It is one o’clock in the morning.');
  assert.equal(pullQuoteText('He said “yes” and left.'), 'He said ‘yes’ and left.');
  assert.equal(pullQuoteText("the boys' shoes"), 'the boys’ shoes');
  assert.equal(pullQuoteText("She called it 'home'."), 'She called it ‘home’.');
});

test('lines with no quotes are unchanged, and empty stays empty', () => {
  assert.equal(pullQuoteText('He had not slept.'), 'He had not slept.');
  assert.equal(pullQuoteText('  '), '');
  assert.equal(resolveOpeningLine({ openingLine: '   ' }), null);
  assert.equal(resolveOpeningLine({}), null);
});

test('idempotent: normalising twice changes nothing', () => {
  const once = pullQuoteText(AWAKENING);
  assert.equal(pullQuoteText(once), once);
});
