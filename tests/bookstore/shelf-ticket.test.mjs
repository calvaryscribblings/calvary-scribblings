// R16 — THE SLIM SHELF TICKET, and the one rule that makes clamping safe.
//
// The shelf card is the curator's own sentence about a book. R16 narrows it to 92% of the
// column and clamps the note to two lines, which is only defensible because the full sentence
// is printed somewhere the reader can reach in one tap.
//
// ⚠ THE FAILURE THIS FILE EXISTS TO CATCH is not the clamp appearing on the shelf. It is the
// clamp SPREADING — a later tidy that "makes the card consistent" by giving the detail page or
// the Window the same two-line box, at which point the curator's sentence exists nowhere in
// full and nobody finds out, because a clamped card looks exactly like a short one.
//
// Three surfaces print title.shelfCard and each has a different job:
//   .shelf-card-body   the shelf   — TWO LINES. A shelf shows you there IS a card.
//   .bd-shelfcard      the page    — WHOLE. This is where the sentence lives.
//   .window-shelfcard  the Window  — WHOLE. One book, all the room in the world.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SHOP_VERNACULAR_CSS } from '../../app/bookstore/components/shopVernacular.js';

const src = (rel) => readFileSync(new URL(rel, new URL('../../', import.meta.url)), 'utf8');
const rules = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const VERN = rules(SHOP_VERNACULAR_CSS);
const DETAIL = src('app/bookstore/[slug]/page-detail.js');
const SHOP = src('app/bookstore/page.js');
const CURATED = src('app/bookstore/components/CuratedSection.js');

