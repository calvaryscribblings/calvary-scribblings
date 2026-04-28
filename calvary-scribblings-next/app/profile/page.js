'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { stories as allStories } from '../lib/stories';
import HeaderAdjuster from '../components/HeaderAdjuster';
import { BADGES, RARITY_STYLES, getStreakDisplay } from '../lib/badges';
import { checkAndAwardBadges } from '../lib/badgeEngine';

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
async function getStorageInstance() { const { getStorage } = await import('firebase/storage'); return getStorage(await getApp()); }

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
const LIKE_PATH = 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zm-7 11H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h2v11z';
const FLAME_PATH = 'M12 2c0 0-5 5-5 10a7 7 0 0 0 14 0c0-5-5-10-9-10zm0 16a3 3 0 0 1-3-3c0-2 1.5-3.5 2.5-5 1 1.5 2.5 3 2.5 5a3 3 0 0 1-2 3z';

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

function ReactionPill({ path, fill, count }) {
  if (!count) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20 }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill={fill} stroke="none" style={{ flexShrink: 0 }}><path d={path} /></svg>
      <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', lineHeight: 1 }}>{count}</span>
    </span>
  );
}

function SquarePostCard({ post, profileData, isAuthor, badge }) {
  const initials = (post.authorName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div
      onClick={() => window.location.href = `/square#${post.id}`}
      style={{ padding: '1rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.015)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1.5px solid rgba(167,139,250,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0, fontFamily: 'Cochin, Georgia, serif' }}>
          {post.authorAvatarUrl ? <img src={post.authorAvatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.84rem', color: '#ffffff', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>{post.authorName || profileData?.displayName || 'Reader'}</span>
            {post.isAuthor ? <WriterBadge size={11} /> : badge && <BadgeIcon color={badge.color} size={12} isFounder={badge.isFounder} />}
          </div>
          {profileData?.username && <div style={{ fontSize: '0.63rem', color: 'rgba(167,139,250,0.45)', fontFamily: 'Inter, sans-serif' }}>@{profileData.username}</div>}
        </div>
        <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.25)', fontFamily: 'Inter, sans-serif', flexShrink: 0 }}>{timeAgo(post.createdAt)}</div>
      </div>

      <div style={{ fontSize: '0.92rem', color: '#f0ece6', fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif', lineHeight: 1.7, marginBottom: '0.55rem', paddingLeft: '2.75rem' }}>
        {post.text}
      </div>

      {post.attachedStory && (
        <div onClick={e => { e.stopPropagation(); window.location.href = `/stories/${post.attachedStory.slug}`; }}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '2.75rem', marginBottom: '0.55rem', padding: '0.4rem 0.65rem', background: 'rgba(107,47,173,0.07)', border: '1px solid rgba(107,47,173,0.16)', borderRadius: '7px', cursor: 'pointer' }}>
          {post.attachedStory.cover && <img src={post.attachedStory.cover} alt="" style={{ width: 24, height: 34, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />}
          <span style={{ fontSize: '0.72rem', color: 'rgba(167,139,250,0.72)', fontFamily: 'Cochin, Georgia, serif' }}>{post.attachedStory.title}</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', paddingLeft: '2.75rem' }}>
        <ReactionPill path={HEART_PATH} fill="rgba(212,83,126,0.72)" count={post.likeCount || 0} />
        <ReactionPill path={LIKE_PATH} fill="rgba(217,148,26,0.72)" count={post.clapCount || 0} />
        <ReactionPill path={FLAME_PATH} fill="rgba(251,146,60,0.72)" count={post.fireCount || 0} />
        {post.parentId && <span style={{ fontSize: '0.56rem', color: 'rgba(167,139,250,0.28)', fontFamily: 'Inter, sans-serif', marginLeft: 2 }}>reply</span>}
      </div>
    </div>
  );
}

function SquarePostsModal({ uid, profileData, isAuthor, badge, onClose }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, `user_square_posts/${uid}`));
      if (snap.exists()) {
        const basePosts = Object.entries(snap.val()).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.createdAt - a.createdAt);
        const liveCounts = await Promise.all(basePosts.map(p => get(ref(db, `square_posts/${p.id}`)).then(s => ({ id: p.id, data: s.exists() ? s.val() : null }))));
        const merged = basePosts.map(p => {
          const live = liveCounts.find(l => l.id === p.id)?.data;
          return { ...p, likeCount: live?.likeCount || 0, clapCount: live?.clapCount || 0, fireCount: live?.fireCount || 0 };
        });
        setPosts(merged);
      }
      setLoading(false);
    })();
  }, [uid]);

  return (
    <div className="pf-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-modal" style={{ maxHeight: '88vh' }}>
        <div className="pf-modal-header">
          <div className="pf-modal-title">My Square Posts</div>
          <button className="pf-modal-close" onClick={onClose}>×</button>
        </div>
        {loading
          ? <div style={{ padding: '1.5rem 0', color: 'rgba(255,255,255,0.28)', fontFamily: 'Inter, sans-serif', fontSize: '0.8rem' }}>Loading…</div>
          : posts.length === 0
            ? <div style={{ padding: '1rem 0', color: 'rgba(255,255,255,0.28)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic' }}>No posts yet.</div>
            : posts.map(p => <SquarePostCard key={p.id} post={p} profileData={profileData} isAuthor={isAuthor} badge={badge} />)
        }
        {posts.length > 0 && (
          <div style={{ paddingTop: '1rem' }}>
            <a href="/square" style={{ fontSize: '0.65rem', color: 'rgba(167,139,250,0.45)', fontFamily: 'Inter, sans-serif', textDecoration: 'none' }}>Open The Square →</a>
          </div>
        )}
      </div>
    </div>
  );
}

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
    <div className="pf-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-modal">
        <div className="pf-modal-header">
          <div className="pf-modal-title">{title}</div>
          <button className="pf-modal-close" onClick={onClose}>×</button>
        </div>
        {loadingUsers
          ? <div style={{ padding: '1.5rem 0', color: 'rgba(255,255,255,0.28)', fontSize: '0.8rem', fontFamily: 'Inter, sans-serif' }}>Loading…</div>
          : users.length === 0
            ? <div style={{ padding: '1.5rem 0', color: 'rgba(255,255,255,0.28)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic' }}>No one here yet.</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {users.map(({ uid, data }) => {
                  const ini = (data.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                  const b = getBadge(data.readCount || 0, uid);
                  return (
                    <a key={uid} href={`/user?id=${uid}`} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', textDecoration: 'none', padding: '0.5rem 0.6rem', borderRadius: '10px', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1.5px solid rgba(167,139,250,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0 }}>
                        {data.avatarUrl ? <img src={data.avatarUrl} alt={ini} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : ini}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.84rem', color: '#ffffff', fontFamily: 'Inter, sans-serif', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.displayName || 'Reader'}</div>
                        {data.username && <div style={{ fontSize: '0.63rem', color: 'rgba(167,139,250,0.42)', fontFamily: 'Inter, sans-serif' }}>@{data.username}</div>}
                      </div>
                      {data.isAuthor ? <WriterBadge size={12} /> : b && <BadgeIcon color={b.color} size={13} isFounder={b.isFounder} />}
                    </a>
                  );
                })}
              </div>
        }
      </div>
    </div>
  );
}

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
      Object.entries(snap.val()).forEach(([slug, sc]) => {
        Object.entries(sc).forEach(([id, c]) => {
          if (c.authorUid === uid) all.push({ id, slug, ...c });
        });
      });
      all.sort((a, b) => b.createdAt - a.createdAt);
      setComments(all);
      setLoading(false);
    })();
  }, [uid]);

  return (
    <div className="pf-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-modal">
        <div className="pf-modal-header">
          <div className="pf-modal-title">My Comments</div>
          <button className="pf-modal-close" onClick={onClose}>×</button>
        </div>
        {loading
          ? <div style={{ color: 'rgba(255,255,255,0.28)', fontFamily: 'Inter, sans-serif', fontSize: '0.8rem', padding: '1rem 0' }}>Loading…</div>
          : comments.length === 0
            ? <div style={{ color: 'rgba(255,255,255,0.28)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic' }}>No comments yet.</div>
            : comments.map(c => {
                const story = allStoriesMerged.find(s => s.id === c.slug);
                return (
                  <a key={c.id} href={`/stories/${c.slug}`} style={{ display: 'block', textDecoration: 'none', padding: '0.85rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'opacity 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.68'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                    {story && <div style={{ fontSize: '0.6rem', color: 'rgba(155,109,255,0.48)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{story.title}</div>}
                    <div style={{ fontSize: '0.9rem', color: '#f0ece6', fontFamily: 'Cochin, Georgia, serif', lineHeight: 1.65, marginBottom: 4 }}>{c.text}</div>
                    <div style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.22)', fontFamily: 'Inter, sans-serif' }}>{timeAgo(c.createdAt)}</div>
                  </a>
                );
              })
        }
      </div>
    </div>
  );
}

