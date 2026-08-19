// R13 — THE GENRE MIGRATION, asserted. `npm run test:purchases`.
//
// ── WHAT THIS SUITE IS FOR ───────────────────────────────────────────────────────────────
//
// The migration's whole promise is that THE SHOP RENDERS IDENTICALLY BEFORE AND AFTER. That
// is not a claim a migration script can make about itself, so it is made here, against a
// frozen record of what the shop rendered before.
//
// ── WHY A FROZEN FIXTURE, WHEN THIS CODEBASE NORMALLY REFUSES ONE ────────────────────────
//
// tests/bookstore/gate.spec.mjs argues at length that a test must not carry its own copy of
// a constant, because "a test carrying its own copy of the key passes forever after someone
// changes the real one". That argument does not apply to a fixture of the PAST. PRE_R13
// below is not a copy of a live constant — it is a record of a value that no longer exists
// anywhere and must never change, because history does not. If somebody edits it, they are
// not updating a duplicate; they are rewriting what the shop used to do, and the whole point
// of the suite is that they cannot.
//
// A git cross-check runs alongside it and reads the real pre-R13 source when the commit is
// reachable. It SKIPS rather than fails on a shallow checkout — CI's test:purchases job uses
// actions/checkout at its default depth of 1 — so the frozen fixture is the assertion and
// the git read is the corroboration.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  GENRE_SEED,
  GENRE_SEED_SLUGS,
  GENRE_GROUPS,
  validateGenre,
  sortGenres,
  genreLabel,
  groupOf,
  genresInGroup,
  genresPresentIn,
  titlesInGroup,
} from '../../app/lib/bookstore/genres.js';
import { GENRES } from '../../app/lib/bookstore/schema.js';
import { buildGenreMigration } from '../../app/lib/bookstore/sections.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const src = (rel) => readFileSync(new URL(rel, new URL('../../', import.meta.url)), 'utf8');

// The last commit before R13 touched the bookstore. Used only by the corroborating read.
const PRE_R13_COMMIT = '4b6206a';

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE FROZEN RECORD — app/bookstore/page.js as it stood before R13.
//
//   GENRE_LABELS   the twelve labels, verbatim
//   FICTION_GENRES / NONFICTION_GENRES   the split, in the order the tabs rendered
//
// Do not edit. See the header.
// ═════════════════════════════════════════════════════════════════════════════════════════
const PRE_R13 = {
  labels: {
    'literary-fiction': 'Literary Fiction',
    'romance': 'Romance',
    'thriller-suspense': 'Thriller & Suspense',
    'sci-fi-fantasy': 'Sci-Fi & Fantasy',
    'historical': 'Historical',
    'short-story-collection': 'Short Story Collections',
    'poetry': 'Poetry',
    'memoir-biography': 'Memoir & Biography',
    'essays': 'Essays',
    'self-development': 'Self-Development',
    'business-finance': 'Business & Finance',
    'politics-society': 'Politics & Society',
  },
  fiction: ['literary-fiction', 'romance', 'thriller-suspense', 'sci-fi-fantasy', 'historical', 'short-story-collection', 'poetry'],
  nonfiction: ['memoir-biography', 'essays', 'self-development', 'business-finance', 'politics-society'],
};

// THE LIVE CATALOGUE, as it stood on 19 August 2026 — four published titles across three
// genres, plus the one draft. The genre assignments are the real ones; this is the input the
// "identical tabs" proof is run over.
const LIVE_TITLES = [
  { slug: 'after-the-fact', genre: 'short-story-collection', status: 'published' },
  { slug: 'basil', genre: 'historical', status: 'published' },
  { slug: 'the-fire-in-the-flint', genre: 'literary-fiction', status: 'published' },
  { slug: 'the-rescue', genre: 'literary-fiction', status: 'published' },
  { slug: 'test-drive', genre: 'literary-fiction', status: 'draft' },
];
const LIVE_PUBLISHED = LIVE_TITLES.filter((t) => t.status === 'published');

