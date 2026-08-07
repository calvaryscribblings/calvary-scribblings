'use client';
// THE OFFLINE SHELF — the whole data layer for My Library's STORIES section.
//
// One module owns the schema, the cap, the save/remove/prune lifecycle and the honesty
// metadata, so the story page's contribution is a button and the shelf UI's is a render.
// Nothing else in the tree opens this database.
//
// ── WHAT A SAVED STORY IS ────────────────────────────────────────────────────────────────
// A record in IndexedDB carrying the prose itself, plus a cover blob in a sibling store.
// It is NOT a cached copy of /stories/<slug>: the reader for a saved story is the lean
// shelf reader (app/my-library/read), which needs no network and no Firebase. See the
// service worker's header for why that split was chosen over caching the story route.
//
// The source of a save is the story record ALREADY IN MEMORY on the story page — build-
// inlined by app/stories/[slug]/page.js and refreshed live by page-client.js. Saving
// therefore costs ZERO additional Firebase reads. cms_stories_index is deliberately not
// the source: it excludes `content` by design (see app/lib/storyIndex.js), which is the
// one field a saved story exists for.
//
// ── PER-DEVICE, AND SCOPED BY UID ────────────────────────────────────────────────────────
// IndexedDB does not sync. A shelf saved on a phone is not a shelf on a laptop, and the UI
// says so in four places (see the honesty copy in app/my-library/page.js). Records also
// carry `uid` and every read filters on it, so a shared device cannot show one reader's
// shelf to the next one who signs in.
//
// ── ROOM FOR BOOKS ───────────────────────────────────────────────────────────────────────
// One store, `shelf`, discriminated by `kind: 'story' | 'book'`. The cap check, the size
// accounting, the prune, the sort order and the remove flow are written once here and are
// already kind-agnostic. Books add their own fields (an epub blob key, a format) and their
// own cap constant — CAPS.book — and reuse everything else. A separate `books` store would
// have duplicated all of it. Books are untouched this round; the discriminator is the only
// concession made now and it costs nothing.

export const DB_NAME = 'cs-shelf';
export const DB_VERSION = 1;
export const SCHEMA_V = 1;

// The cap is universal this round. Tiers change this constant into a lookup later and
// nothing else in the codebase moves — every caller goes through capFor().
//
// ── SETTLED BEFORE IT IS BUILT: THE CAP GATES AT SAVE TIME, AND ONLY AT SAVE TIME ────────
//
// When capFor takes a tier — capFor(kind, tier), the R11 membership work — a reader on a day
// pass will hold a larger cap for twenty-four hours and can fill it. The pass then expires
// and their tier falls back, leaving them holding MORE SAVED STORIES THAN THEIR CAP ALLOWS.
//
// THE RULING IS THAT THOSE SAVES PERSIST. Nothing evicts them, nothing prunes them down to
// the new cap, and no background sweep reconciles a shelf against a tier. The over-cap
// reader simply cannot save anything NEW until they are back under the line — the check in
// saveStory() already has exactly that shape, because it compares the current count against
// the current cap and has no opinion about how the count got there.
//
// THE REASON, so nobody has to reconstruct it: we do not take away a reader's saved content.
// They paid £1, they saved twenty stories, the pass ended — deleting nineteen of them would
// be reaching into a device to remove things a reader chose to keep, for a debt of a pound
// that has already been settled. The shelf is on THEIR hardware, in THEIR IndexedDB; the cap
// exists to bound what we encourage them to store, not to police what is already there. And
// the failure modes are not symmetric: a reader carrying a few extra saved stories costs us
// nothing, while a reader who opens the app to find their library culled has been robbed by
// a program.
//
// This is a DECISION, not an oversight, and it is written here because the code cannot show
// it: an eviction sweep would be a new function, and its absence looks identical to nobody
// having thought about it. If a future round adds one, it is reversing this — deliberately,
// with a reason that beats the one above — and not tidying up a loose end.
//
// The honest consequence to keep visible in the UI: an over-cap reader must be told they are
// over, not shown a broken save button with no explanation. ShelfFullError already carries
// the cap for exactly that copy.
export const CAPS = { story: 2, book: 0 };
export const SHELF_CAP = CAPS.story;
export function capFor(kind = 'story') {
  return CAPS[kind] ?? 0;
}

