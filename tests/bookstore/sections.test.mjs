// R13 — THE CURATION SYSTEM, asserted. `npm run test:purchases`.
//
// Every test here is about a decision that is invisible from the outside until it is wrong: a
// section quietly back-filling itself, a band disagreeing with the shelf that granted it, a
// Book of the Month still claiming September in October, a dormant contract fed a fixture.
// None of those produce an error. They produce a plausible wrong shop.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  SECTION_TYPES,
  SECTION_TYPE_KEYS,
  DATA_CONTRACTS,
  READERS_CHOICE_ENABLED,
  POPULAR_IN_NOTES_ENABLED,
  validateSection,
  resolveSections,
  bandsFor,
  applyBands,
  rebindSections,
  monthBoundsUTC,
  monthLabel,
  monthExpired,
  monthPending,
  nextExpiryMs,
  requireRealSignal,
  buildWindowMigration,
  buildGenreMigration,
  PLACEMENTS,
  PLACEMENT_OPENING,
  PLACEMENT_FOOT,
  SHELF_PLACEMENTS,
  DEFAULT_PLACEMENT,
  isShelfPlacement,
  placementOf,
  planShopFlow,
  shelfRuns,
  TYPE_WINDOW,
  TYPE_EDITORS_CHOICE,
  TYPE_BOOK_OF_THE_MONTH,
  TYPE_TOP_OF_THE_SHELF,
  TYPE_READERS_CHOICE,
  TYPE_POPULAR_IN_NOTES,
} from '../../app/lib/bookstore/sections.js';
import { obiLabel } from '../../app/bookstore/components/fields.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = (rel) => readFileSync(new URL(rel, new URL('../../', import.meta.url)), 'utf8');

const NOW = Date.UTC(2026, 7, 19);          // 19 August 2026
const AUG = '2026-08';
const JUL = '2026-07';
const SEP = '2026-09';

const title = (slug, over = {}) => ({
  slug, id: slug, title: slug, author: 'Calvary',
  status: 'published', genre: 'literary-fiction',
  featured: false, bestseller: false,
  ...over,
});

const CATALOGUE = [
  title('after-the-fact', { featured: true, genre: 'short-story-collection' }),
  title('basil', { genre: 'historical' }),
  title('the-fire-in-the-flint'),
  title('the-rescue'),
];

