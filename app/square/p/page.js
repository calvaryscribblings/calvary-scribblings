'use client';

// THE THREAD — W52. /square/p?id={root} (R33.2's permalink, now the thread itself).
//
// ⚠ WHY ?id= AND NOT /square/p/<id>. next.config.mjs sets `output: 'export'`, so
// every dynamic segment must be enumerated at build time by generateStaticParams.
// A permalink for a post that does not exist yet cannot be — it would need a site
// rebuild per post, which is the same publish-to-deploy gap that had bookstore
// pages answering 404 for days. One static page reading a query string has no
// such gap and resolves any post ever written, including one archived tonight.
//
// READS THE ROOM, THEN THE ARCHIVE. Clearing is a horizon, not a deletion, so a
// post past the horizon is still there to be shown — with its replies, its
// identity, and a line saying plainly that it has left the Square and when.
//
// ⭑ W52 — INTERACTIVE ONLY WHEN ALL THREE HOLD: the post is in the room (square_posts, not the
// archive), the room is open (20:00–24:00 London), and the reader is signed in. Otherwise the
// thread reads exactly as the permalink always did. ?id= may name a reply: the page opens its
// root's thread at that reply (older links and notifications carry a reply's id), and so does
// &reply=. The shape of a thread — two levels, the fold, the tombstones, who is notified — is
// decided in app/lib/squareThreads.js, where the tests can reach it.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Avatar, UserBadge, timeAgo, ReactionRow, SQUARE_REACTIONS } from '../../components/conversation/ConversationKit';
import { resolveIdentities, identityOf } from '../../lib/squareIdentity';
import PostBody from '../../components/conversation/PostBody';
import AttachmentCard from '../../components/conversation/AttachmentCard';
import { PostMenu, ReportModal } from '../../components/conversation/SquarePostMenu';
import { attachmentOf, refusalFor, showCounter, MAX_REPLY_CHARS } from '../../lib/squarePostBody';
import { isTombstone, announcedPieceOf, DELETED_POST } from '../../lib/deletedContent';
import { mentionHandles, resolveHandle, matchReaders } from '../../lib/squareHandles';
import { keyboardInset } from '../../lib/composerRail';
import {
  buildThread, foldNested, isRemoved, isHiddenBy, removedNote, replyNotifications, threadHref, THREAD_COPY,
} from '../../lib/squareThreads';
import ReaderCard from '../../components/square/ReaderCard';
import useSafety from '../../components/square/useSafety';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};
async function getApp() {
  const { initializeApp, getApps } = await import('firebase/app');
  return getApps().length ? getApps()[0] : initializeApp(FB);
}
async function getDB() { const { getDatabase } = await import('firebase/database'); return getDatabase(await getApp()); }
async function getFirebaseAuth() { const { getAuth } = await import('firebase/auth'); return getAuth(await getApp()); }

const FF = 'Cormorant Garamond, Georgia, serif';
const GROUND = '#0a0a0a';
const INK = (a) => `rgba(245,240,232,${a})`;
const GOLD = '#c9a84c';
const CONNECTOR = 'rgba(201,168,76,0.32)';
const HANDLE = '#a989d9';
const NOT_SENT = '#d4537e';
const BAR = '#0b0815';
const ANSWERING_TINT = 'rgba(107,47,173,0.10)';

function roomOpen() {
  const h = parseInt(new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }), 10);
  return h >= 20 && h < 24;
}

// Text stays per thread: a reader who starts a reply here, opens another thread and comes back
// finds their words where they left them, and never in the other thread's box.
const DRAFT_KEY = (rootId) => `cs_square_reply_${rootId}`;
const readDraft = (rootId) => { try { return sessionStorage.getItem(DRAFT_KEY(rootId)) || ''; } catch { return ''; } };
const writeDraft = (rootId, v) => { try { if (v) sessionStorage.setItem(DRAFT_KEY(rootId), v); else sessionStorage.removeItem(DRAFT_KEY(rootId)); } catch {} };

function Header() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr 44px', alignItems: 'center', marginBottom: '1.25rem' }}>
      <a href="/square" aria-label={THREAD_COPY.back} title={THREAD_COPY.back}
        style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', color: INK(0.8), textDecoration: 'none' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
      </a>
      <div style={{ textAlign: 'center', fontFamily: "'Cinzel', 'Cormorant Garamond', Georgia, serif", fontSize: '0.95rem', letterSpacing: '0.24em', color: '#f5f0e8' }}>THE SQUARE</div>
      <span />
    </div>
  );
}

