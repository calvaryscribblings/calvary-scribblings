// Bookstore loader library — every read passes through migrateTitle so future schema bumps
// can be slotted in without touching call sites. All functions are tree-shakeable named exports
// and never throw — failures log to console.error and return null or [].
//
// Schema v2 (current): coverUrl and epubPath may be null for draft/unpublished titles. migrateTitle
// promotes legacy v1 docs (empty-string assets) to v2 (null assets) on the way out.
//
// Defence-in-depth filter: every public read filters out titles whose publisher.status !== 'active'.
// This is the safety net behind /admin/publishers' confirm-and-cascade dialog. Admin-facing
// readers (getTitlesByPublisher) skip the filter so admins can see everything.
//
// Publisher storage is split: bookstore_publishers/{slug} holds the public fields (slug, name,
// status, salesSplit, titlesCount, schemaVersion, addedAt, updatedAt) and is genuinely public.
// bookstore_publishers_private/{slug} holds contactEmail and paymentDetails, admin-only read.
// getPublisher merges both for admin callers; getAllPublishers reads only the public node, which
// is what the storefront filter needs. The fail-open behaviour in loadPublisherIndex is a guard
// against transient read failures (network drops), nothing more.

import { ref, query, orderByChild, equalTo, get } from 'firebase/database';
import { db } from '../firebase';
import { SCHEMA_VERSION } from './schema';
import { GENRES_PATH, GENRE_SEED, sortGenres, validateGenre } from './genres';
import { SECTIONS_PATH, SIGNALS_PATH, buildWindowMigration, buildGenreMigration } from './sections';
import { READERSHIP_PATH, readershipCountOf } from './readership';

const TITLES_PATH = 'bookstore_titles';
const PUBLISHERS_PATH = 'bookstore_publishers';
const PUBLISHERS_PRIVATE_PATH = 'bookstore_publishers_private';

export function migrateTitle(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  let out = doc;
  // v1 → v2: empty-string coverUrl/epubPath becomes null. Required-when-published is a
  // validator concern, not a migration one.
  const fromVersion = typeof out.schemaVersion === 'number' ? out.schemaVersion : 1;
  if (fromVersion < 2) {
    out = {
      ...out,
      coverUrl: out.coverUrl === '' ? null : out.coverUrl ?? null,
      epubPath: out.epubPath === '' ? null : out.epubPath ?? null,
      schemaVersion: 2,
    };
  }
  if (!out.schemaVersion) out = { ...out, schemaVersion: SCHEMA_VERSION };
  // R7.4 — the house glossary rides through the spread above untouched, like samplePath and
  // the Bookseller's Fields: schema-external, so there is nothing to migrate and nothing to
  // strip. Normalised to null so a caller can test `title.glossary` without also testing for
  // the empty object a hand-edited record might carry.
  if (out.glossary && (typeof out.glossary !== 'object' || Array.isArray(out.glossary) || !Object.keys(out.glossary).length)) {
    out = { ...out, glossary: null };
  }
  return out;
}

function snapToArray(snap) {
  if (!snap.exists()) return [];
  const out = [];
  snap.forEach((child) => {
    out.push({ id: child.key, ...migrateTitle(child.val()) });
    return false;
  });
  return out;
}

function snapToOne(snap) {
  if (!snap.exists()) return null;
  return migrateTitle(snap.val());
}

// Builds a slug → publisher index. Returns null on read failure (network drop,
// transient permission denied, etc.). Callers fail open when null — they pass
// titles through unfiltered. Public reads on the publishers node are now allowed
// for non-sensitive fields, so this only fails on genuine errors.
async function loadPublisherIndex() {
  try {
    const snap = await get(ref(db, PUBLISHERS_PATH));
    if (!snap.exists()) return {};
    const idx = {};
    snap.forEach((child) => {
      idx[child.key] = child.val();
      return false;
    });
    return idx;
  } catch (err) {
    console.warn('[bookstore.loader] publisher index unreadable; cascade filter skipped', err);
    return null;
  }
}

