'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { getAllPublishers, getTitlesByPublisher } from '../../lib/bookstore/loader';
import {
  createTitle,
  updateTitle,
  setTitleStatus,
  uploadCover,
  uploadEpub,
} from '../../lib/bookstore/admin-writes';
import { GENRES, TITLE_STATUSES } from '../../lib/bookstore/schema';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COMMON_TERRITORIES = ['GB', 'NG', 'US', 'CA', 'AU', 'ZA', 'IE', 'NZ'];
const TITLES_PATH = 'bookstore_titles';

const GENRE_OPTIONS = GENRES.map((g) => ({ value: g, label: g.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join(' ') }));

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function formatGbpMinor(minor) {
  if (typeof minor !== 'number') return '—';
  return `£${(minor / 100).toFixed(2)}`;
}

function minorToMajor(minor) {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return '';
  return (minor / 100).toFixed(2);
}

function majorToMinor(major) {
  if (major === '' || major === null || major === undefined) return null;
  const n = Number(major);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header: { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' },
  logo: { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  headerLinks: { display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' },
  body: { maxWidth: 1080, margin: '0 auto', padding: '2.5rem 2rem' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' },
  h2: { fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: 0 },
  h2sub: { fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  section: { background: '#141414', border: '1px solid #242424', borderRadius: 10, padding: '1.5rem', marginBottom: '1.25rem' },
  sectionTitle: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#c4b5fd', marginBottom: '1.1rem' },
  btn: { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDanger: { background: 'rgba(220,38,38,0.12)', color: '#f87171', border: '1px solid rgba(220,38,38,0.25)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnSm: { background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.3)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, background: '#171717', border: '1px solid #242424', borderRadius: 10, overflow: 'hidden' },
  th: { textAlign: 'left', padding: '0.85rem 1rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid #2a2a2a', background: '#141414' },
  td: { padding: '0.95rem 1rem', fontSize: '0.86rem', color: '#fff', borderBottom: '1px solid #1f1f1f', verticalAlign: 'middle' },
  tdMuted: { color: 'rgba(255,255,255,0.5)' },
  thumb: { width: 40, height: 60, objectFit: 'cover', borderRadius: 3, background: '#2a2a2a' },
  pill: { display: 'inline-block', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.18rem 0.55rem', borderRadius: 12, border: '1px solid' },
  empty: { background: '#171717', border: '1px dashed #2e2e2e', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: 'rgba(255,255,255,0.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' },
  filtersRow: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' },
  filterFg: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  filterLabel: { fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)' },
  fg: { display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  label: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa' },
  labelSoft: { fontWeight: 400, color: 'rgba(255,255,255,0.35)', textTransform: 'none', letterSpacing: 0 },
  input: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  inputErr: { borderColor: 'rgba(220,38,38,0.55)' },
  textarea: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 110, resize: 'vertical', lineHeight: 1.55 },
  textareaTall: { minHeight: 200 },
  select: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.1rem' },
  row3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.1rem' },
  hint: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 },
  hintWarn: { fontSize: '0.7rem', color: '#fcd34d', lineHeight: 1.5 },
  hintGreen: { fontSize: '0.7rem', color: '#86efac', lineHeight: 1.5 },
  errorBox: { background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 6, padding: '0.85rem 1rem', color: '#fca5a5', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1.25rem' },
  formActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', padding: '0.5rem 0' },
  toast: { position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)', background: '#171717', border: '1px solid #2a2a2a', borderRadius: 8, padding: '0.85rem 1.4rem', color: '#86efac', fontSize: '0.85rem', fontWeight: 600, boxShadow: '0 12px 32px rgba(0,0,0,0.6)', zIndex: 1000 },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  radioGroup: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
  radioOption: { display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.88rem', color: '#e8e8e8' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(124,58,237,0.18)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.4)', borderRadius: 999, padding: '0.3rem 0.75rem', fontSize: '0.72rem', fontWeight: 600, fontFamily: 'monospace' },
  chipX: { background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem', padding: 0, lineHeight: 1 },
  chipsWrap: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', minHeight: '2rem', alignItems: 'center', padding: '0.4rem', background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6 },
  chipInput: { flex: 1, minWidth: '80px', background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontFamily: 'inherit', fontSize: '0.85rem' },
  fileBlock: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  fileRow: { display: 'flex', gap: '0.6rem', alignItems: 'center' },
  fileMeta: { fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)' },
  progressBar: { height: 4, background: '#2a2a2a', borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', background: 'linear-gradient(90deg, #7c3aed, #a855f7)', transition: 'width 0.2s' },
  checkbox: { display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.88rem', cursor: 'pointer', color: '#e8e8e8' },
};

function statusPill(status) {
  if (status === 'published') return { ...s.pill, color: '#86efac', borderColor: 'rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)' };
  if (status === 'draft') return { ...s.pill, color: '#fcd34d', borderColor: 'rgba(217,119,6,0.4)', background: 'rgba(217,119,6,0.1)' };
  if (status === 'unpublished') return { ...s.pill, color: 'rgba(255,255,255,0.55)', borderColor: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)' };
  return { ...s.pill, color: 'rgba(255,255,255,0.6)', borderColor: 'rgba(255,255,255,0.2)' };
}

const emptyForm = {
  title: '',
  author: '',
  publisherId: '',
  slug: '',
  isbn: '',
  genre: GENRES[0],
  tagsRaw: '',
  pageCount: '',
  publishedDate: '',
  synopsis: '',
  excerpt: '',
  priceGbp: '',
  priceNgn: '',
  priceUsd: '',
  territoriesMode: 'worldwide', // 'worldwide' | 'specific'
  territoriesList: [],
  coverFile: null,
  coverUrl: '',          // existing URL when editing
  epubFile: null,
  epubPath: '',          // existing path when editing
  status: 'draft',
  featured: false,
  bestseller: false,
};

export default function AdminBookstorePage() {
  const { user } = useAuth();
  const [view, setView] = useState('list');
  const [titles, setTitles] = useState([]);
  const [publishers, setPublishers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [toast, setToast] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [coverProgress, setCoverProgress] = useState(null);
  const [epubProgress, setEpubProgress] = useState(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPublisher, setFilterPublisher] = useState('all');
  const [filterGenre, setFilterGenre] = useState('all');

  const isAdmin = user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const activePublishers = useMemo(() => publishers.filter((p) => p.status === 'active'), [publishers]);
  const publisherById = useMemo(() => {
    const m = {};
    publishers.forEach((p) => { m[p.slug] = p; });
    return m;
  }, [publishers]);

  useEffect(() => {
    if (!isAdmin) return;
    loadAll();
  }, [isAdmin]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pubList] = await Promise.all([getAllPublishers()]);
      pubList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setPublishers(pubList);
      // Read all titles for admin (status-agnostic). We bypass loader filters by reading directly.
      const { ref, get } = await import('firebase/database');
      const { db } = await import('../../lib/firebase');
      const snap = await get(ref(db, TITLES_PATH));
      const out = [];
      if (snap.exists()) {
        snap.forEach((child) => { out.push({ id: child.key, ...child.val() }); return false; });
      }
      out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setTitles(out);
    } catch (e) {
      console.error('[admin/bookstore] load failed', e);
    }
    setLoading(false);
  }

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(''), 1500);
  }

  function openNew() {
    setForm(emptyForm);
    setEditingTitleId(null);
    setErrors([]);
    setCoverProgress(null);
    setEpubProgress(null);
    setView('new');
  }

  function openEdit(title) {
    setForm({
      title: title.title || '',
      author: title.author || '',
      publisherId: title.publisherId || '',
      slug: title.slug || title.id || '',
      isbn: title.isbn || '',
      genre: title.genre || GENRES[0],
      tagsRaw: Array.isArray(title.tags) ? title.tags.join(', ') : '',
      pageCount: typeof title.pageCount === 'number' ? String(title.pageCount) : '',
      publishedDate: title.publishedDate || '',
      synopsis: title.synopsis || '',
      excerpt: title.excerpt || '',
      priceGbp: minorToMajor(title.prices?.gbp),
      priceNgn: minorToMajor(title.prices?.ngn),
      priceUsd: minorToMajor(title.prices?.usd),
      territoriesMode: title.territoriesAllowed === '*' ? 'worldwide' : 'specific',
      territoriesList: Array.isArray(title.territoriesAllowed) ? title.territoriesAllowed : [],
      coverFile: null,
      coverUrl: title.coverUrl || '',
      epubFile: null,
      epubPath: title.epubPath || '',
      status: title.status || 'draft',
      featured: !!title.featured,
      bestseller: !!title.bestseller,
    });
    setEditingTitleId(title.id);
    setErrors([]);
    setCoverProgress(null);
    setEpubProgress(null);
    setView('edit');
  }

  function handleCancel() {
    setView('list');
    setErrors([]);
  }

  function handleTitleBlur() {
    if (!form.slug.trim() && form.title.trim()) {
      const pub = publisherById[form.publisherId];
      const prefix = pub?.slug ? `${pub.slug}-` : '';
      setForm((f) => ({ ...f, slug: prefix + slugify(f.title) }));
    }
  }

  function buildPayload() {
    const prices = {};
    const gbp = majorToMinor(form.priceGbp);
    const ngn = majorToMinor(form.priceNgn);
    const usd = majorToMinor(form.priceUsd);
    if (gbp !== null) prices.gbp = gbp;
    if (ngn !== null) prices.ngn = ngn;
    if (usd !== null) prices.usd = usd;

    const tags = form.tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const territoriesAllowed = form.territoriesMode === 'worldwide' ? '*' : form.territoriesList;

    const payload = {
      title: form.title.trim(),
      author: form.author.trim(),
      publisherId: form.publisherId,
      slug: form.slug.trim(),
      genre: form.genre,
      publishedDate: form.publishedDate,
      synopsis: form.synopsis.trim(),
      prices,
      territoriesAllowed,
      status: form.status,
      featured: form.featured,
      bestseller: form.bestseller,
    };

    if (form.isbn.trim()) payload.isbn = form.isbn.trim();
    if (form.excerpt.trim()) payload.excerpt = form.excerpt.trim();
    if (tags.length) payload.tags = tags;
    if (form.pageCount && Number.isInteger(Number(form.pageCount))) payload.pageCount = Number(form.pageCount);
    if (form.coverUrl) payload.coverUrl = form.coverUrl;
    if (form.epubPath) payload.epubPath = form.epubPath;

    return payload;
  }

  async function handleSave() {
    setSaving(true);
    setErrors([]);
    const local = [];

    if (!form.title.trim()) local.push('Title is required');
    if (!form.author.trim()) local.push('Author is required');
    if (!form.publisherId) local.push('Publisher is required');
    if (!form.publishedDate) local.push('Published date is required');
    if (!form.synopsis.trim()) local.push('Synopsis is required');
    if (form.slug && !SLUG_RE.test(form.slug)) local.push('Slug must be kebab-case');
    if (!form.priceGbp && !form.priceNgn && !form.priceUsd) local.push('Enter at least one price (GBP, NGN, or USD)');
    if (form.territoriesMode === 'specific' && form.territoriesList.length === 0) {
      local.push('Add at least one territory, or switch to Worldwide');
    }
    // Schema v2: cover + EPUB required only for status === 'published'. Drafts and unpublished
    // titles may save with null assets.
    if (form.status === 'published') {
      if (!form.coverFile && !form.coverUrl) local.push('A cover image is required to publish');
      if (!form.epubFile && !form.epubPath) local.push('An EPUB is required to publish');
    }

    if (local.length > 0) {
      setErrors(local);
      setSaving(false);
      return;
    }

    // titleId: from slug. For new titles we need it before any upload; for edits it's editingTitleId.
    const titleId = editingTitleId || (form.slug.trim() || slugify(form.title));
    if (!titleId) {
      setErrors(['Could not derive a title id from the form']);
      setSaving(false);
      return;
    }

    let nextCoverUrl = form.coverUrl;
    let nextEpubPath = form.epubPath;

    // Upload cover first (cheaper to retry, public-readable). If it fails, abort before EPUB upload
    // and before the title doc write — no orphaned title rows pointing at missing storage.
    if (form.coverFile) {
      setCoverProgress(0);
      const cov = await uploadCover(titleId, form.coverFile, (p) => setCoverProgress(p));
      if (!cov.ok) {
        setErrors(cov.errors);
        setSaving(false);
        setCoverProgress(null);
        return;
      }
      nextCoverUrl = cov.url;
      setCoverProgress(100);
    }

    if (form.epubFile) {
      setEpubProgress(0);
      const ep = await uploadEpub(titleId, form.epubFile, (p) => setEpubProgress(p));
      if (!ep.ok) {
        // Cover may have already uploaded — that's fine, it'll be overwritten on next attempt.
        // But we don't write a title doc with missing EPUB path, so refuse and surface the error.
        setErrors([...ep.errors, 'Cover may have uploaded; EPUB did not. Re-upload both on next attempt.']);
        setSaving(false);
        setEpubProgress(null);
        return;
      }
      nextEpubPath = ep.path;
      setEpubProgress(100);
    }

    const payload = buildPayload();
    if (nextCoverUrl) payload.coverUrl = nextCoverUrl;
    if (nextEpubPath) payload.epubPath = nextEpubPath;

    const result = editingTitleId
      ? await updateTitle(editingTitleId, payload)
      : await createTitle(payload);

    setSaving(false);
    setCoverProgress(null);
    setEpubProgress(null);

    if (!result.ok) {
      setErrors(result.errors || ['Save failed']);
      return;
    }

    showToast(editingTitleId ? 'Title updated' : 'Title created');
    setView('list');
    setForm(emptyForm);
    setEditingTitleId(null);
    loadAll();
  }

  async function handleQuickStatus(title, nextStatus) {
    const result = await setTitleStatus(title.id, nextStatus);
    if (!result.ok) {
      alert((result.errors || ['Status change failed']).join('\n'));
      return;
    }
    showToast(`Title ${nextStatus}`);
    loadAll();
  }

  // Filtered list for the table view.
  const filteredTitles = useMemo(() => {
    return titles.filter((t) => {
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (filterPublisher !== 'all' && t.publisherId !== filterPublisher) return false;
      if (filterGenre !== 'all' && t.genre !== filterGenre) return false;
      return true;
    });
  }, [titles, filterStatus, filterPublisher, filterGenre]);

  if (!user) {
    return (
      <div style={s.gate}>
        <div style={{ fontSize: '1.1rem', color: '#a78bfa', fontWeight: 700 }}>Calvary Scribblings CMS</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.88rem' }}>Sign in to access the CMS.</div>
        <a href="/" style={{ color: '#c4b5fd', fontSize: '0.82rem' }}>← Back to site</a>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={s.gate}>
        <div style={{ fontSize: '1.1rem', color: '#f87171', fontWeight: 700 }}>Not authorised</div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.88rem' }}>This area is restricted.</div>
        <a href="/" style={{ color: '#c4b5fd', fontSize: '0.82rem' }}>← Back to site</a>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={s.sub}>Bookstore</div>
        </div>
        <div style={s.headerLinks}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>{user.email}</span>
          <a href="/admin/publishers" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>Publishers →</a>
          <a href="/admin" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← Admin</a>
        </div>
      </header>
      <div style={s.body}>
        {(view === 'new' || view === 'edit') && (
          <TitleForm
            form={form}
            setForm={setForm}
            editingTitleId={editingTitleId}
            saving={saving}
            errors={errors}
            publishers={activePublishers}
            coverProgress={coverProgress}
            epubProgress={epubProgress}
            onSave={handleSave}
            onCancel={handleCancel}
            onTitleBlur={handleTitleBlur}
          />
        )}
        {view === 'list' && (
          <div>
            <div style={s.topBar}>
              <div>
                <h2 style={s.h2}>Titles</h2>
                <div style={s.h2sub}>{titles.length} on file · {filteredTitles.length} shown</div>
              </div>
              {publishers.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: '#fcd34d' }}>
                  Add a publisher first → <a href="/admin/publishers" style={{ color: '#fcd34d', textDecoration: 'underline' }}>/admin/publishers</a>
                </div>
              ) : titles.length > 0 && (
                <button style={s.btn} onClick={openNew} type="button">+ Add title</button>
              )}
            </div>

            {titles.length > 0 && (
              <div style={s.filtersRow}>
                <div style={s.filterFg}>
                  <label style={s.filterLabel}>Status</label>
                  <select style={s.select} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="all">All</option>
                    {TITLE_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
                <div style={s.filterFg}>
                  <label style={s.filterLabel}>Publisher</label>
                  <select style={s.select} value={filterPublisher} onChange={(e) => setFilterPublisher(e.target.value)}>
                    <option value="all">All</option>
                    {activePublishers.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                  </select>
                </div>
                <div style={s.filterFg}>
                  <label style={s.filterLabel}>Genre</label>
                  <select style={s.select} value={filterGenre} onChange={(e) => setFilterGenre(e.target.value)}>
                    <option value="all">All</option>
                    {GENRE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            {loading
              ? <div style={s.empty}>Loading titles…</div>
              : titles.length === 0
                ? (
                  <div style={s.empty}>
                    <div style={{ fontSize: '1rem', color: '#fff', fontWeight: 600 }}>No titles yet.</div>
                    <div style={{ fontSize: '0.85rem' }}>Add your first.</div>
                    {publishers.length > 0 && <button style={s.btn} onClick={openNew} type="button">+ Add title</button>}
                  </div>
                )
                : filteredTitles.length === 0
                  ? <div style={s.empty}>No titles match the current filters.</div>
                  : (
                    <table style={s.table}>
                      <thead>
                        <tr>
                          <th style={s.th}>Cover</th>
                          <th style={s.th}>Title</th>
                          <th style={s.th}>Author</th>
                          <th style={s.th}>Publisher</th>
                          <th style={s.th}>Status</th>
                          <th style={{ ...s.th, textAlign: 'right' }}>Price (GBP)</th>
                          <th style={{ ...s.th, textAlign: 'right' }}>Sales</th>
                          <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTitles.map((t) => {
                          const pub = publisherById[t.publisherId];
                          return (
                            <tr key={t.id}>
                              <td style={s.td}>
                                {t.coverUrl
                                  ? <img src={t.coverUrl} alt="" style={s.thumb} onError={(e) => { e.target.style.opacity = 0.2; }} />
                                  : <div style={{ ...s.thumb, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.6rem' }}>none</div>
                                }
                              </td>
                              <td style={s.td}><strong>{t.title}</strong></td>
                              <td style={{ ...s.td, ...s.tdMuted }}>{t.author}</td>
                              <td style={{ ...s.td, ...s.tdMuted, fontSize: '0.82rem' }}>{pub?.name || t.publisherId}</td>
                              <td style={s.td}><span style={statusPill(t.status)}>{t.status}</span></td>
                              <td style={{ ...s.td, textAlign: 'right' }}>{formatGbpMinor(t.prices?.gbp)}</td>
                              <td style={{ ...s.td, textAlign: 'right' }}>{t.salesCount ?? 0}</td>
                              <td style={{ ...s.td, textAlign: 'right' }}>
                                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                  <button style={s.btnSm} type="button" onClick={() => openEdit(t)}>Edit</button>
                                  {t.status === 'published'
                                    ? <button style={s.btnDanger} type="button" onClick={() => handleQuickStatus(t, 'unpublished')}>Unpublish</button>
                                    : t.status === 'draft' || t.status === 'unpublished'
                                      ? <button style={s.btnSm} type="button" onClick={() => handleQuickStatus(t, 'published')} title="Publish (cover + EPUB must already be set)">Publish</button>
                                      : null
                                  }
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )
            }
          </div>
        )}
      </div>
      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}

function TitleForm({ form, setForm, editingTitleId, saving, errors, publishers, coverProgress, epubProgress, onSave, onCancel, onTitleBlur }) {
  const slugInvalid = form.slug && !SLUG_RE.test(form.slug);

  function handleAddTerritory(code) {
    const v = (code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(v)) return;
    if (form.territoriesList.includes(v)) return;
    setForm((f) => ({ ...f, territoriesList: [...f.territoriesList, v] }));
  }
  function handleRemoveTerritory(code) {
    setForm((f) => ({ ...f, territoriesList: f.territoriesList.filter((c) => c !== code) }));
  }

  return (
    <div>
      <div style={s.topBar}>
        <div>
          <h2 style={s.h2}>{editingTitleId ? 'Edit Title' : 'New Title'}</h2>
          <div style={s.h2sub}>
            {editingTitleId ? `Editing ${editingTitleId}` : 'Drafts can be saved without cover or EPUB. Both required to publish.'}
          </div>
        </div>
        <button style={s.btnGhost} onClick={onCancel} type="button">← Back</button>
      </div>

      {errors.length > 0 && (
        <div style={s.errorBox}>
          <div style={{ fontWeight: 700, color: '#f87171' }}>Please fix the following:</div>
          {errors.map((e, i) => <div key={i}>· {e}</div>)}
        </div>
      )}

      {/* a. METADATA */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Metadata</div>
        <div style={s.row2}>
          <div style={s.fg}>
            <label style={s.label}>Title</label>
            <input style={s.input} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} onBlur={onTitleBlur} placeholder="e.g. Love Letters" />
          </div>
          <div style={s.fg}>
            <label style={s.label}>Author</label>
            <input style={s.input} value={form.author} onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))} placeholder="Display name" />
            <div style={s.hint}>Display name. Pen names allowed.</div>
          </div>
        </div>

        <div style={{ ...s.row2, marginTop: '1.1rem' }}>
          <div style={s.fg}>
            <label style={s.label}>Publisher</label>
            <select
              style={s.select}
              value={form.publisherId}
              disabled={!!editingTitleId}
              onChange={(e) => setForm((f) => ({ ...f, publisherId: e.target.value }))}
            >
              <option value="">— select a publisher —</option>
              {publishers.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
            <div style={s.hint}>{publishers.length === 0
              ? <>No active publisher? Create one in <a href="/admin/publishers" style={{ color: '#a78bfa' }}>/admin/publishers</a> first.</>
              : editingTitleId
                ? 'Publisher cannot be reassigned after creation. Use the Firebase Console for edge cases.'
                : 'Only active publishers are listed.'
            }</div>
          </div>
          <div style={s.fg}>
            <label style={s.label}>Slug</label>
            <input
              style={{ ...s.input, ...(slugInvalid ? s.inputErr : {}) }}
              value={form.slug}
              disabled={!!editingTitleId}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="auto-generated as {publisher}-{title}"
            />
            {editingTitleId
              ? <div style={s.hint}>Slug is fixed once a title is created.</div>
              : slugInvalid
                ? <div style={s.hintWarn}>Slug must be kebab-case.</div>
                : <div style={s.hint}>Auto-fills as publisher-prefixed kebab-case on title blur. Edit to override.</div>
            }
          </div>
        </div>

        <div style={{ ...s.row2, marginTop: '1.1rem' }}>
          <div style={s.fg}>
            <label style={s.label}>ISBN <span style={s.labelSoft}>(optional)</span></label>
            <input style={s.input} value={form.isbn} onChange={(e) => setForm((f) => ({ ...f, isbn: e.target.value }))} placeholder="978-1-..." />
          </div>
          <div style={s.fg}>
            <label style={s.label}>Genre</label>
            <select style={s.select} value={form.genre} onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}>
              {GENRE_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ ...s.row2, marginTop: '1.1rem' }}>
          <div style={s.fg}>
            <label style={s.label}>Tags <span style={s.labelSoft}>(optional, comma-separated)</span></label>
            <input style={s.input} value={form.tagsRaw} onChange={(e) => setForm((f) => ({ ...f, tagsRaw: e.target.value }))} placeholder="romance, epistolary" />
          </div>
          <div style={s.fg}>
            <label style={s.label}>Page count <span style={s.labelSoft}>(optional)</span></label>
            <input style={s.input} type="number" min={1} step={1} value={form.pageCount} onChange={(e) => setForm((f) => ({ ...f, pageCount: e.target.value }))} placeholder="e.g. 280" />
          </div>
        </div>

        <div style={{ marginTop: '1.1rem', ...s.fg }}>
          <label style={s.label}>Published date</label>
          <input style={{ ...s.input, colorScheme: 'dark' }} type="date" value={form.publishedDate} onChange={(e) => setForm((f) => ({ ...f, publishedDate: e.target.value }))} />
        </div>
      </div>

      {/* b. CONTENT */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Content</div>
        <div style={s.fg}>
          <label style={s.label}>Synopsis</label>
          <textarea style={s.textarea} value={form.synopsis} onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))} placeholder="Plain text or basic HTML." />
          <div style={s.hint}>Plain text or basic HTML. Shown on the title detail page.</div>
        </div>
        <div style={{ ...s.fg, marginTop: '1.1rem' }}>
          <label style={s.label}>Excerpt <span style={s.labelSoft}>(optional)</span></label>
          <textarea style={{ ...s.textarea, ...s.textareaTall }} value={form.excerpt} onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))} placeholder="First chapter or sample passage." />
          <div style={s.hint}>First chapter or sample passage. Optional. Shown to non-purchasers.</div>
        </div>
      </div>

      {/* c. PRICING */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Pricing</div>
        <div style={s.row3}>
          <div style={s.fg}>
            <label style={s.label}>GBP (£)</label>
            <input style={s.input} type="number" min={0} step={0.01} value={form.priceGbp} onChange={(e) => setForm((f) => ({ ...f, priceGbp: e.target.value }))} placeholder="4.99" />
          </div>
          <div style={s.fg}>
            <label style={s.label}>NGN (₦)</label>
            <input style={s.input} type="number" min={0} step={1} value={form.priceNgn} onChange={(e) => setForm((f) => ({ ...f, priceNgn: e.target.value }))} placeholder="4500" />
          </div>
          <div style={s.fg}>
            <label style={s.label}>USD ($)</label>
            <input style={s.input} type="number" min={0} step={0.01} value={form.priceUsd} onChange={(e) => setForm((f) => ({ ...f, priceUsd: e.target.value }))} placeholder="6.49" />
          </div>
        </div>
        <div style={{ ...s.hint, marginTop: '0.75rem' }}>
          Enter prices as the customer sees them (e.g. £4.99, ₦4,500, $6.49). Stored internally as minor units (pence/cents/kobo). Leave blank to skip a currency.
        </div>
      </div>

      {/* d. RIGHTS */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Rights</div>
        <div style={s.fg}>
          <label style={s.label}>Territories</label>
          <div style={s.radioGroup}>
            <label style={s.radioOption}>
              <input type="radio" name="territories" checked={form.territoriesMode === 'worldwide'} onChange={() => setForm((f) => ({ ...f, territoriesMode: 'worldwide' }))} />
              Worldwide
            </label>
            <label style={s.radioOption}>
              <input type="radio" name="territories" checked={form.territoriesMode === 'specific'} onChange={() => setForm((f) => ({ ...f, territoriesMode: 'specific' }))} />
              Specific countries
            </label>
          </div>
          {form.territoriesMode === 'specific' && (
            <>
              <div style={{ ...s.chipsWrap, marginTop: '0.6rem' }}>
                {form.territoriesList.map((c) => (
                  <span key={c} style={s.chip}>
                    {c}
                    <button type="button" style={s.chipX} onClick={() => handleRemoveTerritory(c)} aria-label={`Remove ${c}`}>×</button>
                  </span>
                ))}
                <input
                  style={s.chipInput}
                  placeholder={form.territoriesList.length === 0 ? 'Type a 2-letter code and press Enter (e.g. GB)' : 'Add another…'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                      e.preventDefault();
                      handleAddTerritory(e.target.value);
                      e.target.value = '';
                    }
                  }}
                />
              </div>
              <div style={s.hint}>
                Common: {COMMON_TERRITORIES.map((c) => (
                  <button key={c} type="button" style={{ background: 'transparent', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', borderRadius: 12, padding: '0.1rem 0.55rem', fontSize: '0.7rem', fontFamily: 'monospace', cursor: 'pointer', marginRight: '0.4rem' }} onClick={() => handleAddTerritory(c)}>+{c}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* e. ASSETS */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Assets</div>
        <div style={s.row2}>
          <div style={s.fileBlock}>
            <label style={s.label}>Cover image <span style={s.labelSoft}>(image/*, &lt; 5 MB)</span></label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setForm((f) => ({ ...f, coverFile: e.target.files?.[0] || null }))}
              style={{ color: '#fff', fontSize: '0.85rem' }}
            />
            {form.coverFile && (
              <div style={s.fileMeta}>{form.coverFile.name} · {(form.coverFile.size / 1024).toFixed(0)} KB</div>
            )}
            {coverProgress !== null && (
              <div>
                <div style={s.progressBar}><div style={{ ...s.progressFill, width: `${coverProgress}%` }} /></div>
                <div style={s.fileMeta}>{coverProgress < 100 ? `Uploading… ${coverProgress}%` : 'Done ✓'}</div>
              </div>
            )}
            {!form.coverFile && form.coverUrl && (
              <div style={s.hintGreen}>✓ Existing cover on file. Pick a new file to replace.</div>
            )}
          </div>
          <div style={s.fileBlock}>
            <label style={s.label}>EPUB file <span style={s.labelSoft}>(.epub, &lt; 50 MB)</span></label>
            <input
              type="file"
              accept=".epub,application/epub+zip"
              onChange={(e) => setForm((f) => ({ ...f, epubFile: e.target.files?.[0] || null }))}
              style={{ color: '#fff', fontSize: '0.85rem' }}
            />
            {form.epubFile && (
              <div style={s.fileMeta}>{form.epubFile.name} · {(form.epubFile.size / 1024 / 1024).toFixed(1)} MB</div>
            )}
            {epubProgress !== null && (
              <div>
                <div style={s.progressBar}><div style={{ ...s.progressFill, width: `${epubProgress}%` }} /></div>
                <div style={s.fileMeta}>{epubProgress < 100 ? `Uploading… ${epubProgress}%` : 'Done ✓'}</div>
              </div>
            )}
            {!form.epubFile && form.epubPath && (
              <div style={s.hintGreen}>✓ Master EPUB uploaded. Pick a new file to replace.</div>
            )}
            <div style={s.hint}>Master EPUB is admin-only — there's no preview link. Buyer access happens through a Worker (Phase B).</div>
          </div>
        </div>
      </div>

      {/* f. STATUS */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Status</div>
        <div style={s.radioGroup}>
          {TITLE_STATUSES.map((st) => (
            <label key={st} style={s.radioOption}>
              <input type="radio" name="status" checked={form.status === st} onChange={() => setForm((f) => ({ ...f, status: st }))} />
              <span style={{ textTransform: 'capitalize' }}>{st}</span>
            </label>
          ))}
        </div>
        <div style={{ ...s.hint, marginTop: '0.5rem' }}>
          'Published' is gated on a cover + EPUB being uploaded. Save as 'draft' to keep working without those.
        </div>
      </div>

      {/* g. FLAGS */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Flags</div>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <label style={s.checkbox}>
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))} />
            Featured
          </label>
          <label style={s.checkbox}>
            <input type="checkbox" checked={form.bestseller} onChange={(e) => setForm((f) => ({ ...f, bestseller: e.target.checked }))} />
            Bestseller
          </label>
        </div>
        <div style={{ ...s.hint, marginTop: '0.5rem' }}>Bestseller is an editorial flag — independent of salesCount.</div>
      </div>

      <div style={s.formActions}>
        <button style={s.btnGhost} onClick={onCancel} type="button">Cancel</button>
        <button
          style={{ ...s.btn, ...(saving ? s.btnDisabled : {}) }}
          onClick={onSave}
          disabled={saving}
          type="button"
        >
          {saving ? 'Saving…' : editingTitleId ? 'Save changes' : 'Create title'}
        </button>
      </div>
    </div>
  );
}
