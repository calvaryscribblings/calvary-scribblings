// THE ISLAND'S INDEX — the back-of-book kind, browsable before anyone types.
//
// ── THE FRAME ────────────────────────────────────────────────────────────────────────────
//
// Search is a fifth of a five-tab bar. Before R46 it drew an emoji and ten hardcoded
// suggestion strings, and paid 215 KB and 13 round trips to do it. A tab that is blank until
// you type wastes its place in the bar, and the island has plenty to offer before a word is
// entered: 171 stories under 6 forms and 28 subjects, 10 voices, 23 books.
//
// So the resting state IS an index. Everything below is derived from the catalogue the page
// has already fetched for its results — the resting index costs NO additional read.
//
// ⚠ NOTHING HERE IS MAINTAINED BY HAND. The forms, the subjects, the counts and the weights
// all fall out of the live shelf, so the index re-shapes itself as the catalogue grows and
// nobody has to remember to update it. That is the point of it, not a bonus.
//
// Pure — no React, no Firebase, no DOM. The rendering surface and the tests import the same
// functions, so a guard can fail on the thing the reader sees.
import { CATEGORIES, SUBCATEGORIES } from './taxonomy.js';

// ── AN EMPTY ENTRY IS ABSENT, NOT GREYED ─────────────────────────────────────────────────
//
// Same grammar as tabsPresentIn() next door in taxonomy.js, and as an unclaimed bookstore
// section rendering nothing: a form or a subject earns its place by holding at least one of
// the stories it is shown beside. Measured on the live shelf today, this hides:
//
//   · NOVEL — 0 stories, so BY FORM draws five rows, not six;
//   · Business, Finance, Sci-Fi, Elegy, Faith, Novel, Novella, Serial — 8 of the 36
//     vocabulary labels, so BY SUBJECT runs 28 subjects.
//
// An empty state is a promise the library has not kept. Elegy in particular was ruled in and
// has nothing filed under it yet (R44) — it appears the day a poem is filed, with no edit.

// ── THE THREE WEIGHT STEPS ARE DERIVED. RE-DERIVE THEM; DO NOT PRESERVE THEM ─────────────
//
// The subject run is set in three type sizes so the index maps what the island is actually
// ABOUT — a reader should be able to see, without reading a single number, that this is a
// place for drama and for writing about technology and film.
//
// The cuts below were read off the REAL ratio gaps in the live distribution on 9 Sep 2026,
// sorted descending:
//
//   42 │ 21 │ 15 │ 10  9  7  6  6  5  5  5 │ 4  4  4  3  3  3  3  2×6  1×4
//      ↑2.0×   ↑1.4×  ↑1.5×                ↑
//
//   A  ≥ 15   3 subjects   78 stories (46%)   Drama 42 · Tech 21 · Film 15
//   B  5–14   8 subjects   53 stories (31%)
//   C  ≤ 4   17 subjects   40 stories (23%)
//
// ⚠ THESE ARE NOT MAGIC NUMBERS AND MUST NOT BE TREATED AS HOUSE CONSTANTS. They are a
// snapshot of one distribution. When the catalogue has grown enough that the gaps have moved,
// re-run scripts/audit-search-index.mjs and move them — the right instinct on seeing this
// comment in a year is to re-derive, not to preserve. The band 11–14 is empty today; a
// subject landing there takes step B, which is what the ≥5 test does.
export const WEIGHT_CUTS = { A: 15, B: 5 };

/** Which weight step a count falls in: 1 is the heaviest. */
export function weightStep(count) {
  if (count >= WEIGHT_CUTS.A) return 1;
  if (count >= WEIGHT_CUTS.B) return 2;
  return 3;
}

/** BY FORM — every category holding at least one story, in taxonomy order, with its count. */
export function formRows(stories) {
  const list = stories || [];
  return CATEGORIES.map((c) => ({
    value: c.value,
    label: c.label,
    count: list.filter((s) => s && s.category === c.value).length,
  })).filter((r) => r.count > 0);
}

