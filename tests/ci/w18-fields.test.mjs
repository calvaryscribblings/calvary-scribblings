// W18 — NO ZOOM WHEN A TEXT FIELD IS TAPPED, and pinch zoom kept.
//
//   node --test tests/ci/w18-fields.test.mjs      (part of npm run test:ci)
//
// The live measurement is tests/typography/field-census.mjs (every reachable field at 390).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const src = (p) => readFileSync(p, 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : /\.(m?js|jsx|css)$/.test(e) ? [p] : [];
});
const APP = walk('app');

describe('W18 · every text field is 16px on a touch screen', () => {
  const css = src('app/globals.css');
  const block = css.slice(css.indexOf('@media (hover: none) and (pointer: coarse) {'), css.indexOf('}\n}', css.indexOf('@media (hover: none) and (pointer: coarse) {')) + 3);
  test('one rule, in globals.css, for touch screens only', () => {
    assert.ok(block.length > 50, 'the touch-screen block exists');
    assert.match(block, /font-size: 16px !important;/);
    for (const sel of ['input:not([type="checkbox"])', 'textarea:not([data-field-large])', 'select:not([data-field-large])', '[contenteditable]:not([contenteditable="false"]):not([data-field-large])']) {
      assert.ok(block.includes(sel), sel);
    }
    assert.match(src('app/layout.js'), /import '\.\/globals\.css';/);
  });
  test('the only opt-out is data-field-large, and every such field is set at 16px or more', () => {
    const hits = [];
    for (const p of APP.filter((f) => f.endsWith('.js'))) {
      const s = src(p);
      let i = s.indexOf('data-field-large=""');
      while (i >= 0) {
        const open = s.lastIndexOf('<', i);
        const tag = s.slice(open, s.indexOf('/>', i) > 0 ? s.indexOf('/>', i) : i + 600);
        let px = null;
        const inline = tag.match(/fontSize:\s*'([\d.]+)rem'/);
        if (inline) px = parseFloat(inline[1]) * 16;
        const cls = tag.match(/className="([\w-]+)"/);
        if (px === null && cls) {
          const rule = s.match(new RegExp(`\\.${cls[1]}\\s*\\{[^}]*font-size:\\s*(clamp\\([^;]*\\)|[\\d.]+(?:rem|px))`));
          if (rule) {
            const v = rule[1];
            const nums = [...v.matchAll(/([\d.]+)(rem|px)/g)].map(([, n, u]) => (u === 'rem' ? n * 16 : +n));
            px = Math.min(...nums);
          }
        }
        hits.push({ p, px });
        i = s.indexOf('data-field-large=""', i + 1);
      }
    }
    assert.equal(hits.length, 5, 'search, and the Open Pages title and body on new and edit');
    for (const h of hits) assert.ok(h.px !== null && h.px >= 16, `${h.p}: a large field at ${h.px}px`);
  });
  test('pinch zoom stays: no maximum-scale, no user-scalable=no, anywhere', () => {
    for (const p of [...APP, ...readdirSync('public').filter((f) => f.endsWith('.html')).map((f) => join('public', f))]) {
      assert.doesNotMatch(src(p).replace(/\/\*[\s\S]*?\*\//g, ''), /maximum-scale|user-scalable|maximumScale|userScalable/, p);
    }
  });
  test('the Square\'s messages button has a name (the census, and a screen reader, can find it)', () => {
    assert.match(src('app/square/page.js'), /onClick=\{\(\) => setShowDM\(true\)\} aria-label="Messages"/);
  });
});
