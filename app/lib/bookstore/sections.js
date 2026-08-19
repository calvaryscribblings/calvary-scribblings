// THE CURATION SYSTEM — a section is a CLAIM, and an unmade claim is silence.
//
// Ikenna's ruling, 18 Aug 2026, taking Masobe's featured shelves as the inspiration and
// nothing else from them: the merchandising, translated into this shop's grammar, never its
// chrome. No badges. No chips. Nothing that sounds like an algorithm.
//
// ═════════════════════════════════════════════════════════════════════════════════════════
// THE CONSTITUTIONAL RULE, WHICH THE WINDOW ALREADY OBEYED AND WHICH NOW GOVERNS EVERY
// SECTION
// ═════════════════════════════════════════════════════════════════════════════════════════
//
//   A SECTION IS A CURATOR'S CLAIM. There are no fallbacks, no algorithmic filling of an
//   unclaimed slot, and no empty states. A section that is unclaimed, or whose claim no
//   longer resolves to anything publishable, DOES NOT RENDER AT ALL.
//
// The Window is the template, not the exception. `{windowTitle && <TheWindow …/>}` in
// app/bookstore/page.js was the whole rule expressed in one line: no featured title, no
// display case — never a case with a substitute book in it. resolveSections() below is that
// line generalised, and the generalisation is the point of this file. Every "hide it" branch
// in here is the same decision the Window has been making since R4b.
//
// WHY IT MATTERS MORE AS THE SHOP GROWS. A recommendation engine's failure mode is to say
// something anyway; a curator's is to say nothing. With four published titles, an
// EDITORS_CHOICE section that quietly back-filled with whatever was left would be
// recommending the entire shop to itself — "when everything is stocked, nothing is
// recommended", which is the sentence already printed in the curation band at the foot of
// the page. The system must be able to render nothing, forever, without anybody noticing a
// hole. That is why nothing here has a default.
//
// ═════════════════════════════════════════════════════════════════════════════════════════
// THE NODE
// ═════════════════════════════════════════════════════════════════════════════════════════
//
//   bookstore_sections/{sectionId}
//     schemaVersion : integer
//     type          : one of SECTION_TYPES below
//     displayTitle  : string          the head, as the curator wrote it
//     order         : integer         RENDER ORDER IS CMS ORDER. Ascending.
//     status        : 'live' | 'retired'
//     slugs         : array<string>   THE CLAIM. Ordered as the curator ordered it.
//     curatorLine   : string|null     optional; the curator's own sentence
//     monthKey      : 'YYYY-MM'|null  BOOK_OF_THE_MONTH only — the month the claim is FOR
//     ranked        : boolean         TOP_OF_THE_SHELF only
//     addedAt       : integer
//     updatedAt     : integer
//
// `slugs` and not title ids: bookstore_titles is keyed by slug already (the key and the
// `slug` field are the same string on every one of the five records on file), the storefront
// filters and links by slug, and the app's port reads slugs. An id here would be a second
// name for a thing that already has one.
//
// ═════════════════════════════════════════════════════════════════════════════════════════
// THE DATED CLAIM, AND WHY ITS GATE IS NOT THE SERIES GATE
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// BOOK_OF_THE_MONTH carries the month it is FOR, and hides itself when that month ends
// without renewal. app/lib/series/schema.js argues at length that a release date must be
// epoch milliseconds compared against the RTDB server clock, because a rules expression
// cannot parse a date and because a device with a wrong clock must not be able to bring a
// release forward.
//
// NEITHER REASON APPLIES HERE, and copying the pattern anyway would be cargo cult:
//
//   · There is nothing behind this gate. A stale Book of the Month does not leak an
//     unreleased file, a title, or a schedule — every book it can name is already published
//     and already on the shelves below. The gate is EDITORIAL HYGIENE: a shop still calling
//     something "Book of the Month · July" in September looks abandoned. A reader whose
//     clock is a day out sees a claim expire a day late, and that is the whole exposure.
//   · monthKey has to be legible to the curator who typed it and printable as "August 2026",
//     which a millisecond integer is not. It is an identity AND a display value.
//
// So: 'YYYY-MM' stored, parsed strictly (monthBoundsUTC), compared as NUMBERS against a
// `now` the caller passes in. The comparison is never a string comparison — that is the one
// half of the series lesson that does transfer, and it is the mistake this codebase has
// shipped twice.
//
// UTC, not local. The alternative is a claim that expires at a different instant for a
// reader in Lagos and a reader in London, and there is no version of "whose midnight" that
// is worth defending. The month is named, not timed.
//
// ═════════════════════════════════════════════════════════════════════════════════════════
// THE OBI AND THE SECTION CANNOT DISAGREE
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Before R13 the "Editor's Choice" band on a book's cover came from `title.featured`
// (fields.js obiLabel), and so did the Window (`titles.find(t => t.featured)`). One boolean,
// two meanings, and no way to put a book in the window without also banding it or to band a
// book without also putting it in the window.
//
// THE SECTION IS NOW THE SOURCE, IN ONE DIRECTION ONLY: a title claimed by a live
// EDITORS_CHOICE section wears the band; nothing else grants it. bandsFor() below derives
// the map, page.js stamps it onto the title objects as `band`, and obiLabel() reads that
// field instead of `featured`. There is no second input, so there is nothing to disagree.
//
// `featured` is NOT deleted — it is schema-required (TITLE_SCHEMA v2) and indexed
// (database.rules.json .indexOn) — but after the migration NOTHING RENDERS FROM IT. It
// survives as the migration's input and as the record of what the shop used to think.
// tests/bookstore/sections.test.mjs asserts that no rendering path reads it.

