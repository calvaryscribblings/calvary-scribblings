'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { stories as allStories } from '../lib/stories';

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
async function getStorage() { const { getStorage } = await import('firebase/storage'); return getStorage(await getApp()); }

const FOUNDER_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';

function getBadge(readCount, uid) {
  if (uid === FOUNDER_UID) return { tier: 'founder', label: 'Founder', color: '#c8daea', isFounder: true };
  if (readCount >= 1000) return { tier: 'immortal', label: 'Immortal of the Island', color: '#9b6dff' };
  if (readCount >= 150) return { tier: 'legend', label: 'Legend of the Island', color: '#d4537e' };
  if (readCount >= 90) return { tier: 'islander', label: 'Story Islander', color: '#d4941a' };
  if (readCount >= 60) return { tier: 'island', label: 'Island Reader', color: '#1d9e75' };
  if (readCount >= 25) return { tier: 'reader', label: 'Reader', color: '#b4b2a9' };
  return null;
}

function getNextBadge(readCount, uid) {
  if (uid === FOUNDER_UID) return null;
  if (readCount < 25) return { label: 'Reader', threshold: 25 };
  if (readCount < 60) return { label: 'Island Reader', threshold: 60 };
  if (readCount < 90) return { label: 'Story Islander', threshold: 90 };
  if (readCount < 150) return { label: 'Legend of the Island', threshold: 150 };
  if (readCount < 1000) return { label: 'Immortal of the Island', threshold: 1000 };
  return null;
}

function getPrevThreshold(t) {
  return { 25: 0, 60: 25, 90: 60, 150: 90, 1000: 150 }[t] || 0;
}

const BADGE_PATH = 'M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C1.87 9.33 1 10.57 1 12s.87 2.67 2.19 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91C21.37 14.67 22.25 13.43 22.25 12z';
const CHECK_PATH = 'M9.13 17.75L5.5 14.12l1.41-1.41 2.22 2.22 6.34-7.59 1.53 1.28z';
const HEART_PATH = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';
const FLAME_PATH = 'M12 2C9.5 6 7 7.5 7 11a5 5 0 0 0 10 0c0-3.5-2.5-5-5-9zm0 14a3 3 0 0 1-3-3c0-1.8 1-2.8 2-4 1 1.2 2 2.2 2 4a3 3 0 0 1-1 3z';

function BadgeIcon({ color, size = 14, isFounder = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="pgPlat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8f0f8" /><stop offset="50%" stopColor="#c8daea" /><stop offset="100%" stopColor="#a8c0d6" />
        </linearGradient>
      </defs>
      <path fill={isFounder ? 'url(#pgPlat)' : color} d={BADGE_PATH} />
      <path fill={color === '#b4b2a9' ? '#0a0a0a' : '#fff'} d={CHECK_PATH} />
    </svg>
  );
}

function WriterBadge({ size = 13 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <path fill="#581c87" d={BADGE_PATH} />
        <path fill="#e9d5ff" d={CHECK_PATH} />
      </svg>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', background: 'rgba(212,83,126,0.12)', border: '1px solid rgba(212,83,126,0.35)', borderRadius: '6px', padding: '1px 7px 1px 5px' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path fill="#d4537e" d={HEART_PATH} /></svg>
        <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#d4537e', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>Writer</span>
      </span>
    </span>
  );
}

function formatJoinDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function formatPence(pence) {
  return `£${(pence / 100).toFixed(2)}`;
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

/* ── Square Post Card ─────────────────────────────────────────────────── */
function SquarePostCard({ post, profileData, isAuthor, badge, uid }) {
  const initials = (post.authorName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{
      padding: '1.1rem 0',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Author row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.6rem' }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(107,47,173,0.2)', border: '1.5px solid rgba(167,139,250,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0,
          fontFamily: 'Cochin, Georgia, serif',
        }}>
          {post.authorAvatarUrl
            ? <img src={post.authorAvatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.85rem', color: '#ffffff', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
              {post.authorName || 'Reader'}
            </span>
            {post.isAuthor ? <WriterBadge size={12} /> : badge && (
              <BadgeIcon color={badge.color} size={13} isFounder={badge.isFounder} />
            )}
          </div>
          {profileData?.username && (
            <div style={{ fontSize: '0.68rem', color: 'rgba(167,139,250,0.5)', fontFamily: 'Inter, sans-serif' }}>
              @{profileData.username}
            </div>
          )}
        </div>
        <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif', flexShrink: 0 }}>
          {timeAgo(post.createdAt)}
        </div>
      </div>

      {/* Post text */}
      <div style={{
        fontSize: '0.93rem', color: '#f0ece6',
        fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif',
        lineHeight: 1.72, marginBottom: '0.6rem',
        paddingLeft: '2.85rem',
      }}>
        {post.text}
      </div>

      {/* Attached story */}
      {post.attachedStory && (
        <a href={`/stories/${post.attachedStory.slug}`} style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          marginLeft: '2.85rem', marginBottom: '0.6rem',
          padding: '0.5rem 0.75rem',
          background: 'rgba(107,47,173,0.08)',
          border: '1px solid rgba(107,47,173,0.2)',
          borderRadius: '8px', textDecoration: 'none',
        }}>
          {post.attachedStory.cover && (
            <img src={post.attachedStory.cover} alt="" style={{ width: 28, height: 40, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
          )}
          <span style={{ fontSize: '0.75rem', color: 'rgba(167,139,250,0.8)', fontFamily: 'Cochin, Georgia, serif' }}>
            {post.attachedStory.title}
          </span>
        </a>
      )}

      {/* Reactions row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingLeft: '2.85rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(212,83,126,0.5)" stroke="none">
            <path d={HEART_PATH} />
          </svg>
          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter, sans-serif' }}>
            {post.likeCount || 0}
          </span>
        </span>
        {post.parentId && (
          <span style={{ fontSize: '0.62rem', color: 'rgba(167,139,250,0.3)', fontFamily: 'Inter, sans-serif' }}>
            reply
          </span>
        )}
      </div>
    </div>
  );
}

/* ── User List Modal ──────────────────────────────────────────────────── */
function UserListModal({ title, uids, onClose }) {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    if (!uids || uids.length === 0) { setLoadingUsers(false); return; }
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const results = await Promise.all(uids.map(uid => get(ref(db, `users/${uid}`)).then(snap => ({ uid, data: snap.exists() ? snap.val() : null }))));
      setUsers(results.filter(u => u.data));
      setLoadingUsers(false);
    })();
  }, [uids]);

  return (
    <div className="pf-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-modal">
        <div className="pf-modal-header">
          <div className="pf-modal-title">{title}</div>
          <button className="pf-modal-close" onClick={onClose}>×</button>
        </div>
        {loadingUsers ? (
          <div style={{ padding: '1.5rem 0', color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem', fontFamily: 'Inter, sans-serif' }}>Loading…</div>
        ) : users.length === 0 ? (
          <div style={{ padding: '1.5rem 0', color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic' }}>No one here yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {users.map(({ uid, data }) => {
              const initials = (data.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
              const badge = getBadge(data.readCount || 0, uid);
              return (
                <a key={uid} href={`/user?id=${uid}`} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', textDecoration: 'none', padding: '0.55rem 0.65rem', borderRadius: '10px', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1.5px solid rgba(167,139,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0 }}>
                    {data.avatarUrl ? <img src={data.avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', color: '#ffffff', fontFamily: 'Inter, sans-serif', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.displayName || 'Reader'}</div>
                    {data.username && <div style={{ fontSize: '0.68rem', color: 'rgba(167,139,250,0.5)', fontFamily: 'Inter, sans-serif' }}>@{data.username}</div>}
                  </div>
                  {data.isAuthor ? <WriterBadge size={12} /> : badge && <BadgeIcon color={badge.color} size={13} isFounder={badge.isFounder} />}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Comment History Modal ────────────────────────────────────────────── */
function CommentHistoryModal({ uid, onClose, allStoriesMerged }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, 'comments'));
      if (!snap.exists()) { setLoading(false); return; }
      const all = [];
      Object.entries(snap.val()).forEach(([slug, slugComments]) => {
        Object.entries(slugComments).forEach(([id, c]) => {
          if (c.authorUid === uid) all.push({ id, slug, ...c });
        });
      });
      all.sort((a, b) => b.createdAt - a.createdAt);
      setComments(all);
      setLoading(false);
    })();
  }, [uid]);

  return (
    <div className="pf-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-modal">
        <div className="pf-modal-header">
          <div className="pf-modal-title">My Comments</div>
          <button className="pf-modal-close" onClick={onClose}>×</button>
        </div>
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', padding: '1rem 0' }}>Loading…</div>
        ) : comments.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic', fontSize: '0.9rem' }}>No comments yet.</div>
        ) : comments.map(c => {
          const story = allStoriesMerged.find(s => s.id === c.slug);
          return (
            <a key={c.id} href={`/stories/${c.slug}`} style={{ display: 'block', textDecoration: 'none', padding: '0.85rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'opacity 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              {story && (
                <div style={{ fontSize: '0.65rem', color: 'rgba(155,109,255,0.55)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                  {story.title}
                </div>
              )}
              <div style={{ fontSize: '0.9rem', color: '#f0ece6', fontFamily: 'Cochin, Georgia, serif', lineHeight: 1.65, marginBottom: 4 }}>{c.text}</div>
              <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif' }}>{timeAgo(c.createdAt)}</div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* ── Notification type label ──────────────────────────────────────────── */
function notifLabel(n) {
  switch (n.type) {
    case 'heart': return ' loved your post';
    case 'fire': return ' reacted 🔥 to your post';
    case 'square_post': return ' mentioned you in a post';
    case 'mention': return ' mentioned you on The Square';
    case 'reply': return ' replied to your comment';
    case 'follow': return ' started following you';
    case 'new_story': return ` published: ${n.storyTitle || 'a new story'}`;
    case 'reward': return n.message || ' — you earned points!';
    default: return ' interacted with you';
  }
}

/* ── Main Profile Page ────────────────────────────────────────────────── */
export default function ProfilePage() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [readCount, setReadCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followerUids, setFollowerUids] = useState([]);
  const [followingUids, setFollowingUids] = useState([]);
  const [readStorySlugs, setReadStorySlugs] = useState([]);
  const [cmsStories, setCmsStories] = useState([]);
  const [points, setPoints] = useState(0);
  const [walletBalance, setWalletBalance] = useState(0);
  const [squarePosts, setSquarePosts] = useState([]);
  const [squareLoading, setSquareLoading] = useState(true);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showAllStories, setShowAllStories] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAvatarFile, setEditAvatarFile] = useState(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [libNotifs, setLibNotifs] = useState([]);
  const [showLibNotifs, setShowLibNotifs] = useState(false);
  const [unreadLibCount, setUnreadLibCount] = useState(0);
  const [enrichedNotifs, setEnrichedNotifs] = useState({});
  const fileInputRef = useRef(null);

  /* Load CMS stories */
  useEffect(() => {
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, 'cms_stories'));
      if (snap.exists()) {
        setCmsStories(Object.entries(snap.val()).map(([id, s]) => ({ id, title: s.title || '', cover: s.cover || '', category: s.category || '' })));
      }
    })();
  }, []);

  /* Library notifications listener */
  useEffect(() => {
    let unsubNotifs;
    (async () => {
      try {
        const auth = await getFirebaseAuth();
        const { onAuthStateChanged } = await import('firebase/auth');
        onAuthStateChanged(auth, (u) => {
          if (!u) return;
          (async () => {
            const db = await getDB();
            const { ref, onValue } = await import('firebase/database');
            unsubNotifs = onValue(ref(db, `library_notifications/${u.uid}`), (snap) => {
              if (!snap.exists()) { setLibNotifs([]); setUnreadLibCount(0); return; }
              const items = Object.entries(snap.val())
                .map(([id, n]) => ({ id, ...n }))
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 40);
              setLibNotifs(items);
              setUnreadLibCount(items.filter(n => !n.read).length);
            });
          })();
        });
      } catch (e) {}
    })();
    return () => { if (unsubNotifs) unsubNotifs(); };
  }, []);

  /* Enrich notifications with post text when panel opens */
  useEffect(() => {
    if (!showLibNotifs) return;
    const toFetch = libNotifs.filter(n => n.postId && !enrichedNotifs[n.postId]);
    if (!toFetch.length) return;
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const results = await Promise.all(
        toFetch.map(n => get(ref(db, `square_posts/${n.postId}`)).then(snap => ({ postId: n.postId, data: snap.exists() ? snap.val() : null })))
      );
      const enriched = { ...enrichedNotifs };
      results.forEach(({ postId, data }) => { enriched[postId] = data; });
      setEnrichedNotifs(enriched);
    })();
  }, [showLibNotifs, libNotifs]);

  const markLibNotifsRead = async () => {
    setUnreadLibCount(0);
    try {
      const auth = await getFirebaseAuth();
      const u = auth.currentUser;
      if (!u) return;
      const db = await getDB();
      const { ref, update } = await import('firebase/database');
      const updates = {};
      libNotifs.filter(n => !n.read).forEach(n => { updates[`${n.id}/read`] = true; });
      if (Object.keys(updates).length) await update(ref(db, `library_notifications/${u.uid}`), updates);
    } catch (e) {}
  };

  /* Main auth + profile listener */
  useEffect(() => {
    let unsubAuth = null;
    const unsubDB = [];
    (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      unsubAuth = onAuthStateChanged(auth, async (u) => {
        if (!u) { router.push('/'); return; }
        setAuthUser(u);
        const db = await getDB();
        const { ref, onValue, get } = await import('firebase/database');

        const unsubProfile = onValue(ref(db, `users/${u.uid}`), (snap) => {
          if (snap.exists()) {
            const d = snap.val();
            setProfileData(d);
            setReadCount(d.readCount || 0);
            setReadStorySlugs(d.readStories ? Object.keys(d.readStories) : []);
          }
          setLoading(false);
        });
        unsubDB.push(unsubProfile);

        const unsubFollowers = onValue(ref(db, `followers/${u.uid}`), (snap) => {
          const uids = snap.exists() ? Object.keys(snap.val()) : [];
          setFollowerCount(uids.length); setFollowerUids(uids);
        });
        unsubDB.push(unsubFollowers);

        const unsubFollowing = onValue(ref(db, `following/${u.uid}`), (snap) => {
          const uids = snap.exists() ? Object.keys(snap.val()) : [];
          setFollowingCount(uids.length); setFollowingUids(uids);
        });
        unsubDB.push(unsubFollowing);

        const unsubComments = onValue(ref(db, 'comments'), (commentsSnap) => {
          if (!commentsSnap.exists()) return;
          let count = 0;
          for (const sc of Object.values(commentsSnap.val()))
            for (const c of Object.values(sc))
              if (c.authorUid === u.uid) count++;
          setCommentCount(count);
        });
        unsubDB.push(unsubComments);

        try {
          const [pointsSnap, walletSnap] = await Promise.all([
            get(ref(db, `points/${u.uid}/total`)),
            get(ref(db, `wallet/${u.uid}/balance`)),
          ]);
          if (pointsSnap.exists()) setPoints(pointsSnap.val());
          if (walletSnap.exists()) setWalletBalance(walletSnap.val());
        } catch (e) {}

        /* Load Square posts */
        try {
          const sqSnap = await get(ref(db, `user_square_posts/${u.uid}`));
          if (sqSnap.exists()) {
            const list = Object.entries(sqSnap.val())
              .map(([id, p]) => ({ id, ...p }))
              .sort((a, b) => b.createdAt - a.createdAt);
            setSquarePosts(list);
          }
        } catch (e) {}
        setSquareLoading(false);
      });
    })();
    return () => { if (unsubAuth) unsubAuth(); unsubDB.forEach(fn => fn()); };
  }, []);

  const openEdit = () => {
    setEditName(profileData?.displayName || authUser?.displayName || '');
    setEditUsername(profileData?.username || '');
    setEditBio(profileData?.bio || '');
    setEditAvatarFile(null);
    setEditAvatarPreview(profileData?.avatarUrl || null);
    setSaveError('');
    setShowEdit(true);
  };

  const handleEditAvatarChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setEditAvatarFile(file);
    setEditAvatarPreview(URL.createObjectURL(file));
  };

  const handleSave = async () => {
    if (!authUser) return;
    setSaving(true); setSaveError('');
    try {
      const db = await getDB();
      const { ref, update, set, remove } = await import('firebase/database');
      let newAvatarUrl = profileData?.avatarUrl || null;
      if (editAvatarFile) {
        const storage = await getStorage();
        const { ref: sRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
        const storageRef = sRef(storage, `avatars/${authUser.uid}`);
        await uploadBytes(storageRef, editAvatarFile);
        newAvatarUrl = await getDownloadURL(storageRef);
      }
      const username = editUsername.trim().replace(/^@/, '').toLowerCase();
      if (username && !/^[a-z0-9_]{3,20}$/.test(username)) {
        setSaveError('Username must be 3–20 characters: letters, numbers, underscores only.');
        setSaving(false); return;
      }
      const { updateProfile } = await import('firebase/auth');
      const newName = editName.trim() || authUser.displayName;
      await updateProfile(authUser, { displayName: newName });
      await update(ref(db, `users/${authUser.uid}`), { displayName: newName, bio: editBio.trim(), username: username || null, avatarUrl: newAvatarUrl });
      if (username) await set(ref(db, `usernames/${username}`), authUser.uid);
      const oldUsername = profileData?.username;
      if (oldUsername && oldUsername !== username) await remove(ref(db, `usernames/${oldUsername}`));
      setShowEdit(false);
    } catch (e) { setSaveError('Something went wrong. Please try again.'); }
    setSaving(false);
  };

  const handleSignOut = async () => {
    const auth = await getFirebaseAuth();
    const { signOut } = await import('firebase/auth');
    await signOut(auth);
    router.push('/');
  };

  const handleResetPassword = async () => {
    if (!authUser?.email) return;
    setChangingPassword(true);
    try {
      const auth = await getFirebaseAuth();
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, authUser.email);
      setPwMsg('Password reset email sent. Check your inbox.');
    } catch (e) { setPwMsg('Something went wrong. Please try again.'); }
    setChangingPassword(false);
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#0d0d0d' }} />;
  if (!authUser) return null;

  const avatarUrl = profileData?.avatarUrl || null;
  const displayName = profileData?.displayName || authUser.displayName || 'Reader';
  const username = profileData?.username || null;
  const bio = profileData?.bio || null;
  const isAuthor = profileData?.isAuthor || false;
  const badge = getBadge(readCount, authUser.uid);
  const nextBadge = getNextBadge(readCount, authUser.uid);
  const initials = displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const joinDate = authUser.metadata?.creationTime ? formatJoinDate(new Date(authUser.metadata.creationTime)) : null;
  const tierProgress = nextBadge ? Math.min(100, Math.round(((readCount - getPrevThreshold(nextBadge.threshold)) / (nextBadge.threshold - getPrevThreshold(nextBadge.threshold))) * 100)) : 100;

  const allStoriesMerged = [...allStories, ...cmsStories.filter(cs => !allStories.find(s => s.id === cs.id))];
  const readStories = readStorySlugs.map(slug => allStoriesMerged.find(s => s.id === slug)).filter(Boolean);
  const visibleStories = showAllStories ? readStories : readStories.slice(0, 10);
  const visiblePosts = showAllPosts ? squarePosts : squarePosts.slice(0, 5);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0d0d0d; color: #e8e0d4; font-family: Inter, sans-serif; min-height: 100vh; }

        /* ── Nav ── */
        .pf-nav {
          position: relative; z-index: 10;
          display: flex; align-items: center; justify-content: space-between;
          max-width: 680px; margin: 0 auto; padding: 1.1rem 1.5rem;
        }
        .pf-nav-logo { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1rem; font-weight: 600; color: #f5f0e8; letter-spacing: 0.01em; }
        .pf-nav-logo span { color: #a78bfa; }
        .pf-nav-right { display: flex; align-items: center; gap: 1.1rem; }
        .pf-nav-back { font-size: 0.6rem; color: rgba(255,255,255,0.45); letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; transition: color 0.2s; font-family: Inter, sans-serif; }
        .pf-nav-back:hover { color: rgba(255,255,255,0.8); }

        /* ── Banner ── */
        .pf-banner {
          position: relative; width: 100%; height: 168px;
          background: linear-gradient(120deg, #1a0a2e 0%, #2d1b4e 45%, #1f1500 75%, #2a1800 100%);
          overflow: hidden;
        }
        .pf-banner::after {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(120deg, rgba(107,47,173,0.25) 0%, transparent 55%, rgba(201,164,76,0.08) 100%);
          pointer-events: none;
        }
        .pf-banner-edit {
          position: absolute; bottom: 12px; right: 14px; z-index: 2;
          background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.15);
          border-radius: 50%; width: 34px; height: 34px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background 0.2s, border-color 0.2s;
        }
        .pf-banner-edit:hover { background: rgba(107,47,173,0.4); border-color: rgba(167,139,250,0.4); }

        /* ── Avatar strip ── */
        .pf-avatar-strip {
          position: relative; background: #0d0d0d;
          max-width: 680px; margin: 0 auto;
          padding: 0 1.5rem;
          display: flex; align-items: flex-end; justify-content: space-between;
          margin-top: -52px;
        }
        .pf-avatar {
          width: 100px; height: 100px; border-radius: 50%;
          background: rgba(107,47,173,0.2);
          border: 3px solid #0d0d0d;
          display: flex; align-items: center; justify-content: center;
          font-size: 34px; font-weight: 400; color: #c4b5fd; overflow: hidden;
          font-family: Cochin, Georgia, serif; flex-shrink: 0;
          box-shadow: 0 0 0 2px rgba(167,139,250,0.2);
          position: relative; z-index: 1;
        }
        .pf-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .pf-avatar-strip-pad { height: 52px; }

        /* ── Identity block ── */
        .pf-identity {
          max-width: 680px; margin: 0 auto;
          padding: 0.75rem 1.5rem 0;
        }
        .pf-name {
          font-family: Cochin, Cormorant Garamond, Georgia, serif;
          font-size: clamp(1.6rem, 5vw, 2.1rem);
          font-weight: 400; color: #ffffff; line-height: 1.05;
          margin-bottom: 0.2rem; letter-spacing: -0.01em;
        }
        .pf-username { font-size: 0.78rem; color: rgba(167,139,250,0.55); font-family: Inter, sans-serif; margin-bottom: 0.55rem; }
        .pf-meta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 0.35rem; }
        .pf-sep { color: rgba(255,255,255,0.15); font-size: 0.7rem; }
        .pf-verified { display: inline-flex; align-items: center; gap: 3px; font-size: 0.6rem; color: #1d9e75; font-family: Inter, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pf-unverified { font-size: 0.6rem; color: rgba(255,255,255,0.3); font-family: Inter, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pf-joined { font-size: 0.65rem; color: rgba(255,255,255,0.3); font-family: Inter, sans-serif; margin-bottom: 0.75rem; }
        .pf-follow-row { display: flex; gap: 1.5rem; margin-bottom: 0; }
        .pf-follow-stat { display: flex; align-items: baseline; gap: 5px; cursor: pointer; }
        .pf-follow-stat:hover .pf-follow-num { color: #a78bfa; }
        .pf-follow-num { font-family: Cochin, Georgia, serif; font-size: 1.1rem; color: #f5f0e8; line-height: 1; transition: color 0.2s; }
        .pf-follow-label { font-size: 0.58rem; color: rgba(255,255,255,0.35); letter-spacing: 0.1em; text-transform: uppercase; font-family: Inter, sans-serif; }

        /* ── Body ── */
        .pf-body { max-width: 680px; margin: 0 auto; padding: 0 1.5rem 6rem; }

        .pf-bio-wrap { padding: 1.1rem 0 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 1.75rem; }
        .pf-bio-text { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.05rem; color: rgba(240,236,230,0.85); line-height: 1.8; }
        .pf-bio-empty { font-size: 0.8rem; color: rgba(255,255,255,0.25); font-family: Inter, sans-serif; cursor: pointer; }
        .pf-bio-empty:hover { color: rgba(255,255,255,0.45); }

        /* ── Stats grid ── */
        .pf-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; margin-bottom: 2rem; overflow: hidden; }
        .pf-stat { background: rgba(255,255,255,0.02); padding: 1.5rem 1rem; text-align: center; transition: background 0.2s; }
        .pf-stat:hover { background: rgba(255,255,255,0.045); }
        .pf-stat-num { font-family: Cochin, Georgia, serif; font-size: 2.2rem; font-weight: 400; color: #f5f0e8; line-height: 1; margin-bottom: 0.4rem; }
        .pf-stat-label { font-size: 0.54rem; color: rgba(255,255,255,0.35); letter-spacing: 0.15em; text-transform: uppercase; font-family: Inter, sans-serif; }

        /* ── Section ── */
        .pf-section { margin-bottom: 2.25rem; }
        .pf-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .pf-section-title { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.2rem; font-weight: 400; color: #f5f0e8; }
        .pf-section-meta { font-size: 0.58rem; color: rgba(255,255,255,0.3); letter-spacing: 0.12em; text-transform: uppercase; font-family: Inter, sans-serif; }

        /* ── Stories ── */
        .pf-story-row { display: flex; align-items: center; gap: 12px; padding: 0.7rem 0; border-bottom: 1px solid rgba(255,255,255,0.04); text-decoration: none; transition: opacity 0.2s; }
        .pf-story-row:hover { opacity: 0.72; }
        .pf-story-thumb { width: 34px; height: 48px; border-radius: 3px; overflow: hidden; flex-shrink: 0; background: rgba(107,47,173,0.15); }
        .pf-story-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .pf-story-title { font-family: Cochin, Georgia, serif; font-size: 0.88rem; color: #f5f0e8; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pf-story-author { font-size: 0.65rem; color: rgba(255,255,255,0.35); font-family: Inter, sans-serif; margin-top: 2px; }
        .pf-more-btn { background: none; border: none; font-size: 0.7rem; color: rgba(155,109,255,0.5); font-family: Inter, sans-serif; cursor: pointer; padding: 0.65rem 0 0; letter-spacing: 0.06em; text-decoration: underline; text-underline-offset: 3px; }
        .pf-more-btn:hover { color: #a78bfa; }

        /* ── Badge card ── */
        .pf-badge-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.25rem; }
        .pf-progress-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; }
        .pf-progress-current { font-size: 0.75rem; color: rgba(255,255,255,0.6); font-family: Inter, sans-serif; }
        .pf-progress-next { font-size: 0.62rem; color: rgba(255,255,255,0.3); font-family: Inter, sans-serif; }
        .pf-progress-bar-wrap { height: 2px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
        .pf-progress-bar { height: 100%; border-radius: 2px; transition: width 0.8s cubic-bezier(0.22,1,0.36,1); }

        /* ── Rewards ── */
        .pf-rewards-btn { display: block; width: 100%; text-decoration: none; position: relative; overflow: hidden; background: linear-gradient(135deg, #1a0a2e 0%, #0d1a12 50%, #1a0a2e 100%); border: 1px solid rgba(107,47,173,0.25); border-radius: 18px; padding: 1.75rem; transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease; }
        .pf-rewards-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 35px rgba(107,47,173,0.2); border-color: rgba(107,47,173,0.45); }
        .pf-rewards-shimmer { position: absolute; top: 0; left: -100%; width: 60%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.025), transparent); animation: pf-shimmer 3s infinite; }
        @keyframes pf-shimmer { 0% { left: -100%; } 100% { left: 200%; } }
        .pf-rewards-inner { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; }
        .pf-rewards-eyebrow { font-size: 0.55rem; color: rgba(155,109,255,0.5); letter-spacing: 0.2em; text-transform: uppercase; font-family: Inter, sans-serif; margin-bottom: 0.35rem; }
        .pf-rewards-title { font-family: Cochin, Georgia, serif; font-size: 1.5rem; color: #f5f0e8; line-height: 1.1; }
        .pf-rewards-sub { font-size: 0.68rem; color: rgba(232,224,212,0.3); font-family: Inter, sans-serif; margin-top: 0.2rem; }
        .pf-rewards-points { font-family: Cochin, Georgia, serif; font-size: 2.6rem; color: #9b6dff; line-height: 1; }
        .pf-rewards-points-label { font-size: 0.52rem; color: rgba(155,109,255,0.4); letter-spacing: 0.14em; text-transform: uppercase; font-family: Inter, sans-serif; margin-top: 2px; }
        .pf-rewards-wallet { font-size: 0.68rem; color: rgba(29,158,117,0.65); font-family: Inter, sans-serif; margin-top: 0.2rem; }
        .pf-rewards-arrow { font-size: 1rem; color: rgba(167,139,250,0.3); margin-top: 0.5rem; transition: transform 0.2s; }
        .pf-rewards-btn:hover .pf-rewards-arrow { transform: translateX(4px); color: rgba(167,139,250,0.7); }

        /* ── Account ── */
        .pf-account-row { display: flex; align-items: center; justify-content: space-between; padding: 0.9rem 1.1rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; margin-bottom: 0.4rem; }
        .pf-account-label { font-size: 0.8rem; color: rgba(255,255,255,0.35); font-family: Inter, sans-serif; }
        .pf-account-action { font-size: 0.6rem; color: #9b6dff; letter-spacing: 0.1em; text-transform: uppercase; font-family: Inter, sans-serif; cursor: pointer; background: none; border: none; transition: color 0.2s; }
        .pf-account-action:hover { color: #c4b5fd; }
        .pf-pw-msg { font-size: 0.7rem; color: #86efac; font-family: Inter, sans-serif; margin-top: 0.4rem; padding: 0 0.25rem; }
        .pf-signout { width: 100%; margin-top: 0.85rem; background: none; border: 1px solid rgba(220,38,38,0.12); border-radius: 10px; padding: 0.85rem; font-size: 0.6rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(248,113,113,0.3); cursor: pointer; font-family: Inter, sans-serif; transition: color 0.2s, border-color 0.2s; }
        .pf-signout:hover { color: #f87171; border-color: rgba(220,38,38,0.35); }

        /* ── Notification panel ── */
        .lib-notif-panel { position: fixed; top: 0; right: 0; width: min(390px,100vw); height: 100vh; background: #0d0d0d; border-left: 1px solid rgba(255,255,255,0.07); z-index: 2000; display: flex; flex-direction: column; }
        .lib-notif-item { padding: 1rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.04); display: flex; gap: 10px; align-items: flex-start; cursor: pointer; transition: background 0.15s; }
        .lib-notif-item:hover { background: rgba(255,255,255,0.02); }
        .lib-notif-item.unread { background: rgba(107,47,173,0.05); }

        /* ── Edit modal ── */
        .pf-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.82); z-index: 1000; display: flex; align-items: flex-end; justify-content: center; }
        @media (min-width: 600px) { .pf-modal-backdrop { align-items: center; } }
        .pf-modal { background: #111; border: 1px solid rgba(255,255,255,0.08); border-radius: 20px 20px 0 0; width: 100%; max-width: 520px; padding: 2rem 1.5rem 2.5rem; max-height: 92vh; overflow-y: auto; }
        @media (min-width: 600px) { .pf-modal { border-radius: 20px; } }
        .pf-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.75rem; }
        .pf-modal-title { font-family: Cochin, Georgia, serif; font-size: 1.35rem; font-weight: 400; color: #f5f0e8; }
        .pf-modal-close { background: none; border: none; color: rgba(255,255,255,0.4); font-size: 1.4rem; cursor: pointer; padding: 0; line-height: 1; transition: color 0.2s; }
        .pf-modal-close:hover { color: rgba(255,255,255,0.8); }
        .pf-modal-avatar-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
        .pf-modal-avatar { width: 62px; height: 62px; border-radius: 50%; background: rgba(107,47,173,0.2); border: 2px solid rgba(167,139,250,0.25); display: flex; align-items: center; justify-content: center; font-size: 20px; color: #c4b5fd; overflow: hidden; font-family: Cochin, Georgia, serif; flex-shrink: 0; }
        .pf-modal-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .pf-modal-avatar-btn { background: none; border: 1px solid rgba(167,139,250,0.25); border-radius: 8px; padding: 0.4rem 1rem; font-size: 0.6rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(167,139,250,0.6); cursor: pointer; font-family: Inter, sans-serif; transition: all 0.2s; }
        .pf-modal-avatar-btn:hover { border-color: rgba(167,139,250,0.5); color: #a78bfa; }
        .pf-field { margin-bottom: 1rem; }
        .pf-field-label { font-size: 0.6rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.4); font-family: Inter, sans-serif; margin-bottom: 0.35rem; display: block; }
        .pf-field-input { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; padding: 0.75rem 1rem; font-size: 0.9rem; color: #e8e0d4; font-family: Inter, sans-serif; outline: none; transition: border-color 0.2s; }
        .pf-field-input:focus { border-color: rgba(167,139,250,0.4); }
        .pf-field-textarea { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; padding: 0.75rem 1rem; font-size: 0.95rem; color: rgba(232,224,212,0.8); font-family: Cochin, Georgia, serif; font-style: italic; outline: none; resize: none; line-height: 1.75; transition: border-color 0.2s; }
        .pf-field-textarea:focus { border-color: rgba(167,139,250,0.4); }
        .pf-field-hint { font-size: 0.6rem; color: rgba(255,255,255,0.25); font-family: Inter, sans-serif; margin-top: 0.25rem; }
        .pf-username-wrap { position: relative; }
        .pf-username-at { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: rgba(167,139,250,0.4); font-family: Inter, sans-serif; font-size: 0.9rem; pointer-events: none; }
        .pf-username-input { padding-left: 1.75rem !important; }
        .pf-save-error { font-size: 0.7rem; color: #f87171; font-family: Inter, sans-serif; margin-bottom: 0.65rem; }
        .pf-modal-actions { display: flex; gap: 0.65rem; margin-top: 1.5rem; }
        .pf-modal-save { flex: 1; background: #7c3aed; border: none; border-radius: 9px; padding: 0.8rem; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; cursor: pointer; font-family: Inter, sans-serif; transition: background 0.2s; }
        .pf-modal-save:hover { background: #6d28d9; }
        .pf-modal-save:disabled { opacity: 0.45; cursor: not-allowed; }
        .pf-modal-cancel { background: none; border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; padding: 0.8rem 1.1rem; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.4); cursor: pointer; font-family: Inter, sans-serif; }

        /* ── Mobile ── */
        @media (max-width: 520px) {
          .pf-banner { height: 130px; }
          .pf-avatar { width: 82px; height: 82px; font-size: 26px; }
          .pf-avatar-strip { margin-top: -42px; }
          .pf-name { font-size: 1.55rem; }
          .pf-bio-text { font-size: 0.95rem; }
          .pf-bio-wrap { padding: 0.85rem 0 1.25rem; }
          .pf-rewards-title { font-size: 1.25rem; }
          .pf-rewards-points { font-size: 2rem; }
        }
      `}</style>

      {/* Nav */}
      <nav className="pf-nav">
        <div className="pf-nav-logo">Calvary <span>Scribblings</span></div>
        <div className="pf-nav-right">
          <button
            onClick={() => { setShowLibNotifs(true); markLibNotifsRead(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, position: 'relative', display: 'flex', alignItems: 'center' }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unreadLibCount > 0 && (
              <span style={{ position: 'absolute', top: -3, right: -3, background: '#6b2fad', color: '#fff', fontSize: '0.48rem', fontWeight: 700, borderRadius: '999px', minWidth: 13, height: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px', fontFamily: 'Inter,sans-serif' }}>
                {unreadLibCount > 9 ? '9+' : unreadLibCount}
              </span>
            )}
          </button>
          <a href="/" className="pf-nav-back">← Back to stories</a>
        </div>
      </nav>

      {/* Banner */}
      <div className="pf-banner">
        <button className="pf-banner-edit" onClick={openEdit} title="Edit profile">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>

      {/* Avatar strip */}
      <div className="pf-avatar-strip">
        <div className="pf-avatar">
          {avatarUrl ? <img src={avatarUrl} alt={initials} /> : initials}
        </div>
        <div className="pf-avatar-strip-pad" />
      </div>

      {/* Identity */}
      <div className="pf-identity">
        <div className="pf-name">{displayName}</div>
        {username && <div className="pf-username">@{username}</div>}
        <div className="pf-meta-row">
          {isAuthor ? <WriterBadge size={13} /> : badge ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <BadgeIcon color={badge.color} size={13} isFounder={badge.isFounder} />
              <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', color: badge.color }}>{badge.label}</span>
            </span>
          ) : null}
          {(isAuthor || badge) && <span className="pf-sep">·</span>}
          {authUser.emailVerified ? (
            <span className="pf-verified">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#1d9e75" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Verified
            </span>
          ) : <span className="pf-unverified">Unverified</span>}
        </div>
        {joinDate && <div className="pf-joined">Member since {joinDate}</div>}
        <div className="pf-follow-row">
          <div className="pf-follow-stat" onClick={() => setShowFollowers(true)}>
            <div className="pf-follow-num">{followerCount}</div>
            <div className="pf-follow-label">Followers</div>
          </div>
          <div className="pf-follow-stat" onClick={() => setShowFollowing(true)}>
            <div className="pf-follow-num">{followingCount}</div>
            <div className="pf-follow-label">Following</div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="pf-body">

        {/* Bio */}
        <div className="pf-bio-wrap">
          {bio
            ? <span className="pf-bio-text">{bio}</span>
            : <span className="pf-bio-empty" onClick={openEdit}>+ Add a bio</span>}
        </div>

        {/* Stats */}
        <div className="pf-stats">
          <div className="pf-stat">
            <div className="pf-stat-num">{readCount.toLocaleString()}</div>
            <div className="pf-stat-label">Stories read</div>
          </div>
          <div className="pf-stat" onClick={() => setShowComments(true)} style={{ cursor: 'pointer' }}>
            <div className="pf-stat-num">{commentCount}</div>
            <div className="pf-stat-label">Comments ↗</div>
          </div>
          <div className="pf-stat">
            <div className="pf-stat-num">—</div>
            <div className="pf-stat-label">Bookmarks</div>
          </div>
        </div>

        {/* Stories read */}
        {readStories.length > 0 && (
          <div className="pf-section">
            <div className="pf-section-header">
              <div className="pf-section-title">Stories read</div>
              <div className="pf-section-meta">{readStories.length} total</div>
            </div>
            <div>
              {visibleStories.map(s => (
                <a key={s.id} href={`/stories/${s.id}`} className="pf-story-row">
                  <div className="pf-story-thumb">
                    {s.cover && <img src={s.cover} alt={s.title} loading="lazy" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pf-story-title">{s.title}</div>
                    <div className="pf-story-author">by {s.author}</div>
                  </div>
                </a>
              ))}
            </div>
            {readStories.length > 10 && !showAllStories && (
              <button className="pf-more-btn" onClick={() => setShowAllStories(true)}>
                Show {readStories.length - 10} more
              </button>
            )}
          </div>
        )}

        {/* Reading badge */}
        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">Reading badge</div>
            <div className="pf-section-meta">{isAuthor ? 'Writer' : badge ? badge.label : 'No badge yet'}</div>
          </div>
          <div className="pf-badge-card">
            <div className="pf-progress-row">
              <div className="pf-progress-current">{readCount.toLocaleString()} {readCount === 1 ? 'story' : 'stories'} read</div>
              <div className="pf-progress-next">
                {isAuthor ? 'Platform writer' : nextBadge ? `${nextBadge.label} at ${nextBadge.threshold}` : badge ? 'Max tier reached' : 'Reader at 25'}
              </div>
            </div>
            <div className="pf-progress-bar-wrap">
              <div className="pf-progress-bar" style={{ width: isAuthor ? '100%' : `${tierProgress}%`, background: isAuthor ? '#581c87' : badge ? badge.color : '#333' }} />
            </div>
          </div>
        </div>

        {/* Reader's Reward */}
        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">Reader's Reward</div>
          </div>
          <a href="/rewards" className="pf-rewards-btn">
            <div className="pf-rewards-shimmer" />
            <div className="pf-rewards-inner">
              <div>
                <div className="pf-rewards-eyebrow">The Story Island</div>
                <div className="pf-rewards-title">Your Rewards</div>
                <div className="pf-rewards-sub">Read · Comment · Earn · Cash out</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <div className="pf-rewards-points">{points}</div>
                <div className="pf-rewards-points-label">Points</div>
                {walletBalance > 0 && <div className="pf-rewards-wallet">{formatPence(walletBalance)} in wallet</div>}
                <div className="pf-rewards-arrow">→</div>
              </div>
            </div>
          </a>
        </div>

        {/* Square posts — inline */}
        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">The Scribblings Square</div>
            {squarePosts.length > 0 && <div className="pf-section-meta">{squarePosts.length} {squarePosts.length === 1 ? 'post' : 'posts'}</div>}
          </div>
          {squareLoading ? (
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.25)', fontFamily: 'Inter, sans-serif', padding: '0.5rem 0' }}>Loading…</div>
          ) : squarePosts.length === 0 ? (
            <div style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.25)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic', padding: '0.5rem 0' }}>
              No posts yet. <a href="/square" style={{ color: 'rgba(167,139,250,0.5)', textDecoration: 'none' }}>Visit The Square</a>
            </div>
          ) : (
            <>
              {visiblePosts.map(p => (
                <SquarePostCard
                  key={p.id}
                  post={p}
                  profileData={profileData}
                  isAuthor={isAuthor}
                  badge={badge}
                  uid={authUser.uid}
                />
              ))}
              {squarePosts.length > 5 && !showAllPosts && (
                <button className="pf-more-btn" onClick={() => setShowAllPosts(true)}>
                  Show {squarePosts.length - 5} more posts
                </button>
              )}
              <div style={{ marginTop: '0.85rem' }}>
                <a href="/square" style={{ fontSize: '0.68rem', color: 'rgba(167,139,250,0.4)', fontFamily: 'Inter, sans-serif', textDecoration: 'none', letterSpacing: '0.06em' }}>
                  Open The Square →
                </a>
              </div>
            </>
          )}
        </div>

        {/* Account */}
        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">Account</div>
          </div>
          <div className="pf-account-row">
            <span className="pf-account-label">{authUser.email}</span>
          </div>
          <div className="pf-account-row">
            <span className="pf-account-label">Password</span>
            <button className="pf-account-action" onClick={handleResetPassword} disabled={changingPassword}>
              {changingPassword ? 'Sending…' : 'Reset password'}
            </button>
          </div>
          {pwMsg && <div className="pf-pw-msg">{pwMsg}</div>}
          <button className="pf-signout" onClick={handleSignOut}>Sign out</button>
        </div>

      </div>

      {/* Modals */}
      {showFollowers && <UserListModal title={`Followers · ${followerCount}`} uids={followerUids} onClose={() => setShowFollowers(false)} />}
      {showFollowing && <UserListModal title={`Following · ${followingCount}`} uids={followingUids} onClose={() => setShowFollowing(false)} />}
      {showComments && <CommentHistoryModal uid={authUser.uid} onClose={() => setShowComments(false)} allStoriesMerged={allStoriesMerged} />}

      {/* Edit profile modal */}
      {showEdit && (
        <div className="pf-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowEdit(false); }}>
          <div className="pf-modal">
            <div className="pf-modal-header">
              <div className="pf-modal-title">Edit profile</div>
              <button className="pf-modal-close" onClick={() => setShowEdit(false)}>×</button>
            </div>
            <div className="pf-modal-avatar-row">
              <div className="pf-modal-avatar">
                {editAvatarPreview ? <img src={editAvatarPreview} alt="" /> : initials}
              </div>
              <button className="pf-modal-avatar-btn" onClick={() => fileInputRef.current?.click()}>Change photo</button>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleEditAvatarChange} />
            </div>
            <div className="pf-field">
              <label className="pf-field-label">Full name</label>
              <input className="pf-field-input" type="text" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Your name" maxLength={60} />
            </div>
            <div className="pf-field">
              <label className="pf-field-label">Username</label>
              <div className="pf-username-wrap">
                <span className="pf-username-at">@</span>
                <input className="pf-field-input pf-username-input" type="text" value={editUsername} onChange={e => setEditUsername(e.target.value.replace(/^@/, '').toLowerCase())} placeholder="yourhandle" maxLength={20} />
              </div>
              <div className="pf-field-hint">3–20 characters. Letters, numbers, underscores only.</div>
            </div>
            <div className="pf-field">
              <label className="pf-field-label">Bio</label>
              <textarea className="pf-field-textarea" value={editBio} onChange={e => setEditBio(e.target.value)} placeholder="Write a short bio…" rows={3} maxLength={240} />
            </div>
            {saveError && <div className="pf-save-error">{saveError}</div>}
            <div className="pf-modal-actions">
              <button className="pf-modal-cancel" onClick={() => setShowEdit(false)}>Cancel</button>
              <button className="pf-modal-save" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Notification panel */}
      {showLibNotifs && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }} onClick={() => setShowLibNotifs(false)} />
          <div className="lib-notif-panel">
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontFamily: 'Cochin, Georgia, serif', fontSize: '1.1rem', color: '#f5f0e8' }}>Notifications</span>
              <button onClick={() => setShowLibNotifs(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: '1.2rem' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {libNotifs.length === 0
                ? <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic' }}>No notifications yet.</div>
                : libNotifs.map(n => {
                  const postData = n.postId ? enrichedNotifs[n.postId] : null;
                  return (
                    <div
                      key={n.id}
                      className={`lib-notif-item${n.read ? '' : ' unread'}`}
                      onClick={() => { if (n.postId) window.location.href = '/square'; }}
                    >
                      {/* Actor avatar */}
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1px solid rgba(107,47,173,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#a78bfa', flexShrink: 0, fontFamily: 'Cochin, Georgia, serif' }}>
                        {(n.fromName || 'R')[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Action line */}
                        <div style={{ fontSize: '0.8rem', color: '#f0ece6', fontFamily: 'Inter, sans-serif', lineHeight: 1.45, marginBottom: postData ? '0.35rem' : '0.2rem' }}>
                          <span style={{ fontWeight: 600 }}>{n.fromName}</span>
                          <span style={{ color: 'rgba(255,255,255,0.5)' }}>{notifLabel(n)}</span>
                        </div>
                        {/* Post preview */}
                        {postData?.text && (
                          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic', lineHeight: 1.5, marginBottom: '0.25rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            "{postData.text}"
                          </div>
                        )}
                        {/* Timestamp + link */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.25)', fontFamily: 'Inter, sans-serif' }}>
                            {n.createdAt ? timeAgo(n.createdAt) : ''}
                          </span>
                          {n.postId && (
                            <span style={{ fontSize: '0.6rem', color: 'rgba(167,139,250,0.4)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.04em' }}>
                              View on The Square →
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Unread dot */}
                      {!n.read && (
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6b2fad', flexShrink: 0, marginTop: 6 }} />
                      )}
                    </div>
                  );
                })
              }
            </div>
          </div>
        </>
      )}
    </>
  );
}