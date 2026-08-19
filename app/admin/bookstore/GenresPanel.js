'use client';
// THE GENRES PANEL — /admin/bookstore → Genres.
//
// Small on purpose. A genre is four fields (slug, label, group, order) and the only screen it
// needs is a table you can edit in place. What earns its keep here is the two things the panel
// REFUSES:
//
//   · a slug cannot be changed after creation. A title stores its genre AS the slug, so
//     renaming one silently moves every book on it to a shelf that does not exist. The label
//     is the editable thing — that is what a reader sees, and changing it is free.
//   · a genre holding titles cannot be deleted. admin-writes' deleteGenre does the check
//     against the live catalogue and names the books; this panel just shows what it said.
//
// THE ORDER COLUMN IS THE TAB ORDER. Not a hint, not a sort preference — the number the shop
// renders by. Genres are grouped fiction/non-fiction and the two groups are separate shelves,
// so an order shared across the split is harmless and the panel does not police it.

import { useState } from 'react';
import { GENRE_GROUPS } from '../../lib/bookstore/genres';
import { saveGenre, deleteGenre, seedGenres } from '../../lib/bookstore/admin-writes';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const blank = { slug: '', label: '', group: 'fiction', order: 0 };

export default function GenresPanel({ s, genres, titles, onChanged, showToast }) {
  const [editing, setEditing] = useState(null);   // slug being edited, '' for a new one
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);

  // How many titles sit on each genre, ANY status. The count an editor needs before deleting
  // is "what is on this shelf", not "what is on it publicly" — a draft blocks the delete too.
  const counts = new Map();
  for (const t of titles || []) counts.set(t.genre, (counts.get(t.genre) || 0) + 1);
  const published = new Map();
  for (const t of titles || []) if (t.status === 'published') published.set(t.genre, (published.get(t.genre) || 0) + 1);

  function openNew() {
    setForm({ ...blank, order: (genres || []).reduce((m, g) => Math.max(m, g.order), 0) + 1 });
    setEditing('');
    setErrors([]);
  }
  function openEdit(g) {
    setForm({ slug: g.slug, label: g.label, group: g.group, order: g.order });
    setEditing(g.slug);
    setErrors([]);
  }

  async function save() {
    setErrors([]);
    const slug = form.slug.trim();
    if (!SLUG_RE.test(slug)) { setErrors(['Slug must be kebab-case: lowercase letters, digits and hyphens.']); return; }
    setBusy(true);
    const res = await saveGenre({ ...form, slug, order: Number.parseInt(form.order, 10) });
    setBusy(false);
    if (!res.ok) { setErrors(res.errors || ['Save failed']); return; }
    showToast(editing ? 'Genre updated' : 'Genre added');
    setEditing(null);
    onChanged();
  }

  async function remove(g) {
    if (!window.confirm(`Delete the genre “${g.label}”? This cannot be undone.`)) return;
    setBusy(true);
    const res = await deleteGenre(g.slug);
    setBusy(false);
    if (!res.ok) { window.alert((res.errors || ['Delete failed']).join('\n')); return; }
    showToast('Genre deleted');
    onChanged();
  }

  async function seed() {
    if (!window.confirm('Write the twelve seed genres? Existing records with the same slugs are overwritten with the seed label, group and order.')) return;
    setBusy(true);
    const res = await seedGenres();
    setBusy(false);
    if (!res.ok) { window.alert((res.errors || ['Seed failed']).join('\n')); return; }
    showToast(`${res.count} genres written`);
    onChanged();
  }

  const rows = [...(genres || [])].sort((a, b) => (a.order - b.order) || a.slug.localeCompare(b.slug));

  return (
    <div>
      <div style={s.topBar}>
        <div>
          <h2 style={s.h2}>Genres</h2>
          <div style={s.h2sub}>{rows.length} in the taxonomy · the shop&rsquo;s tabs render from these, in this order</div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button style={s.btnGhost} onClick={seed} type="button" disabled={busy}>Write the seed</button>
          <button style={s.btn} onClick={openNew} type="button">+ Add genre</button>
        </div>
      </div>

      {/* The one thing worth saying on this screen, said once. */}
      <div style={{ ...s.section, borderColor: 'rgba(124,58,237,0.25)' }}>
        <div style={s.sectionTitle}>How the shop reads this</div>
        <div style={s.hint}>
          <strong style={{ color: '#e8e8e8' }}>All Fiction</strong> and <strong style={{ color: '#e8e8e8' }}>All Non-Fiction</strong> always come first.
          After them the shop shows <strong style={{ color: '#e8e8e8' }}>only genres holding at least one published title</strong>, in the order below.
          A genre with nothing on it is absent from the shop — not an empty tab.
        </div>
      </div>

      {editing !== null && (
        <div style={s.section}>
          <div style={s.sectionTitle}>{editing ? `Edit ${editing}` : 'New genre'}</div>
          {errors.length > 0 && <div style={s.errorBox}>{errors.map((e, i) => <span key={i}>{e}</span>)}</div>}
          <div style={s.row2}>
            <div style={s.fg}>
              <label style={s.label}>Label <span style={s.labelSoft}>— what a reader sees</span></label>
              <input style={s.input} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Thriller &amp; Suspense" />
            </div>
            <div style={s.fg}>
              <label style={s.label}>Slug <span style={s.labelSoft}>— locked after creation</span></label>
              <input
                style={{ ...s.input, opacity: editing ? 0.5 : 1 }}
                value={form.slug}
                readOnly={!!editing}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="thriller-suspense"
              />
              {!editing && <div style={s.hint}>Titles store this string. It cannot be changed later without moving every book on the shelf by hand.</div>}
            </div>
          </div>
          <div style={{ ...s.row2, marginTop: '1.1rem' }}>
            <div style={s.fg}>
              <label style={s.label}>Half of the shop</label>
              <select style={s.select} value={form.group} onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}>
                {GENRE_GROUPS.map((g) => <option key={g} value={g}>{g === 'fiction' ? 'Fiction' : 'Non-Fiction'}</option>)}
              </select>
            </div>
            <div style={s.fg}>
              <label style={s.label}>Order</label>
              <input style={s.input} type="number" value={form.order} onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))} />
            </div>
          </div>
          <div style={{ ...s.formActions, marginTop: '1.2rem' }}>
            <button style={s.btnGhost} type="button" onClick={() => setEditing(null)}>Cancel</button>
            <button style={{ ...s.btn, ...(busy ? s.btnDisabled : {}) }} type="button" onClick={save} disabled={busy}>Save genre</button>
          </div>
        </div>
      )}

      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Order</th>
            <th style={s.th}>Label</th>
            <th style={s.th}>Slug</th>
            <th style={s.th}>Half</th>
            <th style={s.th}>Titles</th>
            <th style={s.th}>On the shop</th>
            <th style={s.th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => {
            const all = counts.get(g.slug) || 0;
            const pub = published.get(g.slug) || 0;
            return (
              <tr key={g.slug}>
                <td style={{ ...s.td, ...s.tdMuted, fontVariantNumeric: 'tabular-nums' }}>{g.order}</td>
                <td style={s.td}>{g.label}</td>
                <td style={{ ...s.td, ...s.tdMuted, fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem' }}>{g.slug}</td>
                <td style={{ ...s.td, ...s.tdMuted }}>{g.group === 'fiction' ? 'Fiction' : 'Non-Fiction'}</td>
                <td style={{ ...s.td, ...s.tdMuted }}>{all}{all !== pub ? ` (${pub} published)` : ''}</td>
                <td style={s.td}>
                  {pub > 0
                    ? <span style={{ ...s.pill, color: '#86efac', borderColor: 'rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)' }}>Tab shown</span>
                    : <span style={{ ...s.pill, color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.2)' }}>Absent</span>}
                </td>
                <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button style={s.btnSm} type="button" onClick={() => openEdit(g)}>Edit</button>{' '}
                  <button
                    style={{ ...s.btnDanger, ...(all > 0 ? s.btnDisabled : {}) }}
                    type="button"
                    disabled={all > 0 || busy}
                    title={all > 0 ? `${all} title${all === 1 ? '' : 's'} on this genre` : 'Delete'}
                    onClick={() => remove(g)}
                  >Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
