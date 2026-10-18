'use client';

// W53 — THE READER CARD. Tapping a reader's name or face anywhere in the Square (feed, thread,
// messages, notifications) opens it: a bottom sheet on phones, a dialog at wider widths.
//
//   72px face · name at 24px · their UserBadge · "@handle" (+ " · reading since {Month}" only
//   when their record has a join date)
//   Message (filled #6b2fad) · Profile (outlined, /user?id=) — both 44px
//   Mute in the Square / Block @handle, with 20px icons; once set, Unmute / Unblock @handle
// Your own card shows only Profile. Identity comes from the live record (ruling 203).

import { useEffect, useState } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '../../lib/firebaseCore';
import { Avatar, UserBadge } from '../conversation/ConversationKit';
import { resolveIdentities, identityOf } from '../../lib/squareIdentity';
import { SAFETY_COPY, readingSince } from '../../lib/squareSafety';

const FF = 'Cormorant Garamond, Georgia, serif';
const INK = (a) => `rgba(245,240,232,${a})`;
const BLOCK = '#e0868f';

const CSS = `
  .rc-scrim { position: fixed; inset: 0; z-index: 2500; background: rgba(0,0,0,0.72); display: flex; align-items: flex-end; justify-content: center; }
  .rc-card { position: relative; width: 100%; background: #141018; border: 1px solid rgba(107,47,173,0.3); border-radius: 20px 20px 0 0;
    padding: 22px 20px calc(20px + env(safe-area-inset-bottom) + var(--cs-cookie-space, 0px)); box-sizing: border-box; color: #f5f0e8; font-family: ${FF}; }
  @media (min-width: 640px) {
    .rc-scrim { align-items: center; }
    .rc-card { max-width: 420px; border-radius: 16px; padding-bottom: 22px; }
  }
`;

function MuteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}
function BlockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
    </svg>
  );
}

export default function ReaderCard({ uid, me, safety, onMessage, onClose }) {
  const [who, setWho] = useState(null);
  const [joined, setJoined] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [map, created] = await Promise.all([
          resolveIdentities(db, [uid]),
          get(ref(db, `users/${uid}/createdAt`)).then((s) => s.val()).catch(() => null),
        ]);
        if (cancelled) return;
        setWho(identityOf({ authorUid: uid }, map.get(uid)));
        setJoined(created);
      } catch (e) { console.error('Reader card lookup error:', e); }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const own = me?.uid === uid;
  const handle = who?.handle || who?.displayName || 'reader';
  const muted = safety?.isMuted(uid);
  const blocked = safety?.isBlocked(uid);
  const flip = async (kind) => {
    setBusy(kind);
    try { if (kind === 'mute') await safety.setMute(uid, !muted); else await safety.setBlock(uid, !blocked); } catch {}
    setBusy('');
  };

  const row = (kind, icon, title, hint, color) => (
    <button type="button" onClick={() => flip(kind)} disabled={!!busy} data-card-action={kind}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 12, width: '100%', minHeight: 44, padding: '10px 2px', background: 'none', border: 'none', borderTop: `1px solid ${INK(0.08)}`, color, textAlign: 'left', cursor: 'pointer', fontFamily: FF }}>
      <span style={{ flex: 'none', marginTop: 2 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '1rem', fontWeight: 500 }}>{title}</span>
        {hint && <span style={{ display: 'block', fontSize: '0.85rem', color: INK(0.55), marginTop: 2 }}>{hint}</span>}
      </span>
    </button>
  );

  return (
    <div className="rc-scrim" onClick={onClose} data-reader-card-scrim>
      <style>{CSS}</style>
      <div className="rc-card" role="dialog" aria-modal="true" aria-label={who ? who.displayName : 'Reader'} data-reader-card={uid} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close"
          style={{ position: 'absolute', top: 6, right: 6, width: 44, height: 44, background: 'none', border: 'none', color: INK(0.7), fontSize: '1.4rem', cursor: 'pointer' }}>×</button>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 6 }}>
          <Avatar uid={uid} initials={who?.initials || ''} size={72} isAuthor={who?.isAuthor} avatarUrl={who?.avatarUrl} link={false} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 24, fontWeight: 500, lineHeight: 1.2 }}>{who ? who.displayName : ' '}</span>
            {who && <UserBadge uid={uid} readCount={who.readCount} isAuthor={who.isAuthor} />}
          </div>
          {who && (
            <div data-card-handle style={{ fontSize: '0.95rem', color: INK(0.55) }}>
              {who.handle ? `@${who.handle}` : ''}{readingSince(joined)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, margin: '18px 0 8px' }}>
          {!own && (
            <button type="button" onClick={() => onMessage?.(uid)} disabled={blocked}
              style={{ flex: 1, height: 44, borderRadius: 10, background: '#6b2fad', border: 'none', color: '#f5f0e8', fontFamily: FF, fontSize: '0.95rem', letterSpacing: '0.06em', cursor: blocked ? 'default' : 'pointer', opacity: blocked ? 0.45 : 1 }}>
              {SAFETY_COPY.message}
            </button>
          )}
          <a href={`/user?id=${uid}`}
            style={{ flex: 1, height: 44, borderRadius: 10, border: '1px solid rgba(167,139,250,0.55)', color: '#e9e3f7', fontFamily: FF, fontSize: '0.95rem', letterSpacing: '0.06em', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
            {SAFETY_COPY.profile}
          </a>
        </div>
        {!own && me && (
          <div>
            {row('mute', <MuteIcon />, muted ? SAFETY_COPY.unmute : SAFETY_COPY.mute, muted ? '' : SAFETY_COPY.muteHint, '#f5f0e8')}
            {row('block', <BlockIcon />, blocked ? SAFETY_COPY.unblock(handle) : SAFETY_COPY.block(handle), blocked ? '' : SAFETY_COPY.blockHint, BLOCK)}
          </div>
        )}
      </div>
    </div>
  );
}