async function filterByActivePublisher(titles) {
  if (!Array.isArray(titles) || titles.length === 0) return titles;
  const idx = await loadPublisherIndex();
  if (idx === null) return titles; // Fail open — see file header.
  return titles.filter((t) => {
    const pub = idx[t.publisherId];
    // Unknown publisher passes through; missing-publisher data hygiene is
    // the admin's problem, not a reason to hide an otherwise-valid title.
    if (!pub) return true;
    return pub.status === 'active';
  });
}

export async function getAllPublishedTitles() {
  try {
    const snap = await get(query(ref(db, TITLES_PATH), orderByChild('status'), equalTo('published')));
    let titles = snapToArray(snap);
    titles = await filterByActivePublisher(titles);
    titles.sort((a, b) => (b.publishedDate || '').localeCompare(a.publishedDate || ''));
    return titles;
  } catch (err) {
    console.error('[bookstore.loader] getAllPublishedTitles failed', err);
    return [];
  }
}

export async function getTitleBySlug(slug) {
  if (!slug) return null;
  try {
    const snap = await get(query(ref(db, TITLES_PATH), orderByChild('slug'), equalTo(slug)));
    if (!snap.exists()) return null;
    let match = null;
    snap.forEach((child) => {
      if (!match) match = { id: child.key, ...migrateTitle(child.val()) };
      return false;
    });
    if (!match) return null;
    const filtered = await filterByActivePublisher([match]);
    return filtered.length === 0 ? null : filtered[0];
  } catch (err) {
    console.error('[bookstore.loader] getTitleBySlug failed', err);
    return null;
  }
}

export async function getTitlesByGenre(genre) {
  if (!genre) return [];
  try {
    const snap = await get(query(ref(db, TITLES_PATH), orderByChild('genre'), equalTo(genre)));
    let titles = snapToArray(snap).filter((t) => t.status === 'published');
    titles = await filterByActivePublisher(titles);
    titles.sort((a, b) => (b.publishedDate || '').localeCompare(a.publishedDate || ''));
    return titles;
  } catch (err) {
    console.error('[bookstore.loader] getTitlesByGenre failed', err);
    return [];
  }
}

// Admin-facing — does NOT apply the publisher-status filter. Admins need to
// see suspended-publisher titles to manage them.
export async function getTitlesByPublisher(publisherId) {
  if (!publisherId) return [];
  try {
    const snap = await get(query(ref(db, TITLES_PATH), orderByChild('publisherId'), equalTo(publisherId)));
    return snapToArray(snap);
  } catch (err) {
    console.error('[bookstore.loader] getTitlesByPublisher failed', err);
    return [];
  }
}

export async function getFeaturedTitles() {
  try {
    const snap = await get(query(ref(db, TITLES_PATH), orderByChild('featured'), equalTo(true)));
    let titles = snapToArray(snap).filter((t) => t.status === 'published');
    titles = await filterByActivePublisher(titles);
    return titles;
  } catch (err) {
    console.error('[bookstore.loader] getFeaturedTitles failed', err);
    return [];
  }
}

export async function getBestsellers(limit = 10) {
  try {
    const snap = await get(query(ref(db, TITLES_PATH), orderByChild('bestseller'), equalTo(true)));
    let titles = snapToArray(snap).filter((t) => t.status === 'published');
    titles = await filterByActivePublisher(titles);
    titles.sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0));
    return titles.slice(0, limit);
  } catch (err) {
    console.error('[bookstore.loader] getBestsellers failed', err);
    return [];
  }
}