function Shell({ children, bottomPad = '6rem' }) {
  return (
    <div style={{ minHeight: '100vh', background: GROUND, color: '#f5f0e8', padding: `1.25rem 1rem ${bottomPad}` }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <Header />
        <div>{children}</div>
      </div>
    </div>
  );
}

function NameLine({ post, who, onMenu, onOpen }) {
  const id = who(post);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 3 }}>
      {/* W53 — the name opens the reader card. */}
      <button type="button" onClick={() => onOpen?.(post.authorUid)} data-reader-open={post.authorUid}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#f5f0e8', fontFamily: FF, fontWeight: 500, fontSize: '0.95rem' }}>{id.displayName}</button>
      {id.handle && <span style={{ fontFamily: FF, fontSize: '0.75rem', color: INK(0.45) }}>@{id.handle}</span>}
      <UserBadge uid={post.authorUid} readCount={id.readCount} isAuthor={id.isAuthor} />
      <span style={{ fontFamily: FF, fontSize: '0.75rem', color: INK(0.42) }}>· {timeAgo(post.createdAt)}{post.edited && <span style={{ color: INK(0.25) }}> · edited</span>}</span>
      {onMenu}
    </div>
  );
}

// A removed reply, drawn only while replies hang beneath it: a dashed circle where the face was,
// and who removed it. Ruling 30's deleted-account tombstone keeps its own words.
// W53 / ruling 207 — a reply by a reader you've muted or blocked, holding up replies you can see,
// is drawn the same way: "A reply you've hidden."
function Tombstone({ post, size, hiddenByYou = false }) {
  return (
    <div data-reply-tombstone={hiddenByYou ? 'hidden' : post.removedBy || (post.deleted ? 'deleted' : 'author')} style={{ display: 'flex', gap: 10, alignItems: 'center', minHeight: size }}>
      <div aria-hidden="true" style={{ width: size, height: size, flex: 'none', borderRadius: '50%', border: `1.5px dashed ${INK(0.28)}` }} />
      <div style={{ fontFamily: FF, fontStyle: 'italic', fontSize: '0.92rem', color: INK(0.45) }}>
        {hiddenByYou ? THREAD_COPY.hiddenReply : post.deleted ? DELETED_POST : removedNote(post)}
      </div>
    </div>
  );
}

