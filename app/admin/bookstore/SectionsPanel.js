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
//   · THE WINDOW CANNOT BE MOVED. Its placement control is absent rather than disabled, on
//     the same principle as the missing slug field above.
//
// ── R15 — PLACEMENT, AND WHY THE PREVIEW GREW A SHELF AROUND IT ──────────────────────────
//
// Sections used to render in one band above the catalogue, and the panel's preview drew each
// one in an empty frame. Both were the same mistake seen twice: a table has a PLACE, and a
// picture of it with nothing around it answers the wrong question. The panel now carries the
// placement control — a stop, plus a depth in books when the stop is a shelf — and previews a
// placed table INSIDE the storefront's real CatalogueSection, cut at the depth the record
// asks for, by the same planShopFlow() the shop calls.

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
  PLACEMENT_OPENING,
  PLACEMENT_FOOT,
  SHELF_PLACEMENTS,
  isShelfPlacement,
  placementOf,
  planShopFlow,
} from '../../lib/bookstore/sections';
import { genreLabel as labelOf, groupLabel, titlesInGroup, genresPresentIn } from '../../lib/bookstore/genres';
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
import { ShelfEntry, TheWindow, CatalogueSection } from '../../bookstore/page';

const blankFor = (type) => ({
  type,
  displayTitle: SECTION_TYPES[type]?.defaultTitle || '',
  order: 0,
  status: 'live',
  slugs: [],
  curatorLine: '',
  monthKey: '',
  ranked: false,
  // R15 — A NEW TABLE STARTS IN THE SHELVES, not above them.
  //
  // The Window's lock wins here as it does everywhere. For everything else the form opens on
  // the first shelf, at its top, because that is the ruling this round exists to implement:
  // a reader should keep coming upon curated tables while walking the shelves, and a default
  // of 'opening' would rebuild the pile of headers one new section at a time. The sentence
  // under the control says exactly where it will land, and one dropdown moves it.
  //
  // ⚠ THIS IS THE FORM'S DEFAULT, NOT THE READER'S. A record already on file with no
  // placement means 'opening' — see DEFAULT_PLACEMENT — because that is where it was actually
  // rendering before this round. The two defaults answer different questions and it would be
  // a bug to make them agree.
  placement: SECTION_TYPES[type]?.placementLocked || SHELF_PLACEMENTS[0],
  placeAfter: 0,
});

// ═════════════════════════════════════════════════════════════════════════════════════════
// R15 — WHERE IT SITS, IN SENTENCES
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// The panel already explains itself in plain sentences rather than in field names — "It hides
// itself when the month ends", "Nothing claimed — this section will not render". Placement is
// the field that most needs that treatment, because its two degradation rules are invisible
// from the form: a curator who types 12 on a shelf of 4 has not made a mistake and must not be
// told they have, but they do need to be told what will happen today.
//
// So every state of the control has a sentence, and the sentence is computed from the SAME
// numbers the shop is about to use.

const PLACEMENT_CHOICES = [
  { key: PLACEMENT_OPENING, label: 'Opening the shop — above the shelves' },
  ...SHELF_PLACEMENTS.map((g) => ({ key: g, label: `Into the ${groupLabel(g)} shelf` })),
  { key: PLACEMENT_FOOT, label: 'At the foot of the catalogue' },
];

/**
 * @param placement   one of PLACEMENTS
 * @param placeAfter  the depth as typed, UNCLAMPED — the sentence's whole job is to say what
 *                    happens to a number the shelf cannot honour yet
 * @param counts      { [group]: how many published titles that half of the shop holds }
 */
