'use client';
import { GatePreviewToggle } from '../components/GatePreview';
import { useState, useEffect, useRef } from 'react';
import { db, storage } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { extractEpubText } from '../lib/epubExtract';
import { indexUpdatePaths } from '../lib/storyIndex';
import { CATEGORIES, SUBCATEGORIES as SUBCATEGORY_MAP } from '../lib/taxonomy';
import { publishedAtMsFor } from '../lib/storyAccess';
import { validateBody } from '../lib/htmlBlocks';
import { buildCoverDerivatives, COVER_CACHE_CONTROL } from '../lib/coverDerivatives';
import { validateDescriptor, canonicalDescriptor, wordsEchoingTitle } from '../lib/coverDescriptor';
// R19.7 — THE DEPLOY, ASKED FOR BY NAME. This file used to hold a Cloudflare deploy-hook URL
// as a literal and POST it from the browser. A deploy hook is an unauthenticated trigger, so
// that URL — shipped in out/_next/static/chunks — let anyone who had loaded the site start
// builds indefinitely. It was rotated on 26 Aug 2026 and is dead. The hook is now named, never
// held: see app/lib/rebuild.js.
import { fireRebuild, HOOKS } from '../lib/rebuild';
import { liveBuildId, waitForNewBuild, rebuildLine } from '../lib/rebuildWatch';
import { storyStatus, statusLine, scheduleRefusal, unscheduleDecision, hidePaths, unhidePlan } from '../lib/storyState';
import { readWithDeadline, classifyFailure } from '../lib/reliableRead';
import Unavailable from '../components/Unavailable';
import { slugify, newStorySlug } from '../lib/storySlug';

const ADMIN_EMAIL = 'ikennaworksfromhome@gmail.com';

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

// Plain-text paragraphs → prose HTML. Lines that already look like block markup are
// passed through untouched; everything else becomes a paragraph.
//
// ── The closing tag, and the extra bullet it drew ────────────────────────────
// blockTags used to match OPENING tags only, so a `</ul>` sitting on its own line
// was not recognised as markup and got wrapped like prose:
//
//     <ul> <li>One</li> <li>Two</li> <p style="…"></ul></p>
//
// The browser closes the paragraph at `</ul>` and drops the orphaned `</p>`, which
// leaves an EMPTY <p> inside the list — and the app's renderer drew a bullet for
// it. That is the artefact sitting in 13 of the corpus's 20 lists. `<\/?` now
// matches the closing form too, so a list typed across several lines survives
// intact. This is the source; stripping the stored copies without it just refills
// the bucket.
//
// ── Why no inline style any more ─────────────────────────────────────────────
// Indented paragraphs used to carry style="text-indent:1.5em; margin-bottom:0".
// app/lib/proseCSS.js already declares exactly that:
//
//     .prose p { margin-bottom: 0; } .prose:not(.is-verse) p + p { text-indent: 1.5em; }
//
// so the inline copy was redundant — `p + p` indents every paragraph but the
// first, which is precisely what the old `i === 0` branch hand-rolled. Worse, an
// inline style outranks a class selector, so it DEFEATED the two rules written to
// override it: `.prose:not(.is-verse)`, which deliberately leaves verse
// unindented, and `.has-dropcap p.dropcap-target { text-indent: 0 }` — and the
// drop-cap target is not always the first paragraph, because the front-matter walk
// in app/lib/dropcap.js skips ahead. Emitting plain <p> hands both back to the
// stylesheet. Plain <p> is also already the corpus norm (123 of 174 stories,
// including the most recent), so this is the shape both renderers proved.
function convertToHTML(text) {
  const blockTags = /^<\/?(figure|img|h[1-6]|ul|ol|li|blockquote|div|table|hr|p[\s>])/i;
  const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(p => p.length > 0);
  return paragraphs.map((p) => (blockTags.test(p) ? p : `<p>${p}</p>`)).join(' ');
}

async function uploadToStorage(file) {
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const filename = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9.]/g, '_');
  const storageRef = ref(storage, 'covers/' + filename);
  // Long-cache every upload from now on (covers + inline content images are
  // content-addressed by a unique filename, so immutable is safe).
  await uploadBytes(storageRef, file, { contentType: file.type, cacheControl: COVER_CACHE_CONTROL });
  return await getDownloadURL(storageRef);
}

// Compute a blurhash for an image File by drawing a downscaled (~64px wide)
// copy to a canvas and encoding 4x3 components. Best-effort: resolves to ''
// on any failure so a cover upload/replace never blocks on hash generation.
async function computeBlurhash(file) {
  try {
    const { encode } = await import('blurhash');
    const bitmap = await createImageBitmap(file);
    const w = 64;
    const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (typeof bitmap.close === 'function') bitmap.close();
    const { data } = ctx.getImageData(0, 0, w, h);
    return encode(new Uint8ClampedArray(data), w, h, 4, 3);
  } catch (err) {
    console.warn('[admin] blurhash generation failed:', err);
    return '';
  }
}

