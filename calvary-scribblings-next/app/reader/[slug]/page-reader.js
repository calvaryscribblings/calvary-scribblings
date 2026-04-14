'use client';
import { useEffect, useState, useRef } from 'react';
import { stories } from '../../lib/stories';
import TipBox from '../../components/TipBox';
import { use } from 'react';

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
const BADGE_SVG_PATH = "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C1.87 9.33 1 10.57 1 12s.87 2.67 2.19 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91C21.37 14.67 22.25 13.43 22.25 12z";
const CHECK_PATH = "M9.13 17.75L5.5 14.12l1.41-1.41 2.22 2.22 6.34-7.59 1.53 1.28z";
const HEART_PATH = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

function getBadge(readCount, uid) {
  if (uid === FOUNDER_UID) return { tier: 'founder', label: 'Founder', color: '#c8daea' };
  if (readCount >= 1000) return { tier: 'immortal', label: 'Immortal of the Island', color: '#9b6dff' };
  if (readCount >= 150) return { tier: 'legend', label: 'Legend of the Island', color: '#d4537e' };
  if (readCount >= 90) return { tier: 'islander', label: 'Story Islander', color: '#d4941a' };
  if (readCount >= 60) return { tier: 'island', label: 'Island Reader', color: '#1d9e75' };
  if (readCount >= 25) return { tier: 'reader', label: 'Reader', color: '#b4b2a9' };
  return null;
}

function BadgeIcon({ color, size = 14, isFounder = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <defs><linearGradient id="pg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#e8f0f8"/><stop offset="50%" stopColor="#c8daea"/><stop offset="100%" stopColor="#a8c0d6"/></linearGradient></defs>
      <path fill={isFounder ? 'url(#pg2)' : color} d={BADGE_SVG_PATH} />
      <path fill={color === '#b4b2a9' ? '#0a0a0a' : '#fff'} d={CHECK_PATH} />
    </svg>
  );
}

function WriterBadge({ size = 13 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <path fill="#581c87" d={BADGE_SVG_PATH} />
        <path fill="#e9d5ff" d={CHECK_PATH} />
      </svg>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(212,83,126,0.12)', border: '1px solid rgba(212,83,126,0.35)', borderRadius: 6, padding: '1px 7px 1px 5px' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path fill="#d4537e" d={HEART_PATH} /></svg>
        <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#d4537e', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>Writer</span>
      </span>
    </span>
  );
}

function CommentBadge({ uid, size = 13 }) {
  const [badge, setBadge] = useState(null);
  const [isAuthor, setIsAuthor] = useState(false);
  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `users/${uid}`));
        if (snap.exists()) {
          const data = snap.val();
          setIsAuthor(data.isAuthor || false);
          setBadge(getBadge(data.readCount || 0, uid));
        }
      } catch (e) {}
    })();
  }, [uid]);
  if (isAuthor) return <WriterBadge size={size} />;
  if (!badge) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <BadgeIcon color={badge.color} size={size} isFounder={badge.tier === 'founder'} />
      <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: badge.tier === 'founder' ? '#c8daea' : badge.color, fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>{badge.label}</span>
    </span>
  );
}

