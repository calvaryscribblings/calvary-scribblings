// R17.4 — THE SIDE PAPER, asserted at the source. `npm run test:purchases`.
//
// Two failure modes, and they are opposite. The obvious one is that the slab comes back — a
// fixed px width creeping into the rule because a proportion is harder to type. The other is
// subtler and is why half this file exists: "make it thinner" quietly becoming "make it a
// plain stripe". The fore-edge is not a width, it is a CONSTRUCTION — two paper tones in 1px
// vertical bands, inset from the board top and bottom, radiused on the outer corners only,
// with a shadow on its side edge and its left edge tucked under the cover. Every one of those
// survived R17.4 and every one of them is asserted here by name.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(rel, new URL('../../', import.meta.url)), 'utf8');
const BOOK_SRC = src('app/bookstore/components/BoundBook.js');

function literal(name, ending) {
  const m = new RegExp(`export const ${name} = ([\\s\\S]*?)\n${ending}`).exec(BOOK_SRC);
  if (!m) throw new Error(`BoundBook.js no longer exports ${name} as a literal`);
  return new Function(`return ${m[1]}\n${ending.replace(/\\/g, '')}`)();
}
const FORE_EDGE = literal('FORE_EDGE', '\\};');
const REMOVED = literal('BOTTOM_PAGE_BLOCK_REMOVED', '\\};');
const CSS = literal('BOUND_BOOK_CSS', '`;');

// ⚠ EVERY ASSERTION BELOW READS `RULES`, NOT `CSS`, AND THAT IS LOAD-BEARING IN BOTH
// DIRECTIONS. This stylesheet EXPLAINS its removals at length and names the removed class
// while doing it — .bb-foreedge-b appears four times in prose above a rule that no longer
// exists. A grep for "is it gone" that counted the explanation would fail on a correct file,
// and the only thing it could teach the next author is to stop writing the explanation down.
// The same argument boundbook.test.mjs makes, and sections.test.mjs before it. (This suite
// learned it the hard way: its first run failed exactly here.)
const rules = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = rules(CSS);

/** The component's JSX, with the stylesheet literal and every record constant cut out, so a
 *  class named only in a comment or inside a `removedCss` string cannot pass for a rendered
 *  one. Mirrors boundbook.test.mjs's JSX, plus R17.4's own record. */
const JSX = BOOK_SRC
  .replace(/export const BOUND_BOOK_CSS = `[\s\S]*?`;/, '')
  .replace(/export const (BOTTOM_PAGE_BLOCK_REMOVED|CONTACT_SHADOW_REBASE|FORE_EDGE) = \{[\s\S]*?\n\};/g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const RULE = (() => {
  const m = /\.bb-foreedge\{([^}]*)\}/.exec(RULES);
  assert.ok(m, '.bb-foreedge has no rule in BOUND_BOOK_CSS');
  return m[1];
})();