// ── A SUBJECT SPANS CATEGORIES, AND THE INDEX IS THE ISLAND'S ────────────────────────────
//
// The vocabulary is keyed BY CATEGORY in taxonomy.js — 'Drama' is a flash subject and a
// short subject, stored as the same string on both. The index flattens that, deliberately:
// a reader tapping Drama wants all 42 (33 short + 9 flash), not one category's share. Five
// subjects span two categories today — Drama, Slice of Life, Horror, Romance, Humour.
//
// ⚠ SO A SUBJECT'S QUERY IS NEVER SCOPED TO A CATEGORY. The index belongs to the island.
export function subjectRuns(stories) {
  const list = stories || [];
  const vocab = new Set(Object.values(SUBCATEGORIES).flat());
  const seen = new Map();
  for (const s of list) {
    const label = s && typeof s.subcategory === 'string' ? s.subcategory.trim() : '';
    if (!label || !vocab.has(label)) continue;
    if (!seen.has(label)) seen.set(label, { label, count: 0, categories: new Set() });
    const e = seen.get(label);
    e.count += 1;
    if (s.category) e.categories.add(s.category);
  }
  const rows = [...seen.values()].map((e) => ({
    label: e.label,
    count: e.count,
    step: weightStep(e.count),
    categories: [...e.categories].sort(),
  }));
  // Alphabetical WITHIN each weight step. The steps carry the ranking, so ordering by count
  // inside a step would be a second, invisible ranking competing with the type size — and an
  // alphabetical run is what makes the block scannable for a word you already have in mind.
  rows.sort((a, b) => a.step - b.step || a.label.localeCompare(b.label));
  return rows;
}

// ── NEAR-IDENTICAL LABELS, AND THE LIGHTEST THING THAT SEPARATES THEM ────────────────────
//
// 'Political' (poetry, 4) and 'Politics' (news, 4) are different subjects that land adjacent
// in an alphabetical run and read as a typo — one of them looks like a misspelling of the
// other. They are NOT renameable: the label IS the stored key on every story filed under it,
// so a rename is a data migration, not a redirect (taxonomy.js says this at length).
//
// The lightest treatment that separates them is to name the FORM on the collided label only,
// and only where the collision is real. 'Political · poetry' beside 'Politics · news' reads
// as two subjects; putting the form on all 28 would be a second column nobody asked for.
//
// Two labels collide when they SHARE A LONG STEM AND DIVERGE ONLY AT THE TAIL: once case,
// spaces, hyphens and ampersands are dropped, their common prefix is at least 5 characters
// and what is left of each is at most 3. That is the shape of the problem —
//
//   politic|s  vs  politic|al   → COLLIDES. Stem 7, tails 1 and 2. In an alphabetical run
//                                 these land adjacent and one reads as a misspelling of the
//                                 other. They are different subjects in different forms.
//   novel vs novel|la           → COLLIDES. Both empty today; caught the day one is filled.
//   essay vs personalessay      → does not collide, correctly. Common prefix 0: the
//                                 qualifier LEADS, so the eye separates them already.
//   scifi vs science            → does not collide. Common prefix 3, below the floor.
//
// ⚠ TWO EARLIER RULES HERE SILENTLY FOUND NOTHING, and each looked right while doing it.
// The first tested equality after stripping a trailing 's' ('politic' ≠ 'political'); the
// second tested whether one label was a PREFIX of the other, which 'politics' and
// 'political' also fail — they diverge at character 8. Both returned an empty collision set
// against the live shelf and would have shipped the run with the exact pair the rule exists
// for. tests/ci/search-index.test.mjs therefore asserts the LIVE PAIR BY NAME as well as the
// rule's behaviour, because a collision rule that finds no collisions is indistinguishable
// from a correct one until you name the case it must catch.
//
// Computed from the live rows rather than listed, so the next collision is disambiguated the
// day it appears and nobody has to notice it first.
const nub = (s) => String(s).toLowerCase().replace(/[\s\-–—&]/g, '');

const STEM_MIN = 5;
const TAIL_MAX = 3;

const nearIdentical = (a, b) => {
  if (a === b) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i >= STEM_MIN && a.length - i <= TAIL_MAX && b.length - i <= TAIL_MAX;
};

export function markCollisions(rows) {
  const list = rows || [];
  const nubs = list.map((r) => nub(r.label));
  return list.map((r, i) => ({
    ...r,
    collides: list.some((_, k) => k !== i && nearIdentical(nubs[i], nubs[k])),
  }));
}

// ── MATCHING ─────────────────────────────────────────────────────────────────────────────
//
// One normaliser for every corpus, so "op-ed", "Op–Ed" and "OPED" all find the same shelf and
// no surface can drift into a slightly different idea of what matching means.
export const norm = (s) => String(s == null ? '' : s).toLowerCase().trim();

/** The query as the corpora see it: a leading @ is a handle sigil, not a character to match. */
export function normalizeQuery(raw) {
  const q = norm(raw);
  return q.startsWith('@') ? q.slice(1) : q;
}

const hit = (value, q) => norm(value).includes(q);

/**
 * ⚠ PROSE ITSELF IS NOT SEARCHED THIS ROUND, AND THAT IS THE LARGEST QUALITY JUMP LEFT.
 *
 * A reader who remembers a LINE cannot find the story it came from. The bodies exist — 171
 * of them, in cms_stories/<slug>/content — but that node is 1.86 MB whole, so prose search is
 * a real build (a server-side index, or a body-search endpoint), not a field added to this
 * list. Ikenna has not ruled on it.
 *
 * ⭑ THE RESULT ROW IS ALREADY SHAPED FOR IT. Each row prints `opening` — the real first line
 * of prose, indexed at publish time through the shared predicate — in a fixed two-line box.
 * When prose search lands, a matched SENTENCE takes that line's place: same field, same
 * budget, same box, no layout change. Do not add a `content` clause here without building the
 * index; a naive one downloads the catalogue per keystroke.
 */
