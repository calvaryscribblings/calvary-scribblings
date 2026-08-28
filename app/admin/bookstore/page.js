'use client';
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../lib/AuthContext';
import { getAllPublishers, getTitlesByPublisher } from '../../lib/bookstore/loader';
import {
  createTitle,
  updateTitle,
  setTitleStatus,
  uploadCover,
  uploadCoverDerivatives,
  makeCoverLqip,
  uploadAuthorPhoto,
  uploadEpub,
  uploadSampleEpub,
  // R21 — the two ways a title leaves the shop. `deleteTitle` is a REAL delete now; it used to
  // be setTitleStatus(id, 'unpublished') wearing the name.
  withdrawTitle,
  restoreTitle,
  deleteTitle,
  deletionPreview,
} from '../../lib/bookstore/admin-writes';
// R19.6 — THE PUBLISH → DEPLOY HANDSHAKE. A static export serves files, so a published record
// has no pages until a build runs. See app/lib/rebuild.js and functions/api/rebuild.js; this
// file names a hook ('bookstore') and never holds one. R19.7 moved both modules up out of the
// bookstore namespace — four surfaces use them now and only one is the shop.
import { rebuildNeeded, requestRebuild, HOOKS } from '../../lib/rebuild';
import { TITLE_STATUSES } from '../../lib/bookstore/schema';
// R18 — the author block's bounds and its 3 MB photo cap, read from the one module the write
// path and the RTDB .validate rules are both pinned to. Never re-typed here.
import { AUTHOR_CAPS, MAX_AUTHOR_PHOTO_BYTES, publicPhotoUrl } from '../../lib/bookstore/author';
// R13 — the taxonomy and the curation system. The genre dropdown used to be built from
// schema.js's GENRES with labels DERIVED from the slug, and it disagreed with the shop on
// four of the twelve ("Thriller Suspense" here, "Thriller & Suspense" on the shelf). It now
// reads the same records the shop reads.
import { getGenres, getSections } from '../../lib/bookstore/loader';
import { genreLabel as labelOf, sortGenres } from '../../lib/bookstore/genres';
import SectionsPanel from './SectionsPanel';
// R21 — the confirm steps. Both dialogs live in their own file because both are ARGUMENTS as
// much as furniture: the wording is the feature. See the header there.
import { WithdrawDialog, DeleteDialog } from './RemovalDialog';
import { WITHDRAWN, isScheduled } from '../../lib/bookstore/withdrawal';
import GenresPanel from './GenresPanel';
// R7.4 — the same parser the reader's lookup is built on, so what an editor types here
// and what a long-press finds cannot drift apart.
import { parseGlossary, serialiseGlossary } from '../../lib/dictionary';
// R8.4 — the rights vocabulary. describeTerritories is the SAME renderer the list column uses
// and the same one the form's live summary uses, so what an editor is shown before saving and
// what they are shown afterwards cannot disagree.
import {
  TERRITORY_PRESETS,
  describeTerritories,
  territoriesToForm,
  territoriesFromForm,
  MODE_WORLDWIDE,
  MODE_ALLOW,
  MODE_DENY,
} from '../../lib/bookstore/territory';
import { COUNTRY_CODES, COUNTRY_NAMES } from '../../lib/bookstore/countries';
// R8.4 — the drift logged in R8.3, closed. The admin table printed money through a local
// formatGbpMinor while every reader-facing surface used formatPrice; two implementations of
// one job is how a shop ends up quoting one number to an editor and another to a customer.
import { formatPrice } from '../../bookstore/components/fields';

const ADMIN_EMAIL = 'ikennaworksfromhome@gmail.com';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TITLES_PATH = 'bookstore_titles';

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// R8.4 — all three currencies in the list, using the shared formatter. An unset currency is
// marked rather than omitted: "—" beside a code says "nobody has priced this yet", which is a
// fact an editor needs, where a missing column says only that the table is narrow. This is the
// column that used to be "Price (GBP)" and a local formatGbpMinor.
function PriceCell({ prices }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end', fontSize: '0.8rem' }}>
      {['gbp', 'ngn', 'usd'].map((c) => {
        const tag = formatPrice(c, prices?.[c]);
        return (
          <span key={c} style={{ color: tag ? '#e8e8e8' : 'rgba(255,255,255,0.28)', fontVariantNumeric: 'tabular-nums' }}>
            {tag || `— ${c.toUpperCase()}`}
          </span>
        );
      })}
    </div>
  );
}

// R8.4 — thin adapters over the shared converters in app/lib/bookstore/territory.js, which own
// the mapping between the database's two fields and this form's mode-plus-one-list. The form
// uses the canonical mode constants verbatim rather than inventing its own names, so there is
// no translation table to get wrong and the round trip is testable without a browser.
const territoriesToFormState = (title) => {
  const { mode, countries } = territoriesToForm(title);
  return { territoriesMode: mode, territoriesList: countries, territorySearch: '' };
};
const territoriesFromFormState = (form) => territoriesFromForm(form.territoriesMode, form.territoriesList);

function minorToMajor(minor) {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return '';
  return (minor / 100).toFixed(2);
}