const STORE_SHELF = 'shelf';
const STORE_ASSETS = 'assets';
const STORE_META = 'meta';

const hasIDB = () => typeof indexedDB !== 'undefined';
export const shelfId = (kind, slug) => `${kind}:${slug}`;

// ── the database ─────────────────────────────────────────────────────────────────────────
// NOT versioned by build. The shelf is the reader's own content and must survive every
// deploy — only a SCHEMA change bumps DB_VERSION. (The service worker's caches, by
// contrast, are build-stamped and disposable. Two different lifetimes, deliberately.)
let _dbPromise;
export function openShelf() {
  if (!hasIDB()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SHELF)) {
          const s = db.createObjectStore(STORE_SHELF, { keyPath: 'id' });
          s.createIndex('kind', 'kind');
          s.createIndex('savedAt', 'savedAt');
          // The index every list read uses: one reader's shelf, one kind, in one range scan.
          s.createIndex('uid_kind', ['uid', 'kind']);
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'k' });
        // A future version bump lands here. Never drop STORE_SHELF on upgrade — migrate it.
      };
      req.onsuccess = () => {
        // Another tab opening a newer version must not be blocked by this handle.
        req.result.onversionchange = () => { try { req.result.close(); } catch {} _dbPromise = null; };
        resolve(req.result);
      };
      req.onerror = () => reject(req.error || new Error('Could not open the shelf database'));
      // Private-mode Safari and some lockdown configurations never fire either handler.
      req.onblocked = () => reject(new Error('The shelf database is blocked by another tab'));
    });
    _dbPromise.catch(() => { _dbPromise = null; });
  }
  return _dbPromise;
}

function tx(db, stores, mode) {
  const t = db.transaction(stores, mode);
  const done = new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Shelf transaction aborted'));
  });
  return { t, done };
}
const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// ── reads ────────────────────────────────────────────────────────────────────────────────

