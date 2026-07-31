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
import { renderInlineHtml, renderInlineText } from '../../app/lib/newsletterRender.js';

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
const mirror = new Function(`${mirrorSrc}\nreturn { renderInlineHtmlMirror, renderInlineTextMirror };`)();

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
