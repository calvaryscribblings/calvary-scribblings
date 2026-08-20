// R17.3 — EVERY BOOK ON THE SHOP TURNS OVER, asserted at the source. `npm run test:purchases`.
//
// The defect this exists for was not a typo. Three surfaces rendered the same component and
// only one of them wrapped it in the gesture, and the two that did not read perfectly well:
// the props were optional and the JSX was clean. Nothing could have caught it except a rule
// about WHERE the gesture is allowed to live and a register of WHO renders a book.
//
// So this file asserts two things a reviewer cannot see:
//   1. the gesture is inside BoundBook and the props that used to bypass it are GONE, so a
//      surface cannot render a dead book even by accident;
//   2. every `<BoundBook` call site in the tree is one the register knows about — which is
//      what stops a FIFTH surface from shipping quietly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const BOOK = src('app/bookstore/components/BoundBook.js');

function record(name, body = BOOK) {
  const m = new RegExp(`export const ${name} = ([\\s\\S]*?)\\n\\};`).exec(body);
  if (!m) throw new Error(`BoundBook.js no longer exports ${name} as a literal`);
  return new Function(`return ${m[1]}\n};`)();
}
const SURFACES = record('BOOK_SURFACES');

/** Every .js under app/, minus the vestigial trees CLAUDE.md forbids touching. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (name.endsWith('.js')) out.push(p.slice(ROOT.length));
  }
  return out;
}

describe('R17.3 — THE FLIP IS THE BOOK\'S, NOT THE SURFACE\'S', () => {

  test('BoundBook carries the gesture itself', () => {
    assert.match(BOOK, /import \{ useBookGesture \} from '\.\/useBookGesture'/,
      'BoundBook no longer imports the gesture — a surface would have to supply it again');
    const fn = /export default function BoundBook\(\{([^}]*)\}[^)]*\) \{([\s\S]*?)\n\}/.exec(BOOK);
    assert.ok(fn, 'BoundBook is no longer a destructuring function declaration');
    assert.match(fn[2], /useBookGesture\(/, 'BoundBook does not call useBookGesture');
  });

  test('the three props that let a caller own the gesture are GONE, and stay gone', () => {
    // This is the guarantee. While `flipped` / `bind` / `bookRef` were accepted, a surface
    // that simply did not pass them rendered a book that ignored every tap — which is exactly
    // what the Window and the curated case did. There is no longer a way to express that.
    const params = /export default function BoundBook\(\{([^}]*)\}/.exec(BOOK)[1];
    for (const prop of SURFACES.retiredProps) {
      assert.equal(new RegExp(`(^|[\\s,{])${prop}\\s*[,=}]`).test(params), false,
        `BoundBook still accepts \`${prop}\` — a surface can bypass the gesture again`);
    }
  });

  test('no surface builds its own gesture around a book', () => {
    // One call site, and it is inside the component. A second would be the copy-the-handler
    // fix this round explicitly refused: three copies is three places to forget a fourth.
    const HOOK = 'app/bookstore/components/useBookGesture.js';   // its own declaration is not a call
    const callers = walk(join(ROOT, 'app'))
      .filter((f) => f !== HOOK)
      .filter((f) => /useBookGesture\s*\(/.test(src(f)));
    assert.deepEqual(callers.sort(), ['app/bookstore/components/BoundBook.js'],
      'something other than BoundBook calls useBookGesture — the handler has been copied');
  });

  test('THE REGISTER — every file that renders a book is one we know about', () => {
    // A fifth surface fails here until it is registered, at which point whoever adds it has to
    // say what a tap on its book leads to. That is the whole point: not a reminder, a stop.
    const renderers = walk(join(ROOT, 'app'))
      .filter((f) => f !== 'app/bookstore/components/BoundBook.js')
      .filter((f) => /<BoundBook[\s/>]/.test(src(f)));
    const registered = [...new Set(SURFACES.surfaces.map((s) => s.file))].sort();
    assert.deepEqual(renderers.sort(), registered,
      'a file renders a BoundBook without a BOOK_SURFACES entry — register it and say what its tap opens');
  });

  test('every registered surface exists, and every one of them names a destination', () => {
    assert.ok(SURFACES.surfaces.length >= 4);
    for (const s of SURFACES.surfaces) {
      const body = src(s.file);
      assert.match(body, /<BoundBook[\s/>]/, `${s.file} does not render a BoundBook`);
      assert.match(body, new RegExp(`\\b${s.component}\\b`), `${s.file} has no ${s.component}`);
      assert.ok(['quick-look', 'turns-back'].includes(s.opens),
        `${s.key} claims an unknown destination: ${s.opens}`);
    }
  });

  // ⚠ SCOPED TO THE COMPONENT, NOT THE FILE, and that is not fussiness. app/bookstore/page.js
  // holds TWO registered surfaces — the shelf and the Window — and a file-wide search is
  // satisfied by either of them. An earlier draft of this suite did exactly that and passed
  // clean while the Window's onOpen was deleted, because ShelfEntry's was still in the file.
  // The browser suite caught it; this one is meant to catch it first.
  function bodyOf(surface) {
    const body = src(surface.file);
    const start = new RegExp(`^(export (default )?)?function ${surface.component}\\b`, 'm').exec(body);
    assert.ok(start, `${surface.file} no longer declares ${surface.component}`);
    // To the next line that closes a declaration at column 0 — these are all top-level.
    const rest = body.slice(start.index);
    const end = /\n\}/.exec(rest);
    assert.ok(end, `${surface.component} in ${surface.file} has no top-level close`);
    return rest.slice(0, end.index);
  }

  function booksIn(surface) {
    const tags = bodyOf(surface).match(/<BoundBook[^>]*>/g) || [];
    assert.ok(tags.length > 0, `${surface.component} renders no BoundBook`);
    return tags;
  }

  test('a surface that says quick-look actually hands ITS OWN book an onOpen', () => {
    for (const s of SURFACES.surfaces.filter((x) => x.opens === 'quick-look')) {
      assert.ok(booksIn(s).every((t) => /\bonOpen=/.test(t)),
        `${s.key} (${s.component}) claims quick-look but renders a <BoundBook> with no onOpen`);
    }
  });

  test('a surface that says turns-back is not quietly wired to a modal instead', () => {
    for (const s of SURFACES.surfaces.filter((x) => x.opens === 'turns-back')) {
      assert.ok(booksIn(s).every((t) => !/\bonOpen=/.test(t)),
        `${s.key} (${s.component}) says the book turns back but is passing onOpen`);
    }
  });

  test('a book with nowhere to go turns back rather than staying face-down', () => {
    // Without this the two turns-back surfaces would flip on tap and stay flipped forever:
    // the only thing that ever called `reset` was the Quick Look closing.
    const gesture = src('app/bookstore/components/useBookGesture.js');
    const fn = /const openNow = useCallback\(\(\) => \{([\s\S]*?)\}, \[/.exec(gesture);
    assert.ok(fn, 'useBookGesture no longer has an openNow');
    assert.match(fn[1], /if \(!onOpen\) \{ setFlipped\(false\); return; \}/,
      'openNow no longer turns the book back when the surface has no way in');
  });

  test('nowhere hands a book a NO-OP onOpen, which is worse than none', () => {
    // `onOpen={() => {}}` looks like "this surface has no modal" and behaves like the exact
    // opposite: openNow sees a function, calls it, nothing happens, and the book is left face
    // down because the only thing that ever un-flips it is the Quick Look closing. The CMS
    // preview did this from R13 until R17.3. Omission is how a surface says it has no way in.
    for (const f of walk(join(ROOT, 'app'))) {
      const body = src(f);
      assert.equal(/onOpen=\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/.test(body), false,
        `${f} hands a book a no-op onOpen — omit it instead, and the book turns back`);
    }
  });

  test('the pointer cursor is on EVERY book, and the hover lift is still only where it was', () => {
    const css = /export const BOUND_BOOK_CSS = `([\s\S]*?)`;/.exec(BOOK)[1];
    assert.match(css, /(^|\n)\s*\.bb-book\{[^}]*cursor:pointer/,
      'the cursor is no longer on every book — a pressable object that says it is not');
    assert.equal(/\.bb-hoverable \.bb-book\{[^}]*cursor:pointer/.test(css), false,
      'the cursor is back behind .bb-hoverable, so two of the four surfaces disown their own gesture');
    // The LIFT is a look and no ruling moved it. It stays gated.
    assert.match(css, /\.bb-hoverable \.bb-book:not\(\.bb-flipped\):hover\{transform:/,
      'the hover lift is no longer gated on .bb-hoverable');
  });
});
