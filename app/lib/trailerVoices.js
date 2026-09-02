// TRAILER VOICES — a reader's line on the house's trailer card.
//
// R32. Every story-trailer card in the home carousel carries two quotes: the writer's
// trailer line (the house speaking) and a real reader's comment from that story (a reader
// speaking). This module owns everything about that which is not pixels — which comments
// may ever be promoted, how one is abridged to fit, and which one a given rotation shows.
//
// It is PURE and DEPENDENCY-INJECTED throughout: no Firebase import, no DOM import. The
// carousel passes it a DOM probe, the tests pass it a counting stub, the backfill script
// passes it nothing at all. That is the same portability requirement that keeps
// app/lib/bookstore/readership.js and app/lib/userComments.js free of a static firebase
// dependency, and it is what makes the abridger testable without booting a browser.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// THE FLOOR IS 60 CHARACTERS, AND THE CORPUS ARGUED IT
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Measured on live data, 2 Sept 2026: 1,830 top-level comments on published stories, by 99
// readers. The MEDIAN COMMENT IS 26 CHARACTERS. The two most-repeated texts on the island
// are a clapping emoji (44 times) and "beautiful ❤️" (28 times).
//
// So a length floor here is not an optimisation. It is the whole difference between a
// pull-quote and a sticker, on a surface carrying the house's own typography on the first
// screen a new reader sees.
//
//   floor 40 → 704 comments kept, 157 of 157 quoted stories keep a voice
//   floor 60 → 500 comments kept, 148 of 157 quoted stories keep a voice   ← Ikenna's ruling
//
// Ikenna's reasoning, 2 Sept 2026: nine stories losing a voice costs less than a weak line
// under a beautiful card, and each of the nine gets its voice back the moment somebody
// writes a real sentence. The floor is a QUALITY BAR, not a budget control — see
// scripts/screen-comments.mjs for what it does and does not save in money.
export const VOICE_MIN_CHARS = 60;

/**
 * ⭑ THE PRE-SPEND FILTER. Answers "could this comment EVER appear on a trailer card?"
 * before a single token is bought.
 *
 * Every clause here removes a model call that could not have changed an outcome. Measured
 * over the 2,371-record backlog it removes 1,886 of them — replies (442), comments on slugs
 * that are not published stories (99: the `comments` node is shared with Open Pages, so
 * story surfaces must key by slug and never walk it), comments on stories carrying no
 * trailer quote (69: those stories never produce a trailer step at all), and everything
 * under the floor (1,276).
 *
 * ⚠ Be plain about what that is worth: it removes 79.5% of the calls and about $1.26. The
 * filter earns its place because a call that cannot change an outcome should not exist —
 * NOT because it is what makes this affordable. Haiku is what makes this affordable.
 *
 * `hasTrailerQuote` is passed in rather than looked up: this module does not know what a
 * story record looks like, and both callers already hold the index.
 */
export function isScreenable({ text, parentId, hasTrailerQuote }) {
  if (parentId) return false;                       // a reply is never a card's line
  if (!hasTrailerQuote) return false;               // no quote → no trailer step → no card
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length < VOICE_MIN_CHARS) return false;
  // An @mention on the front page reads as somebody else's conversation, and a URL is spam
  // whatever the model thinks of the prose around it. Both are cheaper to catch here.
  if (/(^|\s)@[a-z0-9_]{3,20}\b/i.test(t)) return false;
  if (/https?:\/\//i.test(t)) return false;
  return true;
}

/**
 * ⭑ THE VERDICT, AND WHY IT LIVES OUTSIDE THE COMMENT RECORD.
 *
 *   comment_screening/{slug}/{commentId} = { promotable, text?, uid, categories, reason,
 *                                            model, checkedAt }
 *
 * The obvious home was a `screening` child on the comment itself, and it is worthless.
 * The comments rule grants a comment's author `.write` on the whole record, and in RTDB a
 * permissive parent grants the ENTIRE subtree — a `.write: false` on a child inside it is
 * decoration, not a boundary. That is the R31 lesson about combined grants restated: a rule
 * that reads like a restriction but sits under a grant does nothing. Its own node is
 * world-readable and writable by nothing but the Pages Function's service account, so the
 * comments rule is not reopened at all.
 *
 * The field is named for the SIGNAL and not for this carousel. `promotable: false` is a
 * general "do not promote" mark: a founder can set it by hand to keep a comment out of every
 * surface without deleting it, and the next surface that wants a reader's words asks the
 * same question this one does.
 */
export const SCREENING_NODE = 'comment_screening';