function CommentAvatar({ uid, initials, size = 'sm', isOwnComment }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const dim = size === 'xs' ? 26 : size === 'sm' ? 34 : 36;
  const fontSize = size === 'xs' ? 9 : size === 'sm' ? 11 : 12;
  const href = isOwnComment ? '/profile' : `/user?id=${uid}`;
  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `users/${uid}/avatarUrl`));
        if (snap.exists()) setPhotoUrl(snap.val());
      } catch (e) {}
    })();
  }, [uid]);
  return (
    <a href={href} style={{ width: dim, height: dim, borderRadius: '50%', background: 'rgba(107,47,173,0.25)', border: '1px solid rgba(107,47,173,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize, fontWeight: 500, color: '#9b6dff', flexShrink: 0, fontFamily: 'Inter, sans-serif', overflow: 'hidden', textDecoration: 'none' }}>
      {photoUrl ? <img src={photoUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </a>
  );
}

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
  return <span style={{ fontSize: '0.62rem', color: 'rgba(167,139,250,0.5)', fontFamily: 'Inter, sans-serif' }}>@{username}</span>;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function CommentsSection({ slug, onSignIn }) {
  const [user, setUser] = useState(null);
  const [userAvatarUrl, setUserAvatarUrl] = useState(null);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);

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
    let unsubDB;
    (async () => {
      setLoading(true);
      try {
        const db = await getDB();
        const { ref, onValue } = await import('firebase/database');
        unsubDB = onValue(ref(db, `comments/${slug}`), (snap) => {
          if (snap.exists()) {
            const list = Object.entries(snap.val()).map(([id, c]) => ({ id, ...c })).sort((a, b) => b.createdAt - a.createdAt);
            setComments(list);
          } else { setComments([]); }
          setLoading(false);
        });
      } catch (e) { setLoading(false); }
    })();
    return () => { if (unsubDB) unsubDB(); };
  }, [slug]);

  const postComment = async (commentText, parentId = null) => {
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
      if (parentId) {
        const parentComment = comments.find(c => c.id === parentId);
        if (parentComment && parentComment.authorUid !== user.uid) {
          await push(ref(db, `notifications/${parentComment.authorUid}`), {
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
  };

  const userInitials = user ? (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '';
  const topLevel = comments.filter(c => !c.parentId);
  const getReplies = (id) => comments.filter(c => c.parentId === id).sort((a, b) => a.createdAt - b.createdAt);

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
              <textarea className="cs-textarea" placeholder="Share your thoughts on this story..." value={text} onChange={e => setText(e.target.value)} rows={3} />
              <button className={`cs-kite-btn${text.trim() ? ' active' : ''}`} onClick={() => postComment(text)} disabled={posting || !text.trim()} title="Post comment">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 3L3 10.5l7.5 3L18 6l-7.5 7.5 3 7.5L21 3z" fill="#9b6dff"/></svg>
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
          {topLevel.map((comment, i) => {
            const replies = getReplies(comment.id);
            const isOwn = user?.uid === comment.authorUid;
            return (
              <div key={comment.id}>
                {i > 0 && <div className="cs-divider" />}
                <div className="cs-comment">
                  <CommentAvatar uid={comment.authorUid} initials={comment.authorInitials} size="sm" isOwnComment={isOwn} />
                  <div className="cs-comment-body">
                    <div className="cs-comment-header">
                      <a href={isOwn ? '/profile' : `/user?id=${comment.authorUid}`} className="cs-name cs-name-link">{comment.authorName}</a>
                      <CommentUsername uid={comment.authorUid} />
                      <CommentBadge uid={comment.authorUid} size={13} />
                      <span className="cs-time">{timeAgo(comment.createdAt)}</span>
                    </div>
                    <div className="cs-comment-text">{comment.text}</div>
                    <div className="cs-comment-footer">
                      {user && <button className="cs-reply-btn" onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}>{replyTo === comment.id ? 'Cancel' : 'Reply'}</button>}
                    </div>
                    {replyTo === comment.id && (
                      <div className="cs-reply-compose">
                        <div className="cs-input-wrap">
                          <textarea className="cs-textarea cs-textarea-sm" placeholder={`Reply to ${comment.authorName}...`} value={replyText} onChange={e => setReplyText(e.target.value)} rows={2} autoFocus />
                          <button className={`cs-kite-btn${replyText.trim() ? ' active' : ''}`} onClick={() => postComment(replyText, comment.id)} disabled={posting || !replyText.trim()}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 3L3 10.5l7.5 3L18 6l-7.5 7.5 3 7.5L21 3z" fill="#9b6dff"/></svg>
                          </button>
                        </div>
                      </div>
                    )}
                    {replies.length > 0 && (
                      <div className="cs-replies">
                        {replies.map(reply => {
                          const replyIsOwn = user?.uid === reply.authorUid;
                          return (
                            <div key={reply.id} className="cs-reply">
                              <CommentAvatar uid={reply.authorUid} initials={reply.authorInitials} size="xs" isOwnComment={replyIsOwn} />
                              <div className="cs-comment-body">
                                <div className="cs-comment-header">
                                  <a href={replyIsOwn ? '/profile' : `/user?id=${reply.authorUid}`} className="cs-name cs-name-link">{reply.authorName}</a>
                                  <CommentUsername uid={reply.authorUid} />
                                  <CommentBadge uid={reply.authorUid} size={12} />
                                  <span className="cs-time">{timeAgo(reply.createdAt)}</span>
                                </div>
                                <div className="cs-comment-text cs-comment-text-sm">{reply.text}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  const [fontIndex, setFontIndex] = useState(1);
  const [pageInfo, setPageInfo] = useState('');
  const [bookmark, setBookmark] = useState(null);
  const bookmarkCFI = useRef(null);
  const currentFraction = useRef(0);
  const [bookmarkLoaded, setBookmarkLoaded] = useState(false);
  const [showBookmarkToast, setShowBookmarkToast] = useState(false);
  const [toastFading, setToastFading] = useState(false);
  const [bookmarkSaved, setBookmarkSaved] = useState(false);
  const [debugMsg, setDebugMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const iframeRef = useRef(null);
  const pendingFont = useRef(1);

  useEffect(() => {
    if (story) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'cms_stories/' + slug));
        if (snap.exists()) setStory({ id: slug, ...snap.val() });
      } catch (e) {}
    })();
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const bookmarkTimeout = setTimeout(() => setBookmarkLoaded(true), 3000);
    (async () => {
      try {
        const auth = await getFirebaseAuth();
        const { onAuthStateChanged } = await import('firebase/auth');
        const unsub = onAuthStateChanged(auth, async (user) => {
          clearTimeout(bookmarkTimeout);
          if (!user) { setBookmarkLoaded(true); return; } unsub();
          try {
            const db = await getDB();
            const { ref, get } = await import('firebase/database');
            const snap = await get(ref(db, 'bookmarks/' + user.uid + '/' + slug));
            if (snap.exists()) { const bm = snap.val(); const fraction = typeof bm === 'object' ? bm.fraction : bm; const cfi = typeof bm === 'object' ? bm.cfi : ''; bookmarkCFI.current = cfi; setBookmark(fraction); setDebugMsg('Loaded bm type:' + typeof bm + ' fraction:' + fraction + ' cfi:' + (cfi ? cfi.slice(0,20) : 'NONE')); setShowBookmarkToast(true); setTimeout(() => setToastFading(true), 3500); setTimeout(() => setShowBookmarkToast(false), 4000); }
          } catch (e) {}
          setBookmarkLoaded(true);
        });
      } catch (e) { setBookmarkLoaded(true); }
    })();
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    fetch('/api/hit?slug=' + slug, { method: 'POST' })
      .then(r => r.json()).then(d => { if (typeof d.count === 'number') setHitCount(d.count); }).catch(() => {});
    (async () => {
      try {
        const auth = await getFirebaseAuth();
        const { onAuthStateChanged } = await import('firebase/auth');
        const u = onAuthStateChanged(auth, async (user) => {
          if (!user) return; u();
          const db = await getDB();
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

  useEffect(() => {
    const handler = async e => {
      if (e.data.type === 'debugDetail') { setDebugMsg('keys:' + e.data.keys + ' cfi:' + e.data.cfi); }
      if (e.data.type === 'ended') setShowEnd(true);
      if (e.data.type === 'relocate') {
        const fr = e.data.fraction;
        currentFraction.current = fr;
        if (e.data.cfi) bookmarkCFI.current = e.data.cfi;

        setProgress(fr * 100);
        if (fr > 0 && e.data.step > 0) {
          const total = Math.max(1, Math.round(1 / e.data.step));
          const current = Math.min(total, Math.max(1, Math.round(fr / e.data.step)));
          setPageInfo('Page ' + current + ' of ' + total);
        } else if (fr > 0) {
          setPageInfo('');
        }
      }
      if (e.data.type === 'bookmarkSaved') {
        const fr = currentFraction.current || e.data.fraction;
        setDebugMsg('Saved CFI: ' + (bookmarkCFI.current ? bookmarkCFI.current.slice(0,30) : 'NONE') + ' fr:' + (currentFraction.current||0).toFixed(3));
        setBookmarkSaved(true);
        setTimeout(() => setBookmarkSaved(false), 2000);
        try {
          const auth = await getFirebaseAuth();
          const { onAuthStateChanged } = await import('firebase/auth');
          const unsub = onAuthStateChanged(auth, async (user) => {
            if (!user) return; unsub();
            const db = await getDB();
            const { ref, set } = await import('firebase/database');
            await set(ref(db, 'bookmarks/' + user.uid + '/' + slug), fr);
          });
        } catch (e) {}
      }
      if (e.data.type === 'ready') {
        iframeRef.current?.contentWindow?.postMessage({ type: 'setFontSize', index: pendingFont.current }, '*');
        if (bookmark) {
          setTimeout(() => {
            setDebugMsg('Restoring to: ' + bookmark);
            setDebugMsg('Restoring CFI: ' + (bookmarkCFI.current ? bookmarkCFI.current.slice(0,30) : 'NONE'));
            iframeRef.current?.contentWindow?.postMessage({ type: 'restoreBookmark', fraction: bookmark, cfi: bookmarkCFI.current || '' }, '*');
          }, 1500);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const cycleFont = () => {
    const next = (fontIndex + 1) % FONT_SIZES.length;
    setFontIndex(next);
    pendingFont.current = next;
    iframeRef.current?.contentWindow?.postMessage({ type: 'setFontSize', index: next }, '*');
  };

  if (!story) return (
    <div style={{ minHeight: '100vh', background: '#1a0f0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <div style={{ width: 36, height: 36, border: '2px solid rgba(201,164,76,0.2)', borderTopColor: '#c9a44c', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
    </div>
  );

  const iframeSrc = story.epubUrl
    ? '/vendor/foliate-js-main/calvary-reader.html?url=' + encodeURIComponent(story.epubUrl) + '&fs=' + FONT_SIZES[fontIndex]
    : null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;background:#1a0f0a}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:0.35}50%{opacity:0.9}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .rtop{position:fixed;top:0;left:0;right:0;z-index:200;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:linear-gradient(to bottom,rgba(26,15,10,.96) 60%,transparent);gap:8px}
        .rlogo{font-family:'Cinzel',serif;font-size:.52rem;letter-spacing:.2em;color:rgba(201,164,76,.45);text-decoration:none;text-transform:uppercase;white-space:nowrap}
        .rlogo:hover{color:rgba(201,164,76,.85)}
        .rtitle{font-family:'Cormorant Garamond',serif;font-size:.72rem;font-style:italic;color:rgba(240,234,216,.28);letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;text-align:center}
        .rtop-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
        .rbtn{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.12em;color:rgba(201,164,76,.5);text-transform:uppercase;background:none;border:1px solid rgba(201,164,76,.25);border-radius:3px;padding:4px 9px;cursor:pointer;transition:all .2s;white-space:nowrap}
        .rbtn:hover{color:rgba(201,164,76,.9);border-color:rgba(201,164,76,.6)}
        .rclose{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.12em;color:rgba(201,164,76,.4);text-decoration:none;text-transform:uppercase;white-space:nowrap}
        .rclose:hover{color:rgba(201,164,76,.85)}
        .bcover{position:fixed;inset:0;background:linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px;text-align:center;z-index:150;cursor:pointer;animation:fadeUp .7s ease forwards}
        .bcover::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 65% at 50% 38%,rgba(107,47,173,.28) 0%,transparent 68%)}
        .bcimg{width:min(280px,62vw);height:min(460px,55vh);object-fit:cover;border-radius:2px 4px 4px 2px;position:relative;z-index:1;box-shadow:0 12px 48px rgba(0,0,0,.75),0 0 0 1px rgba(201,164,76,.2);margin-bottom:14px}
        .bcorn{font-size:.55rem;letter-spacing:.4em;color:rgba(201,164,76,.3);margin-bottom:10px;position:relative;z-index:1}
        .bctitle{font-family:'Cormorant Garamond',serif;font-size:clamp(1rem,2.5vw,1.5rem);font-weight:300;color:#f5efe0;line-height:1.2;margin-bottom:6px;position:relative;z-index:1;font-style:italic}
        .bcauthor{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.24em;color:rgba(201,164,76,.65);text-transform:uppercase;position:relative;z-index:1}
        .bccta{position:absolute;bottom:22px;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.2em;color:rgba(201,164,76,.4);text-transform:uppercase;animation:blink 2.2s ease-in-out infinite}
        .reader-frame{position:fixed;top:48px;left:0;right:0;bottom:32px;border:none;width:100%;height:calc(100dvh - 96px)}
        .rbot{position:fixed;bottom:0;left:0;right:0;height:32px;background:rgba(26,15,10,0.92);display:flex;align-items:center;justify-content:center;z-index:200}
        .rprog{position:absolute;top:0;left:0;right:0;height:2px;background:rgba(201,164,76,0.07)}
        .rprogf{height:100%;background:linear-gradient(90deg,#6b2fad,#c9a44c);transition:width 0.45s ease}
        .rpageinfo{font-family:'Cinzel',serif;font-size:.45rem;letter-spacing:.2em;color:rgba(201,164,76,0.6);text-transform:uppercase;white-space:nowrap;pointer-events:none}
        .no-epub{position:fixed;inset:0;top:48px;background:#f6f0e2;display:flex;align-items:center;justify-content:center;font-family:'Cormorant Garamond',serif;font-style:italic;color:#888;font-size:1rem}
        .bend-wrap{position:fixed;inset:0;top:48px;overflow-y:auto;background:#0a0a0a;animation:fadeUp .5s ease forwards;z-index:10}
        .bend{display:flex;flex-direction:column;align-items:center;padding:48px 24px 32px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06)}
        .beorn{font-size:.9rem;color:#c9a44c;letter-spacing:.5em;margin-bottom:18px}
        .berule{width:60px;height:1px;background:rgba(201,164,76,.3);margin:0 auto 18px}
        .betitle{font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-style:italic;color:#f5efe0;margin-bottom:6px}
        .beauth{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.2em;color:rgba(201,164,76,.55);text-transform:uppercase;margin-bottom:24px}
        .bemeta{font-family:'Cormorant Garamond',serif;font-size:.85rem;font-style:italic;color:rgba(255,255,255,.3);margin-bottom:24px}
        .bebtn{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.16em;text-transform:uppercase;padding:10px 26px;background:none;border:1px solid rgba(107,47,173,.35);color:#9b6dff;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block;transition:all .2s;margin:4px}
        .bebtn:hover{background:rgba(107,47,173,.12);border-color:#9b6dff}
        .cs-section{background:#0a0a0a;max-width:680px;margin:0 auto;padding:2.5rem 1.5rem 6rem}
        .cs-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;padding-bottom:1rem;border-bottom:1px solid rgba(255,255,255,0.07)}
        .cs-title{font-family:'Cormorant Garamond',Georgia,serif;font-size:1.3rem;font-weight:300;color:#f5f0e8;letter-spacing:.02em}
        .cs-count{font-size:.68rem;color:rgba(255,255,255,.25);letter-spacing:.12em;text-transform:uppercase;font-family:'Inter',sans-serif}
        .cs-compose{margin-bottom:2rem}
        .cs-compose-row{display:flex;gap:12px;align-items:flex-start}
        .cs-avatar-compose{width:36px;height:36px;border-radius:50%;background:rgba(107,47,173,0.25);border:1px solid rgba(107,47,173,0.3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:500;color:#9b6dff;flex-shrink:0;font-family:'Inter',sans-serif;overflow:hidden;text-decoration:none}
        .cs-input-wrap{flex:1;position:relative}
        .cs-textarea{width:100%;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:.85rem 3rem .85rem 1rem;font-size:.9rem;color:#e8e0d4;font-family:'Cormorant Garamond',Georgia,serif;resize:none;outline:none;box-sizing:border-box;line-height:1.6}
        .cs-textarea-sm{min-height:56px;font-size:.85rem;border-radius:10px}
        .cs-textarea::placeholder{color:rgba(255,255,255,.18);font-style:italic}
        .cs-textarea:focus{border-color:rgba(107,47,173,.4)}
        .cs-kite-btn{position:absolute;bottom:8px;right:8px;background:none;border:none;cursor:pointer;padding:4px;opacity:.2;transition:opacity .2s}
        .cs-kite-btn.active{opacity:1}
        .cs-kite-btn:disabled{cursor:not-allowed}
        .cs-signin-prompt{background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:1.5rem;text-align:center;margin-bottom:2rem}
        .cs-signin-prompt p{font-size:.82rem;color:rgba(255,255,255,.3);margin-bottom:.75rem;font-family:'Inter',sans-serif}
        .cs-signin-btn{background:none;border:1px solid rgba(107,47,173,.4);border-radius:8px;padding:.55rem 1.4rem;font-size:.68rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#9b6dff;cursor:pointer;font-family:'Inter',sans-serif}
        .cs-loading{font-size:.8rem;color:rgba(255,255,255,.2);font-family:'Inter',sans-serif;padding:1rem 0}
        .cs-empty{font-size:.88rem;color:rgba(255,255,255,.2);font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;padding:1rem 0}
        .cs-comments-list{display:flex;flex-direction:column}
        .cs-divider{height:1px;background:rgba(255,255,255,.05);margin:.25rem 0 1.75rem}
        .cs-comment{display:flex;gap:12px;margin-bottom:.25rem}
        .cs-comment-body{flex:1;min-width:0}
        .cs-comment-header{display:flex;align-items:center;gap:6px;margin-bottom:.45rem;flex-wrap:wrap}
        .cs-name{font-size:.8rem;font-weight:500;color:#e8e0d4;font-family:'Inter',sans-serif}
        .cs-name-link{text-decoration:none;transition:color .2s}
        .cs-name-link:hover{color:#a78bfa}
        .cs-time{font-size:.65rem;color:rgba(255,255,255,.22);font-family:'Inter',sans-serif}
        .cs-comment-text{font-family:'Cormorant Garamond',Georgia,serif;font-size:1rem;color:rgba(232,224,212,.75);line-height:1.75}
        .cs-comment-text-sm{font-size:.92rem}
        .cs-comment-footer{margin-top:.5rem}
        .cs-reply-btn{background:none;border:none;font-size:.65rem;color:rgba(155,109,255,.5);cursor:pointer;font-family:'Inter',sans-serif;letter-spacing:.08em;padding:0;transition:color .2s}
        .cs-reply-btn:hover{color:#9b6dff}
        .cs-reply-compose{margin-top:.75rem}
        .cs-replies{margin-top:1rem;padding-left:1rem;border-left:1px solid rgba(107,47,173,.2);display:flex;flex-direction:column;gap:.75rem}
        .cs-reply{display:flex;gap:10px}
        @media(max-width:600px){.rtitle{display:none}.rbtn{font-size:.44rem;padding:3px 7px}.cs-section{padding:2rem 1rem 5rem}}
        @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes toastOut{from{opacity:1;transform:translateX(-50%) translateY(0)}to{opacity:0;transform:translateX(-50%) translateY(-8px)}}
        .bookmark-toast{position:fixed;bottom:52px;left:50%;transform:translateX(-50%);background:#6b2fad;border:1px solid rgba(201,164,76,0.3);border-radius:999px;padding:9px 20px;font-family:'Cormorant Garamond',serif;font-size:.82rem;font-style:italic;color:#f0ead8;white-space:nowrap;z-index:300;pointer-events:none;}
        .bookmark-toast.in{animation:toastIn .4s ease forwards}
        .bookmark-toast.out{animation:toastOut .4s ease forwards}
      `}</style>

      <div style={{ width: '100vw', height: '100vh', background: '#1a0f0a', overflow: 'hidden' }}>
        <div className="rtop">
          <a href="/" className="rlogo">Calvary Scribblings</a>
          <span className="rtitle">{story.title}</span>
          <div className="rtop-right">
            <button className="rbtn" onClick={() => iframeRef.current?.contentWindow?.postMessage({ type: 'saveBookmark' }, '*')} title="Bookmark" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill={bookmarkSaved ? '#c9a44c' : 'none'} stroke="rgba(201,164,76,0.7)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              {bookmarkSaved ? 'Saved' : 'Mark'}
            </button>
<button className="rbtn" onClick={cycleFont}>Aa {FONT_SIZES[fontIndex]}px</button>
            <a href={'/stories/' + slug} className="rclose">← View</a>
          </div>
        </div>

        {showCover && (
          <div className="bcover" onClick={() => setShowCover(false)}>
            <div className="bcorn">✦ ✦ ✦</div>
            <img src={story.cover} alt={story.title} className="bcimg" />
            <div className="bctitle">{story.title}</div>
            <div className="bcauthor">by {story.author}</div>
            <div className="bccta">Open to begin reading</div>
          </div>
        )}

        {!showCover && showEnd && (
          <div className="bend-wrap">
            <div className="bend">
              <div className="beorn">✦</div>
              <div className="berule" />
              <div className="betitle">{story.title}</div>
              <div className="beauth">by {story.author}</div>
              {hitCount !== null && <div className="bemeta">{hitCount.toLocaleString()} reads</div>}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="bebtn" onClick={() => setShowEnd(false)}>← Back to book</button>
                <a href={'/' + (story.category || '')} className="bebtn">More stories</a>
              </div>

            </div>
            <div style={{ padding: '0 1.5rem 1.5rem', background: '#0a0a0a' }}><TipBox variant="reader" /></div>
            <CommentsSection slug={slug} onSignIn={() => setShowAuthModal(true)} />
          </div>
        )}

        {!showCover && !showEnd && progress > 90 && (
          <button
            onClick={() => setShowEnd(true)}
            style={{
              position: 'fixed', bottom: '52px', left: '50%', transform: 'translateX(-50%)',
              background: '#6b2fad', border: 'none', borderRadius: '999px',
              padding: '10px 24px', display: 'flex', alignItems: 'center', gap: '8px',
              fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.18em',
              textTransform: 'uppercase', color: '#fff', cursor: 'pointer', zIndex: 300,
              boxShadow: '0 4px 24px rgba(107,47,173,0.5)',
              animation: 'fadeUp .4s ease forwards',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Discuss
          </button>
        )}
        {!showCover && !showEnd && bookmarkLoaded && (iframeSrc
          ? <iframe ref={iframeRef} className="reader-frame" src={iframeSrc} title={story.title} sandbox="allow-scripts allow-same-origin" />
          : <div className="no-epub">No EPUB file available for this book.</div>
        )}

        {!showCover && !showEnd && (
          <div className="rbot">
            <div className="rprog"><div className="rprogf" style={{ width: progress + '%' }} /></div>
            {pageInfo && <span className="rpageinfo">{pageInfo}</span>}
          </div>
        )}

        {showAuthModal && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowAuthModal(false)}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#12091e', border: '1px solid rgba(107,47,173,0.3)', borderRadius: 16, padding: '2rem', maxWidth: 360, width: '90vw', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Cinzel,serif', fontSize: '.6rem', letterSpacing: '.25em', color: 'rgba(201,164,76,.6)', textTransform: 'uppercase', marginBottom: '1rem' }}>Calvary Scribblings</div>
              <div style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: '1.4rem', fontStyle: 'italic', color: '#f5efe0', marginBottom: '.5rem' }}>Join the Discussion</div>
              <div style={{ fontFamily: 'Cormorant Garamond,serif', fontSize: '.9rem', fontStyle: 'italic', color: 'rgba(255,255,255,.35)', marginBottom: '1.5rem' }}>Sign in to comment on this story</div>
              <a href="/auth" style={{ display: 'block', padding: '.75rem', background: '#6b2fad', color: '#fff', fontFamily: 'Cinzel,serif', fontSize: '.6rem', letterSpacing: '.18em', textTransform: 'uppercase', textDecoration: 'none', borderRadius: 8, marginBottom: '.75rem' }}>Sign In</a>
              <button onClick={() => setShowAuthModal(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.3)', fontFamily: 'Cinzel,serif', fontSize: '.55rem', letterSpacing: '.15em', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}
        {debugMsg ? <div style={{ position: 'fixed', top: '52px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.85)', color: '#c9a44c', fontFamily: 'monospace', fontSize: '10px', padding: '4px 10px', borderRadius: '4px', zIndex: 400, whiteSpace: 'nowrap', maxWidth: '90vw', overflow: 'hidden' }}>{debugMsg}</div> : null}
        {showBookmarkToast && (
          <div className={'bookmark-toast ' + (toastFading ? 'out' : 'in')}>
            Continue where you left off on the Island 🏝️
          </div>
        )}
      </div>
    </>
  );
}