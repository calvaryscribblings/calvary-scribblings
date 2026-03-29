'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';

const CATEGORIES = [
  { value: 'flash', label: 'Flash Fiction' },
  { value: 'short', label: 'Short Story' },
  { value: 'poetry', label: 'Poetry' },
  { value: 'news', label: 'News & Updates' },
  { value: 'inspiring', label: 'Inspiring' },
];

const AUTHORS = ['Calvary', 'Tricia Ajax', 'Ufedo Adaji', 'Chioma Okonkwo', 'Ikenna Okpara'];

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function formatDate(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

async function getDB() {
  const { initializeApp, getApps } = await import('firebase/app');
  const { getDatabase } = await import('firebase/database');
  const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
  return getDatabase(app);
}

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header: { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  body: { maxWidth: 860, margin: '0 auto', padding: '2.5rem 2rem' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' },
  h2: { fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: 0 },
  h2sub: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', marginTop: 3 },
  btn: { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDanger: { background: 'rgba(220,38,38,0.12)', color: '#f87171', border: '1px solid rgba(220,38,38,0.25)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  card: { background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1.1rem 1.4rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1.1rem' },
  coverThumb: { width: 48, height: 64, objectFit: 'cover', borderRadius: 4, flexShrink: 0, background: '#2a2a2a' },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTitle: { fontWeight: 700, fontSize: '0.92rem', color: '#fff', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardMeta: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' },
  badge: { display: 'inline-block', fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.12rem 0.45rem', borderRadius: 3, background: 'rgba(124,58,237,0.2)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.35)', marginLeft: '0.5rem', verticalAlign: 'middle' },
  cardActions: { display: 'flex', gap: '0.5rem', flexShrink: 0 },
  form: { display: 'flex', flexDirection: 'column', gap: '1.4rem' },
  fg: { display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  label: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa' },
  input: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.85rem 1rem', color: '#fff', fontSize: '0.85rem', fontFamily: "'Courier New', monospace", outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 340, resize: 'vertical', lineHeight: 1.65 },
  select: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.1rem' },
  hint: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 },
  msg: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#c4b5fd', marginBottom: '1.5rem' },
  formActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.5rem' },
  empty: { textAlign: 'center', color: 'rgba(255,255,255,0.25)', padding: '4rem 0', fontSize: '0.88rem' },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
};

// ── StoryForm lifted outside AdminPage to prevent re-mount on every render ────
function StoryForm({ form, setForm, editingId, saving, msg, onSave, onCancel }) {
  return (
    <div>
      <div style={s.topBar}>
        <div>
          <h2 style={s.h2}>{editingId ? 'Edit Story' : 'New Story'}</h2>
          {!editingId && form.title && <div style={s.h2sub}>Slug: /stories/{slugify(form.title)}</div>}
        </div>
        <button style={s.btnGhost} onClick={onCancel}>← Back</button>
      </div>
      {msg && <div style={s.msg}>{msg}</div>}
      <div style={s.form}>
        <div style={s.fg}>
          <label style={s.label}>Title</label>
          <input style={s.input} value={form.title} placeholder="Story title"
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        </div>
        <div style={s.row2}>
          <div style={s.fg}>
            <label style={s.label}>Author</label>
            <select style={s.select} value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))}>
              {AUTHORS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div style={s.fg}>
            <label style={s.label}>Category</label>
            <select style={s.select} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div style={s.row2}>
          <div style={s.fg}>
            <label style={s.label}>Date</label>
            <input style={s.input} value={form.date} placeholder="Mar 29, 2026"
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div style={s.fg}>
            <label style={s.label}>Cover Filename</label>
            <input style={s.input} value={form.coverFilename} placeholder="my-story-cover.jpeg"
              onChange={e => setForm(f => ({ ...f, coverFilename: e.target.value }))} />
            <div style={s.hint}>Upload image to /public/ in the repo, then enter filename here.</div>
          </div>
        </div>
        <div style={s.fg}>
          <label style={s.label}>Story Content (HTML)</label>
          <textarea style={s.textarea} value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            placeholder={'<p>First paragraph — no indent.</p>\n<p style="text-indent:1.5em; margin-bottom:0">Indented paragraph.</p>'} />
          <div style={s.hint}>
            House style: British English · single quotes for dialogue · em dashes with spaces · no Oxford comma<br />
            First paragraph flush, all subsequent: style="text-indent:1.5em; margin-bottom:0"<br />
            Separator: &lt;p style="text-indent:1.5em; margin-bottom:0"&gt;***&lt;/p&gt;
          </div>
        </div>
        <div style={s.formActions}>
          <button style={s.btnGhost} onClick={onCancel}>Cancel</button>
          <button style={{ ...s.btn, opacity: saving ? 0.6 : 1 }} onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Update Story' : 'Publish Story'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  const [view, setView] = useState('list');
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [editingId, setEditingId] = useState(null);

  const emptyForm = { title: '', author: AUTHORS[0], category: 'flash', date: formatDate(new Date()), coverFilename: '', content: '' };
  const [form, setForm] = useState(emptyForm);

  const isAdmin = user && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  useEffect(() => { if (isAdmin) loadStories(); }, [isAdmin]);

  async function loadStories() {
    setLoading(true);
    try {
      const { ref, get } = await import('firebase/database');
      const db = await getDB();
      const snap = await get(ref(db, 'cms_stories'));
      if (snap.exists()) {
        const data = snap.val();
        const list = Object.entries(data).map(([id, s]) => ({ id, ...s }));
        list.sort((a, b) => new Date(b.date) - new Date(a.date));
        setStories(list);
      } else { setStories([]); }
    } catch (e) { setMsg('Error loading: ' + e.message); }
    setLoading(false);
  }

  const saveStory = async () => {
    if (!form.title.trim()) { setMsg('Title is required.'); return; }
    if (!form.content.trim()) { setMsg('Content is required.'); return; }
    if (!form.coverFilename.trim()) { setMsg('Cover filename is required.'); return; }
    setSaving(true); setMsg('');
    try {
      const { ref, set } = await import('firebase/database');
      const db = await getDB();
      const slug = editingId || slugify(form.title);
      const categoryObj = CATEGORIES.find(c => c.value === form.category);
      const coverFilename = form.coverFilename.trim();
      const coverPath = coverFilename.startsWith('/') ? coverFilename : `/${coverFilename}`;
      await set(ref(db, `cms_stories/${slug}`), {
        title: form.title.trim(), author: form.author,
        category: form.category, categoryName: categoryObj.label,
        date: form.date, content: form.content.trim(),
        cover: coverPath, url: `/stories/${slug}`, published: true,
      });
      setMsg(editingId ? '✓ Story updated.' : '✓ Story published.');
      setForm(emptyForm); setEditingId(null); setView('list');
      loadStories();
    } catch (e) { setMsg('Error saving: ' + e.message); }
    setSaving(false);
  };

  async function deleteStory(id) {
    if (!confirm('Delete this story? This cannot be undone.')) return;
    try {
      const { ref, remove } = await import('firebase/database');
      const db = await getDB();
      await remove(ref(db, `cms_stories/${id}`));
      setMsg('Story deleted.'); loadStories();
    } catch (e) { setMsg('Error: ' + e.message); }
  }

  function openEdit(story) {
    setForm({ title: story.title, author: story.author, category: story.category, date: story.date, coverFilename: story.cover, content: story.content });
    setEditingId(story.id); setView('edit'); setMsg('');
  }

  function openNew() { setForm(emptyForm); setEditingId(null); setView('new'); setMsg(''); }
  function handleCancel() { setView('list'); setMsg(''); }

  if (!user) return (
    <div style={s.gate}>
      <div style={{ fontSize: '1.1rem', color: '#a78bfa', fontWeight: 700 }}>Calvary Scribblings CMS</div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.88rem' }}>Sign in to access the CMS.</div>
      <a href="/" style={{ color: '#c4b5fd', fontSize: '0.82rem' }}>← Back to site</a>
    </div>
  );

  if (!isAdmin) return (
    <div style={s.gate}>
      <div style={{ fontSize: '1.1rem', color: '#f87171', fontWeight: 700 }}>Access Denied</div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.88rem' }}>This area is restricted.</div>
      <a href="/" style={{ color: '#c4b5fd', fontSize: '0.82rem' }}>← Back to site</a>
    </div>
  );

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={s.sub}>Content Management</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>{user.email}</span>
          <a href="/" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← Site</a>
        </div>
      </header>
      <div style={s.body}>
        {(view === 'new' || view === 'edit') && (
          <StoryForm
            form={form} setForm={setForm} editingId={editingId}
            saving={saving} msg={msg} onSave={saveStory} onCancel={handleCancel}
          />
        )}
        {view === 'list' && (
          <div>
            <div style={s.topBar}>
              <div>
                <h2 style={s.h2}>Stories</h2>
                <div style={s.h2sub}>Firebase CMS · {stories.length} {stories.length === 1 ? 'story' : 'stories'} published</div>
              </div>
              <button style={s.btn} onClick={openNew}>+ New Story</button>
            </div>
            {msg && <div style={s.msg}>{msg}</div>}
            {loading
              ? <div style={s.empty}>Loading…</div>
              : stories.length === 0
                ? <div style={s.empty}>No stories yet.<br />Hit "+ New Story" to publish your first.</div>
                : stories.map(story => (
                  <div key={story.id} style={s.card}>
                    <img src={story.cover} alt={story.title} style={s.coverThumb} onError={e => { e.target.style.opacity = 0.2; }} />
                    <div style={s.cardInfo}>
                      <div style={s.cardTitle}>{story.title}<span style={s.badge}>{story.categoryName}</span></div>
                      <div style={s.cardMeta}>By {story.author} · {story.date} · <a href={story.url} target="_blank" rel="noreferrer" style={{ color: '#a78bfa', textDecoration: 'none' }}>View →</a></div>
                    </div>
                    <div style={s.cardActions}>
                      <button style={s.btnGhost} onClick={() => openEdit(story)}>Edit</button>
                      <button style={s.btnDanger} onClick={() => deleteStory(story.id)}>Delete</button>
                    </div>
                  </div>
                ))
            }
          </div>
        )}
      </div>
    </div>
  );
}