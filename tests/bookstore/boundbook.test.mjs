// R16 — THE BOOK AS A CLEAN GRAPHIC OBJECT, asserted.
//
// Ikenna's ruling of 19 Aug 2026 ratified the app's storefront refinements as the house design
// and the web adopts them. Three of the four changes live in BoundBook and the shop's
// vernacular, and every one of them is one careless edit away from a different change:
//
//   · "remove the bottom page block" is one edit away from "remove the page block"
//   · "move the shadow" is one edit away from "the book now hovers"
//   · "three columns" is one edit away from "the measured auto-fill rule was a mistake"
//
// So each is asserted in BOTH directions: the thing that went is gone, and every thing that
// stayed is still there, by name.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SHOP_VERNACULAR_CSS } from '../../app/bookstore/components/shopVernacular.js';

const src = (rel) => readFileSync(new URL(rel, new URL('../../', import.meta.url)), 'utf8');
const BOOK_SRC = src('app/bookstore/components/BoundBook.js');
const VERN_SRC = src('app/bookstore/components/shopVernacular.js');

// BoundBook.js is JSX, so node cannot import it — the same reason sections.test.mjs reads the
// storefront as text. Its three exported records are pure literals, so they are lifted out of
// the source and evaluated. Lifting rather than copying is the point: a test holding its own
// copy of the numbers would agree with itself forever.
function literal(name, ending) {
  const m = new RegExp(`export const ${name} = ([\\s\\S]*?)\n${ending}`).exec(BOOK_SRC);
  if (!m) throw new Error(`BoundBook.js no longer exports ${name} as a literal`);
  return new Function(`return ${m[1]}\n${ending.replace(/\\/g, '')}`)();
}
const BOUND_BOOK_CSS = literal('BOUND_BOOK_CSS', '`;');
const BOTTOM_PAGE_BLOCK_REMOVED = literal('BOTTOM_PAGE_BLOCK_REMOVED', '\\};');
const CONTACT_SHADOW_REBASE = literal('CONTACT_SHADOW_REBASE', '\\};');

/**
 * A stylesheet with its comments stripped. Load-bearing for every "is it gone" assertion in
 * this file: both stylesheets EXPLAIN the removals at length and name the removed class and
 * the retired rule while doing it. A grep that counted the explanation as the thing would only
 * teach the next author to stop writing the explanation down — the same argument
 * sections.test.mjs makes about the money wall.
 */
const rules = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const BOOK_RULES = rules(BOUND_BOOK_CSS);
const VERN_RULES = rules(SHOP_VERNACULAR_CSS);

/** The component's JSX, with the stylesheet literal and the record constants cut out — so a
 *  class named only inside a comment or a `removedCss` string cannot pass for a rendered one. */
