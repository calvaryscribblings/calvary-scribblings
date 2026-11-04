'use client';
// NOTIF-B2 — THE BELL (rulings 305, 325, 326, 327). Signed-in readers only.
//
// The button: a 36px circle (31px on a phone) inside a 44px target, #1E1B28, the bell outlined in
// #EFE8DA at stroke 1.8; open, #2A2340 with a 1px #6E4BD8 ring. Its badge: a violet pill (#6E45C8)
// at least 17×17, Inter 700 10px #F6F1E7, ringed 2px in the header's ground, 5px above and 7px right
// of the circle's top-right. "99+" above 99; nothing at zero.
//
// mode="panel" (iPad and desktop): opens the panel under the header at the right.
// mode="page"  (phone): opens /notifications.
// mode="auto"  (the Square's own bell): the panel at 768px and wider, the page below.
//
// tone="dark" is the house ground; tone="light" takes the circle and text from the cream theme's
// own tokens (app/lib/archiveLock.js LOCK_THEMES.cream) and keeps the layout and the badge.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBell, useBellDetails } from '../../lib/useBell';
import { badgeText, ariaLabel, PANEL_ROWS } from '../../lib/bell';
import { LOCK_THEMES } from '../../lib/archiveLock';
import { BellGlyph, SlidersGlyph } from './icons';
import BellRow from './BellRow';

export const PHONE_MAX = 767.98;   // the header's own breakpoint (Navbar, TabBar)
const INTER = "'Inter', system-ui, -apple-system, sans-serif";
const FONTS = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=swap');";

export const TONES = {
  dark: { fill: '#1E1B28', glyph: '#EFE8DA', openFill: '#2A2340', openRing: '#6E4BD8', ground: '#0A0A0A' },
  light: {
    fill: LOCK_THEMES.cream.wash, glyph: LOCK_THEMES.cream.headline, openFill: LOCK_THEMES.cream.ctaHoverWash,
    openRing: LOCK_THEMES.cream.ctaBorder, ground: LOCK_THEMES.cream.ground,
  },
};

