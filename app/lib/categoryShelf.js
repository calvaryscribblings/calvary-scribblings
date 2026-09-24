'use client';
// W2 / STORY-04 — THE CATEGORY SHELVES' READ, ONCE. /short, /poetry, /flash, /news and /inspiring
// each carried this body verbatim inside a try/catch that logged and left the list at [] — so a
// read that failed, or hung (a get() against an unreachable database never settles), drew
// "0 stories" over an empty grid, for good. It now RETURNS the list or THROWS, and the page's
// useReliableLoad turns a throw or a hang into a designed failure (app/lib/reliableRead.js).
//
// The two enrichments are allowed to fail without failing the shelf: author names fall back to
// the stored byline (resolveAuthorNames has its own deadline), and read counts fall back to 0 —
// but each now has a deadline, because either one hanging used to hang the whole shelf.
import { readWithDeadline } from './reliableRead';
import { ENRICH_DEADLINE_MS, resolveAuthorNames, withCurrentAuthorNames } from './resolveAuthorNames';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

export async function loadCategoryShelf(cat) {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getDatabase, ref, get } = await import('firebase/database');
  const app = getApps().length ? getApps()[0] : initializeApp(FB);
  const db = getDatabase(app);
  const snap = await get(ref(db, 'cms_stories_index'));
  if (!snap.exists()) return [];
  const now = Date.now();
  const cms = Object.entries(snap.val())
    .map(([id, s]) => ({ ...s, id }))
    .filter((s) => s.category === cat && s.published !== false && (!s.publishAt || new Date(s.publishAt).getTime() <= now));
  const nameMap = await resolveAuthorNames(cms);
  const resolved = withCurrentAuthorNames(cms, nameMap);
  // Per-story read counts (stories/{id}/hits) for the "Most Read" sort. Missing → 0.
  let hitsData = {};
  try {
    const hitsSnap = await readWithDeadline(() => get(ref(db, 'stories')), { deadlineMs: ENRICH_DEADLINE_MS });
    if (hitsSnap.exists()) hitsData = hitsSnap.val();
  } catch { /* the sort falls back to 0 reads; the shelf still draws */ }
  return resolved.map((s) => ({ ...s, hits: hitsData[s.id]?.hits || 0 }));
}

/** "12 poems", "1 story" — or a non-breaking space while the count is not known. */
export function countLabel(shelf, n, [one, many]) {
  if (shelf.phase !== 'ready') return ' ';
  return `${n} ${n === 1 ? one : many}`;
}
