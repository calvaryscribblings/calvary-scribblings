// THE COVER DESCRIPTOR — three punchy words that sit under the hairline rule.
//
//   "DUTY. SACRIFICE. RUIN."      "BIRTH. RHYTHM. FAREWELL."      "RAIN. REPETITION. DREAD."
//
// ── OPTIONAL MEANS OPTIONAL ──────────────────────────────────────────────────────────────
// This field is never required, by anything, ever. A story with no descriptor is not a story
// with a hole in it: the cover generator drops the row, the hairline rule becomes the bottom
// of the stack, and the fleuron takes the space (scripts/covers/render.mjs, planCover). The
// result is a complete, deliberate design and roughly half the library will wear it.
//
// The consequence for validation is precise and worth stating so nobody "tightens" it later:
// the ONLY two valid states are ABSENT and THREE GOOD WORDS. There is no partially-filled
// state — one word or two is a half-finished thought, not a shorter descriptor — and there
// is no "required on publish". `validateDescriptor` returns ok for empty input on purpose.
//
// ── WHY IT IS STORED AS A STRING ─────────────────────────────────────────────────────────
// The obvious shape is an array of three words. RTDB does not have arrays — it stores them
// as objects with numeric keys and hands back an array only when the keys happen to be
// contiguous from zero, which is a property of the data rather than of the schema. A single
// canonical string has one representation, reads correctly in the Firebase console, survives
// the REST API unchanged, and is what an editor typed in the first place.
//
// The canonical form is LOWER CASE with full stops: `duty. sacrifice. ruin.` Case is a
// rendering decision — the cover sets it in caps, the CMS shows it as typed — and baking
// caps into the stored value would make the store the wrong place to change that decision.

/** The three approved examples, which the review rubric is derived from. */
export const DESCRIPTOR_EXAMPLES = Object.freeze([
  'duty. sacrifice. ruin.',
  'birth. rhythm. farewell.',
  'rain. repetition. dread.',
]);

export const DESCRIPTOR_WORDS = 3;
export const DESCRIPTOR_MAX_WORD = 14;

// Letters (any script, so Yorùbá and other diacritics pass), plus the internal hyphen and
// apostrophe a real word can carry. Digits are excluded: a numeral is not one of these words.
const WORD_RE = /^[\p{L}\p{M}]+(?:[-’'][\p{L}\p{M}]+)*$/u;

/** Split a typed descriptor into its words, tolerating stops, commas and stray spacing. */
export function descriptorWords(value) {
  if (Array.isArray(value)) return value.map((w) => String(w ?? '').trim()).filter(Boolean);
  return String(value ?? '').split(/[.,;]|\s+/).map((w) => w.trim()).filter(Boolean);
}

/**
 * Validate. Returns { ok, empty, words, error }.
 *
 * `ok` is true for the empty case — see the header. Callers that need "has a descriptor"
 * ask `!empty`, never `ok`.
 */
export function validateDescriptor(value) {
  const words = descriptorWords(value);
  if (!words.length) return { ok: true, empty: true, words: [], error: '' };
  if (words.length !== DESCRIPTOR_WORDS) {
    return { ok: false, empty: false, words, error: `Needs exactly ${DESCRIPTOR_WORDS} words — got ${words.length}. Leave it empty if you would rather not have one.` };
  }
  const tooLong = words.find((w) => w.length > DESCRIPTOR_MAX_WORD);
  if (tooLong) return { ok: false, empty: false, words, error: `"${tooLong}" is too long — keep every word to ${DESCRIPTOR_MAX_WORD} characters or fewer.` };
  const bad = words.find((w) => !WORD_RE.test(w));
  if (bad) return { ok: false, empty: false, words, error: `"${bad}" is not a single word. Letters only — no digits, and no punctuation beyond an internal hyphen or apostrophe.` };
  const seen = new Set(words.map((w) => w.toLowerCase()));
  if (seen.size !== words.length) return { ok: false, empty: false, words, error: 'The three words must be different from each other.' };
  return { ok: true, empty: false, words, error: '' };
}

/**
 * The stored form: lower case, full-stopped, single-spaced. Empty input stores as ''.
 *
 * Returns '' rather than throwing on invalid input; the caller is expected to have run
 * validateDescriptor and to be refusing to save. Canonicalising is not the place to enforce.
 */
export function canonicalDescriptor(value) {
  const { ok, empty, words } = validateDescriptor(value);
  if (!ok || empty) return '';
  return words.map((w) => `${w.toLocaleLowerCase('en-GB')}.`).join(' ');
}

/**
 * Does this descriptor repeat a word from the title?
 *
 * The rubric forbids it — a cover that says ODELUWA over "ODELUWA. GRIEF. RETURN." has spent
 * one of its three words saying nothing. Advisory, not blocking: an editor who means it
 * should be able to override, so this returns the offending words rather than a verdict.
 */
export function wordsEchoingTitle(value, title) {
  const stop = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'is', 'it']);
  const titleWords = new Set(
    String(title ?? '').toLowerCase().split(/[^\p{L}\p{M}]+/u).filter((w) => w && !stop.has(w)),
  );
  return descriptorWords(value).filter((w) => titleWords.has(w.toLowerCase()));
}