/** The pre-R13 shop's own tab derivation, transcribed from app/bookstore/page.js:326-329. */
function tabsBefore(published) {
  const fictionTitles = published.filter((t) => PRE_R13.fiction.includes(t.genre));
  const nonfictionTitles = published.filter((t) => PRE_R13.nonfiction.includes(t.genre));
  const label = (g) => PRE_R13.labels[g] || g;
  return {
    fiction: ['All Fiction', ...PRE_R13.fiction.filter((g) => fictionTitles.some((t) => t.genre === g)).map(label)],
    nonfiction: ['All Non-Fiction', ...PRE_R13.nonfiction.filter((g) => nonfictionTitles.some((t) => t.genre === g)).map(label)],
  };
}

/** The post-R13 shop's derivation, using the taxonomy exactly as CatalogueSection does. */
function tabsAfter(genres, published) {
  const fictionTitles = titlesInGroup(genres, published, 'fiction');
  const nonfictionTitles = titlesInGroup(genres, published, 'nonfiction');
  return {
    fiction: ['All Fiction', ...genresPresentIn(genres, fictionTitles, 'fiction').map((g) => g.label)],
    nonfiction: ['All Non-Fiction', ...genresPresentIn(genres, nonfictionTitles, 'nonfiction').map((g) => g.label)],
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE MIGRATION PROOF — the shop’s tabs are identical before and after', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('⭑ the live catalogue renders the SAME TABS, in the same order, with the same words', () => {
    const before = tabsBefore(LIVE_PUBLISHED);
    const after = tabsAfter(GENRE_SEED, LIVE_PUBLISHED);
    assert.deepEqual(after, before);
    // …and stated in full, so a reader of this file can see what "identical" means here.
    assert.deepEqual(before.fiction, ['All Fiction', 'Literary Fiction', 'Historical', 'Short Story Collections']);
    assert.deepEqual(before.nonfiction, ['All Non-Fiction']);
  });

  test('…and for every possible catalogue: one title on each genre in turn', () => {
    for (const slug of GENRE_SEED_SLUGS) {
      const cat = [{ slug: 'x', genre: slug, status: 'published' }];
      assert.deepEqual(tabsAfter(GENRE_SEED, cat), tabsBefore(cat), `diverged on ${slug}`);
    }
  });

  test('…and for the full catalogue, one title on every genre at once', () => {
    const cat = GENRE_SEED_SLUGS.map((g, i) => ({ slug: `t${i}`, genre: g, status: 'published' }));
    assert.deepEqual(tabsAfter(GENRE_SEED, cat), tabsBefore(cat));
    // Which is the strongest form: all twelve tabs, both halves, in order.
    assert.deepEqual(tabsAfter(GENRE_SEED, cat).fiction, ['All Fiction', ...PRE_R13.fiction.map((g) => PRE_R13.labels[g])]);
    assert.deepEqual(tabsAfter(GENRE_SEED, cat).nonfiction, ['All Non-Fiction', ...PRE_R13.nonfiction.map((g) => PRE_R13.labels[g])]);
  });

  test('…and for an EMPTY catalogue', () => {
    assert.deepEqual(tabsAfter(GENRE_SEED, []), tabsBefore([]));
    assert.deepEqual(tabsAfter(GENRE_SEED, []).fiction, ['All Fiction']);
  });

  test('every label matches the pre-R13 map, character for character', () => {
    for (const g of GENRE_SEED) {
      assert.equal(g.label, PRE_R13.labels[g.slug], `label drifted for ${g.slug}`);
    }
    assert.equal(GENRE_SEED.length, Object.keys(PRE_R13.labels).length);
  });

  test('every genre is in the half it was in, in the position it was in', () => {
    assert.deepEqual(genresInGroup(GENRE_SEED, 'fiction').map((g) => g.slug), PRE_R13.fiction);
    assert.deepEqual(genresInGroup(GENRE_SEED, 'nonfiction').map((g) => g.slug), PRE_R13.nonfiction);
  });

  test('the three live genre assignments are untouched by the migration', () => {
    // The migration writes bookstore_genres and nothing else. It does not read, rewrite or
    // remap a single title — a title's `genre` is already the slug the taxonomy is keyed by,
    // which is why there is no per-title half to this migration at all.
    const mig = buildGenreMigration(1);
    assert.equal(mig.every((r) => Object.keys(r).sort().join() === 'addedAt,group,label,order,schemaVersion,slug,updatedAt'), true);
    for (const t of LIVE_TITLES) {
      assert.ok(GENRE_SEED_SLUGS.includes(t.genre), `${t.slug} is on a genre the taxonomy does not carry`);
    }
  });

  test('corroboration: the real pre-R13 source, when git can reach it', (t) => {
    let old;
    try {
      old = execFileSync('git', ['show', `${PRE_R13_COMMIT}:app/bookstore/page.js`], { cwd: ROOT, encoding: 'utf8' });
    } catch {
      t.skip(`commit ${PRE_R13_COMMIT} not reachable (shallow checkout) — the frozen fixture above is the assertion`);
      return;
    }
    const labels = {};
    const block = /const GENRE_LABELS = \{([\s\S]*?)\};/.exec(old);
    assert.ok(block, 'pre-R13 page.js no longer parses — is PRE_R13_COMMIT right?');
    for (const [, k, v] of block[1].matchAll(/'([\w-]+)':\s*'([^']*)'/g)) labels[k] = v;
    assert.deepEqual(labels, PRE_R13.labels, 'the frozen fixture disagrees with history');

    const fic = /export const FICTION_GENRES = \[([^\]]*)\]/.exec(old)[1].match(/'([\w-]+)'/g).map((s) => s.slice(1, -1));
    const non = /export const NONFICTION_GENRES = \[([^\]]*)\]/.exec(old)[1].match(/'([\w-]+)'/g).map((s) => s.slice(1, -1));
    assert.deepEqual(fic, PRE_R13.fiction);
    assert.deepEqual(non, PRE_R13.nonfiction);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('ONE TAXONOMY — no second copy anywhere', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  // Before R13 the genre vocabulary was written down three times, and the third had drifted:
  // /admin/bookstore derived labels from the slug and offered an editor "Thriller Suspense"
  // where the shop printed "Thriller & Suspense". This is the guard against a fourth.
  const SURFACES = [
    'app/bookstore/page.js',
    'app/bookstore/[slug]/page-detail.js',
    'app/admin/bookstore/page.js',
    'app/admin/bookstore/SectionsPanel.js',
    'app/admin/bookstore/GenresPanel.js',
    'app/bookstore/components/CuratedSection.js',
    'app/bookstore/components/BoundBook.js',
    'app/bookstore/components/QuickLookModal.js',
  ];

  test('no surface holds a genre label table', () => {
    for (const f of SURFACES) {
      const body = src(f);
      assert.equal(/GENRE_LABELS|GENRE_OPTIONS/.test(body.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')), false,
        `${f} carries a genre label table`);
    }
  });

  test('no surface hard-codes a genre label string', () => {
    // The labels themselves. If one appears as a literal outside genres.js, somebody has
    // started a fourth copy.
    for (const f of SURFACES) {
      const body = src(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const label of Object.values(PRE_R13.labels)) {
        assert.equal(body.includes(`'${label}'`) || body.includes(`"${label}"`), false,
          `${f} hard-codes the label "${label}"`);
      }
    }
  });

  test('no surface hard-codes the fiction / non-fiction split', () => {
    for (const f of SURFACES) {
      const body = src(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      assert.equal(/FICTION_GENRES|NONFICTION_GENRES/.test(body), false, `${f} carries the split`);
    }
  });

  test('schema.js’s GENRES is the seed, not a second list', () => {
    assert.deepEqual(GENRES, GENRE_SEED_SLUGS);
    assert.equal(GENRES, GENRE_SEED_SLUGS, 'the same array object — a projection, not a copy');
    const body = src('app/lib/bookstore/schema.js');
    assert.equal(/'literary-fiction'/.test(body), false, 'schema.js still literals a genre slug');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE TAB RULE — an empty genre is absent, not an empty tab', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('a genre with no published title gets no tab', () => {
    const present = genresPresentIn(GENRE_SEED, LIVE_PUBLISHED, 'fiction').map((g) => g.slug);
    assert.deepEqual(present, ['literary-fiction', 'historical', 'short-story-collection']);
    assert.equal(present.includes('romance'), false, 'Romance has no titles and must be absent');
  });

  test('a genre holding only a DRAFT gets no tab', () => {
    // 'test-drive' is literary-fiction and a draft; the two published literary-fiction titles
    // are what earn that tab, so the test removes them to isolate the draft.
    const onlyDraft = LIVE_TITLES.filter((t) => t.status === 'draft');
    assert.deepEqual(genresPresentIn(GENRE_SEED, onlyDraft.filter((t) => t.status === 'published'), 'fiction'), []);
  });

  test('All Fiction and All Non-Fiction come first, always', () => {
    const t = tabsAfter(GENRE_SEED, LIVE_PUBLISHED);
    assert.equal(t.fiction[0], 'All Fiction');
    assert.equal(t.nonfiction[0], 'All Non-Fiction');
  });

  test('a half of the shop with no titles has no section at all', () => {
    // The storefront guards on titlesInGroup(...).length > 0, so this is the input to that.
    assert.deepEqual(titlesInGroup(GENRE_SEED, LIVE_PUBLISHED, 'nonfiction'), []);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('THE TAXONOMY’S OWN RULES', () => {
// ═════════════════════════════════════════════════════════════════════════════════════════

  test('every seed record validates', () => {
    for (const g of buildGenreMigration(1)) {
      const r = validateGenre(g);
      assert.equal(r.valid, true, `${g.slug}: ${r.errors.join('; ')}`);
    }
  });

  test('validation refuses what would break a shelf', () => {
    const ok = { schemaVersion: 1, slug: 'crime', label: 'Crime', group: 'fiction', order: 3 };
    assert.equal(validateGenre(ok).valid, true);
    assert.equal(validateGenre({ ...ok, slug: 'Crime Fiction' }).valid, false, 'a non-slug key');
    assert.equal(validateGenre({ ...ok, label: '' }).valid, false, 'an unlabelled genre is an unlabelled tab');
    assert.equal(validateGenre({ ...ok, group: 'poetry' }).valid, false, 'a genre belongs to one half of the shop');
    assert.equal(validateGenre({ ...ok, order: -1 }).valid, false);
    assert.equal(validateGenre({ ...ok, order: 1.5 }).valid, false);
    assert.equal(validateGenre(null).valid, false);
  });

  test('a slug missing from the taxonomy falls back to ITSELF, never to a guessed label', () => {
    // This is the exact failure the old CMS shipped: 'thriller-suspense' title-cased into
    // "Thriller Suspense", which looked plausible and was wrong. A raw slug looks wrong, and
    // looking wrong is the correct behaviour for data that is wrong.
    assert.equal(genreLabel(GENRE_SEED, 'crime-noir'), 'crime-noir');
    assert.notEqual(genreLabel(GENRE_SEED, 'crime-noir'), 'Crime Noir');
    assert.equal(groupOf(GENRE_SEED, 'crime-noir'), null);
  });

  test('order decides, and ties break on slug so every device agrees', () => {
    const scrambled = [
      { slug: 'b', label: 'B', group: 'fiction', order: 1 },
      { slug: 'a', label: 'A', group: 'fiction', order: 1 },
      { slug: 'c', label: 'C', group: 'fiction', order: 0 },
    ];
    assert.deepEqual(sortGenres(scrambled).map((g) => g.slug), ['c', 'a', 'b']);
  });

  test('the CMS can reorder and relabel without touching a title', () => {
    // A curator renaming "Historical" to "Historical Fiction" and moving it first changes the
    // tab and nothing else — the same books are on the same shelf under the same slug.
    const edited = GENRE_SEED.map((g) => (g.slug === 'historical' ? { ...g, label: 'Historical Fiction', order: 0 } : g));
    const t = tabsAfter(edited, LIVE_PUBLISHED);
    assert.deepEqual(t.fiction, ['All Fiction', 'Historical Fiction', 'Literary Fiction', 'Short Story Collections']);
    assert.deepEqual(titlesInGroup(edited, LIVE_PUBLISHED, 'fiction').map((x) => x.slug),
      titlesInGroup(GENRE_SEED, LIVE_PUBLISHED, 'fiction').map((x) => x.slug));
  });

  test('the two groups are the two halves of the shop and there is no third', () => {
    assert.deepEqual(GENRE_GROUPS, ['fiction', 'nonfiction']);
    assert.equal(GENRE_SEED.every((g) => GENRE_GROUPS.includes(g.group)), true);
  });
});