describe('R17.4 — THE FORE-EDGE IS A FRACTION OF THE BOARD', () => {

  test('the ratio is DERIVED from the app\'s two numbers, never a pre-multiplied constant', () => {
    // 12 / 245.33 = 4.891%. The record must compute it, not store it, so a hand-edited pct
    // cannot silently disagree with the fixed width and the board it was ratified on.
    assert.equal(FORE_EDGE.ratio, FORE_EDGE.appFixedWidthPt / FORE_EDGE.appBoardWidthPt);
    assert.ok(Math.abs(FORE_EDGE.pct - 4.8914) < 0.001, `pct drifted: ${FORE_EDGE.pct}`);
  });

  test('…and the STYLESHEET carries the same two numbers and does its own division', () => {
    // Not `4.891cqw`. Both source numbers appear verbatim in the rule, and CSS divides them —
    // so the drawing and the reason for it cannot come apart, and neither can be checked
    // without the other. Same discipline as HERO_LOCKUP_AIR's 1.211 and .9.
    const { appFixedWidthPt: w, appBoardWidthPt: b } = FORE_EDGE;
    assert.match(RULE, new RegExp(`calc\\(100cqw \\* ${w} / ${String(b).replace('.', '\\.')}\\)`),
      'the rule no longer derives the width from the app\'s fixed width and its board');
    // A bare pre-multiplied cqw would be the same drawing and an unfalsifiable number.
    assert.equal(/width:\s*[\d.]+cqw/.test(RULE), false, 'the width is a pre-multiplied constant again');
    // And no fixed pixel width may govern it — that is the slab.
    assert.equal(/(^|;)width:\s*\d+px/.test(RULE), false, 'the fore-edge has a fixed pixel width again — the slab is back');
  });

  test('THE FLOOR is one band of each tone, and that is its whole justification', () => {
    // The paper is two tones in 1px bands. A strip narrower than two bands cannot alternate,
    // so it stops reading as stacked pages and becomes a beige line. 2px is that width.
    assert.equal(FORE_EDGE.floorPx, FORE_EDGE.bandPx * FORE_EDGE.tones.length);
    assert.match(RULE, new RegExp(`max\\(${FORE_EDGE.floorPx}px,`), 'the floor is gone from the rule');
  });

  test('THE TUCK is a fixed 1px seam and does not scale with the width', () => {
    // right = -(width - tuck). A seam is a seam at any size: scaling it would open a hairline
    // gap between the cover and the paper on small books and overlap on large ones.
    assert.equal(FORE_EDGE.tuckPx, 1);
    assert.match(RULE, new RegExp(`right:calc\\(${FORE_EDGE.tuckPx}px - var\\(--bb-fe-w\\)\\)`),
      'the tuck is no longer derived from the width');
    assert.equal(/right:\s*-?\d+px/.test(RULE), false, 'the offset is a fixed pixel again, so it cannot follow the width');
  });

  test('THE CONSTRUCTION IS UNTOUCHED — this was a trim, not a redraw', () => {
    assert.match(RULE, new RegExp(`top:${FORE_EDGE.insetPct}%`), 'the top inset is gone — the block now reaches the board');
    assert.match(RULE, new RegExp(`bottom:${FORE_EDGE.insetPct}%`), 'the bottom inset is gone');
    assert.match(RULE, new RegExp(`border-radius:${FORE_EDGE.radius}`), 'the outer-corner radius changed');
    assert.match(RULE, new RegExp(`box-shadow:${FORE_EDGE.sideShadow.replace(/[().]/g, (c) => '\\' + c)}`),
      'the side-edge shadow changed');
    // The two tones, in 1px bands, running vertically down the side edge.
    const [a, b] = FORE_EDGE.tones;
    assert.match(RULE, new RegExp(
      `repeating-linear-gradient\\(${FORE_EDGE.bandAngleDeg}deg,${a} 0,${a} ${FORE_EDGE.bandPx}px,${b} ${FORE_EDGE.bandPx}px,${b} ${FORE_EDGE.bandPx * 2}px\\)`),
      'the paper is no longer two tones in 1px vertical bands');
    assert.match(RULE, /transform:translateZ\(-7px\)/, 'the strip left its plane behind the cover');
  });

  test('EVERY KEEP OF R16 IS STILL DRAWN — the trim took nothing with it', () => {
    // Both directions, as R16 did it. The removed element stays removed…
    assert.equal(RULES.includes('.bb-foreedge-b'), false, 'the feet are back in the stylesheet');
    assert.equal(/className="bb-foreedge-b"/.test(JSX), false, 'the feet are back in the markup');
    // …and everything the ruling kept is still in both.
    for (const cls of REMOVED.keeps) {
      assert.match(RULES, new RegExp(`\\.${cls}[\\s{,:.]`), `.${cls} left the stylesheet`);
      assert.match(JSX, new RegExp(`className=[{'"].*\\b${cls}\\b`), `.${cls} left the markup`);
    }
    // The contact shadow's rebase is a separate derivation and R17.4 did not touch it.
    const shadow = /\.bb-shadow\{([^}]*)\}/.exec(RULES)[1];
    assert.match(shadow, new RegExp(`bottom:${literal('CONTACT_SHADOW_REBASE', '\\};').isBottomPx}px`),
      'the contact shadow moved — R17.4 was a trim of the paper and nothing else');
  });

  test('THE NEW FLIP GESTURE IS UNTOUCHED', () => {
    // R17.3 is one round old and this round edited the same component. Cheap to check, and the
    // failure it guards against — a stylesheet edit reverting a behaviour change — is silent.
    assert.match(JSX, /useBookGesture\(/, 'BoundBook stopped carrying its own gesture');
    assert.match(RULES, /(^|\n)\s*\.bb-book\{[^}]*cursor:pointer/, 'the pointer cursor left the book');
  });

  test('R16\'s retired pin is recorded as retired, with the number it contributed', () => {
    // foreEdgeMinWidthPx is gone, and it is gone by name: the 12 it held is the numerator of
    // the ratio that replaced it, so erasing it would erase half the derivation's provenance.
    assert.equal('foreEdgeMinWidthPx' in REMOVED, false, 'the retired pin is back under its old name');
    assert.equal(REMOVED.foreEdgeWasFixedPx, FORE_EDGE.appFixedWidthPt);
    assert.equal(REMOVED.foreEdgeNowGovernedBy, 'FORE_EDGE');
  });

  test('the measurement the trim is accountable to covers every size the shop renders', () => {
    // Four boards, and the fraction is the same on all of them — which is the entire point.
    for (const [key, m] of Object.entries(FORE_EDGE.measured)) {
      assert.ok(Math.abs(m.after.pct - FORE_EDGE.pct) <= FORE_EDGE.tolerancePct,
        `${key} did not land on the ratio: ${m.after.pct}% vs ${FORE_EDGE.pct}%`);
      assert.ok(m.after.w < m.before.w, `${key} did not get thinner`);
      // The construction held at every size, insets included.
      assert.ok(Math.abs(m.after.h - m.before.h) < 0.5, `${key}: the block's height changed`);
      assert.ok(Math.abs(m.after.tuck - m.before.tuck) < 0.05, `${key}: the seam moved`);
    }
    // The handset is the acceptance test: the slab was 11.26% of a 106px board.
    assert.ok(FORE_EDGE.measured['shelf-106'].before.pct > 11);
    assert.ok(FORE_EDGE.measured['shelf-106'].after.w < 5.5);
  });
});
