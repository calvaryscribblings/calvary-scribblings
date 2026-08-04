// R9.0 PL-5 / PL-6 — THE GATE'S MEASURED CONTRAST, held in place.
//
//   node --test tests/bookstore/gate-contrast.test.mjs      (npm run test:purchases)
//
// The R9.0 audit measured two failures on the passcode field and R8.3 fixed them. A fix to a
// colour is the easiest kind of fix to lose: it is one alpha value, it looks like a taste
// decision to anyone reading the diff, and nothing goes red when someone dims it back down to
// match a mock. So the ratios are computed HERE, from the real stylesheet, on every run.
//
// THE VALUES ARE PARSED OUT OF LaunchGate.js RATHER THAN COPIED. A test carrying its own copy
// of the colour passes forever after someone changes the real one — the same argument
// gate.spec.mjs makes about the passcode, and for the same reason. Both extractors throw by
// name if the rule is restyled, so a rename breaks this suite loudly instead of silently
// asserting nothing.
//
// WHY #070707 IS THE BACKGROUND. It is .bg-gate's own ground and it is what R9.0 measured
// against; its published figures (2.15:1 and 1.51:1) reproduce exactly under the maths below,
// which is the check that makes the NEW numbers trustworthy. The input's own
// rgba(255,255,255,.02) fill sits on top of it and lightens the effective background by ~5/255,
// which moves the ratios by hundredths in the SAFE direction — it is ignored here so the
// assertion is against the stricter of the two readings.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  fileURLToPath(new URL('../../app/bookstore/components/LaunchGate.js', import.meta.url)),
  'utf8',
);

// ── WCAG 2.1 relative luminance and contrast ratio ───────────────────────────
const channel = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const composite = (fg, alpha, bg) => fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]);

const GROUND = [7, 7, 7]; // #070707

/** Pull an `rgba(r,g,b,a)` out of the first CSS declaration matching `pattern`. */
function rgbaFrom(pattern, label) {
  const m = pattern.exec(SRC);
  if (!m) {
    throw new Error(
      `LaunchGate.js no longer contains a rule matching ${label} — update the extractor, ` +
      'do NOT inline the colour here.',
    );
  }
  const rgba = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(m[1]);
  if (!rgba) throw new Error(`${label} matched but carries no rgba() value: ${m[1]}`);
  return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
}

const placeholder = rgbaFrom(
  /\.bg-input::placeholder\{color:([^;}]+)/,
  '.bg-input::placeholder colour',
);
const border = rgbaFrom(
  /\.bg-input\{[^}]*?border:1px solid ([^;}]+)/s,
  '.bg-input border colour',
);

const ratioOf = ({ rgb, alpha }) => contrast(composite(rgb, alpha, GROUND), GROUND);

describe('LaunchGate passcode field — WCAG AA', () => {
  test('PL-5: the placeholder meets AA for text (4.5:1)', () => {
    const r = ratioOf(placeholder);
    assert.ok(
      r >= 4.5,
      `placeholder rgba(${placeholder.rgb},${placeholder.alpha}) on #070707 is ${r.toFixed(2)}:1, ` +
      'below the 4.5:1 required for text. R9.0 PL-5 measured 2.15:1; do not dim it back.',
    );
  });

  test('PL-6: the input border meets AA for non-text UI (3:1)', () => {
    const r = ratioOf(border);
    assert.ok(
      r >= 3.0,
      `border rgba(${border.rgb},${border.alpha}) on #070707 is ${r.toFixed(2)}:1, below the ` +
      '3:1 required for a UI component boundary. R9.0 PL-6 measured 1.51:1; do not dim it back.',
    );
  });

  test('the maths reproduces R9.0\'s published figures', () => {
    // The calibration check. If this drifts, the numbers above are measuring something else
    // and the two assertions are worthless.
    const oldPlaceholder = contrast(composite([240, 234, 216], 0.28, GROUND), GROUND);
    const oldBorder = contrast(composite([201, 164, 76], 0.25, GROUND), GROUND);
    assert.equal(oldPlaceholder.toFixed(2), '2.15', 'R9.0 PL-5 published 2.15:1');
    assert.equal(oldBorder.toFixed(2), '1.51', 'R9.0 PL-6 published 1.51:1');
  });

  test('the approved look is intact — hue and weight unchanged, only alpha moved', () => {
    // The fix was permitted to change the tokens minimally and nothing else. These pin the
    // parts that had to stay: the vellum and gold hues, the hairline border, the italic.
    assert.deepEqual(placeholder.rgb, [240, 234, 216], 'the placeholder must stay vellum');
    assert.deepEqual(border.rgb, [201, 164, 76], 'the border must stay gold');
    assert.match(SRC, /\.bg-input::placeholder\{[^}]*font-style:italic/, 'the placeholder stays italic');
    assert.match(SRC, /\.bg-input\{[^}]*border:1px solid/s, 'the border stays a 1px hairline');
    assert.match(SRC, /\.bg-input:focus\{border-color:#c9a44c/, 'the focus treatment is untouched');
  });
});

describe('LaunchGate is a dialog', () => {
  // Cheap structural assertions. The behavioural half — focus on mount, the trap, restore —
  // is driven for real in tests/bookstore/gate.spec.mjs against a browser; these exist so a
  // deleted attribute fails in the fast suite rather than only in Playwright.
  test('it declares the modal contract', () => {
    assert.match(SRC, /role="dialog"/, 'role="dialog"');
    assert.match(SRC, /aria-modal="true"/, 'aria-modal="true"');
    assert.match(SRC, /aria-labelledby="bg-gate-title"/, 'labelled by its heading');
    assert.match(SRC, /id="bg-gate-title"/, 'and the heading carries that id');
  });

  test('the cookie banner is exempt from the inert sweep', () => {
    // Providers renders it as a DOM sibling at z-index 9999, above the gate, so consent stays
    // reachable behind the curtain. Inerting it would trap the one control that must not be.
    assert.match(SRC, /cs-cookie/, 'the exemption must survive any refactor of the sweep');
  });
});
