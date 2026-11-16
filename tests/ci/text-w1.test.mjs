// TEXT-W1 — ruling 390's one behaviour, kept: every multi-line box on the website is GrowTextarea,
// six lines unless it is one of the named long-form editors, and the arithmetic is right.
// The behaviour itself, in real pages at 390 and 1024 and under a simulated iPhone keyboard, is
// tests/text/text-w1.spec.mjs (npm run test:text:w1).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROW_LINES, LONG_FORM, growHeight } from '../../app/lib/growBox.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const files = (() => {
  const out = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      if (n.startsWith('.') || n === 'node_modules') continue;
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.(jsx?|mjs|tsx?)$/.test(n)) out.push(relative(ROOT, f));
    }
  })(join(ROOT, 'app'));
  return out;
})();
// Code only: comments can name <textarea> freely.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

describe('ruling 390: one box', () => {
  test('six lines, a chosen number; the long-form limits', () => {
    assert.equal(GROW_LINES, 6);
    assert.equal(LONG_FORM.PAGE, Infinity);
    assert.equal(LONG_FORM.DESK, 24);
  });

  test('no raw <textarea> anywhere in app/ but GrowTextarea itself', () => {
    const raw = files.filter((f) => f !== 'app/components/GrowTextarea.js' && /<textarea[\s/>]/.test(code(src(f))));
    assert.deepEqual(raw, []);
  });

  test('every file that draws a GrowTextarea imports it', () => {
    for (const f of files.filter((x) => x !== 'app/components/GrowTextarea.js' && /<GrowTextarea[\s/>]/.test(src(x)))) {
      assert.match(src(f), /import GrowTextarea from '[./]+(components\/)?GrowTextarea';/, f);
    }
  });

  test('the long-form editors, and only they, set their own limit', () => {
    const set = files.flatMap((f) => [...src(f).matchAll(/maxLines=\{([^}]+)\}/g)].map((m) => `${f} ${m[1]}`)).sort();
    assert.deepEqual(set, [
      'app/admin/bookstore/page.js LONG_FORM.DESK',      // the Book Store's sample passage
      'app/admin/page.js LONG_FORM.DESK',                // the CMS's story body
      'app/open-pages/edit/[id]/page-client.js LONG_FORM.PAGE',
      'app/open-pages/new/page.js LONG_FORM.PAGE',
    ]);
  });

  test('the Messages box is a growing box, its Send level with the last line', () => {
    const p = src('app/components/square/MessagesPanel.js');
    assert.match(p, /<GrowTextarea data-dm-field rows=\{1\}/);
    assert.doesNotMatch(p, /<input data-dm-field/);
    assert.match(p, /data-dm-compose style=\{\{[^}]*alignItems: 'flex-end'/);
    assert.match(p, /height: kb\.inset > 0 \? '100%' : undefined/, '391: the whole glass with the keyboard up');
  });

  test('the thread reply bar no longer caps itself at three lines', () => {
    const p = src('app/square/p/page.js');
    assert.doesNotMatch(p, /BOX_MAX/);
    assert.doesNotMatch(p, /maxHeight: BOX/);
  });

  test('the Open Pages composer measures through GrowTextarea, never height: auto', () => {
    assert.doesNotMatch(code(src('app/open-pages/new/page.js')), /style\.height = 'auto'/);
  });

  test('391: the profile sheet and the withdrawal dialogs keep to the glass', () => {
    assert.match(src('app/profile/page.js'), /style=\{kb\.inset > 0 \? \{ top: kb\.top, bottom: kb\.inset \} : undefined\}/);
    assert.equal((src('app/admin/bookstore/RemovalDialog.js').match(/useKeyboardInset\(\)/g) || []).length, 2);
  });
});

describe('growHeight', () => {
  const box = { natural: 70, lineHeight: 20, padY: 20, bY: 2 };   // rests at 70: room for 2 lines + 22
  test('rests at its own height until the text needs more', () => {
    assert.deepEqual(growHeight({ ...box, content: 42 }), { height: 70, cap: 142, scrolls: false });
    assert.deepEqual(growHeight({ ...box, content: 62 }), { height: 70, cap: 142, scrolls: false });
  });
  test('one line taller per line, to six; then it holds and scrolls', () => {
    assert.equal(growHeight({ ...box, content: 82 }).height, 82);
    assert.equal(growHeight({ ...box, content: 142 }).height, 142);
    assert.equal(growHeight({ ...box, content: 142 }).scrolls, false);
    assert.deepEqual(growHeight({ ...box, content: 202 }), { height: 142, cap: 142, scrolls: true });
  });
  test('a hair over the cap is rounding, not a line', () => {
    assert.equal(growHeight({ ...box, content: 143 }).scrolls, false);
    assert.equal(growHeight({ ...box, content: 144 }).scrolls, true);
  });
  test('a box whose own look is taller than six lines keeps it', () => {
    assert.deepEqual(growHeight({ ...box, natural: 340, content: 500 }), { height: 340, cap: 340, scrolls: true });
  });
  test('long-form: the page limit never scrolls inside; the desk limit is 24 lines', () => {
    assert.deepEqual(growHeight({ ...box, content: 5000, maxLines: LONG_FORM.PAGE }), { height: 5000, cap: Infinity, scrolls: false });
    assert.equal(growHeight({ ...box, content: 5000, maxLines: LONG_FORM.DESK }).cap, 24 * 20 + 22);
  });
  test('nonsense in, its resting height out', () => {
    assert.deepEqual(growHeight({ natural: 50, content: NaN, lineHeight: 20 }), { height: 50, cap: 50, scrolls: false });
  });
});
