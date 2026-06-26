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

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';
import AuthModal from '../../components/AuthModal';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { OPEN_PAGES_NODE, normalizeGenre } from '../../lib/openPages';
import { renderMarkdown } from '../../lib/openPagesMarkdown';

const REPORT_REASONS = ['Harmful content', 'Spam', 'Plagiarism', 'Other'];

// Brand palette.
const INK = '#080610';
const SURFACE = '#120d1c';
const SURFACE_2 = '#1a1326';
const PURPLE = '#6b2fad';
const GOLD = '#c9a84c';
const CREAM = '#f5f0e8';
const SERIF = "'Cormorant Garamond', 'Cochin', Georgia, serif";
const BODY_SERIF = "'Cochin', Georgia, serif";
const CINZEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
// Faint cream used for the un-liked heart and the "Reply" affordance.
const CREAM_FAINT = 'rgba(245,240,232,0.4)';
// Left rule on indented reply threads.
const THREAD_BORDER = '2px solid #2a2036';

// ---------------------------------------------------------------------------
// Comment-tree helpers (pure).
//
// Replies are stored as RTDB children of their parent:
//   comments/{postId}/{commentId}/replies/{replyId}             (level 1)
//   comments/{postId}/{commentId}/replies/{replyId}/replies/…   (level 2, max)
// So one read of comments/{postId} returns the whole tree. We normalise each
// node to { id, path, text, authorName, authorUid, createdAt, replies: [] }
// where `path` is the node's location *under* comments/{postId} — reused
// verbatim for the like path (comment_likes/{postId}/{path}/{uid}) and for the
// replies write path (comments/{postId}/{path}/replies).
// ---------------------------------------------------------------------------

function normalizeNode(id, val, path) {
  // Defensive: legacy comments (written before threading) have no `replies` key
  // and may carry unrelated fields (heartCount/fireCount/parentId from other
  // comment sections). Never throw on a missing/odd value — an intact comment of
  // just { text, authorName, authorUid, createdAt } must still render. A non-object
  // value yields an empty node rather than crashing the whole comment list.
  const v = val && typeof val === 'object' ? val : {};
  const node = {
    id,
    path,
    text: v.text,
    authorName: v.authorName,
    authorUid: v.authorUid,
    createdAt: v.createdAt,
    replies: [], // missing `replies` → empty array, not an error
  };
  if (v.replies && typeof v.replies === 'object') {
    node.replies = Object.entries(v.replies)
      .filter(([, rval]) => rval && typeof rval === 'object') // skip null/tombstoned reply entries
      .map(([rid, rval]) => normalizeNode(rid, rval, `${path}/replies/${rid}`))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); // replies read oldest-first
  }
  return node;
}

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

