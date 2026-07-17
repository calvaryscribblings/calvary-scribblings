'use client';
import { useState, useEffect } from 'react';
import { db, storage } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { readMatchNames } from '../../lib/voices';

const ADMIN_EMAIL = 'ikennaworksfromhome@gmail.com';

// Cloudflare Pages deploy hook — same one app/admin/page.js fires after a story save.
// /voices and /voices/{slug} are statically exported, so a new or reordered voice is
// only live after a rebuild. Every mutation here fires it.
const DEPLOY_HOOK = 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/df2479ae-06a5-4ff3-a319-29b7b94dd106';

// The 1080×1350 social card is the whole point of this feature, so the rule blocks
// cap uploads at 5 MB / image-only. Mirror those limits client-side rather than
// letting the user wait for a Storage rejection.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Verbatim from app/admin/page.js:32 — the slug must be generated identically to a
// story slug, since both become URL segments under the same static export.
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function extOf(file) {
  const fromName = (file.name || '').split('.').pop();
  if (fromName && /^[a-zA-Z0-9]{2,5}$/.test(fromName)) return fromName.toLowerCase();
  return (file.type || '').split('/').pop() || 'png';
}

// Deterministic slug-keyed paths, following the bookstore convention
// (lib/bookstore/admin-writes.js:398) rather than the legacy timestamp-prefixed
// 'covers/{Date.now()}_{name}' scheme — a voice owns exactly one card and one
// portrait, so re-uploading should replace, not accumulate.
async function uploadVoiceImage(file, slug, kind) {
  if (!file.type || !file.type.startsWith('image/')) throw new Error('That file is not an image.');
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 5 MB.`);
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const storageRef = ref(storage, `voices/${slug}/${kind}.${extOf(file)}`);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return await getDownloadURL(storageRef);
}

// Style object copied from app/admin/authors/page.js for visual parity.
const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "Cormorant Garamond, Georgia, serif" },
  header: { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' },
  logo: { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  headerLinks: { display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' },
  body: { maxWidth: 1000, margin: '0 auto', padding: '2.5rem 2rem' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' },
  h2: { fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: 0 },
  h2sub: { fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  section: { marginBottom: '3rem' },
  btn: { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnSm: { background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.3)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDanger: { background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.3)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnNudge: { background: 'rgba(124,58,237,0.12)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.25)', width: 28, height: 26, borderRadius: 5, fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1, padding: 0 },
  btnNudgeOff: { background: 'transparent', color: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.07)', width: 28, height: 26, borderRadius: 5, fontWeight: 700, fontSize: '0.72rem', cursor: 'not-allowed', fontFamily: 'inherit', lineHeight: 1, padding: 0 },
  card: { display: 'flex', alignItems: 'center', gap: '1rem', background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '0.75rem' },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: '0.95rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  cardMeta: { fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)', marginTop: 3 },
  cardActions: { display: 'flex', gap: '0.5rem', flexShrink: 0, alignItems: 'center' },
  orderCol: { display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 },
  thumb: { width: 44, height: 55, borderRadius: 5, flexShrink: 0, overflow: 'hidden', background: 'rgba(124,58,237,0.18)', border: '1.5px solid rgba(124,58,237,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c4b5fd', fontSize: '1.1rem' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  pill: { display: 'inline-block', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.16rem 0.5rem', borderRadius: 12, border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd', background: 'rgba(124,58,237,0.1)' },
  pillDraft: { display: 'inline-block', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.16rem 0.5rem', borderRadius: 12, border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.04)' },
  roleBadge: { fontSize: '0.68rem', color: '#a78bfa', fontWeight: 600 },
  empty: { background: '#171717', border: '1px dashed #2e2e2e', borderRadius: 10, padding: '2.5rem 1.5rem', textAlign: 'center', color: 'rgba(255,255,255,0.55)' },
  form: { display: 'flex', flexDirection: 'column', gap: '1.2rem', background: '#141414', border: '1px solid #242424', borderRadius: 10, padding: '1.5rem', marginBottom: '0.75rem' },
  fg: { display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  label: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa' },
  input: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  inputLocked: { background: '#151515', border: '1px solid #242424', borderRadius: 6, padding: '0.72rem 1rem', color: 'rgba(255,255,255,0.4)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  select: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 110, resize: 'vertical', lineHeight: 1.6 },
  hint: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 },
  formActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.25rem' },
  msg: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#c4b5fd', marginBottom: '1.5rem' },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "Cormorant Garamond, Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  row2: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
  checkRow: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  previewWrap: { display: 'flex', alignItems: 'flex-start', gap: '1rem' },
  preview: { width: 72, height: 90, borderRadius: 6, flexShrink: 0, overflow: 'hidden', background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(196,181,253,0.5)', fontSize: '0.65rem', textAlign: 'center' },
};

// Same "(optional)" affordance the authors admin uses on non-required labels.
const optionalTagInline = <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>;

const emptyForm = {
  slug: '', displayName: '', matchUid: '', matchNames: '', genreTag: '',
  message: '', bio: '', cardImage: '', portrait: '', order: '', published: false,
};

function initialOf(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function Thumb({ src, name }) {
  return (
    <div style={s.thumb} aria-hidden={src ? undefined : 'true'}>
      {src ? <img src={src} alt="" style={s.thumbImg} /> : <span>{initialOf(name)}</span>}
    </div>
  );
}

// Comma-separated field → clean array, and back. Used for matchNames, the fallback
// join for the handful of stories with a blank authorUid (guest / collaboration rows).
function parseMatchNames(str) {
  return (str || '').split(',').map((v) => v.trim()).filter(Boolean);
}

export default function VoicesAdmin() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [voices, setVoices] = useState([]);
  const [roster, setRoster] = useState([]); // author picker options, derived from cms_stories

  const [view, setView] = useState('list'); // 'list' | 'form'
  const [editingSlug, setEditingSlug] = useState(null); // null = creating
  const [form, setForm] = useState(emptyForm);
  const [slugTouched, setSlugTouched] = useState(false);

  const isAdmin = user && (user.uid === 'XaG6bTGqdDXh7VkBTw4y1H2d2s82' || user.uid === 'GfXFIc0dThZ1cs2SBBQIFao4aSz1' || (user.email && user.email.toLowerCase() === ADMIN_EMAIL));

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [isAdmin]);

  async function load() {
    setLoading(true);
    try {
      const { ref, get } = await import('firebase/database');
      const [voicesSnap, storiesSnap] = await Promise.all([
        get(ref(db, 'cms_voices')),
        get(ref(db, 'cms_stories')),
      ]);

      const vv = voicesSnap.exists() ? voicesSnap.val() : {};
      const vlist = Object.entries(vv)
        .map(([slug, v]) => ({ ...v, slug }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.displayName || '').localeCompare(b.displayName || ''));
      setVoices(vlist);

      // The author picker is derived from cms_stories the same way
      // app/admin/authors/page.js:152 derives its roster: scan distinct authorUid,
      // then read each users/{uid} individually (rules block a wholesale users read).
      // Names are collected per uid because several authors appear under more than
      // one spelling — surfacing every variant is what makes the picker trustworthy.
      const byUid = {};
      if (storiesSnap.exists()) {
        Object.values(storiesSnap.val()).forEach((st) => {
          const uid = (st && st.authorUid ? String(st.authorUid) : '').trim();
          if (!uid) return;
          const g = (byUid[uid] ||= { count: 0, names: new Set() });
          g.count += 1;
          if (st.author) g.names.add(String(st.author));
        });
      }
      const fetched = await Promise.all(Object.keys(byUid).map(async (uid) => {
        let displayName = '';
        try {
          const snap = await get(ref(db, `users/${uid}`));
          if (snap.exists()) displayName = (snap.val() || {}).displayName || '';
        } catch (e) {
          // A blocked or missing user read must not drop the uid from the picker —
          // the story names below are enough to identify it.
        }
        const names = [...byUid[uid].names];
        return { uid, displayName: displayName || names[0] || '(unknown user)', names, count: byUid[uid].count };
      }));
      fetched.sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));
      setRoster(fetched);
    } catch (e) {
      setMsg('Error loading: ' + e.message);
    }
    setLoading(false);
  }

  // ── Form ───────────────────────────────────────────────────────────────
  function openCreate() {
    const nextOrder = voices.length ? Math.max(...voices.map((v) => v.order ?? 0)) + 1 : 1;
    setForm({ ...emptyForm, order: String(nextOrder) });
    setEditingSlug(null);
    setSlugTouched(false);
    setView('form');
    setMsg('');
  }

  function openEdit(v) {
    setForm({
      slug: v.slug,
      displayName: v.displayName || '',
      matchUid: v.matchUid || '',
      matchNames: readMatchNames(v.matchNames).join(', '),
      genreTag: v.genreTag || '',
      message: v.message || '',
      bio: v.bio || '',
      cardImage: v.cardImage || '',
      portrait: v.portrait || '',
      order: String(v.order ?? 0),
      published: v.published === true,
    });
    setEditingSlug(v.slug);
    setSlugTouched(true);
    setView('form');
    setMsg('');
  }

  function cancelForm() {
    setForm(emptyForm);
    setEditingSlug(null);
    setSlugTouched(false);
    setView('list');
    setMsg('');
  }

  // Slug tracks displayName until the admin edits it by hand, and is frozen once the
  // record exists — it is the public URL, and cms_voices is keyed by it, so changing
  // it would orphan the old key and break any shared link.
  function setDisplayName(value) {
    setForm((f) => ({
      ...f,
      displayName: value,
      slug: editingSlug || slugTouched ? f.slug : slugify(value),
    }));
  }

  function setSlug(value) {
    setSlugTouched(true);
    setForm((f) => ({ ...f, slug: slugify(value) }));
  }

  // Uploads need the slug up front (it is the Storage path), so they are blocked
  // until one exists rather than silently writing to voices//card.png.
  async function handleImage(e, kind) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const slug = (form.slug || '').trim();
    if (!slug) { setMsg('Enter a display name (or slug) before uploading — the slug is the image path.'); e.target.value = ''; return; }
    setSaving(true); setMsg(`Uploading ${kind === 'card' ? 'card' : 'portrait'}…`);
    try {
      const url = await uploadVoiceImage(file, slug, kind);
      setForm((f) => ({ ...f, [kind === 'card' ? 'cardImage' : 'portrait']: url }));
      setMsg(`${kind === 'card' ? 'Card' : 'Portrait'} uploaded — save to apply.`);
    } catch (err) {
      setMsg('Upload failed: ' + err.message);
    }
    setSaving(false);
    e.target.value = '';
  }

  async function saveVoice() {
    const slug = (form.slug || '').trim();
    const displayName = form.displayName.trim();

    if (!displayName) { setMsg('Display name is required.'); return; }
    if (!slug) { setMsg('Slug is required — it is the page URL.'); return; }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { setMsg('Slug must be lowercase letters, numbers and single hyphens.'); return; }
    if (!editingSlug && voices.some((v) => v.slug === slug)) { setMsg(`The slug "${slug}" is already taken.`); return; }
    if (!form.cardImage) { setMsg('Card image is required — it is what the /voices grid renders.'); return; }
    const order = Number(form.order);
    if (!Number.isFinite(order)) { setMsg('Order must be a number.'); return; }

    setSaving(true); setMsg('');
    try {
      const { ref, get, update } = await import('firebase/database');
      const now = Date.now();

      // Child update, not set: preserves createdAt on edit and cannot drop a field
      // this form does not know about.
      const payload = {
        slug,
        displayName,
        matchUid: form.matchUid.trim(),
        matchNames: parseMatchNames(form.matchNames),
        genreTag: form.genreTag.trim(),
        message: form.message.trim(),
        bio: form.bio.trim(),
        cardImage: form.cardImage,
        portrait: form.portrait || '',
        order,
        published: form.published === true,
        updatedAt: now,
      };
      if (!editingSlug) {
        payload.createdAt = now;
      } else {
        const existing = await get(ref(db, `cms_voices/${slug}/createdAt`));
        if (!existing.exists()) payload.createdAt = now;
      }

      await update(ref(db, `cms_voices/${slug}`), payload);
      await fireDeployHook();

      setMsg(form.published
        ? `✓ Voice saved and published. The page is live at /voices/${slug} once the rebuild finishes (1–3 min).`
        : '✓ Voice saved as a draft. It stays off /voices until you publish it.');
      cancelForm();
      load();
    } catch (e) {
      setMsg('Error saving: ' + e.message);
    }
    setSaving(false);
  }

  // ── List actions ───────────────────────────────────────────────────────
  async function togglePublished(v) {
    if (v.published && !confirm(`Unpublish ${v.displayName}? The card leaves /voices and the author page 404s after the rebuild. The record is kept.`)) return;
    try {
      const { ref, update } = await import('firebase/database');
      await update(ref(db, `cms_voices/${v.slug}`), { published: !v.published, updatedAt: Date.now() });
      await fireDeployHook();
      setMsg(v.published ? 'Voice unpublished.' : 'Voice published.');
      load();
    } catch (e) { setMsg('Error: ' + e.message); }
  }

  async function deleteVoice(v) {
    if (!confirm(`Delete ${v.displayName}? This removes the roster entry and the /voices/${v.slug} page for good. Uploaded images stay in Storage. This cannot be undone.`)) return;
    try {
      const { ref, remove } = await import('firebase/database');
      await remove(ref(db, `cms_voices/${v.slug}`));
      await fireDeployHook();
      setMsg('Voice deleted.');
      load();
    } catch (e) { setMsg('Error: ' + e.message); }
  }

  // Swap order values with the neighbour. Writing both in one multi-path update keeps
  // the list from briefly showing two voices at the same position.
  async function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= voices.length) return;
    const a = voices[index];
    const b = voices[target];
    try {
      const { ref, update } = await import('firebase/database');
      const now = Date.now();
      await update(ref(db, 'cms_voices'), {
        [`${a.slug}/order`]: b.order ?? target,
        [`${a.slug}/updatedAt`]: now,
        [`${b.slug}/order`]: a.order ?? index,
        [`${b.slug}/updatedAt`]: now,
      });
      await fireDeployHook();
      load();
    } catch (e) { setMsg('Error reordering: ' + e.message); }
  }

  // Mirrors app/admin/page.js:714 — the 10s pause lets the RTDB write settle before
  // the build reads cms_voices, so the rebuild cannot race the save it was triggered by.
  async function fireDeployHook() {
    try {
      await new Promise((r) => setTimeout(r, 10000));
      await fetch(DEPLOY_HOOK, { method: 'POST' });
    } catch (e) { console.warn('Deploy hook failed:', e); }
  }

  // ── Gates (verbatim from app/admin/page.js) ─────────────────────────────
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

  const selectedAuthor = roster.find((r) => r.uid === form.matchUid);

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={s.sub}>Voices of the Island</div>
        </div>
        <div style={s.headerLinks}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>{user.email}</span>
          <a href="/admin" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← Admin</a>
        </div>
      </header>

      <div style={s.body}>
        {msg && <div style={s.msg}>{msg}</div>}

        {view === 'list' ? (
          <section style={s.section}>
            <div style={s.topBar}>
              <div>
                <h2 style={s.h2}>Voices</h2>
                <div style={s.h2sub}>The curated roster behind /voices. Order here is the order on the page.</div>
              </div>
              <button style={s.btn} onClick={openCreate}>+ Add voice</button>
            </div>

            {loading ? (
              <div style={s.empty}>Loading…</div>
            ) : voices.length === 0 ? (
              <div style={s.empty}>No voices yet. Add one — it appears on /voices once published.</div>
            ) : (
              voices.map((v, i) => (
                <div key={v.slug} style={s.card}>
                  <div style={s.orderCol}>
                    <button
                      style={i === 0 ? s.btnNudgeOff : s.btnNudge}
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${v.displayName} up`}
                    >↑</button>
                    <button
                      style={i === voices.length - 1 ? s.btnNudgeOff : s.btnNudge}
                      onClick={() => move(i, 1)}
                      disabled={i === voices.length - 1}
                      aria-label={`Move ${v.displayName} down`}
                    >↓</button>
                  </div>
                  <Thumb src={v.cardImage} name={v.displayName} />
                  <div style={s.cardInfo}>
                    <div style={s.cardTitle}>
                      {v.displayName || '(unnamed)'}
                      <span style={v.published ? s.pill : s.pillDraft}>{v.published ? 'Published' : 'Draft'}</span>
                      {v.genreTag && <span style={s.roleBadge}>· {v.genreTag}</span>}
                    </div>
                    <div style={s.cardMeta}>
                      /voices/{v.slug}
                      {v.matchUid
                        ? ` · linked to ${roster.find((r) => r.uid === v.matchUid)?.displayName || v.matchUid}`
                        : ' · no author linked — works section will be empty'}
                    </div>
                  </div>
                  <div style={s.cardActions}>
                    <button style={s.btnSm} onClick={() => togglePublished(v)}>{v.published ? 'Unpublish' : 'Publish'}</button>
                    <button style={s.btnSm} onClick={() => openEdit(v)}>Edit</button>
                    <button style={s.btnDanger} onClick={() => deleteVoice(v)}>Delete</button>
                  </div>
                </div>
              ))
            )}
          </section>
        ) : (
          <section style={s.section}>
            <div style={s.topBar}>
              <div>
                <h2 style={s.h2}>{editingSlug ? `Edit ${form.displayName || 'voice'}` : 'Add voice'}</h2>
                <div style={s.h2sub}>{editingSlug ? `/voices/${editingSlug}` : 'The slug is fixed once saved — it becomes the page URL.'}</div>
              </div>
            </div>

            <div style={s.form}>
              <div style={s.fg}>
                <label style={s.label}>Display name</label>
                <input style={s.input} value={form.displayName}
                  placeholder="e.g. Ufedo-Ojo Adaji"
                  onChange={(e) => setDisplayName(e.target.value)} />
                <div style={s.hint}>Shown large on the author page, and used for the card alt text.</div>
              </div>

              <div style={s.fg}>
                <label style={s.label}>Slug {editingSlug && <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(locked)</span>}</label>
                <input
                  style={editingSlug ? s.inputLocked : s.input}
                  value={form.slug}
                  readOnly={!!editingSlug}
                  placeholder="auto-generated from the display name"
                  onChange={(e) => setSlug(e.target.value)}
                />
                <div style={s.hint}>
                  {editingSlug
                    ? 'Locked after the first save — it is the public URL and the record key. Delete and re-add to change it.'
                    : 'Tracks the display name until you edit it. This is the last chance to change it.'}
                </div>
              </div>

              <div style={s.fg}>
                <label style={s.label}>Linked author <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(matchUid)</span></label>
                <select style={s.select} value={form.matchUid} onChange={(e) => setForm((f) => ({ ...f, matchUid: e.target.value }))}>
                  <option value="">— none (no works section) —</option>
                  {roster.map((r) => (
                    <option key={r.uid} value={r.uid}>
                      {r.displayName} — {r.count} stor{r.count === 1 ? 'y' : 'ies'}
                    </option>
                  ))}
                </select>
                <div style={s.hint}>
                  Identity is the author’s uid, never their name — several writers publish under more than one spelling,
                  and a name match would silently drop half their work.
                  {selectedAuthor && selectedAuthor.names.length > 1 && (
                    <> This author appears in stories as: <strong style={{ color: 'rgba(255,255,255,0.6)' }}>{selectedAuthor.names.join(' · ')}</strong>. All of it will be found.</>
                  )}
                </div>
              </div>

              <div style={s.fg}>
                <label style={s.label}>Extra name matches {optionalTagInline}</label>
                <input style={s.input} value={form.matchNames}
                  placeholder="Chioma Okonkwo & Ikenna Okpara"
                  onChange={(e) => setForm((f) => ({ ...f, matchNames: e.target.value }))} />
                <div style={s.hint}>
                  Comma-separated. Only needed for the few stories saved with no authorUid — guest or
                  collaboration pieces — which the uid match cannot reach. Leave empty otherwise.
                </div>
              </div>

              <div style={s.fg}>
                <label style={s.label}>Genre tag {optionalTagInline}</label>
                <input style={s.input} value={form.genreTag}
                  placeholder="SHORT STORY · POETRY"
                  onChange={(e) => setForm((f) => ({ ...f, genreTag: e.target.value }))} />
                <div style={s.hint}>Rendered in gold under the name. Small caps suit it.</div>
              </div>

              <div style={s.fg}>
                <label style={s.label}>Message {optionalTagInline}</label>
                <input style={s.input} value={form.message}
                  placeholder="The line that runs italic across the card"
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
                <div style={s.hint}>One line. Shown as the italic pull-line on the author page.</div>
              </div>

              <div style={s.fg}>
                <label style={s.label}>Bio {optionalTagInline}</label>
                <textarea style={s.textarea} value={form.bio}
                  placeholder="Longer prose for the author page…"
                  onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} />
                <div style={s.hint}>Only on the author page — the card shows the message instead.</div>
              </div>

              <div style={s.fg}>
                <label style={s.label}>Card image <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(1080×1350)</span></label>
                <div style={s.previewWrap}>
                  <div style={s.preview}>
                    {form.cardImage ? <img src={form.cardImage} alt="" style={s.thumbImg} /> : <span>no card</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <input type="file" accept="image/*" onChange={(e) => handleImage(e, 'card')} style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }} />
                    <div style={{ ...s.hint, marginTop: 6 }}>
                      The social card, and what the /voices grid renders. Stored at voices/{form.slug || '{slug}'}/card.*, max 5 MB.
                    </div>
                  </div>
                </div>
              </div>

              <div style={s.fg}>
                <label style={s.label}>Portrait {optionalTagInline}</label>
                <div style={s.previewWrap}>
                  <div style={s.preview}>
                    {form.portrait ? <img src={form.portrait} alt="" style={s.thumbImg} /> : <span>falls back to card</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <input type="file" accept="image/*" onChange={(e) => handleImage(e, 'portrait')} style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }} />
                    <div style={{ ...s.hint, marginTop: 6 }}>
                      Hero image on the author page. Leave empty to reuse the card image.
                    </div>
                  </div>
                </div>
              </div>

              <div style={s.row2}>
                <div style={{ ...s.fg, width: 140 }}>
                  <label style={s.label}>Order</label>
                  <input style={s.input} type="number" value={form.order}
                    onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))} />
                  <div style={s.hint}>Low to high.</div>
                </div>
                <div style={{ ...s.fg, flex: 1, justifyContent: 'center' }}>
                  <label style={s.label}>Published</label>
                  <div style={s.checkRow}>
                    <input id="voice-published" type="checkbox" checked={form.published}
                      onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))} />
                    <label htmlFor="voice-published" style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)' }}>
                      Show on /voices and build the author page
                    </label>
                  </div>
                </div>
              </div>

              <div style={s.formActions}>
                <button style={s.btnGhost} onClick={cancelForm} disabled={saving}>Cancel</button>
                <button style={s.btn} onClick={saveVoice} disabled={saving}>{saving ? 'Saving…' : editingSlug ? 'Save voice' : 'Add voice'}</button>
              </div>
              <div style={{ ...s.hint, textAlign: 'right' }}>
                Saving triggers a site rebuild — the page is live 1–3 minutes later.
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
