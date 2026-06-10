'use client';

// Live author DISPLAY-NAME resolution for story surfaces.
//
// Story docs (cms_stories) carry a denormalized `author` string that is frozen
// at publish time. To show an author's CURRENT display name without requiring a
// republish, we read users/{authorUid}/displayName live. To avoid an N+1 across
// list/grid surfaces we collect the DISTINCT authorUids and read each ONCE
// (authors repeat heavily across stories).
//
// Every consumer keeps the frozen `story.author` as the fallback, so stories
// with no authorUid (guests, legacy rows) or any failed read still render a
// name. Nothing here ever throws.
//
// This mirrors how AboutTheAuthor.js resolves Tier 1 (authorUid -> users/{uid}).

// Self-contained, lazy Firebase access — nothing initialises at module eval, so
// it is safe under the static export build.
const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

async function getDB() {
  const { initializeApp, getApps } = await import('firebase/app');
  const app = getApps().length ? getApps()[0] : initializeApp(FB);
  const { getDatabase } = await import('firebase/database');
  return getDatabase(app);
}

const uidOf = (story) =>
  story && story.authorUid ? String(story.authorUid).trim() : '';

// Read each DISTINCT authorUid's current displayName ONCE. Returns a
// { [uid]: displayName } map. Empty/missing reads are omitted so callers fall
// back to the frozen name. Deduped: repeated authors cost a single read.
export async function resolveAuthorNames(storyList) {
  const map = {};
  const uids = [...new Set((storyList || []).map(uidOf).filter(Boolean))];
  if (uids.length === 0) return map;
  try {
    const db = await getDB();
    const { ref, get } = await import('firebase/database');
    await Promise.all(
      uids.map(async (uid) => {
        try {
          const snap = await get(ref(db, `users/${uid}/displayName`));
          const name = snap.exists() ? String(snap.val()).trim() : '';
          if (name) map[uid] = name;
        } catch (e) {
          /* leave this uid unresolved → frozen fallback */
        }
      })
    );
  } catch (e) {
    /* whole resolution failed → empty map → everything falls back to frozen */
  }
  return map;
}

// Per-story current display name: the live resolved name when available, else
// the frozen cms_stories.author (covers no-authorUid, guests, failed reads).
export function currentAuthorName(story, map) {
  const uid = uidOf(story);
  if (uid && map && map[uid]) return map[uid];
  return (story && story.author) || '';
}

// Returns a new list with each story's `author` overwritten by its current
// display name (frozen author preserved as the fallback). Pure — clones each
// story; resolve names into a list with this BEFORE filtering/searching on
// author so searches match the current name.
export function withCurrentAuthorNames(storyList, map) {
  return (storyList || []).map((s) => ({ ...s, author: currentAuthorName(s, map) }));
}
