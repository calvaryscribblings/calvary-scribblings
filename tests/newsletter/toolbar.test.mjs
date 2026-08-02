// The composer toolbar's selection surgery.
//
//   node --test tests/newsletter/toolbar.test.mjs
//
// app/lib/newsletterToolbar.js is pure string work precisely so this file can
// exist without a DOM. What is being pinned here is the behaviour an author
// feels: that a second press of Bold removes the bold rather than nesting it,
// that italic inside bold does not quietly destroy the bold, and that a `]` in
// link text cannot close the link early.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKERS,
  applyMarker,
  applyLink,
  escapeLinkText,
  isSafeUrl,
} from '../../app/lib/newsletterToolbar.js';
import { renderInlineHtml } from '../../app/lib/newsletterRender.js';

const B = MARKERS.bold;
const I = MARKERS.italic;
const U = MARKERS.underline;

// A tiny helper so the tests read like the editor: | marks the caret, [ ] the
// selection. Returns the result with the new selection marked the same way.
function at(value, start, end, fn) {
  const r = fn(value, start, end);
  return `${r.value.slice(0, r.selectionStart)}[${r.value.slice(r.selectionStart, r.selectionEnd)}]${r.value.slice(r.selectionEnd)}`;
}

test('wrapping a selection puts the markers outside and keeps the text selected', () => {
  assert.equal(at('a word c', 2, 6, (v, s, e) => applyMarker(v, s, e, B)), 'a **[word]** c');
  assert.equal(at('a word c', 2, 6, (v, s, e) => applyMarker(v, s, e, I)), 'a *[word]* c');
  assert.equal(at('a word c', 2, 6, (v, s, e) => applyMarker(v, s, e, U)), 'a __[word]__ c');
});

test('an empty selection inserts the pair with the caret between the halves', () => {
  const r = applyMarker('ab', 1, 1, B);
  assert.equal(r.value, 'a****b');
  assert.equal(r.selectionStart, 3);
  assert.equal(r.selectionEnd, 3);
  // The next keystroke must land inside the formatting.
  const typed = r.value.slice(0, r.selectionStart) + 'x' + r.value.slice(r.selectionEnd);
  assert.equal(typed, 'a**x**b');
});

test('pressing the same marker again unwraps — markers outside the selection', () => {
  assert.equal(at('a **word** c', 4, 8, (v, s, e) => applyMarker(v, s, e, B)), 'a [word] c');
  assert.equal(at('a __word__ c', 4, 8, (v, s, e) => applyMarker(v, s, e, U)), 'a [word] c');
});

test('unwraps when the author selected the markers too', () => {
  assert.equal(at('a **word** c', 2, 10, (v, s, e) => applyMarker(v, s, e, B)), 'a [word] c');
  assert.equal(at('a *word* c', 2, 8, (v, s, e) => applyMarker(v, s, e, I)), 'a [word] c');
});

test('bold then bold again is a round trip', () => {
  const on = applyMarker('a word c', 2, 6, B);
  const off = applyMarker(on.value, on.selectionStart, on.selectionEnd, B);
  assert.equal(off.value, 'a word c');
  assert.equal(off.selectionStart, 2);
  assert.equal(off.selectionEnd, 6);
});

// The prefix trap: '*' is the start of '**'. A naive implementation reads the
// inner asterisk of each '**' as an italic marker and strips it, silently
// downgrading the author's bold.
test('italic inside a bold run does not eat the bold', () => {
  const r = applyMarker('a **word** c', 4, 8, I);
  assert.equal(r.value, 'a ***word*** c');
  assert.equal(renderInlineHtml('a **word** c'), 'a <strong>word</strong> c');
});

test('italic on a selection that IS a bold run does not unwrap it as italic', () => {
  const r = applyMarker('a **word** c', 2, 10, I);
  assert.equal(r.value, 'a ***word*** c', 'selected "**word**" was treated as an italic run');
});

test('a reversed selection is normalised', () => {
  assert.equal(at('a word c', 6, 2, (v, s, e) => applyMarker(v, s, e, B)), 'a **[word]** c');
});

test('out-of-range offsets are clamped rather than producing undefined', () => {
  const r = applyMarker('ab', -5, 99, B);
  assert.equal(r.value, '**ab**');
});

test('marker at the very start of the value has nothing to unwrap into', () => {
  assert.equal(at('word', 0, 4, (v, s, e) => applyMarker(v, s, e, B)), '**[word]**');
});

// ── Links ────────────────────────────────────────────────────────────────────

// The at() helper is no use here — its selection brackets are the same
// character the link grammar uses, so the two are unreadable together.
test('a link wraps the selection and leaves the TEXT selected', () => {
  const r = applyLink('see the island now', 8, 14, 'https://x.co');
  assert.equal(r.value, 'see the [island](https://x.co) now');
  assert.equal(r.value.slice(r.selectionStart, r.selectionEnd), 'island');
});

test('an empty selection yields an empty link with the caret in the brackets', () => {
  const r = applyLink('ab', 1, 1, 'https://x.co');
  assert.equal(r.value, 'a[](https://x.co)b');
  assert.equal(r.selectionStart, 2);
  assert.equal(r.selectionEnd, 2);
});

test('the URL is trimmed', () => {
  assert.equal(applyLink('x', 0, 1, '  https://x.co  ').value, '[x](https://x.co)');
});

// The reason escapeLinkText exists: ']' closes the link-text slot.
test("a ']' in the selected text cannot close the link early", () => {
  const r = applyLink('see a]b now', 4, 7, 'https://x.co');
  assert.equal(r.value, 'see [a\\]b](https://x.co) now');
  const html = renderInlineHtml(r.value);
  assert.ok(html.includes('href="https://x.co"'), html);
  assert.ok(html.includes('a]b'), `link text lost its bracket: ${html}`);
  assert.ok(!html.includes('\\'), `an escape leaked into the mail: ${html}`);
});

test('a backslash in the selected text survives as one backslash', () => {
  const r = applyLink('a\\b', 0, 3, 'https://x.co');
  assert.equal(r.value, '[a\\\\b](https://x.co)');
  const html = renderInlineHtml(r.value);
  assert.ok(html.includes('a\\b'), html);
});

test('escapeLinkText leaves ordinary text alone', () => {
  assert.equal(escapeLinkText('the island'), 'the island');
  assert.equal(escapeLinkText('a [nested] one'), 'a [nested\\] one');
});

// isSafeUrl is the toolbar's copy of the renderer's SAFE_URL. If they disagree,
// the toolbar accepts a URL the renderer then drops to literal text.
test('isSafeUrl agrees with what the renderer will actually linkify', () => {
  const urls = [
    'https://x.co',
    'http://x.co',
    'HTTPS://X.CO',
    '  https://x.co  ',
    'javascript:alert(1)',
    'data:text/html,hi',
    'ftp://x.co',
    '//x.co',
    'x.co',
    '',
  ];
  for (const u of urls) {
    const html = renderInlineHtml(`[t](${u.trim()})`);
    const linkified = html.includes('<a href=');
    assert.equal(isSafeUrl(u), linkified, `disagreement on ${JSON.stringify(u)} → ${html}`);
  }
});
