'use client';
import { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { extractEpubFromUrl } from '../../lib/epubExtract';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header: { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  body: { maxWidth: 860, margin: '0 auto', padding: '2.5rem 2rem' },
  btn: { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.45rem 0.9rem', borderRadius: 6, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  card: { background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' },
  title: { fontSize: '0.92rem', fontWeight: 700, color: '#fff', marginBottom: 3 },
  meta: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif' },
  status: { fontSize: '0.72rem', fontFamily: 'Inter, sans-serif', minWidth: 120, textAlign: 'right' },
  statusOK: { color: '#6ee7b7' },
  statusErr: { color: '#f87171' },
  statusBusy: { color: '#a78bfa' },
  empty: { textAlign: 'center', color: 'rgba(255,255,255,0.3)', padding: '3rem 0', fontFamily: 'Inter, sans-serif' },
  msg: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#c4b5fd', marginBottom: '1.25rem', fontFamily: 'Inter, sans-serif' },
  topActions: { display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', alignItems: 'center', flexWrap: 'wrap' },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
};

function StatusBadge({ status }) {
  if (status?.state === 'done') return <span style={{ ...s.status, ...s.statusOK }}>✓ {status.length.toLocaleString()} chars</span>;
  if (status?.state === 'busy') return <span style={{ ...s.status, ...s.statusBusy }}>Extracting…</span>;
  if (status?.state === 'error') return <span style={{ ...s.status, ...s.statusErr }} title={status.error}>✗ Failed</span>;
  return null;
}

export default function ExtractTextPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user && (user.uid === 'GfXFIc0dThZ1cs2SBBQIFao4aSz1' || (user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()));

  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    loadStories();
  }, [isAdmin]);

  async function loadStories() {
    setLoading(true);
    try {
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, 'cms_stories'));
      if (snap.exists()) {
        const data = snap.val();
        const list = Object.entries(data)
          .map(([slug, st]) => ({
            slug,
            title: st.title || slug,
            author: st.author || '',
            epubUrl: st.epubUrl || '',
            extractedLength: (st.extractedText || '').length,
          }))
          .filter(st => st.epubUrl)
          .sort((a, b) => a.title.localeCompare(b.title));
        setStories(list);
      }
    } catch (e) {
      alert('Failed to load stories: ' + e.message);
    }
    setLoading(false);
  }

  async function extractOne(slug) {
    const story = stories.find(s => s.slug === slug);
    if (!story) return;
    setStatuses(prev => ({ ...prev, [slug]: { state: 'busy' } }));
    try {
      const text = await extractEpubFromUrl(story.epubUrl);
      const { ref, update } = await import('firebase/database');
      await update(ref(db, `cms_stories/${slug}`), { extractedText: text });
      setStatuses(prev => ({ ...prev, [slug]: { state: 'done', length: text.length } }));
      setStories(prev => prev.map(s => s.slug === slug ? { ...s, extractedLength: text.length } : s));
    } catch (e) {
      console.error('[extract-text]', slug, e);
      setStatuses(prev => ({ ...prev, [slug]: { state: 'error', error: e.message } }));
    }
  }

  async function extractAllMissing() {
    if (batchRunning) return;
    setBatchRunning(true);
    const missing = stories.filter(st => st.extractedLength < 500);
    for (const st of missing) {
      await extractOne(st.slug);
    }
    setBatchRunning(false);
  }

  if (authLoading) return <div style={s.gate}>Loading…</div>;
  if (!isAdmin) return (
    <div style={s.gate}>
      <div style={{ color: '#f87171', fontWeight: 700, fontSize: '1rem' }}>Access Denied</div>
      <a href="/" style={{ color: '#a78bfa', fontSize: '0.82rem', textDecoration: 'none' }}>← Back to site</a>
    </div>
  );

  const missingCount = stories.filter(st => st.extractedLength < 500).length;
  const visible = showAll ? stories : stories.filter(st => st.extractedLength < 500);

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={s.sub}>EPUB Text Extraction</div>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <a href="/admin/quizzes" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← Quiz Builder</a>
          <a href="/admin" style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>← CMS</a>
        </div>
      </header>

      <div style={s.body}>
        <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: '0 0 0.5rem' }}>EPUB Text Extraction</h2>
        <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter, sans-serif', marginBottom: '1.5rem' }}>
          Pull plain text from uploaded EPUBs into <code style={{ color: '#c4b5fd' }}>cms_stories/&lt;slug&gt;/extractedText</code>. Required before reader-mode quizzes can be generated.
        </div>

        <div style={s.msg}>
          {loading ? 'Loading…' : `${stories.length} stor${stories.length === 1 ? 'y has' : 'ies have'} an EPUB. ${missingCount} need${missingCount === 1 ? 's' : ''} extraction.`}
        </div>

        <div style={s.topActions}>
          <button style={{ ...s.btn, opacity: (missingCount === 0 || batchRunning) ? 0.5 : 1 }}
            disabled={missingCount === 0 || batchRunning}
            onClick={extractAllMissing}>
            {batchRunning ? 'Extracting…' : `Extract all (${missingCount})`}
          </button>
          <button style={s.btnGhost} onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Show only missing' : 'Show all'}
          </button>
        </div>

        {!loading && visible.length === 0 && (
          <div style={s.empty}>
            {missingCount === 0 ? '✓ All EPUBs have extracted text.' : 'No stories to show.'}
          </div>
        )}

        {visible.map(st => (
          <div key={st.slug} style={s.card}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={s.title}>{st.title}</div>
              <div style={s.meta}>
                {st.author} · {st.extractedLength >= 500
                  ? `${st.extractedLength.toLocaleString()} chars on file`
                  : st.extractedLength > 0
                    ? `${st.extractedLength} chars (too short — re-extract)`
                    : 'no extracted text'}
              </div>
            </div>
            <StatusBadge status={statuses[st.slug]} />
            <button style={s.btnGhost}
              disabled={statuses[st.slug]?.state === 'busy' || batchRunning}
              onClick={() => extractOne(st.slug)}>
              {st.extractedLength >= 500 ? 'Re-extract' : 'Extract'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