/**
 * The public publisher record, and ONLY the public one. R9.2 PL-11.
 *
 * The storefront needs a publisher for exactly one thing — the name printed under "Publisher"
 * on the detail page — and it used getPublisher() below to get it. That call also reaches for
 * bookstore_publishers_private, which is founder-read-only, so for every reader who is not one
 * of the two founders it was a request guaranteed to come back permission-denied: a wasted
 * round trip and a red line in the console on the buying path, every time a book was opened.
 *
 * The audit asked for a grep at launch prep to prove no private field renders on a public
 * surface. It does not — page-detail.js reads `pub.name` and nothing else, so nothing ever
 * leaked. This exists so the question cannot be reopened by a later edit: a public surface
 * calling a public getter can never render a private field, whoever is signed in.
 *
 * getPublisher() keeps the merge, because /admin/publishers genuinely needs it.
 */
export async function getPublisherPublic(publisherId) {
  if (!publisherId) return null;
  try {
    const snap = await get(ref(db, `${PUBLISHERS_PATH}/${publisherId}`));
    return snap.exists() ? snap.val() : null;
  } catch (err) {
    console.error('[bookstore.loader] getPublisherPublic failed', err);
    return null;
  }
}

// Returns the merged publisher shape (public + private fields) when called by an
// admin context. Anonymous callers get only the public fields — the private fetch
// silently fails on permission denied and we still return the public node.
//
// R9.2 PL-11: ADMIN SURFACES ONLY. A storefront caller wants getPublisherPublic() above —
// the private half is founder-gated, so on a public page this always costs a denied request
// and can never return anything.
export async function getPublisher(publisherId) {
  if (!publisherId) return null;
  let publicVal = null;
  try {
    const snap = await get(ref(db, `${PUBLISHERS_PATH}/${publisherId}`));
    if (!snap.exists()) return null;
    publicVal = snap.val();
  } catch (err) {
    console.error('[bookstore.loader] getPublisher (public) failed', err);
    return null;
  }

  let privateVal = null;
  try {
    const privSnap = await get(ref(db, `${PUBLISHERS_PRIVATE_PATH}/${publisherId}`));
    if (privSnap.exists()) privateVal = privSnap.val();
  } catch {
    // Permission denied for anonymous callers — that's expected; treat as no private data.
    privateVal = null;
  }

  return privateVal ? { ...publicVal, ...privateVal } : publicVal;
}

// Reads the public publishers node only — both anonymous storefront and admin call this.
// Admins fetch private fields per-record via getPublisher() when they need them (e.g. when
// opening the Edit form).
export async function getAllPublishers() {
  try {
    const snap = await get(ref(db, PUBLISHERS_PATH));
    if (!snap.exists()) return [];
    const out = [];
    snap.forEach((child) => {
      out.push({ id: child.key, ...child.val() });
      return false;
    });
    return out;
  } catch (err) {
    console.error('[bookstore.loader] getAllPublishers failed', err);
    return [];
  }
}


// ═════════════════════════════════════════════════════════════════════════════════════════
// R13 — THE TAXONOMY AND THE CLAIMS
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Two nodes, both `.read: true`, both admin-write, and they are governed by OPPOSITE rules
// for reasons argued in full at the head of genres.js and sections.js:
//
//   bookstore_genres    VOCABULARY.  An unwritten node bootstraps to the seed, because a
//                       shop with no shelf labels is a broken screen.
//   bookstore_sections  CURATION.    An unwritten node bootstraps to the WINDOW MIGRATION and
//                       to nothing else, because a missing claim is an editorial silence —
//                       and the Window's existing claim is the one thing this round is
//                       required not to drop.
//
// Both bootstraps are keyed on the node being ABSENT ENTIRELY. One saved record retires each
// of them permanently; neither ever fills a gap in a populated node.

/**
 * The genre taxonomy, in display order.
 *
 * A record that fails validateGenre is DROPPED, not repaired. A half-written genre is a
 * missing tab, which is visible; a repaired one is a tab spelled by this function rather
 * than by the curator, which is the exact failure the old CMS GENRE_OPTIONS shipped.
 */