export function BellButton({ unread, open, onPress, phone = false, tone = 'dark', controls }) {
  const t = TONES[tone] || TONES.dark;
  const circle = phone ? 31 : 36;
  const text = badgeText(unread);
  return (
    <button
      type="button"
      data-bell-button
      data-unread={unread || 0}
      aria-label={ariaLabel(unread)}
      aria-haspopup={controls ? 'dialog' : undefined}
      aria-expanded={controls ? !!open : undefined}
      aria-controls={controls || undefined}
      onClick={onPress}
      style={{ width: 44, height: 44, padding: 0, border: 'none', background: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}
    >
      <span
        data-bell-circle
        style={{
          position: 'relative', width: circle, height: circle, borderRadius: '50%',
          background: open ? t.openFill : t.fill, boxShadow: open ? `0 0 0 1px ${t.openRing}` : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s',
        }}
      >
        <BellGlyph size={phone ? 16 : 18} color={t.glyph} stroke={1.8} />
        {text ? (
          <span
            data-bell-badge
            style={{
              position: 'absolute', top: -5, right: -7, minWidth: 17, height: 17, padding: '0 4px', boxSizing: 'border-box',
              borderRadius: 9, background: '#6E45C8', color: '#F6F1E7', fontFamily: INTER, fontWeight: 700, fontSize: 10,
              lineHeight: '17px', textAlign: 'center', boxShadow: `0 0 0 2px ${t.ground}`, fontVariantNumeric: 'tabular-nums',
            }}
          >{text}</span>
        ) : null}
      </span>
    </button>
  );
}

/** The panel: under the header at the right, 400px (never wider than the screen), five rows. */
export function BellPanel({ id, bell, onClose, anchorRef, top = 76 }) {
  const ref = useRef(null);
  const rows = bell.list.slice(0, PANEL_ROWS);
  const details = useBellDetails(rows);
  const since = bell.prevSeen;
  const [now] = useState(() => Date.now());   // the panel's clock, read once as it opens

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(true); } };
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return;
      onClose(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown, true); };
  }, [onClose, anchorRef]);

  return (
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label="Notifications"
      data-bell-panel
      style={{
        position: 'fixed', top, right: 'max(16px, 4vw)', width: 400, maxWidth: 'calc(100vw - 32px)', zIndex: 1100,
        background: '#14121C', border: '1px solid #2A2637', borderRadius: 16, boxShadow: '0 28px 70px rgba(0,0,0,.6)',
        overflow: 'hidden', color: '#EFE8DA',
      }}
    >
      <style>{FONTS}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 12px 20px' }}>
        <span style={{ fontFamily: INTER, fontWeight: 600, fontSize: 11, letterSpacing: '0.24em', color: '#C9A84C' }}>NOTIFICATIONS</span>
        <a href="/notifications/settings" data-bell-settings style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: INTER, fontWeight: 500, fontSize: 12.5, color: '#A9A4B5', textDecoration: 'none' }}>
          <SlidersGlyph size={14} color="#A9A4B5" />Settings
        </a>
      </div>
      <div data-bell-rows>
        {!bell.ready && !rows.length ? (
          <div style={{ padding: '22px 20px', fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic', fontSize: 16, color: '#8E879D' }}>Loading…</div>
        ) : rows.length ? rows.map((r) => (
          <BellRow key={r.key} r={r} details={details} now={now} compact fresh={typeof since === 'number' && r.at > since} onOpen={() => onClose(false)} />
        )) : (
          <div data-bell-empty style={{ padding: '22px 20px', fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic', fontSize: 16, color: '#8E879D' }}>Nothing yet.</div>
        )}
      </div>
      <a href="/notifications" data-bell-all style={{ display: 'block', padding: '14px 20px 16px', borderTop: '1px solid #2A2637', fontFamily: "'Cormorant Garamond', Georgia, serif", fontStyle: 'italic', fontSize: 16.5, color: '#C9A84C', textDecoration: 'none', textAlign: 'center' }}>
        See all notifications
      </a>
    </div>
  );
}

/**
 * The bell for a signed-in reader. Renders nothing for anyone else.
 * @param user  the Firebase user (null: nothing)
 */
/** True below the header's phone breakpoint, live. */
function usePhoneWidth(enabled) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(`(max-width: ${PHONE_MAX}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [enabled]);
  return narrow;
}

/**
 * @param phone     true: the 31px circle; 'auto': 31px below 768px, 36px above
 * @param panelTop  where the panel's top sits; omitted, 8px under the bell's own target
 */
export default function Bell({ user, mode = 'auto', tone = 'dark', phone = false, panelTop }) {
  const bell = useBell(user);
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(panelTop ?? 76);
  const anchor = useRef(null);
  const panelId = useId();
  const narrow = usePhoneWidth(phone === 'auto');
  const small = phone === 'auto' ? narrow : !!phone;
  const { markSeen } = bell;
  const router = useRouter();

  const close = useCallback((refocus) => {
    setOpen(false);
    if (refocus) anchor.current?.querySelector('button')?.focus();
  }, []);

  const press = useCallback(() => {
    const toPage = mode === 'page' || (mode === 'auto' && typeof window !== 'undefined' && window.matchMedia(`(max-width: ${PHONE_MAX}px)`).matches);
    if (toPage) { router.push('/notifications'); return; }
    if (!open) {
      markSeen();   // ruling 326: opening clears the count; the dots stay while it is open
      if (panelTop === undefined && anchor.current) setTop(Math.round(anchor.current.getBoundingClientRect().bottom + 8));
    }
    setOpen(!open);
  }, [mode, markSeen, open, panelTop, router]);

  if (!user) return null;
  return (
    <span ref={anchor} data-bell={mode} style={{ display: 'inline-flex', position: 'relative' }}>
      <style>{FONTS}</style>
      <BellButton unread={bell.unread} open={open} onPress={press} phone={small} tone={tone} controls={mode === 'page' ? null : panelId} />
      {open ? <BellPanel id={panelId} bell={bell} onClose={close} anchorRef={anchor} top={top} /> : null}
    </span>
  );
}
