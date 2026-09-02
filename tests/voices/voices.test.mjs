// R32 — THE READER'S LINE, as logic.
//
// ⚠ EVERY ASSERTION HERE HAS A MUTATION, AND EVERY MUTATION WAS RUN. Twenty tests in this
// project could not fail; the most recent was caught only because somebody actually broke
// the code and watched the suite stay green. So each block below names the edit that must
// redden it, and each of those edits was applied to app/lib/trailerVoices.js, the suite run,
// and the red observed, before the edit was reverted. A named mutation that was never run is
// a comment, not a test.
//
// Pure module, node:test, no browser: the metrics live in tests/voices/heights.spec.mjs
// where a real engine can measure them. What is asserted here is the BRANCHING — which path
// the abridger took and what it decided — which a counting stub can prove and a screenshot
// cannot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  VOICE_MIN_CHARS,
  isScreenable,
  isPromotable,
  promotableVoices,
  shouldTrailer,
  abridgeToFit,
  shuffleVoices,
  pickVoice,
  resolveVoiceIdentity,
  ABRIDGE_WHOLE,
  ABRIDGE_SENTENCE,
  ABRIDGE_ELLIPSIS,
} from '../../app/lib/trailerVoices.js';

// A `fits` stub: everything up to `n` characters fits. Enough to drive every branch.
const upTo = (n) => (t) => t.length <= n;

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE VERDICT GATE. Mutation: relax isPromotable to `row?.promotable !== false`.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('an unscreened comment is never promotable, in every shape it can arrive in', () => {
  for (const bad of [
    undefined, null, false, 0, '', 'true', [], [{ promotable: true }],
    {},                              // screened field absent — the backfill has not reached it
    { promotable: false },           // screened and refused
    { promotable: 'true' },          // a string, not the boolean
    { promotable: 1 },               // truthy, not true
    { text: 'lovely', uid: 'u1' },   // a row that looks complete and carries no verdict
    { promotable: null },
  ]) {
    assert.equal(isPromotable(bad), false, `must fail closed on ${JSON.stringify(bad)}`);
  }
  assert.equal(isPromotable({ promotable: true }), true);
});

