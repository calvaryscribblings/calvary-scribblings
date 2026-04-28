'use client';
import { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';
const ADMIN_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';

const TIER_COLORS = {
  platinum: '#c8daea',
  gold:     '#c9a44c',
  silver:   '#c0c0c8',
  bronze:   '#c97c2f',
};

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 30)  return `${days} days ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function submissionStatus(sub) {
  if (sub.hardballPassed === false) {
    return { text: 'Locked out', color: '#f87171', border: 'rgba(220,38,38,0.35)', bg: 'rgba(220,38,38,0.1)' };
  }
  if (sub.tier && TIER_COLORS[sub.tier]) {
    const c = TIER_COLORS[sub.tier];
    return { text: sub.tier.charAt(0).toUpperCase() + sub.tier.slice(1), color: c, border: `${c}55`, bg: 'rgba(0,0,0,0.25)' };
  }
  if (sub.hardballPassed === true) {
    return { text: 'No tier', color: 'rgba(255,255,255,0.4)', border: 'rgba(255,255,255,0.15)', bg: 'rgba(255,255,255,0.05)' };
  }
  return { text: 'Unknown', color: 'rgba(255,255,255,0.25)', border: 'rgba(255,255,255,0.1)', bg: 'transparent' };
}

function StatusBadge({ sub }) {
  const st = submissionStatus(sub);
  return (
    <span style={{
      fontFamily: 'Inter, sans-serif', fontSize: '0.68rem', fontWeight: 600,
      color: st.color, background: st.bg, border: `1px solid ${st.border}`,
      borderRadius: 4, padding: '0.18em 0.55em', whiteSpace: 'nowrap',
    }}>
      {st.text}
    </span>
  );
}

const s = {
  page:         { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header:       { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo:         { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub:          { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  body:         { maxWidth: 860, margin: '0 auto', padding: '2.5rem 2rem' },
  btn:          { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost:     { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDanger:    { background: 'rgba(220,38,38,0.1)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)', padding: '0.38rem 0.85rem', borderRadius: 5, fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif' },
  card:         { background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1.25rem 1.4rem', marginBottom: '0.75rem' },
  cardPurple:   { background: '#171717', border: '1px solid rgba(107,47,173,0.45)', borderRadius: 10, padding: '1.25rem 1.4rem', marginBottom: '1.25rem' },
  cardDanger:   { background: '#171717', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '1.25rem 1.4rem', marginBottom: '1.25rem' },
  input:        { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.6rem 0.9rem', color: '#fff', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  select:       { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  label:        { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa', display: 'block', marginBottom: '0.45rem', fontFamily: 'Inter, sans-serif' },
  labelDanger:  { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#f87171', display: 'block', marginBottom: '0.45rem', fontFamily: 'Inter, sans-serif' },
  fg:           { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.85rem' },
  hint:         { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' },
  msgGreen:     { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.25)', color: '#6ee7b7', marginBottom: '1.25rem', fontFamily: 'Inter, sans-serif' },
  error:        { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.82rem', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: '#f87171', marginBottom: '1.25rem', fontFamily: "'Courier New', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  gate:         { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  sectionHead:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
  sectionTitle: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif' },
  topBar:       { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' },
  spinner:      { display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: '0.45rem', verticalAlign: 'middle' },
};

export default function QuizResetsPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  const [stories, setStories]           = useState([]);
  const [quizStatuses, setQuizStatuses] = useState({});
  const [loadingData, setLoadingData]   = useState(true);
  const [selectedSlug, setSelectedSlug] = useState('');

  const [submissions, setSubmissions]   = useState(null);
  const [subsLoading, setSubsLoading]   = useState(false);
  const [subsError, setSubsError]       = useState('');

  // Per-action confirm state
  const [confirmState, setConfirmState]     = useState(null); // { uid, action } | null
  const [confirmReason, setConfirmReason]   = useState('');
  const [executingReset, setExecutingReset] = useState(null); // uid in flight

  // Bulk reset
  const [bulkConfirmSlug, setBulkConfirmSlug] = useState('');
  const [bulkReason, setBulkReason]           = useState('');
  const [bulkResetting, setBulkResetting]     = useState(false);

  // Lookup (email or @handle — one field, two paths)
  const [lookupInput, setLookupInput]     = useState('');
  const [lookupResult, setLookupResult]   = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError]     = useState('');

  // Global feedback
  const [resetMsg, setResetMsg]     = useState('');
  const [resetError, setResetError] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    loadStories();
  }, [isAdmin]);

  async function loadStories() {
    setLoadingData(true);
    try {
      const { ref, get } = await import('firebase/database');
      const [storiesSnap, quizzesSnap] = await Promise.all([
        get(ref(db, 'cms_stories')),
        get(ref(db, 'cms_quizzes')),
      ]);
      if (storiesSnap.exists()) {
        const data = storiesSnap.val();
        setStories(
          Object.entries(data)
            .map(([slug, st]) => ({ slug, title: st.title || slug }))
            .sort((a, b) => a.title.localeCompare(b.title))
        );
      }
      if (quizzesSnap.exists()) {
        const data = quizzesSnap.val();
        const statuses = {};
        for (const [slug, q] of Object.entries(data)) statuses[slug] = q.approvedAt ? 'live' : 'draft';
        setQuizStatuses(statuses);
      }
    } catch { /* non-fatal */ }
    setLoadingData(false);
  }

  function selectSlug(slug) {
    setSelectedSlug(slug);
    setSubmissions(null);    setSubsError('');
    setResetMsg('');         setResetError('');
    setLookupResult(null);   setLookupError('');
    setConfirmState(null);   setConfirmReason('');
    setBulkConfirmSlug('');  setBulkReason('');
  }

  async function loadSubmissions() {
    if (!selectedSlug || !user) return;
    setSubsLoading(true); setSubsError(''); setSubmissions(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(
        `/api/admin/submissions-by-slug?slug=${encodeURIComponent(selectedSlug)}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Load failed');
      setSubmissions(data.submissions);
    } catch (e) { setSubsError(e.message); }
    setSubsLoading(false);
  }

  async function performLookup() {
    const input = lookupInput.trim();
    if (!input || !user) return;
    setLookupLoading(true); setLookupError(''); setLookupResult(null);
    setConfirmState(null);  setConfirmReason('');
    try {
      if (input.startsWith('@')) {
        const handle = input.slice(1).toLowerCase();
        const { ref, get } = await import('firebase/database');
        const uidSnap = await get(ref(db, `usernames/${handle}`));
        if (!uidSnap.exists()) throw new Error('No user found with that handle.');
        const uid = uidSnap.val();
        const userSnap = await get(ref(db, `users/${uid}`));
        const userData = userSnap.exists() ? userSnap.val() : {};
        setLookupResult({ uid, email: userData.email ?? null, displayName: userData.displayName ?? null, handle });
      } else {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/admin/lookup-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ email: input }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lookup failed');
        setLookupResult(data);
      }
    } catch (e) { setLookupError(e.message); }
    setLookupLoading(false);
  }

  async function executeReset(uid, action, reason) {
    if (!selectedSlug || !user) return;
    setExecutingReset(uid); setResetMsg(''); setResetError('');
    setConfirmState(null);  setConfirmReason('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/reset-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ uid, slug: selectedSlug, action, reason: reason || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      if (data.wasReset === false) {
        setResetMsg(`No submission found for that user on "${selectedSlug}".`);
      } else {
        const label = action === 'unlock' ? 'Unlocked' : 'Reset';
        setResetMsg(`${label} — ${uid.slice(0, 10)}… can now retake "${selectedSlug}".`);
        setSubmissions(prev => prev ? prev.filter(sub => sub.uid !== uid) : prev);
      }
    } catch (e) { setResetError(e.message); }
    setExecutingReset(null);
  }

  async function executeBulkReset() {
    if (!selectedSlug || !user || bulkConfirmSlug !== selectedSlug) return;
    setBulkResetting(true); setResetMsg(''); setResetError('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/reset-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ slug: selectedSlug, action: 'bulk', reason: bulkReason || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk reset failed');
      const n = data.resetCount ?? 0;
      setResetMsg(
        n === 0
          ? 'No submissions found to reset.'
          : `Bulk reset complete — ${n} submission${n !== 1 ? 's' : ''} cleared for "${selectedSlug}".`
      );
      setBulkConfirmSlug(''); setBulkReason(''); setSubmissions(null);
    } catch (e) { setResetError(e.message); }
    setBulkResetting(false);
  }

  if (authLoading) return <div style={s.gate}>Loading…</div>;
  if (!isAdmin) return (
    <div style={s.gate}>
      <div style={{ color: '#f87171', fontWeight: 700, fontSize: '1rem' }}>Access Denied</div>
      <a href="/" style={{ color: '#a78bfa', fontSize: '0.82rem', textDecoration: 'none' }}>← Back to site</a>
    </div>
  );

  const lockedOutCount = submissions ? submissions.filter(sub => sub.hardballPassed === false).length : 0;
  const scoredCount    = submissions ? submissions.filter(sub => sub.hardballPassed === true).length : 0;

  return (
    <div style={s.page}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <header style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={s.sub}>Quiz Resets</div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <a href="/admin" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← CMS</a>
          <a href="/" style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>← Site</a>
        </div>
      </header>

      <div style={s.body}>
        <div style={s.topBar}>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: '0 0 0.25rem' }}>Quiz Resets</h2>
            <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif' }}>
              Clear a user's attempt so they can retake a quiz
            </div>
          </div>
        </div>

        {/* ── Story selector ─────────────────────────────────────────────── */}
        <div style={s.card}>
          <div style={s.fg}>
            <label style={s.label}>Story / Quiz</label>
            {loadingData ? (
              <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif' }}>Loading…</div>
            ) : (
              <select style={s.select} value={selectedSlug} onChange={e => selectSlug(e.target.value)}>
                <option value="">Select a story…</option>
                {stories.map(st => (
                  <option key={st.slug} value={st.slug}>
                    {st.title}{quizStatuses[st.slug] === 'live' ? ' ✓' : quizStatuses[st.slug] === 'draft' ? ' ⚠' : ''}
                  </option>
                ))}
              </select>
            )}
            {selectedSlug && quizStatuses[selectedSlug] && (
              <div style={s.hint}>
                {quizStatuses[selectedSlug] === 'live' ? '✓ Quiz is live.' : '⚠ Quiz is a draft — submissions may exist from testing.'}
              </div>
            )}
          </div>
        </div>

        {selectedSlug && (
          <>
            {resetMsg   && <div style={s.msgGreen}>{resetMsg}</div>}
            {resetError && <div style={s.error}>{resetError}</div>}

            {/* ── Submissions list ──────────────────────────────────────── */}
            <div style={{ ...s.sectionHead, marginTop: '1.5rem' }}>
              <span style={s.sectionTitle}>Submissions for "{selectedSlug}"</span>
              <button
                style={{ ...s.btnGhost, padding: '0.35rem 0.9rem', fontSize: '0.75rem', opacity: subsLoading ? 0.5 : 1 }}
                onClick={loadSubmissions} disabled={subsLoading}
              >
                {subsLoading ? <><span style={s.spinner} />Loading…</> : submissions !== null ? 'Reload' : 'Load all'}
              </button>
            </div>

            {subsError && <div style={s.error}>{subsError}</div>}

            {submissions !== null && (
              <div style={s.card}>
                {submissions.length === 0 ? (
                  <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif' }}>
                    No submissions found for this story.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif', marginBottom: '0.9rem' }}>
                      {submissions.length} submission{submissions.length !== 1 ? 's' : ''} — {lockedOutCount} locked out, {scoredCount} scored
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      {submissions.map(sub => {
                        const isConfirming = confirmState?.uid === sub.uid;
                        const rowAction    = sub.hardballPassed === false ? 'unlock' : 'reset';
                        return (
                          <div key={sub.uid} style={{ background: '#1a1a1a', borderRadius: 6, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0.8rem', flexWrap: 'wrap' }}>
                              <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)', flex: '0 0 auto' }}>
                                {sub.uid.slice(0, 10)}…
                              </span>
                              <StatusBadge sub={sub} />
                              {sub.pointsAwarded > 0 && (
                                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.68rem', color: '#c9a44c' }}>
                                  +{sub.pointsAwarded} pts
                                </span>
                              )}
                              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.68rem', color: 'rgba(255,255,255,0.22)', marginLeft: 'auto' }}>
                                {timeAgo(sub.submittedAt)}
                              </span>
                              {isConfirming ? (
                                <button
                                  style={{ ...s.btnGhost, padding: '0.3rem 0.7rem', fontSize: '0.72rem' }}
                                  onClick={() => { setConfirmState(null); setConfirmReason(''); }}
                                >Cancel</button>
                              ) : (
                                <button
                                  style={{ ...s.btnDanger, opacity: !!executingReset ? 0.4 : 1 }}
                                  disabled={!!executingReset}
                                  onClick={() => { setConfirmState({ uid: sub.uid, action: rowAction }); setConfirmReason(''); }}
                                >
                                  {rowAction === 'unlock' ? 'Unlock' : 'Reset'}
                                </button>
                              )}
                            </div>
                            {isConfirming && (
                              <div style={{ borderTop: '1px solid #242424', padding: '0.6rem 0.8rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <input
                                  style={{ ...s.input, flex: 1, fontSize: '0.82rem', padding: '0.45rem 0.75rem' }}
                                  placeholder="Reason (optional)"
                                  value={confirmReason}
                                  onChange={e => setConfirmReason(e.target.value)}
                                  onKeyDown={e => e.key === 'Enter' && executeReset(sub.uid, rowAction, confirmReason)}
                                  disabled={!!executingReset}
                                  autoFocus
                                />
                                <button
                                  style={{ ...s.btnDanger, flexShrink: 0, opacity: executingReset === sub.uid ? 0.5 : 1 }}
                                  disabled={!!executingReset}
                                  onClick={() => executeReset(sub.uid, rowAction, confirmReason)}
                                >
                                  {executingReset === sub.uid ? '…' : `Confirm ${rowAction}`}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Lookup by email or @handle ────────────────────────────── */}
            <div style={{ ...s.sectionHead, marginTop: '1.75rem' }}>
              <span style={s.sectionTitle}>Reset by email or @handle</span>
            </div>
            <div style={s.cardPurple}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                <div style={{ ...s.fg, flex: 1, marginBottom: 0 }}>
                  <label style={s.label}>Email or @handle</label>
                  <input
                    style={s.input}
                    value={lookupInput}
                    onChange={e => { setLookupInput(e.target.value); setLookupResult(null); setLookupError(''); setConfirmState(null); setConfirmReason(''); }}
                    onKeyDown={e => e.key === 'Enter' && performLookup()}
                    placeholder="user@example.com or @handle"
                    disabled={lookupLoading}
                  />
                </div>
                <button
                  style={{ ...s.btn, opacity: (!lookupInput.trim() || lookupLoading) ? 0.5 : 1, flexShrink: 0 }}
                  disabled={!lookupInput.trim() || lookupLoading}
                  onClick={performLookup}
                >
                  {lookupLoading ? <><span style={s.spinner} />Looking up…</> : 'Look up'}
                </button>
              </div>

              {lookupError && <div style={{ ...s.error, marginTop: '0.75rem', marginBottom: 0 }}>{lookupError}</div>}

              {lookupResult && (() => {
                const existing     = submissions?.find(sub => sub.uid === lookupResult.uid);
                const lookupAction = existing?.hardballPassed === false ? 'unlock' : 'reset';
                const isConfirming = confirmState?.uid === lookupResult.uid;
                return (
                  <div style={{ marginTop: '1rem', padding: '0.9rem 1rem', background: '#111', borderRadius: 6, border: '1px solid #222' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '0.65rem' }}>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.72rem', color: '#6ee7b7', fontWeight: 600 }}>Found</span>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)' }}>
                        {lookupResult.uid.slice(0, 16)}…
                      </span>
                      {(lookupResult.displayName ?? lookupResult.handle) && (
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)' }}>
                          {lookupResult.displayName ?? `@${lookupResult.handle}`}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', marginBottom: isConfirming ? '0.65rem' : 0 }}>
                      {existing ? (
                        <>
                          <StatusBadge sub={existing} />
                          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)' }}>
                            submitted {timeAgo(existing.submittedAt)}
                          </span>
                        </>
                      ) : submissions ? (
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>
                          No submission for this quiz.
                        </span>
                      ) : (
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)' }}>
                          Load submissions above to see their status.
                        </span>
                      )}
                      {isConfirming ? (
                        <button
                          style={{ ...s.btnGhost, marginLeft: 'auto', padding: '0.3rem 0.7rem', fontSize: '0.72rem' }}
                          onClick={() => { setConfirmState(null); setConfirmReason(''); }}
                        >Cancel</button>
                      ) : (
                        <button
                          style={{ ...s.btnDanger, marginLeft: 'auto', opacity: !!executingReset ? 0.4 : 1 }}
                          disabled={!!executingReset}
                          onClick={() => { setConfirmState({ uid: lookupResult.uid, action: lookupAction }); setConfirmReason(''); }}
                        >
                          {lookupAction === 'unlock' ? 'Unlock' : 'Reset'} for "{selectedSlug}"
                        </button>
                      )}
                    </div>
                    {isConfirming && (
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          style={{ ...s.input, flex: 1, fontSize: '0.82rem', padding: '0.45rem 0.75rem' }}
                          placeholder="Reason (optional)"
                          value={confirmReason}
                          onChange={e => setConfirmReason(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && executeReset(lookupResult.uid, lookupAction, confirmReason)}
                          disabled={!!executingReset}
                          autoFocus
                        />
                        <button
                          style={{ ...s.btnDanger, flexShrink: 0, opacity: executingReset === lookupResult.uid ? 0.5 : 1 }}
                          disabled={!!executingReset}
                          onClick={() => executeReset(lookupResult.uid, lookupAction, confirmReason)}
                        >
                          {executingReset === lookupResult.uid ? '…' : `Confirm ${lookupAction}`}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* ── Bulk reset ────────────────────────────────────────────── */}
            <div style={{ ...s.sectionHead, marginTop: '1.75rem' }}>
              <span style={s.sectionTitle}>Bulk reset</span>
            </div>
            <div style={s.cardDanger}>
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1.65, marginBottom: '1.1rem' }}>
                Wipes <strong style={{ color: 'rgba(255,255,255,0.65)' }}>every</strong> submission for this quiz and allows all readers to retake.
                Each wipe is logged individually. Cannot be undone.
                {submissions && submissions.length > 0 && (
                  <span style={{ color: '#f87171' }}> {submissions.length} submission{submissions.length !== 1 ? 's' : ''} currently on file.</span>
                )}
              </div>
              <div style={s.fg}>
                <label style={s.labelDanger}>Type "{selectedSlug}" to confirm</label>
                <input
                  style={{ ...s.input, borderColor: bulkConfirmSlug && bulkConfirmSlug !== selectedSlug ? 'rgba(220,38,38,0.5)' : '#2e2e2e' }}
                  value={bulkConfirmSlug}
                  onChange={e => setBulkConfirmSlug(e.target.value)}
                  placeholder={selectedSlug}
                  disabled={bulkResetting}
                />
              </div>
              <div style={s.fg}>
                <label style={s.label}>Reason (optional)</label>
                <input
                  style={s.input}
                  value={bulkReason}
                  onChange={e => setBulkReason(e.target.value)}
                  placeholder="e.g. Hardball question was ambiguous"
                  disabled={bulkResetting}
                />
              </div>
              <button
                style={{ ...s.btnDanger, fontSize: '0.82rem', padding: '0.55rem 1.2rem', opacity: (bulkConfirmSlug !== selectedSlug || bulkResetting) ? 0.4 : 1 }}
                disabled={bulkConfirmSlug !== selectedSlug || bulkResetting}
                onClick={executeBulkReset}
              >
                {bulkResetting
                  ? <><span style={{ ...s.spinner, borderTopColor: '#f87171' }} />Resetting…</>
                  : `Reset all${submissions ? ` ${submissions.length}` : ''} submissions`}
              </button>
            </div>
          </>
        )}

        {!selectedSlug && !loadingData && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', padding: '3rem 0', fontSize: '0.88rem', fontFamily: 'Inter, sans-serif' }}>
            Select a story to begin.
          </div>
        )}
      </div>
    </div>
  );
}
