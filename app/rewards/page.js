'use client';
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';

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

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RewardsPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState(null);
  const [pointsHistory, setPointsHistory] = useState([]);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    (async () => {
      const auth = await getFirebaseAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        if (u) await loadScribbles(u);
        else setLoading(false);
      });
    })();
  }, []);

  async function loadScribbles(u) {
    setLoading(true);
    try {
      const db = await getDB();
      const { ref, get, set } = await import('firebase/database');

      const pointsSnap = await get(ref(db, `points/${u.uid}`));
      if (!pointsSnap.exists()) {
        const now = Date.now();
        await set(ref(db, `points/${u.uid}`), {
          total: 0,
          initialised: true,
          history: [{ type: 'init', amount: 0, description: 'Scribbles account initialised', createdAt: now }],
        });
        setPoints({ total: 0 });
        setPointsHistory([]);
      } else {
        const p = pointsSnap.val();
        setPoints(p);
        setPointsHistory(p.history ? Object.values(p.history).sort((a, b) => b.createdAt - a.createdAt) : []);
      }
    } catch (e) { console.error('Rewards load error:', e); }
    setLoading(false);
  }

  if (!user && !loading) return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Cochin, Georgia, serif', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem' }}>
      <Navbar />
      <div style={{ textAlign: 'center', paddingTop: '6rem' }}>
        <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '2rem', fontWeight: 300, color: '#f5f0e8', marginBottom: '1rem' }}>Reader's Reward</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem' }}>Sign in to view your Scribbles and rewards.</div>
      </div>
    </div>
  );

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Cochin, Georgia, serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        .rw-tab { background: none; border: none; padding: 0.6rem 1.2rem; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.35); cursor: pointer; font-family: Inter, sans-serif; border-bottom: 2px solid transparent; transition: all 0.2s; }
        .rw-tab.active { color: #a78bfa; border-bottom-color: #6b2fad; }
        .rw-tab:hover { color: rgba(255,255,255,0.7); }
        @keyframes rw-shimmer { 0%,100%{opacity:0.7} 50%{opacity:1} }
      `}</style>

      <Navbar />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '6rem 1.5rem 4rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <div style={{ fontSize: '0.68rem', color: '#9b6dff', letterSpacing: '0.18em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginBottom: '0.5rem' }}>Reader's Reward</div>
          <h1 style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 300, color: '#f5f0e8', lineHeight: 1.1, marginBottom: '0.5rem' }}>Your Scribbles</h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.88rem', fontFamily: 'Inter, sans-serif' }}>Read stories, take quizzes, complete exercises — earn Scribbles.</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem' }}>
            Loading…
          </div>
        ) : (
          <>
            {/* Scribbles balance */}
            <div style={{ background: 'rgba(107,47,173,0.08)', border: '1px solid rgba(107,47,173,0.25)', borderRadius: 16, padding: '2rem', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.62rem', color: 'rgba(155,109,255,0.6)', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginBottom: '0.5rem' }}>Scribbles Balance</div>
              <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 'clamp(3rem, 8vw, 4.5rem)', fontWeight: 300, color: '#a78bfa', lineHeight: 1 }}>{points?.total || 0}</div>
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', marginTop: '0.75rem' }}>
                Scribbles never expire — they unlock perks when the catalogue opens.
              </div>
            </div>

            {/* Catalogue placeholder */}
            <div style={{
              background: 'rgba(201,164,76,0.05)',
              border: '1px solid rgba(201,164,76,0.2)',
              borderRadius: 14,
              padding: '1.5rem',
              marginBottom: '2rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '1.3rem' }}>✦</span>
                <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.1rem', color: '#c9a44c' }}>
                  The Scribbles Catalogue
                </div>
              </div>
              <p style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1rem', color: 'rgba(240,234,216,0.6)', lineHeight: 1.7, margin: 0 }}>
                The Scribbles catalogue — perks you can unlock with your Scribbles — opens September 2026.
                Until then, your Scribbles accumulate. Perks include exclusive stories, signed prints,
                member-only events, and more.
              </p>
            </div>

            {/* How to earn */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '1.25rem 1.5rem', marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginBottom: '1rem' }}>How to earn Scribbles</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
                {[
                  { label: 'Read 10 stories', amount: '+5', icon: '📖' },
                  { label: 'Post 50 comments', amount: '+10', icon: '💬' },
                  { label: 'Complete an exercise', amount: 'Up to +50', icon: '✍️' },
                  { label: 'Pass a story quiz', amount: 'Up to +50', icon: '📚' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{item.icon}</span>
                    <div>
                      <div style={{ fontSize: '0.78rem', color: '#e8e0d4', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>{item.label}</div>
                      <div style={{ fontSize: '0.68rem', color: '#9b6dff', fontFamily: 'Inter, sans-serif' }}>{item.amount} Scribbles</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: '1.5rem', display: 'flex', gap: 0 }}>
              {['overview', 'history'].map(t => (
                <button key={t} className={`rw-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {tab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif', marginBottom: '0.25rem' }}>Recent activity</div>
                {pointsHistory.slice(0, 5).map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: '0.82rem', color: '#e8e0d4', fontFamily: 'Inter, sans-serif' }}>{h.description}</div>
                      <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', marginTop: 2 }}>{timeAgo(h.createdAt)}</div>
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: h.amount >= 0 ? '#9b6dff' : '#f87171', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                      {h.amount > 0 ? '+' : ''}{h.amount !== 0 ? `${h.amount} ✦` : '—'}
                    </div>
                  </div>
                ))}
                {pointsHistory.length === 0 && (
                  <div style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', fontStyle: 'italic' }}>
                    No activity yet. Take a quiz to earn your first Scribbles.
                  </div>
                )}
              </div>
            )}

            {tab === 'history' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {pointsHistory.map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: '0.82rem', color: '#e8e0d4', fontFamily: 'Inter, sans-serif' }}>{h.description}</div>
                      <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', marginTop: 2 }}>{timeAgo(h.createdAt)}</div>
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: h.amount >= 0 ? '#9b6dff' : '#f87171', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                      {h.amount > 0 ? '+' : ''}{h.amount !== 0 ? `${h.amount} ✦` : '—'}
                    </div>
                  </div>
                ))}
                {pointsHistory.length === 0 && (
                  <div style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', fontStyle: 'italic' }}>
                    No Scribbles history yet.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