async function uploadEPUBToStorage(file) {
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const filename = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9.]/g, '_');
  const storageRef = ref(storage, 'epubs/' + filename);
  await uploadBytes(storageRef, file, { contentType: file.type, cacheControl: COVER_CACHE_CONTROL });
  return await getDownloadURL(storageRef);
}

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "Cormorant Garamond, Georgia, serif" },
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
  badgeSub: { display: 'inline-block', fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.12rem 0.45rem', borderRadius: 3, background: 'rgba(220,38,38,0.15)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)', marginLeft: '0.5rem', verticalAlign: 'middle' },
  badgeReader: { display: 'inline-block', fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.12rem 0.45rem', borderRadius: 3, background: 'rgba(201,164,76,0.15)', color: '#fcd34d', border: '1px solid rgba(201,164,76,0.3)', marginLeft: '0.5rem', verticalAlign: 'middle' },
  // "Cover pending" / "Descriptor pending" — a WAITING state, not a fault. Deliberately
  // cool and quiet rather than the amber of Scheduled or the gold of Hidden.
  badgeHeld: { display: 'inline-block', fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.12rem 0.45rem', borderRadius: 3, background: 'rgba(124,58,237,0.16)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.45)', marginLeft: '0.5rem', verticalAlign: 'middle' },
  badgeHidden: { display: 'inline-block', fontSize: '0.58rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.12rem 0.45rem', borderRadius: 3, background: 'rgba(201,164,76,0.1)', color: '#e0c068', border: '1px solid rgba(201,164,76,0.55)', marginLeft: '0.5rem', verticalAlign: 'middle' },
  filterRow: { display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' },
  filterChip: { background: 'transparent', color: 'rgba(255,255,255,0.5)', border: '1px solid #2a2a2a', padding: '0.4rem 0.9rem', borderRadius: 6, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  filterChipActive: { background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.4)' },
  hiddenNotice: { background: 'rgba(201,164,76,0.1)', border: '1px solid rgba(201,164,76,0.4)', borderRadius: 8, padding: '0.7rem 1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.5rem' },
  btnUnhide: { background: 'rgba(201,164,76,0.15)', color: '#e0c068', border: '1px solid rgba(201,164,76,0.5)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
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
  readerBox: { background: 'rgba(107,47,173,0.08)', border: '1px solid rgba(107,47,173,0.2)', borderRadius: 8, padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  formActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.5rem' },
  empty: { textAlign: 'center', color: 'rgba(255,255,255,0.25)', padding: '4rem 0', fontSize: '0.88rem' },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "Cormorant Garamond, Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 10, padding: '1.75rem', width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: '1rem' },
  modalTitle: { fontSize: '1rem', fontWeight: 700, color: '#fff', margin: 0 },
};

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

function StoryForm({ form, setForm, editingId, saving, msg, onSave, onCancel, roster, guestList, hidden, onUnhide }) {
  const [showImageModal, setShowImageModal] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [epubUploading, setEpubUploading] = useState(false);
  const textareaRef = useRef(null);
  const coverInputRef = useRef(null);
  const epubInputRef = useRef(null);
  // W6 (ADM-07): a LIVE story is not offered a schedule — its past publishAt is history, and the
  // form used to open it with "Schedule for later" ticked and a Schedule Story button.
  const isLiveRecord = form.recordStatus === 'live';
  const isScheduled = !!form.publishAt && !isLiveRecord;
  const scheduleStatus = isScheduled ? getScheduleStatus(form.publishAt) : null;
  const unscheduling = form.recordStatus === 'scheduled' && !form.publishAt;
  const saveLabel = isScheduled && new Date(form.publishAt) > new Date() ? 'Schedule Story'
    : unscheduling ? (form.unscheduleAs === 'publish' ? 'Publish Now' : form.unscheduleAs === 'hide' ? 'Save as Hidden' : 'Choose what happens')
    : !editingId ? 'Publish Story'
    : isLiveRecord ? 'Update Story' : 'Save';
  const subcatOptions = SUBCATEGORY_MAP[form.category] || [];

  // Live-resolve a typed @handle → uid when "Attribute by @handle" is chosen.
  useEffect(() => {
    if (form.selectedAuthor !== 'newhandle') return;
    const raw = (form.handleInput || '').trim().toLowerCase().replace(/^@+/, '');
    if (!raw) { setForm(f => ({ ...f, resolvedHandle: null, handleError: '' })); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const hSnap = await get(ref(db, `usernames/${raw}`));
        const uid = hSnap.exists() ? String(hSnap.val() || '').trim() : '';
        if (!uid) { if (!cancelled) setForm(f => ({ ...f, resolvedHandle: null, handleError: `No user found for @${raw}.` })); return; }
        const uSnap = await get(ref(db, `users/${uid}`));
        const u = uSnap.exists() ? (uSnap.val() || {}) : {};
        if (!cancelled) setForm(f => ({ ...f, resolvedHandle: { uid, displayName: u.displayName || '', username: u.username || raw }, handleError: '', authorHandle: f.authorHandle || u.username || raw }));
      } catch (e) {
        if (!cancelled) setForm(f => ({ ...f, resolvedHandle: null, handleError: 'Lookup failed: ' + e.message }));
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.selectedAuthor, form.handleInput, setForm]);

  // Username of the currently-selected identity (for the override placeholder).
  const selUsername = (() => {
    if (form.selectedAuthor && form.selectedAuthor.startsWith('uid:')) { const r = roster.find(x => `uid:${x.uid}` === form.selectedAuthor); return (r && r.username) || ''; }
    if (form.selectedAuthor === 'newhandle') return (form.resolvedHandle && form.resolvedHandle.username) || '';
    return '';
  })();
  // True unless the selected uid is missing from the roster (legacy/edit case).
  const selKnownInRoster = !form.selectedAuthor || !form.selectedAuthor.startsWith('uid:') || roster.some(r => `uid:${r.uid}` === form.selectedAuthor);

  async function handleCoverUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setCoverUploading(true);
    try {
      const url = await uploadToStorage(file);
      // Compute the blurhash placeholder from the same file (both first upload
      // and replace-on-edit go through here). Non-blocking: '' if it fails.
      const coverHash = await computeBlurhash(file);
      // The door does the sizing: cut w360 + w720 WebP from the same file so this
      // cover ships sized + long-cached from birth. Best-effort — {} on failure,
      // in which case srcset falls back to the original.
      // W1 / ADM-08 — a NEW story's derivatives go under a pending- prefix unless its address
      // has already been accepted. The natural slug is not known to be free until the save
      // asks the live node, and a colliding title would otherwise cut its w360/w720 over the
      // LIVE story's files at that path. The URLs travel in coverSizes, so the prefix is cosmetic.
      const slug = editingId || form.slug || `pending-${Date.now()}`;
      const coverSizes = await buildCoverDerivatives(storage, file, slug);
      setForm(f => ({ ...f, coverFilename: url, coverPreview: url, coverHash, coverSizes: Object.keys(coverSizes).length ? coverSizes : null }));
    } catch (err) { alert('Cover upload failed: ' + err.message); }
    setCoverUploading(false);
  }

  async function handleEPUBUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setEpubUploading(true);
    try {
      const url = await uploadEPUBToStorage(file);
      let extractedText = '';
      let extractionWarning = '';
      try {
        extractedText = await extractEpubText(file);
        if (extractedText.length < 500) extractionWarning = 'Extracted text is unusually short (' + extractedText.length + ' chars). Reader-mode quizzes may fail. Re-run from /admin/extract-text if needed.';
      } catch (extractErr) {
        console.warn('[admin] EPUB text extraction failed:', extractErr);
        extractionWarning = 'EPUB uploaded but text extraction failed: ' + extractErr.message + '. Run extraction from /admin/extract-text after saving.';
      }
      // Stamp a fresh version signal on every upload/replace — app cache-busts on this.
      setForm(f => ({ ...f, epubUrl: url, epubUpdatedAt: Date.now(), extractedText }));
      if (extractionWarning) alert(extractionWarning);
    } catch (err) { alert('EPUB upload failed: ' + err.message); }
    setEpubUploading(false);
  }

  function insertAtCursor(html) {
    const ta = textareaRef.current;
    if (!ta) { setForm(f => ({ ...f, content: f.content + html })); return; }
    const start = ta.selectionStart, end = ta.selectionEnd;
    const newContent = form.content.slice(0, start) + html + form.content.slice(end);
    setForm(f => ({ ...f, content: newContent }));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(start + html.length, start + html.length); }, 0);
  }

  function insertSubheading() {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const selected = form.content.slice(start, end);
    insertAtCursor(selected ? '<h3>' + selected + '</h3>' : '<h3>Subheading</h3>');
  }

  const coverIsUrl = form.coverFilename && form.coverFilename.startsWith('http');
  const epubIsUrl = form.epubUrl && form.epubUrl.startsWith('http');

  return (
    <div>
      {showImageModal && <ImageModal onInsert={insertAtCursor} onClose={() => setShowImageModal(false)} />}
      <div style={s.topBar}>
        <div>
          <h2 style={s.h2}>{editingId ? 'Edit Story' : 'New Story'}</h2>
          {!editingId && form.title && <div style={s.h2sub}>Slug: /stories/{form.slug || slugify(form.title)}</div>}
          {!editingId && form.slugOffer && !form.slug && (
            <button type="button" style={{ ...s.btnGhost, marginTop: 8 }}
              onClick={() => setForm(f => ({ ...f, slug: f.slugOffer, slugOffer: null }))}>
              Use the free address /stories/{form.slugOffer}
            </button>
          )}
        </div>
        <button style={s.btnGhost} onClick={onCancel}>← Back</button>
      </div>
      {msg && <div style={s.msg}>{msg}</div>}
      {hidden && (
        <div style={s.hiddenNotice}>
          <span style={{ fontSize: '0.82rem', color: '#e0c068' }}>This story is hidden from the platform.</span>
          <button style={s.btnUnhide} onClick={onUnhide}>Unhide</button>
        </div>
      )}
      <div style={s.form}>

        <div style={s.fg}>
          <label style={s.label}>Title</label>
          <input style={s.input} value={form.title} placeholder="Story title"
            onChange={e => setForm(f => ({ ...f, title: e.target.value, slug: '', slugOffer: null }))} />
        </div>

        <div style={s.row2}>
          <div style={s.fg}>
            <label style={s.label}>Author</label>
            <select style={s.select} value={form.selectedAuthor || ''}
              onChange={e => {
                const val = e.target.value;
                setForm(f => {
                  let authorHandle = f.authorHandle;
                  if (val.startsWith('uid:')) { const r = roster.find(x => `uid:${x.uid}` === val); authorHandle = (r && r.username) || ''; }
                  else if (val.startsWith('guest:')) authorHandle = '';
                  return { ...f, selectedAuthor: val, authorHandle, handleInput: '', resolvedHandle: null, handleError: '' };
                });
              }}>
              <option value="">— Select author —</option>
              {!selKnownInRoster && <option value={form.selectedAuthor}>{form.author || '(current author)'}</option>}
              <optgroup label="Registered">
                {roster.map(r => <option key={r.uid} value={`uid:${r.uid}`}>{r.displayName}{r.username ? ` (@${r.username})` : ''}</option>)}
              </optgroup>
              <optgroup label="Guests">
                {guestList.map(g => <option key={g.guestId} value={`guest:${g.guestId}`}>{g.name}</option>)}
              </optgroup>
              <option value="newhandle">+ Attribute by @handle…</option>
            </select>

            {form.selectedAuthor === 'newhandle' && (
              <div style={{ marginTop: '0.35rem' }}>
                <input style={s.input} value={form.handleInput || ''} placeholder="Enter @handle to resolve…"
                  onChange={e => setForm(f => ({ ...f, handleInput: e.target.value }))} />
                {form.resolvedHandle && form.resolvedHandle.uid
                  ? <div style={s.hintGreen}>Resolved → {form.resolvedHandle.displayName || '(no name)'} (@{form.resolvedHandle.username})</div>
                  : form.handleError
                    ? <div style={{ ...s.hint, color: '#f87171' }}>{form.handleError}</div>
                    : <div style={s.hint}>Looks up usernames/&lt;handle&gt; → uid. Resolves as you type.</div>}
              </div>
            )}

            <input style={{ ...s.input, marginTop: '0.35rem' }} value={form.authorHandle || ''}
              placeholder={selUsername ? `@${selUsername} (default)` : 'Optional @handle override…'}
              onChange={e => setForm(f => ({ ...f, authorHandle: e.target.value.replace(/^@/, '') }))} />
            <div style={s.hint}>Optional handle override. Defaults to the selected author’s username.</div>
          </div>
          <div style={s.fg}>
            <label style={s.label}>Category</label>
            <select style={s.select} value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value, subcategory: '' }))}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {subcatOptions.length > 0 && (
          <div style={s.fg}>
            <label style={s.label}>Subcategory</label>
            <select style={s.select} value={form.subcategory || ''}
              onChange={e => setForm(f => ({ ...f, subcategory: e.target.value }))}>
              <option value="">— Select subcategory —</option>
              {subcatOptions.map(sc => <option key={sc} value={sc}>{sc}</option>)}
            </select>
            <div style={s.hint}>Subcategory appears alongside the category badge on the story card and page.</div>
          </div>
        )}

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
                  onChange={e => setForm(f => ({ ...f, coverFilename: e.target.value, coverPreview: null, coverHash: '', coverSizes: null }))} />
              </div>
              <button style={{ ...s.btnImg, flexShrink: 0 }}
                onClick={() => coverInputRef.current.click()} disabled={coverUploading}>
                {coverUploading ? '…' : '⬆ Upload'}
              </button>
              <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverUpload} />
            </div>
            {coverIsUrl && <div style={s.hintGreen}>✓ Uploaded to Firebase</div>}
            {!coverIsUrl && <div style={s.hint}>Optional. Leave it empty and the house generates the cover &mdash; every story cover
              is typographic and made from the record itself. Upload only to override that deliberately.</div>}
            {(form.coverPreview || coverIsUrl) && (
              <img src={form.coverPreview || form.coverFilename} alt="Cover preview"
                style={{ width: 80, height: 106, objectFit: 'cover', borderRadius: 4, marginTop: '0.5rem' }} />
            )}
          </div>
        </div>

        {/* EPUB Upload */}
        <div style={s.fg}>
          <label style={s.label}>
            EPUB File <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional — for book reader)</span>
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <input style={s.input} value={form.epubUrl || ''} placeholder="Upload an EPUB file"
                onChange={e => setForm(f => ({ ...f, epubUrl: e.target.value }))} />
            </div>
            <button style={{ ...s.btnImg, flexShrink: 0 }}
              onClick={() => epubInputRef.current.click()} disabled={epubUploading}>
              {epubUploading ? '…' : '⬆ Upload EPUB'}
            </button>
            <input ref={epubInputRef} type="file" accept=".epub,application/epub+zip" style={{ display: 'none' }} onChange={handleEPUBUpload} />
          </div>
          {epubIsUrl && <div style={s.hintGreen}>✓ EPUB uploaded to Firebase</div>}
          {epubIsUrl && (form.extractedText
            ? <div style={s.hintGreen}>✓ Text extracted ({form.extractedText.length.toLocaleString()} chars) — reader-mode quizzes ready.</div>
            : <div style={{ ...s.hint, color: '#fcd34d' }}>⚠ No extracted text on file. Reader-mode quizzes will fail until you re-upload or run /admin/extract-text.</div>
          )}
          <div style={s.hint}>Upload an EPUB file for the cinematic book reader. Convert from Word/Google Docs using Calibre (free).</div>
        </div>

        {/* Book Reader Mode toggle */}
        <div style={s.readerBox}>
          <label style={s.scheduleToggle}>
            <input type="checkbox" checked={form.readerMode || false}
              onChange={e => setForm(f => ({ ...f, readerMode: e.target.checked }))} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Book Reader Mode
            </span>
          </label>
          <div style={s.hint}>
            When enabled, the story opens in the cinematic EPUB reader at /reader/[slug].
          </div>
        </div>

        {/* Prose Poem toggle */}
        <div style={s.readerBox}>
          <label style={s.scheduleToggle}>
            <input type="checkbox" checked={form.prosePoetry || false}
              onChange={e => setForm(f => ({ ...f, prosePoetry: e.target.checked }))} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#c4b5fd' }}>
              Prose Poem
            </span>
          </label>
        </div>

        {/* Featured pin toggle */}
        <div style={s.readerBox}>
          <label style={s.scheduleToggle}>
            <input type="checkbox" checked={form.featuredPin || false}
              onChange={e => setForm(f => ({ ...f, featuredPin: e.target.checked }))} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#c4b5fd' }}>
              Feature on homepage
            </span>
          </label>
          <div style={s.hint}>Pins this story into the featured carousel every rotation.</div>
        </div>

        {isLiveRecord ? (
        <div style={s.scheduleBox}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#86efac', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{form.recordStatusLine || 'Live'}</div>
          <div style={s.hint}>This story is live. Saving updates it in place; to take it down, use Hide on the story list.</div>
        </div>
        ) : (
        <div style={s.scheduleBox}>
          {editingId && form.recordStatusLine && (
            <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.55)', marginBottom: '0.4rem' }}>Now: {form.recordStatusLine}</div>
          )}
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
          {!isScheduled && !unscheduling && <div style={s.hint}>Untick to publish immediately. Tick to choose a future date and time.</div>}
          {unscheduling && (
            <div role="group" aria-label="What happens without its schedule" style={{ marginTop: '0.6rem', padding: '0.6rem 0.75rem', border: '1px solid rgba(252,211,77,0.45)', borderRadius: 8 }}>
              <div style={{ fontSize: '0.8rem', color: '#fcd34d', marginBottom: '0.4rem' }}>You removed this story&rsquo;s schedule. What should happen instead?</div>
              <label style={{ display: 'block', fontSize: '0.82rem', color: '#f5f0e8', marginBottom: '0.25rem' }}>
                <input type="radio" name="unscheduleAs" checked={form.unscheduleAs === 'publish'} onChange={() => setForm(f => ({ ...f, unscheduleAs: 'publish' }))} /> Publish it now
              </label>
              <label style={{ display: 'block', fontSize: '0.82rem', color: '#f5f0e8' }}>
                <input type="radio" name="unscheduleAs" checked={form.unscheduleAs === 'hide'} onChange={() => setForm(f => ({ ...f, unscheduleAs: 'hide' }))} /> Keep it hidden (it will not publish)
              </label>
            </div>
          )}
        </div>
        )}

        <div style={s.fg}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={s.label}>Story Content (HTML)</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button style={s.btnImg} onClick={insertSubheading}>H3 Subheading</button>
              <button style={s.btnImg} onClick={() => setShowImageModal(true)}>🖼 Insert Image</button>
            </div>
          </div>
          <textarea ref={textareaRef} style={s.textarea} value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
            placeholder={'Type paragraphs as plain text, one per line.\n\nOr paste HTML: <p>A paragraph.</p>'} />
          <div style={s.hint}>
            House style: British English · single quotes for dialogue · em dashes with spaces · no Oxford comma<br />
            Indentation is automatic — the stylesheet flushes the first paragraph and indents the rest. Do not type text-indent by hand.<br />
            Separator: &lt;p&gt;***&lt;/p&gt;
          </div>
        </div>

        <div style={s.fg}>
          <label style={s.label}>Trailer Quote <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
          <textarea rows={2} style={{ ...s.textarea, minHeight: 0, fontFamily: 'inherit' }} value={form.trailerQuote}
            placeholder="One striking line from the story, quoted verbatim…"
            onChange={e => setForm(f => ({ ...f, trailerQuote: e.target.value }))} />
          <div style={s.hint}>One striking line from the story, quoted verbatim. Powers the featured-story trailer. 8–20 words. Leave empty to skip this story in the trailer rotation.</div>
        </div>

        {/* COVER DESCRIPTOR — optional, and the hint says so twice on purpose. The generator
            treats absence as a finished design (the fleuron takes the space), so an editor
            with nothing good must feel free to leave it alone rather than pad it out. */}
        <div style={s.fg}>
          <label style={s.label}>Cover Descriptor <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
          <input style={s.input} value={form.descriptor}
            placeholder="duty. sacrifice. ruin."
            onChange={e => setForm(f => ({ ...f, descriptor: e.target.value }))} />
          <div style={s.hint}>
            Three punchy words for the cover, each followed by a full stop &mdash; <em>duty. sacrifice. ruin.</em> &middot;
            {' '}<em>birth. rhythm. farewell.</em> &middot; <em>rain. repetition. dread.</em><br />
            Drawn from the story&rsquo;s own themes, mostly abstract nouns with the occasional concrete one.
            Never repeat a word from the title.<br />
            <strong>Leave it empty and the cover is still finished</strong> &mdash; the fleuron takes the space. Empty is a design, not a gap.<br />
            <span style={{ color: '#c4b5fd' }}>Changing these words queues a new cover.</span> The words and the cover that
            carries them land together, so the story never claims three words no reader can see. Usually about fifteen minutes.
          </div>
          {(() => {
            const v = validateDescriptor(form.descriptor);
            if (!v.ok) return <div style={{ ...s.hint, color: '#ff8080' }}>{v.error}</div>;
            if (v.empty) return null;
            const echo = wordsEchoingTitle(form.descriptor, form.title);
            const canon = canonicalDescriptor(form.descriptor);
            return (
              <div style={{ ...s.hint, color: echo.length ? '#e8b64c' : 'rgba(255,255,255,0.45)' }}>
                {echo.length
                  ? `Heads up: ${echo.join(', ')} already appears in the title. The rubric says not to repeat one \u2014 you can still save.`
                  : `Stored as \u201c${canon}\u201d, set on the cover as \u201c${canon.toUpperCase()}\u201d.`}
              </div>
            );
          })()}
        </div>

        <div style={s.formActions}>
          <button style={s.btnGhost} onClick={onCancel}>Cancel</button>
          <button style={{ ...s.btn, opacity: saving ? 0.6 : 1 }} onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : saveLabel}
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
  // W6 (ADM-24): a failed load is drawn, never "No stories yet".
  const [loadFail, setLoadFail] = useState(null);
  // W6 (ADM-05): stories the scheduled-publish Worker refused to publish coverless.
  const [skips, setSkips] = useState([]);
  // W6 (ADM-10): the site's side of the last action — { stage, done, verdict }.
  const [rebuild, setRebuild] = useState(null);
  const [editingId, setEditingId] = useState(null);
  // Stable-identity rosters for the author picker.
  const [roster, setRoster] = useState([]);       // [{ uid, displayName, username }]
  const [guestList, setGuestList] = useState([]);  // [{ guestId, name }]

  const emptyForm = {
    title: '', selectedAuthor: '', category: 'flash', subcategory: '',
    date: formatDate(new Date()), coverFilename: '', coverPreview: null, coverHash: '', coverSizes: null,
    content: '', publishAt: '', epubUrl: '', epubUpdatedAt: null, readerMode: false, bookReader: false, prosePoetry: false, featuredPin: false,
    extractedText: '',
    authorHandle: '', handleInput: '', resolvedHandle: null, handleError: '',
    trailerQuote: '', descriptor: '', published: true, coverHold: false,
    // W6: the record's own status when the editor opened (app/lib/storyState.js), and the
    // editor's answer when they remove a scheduled story's schedule.
    recordStatus: null, recordStatusLine: '', unscheduleAs: null,
    slug: '', // W1 / ADM-08 — a NEW story's accepted free address; '' = slugify(title)
  };
  const [form, setForm] = useState(emptyForm);
  const [filter, setFilter] = useState('all'); // all · published · hidden
  const [pendingCount, setPendingCount] = useState(0); // Open Pages awaiting moderation

  const isAdmin = user && (user.uid === 'XaG6bTGqdDXh7VkBTw4y1H2d2s82' || user.uid === 'GfXFIc0dThZ1cs2SBBQIFao4aSz1' || (user.email && user.email.toLowerCase() === ADMIN_EMAIL));

  // Open Pages moderation queue depth, for the header badge. Rules allow the
  // pending node only to the two admin UIDs, so an email-only admin just gets
  // no badge rather than an error — the link itself still works.
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'open_pages_pending'));
        setPendingCount(snap.exists() ? Object.keys(snap.val() || {}).length : 0);
      } catch (e) {
        console.error('[admin] pending count unavailable:', e);
      }
    })();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        // Top-level users read is blocked by rules — derive the roster from the
        // authorUids actually used across stories, then read each user per-uid.
        const [storiesSnap, guestsSnap] = await Promise.all([
          get(ref(db, 'cms_stories')),
          get(ref(db, 'cms_authors')),
        ]);
        const uidSet = new Set();
        if (storiesSnap.exists()) {
          Object.values(storiesSnap.val()).forEach(st => {
            const u = (st && st.authorUid ? String(st.authorUid) : '').trim();
            if (u) uidSet.add(u);
          });
        }
        const rosterArr = (await Promise.all([...uidSet].map(async uid => {
          try {
            const snap = await get(ref(db, `users/${uid}`));
            if (!snap.exists()) return null;
            const u = snap.val() || {};
            return { uid, displayName: u.displayName || '(unknown user)', username: u.username || '' };
          } catch (e) { return null; }
        }))).filter(Boolean);
        rosterArr.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setRoster(rosterArr);

        const gv = guestsSnap.exists() ? guestsSnap.val() : {};
        const guestArr = Object.entries(gv)
          .map(([guestId, g]) => ({ guestId, name: (g && g.name) || '(unnamed)' }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setGuestList(guestArr);
      } catch (e) {}
    })();
    loadStories();
  }, [isAdmin]);

  async function loadStories() {
    setLoading(true);
    setLoadFail(null);
    try {
      const { ref, get } = await import('firebase/database');
      const snap = await readWithDeadline(() => get(ref(db, 'cms_stories')));
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
      // The skip alerts are a second, smaller read; their failure must not blank the list.
      try {
        const sk = await readWithDeadline(() => get(ref(db, 'ops/publish_skips')));
        setSkips(sk.exists() ? Object.values(sk.val() || {}) : []);
      } catch (e) { console.warn('[admin] publish-skip alerts could not be read', e); }
    } catch (e) {
      console.warn('[admin] stories load failed', e);
      setLoadFail(e?.kind || classifyFailure(e));
    }
    setLoading(false);
  }

  async function dismissSkip(slug) {
    try {
      const { ref, remove } = await import('firebase/database');
      await remove(ref(db, `ops/publish_skips/${slug}`));
      setSkips((list) => list.filter((k) => k.slug !== slug));
    } catch (e) { setMsg(`✗ The alert for ${slug} was not dismissed — ${e.message}`); }
  }

  // W6 (ADM-10) — THE SITE'S SIDE OF AN ACTION. Runs AFTER the record write has succeeded and
  // been reported, so the save never waits on it (before W6 the 10 s settle blocked "Saving…").
  // "live" is said only when a NEW build is being served; see app/lib/rebuildWatch.js.
  async function rebuildAfter(done) {
    const before = await liveBuildId();
    setRebuild({ stage: 'building', done });
    const verdict = await fireRebuild({ hook: HOOKS.CMS, getIdToken: () => user?.getIdToken() });
    if (!verdict.ok) { setRebuild({ stage: 'refused', done, verdict }); return; }
    if (!before) { setRebuild({ stage: 'unverified', done }); return; }
    const w = await waitForNewBuild(before);
    setRebuild({ stage: w.live ? 'live' : 'timeout', done });
  }

  const saveStory = async () => {
    if (!form.title.trim()) { setMsg('Title is required.'); return; }
    const isEpubCategory = form.category === 'poetry' || form.category === 'novel' || form.category === 'short';
    if (!form.content.trim() && !(isEpubCategory && form.epubUrl)) { setMsg('Content is required (or upload an EPUB for Poetry/Novel/Short Story).'); return; }
    // ── THE COVER IS NO LONGER SOMETHING AN EDITOR SUPPLIES ────────────────────────────
    // Standing rule (CLAUDE.md): every published cms_stories cover is GENERATED by
    // scripts/covers — deterministic, offline, no artwork. Requiring an upload here made an
    // editor pick an image that the reconciler then replaced, and it is how the three live
    // non-typographic covers got in (safety-net, the-other-woman, when-the-technology-…).
    // The field is kept for a deliberate override; it is not a gate any more.
    //
    // A story saved without a generated cover is HELD rather than published — see the
    // coverHold block below. Nothing goes live coverless.

    // Derive author identity from the stable selection token — never from a typed name.
    let authorUid = '', authorGuestId = null, authorName = '', defaultHandle = '';
    const sel = form.selectedAuthor || '';
    if (sel.startsWith('uid:')) {
      authorUid = sel.slice(4);
      const r = roster.find(x => x.uid === authorUid);
      authorName = (r && r.displayName) || form.author || '';
      defaultHandle = (r && r.username) || '';
    } else if (sel.startsWith('guest:')) {
      authorGuestId = sel.slice(6);
      const g = guestList.find(x => x.guestId === authorGuestId);
      authorName = (g && g.name) || form.author || '';
      defaultHandle = '';
    } else if (sel === 'newhandle') {
      if (!form.resolvedHandle || !form.resolvedHandle.uid) { setMsg('Resolve the @handle (or pick an author) before saving.'); return; }
      authorUid = form.resolvedHandle.uid;
      authorName = form.resolvedHandle.displayName || form.author || '';
      defaultHandle = form.resolvedHandle.username || '';
    } else {
      setMsg('Select an author before saving.'); return;
    }
    const authorHandle = (form.authorHandle || '').trim() || defaultHandle || '';

    // ── W6: WHAT THIS SAVE IS, DECIDED BEFORE ANYTHING IS WRITTEN ─────────────────────
    // The story's status as it stands (app/lib/storyState.js), and the two refusals.
    const prevRec = editingId ? (stories.find(x => x.id === editingId) || null) : null;
    const prevStatus = prevRec ? storyStatus(prevRec) : null;
    const publishAtMs = form.publishAt ? new Date(form.publishAt).getTime() : null;
    const schedulingAhead = Number.isFinite(publishAtMs) && publishAtMs > Date.now() && prevStatus !== 'live';
    // ADM-06: removing the schedule from a SCHEDULED story needs a choice, and says which.
    const unscheduling = prevStatus === 'scheduled' && !form.publishAt;
    const unschedule = unscheduling ? unscheduleDecision(form.unscheduleAs || null) : null;
    if (unschedule?.refusal) { setMsg(unschedule.refusal); return; }
    // ADM-05 (ruled 25 Sep): no schedule a cover cannot make in time.
    const scheduleChanged = !prevRec || new Date(prevRec.publishAt || 0).getTime() !== publishAtMs;
    if (schedulingAhead && scheduleChanged) {
      const refusal = scheduleRefusal({ publishAtMs, cover: form.coverFilename });
      if (refusal) { setMsg(refusal); return; }
    }

    setSaving(true); setMsg('');
    try {
      const { ref, get, update } = await import('firebase/database');
      // ── W1 / ADM-08 — A NEW STORY NEVER OVERWRITES ONE THAT EXISTS ─────────
      // The write below MERGES into cms_stories/{slug}, so a new title that slugs onto
      // a live story's address would silently become that story. Asked of the LIVE
      // node (not the list loaded when the page opened), before anything is written;
      // a taken address is refused with the first free one offered, and an empty one
      // (a title of only punctuation) is refused outright. Edits keep their own slug.
      let slug = editingId;
      if (!editingId) {
        const isTaken = async (candidate) => (await get(ref(db, `cms_stories/${candidate}`))).exists();
        const verdict = await newStorySlug({ title: form.title, chosen: form.slug, isTaken });
        if (!verdict.ok) {
          setSaving(false);
          if (verdict.reason === 'empty') {
            setMsg('✗ Not saved — this title makes no web address (it needs at least one letter a–z or digit). Add one to the title and save again.');
          } else {
            const owner = (await get(ref(db, `cms_stories/${verdict.slug}/title`))).val();
            setForm(f => ({ ...f, slugOffer: verdict.offer }));
            setMsg(`✗ Not saved — /stories/${verdict.slug} already belongs to ${owner ? `“${owner}”` : 'another story'}, and saving would overwrite it. `
              + (verdict.offer ? `Change the title, or use the free address /stories/${verdict.offer} below.` : 'Change the title and save again.'));
          }
          return;
        }
        slug = verdict.slug;
      }
      const categoryObj = CATEGORIES.find(c => c.value === form.category);
      const coverFilename = form.coverFilename.trim();
      const coverPath = coverFilename.startsWith('http') ? coverFilename : (coverFilename.startsWith('/') ? coverFilename : `/${coverFilename}`);
      const storyData = {
        title: form.title.trim(),
        author: authorName,
        authorHandle: authorHandle,
        authorUid: authorUid,
        authorGuestId: authorGuestId, // null for non-guest → removed by set()
        category: form.category,
        categoryName: categoryObj.label,
        subcategory: form.subcategory || '',
        date: form.date,
        content: convertToHTML(form.content.trim()),
        cover: coverPath,
        coverHash: form.coverHash || '',
        coverSizes: form.coverSizes || null, // sibling of cover; null → removed by the overwrite
        url: `/stories/${slug}`,
        // New/scheduled stories derive published from publishAt (unchanged). Edits
        // preserve the existing flag so saving never hides or unhides a story.
        // W6: an un-schedule publishes or hides BY THE EDITOR'S CHOICE (unscheduleDecision), and a
        // new future schedule on a story that is not live leaves it unpublished until its time.
        published: unschedule ? unschedule.published
          : schedulingAhead ? false
          : editingId ? (form.published !== false) : true,
        epubUrl: form.epubUrl || '',
        readerMode: form.readerMode || false,
        prosePoetry: form.prosePoetry || false,
        featuredPin: form.featuredPin || false,
        extractedText: form.extractedText || '',
        trailerQuote: form.trailerQuote?.trim() || '',
        // NOTE: `descriptor` is deliberately ABSENT from this object. See the
        // descriptorPending block further down — the words are not allowed to reach the
        // record ahead of the cover that shows them.
      };
      // These three were previously written only when truthy, letting the wholesale
      // overwrite delete them when absent. The write is now per-field (below), so
      // "absent" has to be said out loud: an explicit null deletes the child and is
      // indistinguishable from never having been written. bookReader stays true-or-
      // nothing, so the stories that are not book-reader titles get no schema churn.
      storyData.epubUpdatedAt = form.epubUpdatedAt || null;
      storyData.bookReader = form.bookReader ? true : null;
      storyData.publishAt = form.publishAt ? new Date(form.publishAt).toISOString() : null;

      // ── coverHold — HOW A STORY IS KEPT FROM GOING LIVE WITHOUT ITS COVER ───
      // The generator cannot run here. It is @napi-rs/canvas, a native N-API addon
      // pinned exactly at 1.0.6 because the title auto-sizer must measure with the
      // engine that draws; this file is a browser client, and every live endpoint is
      // a Cloudflare Pages Function on workerd, which loads no native addons at all.
      // So the cover is generated out of band by scripts/covers/on-publish.mjs,
      // running on a Node worker (.github/workflows/covers.yml).
      //
      // The ruling is that a story must never publish with NO cover and never with a
      // STALE one, so the publish path's job is not to generate — it is to REFUSE.
      // A story with no generated cover is saved as a draft carrying coverHold, and
      // the reconciler publishes it IN THE SAME ATOMIC PATCH that gives it a cover.
      // There is no instant at which it is visible and coverless. If generation
      // fails, it stays a draft and the workflow goes red: late, never wrong.
      //
      // coverHold is what tells the reconciler this draft is WAITING rather than
      // HIDDEN. A story an editor hid with the Hide button has published:false and
      // no hold, and is never un-hidden by a robot.
      //
      // ── AND THE ASYMMETRY, WHICH IS DELIBERATE ─────────────────────────────
      // Only a story that is not already live can be held. Un-publishing a LIVE
      // story to wait for a regenerated cover would pull it off the site over a
      // cosmetic edit — worse than the staleness it prevents. A live story whose
      // title changed keeps its own last-good typographic cover until the next
      // reconcile. The one thing that never waits with it is the descriptor, which
      // is the only field that can be stale ON THE COVER ITSELF — see below.
      // ── WHO GETS HELD, AND THE THREE CASES THAT MUST NOT ──────────────────
      //   HELD      a story with no generated cover that is meant to be seen.
      //   NOT HELD  one already LIVE — un-publishing it over a cosmetic edit is
      //             worse than the staleness it prevents;
      //   NOT HELD  one an editor deliberately HID — holding it would hand the
      //             reconciler a story to publish that a person took down;
      //   STILL HELD a story that is ALREADY held and is being edited again. It
      //             also has published:false, which is why the hold has to be
      //             read off the record rather than inferred from that flag.
      //
      // A SCHEDULED new story IS held, and that is not a contradiction: the hold
      // is about the cover, not the clock. The reconciler gives it a cover and
      // releases the hold WITHOUT publishing (see extraFields in on-publish.mjs),
      // so the external scheduled-publish Worker flips it on time onto a cover
      // that already exists.
      const hasGeneratedCover = /covers-typographic/.test(coverPath);
      const isLive = !!editingId && prevStatus === 'live';
      // W6: an editor who just chose "publish it now" on an un-schedule, or who scheduled a story
      // ahead, has not hidden it — and a story they did hide stays unheld.
      const deliberatelyHidden = !!editingId && storyData.published === false && !form.coverHold
        && !schedulingAhead && !(unschedule && unschedule.published);
      const holdForCover = !hasGeneratedCover && !isLive && !deliberatelyHidden;
      if (holdForCover) {
        storyData.published = false;
        storyData.coverHold = true;
      } else {
        // Explicit null, not omission: the write is per-field, so "no longer held"
        // has to be said out loud or a stale hold would survive on the record.
        storyData.coverHold = null;
      }

      // ── hiddenAt (W6, ADM-04) — the mark that makes a Hide stick ───────────────────────
      // Written only when this save decides it: an un-schedule the editor chose to keep hidden
      // sets it; a fresh schedule, or "publish it now", clears it. Any other save leaves the
      // record's own value alone (it is not in the form), so editing a hidden story keeps it hidden.
      if (unschedule?.hide) storyData.hiddenAt = Date.now();
      else if (schedulingAhead || (unschedule && unschedule.published) || storyData.published === true) storyData.hiddenAt = null;

      // ── publishedAtMs — the field the free-window gate stands on ────────────
      // Epoch ms, UTC, a NUMBER. Derived by app/lib/storyAccess.js from the two
      // fields just written above, so the composer, scripts/backfill-published-at.mjs
      // and the serving endpoint all reach the same instant for the same story.
      // See STORY-SERVING-CONTRACT.md §2.
      //
      // It is derived AFTER publishAt is normalised, deliberately: publishAt takes
      // precedence over the hand-typed display date, and reading form.publishAt (a
      // datetime-local string) instead of the ISO value would hand the parser a
      // different string than the one the record ends up carrying.
      //
      // THE NEW-STORY FALLBACK. `date` is a free-text field whose only guidance is a
      // placeholder, so a typo makes it unparseable and publishedAtMsFor answers
      // null. For a story being created RIGHT NOW that is recoverable without a
      // guess — it is being published now, so `now` is the fact, not an estimate.
      // For an EDIT it is not: stamping an unparseable archive story with today's
      // clock would drop it into the free window, so an edit keeps whatever it had
      // and the admin is told below. That asymmetry is the whole reason this is not
      // one line.
      const derivedPublishedAt = publishedAtMsFor(storyData);
      if (derivedPublishedAt !== null) {
        storyData.publishedAtMs = derivedPublishedAt;
      } else if (!editingId) {
        storyData.publishedAtMs = Date.now();
      }

      // ── Why this is a per-field write and not a node overwrite ──────────────
      // It used to be `cms_stories/${slug}: storyData` — a path→object value, which
      // replaces the node WHOLESALE. storyData is the editor's form, so every field
      // living on the node that the form does not own was deleted on every save.
      // That is how 16 approved quizzes lost their quizMeta and stopped being
      // advertised (the story page still rendered the card — QuizCard reads
      // cms_quizzes itself — so readers kept taking quizzes that no pill, no
      // /quizzes row and no library badge pointed at). Live today: quizMeta on 134
      // stories, plus pdfUrl, reads and ageRestricted.
      //
      // The fix is NOT read-merge-write. `record-attempt` increments
      // cms_stories/<slug>/quizMeta/attemptCount with a server-side {'.sv': increment}.
      // Reading that counter and writing it back across an await silently reverses
      // any increment a reader landed in between — one admin and one reader is
      // enough. Writing one path per owned field never reads the counter and never
      // touches a field the form does not own, so the race cannot arise.
      // ── THE VALIDATION GATE, AT THE ONE MOMENT IT IS CHEAP TO OBEY ─────────
      // The preview cutter refuses to cut a body it cannot prove well-formed, and
      // the endpoint's refusal is a 500 the reader can do nothing about
      // (STORY-SERVING-CONTRACT.md §5.5). This is the same check, run here, where
      // the person who can actually fix it is looking at the editor.
      //
      // REFUSES THE SAVE rather than warning past it. A warning would be dismissed
      // and the story would ship un-previewable; the six bodies R11.8a had to repair
      // by script all got in through a door with no check on it.
      //
      // Reader-mode stories are exempt because they have no HTML body to cut — their
      // text is the uploaded EPUB.
      if (!storyData.readerMode && storyData.content) {
        const check = validateBody(storyData.content);
        if (!check.ok) {
          setSaving(false);
          setMsg(`✗ Not saved — the story HTML is malformed and could not be previewed: ${check.error}.`
            + (check.detail?.excerpt ? ` Near: "${String(check.detail.excerpt).replace(/\s+/g, ' ').trim().slice(0, 90)}"` : ''));
          return;
        }
      }

      const ownedPaths = {};
      for (const [k, v] of Object.entries(storyData)) ownedPaths[`cms_stories/${slug}/${k}`] = v;

      // The read below is for the INDEX PROJECTION ONLY — never written back to
      // cms_stories. buildIndexRecord derives the index's quiz badge from quizMeta,
      // which the form does not carry; projecting from storyData alone is what
      // dropped the badge in lockstep with the record and made the loss invisible to
      // a drift check. attemptCount is deliberately excluded from the projection
      // (see storyIndex.js), so a stale read here cannot move a counter.
      const prevSnap = await get(ref(db, `cms_stories/${slug}`));
      const prev = prevSnap.val() || {};
      const projected = { ...prev, ...storyData };

      // ── THE DESCRIPTOR GOES TO A PENDING SLOT, NEVER STRAIGHT TO THE RECORD ─
      // The three words are the one editable field that is PRINTED ON THE COVER.
      // Writing them here and regenerating the cover minutes later would leave a
      // window in which the record claims "duty. sacrifice. ruin." over a cover
      // showing no such words — a story lying about itself on every surface that
      // reads the record. That window is exactly what the migration's --descriptors
      // ingest was built to avoid: it put the words and the picture in ONE patch.
      //
      // So an edit lands on descriptorPending. scripts/covers/on-publish.mjs renders
      // WITH those words, then moves them into `descriptor` in the same atomic patch
      // as the cover that displays them. Until that moment the record still says
      // exactly what the cover says.
      //
      // Written only when the value actually CHANGES. An unchanged descriptor
      // re-queued on every save would make every story look stale to the reconciler
      // and churn a re-upload for an identical image. `prev.descriptorPending` is
      // compared too, so re-saving a story whose words are still in the queue does
      // not silently drop them back to the old value.
      const nextDescriptor = canonicalDescriptor(form.descriptor);
      const settledDescriptor = prev.descriptorPending ?? prev.descriptor ?? '';
      const descriptorPaths = nextDescriptor === settledDescriptor
        ? {}
        : { [`cms_stories/${slug}/descriptorPending`]: nextDescriptor };
      // The projection must not pretend the words have landed — the index does not
      // carry `descriptor` at all, but `projected` is also what the preserved-field
      // report reads, and a phantom field there would read as a loss.
      const descriptorQueued = Object.keys(descriptorPaths).length > 0;

      // Say what survived. The value of a per-field write is the fields nobody has
      // invented yet, and a silent preserve is how the next one hides — so the
      // expected four are logged, and anything else is raised where an admin can
      // see it rather than left to a drift check months later.
      // publishedAtMs joins the list because it is legitimately preserved on ONE path:
      // an edit whose `date` no longer parses (see the derivation above) keeps the
      // value it already had rather than being restamped with today's clock. That is
      // the intended behaviour, so it must not read as an unrecognised field — but it
      // does need saying out loud, which the dateWarning below does.
      // `descriptor` and `descriptorPending` join this list because the form no longer
      // owns them: the words are queued below and moved onto the record by the cover
      // reconciler. They ARE preserved on every save, and that is the intended
      // behaviour rather than a field quietly going missing.
      const PRESERVED_EXPECTED = ['quizMeta', 'pdfUrl', 'reads', 'ageRestricted', 'publishedAtMs',
        'descriptor', 'descriptorPending', 'hiddenAt'];
      const preserved = Object.keys(prev).filter(k => !(k in storyData));
      const unexpected = preserved.filter(k => !PRESERVED_EXPECTED.includes(k));
      if (preserved.length) console.info(`[admin/save] ${slug}: preserved ${preserved.length} field(s) the editor does not own — ${preserved.join(', ')}`);
      if (unexpected.length) console.warn(`[admin/save] ${slug}: UNEXPECTED preserved field(s) — ${unexpected.join(', ')}. Not written by this form and not in the known set; confirm they belong on cms_stories and add them to PRESERVED_EXPECTED.`);

      // ── THE BODY, WRITTEN TWICE, IN THE SAME UPDATE ────────────────────────
      // Phase T1 of the gating work (STORY-SERVING-CONTRACT.md §7). The body now
      // lives at story_bodies/<slug> — a node with `.read: false`, served only by
      // /api/story with an admin token — while cms_stories keeps its copy so that
      // already-deployed app versions, which read that node directly and cannot be
      // updated, do not lose their story text the day the endpoint ships.
      //
      // BOTH COPIES GO IN THE SAME MULTI-PATH UPDATE, for exactly the reason the
      // index does: a save that writes one node and not the other leaves a story
      // whose gated body disagrees with its public one, and nothing would report
      // it. RTDB applies a multi-path update atomically, so there is no window in
      // which they can differ. scripts/backfill-story-bodies.mjs --verify is the
      // standing check.
      //
      // extractedText travels WITH content and is not optional: it is the second
      // copy of the body (the EPUB's plain text, read by generate-quiz.js for
      // reader-mode stories). Moving one without the other gates the story and
      // publishes the story.
      const bodyPaths = {
        [`story_bodies/${slug}/content`]: storyData.content,
        [`story_bodies/${slug}/extractedText`]: storyData.extractedText,
      };

      // Atomic dual-write: the owned fields, the slim index entry and the gated
      // body copy land in ONE multi-path update so they can never half-write. A
      // hidden next-state removes the index entry (see indexUpdatePaths).
      await update(ref(db), {
        ...ownedPaths,
        ...descriptorPaths,
        ...indexUpdatePaths(slug, projected),
        ...bodyPaths,
      });
      // Notify followers of this author when the story GOES LIVE with this save — not on every
      // later edit of a live story (before W6, each "Update Story" re-notified every follower).
      //
      // A story HELD for its cover is not live, so a notification here would send
      // every follower to a story that does not exist yet. The notification travels
      // with the publication instead: scripts/covers/on-publish.mjs sends it in the
      // run that flips the cover and publishes the story. Same rule as the index —
      // whatever announces a story must not outrun the story.
      const goesLiveNow = !holdForCover && storyData.published === true && prevStatus !== 'live';
      let notifyNote = '';
      if (goesLiveNow && authorUid) {
        // W6 (ADM-10): counted, not swallowed — "N notified / N failed".
        try {
          const { get: getSnap, push: pushNotif } = await import('firebase/database');
          const followersSnap = await getSnap(ref(db, `followers/${authorUid}`));
          const followerIds = followersSnap.exists() ? Object.keys(followersSnap.val()) : [];
          const results = await Promise.allSettled(followerIds.map(fid => pushNotif(ref(db, `library_notifications/${fid}`), {
            type: 'new_story', fromUid: authorUid,
            fromName: storyData.author,
            storySlug: slug, storyTitle: storyData.title,
            read: false, createdAt: Date.now(),
          })));
          const failedN = results.filter(r => r.status === 'rejected').length;
          notifyNote = followerIds.length === 0 ? '  No followers to notify.'
            : failedN ? `  ⚠ ${followerIds.length - failedN} follower(s) notified, ${failedN} NOT notified.`
            : `  ${followerIds.length} follower(s) notified.`;
        } catch (e) {
          notifyNote = `  ⚠ Followers were NOT notified — their list could not be read (${e.message}).`;
        }
      }
      const isScheduled = schedulingAhead;
      // An unexpected preserved field is surfaced HERE, not just in the console —
      // the console is where the last silent field loss hid for three months.
      const preservedNote = unexpected.length ? `  ⚠ Preserved unrecognised field(s): ${unexpected.join(', ')} — confirm they belong on cms_stories.` : '';
      // The date field is free text and nothing validates it. When it stops parsing,
      // the story quietly keeps its old publication instant (or, on a new story, gets
      // today's) — and the free-window gate runs off that number. Silent is exactly
      // what this must not be, so it is said in the admin's own message, not a console
      // line nobody opens.
      const dateWarning = derivedPublishedAt === null
        ? (editingId
          ? `  ⚠ "${form.date}" could not be read as a date — publication instant left unchanged. Use "Mar 29, 2026".`
          : `  ⚠ "${form.date}" could not be read as a date — publication instant set to now. Use "Mar 29, 2026".`)
        : '';
      // ── SAY WHAT ACTUALLY HAPPENED, NOT WHAT THE BUTTON SAID ───────────────
      // A story held for its cover has NOT been published, and telling an editor it
      // has is the one thing this must not do. The hold is a normal, expected state
      // — most new stories will pass through it — so the wording is a status, not an
      // apology. W6: nor is anything "published" until the site is rebuilt — the record half
      // is said here, and the site half by the rebuild line (rebuildAfter) when it knows.
      const nextStatus = holdForCover ? 'waiting_cover' : storyStatus({ ...prev, ...storyData });
      const needsRebuild = prevStatus === 'live' || nextStatus === 'live';
      const done = unschedule?.published ? 'Unscheduled and published'
        : nextStatus === 'live' ? (prevStatus === 'live' ? 'Updated' : 'Published') : null;
      const headline = holdForCover
        ? '◷ Saved, and held for its cover. It is NOT live yet — the cover is generated off-site and the story publishes itself the moment it lands (usually within about fifteen minutes). Nothing goes live without its cover.'
        : isScheduled
          ? `⏰ Scheduled for ${new Date(form.publishAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })} (London).`
            + (storyData.coverHold ? ' Its cover is still being made; if it is not ready by then, the story will NOT publish and an alert will appear here.' : '')
          : unschedule?.hide ? '✓ Unscheduled, and hidden. It will not publish until you schedule it again or unhide it.'
          : done ? `✓ ${done} in the database.`
          : `✓ Saved. ${statusLine({ ...prev, ...storyData })}.`;
      const descriptorNote = descriptorQueued && !holdForCover
        ? `  ✎ The descriptor is queued: it appears on the record and on the cover together, when the cover regenerates. Until then the story still shows the words its current cover shows.`
        : '';
      setMsg(headline + notifyNote + descriptorNote + preservedNote + dateWarning);
      setForm(emptyForm); setEditingId(null); setView('list');
      loadStories();
      // Not awaited: the save is done and said; the site's half reports itself when it knows.
      if (needsRebuild) rebuildAfter(done || 'Saved');
    } catch (e) { setMsg('Error saving: ' + e.message); }
    setSaving(false);
  };

  async function deleteStory(id) {
    if (!confirm('Delete this story? This cannot be undone.')) return;
    try {
      const { ref, update } = await import('firebase/database');
      // Atomic: drop the full record, its index entry and its gated body together.
      // story_bodies joins the set for the same reason the index did — a body left
      // behind for a story that no longer exists is an orphan nothing would ever
      // report, on a node no surface reads from. It is not dangerous; it is a lie
      // about what exists, and the backfill's --verify counts it as one.
      await update(ref(db), {
        [`cms_stories/${id}`]: null,
        [`cms_stories_index/${id}`]: null,
        [`story_bodies/${id}`]: null,
        [`ops/publish_skips/${id}`]: null,
      });
      setMsg('✓ Story deleted from the database.'); loadStories();
    } catch (e) { setMsg(`✗ Story NOT deleted — ${e.message}`); return; }
    // W6: its page stops existing only when the site is rebuilt.
    rebuildAfter('Deleted');
  }

  // Targeted field update — never rewrites the whole story object.
  async function hideStory(id) {
    if (!confirm('Hide this story? It disappears from the platform immediately but keeps all data (reads, comments, quotes). Unhide anytime.')) return;
    try {
      const { ref, update } = await import('firebase/database');
      // W6 (ADM-04): published:false AND hiddenAt, with the (now-ineligible) index entry removed,
      // in one atomic update. hiddenAt is what stops the scheduled-publish Worker republishing a
      // story that carries a past publishAt on its next tick (app/lib/storyState.js).
      await update(ref(db), hidePaths(id));
      setMsg('✓ Story hidden. It stays hidden until you unhide it — the scheduled publisher will not bring it back.'); loadStories();
    } catch (e) { setMsg(`✗ Story NOT hidden — ${e.message}`); return; }
    rebuildAfter('Hidden');
  }

  async function unhideStory(id) {
    let live = false;
    try {
      const { ref, update, get } = await import('firebase/database');
      // Unhide needs the full record to rebuild the index entry, so read it,
      // then flip published + re-project the index entry in one atomic update.
      // W6: a story with no generated cover is HELD instead of published (unhidePlan).
      const snap = await get(ref(db, `cms_stories/${id}`));
      const plan = unhidePlan(id, snap.val() || {});
      live = plan.live;
      const full = { ...(snap.val() || {}), published: plan.live, hiddenAt: null };
      await update(ref(db), { ...plan.paths, ...indexUpdatePaths(id, full) });
      setMsg(plan.live
        ? '✓ Story unhidden in the database.'
        : '◷ Unhidden, and held for its cover: it has no generated cover yet, so it publishes itself when the cover lands (usually about fifteen minutes).');
      loadStories();
    } catch (e) { setMsg(`✗ Story NOT unhidden — ${e.message}`); return false; }
    if (live) rebuildAfter('Unhidden');
    return live ? 'live' : 'held';
  }

  // Unhide from within the editor, keeping the current edit session open.
  async function unhideFromEditor() {
    if (!editingId) return;
    const outcome = await unhideStory(editingId);
    if (outcome === 'live') setForm(f => ({ ...f, published: true, recordStatus: 'live' }));
    if (outcome === 'held') setForm(f => ({ ...f, coverHold: true, recordStatus: 'waiting_cover' }));
  }

  function openEdit(story) {
    // Preserve existing (backfilled) attribution by stable id — never re-derive by name.
    const selectedAuthor = story.authorGuestId
      ? `guest:${story.authorGuestId}`
      : (story.authorUid ? `uid:${story.authorUid}` : '');
    setForm({
      title: story.title, author: story.author || '', category: story.category,
      subcategory: story.subcategory || '', date: story.date,
      coverFilename: story.cover, coverPreview: story.cover, coverHash: story.coverHash || '',
      // Preserve existing derivatives across an edit — a full-node overwrite that
      // dropped coverSizes would strip the srcset until the next cover re-upload.
      coverSizes: story.coverSizes || null,
      content: story.content, publishAt: story.publishAt ? toDatetimeLocal(new Date(story.publishAt)) : '',
      epubUrl: story.epubUrl || '',
      epubUpdatedAt: story.epubUpdatedAt || null,
      readerMode: story.readerMode || false,
      // bookReader is authored app-side, not by this form, but the save is a full-node
      // overwrite — without carrying it through, editing a bookReader story here would
      // silently delete the flag from cms_stories AND its index entry. Same hazard the
      // coverSizes line above guards against.
      bookReader: story.bookReader || false,
      prosePoetry: story.prosePoetry || false,
      featuredPin: story.featuredPin || false,
      extractedText: story.extractedText || '',
      authorHandle: story.authorHandle || '',
      selectedAuthor,
      handleInput: '', resolvedHandle: null, handleError: '',
      trailerQuote: story.trailerQuote || '',
      // The pending words win: they are what this editor last typed and what the next
      // cover will carry. Showing the settled `descriptor` instead would present a
      // queued edit as if it had been discarded, and re-saving would then revert it.
      descriptor: story.descriptorPending ?? story.descriptor ?? '',
      published: story.published,
      // Carried so the save path can tell a story WAITING for its cover from one an
      // editor deliberately hid. Both have published:false; only one may be published
      // by a robot.
      coverHold: story.coverHold === true,
      recordStatus: storyStatus(story), recordStatusLine: statusLine(story), unscheduleAs: null,
    });
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

  // W6 (ADM-07): ONE status per story, from app/lib/storyState.js — the same one the editor shows.
  // A past publishAt is history: before W6 the counts treated it as a schedule's shadow.
  // A story HELD for its cover has published:false and is not hidden — it is waiting, and
  // it will publish itself. Filing it under Hidden would put a story the editor just saved
  // into the drawer they use for things they deliberately took down.
  const statusOf = st => storyStatus(st);
  const isHiddenRow = st => statusOf(st) === 'hidden';
  const liveCount = stories.filter(st => statusOf(st) === 'live').length;
  const scheduledCount = stories.filter(st => statusOf(st) === 'scheduled').length;
  const hiddenCount = stories.filter(isHiddenRow).length;
  const publishedCount = stories.length - hiddenCount;
  const visibleStories = stories.filter(st =>
    filter === 'hidden' ? isHiddenRow(st) : filter === 'published' ? !isHiddenRow(st) : true);

  return (
    <div style={s.page}>
      {/* W4 — founders only; renders nothing for the admin email or anyone else. */}
      <div style={{ padding: '0.75rem 1.5rem 0' }}><GatePreviewToggle /></div>
      <header style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={s.sub}>Content Management</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>{user.email}</span>
          <a href="/admin/authors" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>Authors →</a>
          <a href="/admin/voices" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>Voices →</a>
          <a href="/admin/bookstore" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>Bookstore →</a>
          <a href="/admin/publishers" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>Publishers →</a>
          {/* R31 — /admin/series existed since R12.0 and was reachable only by typing the URL,
              which is why it was reported as missing rather than as broken. */}
          <a href="/admin/series" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>Series →</a>
          <a href="/admin/quizzes" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>Quizzes →</a>
          <a href="/admin/analytics" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>Analytics →</a>
          <a href="/admin/forum" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Moderation
            {pendingCount > 0 ? (
              <span style={{ background: '#b4442f', color: '#fff', borderRadius: 999, padding: '0.05rem 0.42rem', fontSize: '0.68rem', fontWeight: 700, lineHeight: 1.5 }}>
                {pendingCount}
              </span>
            ) : null}
            <span>→</span>
          </a>
          {/* W5 — the queue for reported comments, DMs and profiles. */}
          <a href="/admin/reports" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>Reports →</a>
          <a href="/" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← Site</a>
        </div>
      </header>
      <div style={s.body}>
        {(view === 'new' || view === 'edit') && (
          <StoryForm form={form} setForm={setForm} editingId={editingId}
            saving={saving} msg={msg} onSave={saveStory} onCancel={handleCancel}
            roster={roster} guestList={guestList}
            hidden={!!editingId && form.recordStatus === 'hidden'}
            onUnhide={unhideFromEditor} />
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
            {msg && <div role="status" style={s.msg}>{msg}</div>}
            {rebuild && (
              <div role={rebuild.stage === 'refused' || rebuild.stage === 'timeout' ? 'alert' : 'status'}
                style={{ ...s.msg, borderColor: rebuild.stage === 'live' ? 'rgba(134,239,172,0.5)' : rebuild.stage === 'building' || rebuild.stage === 'unverified' ? 'rgba(196,181,253,0.4)' : 'rgba(248,113,113,0.6)' }}>
                {rebuildLine(rebuild.stage, rebuild)}
                {(rebuild.stage === 'refused' || rebuild.stage === 'timeout') && (
                  <button style={{ ...s.btnGhost, marginLeft: '0.75rem' }} onClick={() => rebuildAfter(rebuild.done)}>Retry the rebuild</button>
                )}
              </div>
            )}
            {skips.length > 0 && (
              // W6 (ADM-05): the scheduled-publish Worker's alert. It did NOT publish these.
              <div role="alert" style={{ ...s.msg, borderColor: 'rgba(248,113,113,0.7)' }}>
                <strong>Not published — no cover.</strong> These stories reached their scheduled time without a generated cover, so the scheduled publisher skipped them. Each publishes itself as soon as its cover lands; if the cover worker is failing, that is what to fix.
                {skips.map(k => (
                  <div key={k.slug} style={{ marginTop: '0.4rem' }}>
                    “{k.title || k.slug}” — due {k.publishAt ? new Date(k.publishAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) : '(no time)'}
                    <button style={{ ...s.btnGhost, marginLeft: '0.6rem', padding: '0.2rem 0.6rem' }} onClick={() => dismissSkip(k.slug)}>Dismiss</button>
                  </div>
                ))}
              </div>
            )}
            <div style={s.filterRow}>
              {[
                { key: 'all', label: `All (${stories.length})` },
                { key: 'published', label: `Published (${publishedCount})` },
                { key: 'hidden', label: `Hidden (${hiddenCount})` },
              ].map(f => (
                <button key={f.key}
                  style={{ ...s.filterChip, ...(filter === f.key ? s.filterChipActive : {}) }}
                  onClick={() => setFilter(f.key)}>{f.label}</button>
              ))}
            </div>
            {loading
              ? <div style={s.empty}>Loading…</div>
              : loadFail
                ? <Unavailable kind={loadFail} onRetry={loadStories} subject="the stories" />
              : stories.length === 0
                ? <div style={s.empty}>No stories yet.<br />Hit "+ New Story" to publish your first.</div>
                : visibleStories.length === 0
                  ? <div style={s.empty}>No {filter} stories.</div>
                  : visibleStories.map(story => {
                    const st = statusOf(story);
                    const scheduled = st === 'scheduled';
                    const hidden = st === 'hidden';
                    // Held for a cover: not live, but not hidden either, and it will
                    // publish itself. Distinct from Hidden on purpose — an editor
                    // seeing "Hidden" on a story they just published would go looking
                    // for a bug that is not there.
                    const heldForCover = story.coverHold === true && st !== 'live';
                    return (
                      <div key={story.id} style={{ ...s.card, opacity: hidden ? 0.5 : scheduled ? 0.75 : 1 }}>
                        <img src={story.cover} alt={story.title} style={s.coverThumb} onError={e => { e.target.style.opacity = 0.2; }} />
                        <div style={s.cardInfo}>
                          <div style={s.cardTitle}>
                            {story.title}
                            <span style={s.badge}>{story.categoryName}</span>
                            {story.subcategory && <span style={s.badgeSub}>{story.subcategory}</span>}
                            {story.readerMode && <span style={s.badgeReader}>Book Reader</span>}
                            {scheduled && <span style={s.badgeScheduled}>Scheduled</span>}
                            {heldForCover
                              ? <span style={s.badgeHeld}>Cover pending</span>
                              : hidden && <span style={s.badgeHidden}>Hidden</span>}
                            {story.descriptorPending != null && !heldForCover
                              && <span style={s.badgeHeld}>Descriptor pending</span>}
                          </div>
                          <div style={s.cardMeta}>
                            By {story.author}{story.authorHandle ? ` (@${story.authorHandle})` : ''} · {story.date}
 · {statusLine(story)}
                            {st === 'live' && <> · <a href={story.url} target="_blank" rel="noreferrer" style={{ color: '#a78bfa', textDecoration: 'none' }}>View →</a></>}
                            {story.readerMode && <> · <a href={`/reader/${story.id}`} target="_blank" rel="noreferrer" style={{ color: '#fcd34d', textDecoration: 'none' }}>Book Reader →</a></>}
                          </div>
                        </div>
                        <div style={s.cardActions}>
                          <button style={s.btnGhost} onClick={() => openEdit(story)}>Edit</button>
                          {/* No Hide/Unhide while held: Unhide would publish the story
                              coverless, which is the one thing the hold exists to prevent,
                              and Hide would race the reconciler for the same flag. */}
                          {heldForCover ? null : hidden
                            ? <button style={s.btnUnhide} onClick={() => unhideStory(story.id)}>Unhide</button>
                            : <button style={s.btnGhost} onClick={() => hideStory(story.id)}>Hide</button>}
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