function placementSentence(placement, placeAfter, counts) {
  if (placement === PLACEMENT_OPENING) {
    return 'It stands above the catalogue, under the title page, before the first shelf.';
  }
  if (placement === PLACEMENT_FOOT) {
    return 'It stands after the last shelf, just above the colophon.';
  }
  const name = groupLabel(placement);
  const count = counts[placement] || 0;
  const wanted = Math.max(0, Number.parseInt(placeAfter, 10) || 0);

  // Degradation rule 2, in the curator's terms. Not a warning — a schedule.
  if (count === 0) {
    return `Nothing is published in ${name} yet, so this will stand at the foot of the catalogue until something is. It moves into the shelf by itself the day that happens.`;
  }
  const books = (n) => `${n} ${n === 1 ? 'book' : 'books'}`;
  if (wanted === 0) {
    return `It stands at the top of the ${name} shelf, under its tabs, above the first ${books(count)}.`;
  }
  // Degradation rule 1, likewise: it waits at the end of the shelf, it does not disappear.
  if (wanted > count) {
    return `The ${name} shelf holds ${books(count)} today, so this stands at its foot for now — and moves up to sit after the ${wanted}th once there are that many.`;
  }
  if (wanted === count) {
    return `It stands at the foot of the ${name} shelf, after all ${books(count)}.`;
  }
  return `A reader walking the ${name} shelf meets it after ${books(wanted)}, with ${books(count - wanted)} still below it.`;
}

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
  // The preview's own tab. It exists so a curator can SEE the filtered-tab ruling rather than
  // read about it: narrow the shelf in the frame and the table steps out of the way.
  const [previewTab, setPreviewTab] = useState('all');

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

  // ── R15 — THE SHELVES, AS THE SHOP COUNTS THEM ────────────────────────────────────────
  // The same call the storefront makes, over the same taxonomy, so every sentence below is
  // about the shop's actual shelves and not about an approximation of them. Published only —
  // a draft is not on a shelf, so it cannot be a book a table stands after.
  const shelfTitles = {};
  const shelfCounts = {};
  for (const g of SHELF_PLACEMENTS) {
    shelfTitles[g] = titlesInGroup(genres, bandedTitles, g);
    shelfCounts[g] = shelfTitles[g].length;
  }

  function openNew(type) {
    setForm({ ...blankFor(type), order: rows.length });
    setEditingId('');
    setErrors([]);
  }
  function openEdit(sec) {
    const { placement, placeAfter } = placementOf(sec);
    setForm({
      type: sec.type,
      placement,
      placeAfter,
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
      placeAfter: Number.parseInt(form.placeAfter, 10) || 0,
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

  /**
   * Is this resolved section standing INSIDE a shelf the panel can draw?
   *
   * Both halves are required. A placement of 'fiction' on a shop with nothing published in
   * fiction is a table at the foot of the catalogue — degradation rule 2 — and there is no
   * shelf to preview it in, so it falls to the isolated frame plus the sentence.
   */
  function inShelf(resolvedSec) {
    return !!resolvedSec && isShelfPlacement(resolvedSec.placement) && shelfCounts[resolvedSec.placement] > 0;
  }

  /** The isolated frame, unchanged from R13 — and the renderer the shelf frame injects. */
  function renderPreviewSection(one) {
    return (
      /* R17.3 — NO onOpen ANYWHERE IN THE PREVIEW, and it used to be `() => {}`. The
         distinction is load-bearing now: a book with no onOpen turns itself back after the
         breathe, whereas one handed a no-op flips and stands face-down forever — the only
         thing that ever un-flips it is the Quick Look closing, and there is no Quick Look in
         the CMS. The preview has no modal to open, so it says so by saying nothing. */
      <CuratedSection
        section={one}
        genreLabelFor={genreLabelFor}
        renderWindow={(t) => (
          <div style={{ padding: '2rem' }}>
            <div style={{ textAlign: 'center', fontFamily: "'Cinzel',serif", fontSize: '.62rem', letterSpacing: '.3em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.6rem' }}>&#10086; In the Window &#10086;</div>
            <TheWindow title={t} genreLabelFor={genreLabelFor} />
          </div>
        )}
        renderEntry={(t, i, opts) => (
          <ShelfEntry title={t} index={i} genreLabelFor={genreLabelFor} suppressMark={opts?.suppressMark} />
        )}
      />
    );
  }

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
              <label style={s.label}>Order <span style={s.labelSoft}>— among the sections at the same place</span></label>
              <input style={s.input} type="number" value={form.order} onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))} />
            </div>
          </div>

          {/* ── R15 — WHERE IT SITS ─────────────────────────────
              The one control this round exists to add. Order sits beside it deliberately: the
              two answer different questions and used to be conflated in one number. Placement
              says WHICH STOP, order says the sequence of tables standing at the SAME stop. */}
          <div style={{ ...s.section, marginTop: '1.2rem' }}>
            <div style={s.sectionTitle}>Where it sits</div>
            {spec.placementLocked ? (
              /* ⚠ NO CONTROL. Absent, not disabled — the same shape as a data-driven section's
                 missing slug field, and for the same reason: a greyed-out dropdown invites the
                 question of how to un-grey it. */
              <div style={s.hint}>
                The Window opens the shop. It stands directly under the title page, above every
                shelf, and it does not move — a display case three-quarters of the way down a
                shelf is not a window. To feature a book further down the scroll, use
                Editor&rsquo;s Choice or Book of the Month; both draw a case and both go anywhere.
              </div>
            ) : (
              <>
                <div style={s.row2}>
                  <div style={s.fg}>
                    <label style={s.label}>Its place in the shop&rsquo;s scroll</label>
                    <select
                      style={s.select}
                      value={form.placement}
                      onChange={(e) => setForm((f) => ({ ...f, placement: e.target.value }))}
                    >
                      {PLACEMENT_CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                  {isShelfPlacement(form.placement) && (
                    <div style={s.fg}>
                      <label style={s.label}>
                        After how many books <span style={s.labelSoft}>— 0 puts it at the top</span>
                      </label>
                      <input
                        style={s.input}
                        type="number"
                        min={0}
                        value={form.placeAfter}
                        onChange={(e) => setForm((f) => ({ ...f, placeAfter: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
                <div style={{ ...s.hint, marginTop: '0.8rem' }}>{placementSentence(form.placement, form.placeAfter, shelfCounts)}</div>
                {isShelfPlacement(form.placement) && (
                  <div style={{ ...s.hint, marginTop: '0.5rem' }}>
                    Books, not rows — a row is four covers on a laptop and one on a phone, so
                    counting books is what puts the table after the same book on every screen.
                    While a reader has a single genre selected the shelf is theirs: the tables step
                    out, and come back when they choose All {groupLabel(form.placement)}.
                  </div>
                )}
              </>
            )}
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
        const placed = placementOf(sec);
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
                    ? `${resolved.titles.length} ${resolved.titles.length === 1 ? 'title' : 'titles'}`
                    : silenceReason(sec)}
                </div>
                {/* WHERE IT SITS, ON EVERY ROW — including the silent ones. A retired table
                    keeps its place; that is the difference between retiring and deleting, and
                    a curator bringing one back should already know where it will land. */}
                <div style={{ ...s.h2sub, marginTop: 4 }}>{placementSentence(placed.placement, placed.placeAfter, shelfCounts)}</div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button style={s.btnSm} type="button" disabled={busy} onClick={() => move(sec.id, -1)}>↑</button>
                <button style={s.btnSm} type="button" disabled={busy} onClick={() => move(sec.id, 1)}>↓</button>
                {/* The tab resets with every open. A genre selected while previewing a fiction
                    table is not a genre the non-fiction shelf has, so carrying it across would
                    show the next preview an empty shelf and no table — a picture of nothing,
                    caused by the panel rather than by the claim. */}
                <button style={s.btnSm} type="button" onClick={() => { setPreviewTab('all'); setPreviewing(previewing === sec.id ? null : sec.id); }}>{previewing === sec.id ? 'Hide preview' : 'Preview'}</button>
                <button style={s.btnSm} type="button" onClick={() => openEdit(sec)}>Edit</button>
                <button style={s.btnSm} type="button" disabled={busy} onClick={() => toggleStatus(sec)}>{sec.status === 'live' ? 'Retire' : 'Make live'}</button>
                <button style={s.btnDanger} type="button" disabled={busy} onClick={() => remove(sec)}>Delete</button>
              </div>
            </div>

            {previewing === sec.id && (
              <div style={{ marginTop: '1.2rem' }}>
                <div style={{ ...s.filterLabel, marginBottom: '0.5rem' }}>
                  {inShelf(resolved) ? 'Preview — the table in its place, on the shelf it stands in' : 'Preview — the shop’s own components, over this claim'}
                </div>
                {resolved ? (
                  <div className="cms-preview">
                    {/* ── R15 — IN CONTEXT, NOT IN ISOLATION ─────────────────────────────
                        A curated table in an empty frame told the curator what it looks like
                        and nothing about where it lands, which is precisely the question this
                        round is about. So a table placed into a shelf is previewed INSIDE THE
                        REAL CatalogueSection — the storefront's own component, over the
                        storefront's own shelf, cut at the depth the record asks for by the
                        same planShopFlow() the shop calls. The head, the tabs, the books above
                        it and the books below it are all the shop's.

                        The tabs are live in here on purpose: narrowing the shelf shows the
                        filtered-tab ruling happening rather than describing it. */}
                    {inShelf(resolved)
                      ? (
                        <CatalogueSection
                          id={`preview-${sec.id}`}
                          sectionLabel={groupLabel(resolved.placement)}
                          allLabel={`All ${groupLabel(resolved.placement)}`}
                          titles={shelfTitles[resolved.placement]}
                          genresPresent={genresPresentIn(genres, shelfTitles[resolved.placement], resolved.placement)}
                          active={previewTab}
                          setActive={setPreviewTab}
                          genreLabelFor={genreLabelFor}
                          interleaves={planShopFlow([resolved], [{ group: resolved.placement, count: shelfCounts[resolved.placement] }]).shelves[resolved.placement]}
                          renderSection={(one) => renderPreviewSection(one)}
                        />
                      )
                      : renderPreviewSection(resolved)}
                  </div>
                ) : (
                  /* THE PREVIEW OBEYS THE RULE. Nothing is drawn, because nothing will be. */
                  <div style={{ ...s.empty, padding: '2rem 1.5rem' }}>
                    <div style={{ color: '#fff', fontWeight: 600 }}>Nothing renders.</div>
                    <div style={{ fontSize: '0.85rem' }}>{silenceReason(sec)}</div>
                  </div>
                )}
                {/* The context a frame cannot draw. 'opening' and 'foot' stand OUTSIDE any
                    shelf, so there is no shelf to draw them into — the sentence is the honest
                    picture, and the panel already puts its words outside the frame. */}
                {resolved && !inShelf(resolved) && (
                  <div style={{ ...s.hint, marginTop: '0.6rem' }}>{placementSentence(placed.placement, placed.placeAfter, shelfCounts)}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
