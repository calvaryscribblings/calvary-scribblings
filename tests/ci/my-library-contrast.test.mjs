// R9.7 — MY LIBRARY'S MEASURED CONTRAST, held in place.
//
//   node --test tests/ci/my-library-contrast.test.mjs      (npm run test:ci)
//
// The glow-up round raised several captions that were sitting well under AA — the shelf's
// small caps were at alpha .32-.38 on a near-black ground, which measures around 2.5:1
// against a 4.5:1 requirement. A fix to a colour is the easiest kind to lose: it is one
// alpha value, it looks like taste in a diff, and nothing goes red when the next person dims
// it back to match a mock. So the ratios are computed here, from the real stylesheet.
//
// SAME METHOD AS tests/bookstore/gate-contrast.test.mjs, deliberately — the maths is
// WCAG 2.1 relative luminance, and that file's published figures reproduce under it, which
// is what makes these numbers trustworthy too. Values are PARSED out of the page rather than
// copied: a test carrying its own copy of a colour passes forever after someone changes the
// real one. Every extractor throws by name if its rule is restyled.
//
// THE GROUND IS #080610 — the darkest stop of .ml-page's radial gradient. Text sits over the
// lighter stops too, which only moves the ratios in the safe direction; asserting against the
// darkest is the stricter reading.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  fileURLToPath(new URL('../../app/my-library/page.js', import.meta.url)),
  'utf8',
);

const channel = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const composite = (fg, alpha, bg) => fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]);

const GROUND = [8, 6, 16];      // #080610 — .ml-page's darkest stop
const PLATE = [236, 228, 207];  // #ece4cf — the bookplate's cream stock

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// THE STYLESHEET IS A TEMPLATE LITERAL, so `${LABEL}` appears verbatim in the source and a
// naive /\{[^}]*color:/ stops dead on its closing brace. Rules are therefore sliced by
// SELECTOR and bounded by the start of the next selector line, which is stable regardless of
// how many interpolations a rule carries.
function block(selector) {
  const at = SRC.indexOf(`${selector} {`);
  if (at === -1) {
    throw new Error(
      `app/my-library/page.js no longer contains a rule for ${selector} — update the `
      + 'extractor, do NOT inline the colour here.',
    );
  }
  const rest = SRC.slice(at + selector.length);
  const next = /\n\s*[.@]/.exec(rest);       // the next selector, or a media query
  return rest.slice(0, next ? next.index : 600);
}

/** Pull the rule's `color:` as an rgba() with its alpha. */
function rgbaFrom(selector) {
  const decl = /color:\s*(rgba\([^)]*\))/.exec(block(selector));
  if (!decl) throw new Error(`${selector} carries no rgba() color — update the extractor.`);
  const p = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(decl[1]);
  return { rgb: [Number(p[1]), Number(p[2]), Number(p[3])], alpha: Number(p[4]) };
}

/** Pull the rule's `color:` as a solid hex. */
function hexFrom(selector) {
  const decl = /color:\s*(#[0-9a-fA-F]{6})/.exec(block(selector));
  if (!decl) throw new Error(`${selector} carries no hex color — update the extractor.`);
  return { rgb: hex(decl[1]), alpha: 1 };
}

const ratioOn = ({ rgb, alpha }, bg) => contrast(composite(rgb, alpha, bg), bg);

// Every piece of TEXT the shelf added or touched. Non-text ornament (ledge, sheen, rails) is
// deliberately absent: it carries no information a reader has to read.
const TEXT = [
  ['.ml-vol-a (author)', rgbaFrom('.ml-vol-a'), GROUND],
  ['.ml-pct (43% in)', rgbaFrom('.ml-pct'), GROUND],
  ['.ml-kept (kept-since line)', rgbaFrom('.ml-kept'), GROUND],
  ['.ml-quiet (REMOVE)', rgbaFrom('.ml-quiet'), GROUND],
  ['.ml-withdrawn', rgbaFrom('.ml-withdrawn'), GROUND],
  ['.ml-section-head', rgbaFrom('.ml-section-head'), GROUND],
  ['.ml-soon-note', rgbaFrom('.ml-soon-note'), GROUND],
  ['.ml-sw-t (plaque label)', rgbaFrom('.ml-sw-t'), GROUND],
  ['.ml-sw-n (plaque count)', rgbaFrom('.ml-sw-n'), GROUND],
  ['.ml-slots-n', rgbaFrom('.ml-slots-n'), GROUND],
];

describe('My Library — WCAG AA', () => {
  for (const [label, colour, bg] of TEXT) {
    test(`${label} meets AA for text (4.5:1)`, () => {
      const r = ratioOn(colour, bg);
      assert.ok(
        r >= 4.5,
        `${label} measures ${r.toFixed(2)}:1, below the 4.5:1 required for text. `
        + 'The pre-R9.7 shelf ran these captions at ~2.5:1; do not dim them back.',
      );
    });
  }

  test('the gilded label clears AA on its own gold-tinted ground', () => {
    // .ml-gild is text on a fill, not on the page — the fill is the background that counts.
    const ink = hexFrom('.ml-gild');
    // The lighter of the fill's two stops, i.e. the worst case for this light ink.
    const m = /background: linear-gradient\(180deg, (rgba\([^)]*\))/.exec(block('.ml-gild'));
    if (!m) throw new Error('.ml-gild carries no gradient fill — update the extractor.');
    const p = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(m[1]);
    const bg = composite([Number(p[1]), Number(p[2]), Number(p[3])], Number(p[4]), GROUND);
    const r = contrast(ink.rgb, bg);
    assert.ok(r >= 4.5, `.ml-gild measures ${r.toFixed(2)}:1 on its own fill`);
  });

  test('the bookplate is legible against its cream stock, not the page', () => {
    // The one light surface on a dark shelf. Its ink must be measured against the plate —
    // reading it against the page would report a comfortable number for unreadable text.
    const cat = hexFrom('.ml-plate-cat');
    const state = hexFrom('.ml-plate-state');
    for (const [label, c] of [['catalogue mark', cat], ['PURCHASED', state]]) {
      const r = contrast(c.rgb, PLATE);
      assert.ok(r >= 4.5, `bookplate ${label} measures ${r.toFixed(2)}:1 on #ece4cf`);
    }
  });

  test('the withdrawn treatment stays readable while reading as withdrawn', () => {
    // R9.1 LB-8's rule is that a withdrawn book is dimmed but PRESENT. Dimming it below AA
    // would make "present" a technicality — the reader has to be able to read which book it
    // was, which is the entire point of not filtering it out.
    const title = rgbaFrom('.ml-vol.is-withdrawn .ml-vol-t');
    const author = rgbaFrom('.ml-vol.is-withdrawn .ml-vol-a');
    for (const [label, c] of [['title', title], ['author', author]]) {
      const r = ratioOn(c, GROUND);
      assert.ok(r >= 4.5, `withdrawn ${label} measures ${r.toFixed(2)}:1 — dimmed past legible`);
    }
  });
});
