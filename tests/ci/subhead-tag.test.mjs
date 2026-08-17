// R12.5 — the subheading classifier's behavioural suite.
//
// Runs under `node --test` with no browser and no server: tagSubheads is a pure
// string→string function, and that is precisely the property that lets the static export
// and the hydrated client agree. Testing it as a pure function tests the thing that ships.
//
// The cases below are not invented. Every "should tag" string is a real subheading lifted
// from a published story, and every "must not tag" string is a real run-in lead-in from the
// same corpus — the 52 paragraphs a `:has(> strong:only-child)` rule would have gilded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tagSubheads, isSubheadText, SUBHEAD_CLASS } from '../../app/lib/subheadTag.js';

const tagged = (s) => s.includes(`class="${SUBHEAD_CLASS}"`);

test('the heading form is tagged', () => {
  // Amoré’s Cage, One Scan Can Cost You Everything, The Frictionless Trap, Him vs Her.
  for (const h of [
    'The Bottom Line',
    'The Friction of Reality',
    'The Old Way (The Tactile Approach)',
    'Him',
    "The Technical Trick Behind 'Quishing'",
  ]) {
    const out = tagSubheads(`<p><strong>${h}</strong></p>`);
    assert.ok(tagged(out), `expected a subheading: ${h}`);
    assert.equal(out, `<p class="${SUBHEAD_CLASS}"><strong>${h}</strong></p>`);
  }
});

test('a trailing colon is still a heading — "Pros:" is live copy', () => {
  // The Resistance of the Worn Strap, Beyond the Metered Grid.
  assert.ok(tagSubheads('<p><strong>Pros:</strong></p>').includes(SUBHEAD_CLASS));
  assert.ok(tagSubheads('<p><strong>Cons (the trap):</strong></p>').includes(SUBHEAD_CLASS));
});

test('the RUN-IN form is never tagged — this is the whole point', () => {
  // Each of these is a real paragraph. A CSS :has(> strong:only-child) rule gilds the
  // lead-in of all of them, because the trailing sentence is a text node and :only-child
  // counts elements.
  const runIns = [
    '<p><strong>Product:</strong> The commercial AI companion (Replika, Character.ai, Chai).</p>',
    '<p><strong>Tax season.</strong> Every year, phishing emails impersonating tax authorities spike.</p>',
    '<p><strong>Public holidays and long weekends.</strong> Ransomware attacks have repeatedly been timed to launch right before holidays.</p>',
    '<p><strong>Primary function:</strong> To extract financial value from organic human content.</p>',
  ];
  for (const p of runIns) {
    assert.equal(tagSubheads(p), p, `run-in was altered: ${p.slice(0, 48)}`);
  }
});

test('leading text before the strong is not a heading either', () => {
  // "Rating:<strong> 7 / 10</strong>" — live copy, the bold is the value not the label.
  const p = '<p>Rating:<strong> 7 / 10</strong></p>';
  assert.equal(tagSubheads(p), p);
});

test('an ALL-BOLD emphasis paragraph is not a heading', () => {
  // Satisfies "the strong is the whole paragraph" but is prose: a finished sentence.
  // Zero of the 41 real subheadings in the corpus end in terminal punctuation.
  const cases = [
    '<p><strong>She never once looked back, and that was the whole of it.</strong></p>',
    '<p><strong>Do not let anyone tell you otherwise!</strong></p>',
    '<p><strong>And what, exactly, had he expected?</strong></p>',
    '<p><strong>It ended there.”</strong></p>',
  ];
  for (const p of cases) {
    assert.equal(tagSubheads(p), p, `emphasis paragraph was tagged: ${p.slice(0, 48)}`);
  }
});

test('the pattern never crosses a paragraph boundary', () => {
  // THE REGRESSION THAT MATTERED. An untempered lazy run starting at a run-in lead-in ran
  // past its own </p> to the next </strong></p> further down the story, swallowing 1,415
  // characters of body prose into one bogus subheading. Measured against the live corpus.
  const html =
    '<p><strong>Product:</strong> The companion app.</p>' +
    '<p>Some ordinary body prose in between.</p>' +
    '<p><strong>The Return to Earth</strong></p>';
  const out = tagSubheads(html);
  assert.equal((out.match(new RegExp(SUBHEAD_CLASS, 'g')) || []).length, 1);
  assert.ok(out.includes('<p><strong>Product:</strong> The companion app.</p>'));
  assert.ok(out.includes('Some ordinary body prose in between.'));
  assert.ok(out.includes(`<p class="${SUBHEAD_CLASS}"><strong>The Return to Earth</strong></p>`));
});

test('inline markup inside the heading survives', () => {
  const out = tagSubheads('<p><strong>The <em>Real</em> Cost</strong></p>');
  assert.equal(out, `<p class="${SUBHEAD_CLASS}"><strong>The <em>Real</em> Cost</strong></p>`);
});

test('a paragraph with two strongs is not a heading', () => {
  const p = '<p><strong>One</strong> and <strong>two</strong></p>';
  assert.equal(tagSubheads(p), p);
});

test('idempotent — re-running changes nothing', () => {
  const once = tagSubheads('<p><strong>The Bottom Line</strong></p>');
  assert.equal(tagSubheads(once), once);
});

test('h3 subheadings are left entirely alone', () => {
  // The 37-story form is styled by CSS, not by this classifier. It must not be touched.
  const p = '<p>body</p><h3>A Section</h3><p>more</p>';
  assert.equal(tagSubheads(p), p);
});

test('empty and nullish input do not throw', () => {
  // The story page renders before /api/story returns a body.
  assert.equal(tagSubheads(''), '');
  assert.equal(tagSubheads(null), '');
  assert.equal(tagSubheads(undefined), '');
});

test('isSubheadText is exported and agrees with the tagger', () => {
  assert.equal(isSubheadText('The Bottom Line'), true);
  assert.equal(isSubheadText('Pros:'), true);
  assert.equal(isSubheadText('It ended there.'), false);
  assert.equal(isSubheadText('   '), false);
});
