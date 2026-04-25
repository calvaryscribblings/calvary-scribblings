'use client';
import { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';
const ADMIN_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const LS_KEY = 'cs_quiz_wip';

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header: { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  body: { maxWidth: 860, margin: '0 auto', padding: '2.5rem 2rem' },
  btn: { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGold: { background: 'rgba(201,164,76,0.12)', color: '#c9a44c', border: '1px solid rgba(201,164,76,0.3)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGreen: { background: 'rgba(29,158,117,0.15)', color: '#1d9e75', border: '1px solid rgba(29,158,117,0.3)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  card: { background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1.25rem 1.4rem', marginBottom: '0.75rem' },
  cardPurple: { background: '#171717', border: '1px solid rgba(107,47,173,0.45)', borderRadius: 10, padding: '1.25rem 1.4rem', marginBottom: '1.25rem' },
  input: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.6rem 0.9rem', color: '#fff', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  inputSm: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.5rem 0.75rem', color: '#fff', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', width: '70px', boxSizing: 'border-box' },
  textarea: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.6rem 0.9rem', color: '#fff', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.6 },
  select: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  label: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa', display: 'block', marginBottom: '0.45rem', fontFamily: 'Inter, sans-serif' },
  labelDim: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: '0.45rem', fontFamily: 'Inter, sans-serif' },
  fg: { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.85rem' },
  hint: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.5, fontFamily: 'Inter, sans-serif' },
  msg: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#c4b5fd', marginBottom: '1.25rem', fontFamily: 'Inter, sans-serif' },
  msgGreen: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.25)', color: '#6ee7b7', marginBottom: '1.25rem', fontFamily: 'Inter, sans-serif' },
  error: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.82rem', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: '#f87171', marginBottom: '1.25rem', fontFamily: "'Courier New', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'break-word' },
  warn: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', color: '#fcd34d', marginBottom: '1.25rem', fontFamily: 'Inter, sans-serif' },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
  sectionTitle: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif' },
  num: { fontSize: '0.65rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.6rem', fontFamily: 'Inter, sans-serif' },
  actionBar: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', borderTop: '1px solid #242424', paddingTop: '1.5rem', marginTop: '1.5rem', flexWrap: 'wrap' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' },
  comingSoon: { background: 'rgba(201,164,76,0.07)', border: '1px solid rgba(201,164,76,0.2)', borderRadius: 10, padding: '2.5rem', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', fontSize: '0.88rem', marginTop: '1.5rem' },
  spinner: { display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: '0.5rem', verticalAlign: 'middle' },
};

function filterBtn(active) {
  return {
    background: active ? 'rgba(124,58,237,0.25)' : 'transparent',
    color: active ? '#c4b5fd' : 'rgba(255,255,255,0.4)',
    border: active ? '1px solid rgba(124,58,237,0.5)' : '1px solid rgba(255,255,255,0.12)',
    padding: '0.35rem 0.9rem',
    borderRadius: 4,
    fontWeight: active ? 700 : 400,
    fontSize: '0.78rem',
    cursor: 'pointer',
    fontFamily: 'Inter, sans-serif',
  };
}

function TagInput({ tags, onChange, placeholder, disabled }) {
  const [input, setInput] = useState('');

  function addTag() {
    const val = input.trim();
    if (val && !tags.includes(val)) onChange([...tags, val]);
    setInput('');
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', padding: '0.5rem', background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, minHeight: 42, opacity: disabled ? 0.5 : 1 }}>
      {tags.map((tag, i) => (
        <span key={i} style={{ background: 'rgba(107,47,173,0.2)', border: '1px solid rgba(107,47,173,0.35)', borderRadius: 4, padding: '0.15rem 0.45rem', fontSize: '0.78rem', color: '#c4b5fd', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'Inter, sans-serif' }}>
          {tag}
          {!disabled && (
            <button onClick={() => onChange(tags.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'rgba(196,181,253,0.6)', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '0.9rem' }}>×</button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
          }}
          onBlur={addTag}
          placeholder={placeholder || 'Add tag, press Enter…'}
          style={{ background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: '0.82rem', minWidth: 120, flex: 1, fontFamily: 'Inter, sans-serif', padding: '0.1rem 0.2rem' }}
        />
      )}
    </div>
  );
}

export default function QuizzesPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  const [cmsStories, setCmsStories] = useState([]);
  const [quizStatuses, setQuizStatuses] = useState({});
  const [modeFilter, setModeFilter] = useState('all');
  const [selectedSlug, setSelectedSlug] = useState('');
  const [quiz, setQuiz] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('info');
  const [mcqsCollapsed, setMcqsCollapsed] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    loadData();
  }, [isAdmin]);

  useEffect(() => {
    if (!selectedSlug || !isAdmin) return;
    setQuiz(null);
    setWarnings([]);
    setError('');
    setMsg('');
    loadExistingQuiz(selectedSlug);
  }, [selectedSlug]);

  // Persist WIP to localStorage on every quiz change
  useEffect(() => {
    if (!selectedSlug || !quiz) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ slug: selectedSlug, quiz })); } catch {}
  }, [quiz, selectedSlug]);

  async function loadData() {
    setLoadingData(true);
    try {
      const { ref, get } = await import('firebase/database');
      const storiesSnap = await get(ref(db, 'cms_stories'));
      if (storiesSnap.exists()) {
        const data = storiesSnap.val();
        setCmsStories(
          Object.entries(data)
            .map(([slug, st]) => ({
              slug,
              title: st.title || slug,
              author: st.author || '',
              hasEpub: !!st.epubUrl,
            }))
            .sort((a, b) => a.title.localeCompare(b.title))
        );
      }
    } catch (e) {
      setError('Failed to load stories: ' + e.message);
      setLoadingData(false);
      return;
    }

    // Load quiz statuses separately — cms_quizzes may not have rules yet
    try {
      const { ref, get } = await import('firebase/database');
      const quizzesSnap = await get(ref(db, 'cms_quizzes'));
      if (quizzesSnap.exists()) {
        const data = quizzesSnap.val();
        const statuses = {};
        for (const [slug, q] of Object.entries(data)) {
          statuses[slug] = q.approvedAt ? 'live' : 'draft';
        }
        setQuizStatuses(statuses);
      }
    } catch {
      // non-fatal: quiz statuses will show as unlabelled until rules allow the read
    }

    setLoadingData(false);
  }

  async function loadExistingQuiz(slug) {
    try {
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, `cms_quizzes/${slug}`));
      if (snap.exists()) {
        setQuiz(snap.val());
        showMsg('Existing quiz loaded. Edit and re-approve if you make changes.', 'info');
      } else {
        try {
          const wip = JSON.parse(localStorage.getItem(LS_KEY));
          if (wip && wip.slug === slug && wip.quiz) {
            setQuiz(wip.quiz);
            showMsg('Unsaved draft restored from your last session.', 'info');
          }
        } catch {}
      }
    } catch (e) {
      setError('Failed to load quiz: ' + e.message);
    }
  }

  function showMsg(text, type = 'info') {
    setMsg(text);
    setMsgType(type);
  }

  async function handleGenerate() {
    if (!selectedSlug || !user) return;
    setGenerating(true); setError(''); setMsg(''); setWarnings([]);
    try {
      const res = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: selectedSlug, mode: 'story', uid: user.uid }),
      });
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        console.error('[generate-quiz] response was not JSON, status:', res.status, parseErr);
        throw new Error(`Server returned non-JSON response (HTTP ${res.status}). Check server logs.`);
      }
      if (!res.ok) {
        console.error('[generate-quiz] server error response:', data);
        throw new Error(data.error || JSON.stringify(data) || 'Generation failed.');
      }
      setQuiz(data.quiz);
      setWarnings(data.warnings || []);
      showMsg('Quiz generated. Review and edit before publishing.', 'info');
    } catch (e) {
      console.error('[generate-quiz] client error:', e);
      setError(e.message);
    }
    setGenerating(false);
  }

  async function handleSaveDraft() {
    if (!selectedSlug || !quiz || !user) return;
    setSaving(true); setError(''); setMsg('');
    try {
      const { ref, set, update } = await import('firebase/database');
      await set(ref(db, `cms_quizzes/${selectedSlug}`), { ...quiz, approvedAt: null, approvedBy: null });
      // Mark quiz unavailable on the story card without losing counters or naming state
      await update(ref(db, `cms_stories/${selectedSlug}/quizMeta`), { hasQuiz: false });
      try { localStorage.removeItem(LS_KEY); } catch {}
      setQuizStatuses(prev => ({ ...prev, [selectedSlug]: 'draft' }));
      showMsg('Draft saved.', 'green');
    } catch (e) { setError('Save failed: ' + e.message); }
    setSaving(false);
  }

  async function handleApprove() {
    if (!selectedSlug || !quiz || !user) return;
    setSaving(true); setError(''); setMsg('');
    try {
      const { ref, get, update } = await import('firebase/database');
      const approvedAt = Date.now();

      // Read existing quizMeta to preserve attempt count and naming state on re-approval
      const metaSnap = await get(ref(db, `cms_stories/${selectedSlug}/quizMeta`));
      const existing = metaSnap.exists() ? metaSnap.val() : null;

      // Atomic multi-location write: quiz node + story quizMeta cache
      await update(ref(db), {
        [`cms_quizzes/${selectedSlug}`]: { ...quiz, approvedAt, approvedBy: user.uid },
        [`cms_stories/${selectedSlug}/quizMeta`]: {
          hasQuiz: true,
          scribblesReward: quiz.maxPoints ?? 50,
          publishedAt: approvedAt,
          attemptCount: existing?.attemptCount ?? 0,
          namingClaimedBy: existing?.namingClaimedBy ?? null,
          namingClaimedAt: existing?.namingClaimedAt ?? null,
        },
      });
      try { localStorage.removeItem(LS_KEY); } catch {}
      setQuizStatuses(prev => ({ ...prev, [selectedSlug]: 'live' }));
      showMsg('Quiz approved and published.', 'green');
    } catch (e) { setError('Approve failed: ' + e.message); }
    setSaving(false);
  }

  function setHardball(field, value) {
    setQuiz(q => ({ ...q, hardball: { ...q.hardball, [field]: value } }));
  }

  function setMcq(i, field, value) {
    setQuiz(q => {
      const mcqs = [...q.mcqs];
      mcqs[i] = { ...mcqs[i], [field]: value };
      return { ...q, mcqs };
    });
  }

  function setMcqOption(i, j, value) {
    setQuiz(q => {
      const mcqs = [...q.mcqs];
      const options = [...mcqs[i].options];
      options[j] = value;
      mcqs[i] = { ...mcqs[i], options };
      return { ...q, mcqs };
    });
  }

  function setEssay(i, field, value) {
    setQuiz(q => {
      const essays = [...q.essays];
      essays[i] = { ...essays[i], [field]: value };
      return { ...q, essays };
    });
  }

  const filteredStories = modeFilter === 'story'
    ? cmsStories.filter(s => !s.hasEpub)
    : modeFilter === 'reader'
      ? cmsStories.filter(s => s.hasEpub)
      : cmsStories;

  function statusLabel(slug) {
    const status = quizStatuses[slug];
    if (status === 'live') return ' ✓';
    if (status === 'draft') return ' ⚠';
    return '';
  }

  const busy = generating || saving;

  if (authLoading) return <div style={s.gate}>Loading…</div>;
  if (!isAdmin) return (
    <div style={s.gate}>
      <div style={{ color: '#f87171', fontWeight: 700, fontSize: '1rem' }}>Access Denied</div>
      <a href="/" style={{ color: '#a78bfa', fontSize: '0.82rem', textDecoration: 'none' }}>← Back to site</a>
    </div>
  );

  return (
    <div style={s.page}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <header style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={s.sub}>Quiz Builder</div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <a href="/admin" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← CMS</a>
          <a href="/" style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>← Site</a>
        </div>
      </header>

      <div style={s.body}>
        <div style={s.topBar}>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: '0 0 0.25rem' }}>Quiz Builder</h2>
            <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif' }}>
              Generate, review and publish AI-assisted comprehension quizzes
            </div>
          </div>
        </div>

        {/* Story selector */}
        <div style={s.card}>
          <div style={{ marginBottom: '0.85rem' }}>
            <label style={s.label}>Filter</label>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {['all', 'story', 'reader'].map(f => (
                <button key={f} style={filterBtn(modeFilter === f)} onClick={() => { setModeFilter(f); setSelectedSlug(''); setQuiz(null); setMsg(''); setError(''); setWarnings([]); }}>
                  {f === 'all' ? 'All' : f === 'story' ? 'Story page' : 'Book reader'}
                </button>
              ))}
            </div>
          </div>

          {modeFilter !== 'reader' && (
            <>
              <div style={s.fg}>
                <label style={s.label}>Story</label>
                {loadingData ? (
                  <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif' }}>Loading stories…</div>
                ) : (
                  <select
                    style={s.select}
                    value={selectedSlug}
                    onChange={e => setSelectedSlug(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">Select a story…</option>
                    {filteredStories.map(st => (
                      <option key={st.slug} value={st.slug}>
                        {st.title}{statusLabel(st.slug)}
                        {statusLabel(st.slug) === ' ✓' ? ' — Quiz live' : statusLabel(st.slug) === ' ⚠' ? ' — Draft saved' : ''}
                      </option>
                    ))}
                  </select>
                )}
                {selectedSlug && quizStatuses[selectedSlug] && (
                  <div style={s.hint}>
                    {quizStatuses[selectedSlug] === 'live' ? '✓ This story has a published quiz.' : '⚠ Unpublished draft exists.'}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  style={{ ...s.btn, opacity: (!selectedSlug || busy) ? 0.5 : 1 }}
                  disabled={!selectedSlug || busy}
                  onClick={handleGenerate}
                >
                  {generating ? (
                    <><span style={s.spinner} />Generating quiz… (~30s)</>
                  ) : quiz ? 'Regenerate' : 'Generate Quiz'}
                </button>
              </div>
            </>
          )}

          {modeFilter === 'reader' && (
            <div style={s.comingSoon}>
              <div style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: '#c9a44c' }}>Coming in Phase 1.5</div>
              Book reader quizzes require EPUB text extraction, which is not yet wired up.
              Switch to <strong>Story page</strong> to generate quizzes now.
            </div>
          )}
        </div>

        {/* Feedback messages */}
        {error && <div style={s.error}>{error}</div>}
        {msg && <div style={msgType === 'green' ? s.msgGreen : s.msg}>{msg}</div>}
        {warnings.length > 0 && (
          <div style={s.warn}>
            <strong>Validation warnings:</strong>
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        {/* Quiz editor */}
        {quiz && selectedSlug && (
          <div>
            {/* Hardball */}
            <div style={{ ...s.sectionHead, marginTop: '0.5rem' }}>
              <span style={s.sectionTitle}>Hardball Question</span>
            </div>
            <div style={s.cardPurple}>
              <div style={s.fg}>
                <label style={s.label}>Question</label>
                <textarea
                  style={{ ...s.textarea, minHeight: 80 }}
                  value={quiz.hardball?.question || ''}
                  onChange={e => setHardball('question', e.target.value)}
                  disabled={busy}
                />
              </div>
              <div style={s.fg}>
                <label style={s.label}>Keywords <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(answer must contain {quiz.hardball?.minMatches ?? 2} of these)</span></label>
                <TagInput
                  tags={quiz.hardball?.keywords || []}
                  onChange={tags => setHardball('keywords', tags)}
                  placeholder="Add keyword, press Enter…"
                  disabled={busy}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <div style={{ ...s.fg, flex: '0 0 auto' }}>
                  <label style={s.label}>Min matches</label>
                  <input
                    type="number"
                    min={1}
                    max={quiz.hardball?.keywords?.length || 5}
                    style={{ ...s.inputSm }}
                    value={quiz.hardball?.minMatches ?? 2}
                    onChange={e => setHardball('minMatches', Number(e.target.value))}
                    disabled={busy}
                  />
                </div>
                <div style={{ ...s.fg, flex: 1 }}>
                  <label style={s.label}>Helper text <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional hint shown to reader)</span></label>
                  <input
                    style={s.input}
                    value={quiz.hardball?.helperText || ''}
                    onChange={e => setHardball('helperText', e.target.value)}
                    disabled={busy}
                    placeholder="Optional hint…"
                  />
                </div>
              </div>
            </div>

            {/* MCQs */}
            <div style={{ ...s.sectionHead, marginTop: '1rem' }}>
              <span style={s.sectionTitle}>Multiple Choice ({quiz.mcqs?.length ?? 0} questions)</span>
              <button
                style={{ ...s.btnGhost, padding: '0.25rem 0.7rem', fontSize: '0.72rem' }}
                onClick={() => setMcqsCollapsed(c => !c)}
              >
                {mcqsCollapsed ? 'Expand all' : 'Collapse all'}
              </button>
            </div>

            {!mcqsCollapsed && (quiz.mcqs || []).map((mcq, i) => (
              <div key={i} style={s.card}>
                <div style={s.num}>MCQ {i + 1} of {quiz.mcqs.length}</div>
                <div style={s.fg}>
                  <label style={s.labelDim}>Question</label>
                  <textarea
                    style={{ ...s.textarea, minHeight: 64 }}
                    value={mcq.question || ''}
                    onChange={e => setMcq(i, 'question', e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.85rem' }}>
                  {(mcq.options || ['', '', '', '']).map((opt, j) => (
                    <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="radio"
                        name={`mcq-${i}-correct`}
                        checked={mcq.correctAnswer === j}
                        onChange={() => setMcq(i, 'correctAnswer', j)}
                        disabled={busy}
                        style={{ accentColor: '#7c3aed', flexShrink: 0 }}
                      />
                      <input
                        style={{ ...s.input, flex: 1 }}
                        value={opt}
                        onChange={e => setMcqOption(i, j, e.target.value)}
                        disabled={busy}
                        placeholder={`Option ${String.fromCharCode(65 + j)}…`}
                      />
                    </div>
                  ))}
                </div>
                <div style={s.fg}>
                  <label style={s.labelDim}>Explanation</label>
                  <input
                    style={s.input}
                    value={mcq.explanation || ''}
                    onChange={e => setMcq(i, 'explanation', e.target.value)}
                    disabled={busy}
                    placeholder="Why the correct answer is right…"
                  />
                </div>
              </div>
            ))}

            {mcqsCollapsed && (
              <div style={{ ...s.card, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontFamily: 'Inter, sans-serif', fontSize: '0.82rem', cursor: 'pointer' }} onClick={() => setMcqsCollapsed(false)}>
                {quiz.mcqs?.length ?? 0} MCQs collapsed — click to expand
              </div>
            )}

            {/* Essays */}
            <div style={{ ...s.sectionHead, marginTop: '1rem' }}>
              <span style={s.sectionTitle}>Essay Questions ({quiz.essays?.length ?? 0} questions)</span>
            </div>

            {(quiz.essays || []).map((essay, i) => (
              <div key={i} style={s.card}>
                <div style={s.num}>Essay {i + 1} of {quiz.essays.length}</div>
                <div style={s.fg}>
                  <label style={s.labelDim}>Question</label>
                  <textarea
                    style={{ ...s.textarea, minHeight: 64 }}
                    value={essay.question || ''}
                    onChange={e => setEssay(i, 'question', e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div style={s.fg}>
                  <label style={s.labelDim}>Keyword pool <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(reader must use {essay.requiredMatches ?? 5} of these)</span></label>
                  <TagInput
                    tags={essay.keywordPool || []}
                    onChange={tags => setEssay(i, 'keywordPool', tags)}
                    placeholder="Add keyword, press Enter…"
                    disabled={busy}
                  />
                </div>
                <div style={{ ...s.fg, width: 160 }}>
                  <label style={s.labelDim}>Required matches</label>
                  <input
                    type="number"
                    min={1}
                    max={essay.keywordPool?.length || 8}
                    style={s.inputSm}
                    value={essay.requiredMatches ?? 5}
                    onChange={e => setEssay(i, 'requiredMatches', Number(e.target.value))}
                    disabled={busy}
                  />
                </div>
              </div>
            ))}

            {/* Action bar */}
            <div style={s.actionBar}>
              <button style={{ ...s.btnGhost, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={handleGenerate}>
                {generating ? 'Regenerating…' : 'Regenerate'}
              </button>
              <button style={{ ...s.btnGold, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={handleSaveDraft}>
                {saving ? 'Saving…' : 'Save as draft'}
              </button>
              <button style={{ ...s.btnGreen, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={handleApprove}>
                {saving ? 'Publishing…' : 'Approve & publish'}
              </button>
            </div>
          </div>
        )}

        {!quiz && selectedSlug && !generating && !error && (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.25)', padding: '3rem 0', fontSize: '0.88rem', fontFamily: 'Inter, sans-serif' }}>
            No quiz yet for this story. Hit 'Generate Quiz' to create one.
          </div>
        )}
      </div>
    </div>
  );
}