/**
 * ⚠ FAILS CLOSED, AND THERE IS ONLY ONE WAY TO PASS.
 *
 * Absent, null, a string, an array, a hand-repair, an errored check, a row written before
 * the field existed, `promotable: 'true'` as a string — every one of them answers NO. The
 * only input that answers yes is the boolean true, written by the function after a model
 * call that returned a decision.
 *
 * A moderation failure must never promote something unchecked. This is where that is true.
 */
export function isPromotable(row) {
  return !!row && typeof row === 'object' && !Array.isArray(row) && row.promotable === true;
}

/**
 * The promotable voices for one story, oldest-key order made stable by sort.
 *
 * The screened TEXT is stored beside the verdict rather than a pointer back to the comment,
 * and that buys two things. The carousel reads one node per story — a measured mean of 888
 * bytes against 3.6 KB for the raw comment thread, which matters on a homepage that has been
 * through three phases of speed work. And it closes an edit hole: somebody who posts an
 * innocuous comment, gets promoted, then edits it to something abusive cannot change what
 * the card shows even if the re-screen call is dropped, because the card is reading the
 * words that were screened.
 *
 * The identity is NOT stored here — only the uid. See resolveVoiceIdentity below.
 */
export function promotableVoices(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  return Object.entries(node)
    .filter(([, row]) => isPromotable(row) && typeof row.text === 'string' && row.text.trim())
    .map(([id, row]) => ({ id, text: row.text.trim(), uid: row.uid || null }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * ⭑ WHETHER THIS STORY GETS A TRAILER AT ALL, and therefore ruling 1 in one function.
 *
 * Lives here rather than in the carousel because it is the decision the suite has to be able
 * to redden: a trailer emitted for a story with no promotable voice is a card with a hole in
 * it, and a trailer emitted before the pin is measured is a stage of the wrong height.
 *
 * ⚠ A FALSE HERE COSTS THE TRAILER, NEVER THE CARD. The story keeps its place in the ten and
 * simply shows plain. Dropping the card would let comment activity decide which stories the
 * house promotes, and that is backwards — the house chooses what is featured.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════════
 * ⭑ R32.2 — THE EVERY-2ND RULE IS GONE, AND WHAT IT WAS PACING NO LONGER EXISTS
 * ═════════════════════════════════════════════════════════════════════════════════════════
 *
 * This function used to open with `if (storyIndex % 2 !== 1) return false` — "every 2nd
 * story, unchanged". That capped the ten at FIVE trailers before a single voice was
 * consulted, and it is why Ikenna's first walk of the shipped carousel found two.
 *
 * ⚠ IT WAS A RHYTHM DECISION MADE FOR A DIFFERENT CARD. When that rule was written a trailer
 * carried ONE quote — the house's — and every second story was the right pace for a single
 * repeated gesture. R32 changed what a trailer card IS: it now carries two quotes in two
 * registers, the house's and a stranger's, and a reader's name and face beside them. That is
 * no longer a gesture being repeated too often; it is the thing the card is for. Ikenna
 * expected eight or nine of ten, and after R32 that expectation is the correct one.
 *
 * ⚠⚠ DO NOT RESTORE THE OLD RHYTHM WITHOUT KNOWING WHAT IT WAS PACING. If a future round
 * wants fewer trailers, the honest lever is the dwell or the size of the ten, not a modulo
 * that silently halves the ceiling and then hides behind the voice pool for the shortfall.
 *
 * MEASURED, over 1,000 rotations against live data, 2 Sept 2026:
 *   with `% 2`  — mean 3.86 of a ceiling of 5, and 68 rotations in 1,000 (6.8%) showing two
 *                 or fewer. Seed 993549, the 22:30Z window Ikenna walked, gave exactly two,
 *                 at positions 8 and 10.
 *   without it  — mean 7.1 of a ceiling of 9.
 *
 * ⚠⚠ AND THE FIX THAT WAS REFUSED, recorded here so it is not proposed again. The obvious
 * alternative was to keep the modulo and ORDER THE TEN so that stories carrying a voice land
 * on the eligible positions. It measures beautifully — mean 4.99 of 5, one bad rotation in a
 * thousand — and Ikenna refused it, correctly. It lets comment activity decide WHICH STORY
 * LEADS THE CAROUSEL, which is the same ruling he already made when he kept a voiceless
 * story's card rather than dropping it from the ten. The house chooses what is promoted.
 * The set and the order of the ten are editorial; only whether a card gets a trailer is not.
 *
 * ⭑ STORY 0 STILL NEVER TRAILERS, and that is not a leftover of the modulo — it is two
 * separate requirements that happen to agree:
 *
 *   1. THE SEQUENCE'S FIRST STEP MUST BE A CARD. `loop` increments when the rotation wraps
 *      to step 0, and `loop` is an input to which voice each story shows. If step 0 were a
 *      trailer, the pass counter would advance into the very step whose voice it changes.
 *      The carousel's own comment states that invariant; this is what keeps it true.
 *   2. THE HOMEPAGE OPENS ON A STORY, NOT ON AN INTERSTITIAL. The first thing the hero shows
 *      a new visitor should be a card, not a quote animating word by word into one.
 *
 * So the ceiling is NINE of ten, which is exactly the eight or nine that was asked for.
 */
export function shouldTrailer({ storyIndex, reducedMotion, quote, voices, pinReady }) {
  if (reducedMotion) return false;
  if (storyIndex === 0) return false;                  // step 0 is a card — see above, both reasons
  if (typeof quote !== 'string' || !quote.trim()) return false;
  if (!pinReady) return false;                         // nothing pins until every candidate reported
  return Array.isArray(voices) && voices.length > 0;
}

// ── THE ABRIDGER ──────────────────────────────────────────────────────────────────────────
//
// Ikenna's ruling: abridge by ellipsis to TWO LINES, fitted to the card, cutting at a
// sentence boundary where one exists and ellipsising only when a single sentence overruns.
// Truncating mid-clause reads as broken; stopping at a full stop reads as a pull-quote.
//
// Measured over all 500 candidates at five viewports: 391 need no mark at all, 84 end on a
// full stop, and only 25 — 5% — take an ellipsis. Zero exceed two lines at any width.
//
// `fits` is injected because FIT IS MEASURED, NEVER ESTIMATED. In the browser it is a probe
// element of the card's real width in the card's real type; in the suite it is a character
// count, which is enough to assert the BRANCHING (which path was taken and where it cut)
// without asserting metrics a stub could not know. The heights themselves are asserted in
// Playwright against the real pool — see tests/voices/heights.spec.mjs.

/** Sentence terminator: . ! ? with any closing quote/bracket, followed by space or end. */
const SENTENCE_END = /[.!?]+["'”’)\]]*(?=\s|$)/g;
/** Trailing punctuation an ellipsis must not sit on top of. */
const DANGLING = /[,;:.!?—–\-\s]+$/;

export const ABRIDGE_WHOLE = 'whole';
export const ABRIDGE_SENTENCE = 'sentence';
export const ABRIDGE_ELLIPSIS = 'ellipsis';

/**
 * Abridge one comment to whatever `fits` accepts.
 *
 * Returns { text, mode }. The mode is not decoration — the suite asserts on it, because
 * "cuts at a sentence boundary where one exists" and "ellipsises only when it must" are two
 * separate rulings and a single output string cannot distinguish them.
 */
export function abridgeToFit(raw, fits) {
  // Whitespace collapses first. 166 of the candidates carry a newline, and a comment written
  // as three short paragraphs is still one line of reported speech on a card.
  const t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!t) return { text: '', mode: ABRIDGE_WHOLE };
  if (fits(t)) return { text: t, mode: ABRIDGE_WHOLE };

  // The longest run of COMPLETE sentences that fits. No ellipsis: a full stop is a
  // pull-quote's natural end, and a mark after one would claim something was withheld.
  SENTENCE_END.lastIndex = 0;
  let best = null;
  let m;
  while ((m = SENTENCE_END.exec(t)) !== null) {
    const candidate = t.slice(0, m.index + m[0].length).trim();
    if (!fits(candidate)) break;   // sentences only get longer; stop at the first miss
    best = candidate;
  }
  if (best) return { text: best, mode: ABRIDGE_SENTENCE };

  // Only now — the first sentence alone overruns, or there is no terminator anywhere.
  // Word-boundary truncation, with the ellipsis INSIDE the fit so the mark itself can never
  // be what pushes the line over.
  const words = t.split(' ');
  let lo = 1;
  let hi = words.length;
  let out = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = words.slice(0, mid).join(' ').replace(DANGLING, '') + '…';
    if (fits(candidate)) { out = candidate; lo = mid + 1; } else { hi = mid - 1; }
  }
  // A width so narrow that not one word fits is not a card we would draw; the caller drops
  // the voice rather than printing a bare ellipsis.
  return { text: out, mode: ABRIDGE_ELLIPSIS };
}

// ── THE ROTATION ──────────────────────────────────────────────────────────────────────────
//
// Ikenna's ruling: RANDOM PER CAROUSEL ROTATION — at the carousel's pace a story can show
// several different comments across a session. Not fixed per session, not per launch.
//
// Implemented as a per-story shuffle advanced by a loop counter rather than Math.random(),
// for one reason: random repeats. Over a five-minute visit a story's trailer plays three or
// four times, and true random would show the same line twice inside that window often enough
// to read as a bug. A shuffle that advances shows every voice a story has before it shows
// any of them twice, which is what "several different comments across a session" asks for.
//
// The shuffle seed is the same 30-minute rotation window the carousel already uses, so the
// order a story cycles through is stable within a rotation and different across them.

/** Seeded hash — the same construction rotationScore uses, so no key class can pin itself. */
function hash(str, seed) {
  let h = (seed >>> 0) || 1;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 2654435761) >>> 0;
  return h >>> 0;
}

/** Deterministic Fisher-Yates over a copy, driven by the seeded hash. */
export function shuffleVoices(voices, slug, seed) {
  const a = [...voices];
  let h = hash(slug, seed) || 1;
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (i + 0x9e3779b9), 2654435761) >>> 0;
    const j = h % (i + 1);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/**
 * The voice this story shows on this pass. `loop` counts how many times the carousel has
 * come back round; it advances the index, so consecutive plays of the same story show
 * consecutive entries of that rotation's shuffle.
 *
 * Returns null when the story has no promotable voice — and a null here is the whole of
 * ruling 1: the CARD KEEPS ITS PLACE and simply carries no reader's line. Dropping the story
 * would let comment activity decide which stories get promoted, and that is backwards — the
 * house chooses what is featured, not the commenters.
 */
export function pickVoice(voices, { slug, seed, loop = 0 }) {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const order = shuffleVoices(voices, slug, seed);
  return order[((loop % order.length) + order.length) % order.length];
}

// ── IDENTITY ──────────────────────────────────────────────────────────────────────────────
//
// ⚠⚠ RESOLVED AT RENDER, NEVER COPIED. R33's Square audit found identity photographed at
// write time and never refreshed: the island badge wrong on 112 of 115 posts, 23 stale names,
// 15 readers showing initials who by then had pictures. The same disease is already in the
// comments — measured 2 Sept 2026, 447 of 1,830 stored authorName copies (24.4%) disagree
// with the reader's live record, mostly short names since filled out ("J Tech" →
// "Nzubechukwu Okere", "Chi chi" → "Chinemerem"). This surface reads the live record.
//
// ⚠ ONE RUNG OF THE LADDER IS A COPY, AND IT HAS TO BE. 29 of the 99 commenters have NO name
// in users/{uid} at all — their record holds only readCount and readStories — so for them
// the comment's stored authorName is the only name that exists anywhere. The stored copy is
// therefore the LAST rung, never the first: the live record wins whenever it has anything.
// A voice with no name on any rung is dropped rather than printed as "Reader".

/**
 * Build the card's identity from the reader's live users/{uid} record.
 * `stored` is the comment's own authorName — the last-resort rung, and nothing else.
 */
export function resolveVoiceIdentity(user, stored) {
  const u = user && typeof user === 'object' && !Array.isArray(user) ? user : {};
  const name =
    (typeof u.displayName === 'string' && u.displayName.trim()) ||
    (typeof u.name === 'string' && u.name.trim()) ||
    (typeof stored === 'string' && stored.trim()) ||
    '';
  if (!name) return null;
  return {
    name,
    photo: (typeof u.avatarUrl === 'string' && u.avatarUrl) || (typeof u.photoURL === 'string' && u.photoURL) || null,
    initials: name.split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase(),
    readCount: Number(u.readCount) || 0,
    isAuthor: u.isAuthor === true,
  };
}

// ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────────────────────
//
// THE HANDLE. It is the most interesting omission on this card, so it is recorded rather
// than merely left out. Three measured reasons:
//
//   · Only 46 of the 99 commenters own a handle in usernames/ — it would be blank more than
//     half the time, on a card whose identity row must not change width.
//   · users/{uid}.username is NOT AUTHORITATIVE. R33.1a established this: that field is
//     owner-writable with no uniqueness check anywhere, so a reader can set their own
//     username to somebody else's and post as them. usernames/{handle} is the only real
//     authority on who owns a handle.
//   · And there is NO uid→handle reverse index. Resolving a handle honestly at render would
//     mean scanning usernames/, which is the wrong shape and grows.
//
// THE BADGE LABEL. The icon earns its 12px; the label does not. "Immortal of the Island" and
// "Legend of the Island" out-measure the name beside them, and 67 of 99 commenters carry no
// badge at all — a labelled badge would make the identity row's width lurch from card to
// card, which is the same defect as a moving stage in a different direction. Weighted by
// comment volume, 93% of promotable comments carry a tier or the Writer mark, so the rosette
// is nearly always there.
