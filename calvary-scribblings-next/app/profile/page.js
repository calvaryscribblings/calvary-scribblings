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
    <div className="pf-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-modal">
        <div className="pf-modal-header">
          <div className="pf-modal-title">{title}</div>
          <button className="pf-modal-close" onClick={onClose}>×</button>
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
  const [loading, setLoading] = useState(true);

  const [showEdit, setShowEdit] = useState(false);
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);

  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editAvatarFile, setEditAvatarFile] = useState(null);
  const [editAvatarPreview, setEditAvatarPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [pwMsg, setPwMsg] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const fileInputRef = useRef(null);

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
          cover:s.cover|| '',
          category: s.category || '',
        }));
        setCmsStories(parsed);
      }
    })();
  }, []);

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
        const { ref, onValue } = await import('firebase/database');

        const unsubProfile = onValue(ref(db, `users/${u.uid}`), (snap) => {
          if (snap.exists()) {
            const d = snap.val();
            setProfileData(d);
            setReadCount(d.readCount || 0);
            if (d.readStories) {
              setReadStorySlugs(Object.keys(d.readStories));
            } else {
              setReadStorySlugs([]);
            }
          }
          setLoading(false);
        });
        unsubDB.push(unsubProfile);

        const unsubFollowers = onValue(ref(db, `followers/${u.uid}`), (snap) => {
          if (snap.exists()) {
            const uids = Object.keys(snap.val());
            setFollowerCount(uids.length);
            setFollowerUids(uids);
          } else { setFollowerCount(0); setFollowerUids([]); }
        });
        unsubDB.push(unsubFollowers);

        const unsubFollowing = onValue(ref(db, `following/${u.uid}`), (snap) => {
          if (snap.exists()) {
            const uids = Object.keys(snap.val());
            setFollowingCount(uids.length);
            setFollowingUids(uids);
          } else { setFollowingCount(0); setFollowingUids([]); }
        });
        unsubDB.push(unsubFollowing);

        const unsubComments = onValue(ref(db, 'comments'), (commentsSnap) => {
          if (commentsSnap.exists()) {
            let count = 0;
            for (const sc of Object.values(commentsSnap.val())) {
              for (const c of Object.values(sc)) {
                if (c.authorUid === u.uid) count++;
              }
            }
            setCommentCount(count);
          }
        });
        unsubDB.push(unsubComments);
      });
    })();

    return () => {
      if (unsubAuth) unsubAuth();
      unsubDB.forEach(fn => fn());
    };
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
    setSaving(true);
    setSaveError('');
    try {
      const db = await getDB();
      const { ref, update } = await import('firebase/database');
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
        setSaving(false);
        return;
      }
      const { updateProfile } = await import('firebase/auth');
      const newName = editName.trim() || authUser.displayName;
      await updateProfile(authUser, { displayName: newName });
      await update(ref(db, `users/${authUser.uid}`), {
        displayName: newName,
        bio: editBio.trim(),
        username: username || null,
        avatarUrl: newAvatarUrl,
      });
      setShowEdit(false);
    } catch (e) {
      console.error('Save failed:', e);
      setSaveError('Something went wrong. Please try again.');
    }
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

  if (loading) return <div style={{ minHeight: '100vh', background: '#080808' }} />;
  if (!authUser) return null;

  const avatarUrl = profileData?.avatarUrl || null;
  const displayName = profileData?.displayName || authUser.displayName || 'Reader';
  const username = profileData?.username || null;
  const bio = profileData?.bio || null;
  const badge = getBadge(readCount, authUser.uid);
  const nextBadge = getNextBadge(readCount, authUser.uid);
  const initials = displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const joinDate = authUser.metadata?.creationTime ? formatJoinDate(new Date(authUser.metadata.creationTime)) : 'Recently';
  const tierProgress = nextBadge
    ? Math.min(100, Math.round(((readCount - getPrevThreshold(nextBadge.threshold)) / (nextBadge.threshold - getPrevThreshold(nextBadge.threshold))) * 100))
    : 100;

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
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #080808; color: #e8e0d4; font-family: 'Inter', sans-serif; min-height: 100vh; }

        .pf-nav { display: flex; align-items: center; justify-content: space-between; max-width: 720px; margin: 0 auto; padding: 1.25rem 1.5rem; }
        .pf-nav-logo { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1rem; font-weight: 600; color: #f5f0e8; }
        .pf-nav-logo span { color: #a78bfa; }
        .pf-nav-back { font-size: 0.65rem; color: rgba(255,255,255,0.25); letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; transition: color 0.2s; font-family: 'Inter', sans-serif; }
        .pf-nav-back:hover { color: rgba(255,255,255,0.5); }

        .pf-hero { position: relative; min-height: 320px; display: flex; align-items: flex-end; overflow: hidden; background: #080808; }
        .pf-hero-gradient { position: absolute; inset: 0; background: linear-gradient(135deg, rgba(107,47,173,0.15) 0%, transparent 60%), linear-gradient(to top, #080808 0%, rgba(8,8,8,0.4) 60%, transparent 100%); z-index: 1; }
        .pf-hero-pattern { position: absolute; inset: 0; opacity: 0.04; background-image: radial-gradient(circle, #a78bfa 1px, transparent 1px); background-size: 32px 32px; z-index: 0; }
        .pf-hero-content { position: relative; z-index: 2; width: 100%; max-width: 720px; margin: 0 auto; padding: 2rem 1.5rem 2.5rem; display: flex; align-items: flex-end; gap: 1.5rem; }

        .pf-avatar { width: 88px; height: 88px; border-radius: 50%; background: rgba(107,47,173,0.2); border: 2px solid rgba(167,139,250,0.3); display: flex; align-items: center; justify-content: center; font-size: 30px; font-weight: 400; color: #c4b5fd; overflow: hidden; font-family: 'Cormorant Garamond', Georgia, serif; flex-shrink: 0; }
        .pf-avatar img { width: 100%; height: 100%; object-fit: cover; }

        .pf-hero-info { flex: 1; padding-bottom: 4px; }
        .pf-name { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 2.4rem; font-weight: 300; color: #f5f0e8; line-height: 1; margin-bottom: 0.3rem; letter-spacing: -0.01em; }
        .pf-username { font-size: 0.78rem; color: rgba(167,139,250,0.55); font-family: 'Inter', sans-serif; margin-bottom: 0.5rem; }
        .pf-meta-row { display: flex; align-items: center; gap: 8px; margin-bottom: 0.4rem; flex-wrap: wrap; }
        .pf-badge-pill { display: inline-flex; align-items: center; gap: 5px; }
        .pf-badge-label { font-size: 0.6rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pf-sep { color: rgba(255,255,255,0.15); font-size: 0.6rem; }
        .pf-verified { display: inline-flex; align-items: center; gap: 3px; font-size: 0.6rem; color: #1d9e75; font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pf-unverified { font-size: 0.6rem; color: rgba(255,255,255,0.2); font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pf-joined { font-size: 0.68rem; color: rgba(255,255,255,0.25); font-family: 'Inter', sans-serif; margin-bottom: 0.75rem; }
        .pf-follow-row { display: flex; gap: 1.25rem; }
        .pf-follow-stat { display: flex; flex-direction: column; gap: 1px; cursor: pointer; }
        .pf-follow-stat:hover .pf-follow-num { color: #a78bfa; }
        .pf-follow-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.2rem; font-weight: 300; color: #f5f0e8; line-height: 1; transition: color 0.2s; }
        .pf-follow-label { font-size: 0.56rem; color: rgba(255,255,255,0.3); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }

        .pf-body { max-width: 720px; margin: 0 auto; padding: 0 1.5rem 6rem; }

        .pf-bio-wrap { padding: 1.25rem 0 1.75rem; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 2rem; display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
        .pf-bio-text { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.1rem; color: rgba(232,224,212,0.65); line-height: 1.75; font-style: italic; flex: 1; }
        .pf-bio-empty { font-size: 0.8rem; color: rgba(255,255,255,0.18); font-family: 'Inter', sans-serif; cursor: pointer; font-style: italic; flex: 1; }
        .pf-bio-empty:hover { color: rgba(255,255,255,0.35); }
        .pf-edit-btn { background: none; border: 1px solid rgba(167,139,250,0.2); border-radius: 8px; padding: 0.35rem 0.85rem; font-size: 0.6rem; color: rgba(167,139,250,0.6); letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; cursor: pointer; transition: all 0.2s; white-space: nowrap; flex-shrink: 0; }
        .pf-edit-btn:hover { border-color: rgba(167,139,250,0.5); color: #a78bfa; }

        .pf-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; margin-bottom: 2.5rem; overflow: hidden; }
        .pf-stat { background: rgba(255,255,255,0.02); padding: 1.5rem 1.25rem; text-align: center; }
        .pf-stat-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 2.2rem; font-weight: 300; color: #f5f0e8; line-height: 1; margin-bottom: 0.4rem; }
        .pf-stat-label { font-size: 0.58rem; color: rgba(255,255,255,0.25); letter-spacing: 0.14em; text-transform: uppercase; font-family: 'Inter', sans-serif; }

        .pf-section { margin-bottom: 2.5rem; }
        .pf-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .pf-section-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.2rem; font-weight: 300; color: #f5f0e8; }
        .pf-section-meta { font-size: 0.6rem; color: rgba(255,255,255,0.2); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }

        .pf-stories-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.75rem; }
        .pf-story-card { display: block; text-decoration: none; border-radius: 8px; overflow: hidden; position: relative; aspect-ratio: 2/3; background: rgba(255,255,255,0.04); transition: transform 0.2s, opacity 0.2s; }
        .pf-story-card:hover { transform: scale(1.03); opacity: 0.9; }
        .pf-story-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .pf-story-card-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 50%); display: flex; align-items: flex-end; padding: 0.5rem; opacity: 0; transition: opacity 0.2s; }
        .pf-story-card:hover .pf-story-card-overlay { opacity: 1; }
        .pf-story-card-title { font-size: 0.6rem; color: #fff; font-family: 'Cormorant Garamond', Georgia, serif; line-height: 1.3; }

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

        .pf-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000; display: flex; align-items: flex-end; justify-content: center; }
        @media (min-width: 600px) { .pf-modal-backdrop { align-items: center; } }
        .pf-modal { background: #111; border: 1px solid rgba(255,255,255,0.08); border-radius: 20px 20px 0 0; width: 100%; max-width: 520px; padding: 2rem 1.5rem 2.5rem; max-height: 90vh; overflow-y: auto; }
        @media (min-width: 600px) { .pf-modal { border-radius: 20px; } }
        .pf-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.75rem; }
        .pf-modal-title { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.3rem; font-weight: 300; color: #f5f0e8; }
        .pf-modal-close { background: none; border: none; color: rgba(255,255,255,0.3); font-size: 1.4rem; cursor: pointer; padding: 0; line-height: 1; transition: color 0.2s; }
        .pf-modal-close:hover { color: rgba(255,255,255,0.6); }
        .pf-modal-avatar-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
        .pf-modal-avatar { width: 64px; height: 64px; border-radius: 50%; background: rgba(107,47,173,0.2); border: 2px solid rgba(167,139,250,0.3); display: flex; align-items: center; justify-content: center; font-size: 22px; color: #c4b5fd; overflow: hidden; font-family: 'Cormorant Garamond', Georgia, serif; flex-shrink: 0; }
        .pf-modal-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .pf-modal-avatar-btn { background: none; border: 1px solid rgba(167,139,250,0.3); border-radius: 8px; padding: 0.45rem 1rem; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(167,139,250,0.7); cursor: pointer; font-family: 'Inter', sans-serif; transition: all 0.2s; }
        .pf-modal-avatar-btn:hover { border-color: rgba(167,139,250,0.6); color: #a78bfa; }
        .pf-field { margin-bottom: 1.1rem; }
        .pf-field-label { font-size: 0.6rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.3); font-family: 'Inter', sans-serif; margin-bottom: 0.4rem; display: block; }
        .pf-field-input { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.75rem 1rem; font-size: 0.9rem; color: #e8e0d4; font-family: 'Inter', sans-serif; outline: none; transition: border-color 0.2s; }
        .pf-field-input:focus { border-color: rgba(167,139,250,0.4); }
        .pf-field-textarea { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 0.75rem 1rem; font-size: 0.95rem; color: rgba(232,224,212,0.85); font-family: 'Cormorant Garamond', Georgia, serif; font-style: italic; outline: none; resize: none; line-height: 1.7; transition: border-color 0.2s; }
        .pf-field-textarea:focus { border-color: rgba(167,139,250,0.4); }
        .pf-field-hint { font-size: 0.6rem; color: rgba(255,255,255,0.18); font-family: 'Inter', sans-serif; margin-top: 0.3rem; }
        .pf-username-wrap { position: relative; }
        .pf-username-at { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: rgba(167,139,250,0.5); font-family: 'Inter', sans-serif; font-size: 0.9rem; pointer-events: none; }
        .pf-username-input { padding-left: 1.75rem !important; }
        .pf-save-error { font-size: 0.72rem; color: #f87171; font-family: 'Inter', sans-serif; margin-bottom: 0.75rem; }
        .pf-modal-actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
        .pf-modal-save { flex: 1; background: #7c3aed; border: none; border-radius: 10px; padding: 0.75rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.2s; }
        .pf-modal-save:hover { background: #6d28d9; }
        .pf-modal-save:disabled { opacity: 0.5; cursor: not-allowed; }
        .pf-modal-cancel { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 0.75rem 1.25rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.3); cursor: pointer; font-family: 'Inter', sans-serif; }

        @media (max-width: 480px) {
          .pf-hero-content { flex-direction: column; align-items: flex-start; gap: 1rem; }
          .pf-name { font-size: 1.9rem; }
          .pf-avatar { width: 72px; height: 72px; font-size: 24px; }
          .pf-stories-grid { grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); }
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
          <div className="pf-avatar">
            {avatarUrl ? <img src={avatarUrl} alt={initials} /> : initials}
          </div>
          <div className="pf-hero-info">
            <div className="pf-name">{displayName}</div>
            {username && <div className="pf-username">@{username}</div>}
            <div className="pf-meta-row">
              {badge && (
                <span className="pf-badge-pill">
                  <BadgeIcon color={badge.color} size={13} isFounder={badge.isFounder} />
                  <span className="pf-badge-label" style={{ color: badge.color }}>{badge.label}</span>
                </span>
              )}
              {badge && <span className="pf-sep">·</span>}
              {authUser.emailVerified ? (
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
        </div>
      </div>

      <div className="pf-body">
        <div className="pf-bio-wrap">
          {bio
            ? <span className="pf-bio-text">{bio}</span>
            : <span className="pf-bio-empty" onClick={openEdit}>+ Add a bio</span>
          }
          <button className="pf-edit-btn" onClick={openEdit}>Edit profile</button>
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

        {readStories.length > 0 && (
          <div className="pf-section">
            <div className="pf-section-header">
              <div className="pf-section-title">Stories read</div>
              <div className="pf-section-meta">{readStories.length} shown</div>
            </div>
            <div className="pf-stories-grid">
              {readStories.map(s => (
                <a key={s.id} href={`/stories/${s.id}`} className="pf-story-card" title={s.title}>
                  <img src={s.cover} alt={s.title} loading="lazy" />
                  <div className="pf-story-card-overlay">
                    <div className="pf-story-card-title">{s.title}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

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
              <span className="pf-account-label">{authUser.email}</span>
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

      {showFollowers && <UserListModal title={`Followers · ${followerCount}`} uids={followerUids} onClose={() => setShowFollowers(false)} />}
      {showFollowing && <UserListModal title={`Following · ${followingCount}`} uids={followingUids} onClose={() => setShowFollowing(false)} />}

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
    </>
  );
}