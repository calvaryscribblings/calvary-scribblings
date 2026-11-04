'use client';
// NOTIF-B2 — the bell's live data, shared. One set of listeners per signed-in reader however many
// bells are on the page (the header draws one at phone width and one at desktop width, and the
// Square has its own): every bell and the page subscribe to the same store.
//
// THE READS, every one bounded (app/lib/bell.js READ_LIMITS):
//   inbox/{uid}                  orderByChild('at').limitToLast(100)       (.indexOn at)
//   announcements                orderByChild('at').limitToLast(30)        (.indexOn at)
//   library_notifications/{uid}  orderByChild('createdAt').limitToLast(100) (.indexOn createdAt)
//   notifications/{uid}          orderByChild('createdAt').limitToLast(100) (.indexOn createdAt)
//   following/{uid}              limitToFirst(1000)   — FROM A WRITER YOU FOLLOW (ruling 323)
//   inbox_state/{uid}/seenAt     the count's line (ruling 326)
//   blocked_users/{uid}, muted_users/{uid}   who never appears (ruling 328's list half)
// Names, avatars, titles and covers are drawn live per row (useBellDetails), never stored.
//
// OPENING (markSeen): seenAt goes to now, so the count clears; the rows that arrived after the
// PREVIOUS seenAt keep their violet dot for as long as the panel or page stays open. The old notes
// on screen are also marked read, as the old panels did, so the app's two old bells agree.

import { useEffect, useMemo, useState, useSyncExternalStore, useCallback } from 'react';
import { buildList, unreadCount, READ_LIMITS, isUnread } from './bell';
import { hiddenUids } from './squareSafety';

const EMPTY = Object.freeze({ ready: false, list: [], unread: 0, seenAt: null, prevSeen: null, joinedAt: 0 });

function createStore(uid, joinedAt) {
  const state = { inbox: {}, announcements: {}, library: {}, square: {}, following: {}, blocked: {}, muted: {}, seenAt: undefined, loaded: new Set() };
  const listeners = new Set();
  let snapshot = { ...EMPTY, joinedAt };
  let offs = [];
  let prevSeen = null;   // the seenAt before this session's last open: the dots
  const SOURCES = ['inbox', 'announcements', 'library', 'square', 'following', 'blocked', 'muted', 'seenAt'];

  const recompute = () => {
    const hidden = hiddenUids(state.muted, state.blocked);
    const list = buildList(state, { hidden, followed: state.following });
    const seenAt = typeof state.seenAt === 'number' ? state.seenAt : null;
    snapshot = {
      ready: SOURCES.every((s) => state.loaded.has(s)),
      list, seenAt, joinedAt,
      prevSeen,
      unread: unreadCount(list, seenAt, joinedAt),
    };
    for (const l of listeners) l();
  };

  async function start() {
    const { db } = await import('./firebaseCore');
    const { ref, query, orderByChild, limitToLast, limitToFirst, onValue } = await import('firebase/database');
    const watch = (name, q, pick = (v) => v || {}) => {
      offs.push(onValue(q, (snap) => { state[name] = pick(snap.val()); state.loaded.add(name); recompute(); },
        // A source that can't be read counts as empty: the bell shows the rest, never nothing.
        () => { state[name] = name === 'seenAt' ? null : {}; state.loaded.add(name); recompute(); }));
    };
    watch('inbox', query(ref(db, `inbox/${uid}`), orderByChild('at'), limitToLast(READ_LIMITS.inbox)));
    watch('announcements', query(ref(db, 'announcements'), orderByChild('at'), limitToLast(READ_LIMITS.announcements)));
    watch('library', query(ref(db, `library_notifications/${uid}`), orderByChild('createdAt'), limitToLast(READ_LIMITS.library)));
    watch('square', query(ref(db, `notifications/${uid}`), orderByChild('createdAt'), limitToLast(READ_LIMITS.square)));
    watch('following', query(ref(db, `following/${uid}`), limitToFirst(READ_LIMITS.following)));
    watch('blocked', ref(db, `blocked_users/${uid}`));
    watch('muted', ref(db, `muted_users/${uid}`));
    watch('seenAt', ref(db, `inbox_state/${uid}/seenAt`), (v) => (typeof v === 'number' ? v : null));
  }

  return {
    uid,
    subscribe(l) {
      listeners.add(l);
      if (listeners.size === 1 && !offs.length) start().catch(() => {});
      return () => {
        listeners.delete(l);
        // Kept for a moment after the last bell unmounts: a navigation re-mounts the header at once.
        if (!listeners.size) setTimeout(() => { if (!listeners.size) { offs.forEach((o) => o()); offs = []; state.loaded.clear(); } }, 30000);
      };
    },
    get: () => snapshot,
    /** Opening the panel or the page: the count clears, and what was new keeps its dot. */
    async markSeen(now = Date.now()) {
      const before = typeof state.seenAt === 'number' ? state.seenAt : null;
      const dots = snapshot.list.filter((r) => isUnread(r, before, joinedAt));
      prevSeen = before === null ? (dots.length ? Math.min(...dots.map((r) => r.at)) - 1 : now) : before;
      state.seenAt = now;
      recompute();
      const { db } = await import('./firebaseCore');
      const { ref, update } = await import('firebase/database');
      try { await update(ref(db, `inbox_state/${uid}`), { seenAt: now }); } catch (e) { console.error('[bell] seenAt not saved:', e?.code || e?.message || e); }
      // The app's two old bells read each note's own `read`: mark the ones shown, as the old panels did.
      const lib = {}, sq = {};
      for (const r of snapshot.list) {
        if (r.legacyRead !== false || !r.legacyId) continue;
        (r.source === 'library_notifications' ? lib : sq)[`${r.legacyId}/read`] = true;
      }
      if (Object.keys(lib).length) update(ref(db, `library_notifications/${uid}`), lib).catch(() => {});
      if (Object.keys(sq).length) update(ref(db, `notifications/${uid}`), sq).catch(() => {});
    },
  };
}