// One reader's shelf, newest save first. Returns [] rather than throwing when IndexedDB is
// unavailable (private mode, storage disabled): a shelf that cannot open reads as an empty
// shelf, which the UI already renders honestly. It must never take the page down.
export async function listSaved(uid, kind = 'story') {
  if (!uid) return [];
  try {
    const db = await openShelf();
    const { t } = tx(db, [STORE_SHELF], 'readonly');
    const rows = await wrap(t.objectStore(STORE_SHELF).index('uid_kind').getAll([uid, kind]));
    return (rows || []).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch {
    return [];
  }
}

export async function getSaved(uid, slug, kind = 'story') {
  if (!uid || !slug) return null;
  try {
    const db = await openShelf();
    const { t } = tx(db, [STORE_SHELF], 'readonly');
    const rec = await wrap(t.objectStore(STORE_SHELF).get(shelfId(kind, slug)));
    return rec && rec.uid === uid ? rec : null;
  } catch {
    return null;
  }
}

export async function isSaved(uid, slug, kind = 'story') {
  return !!(await getSaved(uid, slug, kind));
}

export async function shelfCount(uid, kind = 'story') {
  return (await listSaved(uid, kind)).length;
}

// The cover, as an object URL the caller must revoke. Falls back to null so CoverImage
// still paints the blurhash from coverHash — a missing blob degrades to the story's
// colour, never to a hole in the grid.
export async function getCoverURL(record) {
  if (!record?.coverBlobKey) return null;
  try {
    const db = await openShelf();
    const { t } = tx(db, [STORE_ASSETS], 'readonly');
    const row = await wrap(t.objectStore(STORE_ASSETS).get(record.coverBlobKey));
    return row?.blob ? URL.createObjectURL(row.blob) : null;
  } catch {
    return null;
  }
}

// ── the projection ───────────────────────────────────────────────────────────────────────
// What a saved story keeps, and — just as deliberately — what it drops.
//
// DROPPED: extractedText (already stripped server-side; 258 KB of the 1.22 MB node),
// quizMeta, hits, comments, reactions, epubUrl. A saved story is prose and identity, not
// live engagement state. Every one of those fields is either heavy, or stale the moment
// it is written, or belongs to a surface the shelf reader does not render.
export function projectStory(slug, story, uid, extra = {}) {
  const s = story || {};
  return {
    id: shelfId('story', slug),
    kind: 'story',
    slug,
    uid,
    schemaV: SCHEMA_V,
    title: s.title || 'Untitled',
    author: s.author || '',
    authorHandle: s.authorHandle || '',
    authorUid: s.authorUid || '',
    category: s.category || '',
    categoryName: s.categoryName || '',
    subcategory: s.subcategory || '',
    date: s.date || '',
    content: s.content || '',
    cover: s.cover || '',
    coverSizes: s.coverSizes || null,
    // The blurhash earns its keep offline: it renders with zero network and zero blob.
    coverHash: s.coverHash || '',
    readingTime: Number(extra.readingTime) || 0,
    savedAt: Date.now(),
    coverBlobKey: extra.coverBlobKey || null,
  };
}

// Rough byte cost of a record. Not exact — engines store strings at 1–2 bytes/char — but
// honest enough to show a reader what their shelf costs, and it is the number the prune
// reasons about.
function approxBytes(rec, coverBytes = 0) {
  let chars = 0;
  for (const v of Object.values(rec)) if (typeof v === 'string') chars += v.length;
  return chars * 2 + coverBytes;
}

// ── the save ─────────────────────────────────────────────────────────────────────────────
//
// Order matters: the cover is fetched FIRST, before anything is written. A save that
// cannot get its cover is a save that would read as a broken card offline, so it fails
// cleanly and writes nothing rather than half-committing. This is also why the save
// affordance is disabled while offline — see SaveForOffline in the story page.
//
// Throws ShelfFullError when the cap is reached, so the caller can open the full-shelf
// sheet instead of guessing.
export class ShelfFullError extends Error {
  constructor(cap) {
    super(`Your shelf holds ${cap}.`);
    this.name = 'ShelfFullError';
    this.cap = cap;
  }
}

async function fetchCoverBlob(story) {
  // w360 is the rung the cards already serve (see CoverImage) — ~20 KB, and the shelf
  // never renders a cover larger than a card.
  const url = story?.coverSizes?.w360 || story?.coverSizes?.w720 || story?.cover;
  if (!url) return null;
  // Plain cors-mode fetch: the bucket sets access-control-allow-origin for this origin,
  // so the bytes are readable and land in IndexedDB at their real size. (An opaque
  // no-cors response would also replay into an <img>, but Chrome pads opaque cache
  // entries by megabytes, which would make every storage estimate a lie.)
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`Cover fetch failed (${res.status})`);
  const blob = await res.blob();
  if (!blob.size) throw new Error('Cover fetch returned an empty file');
  return { blob, bytes: blob.size, type: blob.type || 'image/webp' };
}

export async function saveStory({ uid, slug, story, readingTime = 0 }) {
  if (!uid) throw new Error('Sign in to save stories.');
  if (!slug || !story) throw new Error('Nothing to save.');

  const kind = 'story';
  // THE ONLY PLACE THE CAP IS ENFORCED — see the ruling above CAPS. This compares the current
  // count against the current cap and has no opinion about how the count got there, which is
  // precisely what lets an over-cap shelf (a lapsed day pass, once capFor takes a tier) sit
  // undisturbed while still refusing anything new. Re-saving a slug already on the shelf is
  // not a new save and is allowed through, so an over-cap reader can still refresh what they
  // have.
  const cap = capFor(kind);
  const existing = await listSaved(uid, kind);
  if (!existing.some((r) => r.slug === slug) && existing.length >= cap) throw new ShelfFullError(cap);

  const cover = await fetchCoverBlob(story);
  const coverBlobKey = cover ? `cover:${slug}:w360` : null;
  const record = projectStory(slug, story, uid, { readingTime, coverBlobKey });
  record.bytes = approxBytes(record, cover?.bytes || 0);

  const db = await openShelf();
  const { t, done } = tx(db, [STORE_SHELF, STORE_ASSETS], 'readwrite');
  t.objectStore(STORE_SHELF).put(record);
  if (cover) t.objectStore(STORE_ASSETS).put({ key: coverBlobKey, blob: cover.blob, type: cover.type, bytes: cover.bytes });
  await done;

  // Ask the browser to stop treating this as disposable. Often granted silently on
  // Chrome/Android and materially deprioritises eviction; a no-op on iOS, where the
  // home-screen nudge is the only real lever. Never blocks the save.
  requestPersistence();
  return record;
}

