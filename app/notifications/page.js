'use client';
// NOTIF-B2 — /notifications: THE ONE LIST (rulings 305, 327), in full.
//
// Header: "‹ HOME" in gold on the left, "NOTIFICATIONS" centred, a 32px settings button on the
// right. Sections TODAY, THIS WEEK, EARLIER. Rows as the panel draws them, at full size
// (components/bell/BellRow.js). Opening the page sets seenAt to now, so the count clears; the rows
// that arrived since the previous visit keep their violet dot while the page is open (ruling 326).
//
// Reads: the new inbox, announcements, and the two old nodes, newest first, each event once, the
// blocked and muted left out, every read bounded (app/lib/useBell.js, app/lib/bell.js).

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { useBell, useBellDetails } from '../lib/useBell';
import { sections } from '../lib/bell';
import BellRow from '../components/bell/BellRow';
import NotificationsHeader from '../components/bell/NotificationsHeader';
import AuthModal from '../components/AuthModal';

const INTER = "'Inter', system-ui, -apple-system, sans-serif";
const SERIF = "'Cormorant Garamond', Georgia, serif";
const FONTS = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=swap');";

function SignedOut() {
  const [auth, setAuth] = useState(false);
  return (
    <div data-signed-out style={{ maxWidth: 520, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
      <p style={{ fontFamily: SERIF, fontSize: 22, color: '#EFE8DA', margin: '0 0 8px' }}>Sign in to see your notifications.</p>
      <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 16.5, color: '#A39CB2', margin: '0 0 24px' }}>Replies, mentions, messages and new stories, in one list.</p>
      <button type="button" onClick={() => setAuth(true)} style={{ background: '#6E45C8', color: '#F6F1E7', border: 'none', borderRadius: 999, padding: '12px 26px', fontFamily: INTER, fontWeight: 600, fontSize: 12, letterSpacing: '0.18em', cursor: 'pointer' }}>SIGN IN</button>
      {auth ? <AuthModal onClose={() => setAuth(false)} /> : null}
    </div>
  );
}

function List({ user }) {
  const bell = useBell(user);
  const details = useBellDetails(bell.list);
  const seen = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const { ready, markSeen } = bell;

  // Opening the page is opening the list: once, when it has loaded.
  useEffect(() => {
    if (!ready || seen.current) return;
    seen.current = true;
    markSeen();
  }, [ready, markSeen]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  if (!ready && !bell.list.length) {
    return <p data-loading style={{ textAlign: 'center', fontFamily: SERIF, fontStyle: 'italic', fontSize: 17, color: '#8E879D', padding: '48px 0' }}>Loading…</p>;
  }
  if (!bell.list.length) {
    return <p data-empty style={{ textAlign: 'center', fontFamily: SERIF, fontStyle: 'italic', fontSize: 17, color: '#8E879D', padding: '48px 24px' }}>Nothing yet. Replies, mentions, messages and new stories will appear here.</p>;
  }
  const since = bell.prevSeen;
  return (
    <div data-notifications-list>
      {sections(bell.list, now).map((s) => (
        <section key={s.label} data-section={s.label}>
          <h2 style={{ margin: 0, padding: '22px 24px 8px', fontFamily: INTER, fontWeight: 600, fontSize: 11, letterSpacing: '0.24em', color: '#C9A84C' }}>{s.label}</h2>
          {s.rows.map((r) => <BellRow key={r.key} r={r} details={details} now={now} fresh={typeof since === 'number' && r.at > since} />)}
        </section>
      ))}
    </div>
  );
}

export default function NotificationsPage() {
  const { user, loading } = useAuth();
  return (
    <main data-notifications-page style={{ minHeight: '100vh', background: '#0A0A0A', color: '#EFE8DA' }}>
      <style>{FONTS}</style>
      <NotificationsHeader />
      <div style={{ maxWidth: 680, margin: '0 auto', paddingBottom: 'calc(48px + env(safe-area-inset-bottom))' }}>
        {loading ? null : user ? <List user={user} /> : <SignedOut />}
      </div>
    </main>
  );
}
