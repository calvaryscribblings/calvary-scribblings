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

// Returns the merged publisher shape (public + private fields) when called by an
// admin context. Anonymous callers get only the public fields — the private fetch
// silently fails on permission denied and we still return the public node.
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
