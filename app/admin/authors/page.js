'use client';
import { useState, useEffect } from 'react';
import { db, storage } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';

// Mirrors uploadToStorage in app/admin/page.js, but stores under 'authors/'.
async function uploadToStorage(file) {
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const filename = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9.]/g, '_');
  const storageRef = ref(storage, 'authors/' + filename);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

// Style object shape copied from app/admin/publishers/page.js for visual parity.
const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
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
  card: { display: 'flex', alignItems: 'center', gap: '1rem', background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '0.75rem' },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: '0.95rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
  cardMeta: { fontSize: '0.74rem', color: 'rgba(255,255,255,0.45)', marginTop: 3 },
  cardActions: { display: 'flex', gap: '0.5rem', flexShrink: 0 },
  avatar: { width: 48, height: 48, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: 'rgba(124,58,237,0.18)', border: '1.5px solid rgba(124,58,237,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c4b5fd', fontSize: '1.2rem' },
  avatarImg: { width: '100%', height: '100%', objectFit: 'cover' },
  pill: { display: 'inline-block', fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.16rem 0.5rem', borderRadius: 12, border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd', background: 'rgba(124,58,237,0.1)' },
  roleBadge: { fontSize: '0.68rem', color: '#a78bfa', fontWeight: 600 },
  empty: { background: '#171717', border: '1px dashed #2e2e2e', borderRadius: 10, padding: '2.5rem 1.5rem', textAlign: 'center', color: 'rgba(255,255,255,0.55)' },
  form: { display: 'flex', flexDirection: 'column', gap: '1.2rem', background: '#141414', border: '1px solid #242424', borderRadius: 10, padding: '1.5rem', marginBottom: '0.75rem' },
  fg: { display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  label: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa' },
  input: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  textarea: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 110, resize: 'vertical', lineHeight: 1.6 },
  hint: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 },
  formActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.25rem' },
  msg: { padding: '0.75rem 1rem', borderRadius: 6, fontSize: '0.85rem', background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#c4b5fd', marginBottom: '1.5rem' },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
};

function initialOf(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}

function Avatar({ src, name }) {
  return (
    <div style={s.avatar} aria-hidden={src ? undefined : 'true'}>
      {src ? <img src={src} alt={name || ''} style={s.avatarImg} /> : <span>{initialOf(name)}</span>}
    </div>
  );
}

const emptyGuest = { name: '', role: '', bio: '', photoUrl: '' };

