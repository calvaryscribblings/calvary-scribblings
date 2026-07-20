'use client';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import React from 'react';
import { stories } from '../../lib/stories';
import { resolveAuthorNames, currentAuthorName } from '../../lib/resolveAuthorNames';
import MentionTextarea from '../../components/MentionTextarea';
import { notifyMentions } from '../../lib/mentions';
import { updateStreak } from '../../lib/streakEngine';
import { checkAndAwardBadges } from '../../lib/badgeEngine';
import QuizCard from '../../components/QuizCard';
import AuthModal from '../../components/AuthModal';
import AboutTheAuthor from '../../components/AboutTheAuthor';
import ReadSeal from '../../components/ReadSeal';
import { use } from 'react';
import { useDeletedUids } from '../../lib/userVisibility';
import { getReaderId } from '../../lib/readerId';
import { Avatar, UserBadge, timeAgo, renderMentions, ReactionRow, buildReactions } from '../../components/conversation/ConversationKit';

const COMMENT_REACTIONS = buildReactions('heart');

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
async function getDB() {
  const { getDatabase } = await import('firebase/database');
  return getDatabase(await getApp());
}
async function getFirebaseAuth() {
  const { getAuth } = await import('firebase/auth');
  return getAuth(await getApp());
}

const FONT_SIZES = [14, 16, 18, 20, 22];
const FOUNDER_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
function CommentUsername({ uid }) {
  const [username, setUsername] = useState(null);
  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `users/${uid}/username`));
        if (snap.exists()) setUsername(snap.val());
      } catch (e) {}
    })();
  }, [uid]);
  if (!username) return null;
  return <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'rgba(245,240,232,0.45)', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>@{username}</span>;
}

function CommentName({ uid, fallback }) {
  const [name, setName] = useState(null);
  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `users/${uid}/displayName`));
        if (snap.exists()) setName(snap.val());
      } catch (e) {}
    })();
  }, [uid]);
  return <>{name || fallback}</>;
}

