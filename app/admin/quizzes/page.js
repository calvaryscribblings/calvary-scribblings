'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { db, DB_URL } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { buildQuizSummary, INDEX_PATH } from '../../lib/storyIndex';
import { toRow, tokenize, quizState, selectRows } from '../../lib/quizPicker';

const ADMIN_EMAIL = 'ikennaworksfromhome@gmail.com';
const ADMIN_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const LS_KEY = 'cs_quiz_wip';

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "Cormorant Garamond, Georgia, serif" },
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
  label: { fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa', display: 'block', marginBottom: '0.45rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  labelDim: { fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: '0.45rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  fg: { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.85rem' },
  hint: { fontSize: '0.75rem', fontWeight: 500, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5, fontFamily: 'Cormorant Garamond, Georgia, serif' },
  msg: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#c4b5fd', marginBottom: '1.25rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  msgGreen: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.25)', color: '#6ee7b7', marginBottom: '1.25rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  error: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.82rem', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: '#f87171', marginBottom: '1.25rem', fontFamily: "'Courier New', monospace", whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowWrap: 'break-word' },
  warn: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)', color: '#fcd34d', marginBottom: '1.25rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "Cormorant Garamond, Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
  sectionTitle: { fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  num: { fontSize: '0.65rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.6rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  actionBar: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', borderTop: '1px solid #242424', paddingTop: '1.5rem', marginTop: '1.5rem', flexWrap: 'wrap' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' },
  comingSoon: { background: 'rgba(201,164,76,0.07)', border: '1px solid rgba(201,164,76,0.2)', borderRadius: 10, padding: '2.5rem', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.88rem', marginTop: '1.5rem' },
  spinner: { display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: '0.5rem', verticalAlign: 'middle' },
  search: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.7rem 2.2rem 0.7rem 0.9rem', color: '#fff', fontSize: '1rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  selectSm: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.4rem 0.6rem', color: '#fff', fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', maxWidth: 230 },
  listBox: { border: '1px solid #242424', borderRadius: 8, background: '#141414', maxHeight: 360, overflowY: 'auto' },
  meta: { fontSize: '0.8rem', fontWeight: 500, color: 'rgba(255,255,255,0.35)', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  countLine: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', gap: '0.75rem', flexWrap: 'wrap' },
  linkBtn: { background: 'none', border: 'none', color: '#a78bfa', fontSize: '0.8rem', fontFamily: 'Cormorant Garamond, Georgia, serif', cursor: 'pointer', padding: 0, textDecoration: 'underline' },
  empty: { padding: '2.25rem 1rem', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.9rem' },
};

function row(selected) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
    width: '100%', textAlign: 'left', boxSizing: 'border-box',
    padding: '0.6rem 0.85rem',
    background: selected ? 'rgba(124,58,237,0.16)' : 'transparent',
    borderBottom: '1px solid #202020',
    borderLeft: selected ? '3px solid #7c3aed' : '3px solid transparent',
    cursor: 'pointer', fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'inherit',
    borderTop: 'none', borderRight: 'none',
  };
}

// Quiz badge, one per state. `live` and `none` are the two the daily workflow sorts
// on; `unlisted` is the honest third — a quiz record exists but the story does not
// advertise it, so no card or story page offers it to a reader.
const BADGE = {
  live: { text: '✓ Quiz live', style: { color: '#1d9e75', background: 'rgba(29,158,117,0.12)', border: '1px solid rgba(29,158,117,0.3)' }, title: 'A quiz exists and the story advertises it.' },
  unlisted: { text: '⚠ Built · not shown', style: { color: '#c9a44c', background: 'rgba(201,164,76,0.1)', border: '1px solid rgba(201,164,76,0.3)' }, title: 'A quiz exists in cms_quizzes, but the story does not advertise it (quizMeta.hasQuiz is not true), so no reader is offered it. Approve & publish to fix.' },
  none: { text: 'No quiz', style: { color: 'rgba(255,255,255,0.3)', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)' }, title: 'No quiz has been built for this story.' },
};

function filterBtn(active) {
  return {
    background: active ? 'rgba(124,58,237,0.25)' : 'transparent',
    color: active ? '#c4b5fd' : 'rgba(255,255,255,0.4)',
    border: active ? '1px solid rgba(124,58,237,0.5)' : '1px solid rgba(255,255,255,0.12)',
    padding: '0.35rem 0.9rem',
    borderRadius: 4,
    fontWeight: active ? 700 : 500,
    fontSize: '0.85rem',
    cursor: 'pointer',
    fontFamily: 'Cormorant Garamond, Georgia, serif',
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
        <span key={i} style={{ background: 'rgba(107,47,173,0.2)', border: '1px solid rgba(107,47,173,0.35)', borderRadius: 4, padding: '0.15rem 0.45rem', fontSize: '0.85rem', fontWeight: 500, color: '#c4b5fd', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
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
          style={{ background: 'none', border: 'none', outline: 'none', color: '#fff', fontSize: '0.82rem', minWidth: 120, flex: 1, fontFamily: 'Cormorant Garamond, Georgia, serif', padding: '0.1rem 0.2rem' }}
        />
      )}
    </div>
  );
}

export default function QuizzesPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user && (user.uid === 'XaG6bTGqdDXh7VkBTw4y1H2d2s82' || user.uid === 'GfXFIc0dThZ1cs2SBBQIFao4aSz1' || (user.email && user.email.toLowerCase() === ADMIN_EMAIL));

  // The picker's rows. `indexRows` come from cms_stories_index (published stories
  // only — isIndexed() excludes hidden ones); `hiddenRows` are the unpublished
  // remainder, loaded from cms_stories only when the admin asks for them.
  const [indexRows, setIndexRows] = useState([]);
  const [hiddenSlugs, setHiddenSlugs] = useState([]);
  const [hiddenRows, setHiddenRows] = useState([]);
  const [loadingHidden, setLoadingHidden] = useState(false);
  // Slugs that HAVE a quiz record (cms_quizzes keys, read shallow) and slugs whose
  // story ADVERTISES one (the index's quiz badge / quizMeta.hasQuiz). They are not
  // the same set — see the drift note where quizStateOf is defined.
  const [quizSlugs, setQuizSlugs] = useState(() => new Set());
  const [advertisedSlugs, setAdvertisedSlugs] = useState(() => new Set());
  const [quizKeysOk, setQuizKeysOk] = useState(false);
  const [modeFilter, setModeFilter] = useState('all');
  const [quizFilter, setQuizFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [authorFilter, setAuthorFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [genMode, setGenMode] = useState('story');
  const [extractMissing, setExtractMissing] = useState(null);
  const searchRef = useRef(null);
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

  // ── Data sources ────────────────────────────────────────────────────────────
  // The picker used to pull cms_stories (1.47 MB) and cms_quizzes (906 KB) whole,
  // for a list that shows a title and a badge. It now reads:
  //   cms_stories_index   ~176 KB  — the slim projection; carries every field a row
  //                                  renders (title, author, categoryName, date,
  //                                  readerMode/bookReader) plus the quiz badge.
  //   cms_quizzes?shallow  ~4 KB   — KEYS ONLY. Which slugs have a quiz at all.
  //   cms_stories?shallow  ~6 KB   — KEYS ONLY. Its difference from the index keys
  //                                  is exactly the unpublished set, so the picker
  //                                  can say how many stories it is not showing
  //                                  without paying for their records.
  // Neither shallow read exists in the JS SDK, so both go over RTDB's REST surface.
  // cms_quizzes is world-readable (database.rules.json), so no token is needed.
  async function loadData() {
    setLoadingData(true);
    let indexSlugs = new Set();
    try {
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, INDEX_PATH));
      if (snap.exists()) {
        const data = snap.val();
        const rows = Object.entries(data).map(([slug, r]) => toRow(slug, r, true));
        indexSlugs = new Set(rows.map(r => r.slug));
        setIndexRows(rows);
        setAdvertisedSlugs(new Set(rows.filter(r => r.advertised).map(r => r.slug)));
      }
    } catch (e) {
      setError('Failed to load stories: ' + e.message);
      setLoadingData(false);
      return;
    }

    // Which slugs have a quiz record. Non-fatal: on failure the picker falls back
    // to the story's own badge (see quizStateOf).
    try {
      const res = await fetch(`${DB_URL}/cms_quizzes.json?shallow=true`);
      if (res.ok) {
        const keys = (await res.json()) || {};
        setQuizSlugs(new Set(Object.keys(keys)));
        setQuizKeysOk(true);
      }
    } catch {
      // leave quizKeysOk false — the badge is then derived from the story alone
    }

    // The unpublished remainder: story keys the index does not carry.
    try {
      const res = await fetch(`${DB_URL}/cms_stories.json?shallow=true`);
      if (res.ok) {
        const keys = (await res.json()) || {};
        setHiddenSlugs(Object.keys(keys).filter(slug => !indexSlugs.has(slug)));
      }
    } catch {
      // non-fatal: the picker simply will not offer the unpublished stories
    }

    setLoadingData(false);
  }

  // Pull the unpublished stories on demand. They are absent from the index by
  // design, so there is no slim source for them — this reads their full records,
  // which is why it is a click and not part of the initial load.
  async function loadUnpublished() {
    if (loadingHidden || !hiddenSlugs.length) return;
    setLoadingHidden(true);
    try {
      const { ref, get } = await import('firebase/database');
      const snaps = await Promise.all(hiddenSlugs.map(slug => get(ref(db, `cms_stories/${slug}`))));
      const rows = snaps
        .map((snap, i) => (snap.exists() ? toRow(hiddenSlugs[i], snap.val(), false) : null))
        .filter(Boolean);
      setHiddenRows(rows);
      setAdvertisedSlugs(prev => {
        const next = new Set(prev);
        rows.forEach(r => { if (r.advertised) next.add(r.slug); });
        return next;
      });
    } catch (e) {
      setError('Failed to load unpublished stories: ' + e.message);
    }
    setLoadingHidden(false);
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
    // The mode sent to the Function is the one shown next to this button. It used
    // to be read off the story-page/book-reader FILTER, which was safe only while
    // the filter was the sole way to reach a story: pick a reader story with the
    // filter on "All" and it silently generated a 10-question story quiz. Now the
    // filter only filters, and the mode is its own control — defaulted from the
    // selected story and overridable. The request body is unchanged.
    const generateMode = genMode === 'reader' ? 'reader' : 'story';
    setGenerating(true); setError(''); setMsg(''); setWarnings([]);
    try {
      // The Function derives the admin uid from this token and checks it against
      // QUIZ_ADMIN_UIDS. It no longer reads a uid from the body — sending one
      // would be inert, so it is not sent.
      const idToken = await user.getIdToken();
      const res = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ slug: selectedSlug, mode: generateMode }),
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
      // Mark quiz unavailable on the story card without losing counters or naming
      // state, and drop the index's quiz badge in the SAME atomic update (R1). The
      // index entry only exists for published stories, so guard on `indexed` — a
      // hidden story has no entry to patch (unhide rebuilds it from quizMeta).
      const indexed = allRows.find(st => st.slug === selectedSlug)?.indexed;
      await update(ref(db), {
        [`cms_stories/${selectedSlug}/quizMeta/hasQuiz`]: false,
        ...(indexed ? { [`cms_stories_index/${selectedSlug}/quiz`]: null } : {}),
      });
      try { localStorage.removeItem(LS_KEY); } catch {}
      // A quiz record now exists but the story no longer advertises it — the
      // picker's "Built · not shown" state, mirroring exactly what was written.
      setQuizSlugs(prev => new Set(prev).add(selectedSlug));
      setAdvertisedSlugs(prev => { const next = new Set(prev); next.delete(selectedSlug); return next; });
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

      // Atomic multi-location write: quiz node + story quizMeta cache + the index's
      // slim quiz badge (R1). buildQuizSummary keeps the index sub-object in lockstep
      // with the stories-admin projection. Guard on `indexed`: only published stories
      // have an index entry to patch (a hidden story's is rebuilt on unhide).
      const indexed = allRows.find(st => st.slug === selectedSlug)?.indexed;
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
        ...(indexed ? { [`cms_stories_index/${selectedSlug}/quiz`]: buildQuizSummary({ hasQuiz: true, scribblesReward: quiz.maxPoints ?? 50 }) } : {}),
      });
      try { localStorage.removeItem(LS_KEY); } catch {}
      setQuizSlugs(prev => new Set(prev).add(selectedSlug));
      setAdvertisedSlugs(prev => new Set(prev).add(selectedSlug));
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

  const allRows = useMemo(() => [...indexRows, ...hiddenRows], [indexRows, hiddenRows]);
  const rowsRef = useRef(allRows);
  rowsRef.current = allRows;

  // Quiz state and the whole filtered list come from app/lib/quizPicker.js, so
  // scripts/verify-quiz-picker.mjs exercises exactly this logic against the live
  // index. See that module for why "built" and "advertised" are separate answers.
  const quizStateOf = useMemo(
    () => slug => quizState(slug, { quizSlugs, advertisedSlugs, quizKeysOk }),
    [quizSlugs, advertisedSlugs, quizKeysOk]
  );

  const tokens = useMemo(() => tokenize(search), [search]);

  const { visible, quizCounts, catOptions, authorOptions } = useMemo(
    () => selectRows(allRows, { tokens, mode: modeFilter, cat: catFilter, author: authorFilter, quiz: quizFilter, sort: sortBy }, quizStateOf),
    [allRows, tokens, modeFilter, catFilter, authorFilter, quizFilter, sortBy, quizStateOf]
  );

  const selectedRow = allRows.find(r => r.slug === selectedSlug) || null;
  const filtersActive = !!search || modeFilter !== 'all' || quizFilter !== 'all' || catFilter !== 'all' || authorFilter !== 'all';

  function clearFilters() {
    setSearch(''); setModeFilter('all'); setQuizFilter('all'); setCatFilter('all'); setAuthorFilter('all');
    if (searchRef.current) searchRef.current.focus();
  }

  // The generation mode follows the story you picked; an explicit change survives
  // until the next selection.
  useEffect(() => {
    const r = rowsRef.current.find(x => x.slug === selectedSlug);
    setGenMode(r && r.reader ? 'reader' : 'story');
  }, [selectedSlug]);

  // Reader-mode quizzes are built from extractedText, which the index deliberately
  // excludes. Rather than reload cms_stories for it, probe the reader slugs' KEYS
  // (~300 B each, and only the reader stories) the first time reader mode is in
  // play, so the "run extraction" warning survives the switch to the slim source.
  const probedRef = useRef(false);
  useEffect(() => {
    if (probedRef.current || loadingData) return;
    const sel = rowsRef.current.find(x => x.slug === selectedSlug);
    if (modeFilter !== 'reader' && !(sel && sel.reader)) return;
    const readers = rowsRef.current.filter(r => r.reader);
    if (!readers.length) return;
    probedRef.current = true;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(readers.map(async r => {
        try {
          const res = await fetch(`${DB_URL}/cms_stories/${r.slug}.json?shallow=true`);
          if (!res.ok) return null;
          const keys = await res.json();
          return keys && keys.extractedText ? null : r.slug;
        } catch { return null; }
      }));
      if (!cancelled) setExtractMissing(results.filter(Boolean));
    })();
    return () => { cancelled = true; };
  }, [modeFilter, selectedSlug, loadingData]);

  // Focus the search on mount — this page is opened to look something up.
  useEffect(() => {
    if (!loadingData && searchRef.current) searchRef.current.focus();
  }, [loadingData]);

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
            <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'rgba(255,255,255,0.3)', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
              Generate, review and publish AI-assisted comprehension quizzes
            </div>
          </div>
        </div>

        {/* Story picker */}
        <div style={s.card}>
          <div style={{ marginBottom: '0.85rem', position: 'relative' }}>
            <label style={s.label}>Search</label>
            <input
              ref={searchRef}
              style={s.search}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); setSearch(''); }
                if (e.key === 'Enter' && visible.length === 1 && !busy) { e.preventDefault(); setSelectedSlug(visible[0].slug); }
              }}
              placeholder="Title or author — Esc clears"
              spellCheck={false}
              autoComplete="off"
            />
            {search && (
              <button
                onClick={() => { setSearch(''); if (searchRef.current) searchRef.current.focus(); }}
                title="Clear search (Esc)"
                style={{ position: 'absolute', right: 10, bottom: 10, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '1.05rem', cursor: 'pointer', lineHeight: 1, padding: 0 }}
              >×</button>
            )}
          </div>

          <div style={{ marginBottom: '0.85rem' }}>
            <label style={s.label}>Quiz state</label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {[
                ['all', 'All', quizCounts.all],
                ['none', 'No quiz yet', quizCounts.none],
                ['has', 'Has quiz', quizCounts.has],
              ].map(([f, labelText, n]) => (
                <button key={f} style={filterBtn(quizFilter === f)} onClick={() => setQuizFilter(f)}>
                  {labelText} ({n})
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '0.85rem' }}>
            <label style={s.label}>Story type</label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {['all', 'story', 'reader'].map(f => (
                <button key={f} style={filterBtn(modeFilter === f)} onClick={() => setModeFilter(f)}>
                  {f === 'all' ? 'All' : f === 'story' ? 'Story page' : 'Book reader'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
            <div>
              <label style={s.labelDim}>Category</label>
              <select style={s.selectSm} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                <option value="all">All categories</option>
                {catOptions.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
              </select>
            </div>
            <div>
              <label style={s.labelDim}>Author</label>
              <select style={s.selectSm} value={authorFilter} onChange={e => setAuthorFilter(e.target.value)}>
                <option value="all">All authors</option>
                {authorOptions.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
              </select>
            </div>
            <div>
              <label style={s.labelDim}>Sort</label>
              <select style={s.selectSm} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="title">Title A–Z</option>
              </select>
            </div>
          </div>

          <div style={s.countLine}>
            <span style={s.meta}>
              {loadingData ? 'Loading stories…' : `${visible.length} of ${allRows.length} stor${allRows.length === 1 ? 'y' : 'ies'}`}
            </span>
            {filtersActive && !loadingData && <button style={s.linkBtn} onClick={clearFilters}>Clear filters</button>}
          </div>

          {!loadingData && (
            <div style={s.listBox}>
              {visible.length === 0 ? (
                <div style={s.empty}>
                  <div style={{ marginBottom: '0.6rem' }}>No stories match{search ? <> “{search}”</> : null}.</div>
                  <button style={s.btnGhost} onClick={clearFilters}>Clear filters</button>
                </div>
              ) : visible.map(st => {
                const badge = BADGE[quizStateOf(st.slug)];
                return (
                  <button
                    key={st.slug}
                    onClick={() => setSelectedSlug(st.slug)}
                    disabled={busy}
                    style={{ ...row(st.slug === selectedSlug), opacity: busy ? 0.55 : 1 }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.95rem', fontWeight: 600, color: st.slug === selectedSlug ? '#c4b5fd' : '#e8e8e8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {st.title}
                      </span>
                      <span style={{ ...s.meta, display: 'block', marginTop: 2 }}>
                        {st.author || 'Unknown'} · {st.date || 'undated'}{st.categoryName ? ` · ${st.categoryName}` : ''}
                        {st.reader ? ' · Book reader' : ''}
                        {!st.indexed ? ' · Unpublished' : ''}
                      </span>
                    </span>
                    <span title={badge.title} style={{ ...badge.style, flexShrink: 0, borderRadius: 4, padding: '0.15rem 0.5rem', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
                      {badge.text}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!loadingData && hiddenSlugs.length > 0 && hiddenRows.length === 0 && (
            <div style={{ ...s.hint, marginTop: '0.6rem' }}>
              {hiddenSlugs.length} unpublished stor{hiddenSlugs.length === 1 ? 'y is' : 'ies are'} not listed — they have no entry in the slim index.{' '}
              <button style={s.linkBtn} onClick={loadUnpublished} disabled={loadingHidden}>
                {loadingHidden ? 'Loading…' : 'Load them'}
              </button>
            </div>
          )}

          {modeFilter === 'reader' && !loadingData && (
            <div style={{ ...s.hint, marginTop: '0.6rem' }}>
              Reader-mode quizzes are 15 MCQs + 3 essays, sourced from extracted EPUB text. Worth up to 100 Scribbles.
            </div>
          )}
          {extractMissing && extractMissing.length > 0 && (
            <div style={{ ...s.warn, marginTop: '0.6rem', marginBottom: 0, fontSize: '0.78rem' }}>
              {extractMissing.length} reader stor{extractMissing.length === 1 ? 'y has' : 'ies have'} an EPUB but no extracted text yet.
              {' '}<a href="/admin/extract-text" style={{ color: '#fcd34d', textDecoration: 'underline' }}>Run extraction →</a>
            </div>
          )}

          {/* Selection + generate */}
          <div style={{ borderTop: '1px solid #242424', marginTop: '1rem', paddingTop: '1rem' }}>
            {selectedSlug ? (
              <>
                <div style={{ ...s.countLine, marginBottom: '0.7rem' }}>
                  <span style={{ fontSize: '0.95rem', color: '#fff', fontWeight: 600 }}>
                    {selectedRow ? selectedRow.title : selectedSlug}
                  </span>
                  <button style={s.linkBtn} onClick={() => { setSelectedSlug(''); setQuiz(null); setMsg(''); setError(''); setWarnings([]); }} disabled={busy}>
                    Clear selection
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    style={{ ...s.btn, opacity: busy ? 0.5 : 1 }}
                    disabled={busy}
                    onClick={handleGenerate}
                  >
                    {generating ? (
                      <><span style={s.spinner} />Generating quiz… (~30s)</>
                    ) : quiz ? 'Regenerate' : 'Generate Quiz'}
                  </button>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <span style={s.meta}>as</span>
                    {[['story', 'Story page · 10+2'], ['reader', 'Book reader · 15+3']].map(([m, labelText]) => (
                      <button key={m} style={filterBtn(genMode === m)} onClick={() => setGenMode(m)} disabled={busy}>
                        {labelText}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div style={s.meta}>Select a story above to generate or edit its quiz.</div>
            )}
          </div>
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
              <div style={{ ...s.card, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontWeight: 500, fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '0.9rem', cursor: 'pointer' }} onClick={() => setMcqsCollapsed(false)}>
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
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.25)', padding: '3rem 0', fontSize: '0.88rem', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>
            No quiz yet for this story. Hit 'Generate Quiz' to create one.
          </div>
        )}
      </div>
    </div>
  );
}
