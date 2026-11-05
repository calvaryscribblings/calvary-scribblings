'use client';
// NOTIF-B2 — /notifications/settings: Push notifications (ruling 312).
//
// The switches change only what reaches the lock screen; everything still appears in the list.
// Each writes notify_prefs/{uid}/{key} (a boolean; the rules take nothing else), which the push
// announcer honours for stories now and the app will honour for the rest once it sends them (P4).
// The defaults are app/lib/notificationKinds.js PREFS: every switch on, "when the Square opens" off.
//
// YOUR WRITING shows to writers only (users/{uid}.isAuthor, the same flag the writer badge reads).
// Ruling 337: only cards whose push is live are drawn (app/lib/notifySettings.js CARD_LIVE).

import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { PREFS } from '../../lib/notificationKinds';
import { visibleCards, needsWriterFlag } from '../../lib/notifySettings';
import NotificationsHeader from '../../components/bell/NotificationsHeader';
import { MoonGlyph } from '../../components/bell/icons';

const INTER = "'Inter', system-ui, -apple-system, sans-serif";
const SERIF = "'Cormorant Garamond', Georgia, serif";
const FONTS = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&display=swap');";

function Switch({ on, label, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      data-switch={on ? 'on' : 'off'}
      style={{ width: 51, height: 31, borderRadius: 999, border: 'none', padding: 2, cursor: disabled ? 'default' : 'pointer', background: on ? '#6E45C8' : '#2A2638', position: 'relative', flexShrink: 0, transition: 'background 0.18s' }}
    >
      <span style={{ position: 'absolute', top: 2, left: on ? 22 : 2, width: 27, height: 27, borderRadius: '50%', background: '#F6F1E7', boxShadow: '0 2px 5px rgba(0,0,0,0.35)', transition: 'left 0.18s' }} />
    </button>
  );
}

export default function NotificationSettingsPage() {
  const { user, loading } = useAuth();
  const [prefs, setPrefs] = useState(null);
  const [writer, setWriter] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user) return undefined;
    let live = true;
    (async () => {
      const { db } = await import('../../lib/firebaseCore');
      const { ref, get } = await import('firebase/database');
      const [p, a] = await Promise.all([
        get(ref(db, `notify_prefs/${user.uid}`)).then((s) => s.val()).catch(() => null),
        needsWriterFlag() ? get(ref(db, `users/${user.uid}/isAuthor`)).then((s) => s.val()).catch(() => null) : null,
      ]);
      if (!live) return;
      setPrefs(p && typeof p === 'object' ? p : {});
      setWriter(a === true);
    })();
    return () => { live = false; };
  }, [user]);

  const value = (key) => (typeof prefs?.[key] === 'boolean' ? prefs[key] : PREFS[key].default);

  const flip = async (key, on) => {
    const before = prefs;
    setPrefs((p) => ({ ...(p || {}), [key]: on }));
    setError(null);
    try {
      const { db } = await import('../../lib/firebaseCore');
      const { ref, set } = await import('firebase/database');
      await set(ref(db, `notify_prefs/${user.uid}/${key}`), on);
    } catch (e) {
      setPrefs(before);
      setError('That switch didn’t save. Try again.');
      console.error('[notify_prefs] not saved:', e?.code || e?.message || e);
    }
  };

  return (
    <main data-notification-settings style={{ minHeight: '100vh', background: '#0A0A0A', color: '#EFE8DA' }}>
      <style>{FONTS}</style>
      <NotificationsHeader back={{ href: '/notifications', label: 'NOTIFICATIONS' }} title="" settings={false} />
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '8px 20px calc(56px + env(safe-area-inset-bottom))' }}>
        <h1 style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 34, lineHeight: 1.15, margin: '18px 0 10px', color: '#EFE8DA' }}>Push notifications</h1>
        <p style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 17, lineHeight: 1.45, color: '#A39CB2', margin: '0 0 26px' }}>
          These switches only change what reaches your lock screen. Everything still appears in your notifications.
        </p>
        {loading ? null : !user ? (
          <p data-signed-out style={{ fontFamily: SERIF, fontSize: 18, color: '#A39CB2' }}>Sign in to choose what reaches your lock screen.</p>
        ) : (
          <>
            {visibleCards({ writer }).map((card) => (
              <section key={card.heading} data-card={card.heading} style={{ marginBottom: 22 }}>
                <h2 style={{ fontFamily: INTER, fontWeight: 600, fontSize: 11, letterSpacing: '0.24em', color: '#C9A84C', margin: '0 0 10px 6px' }}>{card.heading}</h2>
                <div style={{ background: '#100E19', border: '1px solid #221F2E', borderRadius: 22, overflow: 'hidden' }}>
                  {card.rows.map((row, i) => (
                    <div key={row.key} data-pref={row.key} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '15px 18px', borderTop: i ? '1px solid #221F2E' : 'none' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontFamily: SERIF, fontSize: 19, lineHeight: 1.25, color: '#EFE8DA' }}>{row.label}</span>
                        <span style={{ display: 'block', fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, lineHeight: 1.35, color: '#A39CB2', marginTop: 2 }}>{row.sub}</span>
                      </span>
                      <Switch on={value(row.key)} label={row.label} disabled={prefs === null} onChange={(on) => flip(row.key, on)} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {error ? <p role="alert" style={{ fontFamily: SERIF, fontSize: 16, color: '#E7A0AE', margin: '0 0 18px' }}>{error}</p> : null}
            <p data-quiet-hours style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontFamily: SERIF, fontStyle: 'italic', fontSize: 16, lineHeight: 1.45, color: '#A39CB2', margin: '28px 6px 0' }}>
              <span style={{ paddingTop: 3 }}><MoonGlyph size={16} color="#A39CB2" /></span>
              <span>Nothing arrives between midnight and 08:00 London. Anything sent in those hours reaches you together at 08:00.</span>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
