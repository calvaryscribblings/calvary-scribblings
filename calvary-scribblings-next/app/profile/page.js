'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

async function getFirebaseDB() {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getDatabase } = await import('firebase/database');
  const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  return getDatabase(app);
}

async function getFirebaseAuth() {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getAuth } = await import('firebase/auth');
  const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  return getAuth(app);
}

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
  if (readCount < 25) return { label: 'Reader', threshold: 25, color: '#b4b2a9' };
  if (readCount < 60) return { label: 'Island Reader', threshold: 60, color: '#1d9e75' };
  if (readCount < 90) return { label: 'Story Islander', threshold: 90, color: '#d4941a' };
  if (readCount < 150) return { label: 'Legend of the Island', threshold: 150, color: '#d4537e' };
  if (readCount < 1000) return { label: 'Immortal of the Island', threshold: 1000, color: '#9b6dff' };
  return null;
}

const BADGE_SVG_PATH = "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C1.87 9.33 1 10.57 1 12s.87 2.67 2.19 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91C21.37 14.67 22.25 13.43 22.25 12z";
const CHECK_PATH = "M9.13 17.75L5.5 14.12l1.41-1.41 2.22 2.22 6.34-7.59 1.53 1.28z";

function BadgeIcon({ color, size = 14, isFounder = false }) {
  const isLight = color === '#b4b2a9';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="profPlatGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8f0f8"/>
          <stop offset="50%" stopColor="#c8daea"/>
          <stop offset="100%" stopColor="#a8c0d6"/>
        </linearGradient>
      </defs>
      <path fill={isFounder ? 'url(#profPlatGrad)' : color} d={BADGE_SVG_PATH} />
      <path fill={isLight ? '#0a0a0a' : '#fff'} d={CHECK_PATH} />
    </svg>
  );
}

function formatJoinDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [commentCount, setCommentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [changingPassword, setChangingPassword] = useState(false);
  const [pwMsg, setPwMsg] = useState('');

  useEffect(() => {
    let unsub;
    (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      unsub = onAuthStateChanged(auth, async (u) => {
        if (!u) { router.push('/'); return; }
        setUser(u);
        try {
          const db = await getFirebaseDB();
          const { ref, get } = await import('firebase/database');
          const [userSnap, commentsSnap] = await Promise.all([
            get(ref(db, `users/${u.uid}`)),
            get(ref(db, 'comments')),
          ]);
          const uData = userSnap.exists() ? userSnap.val() : {};
          setUserData(uData);
          // Count comments across all stories
          if (commentsSnap.exists()) {
            let count = 0;
            const allStories = commentsSnap.val();
            for (const storyComments of Object.values(allStories)) {
              for (const comment of Object.values(storyComments)) {
                if (comment.authorUid === u.uid) count++;
              }
            }
            setCommentCount(count);
          }
        } catch (e) {}
        setLoading(false);
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  const handleSignOut = async () => {
    const auth = await getFirebaseAuth();
    const { signOut } = await import('firebase/auth');
    await signOut(auth);
    router.push('/');
  };

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setChangingPassword(true);
    try {
      const auth = await getFirebaseAuth();
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, user.email);
      setPwMsg('Password reset email sent. Check your inbox.');
    } catch (e) {
      setPwMsg('Something went wrong. Please try again.');
    }
    setChangingPassword(false);
  };

  if (loading) return <div style={{ minHeight: '100vh', background: '#0a0a0a' }} />;
  if (!user) return null;

  const readCount = userData?.readCount || 0;
  const badge = getBadge(readCount, user.uid);
  const nextBadge = getNextBadge(readCount, user.uid);
  const initials = (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const joinDate = user.metadata?.creationTime ? formatJoinDate(new Date(user.metadata.creationTime)) : 'Recently';

  const progressPct = nextBadge
    ? Math.min(100, Math.round((readCount / nextBadge.threshold) * 100))
    : 100;

  const prevThreshold = (() => {
    if (!nextBadge) return 0;
    if (nextBadge.threshold === 25) return 0;
    if (nextBadge.threshold === 60) return 25;
    if (nextBadge.threshold === 90) return 60;
    if (nextBadge.threshold === 150) return 90;
    if (nextBadge.threshold === 1000) return 150;
    return 0;
  })();

  const tierProgress = nextBadge
    ? Math.min(100, Math.round(((readCount - prevThreshold) / (nextBadge.threshold - prevThreshold)) * 100))
    : 100;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0a0a0a; color: #e8e0d4; font-family: 'Inter', sans-serif; }
        .pg { max-width: 680px; margin: 0 auto; padding: 2rem 1.5rem 6rem; }
        .pg-nav { display: flex; align-items: center; justify-content: space-between; padding-bottom: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 2.5rem; }
        .pg-nav-logo { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1rem; font-weight: 600; letter-spacing: 0.02em; }
        .pg-nav-logo span { color: #a78bfa; }
        .pg-nav-back { font-size: 0.68rem; color: rgba(255,255,255,0.3); letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; text-decoration: none; transition: color 0.2s; }
        .pg-nav-back:hover { color: rgba(255,255,255,0.6); }
        .pg-hero { display: flex; align-items: flex-start; gap: 1.25rem; margin-bottom: 2rem; }
        .pg-avatar { width: 68px; height: 68px; border-radius: 50%; background: rgba(107,47,173,0.25); border: 1px solid rgba(107,47,173,0.3); display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 500; color: #9b6dff; flex-shrink: 0; font-family: 'Inter', sans-serif; }
        .pg-hero-info { flex: 1; padding-top: 4px; }
        .pg-name { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.75rem; font-weight: 300; color: #f5f0e8; line-height: 1.1; margin-bottom: 0.5rem; }
        .pg-badge-row { display: flex; align-items: center; gap: 6px; margin-bottom: 0.4rem; flex-wrap: wrap; }
        .pg-badge-label { font-size: 0.6rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pg-dot { color: rgba(255,255,255,0.1); font-size: 0.6rem; }
        .pg-verified { display: inline-flex; align-items: center; gap: 3px; font-size: 0.6rem; color: #1d9e75; font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pg-unverified { display: inline-flex; align-items: center; gap: 3px; font-size: 0.6rem; color: rgba(255,255,255,0.25); font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
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
        .pg-setting-action { font-size: 0.62rem; color: #9b6dff; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; cursor: pointer; background: none; border: none; }
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
          <div className="pg-avatar">{initials}</div>
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
                {nextBadge ? `${nextBadge.label} at ${nextBadge.threshold}` : badge ? 'Maximum tier reached' : `Reader at 25`}
              </div>
            </div>
            <div className="pg-progress-bar-wrap">
              <div
                className="pg-progress-bar"
                style={{
                  width: `${tierProgress}%`,
                  background: badge ? badge.color : '#444',
                }}
              />
            </div>
          </div>
        </div>

        <div className="pg-section">
          <div className="pg-section-header">
            <div className="pg-section-title">Get Paid to Read</div>
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