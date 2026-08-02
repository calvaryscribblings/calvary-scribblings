// Lockstep enforcement for cs-inline-v1.
//
//   node --test tests/newsletter/mirror-parity.test.mjs
//
// app/lib/newsletterRender.js drives the admin's live preview. The hand-copy
// inside workers-external/calvary-newsletter.worker.js drives the mail that
// actually goes out. The CS-INLINE-V1 CONTRACT says they must agree — this test
// is what makes that claim checkable instead of aspirational.
//
// It lifts the mirror straight out of the Worker source, evaluates it, and runs
// both implementations over a corpus. Eyeballing two copies of a parser is
// exactly the kind of review that passes right up until the day it doesn't.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderInlineHtml,
  renderInlineText,
  renderImageHtml,
  renderImageText,
  imageBlockError,
} from '../../app/lib/newsletterRender.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER = resolve(ROOT, 'workers-external/calvary-newsletter.worker.js');

const src = await readFile(WORKER, 'utf8');

// Slice out escHtml through renderInlineTextMirror. Anchored on markers that are
// themselves load-bearing comments, so a refactor that moves them fails here
// loudly rather than silently testing nothing.
const START = 'function escHtml(s) {';
const END = "// The mail's text/plain part";
const a = src.indexOf(START);
const b = src.indexOf(END);

test('the mirror can be located in the Worker source', () => {
  assert.ok(a !== -1, `could not find "${START}" in the Worker`);
  assert.ok(b !== -1, `could not find "${END}" in the Worker`);
  assert.ok(b > a, 'Worker mirror markers are out of order');
});

const mirrorSrc = src.slice(a, b);
// eslint-disable-next-line no-new-func
const mirror = new Function(
  `${mirrorSrc}\nreturn { renderInlineHtmlMirror, renderInlineTextMirror, renderImageHtmlMirror, renderImageTextMirror, imageBlockErrorMirror };`
)();

const CORPUS = [
  '',
  'plain prose with nothing special in it',
  'a **b** c',
  'a *b* c',
  'a __b__ c',
  '**a *b* c**',
  '**a __b__ c**',
  '**__both__**',
  'a **b c',
  'a __b c',
  '2 * 3 = 6',
  '**a\nb**',
  'read the _quiet_ file_name here',
  'see [the island](https://calvaryscribblings.co.uk) now',
  '[**bold link**](https://x.co)',
  '[k](https://x.co/a__b__c/d**e**f)',
  '[q](https://x.co/s?a=1&b=2)',
  '[](https://x.co)',
  '[x](javascript:alert(1))',
  '[x](data:text/html,hi)',
  '[x](https://x.co/")onmouseover="alert(1))',
  '<strong>hi</strong>',
  '<script>alert(1)</script>',
  `Tom & Jerry's "book"`,
  'literal \\*asterisks\\* here',
  '\\*\\*not bold\\*\\*',
  '\\**not bold\\**',
  '\\_\\_not underline\\_\\_',
  'a \\[b\\](c)',
  'a \\\\ b',
  '\u00000\u0000 and \u00010\u0001',
  'em—dash, ellipsis…, emoji 🏝️, curly ’quotes’',
  '***triple***',
  '____quad____',
  '**',
  '*',
  '__',
  '[unclosed](https://x.co',
  'a > b < c & d',
];

test('HTML: mirror matches the repo module across the corpus', () => {
  for (const input of CORPUS) {
    assert.equal(
      mirror.renderInlineHtmlMirror(input),
      renderInlineHtml(input),
      `HTML drift on input: ${JSON.stringify(input)}`
    );
  }
});

test('TEXT: mirror matches the repo module across the corpus', () => {
  for (const input of CORPUS) {
    assert.equal(
      mirror.renderInlineTextMirror(input),
      renderInlineText(input),
      `TEXT drift on input: ${JSON.stringify(input)}`
    );
  }
});

// Deterministic pseudo-random fuzz over the marker alphabet. Seeded so a failure
// is reproducible; no Math.random.
test('mirror matches the repo module under fuzz', () => {
  const alphabet = ['*', '_', '\\', '[', ']', '(', ')', '<', '>', '&', '"', "'", 'a', ' ', 'https://x.co', '\n'];
  let seed = 20260731;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 4000; i++) {
    const len = 1 + (next() % 24);
    let s = '';
    for (let j = 0; j < len; j++) s += alphabet[next() % alphabet.length];
    assert.equal(mirror.renderInlineHtmlMirror(s), renderInlineHtml(s), `HTML drift on fuzz: ${JSON.stringify(s)}`);
    assert.equal(mirror.renderInlineTextMirror(s), renderInlineText(s), `TEXT drift on fuzz: ${JSON.stringify(s)}`);
  }
});

