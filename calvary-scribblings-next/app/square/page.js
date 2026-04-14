'use client';
import TipBox from '../components/TipBox';

import { useEffect, useState, useRef, useCallback } from 'react';
import { stories as allStaticStories } from '../lib/stories';

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

const FOUNDER_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const MOD_UIDS = [FOUNDER_UID]; // add @calvaryscribblings UID here once known
const CALVARY_UID = FOUNDER_UID; // system post author

const BADGE_PATH = "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C1.87 9.33 1 10.57 1 12s.87 2.67 2.19 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91C21.37 14.67 22.25 13.43 22.25 12z";
const CHECK_PATH = "M9.13 17.75L5.5 14.12l1.41-1.41 2.22 2.22 6.34-7.59 1.53 1.28z";
const HEART_PATH = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";

// ── Time helpers (London/BST aware) ───────────────────────────────────────────
function getLondonTime() {
  const now = new Date();
  const parts = now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false }).split(':');
  const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10), s = parseInt(parts[2], 10);
  const dayStr = now.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
  const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(dayStr);
  return { h: isNaN(h) ? 0 : h, m: isNaN(m) ? 0 : m, s: isNaN(s) ? 0 : s, day };
}
function getLondonHour() { return getLondonTime().h; }
function getLondonMinute() { return getLondonTime().m; }
function isSquareOpen() {
  const { h } = getLondonTime();
  return h >= 20 && h < 24;
}
function getCountdown() {
  const { h, m, s } = getLondonTime();
  let secs;
  if (h >= 20) {
    secs = (24 - h - 1) * 3600 + (59 - m) * 60 + (60 - s);
  } else {
    secs = (20 - h - 1) * 3600 + (59 - m) * 60 + (60 - s);
  }
  const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
  return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
}
function isFriday() { return getLondonTime().day === 5; }
function isMonday() { return getLondonTime().day === 1; }

function getBadge(readCount, uid) {
  if (uid === FOUNDER_UID) return { tier: 'founder', label: 'Founder', color: '#c8daea', isFounder: true };
  if (readCount >= 1000) return { tier: 'immortal', label: 'Immortal of the Island', color: '#9b6dff' };
  if (readCount >= 150) return { tier: 'legend', label: 'Legend of the Island', color: '#d4537e' };
  if (readCount >= 90) return { tier: 'islander', label: 'Story Islander', color: '#d4941a' };
  if (readCount >= 60) return { tier: 'island', label: 'Island Reader', color: '#1d9e75' };
  if (readCount >= 25) return { tier: 'reader', label: 'Reader', color: '#b4b2a9' };
  return null;
}

function getMaxChars(readCount, uid, isAuthor) {
  if (isAuthor || uid === FOUNDER_UID || readCount >= 150) return 500;
  return 200;
}

function BadgeIcon({ color, size = 13, isFounder = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="sqPlat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8f0f8"/><stop offset="50%" stopColor="#c8daea"/><stop offset="100%" stopColor="#a8c0d6"/>
        </linearGradient>
      </defs>
      <path fill={isFounder ? 'url(#sqPlat)' : color} d={BADGE_PATH} />
      <path fill={color === '#b4b2a9' ? '#0a0a0a' : '#fff'} d={CHECK_PATH} />
    </svg>
  );
}

function WriterBadge({ size = 13 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <path fill="#581c87" d={BADGE_PATH} />
        <path fill="#e9d5ff" d={CHECK_PATH} />
      </svg>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(212,83,126,0.12)', border: '1px solid rgba(212,83,126,0.35)', borderRadius: 6, padding: '1px 7px 1px 5px' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path fill="#d4537e" d={HEART_PATH} /></svg>
        <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#d4537e', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>Writer</span>
      </span>
    </span>
  );
}

// Reaction SVG icons
function HeartIcon({ filled, size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? '#d4537e' : 'none'} stroke={filled ? '#d4537e' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={HEART_PATH}/>
    </svg>
  );
}

function ClapIcon({ filled, size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? '#d4941a' : 'none'} stroke={filled ? '#d4941a' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/>
      <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
    </svg>
  );
}

function FlameIcon({ filled, size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? '#ef4444' : 'none'} stroke={filled ? '#ef4444' : 'currentColor'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c0 0-5 5-5 11a5 5 0 0 0 10 0c0-6-5-11-5-11z"/>
      <path d="M12 12c0 2.5-2 4-2 5.5a2 2 0 0 0 4 0c0-1.5-2-3-2-5.5z"/>
    </svg>
  );
}

function PinIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3 7h5l-4 3 1.5 7L12 16l-5.5 3L8 12 4 9h5z"/>
    </svg>
  );
}

function PollIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/><rect x="17" y="3" width="4" height="18"/>
    </svg>
  );
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function UserBadge({ uid, readCount, isAuthor }) {
  const badge = getBadge(readCount || 0, uid);
  if (isAuthor) return <WriterBadge size={12} />;
  if (!badge) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <BadgeIcon color={badge.color} size={12} isFounder={badge.isFounder} />
      <span style={{ fontSize: '0.58rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: badge.color, fontFamily: 'Inter, sans-serif' }}>{badge.label}</span>
    </span>
  );
}

function renderText(text) {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) => {
    if (/^@\w+$/.test(part)) {
      return <span key={i} style={{ color: '#9b6dff', cursor: 'pointer' }} onClick={() => window.location.href = `/search?q=${part.slice(1)}`}>{part}</span>;
    }
    return part;
  });
}

function Avatar({ uid, initials, size = 36, isAuthor, avatarUrl }) {
  return (
    <a href={`/user?id=${uid}`} style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: isAuthor ? 'rgba(88,28,135,0.25)' : 'rgba(107,47,173,0.2)',
      border: isAuthor ? '1.5px solid rgba(88,28,135,0.5)' : '1.5px solid rgba(107,47,173,0.3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.3, fontWeight: 500, color: '#9b6dff',
      overflow: 'hidden', textDecoration: 'none', fontFamily: 'Inter, sans-serif',
    }}>
      {avatarUrl ? <img src={avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </a>
  );
}

