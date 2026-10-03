// W33 — THE HELD BOOK'S DOOR, and the signal contracts that must never name one.
//
//   node --test tests/bookstore/held-book.test.mjs      (npm run test:purchases)
//
// My Library and /my-library/book draw a held book through app/lib/bookstore/heldBook.js. These
// drive that module with values: which door a book gets, what the reader page is handed, and
// what a malformed address resolves to.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  HELD_PATH, parseHeldId, heldBookView, heldBookHref, heldReaderTitle, isActiveHold, isPublishedTitle,
} from '../../app/lib/bookstore/heldBook.js';
import { DATA_CONTRACTS, SECTION_TYPES } from '../../app/lib/bookstore/sections.js';

const ID = 'held-book';
const PURCHASE = { status: 'active', slug: ID, title: 'From the Record', author: 'Record Author', coverUrl: 'https://example.invalid/p.jpg', purchasedAt: 5 };
const DOC = (status, extra = {}) => ({ status, slug: ID, title: 'From the Catalogue', author: 'Catalogue Author', coverUrl: 'https://example.invalid/c.jpg', ...extra });

describe('W33 · the address', () => {
  test('a well-formed ?t= is read', () => assert.equal(parseHeldId(`?t=${ID}`), ID));
  test('anything malformed is no id at all', () => {
    for (const s of ['', '?', '?t=', '?slug=held-book', '?t=../../etc', '?t=a%2Fb', `?t=${'x'.repeat(129)}`, '?t=has space', null, undefined]) {
      assert.equal(parseHeldId(s), null, String(s));
    }
  });
});

describe('W33 · the door', () => {
  test('a PUBLISHED title opens at its reader page', () => {
    assert.equal(heldBookHref(heldBookView(ID, PURCHASE, DOC('published'))), `/reader/${ID}`);
  });
  test('a WITHDRAWN title the reader still holds opens at the held page — not a 404', () => {
    assert.equal(heldBookHref(heldBookView(ID, PURCHASE, DOC('withdrawn'))), `${HELD_PATH}?t=${ID}`);
  });
  test('a book with NO catalogue record opens at the held page', () => {
    assert.equal(heldBookHref(heldBookView(ID, PURCHASE, null)), `${HELD_PATH}?t=${ID}`);
  });
  test('any status that is not exactly "published" is not published', () => {
    for (const s of ['draft', 'unpublished', 'scheduled', 'Published', undefined]) assert.equal(isPublishedTitle(DOC(s)), false, String(s));
  });
});

describe('W33 · the fallbacks My Library has always used', () => {
  test('the catalogue record first, where one exists', () => {
    const v = heldBookView(ID, PURCHASE, DOC('withdrawn'));
    assert.equal(v.title, 'From the Catalogue'); assert.equal(v.author, 'Catalogue Author'); assert.equal(v.coverUrl, 'https://example.invalid/c.jpg');
  });
  test('the purchase record\'s own fields when there is none', () => {
    const v = heldBookView(ID, PURCHASE, null);
    assert.equal(v.title, 'From the Record'); assert.equal(v.author, 'Record Author'); assert.equal(v.coverUrl, 'https://example.invalid/p.jpg');
    assert.equal(v.slug, ID); assert.equal(v.purchasedAt, 5); assert.equal(v.active, true); assert.equal(v.published, false);
  });
  test('and the floor beneath both', () => {
    const v = heldBookView(ID, { status: 'active' }, null);
    assert.equal(v.title, 'Untitled'); assert.equal(v.author, ''); assert.equal(v.coverUrl, null); assert.equal(v.slug, ID);
  });
  test('only the exact status "active" opens', () => {
    for (const s of ['revoked', 'refunded', '', undefined, 'ACTIVE']) assert.equal(isActiveHold({ status: s }), false, String(s));
    assert.equal(isActiveHold({ status: 'active' }), true);
  });
});

describe('W33 · what the held reader is handed', () => {
  test('identity and display, the catalogue mark and glossary where a record has them — never a price, sample or genre', () => {
    const doc = DOC('withdrawn', { catalogueNumber: 7, glossary: { word: 'a meaning' }, samplePath: 'bookstore_epubs/x/sample.epub', prices: { gbp: 999 }, genre: 'fiction' });
    const t = heldReaderTitle(heldBookView(ID, PURCHASE, doc), doc);
    assert.deepEqual(Object.keys(t).sort(), ['author', 'catalogueNumber', 'coverUrl', 'glossary', 'id', 'slug', 'title']);
    assert.equal(t.catalogueNumber, 7); assert.deepEqual(t.glossary, { word: 'a meaning' });
  });
  test('with no catalogue record: no mark, no glossary', () => {
    const t = heldReaderTitle(heldBookView(ID, PURCHASE, null), null);
    assert.equal(t.catalogueNumber, null); assert.equal(t.glossary, null); assert.equal(t.id, ID);
  });
});

describe('W33 · a signal only ever names published titles, and comps never count', () => {
  const dataDriven = Object.entries(DATA_CONTRACTS);
  test('there are data-driven contracts to check (the instrument is not empty)', () => {
    assert.ok(dataDriven.length >= 2);
    for (const [key] of dataDriven) assert.ok(SECTION_TYPES[key], key);
  });
  for (const [key, c] of dataDriven) {
    test(`${key}: names only published titles`, () => assert.equal(c.namesOnly, 'published'));
    test(`${key}: comps are excluded from EVERY column it counts`, () => {
      assert.deepEqual(c.excludesSources, ['comp']);
      assert.deepEqual([...c.excludesSourcesFrom].sort(), [...c.counts].sort());
    });
  }
});
