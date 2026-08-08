// The preview cutter and the HTML validation gate.
//
//   node --test tests/ci/preview-cut.test.mjs      (npm run test:ci)
//
// These assert the guarantees STORY-SERVING-CONTRACT.md §4.2 makes to the app, in the
// same order the contract states them. A guarantee the app is told it can rely on and
// which nothing checks is a guarantee that will be broken by an ordinary refactor.
//
// The malformed-HTML cases are not invented. All three shapes were found in live
// story bodies on 2026-08-08 by running the gate over cms_stories — see the R11.8
// notes. The `<p><figure></p>` case in particular is systematic: five bodies carry it,
// all produced by the same composer image-insertion path.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateBody, parseBlocks, MalformedHtmlError } from '../../app/lib/htmlBlocks.js';
import { cutPreview, isDangling, PREVIEW_FRACTION } from '../../app/lib/previewCut.js';

const p = (n, text) => `<p>${text || `Paragraph number ${n} runs on for a sentence and then stops.`}</p>`;
const body = (n) => Array.from({ length: n }, (_, i) => p(i + 1)).join('\n');

describe('the validation gate', () => {
  test('accepts a well-formed body', () => {
    const r = validateBody(body(5));
    assert.equal(r.ok, true);
    assert.equal(r.blocks.length, 5);
  });

  test('rejects a closing tag with nothing open', () => {
    const r = validateBody('<p>One.</p></p>');
    assert.equal(r.ok, false);
    assert.match(r.error, /nothing open/);
  });

  test('rejects crossed nesting — the live <p><figure></p> defect', () => {
    const r = validateBody('<p style="x"><figure style="y"></p><p>After.</p>');
    assert.equal(r.ok, false);
    assert.match(r.error, /crossed nesting/);
    assert.equal(r.detail.expected, 'figure');
  });

  test('rejects an element that is never closed', () => {
    const r = validateBody('<p>One.</p><div><p>Two.</p>');
    assert.equal(r.ok, false);
    assert.match(r.error, /never closed/);
  });

  test('void elements do not need closing', () => {
    assert.equal(validateBody('<p>A line<br>and another.</p><p>Two.</p>').ok, true);
    assert.equal(validateBody('<p>See <img src="a.png"> this.</p>').ok, true);
  });

  test('parseBlocks throws MalformedHtmlError, and the cutter does not catch it', () => {
    assert.throws(() => parseBlocks('<p><figure></p>'), MalformedHtmlError);
    // THE LOAD-BEARING ONE. A body that fails validation must NOT fall back to the
    // full text — that would make malformed HTML a paywall bypass, and the worse the
    // markup the more reliably it would work. See contract §5.5.
    assert.throws(() => cutPreview('<p><figure></p>'), MalformedHtmlError);
  });

  test('a blockquote is ONE block, not its inner paragraphs', () => {
    const blocks = parseBlocks('<blockquote><p>Inner one.</p><p>Inner two.</p></blockquote><p>After.</p>');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].tag, 'blockquote');
  });
});

describe('the budget', () => {
  test('takes 30% of prose blocks, rounded up', () => {
    const r = cutPreview(body(10));
    assert.equal(r.total, 10);
    assert.equal(r.prose, Math.ceil(10 * PREVIEW_FRACTION));
    assert.equal(r.prose, 3);
  });

  test('never takes the whole story — capped at total-1', () => {
    for (const n of [1, 2, 3, 4]) {
      const r = cutPreview(body(n));
      assert.ok(r.prose <= Math.max(1, n - 1), `n=${n} took ${r.prose}`);
      assert.ok(r.prose >= 1, `n=${n} took nothing`);
    }
  });

  test('the preview is a verbatim PREFIX of the body', () => {
    const src = body(12);
    const r = cutPreview(src);
    // Blocks are rejoined with \n, so compare on the block sequence rather than raw
    // bytes: every block in the preview is the corresponding block of the source.
    const srcBlocks = parseBlocks(src).map((b) => b.html);
    const preBlocks = parseBlocks(r.html).map((b) => b.html);
    assert.deepEqual(preBlocks, srcBlocks.slice(0, preBlocks.length));
  });

  test('the preview is well-formed on its own', () => {
    assert.equal(validateBody(cutPreview(body(20)).html).ok, true);
  });
});