export default function AuthorsAdmin() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [authors, setAuthors] = useState([]);
  const [guests, setGuests] = useState([]);

  // Registered-author edit form
  const [editingUid, setEditingUid] = useState(null);
  const [editForm, setEditForm] = useState({ authorRole: '', authorBio: '', authorPhotoUrl: '', newPhoto: false });

  // Guest-author add form
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [guestForm, setGuestForm] = useState(emptyGuest);

  const isAdmin = user && (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() || user.uid === 'GfXFIc0dThZ1cs2SBBQIFao4aSz1');

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [isAdmin]);

  async function load() {
    setLoading(true);
    try {
      const { ref, get } = await import('firebase/database');
      const [storiesSnap, usersSnap, guestsSnap] = await Promise.all([
        get(ref(db, 'cms_stories')),
        get(ref(db, 'users')),
        get(ref(db, 'cms_authors')),
      ]);

      // Distinct, non-empty authorUid values actually used across stories + counts.
      const counts = {};
      if (storiesSnap.exists()) {
        Object.values(storiesSnap.val()).forEach((st) => {
          const uid = (st && st.authorUid ? String(st.authorUid) : '').trim();
          if (uid) counts[uid] = (counts[uid] || 0) + 1;
        });
      }
      const usersVal = usersSnap.exists() ? usersSnap.val() : {};
      const list = Object.keys(counts).map((uid) => {
        const u = usersVal[uid] || {};
        return {
          uid,
          displayName: u.displayName || '(unknown user)',
          username: u.username || '',
          bio: u.bio || '',
          avatarUrl: u.avatarUrl || '',
          authorBio: u.authorBio || '',
          authorRole: u.authorRole || '',
          authorPhotoUrl: u.authorPhotoUrl || '',
          count: counts[uid],
        };
      });
      list.sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));
      setAuthors(list);

      const gv = guestsSnap.exists() ? guestsSnap.val() : {};
      const glist = Object.entries(gv)
        .map(([id, g]) => ({ id, ...g }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setGuests(glist);
    } catch (e) {
      setMsg('Error loading: ' + e.message);
    }
    setLoading(false);
  }

  // ── Registered authors ─────────────────────────────────────────────────
  function openEditAuthor(a) {
    setEditingUid(a.uid);
    setEditForm({ authorRole: a.authorRole || '', authorBio: a.authorBio || '', authorPhotoUrl: a.authorPhotoUrl || '', newPhoto: false });
    setMsg('');
  }

  async function handleEditPhoto(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setSaving(true); setMsg('Uploading photo…');
    try {
      const url = await uploadToStorage(file);
      setEditForm((f) => ({ ...f, authorPhotoUrl: url, newPhoto: true }));
      setMsg('Photo uploaded — save to apply.');
    } catch (err) {
      setMsg('Upload failed: ' + err.message);
    }
    setSaving(false);
  }

  async function saveAuthor() {
    if (!editingUid) return;
    setSaving(true); setMsg('');
    try {
      const { ref, update } = await import('firebase/database');
      // Child update only — never set. Leaves displayName/bio/avatarUrl/username untouched.
      const payload = {
        authorBio: editForm.authorBio.trim(),
        authorRole: editForm.authorRole.trim(),
      };
      // Only write authorPhotoUrl if a new photo was uploaded this session.
      if (editForm.newPhoto && editForm.authorPhotoUrl) {
        payload.authorPhotoUrl = editForm.authorPhotoUrl;
      }
      await update(ref(db, `users/${editingUid}`), payload);
      setMsg('✓ Author updated.');
      setEditingUid(null);
      load();
    } catch (e) {
      setMsg('Error saving: ' + e.message);
    }
    setSaving(false);
  }

  // ── Guest authors ──────────────────────────────────────────────────────
  function openGuestForm() {
    setGuestForm(emptyGuest);
    setShowGuestForm(true);
    setMsg('');
  }

  async function handleGuestPhoto(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setSaving(true); setMsg('Uploading photo…');
    try {
      const url = await uploadToStorage(file);
      setGuestForm((f) => ({ ...f, photoUrl: url }));
      setMsg('Photo uploaded.');
    } catch (err) {
      setMsg('Upload failed: ' + err.message);
    }
    setSaving(false);
  }

  async function addGuest() {
    if (!guestForm.name.trim()) { setMsg('Guest name is required.'); return; }
    setSaving(true); setMsg('');
    try {
      const { ref, push, set } = await import('firebase/database');
      const newRef = push(ref(db, 'cms_authors'));
      await set(newRef, {
        name: guestForm.name.trim(),
        role: guestForm.role.trim(),
        bio: guestForm.bio.trim(),
        photoUrl: guestForm.photoUrl || '',
        createdAt: Date.now(),
      });
      setMsg('✓ Guest author added.');
      setGuestForm(emptyGuest);
      setShowGuestForm(false);
      load();
    } catch (e) {
      setMsg('Error saving: ' + e.message);
    }
    setSaving(false);
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

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={s.sub}>Authors</div>
        </div>
        <div style={s.headerLinks}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>{user.email}</span>
          <a href="/admin" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← Admin</a>
        </div>
      </header>

      <div style={s.body}>
        {msg && <div style={s.msg}>{msg}</div>}

        {/* ── Registered authors ── */}
        <section style={s.section}>
          <div style={s.topBar}>
            <div>
              <h2 style={s.h2}>Registered authors</h2>
              <div style={s.h2sub}>Derived from authorUid values used across published stories.</div>
            </div>
          </div>

          {loading ? (
            <div style={s.empty}>Loading…</div>
          ) : authors.length === 0 ? (
            <div style={s.empty}>No stories with an authorUid yet.</div>
          ) : (
            authors.map((a) => (
              <div key={a.uid}>
                <div style={s.card}>
                  <Avatar src={a.authorPhotoUrl || a.avatarUrl} name={a.displayName} />
                  <div style={s.cardInfo}>
                    <div style={s.cardTitle}>
                      {a.displayName}
                      {a.authorRole && <span style={s.roleBadge}>· {a.authorRole}</span>}
                    </div>
                    <div style={s.cardMeta}>
                      {a.username ? `@${a.username} · ` : ''}{a.count} stor{a.count === 1 ? 'y' : 'ies'}
                    </div>
                  </div>
                  <div style={s.cardActions}>
                    <button style={s.btnSm} onClick={() => (editingUid === a.uid ? setEditingUid(null) : openEditAuthor(a))}>
                      {editingUid === a.uid ? 'Close' : 'Edit'}
                    </button>
                  </div>
                </div>

                {editingUid === a.uid && (
                  <div style={s.form}>
                    <div style={s.fg}>
                      <label style={s.label}>Author role</label>
                      <input style={s.input} value={editForm.authorRole}
                        placeholder="e.g. Poetry Contributor"
                        onChange={(e) => setEditForm((f) => ({ ...f, authorRole: e.target.value }))} />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Author bio <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(editorial / professional)</span></label>
                      <textarea style={s.textarea} value={editForm.authorBio}
                        placeholder="Editorial bio shown on the story page…"
                        onChange={(e) => setEditForm((f) => ({ ...f, authorBio: e.target.value }))} />
                      <div style={s.hint}>Stored as authorBio. The reader’s self-written bio is left untouched.</div>
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Author photo override <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <Avatar src={editForm.authorPhotoUrl || a.avatarUrl} name={a.displayName} />
                        <input type="file" accept="image/*" onChange={handleEditPhoto} style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }} />
                      </div>
                      <div style={s.hint}>Stored as authorPhotoUrl. Only written when you upload a new photo.</div>
                    </div>
                    <div style={s.formActions}>
                      <button style={s.btnGhost} onClick={() => setEditingUid(null)} disabled={saving}>Cancel</button>
                      <button style={s.btn} onClick={saveAuthor} disabled={saving}>{saving ? 'Saving…' : 'Save author'}</button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        {/* ── Guest authors ── */}
        <section style={s.section}>
          <div style={s.topBar}>
            <div>
              <h2 style={s.h2}>Guest authors</h2>
              <div style={s.h2sub}>Standalone author records (cms_authors) for writers without a user account.</div>
            </div>
            {!showGuestForm && <button style={s.btn} onClick={openGuestForm}>+ Add guest author</button>}
          </div>

          {showGuestForm && (
            <div style={s.form}>
              <div style={s.fg}>
                <label style={s.label}>Name</label>
                <input style={s.input} value={guestForm.name}
                  placeholder="Guest author name"
                  onChange={(e) => setGuestForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div style={s.fg}>
                <label style={s.label}>Role</label>
                <input style={s.input} value={guestForm.role}
                  placeholder="e.g. Guest Essayist"
                  onChange={(e) => setGuestForm((f) => ({ ...f, role: e.target.value }))} />
              </div>
              <div style={s.fg}>
                <label style={s.label}>Bio</label>
                <textarea style={s.textarea} value={guestForm.bio}
                  placeholder="Guest author bio…"
                  onChange={(e) => setGuestForm((f) => ({ ...f, bio: e.target.value }))} />
              </div>
              <div style={s.fg}>
                <label style={s.label}>Photo <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <Avatar src={guestForm.photoUrl} name={guestForm.name} />
                  <input type="file" accept="image/*" onChange={handleGuestPhoto} style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem' }} />
                </div>
              </div>
              <div style={s.formActions}>
                <button style={s.btnGhost} onClick={() => { setShowGuestForm(false); setGuestForm(emptyGuest); }} disabled={saving}>Cancel</button>
                <button style={s.btn} onClick={addGuest} disabled={saving}>{saving ? 'Saving…' : 'Add guest author'}</button>
              </div>
            </div>
          )}

          {loading ? (
            <div style={s.empty}>Loading…</div>
          ) : guests.length === 0 ? (
            <div style={s.empty}>No guest authors yet.</div>
          ) : (
            guests.map((g) => (
              <div key={g.id} style={s.card}>
                <Avatar src={g.photoUrl} name={g.name} />
                <div style={s.cardInfo}>
                  <div style={s.cardTitle}>
                    {g.name || '(unnamed)'}
                    <span style={s.pill}>Guest</span>
                    {g.role && <span style={s.roleBadge}>· {g.role}</span>}
                  </div>
                  {g.bio && <div style={s.cardMeta}>{g.bio}</div>}
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