/** Every way a browser is told to cut text off. */
const TRUNCATORS = [/-webkit-line-clamp/, /line-clamp/, /text-overflow\s*:\s*ellipsis/, /max-height/];

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R16 — THE TICKET, in the web’s own measurements', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const card = /\.shelf-card\{([^}]*)\}/.exec(VERN);
  const body = /\.shelf-card-body\{([^}]*)\}/.exec(VERN);
  const sign = /\.shelf-card-sign\{([^}]*)\}/.exec(VERN);

  test('92% of the column, centred and tucked under the book', () => {
    assert.ok(card, '.shelf-card has no rule');
    assert.match(card[1], /width:92%/, 'the ticket is no longer 92% of its column');
    assert.match(card[1], /margin:1rem auto 0/, 'the ticket is no longer centred under the book');
    // The old rule capped it at a fixed 190px, which cannot follow a column that moves.
    assert.equal(/max-width:190px/.test(card[1]), false, 'the fixed 190px cap is back');
  });

  test('THE NOTE IS CLAMPED TO TWO LINES', () => {
    assert.ok(body, '.shelf-card-body has no rule');
    assert.match(body[1], /-webkit-line-clamp:2/);
    assert.match(body[1], /-webkit-box-orient:vertical/);
    assert.match(body[1], /overflow:hidden/);
    assert.match(body[1], /display:-webkit-box/);
  });

  test('the type comes off the board’s own rungs — no new size was invented', () => {
    // .72rem is the rung the back cover's opening quote sits on; .5rem is the catalogue mark's;
    // .42rem is the smallest floor the storefront already uses (the obi's).
    // Expressed against the ticket's own width so the ratio survives a moving column:
    //   .72rem at the 184px ticket a 200px column gives = 6.26cqw
    //   .5rem  at the same                              = 4.35cqw
    assert.match(body[1], /font-size:max\(\.42rem,6\.26cqw\)/, 'the note left the opening-quote rung or its floor');
    assert.match(sign[1], /font-size:max\(\.42rem,4\.35cqw\)/, 'the attribution left the catalogue-mark rung or its floor');
    assert.match(card[1], /container-type:inline-size/, 'cqw has no ticket to resolve against');

    // THE FLOOR IS THE STOREFRONT'S OWN, not a number chosen here. The obi carries it.
    const BOOK = rules(/export const BOUND_BOOK_CSS = ([\s\S]*?)\n`;/.exec(src('app/bookstore/components/BoundBook.js'))[1]);
    assert.match(BOOK, /font-size:max\(\.42rem,/, 'the obi no longer carries the .42rem floor this borrows');
  });

  test('hierarchy survives the floor by FACE AND COLOUR, and the trade is written down', () => {
    // On a 106px column the ticket is 97px, where both cqw values fall under .42rem and the
    // two runs come out the same size. What separates them then is not size.
    assert.match(body[1], /font-style:italic/, 'the note lost the italic that distinguishes it at the floor');
    assert.match(sign[1], /font-family:'Cinzel',serif/, 'the attribution lost the display face');
    assert.match(sign[1], /letter-spacing:\.12em/);
    assert.match(sign[1], /color:#7a5f24/, 'the attribution lost the muted gold-brown');
    // …and the reason is at the code site, not only here.
    const block = /export const SHOP_VERNACULAR_CSS = `([\s\S]*?)`;/.exec(src('app/bookstore/components/shopVernacular.js'))[1];
    assert.match(block, /BOTH RUNS SIT ON THE FLOOR/i, 'the phone trade is not noted at the code site');
    assert.match(block, /FACE AND COLOUR/i);
  });

  test('THE PRICE LINE IS WEB FURNITURE AND DID NOT MOVE', () => {
    // The app has no money on its shelf; the web has printed one on every entry since R8.3 and
    // this round does not touch it. Same classes, same rungs, same order in the entry.
    assert.match(VERN, /\.entry-price\{font-family:'Cormorant Garamond',Georgia,serif;font-size:\.85rem;font-weight:600;color:#f0ead8\}/);
    assert.match(VERN, /\.entry-price-note\{[\s\S]*?font-size:\.72rem/);
    // …and it is still rendered above the ticket, by the money surface that owns it.
    const entry = /export function ShelfEntry\(\{[\s\S]*?\n\}/.exec(SHOP)[0];
    assert.ok(entry.indexOf('entry-price') < entry.indexOf('shelf-card'), 'the price line moved below the ticket');
    assert.match(entry, /priceLine\(title, currency, country\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R16 — NEITHER SURFACE CLAMPS THE OTHER’S COPY', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('the full note EXISTS on the title’s own page — confirmed, not assumed', () => {
    assert.match(DETAIL, /\{title\.shelfCard && \(/, 'the detail page no longer prints the shelf card');
    assert.match(DETAIL, /className="bd-shelfcard">\{title\.shelfCard\}/, 'the detail page prints something other than the whole field');
    // The whole field, not a slice of it.
    assert.equal(/shelfCard\.(slice|substring|substr)/.test(DETAIL), false, 'the detail page truncates the note in JS');
  });

  test('⛔ …and the page does not clamp it', () => {
    const rule = /\.bd-shelfcard\{([^}]*)\}/.exec(rules(DETAIL));
    assert.ok(rule, '.bd-shelfcard has no rule');
    for (const t of TRUNCATORS) {
      assert.equal(t.test(rule[1]), false, `the detail page's card now carries ${t} — the note exists nowhere in full`);
    }
    // And the element it prints into is not a two-line box either.
    assert.equal(/display:-webkit-box/.test(rule[1]), false);
  });

  test('⛔ the Window does not clamp it either', () => {
    assert.match(SHOP, /className="window-shelfcard">\{title\.shelfCard\}/);
    assert.match(CURATED, /className="window-shelfcard">\{title\.shelfCard\}/);
    const rule = /\.window-shelfcard\{([^}]*)\}/.exec(rules(SHOP_VERNACULAR_CSS));
    assert.ok(rule, '.window-shelfcard has no rule');
    for (const t of TRUNCATORS) {
      assert.equal(t.test(rule[1]), false, `the Window's card now carries ${t}`);
    }
  });

  test('the clamp exists on EXACTLY ONE of the three surfaces', () => {
    const carriers = [];
    for (const [name, css] of [
      ['shelf', /\.shelf-card-body\{([^}]*)\}/.exec(VERN)?.[1] || ''],
      ['detail page', /\.bd-shelfcard\{([^}]*)\}/.exec(rules(DETAIL))?.[1] || ''],
      ['window', /\.window-shelfcard\{([^}]*)\}/.exec(rules(SHOP_VERNACULAR_CSS))?.[1] || ''],
    ]) {
      if (/-webkit-line-clamp/.test(css)) carriers.push(name);
    }
    assert.deepEqual(carriers, ['shelf'],
      `the clamp is on ${carriers.join(' and ') || 'nothing'} — it belongs to the shelf and only the shelf`);
  });

  test('the shelf’s own two OTHER printings of a curator sentence are untouched', () => {
    // The curated section's line and the curation band are the same voice and were not in scope.
    assert.match(rules(src('app/bookstore/components/CuratedSection.js')), /\.curated-line\{[^}]*max-width:560px/);
    assert.equal(/-webkit-line-clamp/.test(rules(src('app/bookstore/components/CuratedSection.js'))), false);
  });
});
