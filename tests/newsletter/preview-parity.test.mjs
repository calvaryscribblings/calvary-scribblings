// The admin preview must not lie about the mail.
//
//   node --test tests/newsletter/preview-parity.test.mjs
//
// mirror-parity.test.mjs proves the two INLINE renderers agree. That is not
// enough on its own: the preview also has to segment paragraphs the way
// buildEmail segments them, and take the same branch of the format gate. Before
// this, it did neither — it rendered the raw source under white-space:pre-wrap,
// so markers showed as literal asterisks and a single newline looked like a
// break the mail collapses to a space.
//
// This test runs the preview's own projection —
// renderTextBlockParagraphs() from app/lib/newsletterRender.js — and asserts
// its output is EXACTLY the paragraph HTML the Worker's buildEmail emits for
// the same block. The Worker keeps that segmentation inline, so there is no
// function there to compare against by name; comparing against the rendered
// mail is what makes the claim checkable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderTextBlockParagraphs,
  splitParagraphs,
  renderImageHtml,
  renderImageText,
} from '../../app/lib/newsletterRender.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = await readFile(resolve(ROOT, 'workers-external/calvary-newsletter.worker.js'), 'utf8');

const { buildEmail, buildEmailText } = new Function(
  `${src.slice(src.indexOf('function escHtml(s) {'), src.indexOf('function unsubscribePage('))}\nreturn { buildEmail, buildEmailText };`
)();

// The shell buildEmail wraps each paragraph and each text block in. Restated
// here rather than derived, so a change to either end of the contract has to be
// made deliberately in both places.
const P_OPEN = '<p style="color:#1a1a2e;font-size:16px;line-height:1.75;margin:0 0 16px;">';
const TD_OPEN = '<tr><td style="padding:20px 40px;">';

function mailBlockHtml(block) {
  const out = buildEmail({ subject: 's', issueNumber: 1, blocks: [block] });
  const a = out.indexOf(TD_OPEN);
  if (a === -1) return null; // block emitted nothing at all
  return out.slice(a + TD_OPEN.length, out.indexOf('</td></tr>', a));
}

const BLOCKS = [
  { name: 'legacy, one paragraph', block: { type: 'text', id: '1', content: 'A **bold** and a <tag> and _under_.' } },
  { name: 'legacy, two paragraphs', block: { type: 'text', id: '1', content: 'One.\n\nTwo.' } },
  { name: 'rich, one paragraph', block: { type: 'text', id: '1', format: 'cs-inline-v1', content: 'A **bold** one.' } },
  { name: 'rich, two paragraphs', block: { type: 'text', id: '1', format: 'cs-inline-v1', content: 'First **para**.\n\nSecond *para*.' } },
  { name: 'rich, three blank lines between', block: { type: 'text', id: '1', format: 'cs-inline-v1', content: 'a\n\n\n\nb' } },
  { name: 'rich, single newline inside a paragraph', block: { type: 'text', id: '1', format: 'cs-inline-v1', content: 'line one\nline two' } },
  { name: 'rich, leading and trailing blank lines', block: { type: 'text', id: '1', format: 'cs-inline-v1', content: '\n\n  padded  \n\n' } },
  { name: 'rich, a link', block: { type: 'text', id: '1', format: 'cs-inline-v1', content: 'see [the island](https://calvaryscribblings.co.uk) now' } },
  { name: 'rich, a link with an escaped bracket', block: { type: 'text', id: '1', format: 'cs-inline-v1', content: '[a\\]b](https://x.co)' } },
  { name: 'rich, an unsafe link falls through', block: { type: 'text', id: '1', format: 'cs-inline-v1', content: '[x](javascript:alert(1))' } },
  { name: 'rich, html in the source', block: { type: 'text', id: '1', format: 'cs-inline-v1', content: '<script>alert(1)</script> & "quotes"' } },
  { name: 'unknown format fails closed', block: { type: 'text', id: '1', format: 'cs-inline-v2', content: 'A **bold** one.' } },
  { name: 'rich, whitespace-only paragraph is dropped', block: { type: 'text', id: '1', format: 'cs-inline-v1', content: 'a\n\n   \n\nb' } },
];

test('preview paragraphs are exactly the mail paragraphs', () => {
  for (const { name, block } of BLOCKS) {
    const preview = renderTextBlockParagraphs(block);
    const expected = preview.map((h) => `${P_OPEN}${h}</p>`).join('');
    assert.equal(mailBlockHtml(block), expected, `preview/mail drift on: ${name}`);
  }
});

test('a block the preview shows as empty emits nothing in the mail', () => {
  for (const content of ['', '   ', '\n\n', '\n \n \n', null, undefined]) {
    const block = { type: 'text', id: '1', format: 'cs-inline-v1', content };
    assert.equal(renderTextBlockParagraphs(block).length, 0, `preview kept a paragraph for ${JSON.stringify(content)}`);
    assert.equal(mailBlockHtml(block), null, `mail emitted a block for ${JSON.stringify(content)}`);
  }
});

// The gate again, from the preview's side. mirror-parity proves buildEmail
// honours it; these prove the preview honours it identically, which is what
// stops the studio showing formatting on a block that mails out escaped.
test('the preview does not parse a block without a format field', () => {
  const [p] = renderTextBlockParagraphs({ type: 'text', content: 'A **bold** and <tag>.' });
  assert.equal(p, 'A **bold** and &lt;tag&gt;.');
  assert.ok(!p.includes('<strong>'), 'legacy block was parsed in the preview');
});