const CommentNode = React.memo(function CommentNode({
  comment, depth, parentAuthorName,
  user, comments, commentReactions,
  replyTo, replyText, editingId, editText, menuId, posting,
  setReplyTo, setReplyText, setEditingId, setEditText, setMenuId,
  toggleCommentReaction, postComment, editComment, deleteComment,
}) {
  const isOwn = user?.uid === comment.authorUid;
  const children = comments.filter(c => c.parentId === comment.id).sort((a, b) => a.createdAt - b.createdAt);
  const visualDepth = Math.min(depth, 3);
  const isFlattened = depth > 3;
  const indentPx = (visualDepth - 1) * 28;

  return (
    <div style={{ marginLeft: indentPx }}>
      <div className={depth === 1 ? "cs-comment" : "cs-reply"}>
        <Avatar variant="comment" uid={comment.authorUid} initials={comment.authorInitials} size={depth === 1 ? "sm" : "xs"} isOwn={isOwn} />
        <div className="cs-comment-body">
          <div className="cs-comment-header" style={{ position: 'relative' }}>
            <a href={isOwn ? '/profile' : `/user?id=${comment.authorUid}`} className="cs-name cs-name-link"><CommentName uid={comment.authorUid} fallback={comment.authorName} /></a>
            <CommentUsername uid={comment.authorUid} />
            <UserBadge self uid={comment.authorUid} size={depth === 1 ? 13 : 12} labelSize="0.68rem" gap="4px" />
            <span className="cs-time" style={{ marginLeft: -2 }}>· {timeAgo(comment.createdAt)}</span>
            {comment.editedAt && <span className="cs-time"> · edited</span>}
            {isOwn && (
              <div style={{ marginLeft: 'auto', position: 'relative' }}>
                <button onClick={() => setMenuId(menuId === comment.id ? null : comment.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '0 4px', fontSize: '1rem', lineHeight: 1 }}>···</button>
                {menuId === comment.id && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setMenuId(null)} />
                    <div style={{ position: 'absolute', right: 0, top: '100%', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, zIndex: 100, minWidth: 110, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
                      <button onClick={() => { setEditingId(comment.id); setEditText(comment.text); setMenuId(null); }} style={{ display: 'block', width: '100%', padding: '0.6rem 1rem', background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.85rem', fontWeight: 500, textAlign: 'left', cursor: 'pointer' }}>Edit</button>
                      <button onClick={() => { setMenuId(null); if (window.confirm(depth === 1 ? 'Delete this comment?' : 'Delete this reply?')) deleteComment(comment.id); }} style={{ display: 'block', width: '100%', padding: '0.6rem 1rem', background: 'none', border: 'none', color: 'rgba(248,113,113,0.7)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.85rem', fontWeight: 500, textAlign: 'left', cursor: 'pointer' }}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className={depth === 1 ? "cs-comment-text" : "cs-comment-text cs-comment-text-sm"}>
            {editingId === comment.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <MentionTextarea value={editText} onChange={setEditText} className="cs-textarea cs-textarea-sm" rows={2} autoFocus />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="cs-save-btn" onClick={() => editComment(comment.id)}>Save</button>
                  <button className="cs-cancel-btn" onClick={() => { setEditingId(null); setEditText(''); }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {isFlattened && parentAuthorName && (
                  <span style={{ color: '#c9a84c', fontWeight: 500, marginRight: 4 }}>@{parentAuthorName}</span>
                )}
                {renderMentions(comment.text)}
              </>
            )}
          </div>
          <ReactionRow
            reactions={COMMENT_REACTIONS}
            item={comment}
            activeMap={commentReactions[comment.id]}
            onToggle={(key) => toggleCommentReaction(comment.id, key, comment.authorUid)}
            canReact={!!user}
            iconSize={depth === 1 ? 16 : 14}
            trailing={user && <button className="cs-reply-btn" onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}>{replyTo === comment.id ? 'Cancel' : 'Reply'}</button>}
          />
          {replyTo === comment.id && (
            <div className="cs-reply-compose">
              <div className="cs-input-wrap">
                <MentionTextarea value={replyText} onChange={setReplyText} placeholder={`Reply to ${comment.authorName}...`} className="cs-textarea cs-textarea-sm" rows={2} autoFocus />
                <button className={`cs-kite-btn${replyText.trim() ? ' active' : ''}`} onClick={() => postComment(replyText, comment.id)} disabled={posting || !replyText.trim()}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 3L3 10.5l7.5 3L18 6l-7.5 7.5 3 7.5L21 3z" fill="#c9a84c"/></svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {children.length > 0 && (
        <div className="cs-replies">
          {children.map(child => (
            <CommentNode
              key={child.id} comment={child} depth={depth + 1} parentAuthorName={comment.authorName}
              user={user} comments={comments} commentReactions={commentReactions}
              replyTo={replyTo} replyText={replyText} editingId={editingId} editText={editText} menuId={menuId} posting={posting}
              setReplyTo={setReplyTo} setReplyText={setReplyText} setEditingId={setEditingId} setEditText={setEditText} setMenuId={setMenuId}
              toggleCommentReaction={toggleCommentReaction} postComment={postComment} editComment={editComment} deleteComment={deleteComment}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function CommentsSection({ slug, onSignIn }) {
  const [user, setUser] = useState(null);
  const [userAvatarUrl, setUserAvatarUrl] = useState(null);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [commentReactions, setCommentReactions] = useState({});
  const [menuId, setMenuId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    let unsubAuth;
    (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      unsubAuth = onAuthStateChanged(auth, async (u) => {
        setUser(u);
        if (u) {
          try {
            const db = await getDB();
            const { ref, get } = await import('firebase/database');
            const avSnap = await get(ref(db, `users/${u.uid}/avatarUrl`));
            if (avSnap.exists()) setUserAvatarUrl(avSnap.val());
          } catch (e) {}
        }
      });
    })();
    return () => { if (unsubAuth) unsubAuth(); };
  }, []);

  useEffect(() => {
    if (!slug) return;
    let unsubDB, unsubReactions;
    (async () => {
      setLoading(true);
      try {
        const db = await getDB();
        const { ref, onValue } = await import('firebase/database');
        if (user) {
          unsubReactions = onValue(ref(db, `comment_reactions/${slug}/${user.uid}`), (snap) => {
            if (snap.exists()) setCommentReactions(snap.val());
            else setCommentReactions({});
          });
        }
        unsubDB = onValue(ref(db, `comments/${slug}`), (snap) => {
          if (snap.exists()) {
            const list = Object.entries(snap.val()).map(([id, c]) => ({ id, ...c })).sort((a, b) => b.createdAt - a.createdAt);
            setComments(list);
          } else { setComments([]); }
          setLoading(false);
        });
      } catch (e) { setLoading(false); }
    })();
    return () => { if (unsubDB) unsubDB(); if (unsubReactions) unsubReactions(); };
  }, [slug, user]);

  const toggleCommentReaction = useCallback(async (commentId, type, commentAuthorUid) => {
    if (!user) return;
    try {
      const db = await getDB();
      const { ref, set, remove, runTransaction, push } = await import('firebase/database');
      const reactionRef = ref(db, `comment_reactions/${slug}/${user.uid}/${commentId}/${type}`);
      const countRef = ref(db, `comments/${slug}/${commentId}/${type}Count`);
      const hasReacted = commentReactions[commentId]?.[type];
      if (hasReacted) {
        await remove(reactionRef);
        await runTransaction(countRef, c => Math.max(0, (c || 0) - 1));
      } else {
        await set(reactionRef, true);
        await runTransaction(countRef, c => (c || 0) + 1);
        if (commentAuthorUid && commentAuthorUid !== user.uid) {
          await push(ref(db, `library_notifications/${commentAuthorUid}`), {
            type, fromUid: user.uid, fromName: user.displayName || 'Reader',
            slug, read: false, createdAt: Date.now(),
          });
        }
      }
      setCommentReactions(prev => {
        const updated = { ...prev };
        if (!updated[commentId]) updated[commentId] = {};
        updated[commentId] = { ...updated[commentId], [type]: !hasReacted };
        return updated;
      });
    } catch (e) {}
  }, [user, slug, commentReactions]);

  const postComment = useCallback(async (commentText, parentId = null) => {
    if (!commentText.trim() || !user) return;
    setPosting(true);
    try {
      const db = await getDB();
      const { ref, push, get, update } = await import('firebase/database');
      await push(ref(db, `comments/${slug}`), {
        text: commentText.trim(),
        authorName: user.displayName || 'Reader',
        authorInitials: (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
        authorUid: user.uid,
        parentId: parentId || null,
        createdAt: Date.now(),
      });
      try {
        await notifyMentions({
          text: commentText.trim(), slug,
          fromUid: user.uid, fromName: user.displayName || 'Reader',
          excludeUid: user.uid,
        });
      } catch (e) {}
      if (parentId) {
        const parentComment = comments.find(c => c.id === parentId);
        if (parentComment && parentComment.authorUid !== user.uid) {
          await push(ref(db, `library_notifications/${parentComment.authorUid}`), {
            type: 'reply', fromUid: user.uid,
            fromName: user.displayName || 'Reader',
            slug, read: false, createdAt: Date.now(),
          });
        }
        setReplyText(''); setReplyTo(null);
      } else setText('');
      try {
        const commentsSnap = await get(ref(db, 'comments'));
        let userCommentCount = 0;
        if (commentsSnap.exists()) {
          Object.values(commentsSnap.val()).forEach(slugComments => {
            Object.values(slugComments).forEach(c => { if (c.authorUid === user.uid) userCommentCount++; });
          });
        }
        if (userCommentCount > 0 && userCommentCount % 50 === 0) {
          const pointsSnap = await get(ref(db, `points/${user.uid}/total`));
          const current = pointsSnap.exists() ? pointsSnap.val() : 0;
          await update(ref(db, `points/${user.uid}`), { total: current + 10 });
          await push(ref(db, `points/${user.uid}/history`), {
            type: 'comment', amount: 10,
            description: `${userCommentCount} comments milestone`,
            createdAt: Date.now(),
          });
        }
      } catch (e) {}
    } catch (e) {}
    setPosting(false);
  }, [user, slug, comments]);

  const editComment = useCallback(async (commentId) => {
    if (!editText.trim() || !user) return;
    try {
      const db = await getDB();
      const { ref, update } = await import('firebase/database');
      await update(ref(db, `comments/${slug}/${commentId}`), {
        text: editText.trim(),
        editedAt: Date.now(),
      });
      setEditingId(null);
      setEditText('');
    } catch (e) {}
  }, [user, slug, editText]);

  const deleteComment = useCallback(async (commentId) => {
    if (!user) return;
    try {
      const db = await getDB();
      const { ref, remove } = await import('firebase/database');
      await remove(ref(db, `comments/${slug}/${commentId}`));
    } catch (e) {}
  }, [user, slug]);

  const userInitials = user ? (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '';
  const deletedCommentAuthors = useDeletedUids(comments.map(c => c.authorUid));
  const visibleComments = deletedCommentAuthors
    ? comments.filter(c => !deletedCommentAuthors.has(c.authorUid))
    : comments;
  const topLevel = visibleComments.filter(c => !c.parentId);

  return (
    <div className="cs-section">
      <div className="cs-header">
        <div className="cs-title">Discussion</div>
        {comments.length > 0 && <div className="cs-count">{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</div>}
      </div>
      {user ? (
        <div className="cs-compose">
          <div className="cs-compose-row">
            <a href="/profile" className="cs-avatar-compose">
              {userAvatarUrl ? <img src={userAvatarUrl} alt={userInitials} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} /> : userInitials}
            </a>
            <div className="cs-input-wrap">
              <MentionTextarea value={text} onChange={setText} placeholder="Share your thoughts on this story..." rows={3} />
              <button className={`cs-kite-btn${text.trim() ? ' active' : ''}`} onClick={() => postComment(text)} disabled={posting || !text.trim()} title="Post comment">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 3L3 10.5l7.5 3L18 6l-7.5 7.5 3 7.5L21 3z" fill="#c9a84c"/></svg>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="cs-signin-prompt">
          <p>Sign in to join the discussion</p>
          <button className="cs-signin-btn" onClick={onSignIn}>Sign in to comment</button>
        </div>
      )}
      {loading ? (
        <div className="cs-loading">Loading comments...</div>
      ) : topLevel.length === 0 ? (
        <div className="cs-empty">No comments yet. Be the first to share your thoughts.</div>
      ) : (
        <div className="cs-comments-list">
          {topLevel.map((comment, i) => (
            <React.Fragment key={comment.id}>
              {i > 0 && <div className="cs-divider" aria-hidden="true" />}
              <CommentNode
                comment={comment} depth={1} parentAuthorName={null}
                user={user} comments={visibleComments} commentReactions={commentReactions}
                replyTo={replyTo} replyText={replyText} editingId={editingId} editText={editText} menuId={menuId} posting={posting}
                setReplyTo={setReplyTo} setReplyText={setReplyText} setEditingId={setEditingId} setEditText={setEditText} setMenuId={setMenuId}
                toggleCommentReaction={toggleCommentReaction} postComment={postComment} editComment={editComment} deleteComment={deleteComment}
              />
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THE READING ROOM (R4a) — chrome, Typesetter, CFI progress, ribbons, search.
// The iframe host is public/reading-room.html (Calvary-owned; imports foliate-js
// read-only from /vendor/…). This component owns the shell and the postMessage bridge.
// ─────────────────────────────────────────────────────────────────────────────

// Paper themes REPLACE-RENAME the four legacy themes; mapped onto the host's setStyles.
const PAPERS = {
  vellum: { label: 'Vellum', bg: '#f2ecd9', fg: '#2b2418' },
  ivory: { label: 'Ivory', bg: '#faf7f0', fg: '#1f1c16' },
  dusk: { label: 'Dusk', bg: '#211d16', fg: '#ddd2b8' },
  ink: { label: 'Ink', bg: '#0a0a0a', fg: '#d9d2bf' },
};
const PAPER_ORDER = ['vellum', 'ivory', 'dusk', 'ink'];
const FACES = {
  cormorant: { label: 'Cormorant', css: "'Cormorant Garamond', Georgia, serif" },
  literata: { label: 'Literata', css: "'Literata', Georgia, serif" },
  inter: { label: 'Inter', css: "'Inter', system-ui, sans-serif" },
};
const FACE_ORDER = ['cormorant', 'literata', 'inter'];
const SIZE_MIN = 70, SIZE_MAX = 180, SIZE_STEP = 10;
const LEAD_MIN = 1.3, LEAD_MAX = 2.2, LEAD_STEP = 0.08;
const DEFAULT_PREFS = { paper: 'vellum', face: 'cormorant', sizePct: 100, leading: 1.6, flow: 'paginated' };
const PREFS_KEY = 'readingRoom.prefs';
const CHROME_IDLE_MS = 3500;

function loadPrefs() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null;
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_PREFS }; }
}
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {} }
function clampLeading(v) { return Math.min(LEAD_MAX, Math.max(LEAD_MIN, Math.round(v * 100) / 100)); }
function stylesMsg(p) {
  const paper = PAPERS[p.paper] || PAPERS.vellum;
  return { type: 'applyStyles', bg: paper.bg, fg: paper.fg, face: p.face, sizePct: p.sizePct, leading: p.leading, justify: true };
}
function readingRoomSrc(epubUrl, p) {
  const paper = PAPERS[p.paper] || PAPERS.vellum;
  const qs = new URLSearchParams({
    url: epubUrl, bg: paper.bg, fg: paper.fg, face: p.face,
    size: String(p.sizePct), leading: String(p.leading), flow: p.flow,
  });
  return '/reading-room.html?' + qs.toString();
}

// ── Typesetter (Part 3) ────────────────────────────────────────────────────────
function TypesetterPanel({ prefs, onPaper, onFace, onSize, onLeading, onFlow, onClose }) {
  return (
    <div className="rr-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rr-sheet" role="dialog" aria-label="The Typesetter">
        <div className="rr-grab" />
        <div className="rr-sheet-title">&#10086; The Typesetter</div>

        <div className="rr-row-label">Paper</div>
        <div className="rr-swatches">
          {PAPER_ORDER.map((k) => (
            <button key={k} className={'rr-swatch' + (prefs.paper === k ? ' active' : '')} onClick={() => onPaper(k)} aria-label={PAPERS[k].label}>
              <span className="rr-swatch-page" style={{ background: PAPERS[k].bg, color: PAPERS[k].fg }}>Aa</span>
              <span className="rr-swatch-name">{PAPERS[k].label}</span>
            </button>
          ))}
        </div>

        <div className="rr-row-label">Typeface</div>
        <div className="rr-faces">
          {FACE_ORDER.map((k) => (
            <button key={k} className={'rr-face' + (prefs.face === k ? ' active' : '')} onClick={() => onFace(k)} style={{ fontFamily: FACES[k].css }}>{FACES[k].label}</button>
          ))}
        </div>

        <div className="rr-stepper-row">
          <span className="rr-row-label">Size</span>
          <div className="rr-stepper">
            <button className="rr-step" onClick={() => onSize(-SIZE_STEP)} disabled={prefs.sizePct <= SIZE_MIN} aria-label="Smaller">&minus;</button>
            <span className="rr-step-val">{prefs.sizePct}%</span>
            <button className="rr-step" onClick={() => onSize(SIZE_STEP)} disabled={prefs.sizePct >= SIZE_MAX} aria-label="Larger">+</button>
          </div>
        </div>

        <div className="rr-stepper-row">
          <span className="rr-row-label">Leading</span>
          <div className="rr-stepper">
            <button className="rr-step" onClick={() => onLeading(-LEAD_STEP)} disabled={prefs.leading <= LEAD_MIN} aria-label="Tighter">&minus;</button>
            <span className="rr-step-val">{prefs.leading.toFixed(2)}</span>
            <button className="rr-step" onClick={() => onLeading(LEAD_STEP)} disabled={prefs.leading >= LEAD_MAX} aria-label="Looser">+</button>
          </div>
        </div>

        <div className="rr-stepper-row">
          <span className="rr-row-label">Flow</span>
          <div className="rr-toggle">
            <button className={'rr-toggle-opt' + (prefs.flow === 'paginated' ? ' active' : '')} onClick={() => onFlow('paginated')}>Pages</button>
            <button className={'rr-toggle-opt' + (prefs.flow === 'scrolled' ? ' active' : '')} onClick={() => onFlow('scrolled')}>Scroll</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Contents + Ribbons (Parts 4 & 5) ─────────────────────────────────────────────
function ContentsPanel({ toc, chapterHref, ribbons, onJump, onRemoveRibbon, onClose }) {
  return (
    <div className="rr-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rr-sheet rr-sheet-tall" role="dialog" aria-label="Contents">
        <div className="rr-grab" />
        <div className="rr-sheet-title">&#10086; Contents</div>
        <div className="rr-scroll">
          {toc.length === 0
            ? <div className="rr-empty">No chapters listed for this book.</div>
            : toc.map((c, i) => (
              <button key={i} className={'rr-toc-item' + (c.href && c.href === chapterHref ? ' current' : '')} style={{ paddingInlineStart: `${1 + c.level * 1.1}rem` }} onClick={() => c.href && onJump(c.href)} disabled={!c.href}>{c.label}</button>
            ))}

          {ribbons.length > 0 && (
            <>
              <div className="rr-section-label">Ribbons</div>
              {ribbons.map((r) => (
                <div key={r.id} className="rr-ribbon-row">
                  <button className="rr-ribbon-jump" onClick={() => onJump(r.cfi)}>
                    <span className="rr-ribbon-dot" />
                    <span>
                      <span className="rr-ribbon-label">{r.label || 'Bookmarked passage'}</span>
                      <span className="rr-ribbon-time">{timeAgo(r.createdAt)}</span>
                    </span>
                  </button>
                  <button className="rr-ribbon-x" onClick={() => onRemoveRibbon(r)} aria-label="Remove ribbon">&times;</button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Search (Part 5) ───────────────────────────────────────────────────────────
function SearchPanel({ query, setQuery, results, truncated, searching, onPick, onClose }) {
  return (
    <div className="rr-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rr-sheet rr-sheet-tall" role="dialog" aria-label="Search">
        <div className="rr-grab" />
        <div className="rr-search-head">
          <input
            className="rr-search-input" autoFocus value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this book…" enterKeyHint="search"
          />
          <button className="rr-search-close" onClick={onClose} aria-label="Close search">&times;</button>
        </div>
        <div className="rr-scroll">
          {searching && <div className="rr-empty">Searching…</div>}
          {!searching && query.trim() && results.length === 0 && <div className="rr-empty">No matches.</div>}
          {results.map((r, i) => (
            <button key={i} className="rr-result" onClick={() => onPick(r)}>
              {r.chapterLabel && <span className="rr-result-chapter">{r.chapterLabel}</span>}
              <span className="rr-result-excerpt">{r.pre}<mark>{r.match}</mark>{r.post}</span>
            </button>
          ))}
          {truncated && <div className="rr-empty">Showing the first 50 matches — refine your search.</div>}
        </div>
      </div>
    </div>
  );
}

export default function StoryReaderClient({ params }) {
  const { slug } = use(params);
  const [story, setStory] = useState(stories.find(s => s.id === slug) || null);
  const [showCover, setShowCover] = useState(true);
  const [showEnd, setShowEnd] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [hitCount, setHitCount] = useState(null);
  const [readerUser, setReaderUser] = useState(null);
  const [progress, setProgress] = useState(0);
  const [readerReady, setReaderReady] = useState(false);
  const [resumeToast, setResumeToast] = useState(false);
  const [toastFading, setToastFading] = useState(false);

  // Reading Room chrome state
  const [chromeVisible, setChromeVisible] = useState(true);
  const [panel, setPanel] = useState('none'); // 'none' | 'type' | 'toc' | 'search'
  const [reduced, setReduced] = useState(false);

  // Typesetter prefs (device-level, localStorage). Captured once so the iframe src is stable.
  const prefsInit = useRef(null);
  if (!prefsInit.current) prefsInit.current = loadPrefs();
  const [prefs, setPrefs] = useState(prefsInit.current);
  const prefsRef = useRef(prefs);
  useEffect(() => { prefsRef.current = prefs; }, [prefs]);

  // Location / progress
  const [fraction, setFraction] = useState(0);
  const [chapterLabel, setChapterLabel] = useState('');
  const [chapterHref, setChapterHref] = useState('');
  const [botInfo, setBotInfo] = useState({ cur: null, total: null, pct: 0, minLeft: null });
  const [toc, setToc] = useState([]);
  const [ribbons, setRibbons] = useState([]);
  const [ribbonDropping, setRibbonDropping] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searching, setSearching] = useState(false);

  const iframeRef = useRef(null);
  const progressSaveTimer = useRef(null);
  const hitFired = useRef(false);
  const currentCFI = useRef('');
  const currentFraction = useRef(0);
  const restoreTargetRef = useRef(null);     // CFI to restore on ready
  const restoreFractionRef = useRef(null);   // fraction fallback (old shape)
  const idleTimer = useRef(null);
  const panelRef = useRef('none');
  useEffect(() => { panelRef.current = panel; }, [panel]);
  const searchIdRef = useRef(0);
  const searchDebounce = useRef(null);

  useEffect(() => { setReduced(!!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)); }, []);

  const postToFrame = useCallback((msg) => {
    try { iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin); } catch {}
  }, []);

  // Read counter — engagement-gated, fired once per load (PRESERVED from the previous reader).
  const fireReadHit = useCallback(() => {
    if (hitFired.current) return;
    hitFired.current = true;
    getReaderId().then((readerId) => {
      const qs = `?slug=${encodeURIComponent(slug)}&readerId=${encodeURIComponent(readerId)}`;
      fetch(`/api/hit${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, readerId }) })
        .then((r) => r.json())
        .then((d) => { if (typeof d.count === 'number') setHitCount(d.count); })
        .catch(() => {});
    });
  }, [slug]);

  // Auth observer for QuizCard / progress / ribbons (PRESERVED).
  useEffect(() => {
    let unsub;
    (async () => {
      try {
        const auth = await getFirebaseAuth();
        const { onAuthStateChanged } = await import('firebase/auth');
        unsub = onAuthStateChanged(auth, u => setReaderUser(u));
      } catch {}
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  // cms_stories fallback load (PRESERVED — the free-story regression guard: hardcoded stories are
  // already in `story` state from the first render; this only runs for non-hardcoded slugs).
  useEffect(() => {
    if (story) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'cms_stories/' + slug));
        if (snap.exists()) {
          const data = { id: slug, ...snap.val() };
          const nameMap = await resolveAuthorNames([data]);
          data.author = currentAuthorName(data, nameMap);
          setStory(data);
        }
      } catch (e) {}
    })();
  }, [slug]);

  // No EPUB → send to the story page (PRESERVED).
  useEffect(() => {
    if (story && !story.epubUrl) window.location.replace(`/stories/${slug}`);
  }, [story, slug]);

  // Restore lookup: read the CFI progress once, queue the restore target for the ready event.
  // Fallback chain: {cfi} → goTo(cfi); {fraction} (old shape) or bare number → goToFraction once
  // (the next relocate re-saves in the new shape). Ready-gated in the host (no restore race).
  useEffect(() => {
    if (!slug) return;
    const timeout = setTimeout(() => setReaderReady(true), 3000);
    (async () => {
      try {
        const auth = await getFirebaseAuth();
        const { onAuthStateChanged } = await import('firebase/auth');
        const unsub = onAuthStateChanged(auth, async (user) => {
          clearTimeout(timeout);
          if (!user) { setReaderReady(true); return; } unsub();
          try {
            const db = await getDB();
            const { ref, get } = await import('firebase/database');
            const snap = await get(ref(db, `users/${user.uid}/readerProgress/${slug}`));
            if (snap.exists()) {
              const v = snap.val();
              if (typeof v === 'number') { restoreFractionRef.current = v; }
              else if (v && typeof v.cfi === 'string' && v.cfi) { restoreTargetRef.current = v.cfi; }
              else if (v && typeof v.fraction === 'number') { restoreFractionRef.current = v.fraction; }
              if (restoreTargetRef.current || restoreFractionRef.current) {
                setResumeToast(true);
                setTimeout(() => setToastFading(true), 3200);
                setTimeout(() => setResumeToast(false), 3800);
              }
            }
          } catch (e) {}
          setReaderReady(true);
        });
      } catch (e) { setReaderReady(true); }
    })();
    return () => clearTimeout(timeout);
  }, [slug]);

  // Ribbons: live subscription per user per book (PRESERVED persistence surface, mirrored).
  useEffect(() => {
    if (!readerUser || !slug) { setRibbons([]); return; }
    let unsub;
    (async () => {
      try {
        const db = await getDB();
        const { ref, onValue } = await import('firebase/database');
        unsub = onValue(ref(db, `readerBookmarks/${readerUser.uid}/${slug}`), (snap) => {
          const out = [];
          if (snap.exists()) snap.forEach((c) => { out.push({ id: c.key, ...(c.val() || {}) }); return false; });
          out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          setRibbons(out);
        });
      } catch (e) {}
    })();
    return () => { if (unsub) unsub(); };
  }, [readerUser?.uid, slug]);

  // Auto-save CFI progress (debounced ~2s). New shape: { cfi, fraction, updatedAt }.
  useEffect(() => {
    if (!readerUser) return;
    if (!progress || progress < 1) return;
    if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
    progressSaveTimer.current = setTimeout(async () => {
      try {
        const db = await getDB();
        const { ref, set } = await import('firebase/database');
        await set(ref(db, `users/${readerUser.uid}/readerProgress/${slug}`), {
          cfi: currentCFI.current || null,
          fraction: currentFraction.current || progress / 100,
          updatedAt: Date.now(),
        });
      } catch (e) { console.warn('[reader] readerProgress save failed:', e); }
    }, 2000);
    return () => { if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current); };
  }, [progress, readerUser?.uid, slug]);

  // Read counter — 12s foreground-dwell fallback (PRESERVED).
  useEffect(() => {
    if (!slug) return undefined;
    let dwellMs = 0;
    let lastTick = document.visibilityState === 'visible' ? Date.now() : null;
    const tick = () => {
      if (hitFired.current) return;
      if (document.visibilityState !== 'visible') { lastTick = null; return; }
      const now = Date.now();
      if (lastTick != null) dwellMs += now - lastTick;
      lastTick = now;
      if (dwellMs >= 12000) fireReadHit();
    };
    const onVis = () => { lastTick = document.visibilityState === 'visible' ? Date.now() : null; };
    const interval = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVis); };
  }, [slug, fireReadHit]);

  // Streak / badges / read tracking (PRESERVED).
  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const auth = await getFirebaseAuth();
        const { onAuthStateChanged } = await import('firebase/auth');
        const u = onAuthStateChanged(auth, async (user) => {
          if (!user) return; u();
          const db = await getDB();
          updateStreak(user.uid, db)
            .then(changed => { if (changed) checkAndAwardBadges(user.uid, db).catch(() => {}); })
            .catch(() => {});
          const { ref, get, set, runTransaction } = await import('firebase/database');
          const rr = ref(db, 'users/' + user.uid + '/readStories/' + slug);
          const s = await get(rr);
          if (!s.exists()) {
            await set(rr, true);
            await runTransaction(ref(db, 'users/' + user.uid + '/readCount'), c => (c || 0) + 1);
          }
        });
      } catch (e) {}
    })();
  }, [slug]);

  // ── Chrome vanishing behaviour ────────────────────────────────────────────────
  const bumpIdle = useCallback(() => {
    setChromeVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (panelRef.current !== 'none') return; // never auto-hide with a panel open
    idleTimer.current = setTimeout(() => { if (panelRef.current === 'none') setChromeVisible(false); }, CHROME_IDLE_MS);
  }, []);
  const toggleChrome = useCallback(() => {
    if (panelRef.current !== 'none') return;
    setChromeVisible((v) => {
      const nv = !v;
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (nv) idleTimer.current = setTimeout(() => { if (panelRef.current === 'none') setChromeVisible(false); }, CHROME_IDLE_MS);
      return nv;
    });
  }, []);
  const openPanel = useCallback((name) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    setChromeVisible(true);
    setPanel(name);
  }, []);
  const closePanel = useCallback(() => {
    setPanel('none');
    postToFrame({ type: 'clearSearch' });
    bumpIdle();
  }, [postToFrame, bumpIdle]);

  // Kick off the idle countdown once reading begins.
  useEffect(() => {
    if (!showCover && !showEnd) bumpIdle();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [showCover, showEnd, bumpIdle]);

  // ── The postMessage bridge (origin-locked) ───────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.origin !== window.location.origin) return; // HYGIENE: origin lock (was '*')
      const d = e.data || {};
      if (d.type === 'ready') {
        setToc(Array.isArray(d.toc) ? d.toc : []);
        postToFrame(stylesMsg(prefsRef.current));
        postToFrame({ type: 'setFlow', flow: prefsRef.current.flow });
        if (restoreTargetRef.current) postToFrame({ type: 'goTo', cfi: restoreTargetRef.current });
        else if (restoreFractionRef.current != null) postToFrame({ type: 'goToFraction', fraction: restoreFractionRef.current });
      } else if (d.type === 'relocate') {
        fireReadHit();
        currentCFI.current = d.cfi || currentCFI.current;
        currentFraction.current = typeof d.fraction === 'number' ? d.fraction : currentFraction.current;
        setFraction(currentFraction.current);
        setProgress(currentFraction.current * 100);
        setChapterLabel(d.chapterLabel || '');
        if (d.chapterHref) setChapterHref(d.chapterHref);
        setBotInfo({ cur: d.pageCurrent, total: d.pageTotal, pct: d.pct, minLeft: d.minLeft });
      } else if (d.type === 'ended') {
        setShowEnd(true);
      } else if (d.type === 'toggleChrome') {
        toggleChrome();
      } else if (d.type === 'searchResults' && d.id === searchIdRef.current) {
        setSearchResults(Array.isArray(d.results) ? d.results : []);
        setSearchTruncated(!!d.truncated);
        setSearching(false);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [postToFrame, fireReadHit, toggleChrome]);

  // ── Typesetter handlers ───────────────────────────────────────────────────────
  const applyPrefs = useCallback((patch, kind) => {
    setPrefs((p) => {
      const np = { ...p, ...patch };
      savePrefs(np);
      if (kind === 'flow') postToFrame({ type: 'setFlow', flow: np.flow });
      else postToFrame(stylesMsg(np));
      return np;
    });
  }, [postToFrame]);
  const onPaper = (k) => applyPrefs({ paper: k });
  const onFace = (k) => applyPrefs({ face: k });
  const onSize = (delta) => applyPrefs({ sizePct: Math.min(SIZE_MAX, Math.max(SIZE_MIN, prefsRef.current.sizePct + delta)) });
  const onLeading = (delta) => applyPrefs({ leading: clampLeading(prefsRef.current.leading + delta) });
  const onFlow = (flow) => applyPrefs({ flow }, 'flow');

  // ── Ribbon drop / remove ──────────────────────────────────────────────────────
  const dropRibbon = useCallback(async () => {
    if (!readerUser) { setShowAuthModal(true); return; }
    const cfi = currentCFI.current;
    if (!cfi) return;
    if (!reduced) { setRibbonDropping(true); setTimeout(() => setRibbonDropping(false), 650); }
    try {
      const db = await getDB();
      const { ref, push } = await import('firebase/database');
      await push(ref(db, `readerBookmarks/${readerUser.uid}/${slug}`), {
        cfi, label: chapterLabel || null, createdAt: Date.now(),
      });
    } catch (e) { console.warn('[reader] ribbon save failed', e); }
  }, [readerUser, slug, chapterLabel, reduced]);

  const removeRibbon = useCallback(async (r) => {
    if (!readerUser) return;
    if (!window.confirm('Remove this ribbon?')) return;
    try {
      const db = await getDB();
      const { ref, remove } = await import('firebase/database');
      await remove(ref(db, `readerBookmarks/${readerUser.uid}/${slug}/${r.id}`));
    } catch (e) {}
  }, [readerUser, slug]);

  const jumpTo = useCallback((cfiOrHref) => {
    postToFrame({ type: 'goTo', cfi: cfiOrHref });
    closePanel();
  }, [postToFrame, closePanel]);

  // ── Search (debounced) ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (panel !== 'search') return;
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const q = searchQuery.trim();
    if (!q) { setSearchResults([]); setSearchTruncated(false); setSearching(false); return; }
    setSearching(true);
    searchDebounce.current = setTimeout(() => {
      const id = ++searchIdRef.current;
      postToFrame({ type: 'search', id, query: q });
    }, 320);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchQuery, panel, postToFrame]);

  const pickResult = useCallback((r) => {
    postToFrame({ type: 'goTo', cfi: r.cfi });
    closePanel();
  }, [postToFrame, closePanel]);

  if (!story) return (
    <div style={{ minHeight: '100dvh', background: '#1a0f0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ width: 36, height: 36, border: '2px solid rgba(201,164,76,0.2)', borderTopColor: '#c9a44c', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
    </div>
  );

  const iframeSrc = story.epubUrl ? readingRoomSrc(story.epubUrl, prefsInit.current) : null;
  // R4a.4: one door, one destination. The top-bar control used to return to this story's own
  // detail page (/stories/<slug>); it now routes home to the Library, matching the Story Island
  // app's LIBRARY control. Plain navigation — no history.back(), no referrer sniffing.
  const backHref = '/public-library';
  const paper = PAPERS[prefs.paper] || PAPERS.vellum;

  const botText = (() => {
    const parts = [];
    if (botInfo.cur && botInfo.total) parts.push(`Page ${botInfo.cur} of ${botInfo.total}`);
    parts.push(`${botInfo.pct || 0}%`);
    if (typeof botInfo.minLeft === 'number') parts.push(`${botInfo.minLeft} min left in chapter`);
    return parts.join(' · ');
  })();

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeOpacity{from{opacity:0}to{opacity:1}}
        @keyframes blink{0%,100%{opacity:0.35}50%{opacity:0.9}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes ribbonDrop{0%{transform:translateY(-40px)}60%{transform:translateY(6px)}100%{transform:translateY(0)}}
        @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes toastOut{from{opacity:1}to{opacity:0;transform:translateX(-50%) translateY(-8px)}}

        /* R4a.2 fault A: 100vw is the LAYOUT viewport on iOS and ignores the safe area, so it
           overflowed the visual viewport and shifted the surface. inset-based sizing tracks the
           real box. --rr-lane reserves the ribbon's gutter (fault C) — it is painted with
           --rr-bg, so the surface still reads as full-bleed paper. */
        /* R4a.3: the safe-area insets are named ONCE here and referenced everywhere else. Previously
           each rule inlined env(...) directly, which made the geometry impossible to test (Chromium
           cannot emulate iOS insets) and easy to apply inconsistently. Overriding these four vars
           simulates a notched device in any browser. */
        .rr-root{--rr-accent:#c9a44c;--rr-lane:30px;
          --rr-sat:env(safe-area-inset-top);--rr-sab:env(safe-area-inset-bottom);
          --rr-sal:env(safe-area-inset-left);--rr-sar:env(safe-area-inset-right);--rr-thread-h:3px;
          position:fixed;top:0;left:0;right:0;height:100dvh;overflow:hidden;background:var(--rr-bg);color:var(--rr-fg)}
        .rr-root[data-theme="vellum"]{--rr-bg:#f2ecd9;--rr-fg:#2b2418;--rr-chrome:rgba(242,236,217,.9);--rr-line:rgba(43,36,24,.14);--rr-soft:rgba(43,36,24,.55)}
        .rr-root[data-theme="ivory"]{--rr-bg:#faf7f0;--rr-fg:#1f1c16;--rr-chrome:rgba(250,247,240,.9);--rr-line:rgba(31,28,22,.13);--rr-soft:rgba(31,28,22,.55)}
        .rr-root[data-theme="dusk"]{--rr-bg:#211d16;--rr-fg:#ddd2b8;--rr-chrome:rgba(33,29,22,.9);--rr-line:rgba(221,210,184,.16);--rr-soft:rgba(221,210,184,.55)}
        .rr-root[data-theme="ink"]{--rr-bg:#0a0a0a;--rr-fg:#d9d2bf;--rr-chrome:rgba(10,10,10,.92);--rr-line:rgba(217,210,191,.14);--rr-soft:rgba(217,210,191,.5)}

        /* R4a.2 fault B: env() resolves to 0 inside a nested browsing context, so the iframe can
           never protect itself from the notch — the PARENT must inset it. These insets apply in
           BOTH chrome states; the strips they expose are --rr-bg (paper), never white.
           The inset lives on a WRAPPER, not the iframe: an absolutely-positioned replaced element
           with width:auto falls back to its intrinsic 300px instead of stretching to left/right.
           R4a.3: the wrapper's box IS the paginator's layout box — foliate sizes its columns from
           the iframe it lives in, so nothing may overlay or inset it further, or page extremities
           land in hidden pixels. The gold thread's 3px is reserved here, not painted over the page. */
        .rr-frame-wrap{position:fixed;background:var(--rr-bg);
          top:var(--rr-sat);left:var(--rr-sal);right:calc(var(--rr-lane) + var(--rr-sar));
          height:calc(100dvh - var(--rr-sat) - var(--rr-sab) - var(--rr-thread-h))}
        .rr-frame{display:block;border:none;width:100%;height:100%;background:var(--rr-bg)}

        .rr-top{position:fixed;top:0;left:0;right:0;z-index:40;display:flex;align-items:center;gap:8px;padding:8px 12px;
          padding-top:max(8px,var(--rr-sat));background:var(--rr-chrome);backdrop-filter:blur(10px);
          border-bottom:1px solid var(--rr-line);transition:transform .35s cubic-bezier(.2,.7,.2,1)}
        .rr-top.hidden{transform:translateY(-110%)}
        .rr-back{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;font-family:'Cinzel',serif;font-size:.6rem;
          letter-spacing:.14em;text-transform:uppercase;color:var(--rr-soft);text-decoration:none;white-space:nowrap}
        .rr-back:hover{color:var(--rr-accent)}
        .rr-titleblock{flex:1;text-align:center;min-width:0}
        .rr-book-title{font-family:'Cinzel',serif;font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--rr-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rr-chapter{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:.72rem;color:var(--rr-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
        .rr-tools{display:flex;align-items:center;gap:2px;flex-shrink:0}
        .rr-tool{min-width:44px;min-height:44px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;
          background:none;border:none;cursor:pointer;font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.1em;
          text-transform:uppercase;color:var(--rr-soft)}
        .rr-tool:hover{color:var(--rr-accent)}

        .rr-bot{position:fixed;bottom:0;left:0;right:0;z-index:40;display:flex;align-items:center;justify-content:center;
          min-height:44px;padding-bottom:max(0px,var(--rr-sab));background:var(--rr-chrome);backdrop-filter:blur(10px);
          border-top:1px solid var(--rr-line);transition:transform .35s cubic-bezier(.2,.7,.2,1)}
        .rr-bot.hidden{transform:translateY(110%)}
        .rr-botinfo{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.16em;text-transform:uppercase;color:var(--rr-soft);white-space:nowrap;pointer-events:none;padding:0 12px}

        /* R4a.2 fault B (bottom): lift the thread clear of the home indicator. */
        .rr-thread{position:fixed;bottom:var(--rr-sab);left:0;right:0;height:var(--rr-thread-h);z-index:50;background:rgba(201,164,76,.1);pointer-events:none}
        .rr-thread-fill{height:100%;background:var(--rr-accent);box-shadow:0 0 8px rgba(201,164,76,.7);transition:width .45s ease}

        /* R4a.2 fault C: was top:0 (under the notch) and right:22px (inside the text measure).
           Now anchored into the reserved --rr-lane gutter and below the safe area. 24px tab in a
           30px lane with a 3px edge gap => it can never reach the text column at any width. */
        .rr-ribbon-tab{position:fixed;top:calc(var(--rr-sat) + 6px);right:max(3px,var(--rr-sar));z-index:38;width:24px;min-height:44px;border:none;cursor:pointer;padding:0;
          background:linear-gradient(180deg,#e8c877,#a8842f);box-shadow:0 3px 8px rgba(0,0,0,.4);
          display:flex;align-items:flex-start;justify-content:center;padding-top:8px;color:#3a2c0a}
        .rr-ribbon-tab::after{content:'';position:absolute;left:0;right:0;bottom:-8px;height:9px;background:linear-gradient(180deg,#c9a44c,#a8842f);clip-path:polygon(0 0,100% 0,100% 100%,50% 55%,0 100%)}
        .rr-ribbon-tab.dropping{animation:ribbonDrop .65s cubic-bezier(.2,.8,.2,1)}
        .rr-ribbon-count{font-family:'Cinzel',serif;font-size:.5rem;font-weight:600}

        .rr-sheet-backdrop{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}
        .rr-sheet{width:100%;max-width:560px;max-height:82dvh;background:var(--rr-bg);color:var(--rr-fg);border:1px solid var(--rr-line);
          border-radius:18px 18px 0 0;padding:10px 20px calc(24px + env(safe-area-inset-bottom));animation:sheetUp .32s cubic-bezier(.2,.7,.2,1);display:flex;flex-direction:column}
        .rr-sheet-tall{height:78dvh}
        .rr-grab{width:38px;height:4px;border-radius:999px;background:var(--rr-soft);opacity:.5;margin:2px auto 14px}
        .rr-sheet-title{font-family:'Cinzel',serif;font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;color:var(--rr-accent);text-align:center;margin-bottom:1.4rem}
        .rr-row-label{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.2em;text-transform:uppercase;color:var(--rr-soft);margin:0 0 .7rem}
        .rr-swatches{display:grid;grid-template-columns:repeat(4,1fr);gap:.6rem;margin-bottom:1.4rem}
        .rr-swatch{background:none;border:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:.4rem;padding:0}
        .rr-swatch-page{width:100%;aspect-ratio:3/4;min-height:44px;border-radius:4px;display:flex;align-items:center;justify-content:center;
          font-family:'Cormorant Garamond',Georgia,serif;font-size:1rem;box-shadow:0 4px 12px rgba(0,0,0,.3);border:2px solid transparent}
        .rr-swatch.active .rr-swatch-page{border-color:var(--rr-accent)}
        .rr-swatch-name{font-family:'Cinzel',serif;font-size:.48rem;letter-spacing:.1em;text-transform:uppercase;color:var(--rr-soft)}
        .rr-faces{display:flex;gap:.6rem;margin-bottom:1.4rem;flex-wrap:wrap}
        .rr-face{flex:1;min-height:44px;min-width:90px;border:1px solid var(--rr-line);border-radius:8px;background:none;color:var(--rr-fg);cursor:pointer;font-size:1rem;padding:.4rem}
        .rr-face.active{border-color:var(--rr-accent);color:var(--rr-accent)}
        .rr-stepper-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem;gap:1rem}
        .rr-stepper,.rr-toggle{display:flex;align-items:center;gap:2px;border:1px solid var(--rr-line);border-radius:10px;overflow:hidden}
        .rr-step{min-width:44px;min-height:44px;background:none;border:none;color:var(--rr-fg);font-size:1.2rem;cursor:pointer}
        .rr-step:disabled{opacity:.3;cursor:not-allowed}
        .rr-step-val{min-width:56px;text-align:center;font-family:'Cinzel',serif;font-size:.66rem;letter-spacing:.06em;color:var(--rr-fg)}
        .rr-toggle-opt{min-height:44px;padding:0 1.1rem;background:none;border:none;cursor:pointer;font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.14em;text-transform:uppercase;color:var(--rr-soft)}
        .rr-toggle-opt.active{background:var(--rr-accent);color:var(--rr-bg)}

        .rr-scroll{overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch}
        .rr-toc-item{display:block;width:100%;text-align:start;min-height:44px;background:none;border:none;border-bottom:1px solid var(--rr-line);
          cursor:pointer;color:var(--rr-fg);font-family:'Cormorant Garamond',Georgia,serif;font-size:1rem;padding:.6rem 1rem}
        .rr-toc-item.current{color:var(--rr-accent)}
        .rr-toc-item:disabled{opacity:.5;cursor:default}
        .rr-section-label{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.2em;text-transform:uppercase;color:var(--rr-accent);margin:1.4rem 0 .5rem}
        .rr-ribbon-row{display:flex;align-items:center;gap:.5rem;border-bottom:1px solid var(--rr-line)}
        .rr-ribbon-jump{flex:1;display:flex;align-items:center;gap:.7rem;min-height:44px;background:none;border:none;cursor:pointer;text-align:start;color:var(--rr-fg);padding:.5rem 0}
        .rr-ribbon-dot{width:8px;height:16px;background:var(--rr-accent);border-radius:1px;flex-shrink:0}
        .rr-ribbon-label{display:block;font-family:'Cormorant Garamond',Georgia,serif;font-size:.95rem}
        .rr-ribbon-time{display:block;font-size:.7rem;color:var(--rr-soft)}
        .rr-ribbon-x{min-width:44px;min-height:44px;background:none;border:none;color:var(--rr-soft);font-size:1.2rem;cursor:pointer}
        .rr-empty{padding:2rem 1rem;text-align:center;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;color:var(--rr-soft)}

        .rr-search-head{display:flex;align-items:center;gap:.5rem;margin-bottom:1rem}
        .rr-search-input{flex:1;min-height:44px;background:none;border:1px solid var(--rr-line);border-radius:10px;padding:0 1rem;color:var(--rr-fg);font-family:'Cormorant Garamond',Georgia,serif;font-size:1rem;outline:none}
        .rr-search-close{min-width:44px;min-height:44px;background:none;border:none;color:var(--rr-soft);font-size:1.4rem;cursor:pointer}
        .rr-result{display:block;width:100%;text-align:start;background:none;border:none;border-bottom:1px solid var(--rr-line);cursor:pointer;padding:.75rem 1rem}
        .rr-result-chapter{display:block;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.16em;text-transform:uppercase;color:var(--rr-soft);margin-bottom:.3rem}
        .rr-result-excerpt{display:block;font-family:'Cormorant Garamond',Georgia,serif;font-size:.92rem;line-height:1.5;color:var(--rr-fg)}
        .rr-result-excerpt mark{background:none;color:var(--rr-accent);font-weight:600}

        .rr-cover{position:fixed;inset:0;background:linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px;text-align:center;z-index:80;cursor:pointer;animation:fadeUp .7s ease forwards}
        .rr-cover::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 65% at 50% 38%,rgba(107,47,173,.28) 0%,transparent 68%)}
        /* R4a.4 — bound-book treatment for the splash cover. This deliberately does NOT reuse
           BoundBook: that component is fixed-geometry (height = width * 1.5) and crops with
           object-fit:cover, whereas story covers come from the CMS at arbitrary ratios and the
           splash sizes them with contain + max-height:60dvh. Matching it would mean adding an
           aspect/fit prop to BoundBook's API. So this is a local, binding-only treatment that
           borrows BoundBook's visual language — the spine gradient stops and the fore-edge stripe
           below are copied verbatim from BOUND_BOOK_CSS so the two read as the same object.
           No gesture, no flip, no obi, no ribbon. The wrapper shrink-wraps the image, so the
           binding tracks whatever size the cover actually resolves to. */
        .rr-cbind{position:relative;display:inline-block;z-index:1;margin-bottom:14px;
          transform:rotate(-1.4deg);transform-origin:50% 60%}
        .rr-cimg{display:block;width:auto;height:auto;max-width:min(320px,75vw);max-height:60dvh;object-fit:contain;
          border-radius:2px 5px 5px 2px;box-shadow:0 12px 48px rgba(0,0,0,.75),0 0 0 1px rgba(201,164,76,.2)}
        /* spine hinge, left edge */
        .rr-cbind::before{content:'';position:absolute;top:0;bottom:0;left:0;width:11px;z-index:2;pointer-events:none;
          border-radius:2px 0 0 2px;
          background:linear-gradient(90deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.2) 34%,rgba(255,255,255,.09) 50%,rgba(0,0,0,.22) 66%,rgba(0,0,0,.34) 100%)}
        /* fore-edge page block, right edge */
        .rr-cbind::after{content:'';position:absolute;top:2.5%;bottom:2.5%;right:-9px;width:10px;pointer-events:none;
          border-radius:0 2px 2px 0;
          background:repeating-linear-gradient(90deg,#e6dfc8 0,#e6dfc8 1px,#d3caae 1px,#d3caae 2px);
          box-shadow:1px 2px 6px rgba(0,0,0,.5)}
        .rr-corn{font-size:.55rem;letter-spacing:.4em;color:rgba(201,164,76,.3);margin-bottom:10px;position:relative;z-index:1}
        .rr-ctitle{font-family:Cormorant Garamond,Georgia,serif;font-size:clamp(1rem,2.5vw,1.5rem);font-weight:300;color:#f5efe0;line-height:1.2;margin-bottom:6px;position:relative;z-index:1;font-style:italic}
        .rr-cauthor{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.24em;color:rgba(201,164,76,.65);text-transform:uppercase;position:relative;z-index:1}
        .rr-cabout{position:relative;z-index:1;margin-top:16px;width:100%;max-width:440px;display:flex;justify-content:center}
        .rr-ccta{position:absolute;bottom:calc(22px + env(safe-area-inset-bottom));font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.2em;color:rgba(201,164,76,.4);text-transform:uppercase;animation:blink 2.2s ease-in-out infinite}

        .rr-end-wrap{position:fixed;inset:0;overflow-y:auto;background:#0a0a0a;animation:fadeOpacity .5s ease forwards;z-index:70}
        .rr-end{display:flex;flex-direction:column;align-items:center;padding:calc(48px + env(safe-area-inset-top)) 24px 32px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06)}
        .rr-eorn{font-size:.9rem;color:#c9a44c;letter-spacing:.5em;margin-bottom:18px}
        .rr-erule{width:60px;height:1px;background:rgba(201,164,76,.3);margin:0 auto 18px}
        .rr-etitle{font-family:Cormorant Garamond,Georgia,serif;font-size:1.35rem;font-style:italic;color:#f5efe0;margin-bottom:6px}
        .rr-eauth{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.2em;color:rgba(201,164,76,.55);text-transform:uppercase;margin-bottom:24px}
        .rr-ebtn{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.16em;text-transform:uppercase;padding:10px 26px;background:none;border:1px solid rgba(107,47,173,.35);color:#c9a84c;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block;transition:all .2s;margin:4px}
        .rr-ebtn:hover{background:rgba(107,47,173,.12);border-color:#c9a84c}

        .rr-resume-toast{position:fixed;bottom:calc(52px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);background:#6b2fad;border:1px solid rgba(201,164,76,0.3);border-radius:999px;padding:9px 20px;font-family:Cormorant Garamond,Georgia,serif;font-size:.82rem;font-style:italic;color:#f0ead8;white-space:nowrap;z-index:55;pointer-events:none}
        .rr-resume-toast.in{animation:toastIn .4s ease forwards}
        .rr-resume-toast.out{animation:toastOut .4s ease forwards}

        .rr-noepub{position:fixed;inset:0;background:#f6f0e2;display:flex;align-items:center;justify-content:center;font-family:Cormorant Garamond,Georgia,serif;font-style:italic;color:#888;font-size:1rem}

        @media (prefers-reduced-motion: reduce){
          .rr-top,.rr-bot,.rr-thread-fill,.rr-sheet,.rr-cover,.rr-end-wrap{transition:none !important;animation:none !important}
          .rr-ribbon-tab.dropping{animation:none}
          /* BOUND_BOOK_CSS drops the resting angle under reduced motion; match it. */
          .rr-cbind{transform:none}
        }

        /* Comments / end-card styles (PRESERVED from the previous reader) */
        .cs-section{background:#0a0a0a;max-width:680px;margin:0 auto;padding:2.5rem 1.5rem 6rem}
        .cs-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;padding-bottom:1rem;border-bottom:1px solid rgba(255,255,255,0.07)}
        .cs-title{font-family:'Cormorant Garamond',Georgia,serif;font-size:1.3rem;font-weight:300;color:#f5f0e8;letter-spacing:.02em}
        .cs-count{font-size:.75rem;font-weight:500;color:rgba(255,255,255,.25);letter-spacing:.12em;text-transform:uppercase;font-family:Cormorant Garamond,Georgia,serif}
        .cs-compose{margin-bottom:2rem}
        .cs-compose-row{display:flex;gap:12px;align-items:flex-start}
        .cs-avatar-compose{width:36px;height:36px;border-radius:50%;background:rgba(107,47,173,0.25);border:1px solid rgba(107,47,173,0.3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#c9a84c;flex-shrink:0;font-family:Cormorant Garamond,Georgia,serif;overflow:hidden;text-decoration:none}
        .cs-input-wrap{flex:1;position:relative}
        .cs-textarea{width:100%;background:rgba(107,47,173,0.05);border:1px solid rgba(107,47,173,0.2);border-radius:12px;padding:.85rem 3rem .85rem 1rem;font-size:.9rem;color:#e8e0d4;font-family:'Cormorant Garamond',Georgia,serif;resize:none;outline:none;box-sizing:border-box;line-height:1.6}
        .cs-textarea-sm{min-height:56px;font-size:.85rem;border-radius:10px}
        .cs-textarea::placeholder{color:rgba(245,240,232,.32);font-style:italic}
        .cs-textarea:focus{border-color:rgba(201,168,76,.5);box-shadow:0 0 0 2px rgba(201,168,76,.12)}
        .cs-kite-btn{position:absolute;bottom:8px;right:8px;background:none;border:none;cursor:pointer;padding:4px;opacity:.2;transition:opacity .2s}
        .cs-kite-btn.active{opacity:1}
        .cs-kite-btn:disabled{cursor:not-allowed}
        .cs-signin-prompt{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:1.5rem;text-align:center;margin-bottom:2rem}
        .cs-signin-prompt p{font-size:.9rem;font-weight:500;color:rgba(255,255,255,.3);margin-bottom:.75rem;font-family:Cormorant Garamond,Georgia,serif}
        .cs-signin-btn{background:none;border:1px solid rgba(107,47,173,.4);border-radius:8px;padding:.55rem 1.4rem;font-size:.75rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#c9a84c;cursor:pointer;font-family:Cormorant Garamond,Georgia,serif}
        .cs-loading{font-size:.88rem;font-weight:500;color:rgba(255,255,255,.2);font-family:Cormorant Garamond,Georgia,serif;padding:1rem 0}
        .cs-empty{font-size:.88rem;color:rgba(255,255,255,.2);font-family:Cormorant Garamond,Georgia,serif;font-style:italic;padding:1rem 0}
        .cs-comments-list{display:flex;flex-direction:column}
        .cs-divider{height:1px;background:rgba(245,240,232,0.06);margin:1.1rem 0}
        .cs-comment{display:flex;gap:10px;align-items:flex-start}
        .cs-comment>a:first-child,.cs-reply>a:first-child{margin-top:2px}
        .cs-comment-body{flex:1;min-width:0}
        .cs-comment-header{display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap}
        .cs-name{font-size:.92rem;font-weight:600;color:#f5f0e8;font-family:Cormorant Garamond,Georgia,serif}
        .cs-name-link{text-decoration:none;transition:color .2s}
        .cs-name-link:hover{color:#c9a84c}
        .cs-time{font-size:.74rem;font-weight:500;color:rgba(245,240,232,.42);font-family:Cormorant Garamond,Georgia,serif}
        .cs-comment-text{font-family:'Cormorant Garamond',Georgia,serif;font-size:.98rem;color:#f5f0e8;line-height:1.68;margin-top:0}
        .cs-comment-text-sm{font-size:.92rem}
        .cs-comment-footer{margin-top:.5rem}
        .cs-reply-btn{background:none;border:none;font-size:.74rem;font-weight:500;color:rgba(245,240,232,.42);cursor:pointer;font-family:Cormorant Garamond,Georgia,serif;letter-spacing:.08em;padding:0;transition:color .2s}
        .cs-reply-btn:hover{color:#c9a84c}
        .cs-reply-compose{margin-top:.75rem}
        .cs-replies{margin-top:.75rem;padding-left:1rem;border-left:1px solid rgba(107,47,173,.25);display:flex;flex-direction:column;gap:.75rem}
        .cs-reply{display:flex;gap:10px}
        .cs-save-btn,.cs-cancel-btn{font-family:Cormorant Garamond,Georgia,serif;font-size:.78rem;font-weight:600;padding:.35rem .9rem;border-radius:6px;cursor:pointer}
        .cs-save-btn{background:#6b2fad;color:#fff;border:none}
        .cs-cancel-btn{background:none;color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.15)}
        @media(max-width:600px){.cs-section{padding:2rem 1rem 5rem}.cs-textarea,.cs-textarea-sm{font-size:16px !important}}
      `}</style>

      <div className="rr-root" data-theme={prefs.paper}>
        {/* Reading surface + chrome (only while actually reading) */}
        {!showCover && !showEnd && readerReady && (iframeSrc
          ? <div className="rr-frame-wrap"><iframe ref={iframeRef} className="rr-frame" src={iframeSrc} title={story.title} sandbox="allow-scripts allow-same-origin" /></div>
          : <div className="rr-noepub">No EPUB file available for this book.</div>
        )}

        {!showCover && !showEnd && (
          <>
            <header className={'rr-top' + (chromeVisible ? '' : ' hidden')}>
              <a href={backHref} className="rr-back">&larr; Library</a>
              <div className="rr-titleblock">
                <div className="rr-book-title">{story.title}</div>
                {chapterLabel && <div className="rr-chapter">{chapterLabel}</div>}
              </div>
              <div className="rr-tools">
                <button className="rr-tool" onClick={() => openPanel('toc')}>Contents</button>
                <button className="rr-tool" onClick={() => openPanel('search')}>Search</button>
                <button className="rr-tool" onClick={() => openPanel('type')} aria-label="Typesetter">Aa</button>
              </div>
            </header>

            <button className={'rr-ribbon-tab' + (ribbonDropping ? ' dropping' : '')} onClick={dropRibbon} aria-label="Drop a ribbon" style={{ height: 48 }}>
              {ribbons.length > 0 && <span className="rr-ribbon-count">{ribbons.length}</span>}
            </button>

            <footer className={'rr-bot' + (chromeVisible ? '' : ' hidden')}>
              <div className="rr-botinfo">{botText}</div>
            </footer>

            <div className="rr-thread"><div className="rr-thread-fill" style={{ width: (fraction * 100) + '%' }} /></div>

            {panel === 'type' && (
              <TypesetterPanel prefs={prefs} onPaper={onPaper} onFace={onFace} onSize={onSize} onLeading={onLeading} onFlow={onFlow} onClose={closePanel} />
            )}
            {panel === 'toc' && (
              <ContentsPanel toc={toc} chapterHref={chapterHref} ribbons={ribbons} onJump={jumpTo} onRemoveRibbon={removeRibbon} onClose={closePanel} />
            )}
            {panel === 'search' && (
              <SearchPanel query={searchQuery} setQuery={setSearchQuery} results={searchResults} truncated={searchTruncated} searching={searching} onPick={pickResult} onClose={closePanel} />
            )}

            {resumeToast && (
              <div className={'rr-resume-toast ' + (toastFading ? 'out' : 'in')}>Continue where you left off 🏝️</div>
            )}
          </>
        )}

        {/* Cover splash */}
        {showCover && (
          <div className="rr-cover" onClick={() => setShowCover(false)}>
            <div className="rr-corn">✦ ✦ ✦</div>
            <div className="rr-cbind"><img src={story.cover} alt={story.title} className="rr-cimg" /></div>
            <div className="rr-ctitle">{story.title}</div>
            <div className="rr-cauthor">by {story.author}</div>
            <div className="rr-cabout" onClick={e => e.stopPropagation()}>
              <AboutTheAuthor story={story} variant="condensed" />
            </div>
            <div className="rr-ccta">Open to begin reading</div>
          </div>
        )}

        {/* End card */}
        {!showCover && showEnd && (
          <div className="rr-end-wrap">
            <div className="rr-end">
              <div className="rr-eorn">✦</div>
              <div className="rr-erule" />
              <div className="rr-etitle">{story.title}</div>
              <div className="rr-eauth">by {story.author}</div>
              <div style={{ margin: '4px 0 24px' }}>
                <ReadSeal count={hitCount} active ink="#f5efe0" />
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="rr-ebtn" onClick={() => setShowEnd(false)}>← Back to book</button>
                <a href={'/' + (story.category || '')} className="rr-ebtn">More stories</a>
              </div>
            </div>
            <div style={{ maxWidth: 680, margin: '2rem auto 0', padding: '0 1.5rem' }}>
              <QuizCard slug={slug} user={readerUser} mode="reader" readPercent={progress} onSignIn={() => setShowAuthModal(true)} />
            </div>
            <CommentsSection slug={slug} onSignIn={() => setShowAuthModal(true)} />
          </div>
        )}

        {/* Discuss shortcut near the end */}
        {!showCover && !showEnd && progress > 90 && (
          <button
            onClick={() => setShowEnd(true)}
            style={{ position: 'fixed', bottom: 'calc(52px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', background: '#6b2fad', border: 'none', borderRadius: '999px', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '8px', fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.18em', textTransform: 'uppercase', color: '#f5f0e8', cursor: 'pointer', zIndex: 45, boxShadow: '0 4px 24px rgba(107,47,173,0.5)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#f5f0e8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Discuss
          </button>
        )}

        {showAuthModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) setShowAuthModal(false); }}>
            <AuthModal onClose={() => setShowAuthModal(false)} />
          </div>
        )}
      </div>
    </>
  );
}
