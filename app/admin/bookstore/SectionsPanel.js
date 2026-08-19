'use client';
// THE SECTIONS PANEL — /admin/bookstore → Sections.
//
// Create, order, populate, retire. Plus a month picker for BOOK_OF_THE_MONTH and a preview
// that draws the shop's own components over the claims as they stand.
//
// ── THE PREVIEW IS THE SHOP ──────────────────────────────────────────────────────────────
//
// It imports CuratedSection, ShelfEntry and TheWindow — the same three modules
// app/bookstore/page.js renders from — and runs the same resolveSections() over the same
// records. It is not a mock-up of the storefront and it must never become one: a preview
// drawn by its own components is a promise about the shop rather than a picture of it, and
// the first time the two drift the curator is arranging a shelf that does not exist.
//
// Consequently THE PREVIEW OBEYS THE RULE. A section whose claim does not resolve shows
// nothing in the preview, exactly as it will show nothing on the shop, and the panel says so
// in words beside the empty space rather than drawing a placeholder in it. The words are the
// only thing the preview adds, and they are outside the frame.
//
// ── WHAT THE PANEL REFUSES ───────────────────────────────────────────────────────────────
//
//   · A DATA-DRIVEN SECTION CANNOT BE GIVEN BOOKS. Readers' Choice and Popular in Notes have
//     no slug field at all — not a disabled one, not an empty one. The writer refuses a
//     hand-typed claim on those types too (validateSection), so this is the second of two
//     fences and not the only one. Never simulate it.
//   · A SECTION'S TYPE CANNOT CHANGE after creation. updateSection refuses it; the form
//     shows the type as text once saved.
//   · NOTHING IS SEEDED HERE. The system is complete and the shelves are empty, and that is
//     the correct launch state for a four-title catalogue. The claims are Ikenna's.

import { useState } from 'react';
import {
  SECTION_TYPES,
  SECTION_TYPE_KEYS,
  DATA_CONTRACTS,
  resolveSections,
  bandsFor,
  applyBands,
  rebindSections,
  monthLabel,
  monthExpired,
  monthPending,
  TYPE_WINDOW,
} from '../../lib/bookstore/sections';
import { genreLabel as labelOf } from '../../lib/bookstore/genres';
import {
  createSection,
  updateSection,
  setSectionStatus,
  deleteSection,
  reorderSections,
  migrateWindowSection,
} from '../../lib/bookstore/admin-writes';
import CuratedSection, { CURATED_SECTION_CSS } from '../../bookstore/components/CuratedSection';
import { SHOP_VERNACULAR_CSS } from '../../bookstore/components/shopVernacular';
import { BOUND_BOOK_CSS } from '../../bookstore/components/BoundBook';
import { ShelfEntry, TheWindow } from '../../bookstore/page';

const blankFor = (type) => ({
  type,
  displayTitle: SECTION_TYPES[type]?.defaultTitle || '',
  order: 0,
  status: 'live',
  slugs: [],
  curatorLine: '',
  monthKey: '',
  ranked: false,
});

