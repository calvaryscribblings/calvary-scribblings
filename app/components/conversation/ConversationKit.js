'use client';

// ── ConversationKit ───────────────────────────────────────────────────────────
// Shared presentation primitives for the two conversation surfaces — story
// comments (app/stories/[slug]/page-client.js) and the Scribblings Square
// (app/square/page.js). Both surfaces render the same anatomy — an avatar, a
// name line with a verified/reader badge, a body, and a reaction row — so the
// look lives here and each surface passes its own data in.
//
// DATA SHAPES ARE SACRED: reaction DB keys stay per-surface (comments use
// `heart`, Square uses `like`). ReactionRow takes a `reactions` descriptor so
// both map their own key onto the shared heart icon. Firebase paths are never
// touched here — this module is presentation only.

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

const FONT = 'Cormorant Garamond, Georgia, serif';
const IMG = { width: '100%', height: '100%', objectFit: 'cover' };

// ── Palette ───────────────────────────────────────────────────────────────────
// The island's house palette: cream text, gold accents. Avatar initials and
// @mentions are gold on a house-purple chip; the author ring stays its deeper
// purple so writers still read distinctly.
const GOLD = '#c9a84c';
const AVATAR_INITIAL_COLOR = GOLD;
const AVATAR_BG_COMMENT = 'rgba(107,47,173,0.22)';
const AVATAR_BORDER_COMMENT = 'rgba(107,47,173,0.3)';
const AVATAR_BG_SQUARE = 'rgba(107,47,173,0.22)';
const AVATAR_BORDER_SQUARE = 'rgba(107,47,173,0.3)';
const AVATAR_BG_AUTHOR = 'rgba(88,28,135,0.25)';
const AVATAR_BORDER_AUTHOR = 'rgba(88,28,135,0.5)';
const MENTION_COLOR = GOLD;

// Reaction active colours — shared by both surfaces so applause reads the same
// gold on comment and Square. Inactive stroke is passed per-surface in Phase 1.
export const REACTION_COLORS = { heart: '#d4537e', clap: '#d4941a', fire: '#ef4444' };

// ── Icon paths ────────────────────────────────────────────────────────────────
export const BADGE_SVG_PATH = "M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91C1.87 9.33 1 10.57 1 12s.87 2.67 2.19 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91C21.37 14.67 22.25 13.43 22.25 12z";
export const CHECK_PATH = "M9.13 17.75L5.5 14.12l1.41-1.41 2.22 2.22 6.34-7.59 1.53 1.28z";
export const HEART_PATH = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";
const CLAP_PATH_1 = "M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z";
const CLAP_PATH_2 = "M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3";
const FIRE_PATH = "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z";

