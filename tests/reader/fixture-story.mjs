// THE APP HARNESS'S SUBJECT, RESOLVED FROM THE LIVE CATALOGUE — R19.6.
//
// WHY THIS FILE EXISTS. tests/reader/app.spec.mjs pinned the literal slug `beta-princess`
// for eleven rounds. R12 moved Beta Princess into the Series and set both of its parts
// `published: false` in the same atomic write (scripts/migrate-beta-princess.mjs), so the
// static export stopped emitting /reader/beta-princess and all ten specs in that file began
// failing at `dismissCover` with a 30-second timeout — and, because every browser step in
// reader-tests.yml ran unconditionally after the one before it, they took gate, currency,
// territory and the whole membership block down with them without those suites reporting a
// result at all. A hardcoded slug is a fixture that the editorial calendar can retire.
//
// So the subject is now RESOLVED, at suite start, from the same two live nodes the reader
// gate itself reads. No slug is written down anywhere in the harness.
//
// ── TWO TIERS, AND TIER 1 IS THE PREFERRED ONE ──────────────────────────────────────────
//
//   TIER 1 — a published cms_story with readerMode === true and an epubUrl.
//            This is the STORY register (app/reader/[slug]/page-reader.js): the thing the
//            app suite was built to drive.
//
//   TIER 2 — a published bookstore_titles entry carrying a samplePath, driven at
//            /reader/{slug}?sample=1. This is the BOOK register
//            (app/reader/[slug]/book-reader.js).
//
// ⚠ MEASURED 26 Aug 2026: TIER 1 IS EMPTY, AND NOT BY ACCIDENT. Live cms_stories holds
// exactly ten records with readerMode true and a non-empty epubUrl — afterglow,
// almost-together, an-appetite-for-love, beta-princess, beta-princess-part-two,
// diary-of-a-lagos-9-5er-1, filtered-reality, halfway-around-the-moon-part-i-dawn,
// halfway-around-the-moon-prologue, the-man-who-was-two-men — and every one of them is
// `published: false` with no `publishAt`. scripts/pull-book-reader-collection.mjs unpublished
// the whole Book Reader Collection deliberately (read its header: un-ticking readerMode would
// hand two live quizzes back and put five records into a shape R11.10 ruled a data error), and
// migrate-beta-princess.mjs took the remaining two into the Series. hasStaticPage() therefore
// emits no /reader page for any of them. The story register has NO LIVE SUBJECT, by editorial
// intent, and tier 2 is what keeps the React boundary under test meanwhile.
//
// TIER 1 IS NOT VESTIGIAL. It is tried first on every run and the tier that fired is printed
// by name in the run output, so the day a readerMode story is published again the suite moves
// back to the story register on its own and the log says so — without an edit here.
//
// DETERMINISTIC: within a tier, candidates are sorted by slug and the FIRST is taken. Two runs
// against the same catalogue pick the same book.
//
// OFFLINE? No — and that is the point. This is the app suite's one deliberate live dependency
// (playwright.app.config.mjs's header). A catalogue that cannot answer is a fact worth a red
// run, not something to paper over with a fallback fixture.

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// Same budget as FIREBASE_TIMEOUT_MS in functions/api/bookstore/_lib.js, and for the same
// reason: RTDB REST in europe-west1 answers a key lookup in single-digit milliseconds. Five
// seconds means something is wrong and waiting longer will not fix it.
const READ_TIMEOUT_MS = 5_000;

async function readJson(path) {
  const res = await fetch(`${DB}/${path}`, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`RTDB GET ${path} → HTTP ${res.status}`);
  return res.json();
}

/**
 * TIER 1 — the story register.
 *
 * cms_stories_index is read rather than cms_stories because membership of the index IS
 * publication: app/lib/storyIndex.js's isIndexed() is `published !== false`, and the pull
 * script above DELETES the index entry when it unpublishes. So one ~200 KB read gives the
 * published set with `readerMode` already projected onto it. `published !== false` is asserted
 * anyway rather than inferred — an index that ever carried a partial record must not quietly
 * qualify one.
 *
 * epubUrl is NOT in the index projection, so it is read per candidate off cms_stories. In slug
 * order, first match wins, so the number of extra reads is the number of readerMode records
 * that turn out to have no file — normally zero.
 */
