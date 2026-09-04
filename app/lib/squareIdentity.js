'use client';

// IDENTITY AT RENDER — R33.2.
//
// THE FAULT THIS REPLACES: identity in the Square was a photograph, not a link.
// Every post stored a COPY of its author's name, handle, picture, initials,
// read count and writer flag at the moment it was written, and nothing ever
// refreshed it. Measured on the 115 live posts before this was built:
//
//   112 (97%)  carry a stale authorReadCount — and that is the ISLAND BADGE's
//              number, so the badge is simply wrong on almost every post. One
//              reader's badge claimed 4 reads against 124 actually read.
//    23        carry a display name the reader has since changed.
//    19        carry no handle at all, for readers who now have one.
//    15        show initials for readers who now have a picture.
//     8        point at an avatar URL that has since been replaced.
//
// Six surfaces drew from those copies, so the same reader appeared six slightly
// different ways in one room. Resolving from the record at render fixes every
// surface and every drift in one change, and means a reader who changes their
// picture changes it everywhere — which is what "in every aspect of the square"
// actually asks for.
//
// COST. Bounded by DISTINCT AUTHORS, not by posts: ~22 readers across 115 posts
// today. Each record is fetched once and cached for the page load, so a busy
// night with 200 posts from 30 people is 30 reads, not 200.
//
// THE STORED COPY IS STILL THE FALLBACK, and deliberately: an account that has
// been hard-deleted has no record to resolve against, and its old posts should
// still say who wrote them rather than collapsing to "Reader".

import { ref, get } from 'firebase/database';

const TTL_MS = 60_000;
const cache = new Map(); // uid -> { at, value }
const inflight = new Map();

/** What every Square surface needs to draw one reader, from one place. */
export function identityOf(post, resolved) {
  const r = resolved || null;
  return {
    uid: post.authorUid,
    // Live first, stored copy second. `|| null` rather than `??` on purpose:
    // an empty-string handle is as absent as a missing one.
    displayName: (r && (r.displayName || r.handle || r.username)) || post.authorName || 'Reader',
    handle: (r && (r.username || r.handle)) || post.authorHandle || null,
    avatarUrl: (r && (r.avatarUrl || r.photoURL)) || post.authorAvatarUrl || null,
    readCount: r && typeof r.readCount === 'number' ? r.readCount : (post.authorReadCount || 0),
    isAuthor: r ? r.isAuthor === true : post.isAuthor === true,
    initials: initialsFrom(
      (r && (r.displayName || r.handle || r.username)) || post.authorName || 'Reader',
      post.authorInitials
    ),
    // True when we are drawing the stored copy because the record is gone.
    stale: !r,
  };
}

function initialsFrom(name, fallback) {
  const s = String(name || '').trim();
  if (!s) return fallback || 'R';
  return s.split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

/**
 * Fetch the records for a set of uids, once each, cached.
 * Concurrent callers for the same uid share one request.
 */
export async function resolveIdentities(db, uids) {
  const want = [...new Set((uids || []).filter(Boolean))];
  const now = Date.now();
  const out = new Map();
  const need = [];

  for (const uid of want) {
    const hit = cache.get(uid);
    if (hit && now - hit.at < TTL_MS) out.set(uid, hit.value);
    else need.push(uid);
  }

  await Promise.all(need.map(async (uid) => {
    if (inflight.has(uid)) { out.set(uid, await inflight.get(uid)); return; }
    const p = (async () => {
      try {
        const snap = await get(ref(db, `users/${uid}`));
        const v = snap.exists() ? snap.val() : null;
        cache.set(uid, { at: Date.now(), value: v });
        return v;
      } catch {
        // A read that fails must not blank the room — fall through to the
        // stored copy, which is what identityOf() does with null.
        cache.set(uid, { at: Date.now(), value: null });
        return null;
      } finally {
        inflight.delete(uid);
      }
    })();
    inflight.set(uid, p);
    out.set(uid, await p);
  }));

  return out;
}

/** Drop the cache — used when a reader edits their own profile mid-session. */
export function forgetIdentity(uid) {
  if (uid) cache.delete(uid); else cache.clear();
}
