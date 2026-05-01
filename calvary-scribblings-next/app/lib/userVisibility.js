'use client';

// Visibility filter for users with isDeleted === true.
//
// During the 7-day grace window after a user requests deletion, their
// content is hidden from public surfaces but still in RTDB. After the
// cron purge runs, the user node is gone and reads return null — which
// also counts as "not visible" because we treat missing user nodes as
// deleted (the post/story they authored is orphaned).
//
// Pattern: fetch users/{uid}/isDeleted in parallel for a known set of
// uids, then post-filter the feed. Cached per page-load (module-level
// Map with a short TTL) to avoid re-reading on every render.

import { ref, get } from 'firebase/database';
import { db } from './firebase';
import { useEffect, useState } from 'react';

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // uid -> { deleted: boolean, ts: number }

function cached(uid) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.deleted;
  return undefined;
}

function store(uid, deleted) {
  cache.set(uid, { deleted, ts: Date.now() });
}

export async function isUserDeleted(uid) {
  if (!uid) return false;
  const c = cached(uid);
  if (c !== undefined) return c;
  try {
    const snap = await get(ref(db, `users/${uid}/isDeleted`));
    const deleted = snap.exists() && snap.val() === true;
    store(uid, deleted);
    return deleted;
  } catch {
    return false;
  }
}

// Batch lookup. Returns Set<uid> of UIDs that are currently deleted.
// Uses cache; only fetches the unknown ones.
export async function getDeletedUidSet(uids) {
  const unique = Array.from(new Set((uids || []).filter(Boolean)));
  const result = new Set();
  const toFetch = [];
  for (const uid of unique) {
    const c = cached(uid);
    if (c === true) result.add(uid);
    else if (c === undefined) toFetch.push(uid);
  }
  if (toFetch.length) {
    const snaps = await Promise.all(
      toFetch.map(uid => get(ref(db, `users/${uid}/isDeleted`)).catch(() => null))
    );
    snaps.forEach((snap, i) => {
      const uid = toFetch[i];
      const deleted = !!(snap && snap.exists() && snap.val() === true);
      store(uid, deleted);
      if (deleted) result.add(uid);
    });
  }
  return result;
}

// React hook: pass an array of uids; returns a Set of deleted ones
// (or null while loading). Re-runs when the joined uid list changes.
export function useDeletedUids(uids) {
  const [deleted, setDeleted] = useState(null);
  const key = (uids || []).filter(Boolean).join(',');
  useEffect(() => {
    let cancelled = false;
    if (!key) { setDeleted(new Set()); return; }
    getDeletedUidSet(key.split(',')).then(s => { if (!cancelled) setDeleted(s); });
    return () => { cancelled = true; };
  }, [key]);
  return deleted;
}

// Invalidate cached entries — call after a user transitions to/from deleted.
export function invalidateUserVisibility(uid) {
  if (uid) cache.delete(uid);
  else cache.clear();
}