const JSX = BOOK_SRC
  .replace(/export const BOUND_BOOK_CSS = `[\s\S]*?`;/, '')
  .replace(/export const BOTTOM_PAGE_BLOCK_REMOVED = \{[\s\S]*?\n\};/, '')
  .replace(/export const CONTACT_SHADOW_REBASE = \{[\s\S]*?\n\};/, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R16 — FEET OFF THE BOOK', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('the removal is RECORDED, not merely done', () => {
    const r = BOTTOM_PAGE_BLOCK_REMOVED;
    assert.equal(r.ruledBy, 'Ikenna');
    assert.equal(r.on, '2026-08-19');
    assert.match(r.ruling, /clean graphic object/i);
    assert.match(r.ruling, /Window included/i);
    assert.equal(r.removedClass, 'bb-foreedge-b');
    // The element kept verbatim, so a restoration is a copy rather than a reconstruction.
    assert.match(r.removedCss, /bottom:-8px/);
    assert.match(r.removedCss, /height:8px/);
    assert.equal(r.removedDropPx, 8);
  });

  test('⛔ the bottom page block is gone from the stylesheet AND from the DOM', () => {
    assert.equal(BOOK_RULES.includes('.bb-foreedge-b'), false, 'the rule is still in BOUND_BOOK_CSS');
    assert.equal(/className="bb-foreedge-b"/.test(JSX), false, 'the element is still rendered');
    assert.equal(/bb-foreedge-b/.test(JSX), false, 'the class name still appears in the rendered half of the file');
  });

  test('✅ …and EVERYTHING ELSE STILL RENDERS. This is the half that gets deleted by accident', () => {
    for (const cls of BOTTOM_PAGE_BLOCK_REMOVED.keeps) {
      assert.ok(BOOK_RULES.includes(`.${cls}`), `${cls} lost its rule — the ruling removed one element, not the page block`);
    }
    // Each one, in the markup, by the route it actually reaches a screen by.
    assert.match(JSX, /className="bb-foreedge"/, 'the RIGHT fore-edge is no longer rendered');
    assert.match(JSX, /bb-spine/, 'the spine is gone');
    assert.match(JSX, /className="bb-obi"/, 'the obi band is gone');
    assert.match(JSX, /className="bb-ribbon"/, 'the gilt ribbon is gone');
    assert.match(JSX, /bb-face bb-back/, 'the printed back face is gone');
    assert.match(JSX, /bb-flipped/, 'the flip is gone');
  });

  // R17.4 RE-DERIVED THIS TEST, and it is worth saying what it used to assert and why the
  // change is not a weakening. It read `width:12px` and `right:-11px` off the rule, lifting the
  // 12 from BOTTOM_PAGE_BLOCK_REMOVED.foreEdgeMinWidthPx. Both numbers are gone: the width is
  // now a fraction of the board and the offset is derived from it. But R16's CLAIM was never
  // about 12 — it was that the feet-removal took the FEET and not the page block, so the right
  // fore-edge is still drawn and still hangs off the RIGHT rather than the bottom. That claim
  // is intact and is what this test asserts. The width's own correctness moved to
  // tests/bookstore/foreedge.test.mjs, which owns the proportion, the floor and the seam.
  test('the right fore-edge is still drawn, and still hangs off the RIGHT — R16\'s claim', () => {
    const rule = /\.bb-foreedge\{([^}]*)\}/.exec(BOOK_RULES);
    assert.ok(rule, '.bb-foreedge has no rule');
    // It hangs off the right edge and is inset from top and bottom — not a bottom block.
    assert.match(rule[1], /(^|;)right:/, 'the right fore-edge stopped hanging off the right');
    assert.equal(/(^|;)bottom:-/.test(rule[1]), false, 'the right fore-edge now hangs off the BOTTOM — that is the element R16 removed');
    // And it still has SOME width. Which one is FORE_EDGE's business, not R16's.
    assert.match(rule[1], /(^|;)width:/, 'the right fore-edge lost its width entirely');
    // The retired pin is retired by name, and the 12 it held survives as provenance: it is the
    // numerator of the ratio that replaced it. See BOTTOM_PAGE_BLOCK_REMOVED's note.
    assert.equal('foreEdgeMinWidthPx' in BOTTOM_PAGE_BLOCK_REMOVED, false);
    assert.equal(BOTTOM_PAGE_BLOCK_REMOVED.foreEdgeWasFixedPx, 12);
  });

  test('the back face still carries its own printed matter', () => {
    // The obi is granted by a live Editor's Choice claim and nothing else; the back face prints
    // the opening line, the blurb, the barcode and the catalogue mark. None of it was in scope.
    for (const bit of ['resolveOpeningLine', 'resolveBackBlurb', 'formatCatalogueNumber', 'bb-barcode', 'obiLabel']) {
      assert.ok(BOOK_SRC.includes(bit), `${bit} disappeared with the feet`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R16 — THE CONTACT SHADOW MOVED BY DERIVATION', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('the shadow rose by exactly the drop the feet occupied', () => {
    // THE WHOLE DERIVATION, as one equation. If somebody restores the feet and forgets the
    // shadow — or nudges the shadow by eye — this is what fails.
    assert.equal(CONTACT_SHADOW_REBASE.raisedByPx, BOTTOM_PAGE_BLOCK_REMOVED.removedDropPx);
    assert.equal(
      CONTACT_SHADOW_REBASE.isBottomPx,
      CONTACT_SHADOW_REBASE.wasBottomPx + CONTACT_SHADOW_REBASE.raisedByPx,
      'the new offset is not the old one raised by the feet’s drop',
    );
  });

  test('…and the stylesheet says the same number', () => {
    const rule = /\.bb-shadow\{([^}]*)\}/.exec(BOOK_RULES);
    assert.ok(rule, '.bb-shadow has no rule');
    assert.match(rule[1], new RegExp(`bottom:${CONTACT_SHADOW_REBASE.isBottomPx}px`),
      'the stylesheet and the record disagree about where the pool sits');
  });

  test('NOTHING ELSE ABOUT THE POOL CHANGED — only where it sits', () => {
    const rule = /\.bb-shadow\{([^}]*)\}/.exec(BOOK_RULES)[1];
    assert.match(rule, /height:24px/, 'the pool changed size');
    assert.match(rule, /filter:blur\(5px\)/, 'the pool changed softness');
    assert.match(rule, /translateZ\(-40px\)/, 'the pool changed plane');
    assert.match(rule, /left:7%/); assert.match(rule, /right:7%/);
    assert.match(rule, /rgba\(0,0,0,\.6\) 0%,transparent 72%/, 'the pool changed falloff');
  });

  test('the measurement is written down on both sides, and the residual with it', () => {
    const b = CONTACT_SHADOW_REBASE.measuredPoolBefore;
    const a = CONTACT_SHADOW_REBASE.measuredPoolAfter;
    // The two call sites whose SIZE did not change are the controlled comparison.
    for (const k of ['window190', 'curatedCase170']) {
      assert.ok(typeof b[k] === 'number' && typeof a[k] === 'number', `${k} is not measured on both sides`);
      assert.ok(Math.abs(a[k] - b[k]) <= CONTACT_SHADOW_REBASE.tolerancePx,
        `${k}: the pool moved ${(a[k] - b[k]).toFixed(2)}px, outside the ${CONTACT_SHADOW_REBASE.tolerancePx}px this round allows`);
    }
    // The 150px shelf book's BEFORE is kept: it is where the 8px came from, and the round
    // resized that book, so it has no comparable after.
    assert.ok(typeof b.shelf150 === 'number');
    assert.equal(a.shelf150, undefined, 'the resized shelf book must not claim an unchanged pool');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R16 — THREE ACROSS, AND THE BOOK IS ITS COLUMN', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const shelfRule = /(?:^|\n)\s*\.shelf\{([^}]*)\}/.exec(VERN_RULES);

  test('the shelf is three fixed columns', () => {
    assert.ok(shelfRule, '.shelf has no rule');
    assert.match(shelfRule[1], /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  });

  test('minmax(0,1fr), not a bare 1fr — a long title may not widen its column', () => {
    assert.equal(/repeat\(3,\s*1fr\)/.test(shelfRule[1]), false,
      'a bare 1fr floors at min-content, so one unbreakable title would put four-across geometry on a three-across shelf');
  });

  test('⛔ the auto-fill rule is retired EVERYWHERE, including its handset override', () => {
    assert.equal(/auto-fill/.test(VERN_RULES), false,
      'an auto-fill grid-template-columns rule is still live');
    const phone = /@media\(max-width:640px\)\{([\s\S]*?)\n  \}/.exec(VERN_RULES);
    assert.ok(phone, 'the vernacular lost its responsive block');
    assert.equal(/grid-template-columns/.test(phone[1]), false,
      'the handset still overrides the column count — three columns need no variant');
  });

  test('…and it is retired AS A MEASURED RULE, with what it did written down', () => {
    // Not silently deleted. The note has to name the rule it replaced and say what that rule
    // could and could not do, or the next author reads three columns as the original design.
    const block = /export const SHOP_VERNACULAR_CSS = `([\s\S]*?)`;/.exec(VERN_SRC)[1];
    assert.match(block, /repeat\(auto-fill,minmax\(180px,1fr\)\)/, 'the retired rule is not quoted');
    assert.match(block, /minmax\(150px,1fr\) under 640px/, 'the retired handset override is not quoted');
    assert.match(block, /not an accident|MEASURED rule/i, 'the note does not say the rule was measured');
  });

  test('the book takes the width of its column, and BoundBook accepts a CSS length', () => {
    assert.match(VERN_RULES, /\.shelf-book-wrap\{[^}]*width:100%/);
    // R17.3 — THIS USED TO NAME `<ShelfBook`, the shelf-only wrapper that carried the gesture.
    // R17.3 retired that wrapper (the gesture moved into BoundBook so no surface could render
    // a dead book) and the shelf now renders the book directly. The PROPERTY R16 was proving is
    // untouched and is still proved here: the shelf hands its book a CSS length, not a pixel
    // number. The assertion follows the code rather than being deleted with it.
    assert.match(src('app/bookstore/page.js'), /<BoundBook title=\{title\} variant="shelf" width="100%"/,
      'the shelf still passes a fixed pixel width');
    // The component's own contract: a number is pixels, a string is used verbatim.
    assert.match(JSX, /typeof width === 'number' \? `\$\{width\}px` : width/);
    assert.match(BOOK_RULES, /--bb-w:160px/);
    assert.match(BOOK_RULES, /width:var\(--bb-w\)/);
  });

  test('every ratio the component used to compute in JS is now derived in CSS, unchanged', () => {
    // height = w*1.5, ribbon = height*.32 = w*.48, obi = max(.42rem, w/320 rem) = 5cqw at
    // 16px root, cover title = max(.62rem, w/190 rem) = 8.421cqw. The floors stay in rem.
    assert.match(BOOK_RULES, /aspect-ratio:2\/3/, 'the 1.5 height ratio is gone');
    assert.match(BOOK_RULES, /\.bb-ribbon\{[^}]*height:48cqw/, 'the ribbon ratio is gone');
    assert.match(BOOK_RULES, /\.bb-obi\{[^}]*font-size:max\(\.42rem,5cqw\)/, 'the obi type ratio or its floor is gone');
    assert.match(BOOK_RULES, /\.bb-cover-title\{[^}]*font-size:max\(\.62rem,8\.421cqw\)/, 'the cover-title ratio or its floor is gone');
    assert.match(BOOK_RULES, /container-type:inline-size/, 'cqw has no container to resolve against');
    // …and the JS no longer computes any of them.
    assert.equal(/Math\.round\(width \* 1\.5\)/.test(JSX), false);
    assert.equal(/Math\.max\(0\.42, width \/ 320\)/.test(JSX), false);
    assert.equal(/Math\.max\(0\.62, width \/ 190\)/.test(JSX), false);
  });

  test('the four call sites: three still name a size, one takes its column', () => {
    const shop = src('app/bookstore/page.js');
    assert.match(shop, /width=\{190\} ribbon/, 'the Window’s book changed size');
    assert.match(src('app/bookstore/components/CuratedSection.js'), /width=\{170\}/, 'the curated case’s book changed size');
    // R26 — the detail board's 220 moved into app/lib/bookstore/board.js so the detail page's
    // SERVER component can state the same `sizes` in its cover preload. Same fact, asserted in
    // both halves: the page passes the constant, and the constant is still 220.
    assert.match(src('app/bookstore/[slug]/page-detail.js'), /width=\{DETAIL_BOARD_WIDTH\}/, 'the detail page’s book no longer takes its width from the shared constant');
    assert.match(src('app/lib/bookstore/board.js'), /export const DETAIL_BOARD_WIDTH = 220;/, 'the detail page’s book changed size');
    assert.match(shop, /width="100%"/, 'the shelf’s book is not its column');
  });

  test('R15’s interleave air still derives from the gap tokens the grid kept', () => {
    assert.match(VERN_RULES, /--shelf-row-gap:3\.5rem;--shelf-col-gap:1\.5rem/);
    assert.match(VERN_RULES, /--shelf-row-gap:2\.75rem;--shelf-col-gap:1rem/);
    assert.match(VERN_RULES, /\.catalogue-interleave\{padding:calc\(var\(--shelf-row-gap\) \* 2\) 0\}/);
  });
});