async function tierOne() {
  const index = (await readJson('cms_stories_index.json')) || {};
  const candidates = Object.keys(index)
    .filter((slug) => index[slug]?.published !== false && index[slug]?.readerMode === true)
    .sort();

  for (const slug of candidates) {
    const epubUrl = await readJson(`cms_stories/${slug}/epubUrl.json`);
    if (typeof epubUrl === 'string' && epubUrl.length > 0) {
      return {
        tier: 1,
        register: 'story',
        slug,
        path: `/reader/${slug}`,
        // Where a reader is sent when the book will not open, and what the top bar's back
        // control points at. Both are the register's own, not this file's opinion.
        escapeHref: '/public-library',
        source: 'cms_stories_index → cms_stories/<slug>/epubUrl',
        candidates: candidates.length,
      };
    }
  }
  return { tier: 1, slug: null, candidates: candidates.length };
}

/**
 * TIER 2 — the book register, in sample mode.
 *
 * A sample needs no account and no purchase, which is what makes it drivable: the entitlement
 * fork in book-reader.js resolves to the public sample EPUB before any auth is consulted. The
 * title must be `published`, because the reader gate only lets a PUBLISHED title take a slug
 * (reader-gate.js's precedence note), and it must carry a samplePath, because without one
 * `?sample=1` falls through to the interstitial and no Reading Room mounts at all.
 */
async function tierTwo() {
  const titles = (await readJson('bookstore_titles.json')) || {};
  const candidates = Object.values(titles)
    .filter((t) => t?.status === 'published' && typeof t?.slug === 'string' && !!t?.samplePath)
    .map((t) => ({ slug: t.slug, samplePath: t.samplePath }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  if (!candidates.length) return { tier: 2, slug: null, candidates: 0 };
  const { slug, samplePath } = candidates[0];
  return {
    tier: 2,
    register: 'book',
    slug,
    samplePath,
    path: `/reader/${slug}?sample=1`,
    escapeHref: `/bookstore/${slug}`,
    source: 'bookstore_titles (status=published, samplePath present)',
    candidates: candidates.length,
  };
}

/**
 * Resolve the fixture, log which tier fired, and return it.
 *
 * Throws — loudly, naming the reason — when neither tier can supply a subject. That failure is
 * the harness's honest answer to "there is nothing published to read", and it must not be
 * softened into a skip: a green tick that proves nothing about the reader is worse than a red
 * one that says why.
 */
export async function resolveFixture({ log = console.log } = {}) {
  const one = await tierOne();
  if (one.slug) {
    log(
      `\n=== app harness fixture ===\n`
      + `TIER 1 · the STORY register — the preferred subject.\n`
      + `slug:       ${one.slug}\n`
      + `path:       ${one.path}\n`
      + `resolved:   ${one.source}\n`
      + `candidates: ${one.candidates} published readerMode stor${one.candidates === 1 ? 'y' : 'ies'}\n`,
    );
    return one;
  }

  const two = await tierTwo();
  if (two.slug) {
    log(
      `\n=== app harness fixture ===\n`
      + `TIER 2 · the BOOK register, in sample mode.\n`
      + `TIER 1 WAS EMPTY: no published cms_story carries readerMode + an epubUrl. The Book\n`
      + `Reader Collection is unpublished by editorial decision (see this file's header), so\n`
      + `the story register currently has no live subject and the specs marked BOOK-REGISTER\n`
      + `in app.spec.mjs stand in for it. This is expected, not drift.\n`
      + `slug:       ${two.slug}\n`
      + `path:       ${two.path}\n`
      + `samplePath: ${two.samplePath}\n`
      + `resolved:   ${two.source}\n`
      + `candidates: ${two.candidates} published titles with a sample\n`,
    );
    return two;
  }

  throw new Error(
    'app harness: NO FIXTURE. Neither tier could supply a subject from the live catalogue.\n'
    + `  tier 1 — published cms_stories with readerMode: ${one.candidates}, `
    + 'none of which carries a non-empty epubUrl.\n'
    + `  tier 2 — published bookstore_titles with a samplePath: ${two.candidates}.\n`
    + '  The app suite drives /reader/{slug} out of the static export against LIVE data; with\n'
    + '  nothing published to read there is nothing to drive. Publish a readerMode story or a\n'
    + '  bookstore title with a sample, or check that RTDB answered at all — a network failure\n'
    + '  reaches here as an HTTP error above, not as this message.',
  );
}
