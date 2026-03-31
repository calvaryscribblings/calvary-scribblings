'use client';
import { useState, useEffect, useRef } from 'react';
import { db, storage } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';
const IMGBB_KEY = '7370a63104ddbe33b9693fa1057979d2';

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

function toDatetimeLocal(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getScheduleStatus(publishAt) {
  if (!publishAt) return null;
  const diff = new Date(publishAt).getTime() - Date.now();
  if (diff <= 0) return 'Live';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `Scheduled · publishes in ${days}d ${hours}h`;
  if (hours > 0) return `Scheduled · publishes in ${hours}h ${mins}m`;
  return `Scheduled · publishes in ${mins}m`;
}


function convertToHTML(text) {
  if (/<p[\s>]/i.test(text)) return text;
  const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
  return paragraphs.map((p, i) => {
    if (i === 0) return `<p>${p}</p>`;
    return `<p style="text-indent:1.5em; margin-bottom:0">${p}</p>`;
  }).join(' ');
}

async function uploadToStorage(file) {
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const filename = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9.]/g, '_');
  const storageRef = ref(storage, 'covers/' + filename);
  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);
  return url;
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
  btnImg: { background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.3)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap' },
  card: { background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1.1rem 1.4rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '1.1rem' },
  coverThumb: { width: 48, height: 64, objectFit: 'cover', borderRadius: 4, flexShrink: 0, background: '#2a2a2a' },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTitle: { fontWeight: 700, fontSize: '0.92rem', color: '#fff', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardMeta: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)' },
  badge: { display: 'inline-block', fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.12rem 0.45rem', borderRadius: 3, background: 'rgba(124,58,237,0.2)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.35)', marginLeft: '0.5rem', verticalAlign: 'middle' },
  badgeScheduled: { display: 'inline-block', fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.12rem 0.45rem', borderRadius: 3, background: 'rgba(217,119,6,0.2)', color: '#fcd34d', border: '1px solid rgba(217,119,6,0.35)', marginLeft: '0.5rem', verticalAlign: 'middle' },
  cardActions: { display: 'flex', gap: '0.5rem', flexShrink: 0 },
  form: { display: 'flex', flexDirection: 'column', gap: '1.4rem' },
  fg: { display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  label: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa' },
  input: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.85rem 1rem', color: '#fff', fontSize: '0.85rem', fontFamily: "'Courier New', monospace", outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 340, resize: 'vertical', lineHeight: 1.65 },
  select: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.1rem' },
  hint: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 },
  hintGreen: { fontSize: '0.68rem', color: '#86efac', lineHeight: 1.5 },
  msg: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#c4b5fd', marginBottom: '1.5rem' },
  scheduleBox: { background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 8, padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  scheduleToggle: { display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', userSelect: 'none' },
  formActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.5rem' },
  empty: { textAlign: 'center', color: 'rgba(255,255,255,0.25)', padding: '4rem 0', fontSize: '0.88rem' },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 10, padding: '1.75rem', width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: '1rem' },
  modalTitle: { fontSize: '1rem', fontWeight: 700, color: '#fff', margin: 0 },
};

// ── Image Upload Modal (for inline story images) ───────────────────────────────
function ImageModal({ onInsert, onClose }) {
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  async function handleUpload() {
    if (!file) { setError('Please select an image.'); return; }
    setUploading(true); setError('');
    try {
      const url = await uploadToStorage(file);
      let html;
      if (caption.trim()) {
        html = `\n<figure style="margin:1.5em 0;">\n  <img src="${url}" style="width:100%; border-radius:6px;" alt="${caption.trim()}" />\n  <figcaption style="text-align:center; font-style:italic; font-size:0.85rem; color:#888; margin-top:0.5em;">${caption.trim()}</figcaption>\n</figure>\n`;
      } else {
        html = `\n<figure style="margin:1.5em 0;">\n  <img src="${url}" style="width:100%; border-radius:6px;" alt="" />\n</figure>\n`;
      }
      onInsert(html);
      onClose();
    } catch (e) { setError(e.message); }
    setUploading(false);
  }

  return (
    <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <div style={s.modalTitle}>Insert Image</div>
        <div style={s.fg}>
          <label style={s.label}>Image File</label>
          <button style={s.btnGhost} onClick={() => fileRef.current.click()}>
            {file ? file.name : 'Choose image…'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => setFile(e.target.files[0])} />
        </div>
        <div style={s.fg}>
          <label style={s.label}>Caption (optional)</label>
          <input style={s.input} value={caption} placeholder="Enter a caption…"
            onChange={e => setCaption(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUpload()} />
          <div style={s.hint}>Caption will appear in italics below the image.</div>
        </div>
        {error && <div style={{ fontSize: '0.82rem', color: '#f87171' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button style={s.btnGhost} onClick={onClose}>Cancel</button>
          <button style={{ ...s.btn, opacity: uploading ? 0.6 : 1 }} onClick={handleUpload} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Insert Image'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── StoryForm ─────────────────────────────────────────────────────────────────
function StoryForm({ form, setForm, editingId, saving, msg, onSave, onCancel }) {
  const [showImageModal, setShowImageModal] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const textareaRef = useRef(null);
  const coverInputRef = useRef(null);
  const isScheduled = !!form.publishAt;
  const scheduleStatus = form.publishAt ? getScheduleStatus(form.publishAt) : null;

  async function handleCoverUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setCoverUploading(true);
    try {
      const url = await uploadToStorage(file);
      setForm(f => ({ ...f, coverFilename: url, coverPreview: url }));
    } catch (err) {
      alert('Cover upload failed: ' + err.message);
    }
    setCoverUploading(false);
  }

  function insertAtCursor(html) {
    const ta = textareaRef.current;
    if (!ta) { setForm(f => ({ ...f, content: f.content + html })); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newContent = form.content.slice(0, start) + html + form.content.slice(end);
    setForm(f => ({ ...f, content: newContent }));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + html.length, start + html.length); }, 0);
  }

  function insertImageAtCursor(html) { insertAtCursor(html); }

  function insertSubheading() {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = form.content.slice(start, end);
    const html = selected ? '<h3>' + selected + '</h3>' : '<h3>Subheading</h3>';
    insertAtCursor(html);
  }

  const coverIsUrl = form.coverFilename && form.coverFilename.startsWith('http');

  return (
    <div>
      {showImageModal && <ImageModal onInsert={insertImageAtCursor} onClose={() => setShowImageModal(false)} />}
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
            <label style={s.label}>Display Date</label>
            <input style={s.input} value={form.date} placeholder="Mar 29, 2026"
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            <div style={s.hint}>Shown to readers on the story page.</div>
          </div>
          <div style={s.fg}>
            <label style={s.label}>Cover Image</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <input style={s.input} value={form.coverFilename} placeholder="my-story-cover.jpeg or upload →"
                  onChange={e => setForm(f => ({ ...f, coverFilename: e.target.value, coverPreview: null }))} />
              </div>
              <button style={{ ...s.btnImg, flexShrink: 0 }}
                onClick={() => coverInputRef.current.click()}
                disabled={coverUploading}>
                {coverUploading ? '…' : '⬆ Upload'}
              </button>
              <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverUpload} />
            </div>
            {coverIsUrl && (
              <div style={s.hintGreen}>✓ Uploaded to Firebase</div>
            )}
            {!coverIsUrl && (
              <div style={s.hint}>Upload image, or enter a /public/ filename manually.</div>
            )}
            {(form.coverPreview || coverIsUrl) && (
              <img src={form.coverPreview || form.coverFilename} alt="Cover preview"
                style={{ width: 80, height: 106, objectFit: 'cover', borderRadius: 4, marginTop: '0.5rem' }} />
            )}
          </div>
        </div>

        {/* Scheduling */}
        <div style={s.scheduleBox}>
          <label style={s.scheduleToggle}>
            <input type="checkbox" checked={isScheduled}
              onChange={e => setForm(f => ({
                ...f, publishAt: e.target.checked ? toDatetimeLocal(new Date(Date.now() + 3600000)) : '',
              }))} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fcd34d', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Schedule for later
            </span>
          </label>
          {isScheduled && (
            <>
              <input type="datetime-local" style={{ ...s.input, marginTop: '0.5rem', colorScheme: 'dark' }}
                value={form.publishAt} onChange={e => setForm(f => ({ ...f, publishAt: e.target.value }))} />
              {scheduleStatus && (
                <div style={{ fontSize: '0.72rem', color: '#fcd34d', marginTop: '0.25rem' }}>
                  {scheduleStatus === 'Live' ? '✓ This time is in the past — story will publish immediately.' : `⏰ ${scheduleStatus}`}
                </div>
              )}
            </>
          )}
          {!isScheduled && <div style={s.hint}>Untick to publish immediately. Tick to choose a future date and time.</div>}
        </div>

        {/* Content */}
        <div style={s.fg}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={s.label}>Story Content (HTML)</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button style={s.btnImg} onClick={insertSubheading}>
                H3 Subheading
              </button>
              <button style={s.btnImg} onClick={() => setShowImageModal(true)}>
                🖼 Insert Image
              </button>
            </div>
          </div>
          <textarea ref={textareaRef} style={s.textarea} value={form.content}
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
            {saving ? 'Saving…' : isScheduled ? 'Schedule Story' : editingId ? 'Update Story' : 'Publish Story'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AdminPage ─────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { user } = useAuth();
  const [view, setView] = useState('list');
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [editingId, setEditingId] = useState(null);

  const emptyForm = { title: '', author: AUTHORS[0], category: 'flash', date: formatDate(new Date()), coverFilename: '', coverPreview: null, content: '', publishAt: '' };
  const [form, setForm] = useState(emptyForm);

  const isAdmin = user && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  useEffect(() => { if (isAdmin) loadStories(); }, [isAdmin]);

  async function loadStories() {
    setLoading(true);
    try {
      const { ref, get } = await import('firebase/database');
      const snap = await get(ref(db, 'cms_stories'));
      if (snap.exists()) {
        const data = snap.val();
        const list = Object.entries(data).map(([id, s]) => ({ id, ...s }));
        list.sort((a, b) => {
          const aTime = a.publishAt ? new Date(a.publishAt).getTime() : new Date(a.date).getTime();
          const bTime = b.publishAt ? new Date(b.publishAt).getTime() : new Date(b.date).getTime();
          return bTime - aTime;
        });
        setStories(list);
      } else { setStories([]); }
    } catch (e) { setMsg('Error loading: ' + e.message); }
    setLoading(false);
  }

  const saveStory = async () => {
    if (!form.title.trim()) { setMsg('Title is required.'); return; }
    if (!form.content.trim()) { setMsg('Content is required.'); return; }
    if (!form.coverFilename.trim()) { setMsg('Cover image is required.'); return; }
    setSaving(true); setMsg('');
    try {
      const { ref, set } = await import('firebase/database');
      const slug = editingId || slugify(form.title);
      const categoryObj = CATEGORIES.find(c => c.value === form.category);
      const coverFilename = form.coverFilename.trim();
      // If it's a full URL (ImgBB), use as-is. Otherwise treat as /public/ filename.
      const coverPath = coverFilename.startsWith('http') ? coverFilename : (coverFilename.startsWith('/') ? coverFilename : `/${coverFilename}`);
      const storyData = {
        title: form.title.trim(), author: form.author,
        category: form.category, categoryName: categoryObj.label,
        date: form.date, content: convertToHTML(form.content.trim()),
        cover: coverPath, url: `/stories/${slug}`, published: true,
      };
      if (form.publishAt) storyData.publishAt = new Date(form.publishAt).toISOString();
      await set(ref(db, `cms_stories/${slug}`), storyData);
      // Trigger Cloudflare rebuild after short delay so Firebase write completes first
      try {
        await new Promise(r => setTimeout(r, 3000));
        await fetch('https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/df2479ae-06a5-4ff3-a319-29b7b94dd106', { method: 'POST' });
      } catch(e) { console.warn('Deploy hook failed:', e); }
      const isScheduled = form.publishAt && new Date(form.publishAt) > new Date();
      setMsg(isScheduled
        ? `⏰ Story scheduled for ${new Date(form.publishAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`
        : editingId ? '✓ Story updated.' : '✓ Story published.');
      setForm(emptyForm); setEditingId(null); setView('list');
      loadStories();
    } catch (e) { setMsg('Error saving: ' + e.message); }
    setSaving(false);
  };

  async function deleteStory(id) {
    if (!confirm('Delete this story? This cannot be undone.')) return;
    try {
      const { ref, remove } = await import('firebase/database');
      await remove(ref(db, `cms_stories/${id}`));
      setMsg('Story deleted.'); loadStories();
    } catch (e) { setMsg('Error: ' + e.message); }
  }

  function openEdit(story) {
    setForm({ title: story.title, author: story.author, category: story.category, date: story.date, coverFilename: story.cover, coverPreview: story.cover, content: story.content, publishAt: story.publishAt ? toDatetimeLocal(new Date(story.publishAt)) : '' });
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

  const liveCount = stories.filter(s => !s.publishAt || new Date(s.publishAt) <= new Date()).length;
  const scheduledCount = stories.filter(s => s.publishAt && new Date(s.publishAt) > new Date()).length;

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
          <StoryForm form={form} setForm={setForm} editingId={editingId}
            saving={saving} msg={msg} onSave={saveStory} onCancel={handleCancel} />
        )}
        {view === 'list' && (
          <div>
            <div style={s.topBar}>
              <div>
                <h2 style={s.h2}>Stories</h2>
                <div style={s.h2sub}>{liveCount} live · {scheduledCount} scheduled</div>
              </div>
              <button style={s.btn} onClick={openNew}>+ New Story</button>
            </div>
            {msg && <div style={s.msg}>{msg}</div>}
            {loading
              ? <div style={s.empty}>Loading…</div>
              : stories.length === 0
                ? <div style={s.empty}>No stories yet.<br />Hit "+ New Story" to publish your first.</div>
                : stories.map(story => {
                    const scheduled = story.publishAt && new Date(story.publishAt) > new Date();
                    const status = story.publishAt ? getScheduleStatus(story.publishAt) : null;
                    return (
                      <div key={story.id} style={{ ...s.card, opacity: scheduled ? 0.75 : 1 }}>
                        <img src={story.cover} alt={story.title} style={s.coverThumb} onError={e => { e.target.style.opacity = 0.2; }} />
                        <div style={s.cardInfo}>
                          <div style={s.cardTitle}>
                            {story.title}
                            <span style={s.badge}>{story.categoryName}</span>
                            {scheduled && <span style={s.badgeScheduled}>Scheduled</span>}
                          </div>
                          <div style={s.cardMeta}>
                            By {story.author} · {story.date}
                            {status && status !== 'Live' && ` · ${status}`}
                            {!scheduled && <> · <a href={story.url} target="_blank" rel="noreferrer" style={{ color: '#a78bfa', textDecoration: 'none' }}>View →</a></>}
                          </div>
                        </div>
                        <div style={s.cardActions}>
                          <button style={s.btnGhost} onClick={() => openEdit(story)}>Edit</button>
                          <button style={s.btnDanger} onClick={() => deleteStory(story.id)}>Delete</button>
                        </div>
                      </div>
                    );
                  })
            }
          </div>
        )}
      </div>
    </div>
  );
}