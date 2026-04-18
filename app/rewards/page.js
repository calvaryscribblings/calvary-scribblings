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
async function getAuth() { const { getAuth } = await import('firebase/auth'); return getAuth(await getApp()); }

const POINTS_PER_READ_BATCH = 5;      // 5 points per 10 reads
const READS_PER_BATCH = 10;
const POINTS_PER_COMMENT_BATCH = 10;  // 10 points per 50 comments
const COMMENTS_PER_BATCH = 50;
const POINTS_TO_PENCE = 1;            // 100 points = £1 = 100 pence
const POINTS_PER_POUND = 100;
const MIN_PAYOUT_PENCE = 1000;        // £10 minimum
const CARRYOVER_THRESHOLD = 800;      // points below this are reset monthly

function calcPointsFromReads(readCount) {
  return Math.floor(readCount / READS_PER_BATCH) * POINTS_PER_READ_BATCH;
}

function calcPointsFromComments(commentCount) {
  return Math.floor(commentCount / COMMENTS_PER_BATCH) * POINTS_PER_COMMENT_BATCH;
}

function formatPence(pence) {
  return `£${(pence / 100).toFixed(2)}`;
}

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
  const [wallet, setWallet] = useState(null);
  const [pointsHistory, setPointsHistory] = useState([]);
  const [walletHistory, setWalletHistory] = useState([]);
  const [tab, setTab] = useState('overview');
  const [payoutForm, setPayoutForm] = useState({ name: '', sortCode: '', accountNumber: '' });
  const [payoutMsg, setPayoutMsg] = useState('');
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [existingRequest, setExistingRequest] = useState(null);
  const [initialising, setInitialising] = useState(false);

  useEffect(() => {
    (async () => {
      const auth = await getAuth();
      const { onAuthStateChanged } = await import('firebase/auth');
      onAuthStateChanged(auth, async (u) => {
        setUser(u);
        if (u) await loadRewards(u);
        else setLoading(false);
      });
    })();
  }, []);

  async function countUserComments(uid) {
    const db = await getDB();
    const { ref, get } = await import('firebase/database');
    const snap = await get(ref(db, 'comments'));
    if (!snap.exists()) return 0;
    let count = 0;
    Object.values(snap.val()).forEach(slugComments => {
      Object.values(slugComments).forEach(comment => {
        if (comment.authorUid === uid) count++;
      });
    });
    return count;
  }

  async function initialisePoints(uid, readCount) {
    setInitialising(true);
    const db = await getDB();
    const { ref, set, get } = await import('firebase/database');

    const commentCount = await countUserComments(uid);
    const readPoints = calcPointsFromReads(readCount);
    const commentPoints = calcPointsFromComments(commentCount);
    const total = readPoints + commentPoints;

    const now = Date.now();
    const history = [];
    if (readPoints > 0) history.push({ type: 'read', amount: readPoints, description: `Backfill — ${readCount} stories read`, createdAt: now });
    if (commentPoints > 0) history.push({ type: 'comment', amount: commentPoints, description: `Backfill — ${commentCount} comments posted`, createdAt: now - 1 });

    await set(ref(db, `points/${uid}`), {
      total,
      initialised: true,
      lastResetAt: now,
      trackedReads: readCount,
      trackedComments: commentCount,
      history: history.length ? history : [{ type: 'init', amount: 0, description: 'Account initialised', createdAt: now }],
    });

    setPoints({ total, initialised: true, trackedReads: readCount, trackedComments: commentCount });
    setPointsHistory(history);
    setInitialising(false);
  }

  async function loadRewards(u) {
    setLoading(true);
    try {
      const db = await getDB();
      const { ref, get, onValue } = await import('firebase/database');

      // Load user readCount
      const userSnap = await get(ref(db, `users/${u.uid}`));
      const userData = userSnap.exists() ? userSnap.val() : {};
      const readCount = userData.readCount || 0;

      // Load points
      const pointsSnap = await get(ref(db, `points/${u.uid}`));
      if (!pointsSnap.exists()) {
        await initialisePoints(u.uid, readCount);
      } else {
        const p = pointsSnap.val();
        setPoints(p);
        setPointsHistory(p.history ? Object.values(p.history).sort((a, b) => b.createdAt - a.createdAt) : []);
      }

      // Load wallet
      const walletSnap = await get(ref(db, `wallet/${u.uid}`));
      if (walletSnap.exists()) {
        const w = walletSnap.val();
        setWallet(w);
        setWalletHistory(w.history ? Object.values(w.history).sort((a, b) => b.createdAt - a.createdAt) : []);
      } else {
        setWallet({ balance: 0 });
      }

      // Check existing payout request
      const payoutSnap = await get(ref(db, `payout_requests/${u.uid}`));
      if (payoutSnap.exists()) {
        const requests = Object.entries(payoutSnap.val()).map(([id, r]) => ({ id, ...r }));
        const pending = requests.find(r => r.status === 'pending');
        if (pending) setExistingRequest(pending);
      }
    } catch (e) { console.error('Rewards load error:', e); }
    setLoading(false);
  }

  async function convertPoints() {
    if (!user || !points || points.total < POINTS_PER_POUND) return;
    const pointsToConvert = Math.floor(points.total / POINTS_PER_POUND) * POINTS_PER_POUND;
    const penceEarned = pointsToConvert;
    const remaining = points.total - pointsToConvert;

    const db = await getDB();
    const { ref, update, push } = await import('firebase/database');
    const now = Date.now();

    const historyEntry = { type: 'convert', amount: -pointsToConvert, description: `Converted ${pointsToConvert} points to ${formatPence(penceEarned)}`, createdAt: now };
    const walletEntry = { amount: penceEarned, description: `Converted from ${pointsToConvert} points`, createdAt: now };

    await update(ref(db, `points/${user.uid}`), { total: remaining });
    await push(ref(db, `points/${user.uid}/history`), historyEntry);
    await update(ref(db, `wallet/${user.uid}`), { balance: (wallet?.balance || 0) + penceEarned });
    await push(ref(db, `wallet/${user.uid}/history`), walletEntry);

    setPoints(p => ({ ...p, total: remaining }));
    setPointsHistory(h => [historyEntry, ...h]);
    setWallet(w => ({ ...w, balance: (w?.balance || 0) + penceEarned }));
    setWalletHistory(h => [walletEntry, ...h]);
  }

  async function requestPayout() {
    if (!user) return;
    const { name, sortCode, accountNumber } = payoutForm;
    if (!name.trim() || !sortCode.trim() || !accountNumber.trim()) { setPayoutMsg('Please fill in all bank details.'); return; }
    if (sortCode.replace(/\D/g, '').length !== 6) { setPayoutMsg('Sort code must be 6 digits.'); return; }
    if (accountNumber.replace(/\D/g, '').length !== 8) { setPayoutMsg('Account number must be 8 digits.'); return; }
    if ((wallet?.balance || 0) < MIN_PAYOUT_PENCE) { setPayoutMsg(`Minimum payout is ${formatPence(MIN_PAYOUT_PENCE)}.`); return; }
    if (existingRequest) { setPayoutMsg('You already have a pending payout request.'); return; }

    setPayoutLoading(true);
    try {
      const db = await getDB();
      const { ref, push, update } = await import('firebase/database');
      const now = Date.now();
      const amount = wallet.balance;

      const reqRef = await push(ref(db, `payout_requests/${user.uid}`), {
        amount,
        status: 'pending',
        bankDetails: { name: name.trim(), sortCode: sortCode.replace(/\D/g, ''), accountNumber: accountNumber.replace(/\D/g, '') },
        createdAt: now,
      });

      await update(ref(db, `wallet/${user.uid}`), { balance: 0 });
      await push(ref(db, `wallet/${user.uid}/history`), {
        amount: -amount,
        description: `Payout requested — ${formatPence(amount)}`,
        createdAt: now,
      });

      setWallet(w => ({ ...w, balance: 0 }));
      setExistingRequest({ id: reqRef.key, amount, status: 'pending' });
      setPayoutMsg('✓ Payout request submitted. We\'ll process it within 3–5 working days.');
      setPayoutForm({ name: '', sortCode: '', accountNumber: '' });
    } catch (e) { setPayoutMsg('Something went wrong. Please try again.'); }
    setPayoutLoading(false);
  }

  const canConvert = points && points.total >= POINTS_PER_POUND;
  const canPayout = wallet && wallet.balance >= MIN_PAYOUT_PENCE && !existingRequest;
  const progressToNextConvert = points ? (points.total % POINTS_PER_POUND) / POINTS_PER_POUND * 100 : 0;

  if (!user && !loading) return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Cochin, Georgia, serif', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem' }}>
      <Navbar />
      <div style={{ textAlign: 'center', paddingTop: '6rem' }}>
        <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '2rem', fontWeight: 300, color: '#f5f0e8', marginBottom: '1rem' }}>Reader's Reward</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem' }}>Sign in to view your points and rewards.</div>
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
        .rw-input { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0.75rem 1rem; color: #fff; font-size: 0.9rem; font-family: Inter, sans-serif; outline: none; width: 100%; box-sizing: border-box; }
        .rw-input:focus { border-color: rgba(107,47,173,0.5); }
        .rw-btn { background: #6b2fad; border: none; border-radius: 8px; padding: 0.75rem 1.5rem; color: #fff; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; font-family: Inter, sans-serif; transition: background 0.2s; }
        .rw-btn:hover { background: #7c3aed; }
        .rw-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .rw-btn-ghost { background: none; border: 1px solid rgba(107,47,173,0.4); border-radius: 8px; padding: 0.65rem 1.25rem; color: #a78bfa; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; font-family: Inter, sans-serif; transition: all 0.2s; }
        .rw-btn-ghost:hover { background: rgba(107,47,173,0.1); }
        .rw-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
        @keyframes rw-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      `}</style>

      <Navbar />

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '6rem 1.5rem 4rem' }}>

        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <div style={{ fontSize: '0.68rem', color: '#9b6dff', letterSpacing: '0.18em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginBottom: '0.5rem' }}>Reader's Reward</div>
          <h1 style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 300, color: '#f5f0e8', lineHeight: 1.1, marginBottom: '0.5rem' }}>Your Rewards</h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.88rem', fontFamily: 'Inter, sans-serif' }}>Read stories, leave comments, complete exercises — earn points, convert to cash.</p>
        </div>

        {loading || initialising ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem' }}>
            {initialising ? 'Setting up your rewards account…' : 'Loading…'}
          </div>
        ) : (
          <>
            {/* Balance cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
              {/* Points card */}
              <div style={{ background: 'rgba(107,47,173,0.08)', border: '1px solid rgba(107,47,173,0.25)', borderRadius: 16, padding: '1.5rem' }}>
                <div style={{ fontSize: '0.62rem', color: 'rgba(155,109,255,0.6)', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginBottom: '0.5rem' }}>Points Balance</div>
                <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '3rem', fontWeight: 300, color: '#a78bfa', lineHeight: 1 }}>{points?.total || 0}</div>
                <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.25)', fontFamily: 'Inter, sans-serif', marginTop: '0.5rem' }}>100 pts = £1.00</div>
                {points && points.total >= POINTS_PER_POUND && (
                  <button className="rw-btn" style={{ marginTop: '1rem', width: '100%' }} onClick={convertPoints}>
                    Convert to Wallet
                  </button>
                )}
                {points && points.total < POINTS_PER_POUND && (
                  <>
                    <div style={{ marginTop: '1rem', background: 'rgba(255,255,255,0.06)', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${progressToNextConvert}%`, background: 'linear-gradient(90deg, #6b2fad, #a78bfa)', borderRadius: 4, transition: 'width 0.5s' }} />
                    </div>
                    <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', marginTop: '0.4rem' }}>{POINTS_PER_POUND - (points?.total % POINTS_PER_POUND)} pts until next conversion</div>
                  </>
                )}
              </div>

              {/* Wallet card */}
              <div style={{ background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.25)', borderRadius: 16, padding: '1.5rem' }}>
                <div style={{ fontSize: '0.62rem', color: 'rgba(29,158,117,0.7)', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginBottom: '0.5rem' }}>Wallet Balance</div>
                <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '3rem', fontWeight: 300, color: '#1d9e75', lineHeight: 1 }}>{formatPence(wallet?.balance || 0)}</div>
                <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.25)', fontFamily: 'Inter, sans-serif', marginTop: '0.5rem' }}>Min. payout £10.00</div>
                {canPayout && (
                  <button className="rw-btn" style={{ marginTop: '1rem', width: '100%', background: '#1d9e75' }} onClick={() => setTab('payout')}>
                    Request Payout
                  </button>
                )}
                {existingRequest && (
                  <div style={{ marginTop: '1rem', fontSize: '0.68rem', color: 'rgba(29,158,117,0.7)', fontFamily: 'Inter, sans-serif', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ animation: 'rw-pulse 2s infinite', display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#1d9e75' }} />
                    Payout pending · {formatPence(existingRequest.amount)}
                  </div>
                )}
              </div>
            </div>

            {/* How to earn */}
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '1.25rem 1.5rem', marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginBottom: '1rem' }}>How to earn points</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
                {[
                  { label: 'Read 10 stories', points: '+5 pts', icon: '📖' },
                  { label: 'Post 50 comments', points: '+10 pts', icon: '💬' },
                  { label: 'Complete an exercise', points: 'Up to +50 pts', icon: '✍️' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{item.icon}</span>
                    <div>
                      <div style={{ fontSize: '0.78rem', color: '#e8e0d4', fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>{item.label}</div>
                      <div style={{ fontSize: '0.68rem', color: '#9b6dff', fontFamily: 'Inter, sans-serif' }}>{item.points}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', marginBottom: '1.5rem', display: 'flex', gap: 0 }}>
              {['overview', 'points history', 'wallet history', 'payout'].map(t => (
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
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: h.amount >= 0 ? '#9b6dff' : '#f87171', fontFamily: 'Inter, sans-serif' }}>
                      {h.amount >= 0 ? '+' : ''}{h.amount} pts
                    </div>
                  </div>
                ))}
                {pointsHistory.length === 0 && <div style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', fontStyle: 'italic' }}>No activity yet.</div>}
              </div>
            )}

            {tab === 'points history' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {pointsHistory.map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: '0.82rem', color: '#e8e0d4', fontFamily: 'Inter, sans-serif' }}>{h.description}</div>
                      <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', marginTop: 2 }}>{timeAgo(h.createdAt)}</div>
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: h.amount >= 0 ? '#9b6dff' : '#f87171', fontFamily: 'Inter, sans-serif' }}>
                      {h.amount >= 0 ? '+' : ''}{h.amount} pts
                    </div>
                  </div>
                ))}
                {pointsHistory.length === 0 && <div style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', fontStyle: 'italic' }}>No points history yet.</div>}
              </div>
            )}

            {tab === 'wallet history' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {walletHistory.map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10 }}>
                    <div>
                      <div style={{ fontSize: '0.82rem', color: '#e8e0d4', fontFamily: 'Inter, sans-serif' }}>{h.description}</div>
                      <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', marginTop: 2 }}>{timeAgo(h.createdAt)}</div>
                    </div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: h.amount >= 0 ? '#1d9e75' : '#f87171', fontFamily: 'Inter, sans-serif' }}>
                      {h.amount >= 0 ? '+' : ''}{formatPence(Math.abs(h.amount))}
                    </div>
                  </div>
                ))}
                {walletHistory.length === 0 && <div style={{ color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', fontStyle: 'italic' }}>No wallet history yet.</div>}
              </div>
            )}

            {tab === 'payout' && (
              <div style={{ maxWidth: 440 }}>
                {existingRequest ? (
                  <div style={{ background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.2)', borderRadius: 12, padding: '1.5rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>⏳</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.1rem', color: '#f5f0e8', marginBottom: '0.5rem' }}>Payout in progress</div>
                    <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif' }}>Your request for {formatPence(existingRequest.amount)} is being processed. Bank transfers take 3–5 working days.</div>
                  </div>
                ) : (wallet?.balance || 0) < MIN_PAYOUT_PENCE ? (
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '1.5rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>💰</div>
                    <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.1rem', color: '#f5f0e8', marginBottom: '0.5rem' }}>Not enough to cash out</div>
                    <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif' }}>You need at least £10.00 in your wallet to request a payout. Keep reading and earning!</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '1.1rem', color: '#f5f0e8' }}>Request bank transfer</div>
                    <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter, sans-serif' }}>
                      You'll receive {formatPence(wallet?.balance || 0)} via bank transfer within 3–5 working days. Your wallet balance will be cleared on submission.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{ fontSize: '0.68rem', color: '#a78bfa', fontFamily: 'Inter, sans-serif', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Account holder name</label>
                      <input className="rw-input" value={payoutForm.name} onChange={e => setPayoutForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name as on bank account" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.68rem', color: '#a78bfa', fontFamily: 'Inter, sans-serif', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sort code</label>
                        <input className="rw-input" value={payoutForm.sortCode} onChange={e => setPayoutForm(f => ({ ...f, sortCode: e.target.value }))} placeholder="00-00-00" maxLength={8} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.68rem', color: '#a78bfa', fontFamily: 'Inter, sans-serif', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Account number</label>
                        <input className="rw-input" value={payoutForm.accountNumber} onChange={e => setPayoutForm(f => ({ ...f, accountNumber: e.target.value }))} placeholder="12345678" maxLength={8} />
                      </div>
                    </div>
                    {payoutMsg && <div style={{ fontSize: '0.82rem', color: payoutMsg.startsWith('✓') ? '#1d9e75' : '#f87171', fontFamily: 'Inter, sans-serif' }}>{payoutMsg}</div>}
                    <button className="rw-btn" onClick={requestPayout} disabled={payoutLoading} style={{ background: '#1d9e75' }}>
                      {payoutLoading ? 'Submitting…' : `Request ${formatPence(wallet?.balance || 0)} payout`}
                    </button>
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