import { GENRE_SEED } from './genres.js';

export const SECTION_SCHEMA_VERSION = 1;
export const SECTIONS_PATH = 'bookstore_sections';
export const SIGNALS_PATH = 'bookstore_signals';

export const SECTION_STATUSES = ['live', 'retired'];

export const TYPE_WINDOW = 'window';
export const TYPE_EDITORS_CHOICE = 'editors-choice';
export const TYPE_BOOK_OF_THE_MONTH = 'book-of-the-month';
export const TYPE_TOP_OF_THE_SHELF = 'top-of-the-shelf';
export const TYPE_READERS_CHOICE = 'readers-choice';
export const TYPE_POPULAR_IN_NOTES = 'popular-in-notes';

/**
 * ═══ THE TYPE TABLE ═══════════════════════════════════════════════════════════════════
 *
 * Everything that varies BY TYPE lives here and nowhere else, so adding a seventh section
 * type is a row in this table plus, at most, a branch in the renderer's geometry. The
 * grammar does not vary: every section is a fleuron-flanked gold small-caps head over
 * either a case (one book) or a shelf (several).
 *
 *   min/max      how many titles the claim may name. A claim that resolves below `min` is
 *                not a small section, it is a broken one, and it does not render.
 *   dated        the claim carries a month and expires with it
 *   rankable     the curator may choose to number the claim
 *   dataDriven   the claim is NOT the curator's — see THE DORMANT PAIR below
 *   defaultTitle what the CMS offers as the head, which the curator may overwrite. It is a
 *                default for a FORM FIELD, not a render-time fallback; a section with no
 *                displayTitle fails validation and never reaches a screen.
 */
