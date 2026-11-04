'use client';
// NOTIF-B2 — the header of /notifications and /notifications/settings: a gold back link on the left,
// the page's name centred, and (on the list) the 32px settings button on the right.

import { SlidersGlyph } from './icons';

const INTER = "'Inter', system-ui, -apple-system, sans-serif";

export default function NotificationsHeader({ back = { href: '/public-library', label: 'HOME' }, title = 'NOTIFICATIONS', settings = true }) {
  return (
    <header data-notifications-header style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0A0A0A', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: 'calc(14px + env(safe-area-inset-top)) 16px 14px', borderBottom: '1px solid #1B1828' }}>
      <a href={back.href} data-back style={{ justifySelf: 'start', fontFamily: INTER, fontWeight: 600, fontSize: 12, letterSpacing: '0.22em', color: '#C9A84C', textDecoration: 'none', padding: '8px 0' }}>
        <span aria-hidden="true">‹ </span>{back.label}
      </a>
      <h1 style={{ margin: 0, fontFamily: INTER, fontWeight: 600, fontSize: 12, letterSpacing: '0.26em', color: '#9A95A8' }}>{title}</h1>
      {settings ? (
        <a href="/notifications/settings" aria-label="Notification settings" data-settings-button style={{ justifySelf: 'end', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#1B1828', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SlidersGlyph size={15} color="#A9A4B5" />
          </span>
        </a>
      ) : <span />}
    </header>
  );
}