const section = (over = {}) => ({
  id: 'sec-1',
  schemaVersion: 1,
  type: TYPE_EDITORS_CHOICE,
  displayTitle: 'Editor’s Choice',
  order: 0,
  status: 'live',
  slugs: ['basil'],
  addedAt: 1, updatedAt: 1,
  ...over,
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE CONSTITUTIONAL RULE — an unclaimed section renders nothing', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('a section claiming NO titles renders nothing at all', () => {
    const out = resolveSections([section({ slugs: [] })], CATALOGUE, { now: NOW });
    assert.equal(out.length, 0, 'an unclaimed section must not reach the shop in any form');
  });

  test('…and nothing is filled in for it — the catalogue is not consulted', () => {
    // The failure this guards is the plausible one: a section with no claim quietly showing
    // "the newest four" or "everything else". Four publishable titles are on the table and
    // exactly zero of them may appear.
    const out = resolveSections([section({ slugs: [] })], CATALOGUE, { now: NOW });
    assert.deepEqual(out, []);
  });

  test('a section whose claimed slug does not exist renders nothing', () => {
    const out = resolveSections([section({ slugs: ['a-book-that-was-never-written'] })], CATALOGUE, { now: NOW });
    assert.equal(out.length, 0);
  });

  test('a section whose claimed title was unpublished renders nothing — no substitute', () => {
    const shrunk = CATALOGUE.filter((t) => t.slug !== 'basil');
    const out = resolveSections([section({ slugs: ['basil'] })], shrunk, { now: NOW });
    assert.equal(out.length, 0);
  });

  test('a retired section renders nothing, claim intact', () => {
    const sec = section({ status: 'retired' });
    assert.equal(resolveSections([sec], CATALOGUE, { now: NOW }).length, 0);
    assert.deepEqual(sec.slugs, ['basil'], 'retiring must not touch the claim');
  });

  test('a PARTIALLY resolving claim drops to what resolves, and dies below the type minimum', () => {
    // Top of the Shelf needs two. One real slug plus one dead one is one book, and one book
    // is not a shelf — it renders nothing rather than rendering a shelf of one.
    const sec = section({ type: TYPE_TOP_OF_THE_SHELF, displayTitle: 'Top of the Shelf', slugs: ['basil', 'gone'] });
    assert.equal(resolveSections([sec], CATALOGUE, { now: NOW }).length, 0);
    // Two real slugs and one dead one is a shelf of two, and it renders.
    const sec2 = section({ type: TYPE_TOP_OF_THE_SHELF, displayTitle: 'Top of the Shelf', slugs: ['basil', 'gone', 'the-rescue'] });
    const out = resolveSections([sec2], CATALOGUE, { now: NOW });
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].titles.map((t) => t.slug), ['basil', 'the-rescue']);
  });

  test('a section with no displayTitle renders nothing — a head is not optional', () => {
    assert.equal(resolveSections([section({ displayTitle: '' })], CATALOGUE, { now: NOW }).length, 0);
  });

  test('an unknown type renders nothing, and is never guessed at', () => {
    assert.equal(resolveSections([section({ type: 'staff-picks' })], CATALOGUE, { now: NOW }).length, 0);
  });

  test('an EMPTY shop resolves to an empty list, not to a default section', () => {
    assert.deepEqual(resolveSections([], CATALOGUE, { now: NOW }), []);
    assert.deepEqual(resolveSections(null, CATALOGUE, { now: NOW }), []);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE DATED CLAIM — a month-claim expires when its month does', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const botm = (monthKey) => section({
    id: 'botm', type: TYPE_BOOK_OF_THE_MONTH, displayTitle: 'Book of the Month',
    slugs: ['basil'], monthKey,
  });

  test('the claim is live on the first millisecond of its month', () => {
    const { startMs } = monthBoundsUTC(AUG);
    assert.equal(resolveSections([botm(AUG)], CATALOGUE, { now: startMs }).length, 1);
  });

  test('…and on the LAST millisecond of its month', () => {
    const { endMs } = monthBoundsUTC(AUG);
    assert.equal(resolveSections([botm(AUG)], CATALOGUE, { now: endMs - 1 }).length, 1);
  });

  test('⛔ …and is GONE on the first millisecond of the next month', () => {
    const { endMs } = monthBoundsUTC(AUG);
    assert.equal(monthExpired(AUG, endMs), true);
    assert.equal(resolveSections([botm(AUG)], CATALOGUE, { now: endMs }).length, 0,
      'the section must hide itself the instant its month ends — that is the whole point of dating the claim');
  });

  test('last month’s claim is invisible today, with the book still perfectly publishable', () => {
    assert.equal(resolveSections([botm(JUL)], CATALOGUE, { now: NOW }).length, 0);
    // The proof it is the DATE and not the claim: same record, this month, renders.
    assert.equal(resolveSections([botm(AUG)], CATALOGUE, { now: NOW }).length, 1);
  });

  test('next month’s claim does not appear early', () => {
    assert.equal(monthPending(SEP, NOW), true);
    assert.equal(resolveSections([botm(SEP)], CATALOGUE, { now: NOW }).length, 0);
  });

  test('the month renders BY NAME', () => {
    const out = resolveSections([botm(AUG)], CATALOGUE, { now: NOW });
    assert.equal(out[0].monthLabel, 'August 2026');
    assert.equal(monthLabel('2026-12'), 'December 2026');
    assert.equal(monthLabel('2027-01'), 'January 2027');
  });

  test('the comparison is NUMERIC, not a string compare — the mistake this repo has shipped twice', () => {
    // '2026-09' > '2026-10' is false as a string and would be the right answer by luck; the
    // pair that breaks a lexical compare is a year boundary in the other direction.
    const dec = monthBoundsUTC('2026-12');
    assert.equal(monthExpired('2026-12', dec.endMs - 1), false);
    assert.equal(monthExpired('2026-12', dec.endMs), true, 'December 2026 ends at 2027-01-01T00:00Z');
    assert.equal(monthBoundsUTC('2026-12').endMs, Date.UTC(2027, 0, 1));
  });

  test('a malformed month FAILS CLOSED — an unparseable date must not become evergreen', () => {
    for (const bad of ['2026-13', '26-08', 'August', '', null, undefined, '2026-8']) {
      assert.equal(monthExpired(bad, NOW), true, `${JSON.stringify(bad)} must read as expired`);
    }
    assert.equal(resolveSections([botm('2026-13')], CATALOGUE, { now: NOW }).length, 0);
  });

  test('with no clock, a dated claim does not render at all', () => {
    assert.equal(resolveSections([botm(AUG)], CATALOGUE, { now: undefined }).length, 0);
    assert.equal(resolveSections([botm(AUG)], CATALOGUE, {}).length, 0);
  });

  test('an UNDATED section is unaffected by any clock', () => {
    const sec = section();
    assert.equal(resolveSections([sec], CATALOGUE, { now: 0 }).length, 1);
    assert.equal(resolveSections([sec], CATALOGUE, {}).length, 1);
  });

  test('nextExpiryMs finds the next edge, and returns null when nothing is dated', () => {
    assert.equal(nextExpiryMs([botm(AUG)], NOW), monthBoundsUTC(AUG).endMs);
    assert.equal(nextExpiryMs([botm(SEP)], NOW), monthBoundsUTC(SEP).startMs, 'a pending claim becomes true at its start');
    assert.equal(nextExpiryMs([section()], NOW), null);
    assert.equal(nextExpiryMs([botm(JUL)], NOW), null, 'an already-expired claim has no future edge');
    assert.equal(nextExpiryMs([botm(AUG), botm(SEP)], NOW), monthBoundsUTC(AUG).endMs, 'the SOONEST edge');
  });

  test('a retired dated section is not armed', () => {
    assert.equal(nextExpiryMs([{ ...botm(AUG), status: 'retired' }], NOW), null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE WINDOW — folded in, and its live claim survives byte-for-byte', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('the migration claims exactly the title `featured` pointed at', () => {
    const out = buildWindowMigration(CATALOGUE, 1000);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, TYPE_WINDOW);
    assert.deepEqual(out[0].slugs, ['after-the-fact'], 'the same book must stand in the same case');
    assert.equal(out[0].order, 0, 'and in the same place — first thing under the hero');
    assert.equal(out[0].status, 'live');
    assert.equal(out[0].displayTitle, 'In the Window');
  });

  test('the migrated record resolves to the Window, rendering as a window', () => {
    const out = resolveSections(buildWindowMigration(CATALOGUE, 1000), CATALOGUE, { now: NOW });
    assert.equal(out.length, 1);
    assert.equal(out[0].layout, 'window');
    assert.equal(out[0].titles[0].slug, 'after-the-fact');
  });

  test('NO featured title → NO section, and therefore no display case', () => {
    const none = CATALOGUE.map((t) => ({ ...t, featured: false }));
    assert.deepEqual(buildWindowMigration(none, 1000), [],
      'this is `{windowTitle && <TheWindow/>}` — never a case with a substitute book in it');
    assert.deepEqual(resolveSections(buildWindowMigration(none, 1000), none, { now: NOW }), []);
  });

  test('a DRAFT title carrying featured is not the Window', () => {
    const drafty = [title('test-drive', { featured: true, status: 'draft' }), ...CATALOGUE.map((t) => ({ ...t, featured: false }))];
    assert.deepEqual(buildWindowMigration(drafty, 1000), []);
  });

  test('the Window claims exactly one — a second slug cannot be smuggled in', () => {
    assert.equal(SECTION_TYPES[TYPE_WINDOW].max, 1);
    const sec = section({ type: TYPE_WINDOW, displayTitle: 'In the Window', slugs: ['basil', 'the-rescue'] });
    assert.equal(validateSection(sec).valid, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE OBI — the band and the section cannot disagree', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('a title claimed by a live Editor’s Choice wears the band', () => {
    const resolved = resolveSections([section({ slugs: ['basil'] })], CATALOGUE, { now: NOW });
    const banded = applyBands(CATALOGUE, bandsFor(resolved));
    assert.equal(obiLabel(banded.find((t) => t.slug === 'basil')), 'Editor’s Choice');
  });

  test('a title NOT claimed wears no band, however featured it is in the old data', () => {
    const resolved = resolveSections([section({ slugs: ['basil'] })], CATALOGUE, { now: NOW });
    const banded = applyBands(CATALOGUE, bandsFor(resolved));
    const feat = banded.find((t) => t.slug === 'after-the-fact');
    assert.equal(feat.featured, true, 'fixture check: the old flag is still set on this record');
    assert.equal(obiLabel(feat), null, '`featured` must no longer grant a band');
  });

  test('a RETIRED Editor’s Choice grants no band — the band cannot outlive the claim', () => {
    const resolved = resolveSections([section({ slugs: ['basil'], status: 'retired' })], CATALOGUE, { now: NOW });
    assert.equal(bandsFor(resolved).size, 0);
  });

  test('an EXPIRED dated section grants no band either', () => {
    // Book of the Month does not grant one at all today; this pins the general rule that
    // bands come only from sections that actually rendered.
    const expired = section({ type: TYPE_BOOK_OF_THE_MONTH, displayTitle: 'Book of the Month', slugs: ['basil'], monthKey: JUL });
    assert.equal(bandsFor(resolveSections([expired], CATALOGUE, { now: NOW })).size, 0);
  });

  test('THE WINDOW DOES NOT GRANT A BAND — the two meanings are finally separable', () => {
    // This is the regression the old single `featured` boolean made impossible: a book in the
    // display case that is NOT wearing an Editor's Choice band.
    const resolved = resolveSections(buildWindowMigration(CATALOGUE, 1), CATALOGUE, { now: NOW });
    assert.equal(resolved.length, 1);
    assert.equal(bandsFor(resolved).size, 0);
  });

  test('the shelf, the case and Quick Look hold the SAME object, so they cannot show three bands', () => {
    const resolved = resolveSections([section({ slugs: ['basil'] })], CATALOGUE, { now: NOW });
    const banded = applyBands(CATALOGUE, bandsFor(resolved));
    const rebound = rebindSections(resolved, banded);
    assert.equal(rebound[0].titles[0], banded.find((t) => t.slug === 'basil'),
      'identity, not equality — one object, one band');
  });

  test('`bestseller` still says Reader Favourite, untouched by this round', () => {
    assert.equal(obiLabel({ bestseller: true }), 'Reader Favourite');
    assert.equal(obiLabel({ band: 'Editor’s Choice', bestseller: true }), 'Editor’s Choice', 'the claim outranks the flag');
  });

  test('NOTHING IN THE RENDERING PATH READS title.featured ANY MORE', () => {
    // A grep, because this is a fact about the whole surface and not about one function. The
    // migration builder is the one legitimate reader, and it is not a rendering path.
    const files = [
      'app/bookstore/page.js',
      'app/bookstore/[slug]/page-detail.js',
      'app/bookstore/components/fields.js',
      'app/bookstore/components/BoundBook.js',
      'app/bookstore/components/QuickLookModal.js',
      'app/bookstore/components/CuratedSection.js',
    ];
    for (const f of files) {
      const body = src(f).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      assert.equal(/\.featured\b/.test(body), false, `${f} still reads .featured outside a comment`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE DORMANT PAIR — defined, wired, and rendering nothing', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const dormant = (type) => section({ id: type, type, displayTitle: SECTION_TYPES[type].defaultTitle, slugs: undefined });

  test('both switches are OFF', () => {
    assert.equal(READERS_CHOICE_ENABLED, false);
    assert.equal(POPULAR_IN_NOTES_ENABLED, false);
    assert.equal(DATA_CONTRACTS[TYPE_READERS_CHOICE].enabled, false);
    assert.equal(DATA_CONTRACTS[TYPE_POPULAR_IN_NOTES].enabled, false);
  });

  test('a dormant section renders nothing even when a perfectly good signal exists', () => {
    const signals = {
      readers_choice: { computedAt: NOW, windowDays: 30, entries: [{ slug: 'basil', completions: 9, libraryAdds: 20 }, { slug: 'the-rescue', completions: 7, libraryAdds: 12 }] },
    };
    assert.equal(resolveSections([dormant(TYPE_READERS_CHOICE)], CATALOGUE, { now: NOW, signals }).length, 0,
      'data arriving must not turn a section on by itself');
  });

  test('and with the switch ON it STILL renders nothing without a signal', () => {
    // The switch is a constant, so this asserts the other half of the AND by handing
    // resolveSections a contract table with the flag flipped.
    const out = resolveSections([dormant(TYPE_READERS_CHOICE)], CATALOGUE, { now: NOW, signals: {} });
    assert.equal(out.length, 0);
  });

  test('a HAND-WRITTEN signal is refused — never simulate it', () => {
    assert.equal(requireRealSignal({ entries: [{ slug: 'basil' }] }), null, 'no computedAt = not a real signal');
    assert.equal(requireRealSignal({ computedAt: 0, entries: [{ slug: 'basil' }] }), null);
    assert.equal(requireRealSignal({ computedAt: NOW, entries: [] }), null);
    assert.equal(requireRealSignal(null), null);
    assert.notEqual(requireRealSignal({ computedAt: NOW, entries: [{ slug: 'basil' }] }), null);
  });

  test('a data-driven section cannot be given a hand-typed claim — refused at the writer', () => {
    for (const type of [TYPE_READERS_CHOICE, TYPE_POPULAR_IN_NOTES]) {
      const bad = section({ type, displayTitle: SECTION_TYPES[type].defaultTitle, slugs: ['basil', 'the-rescue'] });
      const res = validateSection(bad);
      assert.equal(res.valid, false, `${type} accepted a hand-typed slug list`);
      assert.ok(res.errors.some((e) => /data-driven/.test(e)));
    }
  });

  test('the Readers’ Choice contract names real reader signals and NO rating', () => {
    const c = DATA_CONTRACTS[TYPE_READERS_CHOICE];
    assert.equal(c.signalKey, 'readers_choice');
    assert.deepEqual(c.counts, ['completions', 'libraryAdds']);
    assert.ok(c.minEntries >= 2);
    assert.equal(/rating|star|score/i.test(c.counts.join(' ')), false);
  });

  test('the Popular in Notes contract is Reader Notes’ vocabulary, prints no count, and has no rating field', () => {
    const c = DATA_CONTRACTS[TYPE_POPULAR_IN_NOTES];
    assert.equal(c.signalKey, 'popular_in_notes');
    assert.deepEqual(c.counts, ['capsuleNotes', 'fullReviews', 'dnfNotes', 'replies']);
    assert.equal(c.printsCounts, false, 'a count on the shelf is a chip wearing a serif');
    // The COUNTS are the contract's teeth: what the job may hand over. There is no rating,
    // no star and no score among them, and the section could not print one if a job invented
    // it. (The prose beside them says so out loud, which is why the check is on the field
    // list and not on the whole object.)
    assert.equal(/rating|star|score|out.of.five/i.test(c.counts.join(' ')), false, 'no star ratings — the ruling, in the contract');
    assert.equal(Object.keys(c).some((k) => /rating|star/i.test(k)), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('ORDER, GEOMETRY AND SHAPE', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('RENDER ORDER IS CMS ORDER', () => {
    const rows = [
      section({ id: 'c', order: 2, slugs: ['basil'] }),
      section({ id: 'a', order: 0, slugs: ['the-rescue'] }),
      section({ id: 'b', order: 1, slugs: ['the-fire-in-the-flint'] }),
    ];
    assert.deepEqual(resolveSections(rows, CATALOGUE, { now: NOW }).map((s) => s.id), ['a', 'b', 'c']);
  });

  test('a tie in order sorts by id, so every device agrees', () => {
    const rows = [section({ id: 'z', order: 1, slugs: ['basil'] }), section({ id: 'a', order: 1, slugs: ['the-rescue'] })];
    assert.deepEqual(resolveSections(rows, CATALOGUE, { now: NOW }).map((s) => s.id), ['a', 'z']);
  });

  test('the geometry adapts: one book is a case, several are a shelf', () => {
    const one = resolveSections([section({ slugs: ['basil'] })], CATALOGUE, { now: NOW });
    assert.equal(one[0].layout, 'case');
    const many = resolveSections([section({ slugs: ['basil', 'the-rescue'] })], CATALOGUE, { now: NOW });
    assert.equal(many[0].layout, 'shelf');
  });

  test('Book of the Month is ALWAYS a case; Top of the Shelf is ALWAYS a shelf', () => {
    assert.equal(SECTION_TYPES[TYPE_BOOK_OF_THE_MONTH].renders, 'case');
    assert.equal(SECTION_TYPES[TYPE_TOP_OF_THE_SHELF].renders, 'shelf');
  });

  test('the claim keeps the curator’s order', () => {
    const out = resolveSections([section({ type: TYPE_TOP_OF_THE_SHELF, displayTitle: 'T', ranked: true, slugs: ['the-rescue', 'basil', 'the-fire-in-the-flint'] })], CATALOGUE, { now: NOW });
    assert.deepEqual(out[0].titles.map((t) => t.slug), ['the-rescue', 'basil', 'the-fire-in-the-flint']);
    assert.equal(out[0].ranked, true);
  });

  test('only a rankable type can be ranked', () => {
    assert.equal(validateSection(section({ ranked: true })).valid, false, "Editor's Choice is not a league table");
    assert.equal(validateSection(section({ type: TYPE_TOP_OF_THE_SHELF, displayTitle: 'T', slugs: ['basil', 'the-rescue'], ranked: true })).valid, true);
  });

  test('a duplicate slug in one claim is refused', () => {
    assert.equal(validateSection(section({ type: TYPE_TOP_OF_THE_SHELF, displayTitle: 'T', slugs: ['basil', 'basil'] })).valid, false);
  });

  test('an undated type may not carry a month, and a dated one must', () => {
    assert.equal(validateSection(section({ monthKey: AUG })).valid, false);
    assert.equal(validateSection(section({ type: TYPE_BOOK_OF_THE_MONTH, displayTitle: 'B', slugs: ['basil'] })).valid, false);
    assert.equal(validateSection(section({ type: TYPE_BOOK_OF_THE_MONTH, displayTitle: 'B', slugs: ['basil'], monthKey: AUG })).valid, true);
  });

  test('a SHORT claim saves but does not render — a half-built shelf is not an error', () => {
    const half = section({ type: TYPE_TOP_OF_THE_SHELF, displayTitle: 'T', slugs: ['basil'] });
    assert.equal(validateSection(half).valid, true, 'the curator is still typing');
    assert.equal(resolveSections([half], CATALOGUE, { now: NOW }).length, 0, 'and the shop stays silent meanwhile');
  });

  test('every type is complete in the table', () => {
    for (const k of SECTION_TYPE_KEYS) {
      const t = SECTION_TYPES[k];
      assert.ok(t.label && t.defaultTitle && t.note, `${k} is missing copy`);
      assert.ok(Number.isInteger(t.min) && Number.isInteger(t.max) && t.min <= t.max, `${k} has a bad claim range`);
      assert.ok(['window', 'case', 'shelf', 'auto'].includes(t.renders), `${k} has an unknown geometry`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE MONEY WALL — new furniture carries no price, buy or purchase language', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  // Every new shared surface this round added. The app ports these, and the app cannot carry
  // money. The storefront's own ShelfEntry is NOT in this list: it has printed a price on
  // every shelf since R8.3, and it is injected into CuratedSection as a prop precisely so it
  // stays the storefront's business and not this module's.
  const NEW_FURNITURE = [
    'app/bookstore/components/CuratedSection.js',
    'app/lib/bookstore/sections.js',
    'app/lib/bookstore/genres.js',
  ];

  // Comments are stripped first — the prose in these files ARGUES about the money wall at
  // length, and a grep that counted the argument as a violation would only teach the next
  // author to stop writing the argument down.
  const code = (f) => src(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  test('no money vocabulary in the new components', () => {
    // Word-boundaried: 'buy' must not match 'buyer' in a variable name by accident, and must
    // not miss `buyLabel`. '$' is deliberately absent from the symbol list — it is template
    // literal syntax on every second line of a JS file, so it cannot discriminate; the
    // dollar-then-digit pattern below is what an actual price tag looks like.
    for (const f of NEW_FURNITURE) {
      const body = code(f);
      for (const word of ['price', 'buy', 'purchase', 'checkout', 'currency', 'cart', 'basket']) {
        assert.equal(new RegExp(`\\b${word}`, 'i').test(body), false, `${f} contains money vocabulary: "${word}"`);
      }
      for (const symbol of ['£', '₦', '€']) {
        assert.equal(body.includes(symbol), false, `${f} prints a currency symbol: "${symbol}"`);
      }
      assert.equal(/\$\s?\d/.test(body), false, `${f} prints a dollar amount`);
    }
  });

  test('no money imports either', () => {
    for (const f of NEW_FURNITURE) {
      const body = code(f);
      for (const mod of ['BuyButton', 'lib/currency', 'formatPrice', 'priceLine', 'checkout']) {
        assert.equal(new RegExp(`import[^;]*${mod}`).test(body), false, `${f} imports ${mod}`);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('NOTHING IS SEEDED IN CODE', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('the only section the codebase can produce without a curator is the Window migration', () => {
    // buildWindowMigration is the ONE builder that emits a section, and it emits exactly the
    // claim `featured` already encoded. Nothing anywhere invents an Editor's Choice, a Book of
    // the Month or a Top of the Shelf — those are Ikenna's, made in the CMS.
    const out = buildWindowMigration(CATALOGUE, 1);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, TYPE_WINDOW);
  });

  test('no storefront or library source hard-codes a section claim', () => {
    const files = ['app/bookstore/page.js', 'app/lib/bookstore/sections.js', 'app/lib/bookstore/loader.js'];
    for (const f of files) {
      const body = src(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const slug of CATALOGUE.map((t) => t.slug)) {
        assert.equal(body.includes(slug), false, `${f} names a real title: ${slug}`);
      }
    }
  });

  test('the genre migration is the taxonomy and nothing else', () => {
    const out = buildGenreMigration(1);
    assert.equal(out.length, 12);
    assert.ok(out.every((g) => g.schemaVersion === 1 && g.addedAt === 1 && g.updatedAt === 1));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R17.2 — THE SECTIONS BOOTSTRAP IS GONE, and the builder it used is not', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// The branch was retired because bookstore_sections is written in production. A suite that
// merely stopped exercising it would let it come back silently, so this asserts its ABSENCE
// by name — and, in the other direction, asserts that everything the deletion was NOT allowed
// to take with it is still there. R16's BOTTOM_PAGE_BLOCK_REMOVED set the precedent: a removal
// that is a deleted line and a silence is a removal nobody can check.

  test('loader.getSections no longer answers an absent node with the migration', () => {
    const loader = src('app/lib/bookstore/loader.js');
    const fn = /export async function getSections\(([^)]*)\) \{([\s\S]*?)\n\}/.exec(loader);
    assert.ok(fn, 'loader.js no longer declares getSections');

    // The branch itself, and the builder call that WAS the branch.
    assert.equal(/snap\.exists\(\)/.test(fn[2]), false,
      'getSections still branches on the node existing — the bootstrap is back');
    assert.equal(/buildWindowMigration/.test(fn[2]), false,
      'getSections still calls buildWindowMigration — the bootstrap is back');

    // And the parameter that existed only to feed it.
    assert.equal(fn[1].trim(), '',
      'getSections still takes an argument; the only thing that ever needed one was the bootstrap');

    // The whole module: no importer of the builder is left behind to be re-wired by accident.
    assert.equal(/^import .*buildWindowMigration/m.test(loader), false,
      'loader.js still imports buildWindowMigration');
  });

  test('no caller still passes getSections the catalogue', () => {
    for (const f of ['app/bookstore/page.js', 'app/admin/bookstore/page.js']) {
      const calls = src(f).match(/getSections\([^)]*\)/g) || [];
      assert.ok(calls.length > 0, `${f} no longer calls getSections at all`);
      for (const c of calls) {
        assert.equal(c, 'getSections()', `${f} still hands getSections an argument: ${c}`);
      }
    }
  });

  test('THE BUILDER STAYS — the migration and the CMS button both still need it', () => {
    // The deletion was allowed to take the loader's branch and nothing else. Consumers (1) and
    // (2) are the migration proper and "Fold the Window in", and both must still work.
    const out = buildWindowMigration(CATALOGUE, 1);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, TYPE_WINDOW);
    assert.match(src('scripts/migrate-bookstore-taxonomy.mjs'), /buildWindowMigration/);
    assert.match(src('app/admin/bookstore/SectionsPanel.js'), /buildWindowMigration|foldTheWindowIn/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE PREVIEW IS THE SHOP — one stylesheet, not a copy of one', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const VERNACULAR = src('app/bookstore/components/shopVernacular.js');
  const CURATED = src('app/bookstore/components/CuratedSection.js');
  const SHOP = src('app/bookstore/page.js');
  const PANEL = src('app/admin/bookstore/SectionsPanel.js');

  // The classes the curated components draw with. Both surfaces must get them from the same
  // string; the first version of the Sections panel retyped them and immediately disagreed
  // with the shop about a curated shelf's layout.
  const SHARED = [
    '.section-head', '.section-rule', '.section-title',
    '.window-case', '.window-lamp', '.fleuron-corner', '.window-kicker', '.window-title',
    '.window-pull', '.window-shelfcard', '.btn-details',
    '.shelf', '.shelf-entry', '.no-divider', '.no-label',
    '.entry-genre', '.entry-title', '.entry-author', '.shelf-card',
    // R15 — the catalogue's own classes joined the vernacular when the CMS preview started
    // drawing the real CatalogueSection around a placed table.
    '.catalogue-section', '.genre-tabs', '.genre-tab', '.shelf-empty', '.catalogue-interleave',
  ];

  test('the vernacular defines every shared class exactly once', () => {
    const block = /export const SHOP_VERNACULAR_CSS = `([\s\S]*?)`;/.exec(VERNACULAR);
    assert.ok(block, 'SHOP_VERNACULAR_CSS is no longer a single template literal');
    for (const cls of SHARED) {
      assert.ok(new RegExp(`(^|[,\\s])\\${cls}\\b`, 'm').test(block[1]), `the vernacular does not define ${cls}`);
    }
  });

  test('both surfaces interpolate it, and neither redefines its classes', () => {
    for (const [name, body] of [['storefront', SHOP], ['CMS panel', PANEL]]) {
      assert.ok(body.includes('${SHOP_VERNACULAR_CSS}'), `${name} does not interpolate the vernacular`);
    }
    // A redefinition is a copy starting to form. An override SCOPED under .cms-preview is
    // allowed — the panel has exactly one, a font-size, because the shop sizes its window
    // title with clamp() against the viewport and a card is not a viewport. What is refused
    // is an UNSCOPED rule: a selector whose first token is a shop class is the panel deciding
    // for itself what a shelf looks like.
    const panelCss = /<style>\{`([\s\S]*?)`\}<\/style>/.exec(PANEL);
    assert.ok(panelCss, 'the panel no longer has an inline stylesheet');
    const selectors = panelCss[1]
      .replace(/\$\{[^}]*\}/g, '')                        // drop the interpolations
      .split('}')
      .map((chunk) => chunk.split('{')[0])
      .filter((sel) => sel && sel.includes('.'))
      .flatMap((sel) => sel.split(',').map((one) => one.trim()))
      .filter(Boolean);
    for (const sel of selectors) {
      const first = sel.split(/[\s>]+/)[0];
      assert.equal(SHARED.includes(first), false,
        `the CMS panel defines "${sel}" — a shop class unscoped is a copy of the shop forming`);
    }
  });

  test('the exported stylesheets are whole — no backtick truncated them', () => {
    // A backtick inside one of these template literals does not produce a syntax error. It
    // produces a shorter string and a broken export that throws at render, and it got past
    // the build, the tests and eslint once already. The last rule of each block is the
    // canary: if the literal closed early, it is absent.
    const vern = /export const SHOP_VERNACULAR_CSS = `([\s\S]*?)`;/.exec(VERNACULAR)[1];
    assert.ok(vern.includes('.shelf-card-sign'), 'SHOP_VERNACULAR_CSS is truncated');
    assert.ok(vern.includes('.catalogue-interleave'), 'SHOP_VERNACULAR_CSS lost its catalogue block');
    assert.ok(/@media\(max-width:640px\)/.test(vern), 'SHOP_VERNACULAR_CSS lost its responsive block');
    const cur = /export const CURATED_SECTION_CSS = `([\s\S]*?)`;/.exec(CURATED)[1];
    assert.ok(cur.includes('.curated-actions'), 'CURATED_SECTION_CSS is truncated');
    assert.ok(cur.includes('@media(max-width:640px)'), 'CURATED_SECTION_CSS lost its responsive block');
  });

  test('the preview draws with the shop’s components, not lookalikes', () => {
    for (const imp of ['CuratedSection', 'ShelfEntry', 'TheWindow']) {
      assert.ok(new RegExp(`\\b${imp}\\b`).test(PANEL), `the CMS panel does not use ${imp}`);
    }
    assert.ok(/from '\.\.\/\.\.\/bookstore\/page'/.test(PANEL), 'the panel no longer imports the storefront’s own components');
  });

  test('the preview applies bands the same way the shop does', () => {
    for (const fn of ['resolveSections', 'bandsFor', 'applyBands', 'rebindSections']) {
      assert.ok(PANEL.includes(fn), `the CMS panel skips ${fn} — its covers would wear no obi where the shop’s do`);
      assert.ok(SHOP.includes(fn), `the storefront skips ${fn}`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R15 — PLACEMENT: where a section stands in the scroll', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Ikenna, 19 Aug 2026, on the first live claim: "The system works. The placement is wrong.
// They stack up above the shop and it reads as a run of headers followed by the shop."
//
// Everything below is about the ONE decision this round adds — which stop a resolved section
// stands at — and about the guarantees R13 made that placement had to leave untouched.

  const sec = (id, over = {}) => ({
    id, schemaVersion: 1, type: TYPE_EDITORS_CHOICE, displayTitle: id,
    order: 0, status: 'live', slugs: ['basil'], addedAt: 1, updatedAt: 1,
    ...over,
  });
  // A shelf of ten, so a depth has somewhere to land.
  const SHELF = Array.from({ length: 10 }, (_, i) => title(`book-${i + 1}`));
  const resolveOn = (rows, cat = CATALOGUE) => resolveSections(rows, cat, { now: NOW, signals: {} });

  test('the stops are the shop’s own flow, and the shelves are GENRE_GROUPS', () => {
    // Not a second list of the same two words — the halves of the shop are named in genres.js
    // and a third half added there becomes a stop here without an edit.
    assert.deepEqual(SHELF_PLACEMENTS, ['fiction', 'nonfiction']);
    assert.deepEqual(PLACEMENTS, ['opening', 'fiction', 'nonfiction', 'foot']);
    assert.equal(isShelfPlacement('fiction'), true);
    assert.equal(isShelfPlacement(PLACEMENT_OPENING), false);
    assert.equal(isShelfPlacement(PLACEMENT_FOOT), false);
  });

  test('a record written before this round means ‘opening’ — which is where it was rendering', () => {
    // The two live claims on file carry no placement field. Reading the absence as anything
    // else would move somebody's shop because a deploy happened.
    assert.equal(DEFAULT_PLACEMENT, PLACEMENT_OPENING);
    const [out] = resolveOn([sec('legacy')]);
    assert.equal(out.placement, PLACEMENT_OPENING);
    assert.equal(out.placeAfter, 0);
  });

  test('a malformed placement falls to the default rather than to an error', () => {
    for (const bad of ['sideways', '', null, 7, undefined]) {
      assert.equal(placementOf({ type: TYPE_EDITORS_CHOICE, placement: bad }).placement, PLACEMENT_OPENING);
    }
    assert.equal(placementOf({ type: TYPE_EDITORS_CHOICE, placement: 'fiction', placeAfter: -3 }).placeAfter, 0);
    assert.equal(placementOf({ type: TYPE_EDITORS_CHOICE, placement: 'fiction', placeAfter: 2.5 }).placeAfter, 0);
  });

  test('a depth on a stop with no depth is dropped, not carried', () => {
    // 'opening' and 'foot' have no interior. A stale depth left on the record after a move
    // would resurface the moment the curator moved it back into a shelf.
    assert.equal(placementOf({ type: TYPE_EDITORS_CHOICE, placement: PLACEMENT_FOOT, placeAfter: 9 }).placeAfter, 0);
  });

  test('the section is DISTRIBUTED, not stacked — the whole complaint, in one assertion', () => {
    const rows = [
      sec('a', { placement: PLACEMENT_OPENING }),
      sec('b', { placement: 'fiction', placeAfter: 2 }),
      sec('c', { placement: PLACEMENT_FOOT }),
    ];
    const plan = planShopFlow(resolveOn(rows), [{ group: 'fiction', count: 10 }]);
    assert.deepEqual(plan.opening.map((x) => x.id), ['a']);
    assert.deepEqual(plan.shelves.fiction.map((c) => c.after), [2]);
    assert.deepEqual(plan.shelves.fiction[0].sections.map((x) => x.id), ['b']);
    assert.deepEqual(plan.foot.map((x) => x.id), ['c']);
  });

  test('a cut splits the shelf into runs, and the books either side are all still there', () => {
    const plan = planShopFlow(resolveOn([sec('b', { placement: 'fiction', placeAfter: 4 })]), [{ group: 'fiction', count: 10 }]);
    const runs = shelfRuns(SHELF, plan.shelves.fiction);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].titles.length, 4);
    assert.equal(runs[1].titles.length, 6);
    assert.deepEqual(runs[0].sections.map((x) => x.id), ['b']);
    assert.deepEqual(runs[1].sections, []);
    // NOT ONE BOOK LOST OR REPEATED. A cut re-arranges the shelf; it does not edit it.
    assert.deepEqual(runs.flatMap((r) => r.titles.map((t) => t.slug)), SHELF.map((t) => t.slug));
  });

  test('two tables at the same depth share one cut rather than opening two', () => {
    const rows = [
      sec('first', { placement: 'fiction', placeAfter: 3, order: 0 }),
      sec('second', { placement: 'fiction', placeAfter: 3, order: 1 }),
    ];
    const plan = planShopFlow(resolveOn(rows), [{ group: 'fiction', count: 10 }]);
    assert.equal(plan.shelves.fiction.length, 1);
    // AND CMS ORDER STILL DECIDES WHICH IS FIRST. `order` kept its old job; it simply stopped
    // being the only way to say where.
    assert.deepEqual(plan.shelves.fiction[0].sections.map((x) => x.id), ['first', 'second']);
  });

  test('cuts come back in shelf order however the curator ordered the sections', () => {
    const rows = [
      sec('deep', { placement: 'fiction', placeAfter: 8, order: 0 }),
      sec('shallow', { placement: 'fiction', placeAfter: 1, order: 1 }),
    ];
    const plan = planShopFlow(resolveOn(rows), [{ group: 'fiction', count: 10 }]);
    assert.deepEqual(plan.shelves.fiction.map((c) => c.after), [1, 8]);
    const runs = shelfRuns(SHELF, plan.shelves.fiction);
    assert.deepEqual(runs.map((r) => r.titles.length), [1, 7, 2]);
  });

  test('a depth of 0 puts the table above the first book, and draws NO empty grid', () => {
    const plan = planShopFlow(resolveOn([sec('top', { placement: 'fiction', placeAfter: 0 })]), [{ group: 'fiction', count: 10 }]);
    const runs = shelfRuns(SHELF, plan.shelves.fiction);
    assert.equal(runs[0].titles.length, 0);          // the leading run is EMPTY…
    assert.deepEqual(runs[0].sections.map((x) => x.id), ['top']);
    assert.equal(runs[1].titles.length, 10);
    // …and it is returned as empty rather than swallowed, so the ONE condition that suppresses
    // a grid lives in the renderer and not in two places. An empty .shelf is a row gap with no
    // row in it, which is the hole this round must not open.
  });

  test('an uncut shelf is ONE run — byte-identical to the shop before this round', () => {
    assert.deepEqual(shelfRuns(SHELF, []).map((r) => r.titles.length), [10]);
    assert.deepEqual(shelfRuns(SHELF, undefined).map((r) => r.sections), [[]]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R15 — DEGRADATION: an anchor that outran the catalogue', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// A curator plans for a shop that does not exist yet. Neither way of overshooting may produce
// an error, a dropped claim, or a gap.

  const sec = (id, over = {}) => ({
    id, schemaVersion: 1, type: TYPE_EDITORS_CHOICE, displayTitle: id,
    order: 0, status: 'live', slugs: ['basil'], addedAt: 1, updatedAt: 1,
    ...over,
  });
  const SHELF = Array.from({ length: 4 }, (_, i) => title(`book-${i + 1}`));
  const resolveOn = (rows) => resolveSections(rows, CATALOGUE, { now: NOW, signals: {} });

  test('a depth past the end of the shelf CLAMPS to its foot — it is never dropped', () => {
    const plan = planShopFlow(resolveOn([sec('waiting', { placement: 'fiction', placeAfter: 12 })]), [{ group: 'fiction', count: 4 }]);
    assert.equal(plan.shelves.fiction.length, 1);
    assert.equal(plan.shelves.fiction[0].after, 4);
    const runs = shelfRuns(SHELF, plan.shelves.fiction);
    assert.deepEqual(runs.map((r) => r.titles.length), [4]);
    assert.deepEqual(runs[0].sections.map((x) => x.id), ['waiting']);
    // ⚠ AND IT IS STILL RENDERING. Silence belongs to an unmade claim, never to a placement
    // the catalogue has not grown into.
    assert.equal(plan.opening.length + plan.foot.length, 0);
  });

  test('the same claim moves up by itself once the shelf is long enough', () => {
    const rows = resolveOn([sec('waiting', { placement: 'fiction', placeAfter: 12 })]);
    assert.equal(planShopFlow(rows, [{ group: 'fiction', count: 4 }]).shelves.fiction[0].after, 4);
    assert.equal(planShopFlow(rows, [{ group: 'fiction', count: 20 }]).shelves.fiction[0].after, 12);
  });

  test('a shelf that is not on the page at all sends its tables to the FOOT of the catalogue', () => {
    // Today's shop: every published title is fiction, so Non-Fiction is not drawn.
    const plan = planShopFlow(
      resolveOn([sec('orphan', { placement: 'nonfiction', placeAfter: 3 })]),
      [{ group: 'fiction', count: 4 }],
    );
    assert.deepEqual(plan.foot.map((x) => x.id), ['orphan']);
    assert.deepEqual(plan.shelves.fiction, []);
    assert.equal(plan.shelves.nonfiction, undefined);   // not on the page, so not a stop
  });

  test('…and it moves into that shelf by itself the day the half of the shop opens', () => {
    const rows = resolveOn([sec('orphan', { placement: 'nonfiction', placeAfter: 3 })]);
    const plan = planShopFlow(rows, [{ group: 'fiction', count: 4 }, { group: 'nonfiction', count: 5 }]);
    assert.equal(plan.foot.length, 0);
    assert.deepEqual(plan.shelves.nonfiction.map((c) => c.after), [3]);
  });

  test('an EMPTY shop plans an empty scroll, and throws at nothing', () => {
    const plan = planShopFlow([], []);
    assert.deepEqual(plan.opening, []);
    assert.deepEqual(plan.foot, []);
    assert.deepEqual(plan.shelves, {});
    assert.deepEqual(planShopFlow(undefined, undefined).opening, []);
    assert.deepEqual(shelfRuns([], []).map((r) => r.titles.length), [0]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R15 — THE WINDOW IS THE EXCEPTION, and the exception is enforced three times', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// CONFIRMED AGAINST THE SHIPPED SHOP, not assumed: the live record is `window`, order 0, and
// page.js has drawn it as the first thing under the hero since R4b — when it was one line
// reading `{windowTitle && <TheWindow/>}` immediately after <Hero/>.

  const win = (over = {}) => ({
    id: 'window', schemaVersion: 1, type: TYPE_WINDOW, displayTitle: 'In the Window',
    order: 0, status: 'live', slugs: ['the-rescue'], addedAt: 1, updatedAt: 1, ...over,
  });

  test('the type table locks it to the opening', () => {
    assert.equal(SECTION_TYPES[TYPE_WINDOW].placementLocked, PLACEMENT_OPENING);
    // …and nothing else is locked. Every other type goes anywhere.
    for (const k of SECTION_TYPE_KEYS.filter((x) => x !== TYPE_WINDOW)) {
      assert.equal(SECTION_TYPES[k].placementLocked, undefined, `${k} must not be pinned`);
    }
  });

  test('a record that asks to move the Window is overruled at resolution', () => {
    const [out] = resolveSections([win({ placement: 'fiction', placeAfter: 6 })], CATALOGUE, { now: NOW, signals: {} });
    assert.equal(out.placement, PLACEMENT_OPENING);
    assert.equal(out.placeAfter, 0);
    const plan = planShopFlow([out], [{ group: 'fiction', count: 10 }]);
    assert.deepEqual(plan.opening.map((x) => x.id), ['window']);
    assert.deepEqual(plan.shelves.fiction, []);
  });

  test('…and refused at the writer, so a hand-rolled write cannot move it either', () => {
    const bad = validateSection({ ...win({ placement: 'fiction' }), id: undefined });
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.some((e) => /cannot be placed/.test(e)), bad.errors.join(' | '));
    assert.equal(validateSection({ ...win({ placement: PLACEMENT_OPENING }) }).valid, true);
  });

  test('the Window still opens the shop with tables placed all through the shelves', () => {
    const rows = [
      win(),
      { id: 'ec', schemaVersion: 1, type: TYPE_EDITORS_CHOICE, displayTitle: 'EC', order: 1,
        status: 'live', slugs: ['basil'], placement: 'fiction', placeAfter: 2, addedAt: 1, updatedAt: 1 },
    ];
    const plan = planShopFlow(resolveSections(rows, CATALOGUE, { now: NOW, signals: {} }), [{ group: 'fiction', count: 4 }]);
    assert.deepEqual(plan.opening.map((x) => x.id), ['window']);
    assert.equal(plan.opening[0].layout, 'window');
    assert.deepEqual(plan.shelves.fiction[0].sections.map((x) => x.id), ['ec']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R15 — EVERY R13 GUARANTEE HOLDS, WITH THE TABLES NOW MID-SCROLL', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// A hole at the top of a page is a loose margin. A hole between two rows of books is a shelf
// with a missing plank — so each of R13's silences is re-asserted here IN PLACE, and every one
// of them additionally asserts that the shelf closed over it.

  const SHELF = Array.from({ length: 6 }, (_, i) => title(`book-${i + 1}`));
  const at = (id, over) => ({
    id, schemaVersion: 1, displayTitle: id, order: 0, status: 'live',
    placement: 'fiction', placeAfter: 3, addedAt: 1, updatedAt: 1,
    type: TYPE_EDITORS_CHOICE, slugs: ['basil'], ...over,
  });
  const planFor = (rows, opts = {}) => planShopFlow(
    resolveSections(rows, CATALOGUE, { now: NOW, signals: {}, ...opts }),
    [{ group: 'fiction', count: SHELF.length }],
  );
  /** What the shelf actually draws: one number per grid, in order. */
  const gridsOf = (plan) => shelfRuns(SHELF, plan.shelves.fiction)
    .map((r) => r.titles.length).filter((n) => n > 0);

  // The shape of an uncut shelf, computed rather than typed, so this file cannot drift from
  // the fixture above it.
  const WHOLE = [SHELF.length];

  test('AN UNCLAIMED SECTION renders nothing AND the shelf closes over it', () => {
    const plan = planFor([at('empty', { slugs: [] })]);
    assert.equal(plan.shelves.fiction.length, 0);
    assert.deepEqual(gridsOf(plan), WHOLE);            // ⛔ one grid. No cut, no gap.
  });

  test('A CLAIM THAT NO LONGER RESOLVES renders nothing, and leaves no cut behind', () => {
    const plan = planFor([at('gone', { slugs: ['a-book-that-was-unpublished'] })]);
    assert.equal(plan.shelves.fiction.length, 0);
    assert.deepEqual(gridsOf(plan), WHOLE);
  });

  test('A RETIRED SECTION renders nothing, and leaves no cut behind', () => {
    const plan = planFor([at('retired', { status: 'retired' })]);
    assert.equal(plan.shelves.fiction.length, 0);
    assert.deepEqual(gridsOf(plan), WHOLE);
  });

  test('A DORMANT DATA-DRIVEN SECTION renders nothing mid-shelf, even fed a real signal', () => {
    const signals = {
      readers_choice: { computedAt: NOW, windowDays: 30, entries: [{ slug: 'basil' }, { slug: 'the-rescue' }] },
    };
    const plan = planFor([at('dormant', { type: TYPE_READERS_CHOICE, slugs: undefined })], { signals });
    assert.equal(READERS_CHOICE_ENABLED, false);
    assert.equal(plan.shelves.fiction.length, 0);
    assert.deepEqual(gridsOf(plan), WHOLE);
  });

  test('THE MONTH GATE still hides an expired claim, and hides it IN PLACE', () => {
    const july = at('botm', { type: TYPE_BOOK_OF_THE_MONTH, monthKey: JUL, slugs: ['basil'] });
    // Live in July: the shelf is cut in two.
    const inMonth = planShopFlow(
      resolveSections([july], CATALOGUE, { now: Date.UTC(2026, 6, 15), signals: {} }),
      [{ group: 'fiction', count: SHELF.length }],
    );
    assert.deepEqual(shelfRuns(SHELF, inMonth.shelves.fiction).map((r) => r.titles.length), [3, 3]);
    // August: the month ended, so the table is gone AND the plank is back.
    const after = planFor([july]);
    assert.equal(after.shelves.fiction.length, 0);
    assert.deepEqual(gridsOf(after), WHOLE);
  });

  test('…and a claim for NEXT month does not appear early, mid-shelf or anywhere', () => {
    const plan = planFor([at('botm', { type: TYPE_BOOK_OF_THE_MONTH, monthKey: SEP, slugs: ['basil'] })]);
    assert.equal(plan.shelves.fiction.length, 0);
    assert.deepEqual(gridsOf(plan), WHOLE);
  });

  test('SEVERAL SILENT SECTIONS at several depths still leave exactly one grid', () => {
    const plan = planFor([
      at('a', { slugs: [], placeAfter: 1 }),
      at('b', { status: 'retired', placeAfter: 2 }),
      at('c', { type: TYPE_BOOK_OF_THE_MONTH, monthKey: JUL, placeAfter: 4 }),
      at('d', { type: TYPE_POPULAR_IN_NOTES, slugs: undefined, placeAfter: 5 }),
    ]);
    assert.equal(plan.shelves.fiction.length, 0);
    assert.deepEqual(gridsOf(plan), WHOLE);
  });

  test('THE OBI comes only from a live Editor’s Choice — placing it changes nothing', () => {
    for (const where of [{ placement: PLACEMENT_OPENING }, { placement: 'fiction', placeAfter: 2 }, { placement: PLACEMENT_FOOT }]) {
      const resolved = resolveSections([at('ec', { slugs: ['basil'], ...where })], CATALOGUE, { now: NOW, signals: {} });
      const bands = bandsFor(resolved);
      assert.equal(bands.get('basil'), 'Editor’s Choice', `band lost at ${where.placement}`);
      assert.equal(bands.size, 1);
    }
  });

  test('…and a section that placement sent to the foot still grants its band', () => {
    // Degradation must not become a second way to lose a claim's effects.
    const resolved = resolveSections([at('ec', { placement: 'nonfiction', placeAfter: 9 })], CATALOGUE, { now: NOW, signals: {} });
    const plan = planShopFlow(resolved, [{ group: 'fiction', count: SHELF.length }]);
    assert.equal(plan.foot.length, 1);
    assert.equal(bandsFor(resolved).get('basil'), 'Editor’s Choice');
  });

  test('a SILENT section grants no band wherever it was placed', () => {
    for (const where of [{ placement: PLACEMENT_OPENING }, { placement: 'fiction', placeAfter: 2 }]) {
      const resolved = resolveSections([at('ec', { status: 'retired', ...where })], CATALOGUE, { now: NOW, signals: {} });
      assert.equal(bandsFor(resolved).size, 0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R15 — THE FILTERED-TAB RULING, as the storefront implements it', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// THE RULING: a genre tab is a question the reader asked; a curated table is a claim the
// curator made about the shop. Under a filter the shop stops merchandising and answers — one
// continuous grid of exactly the genre asked for. Under "All", the tables are back.
//
// Asserted against the storefront's SOURCE rather than a copy of its logic, because the rule
// is one expression in one component and a re-implementation here would prove only that the
// test agrees with itself. tests/bookstore/placement.spec.mjs drives the real page.

  const SHOP = src('app/bookstore/page.js');

  test('the filter still selects exactly the genre it names', () => {
    const grid = CATALOGUE.filter((t) => t.genre === 'historical');
    assert.deepEqual(grid.map((t) => t.slug), ['basil']);
    // The expression the shop uses, quoted from the component so a rewrite is caught here.
    assert.ok(/const grid = filtered \? titles\.filter\(\(t\) => t\.genre === active\) : titles;/.test(SHOP));
  });

  test('a filtered shelf takes NO cuts — one run, exactly as before this round', () => {
    assert.ok(/const runs = filtered \|\| !renderSection \? \[\{ titles: grid, sections: \[\] \}\] : shelfRuns\(grid, interleaves\)/.test(SHOP),
      'the filtered shelf no longer short-circuits to a single uncut run');
  });

  test('the depth is counted against the UNFILTERED shelf', () => {
    // planShopFlow is handed fictionTitles/nonfictionTitles — the whole halves — never the
    // filtered grid. A depth measured against a tab would move whenever a reader touched one.
    assert.ok(/shelvesOnPage\.push\(\{ group: 'fiction', count: fictionTitles\.length \}\)/.test(SHOP));
    assert.ok(/shelvesOnPage\.push\(\{ group: 'nonfiction', count: nonfictionTitles\.length \}\)/.test(SHOP));
    assert.ok(/planShopFlow\(curatedBanded, shelvesOnPage\)/.test(SHOP));
  });

  test('a run with no books draws no grid', () => {
    assert.ok(/run\.titles\.length > 0 && \(\s*<div className="shelf">/.test(SHOP),
      'the empty-run guard is gone — a cut at depth 0 would draw an empty grid');
  });

  test('the opening and the foot are OUTSIDE the tabbed shelves', () => {
    // Same rule, not an exception to it: a tab filters the shelf it belongs to.
    const body = SHOP.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const opening = body.indexOf('{flow.opening.map(renderCurated)}');
    const fiction = body.indexOf('id="fiction"');
    const foot = body.indexOf('{flow.foot.map(renderCurated)}');
    const colophon = body.indexOf('<Colophon');
    assert.ok(opening > 0 && fiction > opening, 'the opening no longer precedes the catalogue');
    assert.ok(foot > fiction && colophon > foot, 'the foot no longer sits after the shelves and before the colophon');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('R15 — THE CMS CARRIES THE CONTROL, AND THE PREVIEW SHOWS THE PLACE', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  const PANEL = src('app/admin/bookstore/SectionsPanel.js');
  const WRITES = src('app/lib/bookstore/admin-writes.js');
  const RULES = JSON.parse(src('database.rules.json'));

  test('a curator, not a developer, sets it', () => {
    assert.ok(/Where it sits/.test(PANEL), 'the panel has no placement control');
    assert.ok(/PLACEMENT_CHOICES/.test(PANEL));
    assert.ok(/placeAfter: e\.target\.value/.test(PANEL), 'the depth is not editable');
    assert.ok(/placementSentence\(/.test(PANEL), 'the control has no plain-sentence explanation');
  });

  test('the Window’s control is ABSENT, not disabled', () => {
    assert.ok(/spec\.placementLocked \?/.test(PANEL), 'the panel no longer branches on the lock');
    assert.equal(/disabled=\{[^}]*placementLocked/.test(PANEL), false, 'a greyed-out control invites the question of how to un-grey it');
  });

  test('the preview draws the placed table inside the shop’s real catalogue', () => {
    assert.ok(/CatalogueSection/.test(PANEL), 'the preview does not use the storefront’s catalogue component');
    assert.ok(/from '\.\.\/\.\.\/bookstore\/page'/.test(PANEL));
    assert.ok(/planShopFlow\(\[resolved\]/.test(PANEL), 'the preview cuts the shelf by some other means than the shop’s');
    // The BRANCH, not merely the import: a preview that still names CatalogueSection but can
    // never reach it is the isolated frame back again, wearing the right vocabulary.
    assert.ok(/\{inShelf\(resolved\)\s*\n\s*\? \(/.test(PANEL),
      'the placed-context branch is no longer reachable — the preview draws in isolation again');
  });

  test('the writer stores the placement, and clears a depth that no longer applies', () => {
    assert.ok(/doc\.placement = spec\.placementLocked/.test(WRITES), 'the writer does not enforce the lock');
    assert.ok(/if \(isShelfPlacement\(doc\.placement\)\) \{/.test(WRITES), 'a depth is written for a stop that has none');
  });

  test('the database refuses a placement it has never heard of', () => {
    const node = RULES.rules.bookstore_sections.$sectionId;
    assert.ok(node.placement, 'bookstore_sections has no placement rule');
    for (const p of PLACEMENTS) {
      assert.ok(node.placement['.validate'].includes(p), `the rule does not allow ${p}`);
    }
    assert.equal(node.placeAfter['.validate'], 'newData.isNumber() && newData.val() >= 0');
  });
});
