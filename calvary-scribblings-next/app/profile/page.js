'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

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

const BADGE_PATH = "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C1.87 9.33 1 10.57 1 12s.87 2.67 2.19 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91C21.37 14.67 22.25 13.43 22.25 12z";
const CHECK_PATH = "M9.13 17.75L5.5 14.12l1.41-1.41 2.22 2.22 6.34-7.59 1.53 1.28z";

function BadgeIcon({ color, size = 14, isFounder = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="pgPlat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8f0f8"/><stop offset="50%" stopColor="#c8daea"/><stop offset="100%" stopColor="#a8c0d6"/>
        </linearGradient>
      </defs>
      <path fill={isFounder ? 'url(#pgPlat)' : color} d={BADGE_PATH} />
      <path fill={color === '#b4b2a9' ? '#0a0a0a' : '#fff'} d={CHECK_PATH} />
    </svg>
  );
}

function formatJoinDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

async function loadProfileData(uid) {
  const db = await getDB();
  const { ref, get } = await import('firebase/database');
  const [avatarSnap, readCountSnap, commentsSnap, followersSnap, followingSnap] = await Promise.all([
    get(ref(db, `users/${uid}/avatarUrl`)),
    get(ref(db, `users/${uid}/readCount`)),
    get(ref(db, 'comments')),
    get(ref(db, `followers/${uid}`)),
    get(ref(db, `following/${uid}`)),
  ]);

  let commentCount = 0;
  if (commentsSnap.exists()) {
    for (const storyComments of Object.values(commentsSnap.val())) {
      for (const c of Object.values(storyComments)) {
        if (c.authorUid === uid) commentCount++;
      }
    }
  }

  return {
    avatarUrl: avatarSnap.exists() ? avatarSnap.val() : null,
    readCount: readCountSnap.exists() ? readCountSnap.val() : 0,
    commentCount,
    followerCount: followersSnap.exists() ? Object.keys(followersSnap.val()).length : 0,
    followingCount: followingSnap.exists() ? Object.keys(followingSnap.val()).length : 0,
  };
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [readCount, setReadCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pwMsg, setPwMsg] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    let unsub;
    (async () => {
      const auth = await getAuth();
      const { onAuthStateChanged } = await import('firebase/auth');

      unsub = onAuthStateChanged(auth, async (u) => {
        if (!u) { router.push('/'); return; }
        setUser(u);

        // First attempt
        try {
          const data = await loadProfileData(u.uid);
          setAvatarUrl(data.avatarUrl);
          setReadCount(data.readCount);
          setCommentCount(data.commentCount);
          setFollowerCount(data.followerCount);
          setFollowingCount(data.followingCount);

          // If readCount came back 0 but we expect data, retry after 800ms
          // to allow Firebase connection to fully establish
          if (data.readCount === 0 && data.avatarUrl === null) {
            setTimeout(async () => {
              try {
                const retry = await loadProfileData(u.uid);
                if (retry.avatarUrl) setAvatarUrl(retry.avatarUrl);
                if (retry.readCount > 0) setReadCount(retry.readCount);
                if (retry.commentCount > 0) setCommentCount(retry.commentCount);
                if (retry.followerCount > 0) setFollowerCount(retry.followerCount);
                if (retry.followingCount > 0) setFollowingCount(retry.followingCount);
              } catch (e) {}
            }, 800);
          }
        } catch (e) {
          console.error('Profile load error:', e);
          // Retry after delay on error
          setTimeout(async () => {
            try {
              const retry = await loadProfileData(u.uid);
              setAvatarUrl(retry.avatarUrl);
              setReadCount(retry.readCount);
              setCommentCount(retry.commentCount);
              setFollowerCount(retry.followerCount);
              setFollowingCount(retry.followingCount);
            } catch (e2) {}
          }, 1000);
        }

        setLoading(false);
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const storage = await getStorage();
      const db = await getDB();
      const { ref: sRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const { ref, set } = await import('firebase/database');
      const storageRef = sRef(storage, `avatars/${user.uid}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await set(ref(db, `users/${user.uid}/avatarUrl`), url);
      setAvatarUrl(url);
    } catch (e) { console.error('Upload failed:', e); }
    setUploading(false);
  };

  const handleSignOut = async () => {
    const auth = await getAuth();
    const { signOut } = await import('firebase/auth');
    await signOut(auth);
    router.push('/');
  };

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setChangingPassword(true);
    try {
      const auth = await getAuth();
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, user.email);
      setPwMsg('Password reset email sent. Check your inbox.');
    } catch (e) { setPwMsg('Something went wrong. Please try again.'); }
    setChangingPassword(false);
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#0a0a0a' }} />;
  if (!user) return null;

  const badge = getBadge(readCount, user.uid);
  const nextBadge = getNextBadge(readCount, user.uid);
  const initials = (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const joinDate = user.metadata?.creationTime ? formatJoinDate(new Date(user.metadata.creationTime)) : 'Recently';
  const tierProgress = nextBadge
    ? Math.min(100, Math.round(((readCount - getPrevThreshold(nextBadge.threshold)) / (nextBadge.threshold - getPrevThreshold(nextBadge.threshold))) * 100))
    : 100;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0a0a0a; color: #e8e0d4; font-family: 'Inter', sans-serif; }
        .pg { max-width: 680px; margin: 0 auto; padding: 2rem 1.5rem 6rem; }
        .pg-nav { display: flex; align-items: center; justify-content: space-between; padding-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 2.5rem; }
        .pg-nav-logo { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1rem; font-weight: 600; letter-spacing: 0.02em; color: #f5f0e8; }
        .pg-nav-logo span { color: #a78bfa; }
        .pg-nav-back { font-size: 0.68rem; color: rgba(255,255,255,0.3); letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; transition: color 0.2s; }
        .pg-nav-back:hover { color: rgba(255,255,255,0.6); }
        .pg-hero { display: flex; align-items: flex-start; gap: 1.25rem; margin-bottom: 2rem; }
        .pg-avatar-wrap { position: relative; flex-shrink: 0; cursor: pointer; }
        .pg-avatar { width: 72px; height: 72px; border-radius: 50%; background: rgba(107,47,173,0.25); border: 1.5px solid rgba(107,47,173,0.35); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 500; color: #9b6dff; overflow: hidden; font-family: 'Inter', sans-serif; }
        .pg-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .pg-avatar-overlay { position: absolute; inset: 0; border-radius: 50%; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; }
        .pg-avatar-wrap:hover .pg-avatar-overlay { opacity: 1; }
        .pg-avatar-overlay-text { font-size: 0.55rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #fff; font-family: 'Inter', sans-serif; text-align: center; line-height: 1.4; }
        .pg-uploading { position: absolute; inset: 0; border-radius: 50%; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; }
        .pg-spinner { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .pg-hero-info { flex: 1; padding-top: 4px; }
        .pg-name { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.75rem; font-weight: 300; color: #f5f0e8; line-height: 1.1; margin-bottom: 0.5rem; }
        .pg-badge-row { display: flex; align-items: center; gap: 6px; margin-bottom: 0.5rem; flex-wrap: wrap; }
        .pg-badge-label { font-size: 0.6rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pg-dot { color: rgba(255,255,255,0.1); font-size: 0.6rem; }
        .pg-verified { display: inline-flex; align-items: center; gap: 3px; font-size: 0.6rem; color: #1d9e75; font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pg-unverified { font-size: 0.6rem; color: rgba(255,255,255,0.25); font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pg-follow-row { display: flex; gap: 1.5rem; margin-bottom: 0.5rem; }
        .pg-follow-stat { display: flex; flex-direction: column; gap: 2px; }
        .pg-follow-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.1rem; font-weight: 300; color: #f5f0e8; line-height: 1; }
        .pg-follow-label { font-size: 0.58rem; color: rgba(255,255,255,0.25); letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pg-joined { font-size: 0.7rem; color: rgba(255,255,255,0.22); font-family: 'Inter', sans-serif; }
        .pg-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.06); border-radius: 2px; margin-bottom: 2rem; overflow: hidden; }
        .pg-stat { background: #0a0a0a; padding: 1.25rem; text-align: center; }
        .pg-stat-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 2rem; font-weight: 300; color: #f5f0e8; line-height: 1; margin-bottom: 0.3rem; }
        .pg-stat-label { font-size: 0.58rem; color: rgba(255,255,255,0.25); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pg-section { margin-bottom: 2rem; }
        .pg-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .pg-section-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.1rem; font-weight: 300; color: #f5f0e8; }
        .pg-section-meta { font-size: 0.62rem; color: rgba(255,255,255,0.2); letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pg-badge-progress { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 2px; padding: 1.25rem; }
        .pg-progress-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
        .pg-progress-current { font-size: 0.75rem; color: rgba(255,255,255,0.4); font-family: 'Inter', sans-serif; }
        .pg-progress-next { font-size: 0.65rem; color: rgba(255,255,255,0.2); font-family: 'Inter', sans-serif; }
        .pg-progress-bar-wrap { height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
        .pg-progress-bar { height: 100%; border-radius: 2px; transition: width 0.6s ease; }
        .pg-wallet { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 2px; padding: 1.25rem; display: flex; align-items: center; justify-content: space-between; opacity: 0.4; }
        .pg-wallet-label { font-size: 0.6rem; color: rgba(255,255,255,0.25); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; margin-bottom: 4px; }
        .pg-wallet-amount { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.6rem; font-weight: 300; color: #f5f0e8; margin-bottom: 4px; }
        .pg-wallet-coming { font-size: 0.65rem; color: rgba(255,255,255,0.18); font-family: 'Inter', sans-serif; font-style: italic; }
        .pg-points-pill { background: rgba(107,47,173,0.15); border: 1px solid rgba(107,47,173,0.3); border-radius: 1px; padding: 0.5rem 1rem; text-align: center; }
        .pg-points-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.4rem; color: #9b6dff; line-height: 1; margin-bottom: 2px; }
        .pg-points-label { font-size: 0.55rem; color: rgba(155,109,255,0.5); letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pg-bookmarks-empty { padding: 1.5rem; text-align: center; border: 1px solid rgba(255,255,255,0.05); border-radius: 2px; }
        .pg-bookmarks-empty p { font-size: 0.85rem; color: rgba(255,255,255,0.2); font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic; }
        .pg-settings { display: flex; flex-direction: column; gap: 0.5rem; }
        .pg-setting-row { display: flex; align-items: center; justify-content: space-between; padding: 0.85rem 1rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 1px; }
        .pg-setting-label { font-size: 0.8rem; color: rgba(255,255,255,0.45); font-family: 'Inter', sans-serif; }
        .pg-setting-action { font-size: 0.62rem; color: #9b6dff; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; cursor: pointer; background: none; border: none; transition: color 0.2s; }
        .pg-setting-action:hover { color: #c4b5fd; }
        .pg-pw-msg { font-size: 0.72rem; color: #86efac; font-family: 'Inter', sans-serif; margin-top: 0.5rem; padding: 0 1rem; }
        .pg-signout { width: 100%; margin-top: 1rem; background: none; border: 1px solid rgba(220,38,38,0.2); border-radius: 1px; padding: 0.75rem; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(248,113,113,0.45); cursor: pointer; font-family: 'Inter', sans-serif; transition: color 0.2s, border-color 0.2s; }
        .pg-signout:hover { color: #f87171; border-color: rgba(220,38,38,0.4); }
      `}</style>

      <div className="pg">
        <div className="pg-nav">
          <div className="pg-nav-logo">Calvary <span>Scribblings</span></div>
          <a href="/" className="pg-nav-back">← Back to stories</a>
        </div>

        <div className="pg-hero">
          <div className="pg-avatar-wrap" onClick={() => !uploading && fileInputRef.current?.click()}>
            <div className="pg-avatar">
              {avatarUrl ? <img src={avatarUrl} alt={initials} /> : initials}
            </div>
            {uploading ? (
              <div className="pg-uploading"><div className="pg-spinner" /></div>
            ) : (
              <div className="pg-avatar-overlay">
                <div className="pg-avatar-overlay-text">Change<br/>photo</div>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />

          <div className="pg-hero-info">
            <div className="pg-name">{user.displayName || 'Reader'}</div>
            <div className="pg-badge-row">
              {badge && (
                <>
                  <BadgeIcon color={badge.color} size={14} isFounder={badge.isFounder} />
                  <span className="pg-badge-label" style={{ color: badge.color }}>{badge.label}</span>
                  <span className="pg-dot">·</span>
                </>
              )}
              {user.emailVerified ? (
                <span className="pg-verified">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#1d9e75" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Verified
                </span>
              ) : (
                <span className="pg-unverified">Unverified</span>
              )}
            </div>
            <div className="pg-follow-row">
              <div className="pg-follow-stat">
                <div className="pg-follow-num">{followerCount}</div>
                <div className="pg-follow-label">Followers</div>
              </div>
              <div className="pg-follow-stat">
                <div className="pg-follow-num">{followingCount}</div>
                <div className="pg-follow-label">Following</div>
              </div>
            </div>
            <div className="pg-joined">Member since {joinDate}</div>
          </div>
        </div>

        <div className="pg-stats">
          <div className="pg-stat">
            <div className="pg-stat-num">{readCount.toLocaleString()}</div>
            <div className="pg-stat-label">Stories read</div>
          </div>
          <div className="pg-stat">
            <div className="pg-stat-num">{commentCount}</div>
            <div className="pg-stat-label">Comments</div>
          </div>
          <div className="pg-stat">
            <div className="pg-stat-num">—</div>
            <div className="pg-stat-label">Bookmarks</div>
          </div>
        </div>

        <div className="pg-section">
          <div className="pg-section-header">
            <div className="pg-section-title">Reading badge</div>
            <div className="pg-section-meta">{badge ? badge.label : 'No badge yet'}</div>
          </div>
          <div className="pg-badge-progress">
            <div className="pg-progress-row">
              <div className="pg-progress-current">{readCount.toLocaleString()} {readCount === 1 ? 'story' : 'stories'} read</div>
              <div className="pg-progress-next">
                {nextBadge ? `${nextBadge.label} at ${nextBadge.threshold}` : badge ? 'Maximum tier reached' : 'Reader at 25'}
              </div>
            </div>
            <div className="pg-progress-bar-wrap">
              <div className="pg-progress-bar" style={{ width: `${tierProgress}%`, background: badge ? badge.color : '#444' }} />
            </div>
          </div>
        </div>

        <div className="pg-section">
          <div className="pg-section-header">
            <div className="pg-section-title">Reader's Reward</div>
            <div className="pg-section-meta">Coming soon</div>
          </div>
          <div className="pg-wallet">
            <div>
              <div className="pg-wallet-label">Wallet balance</div>
              <div className="pg-wallet-amount">£0.00</div>
              <div className="pg-wallet-coming">Points system launching soon</div>
            </div>
            <div className="pg-points-pill">
              <div className="pg-points-num">0</div>
              <div className="pg-points-label">Points</div>
            </div>
          </div>
        </div>

        <div className="pg-section">
          <div className="pg-section-header">
            <div className="pg-section-title">Bookmarks</div>
            <div className="pg-section-meta">Coming soon</div>
          </div>
          <div className="pg-bookmarks-empty">
            <p>Bookmarking is coming soon. Save stories to read later.</p>
          </div>
        </div>

        <div className="pg-section">
          <div className="pg-section-header">
            <div className="pg-section-title">Account</div>
          </div>
          <div className="pg-settings">
            <div className="pg-setting-row">
              <span className="pg-setting-label">{user.email}</span>
            </div>
            <div className="pg-setting-row">
              <span className="pg-setting-label">Password</span>
              <button className="pg-setting-action" onClick={handleResetPassword} disabled={changingPassword}>
                {changingPassword ? 'Sending…' : 'Reset password'}
              </button>
            </div>
          </div>
          {pwMsg && <div className="pg-pw-msg">{pwMsg}</div>}
          <button className="pg-signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </div>
    </>
  );
}