function majorToMinor(major) {
  if (major === '' || major === null || major === undefined) return null;
  const n = Number(major);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

const s = {
  page: { minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "Cormorant Garamond, Georgia, serif" },
  header: { background: '#171717', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' },
  logo: { fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', letterSpacing: '0.05em' },
  sub: { fontSize: '0.68rem', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em', marginTop: 2 },
  headerLinks: { display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' },
  body: { maxWidth: 1080, margin: '0 auto', padding: '2.5rem 2rem' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' },
  h2: { fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: 0 },
  h2sub: { fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginTop: 4 },
  section: { background: '#141414', border: '1px solid #242424', borderRadius: 10, padding: '1.5rem', marginBottom: '1.25rem' },
  sectionTitle: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#c4b5fd', marginBottom: '1.1rem' },
  btn: { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', border: 'none', padding: '0.65rem 1.5rem', borderRadius: 6, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnGhost: { background: 'transparent', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.4)', padding: '0.55rem 1.2rem', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDanger: { background: 'rgba(220,38,38,0.12)', color: '#f87171', border: '1px solid rgba(220,38,38,0.25)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnSm: { background: 'rgba(124,58,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.3)', padding: '0.45rem 0.9rem', borderRadius: 5, fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit' },
  btnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, background: '#171717', border: '1px solid #242424', borderRadius: 10, overflow: 'hidden' },
  th: { textAlign: 'left', padding: '0.85rem 1rem', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid #2a2a2a', background: '#141414' },
  td: { padding: '0.95rem 1rem', fontSize: '0.86rem', color: '#fff', borderBottom: '1px solid #1f1f1f', verticalAlign: 'middle' },
  tdMuted: { color: 'rgba(255,255,255,0.5)' },
  thumb: { width: 40, height: 60, objectFit: 'cover', borderRadius: 3, background: '#2a2a2a' },
  pill: { display: 'inline-block', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0.18rem 0.55rem', borderRadius: 12, border: '1px solid' },
  empty: { background: '#171717', border: '1px dashed #2e2e2e', borderRadius: 10, padding: '3rem 1.5rem', textAlign: 'center', color: 'rgba(255,255,255,0.55)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' },
  filtersRow: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' },
  filterFg: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  filterLabel: { fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.4)' },
  fg: { display: 'flex', flexDirection: 'column', gap: '0.45rem' },
  label: { fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#a78bfa' },
  labelSoft: { fontWeight: 400, color: 'rgba(255,255,255,0.35)', textTransform: 'none', letterSpacing: 0 },
  input: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  inputErr: { borderColor: 'rgba(220,38,38,0.55)' },
  textarea: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 110, resize: 'vertical', lineHeight: 1.55 },
  textareaTall: { minHeight: 200 },
  select: { background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6, padding: '0.72rem 1rem', color: '#fff', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' },
  row2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.1rem' },
  row3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.1rem' },
  hint: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 },
  hintWarn: { fontSize: '0.7rem', color: '#fcd34d', lineHeight: 1.5 },
  hintGreen: { fontSize: '0.7rem', color: '#86efac', lineHeight: 1.5 },
  errorBox: { background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 6, padding: '0.85rem 1rem', color: '#fca5a5', fontSize: '0.82rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '1.25rem' },
  formActions: { display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', padding: '0.5rem 0' },
  // R19.6 — THE DEPLOY NOTICE. Above the toast and outliving it: the toast says what just
  // happened (1.5s), this says what is about to (two minutes). Two different tenses, so two
  // different pieces of furniture rather than one that has to be both.
  rebuild: { position: 'fixed', bottom: '4.6rem', left: '50%', transform: 'translateX(-50%)', maxWidth: 'min(92vw, 30rem)', background: '#171717', border: '1px solid #2a2a2a', borderRadius: 8, padding: '0.85rem 1.1rem', fontSize: '0.82rem', lineHeight: 1.5, boxShadow: '0 12px 32px rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', gap: '0.7rem' },
  rebuildDismiss: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1, padding: 0, marginLeft: 'auto' },
  toast: { position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)', background: '#171717', border: '1px solid #2a2a2a', borderRadius: 8, padding: '0.85rem 1.4rem', color: '#86efac', fontSize: '0.85rem', fontWeight: 600, boxShadow: '0 12px 32px rgba(0,0,0,0.6)', zIndex: 1000 },
  gate: { minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: "Cormorant Garamond, Georgia, serif", flexDirection: 'column', gap: '1rem', textAlign: 'center' },
  radioGroup: { display: 'flex', gap: '1rem', flexWrap: 'wrap' },
  radioOption: { display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.88rem', color: '#e8e8e8' },
  // R8.4 — no longer monospace: the chips carry country NAMES now, not codes, and a proportional
  // face is what "United Arab Emirates" needs to be read rather than parsed.
  chip: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(124,58,237,0.18)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.4)', borderRadius: 999, padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600 },
  chipX: { background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem', padding: 0, lineHeight: 1 },
  chipsWrap: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', minHeight: '2rem', alignItems: 'center', padding: '0.4rem', background: '#1a1a1a', border: '1px solid #2e2e2e', borderRadius: 6 },
  fileBlock: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  fileRow: { display: 'flex', gap: '0.6rem', alignItems: 'center' },
  fileMeta: { fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)' },
  progressBar: { height: 4, background: '#2a2a2a', borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', background: 'linear-gradient(90deg, #7c3aed, #a855f7)', transition: 'width 0.2s' },
  checkbox: { display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.88rem', cursor: 'pointer', color: '#e8e8e8' },
  // R18 — a text button for a destructive-but-trivial action (dropping a photograph from a
  // draft). Deliberately not a `btn`: this is one step, undone by picking another file.
  linkBtn: { background: 'none', border: 'none', padding: 0, color: '#a78bfa', fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' },
};

function statusPill(status) {
  if (status === 'published') return { ...s.pill, color: '#86efac', borderColor: 'rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)' };
  if (status === 'draft') return { ...s.pill, color: '#fcd34d', borderColor: 'rgba(217,119,6,0.4)', background: 'rgba(217,119,6,0.1)' };
  if (status === 'unpublished') return { ...s.pill, color: 'rgba(255,255,255,0.55)', borderColor: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)' };
  // R21 — amber, and deliberately not the grey 'unpublished' wears. A withdrawn title is not a
  // title someone is mid-way through editing; it is one that has left the shop, and the row
  // has to say which of those two it is at a glance.
  if (status === WITHDRAWN) return { ...s.pill, color: '#fdba74', borderColor: 'rgba(234,88,12,0.45)', background: 'rgba(234,88,12,0.12)' };
  return { ...s.pill, color: 'rgba(255,255,255,0.6)', borderColor: 'rgba(255,255,255,0.2)' };
}

const emptyForm = {
  title: '',
  author: '',
  publisherId: '',
  slug: '',
  isbn: '',
  // R13 — was GENRES[0], a constant. The form now takes its default from the live taxonomy
  // (see openNew), and '' here means "nothing chosen yet" rather than a genre picked by
  // whichever slug happened to sort first in a file.
  genre: '',
  tagsRaw: '',
  pageCount: '',
  publishedDate: '',
  synopsis: '',
  excerpt: '',
  // The Bookseller's Fields (R4b)
  backCoverBlurb: '',
  openingLine: '',
  shelfCard: '',
  glossary: '',            // R7.4 — authored as text, saved as a map
  catalogueNumber: '',
  // R18 — THE AUTHOR BLOCK. authorName is NOT the byline above; see the note by the fields.
  authorName: '',
  authorBio: '',
  authorPhotoAlt: '',
  authorPhotoFile: null,
  authorPhotoPath: '',   // existing storage path when editing
  priceGbp: '',
  priceNgn: '',
  priceUsd: '',
  // R8.4 — three modes, matching the three storable states exactly. `territoriesList` holds
  // whichever list the chosen mode names: the EXCLUSIONS under 'except', the ALLOW-LIST under
  // 'only'. One list rather than two because the two can never both apply — that combination
  // is what assertTerritories refuses — and a form that can hold an impossible state is a form
  // that will eventually be saved in one.
  territoriesMode: MODE_WORLDWIDE, // MODE_WORLDWIDE | MODE_DENY | MODE_ALLOW
  territoriesList: [],
  territorySearch: '',
  coverFile: null,
  coverUrl: '',          // existing URL when editing
  // R20 — carried on the form so editing a synopsis cannot silently strip a title's rungs.
  // Same reason /admin/voices carries cardSizes; see the note on nextCoverSizes in onSave.
  coverSizes: {},
  epubFile: null,
  epubPath: '',          // existing path when editing
  sampleFile: null,
  samplePath: '',        // existing sample path when editing
  status: 'draft',
  featured: false,
  bestseller: false,
};

export default function AdminBookstorePage() {
  const { user } = useAuth();
  const [view, setView] = useState('list');
  const [titles, setTitles] = useState([]);
  const [publishers, setPublishers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [toast, setToast] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editingTitleId, setEditingTitleId] = useState(null);
  // The status the open title was LOADED at. The form's own `status` is what the editor has
  // selected, which is not the same question: "did publishedness change" needs both ends.
  const [editingStatusWas, setEditingStatusWas] = useState(null);
  // R19.6 — the deploy notice. NOT the toast: the toast retires after 1.5s and this sentence
  // is a promise about the next two minutes, which a reader has to be able to still be reading
  // when they navigate. { tone: 'ok' | 'bad', text } or null.
  const [rebuildNotice, setRebuildNotice] = useState(null);
  const [coverProgress, setCoverProgress] = useState(null);
  // R20 — the sizing pass reports separately from the upload: they are two different waits and
  // a single bar that restarted would read as a stall.
  const [derivProgress, setDerivProgress] = useState(null);
  const [epubProgress, setEpubProgress] = useState(null);
  const [sampleProgress, setSampleProgress] = useState(null);
  const [authorPhotoProgress, setAuthorPhotoProgress] = useState(null);

  // R21 — the removal dialogs. One slot: at most one can be open.
  const [removal, setRemoval] = useState(null);
  const [removalBusy, setRemovalBusy] = useState(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPublisher, setFilterPublisher] = useState('all');
  const [filterGenre, setFilterGenre] = useState('all');
  // R13 — the taxonomy and the shelf plan, loaded beside the titles they describe.
  const [genres, setGenres] = useState([]);
  const [sections, setSections] = useState([]);
  // 'titles' | 'sections' | 'genres' — the panel showing. The title form still lives in
  // `view` ('list' | 'new' | 'edit') so nothing about the existing screen moved.
  const [panel, setPanel] = useState('titles');
  // The clock the Sections panel judges dated claims against. Set in loadAll, beside the
  // records it dates — see the note at the head of SectionsPanel.
  const [now, setNow] = useState(0);

  const isAdmin = user && (user.uid === 'XaG6bTGqdDXh7VkBTw4y1H2d2s82' || user.uid === 'GfXFIc0dThZ1cs2SBBQIFao4aSz1' || (user.email && user.email.toLowerCase() === ADMIN_EMAIL));
  const activePublishers = useMemo(() => publishers.filter((p) => p.status === 'active'), [publishers]);
  const publisherById = useMemo(() => {
    const m = {};
    publishers.forEach((p) => { m[p.slug] = p; });
    return m;
  }, [publishers]);
  // Catalogue-number → title, for the non-blocking duplicate warning in the form.
  const catalogueInUse = useMemo(() => {
    const m = new Map();
    titles.forEach((t) => { if (Number.isInteger(t.catalogueNumber)) m.set(t.catalogueNumber, t); });
    return m;
  }, [titles]);

  useEffect(() => {
    if (!isAdmin) return;
    loadAll();
  }, [isAdmin]);

  async function loadAll() {
    setLoading(true);
    try {
      const [pubList] = await Promise.all([getAllPublishers()]);
      pubList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setPublishers(pubList);
      // Read all titles for admin (status-agnostic). We bypass loader filters by reading directly.
      const { ref, get } = await import('firebase/database');
      const { db } = await import('../../lib/firebase');
      const snap = await get(ref(db, TITLES_PATH));
      const out = [];
      if (snap.exists()) {
        snap.forEach((child) => { out.push({ id: child.key, ...child.val() }); return false; });
      }
      out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      setTitles(out);
      // R17.2 — getSections takes no argument now. It used to be handed the published subset,
      // because that is what its bootstrap read; the bootstrap is gone and so is the filter
      // that existed only to feed it.
      const [g, secs] = await Promise.all([getGenres(), getSections()]);
      setGenres(g);
      setSections(secs);
      setNow(Date.now());
    } catch (e) {
      console.error('[admin/bookstore] load failed', e);
    }
    setLoading(false);
  }

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(''), 1500);
  }

  // ── R19.6 — SUMMON THE DEPLOY, ONCE PER FLIP ────────────────────────────────────────────
  //
  // Called after a status change has ALREADY SUCCEEDED, and never before one. Three rules, and
  // all three are the difference between this helping and this hurting:
  //
  //   1. ONLY WHEN PUBLISHEDNESS CHANGED. rebuildNeeded() decides; a draft→unpublished flip
  //      changes nothing anyone can see and does not spend a build on saying so.
  //   2. EXACTLY ONCE. One call site per flip — handleQuickStatus for the table's control,
  //      handleSave for the form's — and neither falls through to the other.
  //   3. THE PUBLISH IS NEVER ROLLED BACK. requestRebuild() cannot throw; a failure becomes a
  //      notice that says the book is published anyway and names the manual way to deploy.
  //      A record that is public with stale pages is recoverable in one click in Cloudflare.
  //      Un-publishing a book because its BUILD did not start would be the worse of the two
  //      by a distance.
  async function summonDeploy(was, now) {
    if (!rebuildNeeded(was, now)) return;
    setRebuildNotice(null);
    const verdict = await requestRebuild({ hook: HOOKS.BOOKSTORE, getIdToken: () => user?.getIdToken() });
    setRebuildNotice({ tone: verdict.ok ? 'ok' : 'bad', text: verdict.message });
    if (!verdict.ok) console.error('[admin/bookstore] rebuild not started:', verdict.status, verdict.message);
  }

  function openNew() {
    setForm(emptyForm);
    setEditingTitleId(null);
    // A title that does not exist yet is not published. So "new, saved as published" is a flip
    // and does owe a build; "new, saved as draft" is not and does not.
    setEditingStatusWas(null);
    setErrors([]);
    setCoverProgress(null);
    setEpubProgress(null);
    setSampleProgress(null);
    setView('new');
  }

  function openEdit(title) {
    setForm({
      title: title.title || '',
      author: title.author || '',
      publisherId: title.publisherId || '',
      slug: title.slug || title.id || '',
      isbn: title.isbn || '',
      genre: title.genre || (sortGenres(genres)[0]?.slug || ''),
      tagsRaw: Array.isArray(title.tags) ? title.tags.join(', ') : '',
      pageCount: typeof title.pageCount === 'number' ? String(title.pageCount) : '',
      publishedDate: title.publishedDate || '',
      synopsis: title.synopsis || '',
      excerpt: title.excerpt || '',
      backCoverBlurb: title.backCoverBlurb || '',
      openingLine: title.openingLine || '',
      shelfCard: title.shelfCard || '',
      // R7.4 — the stored map back into the editor's line-per-entry form.
      glossary: serialiseGlossary(title.glossary),
      catalogueNumber: Number.isInteger(title.catalogueNumber) ? String(title.catalogueNumber) : '',
      // R18 — never seeded from title.author. The byline and the author's name are different
      // claims and are allowed to disagree; pre-filling one from the other would quietly make
      // them agree on the next save.
      authorName: title.authorName || '',
      authorBio: title.authorBio || '',
      authorPhotoAlt: title.authorPhotoAlt || '',
      authorPhotoFile: null,
      authorPhotoPath: title.authorPhotoPath || '',
      priceGbp: minorToMajor(title.prices?.gbp),
      priceNgn: minorToMajor(title.prices?.ngn),
      priceUsd: minorToMajor(title.prices?.usd),
      // R8.4 — the stored pair back into the form's one-mode-one-list shape. An allow-list
      // wins the mode question because it is the only field that can make one: exclusions
      // exist only alongside '*', by the write-time rule.
      ...territoriesToFormState(title),
      coverFile: null,
      coverUrl: title.coverUrl || '',
      coverSizes: title.coverSizes || {},
      epubFile: null,
      epubPath: title.epubPath || '',
      sampleFile: null,
      samplePath: title.samplePath || '',
      status: title.status || 'draft',
      featured: !!title.featured,
      bestseller: !!title.bestseller,
    });
    setEditingTitleId(title.id);
    setEditingStatusWas(title.status || 'draft');
    setErrors([]);
    setCoverProgress(null);
    setEpubProgress(null);
    setSampleProgress(null);
    setView('edit');
  }

  function handleCancel() {
    setView('list');
    setErrors([]);
  }

  function handleTitleBlur() {
    if (!form.slug.trim() && form.title.trim()) {
      const pub = publisherById[form.publisherId];
      const prefix = pub?.slug ? `${pub.slug}-` : '';
      setForm((f) => ({ ...f, slug: prefix + slugify(f.title) }));
    }
  }

  function buildPayload() {
    const prices = {};
    const gbp = majorToMinor(form.priceGbp);
    const ngn = majorToMinor(form.priceNgn);
    const usd = majorToMinor(form.priceUsd);
    if (gbp !== null) prices.gbp = gbp;
    if (ngn !== null) prices.ngn = ngn;
    if (usd !== null) prices.usd = usd;

    const tags = form.tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const payload = {
      title: form.title.trim(),
      author: form.author.trim(),
      publisherId: form.publisherId,
      slug: form.slug.trim(),
      genre: form.genre,
      publishedDate: form.publishedDate,
      synopsis: form.synopsis.trim(),
      prices,
      ...territoriesFromFormState(form),
      status: form.status,
      featured: form.featured,
      bestseller: form.bestseller,
    };

    if (form.isbn.trim()) payload.isbn = form.isbn.trim();
    if (form.excerpt.trim()) payload.excerpt = form.excerpt.trim();
    if (tags.length) payload.tags = tags;
    if (form.pageCount && Number.isInteger(Number(form.pageCount))) payload.pageCount = Number(form.pageCount);
    if (form.coverUrl) payload.coverUrl = form.coverUrl;
    if (form.epubPath) payload.epubPath = form.epubPath;
    if (form.samplePath) payload.samplePath = form.samplePath;

    // The Bookseller's Fields (R4b) — always included (null when empty) so an edit can CLEAR a
    // field. The write path spreads existing values, so an omitted key would keep the old one.
    payload.backCoverBlurb = form.backCoverBlurb.trim() || null;
    payload.openingLine = form.openingLine.trim() || null;
    payload.shelfCard = form.shelfCard.trim() || null;
    // R7.4 — the textarea is parsed into the map that reaches RTDB. Always included (null
    // when empty) for the same reason as the fields above: an edit must be able to CLEAR it.
    payload.glossary = parseGlossary(form.glossary).map;
    if (!Object.keys(payload.glossary).length) payload.glossary = null;
    const catNum = form.catalogueNumber.trim() === '' ? null : Number(form.catalogueNumber);
    payload.catalogueNumber = Number.isInteger(catNum) && catNum > 0 ? catNum : null;
    // R18 — always included (null when empty), for the same reason as every field above: the
    // write path spreads the existing record, so an omitted key would keep the old value and
    // a curator could never CLEAR a bio. authorPhotoPath is set by the upload step in
    // handleSave, which runs after this, so it is not written here.
    payload.authorName = form.authorName.trim() || null;
    payload.authorBio = form.authorBio.trim() || null;
    payload.authorPhotoAlt = form.authorPhotoAlt.trim() || null;
    payload.authorPhotoPath = form.authorPhotoPath.trim() || null;

    return payload;
  }

  async function handleSave() {
    setSaving(true);
    setErrors([]);
    const local = [];

    if (!form.title.trim()) local.push('Title is required');
    if (!form.author.trim()) local.push('Author is required');
    if (!form.publisherId) local.push('Publisher is required');
    if (!form.publishedDate) local.push('Published date is required');
    if (!form.synopsis.trim()) local.push('Synopsis is required');
    if (form.slug && !SLUG_RE.test(form.slug)) local.push('Slug must be kebab-case');
    if (!form.priceGbp && !form.priceNgn && !form.priceUsd) local.push('Enter at least one price (GBP, NGN, or USD)');
    if (form.territoriesMode !== MODE_WORLDWIDE && form.territoriesList.length === 0) {
      local.push(form.territoriesMode === MODE_DENY
        ? 'Name at least one country to exclude, or switch to “Sold worldwide”'
        : 'Name at least one country the book may be sold in, or switch to “Sold worldwide”');
    }
    // The Bookseller's Fields (R4b) — caps + positive-integer catalogue number.
    if (form.backCoverBlurb.length > 280) local.push('Back cover blurb must be 280 characters or fewer');
    if (form.shelfCard.length > 160) local.push('Shelf card must be 160 characters or fewer');
    // R7.4 — surface a malformed glossary line here rather than as a write rejection.
    local.push(...parseGlossary(form.glossary).errors);
    if (form.catalogueNumber.trim() !== '') {
      const n = Number(form.catalogueNumber);
      if (!Number.isInteger(n) || n <= 0) local.push('Catalogue number must be a positive whole number');
    }
    // R18 — the caps, read from the module the write path and the RTDB rules are both pinned
    // to, so the counter under the textarea can never promise more room than the database has.
    if (form.authorName.length > AUTHOR_CAPS.authorName) local.push(`Author name must be ${AUTHOR_CAPS.authorName} characters or fewer`);
    if (form.authorBio.length > AUTHOR_CAPS.authorBio) local.push(`Author bio must be ${AUTHOR_CAPS.authorBio} characters or fewer`);
    if (form.authorPhotoAlt.length > AUTHOR_CAPS.authorPhotoAlt) local.push(`Author photo alt text must be ${AUTHOR_CAPS.authorPhotoAlt} characters or fewer`);
    if (form.authorPhotoFile && form.authorPhotoFile.size > MAX_AUTHOR_PHOTO_BYTES) {
      local.push('Author photo must be under 3 MB');
    }
    // Schema v2: cover + EPUB required only for status === 'published'. Drafts and unpublished
    // titles may save with null assets.
    if (form.status === 'published') {
      if (!form.coverFile && !form.coverUrl) local.push('A cover image is required to publish');
      if (!form.epubFile && !form.epubPath) local.push('An EPUB is required to publish');
    }

    if (local.length > 0) {
      setErrors(local);
      setSaving(false);
      return;
    }

    // titleId: from slug. For new titles we need it before any upload; for edits it's editingTitleId.
    const titleId = editingTitleId || (form.slug.trim() || slugify(form.title));
    if (!titleId) {
      setErrors(['Could not derive a title id from the form']);
      setSaving(false);
      return;
    }

    let nextCoverUrl = form.coverUrl;
    let nextEpubPath = form.epubPath;
    let nextSamplePath = form.samplePath;
    let nextAuthorPhotoPath = form.authorPhotoPath;
    // R20 — undefined, NOT {}. An edit that does not touch the cover must leave the existing
    // rungs alone, and the payload line below only overrides when an upload actually made new
    // ones. Writing {} here would strip a title's derivatives every time someone fixed a typo
    // in its synopsis — the same trap the voices form documents for cardSizes.
    let nextCoverSizes;
    let nextCoverLqip;

    // Upload cover first (cheaper to retry, public-readable). If it fails, abort before EPUB upload
    // and before the title doc write — no orphaned title rows pointing at missing storage.
    if (form.coverFile) {
      setCoverProgress(0);
      const cov = await uploadCover(titleId, form.coverFile, (p) => setCoverProgress(p));
      if (!cov.ok) {
        setErrors(cov.errors);
        setSaving(false);
        setCoverProgress(null);
        return;
      }
      nextCoverUrl = cov.url;
      setCoverProgress(100);

      // R20 — THE DOOR DOES THE SIZING. Cut w360 + w720 WebP from the file already in memory
      // and upload them beside the original, so every cover from here on is sized from birth
      // and the backfill only ever has to catch what predates this line.
      //
      // AFTER the original and never in front of it: the original is what `coverUrl` points at
      // and what every fallback path serves, so it is the upload that must not be delayed by
      // an optimisation. And NOT gated — uploadCoverDerivatives never throws and returns {} on
      // any failure, which leaves the title serving the full-size original exactly as it did
      // before this round. A cover that will not shrink is heavy; a cover that will not publish
      // is a book the shop does not have.
      setCoverProgress(null);
      setDerivProgress('sizing…');
      nextCoverSizes = await uploadCoverDerivatives(titleId, form.coverFile, (w) => setDerivProgress(`sizing ${w}w…`));
      // R29 — and the inline stand-in, from the same file, at the same door. Nothing is
      // uploaded: it is a string that rides onto the record beside coverSizes. Same
      // never-gated, never-thrown rule as the rungs above — a cover that saves without a
      // stand-in draws the plate it drew before this round.
      setDerivProgress('stand-in…');
      nextCoverLqip = await makeCoverLqip(form.coverFile);
      setDerivProgress(null);
    }

    if (form.epubFile) {
      setEpubProgress(0);
      const ep = await uploadEpub(titleId, form.epubFile, (p) => setEpubProgress(p));
      if (!ep.ok) {
        // Cover may have already uploaded — that's fine, it'll be overwritten on next attempt.
        // But we don't write a title doc with missing EPUB path, so refuse and surface the error.
        setErrors([...ep.errors, 'Cover may have uploaded; EPUB did not. Re-upload both on next attempt.']);
        setSaving(false);
        setEpubProgress(null);
        return;
      }
      nextEpubPath = ep.path;
      setEpubProgress(100);
    }

    // Sample EPUB is optional. If provided, upload after the master; a failure here doesn't
    // block the title save — but we surface it so the admin knows the sample didn't take.
    if (form.sampleFile) {
      setSampleProgress(0);
      const sp = await uploadSampleEpub(titleId, form.sampleFile, (p) => setSampleProgress(p));
      if (!sp.ok) {
        setErrors(sp.errors);
        setSaving(false);
        setSampleProgress(null);
        return;
      }
      nextSamplePath = sp.path;
      setSampleProgress(100);
    }

    // R18 — the author photograph follows the COVER's path, not the EPUB's: image/*, under
    // 3 MB, stored beside the cover under the public-read `bookstore_covers/` prefix. Uploaded
    // before the doc write, like the cover, so a failure never leaves a title row pointing at
    // a photograph that is not there.
    if (form.authorPhotoFile) {
      setAuthorPhotoProgress(0);
      const ph = await uploadAuthorPhoto(titleId, form.authorPhotoFile, (p) => setAuthorPhotoProgress(p));
      if (!ph.ok) {
        setErrors(ph.errors);
        setSaving(false);
        setAuthorPhotoProgress(null);
        return;
      }
      nextAuthorPhotoPath = ph.path;
      setAuthorPhotoProgress(100);
    }

    const payload = buildPayload();
    // NOT `if (nextAuthorPhotoPath)`. Clearing the photograph must write null, and buildPayload
    // already put the form's current value (null when the field was cleared) in the payload —
    // this only OVERRIDES it when an upload actually produced a new path.
    if (form.authorPhotoFile && nextAuthorPhotoPath) payload.authorPhotoPath = nextAuthorPhotoPath;
    if (nextCoverUrl) payload.coverUrl = nextCoverUrl;
    // Only when this save actually cut new rungs. See the note on nextCoverSizes above.
    if (nextCoverSizes) payload.coverSizes = nextCoverSizes;
    // Only when this save actually cut one, on the same reasoning as the rungs above.
    if (nextCoverLqip) payload.coverLqip = nextCoverLqip;
    if (nextEpubPath) payload.epubPath = nextEpubPath;
    if (nextSamplePath) payload.samplePath = nextSamplePath;

    const result = editingTitleId
      ? await updateTitle(editingTitleId, payload)
      : await createTitle(payload);

    setSaving(false);
    setCoverProgress(null);
    setEpubProgress(null);
    setSampleProgress(null);
    setAuthorPhotoProgress(null);

    if (!result.ok) {
      setErrors(result.errors || ['Save failed']);
      return;
    }

    showToast(editingTitleId ? 'Title updated' : 'Title created');
    // The form's own flip. `editingStatusWas` is what the record held when it was opened —
    // null for a new title, which rebuildNeeded() reads as "not published", so saving a new
    // title straight to published owes a build and saving one as a draft does not.
    await summonDeploy(editingStatusWas, form.status);
    setView('list');
    setForm(emptyForm);
    setEditingTitleId(null);
    setEditingStatusWas(null);
    loadAll();
  }

  // ═════════════════════════════════════════════════════════════════════════════════════════
  // R21 — WITHDRAWAL AND DELETION
  // ═════════════════════════════════════════════════════════════════════════════════════════
  //
  // One piece of state for both dialogs, because at most one can be open and two independent
  // flags would admit a state where both are.
  //
  //   { mode: 'withdraw', title }                 the shop's act, reversible
  //   { mode: 'delete', title, preview }          destructive — `preview` carries the LIVE count
  //
  // The delete dialog is not opened until deletionPreview() has returned. See the header in
  // ./RemovalDialog.js: a confirm step whose number arrives after the button is a confirm step
  // that can be pressed without one.

  async function openWithdraw(title) {
    setRemoval({ mode: 'withdraw', title });
  }

  async function openDelete(title) {
    setRemovalBusy(title.id);
    const preview = await deletionPreview(title.id);
    setRemovalBusy(null);
    if (!preview.ok) {
      // NO DIALOG AT ALL when the count could not be read. deleteTitle refuses on an unknown
      // count anyway (ruling 2, failing closed), so a dialog here would offer something that
      // cannot happen.
      alert((preview.errors || ['Could not prepare the deletion']).join('\n'));
      return;
    }
    setRemoval({ mode: 'delete', title, preview });
  }

  async function confirmWithdraw({ scheduledFor, reason }) {
    const title = removal?.title;
    if (!title) return { ok: false, errors: ['Nothing selected'] };
    const result = await withdrawTitle(title.id, { scheduledFor, reason });
    if (!result.ok) return result;
    setRemoval(null);
    showToast(result.withdrawn ? 'Title withdrawn' : 'Withdrawal scheduled');
    // A SCHEDULED withdrawal changes nothing a reader can see yet, so it owes no build. An
    // immediate one takes the title off a shelf that is a FILE, and that file has to be
    // rebuilt without it — rebuildNeeded('published', 'withdrawn') is true.
    if (result.withdrawn) await summonDeploy(title.status || 'published', WITHDRAWN);
    loadAll();
    return result;
  }

  async function confirmRestore(title) {
    const result = await restoreTitle(title.id);
    if (!result.ok) {
      alert((result.errors || ['Restore failed']).join('\n'));
      return;
    }
    showToast('Title restored');
    await summonDeploy(WITHDRAWN, 'published');
    loadAll();
  }

  async function confirmDelete({ confirmName }) {
    const title = removal?.title;
    if (!title) return { ok: false, errors: ['Nothing selected'] };
    const result = await deleteTitle(title.id, { confirmName });
    if (!result.ok) return result;
    setRemoval(null);
    showToast('Title deleted');
    // A file that could not be removed is reported HERE and not swallowed: the shop is already
    // correct, but an orphan in the bucket is something a founder should know about rather than
    // discover in a storage bill.
    if (result.filesFailed?.length) {
      console.warn('[admin/bookstore] some files survived the delete:', result.filesFailed);
    }
    // Both acts trigger a rebuild — rule C. A deleted title's page is a FILE that still exists
    // in the deployed export until a build runs without it.
    //
    // rebuildNeeded() is still the arbiter, and it says NO for a title that was already
    // withdrawn or was never published: those pages do not exist in the deployed export, so
    // there is nothing to remove and a build would deploy the world exactly as it already is.
    // That is not this round declining rule C — it is rule C meeting the rule R19.6 wrote,
    // "publishedness changed", which is the same rule.
    await summonDeploy(title.status || 'published', 'deleted');
    loadAll();
    return result;
  }

  async function handleQuickStatus(title, nextStatus) {
    const was = title.status || 'draft';
    const result = await setTitleStatus(title.id, nextStatus);
    if (!result.ok) {
      alert((result.errors || ['Status change failed']).join('\n'));
      return;
    }
    showToast(`Title ${nextStatus}`);
    // AFTER the flip has succeeded, and only then. A rebuild summoned for a write that failed
    // would deploy the world exactly as it already is.
    await summonDeploy(was, nextStatus);
    loadAll();
  }

  // Filtered list for the table view.
  const filteredTitles = useMemo(() => {
    return titles.filter((t) => {
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (filterPublisher !== 'all' && t.publisherId !== filterPublisher) return false;
      if (filterGenre !== 'all' && t.genre !== filterGenre) return false;
      return true;
    });
  }, [titles, filterStatus, filterPublisher, filterGenre]);

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
          <div style={s.sub}>Bookstore</div>
        </div>
        <div style={s.headerLinks}>
          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)' }}>{user.email}</span>
          <a href="/admin/publishers" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>Publishers →</a>
          <a href="/admin" style={{ fontSize: '0.78rem', color: '#a78bfa', textDecoration: 'none' }}>← Admin</a>
        </div>
      </header>
      <div style={s.body}>
        {/* R13 — THE PANEL BAR. Three panels, one screen. Hidden while the title form is open,
            because a nav that navigates away from a half-filled upload is a nav that loses
            work; Cancel puts it back. */}
        {view === 'list' && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid #242424' }}>
            {[['titles', 'Titles'], ['sections', 'Sections'], ['genres', 'Genres']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPanel(key)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  padding: '0.7rem 1.1rem', marginBottom: -1,
                  fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: panel === key ? '#c4b5fd' : 'rgba(255,255,255,0.4)',
                  borderBottom: `2px solid ${panel === key ? '#7c3aed' : 'transparent'}`,
                }}
              >{label}</button>
            ))}
          </div>
        )}

        {view === 'list' && panel === 'sections' && (
          <SectionsPanel
            s={s}
            sections={sections}
            titles={titles}
            genres={genres}
            now={now}
            onChanged={loadAll}
            showToast={showToast}
          />
        )}

        {view === 'list' && panel === 'genres' && (
          <GenresPanel
            s={s}
            genres={genres}
            titles={titles}
            onChanged={loadAll}
            showToast={showToast}
          />
        )}

        {(view === 'new' || view === 'edit') && (
          <TitleForm
            form={form}
            setForm={setForm}
            editingTitleId={editingTitleId}
            saving={saving}
            errors={errors}
            publishers={activePublishers}
            genres={genres}
            coverProgress={coverProgress}
            derivProgress={derivProgress}
            authorPhotoProgress={authorPhotoProgress}
            epubProgress={epubProgress}
            sampleProgress={sampleProgress}
            catalogueInUse={catalogueInUse}
            onSave={handleSave}
            onCancel={handleCancel}
            onTitleBlur={handleTitleBlur}
          />
        )}
        {view === 'list' && panel === 'titles' && (
          <div>
            <div style={s.topBar}>
              <div>
                <h2 style={s.h2}>Titles</h2>
                <div style={s.h2sub}>{titles.length} on file · {filteredTitles.length} shown</div>
              </div>
              {publishers.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: '#fcd34d' }}>
                  Add a publisher first → <a href="/admin/publishers" style={{ color: '#fcd34d', textDecoration: 'underline' }}>/admin/publishers</a>
                </div>
              ) : titles.length > 0 && (
                <button style={s.btn} onClick={openNew} type="button">+ Add title</button>
              )}
            </div>

            {titles.length > 0 && (
              <div style={s.filtersRow}>
                <div style={s.filterFg}>
                  <label style={s.filterLabel}>Status</label>
                  <select style={s.select} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                    <option value="all">All</option>
                    {TITLE_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
                <div style={s.filterFg}>
                  <label style={s.filterLabel}>Publisher</label>
                  <select style={s.select} value={filterPublisher} onChange={(e) => setFilterPublisher(e.target.value)}>
                    <option value="all">All</option>
                    {activePublishers.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                  </select>
                </div>
                <div style={s.filterFg}>
                  <label style={s.filterLabel}>Genre</label>
                  <select style={s.select} value={filterGenre} onChange={(e) => setFilterGenre(e.target.value)}>
                    <option value="all">All</option>
                    {sortGenres(genres).map((g) => <option key={g.slug} value={g.slug}>{g.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            {loading
              ? <div style={s.empty}>Loading titles…</div>
              : titles.length === 0
                ? (
                  <div style={s.empty}>
                    <div style={{ fontSize: '1rem', color: '#fff', fontWeight: 600 }}>No titles yet.</div>
                    <div style={{ fontSize: '0.85rem' }}>Add your first.</div>
                    {publishers.length > 0 && <button style={s.btn} onClick={openNew} type="button">+ Add title</button>}
                  </div>
                )
                : filteredTitles.length === 0
                  ? <div style={s.empty}>No titles match the current filters.</div>
                  : (
                    <table style={s.table}>
                      <thead>
                        <tr>
                          <th style={s.th}>Cover</th>
                          <th style={s.th}>Title</th>
                          <th style={s.th}>Author</th>
                          <th style={s.th}>Publisher</th>
                          <th style={s.th}>Status</th>
                          <th style={s.th}>Rights</th>
                          <th style={{ ...s.th, textAlign: 'right' }}>Prices</th>
                          <th style={{ ...s.th, textAlign: 'right' }}>Sales</th>
                          <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTitles.map((t) => {
                          const pub = publisherById[t.publisherId];
                          return (
                            <tr key={t.id}>
                              <td style={s.td}>
                                {t.coverUrl
                                  ? <img src={t.coverUrl} alt="" style={s.thumb} onError={(e) => { e.target.style.opacity = 0.2; }} />
                                  : <div style={{ ...s.thumb, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.6rem' }}>none</div>
                                }
                              </td>
                              <td style={s.td}><strong>{t.title}</strong></td>
                              <td style={{ ...s.td, ...s.tdMuted }}>{t.author}</td>
                              <td style={{ ...s.td, ...s.tdMuted, fontSize: '0.82rem' }}>{pub?.name || t.publisherId}</td>
                              <td style={s.td}><span style={statusPill(t.status)}>{t.status}</span></td>
                              {/* R8.4 — a title's rights at a glance, in the SAME words the
                                  form's summary showed when they were set. */}
                              <td style={{ ...s.td, ...s.tdMuted, fontSize: '0.8rem', maxWidth: 260 }}>
                                {describeTerritories(t.territoriesAllowed, t.territoriesExcluded)}
                              </td>
                              <td style={{ ...s.td, textAlign: 'right' }}><PriceCell prices={t.prices} /></td>
                              <td style={{ ...s.td, textAlign: 'right' }}>{t.salesCount ?? 0}</td>
                              <td style={{ ...s.td, textAlign: 'right' }}>
                                <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                  <button style={s.btnSm} type="button" onClick={() => openEdit(t)}>Edit</button>
                                  {t.status === 'published'
                                    ? <button style={s.btnDanger} type="button" onClick={() => handleQuickStatus(t, 'unpublished')}>Unpublish</button>
                                    : t.status === 'draft' || t.status === 'unpublished'
                                      ? <button style={s.btnSm} type="button" onClick={() => handleQuickStatus(t, 'published')} title="Publish (cover + EPUB must already be set)">Publish</button>
                                      : null
                                  }
                                  {/* R21 — WITHDRAW / RESTORE. Only a published title can be
                                      withdrawn: there is nothing to withdraw a draft from,
                                      and the refusal is written down in withdrawalRefusal().
                                      A scheduled title is still published, so it still shows
                                      Withdraw — pressing it again re-sets the date. */}
                                  {t.status === 'published' && (
                                    <button
                                      style={s.btnDanger}
                                      type="button"
                                      onClick={() => openWithdraw(t)}
                                      title="Take this title off the shelf. Readers who bought it keep it."
                                      data-testid={`withdraw-${t.id}`}
                                    >
                                      {isScheduled(t) ? 'Reschedule' : 'Withdraw'}
                                    </button>
                                  )}
                                  {t.status === WITHDRAWN && (
                                    <button style={s.btnSm} type="button" onClick={() => confirmRestore(t)} data-testid={`restore-${t.id}`}>
                                      Restore
                                    </button>
                                  )}
                                  {/* ⚠ NO STATUS CONDITION. Ruling 1: no title is unremovable,
                                      for any reason. Draft, published, withdrawn — Delete is
                                      on every row, and the confirm step is what makes it
                                      deliberate rather than the button's absence. */}
                                  <button
                                    style={removalBusy === t.id ? { ...s.btnDanger, ...s.btnDisabled } : s.btnDanger}
                                    type="button"
                                    disabled={removalBusy === t.id}
                                    onClick={() => openDelete(t)}
                                    data-testid={`delete-${t.id}`}
                                  >
                                    {removalBusy === t.id ? 'Counting…' : 'Delete'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )
            }
          </div>
        )}
      </div>
      {/* R19.6 — the deploy, said in the admin's own register. It is DISMISSIBLE and does not
          expire: "in about two minutes" is a claim the reader must be able to still be looking
          at when the two minutes are up. A failure keeps the same furniture and changes only
          the colour and the sentence — a separate error surface would teach the eye that this
          box is always good news. */}
      {/* R21 — at most one dialog, and the delete one never renders without its live count. */}
      {removal?.mode === 'withdraw' && (
        <WithdrawDialog
          title={removal.title}
          onCancel={() => setRemoval(null)}
          onConfirm={confirmWithdraw}
        />
      )}
      {removal?.mode === 'delete' && (
        <DeleteDialog
          title={removal.title}
          preview={removal.preview}
          onCancel={() => setRemoval(null)}
          onConfirm={confirmDelete}
        />
      )}
      {rebuildNotice && (
        <div style={{ ...s.rebuild, borderColor: rebuildNotice.tone === 'ok' ? '#2a2a2a' : '#7f1d1d', color: rebuildNotice.tone === 'ok' ? '#86efac' : '#fca5a5' }}>
          <span aria-hidden="true">{rebuildNotice.tone === 'ok' ? '⟳' : '⚠'}</span>
          <span data-testid="rebuild-notice">{rebuildNotice.text}</span>
          <button type="button" onClick={() => setRebuildNotice(null)} style={s.rebuildDismiss} aria-label="Dismiss">×</button>
        </div>
      )}
      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  );
}

function TitleForm({ form, setForm, editingTitleId, saving, errors, publishers, genres, coverProgress, derivProgress, authorPhotoProgress, epubProgress, sampleProgress, catalogueInUse, onSave, onCancel, onTitleBlur }) {
  const slugInvalid = form.slug && !SLUG_RE.test(form.slug);

  // Non-blocking duplicate-catalogue-number warning: flag when another title already uses it.
  const catNumParsed = form.catalogueNumber.trim() === '' ? null : Number(form.catalogueNumber);
  const catDupTitle = (catNumParsed !== null && Number.isInteger(catNumParsed) && catalogueInUse)
    ? catalogueInUse.get(catNumParsed)
    : null;
  const catDup = catDupTitle && catDupTitle.id !== editingTitleId ? catDupTitle : null;

  // R7.4 — live glossary feedback as the editor types: a running entry count, and the
  // malformed lines named by number before Save is ever pressed.
  const glossaryParsed = useMemo(() => {
    const { map, errors } = parseGlossary(form.glossary);
    return { count: Object.keys(map).length, errors };
  }, [form.glossary]);
  const glossaryErrors = glossaryParsed.errors;

  // ── R8.4: RIGHTS ─────────────────────────────────────────────────────────────────────────
  function handleToggleTerritory(code) {
    const v = (code || '').trim().toUpperCase();
    if (!COUNTRY_NAMES[v]) return;
    setForm((f) => ({
      ...f,
      territoriesList: f.territoriesList.includes(v)
        ? f.territoriesList.filter((c) => c !== v)
        : [...f.territoriesList, v],
    }));
  }
  function handleRemoveTerritory(code) {
    setForm((f) => ({ ...f, territoriesList: f.territoriesList.filter((c) => c !== code) }));
  }
  // A PRESET IS A FILLER, NOT A VALUE. It adds its codes to the list and is then forgotten —
  // nothing records that it was used, and nothing stored refers back to it. See the long note
  // at TERRITORY_PRESETS in app/lib/bookstore/territory.js: a title's rights must mean in five
  // years exactly what they meant on the day they were agreed, and a stored group NAME would
  // silently re-scope every title carrying it the day someone corrected the group.
  function handleApplyPreset(codes) {
    setForm((f) => ({
      ...f,
      territoriesList: [...new Set([...f.territoriesList, ...codes])],
    }));
  }

  const territoryMatches = useMemo(() => {
    const q = form.territorySearch.trim().toLowerCase();
    if (!q) return COUNTRY_CODES;
    return COUNTRY_CODES.filter((c) => c.toLowerCase() === q || COUNTRY_NAMES[c].toLowerCase().includes(q));
  }, [form.territorySearch]);

  // The rights as they will read once saved, computed from the form rather than from anything
  // stored — so a mis-tick is visible BEFORE the save, in the same words the list column will
  // use afterwards.
  const rightsSummary = useMemo(() => {
    // The two fields, not the whole form: this depends on the mode and the list and on nothing
    // else, and saying so keeps the memo honest (and the compiler able to preserve it).
    const { territoriesAllowed, territoriesExcluded } = territoriesFromForm(form.territoriesMode, form.territoriesList);
    return describeTerritories(territoriesAllowed, territoriesExcluded);
  }, [form.territoriesMode, form.territoriesList]);

  return (
    <div>
      <div style={s.topBar}>
        <div>
          <h2 style={s.h2}>{editingTitleId ? 'Edit Title' : 'New Title'}</h2>
          <div style={s.h2sub}>
            {editingTitleId ? `Editing ${editingTitleId}` : 'Drafts can be saved without cover or EPUB. Both required to publish.'}
          </div>
        </div>
        <button style={s.btnGhost} onClick={onCancel} type="button">← Back</button>
      </div>

      {errors.length > 0 && (
        <div style={s.errorBox}>
          <div style={{ fontWeight: 700, color: '#f87171' }}>Please fix the following:</div>
          {errors.map((e, i) => <div key={i}>· {e}</div>)}
        </div>
      )}

      {/* a. METADATA */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Metadata</div>
        <div style={s.row2}>
          <div style={s.fg}>
            <label style={s.label}>Title</label>
            <input style={s.input} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} onBlur={onTitleBlur} placeholder="e.g. Love Letters" />
          </div>
          <div style={s.fg}>
            <label style={s.label}>Author</label>
            <input style={s.input} value={form.author} onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))} placeholder="Display name" />
            <div style={s.hint}>Display name. Pen names allowed.</div>
          </div>
        </div>

        <div style={{ ...s.row2, marginTop: '1.1rem' }}>
          <div style={s.fg}>
            <label style={s.label}>Publisher</label>
            <select
              style={s.select}
              value={form.publisherId}
              disabled={!!editingTitleId}
              onChange={(e) => setForm((f) => ({ ...f, publisherId: e.target.value }))}
            >
              <option value="">— select a publisher —</option>
              {publishers.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
            <div style={s.hint}>{publishers.length === 0
              ? <>No active publisher? Create one in <a href="/admin/publishers" style={{ color: '#a78bfa' }}>/admin/publishers</a> first.</>
              : editingTitleId
                ? 'Publisher cannot be reassigned after creation. Use the Firebase Console for edge cases.'
                : 'Only active publishers are listed.'
            }</div>
          </div>
          <div style={s.fg}>
            <label style={s.label}>Slug</label>
            <input
              style={{ ...s.input, ...(slugInvalid ? s.inputErr : {}) }}
              value={form.slug}
              disabled={!!editingTitleId}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="auto-generated as {publisher}-{title}"
            />
            {editingTitleId
              ? <div style={s.hint}>Slug is fixed once a title is created.</div>
              : slugInvalid
                ? <div style={s.hintWarn}>Slug must be kebab-case.</div>
                : <div style={s.hint}>Auto-fills as publisher-prefixed kebab-case on title blur. Edit to override.</div>
            }
          </div>
        </div>

        <div style={{ ...s.row2, marginTop: '1.1rem' }}>
          <div style={s.fg}>
            <label style={s.label}>ISBN <span style={s.labelSoft}>(optional)</span></label>
            <input style={s.input} value={form.isbn} onChange={(e) => setForm((f) => ({ ...f, isbn: e.target.value }))} placeholder="978-1-..." />
          </div>
          <div style={s.fg}>
            <label style={s.label}>Genre</label>
            <select style={s.select} value={form.genre} onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value }))}>
              {/* R13 — the shop's own labels, in the shop's own order. An editor now reads the
                  same words on this dropdown that a reader reads on the shelf. */}
              <option value="">Choose a genre…</option>
              {sortGenres(genres).map((g) => <option key={g.slug} value={g.slug}>{g.label}</option>)}
            </select>
            {genres.length === 0 && <div style={s.hintWarn}>The taxonomy is empty — open the Genres tab and write the seed.</div>}
          </div>
        </div>

        <div style={{ ...s.row2, marginTop: '1.1rem' }}>
          <div style={s.fg}>
            <label style={s.label}>Tags <span style={s.labelSoft}>(optional, comma-separated)</span></label>
            <input style={s.input} value={form.tagsRaw} onChange={(e) => setForm((f) => ({ ...f, tagsRaw: e.target.value }))} placeholder="romance, epistolary" />
          </div>
          <div style={s.fg}>
            <label style={s.label}>Page count <span style={s.labelSoft}>(optional)</span></label>
            <input style={s.input} type="number" min={1} step={1} value={form.pageCount} onChange={(e) => setForm((f) => ({ ...f, pageCount: e.target.value }))} placeholder="e.g. 280" />
          </div>
        </div>

        <div style={{ marginTop: '1.1rem', ...s.fg }}>
          <label style={s.label}>Published date</label>
          <input style={{ ...s.input, colorScheme: 'dark' }} type="date" value={form.publishedDate} onChange={(e) => setForm((f) => ({ ...f, publishedDate: e.target.value }))} />
        </div>
      </div>

      {/* b. CONTENT */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Content</div>
        <div style={s.fg}>
          <label style={s.label}>Synopsis</label>
          <textarea style={s.textarea} value={form.synopsis} onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))} placeholder="Plain text or basic HTML." />
          <div style={s.hint}>Plain text or basic HTML. Shown on the title detail page.</div>
        </div>
        <div style={{ ...s.fg, marginTop: '1.1rem' }}>
          <label style={s.label}>Excerpt <span style={s.labelSoft}>(optional)</span></label>
          <textarea style={{ ...s.textarea, ...s.textareaTall }} value={form.excerpt} onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))} placeholder="First chapter or sample passage." />
          <div style={s.hint}>First chapter or sample passage. Optional. Shown to non-purchasers.</div>
        </div>
      </div>

      {/* b2. THE BOOKSELLER'S FIELDS (R4b) */}
      <div style={s.section}>
        <div style={s.sectionTitle}>The Bookseller&rsquo;s Fields</div>
        <div style={s.fg}>
          <label style={s.label}>Back cover blurb <span style={s.labelSoft}>(optional, ≤ 280)</span></label>
          <textarea style={{ ...s.textarea, minHeight: 90 }} maxLength={280} value={form.backCoverBlurb} onChange={(e) => setForm((f) => ({ ...f, backCoverBlurb: e.target.value }))} placeholder="Two punchy sentences." />
          <div style={s.hint}>Printed on the book&rsquo;s back. Two punchy sentences, not a summary. Falls back to a truncated synopsis if empty. <span style={{ color: form.backCoverBlurb.length > 280 ? '#fcd34d' : 'rgba(255,255,255,0.35)' }}>{form.backCoverBlurb.length}/280</span></div>
        </div>
        <div style={{ ...s.fg, marginTop: '1.1rem' }}>
          <label style={s.label}>Opening line <span style={s.labelSoft}>(optional)</span></label>
          <input style={s.input} value={form.openingLine} onChange={(e) => setForm((f) => ({ ...f, openingLine: e.target.value }))} placeholder="The book's first sentence." />
          <div style={s.hint}>The book&rsquo;s first sentence — or its best early line. Powers the back cover and the Opening Lines rail. Falls back to the first sentence of the excerpt.</div>
        </div>
        <div style={{ ...s.fg, marginTop: '1.1rem' }}>
          <label style={s.label}>Shelf card <span style={s.labelSoft}>(optional, ≤ 160)</span></label>
          <textarea style={{ ...s.textarea, minHeight: 70 }} maxLength={160} value={form.shelfCard} onChange={(e) => setForm((f) => ({ ...f, shelfCard: e.target.value }))} placeholder="The curator's note, in your voice." />
          <div style={s.hint}>The curator&rsquo;s note, in your voice, signed &mdash; Calvary. NO fallback: leave empty and the book gets no card. Never invent one. <span style={{ color: form.shelfCard.length > 160 ? '#fcd34d' : 'rgba(255,255,255,0.35)' }}>{form.shelfCard.length}/160</span></div>
        </div>
        {/* R7.4 — THE HOUSE GLOSSARY. One entry per line, `word — definition`, because that
            is how a glossary is written on paper. Parsed on save; the map is what reaches
            RTDB and what the reader looks up before it ever asks the internet. */}
        <div style={{ ...s.fg, marginTop: '1.1rem' }}>
          <label style={s.label}>House glossary <span style={s.labelSoft}>(optional, one per line)</span></label>
          <textarea
            style={{ ...s.textarea, minHeight: 130, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.8rem' }}
            value={form.glossary}
            onChange={(e) => setForm((f) => ({ ...f, glossary: e.target.value }))}
            placeholder={'harmattan — the dry dusty wind that blows down from the Sahara\nogbanje — a child said to die and return to the same mother'}
          />
          <div style={glossaryErrors.length ? s.hintWarn : s.hint}>
            One entry per line: <code>word — definition</code> (em dash, en dash or a spaced hyphen).
            The reader long-presses a word and gets THIS before any dictionary. Definitions ≤ 500 characters.
            {glossaryParsed.count > 0 && !glossaryErrors.length && <> &mdash; {glossaryParsed.count} {glossaryParsed.count === 1 ? 'entry' : 'entries'}.</>}
            {glossaryErrors.map((er, i) => <div key={i}>⚠ {er}</div>)}
          </div>
        </div>
        <div style={{ ...s.fg, marginTop: '1.1rem', maxWidth: 240 }}>
          <label style={s.label}>Catalogue number <span style={s.labelSoft}>(optional)</span></label>
          <input style={s.input} type="number" min={1} step={1} value={form.catalogueNumber} onChange={(e) => setForm((f) => ({ ...f, catalogueNumber: e.target.value }))} placeholder="e.g. 7" />
          <div style={catDup ? s.hintWarn : s.hint}>
            The No. on everything. Admin-controlled, not auto-assigned.
            {catDup && <> &mdash; ⚠ No. {catNumParsed} is already used by &ldquo;{catDup.title}&rdquo;.</>}
          </div>
        </div>
      </div>

      {/* b3. THE AUTHOR (R18) — the Book Store's OWN author record.
           ⚠ NOT the platform's /admin contributor records. Different product, different
           infrastructure, its own fields. Nothing here reads or writes `users` or `authors`. */}
      <div style={s.section}>
        <div style={s.sectionTitle}>The Author</div>
        <div style={s.hint}>
          Prints under the synopsis on the detail page, above the shelf card.
          NO fallback: leave the bio and the photograph empty and the section does not appear at all —
          which is the right answer for an anthology. A photograph alone, or a bio alone, both render.
        </div>
        <div style={{ ...s.fg, marginTop: '1.1rem' }}>
          <label style={s.label}>Author name <span style={s.labelSoft}>(optional, &le; {AUTHOR_CAPS.authorName})</span></label>
          <input style={s.input} maxLength={AUTHOR_CAPS.authorName} value={form.authorName} onChange={(e) => setForm((f) => ({ ...f, authorName: e.target.value }))} placeholder="The person, e.g. Ada Nwachukwu" />
          {/* THE BYLINE AND THE NAME ARE DIFFERENT CLAIMS, and are allowed to disagree. This
              hint is the whole reason the field is separate — a curator who does not know that
              will type the byline in again. */}
          <div style={s.hint}>
            A PERSON, for the author block. This is <strong>not</strong> the byline above &mdash; the byline is
            an editorial decision about whose name sits under the title, and on an anthology it reads
            &ldquo;Calvary Scribblings&rdquo; on purpose. The two may differ, and nothing corrects them when they do.
            {form.authorName.trim() && form.author.trim() && form.authorName.trim() !== form.author.trim() && (
              <span style={{ color: 'rgba(255,255,255,0.35)' }}> &mdash; byline &ldquo;{form.author.trim()}&rdquo;, author block &ldquo;{form.authorName.trim()}&rdquo;. Both kept.</span>
            )}
          </div>
        </div>
        <div style={{ ...s.fg, marginTop: '1.1rem' }}>
          <label style={s.label}>Author bio <span style={s.labelSoft}>(optional, &le; {AUTHOR_CAPS.authorBio})</span></label>
          <textarea style={{ ...s.textarea, minHeight: 130 }} maxLength={AUTHOR_CAPS.authorBio} value={form.authorBio} onChange={(e) => setForm((f) => ({ ...f, authorBio: e.target.value }))} placeholder="Two or three sentences, publisher-supplied or written in house." />
          <div style={s.hint}>
            Set in Cormorant at body size, under the photograph. Publisher-supplied for Linea House titles.
            <span style={{ color: form.authorBio.length > AUTHOR_CAPS.authorBio ? '#fcd34d' : 'rgba(255,255,255,0.35)' }}> {form.authorBio.length}/{AUTHOR_CAPS.authorBio}</span>
          </div>
        </div>
        <div style={{ ...s.fileBlock, marginTop: '1.25rem' }}>
          <label style={s.label}>Author photograph <span style={s.labelSoft}>(image, &lt; 3 MB, optional)</span></label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setForm((f) => ({ ...f, authorPhotoFile: e.target.files?.[0] || null }))}
            style={{ color: '#fff', fontSize: '0.85rem' }}
          />
          {form.authorPhotoFile && (
            <div style={form.authorPhotoFile.size > MAX_AUTHOR_PHOTO_BYTES ? s.hintWarn : s.fileMeta}>
              {form.authorPhotoFile.name} &middot; {(form.authorPhotoFile.size / 1024).toFixed(0)} KB
              {form.authorPhotoFile.size > MAX_AUTHOR_PHOTO_BYTES && <> &mdash; ⚠ over 3 MB</>}
            </div>
          )}
          {authorPhotoProgress !== null && (
            <div>
              <div style={s.progressBar}><div style={{ ...s.progressFill, width: `${authorPhotoProgress}%` }} /></div>
              <div style={s.fileMeta}>{authorPhotoProgress < 100 ? `Uploading… ${authorPhotoProgress}%` : 'Done ✓'}</div>
            </div>
          )}
          {!form.authorPhotoFile && form.authorPhotoPath && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
              {/* The stored PATH resolved to a URL exactly the way the public page resolves it —
                  same helper, same anonymous ?alt=media fetch. If it fails to load here it will
                  fail to load there, which is the point of previewing it this way. */}
              {/* eslint-disable-next-line @next/next/no-img-element --
                  26 Aug 2026. Same reason as app/bookstore/components/AuthorBlock.js: this is a
                  static export (next.config.mjs, `images: { unoptimized: true }`), so <Image />
                  would render this exact <img> and buy nothing. alt="" is deliberate — the
                  thumbnail is decorative beside the "Photograph on file" label that names it. */}
              <img src={publicPhotoUrl(form.authorPhotoPath)} alt="" style={{ width: 54, height: 68, objectFit: 'cover', borderRadius: 2, border: '1px solid rgba(255,255,255,0.15)' }} />
              <div>
                <div style={s.hintGreen}>✓ Photograph on file. Pick a new file to replace.</div>
                <button type="button" onClick={() => setForm((f) => ({ ...f, authorPhotoPath: '', authorPhotoFile: null }))} style={{ ...s.linkBtn, marginTop: '0.25rem' }}>Remove photograph</button>
              </div>
            </div>
          )}
          <div style={s.hint}>Stored beside the cover, in the same public-read place. Set as a portrait plate, not a circle.</div>
        </div>
        <div style={{ ...s.fg, marginTop: '1.1rem' }}>
          <label style={s.label}>Photograph alt text <span style={s.labelSoft}>(optional, &le; {AUTHOR_CAPS.authorPhotoAlt})</span></label>
          <input style={s.input} maxLength={AUTHOR_CAPS.authorPhotoAlt} value={form.authorPhotoAlt} onChange={(e) => setForm((f) => ({ ...f, authorPhotoAlt: e.target.value }))} placeholder="e.g. Ada Nwachukwu at her desk in Enugu" />
          <div style={s.hint}>
            For screen readers. Left empty it becomes &ldquo;Photograph of {form.authorName.trim() || 'the author'}&rdquo;.
            <span style={{ color: form.authorPhotoAlt.length > AUTHOR_CAPS.authorPhotoAlt ? '#fcd34d' : 'rgba(255,255,255,0.35)' }}> {form.authorPhotoAlt.length}/{AUTHOR_CAPS.authorPhotoAlt}</span>
          </div>
        </div>
      </div>

      {/* c. PRICING */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Pricing</div>
        <div style={s.row3}>
          <div style={s.fg}>
            <label style={s.label}>GBP (£)</label>
            <input style={s.input} type="number" min={0} step={0.01} value={form.priceGbp} onChange={(e) => setForm((f) => ({ ...f, priceGbp: e.target.value }))} placeholder="4.99" />
          </div>
          <div style={s.fg}>
            <label style={s.label}>NGN (₦)</label>
            <input style={s.input} type="number" min={0} step={1} value={form.priceNgn} onChange={(e) => setForm((f) => ({ ...f, priceNgn: e.target.value }))} placeholder="4500" />
          </div>
          <div style={s.fg}>
            <label style={s.label}>USD ($)</label>
            <input style={s.input} type="number" min={0} step={0.01} value={form.priceUsd} onChange={(e) => setForm((f) => ({ ...f, priceUsd: e.target.value }))} placeholder="6.49" />
          </div>
        </div>
        <div style={{ ...s.hint, marginTop: '0.75rem' }}>
          Enter prices as the customer sees them (e.g. £4.99, ₦4,500, $6.49). Stored internally as minor units (pence/cents/kobo). Leave blank to skip a currency.
        </div>
      </div>

      {/* d. RIGHTS */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Rights</div>
        <div style={s.fg}>
          <label style={s.label}>Territories</label>
          {/* THREE CHOICES, because rights come in three shapes and the middle one is the one
              contracts are actually written in ("World excluding North America"). The old form
              offered only worldwide-or-list, which forced an editor with an exclusion to
              enumerate the ~250 countries it did NOT cover — a licence stored as a
              transcription error waiting to happen. */}
          <div style={s.radioGroup}>
            {[
              [MODE_WORLDWIDE, 'Sold worldwide'],
              [MODE_DENY, 'Worldwide, except…'],
              [MODE_ALLOW, 'Only in…'],
            ].map(([mode, label]) => (
              <label key={mode} style={s.radioOption}>
                <input
                  type="radio"
                  name="territories"
                  checked={form.territoriesMode === mode}
                  // Switching modes KEEPS the list. An editor who picks the wrong mode first
                  // and re-picks has not asked to lose the countries they already chose, and
                  // the summary below tells them immediately what the list now means.
                  onChange={() => setForm((f) => ({ ...f, territoriesMode: mode }))}
                />
                {label}
              </label>
            ))}
          </div>

          {form.territoriesMode !== MODE_WORLDWIDE && (
            <>
              <div style={{ ...s.hint, marginTop: '0.7rem', marginBottom: '0.35rem' }}>
                {form.territoriesMode === MODE_DENY
                  ? 'Countries the book may NOT be sold in.'
                  : 'The complete list of countries the book may be sold in.'}
              </div>

              {/* Presets EXPAND INTO CODES on the spot — nothing here is stored by name. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }}>
                {TERRITORY_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    title={`Adds ${p.codes.length} countries`}
                    style={{ background: 'transparent', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', borderRadius: 12, padding: '0.18rem 0.7rem', fontSize: '0.72rem', cursor: 'pointer' }}
                    onClick={() => handleApplyPreset(p.codes)}
                  >
                    + {p.label}
                  </button>
                ))}
              </div>

              {form.territoriesList.length > 0 && (
                <div style={{ ...s.chipsWrap, marginBottom: '0.6rem' }}>
                  {[...form.territoriesList].sort((a, b) => COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b])).map((c) => (
                    <span key={c} style={s.chip}>
                      {COUNTRY_NAMES[c] || c}
                      <button type="button" style={s.chipX} onClick={() => handleRemoveTerritory(c)} aria-label={`Remove ${COUNTRY_NAMES[c] || c}`}>×</button>
                    </span>
                  ))}
                </div>
              )}

              <input
                style={s.input}
                type="search"
                value={form.territorySearch}
                placeholder="Search countries…"
                aria-label="Search countries"
                onChange={(e) => setForm((f) => ({ ...f, territorySearch: e.target.value }))}
              />
              {/* THE WHOLE ISO LIST, BUNDLED. No lookup service, no autocomplete endpoint: it
                  is a constant, it is a few KB, and an editor setting rights on a plane should
                  not be told the country list is unavailable. */}
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #242424', borderRadius: 8, marginTop: '0.5rem', background: '#111' }}>
                {territoryMatches.length === 0
                  ? <div style={{ padding: '0.8rem', fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)' }}>No country matches “{form.territorySearch}”.</div>
                  : territoryMatches.map((c) => (
                    <label
                      key={c}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', padding: '0.3rem 0.7rem', fontSize: '0.85rem', cursor: 'pointer', color: form.territoriesList.includes(c) ? '#c4b5fd' : '#e8e8e8' }}
                    >
                      <input
                        type="checkbox"
                        checked={form.territoriesList.includes(c)}
                        onChange={() => handleToggleTerritory(c)}
                      />
                      <span style={{ fontFamily: 'monospace', color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>{c}</span>
                      {COUNTRY_NAMES[c]}
                    </label>
                  ))}
              </div>
            </>
          )}

          {/* THE RIGHTS, SAID BACK. Above Save, in the same words the list column will use, so
              a mis-tick is caught by reading a sentence rather than by auditing a grid of
              checkboxes. This is the whole reason the summary exists: "Sold worldwide except
              the United States and Canada" is checkable at a glance; 250 boxes are not. */}
          <div
            data-testid="rights-summary"
            style={{ marginTop: '0.9rem', padding: '0.6rem 0.85rem', border: '1px solid #2a2a2a', borderRadius: 8, background: '#141414', fontSize: '0.88rem', color: '#c4b5fd' }}
          >
            {rightsSummary}
          </div>
        </div>
      </div>

      {/* e. ASSETS */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Assets</div>
        <div style={s.row2}>
          <div style={s.fileBlock}>
            <label style={s.label}>Cover image <span style={s.labelSoft}>(image/*, &lt; 5 MB)</span></label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setForm((f) => ({ ...f, coverFile: e.target.files?.[0] || null }))}
              style={{ color: '#fff', fontSize: '0.85rem' }}
            />
            {form.coverFile && (
              <div style={s.fileMeta}>{form.coverFile.name} · {(form.coverFile.size / 1024).toFixed(0)} KB</div>
            )}
            {coverProgress !== null && (
              <div>
                <div style={s.progressBar}><div style={{ ...s.progressFill, width: `${coverProgress}%` }} /></div>
                <div style={s.fileMeta}>{coverProgress < 100 ? `Uploading… ${coverProgress}%` : 'Done ✓'}</div>
              </div>
            )}
            {/* R20 — the sizing pass, reported in its own line. It runs after the original has
                landed, so the upload bar above has already said Done; a second bar restarting
                from zero would read as a failed upload retrying. */}
            {derivProgress !== null && (
              <div style={s.fileMeta}>{derivProgress}</div>
            )}
            {!form.coverFile && form.coverUrl && (
              <div style={s.hintGreen}>✓ Existing cover on file. Pick a new file to replace.</div>
            )}
            {/* Whether this title is already serving sized rungs, or still serving the original.
                Absent is a normal state, not an error — see coverSrcSet in lib/bookstore/covers.js. */}
            {!form.coverFile && form.coverUrl && (
              Object.keys(form.coverSizes || {}).length > 0
                ? <div style={s.hintGreen}>✓ Sized rungs on file ({Object.keys(form.coverSizes).join(', ')}).</div>
                : <div style={s.fileMeta}>No sized rungs yet — this cover serves at full size. Re-upload it to cut them.</div>
            )}
          </div>
          <div style={s.fileBlock}>
            <label style={s.label}>EPUB file <span style={s.labelSoft}>(.epub, &lt; 50 MB)</span></label>
            <input
              type="file"
              accept=".epub,application/epub+zip"
              onChange={(e) => setForm((f) => ({ ...f, epubFile: e.target.files?.[0] || null }))}
              style={{ color: '#fff', fontSize: '0.85rem' }}
            />
            {form.epubFile && (
              <div style={s.fileMeta}>{form.epubFile.name} · {(form.epubFile.size / 1024 / 1024).toFixed(1)} MB</div>
            )}
            {epubProgress !== null && (
              <div>
                <div style={s.progressBar}><div style={{ ...s.progressFill, width: `${epubProgress}%` }} /></div>
                <div style={s.fileMeta}>{epubProgress < 100 ? `Uploading… ${epubProgress}%` : 'Done ✓'}</div>
              </div>
            )}
            {!form.epubFile && form.epubPath && (
              <div style={s.hintGreen}>✓ Master EPUB uploaded. Pick a new file to replace.</div>
            )}
            <div style={s.hint}>Master EPUB is admin-only — there's no preview link. Buyer access happens through a Worker (Phase B).</div>
          </div>
        </div>

        <div style={{ ...s.fileBlock, marginTop: '1.25rem' }}>
          <label style={s.label}>Sample EPUB <span style={s.labelSoft}>(.epub, &lt; 10 MB, optional)</span></label>
          <input
            type="file"
            accept=".epub,application/epub+zip"
            onChange={(e) => setForm((f) => ({ ...f, sampleFile: e.target.files?.[0] || null }))}
            style={{ color: '#fff', fontSize: '0.85rem' }}
          />
          {form.sampleFile && (
            <div style={s.fileMeta}>{form.sampleFile.name} · {(form.sampleFile.size / 1024 / 1024).toFixed(1)} MB</div>
          )}
          {sampleProgress !== null && (
            <div>
              <div style={s.progressBar}><div style={{ ...s.progressFill, width: `${sampleProgress}%` }} /></div>
              <div style={s.fileMeta}>{sampleProgress < 100 ? `Uploading… ${sampleProgress}%` : 'Done ✓'}</div>
            </div>
          )}
          {!form.sampleFile && form.samplePath && (
            <div style={s.hintGreen}>✓ Sample EPUB on file. Pick a new file to replace.</div>
          )}
          <div style={s.hint}>First chapter or two. Powers the Read Sample button. Optional but strongly recommended for published titles. This file is public — do not include the full book.</div>
        </div>
      </div>

      {/* f. STATUS */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Status</div>
        <div style={s.radioGroup}>
          {/* R21 — 'withdrawn' IS IN THE ENUM AND DELIBERATELY NOT IN THIS LIST. Withdrawal is
              an ACT: it records who made it and when, it may carry a licence-end date, and it
              owes a deploy. A radio button knows none of that, so updateTitle refuses a status
              typed into the form (in both directions) and the row's Withdraw / Restore buttons
              are the only doors. Offering an option that always errors would be worse than not
              offering it. The FILTER dropdown above still lists it — filtering by a status is
              not setting one. */}
          {TITLE_STATUSES.filter((st) => st !== WITHDRAWN).map((st) => (
            <label key={st} style={s.radioOption}>
              <input type="radio" name="status" checked={form.status === st} onChange={() => setForm((f) => ({ ...f, status: st }))} />
              <span style={{ textTransform: 'capitalize' }}>{st}</span>
            </label>
          ))}
        </div>
        <div style={{ ...s.hint, marginTop: '0.5rem' }}>
          'Published' is gated on a cover + EPUB being uploaded. Save as 'draft' to keep working without those.
          {form.status === WITHDRAWN && ' This title is withdrawn — use Restore on the list to put it back on the shelf.'}
        </div>
      </div>

      {/* g. FLAGS */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Flags</div>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <label style={s.checkbox}>
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))} />
            Featured
          </label>
          <label style={s.checkbox}>
            <input type="checkbox" checked={form.bestseller} onChange={(e) => setForm((f) => ({ ...f, bestseller: e.target.checked }))} />
            Bestseller
          </label>
        </div>
        <div style={{ ...s.hint, marginTop: '0.5rem' }}>Bestseller is an editorial flag — independent of salesCount.</div>
      </div>

      <div style={s.formActions}>
        <button style={s.btnGhost} onClick={onCancel} type="button">Cancel</button>
        <button
          style={{ ...s.btn, ...(saving ? s.btnDisabled : {}) }}
          onClick={onSave}
          disabled={saving}
          type="button"
        >
          {saving ? 'Saving…' : editingTitleId ? 'Save changes' : 'Create title'}
        </button>
      </div>
    </div>
  );
}