// The whole point of escape-first. Whatever the fuzz throws at it, the renderer
// must never emit a tag outside the grammar, and never an event handler.
test('fuzz never produces a tag outside the grammar', () => {
  const allowed = /^(?:strong|em|u|a|\/strong|\/em|\/u|\/a)$/;
  const alphabet = ['*', '_', '\\', '[', ']', '(', ')', '<', '>', 'script', 'img', 'onerror=', 'a', ' ', 'https://x.co', 'javascript:'];
  let seed = 815;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 4000; i++) {
    const len = 1 + (next() % 20);
    let s = '';
    for (let j = 0; j < len; j++) s += alphabet[next() % alphabet.length];
    const out = renderInlineHtml(s);
    for (const m of out.matchAll(/<\s*([a-z/]+)/gi)) {
      assert.ok(allowed.test(m[1]), `emitted <${m[1]}> from ${JSON.stringify(s)} → ${out}`);
    }
    assert.ok(!/\son\w+\s*=/i.test(out), `emitted an event handler from ${JSON.stringify(s)} → ${out}`);
    assert.ok(!/javascript:/i.test(out.replace(/javascript:/g, (x, o) => (out.slice(0, o).includes('href="') ? x : ''))) || !/href="javascript:/i.test(out),
      `emitted a javascript: href from ${JSON.stringify(s)} → ${out}`);
  }
});

// ── Image blocks ─────────────────────────────────────────────────────────────
// Same lockstep rule as the inline renderers: the Worker's copy drives the
// mail, the repo's drives the preview, and a difference between them is a
// picture that looks one way in the studio and another in the inbox.

const IMAGE_BLOCKS = [
  { type: 'image', src: 'https://x.co/a.png', alt: 'A picture' },
  { type: 'image', src: 'https://x.co/a.png?token=1&b=2', alt: 'Query & ampersand' },
  { type: 'image', src: 'https://x.co/a.png', alt: `Jerry's "quoted" <tag>` },
  { type: 'image', src: 'https://x.co/a.png', alt: '  padded  ' },
  { type: 'image', src: '  https://x.co/a.png  ', alt: 'padded src' },
  // Every one of these must render to the empty string on BOTH sides.
  { type: 'image', src: 'http://x.co/a.png', alt: 'insecure' },
  { type: 'image', src: 'javascript:alert(1)', alt: 'hostile' },
  { type: 'image', src: 'data:image/png;base64,AAAA', alt: 'inline data' },
  { type: 'image', src: '//x.co/a.png', alt: 'protocol relative' },
  { type: 'image', src: '/local.png', alt: 'root relative' },
  { type: 'image', src: 'https://x.co/a.png', alt: '' },
  { type: 'image', src: 'https://x.co/a.png', alt: '   ' },
  { type: 'image', src: 'https://x.co/a.png' },
  { type: 'image', src: '', alt: 'no src' },
  { type: 'image' },
  {},
  null,
  { type: 'image', src: 'HTTPS://X.CO/A.PNG', alt: 'uppercase scheme' },
  { type: 'image', src: 'https://x.co/a.png"onload="alert(1)', alt: 'breakout attempt' },
  { type: 'image', src: 'https://x.co/a.png', alt: 'breakout" onload="alert(1)' },
];

test('image HTML: mirror matches the repo module', () => {
  for (const block of IMAGE_BLOCKS) {
    assert.equal(
      mirror.renderImageHtmlMirror(block),
      renderImageHtml(block),
      `image HTML drift on: ${JSON.stringify(block)}`
    );
  }
});

test('image TEXT: mirror matches the repo module', () => {
  for (const block of IMAGE_BLOCKS) {
    assert.equal(
      mirror.renderImageTextMirror(block),
      renderImageText(block),
      `image TEXT drift on: ${JSON.stringify(block)}`
    );
  }
});

test('image validation: mirror agrees with the repo module, message for message', () => {
  for (const block of IMAGE_BLOCKS) {
    assert.equal(
      mirror.imageBlockErrorMirror(block),
      imageBlockError(block),
      `image validation drift on: ${JSON.stringify(block)}`
    );
  }
});

test('an invalid image renders NOTHING, not a broken tag', () => {
  const invalid = IMAGE_BLOCKS.filter((b) => imageBlockError(b));
  assert.ok(invalid.length >= 10, 'expected the corpus to carry real invalid cases');
  for (const block of invalid) {
    assert.equal(renderImageHtml(block), '', `rendered markup for ${JSON.stringify(block)}`);
    assert.equal(renderImageText(block), '', `rendered text for ${JSON.stringify(block)}`);
  }
});

