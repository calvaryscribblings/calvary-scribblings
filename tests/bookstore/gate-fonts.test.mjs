// R9.2 PL-21 — THE GATE'S TYPEFACES COME FROM THE SHELL, NOT FROM A SECOND REQUEST.
//
//   node --test tests/bookstore/gate-fonts.test.mjs      (npm run test:purchases)
//
// THE FINDING. GATE_CSS opened with an `@import url('https://fonts.googleapis.com/…')` and is
// injected as <style>{GATE_CSS}</style> after mount. An @import inside an injected stylesheet
// is discovered late and fetched serially, and it blocks the render of the sheet that contains
// it — so the first screen a paying customer meets waited on a third-party round trip it did
// not need. app/layout.js already loads both families for the whole app from a render-blocking
// <link>, behind preconnects.
//
// WHY THIS FILE IS STATIC RATHER THAN A BROWSER TEST. What makes the deletion safe is not
// something you can see on a screenshot — a missing face falls back to Georgia, which renders
// perfectly well and looks deliberate. The load-bearing fact is a SET RELATION: every family
// and weight the gate names must be one the shell's link actually fetches. That is a fact about
// two source files, so it is checked as one, and it goes red the day someone adds a weight to
// the gate that the shell does not carry — which is the failure a screenshot would never catch.
//
// Offline. Reads two files and nothing else.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_PATH = 'app/bookstore/components/LaunchGate.js';
const LAYOUT_PATH = 'app/layout.js';

const GATE_SRC = readFileSync(join(ROOT, GATE_PATH), 'utf8');
const LAYOUT_SRC = readFileSync(join(ROOT, LAYOUT_PATH), 'utf8');

/** The template literal assigned to GATE_CSS — the CSS itself, without this file's prose. */
function gateCss() {
  const start = GATE_SRC.indexOf('const GATE_CSS = `');
  assert.notEqual(start, -1, `${GATE_PATH} no longer declares GATE_CSS as a template literal.`);
  const from = start + 'const GATE_CSS = `'.length;
  const end = GATE_SRC.indexOf('`;', from);
  assert.notEqual(end, -1, `${GATE_PATH}: GATE_CSS template literal is unterminated.`);
  return GATE_SRC.slice(from, end);
}

/**
 * What app/layout.js's Google Fonts <link> actually loads, parsed out of the href rather than
 * restated here — a copy would drift the moment the shell changed and would then be asserting
 * against itself.
 *
 * The href looks like:
 *   …css2?family=Cinzel:wght@400;500;600;700&family=Cormorant+Garamond:ital,wght@0,400;…;1,700
 *
 * Returns { 'Cinzel': Set{400,500,600,700}, 'Cormorant Garamond': Set{400,…,700} }. Italic axis
 * values are folded in with the romans: the gate never asks for an italic weight the shell does
 * not also carry as a roman, and flattening keeps this parser honest about what it does know.
 */
function shellFonts() {
  const href = /href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/.exec(LAYOUT_SRC);
  assert.ok(href, `${LAYOUT_PATH} no longer carries a Google Fonts css2 <link>.`);

  const out = new Map();
  for (const m of href[1].matchAll(/family=([^&]+)/g)) {
    const spec = decodeURIComponent(m[1]).replace(/\+/g, ' ');
    const [family, axes] = spec.split(':');
    const weights = new Set();
    if (!axes) {
      weights.add(400); // css2 with no axis spec means regular
    } else {
      // 'wght@400;600' → 400,600 · 'ital,wght@0,400;1,700' → the last number of each tuple
      const values = (axes.split('@')[1] || '').split(';');
      for (const v of values) {
        const n = Number(v.split(',').pop());
        if (Number.isFinite(n)) weights.add(n);
      }
    }
    out.set(family.trim(), weights);
  }
  return out;
}

describe('PL-21 · the gate makes no font request of its own', () => {
  test('THE FINDING: GATE_CSS contains no @import', () => {
    assert.equal(
      /@import/.test(gateCss()),
      false,
      'an @import inside an injected <style> is discovered late and blocks the gate\'s render',
    );
  });

  test('GATE_CSS reaches no third-party host at all', () => {
    // Broader than the @import above on purpose: url(), src: and @font-face would each buy the
    // same blocking round trip by another spelling.
    const css = gateCss();
    assert.equal(/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(css), false);
    assert.equal(/@font-face/.test(css), false);
    assert.equal(/url\(\s*['"]?https?:/.test(css), false, 'no absolute-URL asset in the gate stylesheet');
  });

  test('the shell still loads the two families, behind preconnects', () => {
    const fonts = shellFonts();
    assert.ok(fonts.has('Cinzel'), 'app/layout.js must still load Cinzel');
    assert.ok(fonts.has('Cormorant Garamond'), 'app/layout.js must still load Cormorant Garamond');

    // The preconnects buy nothing if they follow the stylesheet — layout.js says so in a
    // comment and this pins the order it asks for.
    const linkAt = LAYOUT_SRC.indexOf('fonts.googleapis.com/css2');
    const preAt = LAYOUT_SRC.indexOf('rel="preconnect"');
    assert.ok(preAt !== -1 && preAt < linkAt, 'preconnect must precede the stylesheet');
  });

  test('THE SAFETY ARGUMENT: every family the gate names is one the shell loads', () => {
    const loaded = shellFonts();
    const named = new Set();
    for (const m of gateCss().matchAll(/font-family\s*:\s*([^;}]+)/g)) {
      // First term of the stack — the rest are the system fallbacks, which need no loading.
      const first = m[1].split(',')[0].trim().replace(/^['"]|['"]$/g, '');
      if (first && !/^(serif|sans-serif|monospace|inherit|Georgia)$/i.test(first)) named.add(first);
    }
    assert.ok(named.size > 0, 'the extractor found no font-family rules — it has stopped working');

    for (const family of named) {
      assert.ok(
        loaded.has(family),
        `the gate asks for '${family}' but ${LAYOUT_PATH} does not load it, so the gate would ` +
        `render in a fallback face. Add it to the shell's link or stop naming it here.`,
      );
    }
  });

  test('THE SAFETY ARGUMENT: every weight the gate names is one the shell loads', () => {
    // This is the assertion that made deleting the @import safe. The @import fetched weight
    // 300 and the shell does not; nothing in the gate uses 300, so the deletion changed no
    // rendered face. The day someone writes font-weight:300 in GATE_CSS, this goes red.
    const loaded = shellFonts();
    const everyWeight = new Set([...loaded.values()].flatMap((s) => [...s]));

    const named = [...gateCss().matchAll(/font-weight\s*:\s*(\d{3})/g)].map((m) => Number(m[1]));
    assert.ok(named.length > 0, 'the extractor found no font-weight rules — it has stopped working');

    for (const w of named) {
      assert.ok(
        everyWeight.has(w),
        `the gate uses font-weight:${w}, which ${LAYOUT_PATH} does not load. The browser will ` +
        `synthesise or substitute it. Loaded weights: ${[...everyWeight].sort((a, b) => a - b).join(', ')}.`,
      );
    }
  });

  test('the removal is recorded where the next reader will look', () => {
    // globals.css carries the note from the first time this duplicate was removed. The gate
    // is the last copy, and the reason has to survive the diff.
    assert.match(GATE_SRC, /PL-21/, 'LaunchGate.js must name the finding that removed the @import');
  });
});
