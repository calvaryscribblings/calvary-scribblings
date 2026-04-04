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

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [readCount, setReadCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [bio, setBio] = useState('');
  const [bioEdit, setBioEdit] = useState('');
  const [editingBio, setEditingBio] = useState(false);
  const [savingBio, setSavingBio] = useState(false);
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
        try {
          const db = await getDB();
          const { ref, get } = await import('firebase/database');
          const [avatarSnap, readCountSnap, commentsSnap, followersSnap, followingSnap, bioSnap] = await Promise.all([
            get(ref(db, `users/${u.uid}/avatarUrl`)),
            get(ref(db, `users/${u.uid}/readCount`)),
            get(ref(db, 'comments')),
            get(ref(db, `followers/${u.uid}`)),
            get(ref(db, `following/${u.uid}`)),
            get(ref(db, `users/${u.uid}/bio`)),
          ]);
          if (avatarSnap.exists()) setAvatarUrl(avatarSnap.val());
          if (readCountSnap.exists()) setReadCount(readCountSnap.val());
          if (bioSnap.exists()) { const b = bioSnap.val(); setBio(b); setBioEdit(b); }
          if (commentsSnap.exists()) {
            let count = 0;
            for (const sc of Object.values(commentsSnap.val())) {
              for (const c of Object.values(sc)) { if (c.authorUid === u.uid) count++; }
            }
            setCommentCount(count);
          }
          setFollowerCount(followersSnap.exists() ? Object.keys(followersSnap.val()).length : 0);
          setFollowingCount(followingSnap.exists() ? Object.keys(followingSnap.val()).length : 0);
        } catch (e) { console.error('Profile load error:', e); }
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

  const handleSaveBio = async () => {
    if (!user) return;
    setSavingBio(true);
    try {
      const db = await getDB();
      const { ref, set } = await import('firebase/database');
      const trimmed = bioEdit.trim();
      await set(ref(db, `users/${user.uid}/bio`), trimmed);
      setBio(trimmed);
      setEditingBio(false);
    } catch (e) { console.error('Bio save failed:', e); }
    setSavingBio(false);
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

  if (loading) return <div style={{ minHeight: '100vh', background: '#080808' }} />;
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
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #080808; color: #e8e0d4; font-family: 'Inter', sans-serif; min-height: 100vh; }

        .pf-hero { position: relative; min-height: 340px; display: flex; align-items: flex-end; overflow: hidden; background: #080808; }
        .pf-hero-gradient { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(107,47,173,0.15) 0%, rgba(8,8,8,0) 60%), linear-gradient(to top, rgba(8,8,8,1) 0%, rgba(8,8,8,0.4) 60%, rgba(8,8,8,0) 100%); z-index: 1; }
        .pf-hero-pattern { position: absolute; inset: 0; opacity: 0.04; background-image: radial-gradient(circle, #a78bfa 1px, transparent 1px); background-size: 32px 32px; z-index: 0; }
        .pf-hero-content { position: relative; z-index: 2; width: 100%; max-width: 720px; margin: 0 auto; padding: 2rem 1.5rem 2.5rem; display: flex; align-items: flex-end; gap: 1.5rem; }

        .pf-avatar-wrap { position: relative; flex-shrink: 0; cursor: pointer; }
        .pf-avatar { width: 88px; height: 88px; border-radius: 50%; background: rgba(107,47,173,0.2); border: 2px solid rgba(167,139,250,0.3); display: flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 400; color: #c4b5fd; overflow: hidden; font-family: 'Cormorant Garamond', Georgia, serif; transition: border-color 0.2s; }
        .pf-avatar:hover { border-color: rgba(167,139,250,0.6); }
        .pf-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .pf-avatar-overlay { position: absolute; inset: 0; border-radius: 50%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; }
        .pf-avatar-wrap:hover .pf-avatar-overlay { opacity: 1; }
        .pf-avatar-overlay-text { font-size: 0.52rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.9); font-family: 'Inter', sans-serif; text-align: center; line-height: 1.5; }
        .pf-uploading { position: absolute; inset: 0; border-radius: 50%; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; }
        .pf-spinner { width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.15); border-top-color: #a78bfa; border-radius: 50%; animation: spin 0.7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        .pf-hero-info { flex: 1; padding-bottom: 4px; }
        .pf-name { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 2.4rem; font-weight: 300; color: #f5f0e8; line-height: 1; margin-bottom: 0.6rem; letter-spacing: -0.01em; }
        .pf-meta-row { display: flex; align-items: center; gap: 8px; margin-bottom: 0.5rem; flex-wrap: wrap; }
        .pf-badge-pill { display: inline-flex; align-items: center; gap: 5px; }
        .pf-badge-label { font-size: 0.6rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pf-sep { color: rgba(255,255,255,0.15); font-size: 0.6rem; }
        .pf-verified { display: inline-flex; align-items: center; gap: 3px; font-size: 0.6rem; color: #1d9e75; font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pf-unverified { font-size: 0.6rem; color: rgba(255,255,255,0.2); font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pf-joined { font-size: 0.68rem; color: rgba(255,255,255,0.25); font-family: 'Inter', sans-serif; }
        .pf-follow-row { display: flex; gap: 1.25rem; margin-top: 0.75rem; }
        .pf-follow-stat { display: flex; flex-direction: column; gap: 1px; }
        .pf-follow-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.2rem; font-weight: 300; color: #f5f0e8; line-height: 1; }
        .pf-follow-label { font-size: 0.56rem; color: rgba(255,255,255,0.3); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }

        .pf-body { max-width: 720px; margin: 0 auto; padding: 0 1.5rem 6rem; }

        .pf-bio-wrap { padding: 1.5rem 0 2rem; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 2rem; }
        .pf-bio-text { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.15rem; color: rgba(232,224,212,0.7); line-height: 1.75; font-style: italic; }
        .pf-bio-empty { font-size: 0.82rem; color: rgba(255,255,255,0.18); font-family: 'Inter', sans-serif; cursor: pointer; letter-spacing: 0.02em; }
        .pf-bio-empty:hover { color: rgba(255,255,255,0.35); }
        .pf-bio-edit-btn { background: none; border: none; font-size: 0.6rem; color: rgba(255,255,255,0.2); cursor: pointer; padding: 0 0 0 8px; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; transition: color 0.2s; vertical-align: middle; }
        .pf-bio-edit-btn:hover { color: #a78bfa; }
        .pf-bio-textarea { width: 100%; background: rgba(255,255,255,0.03); border: 1px solid rgba(167,139,250,0.2); border-radius: 12px; padding: 0.85rem 1rem; font-size: 1.05rem; color: #e8e0d4; font-family: 'Cormorant Garamond', Georgia, serif; resize: none; outline: none; line-height: 1.7; margin-top: 0.25rem; font-style: italic; }
        .pf-bio-textarea:focus { border-color: rgba(167,139,250,0.45); }
        .pf-bio-actions { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
        .pf-bio-save { background: #7c3aed; border: none; border-radius: 8px; padding: 0.5rem 1.2rem; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #fff; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.2s; }
        .pf-bio-save:hover { background: #6d28d9; }
        .pf-bio-cancel { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0.5rem 1.2rem; font-size: 0.65rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.3); cursor: pointer; font-family: 'Inter', sans-serif; }

        .pf-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; margin-bottom: 2.5rem; overflow: hidden; }
        .pf-stat { background: rgba(255,255,255,0.02); padding: 1.5rem 1.25rem; text-align: center; }
        .pf-stat-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 2.2rem; font-weight: 300; color: #f5f0e8; line-height: 1; margin-bottom: 0.4rem; }
        .pf-stat-label { font-size: 0.58rem; color: rgba(255,255,255,0.25); letter-spacing: 0.14em; text-transform: uppercase; font-family: 'Inter', sans-serif; }

        .pf-section { margin-bottom: 2.5rem; }
        .pf-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .pf-section-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.2rem; font-weight: 300; color: #f5f0e8; letter-spacing: 0.01em; }
        .pf-section-meta { font-size: 0.6rem; color: rgba(255,255,255,0.2); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }

        .pf-badge-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 1.25rem; }
        .pf-progress-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; }
        .pf-progress-current { font-size: 0.75rem; color: rgba(255,255,255,0.35); font-family: 'Inter', sans-serif; }
        .pf-progress-next { font-size: 0.62rem; color: rgba(255,255,255,0.18); font-family: 'Inter', sans-serif; }
        .pf-progress-bar-wrap { height: 2px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }
        .pf-progress-bar { height: 100%; border-radius: 2px; transition: width 0.8s cubic-bezier(0.22,1,0.36,1); }

        .pf-wallet { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; padding: 1.25rem; display: flex; align-items: center; justify-content: space-between; opacity: 0.35; }
        .pf-wallet-label { font-size: 0.58rem; color: rgba(255,255,255,0.3); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; margin-bottom: 4px; }
        .pf-wallet-amount { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.8rem; font-weight: 300; color: #f5f0e8; margin-bottom: 4px; }
        .pf-wallet-coming { font-size: 0.62rem; color: rgba(255,255,255,0.18); font-family: 'Inter', sans-serif; font-style: italic; }
        .pf-points-pill { background: rgba(107,47,173,0.1); border: 1px solid rgba(107,47,173,0.2); border-radius: 12px; padding: 0.6rem 1.25rem; text-align: center; }
        .pf-points-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.6rem; color: #9b6dff; line-height: 1; margin-bottom: 3px; }
        .pf-points-label { font-size: 0.52rem; color: rgba(155,109,255,0.4); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }

        .pf-placeholder { padding: 2rem; text-align: center; border: 1px solid rgba(255,255,255,0.04); border-radius: 16px; }
        .pf-placeholder p { font-size: 0.85rem; color: rgba(255,255,255,0.18); font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic; }

        .pf-account { display: flex; flex-direction: column; gap: 0.5rem; }
        .pf-account-row { display: flex; align-items: center; justify-content: space-between; padding: 0.9rem 1.1rem; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; }
        .pf-account-label { font-size: 0.8rem; color: rgba(255,255,255,0.35); font-family: 'Inter', sans-serif; }
        .pf-account-action { font-size: 0.6rem; color: #9b6dff; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; cursor: pointer; background: none; border: none; transition: color 0.2s; }
        .pf-account-action:hover { color: #c4b5fd; }
        .pf-pw-msg { font-size: 0.72rem; color: #86efac; font-family: 'Inter', sans-serif; margin-top: 0.5rem; padding: 0 0.5rem; }
        .pf-signout { width: 100%; margin-top: 1rem; background: none; border: 1px solid rgba(220,38,38,0.15); border-radius: 12px; padding: 0.8rem; font-size: 0.6rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(248,113,113,0.35); cursor: pointer; font-family: 'Inter', sans-serif; transition: color 0.2s, border-color 0.2s; }
        .pf-signout:hover { color: #f87171; border-color: rgba(220,38,38,0.35); }

        .pf-nav { display: flex; align-items: center; justify-content: space-between; max-width: 720px; margin: 0 auto; padding: 1.25rem 1.5rem; }
        .pf-nav-logo { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1rem; font-weight: 600; color: #f5f0e8; letter-spacing: 0.02em; }
        .pf-nav-logo span { color: #a78bfa; }
        .pf-nav-back { font-size: 0.65rem; color: rgba(255,255,255,0.25); letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; transition: color 0.2s; font-family: 'Inter', sans-serif; }
        .pf-nav-back:hover { color: rgba(255,255,255,0.5); }

        @media (max-width: 480px) {
          .pf-hero-content { flex-direction: column; align-items: flex-start; gap: 1rem; }
          .pf-name { font-size: 1.9rem; }
          .pf-avatar { width: 72px; height: 72px; font-size: 24px; }
        }
      `}</style>

      <div className="pf-nav">
        <div className="pf-nav-logo">Calvary <span>Scribblings</span></div>
        <a href="/" className="pf-nav-back">← Back to stories</a>
      </div>

      <div className="pf-hero">
        <div className="pf-hero-pattern" />
        <div className="pf-hero-gradient" />
        <div className="pf-hero-content">
          <div className="pf-avatar-wrap" onClick={() => !uploading && fileInputRef.current?.click()}>
            <div className="pf-avatar">
              {avatarUrl ? <img src={avatarUrl} alt={initials} /> : initials}
            </div>
            {uploading ? (
              <div className="pf-uploading"><div className="pf-spinner" /></div>
            ) : (
              <div className="pf-avatar-overlay">
                <div className="pf-avatar-overlay-text">Change<br/>photo</div>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} />

          <div className="pf-hero-info">
            <div className="pf-name">{user.displayName || 'Reader'}</div>
            <div className="pf-meta-row">
              {badge && (
                <span className="pf-badge-pill">
                  <BadgeIcon color={badge.color} size={13} isFounder={badge.isFounder} />
                  <span className="pf-badge-label" style={{ color: badge.color }}>{badge.label}</span>
                </span>
              )}
              {badge && <span className="pf-sep">·</span>}
              {user.emailVerified ? (
                <span className="pf-verified">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#1d9e75" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Verified
                </span>
              ) : (
                <span className="pf-unverified">Unverified</span>
              )}
            </div>
            <div className="pf-joined">Member since {joinDate}</div>
            <div className="pf-follow-row">
              <div className="pf-follow-stat">
                <div className="pf-follow-num">{followerCount}</div>
                <div className="pf-follow-label">Followers</div>
              </div>
              <div className="pf-follow-stat">
                <div className="pf-follow-num">{followingCount}</div>
                <div className="pf-follow-label">Following</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pf-body">
        <div className="pf-bio-wrap">
          {editingBio ? (
            <>
              <textarea
                className="pf-bio-textarea"
                value={bioEdit}
                onChange={e => setBioEdit(e.target.value)}
                placeholder="Write a short bio…"
                rows={3}
                maxLength={240}
                autoFocus
              />
              <div className="pf-bio-actions">
                <button className="pf-bio-save" onClick={handleSaveBio} disabled={savingBio}>
                  {savingBio ? 'Saving…' : 'Save'}
                </button>
                <button className="pf-bio-cancel" onClick={() => { setBioEdit(bio); setEditingBio(false); }}>Cancel</button>
              </div>
            </>
          ) : bio ? (
            <span>
              <span className="pf-bio-text">{bio}</span>
              <button className="pf-bio-edit-btn" onClick={() => setEditingBio(true)}>Edit</button>
            </span>
          ) : (
            <span className="pf-bio-empty" onClick={() => setEditingBio(true)}>+ Add a bio</span>
          )}
        </div>

        <div className="pf-stats">
          <div className="pf-stat">
            <div className="pf-stat-num">{readCount.toLocaleString()}</div>
            <div className="pf-stat-label">Stories read</div>
          </div>
          <div className="pf-stat">
            <div className="pf-stat-num">{commentCount}</div>
            <div className="pf-stat-label">Comments</div>
          </div>
          <div className="pf-stat">
            <div className="pf-stat-num">—</div>
            <div className="pf-stat-label">Bookmarks</div>
          </div>
        </div>

        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">Reading badge</div>
            <div className="pf-section-meta">{badge ? badge.label : 'No badge yet'}</div>
          </div>
          <div className="pf-badge-card">
            <div className="pf-progress-row">
              <div className="pf-progress-current">{readCount.toLocaleString()} {readCount === 1 ? 'story' : 'stories'} read</div>
              <div className="pf-progress-next">
                {nextBadge ? `${nextBadge.label} at ${nextBadge.threshold}` : badge ? 'Maximum tier reached' : 'Reader at 25'}
              </div>
            </div>
            <div className="pf-progress-bar-wrap">
              <div className="pf-progress-bar" style={{ width: `${tierProgress}%`, background: badge ? badge.color : '#333' }} />
            </div>
          </div>
        </div>

        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">Reader's Reward</div>
            <div className="pf-section-meta">Coming soon</div>
          </div>
          <div className="pf-wallet">
            <div>
              <div className="pf-wallet-label">Wallet balance</div>
              <div className="pf-wallet-amount">£0.00</div>
              <div className="pf-wallet-coming">Points system launching soon</div>
            </div>
            <div className="pf-points-pill">
              <div className="pf-points-num">0</div>
              <div className="pf-points-label">Points</div>
            </div>
          </div>
        </div>

        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">Bookmarks</div>
            <div className="pf-section-meta">Coming soon</div>
          </div>
          <div className="pf-placeholder">
            <p>Bookmarking is coming soon. Save stories to read later.</p>
          </div>
        </div>

        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">Account</div>
          </div>
          <div className="pf-account">
            <div className="pf-account-row">
              <span className="pf-account-label">{user.email}</span>
            </div>
            <div className="pf-account-row">
              <span className="pf-account-label">Password</span>
              <button className="pf-account-action" onClick={handleResetPassword} disabled={changingPassword}>
                {changingPassword ? 'Sending…' : 'Reset password'}
              </button>
            </div>
          </div>
          {pwMsg && <div className="pf-pw-msg">{pwMsg}</div>}
          <button className="pf-signout" onClick={handleSignOut}>Sign out</button>
        </div>
      </div>
    </>
  );
}