function formatDate(ts) {
  if (!ts || typeof ts !== 'number') return '';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
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
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState('');
  const [showAuth, setShowAuth] = useState(false);

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
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `${OPEN_PAGES_NODE}/${id}`));
        if (cancelled) return;
        const val = snap.exists() ? snap.val() : null;
        // Only ever show live posts (the public node should only hold these).
        const live = val && val.status === 'live' ? { id, ...val } : null;
        setPost(live);

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
      try {
        const { ref, get } = await import('firebase/database');
        const [rSnap, cSnap, lSnap] = await Promise.all([
          get(ref(db, `open_pages_reactions/${id}`)),
          get(ref(db, `comments/${id}`)),
          get(ref(db, `comment_likes/${id}`)),
        ]);
        if (cancelled) return;
        setReactions(rSnap.exists() ? rSnap.val() : {});
        // Top-level comments newest-first; nested replies oldest-first (normalizeNode).
        const tree = cSnap.exists()
          ? Object.entries(cSnap.val())
              .map(([cid, c]) => normalizeNode(cid, c, cid))
              .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          : [];
        setComments(tree);
        const likesMap = {};
        if (lSnap.exists()) {
          const lv = lSnap.val();
          for (const cid of Object.keys(lv)) buildLikesMap(lv[cid], cid, likesMap);
        }
        setLikes(likesMap);
      } catch (e) {
        console.error('[open-pages] reactions/comments read failed:', e);
        if (!cancelled) { setReactions({}); setComments([]); }
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
      const { ref, push, set } = await import('firebase/database');
      // Generate the key up front so the optimistic node carries its real path.
      const newRef = push(ref(db, `comments/${id}`));
      cid = newRef.key;
      const optimistic = { id: cid, path: cid, ...data, replies: [], _optimistic: true };
      setComments((prev) => [optimistic, ...(prev || [])]);
      setCommentText('');
      await set(newRef, data);
    } catch (err) {
      console.error('[open-pages] comment post failed:', err);
      if (cid) setComments((prev) => (prev || []).filter((c) => c.id !== cid));
      setCommentText(trimmed);
    }
    setPosting(false);
  }

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
      <div key={node.path}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 0', borderBottom: '1px solid rgba(245,240,232,0.06)' }}>
          <AuthorLink href={href} style={{ flexShrink: 0, display: 'block' }}>
            <AuthorAvatar src={avatar} initial={initial} size={avatarSize} fontSize={depth === 0 ? '1rem' : '0.85rem'} />
          </AuthorLink>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <AuthorLink href={href} style={{ fontFamily: SERIF, fontSize: '1.05rem', color: CREAM, fontWeight: 600 }}>
                {name}
              </AuthorLink>
              {handle ? <span style={{ fontSize: '0.82rem', color: 'rgba(245,240,232,0.4)' }}>@{handle}</span> : null}
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
                  color: liked ? GOLD : CREAM_FAINT,
                  fontSize: '0.85rem',
                  fontFamily: BODY_SERIF,
                  cursor: 'pointer',
                  transition: 'color 0.15s',
                }}
              >
                <IconHeart size={15} style={{ fill: liked ? GOLD : 'none' }} /> {likeCount}
              </button>
              {canReply ? (
                <button
                  type="button"
                  onClick={() => handleReplyClick(node)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: CREAM_FAINT,
                    fontFamily: CINZEL,
                    fontSize: '0.72rem',
                    letterSpacing: '0.08em',
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
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: SURFACE,
                    border: '1px solid rgba(245,240,232,0.12)',
                    borderRadius: 10,
                    padding: '0.7rem 0.9rem',
                    color: CREAM,
                    fontSize: '0.98rem',
                    lineHeight: 1.5,
                    fontFamily: BODY_SERIF,
                    outline: 'none',
                    resize: 'vertical',
                    minHeight: 60,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => { setReplyOpenPath(null); setReplyDraft(''); }}
                    style={{ background: 'transparent', border: 'none', color: CREAM_FAINT, fontSize: '0.85rem', fontFamily: BODY_SERIF, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!replyDraft.trim() || replySubmitting}
                    style={{
                      background: replyDraft.trim() && !replySubmitting ? PURPLE : 'rgba(245,240,232,0.1)',
                      color: replyDraft.trim() && !replySubmitting ? CREAM : 'rgba(245,240,232,0.4)',
                      border: 'none',
                      borderRadius: 8,
                      padding: '0.45rem 1.3rem',
                      fontWeight: 700,
                      fontSize: '0.88rem',
                      fontFamily: BODY_SERIF,
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
  // Prefer the live profile (Fix 4), falling back to the post's denormalized snapshot.
  const authorName = author?.displayName || post.authorName || 'Reader';
  const authorHandle = post.authorHandle || author?.username || '';
  const authorAvatar = author?.avatarUrl || author?.photoURL || post.authorAvatarUrl || null;
  const authorBio = author?.bio || '';
  const initial = (authorName || '?').trim().charAt(0).toUpperCase();
  const profileHref = authorHandle ? `/u/${authorHandle}` : null;

  return (
    <Shell>
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

        {/* Body */}
        <div style={{ fontFamily: BODY_SERIF, fontSize: '1.22rem', lineHeight: 1.8 }}>
          {renderMarkdown(post.body)}
        </div>

        {/* Like — open_pages_reactions/{postId}/{uid}. Gold when liked. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 36, paddingTop: 24, borderTop: '1px solid rgba(245,240,232,0.08)' }}>
          <button
            type="button"
            onClick={toggleLike}
            aria-pressed={liked}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 9,
              background: 'transparent',
              border: `1px solid ${liked ? 'rgba(201,168,76,0.5)' : 'rgba(245,240,232,0.18)'}`,
              borderRadius: 999,
              padding: '0.5rem 1.2rem',
              color: liked ? GOLD : 'rgba(245,240,232,0.55)',
              fontSize: '0.95rem',
              fontFamily: BODY_SERIF,
              cursor: 'pointer',
              transition: 'color 0.18s, border-color 0.18s',
            }}
          >
            <IconHeart size={18} style={{ fill: liked ? GOLD : 'none' }} />
            {likeCount}
          </button>
        </div>

        {/* Author card — enriched from users/{authorUid} (Fix 4), clickable (Fix 3). */}
        <div style={{ marginTop: 56, background: SURFACE, border: '1px solid rgba(245,240,232,0.08)', borderRadius: 16, padding: '1.8rem' }}>
          <AuthorLink href={profileHref} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <AuthorAvatar src={authorAvatar} initial={initial} size={52} fontSize="1.4rem" />
            <div>
              <div style={{ fontFamily: CINZEL, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GOLD, opacity: 0.75, marginBottom: 4 }}>
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
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              background: PURPLE,
              color: CREAM,
              border: 'none',
              borderRadius: 10,
              padding: '0.85rem 1.5rem',
              fontWeight: 700,
              fontSize: '1rem',
              fontFamily: BODY_SERIF,
              cursor: 'pointer',
              boxShadow: '0 8px 26px rgba(107,47,173,0.32)',
            }}
          >
            <IconHeart size={17} /> Subscribe · Support
          </button>
          <div style={{ textAlign: 'center', fontSize: '0.78rem', color: 'rgba(245,240,232,0.35)', marginTop: 10 }}>
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
                border: '1px solid rgba(245,240,232,0.18)',
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
                style={{ background: 'transparent', border: 'none', color: 'rgba(245,240,232,0.4)', fontSize: '0.8rem', fontFamily: BODY_SERIF, cursor: 'pointer' }}
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
                color: 'rgba(245,240,232,0.4)',
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
          <div style={{ fontFamily: CINZEL, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: GOLD, opacity: 0.85, marginBottom: 22 }}>
            Comments{comments && comments.length ? ` · ${comments.length}` : ''}
          </div>

          {/* Composer (signed-in) or sign-in prompt (signed-out). */}
          {user ? (
            <form onSubmit={submitComment} style={{ marginBottom: 30 }}>
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment…"
                rows={3}
                disabled={posting}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: SURFACE,
                  border: '1px solid rgba(245,240,232,0.12)',
                  borderRadius: 12,
                  padding: '0.9rem 1rem',
                  color: CREAM,
                  fontSize: '1.02rem',
                  lineHeight: 1.6,
                  fontFamily: BODY_SERIF,
                  outline: 'none',
                  resize: 'vertical',
                  minHeight: 84,
                }}
              />
              <div style={{ textAlign: 'right', marginTop: 12 }}>
                <button
                  type="submit"
                  disabled={!commentText.trim() || posting}
                  style={{
                    background: commentText.trim() && !posting ? PURPLE : 'rgba(245,240,232,0.1)',
                    color: commentText.trim() && !posting ? CREAM : 'rgba(245,240,232,0.4)',
                    border: 'none',
                    borderRadius: 9,
                    padding: '0.6rem 1.8rem',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    fontFamily: BODY_SERIF,
                    cursor: commentText.trim() && !posting ? 'pointer' : 'not-allowed',
                    boxShadow: commentText.trim() && !posting ? '0 8px 22px rgba(107,47,173,0.3)' : 'none',
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

          {/* TEMPORARY DEBUG — confirm the post id reaching the fetch. */}
          <div style={{background:'#1a1326', border:'1px solid #6b2fad', borderRadius:6, padding:12, marginBottom:16, fontSize:12, fontFamily:'monospace', color:'#c9a84c', whiteSpace:'pre-wrap', wordBreak:'break-all'}}>
            Post ID: {String(id)} (type: {typeof id})
          </div>

          {/* List */}
          {comments === null ? (
            <div style={{ color: 'rgba(245,240,232,0.4)', fontStyle: 'italic', fontFamily: SERIF, fontSize: '1.1rem' }}>
              Loading comments…
            </div>
          ) : comments.length === 0 ? (
            <div style={{ color: 'rgba(245,240,232,0.4)', fontStyle: 'italic', fontFamily: SERIF, fontSize: '1.2rem' }}>
              No comments yet — be the first.
            </div>
          ) : (
            <div>
              {comments.map((c) => renderNode(c, 0))}
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

function Shell({ children }) {
  return (
    <div style={{ background: INK, minHeight: '100vh', color: CREAM, fontFamily: BODY_SERIF }}>
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
