'use client';
import { useState } from 'react';
import { useAuth } from '../../lib/AuthContext';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';

const s = {
  page:        { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header:      { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:        { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub:         { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  body:        { maxWidth: 720, margin: '0 auto', padding: '2.5rem 2rem' },
  h1:          { fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.4rem' },
  intro:       { fontSize: '0.88rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: '0 0 1.5rem', fontFamily: 'Inter, sans-serif' },
  card:        { background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1.25rem 1.4rem', marginBottom: '1.25rem' },
  btnGhost:    { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.6rem 1.4rem', borderRadius: 6, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDanger:   { background: 'linear-gradient(135deg, #b91c1c, #dc2626)', color: '#fff', border: 'none', padding: '0.6rem 1.4rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDisabled: { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.08)', padding: '0.6rem 1.4rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'not-allowed', fontFamily: 'inherit' },
  row:         { display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' },
  hint:        { fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter, sans-serif', lineHeight: 1.5, marginTop: '0.75rem' },
  stat:        { fontSize: '0.85rem', fontFamily: 'Inter, sans-serif', display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  statLabel:   { color: 'rgba(255,255,255,0.55)' },
  statValue:   { color: '#fff', fontWeight: 600 },
  sampleTitle: { fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa', fontFamily: 'Inter, sans-serif', marginTop: '1.2rem', marginBottom: '0.5rem' },
  sampleRow:   { fontFamily: '"Courier New", monospace', fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)', padding: '0.3rem 0', borderBottom: '1px solid rgba(255,255,255,0.04)', wordBreak: 'break-all' },
  errorBox:    { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.82rem', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: '#f87171', marginBottom: '1.25rem', fontFamily: '"Courier New", monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  okBox:       { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.25)', color: '#6ee7b7', marginTop: '1rem', fontFamily: 'Inter, sans-serif', lineHeight: 1.55 },
  resultLabel: { fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: 'Inter, sans-serif', marginBottom: '0.75rem' },
  gate:        { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
};

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

export default function BackfillJoinDatePage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  const [running, setRunning]       = useState(null); // 'dry' | 'real' | null
  const [dryResult, setDryResult]   = useState(null);
  const [realResult, setRealResult] = useState(null);
  const [error, setError]           = useState('');

  async function run(dryRun) {
    setError('');
    setRunning(dryRun ? 'dry' : 'real');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/backfill-joindate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
      } else if (dryRun) {
        setDryResult(data);
        setRealResult(null);
      } else {
        setRealResult(data);
      }
    } catch (e) {
      setError(e.message || 'Request failed.');
    } finally {
      setRunning(null);
    }
  }

  if (authLoading) return <div style={s.gate}>Loading…</div>;
  if (!isAdmin) {
    return (
      <div style={s.gate}>
        <div>Admin only.</div>
        <a href="/" style={{ color: '#a78bfa', textDecoration: 'underline' }}>Home</a>
      </div>
    );
  }

  const result = realResult || dryResult;
  const realDisabled = !dryResult || running !== null || (dryResult && dryResult.backfilled === 0);

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <div style={s.logo}>CALVARY ADMIN</div>
          <div style={s.sub}>Backfill joinDate</div>
        </div>
        <a href="/admin" style={{ color: '#a78bfa', fontSize: '0.78rem', fontFamily: 'Inter, sans-serif', textDecoration: 'none' }}>← Back</a>
      </header>

      <div style={s.body}>
        <h1 style={s.h1}>Backfill joinDate</h1>
        <p style={s.intro}>
          Fills in joinDate for users who signed up via Google. Run once. Safe to re-run — only affects users still missing the field. Dry run first to preview.
        </p>

        <div style={s.card}>
          <div style={s.row}>
            <button
              style={running === 'dry' ? s.btnDisabled : s.btnGhost}
              disabled={running !== null}
              onClick={() => run(true)}
            >
              {running === 'dry' ? 'Running…' : 'Dry run'}
            </button>
            <button
              style={realDisabled ? s.btnDisabled : s.btnDanger}
              disabled={realDisabled}
              onClick={() => {
                if (!confirm(`Run for real? This will write joinDate to ${dryResult?.backfilled} user records.`)) return;
                run(false);
              }}
            >
              {running === 'real' ? 'Running…' : 'Run for real'}
            </button>
          </div>
          <div style={s.hint}>
            Run for real is enabled after a successful dry run. The dry run shows the same counts and a 5-row sample of what will be written.
          </div>
        </div>

        {error && <div style={s.errorBox}>{error}</div>}

        {result && (
          <div style={s.card}>
            <div style={{ ...s.resultLabel, color: result.dryRun ? '#a78bfa' : '#6ee7b7' }}>
              {result.dryRun ? 'Dry-run preview' : 'Run complete'}
            </div>
            <div style={s.stat}><span style={s.statLabel}>Total Auth users</span><span style={s.statValue}>{result.totalUsers}</span></div>
            <div style={s.stat}><span style={s.statLabel}>Already had joinDate</span><span style={s.statValue}>{result.alreadyHadJoinDate}</span></div>
            <div style={s.stat}><span style={s.statLabel}>{result.dryRun ? 'Would backfill' : 'Backfilled'}</span><span style={s.statValue}>{result.backfilled}</span></div>
            <div style={s.stat}><span style={s.statLabel}>Errors</span><span style={s.statValue}>{result.errors?.length ?? 0}</span></div>

            {result.sample?.length > 0 && (
              <>
                <div style={s.sampleTitle}>Sample ({result.sample.length})</div>
                {result.sample.map((row) => (
                  <div key={row.uid} style={s.sampleRow}>
                    {row.uid} · {fmtDate(row.joinDate)} · {row.email ?? '—'}
                  </div>
                ))}
              </>
            )}

            {result.errors?.length > 0 && (
              <>
                <div style={s.sampleTitle}>Errors</div>
                {result.errors.map((err, i) => (
                  <div key={i} style={s.sampleRow}>
                    {err.uid ?? '—'} · {err.reason}
                  </div>
                ))}
              </>
            )}

            {!result.dryRun && (
              <div style={s.okBox}>
                Done. After confirming the leaderboard tie-break behaves correctly, ask for a cleanup commit to delete this page and the function.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