// The invariant is STRUCTURAL, not a keyword scan. `alt="… onerror=…"` is
// perfectly safe when the quotes around it are escaped — searching the output
// for "onerror=" flags that harmless case and still misses a real breakout.
// What actually matters is that the tag has exactly these four attributes and
// that no value contains a raw quote, which [^"]* is what proves: if a value
// could close its own quote, the shape would not match.
const IMG_SHAPE = /^<img src="[^"]*" alt="[^"]*" width="540" style="display:block;max-width:100%;height:auto;border-radius:6px;" \/>$/;

test('a rendered image cannot break out of its attributes', () => {
  for (const block of IMAGE_BLOCKS) {
    const out = renderImageHtml(block);
    if (!out) continue;
    assert.match(out, IMG_SHAPE, `escaped its attribute shape: ${out}`);
  }
});

test('a hostile alt is inert content, not markup', () => {
  const out = renderImageHtml({ type: 'image', src: 'https://x.co/a.png', alt: 'x" onload="alert(1)' });
  assert.match(out, IMG_SHAPE);
  assert.ok(out.includes('&quot;'), `the quote was not escaped: ${out}`);
  assert.ok(!/alt="[^"]*"\s+onload/i.test(out), `onload escaped the alt value: ${out}`);
});

// Fuzz the two author-controlled fields. src and alt both land inside attribute
// values, so the escaping is the whole defence.
test('image fuzz never escapes its attributes', () => {
  const alphabet = ['"', "'", '<', '>', '&', ' ', '/', 'a', 'onerror=', 'javascript:', 'https://x.co/', '.png', '\\', '\n'];
  let seed = 4242;
  const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 3000; i++) {
    const build = () => {
      const len = 1 + (next() % 10);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[next() % alphabet.length];
      return s;
    };
    const block = { type: 'image', src: `https://x.co/${build()}`, alt: build() };
    assert.equal(mirror.renderImageHtmlMirror(block), renderImageHtml(block), `fuzz drift: ${JSON.stringify(block)}`);
    const out = renderImageHtml(block);
    if (!out) continue;
    assert.match(out, IMG_SHAPE, `broke its attribute shape from ${JSON.stringify(block)}`);
  }
});

// ── The format gate ──────────────────────────────────────────────────────────
// Everything above proves the two renderers agree. These prove the renderer is
// only reached when a block asks for it — the guarantee that seven already-sent
// issues and any saved draft keep mailing exactly as they did.

const buildEmail = new Function(
  `${src.slice(src.indexOf('function escHtml(s) {'), src.indexOf('function unsubscribePage('))}\nreturn buildEmail;`
)();

test('a text block WITHOUT a format field is escaped, never parsed', () => {
  const out = buildEmail({
    subject: 's',
    issueNumber: 1,
    blocks: [{ type: 'text', id: '1', content: 'A **bold** and a <tag> and _under_.' }],
  });
  assert.ok(out.includes('A **bold** and a &lt;tag&gt; and _under_.'), out);
  assert.ok(!out.includes('<strong>'), 'legacy block was parsed as cs-inline-v1');
});

test('a text block WITH format:cs-inline-v1 is parsed', () => {
  const out = buildEmail({
    subject: 's',
    issueNumber: 1,
    blocks: [{ type: 'text', id: '1', format: 'cs-inline-v1', content: 'A **bold** one.' }],
  });
  assert.ok(out.includes('<strong>bold</strong>'), out);
});

test('an unrecognised format value falls back to escaping, not to parsing', () => {
  const out = buildEmail({
    subject: 's',
    issueNumber: 1,
    blocks: [{ type: 'text', id: '1', format: 'cs-inline-v2', content: 'A **bold** one.' }],
  });
  assert.ok(out.includes('A **bold** one.'), out);
  assert.ok(!out.includes('<strong>'), 'unknown format was parsed — must fail closed');
});

test('a valid image block reaches the mail in the padded cell at 540', () => {
  const out = buildEmail({
    subject: 's',
    issueNumber: 1,
    blocks: [{ type: 'image', id: '1', src: 'https://x.co/a.png?t=1&b=2', alt: `Jerry's <picture>` }],
  });
  assert.ok(out.includes('<tr><td style="padding:20px 40px;"><img src='), out);
  assert.ok(out.includes('width="540"'), out);
  assert.ok(out.includes('a.png?t=1&amp;b=2'), 'src not escaped');
  assert.ok(out.includes('alt="Jerry&#39;s &lt;picture&gt;"'), 'alt not escaped');
  assert.ok(!out.includes('<picture>'), 'raw alt markup reached the mail');
});

test('an invalid image block leaves NO cell in the mail', () => {
  for (const block of [
    { type: 'image', id: '1', src: 'http://x.co/a.png', alt: 'insecure' },
    { type: 'image', id: '1', src: 'https://x.co/a.png', alt: '' },
    { type: 'image', id: '1', src: '', alt: 'nothing' },
  ]) {
    const out = buildEmail({ subject: 's', issueNumber: 1, blocks: [block] });
    assert.ok(!out.includes('<img'), `an img reached the mail from ${JSON.stringify(block)}`);
    assert.ok(!out.includes('padding:20px 40px'), `an empty cell was emitted for ${JSON.stringify(block)}`);
  }
});

test('story block fields are escaped', () => {
  const out = buildEmail({
    subject: 's',
    issueNumber: 1,
    blocks: [{ type: 'story', id: '1', slug: 'x', title: "Jerry's <b>Tale</b>", author: 'A & B', category: 'Fiction', cover: 'https://x.co/c.jpg?a=1&b=2', excerpt: 'It <em>is</em>.' }],
  });
  assert.ok(!out.includes('<b>Tale</b>'), 'raw title markup reached the mail');
  assert.ok(out.includes('Jerry&#39;s &lt;b&gt;Tale&lt;/b&gt;'), out);
  assert.ok(out.includes('c.jpg?a=1&amp;b=2'), 'cover URL not escaped in src');
});
