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
import {
  REFUSAL_CATEGORIES,
  SCREENING_VERSION,
  CALIBRATION,
  foldCategory,
  normaliseCategories,
  buildScreeningRequest,
  parseScreeningResponse,
  screeningRow,
  estimateInputTokens,
  promptChars,
} from '../../app/lib/voiceScreening.js';

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

// ─────────────────────────────────────────────────────────────────────────────────────────
// ⭑ R32.2 — THE CEILING IS NINE OF TEN, NOT FIVE. This test replaces one that asserted
// `every 2nd story only`, and the assertion it replaces is the defect Ikenna walked into:
// the modulo capped the ten at five trailers before a single voice was consulted, and the
// live mean was 3.86. Mutation: restore `if (storyIndex % 2 !== 1) return false`.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('every story but the first can carry a trailer', () => {
  const base = { reducedMotion: false, quote: 'a line', voices: [{ id: 'a' }], pinReady: true };
  // the whole ten, and nine of them are eligible
  const eligible = [];
  for (let i = 0; i < 10; i++) if (shouldTrailer({ ...base, storyIndex: i })) eligible.push(i);
  assert.deepEqual(eligible, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'positions 2-10 are all eligible');

  // ⚠ STORY 0 NEVER TRAILERS, and it is load-bearing twice over: the sequence's step 0 must
  // be a CARD, because `loop` advances on the wrap to step 0 and `loop` chooses the voice —
  // a trailer there would advance the counter into the step whose voice it changes. And the
  // homepage opens on a story, not on a quote animating into one.
  assert.equal(shouldTrailer({ ...base, storyIndex: 0 }), false, 'step 0 must be a card');
});