function notifLabel(type) {
  switch (type) {
    case 'heart': return ' loved your comment';
    case 'fire': return ' reacted \uD83D\uDD25 to your comment';
    case 'clap': return ' liked your comment';
    case 'reply': return ' replied to your comment';
    case 'follow': return ' started following you';
    case 'new_story': return ' published a new story';
    case 'mention': return ' mentioned you in a comment';
    default: return ' interacted with you';
  }
}

function notifHref(n) {
  if (n.type === 'follow' && n.fromUid) return `/user?id=${n.fromUid}`;
  if (n.slug) return `/stories/${n.slug}`;
  return null;
}

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
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showSquarePosts, setShowSquarePosts] = useState(false);
  const [showAllStories, setShowAllStories] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAvatarFile, setEditAvatarFile] = useState(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState(null);
  const [editHeaderFile, setEditHeaderFile] = useState(null);
  const [editHeaderPreview, setEditHeaderPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showAdjuster, setShowAdjuster] = useState(false);
  const [pendingHeaderFile, setPendingHeaderFile] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [userBadges, setUserBadges] = useState({});
  const [streakData, setStreakData] = useState(null);
  const [libNotifs, setLibNotifs] = useState([]);
  const [showLibNotifs, setShowLibNotifs] = useState(false);
  const [unreadLibCount, setUnreadLibCount] = useState(0);
  const avatarInputRef = useRef(null);
  const headerInputRef = useRef(null);
  const modalAvatarInputRef = useRef(null);
  const [notifUsers, setNotifUsers] = useState({});

  useEffect(() => {
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, 'cms_stories'));
      if (snap.exists()) setCmsStories(Object.entries(snap.val()).map(([id, s]) => ({ id, title: s.title || '', cover: s.cover || '', category: s.category || '' })));
    })();
  }, []);

  useEffect(() => {
    let unsubNotifs;
    (async () => {
      try {
        const auth = await getFirebaseAuth();
        const { onAuthStateChanged } = await import('firebase/auth');
        onAuthStateChanged(auth, u => {
          if (!u) return;
          (async () => {
            const db = await getDB();
            const { ref, onValue } = await import('firebase/database');
            unsubNotifs = onValue(ref(db, `library_notifications/${u.uid}`), snap => {
              if (!snap.exists()) { setLibNotifs([]); setUnreadLibCount(0); return; }
              const items = Object.entries(snap.val()).map(([id, n]) => ({ id, ...n })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 40);
              setLibNotifs(items);
              setUnreadLibCount(items.filter(n => !n.read).length);
            });
          })();
        });
      } catch (e) {}
    })();
    return () => { if (unsubNotifs) unsubNotifs(); };
  }, []);

  useEffect(() => {
    if (!showLibNotifs || !libNotifs.length) return;
    const uids = [...new Set(libNotifs.filter(n => n.fromUid && !notifUsers[n.fromUid]).map(n => n.fromUid))];
    if (!uids.length) return;
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const results = await Promise.all(uids.map(uid => get(ref(db, `users/${uid}`)).then(s => ({ uid, data: s.exists() ? s.val() : null }))));
      const map = { ...notifUsers };
      results.forEach(({ uid, data }) => { if (data) map[uid] = data; });
      setNotifUsers(map);
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

  useEffect(() => {
    let unsubAuth = null;
    const unsubDB = [];
    (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      unsubAuth = onAuthStateChanged(auth, async u => {
        if (!u) { router.push('/'); return; }
        setAuthUser(u);
        const db = await getDB();
        const { ref, onValue, get } = await import('firebase/database');
        unsubDB.push(onValue(ref(db, `users/${u.uid}`), async snap => {
          if (snap.exists()) {
            const d = snap.val();
            setProfileData(d);
            setReadCount(d.readCount || 0);
            setReadStorySlugs(d.readStories ? Object.keys(d.readStories) : []);
            // Self-heal: ensure usernames index has an entry for this user
            if (d.username) {
              try {
                const { set } = await import('firebase/database');
                const idxSnap = await get(ref(db, `usernames/${d.username}`));
                if (!idxSnap.exists() || idxSnap.val() !== u.uid) {
                  await set(ref(db, `usernames/${d.username}`), u.uid);
                }
              } catch (e) {}
            }
          }
          setLoading(false);
        }));
        unsubDB.push(onValue(ref(db, `followers/${u.uid}`), snap => { const uids = snap.exists() ? Object.keys(snap.val()) : []; setFollowerCount(uids.length); setFollowerUids(uids); }));
        unsubDB.push(onValue(ref(db, `following/${u.uid}`), snap => { const uids = snap.exists() ? Object.keys(snap.val()) : []; setFollowingCount(uids.length); setFollowingUids(uids); }));
        unsubDB.push(onValue(ref(db, 'comments'), snap => {
          if (!snap.exists()) return;
          let count = 0;
          for (const sc of Object.values(snap.val())) for (const c of Object.values(sc)) if (c.authorUid === u.uid) count++;
          setCommentCount(count);
        }));
        try {
          const [ps, ws, badgesSnap, streakSnap] = await Promise.all([
            get(ref(db, `points/${u.uid}/total`)),
            get(ref(db, `wallet/${u.uid}/balance`)),
            get(ref(db, `userBadges/${u.uid}`)),
            get(ref(db, `userStreaks/${u.uid}`)),
          ]);
          if (ps.exists()) setPoints(ps.val());
          if (ws.exists()) setWalletBalance(ws.val());
          if (badgesSnap.exists()) setUserBadges(badgesSnap.val());
          if (streakSnap.exists()) setStreakData(streakSnap.val());
          checkAndAwardBadges(u.uid, db).then(newBadges => {
            if (newBadges.length) setUserBadges(prev => {
              const updated = { ...prev };
              newBadges.forEach(b => { updated[b.id] = { earnedAt: Date.now() }; });
              return updated;
            });
          }).catch(() => {});
        } catch (e) {}
      });
    })();
    return () => { if (unsubAuth) unsubAuth(); unsubDB.forEach(fn => fn()); };
  }, []);

  const openEdit = () => {
    setEditName(profileData?.displayName || authUser?.displayName || '');
    setEditUsername(profileData?.username || '');
    setEditBio(profileData?.bio || '');
    setEditAvatarFile(null); setEditAvatarPreview(profileData?.avatarUrl || null);
    setEditHeaderFile(null); setEditHeaderPreview(profileData?.headerUrl || null);
    setSaveError(''); setShowEdit(true);
  };

  const handleSave = async () => {
    if (!authUser) return;
    setSaving(true); setSaveError('');
    try {
      const db = await getDB();
      const { ref, update, set, remove } = await import('firebase/database');
      const storage = await getStorageInstance();
      const { ref: sRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
      let newAvatarUrl = profileData?.avatarUrl || null;
      if (editAvatarFile) { const r = sRef(storage, `avatars/${authUser.uid}`); await uploadBytes(r, editAvatarFile); newAvatarUrl = await getDownloadURL(r); }
      let newHeaderUrl = profileData?.headerUrl || null;
      if (editHeaderFile) { const r = sRef(storage, `headers/${authUser.uid}`); await uploadBytes(r, editHeaderFile); newHeaderUrl = await getDownloadURL(r); }
      const username = editUsername.trim().replace(/^@/, '').toLowerCase();
      if (username && !/^[a-z0-9_]{3,20}$/.test(username)) { setSaveError('Username must be 3-20 characters: letters, numbers, underscores only.'); setSaving(false); return; }
      const { updateProfile } = await import('firebase/auth');
      const newName = editName.trim() || authUser.displayName;
      await updateProfile(authUser, { displayName: newName });
      await update(ref(db, `users/${authUser.uid}`), { displayName: newName, bio: editBio.trim(), username: username || null, avatarUrl: newAvatarUrl, headerUrl: newHeaderUrl });
      if (username) await set(ref(db, `usernames/${username}`), authUser.uid);
      const old = profileData?.username;
      if (old && old !== username) await remove(ref(db, `usernames/${old}`));
      setShowEdit(false);
    } catch (e) { setSaveError('Something went wrong. Please try again.'); }
    setSaving(false);
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#0d0d0d' }} />;
  if (!authUser) return null;

  const avatarUrl = profileData?.avatarUrl || null;
  const headerUrl = profileData?.headerUrl || null;
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

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0d0d0d; color: #e8e0d4; font-family: Inter, sans-serif; min-height: 100vh; }

        .pf-nav { position: relative; z-index: 10; display: flex; align-items: center; justify-content: space-between; max-width: 740px; margin: 0 auto; padding: 1.1rem 1.5rem; }
        .pf-nav-logo { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1rem; font-weight: 600; color: #f5f0e8; }
        .pf-nav-logo span { color: #a78bfa; }
        .pf-nav-right { display: flex; align-items: center; gap: 1.1rem; }
        .pf-nav-back { font-size: 0.6rem; color: rgba(255,255,255,0.38); letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; transition: color 0.2s; font-family: Inter, sans-serif; }
        .pf-nav-back:hover { color: rgba(255,255,255,0.72); }

        .pf-banner { position: relative; width: 100%; height: 240px; background: linear-gradient(135deg, #120820 0%, #2d1b4e 40%, #1c1000 70%, #2a1800 100%); overflow: hidden; }
        .pf-banner-bg { position: absolute; inset: 0; background-size: cover; background-position: center; }
        .pf-banner-overlay { position: absolute; inset: 0; background: linear-gradient(to bottom, transparent 40%, rgba(13,13,13,0.6) 100%); pointer-events: none; }
        .pf-banner-edit-btn { position: absolute; bottom: 14px; right: 16px; z-index: 3; background: rgba(0,0,0,0.48); border: 1px solid rgba(255,255,255,0.16); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; backdrop-filter: blur(4px); }
        .pf-banner-edit-btn:hover { background: rgba(107,47,173,0.52); border-color: rgba(167,139,250,0.48); }

        .pf-identity-wrap { max-width: 740px; margin: 0 auto; padding: 0 1.5rem; }

        .pf-avatar-wrap { position: relative; width: 108px; height: 108px; margin-top: -54px; flex-shrink: 0; z-index: 2; cursor: pointer; margin-bottom: 0.7rem; }
        .pf-avatar { width: 108px; height: 108px; border-radius: 50%; background: rgba(107,47,173,0.22); border: 3px solid #0d0d0d; display: flex; align-items: center; justify-content: center; font-size: 36px; color: #c4b5fd; overflow: hidden; font-family: Cochin, Georgia, serif; box-shadow: 0 0 0 1.5px rgba(167,139,250,0.18); }
        .pf-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .pf-avatar-overlay { position: absolute; inset: 0; border-radius: 50%; background: rgba(0,0,0,0.42); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; }
        .pf-avatar-wrap:hover .pf-avatar-overlay { opacity: 1; }

        .pf-name { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: clamp(1.7rem, 4.5vw, 2.2rem); font-weight: 400; color: #ffffff; line-height: 1.05; margin-bottom: 0.15rem; letter-spacing: -0.01em; }
        .pf-username { font-size: 0.77rem; color: rgba(167,139,250,0.52); font-family: Inter, sans-serif; margin-bottom: 0.42rem; }
        .pf-badge-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 0.28rem; }
        .pf-badge-label { font-size: 0.58rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-family: Inter, sans-serif; }
        .pf-verified-row { margin-bottom: 0.5rem; }
        .pf-verified { display: inline-flex; align-items: center; gap: 3px; font-size: 0.57rem; color: #1d9e75; font-family: Inter, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pf-unverified { font-size: 0.57rem; color: rgba(255,255,255,0.22); font-family: Inter, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pf-joined { font-size: 0.62rem; color: rgba(255,255,255,0.22); font-family: Inter, sans-serif; margin-bottom: 0.65rem; }
        .pf-follow-row { display: flex; gap: 1.5rem; margin-bottom: 1.5rem; }
        .pf-follow-stat { display: flex; align-items: baseline; gap: 5px; cursor: pointer; }
        .pf-follow-stat:hover .pf-follow-num { color: #a78bfa; }
        .pf-follow-num { font-family: Cochin, Georgia, serif; font-size: 1.1rem; color: #f5f0e8; line-height: 1; transition: color 0.2s; }
        .pf-follow-label { font-size: 0.55rem; color: rgba(255,255,255,0.28); letter-spacing: 0.1em; text-transform: uppercase; font-family: Inter, sans-serif; }

        .pf-body { max-width: 740px; margin: 0 auto; padding: 0 1.5rem 6rem; }
        .pf-bio-wrap { padding: 1rem 0 1.35rem; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 1.75rem; }
        .pf-bio-text { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.02rem; color: rgba(240,236,230,0.8); line-height: 1.8; }
        .pf-bio-empty { font-size: 0.78rem; color: rgba(255,255,255,0.2); font-family: Inter, sans-serif; cursor: pointer; }
        .pf-bio-empty:hover { color: rgba(255,255,255,0.42); }

        .pf-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; margin-bottom: 2rem; overflow: hidden; }
        .pf-stat { background: rgba(255,255,255,0.02); padding: 1.5rem 1rem; text-align: center; transition: background 0.2s; }
        .pf-stat:hover { background: rgba(255,255,255,0.04); }
        .pf-stat-num { font-family: Cochin, Georgia, serif; font-size: 2.2rem; color: #f5f0e8; line-height: 1; margin-bottom: 0.38rem; }
        .pf-stat-label { font-size: 0.52rem; color: rgba(255,255,255,0.28); letter-spacing: 0.15em; text-transform: uppercase; font-family: Inter, sans-serif; }

        .pf-section { margin-bottom: 2.2rem; }
        .pf-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; padding-bottom: 0.68rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .pf-section-title { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.18rem; color: #f5f0e8; }
        .pf-section-meta { font-size: 0.54rem; color: rgba(255,255,255,0.26); letter-spacing: 0.12em; text-transform: uppercase; font-family: Inter, sans-serif; }

        .pf-story-row { display: flex; align-items: center; gap: 12px; padding: 0.68rem 0; border-bottom: 1px solid rgba(255,255,255,0.04); text-decoration: none; transition: opacity 0.2s; }
        .pf-story-row:hover { opacity: 0.68; }
        .pf-story-thumb { width: 34px; height: 48px; border-radius: 3px; overflow: hidden; flex-shrink: 0; background: rgba(107,47,173,0.15); }
        .pf-story-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .pf-story-title { font-family: Cochin, Georgia, serif; font-size: 0.87rem; color: #f5f0e8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pf-story-author { font-size: 0.62rem; color: rgba(255,255,255,0.28); font-family: Inter, sans-serif; margin-top: 2px; }
        .pf-more-btn { background: none; border: none; font-size: 0.67rem; color: rgba(155,109,255,0.42); font-family: Inter, sans-serif; cursor: pointer; padding: 0.6rem 0 0; letter-spacing: 0.06em; text-decoration: underline; text-underline-offset: 3px; }
        .pf-more-btn:hover { color: #a78bfa; }

        .pf-square-trigger { display: flex; align-items: center; justify-content: space-between; width: 100%; background: rgba(107,47,173,0.05); border: 1px solid rgba(107,47,173,0.14); border-radius: 12px; padding: 1rem 1.2rem; cursor: pointer; text-align: left; transition: all 0.2s; }
        .pf-square-trigger:hover { background: rgba(107,47,173,0.1); border-color: rgba(107,47,173,0.28); }

        .pf-badge-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 14px; padding: 1.2rem; }
        .pf-progress-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.78rem; }
        .pf-progress-current { font-size: 0.72rem; color: rgba(255,255,255,0.52); font-family: Inter, sans-serif; }
        .pf-progress-next { font-size: 0.58rem; color: rgba(255,255,255,0.26); font-family: Inter, sans-serif; }
        .pf-progress-bar-wrap { height: 2px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
        .pf-progress-bar { height: 100%; border-radius: 2px; transition: width 0.8s cubic-bezier(0.22,1,0.36,1); }

        .pf-badge-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.75rem; }
        @media (max-width: 520px) { .pf-badge-grid { grid-template-columns: repeat(3, 1fr); } }

        .pf-rewards-btn { display: block; width: 100%; text-decoration: none; position: relative; overflow: hidden; background: linear-gradient(135deg, #1a0a2e 0%, #0d1a12 50%, #1a0a2e 100%); border: 1px solid rgba(107,47,173,0.2); border-radius: 18px; padding: 1.7rem; transition: transform 0.3s, box-shadow 0.3s, border-color 0.3s; }
        .pf-rewards-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 35px rgba(107,47,173,0.16); border-color: rgba(107,47,173,0.4); }
        .pf-rewards-shimmer { position: absolute; top: 0; left: -100%; width: 60%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.022), transparent); animation: shimmer 3s infinite; }
        @keyframes shimmer { 0% { left: -100%; } 100% { left: 200%; } }
        .pf-rewards-inner { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; }

        .pf-account-row { display: flex; align-items: center; justify-content: space-between; padding: 0.88rem 1.1rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; margin-bottom: 0.38rem; }
        .pf-account-label { font-size: 0.78rem; color: rgba(255,255,255,0.3); font-family: Inter, sans-serif; }

        .lib-notif-panel { position: fixed; top: 0; right: 0; width: min(400px,100vw); height: 100vh; background: #0c0c0c; border-left: 1px solid rgba(255,255,255,0.07); z-index: 2000; display: flex; flex-direction: column; }
        .lib-notif-item { padding: 0.95rem 1.2rem; border-bottom: 1px solid rgba(255,255,255,0.04); display: flex; gap: 10px; align-items: flex-start; text-decoration: none; transition: background 0.15s; }
        .lib-notif-item:hover { background: rgba(255,255,255,0.022); }
        .lib-notif-item.unread { background: rgba(107,47,173,0.055); }

        .pf-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.82); z-index: 1000; display: flex; align-items: flex-end; justify-content: center; }
        @media (min-width: 600px) { .pf-modal-backdrop { align-items: center; } }
        .pf-modal { background: #111; border: 1px solid rgba(255,255,255,0.08); border-radius: 20px 20px 0 0; width: 100%; max-width: 520px; padding: 2rem 1.5rem 2.5rem; max-height: 92vh; overflow-y: auto; }
        @media (min-width: 600px) { .pf-modal { border-radius: 20px; } }
        .pf-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
        .pf-modal-title { font-family: Cochin, Georgia, serif; font-size: 1.3rem; color: #f5f0e8; }
        .pf-modal-close { background: none; border: none; color: rgba(255,255,255,0.32); font-size: 1.4rem; cursor: pointer; padding: 0; line-height: 1; transition: color 0.2s; }
        .pf-modal-close:hover { color: rgba(255,255,255,0.72); }
        .pf-field { margin-bottom: 0.95rem; }
        .pf-field-label { font-size: 0.57rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.32); font-family: Inter, sans-serif; margin-bottom: 0.3rem; display: block; }
        .pf-field-input { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; padding: 0.72rem 1rem; font-size: 0.9rem; color: #e8e0d4; font-family: Inter, sans-serif; outline: none; transition: border-color 0.2s; }
        .pf-field-input:focus { border-color: rgba(167,139,250,0.35); }
        .pf-field-textarea { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; padding: 0.72rem 1rem; font-size: 0.95rem; color: rgba(232,224,212,0.75); font-family: Cochin, Georgia, serif; font-style: italic; outline: none; resize: none; line-height: 1.75; transition: border-color 0.2s; }
        .pf-field-textarea:focus { border-color: rgba(167,139,250,0.35); }
        .pf-field-hint { font-size: 0.57rem; color: rgba(255,255,255,0.2); font-family: Inter, sans-serif; margin-top: 0.2rem; }
        .pf-username-wrap { position: relative; }
        .pf-username-at { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: rgba(167,139,250,0.35); font-size: 0.9rem; pointer-events: none; }
        .pf-username-input { padding-left: 1.75rem !important; }
        .pf-save-error { font-size: 0.66rem; color: #f87171; font-family: Inter, sans-serif; margin-bottom: 0.6rem; }
        .pf-modal-actions { display: flex; gap: 0.6rem; margin-top: 1.5rem; }
        .pf-modal-save { flex: 1; background: #7c3aed; border: none; border-radius: 9px; padding: 0.78rem; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; cursor: pointer; font-family: Inter, sans-serif; transition: background 0.2s; }
        .pf-modal-save:hover { background: #6d28d9; }
        .pf-modal-save:disabled { opacity: 0.4; cursor: not-allowed; }
        .pf-modal-cancel { background: none; border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; padding: 0.78rem 1.1rem; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.32); cursor: pointer; font-family: Inter, sans-serif; }

        @media (max-width: 520px) {
          .pf-banner { height: 190px; }
          .pf-avatar-wrap { width: 88px; height: 88px; margin-top: -44px; }
          .pf-avatar { width: 88px; height: 88px; font-size: 28px; }
          .pf-name { font-size: 1.62rem; }
          .pf-bio-text { font-size: 0.94rem; }
        }
      `}</style>

      {/* Hidden inputs */}
      <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (!f) return; setEditAvatarFile(f); setEditAvatarPreview(URL.createObjectURL(f)); if (!showEdit) openEdit(); }} />
      <input ref={headerInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (!f) return; setPendingHeaderFile(f); setShowAdjuster(true); if (!showEdit) openEdit(); e.target.value = ''; }} />

      {/* Nav */}
      <nav className="pf-nav">
        <div className="pf-nav-logo">Calvary <span>Scribblings</span></div>
        <div className="pf-nav-right">
          <button onClick={() => { setShowLibNotifs(true); markLibNotifsRead(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.42)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unreadLibCount > 0 && (
              <span style={{ position: 'absolute', top: -3, right: -3, background: '#6b2fad', color: '#fff', fontSize: '0.45rem', fontWeight: 700, borderRadius: '999px', minWidth: 13, height: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px', fontFamily: 'Inter,sans-serif' }}>
                {unreadLibCount > 9 ? '9+' : unreadLibCount}
              </span>
            )}
          </button>
          <a href="/" className="pf-nav-back">← Back to stories</a>
        </div>
      </nav>

      {/* Banner — full width */}
      <div className="pf-banner">
        {headerUrl && <div className="pf-banner-bg" style={{ backgroundImage: `url(${headerUrl})` }} />}
        <div className="pf-banner-overlay" />
        <button className="pf-banner-edit-btn" onClick={openEdit} title="Edit profile">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>

      {/* Identity */}
      <div className="pf-identity-wrap">
        {/* Tappable avatar */}
        <div className="pf-avatar-wrap" onClick={() => avatarInputRef.current?.click()} title="Change photo">
          <div className="pf-avatar">{avatarUrl ? <img src={avatarUrl} alt={initials} /> : initials}</div>
          <div className="pf-avatar-overlay">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.88)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div className="pf-name">{displayName}</div>
          {(() => {
            const streak = getStreakDisplay(streakData);
            if (!streak || streak.n === 0) return null;
            return (
              <span style={{ fontSize: '0.78rem', fontFamily: 'Inter, sans-serif', color: streak.warning ? '#fbbf24' : 'rgba(255,255,255,0.4)', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                {streak.icon} {streak.n}d
              </span>
            );
          })()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.42rem' }}>
          {username && <span className="pf-username" style={{ marginBottom: 0 }}>@{username}</span>}
          {isAuthor ? <WriterBadge size={13} /> : badge ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <BadgeIcon color={badge.color} size={13} isFounder={badge.isFounder} />
              <span className="pf-badge-label" style={{ color: badge.color }}>{badge.label}</span>
            </span>
          ) : null}
        </div>
        <div className="pf-verified-row">
          {authUser.emailVerified
            ? <span className="pf-verified"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#1d9e75" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Verified</span>
            : <span className="pf-unverified">Unverified</span>}
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
        <div className="pf-bio-wrap">
          {bio ? <span className="pf-bio-text">{bio}</span> : <span className="pf-bio-empty" onClick={openEdit}>+ Add a bio</span>}
        </div>

        <div className="pf-stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="pf-stat">
            <div className="pf-stat-num">{readCount.toLocaleString()}</div>
            <div className="pf-stat-label">Stories read</div>
          </div>
          <div className="pf-stat" onClick={() => setShowComments(true)} style={{ cursor: 'pointer' }}>
            <div className="pf-stat-num">{commentCount}</div>
            <div className="pf-stat-label">Comments ↗</div>
          </div>
        </div>

        <div className="pf-section">
          <div className="pf-section-header"><div className="pf-section-title">The Scribblings Square</div></div>
          <button className="pf-square-trigger" onClick={() => setShowSquarePosts(true)}>
            <div>
              <div style={{ fontFamily: 'Cochin, Georgia, serif', fontSize: '0.98rem', color: '#f5f0e8', marginBottom: 2 }}>My posts on The Square</div>
              <div style={{ fontSize: '0.63rem', color: 'rgba(155,109,255,0.42)', fontFamily: 'Inter, sans-serif' }}>View your contributions</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(155,109,255,0.32)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>

        {readStories.length > 0 && (
          <div className="pf-section">
            <div className="pf-section-header">
              <div className="pf-section-title">Stories read</div>
              <div className="pf-section-meta">{readStories.length} total</div>
            </div>
            <div>
              {visibleStories.map(s => (
                <a key={s.id} href={`/stories/${s.id}`} className="pf-story-row">
                  <div className="pf-story-thumb">{s.cover && <img src={s.cover} alt={s.title} loading="lazy" />}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="pf-story-title">{s.title}</div>
                    <div className="pf-story-author">by {s.author}</div>
                  </div>
                </a>
              ))}
            </div>
            {readStories.length > 10 && !showAllStories && (
              <button className="pf-more-btn" onClick={() => setShowAllStories(true)}>Show {readStories.length - 10} more</button>
            )}
          </div>
        )}

        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">Reading badge</div>
            <div className="pf-section-meta">{isAuthor ? 'Writer' : badge ? badge.label : 'No badge yet'}</div>
          </div>
          <div className="pf-badge-card">
            <div className="pf-progress-row">
              <div className="pf-progress-current">{readCount.toLocaleString()} {readCount === 1 ? 'story' : 'stories'} read</div>
              <div className="pf-progress-next">{isAuthor ? 'Platform writer' : nextBadge ? `${nextBadge.label} at ${nextBadge.threshold}` : badge ? 'Max tier reached' : 'Reader at 25'}</div>
            </div>
            <div className="pf-progress-bar-wrap">
              <div className="pf-progress-bar" style={{ width: isAuthor ? '100%' : `${tierProgress}%`, background: isAuthor ? '#581c87' : badge ? badge.color : '#333' }} />
            </div>
          </div>
        </div>

        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">Honour Badges</div>
            <div className="pf-section-meta">{Object.keys(userBadges).length}/{BADGES.length} earned</div>
          </div>
          <div className="pf-badge-grid">
            {BADGES.map(badge => {
              const earned = !!userBadges[badge.id];
              return (
                <div key={badge.id} style={{
                  borderRadius: 10, padding: '0.6rem', textAlign: 'center',
                  opacity: earned ? 1 : 0.25,
                  ...(earned ? RARITY_STYLES[badge.rarity] : { border: '1px solid rgba(255,255,255,0.08)', background: 'transparent' }),
                }}>
                  <div style={{ fontSize: '1.2rem', marginBottom: '0.3rem' }}>{badge.icon}</div>
                  <div style={{ fontSize: '0.6rem', fontFamily: 'Cochin, Georgia, serif', color: '#f5f0e8', marginBottom: '0.15rem' }}>{badge.name}</div>
                  <div style={{ fontSize: '0.52rem', fontFamily: 'Inter, sans-serif', color: 'rgba(255,255,255,0.35)', lineHeight: 1.35 }}>{badge.description}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pf-section">
          <div className="pf-section-header"><div className="pf-section-title">Reader's Reward</div></div>
          <a href="/rewards" className="pf-rewards-btn">
            <div className="pf-rewards-shimmer" />
            <div className="pf-rewards-inner">
              <div>
                <div style={{ fontSize: '0.51rem', color: 'rgba(155,109,255,0.48)', letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginBottom: '0.28rem' }}>The Story Island</div>
                <div style={{ fontFamily: 'Cochin, Georgia, serif', fontSize: '1.48rem', color: '#f5f0e8', lineHeight: 1.1 }}>Your Rewards</div>
                <div style={{ fontSize: '0.63rem', color: 'rgba(232,224,212,0.26)', fontFamily: 'Inter, sans-serif', marginTop: '0.16rem' }}>Read · Comment · Quiz · Earn</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <div style={{ fontFamily: 'Cochin, Georgia, serif', fontSize: '2.5rem', color: '#9b6dff', lineHeight: 1 }}>{points}</div>
                <div style={{ fontSize: '0.49rem', color: 'rgba(155,109,255,0.36)', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginTop: 2 }}>Scribbles</div>
                <div style={{ fontSize: '0.92rem', color: 'rgba(167,139,250,0.26)', marginTop: '0.42rem' }}>→</div>
              </div>
            </div>
          </a>
        </div>

        <div className="pf-section">
          <div className="pf-section-header"><div className="pf-section-title">Account</div></div>
          <a href="/settings" className="pf-account-row" style={{ textDecoration: 'none', cursor: 'pointer', transition: 'background 0.2s, border-color 0.2s' }}>
            <span className="pf-account-label">Account settings</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.57rem', color: '#9b6dff', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif' }}>
              Manage
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9b6dff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </span>
          </a>
        </div>
      </div>

      {/* Modals */}
      {showFollowers && <UserListModal title={`Followers · ${followerCount}`} uids={followerUids} onClose={() => setShowFollowers(false)} />}
      {showFollowing && <UserListModal title={`Following · ${followingCount}`} uids={followingUids} onClose={() => setShowFollowing(false)} />}
      {showComments && <CommentHistoryModal uid={authUser.uid} onClose={() => setShowComments(false)} allStoriesMerged={allStoriesMerged} />}
      {showSquarePosts && <SquarePostsModal uid={authUser.uid} profileData={profileData} isAuthor={isAuthor} badge={badge} onClose={() => setShowSquarePosts(false)} />}

      {/* Edit modal */}
      {showEdit && (
        <div className="pf-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowEdit(false); }}>
          <div className="pf-modal">
            <div className="pf-modal-header">
              <div className="pf-modal-title">Edit profile</div>
              <button className="pf-modal-close" onClick={() => setShowEdit(false)}>×</button>
            </div>

            {/* Header upload */}
            <div className="pf-field">
              <label className="pf-field-label">Cover photo</label>
              <div
                onClick={() => headerInputRef.current?.click()}
                style={{ position: 'relative', width: '100%', height: 88, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', background: editHeaderPreview ? 'transparent' : 'rgba(255,255,255,0.025)', border: '1px dashed rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'border-color 0.2s' }}
              >
                {editHeaderPreview
                  ? <img src={editHeaderPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.22)', fontFamily: 'Inter, sans-serif' }}>Click to upload cover photo</span>}
              </div>
            </div>

            {/* Avatar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.1rem' }}>
              <div style={{ width: 58, height: 58, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '2px solid rgba(167,139,250,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0, fontFamily: 'Cochin, Georgia, serif', cursor: 'pointer' }}
                onClick={() => modalAvatarInputRef.current?.click()}>
                {editAvatarPreview ? <img src={editAvatarPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
                <input ref={modalAvatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files[0]; if (!f) return; setEditAvatarFile(f); setEditAvatarPreview(URL.createObjectURL(f)); }} />
              </div>
              <span style={{ fontSize: '0.6rem', color: 'rgba(167,139,250,0.45)', fontFamily: 'Inter, sans-serif' }}>Tap photo to change</span>
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
              <div className="pf-field-hint">3-20 characters. Letters, numbers, underscores only.</div>
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
            <div style={{ padding: '1.2rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontFamily: 'Cochin, Georgia, serif', fontSize: '1.08rem', color: '#f5f0e8' }}>Notifications</span>
              <button onClick={() => setShowLibNotifs(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.26)', fontSize: '1.2rem' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {libNotifs.length === 0
                ? <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic' }}>No notifications yet.</div>
                : libNotifs.map(n => {
                  const href = notifHref(n);
                  const isReward = n.type === 'reward';
                  return (
                    <a
                      key={n.id}
                      href={href || '#'}
                      className={`lib-notif-item${n.read ? '' : ' unread'}`}
                      onClick={!href ? e => e.preventDefault() : undefined}
                    >
                      {(() => {
                        const actor = n.fromUid ? notifUsers[n.fromUid] : null;
                        const ini = (n.fromName || 'C').split(' ').map(x => x[0]).join('').slice(0,2).toUpperCase();
                        return (
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(107,47,173,0.17)', border: '1px solid rgba(107,47,173,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#a78bfa', flexShrink: 0, fontFamily: 'Cochin, Georgia, serif', overflow: 'hidden' }}>
                            {(actor?.avatarUrl || n.fromAvatarUrl) ? <img src={actor?.avatarUrl || n.fromAvatarUrl} alt={ini} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : ini}
                          </div>
                        );
                      })()}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 2 }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#ffffff', fontFamily: 'Inter, sans-serif' }}>{n.fromName}</span>
                          {(() => {
                            const actor = n.fromUid ? notifUsers[n.fromUid] : null;
                            if (!actor) return null;
                            if (actor.isAuthor) return <WriterBadge size={11} />;
                            const b = getBadge(actor.readCount || 0, n.fromUid);
                            return b ? <BadgeIcon color={b.color} size={12} isFounder={b.isFounder} /> : null;
                          })()}
                        </div>
                        {(notifUsers[n.fromUid]?.username || n.fromUsername) && (
                          <div style={{ fontSize: '0.6rem', color: 'rgba(167,139,250,0.42)', fontFamily: 'Inter, sans-serif', marginBottom: 3 }}>
                            @{notifUsers[n.fromUid]?.username || n.fromUsername}
                          </div>
                        )}
                        <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.48)', fontFamily: 'Inter, sans-serif', lineHeight: 1.4, marginBottom: '0.18rem' }}>
                          {isReward
                            ? <span>{n.message || 'You earned Scribbles!'}</span>
                            : <span>{notifLabel(n.type)}</span>}
                        </div>
                        {n.commentText && (
                          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.28)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic', lineHeight: 1.48, marginBottom: '0.2rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            "{n.commentText}"
                          </div>
                        )}
                        {n.slug && !isReward && n.type !== 'follow' && (
                          <div style={{ fontSize: '0.56rem', color: 'rgba(155,109,255,0.42)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.16rem' }}>
                            {allStoriesMerged.find(s => s.id === n.slug)?.title || n.slug}
                          </div>
                        )}
                        <div style={{ fontSize: '0.56rem', color: 'rgba(255,255,255,0.18)', fontFamily: 'Inter, sans-serif' }}>
                          {n.createdAt ? timeAgo(n.createdAt) : ''}
                        </div>
                      </div>
                      {!n.read && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6b2fad', flexShrink: 0, marginTop: 5 }} />}
                    </a>
                  );
                })
              }
            </div>
          </div>
        </>
      )}
    {showAdjuster && pendingHeaderFile && (
        <HeaderAdjuster
          file={pendingHeaderFile}
          onCancel={() => { setShowAdjuster(false); setPendingHeaderFile(null); }}
          onDone={(blob, dataUrl) => {
            const croppedFile = new File([blob], 'header.jpg', { type: 'image/jpeg' });
            setEditHeaderFile(croppedFile);
            setEditHeaderPreview(dataUrl);
            setShowAdjuster(false);
            setPendingHeaderFile(null);
          }}
        />
      )}
    </>
  );
}