export async function getGenres() {
  try {
    const snap = await get(ref(db, GENRES_PATH));
    if (!snap.exists()) return sortGenres(GENRE_SEED);          // ⚠ bootstrap — see header
    const out = [];
    snap.forEach((child) => {
      const doc = { slug: child.key, ...child.val() };
      if (validateGenre(doc).valid) out.push(doc);
      else console.warn('[bookstore.loader] genre record dropped (invalid)', child.key);
      return false;
    });
    return out.length ? sortGenres(out) : sortGenres(GENRE_SEED);
  } catch (err) {
    console.error('[bookstore.loader] getGenres failed', err);
    // A read failure is not an editorial decision. The shop still needs labels, and the seed
    // is what it had before this node existed.
    return sortGenres(GENRE_SEED);
  }
}

/**
 * The raw curated sections, unresolved. resolveSections() in sections.js turns these into
 * what renders — this function only fetches, exactly as getAllPublishedTitles only fetches.
 *
 * `titles` is taken as an argument solely to build the bootstrap, and is unused once the node
 * exists. Pass the published catalogue you already loaded; do not fetch it again for this.
 *
 * ⚠ A READ FAILURE RETURNS [] AND NOT THE BOOTSTRAP. The bootstrap answers "this node has
 * never been written"; a network drop answers nothing at all, and a shop that draws a Window
 * from `featured` whenever a request fails would keep the old behaviour alive indefinitely
 * behind an intermittent fault. Silence is the correct output of a failed read here, because
 * silence is what an unclaimed section renders anyway.
 */
export async function getSections(titles) {
  try {
    const snap = await get(ref(db, SECTIONS_PATH));
    if (!snap.exists()) return buildWindowMigration(titles, Date.now());   // ⚠ bootstrap
    const out = [];
    snap.forEach((child) => {
      out.push({ id: child.key, ...child.val() });
      return false;
    });
    return out;
  } catch (err) {
    console.error('[bookstore.loader] getSections failed', err);
    return [];
  }
}

/**
 * The aggregates the dormant pair would read. There is no aggregator and therefore no node,
 * so this returns {} today and both data-driven sections resolve to nothing.
 *
 * IT IS WIRED ANYWAY, deliberately. A contract that is defined but never called is a contract
 * nobody has tried; this one is called on every load, costs one absent-node read, and means
 * the day the aggregator first writes there is no client change to remember. The switches in
 * sections.js still hold the section closed until Ikenna opens it.
 */
export async function getSignals() {
  try {
    const snap = await get(ref(db, SIGNALS_PATH));
    return snap.exists() ? (snap.val() || {}) : {};
  } catch (err) {
    console.error('[bookstore.loader] getSignals failed', err);
    return {};
  }
}

/** The genre taxonomy as the migration would write it. Used by the CMS's seed button. */
export function genreMigrationPayload(nowMs) {
  return buildGenreMigration(nowMs);
}

/**
 * READERSHIP — the public count for one title. R14.
 *
 * A single-key read of a public node, and the ONLY way a browser is allowed to learn this
 * number: bookstore_purchases is per-reader and gated to its owner, so there is no
 * client-side derivation to fall back to and there must never be one.
 *
 * ⚠ EVERY FAILURE RETURNS 0, and 0 renders nothing. An absent node (nobody has bought it), a
 * network drop, a permission surprise — all of them mean the line does not appear, which is
 * the same thing the shop shows for a title with no purchases. That is the correct direction
 * for a claim about other people: a shop that cannot verify how many libraries a book is in
 * says nothing, rather than guessing or printing a stale figure.
 *
 * NO SIGNED-IN STATE IS INVOLVED. The node is `.read: true`, so a guest gets the same number
 * as a founder — asserted in tests/rules/database.test.mjs.
 */
export async function getReadership(titleId) {
  if (!titleId) return 0;
  try {
    const snap = await get(ref(db, `${READERSHIP_PATH}/${titleId}`));
    return snap.exists() ? readershipCountOf(snap.val()) : 0;
  } catch (err) {
    console.error('[bookstore.loader] getReadership failed', err);
    return 0;
  }
}
