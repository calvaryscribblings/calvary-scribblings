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
const HEART_PATH = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

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
          <div style={{ padding: '1.5rem 0', color: 'rgba(255,255,255,0.95)', fontSize: '0.82rem', fontFamily: 'Inter, sans-serif' }}>Loading…</div>
        ) : users.length === 0 ? (
          <div style={{ padding: '1.5rem 0', color: '#ffffff', fontSize: '0.85rem', fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif', fontStyle: 'italic' }}>No one here yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {users.map(({ uid, data }) => {
              const initials = (data.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
              const badge = getBadge(data.readCount || 0, uid);
              return (
                <a key={uid} href={`/user?id=${uid}`} style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', textDecoration: 'none', padding: '0.6rem 0.75rem', borderRadius: '10px', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1.5px solid rgba(167,139,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0 }}>
                    {data.avatarUrl ? <img src={data.avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', color: '#ffffff', fontFamily: 'Inter, sans-serif', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.displayName || 'Reader'}</div>
                    {data.username && <div style={{ fontSize: '0.7rem', color: 'rgba(167,139,250,0.55)', fontFamily: 'Inter, sans-serif' }}>@{data.username}</div>}
                  </div>
                  {data.isAuthor ? <WriterBadge size={13} /> : badge && <BadgeIcon color={badge.color} size={14} isFounder={badge.isFounder} />}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CommentHistoryModal({ uid, displayName, onClose, allStoriesMerged }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [libNotifs, setLibNotifs] = useState([]);
  const [showLibNotifs, setShowLibNotifs] = useState(false);
  const [headerImg, setHeaderImg] = useState(null);
  const [libNotifsRead, setLibNotifsRead] = useState(false);

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
          <div style={{ color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', padding: '1rem 0' }}>Loading…</div>
        ) : comments.length === 0 ? (
          <div style={{ color: '#ffffff', fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '0.9rem' }}>No comments yet.</div>
        ) : comments.map(c => {
          const story = allStoriesMerged.find(s => s.id === c.slug);
          return (
            <a key={c.id} href={`/stories/${c.slug}`} style={{ display: 'block', textDecoration: 'none', padding: '0.85rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'opacity 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
              {story && (
                <div style={{ fontSize: '0.68rem', color: 'rgba(155,109,255,0.6)', fontFamily: 'Inter, sans-serif', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                  {story.title}
                </div>
              )}
              <div style={{ fontSize: '0.9rem', color: '#ffffff', fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif', lineHeight: 1.65, marginBottom: 4 }}>{c.text}</div>
              <div style={{ fontSize: '0.65rem', color: '#ffffff', fontFamily: 'Inter, sans-serif' }}>{timeAgo(c.createdAt)}</div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function SquarePostsModal({ uid, onClose }) {
  const [squarePosts, setSquarePosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [libNotifs, setLibNotifs] = useState([]);
  const [showLibNotifs, setShowLibNotifs] = useState(false);
  const [libNotifsRead, setLibNotifsRead] = useState(false);

  useEffect(() => {
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, `user_square_posts/${uid}`));
      if (!snap.exists()) { setLoading(false); return; }
      const list = Object.entries(snap.val()).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.createdAt - a.createdAt);
      setSquarePosts(list);
      setLoading(false);
    })();
  }, [uid]);

  return (
    <div className="pf-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-modal">
        <div className="pf-modal-header">
          <div className="pf-modal-title">My Square Posts</div>
          <button className="pf-modal-close" onClick={onClose}>×</button>
        </div>
        {loading ? (
          <div style={{ color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', padding: '1rem 0' }}>Loading…</div>
        ) : squarePosts.length === 0 ? (
          <div style={{ color: '#ffffff', fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '0.9rem' }}>No Square posts yet.</div>
        ) : squarePosts.map(p => (
          <div key={p.id} style={{ padding: '0.85rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: '0.92rem', color: '#ffffff', fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif', lineHeight: 1.7, marginBottom: 4 }}>{p.text}</div>
            <div style={{ fontSize: '0.65rem', color: '#ffffff', fontFamily: 'Inter, sans-serif' }}>{timeAgo(p.createdAt)}</div>
          </div>
        ))}
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
  const [points, setPoints] = useState(0);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [libNotifs, setLibNotifs] = useState([]);
  const [showLibNotifs, setShowLibNotifs] = useState(false);
  const [libNotifsRead, setLibNotifsRead] = useState(false);
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const fileInputRef = useRef(null);

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
  const joinDate = authUser.metadata?.creationTime ? formatJoinDate(new Date(authUser.metadata.creationTime)) : 'Recently';
  const tierProgress = nextBadge ? Math.min(100, Math.round(((readCount - getPrevThreshold(nextBadge.threshold)) / (nextBadge.threshold - getPrevThreshold(nextBadge.threshold))) * 100)) : 100;

  const allStoriesMerged = [...allStories, ...cmsStories.filter(cs => !allStories.find(s => s.id === cs.id))];
  const readStories = readStorySlugs.map(slug => allStoriesMerged.find(s => s.id === slug)).filter(Boolean);
  const visibleStories = showAllStories ? readStories : readStories.slice(0, 10);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0d0d0d; color: #e8e0d4; font-family: 'Inter', sans-serif; min-height: 100vh; }

        .pf-nav { display: flex; align-items: center; justify-content: space-between; max-width: 740px; margin: 0 auto; padding: 1.25rem 1.5rem; }
        .pf-nav-logo { font-family: Cochin, Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.05rem; font-weight: 600; color: #f5f0e8; letter-spacing: 0.01em; }
        .pf-nav-logo span { color: #a78bfa; }
        .pf-nav-back { font-size: 0.65rem; color: rgba(255,255,255,0.95); letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; transition: color 0.2s; font-family: 'Inter', sans-serif; }
        .pf-nav-back:hover { color: rgba(255,255,255,0.95); }

        .pf-header-banner { position: relative; width: 100%; height: 160px; overflow: hidden; background: linear-gradient(120deg, #1a0a2e 0%, #2d1b4e 40%, #1a1200 70%, #2a1a00 100%); cursor: pointer; }
        .pf-header-banner::after { content: ''; position: absolute; inset: 0; background: linear-gradient(120deg, rgba(107,47,173,0.35) 0%, transparent 50%, rgba(201,164,76,0.12) 100%); pointer-events: none; }
        .pf-edit-btn-header { position: absolute; bottom: 12px; right: 14px; z-index: 2; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.18); border-radius: 8px; padding: 6px 14px; font-size: 0.6rem; color: rgba(255,255,255,0.85); font-family: Inter, sans-serif; letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; }
        .pf-edit-btn-header:hover { background: rgba(107,47,173,0.4); border-color: rgba(167,139,250,0.4); color: #fff; }
        .pf-hero { position: relative; background: #0d0d0d; }
        .pf-hero-content { position: relative; width: 100%; max-width: 740px; margin: -52px auto 0; padding: 0 1.5rem 1rem; display: flex; align-items: flex-end; gap: 1rem; }
        .pf-hero-right { position: absolute; top: 8px; right: 1.5rem; }

        .pf-avatar { width: 88px; height: 88px; border-radius: 50%; background: rgba(107,47,173,0.3); border: 3px solid #0d0d0d; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 400; color: #c4b5fd; overflow: hidden; font-family: Cochin, Cormorant Garamond, Georgia, serif; flex-shrink: 0; box-shadow: 0 0 0 2px rgba(201,164,76,0.2); }
        .pf-avatar img { width: 100%; height: 100%; object-fit: cover; }

        .pf-hero-info { flex: 1; padding-bottom: 4px; min-width: 0; }
        .pf-name-row { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 0.25rem; }
        .pf-name { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: clamp(1.3rem, 3.5vw, 1.7rem); font-weight: 400; color: #ffffff; line-height: 1; letter-spacing: -0.01em; }
        .pf-username { font-size: 0.75rem; color: rgba(167,139,250,0.55); font-family: 'Inter', sans-serif; margin-bottom: 0.4rem; }
        .pf-meta-row { display: flex; align-items: center; gap: 8px; margin-bottom: 0.5rem; flex-wrap: wrap; }
        .pf-badge-pill { display: inline-flex; align-items: center; gap: 5px; }
        .pf-badge-label { font-size: 0.62rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pf-sep { color: rgba(255,255,255,0.15); font-size: 0.7rem; }
        .pf-verified { display: inline-flex; align-items: center; gap: 3px; font-size: 0.62rem; color: #1d9e75; font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pf-unverified { font-size: 0.62rem; color: #ffffff; font-family: 'Inter', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
        .pf-joined { font-size: 0.65rem; color: rgba(255,255,255,0.45); font-family: 'Inter', sans-serif; margin-bottom: 0.5rem; }
        .pf-follow-row { display: flex; gap: 1.25rem; margin-bottom: 0.25rem; }
        .pf-follow-stat { display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
        .pf-follow-stat:hover .pf-follow-num { color: #a78bfa; }
        .pf-follow-num { font-family: Inter, sans-serif; font-size: 0.95rem; font-weight: 600; color: #ffffff; line-height: 1; transition: color 0.2s; }
        .pf-follow-label { font-size: 0.56rem; color: rgba(255,255,255,0.4); letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; }

        .pf-body { max-width: 740px; margin: 0 auto; padding: 0 1.5rem 6rem; }

        .pf-bio-wrap { padding: 1.25rem 0 2rem; border-bottom: 1px solid rgba(255,255,255,0.07); margin-bottom: 2.5rem; }
        .pf-bio-text { font-family: Cochin, Cormorant Garamond, Georgia, serif; font-size: 0.95rem; color: #f5f0e8; line-height: 1.75; flex: 1; }
        .pf-bio-empty { font-size: 0.82rem; color: #ffffff; font-family: 'Inter', sans-serif; cursor: pointer; flex: 1; transition: color 0.2s; }
        .pf-bio-empty:hover { color: rgba(255,255,255,0.4); }
        .pf-edit-btn { background: none; border: 1px solid rgba(167,139,250,0.25); border-radius: 8px; padding: 0.4rem 1rem; font-size: 0.62rem; color: rgba(167,139,250,0.65); letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; cursor: pointer; transition: all 0.2s; white-space: nowrap; flex-shrink: 0; }
        .pf-edit-btn:hover { border-color: rgba(167,139,250,0.55); color: #a78bfa; }

        .pf-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.07); border-radius: 18px; margin-bottom: 2.5rem; overflow: hidden; }
        .pf-stat { background: rgba(255,255,255,0.03); padding: 1.75rem 1.25rem; text-align: center; transition: background 0.2s; }
        .pf-stat:hover { background: rgba(255,255,255,0.05); }
        .pf-stat-num { font-family: Cochin, Cochin, Cormorant Garamond, Georgia, serif; font-size: 2.6rem; font-weight: 400; color: #f5f0e8; line-height: 1; margin-bottom: 0.5rem; }
        .pf-stat-label { font-size: 0.58rem; color: rgba(255,255,255,0.95); letter-spacing: 0.16em; text-transform: uppercase; font-family: 'Inter', sans-serif; }

        .pf-section { margin-bottom: 2.5rem; }
        .pf-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.1rem; padding-bottom: 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.07); }
        .pf-section-title { font-family: Cochin, Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.3rem; font-weight: 400; color: #f5f0e8; letter-spacing: 0.01em; }
        .pf-section-meta { font-size: 0.6rem; color: #ffffff; letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }

        .pf-story-list { display: flex; flex-direction: column; }
        .pf-story-row { display: flex; align-items: center; gap: 12px; padding: 0.75rem 0; border-bottom: 1px solid rgba(255,255,255,0.05); text-decoration: none; transition: opacity 0.2s; }
        .pf-story-row:hover { opacity: 0.75; }
        .pf-story-thumb { width: 36px; height: 52px; border-radius: 4px; overflow: hidden; flex-shrink: 0; background: rgba(107,47,173,0.15); }
        .pf-story-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .pf-story-info { flex: 1; min-width: 0; }
        .pf-story-title { font-family: Cochin, Cochin, Cormorant Garamond, Georgia, serif; font-size: 0.92rem; color: #f5f0e8; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pf-story-author { font-size: 0.68rem; color: rgba(255,255,255,0.92); font-family: 'Inter', sans-serif; margin-top: 2px; }
        .pf-more-btn { background: none; border: none; font-size: 0.72rem; color: rgba(155,109,255,0.6); font-family: 'Inter', sans-serif; cursor: pointer; padding: 0.75rem 0 0; letter-spacing: 0.08em; text-decoration: underline; text-underline-offset: 2px; }
        .pf-more-btn:hover { color: #a78bfa; }

        .pf-badge-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; padding: 1.5rem; }
        .pf-progress-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
        .pf-progress-current { font-size: 0.78rem; color: #ffffff; font-family: 'Inter', sans-serif; }
        .pf-progress-next { font-size: 0.65rem; color: #ffffff; font-family: 'Inter', sans-serif; }
        .pf-progress-bar-wrap { height: 3px; background: rgba(255,255,255,0.07); border-radius: 3px; overflow: hidden; }
        .pf-progress-bar { height: 100%; border-radius: 3px; transition: width 0.8s cubic-bezier(0.22,1,0.36,1); }

        .pf-rewards-btn { display: block; width: 100%; text-decoration: none; position: relative; overflow: hidden; background: linear-gradient(135deg, #1a0a2e 0%, #0d1a12 50%, #1a0a2e 100%); border: 1px solid rgba(107,47,173,0.3); border-radius: 20px; padding: 2rem; transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease; cursor: pointer; }
        .pf-rewards-btn::before { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(107,47,173,0.15) 0%, rgba(29,158,117,0.08) 50%, rgba(107,47,173,0.15) 100%); opacity: 0; transition: opacity 0.3s ease; }
        .pf-rewards-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(107,47,173,0.25), 0 0 0 1px rgba(107,47,173,0.4); border-color: rgba(107,47,173,0.5); }
        .pf-rewards-btn:hover::before { opacity: 1; }
        .pf-rewards-btn-inner { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; }
        .pf-rewards-left { display: flex; flex-direction: column; gap: 0.5rem; }
        .pf-rewards-eyebrow { font-size: 0.58rem; color: rgba(155,109,255,0.6); letter-spacing: 0.2em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pf-rewards-title { font-family: Cochin, Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.6rem; font-weight: 400; color: #f5f0e8; line-height: 1.1; }
        .pf-rewards-sub { font-size: 0.72rem; color: rgba(232,224,212,0.4); font-family: 'Inter', sans-serif; margin-top: 0.25rem; }
        .pf-rewards-right { display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem; }
        .pf-rewards-points { font-family: Cochin, Cochin, Cormorant Garamond, Georgia, serif; font-size: 2.8rem; font-weight: 400; color: #9b6dff; line-height: 1; }
        .pf-rewards-points-label { font-size: 0.55rem; color: rgba(155,109,255,0.45); letter-spacing: 0.14em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
        .pf-rewards-wallet { font-size: 0.72rem; color: rgba(29,158,117,0.7); font-family: 'Inter', sans-serif; margin-top: 0.25rem; }
        .pf-rewards-arrow { font-size: 1.2rem; color: rgba(167,139,250,0.4); margin-top: 0.5rem; transition: transform 0.2s, color 0.2s; }
        .pf-rewards-btn:hover .pf-rewards-arrow { transform: translateX(4px); color: rgba(167,139,250,0.8); }
        .pf-rewards-shimmer { position: absolute; top: 0; left: -100%; width: 60%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent); animation: pf-shimmer 3s infinite; }
        @keyframes pf-shimmer { 0% { left: -100%; } 100% { left: 200%; } }

        .pf-square-btn { display: flex; align-items: center; justify-content: space-between; width: 100%; background: rgba(107,47,173,0.06); border: 1px solid rgba(107,47,173,0.18); border-radius: 12px; padding: 1rem 1.25rem; cursor: pointer; text-align: left; transition: all 0.2s; }
        .pf-square-btn:hover { background: rgba(107,47,173,0.12); border-color: rgba(107,47,173,0.35); }

        .pf-placeholder { padding: 2rem; text-align: center; border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; background: rgba(255,255,255,0.01); }
        .pf-placeholder p { font-size: 0.88rem; color: #ffffff; font-family: Cochin, Cochin, Cormorant Garamond, Georgia, serif; font-style: italic; }

        .pf-account { display: flex; flex-direction: column; gap: 0.5rem; }
        .pf-account-row { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.25rem; background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; }
        .pf-account-label { font-size: 0.82rem; color: rgba(255,255,255,0.4); font-family: 'Inter', sans-serif; }
        .pf-account-action { font-size: 0.62rem; color: #9b6dff; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; cursor: pointer; background: none; border: none; transition: color 0.2s; }
        .pf-account-action:hover { color: #c4b5fd; }
        .pf-pw-msg { font-size: 0.72rem; color: #86efac; font-family: 'Inter', sans-serif; margin-top: 0.5rem; padding: 0 0.5rem; }
        .pf-signout { width: 100%; margin-top: 1rem; background: none; border: 1px solid rgba(220,38,38,0.15); border-radius: 12px; padding: 0.9rem; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(248,113,113,0.35); cursor: pointer; font-family: 'Inter', sans-serif; transition: color 0.2s, border-color 0.2s; }
        .pf-signout:hover { color: #f87171; border-color: rgba(220,38,38,0.4); }

        .pf-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 1000; display: flex; align-items: flex-end; justify-content: center; }
        .lib-notif-panel { position: fixed; top: 0; right: 0; width: min(380px, 100vw); height: 100vh; background: #0d0d0d; border-left: 1px solid rgba(255,255,255,0.08); z-index: 2000; display: flex; flex-direction: column; animation: slideInRight 0.3s ease; }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .lib-notif-item { padding: 1rem 1.25rem; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; gap: 10px; align-items: flex-start; }
        .lib-notif-item.unread { background: rgba(107,47,173,0.06); }
        @media (min-width: 600px) { .pf-modal-backdrop { align-items: center; } }
        .pf-modal { background: #141414; border: 1px solid rgba(255,255,255,0.09); border-radius: 20px 20px 0 0; width: 100%; max-width: 520px; padding: 2rem 1.5rem 2.5rem; max-height: 90vh; overflow-y: auto; }
        @media (min-width: 600px) { .pf-modal { border-radius: 20px; } }
        .pf-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.75rem; }
        .pf-modal-title { font-family: Cochin, Cochin, Cormorant Garamond, Georgia, serif; font-size: 1.4rem; font-weight: 400; color: #f5f0e8; }
        .pf-modal-close { background: none; border: none; color: rgba(255,255,255,0.95); font-size: 1.4rem; cursor: pointer; padding: 0; line-height: 1; transition: color 0.2s; }
        .pf-modal-close:hover { color: rgba(255,255,255,0.95); }
        .pf-modal-avatar-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
        .pf-modal-avatar { width: 64px; height: 64px; border-radius: 50%; background: rgba(107,47,173,0.2); border: 2px solid rgba(167,139,250,0.3); display: flex; align-items: center; justify-content: center; font-size: 22px; color: #c4b5fd; overflow: hidden; font-family: Cochin, Cochin, Cormorant Garamond, Georgia, serif; flex-shrink: 0; }
        .pf-modal-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .pf-modal-avatar-btn { background: none; border: 1px solid rgba(167,139,250,0.3); border-radius: 8px; padding: 0.45rem 1rem; font-size: 0.62rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(167,139,250,0.7); cursor: pointer; font-family: 'Inter', sans-serif; transition: all 0.2s; }
        .pf-modal-avatar-btn:hover { border-color: rgba(167,139,250,0.6); color: #a78bfa; }
        .pf-field { margin-bottom: 1.1rem; }
        .pf-field-label { font-size: 0.62rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.95); font-family: 'Inter', sans-serif; margin-bottom: 0.4rem; display: block; }
        .pf-field-input { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); border-radius: 10px; padding: 0.8rem 1rem; font-size: 0.9rem; color: #e8e0d4; font-family: 'Inter', sans-serif; outline: none; transition: border-color 0.2s; }
        .pf-field-input:focus { border-color: rgba(167,139,250,0.45); }
        .pf-field-textarea { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); border-radius: 10px; padding: 0.8rem 1rem; font-size: 1rem; color: rgba(232,224,212,0.85); font-family: Cochin, Cochin, Cormorant Garamond, Georgia, serif; font-style: italic; outline: none; resize: none; line-height: 1.75; transition: border-color 0.2s; }
        .pf-field-textarea:focus { border-color: rgba(167,139,250,0.45); }
        .pf-field-hint { font-size: 0.62rem; color: #ffffff; font-family: 'Inter', sans-serif; margin-top: 0.3rem; }
        .pf-username-wrap { position: relative; }
        .pf-username-at { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: rgba(167,139,250,0.5); font-family: 'Inter', sans-serif; font-size: 0.9rem; pointer-events: none; }
        .pf-username-input { padding-left: 1.75rem !important; }
        .pf-save-error { font-size: 0.72rem; color: #f87171; font-family: 'Inter', sans-serif; margin-bottom: 0.75rem; }
        .pf-modal-actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
        .pf-modal-save { flex: 1; background: #7c3aed; border: none; border-radius: 10px; padding: 0.8rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.2s; }
        .pf-modal-save:hover { background: #6d28d9; }
        .pf-modal-save:disabled { opacity: 0.5; cursor: not-allowed; }
        .pf-modal-cancel { background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 0.8rem 1.25rem; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.95); cursor: pointer; font-family: 'Inter', sans-serif; }

        @media (max-width: 480px) {
          .pf-hero-content { flex-direction: column; align-items: flex-start; gap: 1.25rem; }
          .pf-name { font-size: 2rem; }
          .pf-avatar { width: 76px; height: 76px; font-size: 26px; }
          .pf-rewards-title { font-size: 1.3rem; }
          .pf-rewards-points { font-size: 2.2rem; }
        }
      `}</style>

      <div className="pf-nav">
        <div className="pf-nav-logo">Calvary <span>Scribblings</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <button onClick={() => { setShowLibNotifs(true); markLibNotifsRead(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, position: 'relative', display: 'flex', alignItems: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {libNotifs.filter(n => !n.read).length > 0 && !libNotifsRead && (
              <span style={{ position: 'absolute', top: -4, right: -4, background: '#6b2fad', color: '#fff', fontSize: '0.5rem', fontFamily: 'Inter, sans-serif', fontWeight: 700, borderRadius: '999px', minWidth: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                {libNotifs.filter(n => !n.read).length}
              </span>
            )}
          </button>
          <a href="/" className="pf-nav-back">← Back to stories</a>
        </div>
      </div>

      <div className="pf-hero">
        <div className="pf-header-banner" style={headerImg ? { backgroundImage: `url(${headerImg})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
          <button className="pf-edit-btn-header" onClick={openEdit}>Edit profile</button>
        </div>
        <div className="pf-hero-content">
          <div className="pf-avatar">
            {avatarUrl ? <img src={avatarUrl} alt={initials} /> : initials}
          </div>
          <div className="pf-hero-info">
            <div className="pf-name-row">
              <span className="pf-name">{displayName}</span>
              {username && <span className="pf-username">@{username}</span>}
            </div>
            <div className="pf-meta-row">
              {isAuthor ? <WriterBadge size={13} /> : badge ? (
                <span className="pf-badge-pill">
                  <BadgeIcon color={badge.color} size={13} isFounder={badge.isFounder} />
                  <span className="pf-badge-label" style={{ color: badge.color }}>{badge.label}</span>
                </span>
              ) : null}
              <span className="pf-sep">·</span>
              {authUser.emailVerified ? (
                <span className="pf-verified">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#1d9e75" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Verified
                </span>
              ) : <span className="pf-unverified">Unverified</span>}
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
          {bio ? <span className="pf-bio-text">{bio}</span> : <span className="pf-bio-empty" onClick={openEdit}>+ Add a bio</span>}
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

        {/* Stories read — list */}
        {readStories.length > 0 && (
          <div className="pf-section">
            <div className="pf-section-header">
              <div className="pf-section-title">Stories read</div>
              <div className="pf-section-meta">{readStories.length} total</div>
            </div>
            <div className="pf-story-list">
              {visibleStories.map(s => (
                <a key={s.id} href={`/stories/${s.id}`} className="pf-story-row">
                  <div className="pf-story-thumb">
                    {s.cover && <img src={s.cover} alt={s.title} loading="lazy" />}
                  </div>
                  <div className="pf-story-info">
                    <div className="pf-story-title">{s.title}</div>
                    <div className="pf-story-author">by {s.author}</div>
                  </div>
                </a>
              ))}
            </div>
            {readStories.length > 10 && !showAllStories && (
              <button className="pf-more-btn" onClick={() => setShowAllStories(true)}>
                more… ({readStories.length - 10} more stories)
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
                {isAuthor ? 'Platform writer' : nextBadge ? `${nextBadge.label} at ${nextBadge.threshold}` : badge ? 'Maximum tier reached' : 'Reader at 25'}
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
            <div className="pf-rewards-btn-inner">
              <div className="pf-rewards-left">
                <div className="pf-rewards-eyebrow">The Story Island</div>
                <div className="pf-rewards-title">Your Rewards</div>
                <div className="pf-rewards-sub">Read · Comment · Earn · Cash out</div>
              </div>
              <div className="pf-rewards-right">
                <div className="pf-rewards-points">{points}</div>
                <div className="pf-rewards-points-label">Points</div>
                {walletBalance > 0 && <div className="pf-rewards-wallet">{formatPence(walletBalance)} in wallet</div>}
                <div className="pf-rewards-arrow">→</div>
              </div>
            </div>
          </a>
        </div>

        {/* Square posts */}
        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">The Scribblings Square</div>
            {squarePosts.length > 0 && <div className="pf-section-meta">{squarePosts.length} posts</div>}
          </div>
          {squarePosts.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.35)', fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif', fontSize: '0.9rem', padding: '0.5rem 0' }}>No Square posts yet.</div>
          ) : squarePosts.slice(0, 5).map(p => (
            <div key={p.id} style={{ padding: '1rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(107,47,173,0.25)', border: '1.5px solid rgba(107,47,173,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0 }}>
                  {avatarUrl ? <img src={avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: 2 }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 500, color: '#ffffff', fontFamily: 'Inter, sans-serif' }}>{displayName}</span>
                    {username && <span style={{ fontSize: '0.68rem', color: 'rgba(167,139,250,0.55)', fontFamily: 'Inter, sans-serif' }}>@{username}</span>}
                    {isAuthor && <WriterBadge size={11} />}
                    <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter, sans-serif' }}>{timeAgo(p.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: '0.95rem', color: '#ffffff', fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif', lineHeight: 1.7 }}>{p.text}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '16px', paddingLeft: '46px' }}>
                {[
                  { type: 'like', activeColor: '#d4537e', d: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z' },
                  { type: 'clap', activeColor: '#d4941a', d: 'M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3' },
                  { type: 'fire', activeColor: '#ef4444', d: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z' },
                ].map(({ type, activeColor, d }) => {
                  const count = p[type + 'Count'] || p.likeCount && type === 'like' ? (p.likeCount || 0) : 0;
                  return (
                    <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'rgba(255,255,255,0.4)' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>
                      {count > 0 && <span style={{ fontSize: '0.6rem', fontFamily: 'Inter, sans-serif' }}>{count}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {squarePosts.length > 5 && (
            <button className="pf-more-btn" onClick={() => setShowSquarePosts(true)}>
              more… ({squarePosts.length - 5} more posts)
            </button>
          )}
        </div>

        {/* Reading Progress */}
        <div className="pf-section">
          <div className="pf-section-header">
            <div className="pf-section-title">Reading Progress</div>
            <div className="pf-section-meta">Book reader</div>
          </div>
          <div className="pf-placeholder" style={{ fontFamily: 'Cochin, Cormorant Garamond, Georgia, serif', fontStyle: 'normal', color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem' }}>
            <p>Stories you've bookmarked in the book reader will appear here.</p>
          </div>
        </div>

        {/* Account */}
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
      {showComments && <CommentHistoryModal uid={authUser.uid} displayName={displayName} onClose={() => setShowComments(false)} allStoriesMerged={allStoriesMerged} />}
      {showSquarePosts && <SquarePostsModal uid={authUser.uid} onClose={() => setShowSquarePosts(false)} />}

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
      {showLibNotifs && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1999 }} onClick={() => setShowLibNotifs(false)} />
          <div className="lib-notif-panel">
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: "Cochin, Cormorant Garamond, Georgia, serif", fontSize: '1.1rem', color: '#ffffff' }}>Notifications</span>
              <button onClick={() => setShowLibNotifs(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: '1.2rem' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {libNotifs.length === 0
                ? <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: "Cochin, Cormorant Garamond, Georgia, serif", fontStyle: 'italic' }}>No notifications yet.</div>
                : libNotifs.map(n => (
                  <div key={n.id} className={`lib-notif-item${n.read ? '' : ' unread'}`}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(107,47,173,0.25)', border: '1px solid rgba(107,47,173,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#a78bfa', flexShrink: 0 }}>
                      {(n.fromName || 'R')[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.82rem', color: '#ffffff', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 600 }}>{n.fromName}</span>
                        {n.type === 'reply' && ' replied to your comment'}
                        {n.type === 'heart' && ' loved your comment'}
                        {n.type === 'clap' && ' liked your comment'}
                        {n.type === 'fire' && ' reacted 🔥 to your comment'}
                        {n.type === 'follow' && ' started following you'}
                        {n.type === 'new_story' && ` published: ${n.storyTitle || 'a new story'}`}
                        {n.type === 'reward' && (n.message || ' — you earned points!')}
                      </div>
                      <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)', marginTop: 3, fontFamily: 'Inter, sans-serif' }}>
                        {n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        </>
      )}
    </>
  );
}