'use client';
import { useState, useEffect } from 'react';
import { db, storage } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';

async function uploadPhoto(file, uid) {
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const storageRef = ref(storage, `story_authors/${uid}.${ext}`);
  await uploadBytes(storageRef, file);
  return await getDownloadURL(storageRef);
}

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header: { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  body: { maxWidth: 860, margin: '0 auto', padding: '2.5rem 2rem' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' },
  h2: { fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: 0 },
  h2sub: { fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  card: { background: '#171717', border: '1px solid #2a2a2a', borderRadius: 10, padding: '1.25rem', marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' },
  avatar: { width: 64, height: 64, borderRadius: '50%', background: '#2a2a2a', objectFit: 'cover', flexShrink: 0 },
  avatarPlaceholder: { width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #2a1a3d 0%, #6b2fad 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c4b5fd', fontWeight: 700, flexShrink: 0 },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: 2 },
  cardMeta: { fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)' },
  cardStatus: { fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: 4 },
  btn: { background: '#c4b5fd', color: '#0f0f0f', border: 'none', borderRadius: 6, padding: '0.55rem 1rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' },
  btnGhost: { background: 'transparent', color: '#c4b5fd', border: '1px solid rgba(196,181,253,0.4)', borderRadius: 6, padding: '0.5rem 0.9rem', fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer' },
  form: { background: '#171717', border: '1px solid #2a2a2a', borderRadius: 10, padding: '1.5rem', marginBottom: '1rem' },
  formRow: { marginBottom: '1.25rem' },
  label: { display: 'block', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.55)', marginBottom: '0.5rem', fontWeight: 600 },
  input: { width: '100%', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 6, padding: '0.65rem 0.85rem', color: '#e8e8e8', fontFamily: 'inherit', fontSize: '0.92rem', boxSizing: 'border-box' },
  textarea: { width: '100%', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 6, padding: '0.75rem 0.85rem', color: '#e8e8e8', fontFamily: 'inherit', fontSize: '0.92rem', minHeight: 110, resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box' },
  hint: { fontSize: '0.72rem', color: 'rgba(255,255,255,0.35)', marginTop: '0.35rem' },
  row: { display: 'flex', gap: '0.75rem', alignItems: 'center' },
  msg: { background: 'rgba(196,181,253,0.08)', border: '1px solid rgba(196,181,253,0.25)', borderRadius: 6, padding: '0.7rem 1rem', fontSize: '0.85rem', color: '#c4b5fd', marginBottom: '1rem' },
  gate: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
};

function stripHandle(v) {
  return (v || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram\.com|twitter\.com|x\.com)\//, '').replace(/\/$/, '');
}

function AuthorForm({ uid, user, existing, onSave, onCancel, saving, msg }) {
  const [displayName, setDisplayName] = useState(existing?.displayName || user.displayName || '');
  const [bio, setBio] = useState(existing?.bio || '');
  const [handle, setHandle] = useState(existing?.handle || user.username || '');
  const [instagram, setInstagram] = useState(existing?.instagram || '');
  const [twitter, setTwitter] = useState(existing?.twitter || '');
  const [photoUrl, setPhotoUrl] = useState(existing?.photoUrl || '');
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState('');

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUpErr('');
    try {
      const url = await uploadPhoto(file, uid);
      setPhotoUrl(url);
    } catch (err) {
      setUpErr('Upload failed: ' + err.message);
    }
    setUploading(false);
  }

  function submit() {
    onSave(uid, {
      displayName: displayName.trim(),
      bio: bio.trim(),
      handle: stripHandle(handle),
      instagram: stripHandle(instagram),
      twitter: stripHandle(twitter),
      photoUrl: photoUrl || '',
    });
  }

  return (
    <div style={s.form}>
      <h3 style={{ ...s.h2, marginBottom: '1.5rem' }}>Editing: {user.displayName}</h3>
      {msg && <div style={s.msg}>{msg}</div>}

      <div style={s.formRow}>
        <label style={s.label}>Photo</label>
        <div style={s.row}>
          {photoUrl
            ? <img src={photoUrl} alt="" style={s.avatar} />
            : <div style={s.avatarPlaceholder}>{(displayName || '?')[0]}</div>}
          <input type="file" accept="image/*" onChange={handlePhoto} style={{ fontSize: '0.82rem' }} />
        </div>
        {uploading && <div style={s.hint}>Uploading…</div>}
        {upErr && <div style={{ ...s.hint, color: '#f87171' }}>{upErr}</div>}
      </div>

      <div style={s.formRow}>
        <label style={s.label}>Display name (story byline)</label>
        <input style={s.input} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Kalu Rebecca" />
        <div style={s.hint}>Overrides the CMS author string on story pages.</div>
      </div>

      <div style={s.formRow}>
        <label style={s.label}>Bio</label>
        <textarea style={s.textarea} value={bio} onChange={e => setBio(e.target.value)} placeholder="Two or three sentences for the end-of-story bio block." />
      </div>

      <div style={s.formRow}>
        <label style={s.label}>Handle (links to /user/{'{handle}'})</label>
        <input style={s.input} value={handle} onChange={e => setHandle(e.target.value)} placeholder="kalurebecca" />
      </div>

      <div style={s.formRow}>
        <label style={s.label}>Instagram handle</label>
        <input style={s.input} value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="kalurebecca" />
        <div style={s.hint}>Just the handle — no @, no URL.</div>
      </div>

      <div style={s.formRow}>
        <label style={s.label}>Twitter / X handle</label>
        <input style={s.input} value={twitter} onChange={e => setTwitter(e.target.value)} placeholder="kalurebecca" />
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <button style={s.btn} onClick={submit} disabled={saving || uploading}>{saving ? 'Saving…' : 'Save'}</button>
        <button style={s.btnGhost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function AdminAuthors() {
  const { user, loading: authLoading } = useAuth();
  const [authors, setAuthors] = useState([]);
  const [records, setRecords] = useState({});
  const [loading, setLoading] = useState(true);
  const [editingUid, setEditingUid] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const isAdmin = user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  async function loadAll() {
    setLoading(true);
    try {
      const { ref, get } = await import('firebase/database');
      const [usersSnap, recsSnap] = await Promise.all([
        get(ref(db, 'users')),
        get(ref(db, 'story_authors')),
      ]);
      const users = usersSnap.exists() ? usersSnap.val() : {};
      const recs = recsSnap.exists() ? recsSnap.val() : {};
      const list = Object.entries(users)
        .filter(([, u]) => u.isAuthor === true)
        .map(([uid, u]) => ({ uid, ...u }))
        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
      setAuthors(list);
      setRecords(recs);
    } catch (e) {
      setMsg('Load error: ' + e.message);
    }
    setLoading(false);
  }

  useEffect(() => { if (isAdmin) loadAll(); }, [isAdmin]);

  async function save(uid, data) {
    setSaving(true); setMsg('');
    try {
      const { ref, update } = await import('firebase/database');
      await update(ref(db, `story_authors/${uid}`), data);
      setMsg('Saved.');
      setEditingUid(null);
      await loadAll();
    } catch (e) {
      setMsg('Save error: ' + e.message);
    }
    setSaving(false);
  }

  if (authLoading) return <div style={s.gate}>Loading…</div>;
  if (!isAdmin) return (
    <div style={s.gate}>
      <div style={{ fontSize: '1.1rem', color: '#f87171', fontWeight: 700 }}>Access Denied</div>
      <a href="/" style={{ color: '#c4b5fd', fontSize: '0.82rem' }}>← Back to site</a>
    </div>
  );

  const editingUser = editingUid ? authors.find(a => a.uid === editingUid) : null;

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <div style={s.logo}>Calvary Scribblings</div>
          <div style={s.sub}>Author Bios</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <a href="/admin" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← Admin</a>
        </div>
      </header>
      <div style={s.body}>
        {!editingUid && (
          <>
            <div style={s.topBar}>
              <div>
                <h2 style={s.h2}>Authors</h2>
                <div style={s.h2sub}>{authors.length} writers · story-page bios</div>
              </div>
            </div>
            {msg && <div style={s.msg}>{msg}</div>}
            {loading
              ? <div style={{ color: 'rgba(255,255,255,0.4)', padding: '2rem', textAlign: 'center' }}>Loading…</div>
              : authors.length === 0
                ? <div style={{ color: 'rgba(255,255,255,0.4)', padding: '2rem', textAlign: 'center' }}>No writers found. Set <code>isAuthor: true</code> on user records in Firebase.</div>
                : authors.map(a => {
                    const rec = records[a.uid];
                    const hasBio = rec && rec.bio;
                    return (
                      <div key={a.uid} style={s.card}>
                        {rec?.photoUrl
                          ? <img src={rec.photoUrl} alt="" style={s.avatar} />
                          : <div style={s.avatarPlaceholder}>{(a.displayName || '?')[0]}</div>}
                        <div style={s.cardBody}>
                          <div style={s.cardName}>{rec?.displayName || a.displayName}</div>
                          <div style={s.cardMeta}>{a.username ? `@${a.username}` : 'no username'}</div>
                          <div style={{ ...s.cardStatus, color: hasBio ? '#86efac' : 'rgba(255,255,255,0.35)' }}>
                            {hasBio ? '✓ Bio set' : 'Not set up'}
                          </div>
                        </div>
                        <button style={s.btnGhost} onClick={() => { setEditingUid(a.uid); setMsg(''); }}>Edit</button>
                      </div>
                    );
                  })
            }
          </>
        )}
        {editingUid && editingUser && (
          <AuthorForm
            uid={editingUid}
            user={editingUser}
            existing={records[editingUid]}
            onSave={save}
            onCancel={() => { setEditingUid(null); setMsg(''); }}
            saving={saving}
            msg={msg}
          />
        )}
      </div>
    </div>
  );
}