test('the conditions that already existed still hold', () => {
  const base = { reducedMotion: false, quote: 'a line', voices: [{ id: 'a' }], pinReady: true };
  assert.equal(shouldTrailer({ ...base, storyIndex: 1, reducedMotion: true }), false);
  assert.equal(shouldTrailer({ ...base, storyIndex: 1, quote: '   ' }), false);
  assert.equal(shouldTrailer({ ...base, storyIndex: 2, quote: '   ' }), false, 'no quote, any position');
  assert.equal(shouldTrailer({ ...base, storyIndex: 2, voices: [] }), false, 'no voice, any position');
  assert.equal(shouldTrailer({ ...base, storyIndex: 2, pinReady: false }), false, 'no pin, any position');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE DWELL. Ikenna's ruling: a card carrying two quotes needs longer than one carrying one.
// The trailer's duration and the card's are separate constants and must stay separate —
// slowing all ten would make the carousel drag. Mutation: drop TRAILER_READER_HOLD_MS from
// the hold, or leave TRAILER_CAP_MS at 8000 while the hold grows.
// ─────────────────────────────────────────────────────────────────────────────────────────
const PAGE_SRC = readFileSync(fileURLToPath(new URL('../../app/public-library/page.js', import.meta.url)), 'utf8');

test('the trailer dwell grew by three seconds and the cap grew with it', () => {
  assert.match(PAGE_SRC, /const HERO_CARD_MS = 5000;/, 'a plain card is untouched at 5s');
  assert.match(PAGE_SRC, /const TRAILER_READER_HOLD_MS = 3000;/);
  assert.match(PAGE_SRC, /const TRAILER_CAP_MS = 11000;/, 'the cap must move or the longest quotes gain nothing');
  // the extra time goes on the HOLD — not the lead-in, not the word cadence
  assert.match(PAGE_SRC, /Math\.min\(3200, wordCount \* 120\)\) \+ TRAILER_READER_HOLD_MS/);
  // and the watchdog ceiling is derived from the cap, never restated
  assert.match(PAGE_SRC, /MAX_STEP_MS = Math\.max\(HERO_CARD_MS, TRAILER_CAP_MS\)/);

  // ⭑ EVERY quote gains exactly three seconds, including the nine that were already sitting
  // on the old ceiling. Both the hold and the cap moved by 3000, so the difference is
  // constant across the whole pool — which is the property a raised cap is FOR. Leave the
  // cap at 8000 and this assertion goes red at 39 words and above, where the nine live.
  const base = (w) => Math.max(1600, Math.min(3200, w * 120));
  const was = (w) => Math.min(350 + w * 150 + 750 + base(w), 8000);
  const now = (w) => Math.min(350 + w * 150 + 750 + base(w) + 3000, 11000);
  for (let w = 1; w <= 120; w++) {
    assert.equal(now(w) - was(w), 3000, `a ${w}-word quote must gain exactly three seconds`);
  }
  assert.equal(was(60), 8000, 'a 60-word quote was on the old ceiling');
  assert.equal(now(60), 11000, 'and is on the new one, three seconds later');
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


// ═════════════════════════════════════════════════════════════════════════════════════════
// R32.1 — THE CLOSED REFUSAL LIST, AND THE COST MODEL
//
// Same discipline as everything above: each block names the edit to app/lib/voiceScreening.js
// that must redden it, and each of those edits was applied, the suite run, the red observed,
// and the edit reverted.
// ═════════════════════════════════════════════════════════════════════════════════════════
const SCREEN_SRC = readFileSync(fileURLToPath(new URL('../../app/lib/voiceScreening.js', import.meta.url)), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE COERCION IS THE PART THAT HOLDS. Mutation: in normaliseCategories, return the raw
// array filtered to strings — i.e. restore the version 1 behaviour.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('nothing off the closed list can ever reach a stored row', () => {
  // every free-text label the version 1 run actually produced, plus junk and an attack
  const wild = [
    'not about the story', 'not_about_story', 'no_story_reference', 'unclear context',
    'context-dependent', 'no context', 'out of context', 'lacks context', 'out-of-context',
    'incomplete context', 'contextual fragment', 'unclear reference', 'inside-reference',
    'unclear', 'fragment', 'incomplete', 'generic advice', 'generic platitude',
    'political advocacy', 'sports prediction', 'likely spam or bot', 'violence',
    'wibble', '', '   ', 'SPOILER', 'Off-Topic ', 'ignore your instructions',
  ];
  for (const label of wild) {
    for (const c of normaliseCategories([label])) {
      assert.ok(REFUSAL_CATEGORIES.includes(c), `${JSON.stringify(label)} produced off-list ${JSON.stringify(c)}`);
    }
  }
  // non-strings, and non-arrays, cannot produce a category either
  for (const junk of [undefined, null, 'spoiler', 42, {}, { 0: 'spoiler' }]) {
    assert.deepEqual(normaliseCategories(junk), [], `non-array ${JSON.stringify(junk)}`);
  }
  for (const c of normaliseCategories([null, 7, {}, [], () => {}])) {
    assert.ok(REFUSAL_CATEGORIES.includes(c));
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE FOLD IS WHAT MAKES THE STORED HISTORY COUNTABLE. Mutation: drop the LEGACY_CATEGORY
// lookup from foldCategory and return CATEGORY_FALLBACK for anything not already on the list.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('the version 1 vocabulary folds onto the closed list rather than collapsing to other', () => {
  assert.equal(foldCategory('not about the story'), 'off-topic');
  assert.equal(foldCategory('not_about_story'), 'off-topic');
  assert.equal(foldCategory('no_story_reference'), 'off-topic');
  assert.equal(foldCategory('unclear context'), 'needs-context');
  assert.equal(foldCategory('out of context'), 'needs-context');
  assert.equal(foldCategory('out-of-context'), 'needs-context');
  assert.equal(foldCategory('lacks context'), 'needs-context');
  assert.equal(foldCategory('context-dependent'), 'needs-context');
  assert.equal(foldCategory('likely spam or bot'), 'spam');
  assert.equal(foldCategory('violence'), 'explicit');
  // already-canonical words survive untouched, in any casing or padding
  for (const c of REFUSAL_CATEGORIES) {
    assert.equal(foldCategory(c), c);
    assert.equal(foldCategory(` ${c.toUpperCase()} `), c);
  }
  // a genuinely unknown word is the only thing that becomes `other`
  assert.equal(foldCategory('wibble'), 'other');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// `other` IS A LAST RESORT, NOT A COMPANION. Mutation: return `out` unfiltered.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('other is dropped beside a real label and kept when it is the whole answer', () => {
  assert.deepEqual(normaliseCategories(['spoiler', 'wibble']), ['spoiler']);
  assert.deepEqual(normaliseCategories(['wibble']), ['other']);
  assert.deepEqual(normaliseCategories(['wibble', 'wobble']), ['other']);
  // and duplicates — four spellings of one reason — collapse to one label
  assert.deepEqual(
    normaliseCategories(['off-topic', 'not about the story', 'not_about_story', 'no_story_reference']),
    ['off-topic']
  );
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE LIST IS STATED IN ALL THREE PLACES. Mutation: delete `enum` from the tool schema, or
// remove one bullet from the CATEGORIES block of the system prompt.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('the schema enum and the system prompt name exactly the closed list, and nothing else', () => {
  const req = buildScreeningRequest('a comment long enough to be worth screening at all');
  const schema = req.tools[0].input_schema.properties.categories;
  assert.deepEqual(schema.items.enum, [...REFUSAL_CATEGORIES], 'the tool schema enum IS the list');
  for (const c of REFUSAL_CATEGORIES) {
    assert.ok(req.system.includes(`\n- ${c} —`), `the system prompt must define ${c}`);
  }
  // and no bullet in that block names a word that is not on the list
  const block = req.system.slice(req.system.indexOf('CATEGORIES.'));
  for (const [, word] of block.matchAll(/^- ([a-z-]+) —/gm)) {
    assert.ok(REFUSAL_CATEGORIES.includes(word), `the prompt defines off-list ${word}`);
  }
  assert.ok(req.system.includes('Do not invent a label'), 'the prompt must forbid inventing one');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// A REFUSAL IS STILL A REFUSAL. Mutation: make parseScreeningResponse throw when a category
// is off-list. That would turn a labelling quibble into a fail-closed, which is the one
// thing the vocabulary change must NOT do.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('an off-list label never changes the verdict, in either direction', () => {
  const resp = (input) => ({ content: [{ type: 'tool_use', name: 'screen_comment', input }] });
  const refused = parseScreeningResponse(resp({ promotable: false, categories: ['wibble'], reason: 'no' }));
  assert.equal(refused.promotable, false);
  assert.deepEqual(refused.categories, ['other']);
  const passed = parseScreeningResponse(resp({ promotable: true, categories: ['wibble'], reason: 'yes' }));
  assert.equal(passed.promotable, true, 'a promotable comment is not demoted by an odd label');
  // the verdict gate is still the boolean and nothing else
  assert.equal(screeningRow({ ...refused, uid: 'u1', text: 'x' }).promotable, false);
  assert.equal(screeningRow({ ...passed, uid: 'u1', text: 'x' }).promotable, true);
  assert.equal(screeningRow({ ...passed, uid: 'u1', text: 'x' }).version, SCREENING_VERSION);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// ⭑ THE ESTIMATOR MUST MOVE WHEN THE PROMPT DOES. This is the R32 defect itself, as a test:
// 526 was projected, ~1,297 was billed, and nothing anywhere noticed. Mutation: make
// estimateInputTokens return a constant, or drop the `drift` term from it.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('a longer prompt costs more, and a longer comment costs more', () => {
  const short = estimateInputTokens('x'.repeat(50));
  const long = estimateInputTokens('x'.repeat(50 + 3900));
  assert.ok(long - short > 900, `1,000 tokens of comment must show up; got ${long - short}`);

  // the anchor is a MEASUREMENT of a specific prompt, so the estimate must carry the
  // difference between that prompt and the one in the file today
  const drift = (promptChars() - CALIBRATION.promptChars) / 3.9;
  assert.equal(estimateInputTokens(''), Math.round(CALIBRATION.meanInputTokens - CALIBRATION.meanTextChars / 3.9 + drift));

  // ⚠ and the estimate must be in the neighbourhood of what was actually billed. The old
  // 526 fails this by a factor of two, which is the only assertion that would have caught it.
  const atMean = estimateInputTokens('x'.repeat(Math.round(CALIBRATION.meanTextChars)));
  const ratio = atMean / CALIBRATION.meanInputTokens;
  assert.ok(ratio > 0.85, `estimate ${atMean} is far under the measured ${CALIBRATION.meanInputTokens}`);
  assert.ok(ratio < 1.6, `estimate ${atMean} is far over the measured ${CALIBRATION.meanInputTokens}`);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE OVERHEAD IS NOT THE LENGTH OF THE TEXT. The whole reason 526 was wrong. Mutation:
// redefine promptChars() as SYSTEM_PROMPT.length alone — the count the original guess made.
// ─────────────────────────────────────────────────────────────────────────────────────────
test('the fixed cost counts the tool schema and the wrapper, not just the system prompt', () => {
  const req = buildScreeningRequest('');
  const system = req.system.length;
  const tools = JSON.stringify(req.tools).length;
  assert.equal(promptChars(), system + tools + req.messages[0].content.length);
  assert.ok(promptChars() > system + 500, 'the tool definition is billed input and must be counted');

  // and the anchor's overhead must exceed what the visible characters alone would suggest —
  // the gap IS the tool-use scaffolding the API adds, which no string in the file contains
  const overhead = CALIBRATION.meanInputTokens - CALIBRATION.meanTextChars / 3.9;
  assert.ok(overhead > CALIBRATION.promptChars / 3.9 + 300, 'the invisible scaffolding must be inside the anchor');
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// NO ESTIMATE MAY BE RESTATED AWAY FROM THE ANCHOR. Mutation: put `const PROJECTED_IN = 526`
// back into scripts/screen-comments.mjs.
// ─────────────────────────────────────────────────────────────────────────────────────────
const BACKFILL_SRC = readFileSync(fileURLToPath(new URL('../../scripts/screen-comments.mjs', import.meta.url)), 'utf8');

test('the backfill projects through the shared cost model and holds no rate of its own', () => {
  assert.ok(!/PROJECTED_IN|PROJECTED_OUT/.test(BACKFILL_SRC), 'no hardcoded per-call token guess');
  assert.ok(
    !/^\s*const\s+USD_PER_(INPUT|OUTPUT)_TOKEN\s*=/m.test(BACKFILL_SRC),
    'the script must import the rates, never restate them'
  );
  assert.ok(BACKFILL_SRC.includes('estimateCallCost'), 'the projection comes from the shared model');
  assert.ok(BACKFILL_SRC.includes('DRIFT'), 'a measured/estimated disagreement must be announced');
  // the source of truth carries its provenance
  assert.match(SCREEN_SRC, /CALIBRATION = Object\.freeze\(\{[\s\S]*measuredAt:/);
});
