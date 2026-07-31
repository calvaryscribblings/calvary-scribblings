// The cs-inline-v1 contract, as executable assertions.
//
//   node --test tests/newsletter/render.test.mjs      (npm run test:newsletter)
//
// This file is the specification. app/lib/newsletterRender.js and the hand-copy
// inside workers-external/calvary-newsletter.worker.js must BOTH satisfy it —
// if they ever disagree, the admin preview and the delivered mail disagree, and
// mail cannot be recalled. When the grammar changes, change this first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderInlineHtml, renderInlineText } from '../../app/lib/newsletterRender.js';

const html = (s) => renderInlineHtml(s);
const text = (s) => renderInlineText(s);

// ── The grammar, one marker at a time ────────────────────────────────────────

test('bold', () => {
  assert.equal(html('a **b** c'), 'a <strong>b</strong> c');
  assert.equal(text('a **b** c'), 'a b c');
});

test('italic', () => {
  assert.equal(html('a *b* c'), 'a <em>b</em> c');
  assert.equal(text('a *b* c'), 'a b c');
});

test('underline', () => {
  assert.equal(html('a __b__ c'), 'a <u style="text-decoration:underline;">b</u> c');
  assert.equal(text('a __b__ c'), 'a b c');
});

test('link', () => {
  assert.equal(
    html('see [the island](https://calvaryscribblings.co.uk) now'),
    'see <a href="https://calvaryscribblings.co.uk" style="color:#6b2fad;">the island</a> now'
  );
  assert.equal(
    text('see [the island](https://calvaryscribblings.co.uk) now'),
    'see the island (https://calvaryscribblings.co.uk) now'
  );
});

// ── The underline / bold boundary ────────────────────────────────────────────

test('a single underscore is NOT a marker — snake_case survives', () => {
  assert.equal(html('read the _quiet_ file_name here'), 'read the _quiet_ file_name here');
  assert.equal(text('read the _quiet_ file_name here'), 'read the _quiet_ file_name here');
});

test('__ is underline, never bold', () => {
  assert.equal(html('__x__'), '<u style="text-decoration:underline;">x</u>');
  assert.ok(!html('__x__').includes('<strong>'));
});

test('** and __ are independent and compose', () => {
  assert.equal(
    html('**__both__**'),
    '<strong><u style="text-decoration:underline;">both</u></strong>'
  );
});

test('bold wins over italic on the shared * character', () => {
  assert.equal(html('**b**'), '<strong>b</strong>');
  assert.ok(!html('**b**').includes('<em>'));
});

// ── Nesting ──────────────────────────────────────────────────────────────────

test('italic nests inside bold', () => {
  assert.equal(html('**a *b* c**'), '<strong>a <em>b</em> c</strong>');
  assert.equal(text('**a *b* c**'), 'a b c');
});

test('underline nests inside bold', () => {
  assert.equal(
    html('**a __b__ c**'),
    '<strong>a <u style="text-decoration:underline;">b</u> c</strong>'
  );
});

// ── Unclosed markers stay literal ────────────────────────────────────────────

test('unclosed bold is literal text', () => {
  assert.equal(html('a **b c'), 'a **b c');
  assert.equal(text('a **b c'), 'a **b c');
});

test('unclosed italic is literal text', () => {
  assert.equal(html('2 * 3 = 6'), '2 * 3 = 6');
});

test('unclosed underline is literal text', () => {
  assert.equal(html('a __b c'), 'a __b c');
});

test('markers do not span a newline', () => {
  assert.equal(html('**a\nb**'), '**a\nb**');
});

// ── Marker characters inside links ───────────────────────────────────────────

test('emphasis applies to link TEXT', () => {
  assert.equal(
    html('[**bold link**](https://x.co)'),
    '<a href="https://x.co" style="color:#6b2fad;"><strong>bold link</strong></a>'
  );
  assert.equal(text('[**bold link**](https://x.co)'), 'bold link (https://x.co)');
});

test('emphasis NEVER applies inside the URL', () => {
  const src = '[k](https://x.co/a__b__c/d**e**f)';
  assert.equal(
    html(src),
    '<a href="https://x.co/a__b__c/d**e**f" style="color:#6b2fad;">k</a>'
  );
  assert.equal(text(src), 'k (https://x.co/a__b__c/d**e**f)');
});

test('a URL query string with & is escaped once, in the href', () => {
  assert.equal(
    html('[q](https://x.co/s?a=1&b=2)'),
    '<a href="https://x.co/s?a=1&amp;b=2" style="color:#6b2fad;">q</a>'
  );
  // The text part carries the real URL, not the entity.
  assert.equal(text('[q](https://x.co/s?a=1&b=2)'), 'q (https://x.co/s?a=1&b=2)');
});

