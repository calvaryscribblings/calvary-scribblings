'use client';

import { useEffect, useState } from 'react';

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

export default function UserPage() {
  const [uid, setUid] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [readCount, setReadCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followsYou, setFollowsYou] = useState(false);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);

  // Read uid from query string
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) setUid(id);
    else setLoading(false);
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
            get(ref(db, `users/${uid}/avatarUrl`)),
            get(ref(db, `users/${uid}/readCount`)),
            get(ref(db, `users/${uid}/displayName`)),
            get(ref(db, `users/${uid}/joinDate`)),
            get(ref(db, 'comments')),
            get(ref(db, `followers/${uid}`)),
            get(ref(db, `following/${uid}`)),
          ];
          if (u) {
            fetches.push(get(ref(db, `followers/${uid}/${u.uid}`)));
            fetches.push(get(ref(db, `followers/${u.uid}/${uid}`)));
          }

          const results = await Promise.all(fetches);
          const [avatarSnap, readCountSnap, nameSnap, joinSnap, commentsSnap, followersSnap, followingSnap] = results;

          setProfileData({
            avatarUrl: avatarSnap.exists() ? avatarSnap.val() : null,
            displayName: nameSnap.exists() ? nameSnap.val() : 'Reader',
            joinDate: joinSnap.exists() ? joinSnap.val() : null,
          });
          setReadCount(readCountSnap.exists() ? readCountSnap.val() : 0);

          if (commentsSnap.exists()) {
            let count = 0;
            for (const storyComments of Object.values(commentsSnap.val())) {
              for (const c of Object.values(storyComments)) {
                if (c.authorUid === uid) count++;
              }
            }
            setCommentCount(count);
          }

          const followers = followersSnap.exists() ? followersSnap.val() : {};
          setFollowerCount(Object.keys(followers).length);
          setFollowingCount(followingSnap.exists() ? Object.keys(followingSnap.val()).length : 0);

          if (u) {
            setIsFollowing(results[7]?.exists() || false);
            setFollowsYou(results[8]?.exists() || false);
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
        .up-hero { display: flex; align-items: flex-start; gap: 1.25rem; margin-bottom: 2rem; }
        .up-avatar { width: 72px; height: 72px; border-radius: 50%; background: rgba(107,47,173,0.25); border: 1.5px solid rgba(107,47,173,0.35); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 500; color: #9b6dff; overflow: hidden; flex-shrink: 0; font-family: 'Inter', sans-serif; }
        .up-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .up-hero-info { flex: 1; padding-top: 4px; }
        .up-name { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.75rem; font-weight: 300; color: #f5f0e8; line-height: 1.1; margin-bottom: 0.5rem; }
        .up-badge-row { display: flex; align-items: center; gap: 6px; margin-bottom: 0.5rem; flex-wrap: wrap; }
        .up-badge-label { font-size: 0.6rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .up-follows-you { display: inline-flex; align-items: center; font-size: 0.6rem; color: rgba(255,255,255,0.35); font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 0.15em 0.65em; }
        .up-follow-row { display: flex; gap: 1.5rem; margin-bottom: 0.5rem; }
        .up-follow-stat { display: flex; flex-direction: column; gap: 2px; }
        .up-follow-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.1rem; font-weight: 300; color: #f5f0e8; line-height: 1; }
        .up-follow-label { font-size: 0.58rem; color: rgba(255,255,255,0.25); letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .up-joined { font-size: 0.7rem; color: rgba(255,255,255,0.22); font-family: 'Inter', sans-serif; margin-bottom: 0.75rem; }
        .up-follow-btn { background: #7c3aed; border: none; border-radius: 2px; padding: 0.5rem 1.4rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.2s; }
        .up-follow-btn:hover { background: #6d28d9; }
        .up-follow-btn.following { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.5); }
        .up-follow-btn.following:hover { border-color: rgba(220,38,38,0.4); color: rgba(248,113,113,0.6); }
        .up-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
        .up-stat { background: #0a0a0a; padding: 1.25rem; text-align: center; }
        .up-stat-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 2rem; font-weight: 300; color: #f5f0e8; line-height: 1; margin-bottom: 0.3rem; }
        .up-stat-label { font-size: 0.58rem; color: rgba(255,255,255,0.25); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .up-signin-prompt { font-size: 0.78rem; color: rgba(255,255,255,0.25); font-family: 'Inter', sans-serif; font-style: italic; padding: 0.75rem 0; }
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
            <div className="up-name">{profileData.displayName}</div>
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
              <div className="up-follow-stat">
                <div className="up-follow-num">{followerCount}</div>
                <div className="up-follow-label">Followers</div>
              </div>
              <div className="up-follow-stat">
                <div className="up-follow-num">{followingCount}</div>
                <div className="up-follow-label">Following</div>
              </div>
            </div>
            {joinDate && <div className="up-joined">Member since {joinDate}</div>}
            {currentUser ? (
              <button
                className={`up-follow-btn${isFollowing ? ' following' : ''}`}
                onClick={handleFollow}
                disabled={followLoading}
              >
                {followLoading ? '…' : isFollowing ? 'Following' : 'Follow'}
              </button>
            ) : (
              <div className="up-signin-prompt">Sign in to follow this reader.</div>
            )}
          </div>
        </div>

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
      </div>
    </>
  );
}