export async function removeSaved(uid, slug, kind = 'story') {
  const rec = await getSaved(uid, slug, kind);
  if (!rec) return false;
  const db = await openShelf();
  const { t, done } = tx(db, [STORE_SHELF, STORE_ASSETS], 'readwrite');
  t.objectStore(STORE_SHELF).delete(rec.id);
  if (rec.coverBlobKey) t.objectStore(STORE_ASSETS).delete(rec.coverBlobKey);
  await done;
  return true;
}

// ── meta ─────────────────────────────────────────────────────────────────────────────────
// Small durable flags that are neither content nor cache: the iOS nudge's dismissal state,
// the schema stamp, whatever the shelf needs to remember about itself.
export async function getMeta(k, fallback = null) {
  try {
    const db = await openShelf();
    const { t } = tx(db, [STORE_META], 'readonly');
    const row = await wrap(t.objectStore(STORE_META).get(k));
    return row ? row.v : fallback;
  } catch {
    return fallback;
  }
}

export async function setMeta(k, v) {
  try {
    const db = await openShelf();
    const { t, done } = tx(db, [STORE_META], 'readwrite');
    t.objectStore(STORE_META).put({ k, v });
    await done;
    return true;
  } catch {
    return false;
  }
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return true;
  } catch {
    return false;
  }
}

// ── honesty helpers ──────────────────────────────────────────────────────────────────────

// "Saved 3 days ago". A shelf that cannot say when it was filled cannot be judged stale,
// and on iOS a stale shelf is a shelf about to be evicted.
export function savedAgo(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'Saved just now';
  if (mins < 60) return `Saved ${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Saved ${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `Saved ${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `Saved ${months} month${months === 1 ? '' : 's'} ago`;
}

// R9.7 — the same fact as savedAgo(), in the house's voice rather than a log line.
//
// savedAgo() stays exactly as it is: it is the honesty line, and "Saved 3 days ago" is the
// phrasing an iOS eviction warning wants — flat, dated, checkable. This one is for the shelf
// itself, where the fact being stated is possession rather than staleness. "Kept" is the
// difference between a receipt and a bookshelf.
//
// Small numbers are spelled out because the house does: a shelf that says "Kept three days"
// reads as prose, and "Kept 3 days" reads as telemetry. Past ten it goes back to digits,
// which is also the house rule.
const SPELLED = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n) => (n <= 10 ? SPELLED[n] : String(n));

export function keptAgo(ts) {
  if (!ts) return '';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 2) return 'Kept just now';
  if (mins < 60) return `Kept ${count(mins)} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs === 1) return 'Kept an hour ago';
  if (hrs < 24) return `Kept ${count(hrs)} hours ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Kept since yesterday';
  if (days < 30) return `Kept ${count(days)} days`;
  const months = Math.floor(days / 30);
  if (months === 1) return 'Kept a month';
  return `Kept ${count(months)} months`;
}

// iOS Safari clears all script-writable storage after ~7 days without a visit, and the
// only exemption is a site on the Home Screen. Detect the exact population that can act
// on that: iOS, in Safari's browser UI, not already installed.
export function isIOSSafariBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua)
    // iPadOS 13+ reports as a Mac; the touch-point count is what still gives it away.
    || (/Macintosh/.test(ua) && typeof document !== 'undefined' && navigator.maxTouchPoints > 1);
  if (!iOS) return false;
  const standalone = navigator.standalone === true
    || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
  return !standalone;
}
