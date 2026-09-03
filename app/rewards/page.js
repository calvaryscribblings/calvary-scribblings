'use client';
import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import {
  SUMMER_2026, prizePool, PROGRAM_NAME, PROGRAM_DETAILS_HREF,
  SHOW_SUMMER_2026_BUTTON, programStatusLabel,
} from '../lib/leaderboards';
import { useContestPhase } from '../lib/useContestPhase';

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

// R34 — THE PROGRAMME CARD. Twin of ProgramBanner on /leaderboard: same phase,
// same status word, same one-line switch for the edition button. The two
// surfaces differ in dress only; every decision they make comes from
// app/lib/leaderboards.js, because the defect this replaces was exactly the
// same ternary written out twice and wrong in both copies.
//
// The copy no longer names August or a date of any kind. The programme is
// seasonal and the pool is £100; the edition's own window is on its own board.
function ProgramCard() {
  const board = SUMMER_2026;
  const { phase } = useContestPhase(board);
  const status = programStatusLabel(phase);

  return (
    <div data-program-banner style={{
      background: 'linear-gradient(135deg, rgba(201,164,76,0.09), rgba(107,47,173,0.08))',
      border: '1px solid rgba(201,164,76,0.28)', borderRadius: 14,
      padding: '1.25rem 1.5rem', marginBottom: '1.5rem',
    }}>
      {status && (
        <div data-program-status style={{ fontSize: '0.7rem', fontWeight: 500, color: '#c9a44c', letterSpacing: '0.16em', textTransform: 'uppercase', fontFamily: 'Cormorant Garamond, Georgia, serif', marginBottom: '0.45rem' }}>
          {status}
        </div>
      )}
      <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.35rem', color: '#f5f0e8', lineHeight: 1.15, marginBottom: '0.5rem' }}>
        {PROGRAM_NAME}
      </div>
      <p style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.95rem', color: 'rgba(240,234,216,0.6)', lineHeight: 1.6, margin: '0 0 0.85rem' }}>
        A reading contest each season, ranked on the Scribbles you earn inside
        the edition&rsquo;s window. {board.prizes.length} prize places,
        &pound;{prizePool(board)} in total.
      </p>
      <div style={{ display: 'flex', gap: '1.1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <a href={PROGRAM_DETAILS_HREF} style={{ fontSize: '0.85rem', fontFamily: 'Cormorant Garamond, Georgia, serif', color: '#a78bfa', fontWeight: 600, textDecoration: 'none' }}>
          How it works &rarr;
        </a>
        {/* Temporary. One edit removes it: SHOW_SUMMER_2026_BUTTON in
            app/lib/leaderboards.js. The board itself stays reachable. */}
        {SHOW_SUMMER_2026_BUTTON && (
          <a data-edition-button href={`/leaderboard/${board.boardId}`} style={{ fontSize: '0.85rem', fontFamily: 'Cormorant Garamond, Georgia, serif', color: '#c9a44c', fontWeight: 600, textDecoration: 'none' }}>
            {board.edition} board &rarr;
          </a>
        )}
      </div>
    </div>
  );
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
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Cormorant Garamond, Georgia, serif', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem' }}>
      <Navbar />
      <div style={{ textAlign: 'center', paddingTop: '6rem' }}>
        <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '2rem', fontWeight: 300, color: '#f5f0e8', marginBottom: '1rem' }}>Reader's Reward</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem' }}>Sign in to view your Scribbles and rewards.</div>
      </div>
    </div>
  );

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap');
        .rw-tab { background: none; border: none; padding: 0.6rem 1.2rem; font-size: 0.8rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.35); cursor: pointer; font-family: Cormorant Garamond, Georgia, serif; border-bottom: 2px solid transparent; transition: all 0.2s; }
        .rw-tab.active { color: #a78bfa; border-bottom-color: #6b2fad; }
        .rw-tab:hover { color: rgba(255,255,255,0.7); }
        @keyframes rw-shimmer { 0%,100%{opacity:0.7} 50%{opacity:1} }
      `}</style>

      <Navbar />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '6rem 1.5rem 4rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 500, color: '#9b6dff', letterSpacing: '0.18em', textTransform: 'uppercase', fontFamily: 'Cormorant Garamond, Georgia, serif', marginBottom: '0.5rem' }}>Reader's Reward</div>
          <h1 style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 300, color: '#f5f0e8', lineHeight: 1.1, marginBottom: '0.5rem' }}>Your Scribbles</h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.88rem', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>Read stories, take quizzes, complete exercises — earn Scribbles.</p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.9rem', fontWeight: 500 }}>
            Loading…
          </div>
        ) : (
          <>
            {/* Scribbles balance */}
            <div style={{ background: 'rgba(107,47,173,0.08)', border: '1px solid rgba(107,47,173,0.25)', borderRadius: 16, padding: '2rem', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 500, color: 'rgba(155,109,255,0.6)', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'Cormorant Garamond, Georgia, serif', marginBottom: '0.5rem' }}>Scribbles Balance</div>
              <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 'clamp(3rem, 8vw, 4.5rem)', fontWeight: 300, color: '#a78bfa', lineHeight: 1 }}>{points?.total || 0}</div>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'rgba(255,255,255,0.2)', fontFamily: 'Cormorant Garamond, Georgia, serif', marginTop: '0.75rem' }}>
                Scribbles never expire — they unlock perks when the catalogue opens.
              </div>
            </div>

            {/* The Seasonal Reading Program — directly under the balance,
                because the balance is exactly what an edition ranks. */}
            <ProgramCard />

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
              {/* ⚠ "opens September 2026" is STALE as of 3 Sept 2026 and is left
                  standing on purpose. It is one of nine launch-date sites, listed
                  in full at OPENING_DATE in app/bookstore/components/LaunchGate.js,
                  and they want sweeping together — fixing this one alone leaves the
                  site saying two different things about the same date. Ikenna's
                  call, R34. Do not edit this line in isolation. */}
              <p style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1rem', color: 'rgba(240,234,216,0.6)', lineHeight: 1.7, margin: 0 }}>
                The Scribbles catalogue — perks you can unlock with your Scribbles — opens September 2026.
                Until then, your Scribbles accumulate. Perks include exclusive stories, signed prints,
                member-only events, and more.
              </p>
            </div>

            {/* How to earn */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '1.25rem 1.5rem', marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 500, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'Cormorant Garamond, Georgia, serif', marginBottom: '1rem' }}>How to earn Scribbles</div>
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
                      <div style={{ fontSize: '0.85rem', color: '#e8e0d4', fontFamily: 'Cormorant Garamond, Georgia, serif', fontWeight: 500 }}>{item.label}</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 500, color: '#9b6dff', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>{item.amount} Scribbles</div>
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
                <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'rgba(255,255,255,0.3)', fontFamily: 'Cormorant Garamond, Georgia, serif', marginBottom: '0.25rem' }}>Recent activity</div>
                {pointsHistory.slice(0, 5).map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 500, color: '#e8e0d4', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>{h.description}</div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 500, color: 'rgba(255,255,255,0.2)', fontFamily: 'Cormorant Garamond, Georgia, serif', marginTop: 2 }}>{timeAgo(h.createdAt)}</div>
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: h.amount >= 0 ? '#9b6dff' : '#f87171', fontFamily: 'Cormorant Garamond, Georgia, serif', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                      {h.amount > 0 ? '+' : ''}{h.amount !== 0 ? `${h.amount} ✦` : '—'}
                    </div>
                  </div>
                ))}
                {pointsHistory.length === 0 && (
                  <div style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.9rem', fontWeight: 500, fontStyle: 'italic' }}>
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
                      <div style={{ fontSize: '0.9rem', fontWeight: 500, color: '#e8e0d4', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>{h.description}</div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 500, color: 'rgba(255,255,255,0.2)', fontFamily: 'Cormorant Garamond, Georgia, serif', marginTop: 2 }}>{timeAgo(h.createdAt)}</div>
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: h.amount >= 0 ? '#9b6dff' : '#f87171', fontFamily: 'Cormorant Garamond, Georgia, serif', whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                      {h.amount > 0 ? '+' : ''}{h.amount !== 0 ? `${h.amount} ✦` : '—'}
                    </div>
                  </div>
                ))}
                {pointsHistory.length === 0 && (
                  <div style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.9rem', fontWeight: 500, fontStyle: 'italic' }}>
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