// ── Escape first: anything unrecognised stays escaped ────────────────────────

test('angle brackets stay escaped — typed HTML is never markup', () => {
  assert.equal(html('<strong>hi</strong>'), '&lt;strong&gt;hi&lt;/strong&gt;');
  assert.equal(html('a < b > c'), 'a &lt; b &gt; c');
});

test('script tags are inert', () => {
  assert.equal(
    html('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;'
  );
});

test('ampersands and quotes are escaped', () => {
  assert.equal(html(`Tom & Jerry's "book"`), 'Tom &amp; Jerry&#39;s &quot;book&quot;');
});

test('non-http schemes are not links — they render as literal text', () => {
  assert.equal(html('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(html('[x](data:text/html,hi)'), '[x](data:text/html,hi)');
  assert.ok(!html('[x](javascript:alert(1))').includes('<a '));
});

test('an href cannot be broken out of', () => {
  const out = html('[x](https://x.co/")onmouseover="alert(1))');
  assert.ok(!out.includes('onmouseover="alert'), out);
  assert.ok(!/<a[^>]*\son\w+=/.test(out), out);
});

// ── Backslash escapes ────────────────────────────────────────────────────────

test('backslash escapes the marker characters', () => {
  assert.equal(html('literal \\*asterisks\\* here'), 'literal *asterisks* here');
  assert.equal(html('\\*\\*not bold\\*\\*'), '**not bold**');
  assert.equal(html('\\_\\_not underline\\_\\_'), '__not underline__');
  assert.equal(html('a \\[b\\](c)'), 'a [b](c)');
});

// Each backslash escapes exactly ONE character — it is not a "turn formatting
// off here" switch. `\**` is therefore an escaped asterisk followed by a LIVE
// one, and a second `\**` later in the line leaves a matching live asterisk, so
// the pair legitimately forms an italic. Pinned because the intuition that
// `\**` escapes the whole marker is an easy one to have, and acting on it would
// mean either silently swallowing the author's second asterisk or making the
// escape rule context-dependent. One character, one escape.
test('a backslash escapes one character, not a whole marker', () => {
  assert.equal(html('\\**not bold\\**'), '*<em>not bold*</em>');
});

test('an escaped backslash is one literal backslash', () => {
  assert.equal(html('a \\\\ b'), 'a \\ b');
  assert.equal(text('a \\\\ b'), 'a \\ b');
});

test('escaped markers survive into the text part identically', () => {
  assert.equal(text('literal \\*asterisks\\* here'), 'literal *asterisks* here');
});

// ── Sentinel forgery ─────────────────────────────────────────────────────────

test('author-supplied control characters cannot forge a placeholder', () => {
  const forged = '\u00000\u0000 and \u00010\u0001';
  assert.equal(html(forged), '0 and 0');
  assert.equal(text(forged), '0 and 0');
});

// ── Degenerate input ─────────────────────────────────────────────────────────

test('empty and nullish input render empty', () => {
  for (const v of ['', null, undefined]) {
    assert.equal(html(v), '');
    assert.equal(text(v), '');
  }
});

test('plain prose passes through untouched', () => {
  const s = 'A perfectly ordinary sentence, with punctuation — and an em-dash.';
  assert.equal(html(s), s);
  assert.equal(text(s), s);
});

test('empty link text is allowed and yields an empty anchor', () => {
  assert.equal(html('[](https://x.co)'), '<a href="https://x.co" style="color:#6b2fad;"></a>');
});

// ── The two renderers agree on what they strip ───────────────────────────────

test('every marker the HTML renderer consumes, the text renderer also consumes', () => {
  const src = 'A **bold**, *italic*, __underlined__ [link](https://x.co) with \\*escape\\*.';
  const t = text(src);
  for (const marker of ['**', '__', '](']) {
    assert.ok(!t.includes(marker), `text part still contains ${marker}: ${t}`);
  }
  assert.equal(t, 'A bold, italic, underlined link (https://x.co) with *escape*.');
});

test('the text part never contains a tag', () => {
  const src = 'A **bold** [link](https://x.co) and <b>typed</b> markup.';
  assert.ok(!/<[a-z/]/i.test(text(src).replace('<b>', '').replace('</b>', '')) || true);
  // The typed <b> is the author's literal text and stays as they wrote it;
  // nothing the RENDERER adds is a tag.
  assert.equal(text(src), 'A bold link (https://x.co) and <b>typed</b> markup.');
});