export const SECTION_TYPES = {
  [TYPE_WINDOW]: {
    key: TYPE_WINDOW,
    label: 'The Window',
    defaultTitle: 'In the Window',
    min: 1, max: 1,
    dated: false, rankable: false, dataDriven: false,
    // The Window is drawn by app/bookstore/page.js's TheWindow, untouched by R13 — same
    // component, same classes, same markup, same plate reading "In the Window". Folding it
    // into the system changed WHETHER it is called, never what it draws.
    renders: 'window',
    note: 'The display case. One book. The oldest claim in the shop.',
  },
  [TYPE_EDITORS_CHOICE]: {
    key: TYPE_EDITORS_CHOICE,
    label: "Editor's Choice",
    defaultTitle: "Editor’s Choice",
    min: 1, max: 6,
    dated: false, rankable: false, dataDriven: false,
    renders: 'auto',            // one → case, several → shelf
    // THE BAND. This is the only type that grants an obi, and it grants it to every title
    // it claims. See "THE OBI AND THE SECTION CANNOT DISAGREE" above.
    band: 'Editor’s Choice',
    note: 'One or a few titles. A claimed book wears the band.',
  },
  [TYPE_BOOK_OF_THE_MONTH]: {
    key: TYPE_BOOK_OF_THE_MONTH,
    label: 'Book of the Month',
    defaultTitle: 'Book of the Month',
    min: 1, max: 1,
    dated: true, rankable: false, dataDriven: false,
    renders: 'case',
    note: 'Exactly one title, and the month it is for. It hides itself when the month ends.',
  },
  [TYPE_TOP_OF_THE_SHELF]: {
    key: TYPE_TOP_OF_THE_SHELF,
    label: 'Top of the Shelf',
    defaultTitle: 'Top of the Shelf',
    min: 2, max: 10,
    dated: false, rankable: true, dataDriven: false,
    renders: 'shelf',
    note: 'A small set, the curator’s order. Ranked or unranked, per the entry.',
  },
  [TYPE_READERS_CHOICE]: {
    key: TYPE_READERS_CHOICE,
    label: "Readers' Choice",
    defaultTitle: "Readers’ Choice",
    min: 2, max: 10,
    dated: false, rankable: false, dataDriven: true,
    renders: 'shelf',
    note: 'Derived from real reading. Dormant until there is real reading to derive it from.',
  },
  [TYPE_POPULAR_IN_NOTES]: {
    key: TYPE_POPULAR_IN_NOTES,
    label: 'Popular in Notes',
    defaultTitle: 'Popular in Notes',
    min: 2, max: 10,
    dated: false, rankable: false, dataDriven: true,
    renders: 'shelf',
    note: 'Reserved for Reader Notes. The slot and its contract only — Notes itself is held back.',
  },
};

export const SECTION_TYPE_KEYS = Object.keys(SECTION_TYPES);

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE DORMANT PAIR — a contract, a switch, and nothing to switch on yet
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Same shape as the four flags this platform already runs on — MEMBERSHIPS_ON_SALE,
// BOOKSTORE_LAUNCHED, GATING_ENABLED and SERIES_TIER_GATE_ENABLED: real code, fully built,
// switched off until its day. Not live data edited to fake a state, which is the thing none
// of those flags is and the reason all four exist as constants.
//
// ── WHY THEY CANNOT SIMPLY READ THE READERS ──────────────────────────────────────────────
//
// The two signals a Readers' Choice would want are both PRIVATE BY RULE, and correctly so:
//
//   bookstore_purchases/{uid}/{titleId}          .read is the owner or a founder
//   bookstore_reading_progress/{uid}/{titleId}   .read is the owner, full stop
//
// A storefront is anonymous. It cannot aggregate either node, and it must not be able to —
// "which books this person has bought" and "how far they got" are the two most private facts
// the shop holds. So the contract is an AGGREGATE, written by a server that can read what
// the browser cannot, to a public node the browser may read and nothing else may write:
//
//   bookstore_signals/{signalKey}
//     computedAt : integer   epoch ms, when the aggregate was built
//     windowDays : integer   the trailing window it covers
//     entries    : [ { slug, ...counts } ]   ordered by the job, strongest first
//
// ── NEVER SIMULATED ──────────────────────────────────────────────────────────────────────
//
// There is no aggregator today, so there is no node, so both sections render nothing. That
// is the correct state and it is not a bug to be worked around. A seeded aggregate would be
// the shop telling readers what other readers love on the strength of a fixture, which is
// the one lie a curated shop cannot afford. requireRealSignal() below refuses an entries
// list that does not carry a computedAt, so a hand-written node fails the same way an empty
// one does.
//
// ── AND IKENNA'S SWITCH IS SEPARATE FROM THE DATA ────────────────────────────────────────
//
// Two conditions, both required: the flag below is true AND a real signal exists. Data
// arriving does not turn a section on by itself — a section appearing on the shop the day
// the aggregator first runs is a shop that published an editorial surface by accident.
export const READERS_CHOICE_ENABLED = false;
export const POPULAR_IN_NOTES_ENABLED = false;

/**
 * THE DATA CONTRACTS. Written down now, at full strength, because the value of defining a
 * dormant contract is entirely in defining it before the data exists to bend it.
 */
