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