export function matchStories(stories, q) {
  if (!q) return [];
  return (stories || []).filter(
    (s) =>
      s &&
      (hit(s.title, q) ||
        hit(s.author, q) ||
        hit(s.categoryName, q) ||
        hit(s.subcategory, q) ||
        hit(s.date, q))
  );
}

/** Voices match on the name a reader can see, the handle they might type, and the bio. */
export function matchVoices(voices, q) {
  if (!q) return [];
  return (voices || []).filter(
    (v) => v && (hit(v.displayName, q) || hit(v.username, q) || hit(v.register, q) || hit(v.bio, q))
  );
}

/** Books match on title, the author as credited on the book, and the shelf it sits on. */
export function matchBooks(books, q) {
  if (!q) return [];
  return (books || []).filter(
    (b) => b && (hit(b.title, q) || hit(b.authorName, q) || hit(b.author, q) || hit(b.genre, q))
  );
}

// ── PICKING THE MATCH OUT IN GOLD ────────────────────────────────────────────────────────
//
// Returns [{ text, hit }] rather than an HTML string. The old surface built
// `<mark>` markup and handed it to dangerouslySetInnerHTML, which put every story title and
// author name — and the reader's own query — through an innerHTML sink for a purely visual
// effect. This renders as <span>s instead: same look, no sink, and the function is testable
// without a DOM.
export function highlightParts(text, rawQuery) {
  const src = String(text == null ? '' : text);
  const q = normalizeQuery(rawQuery);
  if (!q || !src) return [{ text: src, hit: false }];
  const parts = [];
  const hay = src.toLowerCase();
  let i = 0;
  for (;;) {
    const at = hay.indexOf(q, i);
    if (at === -1) break;
    if (at > i) parts.push({ text: src.slice(i, at), hit: false });
    parts.push({ text: src.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  if (i < src.length) parts.push({ text: src.slice(i), hit: false });
  return parts.length ? parts : [{ text: src, hit: false }];
}

// ── HOW MANY ROWS A GROUP ACTUALLY PAINTS ───────────────────────────────────────────────
//
// ⚠ MEASURED, NOT GUESSED. A one-character query is not a search — it is a keystroke on the
// way to one — but the corpus does not know that, and "e" matches 191 stories and 125 people.
// Rendered in full that is 10,063 DOM nodes on a phone, against the 5,434 views the app's
// Square mounts at once and which this round was told not to repeat.
//
// A list would be the other answer, and it is the wrong one here. The result groups are
// short in every real query (42 for "drama", the largest subject on the shelf), so a
// virtualised list would carry its machinery on every search to save nothing on almost all
// of them, and it would break the one thing this screen is for — a page you can read down.
//
// So the groups are CAPPED and the cap is stated. The kicker already prints the true total,
// so nothing is hidden: a reader sees "STORIES 191", the first 50, and a line saying how many
// more there are. That is how an index behaves — it tells you the extent and shows you the
// beginning.
//
// ⭑ 50 IS NOT A ROUND NUMBER, IT IS A MEASURED ONE. The largest genuine group any query can
// return is the biggest subject on the shelf — Drama, at 42 — so the cap sits just above it
// and NO REAL SEARCH IS EVER TRUNCATED. A cap of 40 was tried first and it clipped "drama"
// with a "2 more" line, which is the worst of both: it interrupts the one query most likely
// to be typed and saves nothing worth saving. If Drama passes 50, raise this — the number
// exists to sit above the shelf's largest shelf, not to be preserved.
export const GROUP_CAP = 50;

/** The rows a group paints, and how many it is holding back. Never hides the true count. */
export function capGroup(rows) {
  const list = rows || [];
  return { shown: list.slice(0, GROUP_CAP), hidden: Math.max(0, list.length - GROUP_CAP) };
}

// ── OLDSTYLE FIGURES ─────────────────────────────────────────────────────────────────────
//
// Every count on this screen sets in oldstyle. Lining numerals stand at cap height and shout
// next to lowercase text; oldstyle figures have ascenders and descenders and sit IN the line,
// which is how an index sets a number. Cormorant Garamond carries them, so it is one CSS
// property and it is most of the difference between typeset and merely styled.
//
// ⚠ font-variant-numeric needs the font actually loaded — a fallback to Georgia silently
// renders lining. The class also carries font-feature-settings 'onum' for engines that honour
// only the low-level property.
export const OLDSTYLE_CLASS = 'cs-onum';