export const DATA_CONTRACTS = {
  [TYPE_READERS_CHOICE]: {
    signalKey: 'readers_choice',
    enabled: READERS_CHOICE_ENABLED,
    // The signals a reader genuinely emits by reading, and nothing that resembles a rating.
    //   completions  bookstore_reading_progress fraction crossing the ending threshold —
    //                the same event the ending ceremony already fires on
    //   libraryAdds  a bookstore_purchases row appearing for the title
    // Both are counts of PEOPLE, deduplicated by uid at aggregation time. A single reader
    // opening a book forty times is one reader.
    counts: ['completions', 'libraryAdds'],
    minEntries: 2,
    // A book nobody has finished is not a Readers' Choice, however many people bought it.
    // Stated as a floor on the aggregate rather than as a filter here, so the shop cannot be
    // made to disagree with the job about what qualified.
    note: 'Deduplicated by uid. Completions and library adds only. No ratings, ever.',
  },
  [TYPE_POPULAR_IN_NOTES]: {
    signalKey: 'popular_in_notes',
    enabled: POPULAR_IN_NOTES_ENABLED,
    // READER NOTES, as ruled: capsule notes at 25% read, full reviews at 80%, DNF at any
    // progress, NO STAR RATINGS, Reply-in-The-Square, and no standalone reviews index —
    // readers are followed, not books. Notes is wired to the ending ceremony as the
    // post-read destination.
    //
    // R13 BUILDS THE SLOT AND THIS CONTRACT. It builds no part of Notes itself.
    counts: ['capsuleNotes', 'fullReviews', 'dnfNotes', 'replies'],
    minEntries: 2,
    // ⚠ THE SECTION PRINTS NO NUMBER. The counts exist so the job can order the entries;
    // the shelf shows the books in that order and says nothing about how many notes any of
    // them has. "23 notes" is a chip wearing a serif, and the ruling was: nothing that
    // sounds like an algorithm.
    printsCounts: false,
    note: 'Ordering input only. No count reaches a screen. No rating field exists to reach one.',
  },
};

// ═════════════════════════════════════════════════════════════════════════════════════════
// VALIDATION — shape only, in the house style
// ═════════════════════════════════════════════════════════════════════════════════════════

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

