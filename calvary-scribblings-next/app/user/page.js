'use client';

import { useEffect, useState } from 'react';
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
async function getAuthInstance() { const { getAuth } = await import('firebase/auth'); return getAuth(await getApp()); }

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

const BADGE_PATH = 'M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C1.87 9.33 1 10.57 1 12s.87 2.67 2.19 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91C21.37 14.67 22.25 13.43 22.25 12z';
const CHECK_PATH = 'M9.13 17.75L5.5 14.12l1.41-1.41 2.22 2.22 6.34-7.59 1.53 1.28z';
const HEART_PATH = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';

function BadgeIcon({ color, size = 14, isFounder = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="upPlat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8f0f8" /><stop offset="50%" stopColor="#c8daea" /><stop offset="100%" stopColor="#a8c0d6" />
        </linearGradient>
      </defs>
      <path fill={isFounder ? 'url(#upPlat)' : color} d={BADGE_PATH} />
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

function formatJoinDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/* ── Square Post Card ─────────────────────────────────────────────────── */
function SquarePostCard({ post, profileData, isAuthor, badge }) {
  const initials = (post.authorName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{ padding: '1.1rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.6rem' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1.5px solid rgba(167,139,250,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0, fontFamily: 'Cochin, Georgia, serif' }}>
          {post.authorAvatarUrl
            ? <img src={post.authorAvatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.85rem', color: '#ffffff', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
              {post.authorName || profileData?.displayName || 'Reader'}
            </span>
            {isAuthor ? <WriterBadge size={12} /> : badge && (
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

      <div style={{ fontSize: '0.93rem', color: '#f0ece6', fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif', lineHeight: 1.72, marginBottom: '0.6rem', paddingLeft: '2.85rem' }}>
        {post.text}
      </div>

      {post.attachedStory && (
        <a href={`/stories/${post.attachedStory.slug}`} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '2.85rem', marginBottom: '0.6rem', padding: '0.5rem 0.75rem', background: 'rgba(107,47,173,0.08)', border: '1px solid rgba(107,47,173,0.2)', borderRadius: '8px', textDecoration: 'none' }}>
          {post.attachedStory.cover && (
            <img src={post.attachedStory.cover} alt="" style={{ width: 28, height: 40, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
          )}
          <span style={{ fontSize: '0.75rem', color: 'rgba(167,139,250,0.8)', fontFamily: 'Cochin, Georgia, serif' }}>
            {post.attachedStory.title}
          </span>
        </a>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingLeft: '2.85rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(212,83,126,0.45)" stroke="none">
            <path d={HEART_PATH} />
          </svg>
          <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif' }}>
            {post.likeCount || 0}
          </span>
        </span>
        {post.parentId && (
          <span style={{ fontSize: '0.62rem', color: 'rgba(167,139,250,0.3)', fontFamily: 'Inter, sans-serif' }}>reply</span>
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 520, padding: '2rem 1.5rem 2.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
          <div style={{ fontFamily: 'Cochin, Georgia, serif', fontSize: '1.35rem', fontWeight: 400, color: '#f5f0e8' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
        </div>
        {loadingUsers ? (
          <div style={{ padding: '1.5rem 0', color: 'rgba(255,255,255,0.4)', fontSize: '0.82rem', fontFamily: 'Inter, sans-serif' }}>Loading…</div>
        ) : users.length === 0 ? (
          <div style={{ padding: '1.5rem 0', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic' }}>No one here yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {users.map(({ uid, data }) => {
              const ini = (data.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
              const b = getBadge(data.readCount || 0, uid);
              return (
                <a key={uid} href={`/user?id=${uid}`} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', textDecoration: 'none', padding: '0.55rem 0.65rem', borderRadius: '10px', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1.5px solid rgba(167,139,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0 }}>
                    {data.avatarUrl ? <img src={data.avatarUrl} alt={ini} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : ini}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', color: '#ffffff', fontFamily: 'Inter, sans-serif', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.displayName || 'Reader'}</div>
                    {data.username && <div style={{ fontSize: '0.68rem', color: 'rgba(167,139,250,0.5)', fontFamily: 'Inter, sans-serif' }}>@{data.username}</div>}
                  </div>
                  {data.isAuthor ? <WriterBadge size={12} /> : b && <BadgeIcon color={b.color} size={13} isFounder={b.isFounder} />}
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
function CommentHistoryModal({ uid, displayName, onClose, allStoriesMerged }) {
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 520, padding: '2rem 1.5rem 2.5rem', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div style={{ fontFamily: 'Cochin, Georgia, serif', fontSize: '1.3rem', fontWeight: 400, color: '#f5f0e8' }}>Comments by {displayName}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
        </div>
        {loading ? (
          <div style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', padding: '1rem 0' }}>Loading…</div>
        ) : comments.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic', fontSize: '0.9rem' }}>No comments yet.</div>
        ) : comments.map(c => {
          const story = allStoriesMerged.find(s => s.id === c.slug);
          return (
            <a key={c.id} href={`/stories/${c.slug}`} style={{ display: 'block', textDecoration: 'none', padding: '0.85rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'opacity 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.72'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              {story && (
                <div style={{ fontSize: '0.65rem', color: 'rgba(155,109,255,0.5)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
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

/* ── Main User Page ───────────────────────────────────────────────────── */
export default function UserPage() {
  const [uid, setUid] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [readCount, setReadCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followerUids, setFollowerUids] = useState([]);
  const [followingUids, setFollowingUids] = useState([]);
  const [readStorySlugs, setReadStorySlugs] = useState([]);
  const [cmsStories, setCmsStories] = useState([]);
  const [squarePosts, setSquarePosts] = useState([]);
  const [squareLoading, setSquareLoading] = useState(true);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followsYou, setFollowsYou] = useState(false);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showAllStories, setShowAllStories] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) setUid(id);
    else setLoading(false);
  }, []);

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

  useEffect(() => {
    if (!uid) return;
    (async () => {
      const auth = await getAuthInstance();
      const db = await getDB();
      const { onAuthStateChanged } = await import('firebase/auth');
      const { ref, get } = await import('firebase/database');

      onAuthStateChanged(auth, async (u) => {
        setCurrentUser(u);
        if (u && u.uid === uid) { window.location.href = '/profile'; return; }
        try {
          const fetches = [
            get(ref(db, `users/${uid}`)),
            get(ref(db, 'comments')),
            get(ref(db, `followers/${uid}`)),
            get(ref(db, `following/${uid}`)),
            get(ref(db, `user_square_posts/${uid}`)),
          ];
          if (u) {
            fetches.push(get(ref(db, `followers/${uid}/${u.uid}`)));
            fetches.push(get(ref(db, `followers/${u.uid}/${uid}`)));
          }
          const results = await Promise.all(fetches);
          const [userSnap, commentsSnap, followersSnap, followingSnap, sqSnap] = results;

          if (userSnap.exists()) {
            const d = userSnap.val();
            setProfileData(d);
            setReadCount(d.readCount || 0);
            if (d.readStories) setReadStorySlugs(Object.keys(d.readStories));
          }
          if (commentsSnap.exists()) {
            let count = 0;
            for (const sc of Object.values(commentsSnap.val()))
              for (const c of Object.values(sc))
                if (c.authorUid === uid) count++;
            setCommentCount(count);
          }
          const followerUidList = followersSnap.exists() ? Object.keys(followersSnap.val()) : [];
          setFollowerCount(followerUidList.length); setFollowerUids(followerUidList);
          const followingUidList = followingSnap.exists() ? Object.keys(followingSnap.val()) : [];
          setFollowingCount(followingUidList.length); setFollowingUids(followingUidList);

          if (sqSnap.exists()) {
            const list = Object.entries(sqSnap.val())
              .map(([id, p]) => ({ id, ...p }))
              .sort((a, b) => b.createdAt - a.createdAt);
            setSquarePosts(list);
          }
          setSquareLoading(false);

          if (u) {
            setIsFollowing(results[5]?.exists() || false);
            setFollowsYou(results[6]?.exists() || false);
          }
        } catch (e) { console.error('User profile error:', e); }
        setLoading(false);
      });
    })();
  }, [uid]);

  const handleFollow = async () => {
    if (!currentUser || followLoading) return;
    setFollowLoading(true);
    try {
      const db = await getDB();
      const { ref, set, remove, push } = await import('firebase/database');
      if (isFollowing) {
        await Promise.all([
          remove(ref(db, `followers/${uid}/${currentUser.uid}`)),
          remove(ref(db, `following/${currentUser.uid}/${uid}`)),
        ]);
        setIsFollowing(false); setFollowerCount(c => Math.max(0, c - 1));
      } else {
        await Promise.all([
          set(ref(db, `followers/${uid}/${currentUser.uid}`), true),
          set(ref(db, `following/${currentUser.uid}/${uid}`), true),
        ]);
        setIsFollowing(true); setFollowerCount(c => c + 1);
        await push(ref(db, `library_notifications/${uid}`), {
          type: 'follow', fromUid: currentUser.uid,
          fromName: currentUser.displayName || 'Reader',
          read: false, createdAt: Date.now(),
        });
      }
    } catch (e) { console.error('Follow error:', e); }
    setFollowLoading(false);
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#0d0d0d' }} />;
  if (!uid || !profileData) return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', fontSize: '0.85rem' }}>User not found.</p>
    </div>
  );

  const isAuthor = profileData.isAuthor || false;
  const badge = getBadge(readCount, uid);
  const initials = (profileData.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const joinDate = profileData.joinDate ? formatJoinDate(profileData.joinDate) : null;
  const allStoriesMerged = [...allStories, ...cmsStories.filter(cs => !allStories.find(s => s.id === cs.id))];
  const readStories = readStorySlugs.map(slug => allStoriesMerged.find(s => s.id === slug)).filter(Boolean);
  const visibleStories = showAllStories ? readStories : readStories.slice(0, 10);
  const visiblePosts = showAllPosts ? squarePosts : squarePosts.slice(0, 5);
  const firstName = profileData.displayName?.split(' ')[0] || 'Reader';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0d0d0d; color: #e8e0d4; font-family: Inter, sans-serif; min-height: 100vh; }

        .up-nav { position: relative; z-index: 10; display: flex; align-items: center; justify-content: space-between; max-width: 680px; margin: 0 auto; padding: 1.1rem 1.5rem; }
        .up-nav-logo { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1rem; font-weight: 600; color: #f5f0e8; letter-spacing: 0.01em; }
        .up-nav-logo span { color: #a78bfa; }
        .up-nav-back { font-size: 0.6rem; color: rgba(255,255,255,0.4); letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; transition: color 0.2s; font-family: Inter, sans-serif; }
        .up-nav-back:hover { color: rgba(255,255,255,0.75); }

        .up-banner { position: relative; width: 100%; height: 168px; background: linear-gradient(120deg, #0e1a0a 0%, #1a2e10 35%, #1a0a2e 65%, #2d1b4e 100%); overflow: hidden; }
        .up-banner::after { content: ''; position: absolute; inset: 0; background: linear-gradient(120deg, rgba(29,158,117,0.15) 0%, transparent 45%, rgba(107,47,173,0.2) 100%); pointer-events: none; }

        .up-follow-btn-banner { position: absolute; bottom: 12px; right: 14px; z-index: 2; background: rgba(124,58,237,0.85); border: 1px solid rgba(167,139,250,0.3); border-radius: 8px; padding: 7px 18px; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; cursor: pointer; font-family: Inter, sans-serif; transition: all 0.2s; }
        .up-follow-btn-banner:hover { background: rgba(109,40,217,0.95); }
        .up-follow-btn-banner.following { background: rgba(0,0,0,0.5); border-color: rgba(255,255,255,0.15); color: rgba(255,255,255,0.6); }
        .up-follow-btn-banner.following:hover { border-color: rgba(220,38,38,0.35); color: rgba(248,113,113,0.6); }

        .up-avatar-strip { position: relative; background: #0d0d0d; max-width: 680px; margin: -52px auto 0; padding: 0 1.5rem; display: flex; align-items: flex-end; }
        .up-avatar { width: 100px; height: 100px; border-radius: 50%; background: rgba(107,47,173,0.2); border: 3px solid #0d0d0d; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 400; color: #c4b5fd; overflow: hidden; font-family: Cochin, Georgia, serif; flex-shrink: 0; box-shadow: 0 0 0 2px rgba(167,139,250,0.15); position: relative; z-index: 1; }
        .up-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .up-avatar-pad { height: 52px; }

        .up-identity { max-width: 680px; margin: 0 auto; padding: 0.75rem 1.5rem 0; }
        .up-name { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: clamp(1.6rem, 5vw, 2.1rem); font-weight: 400; color: #ffffff; line-height: 1.05; margin-bottom: 0.2rem; letter-spacing: -0.01em; }
        .up-username { font-size: 0.78rem; color: rgba(167,139,250,0.55); font-family: Inter, sans-serif; margin-bottom: 0.55rem; }
        .up-badge-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 0.35rem; }
        .up-follows-you { font-size: 0.58rem; color: rgba(255,255,255,0.3); font-family: Inter, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 0.15em 0.7em; }
        .up-joined { font-size: 0.65rem; color: rgba(255,255,255,0.3); font-family: Inter, sans-serif; margin-bottom: 0.75rem; }
        .up-follow-row { display: flex; gap: 1.5rem; margin-bottom: 0.85rem; }
        .up-follow-stat { display: flex; align-items: baseline; gap: 5px; cursor: pointer; }
        .up-follow-stat:hover .up-follow-num { color: #a78bfa; }
        .up-follow-num { font-family: Cochin, Georgia, serif; font-size: 1.1rem; color: #f5f0e8; line-height: 1; transition: color 0.2s; }
        .up-follow-label { font-size: 0.58rem; color: rgba(255,255,255,0.35); letter-spacing: 0.1em; text-transform: uppercase; font-family: Inter, sans-serif; }
        .up-signin-prompt { font-size: 0.75rem; color: rgba(255,255,255,0.3); font-family: Inter, sans-serif; font-style: italic; }

        .up-body { max-width: 680px; margin: 0 auto; padding: 0 1.5rem 6rem; }
        .up-bio { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.05rem; color: rgba(240,236,230,0.8); line-height: 1.8; padding: 1.1rem 0 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 1.75rem; }

        .up-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; overflow: hidden; margin-bottom: 2rem; }
        .up-stat { background: rgba(255,255,255,0.02); padding: 1.5rem 1rem; text-align: center; transition: background 0.2s; cursor: default; }
        .up-stat.clickable { cursor: pointer; }
        .up-stat:hover { background: rgba(255,255,255,0.04); }
        .up-stat-num { font-family: Cochin, Georgia, serif; font-size: 2.2rem; font-weight: 400; color: #f5f0e8; line-height: 1; margin-bottom: 0.4rem; }
        .up-stat-label { font-size: 0.54rem; color: rgba(255,255,255,0.35); letter-spacing: 0.15em; text-transform: uppercase; font-family: Inter, sans-serif; }

        .up-section { margin-bottom: 2.25rem; }
        .up-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .up-section-title { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.2rem; font-weight: 400; color: #f5f0e8; }
        .up-section-meta { font-size: 0.58rem; color: rgba(255,255,255,0.3); letter-spacing: 0.12em; text-transform: uppercase; font-family: Inter, sans-serif; }

        .up-story-row { display: flex; align-items: center; gap: 12px; padding: 0.7rem 0; border-bottom: 1px solid rgba(255,255,255,0.04); text-decoration: none; transition: opacity 0.2s; }
        .up-story-row:hover { opacity: 0.72; }
        .up-story-thumb { width: 34px; height: 48px; border-radius: 3px; overflow: hidden; flex-shrink: 0; background: rgba(107,47,173,0.15); }
        .up-story-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .up-story-title { font-family: Cochin, Georgia, serif; font-size: 0.88rem; color: #f5f0e8; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .up-story-author { font-size: 0.65rem; color: rgba(255,255,255,0.35); font-family: Inter, sans-serif; margin-top: 2px; }
        .up-more-btn { background: none; border: none; font-size: 0.7rem; color: rgba(155,109,255,0.5); font-family: Inter, sans-serif; cursor: pointer; padding: 0.65rem 0 0; letter-spacing: 0.06em; text-decoration: underline; text-underline-offset: 3px; }
        .up-more-btn:hover { color: #a78bfa; }

        @media (max-width: 520px) {
          .up-banner { height: 130px; }
          .up-avatar { width: 82px; height: 82px; font-size: 26px; }
          .up-avatar-strip { margin-top: -42px; }
          .up-name { font-size: 1.55rem; }
        }
      `}</style>

      {/* Nav */}
      <nav className="up-nav">
        <div className="up-nav-logo">Calvary <span>Scribblings</span></div>
        <a href="/" className="up-nav-back">← Back to stories</a>
      </nav>

      {/* Banner */}
      <div className="up-banner">
        {currentUser && (
          <button
            className={`up-follow-btn-banner${isFollowing ? ' following' : ''}`}
            onClick={handleFollow}
            disabled={followLoading}
          >
            {followLoading ? '…' : isFollowing ? 'Following' : 'Follow'}
          </button>
        )}
      </div>

      {/* Avatar strip */}
      <div className="up-avatar-strip">
        <div className="up-avatar">
          {profileData.avatarUrl ? <img src={profileData.avatarUrl} alt={initials} /> : initials}
        </div>
        <div className="up-avatar-pad" />
      </div>

      {/* Identity */}
      <div className="up-identity">
        <div className="up-name">{profileData.displayName || 'Reader'}</div>
        {profileData.username && <div className="up-username">@{profileData.username}</div>}
        <div className="up-badge-row">
          {isAuthor ? <WriterBadge size={13} /> : badge ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <BadgeIcon color={badge.color} size={13} isFounder={badge.isFounder} />
              <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', color: badge.color }}>{badge.label}</span>
            </span>
          ) : null}
          {followsYou && <span className="up-follows-you">Follows you</span>}
        </div>
        {joinDate && <div className="up-joined">Member since {joinDate}</div>}
        <div className="up-follow-row">
          <div className="up-follow-stat" onClick={() => setShowFollowers(true)}>
            <div className="up-follow-num">{followerCount}</div>
            <div className="up-follow-label">Followers</div>
          </div>
          <div className="up-follow-stat" onClick={() => setShowFollowing(true)}>
            <div className="up-follow-num">{followingCount}</div>
            <div className="up-follow-label">Following</div>
          </div>
        </div>
        {!currentUser && (
          <div className="up-signin-prompt">Sign in to follow {firstName}.</div>
        )}
      </div>

      {/* Body */}
      <div className="up-body">

        {profileData.bio && <div className="up-bio">{profileData.bio}</div>}

        {/* Stats */}
        <div className="up-stats">
          <div className="up-stat">
            <div className="up-stat-num">{readCount.toLocaleString()}</div>
            <div className="up-stat-label">Stories read</div>
          </div>
          <div className="up-stat clickable" onClick={() => setShowComments(true)}>
            <div className="up-stat-num">{commentCount}</div>
            <div className="up-stat-label">Comments ↗</div>
          </div>
          <div className="up-stat">
            <div className="up-stat-num">—</div>
            <div className="up-stat-label">Bookmarks</div>
          </div>
        </div>

        {/* Stories read */}
        {readStories.length > 0 && (
          <div className="up-section">
            <div className="up-section-header">
              <div className="up-section-title">Stories read</div>
              <div className="up-section-meta">{readStories.length} total</div>
            </div>
            <div>
              {visibleStories.map(s => (
                <a key={s.id} href={`/stories/${s.id}`} className="up-story-row">
                  <div className="up-story-thumb">
                    {s.cover && <img src={s.cover} alt={s.title} loading="lazy" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="up-story-title">{s.title}</div>
                    <div className="up-story-author">by {s.author}</div>
                  </div>
                </a>
              ))}
            </div>
            {readStories.length > 10 && !showAllStories && (
              <button className="up-more-btn" onClick={() => setShowAllStories(true)}>
                Show {readStories.length - 10} more
              </button>
            )}
          </div>
        )}

        {/* Square posts — inline */}
        <div className="up-section">
          <div className="up-section-header">
            <div className="up-section-title">The Scribblings Square</div>
            {squarePosts.length > 0 && <div className="up-section-meta">{squarePosts.length} {squarePosts.length === 1 ? 'post' : 'posts'}</div>}
          </div>
          {squareLoading ? (
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.25)', fontFamily: 'Inter, sans-serif', padding: '0.5rem 0' }}>Loading…</div>
          ) : squarePosts.length === 0 ? (
            <div style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.25)', fontFamily: 'Cochin, Georgia, serif', fontStyle: 'italic', padding: '0.5rem 0' }}>
              {firstName} hasn't posted on The Square yet.
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
                />
              ))}
              {squarePosts.length > 5 && !showAllPosts && (
                <button className="up-more-btn" onClick={() => setShowAllPosts(true)}>
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

      </div>

      {showFollowers && <UserListModal title={`Followers · ${followerCount}`} uids={followerUids} onClose={() => setShowFollowers(false)} />}
      {showFollowing && <UserListModal title={`Following · ${followingCount}`} uids={followingUids} onClose={() => setShowFollowing(false)} />}
      {showComments && <CommentHistoryModal uid={uid} displayName={profileData.displayName || 'Reader'} onClose={() => setShowComments(false)} allStoriesMerged={allStoriesMerged} />}
    </>
  );
}