const stores = new Map();
function storeFor(uid, joinedAt) {
  if (!uid) return null;
  let s = stores.get(uid);
  if (!s) { s = createStore(uid, joinedAt); stores.set(uid, s); }
  return s;
}

const noopSub = () => () => {};
const emptyGet = () => EMPTY;

/** The signed-in reader's bell: { ready, list, unread, seenAt, prevSeen, markSeen }. */
export function useBell(user) {
  const uid = user?.uid || null;
  const joined = Date.parse(user?.metadata?.creationTime || '') || 0;
  const store = useMemo(() => storeFor(uid, joined), [uid, joined]);
  const snap = useSyncExternalStore(store ? store.subscribe : noopSub, store ? store.get : emptyGet, emptyGet);
  const markSeen = useCallback((now) => store?.markSeen(now), [store]);
  return { ...snap, markSeen };
}

// ── the rows' live details ────────────────────────────────────────────────────────────────────
// Who (users/{uid}), the story's title and cover (cms_stories_index/{slug}), an instalment's
// title and its series' poster, a response's words. Read only for the rows on screen, each once.

const cache = { users: new Map(), stories: new Map(), instalments: new Map(), series: new Map(), quotes: new Map() };
const inflight = new Map();
/** Read once into the cache; a read that fails caches null (the row draws without it). */
function load(kind, key, read) {
  const id = `${kind}|${key}`;
  if (cache[kind].has(key)) return Promise.resolve();
  if (inflight.has(id)) return inflight.get(id);
  const p = read().then((v) => { cache[kind].set(key, v ?? null); }, () => { cache[kind].set(key, null); }).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

export function useBellDetails(rows) {
  const [, bump] = useState(0);
  const wantKey = rows.map((r) => r.key).join(',');
  useEffect(() => {
    let live = true;
    (async () => {
      const { db } = await import('./firebaseCore');
      const { ref, get } = await import('firebase/database');
      const val = async (path) => (await get(ref(db, path))).val();
      const jobs = [];
      for (const r of rows) {
        for (const u of [r.actor, r.actors?.[1], r.writer].filter(Boolean)) jobs.push(load('users', u, () => val(`users/${u}`)));
        const slug = r.needsStory || r.needsTitle;
        if (slug) jobs.push(load('stories', slug, () => val(`cms_stories_index/${slug}`)));
        if (r.needsInstalment) {
          const { id, seriesId } = r.needsInstalment;
          jobs.push(load('instalments', id, () => val(`series_instalments_detail/${id}`)));
          if (seriesId) jobs.push(load('series', seriesId, () => val(`series/${seriesId}`)));
        }
        if (r.needsQuote && !r.quote) {
          const { slug: s, commentId } = r.needsQuote;
          jobs.push(load('quotes', `${s}/${commentId}`, () => val(`comments/${s}/${commentId}/text`)));
        }
      }
      await Promise.all(jobs);
      if (live) bump((n) => n + 1);
    })().catch(() => {});
    return () => { live = false; };
    // rows is described exactly by its keys
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantKey]);

  // undefined while a read is in flight; null when it found nothing.
  return {
    user: (uid) => cache.users.get(uid),
    story: (slug) => cache.stories.get(slug),
    instalment: (id) => cache.instalments.get(id),
    series: (id) => cache.series.get(id),
    quote: (slug, cid) => cache.quotes.get(`${slug}/${cid}`),
  };
}