function Thread() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id');
  const replyParam = params.get('reply');
  const [state, setState] = useState({ phase: 'loading' });
  const [replies, setReplies] = useState([]);
  const [identities, setIdentities] = useState({});
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [open, setOpen] = useState(false);
  const [reactions, setReactions] = useState({});
  const [expanded, setExpanded] = useState(() => new Set());
  const [ownSent, setOwnSent] = useState(() => new Set());
  const [failed, setFailed] = useState([]);          // replies that did not save, waiting in place
  const [answering, setAnswering] = useState(null);  // the reply being answered, or null
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const fieldRef = useRef(null);
  const [inset, setInset] = useState(0);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionRows, setMentionRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState('');
  const [editErr, setEditErr] = useState('');
  const [reporting, setReporting] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const scrolledTo = useRef(false);
  const [cardUid, setCardUid] = useState(null);
  const openReader = useCallback((uid) => { if (uid) setCardUid(uid); }, []);

  // ── where the thread lives ──────────────────────────────────────────────────
  useEffect(() => {
    if (!id) { setState({ phase: 'missing' }); return; }
    let cancelled = false;
    const offs = [];
    (async () => {
      try {
        const db = await getDB();
        const { ref, get, query, orderByChild, equalTo, onValue, onChildAdded, onChildChanged, onChildRemoved } = await import('firebase/database');
        // The room first, then the archive. A post is in exactly one of them.
        let where = 'square_posts';
        let snap = await get(ref(db, `square_posts/${id}`));
        if (!snap.exists()) { where = 'square_archive'; snap = await get(ref(db, `square_archive/${id}`)); }
        if (!snap.exists()) { if (!cancelled) setState({ phase: 'gone' }); return; }
        const post = { id, ...snap.val() };
        // Replies live beside their parent in whichever node holds the thread —
        // the horizon moves a thread whole, so they are never split across the two.
        const rootId = post.parentId || id;
        let root = post;
        if (post.parentId) {
          const rs = await get(ref(db, `${where}/${rootId}`));
          root = rs.exists() ? { id: rootId, ...rs.val() } : { id: rootId, authorUid: null, createdAt: post.createdAt, missing: true };
        }
        const focusId = replyParam || (post.parentId ? id : null);
        if (cancelled) return;
        // The canonical address: the root, opening at the reply.
        try { const want = threadHref(rootId, focusId); if (`${location.pathname}${location.search}` !== want) history.replaceState(null, '', want); } catch {}
        setText(readDraft(rootId));
        setState({ phase: 'ok', root, where, archived: where === 'square_archive', focusId });

        const q = query(ref(db, where), orderByChild('parentId'), equalTo(rootId));
        if (where === 'square_archive') {
          const sibs = await get(q);
          if (!cancelled) setReplies(sibs.exists() ? Object.entries(sibs.val()).map(([k, v]) => ({ id: k, ...v })) : []);
          return;
        }
        // In the room the thread is live: a reply, an edit or a removal lands as it happens.
        const seen = new Map();
        const flush = () => { if (!cancelled) setReplies([...seen.values()]); };
        offs.push(onChildAdded(q, (s) => { seen.set(s.key, { id: s.key, ...s.val() }); flush(); }));
        offs.push(onChildChanged(q, (s) => { seen.set(s.key, { id: s.key, ...s.val() }); flush(); }));
        offs.push(onChildRemoved(q, (s) => { seen.delete(s.key); flush(); }));
        offs.push(onValue(ref(db, `square_posts/${rootId}`), (s) => {
          if (cancelled) return;
          if (s.exists()) setState((st) => (st.phase === 'ok' ? { ...st, root: { id: rootId, ...s.val() } } : st));
          else setState((st) => (st.phase === 'ok' && !st.root.missing ? { ...st, where: 'gone-live', interactiveLost: true } : st));
        }));
        const rx = ref(db, 'square_reactions');
        const absorb = (s) => setReactions((prev) => ({ ...prev, [s.key]: s.val() || {} }));
        offs.push(onChildAdded(rx, absorb));
        offs.push(onChildChanged(rx, absorb));
        offs.push(onChildRemoved(rx, (s) => setReactions((prev) => { const n = { ...prev }; delete n[s.key]; return n; })));
      } catch {
        if (!cancelled) setState({ phase: 'error' });
      }
    })();
    return () => { cancelled = true; offs.forEach((off) => { try { off(); } catch {} }); };
  }, [id, replyParam]);

  // ── who is reading ──────────────────────────────────────────────────────────
  useEffect(() => {
    let off = null;
    let cancelled = false;
    (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      if (cancelled) return;
      off = onAuthStateChanged(auth, async (u) => {
        setUser(u);
        setUserData(null);
        if (!u) return;
        try {
          const db = await getDB();
          const { ref, get } = await import('firebase/database');
          const s = await get(ref(db, `users/${u.uid}`));
          if (!cancelled && s.exists()) setUserData(s.val());
        } catch (e) { console.error('Reader lookup error:', e); }
      });
    })();
    return () => { cancelled = true; if (off) off(); };
  }, []);

  // ── the room's hours ────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setOpen(roomOpen());
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, []);

  // ── the bar rides the visual viewport, so the phone keyboard never covers it ─
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    let raf = 0;
    const measure = () => { raf = 0; setInset(keyboardInset({ innerHeight: window.innerHeight, height: vv.height, offsetTop: vv.offsetTop })); };
    const onChange = () => { if (!raf) raf = requestAnimationFrame(measure); };
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    measure();
    return () => { vv.removeEventListener('resize', onChange); vv.removeEventListener('scroll', onChange); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const root = state.phase === 'ok' ? state.root : null;
  const rootId = root?.id || null;

  // ── identity at render (ruling 203) ─────────────────────────────────────────
  const uidKey = useMemo(() => [...new Set([root?.authorUid, ...replies.map((r) => r.authorUid)].filter(Boolean))].sort().join(','), [root?.authorUid, replies]);
  useEffect(() => {
    if (!uidKey) return;
    let cancelled = false;
    (async () => {
      const db = await getDB();
      const map = await resolveIdentities(db, uidKey.split(','));
      if (!cancelled) setIdentities(Object.fromEntries(map));
    })();
    return () => { cancelled = true; };
  }, [uidKey]);
  const who = (p) => identityOf(p, identities[p.authorUid]);

  const interactive = !!(root && state.where === 'square_posts' && open && user && !root.missing);
  // W53 — this reader's mute and block lists: those readers' replies are hidden (ruling 207).
  const safety = useSafety(user?.uid || null);
  const hidden = safety.hidden;
  const canRemove = userData?.canRemovePosts === true;

  // Failed replies are drawn in place, as records of the thread, until sent or removed.
  const thread = useMemo(() => buildThread([...replies, ...failed], { hidden }), [replies, failed, hidden]);
  const keep = useMemo(() => new Set([...ownSent, ...failed.map((f) => f.id)]), [ownSent, failed]);

  // Open at the reply the link names, once it has arrived.
  useEffect(() => {
    if (scrolledTo.current || state.phase !== 'ok' || !state.focusId) return;
    const el = document.getElementById(`r-${state.focusId}`);
    if (!el) {
      // A link to a nested reply that sits behind the fold: open that group.
      const top = thread.byId.get(state.focusId);
      if (top) {
        const g = thread.groups.find((x) => x.nested.some((n) => n.id === state.focusId));
        if (g && !expanded.has(g.top.id)) setExpanded((s) => new Set([...s, g.top.id]));
      }
      return;
    }
    scrolledTo.current = true;
    el.scrollIntoView({ block: 'center' });
  }, [state, thread, expanded]);

  // ── the box ─────────────────────────────────────────────────────────────────
  const setBox = (v) => {
    setText(v);
    if (rootId) writeDraft(rootId, v);
    const m = v.match(/@(\w*)$/);
    setMentionQuery(m ? m[1] : '');
  };
  useEffect(() => {
    if (!mentionQuery) { setMentionRows([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'user_search'));
        if (!cancelled) setMentionRows(matchReaders(snap.val(), mentionQuery, { fields: ['username'] }));
      } catch (e) { console.error('Mention lookup error:', e); if (!cancelled) setMentionRows([]); }
    })();
    return () => { cancelled = true; };
  }, [mentionQuery]);
  const pickMention = (username) => { setBox(text.replace(/@\w*$/, `@${username} `)); setMentionQuery(''); fieldRef.current?.focus(); };

  const answer = (r) => {
    setAnswering(r);
    setTimeout(() => fieldRef.current?.focus(), 30);
  };

  // A reply's readers hear after it saved, never instead of it. Logged, never shown as a failure.
  const tellReaders = async (db, key, body, target) => {
    const { ref, push, get, set } = await import('firebase/database');
    const record = { text: body, authorUid: user.uid, parentId: rootId, createdAt: Date.now() };
    if (target) record.replyToId = target.id;
    await set(ref(db, `user_square_posts/${user.uid}/${key}`), record);
    const mentioned = [];
    for (const h of mentionHandles(body)) {
      const uid = await resolveHandle(h, async (k) => (await get(ref(db, `usernames/${k}`))).val());
      if (uid) mentioned.push(uid);
    }
    const from = {
      fromUid: user.uid, fromName: user.displayName || 'Reader',
      fromUsername: userData?.username || null, fromAvatarUrl: userData?.avatarUrl || null,
    };
    for (const n of replyNotifications({ me: user.uid, rootAuthorUid: root.authorUid, replyToAuthorUid: target?.authorUid || null, mentionedUids: mentioned })) {
      // One at a time, each on its own: the rules refuse one to a reader who has blocked this one (W53).
      try { await push(ref(db, `notifications/${n.uid}`), { type: n.type, ...from, postId: key, threadId: rootId, read: false, createdAt: Date.now() }); }
      catch (e) { console.error('Notification not sent:', e?.code || e?.message || e); }
    }
  };

  const send = useCallback(async ({ body, target, retryOf = null }) => {
    if (!user || !rootId || sendingRef.current) return;
    if (!refusalFor(body, { isReply: true }).ok) return;
    sendingRef.current = true;
    setSending(true);
    // ⚠ W51 — THE BOX CLEARS WHEN THE SAVE IS WRITTEN, NOT BEFORE: push() resolves on the
    // server's acknowledgement. The words stay in the box while the write is in flight.
    const clearBox = () => { setBox(''); setAnswering(null); setMentionQuery(''); };
    try {
      const db = await getDB();
      const { ref, push } = await import('firebase/database');
      const data = {
        text: body, authorUid: user.uid, authorName: user.displayName || 'Reader',
        authorInitials: (user.displayName || 'R').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase(),
        authorAvatarUrl: userData?.avatarUrl || null, authorHandle: userData?.username || '', authorReadCount: userData?.readCount || 0,
        isAuthor: userData?.isAuthor || false, parentId: rootId, likeCount: 0,
        pinned: false, unpinnedAt: null, createdAt: Date.now(),
      };
      if (target) data.replyToId = target.id;
      const saved = await push(ref(db, 'square_posts'), data);
      if (!retryOf) clearBox();
      if (retryOf) setFailed((f) => f.filter((x) => x.id !== retryOf));
      setOwnSent((s) => new Set([...s, saved.key]));
      tellReaders(db, saved.key, body, target).catch((e) => console.error('After-save error (the reply itself was saved):', e));
    } catch (e) {
      console.error('Reply error:', e);
      // Not sent: the words move out of the box and wait in the thread, where they were going,
      // at half opacity, with Try again and Remove.
      if (!retryOf) {
        clearBox();
        setFailed((f) => [...f, {
          id: `unsent-${Date.now()}`, unsent: true, text: body, authorUid: user.uid, parentId: rootId,
          replyToId: target?.id || undefined, createdAt: Date.now(), target,
        }]);
      }
    }
    sendingRef.current = false;
    setSending(false);
    // setBox is stable enough: it closes over rootId, which is a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userData, rootId, root]);

  // ── reactions, as the feed does them (W13) ──────────────────────────────────
  const counts = useMemo(() => Object.fromEntries([root, ...replies].filter(Boolean).map((p) => [p.id, p])), [root, replies]);
  const [bumps, setBumps] = useState({});
  const toggleReaction = async (p, type) => {
    if (!user) return;
    const mine = !!reactions[p.id]?.[type]?.[user.uid];
    const base = (bumps[p.id]?.[type] ?? counts[p.id]?.[`${type}Count`]) || 0;
    const apply = (on, count) => {
      setReactions((prev) => ({ ...prev, [p.id]: { ...prev[p.id], [type]: { ...(prev[p.id]?.[type] || {}), [user.uid]: on || undefined } } }));
      setBumps((prev) => ({ ...prev, [p.id]: { ...prev[p.id], [type]: count } }));
    };
    apply(!mine, mine ? Math.max(0, base - 1) : base + 1);
    const db = await getDB();
    const { ref, set, remove, runTransaction, push } = await import('firebase/database');
    try {
      if (mine) { await remove(ref(db, `square_reactions/${p.id}/${type}/${user.uid}`)); await runTransaction(ref(db, `square_posts/${p.id}/${type}Count`), (c) => Math.max(0, (c || 0) - 1)); }
      else { await set(ref(db, `square_reactions/${p.id}/${type}/${user.uid}`), true); await runTransaction(ref(db, `square_posts/${p.id}/${type}Count`), (c) => (c || 0) + 1); }
    } catch (e) { apply(mine, base); throw e; }
    if (!mine && p.authorUid && p.authorUid !== user.uid) {
      try {
        await push(ref(db, `notifications/${p.authorUid}`), {
          type, fromUid: user.uid, fromName: user.displayName || 'Reader',
          fromUsername: userData?.username || null, fromAvatarUrl: userData?.avatarUrl || null,
          postId: p.id, threadId: rootId, read: false, createdAt: Date.now(),
        });
      } catch (e) { console.error('Reaction notification error:', e); }
    }
  };
  const activeOf = (p) => {
    const r = reactions[p.id] || {};
    return user ? Object.fromEntries(['like', 'clap', 'fire'].map((t) => [t, !!r[t]?.[user.uid]])) : {};
  };
  // A live echo carries the true count, so it supersedes the optimistic one.
  useEffect(() => { setBumps({}); }, [replies, root]);
  const withCounts = (p) => ({ ...p, ...Object.fromEntries(Object.entries(bumps[p.id] || {}).map(([t, c]) => [`${t}Count`, c])) });

  // ── withdraw, remove, edit, report ──────────────────────────────────────────
  // W52 — a reply is never hard-deleted. Its words and attachments go; the record stays as a
  // tombstone saying whose hand it was, drawn only while replies hang beneath it.
  const handleDelete = async (p) => {
    const mine = user?.uid === p.authorUid;
    const db = await getDB();
    const { ref, update, remove } = await import('firebase/database');
    if (p.parentId) {
      if (!confirm(mine ? 'Withdraw this reply?' : 'Remove this reply?')) return;
      try {
        await update(ref(db, `square_posts/${p.id}`), {
          text: null, attachedStory: null, attachedOpenPage: null, quotedPostId: null,
          withdrawn: true, withdrawnAt: Date.now(), removedBy: mine ? 'author' : 'moderator',
        });
        if (mine) await remove(ref(db, `user_square_posts/${p.authorUid}/${p.id}`)).catch(() => {});
      } catch (e) { console.error('Withdraw error:', e); alert('That didn’t go through. Nothing was changed.'); }
      return;
    }
    // The root: as the feed does it (R33.2) — withdrawn while replies stand beneath it.
    const n = replies.length;
    const msg = n > 0
      ? `Withdraw this post?\n\nThe ${n} ${n === 1 ? 'reply' : 'replies'} beneath it will stay — they aren't yours to delete.`
      : "Withdraw this post? It'll be removed from the Square.";
    if (!confirm(msg)) return;
    if (n > 0) {
      await update(ref(db, `square_posts/${p.id}`), { text: '', withdrawn: true, withdrawnAt: Date.now(), removedBy: mine ? 'author' : 'moderator' });
      return;
    }
    await remove(ref(db, `square_posts/${p.id}`));
    await remove(ref(db, `user_square_posts/${p.authorUid}/${p.id}`)).catch(() => {});
    router.push('/square');
  };
  const startEdit = (p) => { setEditing(p.id); setEditText(p.text || ''); setEditErr(''); };
  const saveEdit = async (p) => {
    const verdict = refusalFor(editText, { isReply: true, previousLength: (p.text || '').length });
    if (!verdict.ok) { setEditErr(verdict.message); return; }
    try {
      const db = await getDB();
      const { ref, update } = await import('firebase/database');
      await update(ref(db, `square_posts/${p.id}`), { text: editText.trim(), edited: true });
      setEditing(null); setEditText(''); setEditErr('');
    } catch (e) {
      setEditErr('That edit was refused. Nothing was changed — your text is still here.');
      console.error('Edit error:', e);
    }
  };
  const submitReport = async (p, reason, note) => {
    if (!user) { setShowAuth(true); return; }
    const db = await getDB();
    const { ref, set } = await import('firebase/database');
    await set(ref(db, `square_reports/${p.id}/${user.uid}`), {
      reason, note: (note || '').slice(0, 300), reporterUid: user.uid, postAuthorUid: p.authorUid || '', createdAt: Date.now(),
    });
    setReporting(null);
  };

  // ── drawing ─────────────────────────────────────────────────────────────────
  const menuFor = (p) => (user && !p.unsent ? (
    <PostMenu post={p} user={user} onEdit={p.parentId ? startEdit : null} onDelete={handleDelete} onReport={setReporting}
      canPin={false} canRemove={canRemove && state.where === 'square_posts'} />
  ) : null);

  const replyButton = (r) => (interactive && !isRemoved(r) && !r.unsent ? (
    <button onClick={() => answer(r)} data-reply-to={r.id}
      style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 44, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: INK(0.45), fontSize: '0.7rem', fontWeight: 500, fontFamily: FF, letterSpacing: '0.1em' }}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
      reply
    </button>
  ) : null);

  const Unsent = ({ r }) => (
    <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4, fontFamily: FF, fontSize: '0.85rem' }}>
      <span style={{ color: NOT_SENT }}>{THREAD_COPY.notSent}</span>
      <button disabled={sending} onClick={() => send({ body: r.text, target: r.target, retryOf: r.id })}
        style={{ minHeight: 44, background: 'none', border: 'none', padding: 0, color: HANDLE, fontFamily: FF, fontSize: '0.85rem', cursor: 'pointer' }}>{THREAD_COPY.tryAgain}</button>
      <button onClick={() => setFailed((f) => f.filter((x) => x.id !== r.id))}
        style={{ minHeight: 44, background: 'none', border: 'none', padding: 0, color: INK(0.62), fontFamily: FF, fontSize: '0.85rem', cursor: 'pointer' }}>{THREAD_COPY.remove}</button>
    </div>
  );

  const Reply = ({ r, nested }) => {
    const size = nested ? 28 : 36;
    const target = nested ? (r.target || thread.byId.get(r.replyToId)) : null;
    const tint = answering?.id === r.id ? ANSWERING_TINT : (state.focusId === r.id ? 'rgba(201,168,76,0.07)' : 'transparent');
    if (isRemoved(r)) {
      return <div id={`r-${r.id}`} style={{ padding: '10px 6px', borderRadius: 8 }}><Tombstone post={r} size={size} /></div>;
    }
    if (isHiddenBy(hidden, r)) {
      return <div id={`r-${r.id}`} style={{ padding: '10px 6px', borderRadius: 8 }}><Tombstone post={r} size={size} hiddenByYou /></div>;
    }
    const isEditing = editing === r.id;
    return (
      <div id={`r-${r.id}`} data-reply={r.unsent ? 'unsent' : r.id} data-depth={nested ? 2 : 1}
        style={{ display: 'flex', gap: 10, padding: '10px 6px', borderRadius: 8, background: tint }}>
        <div style={{ opacity: r.unsent ? 0.5 : 1, flex: 'none' }}>
          <Avatar uid={r.authorUid} initials={who(r).initials} size={size} isAuthor={who(r).isAuthor} avatarUrl={who(r).avatarUrl} onOpen={r.unsent ? null : openReader} label={`Open ${who(r).displayName}`} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ opacity: r.unsent ? 0.5 : 1 }}>
            <NameLine post={r} who={who} onMenu={menuFor(r)} onOpen={openReader} />
            {nested && target && (
              <div data-replying-to style={{ fontFamily: FF, fontStyle: 'italic', fontSize: 14, color: INK(0.55), marginBottom: 2 }}>
                Replying to <span style={{ color: HANDLE, fontStyle: 'normal' }}>@{who(target).handle || who(target).displayName}</span>
              </div>
            )}
            {isEditing ? (
              <div>
                <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={2} autoFocus
                  style={{ width: '100%', background: 'rgba(107,47,173,0.05)', border: '1px solid rgba(107,47,173,0.2)', borderRadius: 12, padding: '0.7rem 0.9rem', color: '#f5f0e8', fontFamily: FF, fontSize: '0.92rem', resize: 'none', outline: 'none', boxSizing: 'border-box' }} />
                {editErr && <div style={{ fontSize: '0.75rem', color: '#f87171', fontFamily: FF }}>{editErr}</div>}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 }}>
                  {showCounter(editText.length, MAX_REPLY_CHARS) && <span style={{ marginRight: 'auto', fontSize: '0.7rem', fontFamily: FF, color: editText.length > MAX_REPLY_CHARS ? '#f87171' : INK(0.45) }}>{editText.length} / {MAX_REPLY_CHARS}</span>}
                  <button onClick={() => { setEditing(null); setEditErr(''); }} style={{ minHeight: 44, background: 'none', border: 'none', color: INK(0.7), fontFamily: FF, cursor: 'pointer' }}>Cancel</button>
                  <button onClick={() => saveEdit(r)} disabled={!refusalFor(editText, { isReply: true, previousLength: (r.text || '').length }).ok}
                    style={{ minHeight: 44, background: 'none', border: 'none', color: HANDLE, fontFamily: FF, cursor: 'pointer' }}>Save</button>
                </div>
              </div>
            ) : (
              <PostBody text={r.text} surface="thread-reply" withdrawn={r.withdrawn === true} deleted={isTombstone(r)} removedBy={r.removedBy} piece={announcedPieceOf(r)} />
            )}
          </div>
          {r.unsent ? Unsent({ r }) : (
            <ReactionRow reactions={SQUARE_REACTIONS} item={withCounts(r)} activeMap={activeOf(r)}
              onToggle={(key) => toggleReaction(r, key)} canReact={interactive} iconSize={16} trailing={replyButton(r)} />
          )}
        </div>
      </div>
    );
  };

  if (state.phase === 'loading') return <Shell><p style={{ fontFamily: FF, color: INK(0.4) }}>Finding it…</p></Shell>;
  if (state.phase === 'missing') return <Shell><p style={{ fontFamily: FF, color: INK(0.6) }}>That link is missing a post.</p></Shell>;
  if (state.phase === 'error') return <Shell><p style={{ fontFamily: FF, color: INK(0.6) }}>Something went wrong reading that post. Try again in a moment.</p></Shell>;
  if (state.phase === 'gone') {
    return (
      <Shell>
        <h1 style={{ fontFamily: FF, fontWeight: 400, fontSize: '1.6rem', margin: '0 0 10px' }}>This post is gone.</h1>
        <p style={{ fontFamily: FF, fontSize: '0.95rem', lineHeight: 1.65, color: INK(0.55) }}>
          It was deleted by its author or removed by a moderator. Posts that simply pass the
          48-hour horizon are kept and still open here — this one isn’t among them.
        </p>
      </Shell>
    );
  }

  const answeringWho = answering ? who(answering) : null;
  const over = text.length > MAX_REPLY_CHARS;
  const canSend = interactive && !sending && text.trim() && refusalFor(text, { isReply: true }).ok;

  return (
    <Shell bottomPad={interactive ? '9rem' : '6rem'}>
      {state.archived && (
        <div style={{ border: '1px solid rgba(201,168,76,0.3)', background: 'rgba(201,168,76,0.06)', borderRadius: 8, padding: '12px 14px', marginBottom: 18 }}>
          <div style={{ fontFamily: FF, fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: GOLD, marginBottom: 4 }}>Past the horizon</div>
          <div style={{ fontFamily: FF, fontSize: '0.9rem', lineHeight: 1.6, color: INK(0.6) }}>
            This thread has left the Square. The room holds 48 hours; nothing is deleted, so it’s
            still readable here — just no longer in the room.
          </div>
        </div>
      )}

      {/* The post, as the threads canvas draws it. */}
      <div id={`r-${root.id}`} data-thread-root style={{ display: 'flex', gap: 12, padding: '6px 0 4px' }}>
        {/* W17 / ruling 30 — a deleted account's post kept as a tombstone: no author. */}
        {isTombstone(root) || root.missing ? <div style={{ width: 40, flex: 'none' }} /> : <Avatar uid={root.authorUid} initials={who(root).initials} size={40} isAuthor={who(root).isAuthor} avatarUrl={who(root).avatarUrl} onOpen={openReader} label={`Open ${who(root).displayName}`} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          {!isTombstone(root) && !root.missing && <NameLine post={root} who={who} onMenu={menuFor(root)} onOpen={openReader} />}
          {/* R43 — one renderer for every surface: paragraphs and mentions, nothing else. */}
          <PostBody text={root.text} surface="permalink" withdrawn={root.withdrawn === true} deleted={isTombstone(root) || root.missing === true} removedBy={root.removedBy} piece={announcedPieceOf(root)} />
          {!root.withdrawn && !isTombstone(root) && <AttachmentCard attachment={attachmentOf(root)} />}
          {!isTombstone(root) && !root.missing && (
            <ReactionRow reactions={SQUARE_REACTIONS} item={withCounts(root)} activeMap={activeOf(root)}
              onToggle={(key) => toggleReaction(root, key)} canReact={interactive} iconSize={16}
              trailing={interactive && !root.withdrawn ? (
              <button onClick={() => { setAnswering(null); fieldRef.current?.focus(); }}
                style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 44, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: INK(0.45), fontSize: '0.7rem', fontWeight: 500, fontFamily: FF, letterSpacing: '0.1em' }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                reply
              </button>
            ) : null} />
          )}
        </div>
      </div>

      {/* Replies, oldest first, under a gold rule with the count. */}
      <div data-replies-heading style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 6px' }}>
        <span style={{ fontFamily: FF, fontSize: '0.8rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: GOLD }}>{THREAD_COPY.heading}</span>
        <span aria-hidden="true" style={{ flex: 1, height: 1, background: 'rgba(201,168,76,0.45)' }} />
        <span data-replies-count style={{ fontFamily: FF, fontSize: '0.85rem', color: INK(0.55) }}>{thread.count}</span>
      </div>

      {thread.groups.length === 0 && (
        <p style={{ fontFamily: FF, fontStyle: 'italic', fontSize: '0.92rem', color: INK(0.42), margin: '10px 0' }}>No replies yet.</p>
      )}

      {thread.groups.map((g) => {
        const { shown, hidden } = foldNested(g.nested, { expanded: expanded.has(g.top.id), keep });
        return (
          <div key={g.top.id} data-reply-group={g.top.id}>
            {Reply({ r: g.top, nested: false })}
            {g.nested.length > 0 && (
              // One level in, whatever the depth: 48px, with the gold connector from the face above.
              <div style={{ marginLeft: 23, paddingLeft: 25, borderLeft: `1.5px solid ${CONNECTOR}` }}>
                {shown.map((n) => <div key={n.id}>{Reply({ r: n, nested: true })}</div>)}
                {hidden > 0 && (
                  <button onClick={() => setExpanded((s) => new Set([...s, g.top.id]))} data-view-more
                    style={{ minHeight: 44, background: 'none', border: 'none', padding: '0 6px', color: HANDLE, fontFamily: FF, fontSize: '0.88rem', cursor: 'pointer' }}>
                    {THREAD_COPY.viewMore(hidden)}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!interactive && state.where === 'square_posts' && !open && (
        <p style={{ fontFamily: FF, fontStyle: 'italic', fontSize: '0.9rem', color: INK(0.45), marginTop: 18 }}>The Square opens at 8pm. Replies open with it.</p>
      )}
      {!interactive && state.where === 'square_posts' && open && !user && (
        <button onClick={() => setShowAuth(true)} style={{ marginTop: 18, minHeight: 44, background: '#6b2fad', border: 'none', borderRadius: 8, padding: '0 1.4rem', color: '#f5f0e8', fontFamily: FF, fontSize: '0.85rem', letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer' }}>Sign in to reply</button>
      )}

      {/* The reply box, on the bottom bar, above the phone keyboard. */}
      {interactive && (
        <div data-reply-bar data-keyboard-inset={inset}
          // W53 — above the keyboard AND above the cookie notice, which publishes the space it takes
          // (--cs-cookie-space, app/components/CookieBanner.js): nothing a reader needs sits under it.
          style={{ position: 'fixed', left: 0, right: 0, bottom: `calc(${inset}px + var(--cs-cookie-space, 0px))`, background: BAR, borderTop: `1px solid ${INK(0.1)}`, padding: '8px 12px calc(8px + env(safe-area-inset-bottom))', zIndex: 50 }}>
          <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative' }}>
            {mentionRows.length > 0 && (
              <div data-mention-dropdown style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 56, background: '#1a1a2e', border: '1px solid rgba(107,47,173,0.3)', borderRadius: 10, overflow: 'hidden' }}>
                {mentionRows.map((u) => (
                  <button key={u.uid} onClick={() => pickMention(u.username)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', minHeight: 44, padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: FF }}>
                    <span style={{ color: '#f5f0e8', fontSize: '0.9rem', fontWeight: 500 }}>{u.displayName || u.username}</span>{' '}
                    <span style={{ color: HANDLE, fontSize: '0.8rem' }}>@{u.username}</span>
                  </button>
                ))}
              </div>
            )}
            {answering && (
              <div data-replying-row style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: FF, fontStyle: 'italic', fontSize: 14, color: INK(0.55) }}>
                <span>Replying to <span style={{ color: HANDLE, fontStyle: 'normal' }}>@{answeringWho.handle || answeringWho.displayName}</span></span>
                <button onClick={() => setAnswering(null)} aria-label={`Stop replying to @${answeringWho.handle || answeringWho.displayName}`}
                  style={{ width: 44, height: 44, background: 'none', border: 'none', color: INK(0.7), fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <textarea ref={fieldRef} value={text} onChange={(e) => setBox(e.target.value)} rows={1}
                placeholder={answering ? `Reply to ${answeringWho.displayName}…` : `Reply to ${who(root).displayName}…`}
                aria-label="Reply"
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) send({ body: text.trim(), target: answering }); }}
                style={{ flex: 1, height: 44, minHeight: 44, borderRadius: 22, padding: '11px 16px', boxSizing: 'border-box', resize: 'none', overflowY: 'auto', outline: 'none',
                  background: 'rgba(245,240,232,0.04)', color: '#f5f0e8', fontFamily: FF, fontSize: 16, lineHeight: 1.3,
                  border: `1px solid ${answering ? 'rgba(201,168,76,0.45)' : INK(0.14)}` }} />
              <button onClick={() => send({ body: text.trim(), target: answering })} disabled={!canSend} aria-label="Send"
                style={{ width: 44, height: 44, flex: 'none', borderRadius: '50%', background: '#6b2fad', border: 'none', color: '#f5f0e8', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: canSend ? 'pointer' : 'default', opacity: canSend ? 1 : 0.45 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>
              </button>
            </div>
            {showCounter(text.length, MAX_REPLY_CHARS) && (
              <div style={{ textAlign: 'right', fontSize: '0.7rem', fontFamily: FF, marginTop: 2, paddingRight: 54, color: over ? '#f87171' : INK(0.45) }}>{text.length} / {MAX_REPLY_CHARS}</div>
            )}
          </div>
        </div>
      )}

      {reporting && <ReportModal post={reporting} onSubmit={submitReport} onClose={() => setReporting(null)} />}
      {cardUid && <ReaderCard uid={cardUid} me={user} safety={safety} onClose={() => setCardUid(null)}
        onMessage={(uid) => { setCardUid(null); if (!user) { setShowAuth(true); return; } router.push(`/square?dm=${encodeURIComponent(uid)}`); }} />}
      {showAuth && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000 }}>
          {(() => { const AuthModal = require('../../components/AuthModal').default; return <AuthModal onClose={() => setShowAuth(false)} />; })()}
        </div>
      )}
    </Shell>
  );
}

export default function Page() {
  // useSearchParams needs a Suspense boundary under `output: 'export'`.
  return (
    <Suspense fallback={<Shell><p style={{ fontFamily: FF, color: INK(0.4) }}>Finding it…</p></Shell>}>
      <Thread />
    </Suspense>
  );
}
