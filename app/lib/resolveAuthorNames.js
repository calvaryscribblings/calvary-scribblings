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

// ─────────────────────────────────────────────────────────────────────────────
// R46 — THE SAME RULE, WIDENED TO THE WHOLE IDENTITY.
//
// resolveAuthorNames() above reads users/{uid}/displayName and nothing else,
// which is right for the fifteen list surfaces that only print a name. The
// search index needs a name AND A PICTURE for the same people, so it takes the
// whole record instead — one read per DISTINCT uid, shared across every block on
// the screen.
//
// ⚠ WHY THIS EXISTS RATHER THAN A STORED COPY. Every identity on this platform
// resolves at render. The measurements that forced the rule:
//
//   · the Square audit found 113 of 118 stored name copies stale, one reader
//     carrying 28 different values for a single field;
//   · Stanley Princewill McDaniels is currently spelled THREE ways in three
//     nodes — cms_voices says "Stanley Princewill Mcdaniels", user_search says
//     "Stanley P. Balogun", and users/{uid} — the record he controls — says
//     "Stanley Princewill McDaniels".
//
// So a copy is never rendered when a uid is in hand. ⚠ If the roster's spelling
// looks wrong on screen, the fix is NOT to edit cms_voices: the roster copy is
// not read for display at all, and correcting it would only make two stale
// copies agree. See app/search/page.js, the VOICES block.
//
// ⚠ ONCE PER DISTINCT UID, NEVER ONCE PER ROW. The search screen's story rows
// and its Voices block overlap almost completely — 9 of the 10 voices are also
// index authors, so the union of 13 author uids and 10 voice uids is 14, not 23.
// Resolving per row would be 171 + 10.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Live { displayName, username, avatarUrl } for each distinct uid, keyed by uid.
 *
 * Never throws and never rejects: a uid that fails to read is simply absent from
 * the map, and every caller is required to have a fallback for that. An empty
 * map is a valid answer and must render a correct (if less current) screen.
 */
export async function resolveIdentities(uidList) {
  const map = {};
  const uids = [...new Set((uidList || []).map((u) => (u ? String(u).trim() : '')).filter(Boolean))];
  if (uids.length === 0) return map;
  try {
    const db = await getDB();
    const { ref, get } = await import('firebase/database');
    await Promise.all(
      uids.map(async (uid) => {
        try {
          const snap = await get(ref(db, `users/${uid}`));
          if (!snap.exists()) return;
          const v = snap.val() || {};
          map[uid] = {
            displayName: String(v.displayName || '').trim(),
            username: String(v.username || v.handle || '').trim(),
            avatarUrl: String(v.avatarUrl || v.photoURL || '').trim(),
          };
        } catch (e) {
          /* leave this uid unresolved → the caller's stored fallback stands */
        }
      })
    );
  } catch (e) {
    /* whole resolution failed → empty map → every row falls back */
  }
  return map;
}