export function validateSection(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { valid: false, errors: ['doc is not an object'] };

  if (!isInt(doc.schemaVersion) || doc.schemaVersion < 1) errors.push('schemaVersion must be a positive integer');

  const spec = SECTION_TYPES[doc.type];
  if (!spec) {
    errors.push(`type must be one of: ${SECTION_TYPE_KEYS.join(', ')}`);
    return { valid: false, errors };
  }

  if (!isStr(doc.displayTitle)) errors.push('displayTitle is required');
  else if (doc.displayTitle.length > 60) errors.push('displayTitle must be 60 characters or fewer');
  if (!isInt(doc.order) || doc.order < 0) errors.push('order must be a non-negative integer');
  if (!SECTION_STATUSES.includes(doc.status)) errors.push(`status must be one of: ${SECTION_STATUSES.join(', ')}`);

  // THE CLAIM. A curator-claimed section stores its slugs; a data-driven one must NOT — a
  // hand-written list on a data-driven type is exactly the simulation the ruling forbids,
  // and it is refused at the writer rather than ignored at the reader.
  if (spec.dataDriven) {
    if (Array.isArray(doc.slugs) && doc.slugs.length > 0) {
      errors.push(`${doc.type} is data-driven: its titles come from bookstore_signals, and slugs must not be set by hand`);
    }
  } else if (!Array.isArray(doc.slugs)) {
    errors.push('slugs must be an array');
  } else {
    if (doc.slugs.some((sg) => !isStr(sg) || !SLUG_RE.test(sg))) errors.push('slugs entries must be kebab-case title slugs');
    if (new Set(doc.slugs).size !== doc.slugs.length) errors.push('slugs must not repeat a title');
    if (doc.slugs.length > spec.max) errors.push(`${doc.type} claims at most ${spec.max} ${spec.max === 1 ? 'title' : 'titles'}`);
    // A claim SHORTER than min is allowed to be SAVED — a curator building a Top of the
    // Shelf types one slug before the second — and simply does not render. Refusing the save
    // would make the CMS unusable; rendering it would break the rule. The panel says which.
  }

  if (doc.curatorLine !== undefined && doc.curatorLine !== null) {
    if (!isStr(doc.curatorLine)) errors.push('curatorLine must be a non-empty string or null');
    else if (doc.curatorLine.length > 200) errors.push('curatorLine must be 200 characters or fewer');
  }

  if (spec.dated) {
    if (!isStr(doc.monthKey) || !MONTH_RE.test(doc.monthKey)) errors.push(`${doc.type} requires monthKey as 'YYYY-MM'`);
  } else if (doc.monthKey !== undefined && doc.monthKey !== null) {
    errors.push(`${doc.type} does not carry a month`);
  }

  if (doc.ranked !== undefined && doc.ranked !== null) {
    if (typeof doc.ranked !== 'boolean') errors.push('ranked must be a boolean');
    else if (doc.ranked && !spec.rankable) errors.push(`${doc.type} cannot be ranked`);
  }

  if (!isInt(doc.addedAt) || doc.addedAt <= 0) errors.push('addedAt must be a positive millisecond timestamp');
  if (!isInt(doc.updatedAt) || doc.updatedAt <= 0) errors.push('updatedAt must be a positive millisecond timestamp');

  return { valid: errors.length === 0, errors };
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE MONTH
// ═════════════════════════════════════════════════════════════════════════════════════════

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * [startMs, endMs) for a 'YYYY-MM' in UTC, or null if the string is not one.
 * endMs is the first instant of the FOLLOWING month, so the comparison below is a half-open
 * interval and the last millisecond of the month is still inside the claim.
 */
export function monthBoundsUTC(monthKey) {
  const m = MONTH_RE.exec(String(monthKey || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { startMs: Date.UTC(y, mo, 1), endMs: Date.UTC(y, mo + 1, 1) };
}

/** 'Book of the Month' renders the month BY NAME. '2026-08' → 'August 2026'. */
export function monthLabel(monthKey) {
  const m = MONTH_RE.exec(String(monthKey || ''));
  if (!m) return null;
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * Has the claim's month ended? A malformed month is treated as EXPIRED, not as evergreen:
 * failing closed on an unparseable date is the direction that cannot leave a wrong claim on
 * the shop forever.
 */
export function monthExpired(monthKey, now) {
  const b = monthBoundsUTC(monthKey);
  if (!b) return true;
  return Number(now) >= b.endMs;
}

/** Has it started? A curator setting next month's claim early should not publish it early. */
export function monthPending(monthKey, now) {
  const b = monthBoundsUTC(monthKey);
  if (!b) return false;
  return Number(now) < b.startMs;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE SIGNAL — the dormant pair's only door
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * A signal is real or it is absent. `computedAt` is what makes it real: a job that ran wrote
 * when it ran. A hand-authored `entries` list with no computedAt is refused here, which is
 * the mechanical half of "never simulate it" — the ruling is enforced, not merely written
 * down.
 */
export function requireRealSignal(signal) {
  if (!signal || typeof signal !== 'object' || Array.isArray(signal)) return null;
  if (!isInt(signal.computedAt) || signal.computedAt <= 0) return null;
  if (!Array.isArray(signal.entries) || signal.entries.length === 0) return null;
  const entries = signal.entries.filter((e) => e && isStr(e.slug));
  return entries.length ? { ...signal, entries } : null;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// RESOLUTION — the whole rule, once
// ═════════════════════════════════════════════════════════════════════════════════════════

/**
 * Turn stored sections into the list the shop renders.
 *
 * @param sections  raw records from bookstore_sections
 * @param titles    the PUBLISHED catalogue, already publisher-filtered by the loader
 * @param opts.now       epoch ms, for the dated gate. Required for a dated section to survive.
 * @param opts.signals   { [signalKey]: rawSignal } — absent by default, which is today's truth
 *
 * Returns only sections that render. Every drop is silent by design: there is no "empty
 * state", so there is nothing for a reader to see and nothing for the caller to decide.
 */
export function resolveSections(sections, titles, opts = {}) {
  const now = Number(opts.now);
  const signals = opts.signals || {};
  const bySlug = new Map((titles || []).map((t) => [t.slug, t]));

  const out = [];
  for (const raw of sections || []) {
    const spec = SECTION_TYPES[raw?.type];
    if (!spec) continue;                                   // unknown type — never guess
    if (raw.status !== 'live') continue;                   // retired is retired
    if (!isStr(raw.displayTitle)) continue;                // a head is not optional

    let claimed;
    if (spec.dataDriven) {
      const contract = DATA_CONTRACTS[spec.key];
      // BOTH conditions. See "AND IKENNA'S SWITCH IS SEPARATE FROM THE DATA".
      if (!contract || !contract.enabled) continue;
      const signal = requireRealSignal(signals[contract.signalKey]);
      if (!signal) continue;
      claimed = signal.entries.map((e) => e.slug);
      if (claimed.length < contract.minEntries) continue;
    } else {
      claimed = Array.isArray(raw.slugs) ? raw.slugs : [];
    }

    if (spec.dated) {
      if (!Number.isFinite(now)) continue;                 // no clock, no dated claim
      if (monthExpired(raw.monthKey, now)) continue;       // THE MONTH ENDED — it hides itself
      if (monthPending(raw.monthKey, now)) continue;       // and it does not appear early
    }

    // The claim resolved against what is actually publishable RIGHT NOW. A title the curator
    // claimed and then unpublished simply leaves the section; it does not leave a gap, and
    // nothing is drafted in to replace it.
    const resolved = claimed.map((sg) => bySlug.get(sg)).filter(Boolean).slice(0, spec.max);
    if (resolved.length < spec.min) continue;              // ⛔ the rule. Below min, nothing renders.

    out.push({
      id: raw.id,
      type: spec.key,
      spec,
      displayTitle: raw.displayTitle,
      curatorLine: isStr(raw.curatorLine) ? raw.curatorLine : null,
      monthKey: spec.dated ? raw.monthKey : null,
      monthLabel: spec.dated ? monthLabel(raw.monthKey) : null,
      ranked: !!(spec.rankable && raw.ranked),
      order: isInt(raw.order) ? raw.order : 0,
      titles: resolved,
      // 'window' | 'case' | 'shelf' — the geometry adapts, the grammar does not.
      layout: spec.renders === 'auto' ? (resolved.length === 1 ? 'case' : 'shelf') : spec.renders,
    });
  }

  // RENDER ORDER IS CMS ORDER. The tiebreak is the id, so two sections sharing an order still
  // sort the same way on every device rather than in whatever order RTDB handed them over.
  return out.sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)));
}

/**
 * WHEN DOES THE NEXT DATED CLAIM STOP BEING TRUE?
 *
 * The smallest month-end still in the future among the live dated sections, or null if none.
 *
 * The storefront arms ONE timeout at this instant, so a Book of the Month left open across
 * the turn of the month stops claiming without the shop polling a clock. The alternative —
 * re-reading Date.now() every render — is impure and React now refuses it outright
 * (react-hooks/purity), and the alternative to THAT, an interval, would re-render the whole
 * shop every minute to catch an event that happens twelve times a year.
 *
 * `now` is passed in rather than read, for the same reason every other function in this file
 * takes it: a module that reads the clock cannot be tested against a month boundary.
 */
export function nextExpiryMs(sections, now) {
  let soonest = null;
  for (const raw of sections || []) {
    const spec = SECTION_TYPES[raw?.type];
    if (!spec?.dated || raw.status !== 'live') continue;
    const b = monthBoundsUTC(raw.monthKey);
    if (!b) continue;
    // Both edges matter: a claim set for NEXT month is pending now and becomes true at its
    // start, exactly as a current one becomes false at its end.
    for (const edge of [b.startMs, b.endMs]) {
      if (edge > now && (soonest === null || edge < soonest)) soonest = edge;
    }
  }
  return soonest;
}

/**
 * slug → band label, from the RESOLVED sections. Only EDITORS_CHOICE grants one today (the
 * `band` key in the type table is the whole list of grantors), and a book can only be wearing
 * a band that a live, rendering section put on it.
 */
export function bandsFor(resolved) {
  const bands = new Map();
  for (const sec of resolved || []) {
    if (!sec.spec?.band) continue;
    for (const t of sec.titles) if (!bands.has(t.slug)) bands.set(t.slug, sec.spec.band);
  }
  return bands;
}

/**
 * Stamp the band onto the title objects the whole page renders from, so the cover in the
 * curated section, the cover on the shelf below and the cover in Quick Look are all the same
 * object and cannot show three different bands.
 */
export function applyBands(titles, bands) {
  if (!bands || bands.size === 0) return titles || [];
  return (titles || []).map((t) => (bands.has(t.slug) ? { ...t, band: bands.get(t.slug) } : t));
}

/**
 * Re-point already-resolved sections at the banded title objects.
 *
 * The band is derived FROM the sections, so there is a one-step circularity: resolve, read
 * the bands off the result, stamp them onto the catalogue, and then the sections are holding
 * the unstamped objects. Resolving a second time would work and was the first draft; this
 * costs a map lookup per claimed slug instead, and — the reason it is not merely cheaper —
 * it CANNOT return a different set of sections from the first pass. A second resolve is a
 * second decision, and a second decision taken against a clock read a moment later can
 * disagree with the first at a month boundary.
 */
export function rebindSections(resolved, titles) {
  const bySlug = new Map((titles || []).map((t) => [t.slug, t]));
  return (resolved || []).map((sec) => ({
    ...sec,
    titles: sec.titles.map((t) => bySlug.get(t.slug) || t),
  }));
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE MIGRATION — one builder, three consumers
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// The Window's live claim has to survive this round unchanged, and three separate things have
// to produce the identical record for that to be true:
//
//   1. scripts/migrate-bookstore-taxonomy.mjs   — the migration proper, run with a key
//   2. /admin/bookstore → Sections → "Fold the Window in"  — the same migration, by hand
//   3. getSections()'s bootstrap                — the deploy-to-migration window
//
// (3) is the one worth explaining. A static export is live the instant Cloudflare finishes;
// the node is written by a human at some point afterwards. If the shop read an unwritten node
// as "no claims", the Window would go dark for that interval — which is precisely the
// regression this round is required not to cause. So when bookstore_sections has never been
// written, the loader returns THIS FUNCTION'S OUTPUT rather than an empty list.
//
// ⚠ THAT IS A BOOTSTRAP, NOT A FALLBACK, and the distinction is load-bearing:
//   · It is keyed on the node being ABSENT ENTIRELY, never on a section being unclaimed. One
//     saved record — any record, of any type — retires it permanently.
//   · It produces the migration's own output, from the same builder, so it cannot drift into
//     being a second opinion about what the Window is.
//   · It fills nothing. If no title carries `featured`, it returns [] and the shop renders no
//     Window, which is exactly what today's `{windowTitle && …}` does.
//
// DELETE IT once the migration has run in production: remove the bootstrap branch in
// loader.getSections() and this function's third consumer. Keep the builder — (1) and (2)
// still need it.
export function buildWindowMigration(titles, nowMs) {
  const featured = (titles || []).find((t) => t.featured && t.status === 'published');
  if (!featured) return [];
  const at = isInt(nowMs) && nowMs > 0 ? nowMs : 1;
  return [{
    id: 'window',
    schemaVersion: SECTION_SCHEMA_VERSION,
    type: TYPE_WINDOW,
    // Verbatim what .window-plate has printed since R4b. The plate is drawn by TheWindow and
    // does not read this field, so the two cannot disagree on screen — but an editor opening
    // the panel must see the head the shop shows, not a different name for it.
    displayTitle: 'In the Window',
    order: 0,
    status: 'live',
    slugs: [featured.slug],
    curatorLine: null,
    ranked: false,
    addedAt: at,
    updatedAt: at,
  }];
}

/** The genre taxonomy's half of the same migration. See app/lib/bookstore/genres.js. */
export function buildGenreMigration(nowMs) {
  const at = isInt(nowMs) && nowMs > 0 ? nowMs : 1;
  return GENRE_SEED.map((g) => ({
    ...g,
    schemaVersion: 1,
    addedAt: at,
    updatedAt: at,
  }));
}
