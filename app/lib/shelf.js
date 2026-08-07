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

// ── THE CAP IS A LOOKUP ON (kind, tier) ──────────────────────────────────────────────────
//
// R11.6. The prediction the previous version of this comment made held: every caller already
// went through capFor(), so the constant became a table and nothing else moved but the two
// call sites that now have a tier to pass.
//
// STORY: Free 2 · Gold 20 · Platinum unlimited.
//
// UNLIMITED IS `Infinity`, NOT null AND NOT -1. The arithmetic then needs no special case
// anywhere: `existing.length >= Infinity` is false for every possible shelf, so the save path
// below is correct for Platinum without a branch. A sentinel would have needed one at every
// comparison, and the one someone forgot would be the one that told a Platinum member their
// shelf was full. The cost is paid in the UI instead, where it is visible: a renderer that
// draws one pip per slot cannot draw Infinity of them, so surfaces call isUnlimitedCap()
// and render a count rather than a denominator. That is a real constraint and it is why the
// helper exists rather than each surface testing for it in its own way.
//
// ── BOOKS ARE 0 ON EVERY TIER, AND THAT IS NOT A MISSING FEATURE ─────────────────────────
//
// "Books uncapped" appears in the pricing notes and means something specific that is easy to
// misread as an unbuilt shelf. THERE IS NO WEB BOOK SHELF TO CAP. A purchased book is
// STREAMING-ONLY on the web by design: master EPUBs are stored `read: false`, and access is a
// 300-second signed URL minted per session by functions/api/bookstore/stream.js. Nothing
// durable lands in the browser, so there is nothing for a cap to bound and a non-zero number
// here would describe storage that does not exist.
//
// The offline book cache lives in the APP, which has its own storage and its own limits, and
// this table does not govern it. So 0 here is the accurate description of the web surface,
// not a placeholder waiting for a feature — do not "finish" it by raising the number, because
// raising it would let saveStory() admit a book the web has no way to store or re-open.
//
// ── SETTLED BEFORE IT WAS BUILT: THE CAP GATES AT SAVE TIME, AND ONLY AT SAVE TIME ───────
//
// Now that capFor takes a tier, a reader on a day pass holds the Gold cap for twenty-four
// hours and can fill it. The pass then expires and their tier falls back, leaving them
// holding MORE SAVED STORIES THAN THEIR CAP ALLOWS — eighteen over, in the worst case.
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
export const CAPS = {
  story: { free: 2, gold: 20, platinum: Infinity },
  book: { free: 0, gold: 0, platinum: 0 },
};

/**
 * How many of `kind` this tier may keep on this device.
 *
 * TOTAL, and it floors to the FREE row rather than to zero. An unknown tier — a typo, a value
 * from a membership record written by something newer than this build — must not silently
 * take away the two slots every signed-in reader has; and it must not hand out twenty either.
 * Free is the honest floor, and it matches normaliseTier() in app/lib/membership.js, which
 * turns anything it does not recognise into 'free' for exactly the same reason.
 *
 * An unknown KIND is 0, which is different on purpose: a tier we cannot read is a reader we
 * can still serve conservatively, while a kind we cannot read is a bug in the caller and
 * should store nothing at all.
 */
export function capFor(kind = 'story', tier = 'free') {
  const row = CAPS[kind];
  if (!row) return 0;
  return row[tier] ?? row.free ?? 0;
}

/**
 * Is this cap unbounded? The one thing a renderer must ask before drawing slots.
 *
 * Exported rather than left to each surface to test, because `cap > 12`, `Number.isFinite(cap)`
 * and `cap === Infinity` are three different guesses at the same question and the pip
 * renderers would have drifted between them. Array.from({ length: Infinity }) throws.
 */
export const isUnlimitedCap = (cap) => !Number.isFinite(cap);

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

/**
 * `tier` IS PASSED IN, NOT LOOKED UP. This module has no React and no Firebase — it cannot
 * call useMembership() and must not open a second subscription of its own to learn something
 * the calling surface already holds. It defaults to 'free' for the same reason capFor() floors
 * there: a caller that forgets to pass one gets the conservative answer, not the generous one.
 */
export async function saveStory({ uid, slug, story, readingTime = 0, tier = 'free' }) {
  if (!uid) throw new Error('Sign in to save stories.');
  if (!slug || !story) throw new Error('Nothing to save.');

  const kind = 'story';
  // THE ONLY PLACE THE CAP IS ENFORCED — see the ruling above CAPS. This compares the current
  // count against the CURRENT cap and has no opinion about how the count got there, which is
  // precisely what lets an over-cap shelf — a day pass that has since lapsed — sit undisturbed
  // while still refusing anything new. Re-saving a slug already on the shelf is not a new save
  // and is allowed through, so an over-cap reader can still refresh what they have.
  //
  // Platinum's cap is Infinity, so the comparison is false for every possible shelf and the
  // ShelfFullError below is unreachable for them without a branch saying so.
  const cap = capFor(kind, tier);
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
