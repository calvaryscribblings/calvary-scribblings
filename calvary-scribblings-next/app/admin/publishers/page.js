'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { getAllPublishers, getPublisher } from '../../lib/bookstore/loader';
import { createPublisher, updatePublisher, setPublisherStatus } from '../../lib/bookstore/admin-writes';

const ADMIN_EMAIL = 'Ikennaworksfromhome@gmail.com';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
];

const PAYMENT_METHODS = [
  { value: '', label: '— not set —' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'paystack', label: 'Paystack' },
];

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Cochin', Georgia, serif" },
  header: { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' },
  logo: { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  headerLinks: { display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' },
  body: { maxWidth: 1000, margin: '0 auto', padding: '2.5rem 2rem' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', gap: '1rem', flexWrap: 'wrap' },
  h2: { fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: 0 },
  h2sub: { fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  btn: { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDanger: { background: 'rgba(220,38,38,0.12)', color: '#f87171', border: '1px solid rgba(220,38,38,0.25)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnSm: { background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.3)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, background: '#171717', border: '1px solid #242424', borderRadius: 10, overflow: 'hidden' },
  th: { textAlign: 'left', padding: '0.85rem 1rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid #2a2a2a', background: '#141414' },
  td: { padding: '0.95rem 1rem', fontSize: '0.86rem', color: '#fff', borderBottom: '1px solid #1f1f1f', verticalAlign: 'middle' },
  tdMuted: { color: 'rgba(255,255,255,0.5)' },
  pill: { display: 'inline-block', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.18rem 0.55rem', borderRadius: 12, border: '1px solid' },
  rowActions: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' },
  empty: { background: '#171717', border: '1px dashed #2e2e2e', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: 'rgba(255,255,255,0.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '1.4rem', background: '#141414', border: '1px solid #242424', borderRadius: 10, padding: '1.75rem' },
  fg: { display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  label: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa' },
  input: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  inputErr: { borderColor: 'rgba(220,38,38,0.55)' },
  textarea: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 80, resize: 'vertical', lineHeight: 1.5 },
  select: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.1rem' },
  hint: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 },
  hintWarn: { fontSize: '0.7rem', color: '#fcd34d', lineHeight: 1.5 },
  errorBox: { background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 6, padding: '0.85rem 1rem', color: '#fca5a5', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  formActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.5rem' },
  toast: { position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)', background: '#171717', border: '1px solid #2a2a2a', borderRadius: 8, padding: '0.85rem 1.4rem', color: '#86efac', fontSize: '0.85rem', fontWeight: 600, boxShadow: '0 12px 32px rgba(0,0,0,0.6)', zIndex: 1000 },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "'Cochin', Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  cardList: { display: 'none' },
};

function statusPill(status) {
  if (status === 'active') return { ...s.pill, color: '#86efac', borderColor: 'rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)' };
  if (status === 'pending') return { ...s.pill, color: '#fcd34d', borderColor: 'rgba(217,119,6,0.4)', background: 'rgba(217,119,6,0.1)' };
  if (status === 'suspended') return { ...s.pill, color: '#fca5a5', borderColor: 'rgba(220,38,38,0.4)', background: 'rgba(220,38,38,0.1)' };
  return { ...s.pill, color: 'rgba(255,255,255,0.6)', borderColor: 'rgba(255,255,255,0.2)' };
}

const emptyForm = {
  name: '',
  slug: '',
  contactEmail: '',
  salesSplit: 0.7,
  status: 'active',
  paymentMethod: '',
  paymentNotes: '',
};

function PublisherForm({ form, setForm, editingSlug, saving, errors, onSave, onCancel }) {
  function handleNameBlur() {
    if (!form.slug.trim() && form.name.trim()) {
      setForm((f) => ({ ...f, slug: slugify(f.name) }));
    }
  }

  const slugInvalid = form.slug && !SLUG_RE.test(form.slug);

  return (
    <div>
      <div style={s.topBar}>
        <div>
          <h2 style={s.h2}>{editingSlug ? 'Edit Publisher' : 'New Publisher'}</h2>
          <div style={s.h2sub}>{editingSlug ? `Editing ${editingSlug}` : 'Add a publisher record. Bank details stay offline.'}</div>
        </div>
        <button style={s.btnGhost} onClick={onCancel} type="button">← Back</button>
      </div>

      {errors.length > 0 && (
        <div style={{ ...s.errorBox, marginBottom: '1.5rem' }}>
          <div style={{ fontWeight: 700, color: '#f87171' }}>Please fix the following:</div>
          {errors.map((e, i) => <div key={i}>· {e}</div>)}
        </div>
      )}

      <div style={s.form}>
        <div style={s.fg}>
          <label style={s.label}>Publisher name</label>
          <input
            style={s.input}
            value={form.name}
            placeholder="e.g. Calvary Media UK Ltd"
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            onBlur={handleNameBlur}
          />
        </div>

        <div style={s.row2}>
          <div style={s.fg}>
            <label style={s.label}>Slug</label>
            <input
              style={{ ...s.input, ...(slugInvalid ? s.inputErr : {}) }}
              value={form.slug}
              placeholder="auto-generated from name"
              disabled={!!editingSlug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            />
            {editingSlug
              ? <div style={s.hint}>Slug is fixed once a publisher is created.</div>
              : slugInvalid
                ? <div style={s.hintWarn}>Slug must be kebab-case (lowercase, digits, hyphens).</div>
                : <div style={s.hint}>Auto-fills from the name. Edit to override.</div>
            }
          </div>
          <div style={s.fg}>
            <label style={s.label}>Contact email</label>
            <input
              style={s.input}
              type="email"
              value={form.contactEmail}
              placeholder="contact@publisher.com"
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
            />
          </div>
        </div>

        <div style={s.row2}>
          <div style={s.fg}>
            <label style={s.label}>Sales split</label>
            <input
              style={s.input}
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={form.salesSplit}
              onChange={(e) => setForm((f) => ({ ...f, salesSplit: e.target.value === '' ? '' : Number(e.target.value) }))}
            />
            <div style={s.hint}>Publisher's share of each sale, between 0 and 1. Calvary keeps the remainder. For Calvary's own imprint set 1.0; external publishers typically settle around 0.7.</div>
          </div>
          <div style={s.fg}>
            <label style={s.label}>Status</label>
            <select
              style={s.select}
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div style={s.hint}>'Suspended' hides their titles from sale without deleting anything.</div>
          </div>
        </div>

        <div style={s.row2}>
          <div style={s.fg}>
            <label style={s.label}>Payment method <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <select
              style={s.select}
              value={form.paymentMethod}
              onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
            >
              {PAYMENT_METHODS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div style={s.fg}>
            <label style={s.label}>Payment notes <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <textarea
              style={s.textarea}
              value={form.paymentNotes}
              placeholder="e.g. See offline payouts spreadsheet, row 3"
              onChange={(e) => setForm((f) => ({ ...f, paymentNotes: e.target.value }))}
            />
            <div style={s.hintWarn}>Bank details kept offline. This is a free-text reference only — do not paste account numbers here.</div>
          </div>
        </div>

        <div style={s.formActions}>
          <button style={s.btnGhost} onClick={onCancel} type="button">Cancel</button>
          <button
            style={{ ...s.btn, opacity: saving ? 0.6 : 1 }}
            onClick={onSave}
            disabled={saving}
            type="button"
          >
            {saving ? 'Saving…' : editingSlug ? 'Save changes' : 'Create publisher'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PublisherList({ publishers, loading, onNew, onEdit, onToggleStatus }) {
  if (loading) {
    return <div style={s.empty}>Loading publishers…</div>;
  }

  if (publishers.length === 0) {
    return (
      <div style={s.empty}>
        <div style={{ fontSize: '1rem', color: '#fff', fontWeight: 600 }}>No publishers yet.</div>
        <div style={{ fontSize: '0.85rem' }}>Add your first.</div>
        <button style={s.btn} onClick={onNew} type="button">+ Add publisher</button>
      </div>
    );
  }

  return (
    <table style={s.table}>
      <thead>
        <tr>
          <th style={s.th}>Name</th>
          <th style={s.th}>Slug</th>
          <th style={s.th}>Contact</th>
          <th style={s.th}>Status</th>
          <th style={{ ...s.th, textAlign: 'right' }}>Titles</th>
          <th style={{ ...s.th, textAlign: 'right' }}>Split</th>
          <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {publishers.map((p) => (
          <tr key={p.id}>
            <td style={s.td}><strong>{p.name}</strong></td>
            <td style={{ ...s.td, ...s.tdMuted, fontFamily: 'monospace', fontSize: '0.8rem' }}>{p.slug}</td>
            <td style={{ ...s.td, ...s.tdMuted, fontSize: '0.82rem' }}>{p.contactEmail}</td>
            <td style={s.td}><span style={statusPill(p.status)}>{p.status}</span></td>
            <td style={{ ...s.td, textAlign: 'right' }}>{p.titlesCount ?? 0}</td>
            <td style={{ ...s.td, textAlign: 'right' }}>{typeof p.salesSplit === 'number' ? `${Math.round(p.salesSplit * 100)}%` : '—'}</td>
            <td style={{ ...s.td, textAlign: 'right' }}>
              <div style={{ ...s.rowActions, justifyContent: 'flex-end' }}>
                <button style={s.btnSm} type="button" onClick={() => onEdit(p)}>Edit</button>
                <button
                  style={p.status === 'suspended' ? s.btnSm : s.btnDanger}
                  type="button"
                  onClick={() => onToggleStatus(p)}
                >
                  {p.status === 'suspended' ? 'Activate' : 'Suspend'}
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminPublishersPage() {
  const { user } = useAuth();
  const [view, setView] = useState('list');
  const [publishers, setPublishers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [toast, setToast] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingSlug, setEditingSlug] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [suspendConfirm, setSuspendConfirm] = useState(null); // { pub, affectedCount } or null

  const isAdmin = user && user.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  useEffect(() => {
    function handleResize() { setIsMobile(window.innerWidth < 640); }
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadPublishers();
  }, [isAdmin]);

  async function loadPublishers() {
    setLoading(true);
    try {
      const list = await getAllPublishers();
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setPublishers(list);
    } catch (e) {
      console.error('[admin/publishers] load failed', e);
    }
    setLoading(false);
  }

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(''), 1500);
  }

  function openNew() {
    setForm(emptyForm);
    setEditingSlug(null);
    setErrors([]);
    setView('new');
  }

  async function openEdit(pub) {
    // The list view's `pub` only carries public fields after the publishers split.
    // Refetch via getPublisher to merge in contactEmail and paymentDetails for the form.
    const merged = (await getPublisher(pub.slug)) || pub;
    setForm({
      name: merged.name || '',
      slug: merged.slug || pub.slug || '',
      contactEmail: merged.contactEmail || '',
      salesSplit: typeof merged.salesSplit === 'number' ? merged.salesSplit : 0.7,
      status: merged.status || 'active',
      paymentMethod: merged.paymentDetails?.method || '',
      paymentNotes: merged.paymentDetails?.notes || '',
    });
    setEditingSlug(merged.slug || pub.slug);
    setErrors([]);
    setView('edit');
  }

  function handleCancel() {
    setView('list');
    setErrors([]);
  }

  function buildPayload() {
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      contactEmail: form.contactEmail.trim(),
      salesSplit: typeof form.salesSplit === 'number' ? form.salesSplit : Number(form.salesSplit),
      status: form.status,
    };
    const method = form.paymentMethod || null;
    const notes = form.paymentNotes.trim();
    if (method || notes) {
      payload.paymentDetails = {};
      if (method) payload.paymentDetails.method = method;
      if (notes) payload.paymentDetails.notes = notes;
    }
    return payload;
  }

  async function handleSave() {
    setSaving(true);
    setErrors([]);
    const payload = buildPayload();
    const result = editingSlug
      ? await updatePublisher(editingSlug, payload)
      : await createPublisher(payload);

    setSaving(false);
    if (!result.ok) {
      setErrors(result.errors || ['Save failed']);
      return;
    }
    showToast('Publisher saved');
    setView('list');
    setForm(emptyForm);
    setEditingSlug(null);
    loadPublishers();
  }

  async function handleToggleStatus(pub) {
    const next = pub.status === 'suspended' ? 'active' : 'suspended';

    // Suspend with attached titles → confirm-and-cascade dialog.
    if (next === 'suspended' && (pub.titlesCount ?? 0) > 0) {
      setSuspendConfirm({ pub, affectedCount: pub.titlesCount });
      return;
    }

    await applyStatusChange(pub, next);
  }

  async function applyStatusChange(pub, next) {
    const result = await setPublisherStatus(pub.slug, next);
    if (!result.ok) {
      alert((result.errors || ['Status change failed']).join('\n'));
      return;
    }
    showToast(next === 'active' ? 'Publisher activated' : 'Publisher suspended');
    loadPublishers();
  }

  async function confirmSuspendCascade() {
    if (!suspendConfirm) return;
    const { pub } = suspendConfirm;
    setSuspendConfirm(null);
    await applyStatusChange(pub, 'suspended');
  }

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
          <div style={s.sub}>Publishers</div>
        </div>
        <div style={s.headerLinks}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>{user.email}</span>
          <a href="/admin" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← Admin</a>
        </div>
      </header>
      <div style={s.body}>
        {(view === 'new' || view === 'edit') && (
          <PublisherForm
            form={form}
            setForm={setForm}
            editingSlug={editingSlug}
            saving={saving}
            errors={errors}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        )}
        {view === 'list' && (
          <div>
            <div style={s.topBar}>
              <div>
                <h2 style={s.h2}>Publishers</h2>
                <div style={s.h2sub}>{publishers.length} on file</div>
              </div>
              {publishers.length > 0 && (
                <button style={s.btn} onClick={openNew} type="button">+ Add publisher</button>
              )}
            </div>
            {isMobile && publishers.length > 0
              ? (
                <div>
                  {publishers.map((p) => (
                    <div key={p.id} style={{ background: '#171717', border: '1px solid #242424', borderRadius: 10, padding: '1.1rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff', marginBottom: 4 }}>{p.name}</div>
                          <div style={{ ...s.tdMuted, fontSize: '0.78rem', fontFamily: 'monospace', marginBottom: 4 }}>{p.slug}</div>
                          <div style={{ ...s.tdMuted, fontSize: '0.8rem', marginBottom: 8 }}>{p.contactEmail}</div>
                          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)' }}>
                            <span style={statusPill(p.status)}>{p.status}</span>
                            <span>{p.titlesCount ?? 0} titles</span>
                            <span>{typeof p.salesSplit === 'number' ? `${Math.round(p.salesSplit * 100)}%` : '—'}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ ...s.rowActions, marginTop: '0.85rem', justifyContent: 'flex-end' }}>
                        <button style={s.btnSm} type="button" onClick={() => openEdit(p)}>Edit</button>
                        <button style={p.status === 'suspended' ? s.btnSm : s.btnDanger} type="button" onClick={() => handleToggleStatus(p)}>
                          {p.status === 'suspended' ? 'Activate' : 'Suspend'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
              : (
                <PublisherList
                  publishers={publishers}
                  loading={loading}
                  onNew={openNew}
                  onEdit={openEdit}
                  onToggleStatus={handleToggleStatus}
                />
              )
            }
          </div>
        )}
      </div>
      {toast && <div style={s.toast}>{toast}</div>}
      {suspendConfirm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={(e) => { if (e.target === e.currentTarget) setSuspendConfirm(null); }}
        >
          <div style={{ background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 10, padding: '1.75rem', width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
              Suspend {suspendConfirm.pub.name}?
            </div>
            <div style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.7)', lineHeight: 1.55 }}>
              Suspending {suspendConfirm.pub.name} will hide {suspendConfirm.affectedCount} title{suspendConfirm.affectedCount === 1 ? '' : 's'} from the storefront. Their data is preserved and they reappear if you reactivate the publisher. Continue?
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', paddingTop: '0.25rem' }}>
              <button style={s.btnGhost} type="button" onClick={() => setSuspendConfirm(null)}>Cancel</button>
              <button style={s.btnDanger} type="button" onClick={confirmSuspendCascade}>Suspend and hide titles</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
