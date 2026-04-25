'use client';
import { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header: { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  body: { maxWidth: 860, margin: '0 auto', padding: '2.5rem 2rem' },
  btn: { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGreen: { background: 'rgba(29,158,117,0.15)', color: '#1d9e75', border: '1px solid rgba(29,158,117,0.3)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  card: { background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1.25rem', marginBottom: '0.75rem' },
  input: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.6rem 0.9rem', color: '#fff', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', width: '80px', boxSizing: 'border-box' },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexDirection: 'column', gap: '1rem' },
};

export default function SubmissionsPage() {
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState({});
  const [scores, setScores] = useState({});
  const [msg, setMsg] = useState('');

  const isAdmin = user && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  useEffect(() => {
    if (!isAdmin) return;
    loadSubmissions();
  }, [isAdmin]);

  async function loadSubmissions() {
    setLoading(true);
    try {
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, 'exercise_submissions'));
      if (!snap.exists()) { setSubmissions([]); setLoading(false); return; }

      const all = [];
      for (const [uid, slugs] of Object.entries(snap.val())) {
        for (const [slug, sub] of Object.entries(slugs)) {
          if (sub.status === 'pending_review') {
            // Get user display name
            const userSnap = await get(ref(db, `users/${uid}/displayName`));
            const displayName = userSnap.exists() ? userSnap.val() : 'Reader';
            all.push({ uid, slug, displayName, ...sub });
          }
        }
      }
      setSubmissions(all.sort((a, b) => a.submittedAt - b.submittedAt));
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function markSubmission(uid, slug, questionIndex, awardedPoints) {
    const key = `${uid}_${slug}_${questionIndex}`;
    setMarking(m => ({ ...m, [key]: true }));
    try {
      const { ref, update, push } = await import('firebase/database');
      const sub = submissions.find(s => s.uid === uid && s.slug === slug);
      if (!sub) return;

      // Update submission
      const updatedAnswers = [...(sub.answers || [])];
      if (updatedAnswers[questionIndex]) {
        updatedAnswers[questionIndex] = { ...updatedAnswers[questionIndex], awardedPoints, marked: true };
      }

      const allMarked = updatedAnswers.every(a => a.type !== 'essay' || a.marked);
      const totalAwarded = updatedAnswers.reduce((sum, a) => sum + (a.awardedPoints || 0), 0);

      await update(ref(db, `exercise_submissions/${uid}/${slug}`), {
        answers: updatedAnswers,
        status: allMarked ? 'marked' : 'pending_review',
        markedAt: allMarked ? Date.now() : null,
        totalScore: totalAwarded,
      });

      if (allMarked) {
        // Award points to user
        const now = Date.now();
        await push(ref(db, `points/${uid}/history`), {
          type: 'exercise',
          amount: totalAwarded,
          description: `Exercise completed — ${sub.slug.replace(/-/g, ' ')}`,
          createdAt: now,
        });
        const pointsSnap = await (await import('firebase/database')).get(ref(db, `points/${uid}/total`));
        const currentPoints = pointsSnap.exists() ? pointsSnap.val() : 0;
        await update(ref(db, `points/${uid}`), { total: currentPoints + totalAwarded });
      }

      setMsg(`✓ Marked — ${awardedPoints} points awarded.`);
      await loadSubmissions();
    } catch (e) { setMsg('Error: ' + e.message); }
    setMarking(m => { const n = { ...m }; delete n[`${uid}_${slug}_${questionIndex}`]; return n; });
  }

  if (!user || !isAdmin) return (
    <div style={s.gate}>
      <div style={{ color: '#f87171', fontWeight: 700 }}>Access Denied</div>
      <a href="/" style={{ color: '#c4b5fd', fontSize: '0.82rem' }}>← Back to site</a>
    </div>
  );

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Essay Submissions</div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <a href="/admin/exercises" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← Exercise Builder</a>
          <a href="/admin" style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>← CMS</a>
        </div>
      </header>

      <div style={s.body}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#fff' }}>Essay Submissions</h2>
          <button style={s.btnGhost} onClick={loadSubmissions}>Refresh</button>
        </div>

        {msg && <div style={{ padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#c4b5fd', marginBottom: '1rem' }}>{msg}</div>}

        {loading ? (
          <div style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem' }}>Loading…</div>
        ) : submissions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'Inter, sans-serif', fontSize: '0.88rem' }}>No essay submissions pending review.</div>
        ) : submissions.map((sub, si) => (
          <div key={`${sub.uid}_${sub.slug}`} style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff', marginBottom: 3 }}>{sub.displayName}</div>
                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter, sans-serif' }}>
                  {sub.slug.replace(/-/g, ' ')} · Submitted {new Date(sub.submittedAt).toLocaleDateString('en-GB')}
                </div>
              </div>
              <div style={{ fontSize: '0.68rem', color: '#fcd34d', background: 'rgba(217,119,6,0.15)', border: '1px solid rgba(217,119,6,0.3)', borderRadius: 4, padding: '0.2rem 0.6rem', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>
                Pending Review
              </div>
            </div>

            {(sub.answers || []).filter(a => a.type === 'essay' && !a.marked).map((answer, ai) => {
              const key = `${sub.uid}_${sub.slug}_${answer.questionIndex}`;
              return (
                <div key={ai} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '1rem', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.78rem', color: '#a78bfa', fontFamily: 'Inter, sans-serif', fontWeight: 600, marginBottom: '0.5rem' }}>
                    Q{answer.questionIndex + 1} · Essay · Max {answer.maxPoints} pts
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter, sans-serif', marginBottom: '0.75rem', fontStyle: 'italic' }}>
                    {answer.question}
                  </div>
                  <div style={{ fontSize: '0.92rem', color: '#e8e0d4', fontFamily: 'Cochin, Georgia, serif', lineHeight: 1.7, marginBottom: '1rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: 6, borderLeft: '3px solid rgba(107,47,173,0.4)' }}>
                    {answer.response}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input
                      style={s.input} type="number" min={0} max={answer.maxPoints}
                      placeholder="pts"
                      value={scores[key] ?? ''}
                      onChange={e => setScores(sc => ({ ...sc, [key]: Number(e.target.value) }))}
                    />
                    <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif' }}>/ {answer.maxPoints} pts</span>
                    <button style={s.btnGreen}
                      disabled={marking[key] || scores[key] === undefined || scores[key] === ''}
                      onClick={() => markSubmission(sub.uid, sub.slug, answer.questionIndex, scores[key] || 0)}>
                      {marking[key] ? 'Saving…' : 'Award Points'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}