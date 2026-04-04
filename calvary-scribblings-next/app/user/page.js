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
async function getAuth() { const { getAuth } = await import('firebase/auth'); return getAuth(await getApp()); }

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

const BADGE_PATH = "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C1.87 9.33 1 10.57 1 12s.87 2.67 2.19 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91C21.37 14.67 22.25 13.43 22.25 12z";
const CHECK_PATH = "M9.13 17.75L5.5 14.12l1.41-1.41 2.22 2.22 6.34-7.59 1.53 1.28z";

function BadgeIcon({ color, size = 14, isFounder = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="upPlat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8f0f8"/><stop offset="50%" stopColor="#c8daea"/><stop offset="100%" stopColor="#a8c0d6"/>
        </linearGradient>
      </defs>
      <path fill={isFounder ? 'url(#upPlat)' : color} d={BADGE_PATH} />
      <path fill={color === '#b4b2a9' ? '#0a0a0a' : '#fff'} d={CHECK_PATH} />
    </svg>
  );
}

function formatJoinDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function UserListModal({ title, uids, onClose }) {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    if (!uids || uids.length === 0) { setLoadingUsers(false); return; }
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const results = await Promise.all(
        uids.map(uid => get(ref(db, `users/${uid}`)).then(snap => ({ uid, data: snap.exists() ? snap.val() : null })))
      );
      setUsers(results.filter(u => u.data));
      setLoadingUsers(false);
    })();
  }, [uids]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 520, padding: '2rem 1.5rem 2.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.3rem', fontWeight: 300, color: '#f5f0e8' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '1.4rem', cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
        </div>
        {loadingUsers ? (
          <div style={{ padding: '1.5rem 0', color: 'rgba(255,255,255,0.3)', fontSize: '0.82rem', fontFamily: 'Inter, sans-serif' }}>Loading…</div>
        ) : users.length === 0 ? (
          <div style={{ padding: '1.5rem 0', color: 'rgba(255,255,255,0.2)', fontSize: '0.85rem', fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic' }}>No one here yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {users.map(({ uid, data }) => {
              const initials = (data.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
              const badge = getBadge(data.readCount || 0, uid);
              return (
                <a key={uid} href={`/user?id=${uid}`} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', textDecoration: 'none', padding: '0.6rem 0.75rem', borderRadius: '10px', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1.5px solid rgba(167,139,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0, fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
                    {data.avatarUrl ? <img src={data.avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', color: '#f5f0e8', fontFamily: 'Inter, sans-serif', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.displayName || 'Reader'}</div>
                    {data.username && <div style={{ fontSize: '0.7rem', color: 'rgba(167,139,250,0.55)', fontFamily: 'Inter, sans-serif' }}>@{data.username}</div>}
                  </div>
                  {badge && <BadgeIcon color={badge.color} size={14} isFounder={badge.isFounder} />}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [isFollowing, setIsFollowing] = useState(false);
  const [followsYou, setFollowsYou] = useState(false);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) setUid(id);
    else setLoading(false);
  }, []);

  // Fetch CMS stories from Firebase
  useEffect(() => {
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, 'cms_stories'));
      if (snap.exists()) {
        const data = snap.val();
        const parsed = Object.entries(data).map(([id, s]) => ({
          id,
          title: s.title || '',
          cover: s.coverUrl || '',
          category: s.category || '',
        }));
        setCmsStories(parsed);
      }
    })();
  }, []);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      const auth = await getAuth();
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
          ];
          if (u) {
            fetches.push(get(ref(db, `followers/${uid}/${u.uid}`)));
            fetches.push(get(ref(db, `followers/${u.uid}/${uid}`)));
          }

          const results = await Promise.all(fetches);
          const [userSnap, commentsSnap, followersSnap, followingSnap] = results;

          if (userSnap.exists()) {
            const d = userSnap.val();
            setProfileData(d);
            setReadCount(d.readCount || 0);
            if (d.readStories) setReadStorySlugs(Object.keys(d.readStories));
          }

          if (commentsSnap.exists()) {
            let count = 0;
            for (const sc of Object.values(commentsSnap.val())) {
              for (const c of Object.values(sc)) {
                if (c.authorUid === uid) count++;
              }
            }
            setCommentCount(count);
          }

          const followers = followersSnap.exists() ? followersSnap.val() : {};
          const followerUidList = Object.keys(followers);
          setFollowerCount(followerUidList.length);
          setFollowerUids(followerUidList);

          const followingVal = followingSnap.exists() ? followingSnap.val() : {};
          const followingUidList = Object.keys(followingVal);
          setFollowingCount(followingUidList.length);
          setFollowingUids(followingUidList);

          if (u) {
            setIsFollowing(results[4]?.exists() || false);
            setFollowsYou(results[5]?.exists() || false);
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
      const { ref, set, remove } = await import('firebase/database');
      if (isFollowing) {
        await Promise.all([
          remove(ref(db, `followers/${uid}/${currentUser.uid}`)),
          remove(ref(db, `following/${currentUser.uid}/${uid}`)),
        ]);
        setIsFollowing(false);
        setFollowerCount(c => Math.max(0, c - 1));
      } else {
        await Promise.all([
          set(ref(db, `followers/${uid}/${currentUser.uid}`), true),
          set(ref(db, `following/${currentUser.uid}/${uid}`), true),
        ]);
        setIsFollowing(true);
        setFollowerCount(c => c + 1);
      }
    } catch (e) { console.error('Follow error:', e); }
    setFollowLoading(false);
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#0a0a0a' }} />;

  if (!uid || !profileData) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif', fontSize: '0.85rem' }}>User not found.</p>
    </div>
  );

  const badge = getBadge(readCount, uid);
  const initials = (profileData.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const joinDate = profileData.joinDate ? formatJoinDate(profileData.joinDate) : null;

  // Merge static + CMS stories, then map slugs
  const allStoriesMerged = [
    ...allStories,
    ...cmsStories.filter(cs => !allStories.find(s => s.id === cs.id)),
  ];
  const readStories = readStorySlugs
    .map(slug => allStoriesMerged.find(s => s.id === slug))
    .filter(Boolean)
    .slice(0, 30);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0a0a0a; color: #e8e0d4; font-family: 'Inter', sans-serif; }
        .up { max-width: 680px; margin: 0 auto; padding: 2rem 1.5rem 6rem; }
        .up-nav { display: flex; align-items: center; justify-content: space-between; padding-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 2.5rem; }
        .up-nav-logo { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1rem; font-weight: 600; color: #f5f0e8; }
        .up-nav-logo span { color: #a78bfa; }
        .up-nav-back { font-size: 0.68rem; color: rgba(255,255,255,0.3); letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; transition: color 0.2s; }
        .up-nav-back:hover { color: rgba(255,255,255,0.6); }
        .up-hero { display: flex; align-items: flex-start; gap: 1.25rem; margin-bottom: 1.5rem; }
        .up-avatar { width: 72px; height: 72px; border-radius: 50%; background: rgba(107,47,173,0.25); border: 1.5px solid rgba(107,47,173,0.35); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 500; color: #9b6dff; overflow: hidden; flex-shrink: 0; font-family: 'Inter', sans-serif; }
        .up-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .up-hero-info { flex: 1; padding-top: 4px; }
        .up-name { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.75rem; font-weight: 300; color: #f5f0e8; line-height: 1.1; margin-bottom: 0.2rem; }
        .up-username { font-size: 0.75rem; color: rgba(167,139,250,0.55); font-family: 'Inter', sans-serif; margin-bottom: 0.5rem; }
        .up-badge-row { display: flex; align-items: center; gap: 6px; margin-bottom: 0.5rem; flex-wrap: wrap; }
        .up-badge-label { font-size: 0.6rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .up-follows-you { display: inline-flex; align-items: center; font-size: 0.6rem; color: rgba(255,255,255,0.35); font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 0.15em 0.65em; }
        .up-follow-row { display: flex; gap: 1.5rem; margin-bottom: 0.5rem; }
        .up-follow-stat { display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
        .up-follow-stat:hover .up-follow-num { color: #a78bfa; }
        .up-follow-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.1rem; font-weight: 300; color: #f5f0e8; line-height: 1; transition: color 0.2s; }
        .up-follow-label { font-size: 0.58rem; color: rgba(255,255,255,0.25); letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .up-joined { font-size: 0.7rem; color: rgba(255,255,255,0.22); font-family: 'Inter', sans-serif; margin-bottom: 0.75rem; }
        .up-follow-btn { background: #7c3aed; border: none; border-radius: 8px; padding: 0.5rem 1.4rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.2s; }
        .up-follow-btn:hover { background: #6d28d9; }
        .up-follow-btn.following { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.5); }
        .up-follow-btn.following:hover { border-color: rgba(220,38,38,0.4); color: rgba(248,113,113,0.6); }
        .up-bio { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1rem; color: rgba(232,224,212,0.6); line-height: 1.7; font-style: italic; margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .up-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; overflow: hidden; margin-bottom: 2rem; }
        .up-stat { background: #0a0a0a; padding: 1.25rem; text-align: center; }
        .up-stat-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 2rem; font-weight: 300; color: #f5f0e8; line-height: 1; margin-bottom: 0.3rem; }
        .up-stat-label { font-size: 0.58rem; color: rgba(255,255,255,0.25); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .up-section { margin-bottom: 2rem; }
        .up-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .up-section-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.1rem; font-weight: 300; color: #f5f0e8; }
        .up-section-meta { font-size: 0.6rem; color: rgba(255,255,255,0.2); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .up-stories-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 0.65rem; }
        .up-story-card { display: block; text-decoration: none; border-radius: 8px; overflow: hidden; position: relative; aspect-ratio: 2/3; background: rgba(255,255,255,0.04); transition: transform 0.2s, opacity 0.2s; }
        .up-story-card:hover { transform: scale(1.03); opacity: 0.9; }
        .up-story-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .up-story-card-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 50%); display: flex; align-items: flex-end; padding: 0.5rem; opacity: 0; transition: opacity 0.2s; }
        .up-story-card:hover .up-story-card-overlay { opacity: 1; }
        .up-story-card-title { font-size: 0.58rem; color: #fff; font-family: 'Cormorant Garamond', Georgia, serif; line-height: 1.3; }
        .up-signin-prompt { font-size: 0.78rem; color: rgba(255,255,255,0.25); font-family: 'Inter', sans-serif; font-style: italic; padding: 0.75rem 0; }
        @media (max-width: 480px) {
          .up-stories-grid { grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); }
        }
      `}</style>

      <div className="up">
        <div className="up-nav">
          <div className="up-nav-logo">Calvary <span>Scribblings</span></div>
          <a href="/" className="up-nav-back">← Back to stories</a>
        </div>

        <div className="up-hero">
          <div className="up-avatar">
            {profileData.avatarUrl ? <img src={profileData.avatarUrl} alt={initials} /> : initials}
          </div>
          <div className="up-hero-info">
            <div className="up-name">{profileData.displayName || 'Reader'}</div>
            {profileData.username && <div className="up-username">@{profileData.username}</div>}
            <div className="up-badge-row">
              {badge && (
                <>
                  <BadgeIcon color={badge.color} size={14} isFounder={badge.isFounder} />
                  <span className="up-badge-label" style={{ color: badge.color }}>{badge.label}</span>
                </>
              )}
              {followsYou && <span className="up-follows-you">Follows you</span>}
            </div>
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
            {joinDate && <div className="up-joined">Member since {joinDate}</div>}
            {currentUser ? (
              <button className={`up-follow-btn${isFollowing ? ' following' : ''}`} onClick={handleFollow} disabled={followLoading}>
                {followLoading ? '…' : isFollowing ? 'Following' : 'Follow'}
              </button>
            ) : (
              <div className="up-signin-prompt">Sign in to follow this reader.</div>
            )}
          </div>
        </div>

        {profileData.bio && <div className="up-bio">{profileData.bio}</div>}

        <div className="up-stats">
          <div className="up-stat">
            <div className="up-stat-num">{readCount.toLocaleString()}</div>
            <div className="up-stat-label">Stories read</div>
          </div>
          <div className="up-stat">
            <div className="up-stat-num">{commentCount}</div>
            <div className="up-stat-label">Comments</div>
          </div>
          <div className="up-stat">
            <div className="up-stat-num">—</div>
            <div className="up-stat-label">Bookmarks</div>
          </div>
        </div>

        {readStories.length > 0 && (
          <div className="up-section">
            <div className="up-section-header">
              <div className="up-section-title">Stories read</div>
              <div className="up-section-meta">{readStories.length} shown</div>
            </div>
            <div className="up-stories-grid">
              {readStories.map(s => (
                <a key={s.id} href={`/stories/${s.id}`} className="up-story-card" title={s.title}>
                  <img src={s.cover} alt={s.title} loading="lazy" />
                  <div className="up-story-card-overlay">
                    <div className="up-story-card-title">{s.title}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {showFollowers && <UserListModal title={`Followers · ${followerCount}`} uids={followerUids} onClose={() => setShowFollowers(false)} />}
      {showFollowing && <UserListModal title={`Following · ${followingCount}`} uids={followingUids} onClose={() => setShowFollowing(false)} />}
    </>
  );
}