/** 'YYYY-MM' for the month a Date falls in, UTC — the same calendar monthKey is parsed in. */
function monthKeyOf(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function SectionsPanel({ s, sections, titles, genres, now, onChanged, showToast }) {
  const [editingId, setEditingId] = useState(null);   // section id, or '' for a new one
  const [form, setForm] = useState(blankFor(TYPE_WINDOW));
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(null); // section id under preview

  const published = (titles || []).filter((t) => t.status === 'published');
  const genreLabelFor = (g) => labelOf(genres || [], g);

  // THE CLOCK IS THE PARENT'S, taken in loadAll beside the records it dates.
  //
  // Two reasons it is not read here. The mechanical one: React refuses an impure call in a
  // render body (react-hooks/purity) and the lint ratchet counts every new violation. The
  // real one is that this panel's list pills and its preview must judge the same section
  // against the same instant — a clock read per render pass could tell a curator a claim is
  // live in the row and expired in the frame below it.

  const rows = [...(sections || [])].sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || String(a.id).localeCompare(String(b.id)));
  // THE SAME THREE STEPS THE STOREFRONT TAKES, in the same order: resolve, derive the bands
  // from what resolved, re-point the sections at the banded titles. Skipping the last two
  // here was the first version of this panel, and it produced a preview whose covers wore no
  // obi while the shop's would — a preview that is 95% the shop is the failure this whole
  // component exists to avoid.
  const resolvedAll = resolveSections(rows, published, { now, signals: {} });
  const bandedTitles = applyBands(published, bandsFor(resolvedAll));
  const live = rebindSections(resolvedAll, bandedTitles);
  const liveIds = new Set(live.map((x) => x.id));

  function openNew(type) {
    setForm({ ...blankFor(type), order: rows.length });
    setEditingId('');
    setErrors([]);
  }
  function openEdit(sec) {
    setForm({
      type: sec.type,
      displayTitle: sec.displayTitle || '',
      order: sec.order ?? 0,
      status: sec.status || 'live',
      slugs: Array.isArray(sec.slugs) ? sec.slugs : [],
      curatorLine: sec.curatorLine || '',
      monthKey: sec.monthKey || '',
      ranked: !!sec.ranked,
    });
    setEditingId(sec.id);
    setErrors([]);
  }

  async function save() {
    setErrors([]);
    setBusy(true);
    const payload = {
      ...form,
      order: Number.parseInt(form.order, 10) || 0,
      curatorLine: form.curatorLine.trim() || null,
    };
    const res = editingId ? await updateSection(editingId, payload) : await createSection(payload);
    setBusy(false);
    if (!res.ok) { setErrors(res.errors || ['Save failed']); return; }
    showToast(editingId ? 'Section saved' : 'Section created');
    setEditingId(null);
    onChanged();
  }

  async function move(id, delta) {
    const ids = rows.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setBusy(true);
    const res = await reorderSections(ids);
    setBusy(false);
    if (!res.ok) { window.alert((res.errors || ['Reorder failed']).join('\n')); return; }
    onChanged();
  }

  async function toggleStatus(sec) {
    setBusy(true);
    const res = await setSectionStatus(sec.id, sec.status === 'live' ? 'retired' : 'live');
    setBusy(false);
    if (!res.ok) { window.alert((res.errors || ['Failed']).join('\n')); return; }
    showToast(sec.status === 'live' ? 'Section retired' : 'Section live');
    onChanged();
  }

  async function remove(sec) {
    if (!window.confirm(`Delete “${sec.displayTitle}”? Retiring keeps the claim; deleting does not.`)) return;
    setBusy(true);
    const res = await deleteSection(sec.id);
    setBusy(false);
    if (!res.ok) { window.alert((res.errors || ['Delete failed']).join('\n')); return; }
    showToast('Section deleted');
    onChanged();
  }

  async function foldTheWindowIn() {
    if (!window.confirm('Fold the Window into the sections system? This writes the claim the shop is already showing, as a WINDOW section.')) return;
    setBusy(true);
    const res = await migrateWindowSection();
    setBusy(false);
    if (!res.ok) { window.alert((res.errors || ['Migration failed']).join('\n')); return; }
    showToast(`Window folded in — ${res.slug}`);
    onChanged();
  }

  const spec = SECTION_TYPES[form.type];

  // Why a given section is not on the shop. Reported in the curator's terms — resolveSections
  // simply drops it, and a curator staring at a shelf that is not there needs the sentence.
  function silenceReason(sec) {
    const sp = SECTION_TYPES[sec.type];
    if (!sp) return 'Unknown section type.';
    if (sec.status !== 'live') return 'Retired.';
    if (sp.dataDriven) {
      const c = DATA_CONTRACTS[sp.key];
      return c?.enabled
        ? 'Switched on, but no signal has been computed yet.'
        : 'Dormant. It renders nothing until there is real reader data AND the switch is flipped in code.';
    }
    if (sp.dated) {
      if (monthExpired(sec.monthKey, now)) return `The claim was for ${monthLabel(sec.monthKey) || sec.monthKey}, and that month has ended.`;
      if (monthPending(sec.monthKey, now)) return `The claim is for ${monthLabel(sec.monthKey) || sec.monthKey}, which has not started.`;
    }
    const resolved = (sec.slugs || []).filter((sg) => published.some((t) => t.slug === sg));
    if (resolved.length < sp.min) {
      return resolved.length === 0
        ? `No published title is claimed. It needs ${sp.min}.`
        : `${resolved.length} of the ${sp.min} it needs resolve to a published title.`;
    }
    return 'Not rendering.';
  }

  return (
    <div>
      {/* THE SHOP'S OWN STYLESHEET, not a copy of it. SHOP_VERNACULAR_CSS is the very string
          app/bookstore/page.js interpolates, so the preview cannot look like a shelf the shop
          would draw differently. Only the frame around it is local. */}
      <style>{`${BOUND_BOOK_CSS}${SHOP_VERNACULAR_CSS}${CURATED_SECTION_CSS}
        .cms-preview{background:#070707;color:#f0ead8;border:1px solid #242424;border-radius:10px;overflow:hidden;
          font-family:'Cormorant Garamond',Georgia,serif}
        /* The shop sizes its window title against the viewport with clamp(); inside a panel
           card that resolves against the WINDOW's width and prints a heading far larger than
           the frame it sits in. Pinned to the middle of the shop's own range. */
        .cms-preview .window-title{font-size:1.6rem}
      `}</style>

      <div style={s.topBar}>
        <div>
          <h2 style={s.h2}>Sections</h2>
          <div style={s.h2sub}>{rows.length} planned · {live.length} rendering on the shop right now</div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {rows.length === 0 && (
            <button style={s.btnGhost} onClick={foldTheWindowIn} type="button" disabled={busy}>Fold the Window in</button>
          )}
          <select
            style={{ ...s.select, width: 'auto' }}
            value=""
            onChange={(e) => { if (e.target.value) openNew(e.target.value); }}
          >
            <option value="">+ Add section…</option>
            {SECTION_TYPE_KEYS.map((k) => <option key={k} value={k}>{SECTION_TYPES[k].label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ ...s.section, borderColor: 'rgba(124,58,237,0.25)' }}>
        <div style={s.sectionTitle}>The rule every section obeys</div>
        <div style={s.hint}>
          A section is a <strong style={{ color: '#e8e8e8' }}>claim</strong>. There are no fallbacks and no empty states:
          a section that claims nothing, or whose claim no longer resolves to a published title,
          <strong style={{ color: '#e8e8e8' }}> does not appear on the shop at all</strong>. Nothing is ever filled in for you.
          The preview below shows exactly that — where the shop will be silent, so is the preview.
        </div>
      </div>

      {editingId !== null && spec && (
        <div style={s.section}>
          <div style={s.sectionTitle}>{editingId ? `Edit — ${spec.label}` : `New — ${spec.label}`}</div>
          <div style={{ ...s.hint, marginBottom: '1.1rem' }}>{spec.note}</div>
          {errors.length > 0 && <div style={s.errorBox}>{errors.map((e, i) => <span key={i}>{e}</span>)}</div>}

          <div style={s.row2}>
            <div style={s.fg}>
              <label style={s.label}>Display title <span style={s.labelSoft}>— the head, as it will be set</span></label>
              <input style={s.input} value={form.displayTitle} onChange={(e) => setForm((f) => ({ ...f, displayTitle: e.target.value }))} />
            </div>
            <div style={s.fg}>
              <label style={s.label}>Order</label>
              <input style={s.input} type="number" value={form.order} onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))} />
            </div>
          </div>

          <div style={{ ...s.fg, marginTop: '1.1rem' }}>
            <label style={s.label}>Curator&rsquo;s line <span style={s.labelSoft}>— optional, one sentence, in your own voice</span></label>
            <input style={s.input} value={form.curatorLine} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, curatorLine: e.target.value }))} />
          </div>

          {spec.dated && (
            <div style={{ ...s.fg, marginTop: '1.1rem' }}>
              <label style={s.label}>The month this claim is for</label>
              <input
                style={{ ...s.input, maxWidth: 260 }}
                type="month"
                value={form.monthKey}
                onChange={(e) => setForm((f) => ({ ...f, monthKey: e.target.value }))}
              />
              <div style={s.hint}>
                {form.monthKey
                  ? <>The shop will print <strong style={{ color: '#e8e8e8' }}>{monthLabel(form.monthKey) || form.monthKey}</strong> and hide this section the moment that month ends. Renew it by changing the month.</>
                  : <>Required. The section hides itself when the month ends — that is the point of dating the claim.</>}
              </div>
              <button style={{ ...s.btnSm, alignSelf: 'flex-start' }} type="button" onClick={() => setForm((f) => ({ ...f, monthKey: monthKeyOf(new Date()) }))}>This month</button>
            </div>
          )}

          {spec.rankable && (
            <label style={{ ...s.checkbox, marginTop: '1.1rem' }}>
              <input type="checkbox" checked={form.ranked} onChange={(e) => setForm((f) => ({ ...f, ranked: e.target.checked }))} />
              Number this shelf (I, II, III…) in the order below
            </label>
          )}

          {spec.dataDriven ? (
            /* ⚠ NO SLUG FIELD. Not disabled — absent. See the header. */
            <div style={{ ...s.section, marginTop: '1.2rem', background: '#111', borderColor: 'rgba(252,211,77,0.25)' }}>
              <div style={{ ...s.sectionTitle, color: '#fcd34d' }}>Data-driven — dormant</div>
              <div style={s.hintWarn}>
                This section&rsquo;s books come from real reader signals, never from a list typed here.
                There is no aggregate today, so it renders nothing — and it will keep rendering nothing until
                both are true: real data exists <em>and</em> the switch is flipped in code.
              </div>
              <div style={{ ...s.hint, marginTop: '0.8rem' }}>
                Contract: <code style={{ color: '#c4b5fd' }}>bookstore_signals/{DATA_CONTRACTS[spec.key]?.signalKey}</code> ·
                counts {DATA_CONTRACTS[spec.key]?.counts.join(', ')} · at least {DATA_CONTRACTS[spec.key]?.minEntries} entries.
                <br />{DATA_CONTRACTS[spec.key]?.note}
              </div>
            </div>
          ) : (
            <div style={{ ...s.fg, marginTop: '1.2rem' }}>
              <label style={s.label}>
                The claim <span style={s.labelSoft}>— {spec.min === spec.max ? `exactly ${spec.min}` : `${spec.min} to ${spec.max}`} {spec.max === 1 ? 'title' : 'titles'}, in your order</span>
              </label>
              <div style={s.chipsWrap}>
                {form.slugs.length === 0 && <span style={{ ...s.hint, padding: '0 .4rem' }}>Nothing claimed — this section will not render.</span>}
                {form.slugs.map((sg, i) => {
                  const t = published.find((x) => x.slug === sg);
                  return (
                    <span key={sg} style={s.chip}>
                      {spec.rankable && form.ranked ? `${i + 1}. ` : ''}{t ? t.title : `${sg} (not published)`}
                      <button style={s.chipX} type="button" onClick={() => setForm((f) => ({ ...f, slugs: f.slugs.filter((x) => x !== sg) }))}>×</button>
                    </span>
                  );
                })}
              </div>
              <select
                style={{ ...s.select, marginTop: '0.6rem' }}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  setForm((f) => (f.slugs.includes(v) || f.slugs.length >= spec.max ? f : { ...f, slugs: [...f.slugs, v] }));
                }}
              >
                <option value="">Add a title…</option>
                {published.filter((t) => !form.slugs.includes(t.slug)).map((t) => (
                  <option key={t.slug} value={t.slug}>{t.title} — {t.author}</option>
                ))}
              </select>
              {form.slugs.length >= spec.max && <div style={s.hint}>{spec.label} claims at most {spec.max}.</div>}
              {spec.band && <div style={s.hintGreen}>Every title claimed here wears the &ldquo;{spec.band}&rdquo; band on its cover, everywhere in the shop.</div>}
            </div>
          )}

          <div style={{ ...s.formActions, marginTop: '1.3rem' }}>
            <button style={s.btnGhost} type="button" onClick={() => setEditingId(null)}>Cancel</button>
            <button style={{ ...s.btn, ...(busy ? s.btnDisabled : {}) }} type="button" onClick={save} disabled={busy}>Save section</button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div style={s.empty}>
          <div style={{ fontSize: '1rem', color: '#fff', fontWeight: 600 }}>No sections yet.</div>
          <div>The shop is showing the Window from the old <code>featured</code> flag. Fold it in above, then plan the shelves.</div>
        </div>
      ) : rows.map((sec) => {
        const sp = SECTION_TYPES[sec.type];
        const rendering = liveIds.has(sec.id);
        const resolved = live.find((x) => x.id === sec.id);
        return (
          <div key={sec.id} style={s.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff' }}>{sec.displayTitle}</span>
                  <span style={{ ...s.pill, color: '#c4b5fd', borderColor: 'rgba(124,58,237,0.4)' }}>{sp ? sp.label : sec.type}</span>
                  {sec.monthKey && <span style={{ ...s.pill, color: '#a78bfa', borderColor: 'rgba(124,58,237,0.3)' }}>{monthLabel(sec.monthKey) || sec.monthKey}</span>}
                  {sec.ranked && <span style={{ ...s.pill, color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.2)' }}>Ranked</span>}
                  {rendering
                    ? <span style={{ ...s.pill, color: '#86efac', borderColor: 'rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)' }}>On the shop</span>
                    : <span style={{ ...s.pill, color: 'rgba(255,255,255,0.55)', borderColor: 'rgba(255,255,255,0.2)' }}>Silent</span>}
                </div>
                <div style={{ ...s.h2sub, marginTop: 6 }}>
                  {rendering
                    ? `${resolved.titles.length} ${resolved.titles.length === 1 ? 'title' : 'titles'} · position ${sec.order}`
                    : silenceReason(sec)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button style={s.btnSm} type="button" disabled={busy} onClick={() => move(sec.id, -1)}>↑</button>
                <button style={s.btnSm} type="button" disabled={busy} onClick={() => move(sec.id, 1)}>↓</button>
                <button style={s.btnSm} type="button" onClick={() => setPreviewing(previewing === sec.id ? null : sec.id)}>{previewing === sec.id ? 'Hide preview' : 'Preview'}</button>
                <button style={s.btnSm} type="button" onClick={() => openEdit(sec)}>Edit</button>
                <button style={s.btnSm} type="button" disabled={busy} onClick={() => toggleStatus(sec)}>{sec.status === 'live' ? 'Retire' : 'Make live'}</button>
                <button style={s.btnDanger} type="button" disabled={busy} onClick={() => remove(sec)}>Delete</button>
              </div>
            </div>

            {previewing === sec.id && (
              <div style={{ marginTop: '1.2rem' }}>
                <div style={{ ...s.filterLabel, marginBottom: '0.5rem' }}>Preview — the shop&rsquo;s own components, over this claim</div>
                {resolved ? (
                  <div className="cms-preview">
                    <CuratedSection
                      section={resolved}
                      genreLabelFor={genreLabelFor}
                      renderWindow={(t) => (
                        <div style={{ padding: '2rem' }}>
                          <div style={{ textAlign: 'center', fontFamily: "'Cinzel',serif", fontSize: '.62rem', letterSpacing: '.3em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.6rem' }}>&#10086; In the Window &#10086;</div>
                          <TheWindow title={t} genreLabelFor={genreLabelFor} />
                        </div>
                      )}
                      renderEntry={(t, i, opts) => (
                        <ShelfEntry title={t} index={i} onOpen={() => {}} genreLabelFor={genreLabelFor} suppressMark={opts?.suppressMark} />
                      )}
                    />
                  </div>
                ) : (
                  /* THE PREVIEW OBEYS THE RULE. Nothing is drawn, because nothing will be. */
                  <div style={{ ...s.empty, padding: '2rem 1.5rem' }}>
                    <div style={{ color: '#fff', fontWeight: 600 }}>Nothing renders.</div>
                    <div style={{ fontSize: '0.85rem' }}>{silenceReason(sec)}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
