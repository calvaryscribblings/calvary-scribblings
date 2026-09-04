'use client';

// Open Pages — post detail (Stage 4), client renderer for /open-pages/[id].
//
// Reads postId from the route params, fetches open_pages/{postId} once on mount,
// and renders the full post. The public node holds only moderation-cleared
// status:'live' posts, so anything found here is safe to show. Body is Markdown,
// rendered to React elements via the shared XSS-safe renderer (no raw HTML).
//
// Subscribe·Support and Report are UI ONLY in this stage — Stage 5 wires Report
// to the admin queue and a later stage wires subscriptions.

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import AuthModal from '../../components/AuthModal';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { OPEN_PAGES_NODE, normalizeGenre, isEdited } from '../../lib/openPages';
// R38 — the reading treatment. THE TAGGER IS SHARED WITH THE STORY PAGE; the stylesheet
// deliberately is not. See the note above OP_READING_CSS.
import { attachDropcap } from '../../lib/dropcap';
import { PUBLISHED_FOOTER } from '../../lib/openPagesCopy';
// R36 — the blocking filter lives in a module so it can be tested directly; see its
// note there for the ruling it implements and why it is not a write barrier.
import { pruneBlocked, countNodes } from '../../lib/openPagesThread';
import { renderMarkdown } from '../../lib/openPagesMarkdown';
import { indexedCommentWrite } from '../../lib/userComments';

const REPORT_REASONS = ['Harmful content', 'Spam', 'Plagiarism', 'Other'];

// Brand palette.
const INK = '#080610';
const SURFACE = '#120d1c';
const SURFACE_2 = '#1a1326';
const PURPLE = '#6b2fad';
const GOLD = '#c9a84c';
const CREAM = '#f5f0e8';
const SERIF = "Cormorant Garamond, Georgia, serif";
const BODY_SERIF = "Cormorant Garamond, Georgia, serif";
const CINZEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
// Muted cream scale — consolidated from the inline rgba literals scattered
// through the file. DIM = secondary reading text, MUTE = quiet UI controls and
// captions, FAINT = very subtle borders/hints.
const CREAM_DIM = 'rgba(245,240,232,0.62)';
const CREAM_MUTE = 'rgba(245,240,232,0.35)';
const CREAM_FAINT = 'rgba(245,240,232,0.18)';
// Muted gold for hairline rules and faint accents.
const GOLD_SOFT = 'rgba(201,168,76,0.35)';
const GOLD_FAINT = 'rgba(201,168,76,0.15)';
// Indent/thread rule colour, reused on the nested-reply left rule.
const LINE = '#2a2036';
const THREAD_BORDER = `2px solid ${LINE}`;

// ---------------------------------------------------------------------------
// Comment-tree helpers (pure).
//
// Replies are stored as RTDB children of their parent:
//   comments/{postId}/{commentId}/replies/{replyId}             (level 1)
//   comments/{postId}/{commentId}/replies/{replyId}/replies/…   (level 2, max)
// Each node carries a `path` — its location *under* comments/{postId} — reused
// verbatim for the like path (comment_likes/{postId}/{path}/{uid}) and the
// replies write path (comments/{postId}/{path}/replies). The comment tree is
// built inline in the fetch effect (see below) so a parse edge case can never
// take down the whole list.
// ---------------------------------------------------------------------------

// Flatten comment_likes/{postId} into a { path -> { uid: true } } map mirroring
// the comment tree. Each likes node holds uid keys plus an optional `replies`
// child that recurses; `replies` is never a uid so we skip it.
function buildLikesMap(node, path, out) {
  if (!node || typeof node !== 'object') return out;
  const uids = {};
  for (const k of Object.keys(node)) {
    if (k === 'replies') continue;
    if (node[k] === true) uids[k] = true;
  }
  out[path] = uids;
  if (node.replies && typeof node.replies === 'object') {
    for (const rid of Object.keys(node.replies)) {
      buildLikesMap(node.replies[rid], `${path}/replies/${rid}`, out);
    }
  }
  return out;
}

// Collect every authorUid across the tree (for lazy profile resolution).
function collectUids(nodes, out) {
  for (const n of nodes) {
    if (n.authorUid) out.add(n.authorUid);
    if (n.replies && n.replies.length) collectUids(n.replies, out);
  }
  return out;
}

// Immutably insert `reply` under the node whose path === parentPath.
function addReplyToTree(nodes, parentPath, reply) {
  return nodes.map((n) => {
    if (n.path === parentPath) return { ...n, replies: [...n.replies, reply] };
    if (n.replies && n.replies.length) return { ...n, replies: addReplyToTree(n.replies, parentPath, reply) };
    return n;
  });
}