// ── timeAgo ───────────────────────────────────────────────────────────────────
// Unified to the comments behaviour: minutes → hours → Nd up to 7 days → date.
export function timeAgo(ts) {
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

// ── renderMentions ────────────────────────────────────────────────────────────
// One implementation for both surfaces. Links @handles to their profile.
export function renderMentions(text) {
  if (!text) return text;
  const parts = [];
  let last = 0;
  const re = /(^|\s)@([a-z0-9_]{3,20})\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, pre, handle] = m;
    const start = m.index + pre.length;
    const end = start + 1 + handle.length;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a key={start} href={`/user?handle=${handle}`} style={{ color: MENTION_COLOR, textDecoration: 'none', fontWeight: 500 }}>@{handle}</a>
    );
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── Badge tier ────────────────────────────────────────────────────────────────
export function getBadge(readCount) {
  // Immortal keeps its violet — it's the top tier, distinct from the gold
  // accents (written as rgb() to stay clear of the palette-sweep hex grep).
  if (readCount >= 1000) return { tier: 'immortal', label: 'Immortal of the Island', color: 'rgb(155,109,255)' };
  if (readCount >= 150) return { tier: 'legend', label: 'Legend of the Island', color: '#d4537e' };
  if (readCount >= 90) return { tier: 'islander', label: 'Story Islander', color: '#d4941a' };
  if (readCount >= 60) return { tier: 'island', label: 'Island Reader', color: '#1d9e75' };
  if (readCount >= 25) return { tier: 'reader', label: 'Reader', color: '#b4b2a9' };
  return null;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
// variant 'comment' self-fetches the avatar by uid and links to /profile for the
// viewer's own comment; variant 'square' takes avatarUrl as a prop and carries
// the author ring when isAuthor is set.
const COMMENT_DIMS = { xs: { dim: 26, font: 9 }, sm: { dim: 34, font: 11 }, md: { dim: 36, font: 12 } };

export function Avatar({ variant = 'square', uid, initials, avatarUrl, size, isAuthor = false, isOwn = false }) {
  const selfFetch = variant === 'comment';
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (!selfFetch || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `users/${uid}/avatarUrl`));
        if (!cancelled && snap.exists()) setFetched(snap.val());
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, [uid, selfFetch]);
  const photo = selfFetch ? fetched : avatarUrl;

  if (variant === 'comment') {
    const { dim, font } = COMMENT_DIMS[size] || COMMENT_DIMS.sm;
    const href = isOwn ? '/profile' : `/user?id=${uid}`;
    return (
      <a href={href} style={{
        width: dim, height: dim, borderRadius: '50%',
        background: AVATAR_BG_COMMENT, border: `1px solid ${AVATAR_BORDER_COMMENT}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: font, fontWeight: 500, color: AVATAR_INITIAL_COLOR, flexShrink: 0,
        fontFamily: FONT, overflow: 'hidden', textDecoration: 'none',
      }}>
        {photo ? <img src={photo} alt={initials} style={IMG} /> : initials}
      </a>
    );
  }

  const dim = size || 36;
  return (
    <a href={`/user?id=${uid}`} style={{
      width: dim, height: dim, borderRadius: '50%', flexShrink: 0,
      background: isAuthor ? AVATAR_BG_AUTHOR : AVATAR_BG_SQUARE,
      border: isAuthor ? `1.5px solid ${AVATAR_BORDER_AUTHOR}` : `1.5px solid ${AVATAR_BORDER_SQUARE}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: dim * 0.3, fontWeight: 500, color: AVATAR_INITIAL_COLOR,
      overflow: 'hidden', textDecoration: 'none', fontFamily: FONT,
    }}>
      {photo ? <img src={photo} alt={initials} style={IMG} /> : initials}
    </a>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────
export function BadgeIcon({ color, size = 13, isFounder = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="ckPlatGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#e8f0f8"/><stop offset="50%" stopColor="#c8daea"/><stop offset="100%" stopColor="#a8c0d6"/>
        </linearGradient>
      </defs>
      <path fill={isFounder ? 'url(#ckPlatGrad)' : color} d={BADGE_SVG_PATH} />
      <path fill={color === '#b4b2a9' ? '#0a0a0a' : '#f5f0e8'} d={CHECK_PATH} />
    </svg>
  );
}

export function WriterBadge({ size = 13 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
        <path fill="#581c87" d={BADGE_SVG_PATH} />
        <path fill="#e9d5ff" d={CHECK_PATH} />
      </svg>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(212,83,126,0.12)', border: '1px solid rgba(212,83,126,0.35)', borderRadius: 6, padding: '1px 7px 1px 5px' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><path fill="#d4537e" d={HEART_PATH} /></svg>
        <span style={{ fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#d4537e', fontFamily: FONT, whiteSpace: 'nowrap' }}>Writer</span>
      </span>
    </span>
  );
}

function BadgeLabel({ tier, label, color, size, labelSize, gap }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap }}>
      <BadgeIcon color={color} size={size} isFounder={tier === 'founder'} />
      <span style={{ fontSize: labelSize, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: tier === 'founder' ? '#c8daea' : color, fontFamily: FONT, whiteSpace: 'nowrap' }}>{label}</span>
    </span>
  );
}

// UserBadge — Square passes readCount/isAuthor directly; comments pass `self`
// with a uid and the kit reads the user's readCount + isAuthor from Firebase.
export function UserBadge({ uid, readCount, isAuthor, self = false, size = 12, labelSize = '0.58rem', gap = 3 }) {
  const [data, setData] = useState(self ? null : { readCount, isAuthor });
  useEffect(() => {
    if (!self || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `users/${uid}`));
        if (!cancelled && snap.exists()) {
          const v = snap.val();
          setData({ readCount: v.readCount || 0, isAuthor: v.isAuthor || false });
        }
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, [uid, self]);
  const resolved = self ? data : { readCount, isAuthor };
  if (!resolved) return null;
  if (resolved.isAuthor) return <WriterBadge size={size} />;
  const badge = getBadge(resolved.readCount || 0);
  if (!badge) return null;
  return <BadgeLabel tier={badge.tier} label={badge.label} color={badge.color} size={size} labelSize={labelSize} gap={gap} />;
}

// ── Reactions ─────────────────────────────────────────────────────────────────
// A reaction descriptor maps a per-surface DB key onto a shared icon + colour:
//   comments → [{ key:'heart', icon:'heart', ... }, ...]
//   Square   → [{ key:'like',  icon:'heart', ... }, ...]
export function buildReactions(heartKey) {
  return [
    { key: heartKey, icon: 'heart', activeColor: REACTION_COLORS.heart },
    { key: 'clap', icon: 'clap', activeColor: REACTION_COLORS.clap },
    { key: 'fire', icon: 'fire', activeColor: REACTION_COLORS.fire },
  ];
}

function ReactionIcon({ type, size, active, color, strokeWidth = 1.5 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: active ? color : 'none', stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (type === 'heart') return <svg {...common}><path d={HEART_PATH} /></svg>;
  if (type === 'clap') return <svg {...common}><path d={CLAP_PATH_1} /><path d={CLAP_PATH_2} /></svg>;
  if (type === 'fire') return <svg {...common}><path d={FIRE_PATH} /></svg>;
  return null;
}

export function ReactionRow({
  reactions, item, activeMap, onToggle, canReact,
  iconSize = 14, inactiveColor = 'rgba(255,255,255,0.4)',
  countSize = '0.7rem', press = false,
  gap = 12, buttonGap = 4, marginTop = 8, trailing = null,
}) {
  const [pressed, setPressed] = useState(null);
  const pressHandlers = press ? (key) => ({
    onMouseDown: () => setPressed(key), onMouseUp: () => setPressed(null),
    onMouseLeave: () => setPressed(null),
    onTouchStart: () => setPressed(key), onTouchEnd: () => setPressed(null),
  }) : () => ({});
  return (
    <div style={{ display: 'flex', gap, marginTop, alignItems: 'center', flexWrap: 'wrap' }}>
      {reactions.map(({ key, icon, activeColor }) => {
        const active = activeMap?.[key];
        const count = item[`${key}Count`] || 0;
        const color = active ? activeColor : inactiveColor;
        return (
          <button key={key} onClick={() => onToggle(key)} {...pressHandlers(key)}
            style={{ background: 'none', border: 'none', cursor: canReact ? 'pointer' : 'default', padding: 0, display: 'flex', alignItems: 'center', gap: buttonGap, color, fontSize: countSize, fontWeight: 500, fontFamily: FONT, letterSpacing: '0.08em', transform: (press && pressed === key) ? 'scale(0.82)' : 'scale(1)', transition: 'transform 0.1s ease, color 0.2s' }}>
            <ReactionIcon type={icon} size={iconSize} active={active} color={color} />
            {count > 0 && <span style={{ fontFamily: FONT }}>{count}</span>}
          </button>
        );
      })}
      {trailing}
    </div>
  );
}