test('the preview parses a block with format cs-inline-v1', () => {
  const [p] = renderTextBlockParagraphs({ type: 'text', format: 'cs-inline-v1', content: 'A **bold** one.' });
  assert.equal(p, 'A <strong>bold</strong> one.');
});

test('the preview fails closed on an unrecognised format', () => {
  const [p] = renderTextBlockParagraphs({ type: 'text', format: 'cs-inline-v9', content: 'A **bold** one.' });
  assert.equal(p, 'A **bold** one.');
});

test('renderTextBlockParagraphs tolerates a missing or malformed block', () => {
  assert.deepEqual(renderTextBlockParagraphs(null), []);
  assert.deepEqual(renderTextBlockParagraphs({}), []);
  assert.deepEqual(renderTextBlockParagraphs({ content: 42 }), ['42']);
});

// ── Image blocks ─────────────────────────────────────────────────────────────
// The preview renders images through renderImageHtml, the same function the
// Worker mirrors. What this pins is that the preview's markup is EXACTLY the
// markup that lands in the padded cell — same 540 width, same escaping — so the
// picture cannot look one size in the studio and another in the inbox.

const IMAGE_CELL_OPEN = '<tr><td style="padding:20px 40px;">';

const PREVIEW_IMAGES = [
  { name: 'plain', block: { type: 'image', id: '1', src: 'https://x.co/a.png', alt: 'A picture' } },
  { name: 'ampersand in src', block: { type: 'image', id: '1', src: 'https://x.co/a.png?t=1&b=2', alt: 'Q' } },
  { name: 'markup in alt', block: { type: 'image', id: '1', src: 'https://x.co/a.png', alt: `Jerry's <b>dog</b>` } },
  { name: 'padded values', block: { type: 'image', id: '1', src: '  https://x.co/a.png  ', alt: '  Trimmed  ' } },
];

test('the preview image markup is exactly the mail image markup', () => {
  for (const { name, block } of PREVIEW_IMAGES) {
    const out = buildEmail({ subject: 's', issueNumber: 1, blocks: [block] });
    const a = out.indexOf(IMAGE_CELL_OPEN);
    assert.notEqual(a, -1, `no image cell in the mail for: ${name}`);
    const cell = out.slice(a + IMAGE_CELL_OPEN.length, out.indexOf('</td></tr>', a));
    assert.equal(cell, renderImageHtml(block), `preview/mail image drift on: ${name}`);
  }
});

test('an image the preview refuses is an image the mail omits', () => {
  for (const block of [
    { type: 'image', id: '1', src: 'http://x.co/a.png', alt: 'insecure' },
    { type: 'image', id: '1', src: 'javascript:alert(1)', alt: 'hostile' },
    { type: 'image', id: '1', src: 'https://x.co/a.png', alt: '   ' },
    { type: 'image', id: '1', src: '', alt: 'no src' },
  ]) {
    assert.equal(renderImageHtml(block), '', `preview rendered ${JSON.stringify(block)}`);
    const out = buildEmail({ subject: 's', issueNumber: 1, blocks: [block] });
    assert.ok(!out.includes('<img'), `mail rendered ${JSON.stringify(block)}`);
  }
});

test('the text part carries [image: alt], never the URL', () => {
  const block = { type: 'image', id: '1', src: 'https://x.co/secret-token-url.png', alt: 'A lighthouse at dusk' };
  const text = buildEmailText({ subject: 's', issueNumber: 1, blocks: [block] });
  assert.ok(text.includes('[image: A lighthouse at dusk]'), text);
  assert.ok(!text.includes('secret-token-url'), 'the storage URL leaked into the text part');
  assert.equal(renderImageText(block), '[image: A lighthouse at dusk]');
});

test('an invalid image contributes nothing to the text part', () => {
  const block = { type: 'image', id: '1', src: 'http://x.co/a.png', alt: 'insecure' };
  const text = buildEmailText({ subject: 's', issueNumber: 1, blocks: [block] });
  assert.ok(!text.includes('[image:'), text);
  assert.equal(renderImageText(block), '');
});

test('an image sits between its neighbours in both parts, in order', () => {
  const blocks = [
    { type: 'text', id: '1', format: 'cs-inline-v1', content: 'Before the picture.' },
    { type: 'image', id: '2', src: 'https://x.co/a.png', alt: 'The picture' },
    { type: 'text', id: '3', format: 'cs-inline-v1', content: 'After the picture.' },
  ];
  const html = buildEmail({ subject: 's', issueNumber: 1, blocks });
  assert.ok(html.indexOf('Before the picture.') < html.indexOf('<img'), html);
  assert.ok(html.indexOf('<img') < html.indexOf('After the picture.'), html);
  const text = buildEmailText({ subject: 's', issueNumber: 1, blocks });
  assert.ok(text.indexOf('Before the picture.') < text.indexOf('[image: The picture]'), text);
  assert.ok(text.indexOf('[image: The picture]') < text.indexOf('After the picture.'), text);
});

test('splitParagraphs matches the Worker split across an awkward corpus', () => {
  const cases = ['', 'a', 'a\nb', 'a\n\nb', 'a\n\n\nb', '\n\na\n\n', '   ', 'a\n\n   \n\nb', 'a  \n\n  b'];
  for (const content of cases) {
    // The Worker's split, transcribed from buildEmail. If this drifts, the
    // assertion above against real buildEmail output catches it too — this one
    // just localises the failure.
    const worker = String(content || '').split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    assert.deepEqual(splitParagraphs(content), worker, `split drift on ${JSON.stringify(content)}`);
  }
});