test('promotableVoices lets nothing through that isPromotable refuses', () => {
  const node = {
    a: { promotable: true, text: 'a real sentence about the story', uid: 'u1' },
    b: { promotable: false, text: 'refused but still stored', uid: 'u2' },
    c: { text: 'never screened at all', uid: 'u3' },
    d: { promotable: true, uid: 'u4' },              // promoted with no words
    e: { promotable: true, text: '   ', uid: 'u5' }, // promoted with only space
    f: { promotable: 'true', text: 'forged', uid: 'u6' },
  };
  assert.deepEqual(promotableVoices(node).map((v) => v.id), ['a']);
  for (const junk of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(promotableVoices(junk), []);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// RULING 1. Mutation: drop the `voices.length > 0` clause from shouldTrailer.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('a story with no promotable voice produces no trailer step', () => {
  const base = { storyIndex: 1, reducedMotion: false, quote: 'a line', pinReady: true };
  assert.equal(shouldTrailer({ ...base, voices: [{ id: 'a', text: 'x' }] }), true);
  assert.equal(shouldTrailer({ ...base, voices: [] }), false);
  assert.equal(shouldTrailer({ ...base, voices: undefined }), false);
  assert.equal(shouldTrailer({ ...base, voices: null }), false);
});

test('nothing pins until the stage has been measured', () => {
  const base = { storyIndex: 1, reducedMotion: false, quote: 'a line', voices: [{ id: 'a' }] };
  assert.equal(shouldTrailer({ ...base, pinReady: true }), true);
  assert.equal(shouldTrailer({ ...base, pinReady: false }), false);
});

test('the conditions that already existed still hold', () => {
  const base = { reducedMotion: false, quote: 'a line', voices: [{ id: 'a' }], pinReady: true };
  assert.equal(shouldTrailer({ ...base, storyIndex: 0 }), false, 'every 2nd story only');
  assert.equal(shouldTrailer({ ...base, storyIndex: 1 }), true);
  assert.equal(shouldTrailer({ ...base, storyIndex: 2 }), false);
  assert.equal(shouldTrailer({ ...base, storyIndex: 1, reducedMotion: true }), false);
  assert.equal(shouldTrailer({ ...base, storyIndex: 1, quote: '   ' }), false);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE PRE-SPEND FILTER. Mutation: drop the length clause; drop the @mention clause.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('only what could ever be eligible is screenable', () => {
  const long = 'This is a real reader sentence with enough words to clear the floor.';
  assert.ok(long.length >= VOICE_MIN_CHARS);
  assert.equal(isScreenable({ text: long, hasTrailerQuote: true }), true);
  assert.equal(isScreenable({ text: long, hasTrailerQuote: true, parentId: 'c1' }), false, 'a reply');
  assert.equal(isScreenable({ text: long, hasTrailerQuote: false }), false, 'story has no quote');
  assert.equal(isScreenable({ text: '👏🏾👏🏾👏🏾', hasTrailerQuote: true }), false, 'emoji only');
  assert.equal(isScreenable({ text: 'beautiful ❤️', hasTrailerQuote: true }), false, 'under the floor');
  assert.equal(isScreenable({ text: 'x'.repeat(VOICE_MIN_CHARS - 1), hasTrailerQuote: true }), false);
  assert.equal(isScreenable({ text: 'x'.repeat(VOICE_MIN_CHARS), hasTrailerQuote: true }), true);
  assert.equal(isScreenable({ text: `${long} @byokpara`, hasTrailerQuote: true }), false, '@mention');
  assert.equal(isScreenable({ text: `${long} https://x.com`, hasTrailerQuote: true }), false, 'URL');
  for (const bad of [null, undefined, 42, {}]) {
    assert.equal(isScreenable({ text: bad, hasTrailerQuote: true }), false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE ABRIDGER. Mutations: force the word-boundary path always; append '…' on the sentence
// path; drop the ellipsis from the fit candidate.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('a comment that fits is left completely alone', () => {
  const t = 'Sadly, too many children know only this kind of love.';
  const r = abridgeToFit(t, upTo(80));
  assert.equal(r.mode, ABRIDGE_WHOLE);
  assert.equal(r.text, t);
  assert.ok(!r.text.includes('…'), 'nothing that fits may carry a mark');
});

test('it cuts at a sentence boundary where one exists, and adds no ellipsis there', () => {
  const t = 'The ending is a punch to the gut. I did not see it coming at all, not even a little bit.';
  const r = abridgeToFit(t, upTo(40));
  assert.equal(r.mode, ABRIDGE_SENTENCE);
  assert.equal(r.text, 'The ending is a punch to the gut.');
  assert.ok(!r.text.includes('…'), 'a full stop is the end; a mark would claim something was withheld');
});

test('it takes as many whole sentences as fit, not just the first', () => {
  const t = 'One. Two. Three. Four is very much longer than all of the others put together.';
  const r = abridgeToFit(t, upTo(20));
  assert.equal(r.mode, ABRIDGE_SENTENCE);
  assert.equal(r.text, 'One. Two. Three.');
});

test('a sentence ending in a quote mark or bracket still counts as a boundary', () => {
  const t = 'She said “go home.” Then she left and did not look back even once, not for a second.';
  const r = abridgeToFit(t, upTo(30));
  assert.equal(r.mode, ABRIDGE_SENTENCE);
  assert.equal(r.text, 'She said “go home.”');
});

test('it ellipsises ONLY when a single sentence overruns', () => {
  const t = 'This one long unpunctuated thought just keeps going and going without ever stopping';
  const r = abridgeToFit(t, upTo(40));
  assert.equal(r.mode, ABRIDGE_ELLIPSIS);
  assert.ok(r.text.endsWith('…'));
  assert.ok(r.text.length <= 40, 'the ellipsis is inside the fit, not added after it');
  assert.ok(!r.text.includes('  '), 'no mid-word cut');
  // the cut is on a word boundary of the original
  const body = r.text.slice(0, -1);
  assert.ok(t.startsWith(body), 'the kept text is a prefix of the original');
  assert.ok(t[body.length] === ' ' || body.length === t.length, 'cut at a space');
});

test('the ellipsis never lands on top of dangling punctuation', () => {
  const t = 'A thought, another clause, and then a third that runs on far past the end of the box';
  const r = abridgeToFit(t, upTo(30));
  assert.equal(r.mode, ABRIDGE_ELLIPSIS);
  assert.ok(!/[,;:—–-]…$/.test(r.text), `dangling punctuation before the mark: ${r.text}`);
});

test('newlines collapse — a comment written as paragraphs is one line of reported speech', () => {
  const r = abridgeToFit('First thought.\n\nSecond thought.', upTo(200));
  assert.equal(r.text, 'First thought. Second thought.');
  assert.equal(r.mode, ABRIDGE_WHOLE);
});

test('a first sentence that fits exactly is a sentence cut, not an ellipsis', () => {
  const t = 'Exactly this long. And then considerably more text that cannot possibly fit.';
  const r = abridgeToFit(t, upTo('Exactly this long.'.length));
  assert.equal(r.mode, ABRIDGE_SENTENCE);
  assert.equal(r.text, 'Exactly this long.');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE ROTATION. Mutation: return order[0] from pickVoice regardless of loop.
// ─────────────────────────────────────────────────────────────────────────────────────────
const voicesOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, text: `t${i}`, uid: `u${i}` }));

test('the same story shows different comments across rotations', () => {
  const voices = voicesOf(4);
  const seen = [0, 1, 2, 3].map((loop) => pickVoice(voices, { slug: 'a-story', seed: 7, loop }).id);
  assert.equal(new Set(seen).size, 4, `expected four distinct voices, got ${seen.join(',')}`);
});

test('every voice is shown before any is repeated', () => {
  const voices = voicesOf(5);
  const seen = Array.from({ length: 5 }, (_, loop) => pickVoice(voices, { slug: 's', seed: 3, loop }).id);
  assert.deepEqual([...seen].sort(), voices.map((v) => v.id).sort());
  // and it wraps rather than running off the end
  assert.equal(pickVoice(voices, { slug: 's', seed: 3, loop: 5 }).id, seen[0]);
});

test('the shuffle is stable within a rotation and different across them', () => {
  const voices = voicesOf(6);
  const a = shuffleVoices(voices, 'story', 100).map((v) => v.id);
  assert.deepEqual(shuffleVoices(voices, 'story', 100).map((v) => v.id), a, 'stable for one seed');
  const b = shuffleVoices(voices, 'story', 101).map((v) => v.id);
  assert.notDeepEqual(b, a, 'a new rotation reorders');
  const c = shuffleVoices(voices, 'other-story', 100).map((v) => v.id);
  assert.notDeepEqual(c, a, 'two stories do not march in step');
  assert.deepEqual([...a].sort(), voices.map((v) => v.id).sort(), 'a shuffle loses nobody');
});

test('a single voice is shown every time, and no voices is null', () => {
  assert.equal(pickVoice(voicesOf(1), { slug: 's', seed: 1, loop: 9 }).id, 'c0');
  assert.equal(pickVoice([], { slug: 's', seed: 1, loop: 0 }), null);
  assert.equal(pickVoice(null, { slug: 's', seed: 1, loop: 0 }), null);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// IDENTITY AT RENDER. Mutation: put `stored` first in the ladder.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('the live record beats the stored copy every time it has anything', () => {
  // The real case, measured: 447 of 1,830 stored copies are stale.
  const live = { displayName: 'Nzubechukwu Okere', readCount: 124, avatarUrl: 'https://x/p.jpg' };
  const id = resolveVoiceIdentity(live, 'J Tech');
  assert.equal(id.name, 'Nzubechukwu Okere');
  assert.equal(id.photo, 'https://x/p.jpg');
  assert.equal(id.readCount, 124);
  assert.equal(resolveVoiceIdentity({ name: 'Chinemerem' }, 'Chi chi').name, 'Chinemerem');
});

test('the stored copy is the LAST rung, and the carousel does not pass one', () => {
  // 29 of 99 commenters hold no name at all in users/{uid}.
  assert.equal(resolveVoiceIdentity({ readCount: 12 }, 'Enoch Oyewo').name, 'Enoch Oyewo');
  // …but the carousel passes null, so such a reader is simply not drawn.
  assert.equal(resolveVoiceIdentity({ readCount: 12 }, null), null);
  assert.equal(resolveVoiceIdentity(null, null), null);
  assert.equal(resolveVoiceIdentity({ displayName: '   ' }, null), null);
});

test('photo falls back through both field names, and initials come from the live name', () => {
  assert.equal(resolveVoiceIdentity({ photoURL: 'p' }, 'A Reader').photo, 'p');
  assert.equal(resolveVoiceIdentity({ displayName: 'Adejoke Adebayo' }, null).initials, 'AA');
  assert.equal(resolveVoiceIdentity({ displayName: 'Chinemerem' }, null).initials, 'C');
  assert.equal(resolveVoiceIdentity({ displayName: 'A Reader' }, null).photo, null);
  assert.equal(resolveVoiceIdentity({ displayName: 'A', isAuthor: true }, null).isAuthor, true);
  assert.equal(resolveVoiceIdentity({ displayName: 'A' }, null).isAuthor, false);
});


// ─────────────────────────────────────────────────────────────────────────────────────────
// THE ONE INVARIANT WITH NO BEHAVIOURAL SIGNATURE — asserted on the source, like
// spectrum.test.mjs asserts on its own.
//
// The painted quote is one inline-block span per word, each with a trailing NON-BREAKING
// space. If measureQuotePin ever measures the plain string instead, it measures a different
// wrap, and a pin measured on a different wrap is not a pin.
//
// I mutated it to `p.textContent = q` and the height suite stayed GREEN: over today's 157
// quotes at today's five widths the two wraps happen to produce the same maximum, so the bug
// is currently invisible and would appear the first time somebody wrote a quote whose last
// word sat on the boundary. A latent trap with no failing case is exactly what a source
// assertion is for.
// ─────────────────────────────────────────────────────────────────────────────────────────
const PINNER_SRC = readFileSync(fileURLToPath(new URL('../../app/lib/pinQuoteStage.js', import.meta.url)), 'utf8');

test('the pin probe builds the real word spans and never measures a plain string', () => {
  const body = PINNER_SRC.slice(PINNER_SRC.indexOf('export function measureQuotePin'));
  assert.ok(body.includes('paintQuoteWords(p, q)'), 'measureQuotePin must paint through paintQuoteWords');
  assert.ok(!/\bp\.textContent\s*=/.test(body), 'measureQuotePin must not assign textContent to the probe');
  // and the painter itself must still emit the non-breaking space
  assert.ok(PINNER_SRC.includes('\u00a0'), 'paintQuoteWords must join words with a non-breaking space');
  assert.ok(PINNER_SRC.includes("span.className = 'trailer-word'"), 'the probe spans must carry the real class');
});