// Immutably drop a reply (by id) from under parentPath — used to roll back a
// failed optimistic insert.
function removeReplyFromTree(nodes, parentPath, replyId) {
  return nodes.map((n) => {
    if (n.path === parentPath) return { ...n, replies: n.replies.filter((r) => r.id !== replyId) };
    if (n.replies && n.replies.length) return { ...n, replies: removeReplyFromTree(n.replies, parentPath, replyId) };
    return n;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════
// R38 — THE READING TREATMENT, AND WHY app/lib/proseCSS.js IS NOT IMPORTED.
// ═══════════════════════════════════════════════════════════════════════════════════
// A community piece read visibly cheaper than a house one — no drop cap, no reading
// progress, no ending — on the surface whose whole new argument is that the house is
// reading. That difference told a writer exactly what the house thought of their work.
//
// The obvious move is to import proseCSS.js, which the story page and the offline shelf
// reader already share. IT CANNOT BE IMPORTED HERE AND THIS IS THE MEASURED REASON:
// proseCSS is written for a LIGHT ground — `color: #1a1a1a`, `rgba(26,26,26,0.55)`,
// HOUSE_GOLD_ON_LIGHT (#7f6726) — because the story page is cream. THIS PAGE IS INK
// (#080610) with cream text. Importing it would set near-black type on a near-black
// background: the whole body would vanish.
//
// So what is ported is the GEOMETRY AND THE GOLD, both copied exactly:
//   · the drop cap's 4.2em / 0.78 line-height / 0.06em 0.12em margins, and #c9a84c —
//     which is already the on-dark half of the house gold pair, so it needs no
//     adaptation at all (the cream-ground page uses #7f6726 for the same reason).
//   · the progress bar's 2px, its gradient, and its transform-origin.
//   · the ending mark's 88px rule, its ✦, and its 14px gap.
// What is NOT ported is every colour that assumed cream. The tagger — app/lib/dropcap.js
// — IS shared, because deciding which paragraph is genuinely opening prose is ground-
// agnostic and is the part with the real logic in it.
//
// ⚠ If proseCSS is ever made ground-aware, this block should be deleted in favour of it.
// Two copies of a stylesheet drift; this one exists only because the two grounds differ.
const OP_READING_CSS = `
  .op-prose.has-dropcap p.dropcap-target::first-letter { font-size: 4.2em; font-weight: 600; float: left; line-height: 0.78; margin: 0.06em 0.12em 0 0; color: #c9a84c; font-family: Cormorant Garamond, Georgia, serif; }
  .op-prose.has-dropcap p.dropcap-target { text-indent: 0; }
  .op-reading-progress { position: fixed; top: 0; left: 0; right: 0; width: 100%; height: 2px; background: linear-gradient(90deg, #c9a84c, rgba(201,168,76,0.55)); transform: scaleX(0); transform-origin: left; opacity: 0; z-index: 1000; will-change: transform, opacity; transition: opacity 0.4s ease; pointer-events: none; }
  .op-last-page { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 2.75rem 2rem 1rem; }
  .op-lp-orn { color: #c9a84c; font-size: 0.9rem; line-height: 1; opacity: 0; transition: opacity 600ms ease 1400ms; }
  .op-lp-rule { display: block; width: 88px; height: 1px; background: #c9a84c; transform: scaleX(0); transform-origin: center; transition: transform 700ms ease 400ms; }
  .op-closed .op-lp-rule { transform: scaleX(1); }
  .op-closed .op-lp-orn { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    .op-lp-rule { transform: scaleX(1); transition: none; }
    .op-lp-orn { opacity: 1; transition: none; }
    .op-reading-progress { transition: none; }
  }
`;

function formatDate(ts) {
  if (!ts || typeof ts !== 'number') return '';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Estimated reading time in whole minutes (~200 wpm), floored at 1.
function readTime(body) {
  const wordCount = (body || '').trim().split(/\s+/).length;
  return Math.max(1, Math.round(wordCount / 200));
}

// Relative time for comments — "just now", "5 minutes ago", then a date.
function timeAgo(ts) {
  if (!ts || typeof ts !== 'number') return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function OpenPageDetailClient({ params }) {
  const { id } = use(params);
  const { user, loading: authLoading } = useAuth();

  const [post, setPost] = useState(undefined); // undefined = loading, null = not found
  // Live author profile resolved from users/{authorUid} — richer/fresher than the
  // denormalized snapshot stored on the post (real displayName, avatar, bio).
  const [author, setAuthor] = useState(null);

  // Guards the read-count increment to once per mount (effects can re-run, and
  // React strict mode double-invokes them in dev).
  const readCountedRef = useRef(false);

  // R38 — the reading treatment's three moving parts.
  const proseRef = useRef(null);      // the drop-cap tagger's container
  const progressRef = useRef(null);   // the 2px bar
  const endRef = useRef(null);        // the ending mark's sentinel
  const [closed, setClosed] = useState(false);

  // Reactions — open_pages_reactions/{postId}/{uid} = true. Held as a uid->true
  // map; count and "did I like it" are derived at render so they react to auth.
  const [reactions, setReactions] = useState({});

  // Comments — comments/{postId}. null = loading. Commenter profiles (avatar,
  // handle) are resolved lazily from users/{uid} into commenterProfiles.
  const [comments, setComments] = useState(null);
  const [commenterProfiles, setCommenterProfiles] = useState({}); // uid -> profile|null
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);

  // Comment + reply likes — comment_likes/{postId} flattened to { path -> { uid: true } }
  // (see buildLikesMap). Count and "did I like it" are derived at render.
  const [likes, setLikes] = useState({});

  // Inline reply composer. Only one reply box is open at a time, keyed by the
  // path of the node being replied to; the draft + submitting flag are shared.
  const [replyOpenPath, setReplyOpenPath] = useState(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

  // Report flow. One report per user per post — the RTDB path is keyed by the
  // reporter's uid, so re-reporting just overwrites their own entry. We disable
  // the control for the session once submitted.
  // blocked_users/{myUid} — a uid->true map of people this reader has blocked.
  // Owner-readable only, so this is always MY list and never anyone else's.
  const [blocked, setBlocked] = useState(() => new Set());
  const [blockBusy, setBlockBusy] = useState('');

  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState('');
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!user) { setBlocked(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `blocked_users/${user.uid}`));
        if (cancelled) return;
        const val = snap.exists() ? snap.val() : {};
        setBlocked(new Set(Object.keys(val).filter((k) => val[k])));
      } catch (e) {
        // A failed read must not blank the thread — worst case the filter is not
        // applied this session, which is visibly wrong to the blocker rather than
        // silently wrong to everyone.
        console.warn('[open-pages] block list read failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  async function toggleBlock(uid) {
    if (!user || !uid || uid === user.uid) return;
    setBlockBusy(uid);
    const isBlocked = blocked.has(uid);
    // Optimistic: the comment should vanish on the click, not after a round trip.
    setBlocked((cur) => {
      const next = new Set(cur);
      if (isBlocked) next.delete(uid); else next.add(uid);
      return next;
    });
    try {
      const { ref, set, remove } = await import('firebase/database');
      const r = ref(db, `blocked_users/${user.uid}/${uid}`);
      if (isBlocked) await remove(r); else await set(r, true);
    } catch (e) {
      console.error('[open-pages] block toggle failed:', e);
      setBlocked((cur) => {
        const next = new Set(cur);
        if (isBlocked) next.add(uid); else next.delete(uid);
        return next;
      });
    }
    setBlockBusy('');
  }

  async function submitReport(reason) {
    if (!user) { setShowAuth(true); return; }
    setReporting(true);
    setReportError('');
    try {
      const { ref, set } = await import('firebase/database');
      await set(ref(db, `open_pages_reports/${id}/${user.uid}`), {
        reason,
        reporterUid: user.uid,
        createdAt: Date.now(),
      });
      setReported(true);
      setReportOpen(false);
    } catch (e) {
      console.error('[open-pages] report failed:', e);
      setReportError('Couldn’t submit your report. Please try again.');
    }
    setReporting(false);
  }

  function handleReportClick() {
    if (!user) { setShowAuth(true); return; }
    setReportOpen((v) => !v);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ref, get, runTransaction } = await import('firebase/database');
        const snap = await get(ref(db, `${OPEN_PAGES_NODE}/${id}`));
        if (cancelled) return;
        const val = snap.exists() ? snap.val() : null;
        // Only ever show live posts (the public node should only hold these).
        const live = val && val.status === 'live' ? { id, ...val } : null;
        setPost(live);

        // Read count — bump open_pages/{id}/readCount once per mount, fire-and-
        // forget. Not awaited so it never blocks render; errors are swallowed so
        // a rules denial can never surface. runTransaction keeps concurrent reads
        // from clobbering each other's increment.
        if (live && !readCountedRef.current) {
          readCountedRef.current = true;
          runTransaction(ref(db, `${OPEN_PAGES_NODE}/${id}/readCount`), (cur) => (cur || 0) + 1).catch(() => {});
        }

        // Secondary fetch: resolve the live author profile from users/{authorUid}
        // (displayName, avatarUrl/photoURL, bio…) to enrich the author card.
        if (live && live.authorUid) {
          try {
            const pSnap = await get(ref(db, `users/${live.authorUid}`));
            if (!cancelled && pSnap.exists()) setAuthor(pSnap.val());
          } catch (e2) {
            console.warn('[open-pages] author profile read failed:', e2);
          }
        }
      } catch (e) {
        console.error('[open-pages] detail read failed:', e);
        if (!cancelled) setPost(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Reactions + comments — one read each, once Firebase auth has initialised.
  // The comments node is publicly readable, but firing the read before
  // onAuthStateChanged has resolved can hit a rule-evaluation edge case and be
  // rejected with "Permission denied". Gating on authLoading guarantees the auth
  // state (signed-in OR confirmed signed-out) is settled before we read.
  useEffect(() => {
    if (authLoading) return; // wait for auth to initialise (deps re-run when it does)
    if (!id || typeof id !== 'string') return; // don't fetch with a missing/invalid post id
    let cancelled = false;
    (async () => {
      const { ref, get } = await import('firebase/database');

      // ---- Comments — the critical read, ISOLATED ----
      // Previously comments shared a single Promise.all with the reactions and
      // comment_likes reads, so a rules rejection on *either* of those (e.g.
      // comment_likes lacking a deployed .read) rejected the whole batch and
      // blanked the comments — even though comments/{id} is publicly readable
      // (which is why feed counts work). Reading comments on its own guarantees
      // those other reads can never take the comment list down. Parsing is done
      // explicitly inline with optional chaining so a malformed node can't throw.
      try {
        const cSnap = await get(ref(db, `comments/${id}`));
        if (cancelled) return;
        if (cSnap.exists()) {
          const raw = cSnap.val();
          const list = Object.entries(raw).map(([cid, cval]) => ({
            id: cid,
            path: cid,
            text: cval?.text || '',
            authorName: cval?.authorName || 'Anonymous',
            authorUid: cval?.authorUid || '',
            createdAt: cval?.createdAt || 0,
            replies: cval?.replies ? Object.entries(cval.replies).map(([rid, rval]) => ({
              id: rid,
              path: `${cid}/replies/${rid}`,
              text: rval?.text || '',
              authorName: rval?.authorName || 'Anonymous',
              authorUid: rval?.authorUid || '',
              createdAt: rval?.createdAt || 0,
              replies: rval?.replies ? Object.entries(rval.replies).map(([r2id, r2val]) => ({
                id: r2id,
                path: `${cid}/replies/${rid}/replies/${r2id}`,
                text: r2val?.text || '',
                authorName: r2val?.authorName || 'Anonymous',
                authorUid: r2val?.authorUid || '',
                createdAt: r2val?.createdAt || 0,
                replies: [],
              })).filter(r2 => r2.text) : [],
            })).filter(r => r.text).sort((a, b) => a.createdAt - b.createdAt) : [],
          })).filter(c => c.text).sort((a, b) => b.createdAt - a.createdAt);
          setComments(list);
        } else {
          setComments([]);
        }
      } catch (err) {
        console.error('[open-pages] comments read failed:', err);
        if (!cancelled) { setComments([]); }
      }

      // ---- Reactions — non-fatal, independent of comments ----
      try {
        const rSnap = await get(ref(db, `open_pages_reactions/${id}`));
        if (!cancelled) setReactions(rSnap.exists() ? rSnap.val() : {});
      } catch (err) {
        console.warn('[open-pages] reactions read failed:', err);
      }

      // ---- Comment likes — non-fatal; a denial here must NOT blank comments ----
      try {
        const lSnap = await get(ref(db, `comment_likes/${id}`));
        if (!cancelled && lSnap.exists()) {
          const likesMap = {};
          const lv = lSnap.val();
          for (const cid of Object.keys(lv)) buildLikesMap(lv[cid], cid, likesMap);
          setLikes(likesMap);
        }
      } catch (err) {
        console.warn('[open-pages] comment_likes read failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [id, authLoading]);

  // Resolve commenter profiles (avatar/handle) for any uids not yet fetched —
  // re-runs as comments arrive (including an optimistic one the user just posted).
  useEffect(() => {
    if (!comments || !comments.length) return;
    let cancelled = false;
    (async () => {
      const need = [...collectUids(comments, new Set())]
        .filter((u) => u && !(u in commenterProfiles));
      if (!need.length) return;
      try {
        const { ref, get } = await import('firebase/database');
        const results = await Promise.all(
          need.map((u) =>
            get(ref(db, `users/${u}`))
              .then((s) => [u, s.exists() ? s.val() : null])
              .catch(() => [u, null])
          )
        );
        if (!cancelled) setCommenterProfiles((prev) => ({ ...prev, ...Object.fromEntries(results) }));
      } catch (e) {
        console.warn('[open-pages] commenter profile read failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [comments]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Like toggle (optimistic) ----
  const likeCount = Object.keys(reactions).length;
  const liked = !!(user && reactions[user.uid]);

  async function toggleLike() {
    if (!user) { setShowAuth(true); return; }
    const willLike = !liked;
    // Optimistic.
    setReactions((prev) => {
      const next = { ...prev };
      if (willLike) next[user.uid] = true;
      else delete next[user.uid];
      return next;
    });
    try {
      const { ref, set, remove } = await import('firebase/database');
      if (willLike) await set(ref(db, `open_pages_reactions/${id}/${user.uid}`), true);
      else await remove(ref(db, `open_pages_reactions/${id}/${user.uid}`));
    } catch (e) {
      console.error('[open-pages] like toggle failed:', e);
      // Revert.
      setReactions((prev) => {
        const next = { ...prev };
        if (willLike) delete next[user.uid];
        else next[user.uid] = true;
        return next;
      });
    }
  }

  // ---- Post a comment (optimistic) ----
  async function submitComment(e) {
    e.preventDefault();
    if (!user) { setShowAuth(true); return; }
    const trimmed = commentText.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    const createdAt = Date.now();
    // Match the platform's comments shape exactly.
    const data = { text: trimmed, authorName: user.displayName || 'Reader', authorUid: user.uid, createdAt };
    let cid;
    try {
      const { ref, push, update } = await import('firebase/database');
      // Generate the key up front so the optimistic node carries its real path.
      const newRef = push(ref(db, `comments/${id}`));
      cid = newRef.key;
      const optimistic = { id: cid, path: cid, ...data, replies: [], _optimistic: true };
      setComments((prev) => [optimistic, ...(prev || [])]);
      setCommentText('');
      // Indexed like every other top-level comment: the per-author count has always
      // included open-pages threads (the old whole-node scan walked comments/* without
      // caring what the parent was), so leaving these out would silently lower it.
      // Nested replies are NOT indexed, and were never counted either — the old scan
      // iterated comments/{parent} one level deep and never descended into `replies`.
      await update(ref(db, '/'), indexedCommentWrite({
        uid: user.uid, slug: id, commentId: cid, comment: data,
      }));
    } catch (err) {
      console.error('[open-pages] comment post failed:', err);
      if (cid) setComments((prev) => (prev || []).filter((c) => c.id !== cid));
      setCommentText(trimmed);
    }
    setPosting(false);
  }

  // R38 — DROP CAP. The tagger is app/lib/dropcap.js, the same module the story page
  // and the offline shelf reader run. It walks the container, decides which paragraph
  // is genuinely opening prose (skipping epigraphs, content notes, section numerals)
  // and tags it; the CSS above does the rest. Re-attached when the body changes,
  // because the post arrives after the first render.
  useEffect(() => {
    if (!post || !proseRef.current) return;
    return attachDropcap(proseRef.current);
  }, [post]);

  // R38 — READING PROGRESS. The same 2px gold bar the story page carries. It is a
  // fraction of the ARTICLE, not of the document: a long comment thread underneath
  // would otherwise mean the bar never fills while reading the piece, which reads as
  // the piece being longer than it is.
  useEffect(() => {
    if (!post) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      const el = proseRef.current, bar = progressRef.current;
      if (!el || !bar) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const span = Math.max(1, el.offsetHeight - window.innerHeight * 0.6);
      const frac = Math.min(1, Math.max(0, (window.scrollY - top + window.innerHeight * 0.6) / span));
      bar.style.transform = `scaleX(${frac})`;
      bar.style.opacity = frac > 0.01 && frac < 0.995 ? '1' : '0';
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(paint); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    paint();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [post]);

  // R38 — THE ENDING. A piece that simply stops has not ended; the story page draws a
  // rule and an ornament when the reader reaches the last line, and a community piece
  // now earns the same. One-way: once closed it stays closed, so scrolling back up
  // does not un-end the piece.
  useEffect(() => {
    if (!post || !endRef.current || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setClosed(true); io.disconnect(); }
    }, { threshold: 0.6 });
    io.observe(endRef.current);
    return () => io.disconnect();
  }, [post]);

  // ---- Like a comment or reply (optimistic) ----
  // comment_likes/{postId}/{node.path}/{uid} = true. `node.path` already encodes
  // the full nesting, so the same code likes comments and replies at any depth.
  async function toggleNodeLike(node) {
    if (!user) { setShowAuth(true); return; }
    const path = node.path;
    const willLike = !(likes[path] && likes[path][user.uid]);
    setLikes((prev) => {
      const cur = { ...(prev[path] || {}) };
      if (willLike) cur[user.uid] = true; else delete cur[user.uid];
      return { ...prev, [path]: cur };
    });
    try {
      const { ref, set, remove } = await import('firebase/database');
      const likeRef = ref(db, `comment_likes/${id}/${path}/${user.uid}`);
      if (willLike) await set(likeRef, true); else await remove(likeRef);
    } catch (err) {
      console.error('[open-pages] comment like toggle failed:', err);
      setLikes((prev) => {
        const cur = { ...(prev[path] || {}) };
        if (willLike) delete cur[user.uid]; else cur[user.uid] = true;
        return { ...prev, [path]: cur };
      });
    }
  }

  // Open/close the inline reply composer for a node (auth-gated).
  function handleReplyClick(node) {
    if (!user) { setShowAuth(true); return; }
    setReplyDraft('');
    setReplyOpenPath((cur) => (cur === node.path ? null : node.path));
  }

  // ---- Post a reply to `parentNode` (optimistic) + notify the parent author ----
  async function submitReply(parentNode, e) {
    if (e) e.preventDefault();
    if (!user) { setShowAuth(true); return; }
    const trimmed = replyDraft.trim();
    if (!trimmed || replySubmitting) return;
    setReplySubmitting(true);
    const createdAt = Date.now();
    const data = { text: trimmed, authorName: user.displayName || 'Reader', authorUid: user.uid, createdAt };
    let replyId;
    try {
      const { ref, push, set } = await import('firebase/database');
      const newRef = push(ref(db, `comments/${id}/${parentNode.path}/replies`));
      replyId = newRef.key;
      const optimistic = {
        id: replyId,
        path: `${parentNode.path}/replies/${replyId}`,
        ...data,
        replies: [],
        _optimistic: true,
      };
      setComments((prev) => addReplyToTree(prev || [], parentNode.path, optimistic));
      setReplyOpenPath(null);
      setReplyDraft('');
      await set(newRef, data);
      // Notify the author of the comment/reply being replied to — same shape as
      // notifications/{uid} elsewhere (see app/square/page.js). Skip self-replies.
      if (parentNode.authorUid && parentNode.authorUid !== user.uid) {
        await push(ref(db, `notifications/${parentNode.authorUid}`), {
          type: 'open_pages_reply',
          fromUid: user.uid,
          fromName: user.displayName || 'Reader',
          fromUsername: null,
          fromAvatarUrl: user.photoURL || null,
          postId: id,
          read: false,
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      console.error('[open-pages] reply post failed:', err);
      if (replyId) setComments((prev) => removeReplyFromTree(prev || [], parentNode.path, replyId));
      setReplyOpenPath(parentNode.path);
      setReplyDraft(trimmed);
    }
    setReplySubmitting(false);
  }

  // Recursive renderer for a comment / reply / reply-to-reply. depth 0 = comment,
  // 1 = reply, 2 = reply-to-reply (no further "Reply" affordance — max depth).
  function renderNode(node, depth) {
    const profile = commenterProfiles[node.authorUid];
    const name = profile?.displayName || node.authorName || 'Reader';
    const handle = profile?.username || '';
    const avatar = profile?.avatarUrl || profile?.photoURL || null;
    const initial = (name || '?').trim().charAt(0).toUpperCase();
    const href = handle ? `/u/${handle}` : null;
    const nodeLikes = likes[node.path] || {};
    const likeCount = Object.keys(nodeLikes).length;
    const liked = !!(user && nodeLikes[user.uid]);
    const canReply = depth < 2;
    const replyOpen = replyOpenPath === node.path;
    const avatarSize = depth === 0 ? 38 : 30;

    return (
      <div key={node.path} style={{ marginBottom: depth === 0 ? 28 : 20 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <AuthorLink href={href} style={{ flexShrink: 0, display: 'block' }}>
            <AuthorAvatar src={avatar} initial={initial} size={avatarSize} fontSize={depth === 0 ? '1rem' : '0.85rem'} />
          </AuthorLink>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <AuthorLink href={href} style={{ fontFamily: SERIF, fontSize: '1.05rem', color: CREAM, fontWeight: 600 }}>
                {name}
              </AuthorLink>
              {handle ? <span style={{ fontSize: '0.82rem', color: CREAM_MUTE }}>@{handle}</span> : null}
              <span style={{ fontSize: '0.78rem', color: 'rgba(245,240,232,0.3)' }}>· {timeAgo(node.createdAt)}</span>
            </div>
            <div style={{ fontSize: '1.05rem', lineHeight: 1.6, color: 'rgba(245,240,232,0.82)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {node.text}
            </div>

            {/* Actions — like (gold when liked) + reply (hidden at max depth). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => toggleNodeLike(node)}
                aria-pressed={liked}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: liked ? GOLD : CREAM_MUTE,
                  fontFamily: CINZEL,
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  transition: 'color 0.15s',
                }}
              >
                <IconHeart size={13} style={{ fill: liked ? GOLD : 'none' }} /> {likeCount}
              </button>
              {user && node.authorUid && node.authorUid !== user.uid ? (
                <button
                  type="button"
                  onClick={() => toggleBlock(node.authorUid)}
                  disabled={blockBusy === node.authorUid}
                  data-block-btn
                  style={{
                    background: 'transparent', border: 'none', padding: 0, color: CREAM_MUTE,
                    fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
                    cursor: blockBusy === node.authorUid ? 'wait' : 'pointer', opacity: 0.6,
                  }}
                >
                  Block
                </button>
              ) : null}
              {canReply ? (
                <button
                  type="button"
                  onClick={() => handleReplyClick(node)}
                  className="op-reply-btn"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: 'rgba(245,240,232,0.45)',
                    fontFamily: CINZEL,
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  Reply
                </button>
              ) : null}
            </div>

            {/* Inline reply composer — collapses on submit/cancel. */}
            {replyOpen ? (
              <form onSubmit={(e) => submitReply(node, e)} style={{ marginTop: 12 }}>
                <textarea
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  placeholder="Write a reply…"
                  rows={2}
                  autoFocus
                  disabled={replySubmitting}
                  className="op-input"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: SURFACE,
                    borderRadius: 6,
                    padding: '0.7rem 0.9rem',
                    color: CREAM,
                    fontSize: 16,
                    lineHeight: 1.5,
                    fontFamily: BODY_SERIF,
                    resize: 'vertical',
                    minHeight: 60,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => { setReplyOpenPath(null); setReplyDraft(''); }}
                    style={{ background: 'transparent', border: 'none', padding: 0, color: CREAM_MUTE, fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!replyDraft.trim() || replySubmitting}
                    style={{
                      background: replyDraft.trim() && !replySubmitting ? PURPLE : 'transparent',
                      color: replyDraft.trim() && !replySubmitting ? CREAM : CREAM_MUTE,
                      border: replyDraft.trim() && !replySubmitting ? 'none' : '1px solid rgba(245,240,232,0.12)',
                      borderRadius: 4,
                      padding: '8px 16px',
                      fontFamily: CINZEL,
                      fontSize: 10,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      cursor: replyDraft.trim() && !replySubmitting ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {replySubmitting ? 'Posting…' : 'Reply'}
                  </button>
                </div>
              </form>
            ) : null}

            {/* Nested replies — indented with a left rule. Levels 1 and 2 share the
                same indentation style; level 2 nodes render no further "Reply". */}
            {node.replies && node.replies.length ? (
              <div style={{ marginTop: 6, marginLeft: 4, paddingLeft: 14, borderLeft: THREAD_BORDER }}>
                {node.replies.map((child) => renderNode(child, depth + 1))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // ---- Loading ----
  if (post === undefined) {
    return (
      <Shell>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 24px' }}>
          <div style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 14, background: 'rgba(245,240,232,0.05)', marginBottom: 28 }} />
          <div style={{ width: '70%', height: 38, borderRadius: 8, background: 'rgba(245,240,232,0.06)', marginBottom: 18 }} />
          <div style={{ width: '100%', height: 14, borderRadius: 6, background: 'rgba(245,240,232,0.04)', marginBottom: 10 }} />
          <div style={{ width: '90%', height: 14, borderRadius: 6, background: 'rgba(245,240,232,0.04)' }} />
        </div>
      </Shell>
    );
  }

  // ---- Not found ----
  if (post === null) {
    return (
      <Shell>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '6rem 1.5rem', textAlign: 'center' }}>
          <div style={{ fontFamily: SERIF, fontSize: '4rem', color: GOLD, opacity: 0.6, lineHeight: 1 }}>404</div>
          <div style={{ fontFamily: SERIF, fontSize: '1.9rem', color: CREAM, margin: '0.6rem 0 0.8rem' }}>
            This story isn’t here.
          </div>
          <p style={{ fontSize: '1.1rem', color: 'rgba(245,240,232,0.55)', marginBottom: '2rem' }}>
            It may have been removed, or the link is wrong.
          </p>
          <a href="/open-pages" style={backLink}>
            <IconArrowLeft size={16} /> Back to Open Pages
          </a>
        </div>
      </Shell>
    );
  }

  const genre = normalizeGenre(post.genre);
  // The thread as THIS reader sees it. Everyone else's view is unchanged, and the
  // piece itself is never filtered — see pruneBlocked's note.
  const visibleComments = comments === null ? null : pruneBlocked(comments, blocked);
  const hiddenCount = comments === null ? 0 : countNodes(comments) - countNodes(visibleComments);
  // Only the blocked people who actually appear in THIS thread — the note should not
  // enumerate a reader's whole block list on an unrelated piece.
  const hiddenAuthors =
    comments === null || blocked.size === 0
      ? []
      : [...collectUids(comments, new Set())].filter((u) => blocked.has(u));
  // Prefer the live profile (Fix 4), falling back to the post's denormalized snapshot.
  const authorName = author?.displayName || post.authorName || 'Reader';
  const authorHandle = post.authorHandle || author?.username || '';
  const authorAvatar = author?.avatarUrl || author?.photoURL || post.authorAvatarUrl || null;
  const authorBio = author?.bio || '';
  const initial = (authorName || '?').trim().charAt(0).toUpperCase();
  const profileHref = authorHandle ? `/u/${authorHandle}` : null;

  return (
    <Shell>
      <style>{OP_READING_CSS}</style>
      <div ref={progressRef} className="op-reading-progress" aria-hidden="true" />
      <article style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 90px' }}>
        {/* Back */}
        <div style={{ marginBottom: 28 }}>
          <a href="/open-pages" style={backLink}>
            <IconArrowLeft size={16} /> Open Pages
          </a>
        </div>

        {/* Cover */}
        {post.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImage}
            alt=""
            style={{ width: '100%', maxHeight: 440, objectFit: 'cover', borderRadius: 14, display: 'block', marginBottom: 30, border: '1px solid rgba(245,240,232,0.1)' }}
          />
        ) : null}

        {/* Genre + date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={genrePill}>{genre}</span>
          <span style={{ fontSize: '0.82rem', color: 'rgba(245,240,232,0.45)' }}>{formatDate(post.createdAt)}</span>
          {/* R36 — THE EDIT MARK. Ikenna's ruling: a published piece stays editable
              forever, because writers fix things and a typo found six months later
              should be fixable. What matters is not whether they edited but that a
              reader can see they did.

              It reads `updatedAt` and nothing else. `editedAt` was documented in
              app/lib/openPages.js and existed on ZERO records — a mark wired to it
              would have been invisible on every piece ever edited. The `> createdAt`
              guard is what keeps the three founder-APPROVED pieces unmarked: they
              carry approvedAt, not updatedAt, and approval by an admin is not an
              edit by the author. */}
          {isEdited(post) ? (
            <span
              data-edited-mark
              title={`Edited ${formatDate(post.updatedAt)}`}
              style={{ fontSize: '0.82rem', color: 'rgba(245,240,232,0.45)', fontStyle: 'italic' }}
            >
              · edited {formatDate(post.updatedAt)}
            </span>
          ) : null}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: CINZEL, fontSize: 11, letterSpacing: '0.1em', color: CREAM_MUTE }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            {post.readCount || 0} reads
          </span>
          <span style={{ fontFamily: CINZEL, fontSize: 11, letterSpacing: '0.1em', color: CREAM_MUTE }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'inline-block',verticalAlign:'middle',marginRight:3}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>{readTime(post.body)} min read
          </span>
        </div>

        {/* Title */}
        <h1 style={{ fontFamily: SERIF, fontSize: '2.9rem', fontWeight: 600, color: CREAM, margin: '0 0 1.2rem', lineHeight: 1.1 }}>
          {post.title}
        </h1>

        {/* Author row — links to the writer's profile (Fix 3). */}
        <AuthorLink href={profileHref} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 34, paddingBottom: 28, borderBottom: '1px solid rgba(245,240,232,0.08)' }}>
          <AuthorAvatar src={authorAvatar} initial={initial} size={40} fontSize="1.1rem" />
          <div>
            <div style={{ fontFamily: SERIF, fontSize: '1.2rem', color: CREAM, fontWeight: 600 }}>{authorName}</div>
            {authorHandle ? (
              <div style={{ fontSize: '0.88rem', color: 'rgba(245,240,232,0.45)' }}>@{authorHandle}</div>
            ) : null}
          </div>
        </AuthorLink>

        {/* Body — R38: `.op-prose has-dropcap` is what the shared tagger scopes to. */}
        <div
          ref={proseRef}
          className="op-prose has-dropcap"
          style={{ fontFamily: BODY_SERIF, fontSize: '1.22rem', lineHeight: 1.8 }}
        >
          {renderMarkdown(post.body)}
        </div>

        {/* R38 — THE ENDING. Same 88px rule and ✦ the story page draws, on ink. */}
        <div ref={endRef} className={`op-last-page${closed ? ' op-closed' : ''}`} aria-hidden="true">
          <span className="op-lp-orn">✦</span>
          <span className="op-lp-rule" />
        </div>

        {/* R38 — the thank-you. Attention, not outcome: it says the piece HAS been read
            here, which is true of everything published, and promises nothing further.
            See app/lib/openPagesCopy.js. */}
        <p data-op-footer-note style={{ textAlign: 'center', fontFamily: BODY_SERIF, fontSize: '0.95rem', color: 'rgba(245,240,232,0.42)', margin: '0 0 8px', lineHeight: 1.6 }}>
          {PUBLISHED_FOOTER}
        </p>

        {/* Like — open_pages_reactions/{postId}/{uid}. A quiet heart + count, no
            chrome; the heart gives one small scale pulse when it turns gold. */}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 20 }}>
          <button
            type="button"
            onClick={toggleLike}
            aria-pressed={liked}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'transparent',
              border: 'none',
              padding: 0,
              color: liked ? GOLD : CREAM_MUTE,
              fontFamily: CINZEL,
              fontSize: 11,
              letterSpacing: '0.12em',
              cursor: 'pointer',
              transition: 'color 0.18s',
            }}
          >
            <IconHeart
              size={18}
              style={{ fill: liked ? GOLD : 'none', animation: liked ? 'opLikePulse 200ms ease' : 'none' }}
            />
            {likeCount}
          </button>
        </div>

        {/* Author card — enriched from users/{authorUid} (Fix 4), clickable (Fix 3). */}
        <div style={{ marginTop: 56, background: SURFACE, borderTop: '1px solid rgba(245,240,232,0.08)', border: '1px solid rgba(245,240,232,0.08)', borderRadius: 8, padding: '1.8rem' }}>
          <AuthorLink href={profileHref} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <AuthorAvatar src={authorAvatar} initial={initial} size={52} fontSize="1.4rem" />
            <div>
              <div style={{ fontFamily: CINZEL, fontSize: 9, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(201,168,76,0.6)', marginBottom: 4 }}>
                Written by
              </div>
              <div style={{ fontFamily: SERIF, fontSize: '1.5rem', color: CREAM, fontWeight: 600, lineHeight: 1.1 }}>
                {authorName}
              </div>
              {authorHandle ? (
                <div style={{ fontSize: '0.9rem', color: 'rgba(245,240,232,0.45)' }}>@{authorHandle}</div>
              ) : null}
            </div>
          </AuthorLink>
          {authorBio ? (
            <p style={{ fontFamily: BODY_SERIF, fontSize: '1rem', lineHeight: 1.7, color: 'rgba(245,240,232,0.7)', margin: '0 0 18px' }}>
              {authorBio}
            </p>
          ) : null}
          <button
            type="button"
            // UI only — subscriptions/support are wired in a later stage.
            onClick={() => {}}
            className="op-subscribe"
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              background: 'transparent',
              color: 'rgba(107,47,173,0.9)',
              border: '1px solid rgba(107,47,173,0.6)',
              borderRadius: 10,
              padding: '0.85rem 1.5rem',
              fontWeight: 700,
              fontSize: '1rem',
              fontFamily: BODY_SERIF,
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
          >
            <IconHeart size={17} /> Subscribe · Support
          </button>
          <div style={{ textAlign: 'center', fontFamily: CINZEL, fontSize: 9, letterSpacing: '0.12em', color: 'rgba(245,240,232,0.3)', marginTop: 10 }}>
            Supporting creators is coming soon.
          </div>
        </div>

        {/* Edit — owner only. Ghost button linking to the edit composer. */}
        {user && user.uid === post.authorUid ? (
          <div style={{ textAlign: 'center', marginTop: 22 }}>
            <a
              href={`/open-pages/edit/${post.id}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: 'transparent',
                color: 'rgba(245,240,232,0.7)',
                border: `1px solid ${CREAM_FAINT}`,
                borderRadius: 10,
                padding: '0.7rem 1.8rem',
                fontWeight: 600,
                fontSize: '0.95rem',
                fontFamily: BODY_SERIF,
                textDecoration: 'none',
              }}
            >
              <IconPencil size={15} /> Edit story
            </a>
          </div>
        ) : null}

        {/* Report — writes open_pages_reports/{postId}/{reporterUid}; the admin
            queue (app/admin/forum) reviews and acts on these. */}
        <div style={{ textAlign: 'center', marginTop: 30 }}>
          {reported ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.86rem', color: GOLD }}>
              <IconCheck size={15} /> Thanks — our moderators will take a look.
            </span>
          ) : reportOpen ? (
            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 12, background: SURFACE, border: '1px solid rgba(245,240,232,0.1)', borderRadius: 12, padding: '1.1rem 1.3rem' }}>
              <div style={{ fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(245,240,232,0.55)' }}>
                Why are you reporting this?
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, maxWidth: 360 }}>
                {REPORT_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    disabled={reporting}
                    onClick={() => submitReport(reason)}
                    style={{
                      background: 'rgba(245,240,232,0.04)',
                      border: '1px solid rgba(245,240,232,0.16)',
                      color: 'rgba(245,240,232,0.8)',
                      borderRadius: 999,
                      padding: '0.45rem 1rem',
                      fontSize: '0.84rem',
                      fontFamily: BODY_SERIF,
                      cursor: reporting ? 'not-allowed' : 'pointer',
                      opacity: reporting ? 0.5 : 1,
                    }}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              {reportError ? (
                <div style={{ fontSize: '0.8rem', color: '#e88' }}>{reportError}</div>
              ) : null}
              <button
                type="button"
                onClick={() => { setReportOpen(false); setReportError(''); }}
                style={{ background: 'transparent', border: 'none', color: CREAM_MUTE, fontSize: '0.8rem', fontFamily: BODY_SERIF, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleReportClick}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                background: 'transparent',
                border: 'none',
                color: CREAM_MUTE,
                fontSize: '0.86rem',
                fontFamily: BODY_SERIF,
                cursor: 'pointer',
                padding: '0.4rem 0.6rem',
              }}
            >
              <IconFlag size={14} /> Report this post
            </button>
          )}
        </div>

        {/* Comments — comments/{postId} (shared platform node). */}
        <section style={{ marginTop: 56, paddingTop: 34, borderTop: '1px solid rgba(245,240,232,0.08)' }}>
          <div style={{ fontFamily: CINZEL, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: GOLD, opacity: 0.7, marginBottom: 14 }}>
            Comments{visibleComments && visibleComments.length ? ` · ${countNodes(visibleComments)}` : ''}
          </div>
          <div style={{ borderBottom: '1px solid rgba(201,168,76,0.2)', marginBottom: 24 }} />

          {/* Composer (signed-in) or sign-in prompt (signed-out). */}
          {user ? (
            <form onSubmit={submitComment} style={{ marginBottom: 30 }}>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment…"
                rows={3}
                disabled={posting}
                className="op-input"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: SURFACE,
                  borderRadius: 6,
                  padding: '0.9rem 1rem',
                  color: CREAM,
                  fontSize: 16,
                  lineHeight: 1.6,
                  fontFamily: BODY_SERIF,
                  resize: 'vertical',
                  minHeight: 96,
                }}
              />
              <div style={{ textAlign: 'right', marginTop: 12 }}>
                <button
                  type="submit"
                  disabled={!commentText.trim() || posting}
                  style={{
                    background: commentText.trim() && !posting ? PURPLE : 'transparent',
                    color: commentText.trim() && !posting ? CREAM : CREAM_MUTE,
                    border: commentText.trim() && !posting ? 'none' : '1px solid rgba(245,240,232,0.12)',
                    borderRadius: 4,
                    padding: '10px 20px',
                    fontFamily: CINZEL,
                    fontSize: 10,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    cursor: commentText.trim() && !posting ? 'pointer' : 'not-allowed',
                  }}
                >
                  {posting ? 'Posting…' : 'Post comment'}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowAuth(true)}
              style={{
                width: '100%',
                background: SURFACE,
                border: '1px solid rgba(245,240,232,0.12)',
                borderRadius: 12,
                padding: '0.95rem 1rem',
                color: 'rgba(245,240,232,0.6)',
                fontSize: '1rem',
                fontFamily: BODY_SERIF,
                cursor: 'pointer',
                marginBottom: 30,
              }}
            >
              Sign in to leave a comment
            </button>
          )}

          {/* List */}
          {visibleComments === null ? (
            <div style={{ color: CREAM_MUTE, fontStyle: 'italic', fontFamily: SERIF, fontSize: '1.1rem' }}>
              Loading comments…
            </div>
          ) : comments.length === 0 ? (
            <div style={{ color: CREAM_MUTE, fontStyle: 'italic', fontFamily: SERIF, fontSize: '1.2rem' }}>
              No comments yet — be the first.
            </div>
          ) : (
            <div>
              {visibleComments.map((c) => renderNode(c, 0))}
              {/* R36 — WITHOUT THIS, A BLOCK IS ONE-WAY. Pruning the comment removes
                  the only control that could undo it, which would leave the reader
                  with no way back short of a settings page that does not exist. The
                  note says what is hidden and offers it back, and it is visible to
                  nobody but the blocker. */}
              {hiddenAuthors.length ? (
                <div data-hidden-note style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(245,240,232,0.08)', fontSize: '0.85rem', color: CREAM_MUTE, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span>
                    {hiddenCount} {hiddenCount === 1 ? 'comment is' : 'comments are'} hidden because you blocked{' '}
                    {hiddenAuthors.length === 1 ? 'its author' : 'their authors'}.
                  </span>
                  {hiddenAuthors.map((uid) => (
                    <button
                      key={uid}
                      type="button"
                      onClick={() => toggleBlock(uid)}
                      disabled={blockBusy === uid}
                      style={{ background: 'transparent', border: '1px solid rgba(245,240,232,0.18)', borderRadius: 999, padding: '3px 10px', color: GOLD, fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: blockBusy === uid ? 'wait' : 'pointer' }}
                    >
                      Unblock {commenterProfiles[uid]?.displayName || 'them'}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </article>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Shell + styles + icons.
// ---------------------------------------------------------------------------

// Wraps an author block in a Link to /u/{handle} when a handle is known, else a
// plain div — so name/handle/avatar are all clickable (Fix 3) without breaking
// when the author has no handle.
function AuthorLink({ href, style, children }) {
  if (href) {
    return (
      <Link href={href} style={{ ...style, textDecoration: 'none', color: 'inherit' }}>
        {children}
      </Link>
    );
  }
  return <div style={style}>{children}</div>;
}

// Real profile photo when available, else the purple-gradient initial avatar.
function AuthorAvatar({ src, initial, size = 40, fontSize = '1.1rem' }) {
  const base = { width: size, height: size, borderRadius: '50%', flexShrink: 0 };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={{ ...base, objectFit: 'cover', display: 'block', border: '1px solid rgba(245,240,232,0.1)' }} />;
  }
  return (
    <span style={{ ...base, background: `linear-gradient(135deg, ${PURPLE}, #3a1a63)`, color: CREAM, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize, fontWeight: 700, fontFamily: SERIF }}>
      {initial}
    </span>
  );
}

// Styling-only CSS: the one signature moment (heart pulse on like), the gold
// focus ring on the composers (inline styles can't express :focus), and the two
// quiet hover brightenings. Injected once via Shell.
const GLOBAL_CSS = `
@keyframes opLikePulse { from { transform: scale(1.2); } to { transform: scale(1); } }
.op-input { border: 1px solid rgba(245,240,232,0.08); outline: none; transition: border-color 0.2s; }
.op-input:focus { border-color: ${GOLD_SOFT}; }
.op-reply-btn:hover { color: ${CREAM_DIM} !important; }
.op-subscribe:hover { background: rgba(107,47,173,0.1) !important; }
`;

function Shell({ children }) {
  return (
    <div style={{ background: INK, minHeight: '100vh', color: CREAM, fontFamily: BODY_SERIF }}>
      <style>{GLOBAL_CSS}</style>
      <Navbar />
      {children}
    </div>
  );
}

const backLink = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  color: 'rgba(245,240,232,0.55)',
  textDecoration: 'none',
  fontFamily: CINZEL,
  fontSize: '0.72rem',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
};

const genrePill = {
  fontFamily: CINZEL,
  fontSize: '0.64rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: GOLD,
  background: 'rgba(201,168,76,0.1)',
  border: '1px solid rgba(201,168,76,0.3)',
  borderRadius: 999,
  padding: '0.26rem 0.8rem',
};

function Svg({ size = 18, style, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', flexShrink: 0, ...style }}>
      {children}
    </svg>
  );
}
const IconArrowLeft = (p) => (
  <Svg {...p}>
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </Svg>
);
const IconHeart = (p) => (
  <Svg {...p}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </Svg>
);
const IconPencil = (p) => (
  <Svg {...p}>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </Svg>
);
const IconFlag = (p) => (
  <Svg {...p}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </Svg>
);
const IconCheck = (p) => (
  <Svg {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
