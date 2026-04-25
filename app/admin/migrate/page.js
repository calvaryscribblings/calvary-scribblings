'use client';
import { useState } from 'react';
import { useAuth } from '../../lib/AuthContext';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';

const s = {
  page:    { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header:  { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:    { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub:     { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  body:    { maxWidth: 860, margin: '0 auto', padding: '2.5rem 2rem' },
  topBar:  { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' },
  h2:      { fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: 0 },
  h2sub:   { fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', marginTop: 3 },
  card:    { background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1.5rem 1.75rem', marginBottom: '1.5rem' },
  label:   { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa', display: 'block', marginBottom: '0.6rem', fontFamily: 'Inter, sans-serif' },
  hint:    { fontSize: '0.78rem', color: 'rgba(255,255,255,0.35)', lineHeight: 1.6, fontFamily: 'Inter, sans-serif', marginBottom: '1.25rem' },
  actions: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  btn:     { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost:{ background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDis:  { opacity: 0.45, cursor: 'not-allowed' },
  pre:     { background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '1.25rem', fontFamily: "'Courier New', monospace", fontSize: '0.82rem', lineHeight: 1.65, color: '#e8e8e8', whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'break-word', marginTop: '1.5rem' },
  preLabel:{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif', marginTop: '1.75rem', marginBottom: '0.4rem' },
  error:   { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.82rem', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: '#f87171', marginTop: '1.25rem', fontFamily: "'Courier New', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  gate:    { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
};

export default function MigratePage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  if (authLoading) return <div style={s.gate}><span style={{ color: 'rgba(255,255,255,0.3)' }}>Checking auth…</span></div>;
  if (!isAdmin)    return <div style={s.gate}><div style={{ color: '#f87171', fontWeight: 700 }}>Access Denied</div></div>;

  async function run(dryRun) {
    if (!dryRun && !window.confirm('This will write quizMeta to every story with a quiz. Continue?')) return;

    setRunning(true);
    setResult(null);
    setError('');

    try {
      const token = await user.getIdToken();
      const url = dryRun ? '/admin/migrate-quiz-meta?dryRun=true' : '/admin/migrate-quiz-meta';
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setResult({ status: res.status, body: data });
    } catch (e) {
      setError(e.message);
    }

    setRunning(false);
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings · Admin</div>
          <div style={s.sub}>Data Migrations</div>
        </div>
      </div>

      <div style={s.body}>
        <div style={s.topBar}>
          <div>
            <div style={s.h2}>Quiz Meta Migration</div>
            <div style={s.h2sub}>Phase 3.1 — Step 1</div>
          </div>
        </div>

        <div style={s.card}>
          <div style={s.label}>quizMeta backfill</div>
          <p style={s.hint}>
            Walks <code>cms_quizzes</code>, finds every approved quiz, and writes a <code>quizMeta</code> block
            to the matching <code>cms_stories</code> node. Idempotent — safe to run more than once.
            Existing <code>attemptCount</code> and naming fields are preserved.
          </p>
          <div style={s.actions}>
            <button
              style={{ ...s.btnGhost, ...(running ? s.btnDis : {}) }}
              onClick={() => run(true)}
              disabled={running}
            >
              {running ? 'Running…' : 'Dry Run'}
            </button>
            <button
              style={{ ...s.btn, ...(running ? s.btnDis : {}) }}
              onClick={() => run(false)}
              disabled={running}
            >
              {running ? 'Running…' : 'Run for Real'}
            </button>
          </div>

          {error && <div style={s.error}>{error}</div>}

          {result && (
            <>
              <div style={s.preLabel}>Response · HTTP {result.status}</div>
              <pre style={s.pre}>{JSON.stringify(result.body, null, 2)}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
