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
import ReadingRoom from './ReadingRoom';
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
// THE STORY REGISTER (R7.1) — an adapter, not a reader.
//
// The reading surface moved wholesale to ./ReadingRoom.js. What stays here is the part
// that is TRUE OF STORIES AND NOTHING ELSE: the cms_stories resolution, the read counter,
// streaks and badges, readStories/readCount, the quiz, the comment thread and the story's
// own cover splash and end card.
//
// Behaviour is preserved exactly — every effect below is the one that was here before,
// with its original PRESERVED marker intact. The Reading Room now owns chrome, panels,
// typesetting, ribbons, readerProgress and the postMessage bridge, and hands this file
// what it needs through onRelocate.
// ─────────────────────────────────────────────────────────────────────────────

export default function StoryReaderClient({ params }) {
  const { slug } = use(params);
  const [story, setStory] = useState(stories.find(s => s.id === slug) || null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [hitCount, setHitCount] = useState(null);
  const [readerUser, setReaderUser] = useState(null);
  const [progress, setProgress] = useState(0);

  const hitFired = useRef(false);

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

  // cms_stories fallback load (PRESERVED). NOTE: app/lib/stories.js exports an empty array
  // since the 2026-05-18 CMS migration, so this is the ONLY path that resolves a story.
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

  // The engagement gate the read counter has always used: the first relocate means the
  // book has actually painted. fireReadHit is self-latching, so calling it on every
  // relocate is the behaviour that shipped.
  const onRelocate = useCallback((info) => {
    fireReadHit();
    setProgress((info.fraction || 0) * 100);
  }, [fireReadHit]);

  if (!story) return (
    <div style={{ minHeight: '100dvh', background: '#1a0f0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ width: 36, height: 36, border: '2px solid rgba(201,164,76,0.2)', borderTopColor: '#c9a44c', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
    </div>
  );

  // R4a.4: one door, one destination. The top-bar control routes home to the Library,
  // matching the Story Island app's LIBRARY control. Plain navigation — no history.back(),
  // no referrer sniffing.
  const coverSplash = (
    <>
      <div className="rr-corn">✦ ✦ ✦</div>
      <div className="rr-cbind"><img src={story.cover} alt={story.title} className="rr-cimg" /></div>
      <div className="rr-ctitle">{story.title}</div>
      <div className="rr-cauthor">by {story.author}</div>
      <div className="rr-cabout" onClick={e => e.stopPropagation()}>
        <AboutTheAuthor story={story} variant="condensed" />
      </div>
      <div className="rr-ccta">Open to begin reading</div>
    </>
  );

  const renderEnding = ({ close }) => (
    <>
      <div className="rr-end">
        <div className="rr-eorn">✦</div>
        <div className="rr-erule" />
        <div className="rr-etitle">{story.title}</div>
        <div className="rr-eauth">by {story.author}</div>
        <div style={{ margin: '4px 0 24px' }}>
          <ReadSeal count={hitCount} active ink="#f5efe0" />
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="rr-ebtn" onClick={close}>← Back to book</button>
          <a href={'/' + (story.category || '')} className="rr-ebtn">More stories</a>
        </div>
      </div>
      <div style={{ maxWidth: 680, margin: '2rem auto 0', padding: '0 1.5rem' }}>
        <QuizCard slug={slug} user={readerUser} mode="reader" readPercent={progress} onSignIn={() => setShowAuthModal(true)} />
      </div>
      <CommentsSection slug={slug} onSignIn={() => setShowAuthModal(true)} />
    </>
  );

  return (
    <>
      <style>{`
        /* Comments / end-card styles (PRESERVED from the previous reader). The rr-* room
           styles live in ./ReadingRoom.js — these are the story register's own. */
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

      <ReadingRoom
        register="story"
        epubSource={story.epubUrl || null}
        meta={{ slug, title: story.title, author: story.author }}
        escape={{ href: '/public-library', label: '← Library' }}
        user={readerUser}
        ribbons
        progress
        coverSplash={coverSplash}
        earlyEnding={<>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#f5f0e8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Discuss
        </>}
        renderEnding={renderEnding}
        onRelocate={onRelocate}
        onRequireAuth={() => setShowAuthModal(true)}
      />

      {showAuthModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) setShowAuthModal(false); }}>
          <AuthModal onClose={() => setShowAuthModal(false)} />
        </div>
      )}
    </>
  );
}