function MentionDropdown({ query, onSelect }) {
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (!query) { setResults([]); return; }
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, 'users'));
      if (!snap.exists()) return;
      const matches = Object.entries(snap.val())
        .filter(([, u]) => u.username && u.username.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5)
        .map(([uid, u]) => ({ uid, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl }));
      setResults(matches);
    })();
  }, [query]);
  if (!results.length) return null;
  return (
    <div style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, right: 0, background: '#1a1a2e', border: '1px solid rgba(107,47,173,0.3)', borderRadius: 10, overflow: 'hidden', zIndex: 100 }}>
      {results.map(u => (
        <div key={u.uid} onClick={() => onSelect(u.username)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.15)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1px solid rgba(107,47,173,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#9b6dff', overflow: 'hidden', flexShrink: 0 }}>
            {u.avatarUrl ? <img src={u.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (u.displayName || 'R')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#f5f0e8', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>{u.displayName || u.username}</div>
            <div style={{ fontSize: '0.68rem', color: 'rgba(167,139,250,0.55)', fontFamily: 'Inter, sans-serif' }}>@{u.username}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Poll Component ────────────────────────────────────────────────────────────
function PollDisplay({ poll, postId, user }) {
  const [voted, setVoted] = useState(null);
  const [votes, setVotes] = useState(poll.votes || {});

  useEffect(() => {
    if (!user) return;
    if (votes[user.uid]) setVoted(votes[user.uid]);
  }, [user, votes]);

  const totalVotes = Object.values(votes).filter(v => typeof v === 'string').length;

  const castVote = async (optionIndex) => {
    if (!user || voted) return;
    const db = await getDB();
    const { ref, update } = await import('firebase/database');
    await update(ref(db, `square_posts/${postId}/poll/votes`), { [user.uid]: String(optionIndex) });
    setVotes(v => ({ ...v, [user.uid]: String(optionIndex) }));
    setVoted(String(optionIndex));
  };

  const now = Date.now();
  const closed = poll.closesAt && now > poll.closesAt;
  const showResults = voted !== null || closed;

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {poll.question && (
        <div style={{ fontSize: '0.85rem', color: '#f5f0e8', fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 600, marginBottom: 4 }}>{poll.question}</div>
      )}
      {poll.options.map((opt, i) => {
        const optVotes = Object.values(votes).filter(v => v === String(i)).length;
        const pct = totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
        const isVoted = voted === String(i);
        return (
          <div key={i} onClick={() => !voted && !closed && castVote(i)}
            style={{ position: 'relative', border: `1px solid ${isVoted ? 'rgba(107,47,173,0.6)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 8, padding: '8px 12px', cursor: (!voted && !closed) ? 'pointer' : 'default', overflow: 'hidden', transition: 'border-color 0.2s' }}
            onMouseEnter={e => { if (!voted && !closed) e.currentTarget.style.borderColor = 'rgba(107,47,173,0.4)'; }}
            onMouseLeave={e => { if (!voted && !closed) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}>
            {showResults && (
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: isVoted ? 'rgba(107,47,173,0.2)' : 'rgba(255,255,255,0.04)', transition: 'width 0.5s ease', borderRadius: 8 }} />
            )}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.82rem', color: isVoted ? '#c4b5fd' : 'rgba(232,224,212,0.8)', fontFamily: 'Inter, sans-serif' }}>{opt}</span>
              {showResults && <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>{pct}%</span>}
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif' }}>
        {totalVotes} vote{totalVotes !== 1 ? 's' : ''}{closed ? ' · Closed' : poll.closesAt ? ` · Closes ${timeAgo(poll.closesAt)}` : ''}
      </div>
    </div>
  );
}

// ── Post Menu ─────────────────────────────────────────────────────────────────
function PostMenu({ post, user, onEdit, onDelete, onPin, isMod }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const isOwn = user?.uid === post.authorUid;
  const canEdit = isOwn && (Date.now() - post.createdAt) < 5 * 60 * 1000;
  const isPinned = post.pinned || false;

  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/square#${post.id}`);
    setOpen(false);
  };

  return (
    <div ref={menuRef} style={{ position: 'relative', marginLeft: 'auto' }}>
      <button onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', padding: '2px 4px', fontSize: 14, lineHeight: 1, transition: 'color 0.2s' }}
        onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.2)'}>···</button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', background: '#1a1a2e', border: '1px solid rgba(107,47,173,0.25)', borderRadius: 10, minWidth: 160, zIndex: 200, overflow: 'hidden' }}>
          {isOwn && canEdit && (
            <button onClick={() => { onEdit(post); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: 'rgba(232,224,212,0.8)', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit post
            </button>
          )}
          {isMod && (
            <button onClick={() => { onPin(post); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: isPinned ? '#fcd34d' : 'rgba(232,224,212,0.8)', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <PinIcon size={12} />
              {isPinned ? 'Unpin post' : 'Pin post'}
            </button>
          )}
          {(isOwn || isMod) && (
            <button onClick={() => { onDelete(post); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: '#f87171', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(220,38,38,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              Delete post
            </button>
          )}
          <button onClick={copyLink} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: 'rgba(232,224,212,0.8)', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif', textAlign: 'left' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.15)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            Copy link
          </button>
          {!isOwn && (
            <button onClick={() => setOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '9px 14px', background: 'none', border: 'none', color: 'rgba(232,224,212,0.5)', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
              Report
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Poll Creator (mod only) ───────────────────────────────────────────────────
function PollCreatorModal({ onCreate, onClose }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState(60); // minutes

  const addOption = () => { if (options.length < 6) setOptions(o => [...o, '']); };
  const removeOption = (i) => { if (options.length > 2) setOptions(o => o.filter((_, idx) => idx !== i)); };
  const updateOption = (i, val) => setOptions(o => o.map((v, idx) => idx === i ? val : v));

  const create = () => {
    const validOptions = options.filter(o => o.trim());
    if (validOptions.length < 2) return;
    onCreate({ question: question.trim(), options: validOptions, closesAt: Date.now() + duration * 60 * 1000 });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 520, padding: '1.5rem', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.2rem', color: '#f5f0e8' }}>Create Poll</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '1.3rem', cursor: 'pointer' }}>×</button>
        </div>
        <input placeholder="Question (optional)…" value={question} onChange={e => setQuestion(e.target.value)}
          style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 1rem', color: '#e8e0d4', fontSize: '0.9rem', fontFamily: 'Inter, sans-serif', outline: 'none', marginBottom: '1rem', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1rem' }}>
          {options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={opt} onChange={e => updateOption(i, e.target.value)} placeholder={`Option ${i + 1}`}
                style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '0.6rem 0.9rem', color: '#e8e0d4', fontSize: '0.88rem', fontFamily: 'Inter, sans-serif', outline: 'none' }} />
              {options.length > 2 && (
                <button onClick={() => removeOption(i)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '1.1rem', padding: '0 4px' }}>×</button>
              )}
            </div>
          ))}
          {options.length < 6 && (
            <button onClick={addOption} style={{ background: 'none', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.5rem', color: 'rgba(255,255,255,0.3)', fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>+ Add option</button>
          )}
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', display: 'block', marginBottom: 6 }}>Poll duration</label>
          <select value={duration} onChange={e => setDuration(Number(e.target.value))}
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '0.6rem 0.9rem', color: '#e8e0d4', fontSize: '0.88rem', fontFamily: 'Inter, sans-serif', outline: 'none', width: '100%' }}>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={90}>1.5 hours</option>
            <option value={120}>2 hours</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.6rem 1.2rem', color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Cancel</button>
          <button onClick={create} style={{ background: '#6b2fad', border: 'none', borderRadius: 8, padding: '0.6rem 1.5rem', color: '#fff', fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Create Poll</button>
        </div>
      </div>
    </div>
  );
}

function StoryAttachModal({ onSelect, onClose, cmsStories }) {
  const [query, setQuery] = useState('');
  const allStories = [...allStaticStories, ...cmsStories];
  const filtered = query.trim()
    ? allStories.filter(s => s.title.toLowerCase().includes(query.toLowerCase()) || (s.author || '').toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : allStories.slice(0, 8);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 520, padding: '1.5rem', maxHeight: '70vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.2rem', color: '#f5f0e8' }}>Attach a story</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '1.3rem', cursor: 'pointer' }}>×</button>
        </div>
        <input placeholder="Search stories…" value={query} onChange={e => setQuery(e.target.value)}
          style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '0.7rem 1rem', color: '#e8e0d4', fontSize: '0.9rem', fontFamily: 'Inter, sans-serif', outline: 'none', marginBottom: '1rem', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(s => (
            <div key={s.id} onClick={() => onSelect(s)} style={{ display: 'flex', gap: 10, padding: '8px 10px', borderRadius: 10, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(107,47,173,0.1)'; e.currentTarget.style.borderColor = 'rgba(107,47,173,0.3)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}>
              <div style={{ width: 36, height: 52, borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: 'rgba(107,47,173,0.2)' }}>
                {s.cover && <img src={s.cover} alt={s.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', color: 'rgba(155,109,255,0.6)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>{s.categoryName}</div>
                <div style={{ fontSize: '0.88rem', color: '#f5f0e8', fontFamily: 'Cormorant Garamond, Georgia, serif', lineHeight: 1.3 }}>{s.title}</div>
                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>by {s.author}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StoryEmbed({ story }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a href={story.url || `/stories/${story.id}`}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', gap: 10, background: hovered ? 'rgba(107,47,173,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${hovered ? 'rgba(107,47,173,0.3)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 10, padding: '9px 12px', marginTop: 8, alignItems: 'center', textDecoration: 'none', transition: 'all 0.15s' }}>
      <div style={{ width: 32, height: 46, borderRadius: 3, overflow: 'hidden', flexShrink: 0, background: 'rgba(107,47,173,0.2)' }}>
        {story.cover && <img src={story.cover} alt={story.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.62rem', color: 'rgba(155,109,255,0.6)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>{story.categoryName}</div>
        <div style={{ fontSize: '0.82rem', color: '#f5f0e8', fontFamily: 'Cormorant Garamond, Georgia, serif', lineHeight: 1.3 }}>{story.title}</div>
        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>by {story.author}</div>
      </div>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
    </a>
  );
}

// ── DM Panel ──────────────────────────────────────────────────────────────────
function DMPanel({ user, onClose }) {
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [dmText, setDmText] = useState('');
  const [sending, setSending] = useState(false);
  const [dmImageFile, setDmImageFile] = useState(null);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [newMsgSearch, setNewMsgSearch] = useState('');
  const [newMsgResults, setNewMsgResults] = useState([]);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const messagesEndRef = useRef(null);
  const dmFileRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const db = await getDB();
      const { ref, onValue } = await import('firebase/database');
      onValue(ref(db, `dm_conversations/${user.uid}`), async (snap) => {
        if (!snap.exists()) { setConversations([]); setLoadingConvs(false); return; }
        const convData = snap.val();
        const convIds = Object.keys(convData);
        const convDetails = await Promise.all(convIds.map(async convId => {
          const otherUid = convId.split('_').find(u => u !== user.uid);
          const { get } = await import('firebase/database');
          const [userSnap, lastMsgSnap] = await Promise.all([
            get(ref(db, `users/${otherUid}`)),
            get(ref(db, `dm_messages/${convId}`)),
          ]);
          const otherUser = userSnap.exists() ? userSnap.val() : {};
          let lastMsg = null;
          if (lastMsgSnap.exists()) {
            const msgs = Object.values(lastMsgSnap.val());
            lastMsg = msgs[msgs.length - 1];
          }
          return { convId, otherUid, otherUser, lastMsg, unread: convData[convId].unread || 0 };
        }));
        setConversations(convDetails.sort((a, b) => (b.lastMsg?.createdAt || 0) - (a.lastMsg?.createdAt || 0)));
        setLoadingConvs(false);
      });
    })();
  }, [user]);

  useEffect(() => {
    if (!activeConv) return;
    (async () => {
      const db = await getDB();
      const { ref, onValue, update } = await import('firebase/database');
      onValue(ref(db, `dm_messages/${activeConv.convId}`), (snap) => {
        if (!snap.exists()) { setMessages([]); return; }
        setMessages(Object.entries(snap.val()).map(([id, m]) => ({ id, ...m })).sort((a, b) => a.createdAt - b.createdAt));
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      });
      await update(ref(db, `dm_conversations/${user.uid}/${activeConv.convId}`), { unread: 0 });
    })();
  }, [activeConv]);

  useEffect(() => {
    if (!newMsgSearch.trim()) { setNewMsgResults([]); return; }
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, 'users'));
      if (!snap.exists()) return;
      const matches = Object.entries(snap.val())
        .filter(([uid, u]) => {
          if (uid === user.uid) return false;
          const q = newMsgSearch.toLowerCase();
          return (u.displayName || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q);
        })
        .slice(0, 6)
        .map(([uid, u]) => ({ uid, displayName: u.displayName, username: u.username, avatarUrl: u.avatarUrl }));
      setNewMsgResults(matches);
    })();
  }, [newMsgSearch]);

  const startConversation = async (otherUid, otherUser) => {
    const convId = [user.uid, otherUid].sort().join('_');
    setActiveConv({ convId, otherUid, otherUser });
    setShowNewMsg(false); setNewMsgSearch(''); setNewMsgResults([]);
  };

  const sendDM = async () => {
    if (!dmText.trim() && !dmImageFile) return;
    if (!activeConv) return;
    setSending(true);
    try {
      const db = await getDB();
      const { ref, push, update } = await import('firebase/database');
      let imageUrl = null;
      if (dmImageFile) {
        const { getStorage, ref: sRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
        const storage = getStorage(await getApp());
        const storageRef = sRef(storage, `dm_images/${activeConv.convId}/${Date.now()}`);
        await uploadBytes(storageRef, dmImageFile);
        imageUrl = await getDownloadURL(storageRef);
        setDmImageFile(null);
      }
      const msg = { text: dmText.trim(), imageUrl, senderUid: user.uid, createdAt: Date.now() };
      await push(ref(db, `dm_messages/${activeConv.convId}`), msg);
      await update(ref(db, `dm_conversations/${user.uid}/${activeConv.convId}`), { unread: 0, lastAt: Date.now() });
      await update(ref(db, `dm_conversations/${activeConv.otherUid}/${activeConv.convId}`), { unread: 1, lastAt: Date.now() });
      setDmText('');
    } catch (e) { console.error('DM send error:', e); }
    setSending(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          {activeConv ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setActiveConv(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem', cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', padding: 0 }}>←</button>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1px solid rgba(107,47,173,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#9b6dff', overflow: 'hidden' }}>
                {activeConv.otherUser.avatarUrl ? <img src={activeConv.otherUser.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (activeConv.otherUser.displayName || 'R')[0]}
              </div>
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 500, color: '#f5f0e8', fontFamily: 'Inter, sans-serif' }}>{activeConv.otherUser.displayName || 'Reader'}</div>
                {activeConv.otherUser.username && <div style={{ fontSize: '0.68rem', color: 'rgba(167,139,250,0.5)', fontFamily: 'Inter, sans-serif' }}>@{activeConv.otherUser.username}</div>}
              </div>
            </div>
          ) : (
            <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.2rem', color: '#f5f0e8' }}>Messages</div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!activeConv && (
              <button onClick={() => setShowNewMsg(!showNewMsg)} style={{ background: 'rgba(107,47,173,0.12)', border: '1px solid rgba(107,47,173,0.25)', borderRadius: 7, padding: '5px 10px', fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(155,109,255,0.8)', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>+ New</button>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '1.3rem', cursor: 'pointer' }}>×</button>
          </div>
        </div>
        {showNewMsg && !activeConv && (
          <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <input autoFocus placeholder="Search by name or @handle…" value={newMsgSearch} onChange={e => setNewMsgSearch(e.target.value)}
              style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '8px 12px', color: '#e8e0d4', fontSize: '0.88rem', fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box' }} />
            {newMsgResults.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {newMsgResults.map(u => (
                  <div key={u.uid} onClick={() => startConversation(u.uid, u)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(107,47,173,0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1px solid rgba(107,47,173,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#9b6dff', overflow: 'hidden', flexShrink: 0 }}>
                      {u.avatarUrl ? <img src={u.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (u.displayName || 'R')[0]}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 500, color: '#f5f0e8', fontFamily: 'Inter, sans-serif' }}>{u.displayName || 'Reader'}</div>
                      {u.username && <div style={{ fontSize: '0.7rem', color: 'rgba(167,139,250,0.5)', fontFamily: 'Inter, sans-serif' }}>@{u.username}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!activeConv ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
            {loadingConvs ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem' }}>Loading…</div>
            ) : conversations.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.95rem', fontStyle: 'italic' }}>No messages yet. Tap + New to start a conversation.</div>
            ) : conversations.map(conv => (
              <div key={conv.convId} onClick={() => setActiveConv(conv)}
                style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 20px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1px solid rgba(107,47,173,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#9b6dff', overflow: 'hidden', flexShrink: 0 }}>
                  {conv.otherUser.avatarUrl ? <img src={conv.otherUser.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (conv.otherUser.displayName || 'R')[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 500, color: '#e8e0d4', fontFamily: 'Inter, sans-serif', marginBottom: 2 }}>{conv.otherUser.displayName || 'Reader'}</div>
                  <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.28)', fontFamily: 'Cormorant Garamond, Georgia, serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{conv.lastMsg?.text || 'Image'}</div>
                </div>
                {conv.unread > 0 && (
                  <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#6b2fad', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 500, flexShrink: 0 }}>{conv.unread}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {messages.map(msg => {
                const isMine = msg.senderUid === user.uid;
                return (
                  <div key={msg.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexDirection: isMine ? 'row-reverse' : 'row' }}>
                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1px solid rgba(107,47,173,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#9b6dff', overflow: 'hidden', flexShrink: 0 }}>
                      {isMine ? (user.photoURL ? <img src={user.photoURL} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (user.displayName || 'R')[0]) : (activeConv.otherUser.avatarUrl ? <img src={activeConv.otherUser.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (activeConv.otherUser.displayName || 'R')[0])}
                    </div>
                    <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', gap: 4, alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                      {msg.imageUrl && <img src={msg.imageUrl} alt="shared" style={{ maxWidth: 180, borderRadius: 10, display: 'block' }} />}
                      {msg.text && (
                        <div style={{ padding: '8px 12px', borderRadius: isMine ? '12px 12px 3px 12px' : '12px 12px 12px 3px', background: isMine ? '#6b2fad' : 'rgba(255,255,255,0.06)', color: isMine ? '#fff' : 'rgba(232,224,212,0.85)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.88rem', lineHeight: 1.6 }}>
                          {msg.text}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <button onClick={() => dmFileRef.current?.click()} style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(107,47,173,0.12)', border: '1px solid rgba(107,47,173,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(155,109,255,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </button>
              <input ref={dmFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setDmImageFile(e.target.files[0])} />
              <input value={dmText} onChange={e => setDmText(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendDM()}
                placeholder={`Message ${activeConv.otherUser.displayName || 'Reader'}…`}
                style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '8px 14px', fontSize: '0.88rem', color: 'rgba(255,255,255,0.85)', fontFamily: 'Cormorant Garamond, Georgia, serif', outline: 'none' }} />
              <button onClick={sendDM} disabled={sending || (!dmText.trim() && !dmImageFile)} style={{ width: 32, height: 32, borderRadius: '50%', background: '#6b2fad', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, opacity: (!dmText.trim() && !dmImageFile) ? 0.4 : 1 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 3L3 10.5l7.5 3L18 6l-7.5 7.5 3 7.5L21 3z" fill="#fff"/></svg>
              </button>
            </div>
            {dmImageFile && (
              <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={URL.createObjectURL(dmImageFile)} alt="preview" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }} />
                <button onClick={() => setDmImageFile(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'Inter, sans-serif' }}>Remove</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Notifications Panel ───────────────────────────────────────────────────────
function NotificationsPanel({ user, onClose }) {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const db = await getDB();
      const { ref, onValue, update } = await import('firebase/database');
      onValue(ref(db, `notifications/${user.uid}`), (snap) => {
        if (!snap.exists()) { setNotifs([]); setLoading(false); return; }
        const list = Object.entries(snap.val()).map(([id, n]) => ({ id, ...n })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
        setNotifs(list);
        setLoading(false);
        const updates = {};
        list.filter(n => !n.read).forEach(n => { updates[`${n.id}/read`] = true; });
        if (Object.keys(updates).length) update(ref(db, `notifications/${user.uid}`), updates);
      });
    })();
  }, [user]);

  const notifLabel = (n) => {
    if (n.type === 'mention') return ' mentioned you in the Square';
    if (n.type === 'reply') return ' replied to your comment';
    if (n.type === 'follow') return ' started following you';
    if (n.type === 'heart') return ' loved your post';
    if (n.type === 'clap') return ' applauded your post';
    if (n.type === 'fire') return ' fired up your post';
    if (n.type === 'new_story') return ` published a new story: ${n.storyTitle || 'a new story'}`;
    if (n.type === 'reward') return n.message || ' — you earned points!';
    if (n.type === 'follow') return ' started following you';
    if (n.type === 'square_post') return ' posted in the Square';
    if (n.type === 'like') return ' liked your post';
    if (n.type === 'clap') return ' clapped for your post';
    if (n.type === 'fire') return ' reacted 🔥 to your post';
    return '';
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 520, maxHeight: '75vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.2rem', color: '#f5f0e8' }}>Notifications</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: '1.3rem', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem' }}>Loading…</div>
          ) : notifs.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.95rem', fontStyle: 'italic' }}>No notifications yet.</div>
          ) : notifs.map(n => (
            <div key={n.id} style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 10, alignItems: 'flex-start', background: n.read ? 'transparent' : 'rgba(107,47,173,0.05)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: n.read ? 'transparent' : '#9b6dff', marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.82rem', color: '#e8e0d4', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
                  <span style={{ color: '#a78bfa', fontWeight: 500 }}>{n.fromName}</span>{notifLabel(n)}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.22)', marginTop: 3, fontFamily: 'Inter, sans-serif' }}>{timeAgo(n.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SquarePage() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [posts, setPosts] = useState([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [posting, setPosting] = useState(false);
  const [attachedStory, setAttachedStory] = useState(null);
  const [showStoryAttach, setShowStoryAttach] = useState(false);
  const [showDM, setShowDM] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [presenceCount, setPresenceCount] = useState(0);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [squareOpen, setSquareOpen] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [cmsStories, setCmsStories] = useState([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionQueryReply, setMentionQueryReply] = useState('');
  const [mentionQueryEdit, setMentionQueryEdit] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [reactions, setReactions] = useState({});
  const [editingPost, setEditingPost] = useState(null);
  const [editText, setEditText] = useState('');
  const textareaRef = useRef(null);
  const replyTextareaRef = useRef(null);
  const editTextareaRef = useRef(null);

  const isMod = user && MOD_UIDS.includes(user.uid);

  useEffect(() => {
    const tick = () => { setSquareOpen(isSquareOpen()); setCountdown(getCountdown()); };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        if (u) {
          const db = await getDB();
          const { ref, get, onValue, set, onDisconnect } = await import('firebase/database');
          const snap = await get(ref(db, `users/${u.uid}`));
          if (snap.exists()) setUserData(snap.val());
          onValue(ref(db, `notifications/${u.uid}`), (snap) => {
            setUnreadNotifs(snap.exists() ? Object.values(snap.val()).filter(n => !n.read).length : 0);
          });
          // Load reactions for all posts
          onValue(ref(db, `square_reactions`), (snap) => {
            if (!snap.exists()) return;
            const r = {};
            Object.entries(snap.val()).forEach(([postId, reactionData]) => {
              r[postId] = {};
              ['like', 'clap', 'fire'].forEach(type => {
                if (reactionData[type] && reactionData[type][u.uid]) r[postId][type] = true;
              });
            });
            setReactions(r);
          });
          const presRef = ref(db, `square_presence/${u.uid}`);
          await set(presRef, true);
          onDisconnect(presRef).remove();
        }
      });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const db = await getDB();
      const { ref, onValue } = await import('firebase/database');
      onValue(ref(db, 'square_presence'), (snap) => {
        setPresenceCount(snap.exists() ? Object.keys(snap.val()).length : 0);
      });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const db = await getDB();
      const { ref, onValue } = await import('firebase/database');
      onValue(ref(db, 'square_posts'), (snap) => {
        if (!snap.exists()) { setPosts([]); setLoading(false); return; }
        const list = Object.entries(snap.val()).map(([id, p]) => ({ id, ...p }));
        // Pinned posts first, then by date
        list.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return b.createdAt - a.createdAt;
        });
        setPosts(list);
        setLoading(false);
      });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const db = await getDB();
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, 'cms_stories'));
      if (snap.exists()) {
        setCmsStories(Object.entries(snap.val()).map(([id, s]) => ({ id, ...s, cover: s.cover || '', url: `/stories/${id}` })));
      }
    })();
  }, []);

  const extractMentionQuery = (t) => { const match = t.match(/@(\w*)$/); return match ? match[1] : ''; };
  const handleTextChange = (val) => { setText(val); setMentionQuery(extractMentionQuery(val)); };
  const handleReplyTextChange = (val) => { setReplyText(val); setMentionQueryReply(extractMentionQuery(val)); };
  const handleEditTextChange = (val) => { setEditText(val); setMentionQueryEdit(extractMentionQuery(val)); };
  const insertMention = (username) => { setText(text.replace(/@\w*$/, `@${username} `)); setMentionQuery(''); textareaRef.current?.focus(); };
  const insertMentionReply = (username) => { setReplyText(replyText.replace(/@\w*$/, `@${username} `)); setMentionQueryReply(''); replyTextareaRef.current?.focus(); };
  const insertMentionEdit = (username) => { setEditText(editText.replace(/@\w*$/, `@${username} `)); setMentionQueryEdit(''); editTextareaRef.current?.focus(); };

  const sendNotifications = async (text, postId, type = 'mention', replyAuthorUid = null) => {
    const db = await getDB();
    const { ref, push, get } = await import('firebase/database');
    const mentions = [...text.matchAll(/@(\w+)/g)].map(m => m[1]);
    for (const handle of mentions) {
      let targetUid = null;
      const usernameSnap = await get(ref(db, `usernames/${handle}`));
      if (usernameSnap.exists()) { targetUid = usernameSnap.val(); }
      else {
        const usersSnap = await get(ref(db, 'users'));
        if (usersSnap.exists()) {
          const entry = Object.entries(usersSnap.val()).find(([, u]) => u.username === handle);
          if (entry) targetUid = entry[0];
        }
      }
      if (!targetUid || targetUid === user.uid) continue;
      await push(ref(db, `notifications/${targetUid}`), {
        type: 'mention', fromUid: user.uid, fromName: user.displayName || 'Reader',
        postId, read: false, createdAt: Date.now(),
      });
    }
    if (type === 'reply' && replyAuthorUid && replyAuthorUid !== user.uid) {
      await push(ref(db, `notifications/${replyAuthorUid}`), {
        type: 'reply', fromUid: user.uid, fromName: user.displayName || 'Reader',
        postId, read: false, createdAt: Date.now(),
      });
    }
    if (type === 'post') {
      const followersSnap = await get(ref(db, `followers/${user.uid}`));
      if (followersSnap.exists()) {
        for (const followerUid of Object.keys(followersSnap.val())) {
          await push(ref(db, `notifications/${followerUid}`), {
            type: 'square_post', fromUid: user.uid, fromName: user.displayName || 'Reader',
            postId, read: false, createdAt: Date.now(),
          });
        }
      }
    }
  };

  const mirrorToUserPosts = async (postId, postData) => {
    const db = await getDB();
    const { ref, set } = await import('firebase/database');
    await set(ref(db, `user_square_posts/${postData.authorUid}/${postId}`), postData);
  };

  const post = async (pollData = null) => {
    if (!text.trim() && !pollData) return;
    if (!user) return;
    const maxChars = getMaxChars(userData?.readCount || 0, user.uid, userData?.isAuthor);
    if (text.length > maxChars) return;
    setPosting(true);
    try {
      const db = await getDB();
      const { ref, push } = await import('firebase/database');
      const postData = {
        text: text.trim(), authorUid: user.uid, authorName: user.displayName || 'Reader',
        authorInitials: (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
        authorAvatarUrl: userData?.avatarUrl || null, authorReadCount: userData?.readCount || 0,
        isAuthor: userData?.isAuthor || false, attachedStory: attachedStory || null,
        parentId: null, likeCount: 0, pinned: false,
        unpinnedAt: null,
        createdAt: Date.now(),
      };
      if (pollData) postData.poll = { ...pollData, votes: {} };
      const newPost = await push(ref(db, 'square_posts'), postData);
      await mirrorToUserPosts(newPost.key, postData);
      await sendNotifications(text.trim(), newPost.key, 'post');
      setText(''); setAttachedStory(null);
    } catch (e) { console.error('Post error:', e); }
    setPosting(false);
  };

  const reply = async (parentPost) => {
    if (!replyText.trim() || !user) return;
    setPosting(true);
    try {
      const db = await getDB();
      const { ref, push } = await import('firebase/database');
      const replyData = {
        text: replyText.trim(), authorUid: user.uid, authorName: user.displayName || 'Reader',
        authorInitials: (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(),
        authorAvatarUrl: userData?.avatarUrl || null, authorReadCount: userData?.readCount || 0,
        isAuthor: userData?.isAuthor || false, parentId: parentPost.id, likeCount: 0,
        pinned: false, unpinnedAt: null, createdAt: Date.now(),
      };
      const newReply = await push(ref(db, 'square_posts'), replyData);
      await mirrorToUserPosts(newReply.key, replyData);
      await sendNotifications(replyText.trim(), newReply.key, 'reply', parentPost.authorUid);
      setReplyText(''); setReplyTo(null);
    } catch (e) { console.error('Reply error:', e); }
    setPosting(false);
  };

  const toggleReaction = async (postId, type) => {
    if (!user) return;
    const db = await getDB();
    const { ref, set, remove, runTransaction, push } = await import('firebase/database');
    const reactionRef = ref(db, `square_reactions/${postId}/${type}/${user.uid}`);
    const countRef = ref(db, `square_posts/${postId}/${type}Count`);
    const hasReacted = reactions[postId]?.[type];

    if (hasReacted) {
      await remove(reactionRef);
      await runTransaction(countRef, c => Math.max(0, (c || 0) - 1));
    } else {
      await set(reactionRef, true);
      await runTransaction(countRef, c => (c || 0) + 1);
      // Send notification to post author
      const post = posts.find(p => p.id === postId);
      if (post && post.authorUid !== user.uid) {
        await push(ref(db, `notifications/${post.authorUid}`), {
          type, fromUid: user.uid, fromName: user.displayName || 'Reader',
          postId, read: false, createdAt: Date.now(),
        });
      }
    }
  };

  const handlePin = async (p) => {
    if (!isMod) return;
    const db = await getDB();
    const { ref, update } = await import('firebase/database');
    if (p.pinned) {
      // Unpin — start 2-day deletion countdown
      await update(ref(db, `square_posts/${p.id}`), { pinned: false, unpinnedAt: Date.now() });
    } else {
      await update(ref(db, `square_posts/${p.id}`), { pinned: true, unpinnedAt: null });
    }
  };

  const handleEdit = (p) => { setEditingPost(p.id); setEditText(p.text); setMentionQueryEdit(''); };

  const saveEdit = async (postId) => {
    if (!editText.trim()) return;
    const db = await getDB();
    const { ref, update } = await import('firebase/database');
    await update(ref(db, `square_posts/${postId}`), { text: editText.trim(), edited: true });
    setEditingPost(null); setEditText(''); setMentionQueryEdit('');
  };

  const handleDelete = async (p) => {
    if (!confirm('Delete this post?')) return;
    const db = await getDB();
    const { ref, remove } = await import('firebase/database');
    await remove(ref(db, `square_posts/${p.id}`));
    await remove(ref(db, `user_square_posts/${p.authorUid}/${p.id}`));
    const repliesToDelete = posts.filter(r => r.parentId === p.id);
    await Promise.all(repliesToDelete.map(r => Promise.all([
      remove(ref(db, `square_posts/${r.id}`)),
      remove(ref(db, `user_square_posts/${r.authorUid}/${r.id}`)),
    ])));
  };

  const createPoll = async (pollData) => {
    await post(pollData);
  };

  const maxChars = user ? getMaxChars(userData?.readCount || 0, user.uid, userData?.isAuthor) : 200;
  const topLevel = posts.filter(p => !p.parentId);
  const getReplies = (id) => posts.filter(p => p.parentId === id).sort((a, b) => a.createdAt - b.createdAt);
  const userInitials = user ? (user.displayName || 'R').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '';

  const ReactionBar = ({ p, size = 12 }) => {
    const postReactions = reactions[p.id] || {};
    return (
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        {[
          { type: 'like', Icon: HeartIcon, activeColor: '#d4537e', count: p.likeCount || 0 },
          { type: 'clap', Icon: ClapIcon, activeColor: '#d4941a', count: p.clapCount || 0 },
          { type: 'fire', Icon: FlameIcon, activeColor: '#ef4444', count: p.fireCount || 0 },
        ].map(({ type, Icon, activeColor, count }) => {
          const active = postReactions[type] || false;
          return (
            <button key={type} onClick={() => toggleReaction(p.id, type)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: user ? 'pointer' : 'default', padding: 0, color: active ? activeColor : 'rgba(255,255,255,0.22)', fontSize: '0.62rem', fontFamily: 'Inter, sans-serif', transition: 'color 0.2s', letterSpacing: '0.08em' }}>
              <Icon filled={active} size={size} />
              {count > 0 && count}
            </button>
          );
        })}
        {user && (
          <button className="sq-action-btn" onClick={() => setReplyTo(replyTo === p.id ? null : p.id)}>
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            {replyTo === p.id ? 'Cancel' : 'Reply'}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #0a0a0a; color: #e8e0d4; font-family: 'Inter', sans-serif; min-height: 100vh; }
        @keyframes sq-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes sq-lockglow { 0%,100%{background:rgba(107,47,173,0.08)} 50%{background:rgba(107,47,173,0.18)} }
        @keyframes sq-lockpulse { 0%,100%{opacity:0.3;transform:scale(1)} 50%{opacity:1;transform:scale(1.04)} }
        .sq-textarea { width: 100%; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 0.85rem 1rem; font-size: 0.95rem; color: #e8e0d4; font-family: 'Cormorant Garamond', Georgia, serif; resize: none; outline: none; line-height: 1.65; box-sizing: border-box; }
        .sq-textarea:focus { border-color: rgba(107,47,173,0.4); }
        .sq-textarea::placeholder { color: rgba(255,255,255,0.18); font-style: italic; }
        .sq-post-btn { background: #6b2fad; border: none; border-radius: 8px; padding: 7px 18px; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.2s; }
        .sq-post-btn:hover { background: #7c3aed; }
        .sq-post-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .sq-action-btn { background: none; border: none; font-size: 0.62rem; color: rgba(255,255,255,0.22); cursor: pointer; padding: 0; letter-spacing: 0.1em; text-transform: uppercase; font-family: 'Inter', sans-serif; transition: color 0.2s; display: flex; align-items: center; gap: 4px; }
        .sq-action-btn:hover { color: #9b6dff; }
        .sq-pinned-bar { background: rgba(252,211,77,0.06); border-left: 2px solid rgba(252,211,77,0.4); padding: 3px 8px; margin-bottom: 6px; display: flex; align-items: center; gap: 5px; border-radius: 0 4px 4px 0; }
        .sq-pinned-label { font-size: 0.58rem; color: rgba(252,211,77,0.6); letter-spacing: 0.12em; text-transform: uppercase; font-family: 'Inter', sans-serif; }
      `}</style>

      {/* Nav */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(10,10,10,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: '#6b2fad', borderRadius: 7, textDecoration: 'none' }}>
            <span style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 17, fontWeight: 600, color: '#fff', lineHeight: 1 }}>S</span>
          </a>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 16, color: '#f5f0e8', lineHeight: 1 }}>The Scribblings Square</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              {squareOpen ? (
                <>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#1d9e75', display: 'inline-block', animation: 'sq-pulse 2s infinite' }} />
                  <span style={{ fontSize: 10, color: '#1d9e75', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Open</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>·</span>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{presenceCount} in the room</span>
                </>
              ) : (
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Closed · Opens at 8pm London time</span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {user && (
            <>
              <button onClick={() => setShowDM(true)} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </button>
              <button onClick={() => setShowNotifs(true)} style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                {unreadNotifs > 0 && <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: '#9b6dff', border: '1.5px solid #0a0a0a' }} />}
              </button>
              <a href="/profile" style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(107,47,173,0.3)', border: '1.5px solid rgba(107,47,173,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#c4b5fd', textDecoration: 'none', overflow: 'hidden', fontFamily: 'Inter, sans-serif' }}>
                {userData?.avatarUrl ? <img src={userData.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : userInitials}
              </a>
            </>
          )}
          {!user && (
            <button onClick={() => setShowAuth(true)} style={{ background: '#6b2fad', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#fff', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Sign in</button>
          )}
          <a href="/" style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.22)', letterSpacing: '0.1em', textTransform: 'uppercase', textDecoration: 'none', fontFamily: 'Inter, sans-serif' }}>← Home</a>
        </div>
      </div>

      {/* Closed state */}
      {!squareOpen && (
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '4rem 1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '3rem' }}>
            <div style={{ position: 'relative', width: 72, height: 72, marginBottom: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ position: 'absolute', inset: -10, borderRadius: '50%', border: '1px solid rgba(107,47,173,0.15)', animation: 'sq-lockpulse 1.8s ease-in-out infinite 0.4s' }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid rgba(107,47,173,0.3)', animation: 'sq-lockpulse 1.8s ease-in-out infinite' }} />
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(107,47,173,0.12)', border: '1px solid rgba(107,47,173,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'sq-lockglow 1.8s ease-in-out infinite', position: 'relative', zIndex: 1 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9b6dff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </div>
            </div>
            <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '2rem', fontWeight: 300, color: '#f5f0e8', marginBottom: 10 }}>The Square is closed.</div>
            <div style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.7, maxWidth: 300, fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', marginBottom: 28 }}>
              The Scribblings Square opens every evening at 8pm London time. Come back then — the conversation continues.
            </div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 28 }}>
              {['Hours', 'Minutes', 'Seconds'].map((label, i) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '2.5rem', fontWeight: 300, color: '#9b6dff', lineHeight: 1 }}>{countdown.split(':')[i] || '00'}</div>
                  <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif' }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif' }}>
              Opens at <span style={{ color: 'rgba(155,109,255,0.6)' }}>8:00pm London time</span> tonight
            </div>
          </div>
          <div style={{ margin: '1.5rem 0' }}><TipBox variant="square" /></div>
          {posts.length > 0 && (
            <div style={{ opacity: 0.35 }}>
              <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginBottom: 12 }}>Last night in the Square</div>
              {topLevel.slice(0, 5).map(p => (
                <div key={p.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(107,47,173,0.2)', border: '1px solid rgba(107,47,173,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#9b6dff', flexShrink: 0, overflow: 'hidden' }}>
                    {p.authorAvatarUrl ? <img src={p.authorAvatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : p.authorInitials}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 500, color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', marginBottom: 3 }}>{p.authorName}</div>
                    <div style={{ fontSize: '0.88rem', color: 'rgba(232,224,212,0.5)', fontFamily: 'Cormorant Garamond, Georgia, serif', lineHeight: 1.6 }}>{p.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Open state */}
      {squareOpen && (
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '1.5rem 1.5rem 6rem' }}>
          <div style={{ marginBottom: '1.5rem' }}><TipBox variant="square" /></div>

          {/* Composer */}
          {user ? (
            <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <Avatar uid={user.uid} initials={userInitials} size={36} isAuthor={userData?.isAuthor} avatarUrl={userData?.avatarUrl} />
                <div style={{ flex: 1, position: 'relative' }}>
                  <textarea ref={textareaRef} className="sq-textarea" placeholder="What's on your mind? Type @ to mention someone…" value={text} onChange={e => handleTextChange(e.target.value)} rows={3} />
                  {mentionQuery !== '' && <MentionDropdown query={mentionQuery} onSelect={insertMention} />}
                  {attachedStory && (
                    <div style={{ marginTop: 8 }}>
                      <StoryEmbed story={attachedStory} />
                      <button onClick={() => setAttachedStory(null)} style={{ marginTop: 4, background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Remove story</button>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button onClick={() => setShowStoryAttach(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(107,47,173,0.08)', border: '1px solid rgba(107,47,173,0.2)', borderRadius: 6, padding: '4px 10px', fontSize: '0.68rem', color: 'rgba(155,109,255,0.65)', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                        Attach story
                      </button>
                      {isMod && (
                        <button onClick={() => setShowPollCreator(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.2)', borderRadius: 6, padding: '4px 10px', fontSize: '0.68rem', color: 'rgba(29,158,117,0.65)', letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
                          <PollIcon size={11} />
                          Create poll
                        </button>
                      )}
                      <span style={{ fontSize: '0.65rem', color: text.length > maxChars ? '#f87171' : 'rgba(255,255,255,0.18)', fontFamily: 'Inter, sans-serif' }}>{text.length} / {maxChars}</span>
                    </div>
                    <button className="sq-post-btn" onClick={() => post()} disabled={posting || !text.trim() || text.length > maxChars}>{posting ? 'Posting…' : 'Post'}</button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: '2rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '1.5rem', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1rem', color: 'rgba(255,255,255,0.4)', marginBottom: 12, fontStyle: 'italic' }}>Sign in to join the conversation</div>
              <button onClick={() => setShowAuth(true)} style={{ background: '#6b2fad', border: 'none', borderRadius: 8, padding: '0.6rem 1.5rem', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#fff', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Sign in</button>
            </div>
          )}

          {/* Feed */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem' }}>Loading…</div>
          ) : topLevel.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'rgba(255,255,255,0.18)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1rem', fontStyle: 'italic' }}>No posts yet. Be the first to say something.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {topLevel.map((p, i) => {
                const replies = getReplies(p.id);
                const isOwn = user?.uid === p.authorUid;
                const isEditing = editingPost === p.id;
                return (
                  <div key={p.id} id={p.id}>
                    {i > 0 && <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '0.25rem 0 1.25rem' }} />}
                    {p.pinned && (
                      <div className="sq-pinned-bar">
                        <PinIcon size={10} />
                        <span className="sq-pinned-label">Pinned</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10 }}>
                      <Avatar uid={p.authorUid} initials={p.authorInitials} size={34} isAuthor={p.isAuthor} avatarUrl={p.authorAvatarUrl} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                          <a href={isOwn ? '/profile' : `/user?id=${p.authorUid}`} style={{ fontSize: '0.82rem', fontWeight: 500, color: '#e8e0d4', fontFamily: 'Inter, sans-serif', textDecoration: 'none' }}
                            onMouseEnter={e => e.currentTarget.style.color = '#a78bfa'}
                            onMouseLeave={e => e.currentTarget.style.color = '#e8e0d4'}>{p.authorName}</a>
                          <UserBadge uid={p.authorUid} readCount={p.authorReadCount} isAuthor={p.isAuthor} />
                          <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.18)', fontFamily: 'Inter, sans-serif' }}>{timeAgo(p.createdAt)}{p.edited && <span style={{ color: 'rgba(255,255,255,0.15)' }}> · edited</span>}</span>
                          {user && <PostMenu post={p} user={user} onEdit={handleEdit} onDelete={handleDelete} onPin={handlePin} isMod={isMod} />}
                        </div>

                        {isEditing ? (
                          <div style={{ marginBottom: 8, position: 'relative' }}>
                            <textarea ref={editTextareaRef} className="sq-textarea" value={editText} onChange={e => handleEditTextChange(e.target.value)} rows={3} autoFocus style={{ marginBottom: 6 }} />
                            {mentionQueryEdit !== '' && <MentionDropdown query={mentionQueryEdit} onSelect={insertMentionEdit} />}
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button onClick={() => { setEditingPost(null); setMentionQueryEdit(''); }} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '5px 12px', fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Cancel</button>
                              <button className="sq-post-btn" onClick={() => saveEdit(p.id)} disabled={!editText.trim()}>Save</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1rem', color: 'rgba(232,224,212,0.82)', lineHeight: 1.7, marginBottom: 6 }}>{renderText(p.text)}</div>
                            {p.attachedStory && <StoryEmbed story={p.attachedStory} />}
                            {p.poll && <PollDisplay poll={p.poll} postId={p.id} user={user} />}
                          </>
                        )}

                        <ReactionBar p={p} size={12} />

                        {replyTo === p.id && (
                          <div style={{ marginTop: 10, position: 'relative' }}>
                            <textarea ref={replyTextareaRef} className="sq-textarea" placeholder={`Reply to ${p.authorName}…`} value={replyText} onChange={e => handleReplyTextChange(e.target.value)} rows={2} autoFocus style={{ fontSize: '0.88rem' }} />
                            {mentionQueryReply !== '' && <MentionDropdown query={mentionQueryReply} onSelect={insertMentionReply} />}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                              <button className="sq-post-btn" onClick={() => reply(p)} disabled={posting || !replyText.trim()}>{posting ? '…' : 'Reply'}</button>
                            </div>
                          </div>
                        )}

                        {replies.length > 0 && (
                          <div style={{ marginTop: 12, paddingLeft: 12, borderLeft: '1px solid rgba(107,47,173,0.2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {replies.map(r => {
                              const rIsOwn = user?.uid === r.authorUid;
                              return (
                                <div key={r.id} style={{ display: 'flex', gap: 8 }}>
                                  <Avatar uid={r.authorUid} initials={r.authorInitials} size={26} isAuthor={r.isAuthor} avatarUrl={r.authorAvatarUrl} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, flexWrap: 'wrap' }}>
                                      <a href={rIsOwn ? '/profile' : `/user?id=${r.authorUid}`} style={{ fontSize: '0.75rem', fontWeight: 500, color: '#e8e0d4', fontFamily: 'Inter, sans-serif', textDecoration: 'none' }}
                                        onMouseEnter={e => e.currentTarget.style.color = '#a78bfa'}
                                        onMouseLeave={e => e.currentTarget.style.color = '#e8e0d4'}>{r.authorName}</a>
                                      <UserBadge uid={r.authorUid} readCount={r.authorReadCount} isAuthor={r.isAuthor} />
                                      <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.18)', fontFamily: 'Inter, sans-serif' }}>{timeAgo(r.createdAt)}{r.edited && <span style={{ color: 'rgba(255,255,255,0.15)' }}> · edited</span>}</span>
                                      {user && <PostMenu post={r} user={user} onEdit={handleEdit} onDelete={handleDelete} onPin={handlePin} isMod={isMod} />}
                                    </div>
                                    {editingPost === r.id ? (
                                      <div style={{ position: 'relative' }}>
                                        <textarea ref={editTextareaRef} className="sq-textarea" value={editText} onChange={e => handleEditTextChange(e.target.value)} rows={2} autoFocus style={{ fontSize: '0.88rem', marginBottom: 6 }} />
                                        {mentionQueryEdit !== '' && <MentionDropdown query={mentionQueryEdit} onSelect={insertMentionEdit} />}
                                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                          <button onClick={() => { setEditingPost(null); setMentionQueryEdit(''); }} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '4px 10px', fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Cancel</button>
                                          <button className="sq-post-btn" onClick={() => saveEdit(r.id)} disabled={!editText.trim()}>Save</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.92rem', color: 'rgba(232,224,212,0.75)', lineHeight: 1.65 }}>{renderText(r.text)}</div>
                                    )}
                                    <ReactionBar p={r} size={11} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showStoryAttach && <StoryAttachModal onSelect={(s) => { setAttachedStory(s); setShowStoryAttach(false); }} onClose={() => setShowStoryAttach(false)} cmsStories={cmsStories} />}
      {showPollCreator && <PollCreatorModal onCreate={createPoll} onClose={() => setShowPollCreator(false)} />}
      {showDM && user && <DMPanel user={user} onClose={() => setShowDM(false)} />}
      {showNotifs && user && <NotificationsPanel user={user} onClose={() => setShowNotifs(false)} />}

      {showAuth && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000 }}>
          {(() => { const AuthModal = require('../components/AuthModal').default; return <AuthModal onClose={() => setShowAuth(false)} />; })()}
        </div>
      )}
    </>
  );
}