describe('front matter rides along free', () => {
  test('a content note and an epigraph do not spend the budget', () => {
    const src = [
      '<p class="intro-note">Content note: grief.</p>',
      '<blockquote><p>An epigraph.</p></blockquote>',
      body(10),
    ].join('\n');
    const r = cutPreview(src);
    // Still ten PROSE blocks — the note and the epigraph are not prose.
    assert.equal(r.total, 10);
    assert.equal(r.prose, 3);
    // …and both are present in the preview, because an epigraph belongs with the
    // opening it introduces.
    assert.match(r.html, /intro-note/);
    assert.match(r.html, /blockquote/);
  });

  test('a body that is entirely front matter still previews something', () => {
    const r = cutPreview('<p class="intro-note">I.</p>');
    assert.equal(r.total, 0);
    assert.ok(r.html.length > 0, 'a preview of nothing is worse than a preview of an epigraph');
  });
});

describe('the one-block advance past dangling connectives', () => {
  test('isDangling catches punctuation, function words and unclosed quotes', () => {
    assert.equal(isDangling('She turned, and then —'), true);
    assert.equal(isDangling('He said it was because'), true);
    assert.equal(isDangling('It belonged to the'), true);
    assert.equal(isDangling('"I never meant it,'), true);
    assert.equal(isDangling('“You cannot be serious.'), true, 'one curly quote is still open');
    assert.equal(isDangling('She turned and left.'), false);
    assert.equal(isDangling('“You cannot be serious.”'), false);
    assert.equal(isDangling("The dog's bowl was empty."), false, 'apostrophes are not quotes');
  });

  // NOTE ON THE FIXTURES BELOW. Every dangling paragraph here is deliberately LONGER
  // than 40 characters. A short unterminated line followed by a longer one is
  // front matter by prosePredicate's last rule — a heading over a paragraph — so a
  // terse fixture like `<p>Third ended on a comma,</p>` never reaches the budget at
  // all; it is reclassified out of the prose count. The first draft of these tests
  // used exactly that and failed for a reason that had nothing to do with the
  // advance. The rule is correct; the fixtures had to grow up.

  test('advances exactly one block when the cut lands on a dangling one', () => {
    const blocks = [
      p(1), p(2),
      '<p>The third paragraph ran on at some length and then ended on a comma,</p>',  // ceil(10*0.3)=3
      p(4), p(5), p(6), p(7), p(8), p(9), p(10),
    ].join('\n');
    const r = cutPreview(blocks);
    assert.equal(r.total, 10);
    assert.equal(r.prose, 4, 'should have advanced from 3 to 4');
  });

  test('ONCE, never twice — two dangling blocks in a row stop after one step', () => {
    const blocks = [
      p(1), p(2),
      '<p>The third paragraph ran on at some length and then ended on a comma,</p>',
      '<p>and the fourth one carried the sentence further before ending with</p>',
      p(5), p(6), p(7), p(8), p(9), p(10),
    ].join('\n');
    const r = cutPreview(blocks);
    assert.equal(r.prose, 4, 'a while-loop here would walk most of the story');
  });

  test('does not advance past the cap', () => {
    const blocks = [
      '<p>The opening paragraph ran on at some length and ended on a comma,</p>',
      '<p>and the second paragraph finished the thought properly at last.</p>',
    ].join('\n');
    const r = cutPreview(blocks);
    assert.equal(r.total, 2);
    assert.equal(r.prose, 1, 'the cap at total-1 wins over the advance');
  });
});
