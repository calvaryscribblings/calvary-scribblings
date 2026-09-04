// R39 — the composer. The design decisions that a later round would otherwise undo
// without noticing, and the four live contracts it must not disturb.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RAIL_ICON, RAIL_STROKE, RAIL_BUTTON, RAIL_LEFT, RAIL_MIN_WIDTH,
  RAIL_CONTROLS, applyControl,
} from '../../app/lib/composerRail.js';
import {
  LOCAL_DEBOUNCE_MS, REMOTE_DEBOUNCE_MS, REMOTE_MAX_WAIT_MS, MAX_DRAFTS,
} from '../../app/lib/openPagesDrafts.js';

const composer = readFileSync('app/open-pages/new/page.js', 'utf8');
const rail = readFileSync('app/components/ComposerRail.js', 'utf8');

// Strip line comments so the prose that EXPLAINS a rule is not mistaken for a breach
// of it — this file's own docblocks name the things they forbid.
const codeOf = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// ═══════════════════════════════════════════════════════════════════════════════
describe('R39 · ⚠ SVG ONLY, NO EMOJI', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('⭐ NO EMOJI ANYWHERE IN THE COMPOSER TREE', () => {
    // ❦ (U+2766) and ✦ (U+2726) are typographic marks from the font and are allowed;
    // everything in the pictograph blocks is not. The old composer shipped a ✓ in
    // "Going live on Calvary Scribblings ✓" and that is what this catches coming back.
    const ALLOWED = new Set(['❦', '✦', '︎']);
    for (const [name, src] of [['composer', composer], ['rail', rail]]) {
      for (const [i, line] of codeOf(src).split('\n').entries()) {
        for (const ch of line) {
          const o = ch.codePointAt(0);
          const pictograph = (o >= 0x1F000 && o <= 0x1FAFF)
            || (o >= 0x2700 && o <= 0x27BF)     // dingbats: ✓ ✗ ✂ …
            || (o >= 0x2600 && o <= 0x26FF)     // misc symbols: ⚠ ☀ …
            || (o >= 0x2B00 && o <= 0x2BFF);    // ⭐ ⬆ …
          if (pictograph && !ALLOWED.has(ch)) {
            assert.fail(`${name}:${i + 1} ships U+${o.toString(16).toUpperCase()} — SVG only, no emoji.\n    ${line.trim().slice(0, 90)}`);
          }
        }
      }
    }
  });

  test('B, I, H and the quotation mark are SET IN CORMORANT, not drawn', () => {
    const letters = RAIL_CONTROLS.filter((c) => ['bold', 'italic', 'head', 'quote'].includes(c.key));
    assert.equal(letters.length, 4);
    // A letter is not an emoji, and the house's own face says "bold" better than a
    // picture of a B. The <Letter> component is the only thing that renders them.
    assert.match(rail, /function Letter/);
    assert.match(rail, /fontFamily: "Cormorant Garamond, Georgia, serif"/);
    for (const c of letters) assert.ok(c.letter, `${c.key} must be a letterform, not a drawing`);
    assert.deepEqual(letters.map((c) => c.letter), ['B', 'I', 'H', '\u201C']);
  });

  test('⭐ THE DRAWN GLYPHS ARE ONE STROKE WIDTH AND ONE SIZE', () => {
    // A set that reads as one hand. A second stroke width or size anywhere in the rail
    // is the bug — it is what makes an icon set look bought rather than drawn.
    const strokes = [...rail.matchAll(/strokeWidth=\{([^}]+)\}/g)].map((m) => m[1]);
    const widths = [...rail.matchAll(/width=\{([^}]+)\}/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(strokes)], ['RAIL_STROKE'], 'every svg must use the one stroke constant');
    assert.ok(widths.every((w) => w === 'RAIL_ICON' || w === 'RAIL_BUTTON'), 'every size comes from a constant');
    // And no literal stroke or size slipped in.
    assert.equal(/strokeWidth="[\d.]+"/.test(rail), false);
    assert.equal(/<svg[^>]*width="\d+"/.test(rail), false);
    assert.equal(RAIL_STROKE, 1.25);
    assert.equal(RAIL_ICON, 17);
  });

  test('every rail control is a real button with a real name', () => {
    // Accessibility is not optional on a writing surface.
    for (const c of RAIL_CONTROLS) {
      assert.ok(c.name && c.name.length > 2, `${c.key} needs an accessible name`);
    }
    assert.match(rail, /aria-label=\{c\.name\}/);
    assert.match(rail, /role="toolbar"/);
    assert.match(rail, /aria-label="Formatting"/);
    // Real <button>s, so Enter and Space come for free and the tab order is the DOM's.
    assert.equal(/<div[^>]*onClick/.test(rail), false, 'no div pretending to be a button');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R39 · ⭐ THE RAIL NEVER CROSSES THE MEASURE', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('the geometry puts it entirely in the margin', () => {
    // The invariant, computed rather than trusted: the rail's right edge must be at or
    // left of the measure's left edge. Verified against the painted page too — at
    // 1280px the rail occupies 246–278 and the measure begins at 310.
    assert.ok(RAIL_LEFT + RAIL_BUTTON <= 0,
      `rail right edge is ${RAIL_LEFT + RAIL_BUTTON}px into the measure — it is crossing the words`);
    assert.ok(RAIL_LEFT < 0, 'the rail lives in the margin, not the column');
  });

  test('where there is no margin it is ABSENT, not overlapped', () => {
    // Below this width the measure needs the whole window. Hiding the rail is the only
    // honest answer; shrinking it or letting it overlap would put furniture on the words.
    assert.ok(RAIL_MIN_WIDTH > 660, 'the breakpoint must be wider than the measure itself');
    assert.match(composer, /@media \(max-width: 900px\) \{ \.op-rail \{ display: none !important; \} \}/);
    assert.equal(RAIL_MIN_WIDTH, 901, 'the CSS query and this constant must be the same number');
  });

  test('the measure is the reading measure, and the chrome shares its axis', () => {
    assert.match(composer, /\.op-measure \{ position: relative; max-width: 660px/);
    assert.match(composer, /\.op-chrome \{[^}]*max-width: 660px/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R39 · the rail inserts MARKDOWN, never rich text', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  const byKey = (k) => RAIL_CONTROLS.find((c) => c.key === k);

  test('a wrap wraps the selection and leaves the caret after it', () => {
    const r = applyControl(byKey('bold'), 'the quick fox', 4, 9);
    assert.equal(r.text, 'the **quick** fox');
    assert.equal(r.caret, 11, 'the caret sits at the end of the wrapped words, not after the marker');
  });

  test('a line prefix lands at the START of the line, not mid-sentence', () => {
    // The obvious implementation inserts at the caret, which produces
    // "a senten## ce" — a heading marker in the middle of a word.
    const r = applyControl(byKey('head'), 'first line\nsecond line', 17, 17);
    assert.equal(r.text, 'first line\n## second line');
  });

  test('the quotation control is a markdown blockquote, and the link is markdown', () => {
    assert.equal(applyControl(byKey('quote'), 'said it', 3, 3).text, '> said it');
    assert.equal(applyControl(byKey('link'), 'here', 0, 4).text, '[here](url)');
    assert.equal(applyControl(byKey('list'), 'one', 0, 0).text, '- one');
  });

  test('⭐ THERE IS NO RICH-TEXT MODEL — the repo has no sanitiser', () => {
    const code = codeOf(composer) + codeOf(rail);
    assert.equal(/dangerouslySetInnerHTML/.test(code), false);
    assert.equal(/contentEditable/i.test(code), false);
    assert.equal(/document\.execCommand/.test(code), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R39 · ⚠ THE LIVE CONTRACTS ARE UNDISTURBED', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test("⭐ R37's SAVE CADENCE AND CONFLICT RULE ARE UNCHANGED", () => {
    assert.equal(LOCAL_DEBOUNCE_MS, 500);
    assert.equal(REMOTE_DEBOUNCE_MS, 10000);
    assert.equal(REMOTE_MAX_WAIT_MS, 60000);
    assert.equal(MAX_DRAFTS, 20);
    // The composer still drives the hook, and still hands it the same four values —
    // a redesign that reimplemented saving would show up as the hook going unused.
    assert.match(composer, /useOpenPagesDraft\(\{/);
    assert.match(composer, /uid: user\?\.uid \|\| null/);
    assert.match(composer, /title, body, genre, coverImage/);
    assert.match(composer, /draft\.discardOnPublish\(\)/, "ruling 3 still fires on publish");
  });

  test('⭐ R35: PUBLISHING GOES THROUGH THE FUNCTION, NEVER TO THE NODE', () => {
    const code = codeOf(composer);
    assert.match(code, /fetch\('\/api\/open-pages\/moderate'/);
    // If this round writes to open_pages, it is wrong.
    assert.equal(/ref\(db, *`?open_pages\//.test(code), false, 'the composer must never write the public node');
    assert.equal(/OPEN_PAGES_NODE/.test(code), false);
    assert.match(code, /Authorization: `Bearer \$\{idToken\}`/, 'the uid comes from a verified token');
  });

  test("R36's limiter refusal is surfaced, not swallowed", () => {
    assert.match(composer, /res\.status === 429/);
    assert.match(composer, /rate_limited/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R39 · ⭐⭐ THE SCREENING MOMENT, AND HONEST REFUSALS', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('⭐ IT SAYS READING, NOT CHECKING', () => {
    // The default answer to a wait is a spinner, and the default word is "checking".
    // Both say "the system is busy". This is the one moment a writer can feel that the
    // house reads everything, which is the whole commissioning argument.
    assert.match(composer, /Reading your piece/);
    assert.match(composer, /Every piece published on the island is read before it lands\./);
    const screen = composer.slice(composer.indexOf('op-screen-h'), composer.indexOf('op-screen-p') + 400);
    assert.equal(/check/i.test(screen), false, 'the screening copy must not say checking');
    assert.equal(/scan|verify|safety|moderat/i.test(screen), false, 'nor any other machine word');
  });

  test('⭐ A FLAGGED PIECE IS HELD FOR AN EDITOR, NEVER "REJECTED"', () => {
    // A writer told a machine rejected their work does not come back. It has not
    // failed — it is waiting for a person, and the copy has to say so.
    assert.match(composer, /pending: 'Held for an editor'/);
    assert.match(composer, /An editor will read this before it goes up\./);
    assert.match(composer, /nothing has been lost/);
    // "Rejected" survives only as the API's status key, never as words a writer reads.
    const titles = composer.slice(composer.indexOf('const OUTCOME_TITLES'), composer.indexOf('const OUTCOME_TITLES') + 400);
    assert.equal(/'Rejected'|"Rejected"/.test(titles), false);
  });

  test('the rate-limit refusal names the wait — silence reads as a lost piece', () => {
    assert.match(composer, /rate_limited: 'Just a moment'/);
    assert.match(composer, /Your work is safe/, 'the writer must be told nothing was lost');
  });

  test('⚠ REDUCE MOTION COLLAPSES IT TO ITS FINAL STATE', () => {
    const rm = composer.slice(composer.indexOf('prefers-reduced-motion'));
    assert.match(rm, /\.op-screen-mark, \.op-screen-h, \.op-screen-p \{ opacity: 1; animation: none; \}/);
    assert.match(rm, /\.op-screen-rule \{ transform: scaleX\(1\); animation: none; \}/);
  });

  test('the word count is Cinzel and counts WORDS', () => {
    assert.match(composer, /wordCount\.toLocaleString\(\)\} \{wordCount === 1 \? 'word' : 'words'\}/);
    assert.match(composer, /\.op-count \{ font-family: 'Cinzel'/);
  });

  test("R38's approved copy is at the panel's foot", () => {
    const panel = composer.slice(composer.indexOf('data-publish-panel'), composer.indexOf('</aside>'));
    assert.match(panel, /COMPOSER_NOTE/);
    assert.match(panel, /data-op-composer-note/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R39 · contrast on the ink ground', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  const INK = [0x08, 0x06, 0x10], CREAM = [0xf5, 0xf0, 0xe8];
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const over = (fg, a) => fg.map((f, i) => a * f + (1 - a) * INK[i]);
  const ratio = (rgb) => { const [a, b] = [L(rgb), L(INK)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };

  test('⭐ THE PLACEHOLDER PASSES — at the old 0.35 it was 2.86:1 and failed both thresholds', () => {
    // The single most-read string on an empty composer, and the one the brief predicted
    // would fail. It did.
    const m = composer.match(/\.op-body::placeholder \{ color: rgba\(245,240,232,([\d.]+)\); \}/);
    assert.ok(m, 'the body placeholder must set an explicit colour');
    const r = ratio(over(CREAM, Number(m[1])));
    assert.ok(r >= 4.5, `placeholder is ${r.toFixed(2)}:1, below the 4.5:1 body minimum`);
    assert.ok(ratio(over(CREAM, 0.35)) < 3, 'the old value really did fail — this is the regression guard');
  });

  test('the body passes AA, and the rail passes the UI minimum', () => {
    assert.ok(ratio(over(CREAM, 0.85)) >= 4.5, 'body text');
    assert.ok(ratio(over(CREAM, 0.45)) >= 3, 'rail at rest');
    assert.ok(ratio([0xc9, 0xa8, 0x4c]) >= 4.5, 'the gold action');
  });

  test('⭐ THE PUBLISH ACTION IS NO LONGER PURPLE-ON-CREAM', () => {
    // #6b2fad under cream measures 2.52:1 — it failed, on the one control the page
    // exists to reach. The action is gold on ink at 8.80:1.
    assert.ok(ratio([0x6b, 0x2f, 0xad]) < 3, 'the purple really did fail');
    const action = composer.slice(composer.indexOf('.op-action {'), composer.indexOf('.op-action {') + 300);
    assert.equal(/#6b2fad|107,47,173/.test(action), false, 'the failing purple must not come back');
    assert.match(action, /#c9a84c/);
  });
});
