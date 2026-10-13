'use client';
// THE SERIES ADMIN — W38, rebuilt to the seven-screen design Ikenna approved on 11 Oct (ruling 140).
//
// "Publishing must be easy." Before W38 the writer was typed by hand on every instalment, release
// times were UTC echoed back as epoch milliseconds, the series was published separately, uploads
// lived in another panel, and the title, writer and release could not be changed after creation.
//
// ── WHAT THIS PAGE IS, AND IS NOT ────────────────────────────────────────────────────────
// A form. Every write goes through app/lib/series/admin-writes.js, which re-checks the admin uid
// and validates before it touches the database; the decisions and the words (states, the
// checklist, the button, the summaries) are app/lib/series/publishing.js, so the panel and the
// writer ask the same question. One static page; the view is the query string —
//   (none)              the list             ?new=series        a new series
//   ?s=<series>         one series           ?s=<series>&i=new  a new instalment
//   ?s=<series>&i=<id>  the editor
// — so Back and Forward work. No epoch number, instalment id or raw status word is ever printed.
//
// ── CARRIED FORWARD FROM THE OLD SCREEN, ON PURPOSE ──────────────────────────────────────
// · The EPUB is never shown as a URL: series_epubs/ is read:false to every client, this one too.
// · There is no reading-time input. wordCount comes from uploadInstalmentEpub(), from the bytes.
// · Who can read it is a real choice with NO default (ruling 142); day and week passes never count.
// · Delete is permanent, takes a typed confirmation, and burns the ordinal (deletion.js).
// · Messages appear where the action was, never only at the top of the page (R31).
// · A publish asks for ONE build (W34), then checks the page actually opens.
//
// ── TIME IS LONDON TIME ──────────────────────────────────────────────────────────────────
// Entered as a date and a time read as London wall time (app/lib/londonTime.js), shown the same
// way. The old screen read the typed time as UTC. "As soon as I publish" is the database
// server's clock (serverTimestamp), so a fast device clock cannot hold a release back.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { useReliableLoad } from '../../lib/useReliable';
import AdminLoad from '../../components/AdminLoad';
import { getAllSeries, getAllInstalments, getDeletedInstalments } from '../../lib/series/loader';
import {
  createSeries, updateSeries, createDraftInstalment, updateInstalment, publishInstalment,
  takeDownInstalment, deleteInstalment, uploadInstalmentEpub, uploadInstalmentImage,
  uploadSeriesImage, slugify,
} from '../../lib/series/admin-writes';
import { nextFreeOrdinal } from '../../lib/series/deletion';
import { readingMinutes } from '../../lib/series/format';
import {
  instalmentState, seriesState, STATE_LABEL, SERIES_CHIP, SERIES_LIST_CHIP, tierLabel, tierChosen,
  releaseChoice, needsFor, publishButtonLabel, pressingIt, goesLiveLine, seriesSummary, rowSubline,
  initials, audienceLine, levelOf, levelFields, levelChangeLine,
} from '../../lib/series/publishing';
import { PROVISIONAL_RELEASE_MS } from '../../lib/series/schema';
import { requestRebuild, HOOKS } from '../../lib/rebuild';
import { pageAnswers, waitForPages, instalmentPagePath, seriesPagePath } from '../../lib/series/pageCheck';
import {
  londonFields, londonFieldsToMs, londonLongDate, londonClock, londonLongDateTime,
} from '../../lib/londonTime';
import { loadWriterRoster, findWriterByHandle } from '../../lib/writerRoster';
import { InstalmentBody, ReadAction } from '../../series/instalment/[instalmentId]/page-instalment';

const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const AUTOSAVE_MS = 600;

// ── THE LOOK (ruling 140) ─────────────────────────────────────────────────────────────────
// The admin's own dark style. Sizes taken from the brief are as given; the ones it left open are
// named in the W38 report (header, breadcrumb, chip, dialog, phone gutters).
const CSS = `
.sa{min-height:100vh;background:#0f0f0f;color:#e8e8e8;font-family:'Cormorant Garamond',Georgia,serif;font-size:18px;line-height:1.5}
.sa *{box-sizing:border-box}
.sa-top{background:#171717;border-bottom:1px solid #242424}
.sa-top-in{max-width:1120px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.sa-logo{font-size:17px;font-weight:700;color:#c4b5fd;letter-spacing:.05em}
.sa-sub{font-size:13px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.14em}
.sa-toplink{color:#c4b5fd;text-decoration:none;font-size:17px;min-height:44px;display:inline-flex;align-items:center}
.sa-body{max-width:1120px;margin:0 auto;padding:32px 24px 96px;display:flex;flex-direction:column;gap:24px}
.sa-card{background:#171717;border:1px solid #242424;border-radius:12px;padding:24px}
.sa-h1{font-size:36px;font-weight:600;color:#fff;margin:0;line-height:1.12}
.sa-h2{font-size:25px;font-weight:600;color:#fff;margin:0;line-height:1.2}
.sa-label{display:block;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:rgba(255,255,255,.62);margin:0 0 8px}
.sa-eyebrow{display:block;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.2em;color:#c9a84c}
.sa-dim{color:rgba(255,255,255,.62)}
.sa-small{font-size:16px}
.sa-amber{color:#fcd34d}
.sa-err{color:#f87171;font-size:17px;white-space:pre-wrap}
.sa-ok{color:#86efac;font-size:17px}
.sa-input{width:100%;min-height:48px;background:#1a1a1a;border:1px solid #2e2e2e;border-radius:8px;color:#e8e8e8;font:inherit;font-size:19px;padding:10px 14px}
.sa-input:focus{outline:2px solid #a78bfa;outline-offset:1px}
.sa-input::placeholder{color:rgba(255,255,255,.35)}
textarea.sa-input{min-height:112px;resize:vertical;line-height:1.45}
.sa-field{display:flex;flex-direction:column}
.sa-stack{display:flex;flex-direction:column;gap:20px}
.sa-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sa-between{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.sa-btn{min-height:48px;padding:0 22px;border-radius:8px;font:inherit;font-size:18px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;line-height:1.2;text-align:center}
.sa-btn-p{background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border:none}
.sa-btn-s{background:transparent;border:1px solid rgba(124,58,237,.45);color:#c4b5fd}
.sa-btn-red{background:#b91c1c;color:#fff;border:none}
.sa-btn-redline{background:transparent;border:1px solid rgba(248,113,113,.6);color:#f87171}
.sa-btn:disabled{opacity:.45;cursor:default}
.sa-btn-wide{width:100%}
.sa-textbtn{background:none;border:none;font:inherit;font-size:17px;color:#c4b5fd;cursor:pointer;min-height:44px;padding:0;text-align:left}
.sa-textbtn-red{color:#f87171}
.sa-chip{display:inline-flex;align-items:center;min-height:30px;padding:0 12px;border-radius:999px;font-size:15px;font-weight:700;white-space:nowrap}
.sa-chip-live{color:#86efac;background:rgba(134,239,172,.12)}
.sa-chip-scheduled{color:#bfdbfe;background:rgba(191,219,254,.12)}
.sa-chip-draft{color:#d4d4d4;background:rgba(212,212,212,.12)}
.sa-chip-taken-down{color:#fcd34d;background:rgba(252,211,77,.12)}
.sa-crumb{font-size:17px;color:rgba(255,255,255,.62);display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.sa-crumb button{background:none;border:none;font:inherit;color:#c4b5fd;cursor:pointer;padding:0;min-height:44px}
.sa-poster{background:#1a1a1a center/cover no-repeat;border:1px solid #2e2e2e;border-radius:6px;flex:0 0 auto}
.sa-list{display:flex;flex-direction:column;gap:16px}
.sa-scard{display:flex;gap:20px;align-items:center;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer}
.sa-scard:hover{border-color:#3a3a3a}
.sa-grow{flex:1 1 auto;min-width:0}
.sa-title{font-size:23px;font-weight:600;color:#fff;line-height:1.2}
.sa-irow{display:grid;grid-template-columns:36px 44px minmax(0,1fr) auto 20px;grid-template-areas:"ord thumb text meta chev";align-items:center;column-gap:16px;row-gap:8px;width:100%;padding:14px 0;border:none;border-top:1px solid #242424;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;min-height:44px}
.sa-irow-meta{grid-area:meta;display:flex;align-items:center;gap:16px}
.sa-irow:first-child{border-top:none}
.sa-ord{grid-area:ord;font-size:28px;font-weight:600;color:#c9a84c;text-align:center}
.sa-who{flex:0 0 auto;font-size:16px;width:150px}
.sa-who-gold{color:#e0c068}.sa-who-plat{color:#d8d4f0}.sa-who-free{color:#fda4af}.sa-who-none{color:#fcd34d}
.sa-chev{grid-area:chev;color:rgba(255,255,255,.4)}
.sa-cols{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
.sa-form{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:24px}
.sa-panel{flex:1 1 320px;min-width:0;position:sticky;top:24px;display:flex;flex-direction:column;gap:20px}
.sa-tiles{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.sa-tile{border:1px dashed #3a3a3a;border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;min-height:200px;background:#141414}
.sa-tile.sa-filled{border-style:solid;border-color:#2e2e2e}
.sa-tile.sa-drag{border-color:#a78bfa;background:rgba(167,139,250,.08)}
.sa-tile-img{width:96px;aspect-ratio:2/3;border-radius:4px;background:#1a1a1a center/cover no-repeat;border:1px solid #2e2e2e}
.sa-logo-img{width:64px;height:64px;border-radius:6px;background:#1a1a1a center/contain no-repeat;border:1px solid #2e2e2e}
.sa-choices{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.sa-choices-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.sa-choice{position:relative;min-height:96px;text-align:left;padding:18px 48px 18px 18px;border-radius:10px;border:1px solid #2e2e2e;background:#1a1a1a;color:#e8e8e8;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:4px}
.sa-choice[aria-checked="true"]{border:2px solid #a78bfa;background:rgba(167,139,250,.10);padding:17px 47px 17px 17px}
.sa-choice-t{font-size:21px;font-weight:600}
.sa-tick{position:absolute;top:16px;right:16px;color:#a78bfa}
.sa-check{display:flex;gap:12px;align-items:flex-start;padding:6px 0}
.sa-dot{flex:0 0 22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-top:3px}
.sa-dot-done{background:rgba(134,239,172,.15);color:#86efac}
.sa-dot-need{border:2px solid #fcd34d}
.sa-dot-opt{border:2px solid rgba(255,255,255,.28)}
.sa-steps{display:flex;flex-direction:column;gap:12px}
.sa-spin{width:18px;height:18px;border-radius:50%;border:2px solid rgba(167,139,250,.3);border-top-color:#a78bfa;animation:sa-spin 900ms linear infinite}
@keyframes sa-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.sa-spin{animation:none}}
.sa-warn{border-color:#fcd34d}
.sa-overlay{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px}
.sa-dialog{width:100%;max-width:560px;max-height:calc(100vh - 32px);overflow:auto}
.sa-results{display:flex;flex-direction:column;gap:8px;max-height:320px;overflow:auto}
.sa-writer{display:flex;align-items:center;gap:14px;width:100%;min-height:60px;padding:8px 14px;border:1px solid #2e2e2e;border-radius:10px;background:#1a1a1a;color:inherit;font:inherit;text-align:left;cursor:pointer}
.sa-writer[aria-checked="true"]{border:2px solid #a78bfa;padding:7px 13px;background:rgba(167,139,250,.10)}
.sa-disc{flex:0 0 44px;height:44px;border-radius:50%;background:rgba(124,58,237,.25);color:#c4b5fd;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:17px}
.sa-preview{position:fixed;inset:0;z-index:2100;background:#080610;overflow:auto}
.sa-preview-bar{position:sticky;top:0;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 16px;background:#171717;border-bottom:1px solid #242424}
.sa-savebar{position:sticky;bottom:16px;z-index:5;display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;padding:14px 16px;border-radius:12px;background:#171717;border:1px solid #2e2e2e;box-shadow:0 12px 28px rgba(0,0,0,.5)}
@media (max-width:899px){.sa-panel{position:static}}
@media (max-width:640px){
  .sa-top-in{padding:12px 16px}
  .sa-body{padding:20px 16px 80px;gap:20px}
  .sa-card{padding:20px 16px}
  .sa-h1{font-size:30px}
  .sa-tiles,.sa-choices,.sa-choices-3{grid-template-columns:1fr}
  .sa-scard{align-items:flex-start}
  .sa-who{width:auto}
  .sa-irow{grid-template-columns:28px 44px minmax(0,1fr) 20px;grid-template-areas:"ord thumb text chev" "ord thumb meta chev";column-gap:12px}
  .sa-irow-meta{gap:12px;flex-wrap:wrap}
}
`;

// ── SMALL PIECES ──────────────────────────────────────────────────────────────────────────
const Tick = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17.5 19 7" /></svg>
);
const Chevron = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><polyline points="9 5 16 12 9 19" /></svg>
);
const Close = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
);
const Chip = ({ state, children }) => <span className={`sa-chip sa-chip-${state}`}>{children || STATE_LABEL[state]}</span>;
const Msg = ({ m }) => (m ? <div role="status" className={m.ok ? 'sa-ok' : 'sa-err'}>{m.text}</div> : null);
const errText = (r) => (r?.errors || ['Something went wrong.']).join('\n');
const has = (v) => typeof v === 'string' && v.trim().length > 0;
const whoClass = (label) => ({ 'Gold and Platinum': 'sa-who-gold', 'Platinum only': 'sa-who-plat', 'Free to read': 'sa-who-free' }[label] || 'sa-who-none');

/** A drop zone that is also a file picker. Disabled until it can upload. */
function DropZone({ accept, disabled, onFile, className = '', children }) {
  const input = useRef(null);
  const [drag, setDrag] = useState(false);
  const [pick] = useState(() => () => input.current?.click());
  return (
    <div
      className={`sa-tile ${className} ${drag ? 'sa-drag' : ''}`}
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (!disabled && e.dataTransfer.files?.[0]) onFile(e.dataTransfer.files[0]); }}
    >
      {children(pick)}
      <input ref={input} type="file" accept={accept} hidden disabled={disabled}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </div>
  );
}

// ── THE CLOCK ─────────────────────────────────────────────────────────────────────────────
// States move with time (Scheduled becomes Live at its minute), so the screens re-read the clock
// every half minute. Read once at mount in the initialiser, never during a render.
function useNow(everyMs = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

// ── THE ROUTE ─────────────────────────────────────────────────────────────────────────────
// Read in an effect, not during render: the page is prerendered with no query string, and
// reading location in an initialiser would render something else on hydration.
function useRoute() {
  const [search, setSearch] = useState(null);
  useEffect(() => {
    const read = () => setSearch(window.location.search);
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const go = useCallback((params, { replace = false } = {}) => {
    const qs = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v != null && v !== '')).toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
    setSearch(window.location.search);
    if (!replace) window.scrollTo(0, 0);
  }, []);
  return [search === null ? null : new URLSearchParams(search), go];
}

/** Everything the screens need, in one admin read: each series, its rows, its burned ordinals,
 *  and each instalment's detail (admin-readable before release). Throws on failure, so a failed
 *  read is drawn by AdminLoad rather than disguised as "no series". */
async function loadEverything() {
  const opts = { throwOnError: true };
  const all = await getAllSeries(opts);
  return Promise.all(all.map(async (series) => {
    const [rows, dead] = await Promise.all([getAllInstalments(series.id, opts), getDeletedInstalments(series.id, opts)]);
    const details = Object.fromEntries(await Promise.all(rows.map(async (r) => {
      const snap = await get(ref(db, `series_instalments_detail/${r.id}`));
      return [r.id, snap.exists() ? snap.val() : null];
    })));
    return { ...series, rows, dead, details };
  }));
}

async function readInstalment(id) {
  const [row, detail] = await Promise.all([
    get(ref(db, `series_instalments/${id}`)), get(ref(db, `series_instalments_detail/${id}`)),
  ]);
  return { row: row.exists() ? { id, ...row.val() } : null, detail: detail.exists() ? detail.val() : null };
}

// ═════════════════════════════════════════════════════════════════════════════════════════
export default function SeriesAdminPage() {
  const { user, loading } = useAuth() || {};
  const isAdmin = !!user && ADMIN_UIDS.includes(user.uid);
  const [params, go] = useRoute();
  // A message carried to the next screen, for actions that remove the screen they were taken on.
  const [flash, setFlash] = useState(null);
  const [createdId, setCreatedId] = useState(null);
  const load = useReliableLoad(async () => (isAdmin ? loadEverything() : null), [isAdmin]);

  if (loading || params === null) return <Frame><div className="sa-dim">Loading…</div></Frame>;
  if (!isAdmin) {
    return (
      <Frame>
        <div className="sa-card" style={{ textAlign: 'center' }}>
          <div className="sa-err" style={{ fontWeight: 700 }}>Not authorised</div>
          <div className="sa-dim">This area is restricted.</div>
        </div>
      </Frame>
    );
  }

  const s = params.get('s');
  const i = params.get('i');
  const isNewSeries = params.get('new') === 'series';
  // A message for the next screen travels with the navigation, so moving on cannot clear it.
  const navigate = (p, { flash: next = null, ...opts } = {}) => { setFlash(next); go(p, opts); };

  return (
    <Frame>
      <AdminLoad load={load} subject="the series" isEmpty={() => false}
        loading={<div className="sa-dim">Loading the series…</div>}>
        {(list) => {
          if (isNewSeries) return <NewSeries go={navigate} reload={load.reload} />;
          const entry = s ? list.find((x) => x.id === s) : null;
          if (s && !entry) return <NotFound go={navigate} />;
          if (entry && i) {
            // The editor keeps its state across the moment a new draft gets its id: the URL moves
            // from i=new to the real id, and remounting there would drop what was being typed.
            const key = i === 'new' || i === createdId ? 'new' : i;
            return (
              <InstalmentEditor key={`${entry.id}/${key}`} entry={entry} instalmentId={i === 'new' ? null : i}
                user={user} go={navigate} reload={load.reload}
                onCreated={(id) => { setCreatedId(id); go({ s: entry.id, i: id }, { replace: true }); }} />
            );
          }
          if (entry) return <OneSeries key={entry.id} entry={entry} user={user} go={navigate} reload={load.reload} flash={flash} />;
          return <SeriesList list={list} go={navigate} />;
        }}
      </AdminLoad>
    </Frame>
  );
}

function Frame({ children }) {
  return (
    <div className="sa">
      <style>{CSS}</style>
      <header className="sa-top">
        <div className="sa-top-in">
          <div>
            <div className="sa-logo">Calvary Scribblings</div>
            <div className="sa-sub">The Series</div>
          </div>
          <a className="sa-toplink" href="/admin">← Admin</a>
        </div>
      </header>
      <main className="sa-body">{children}</main>
    </div>
  );
}

function NotFound({ go }) {
  return (
    <div className="sa-card sa-stack">
      <div>That series could not be found.</div>
      <div><button type="button" className="sa-btn sa-btn-s" onClick={() => go({})}>Back to the Series</button></div>
    </div>
  );
}

// ── 1. THE SERIES ─────────────────────────────────────────────────────────────────────────
function SeriesList({ list, go }) {
  const now = useNow();
  return (
    <>
      <div className="sa-between">
        <h1 className="sa-h1">The Series</h1>
        <button type="button" className="sa-btn sa-btn-p" onClick={() => go({ new: 'series' })}>New series</button>
      </div>
      {!list.length && <div className="sa-card sa-dim">No series yet.</div>}
      <div className="sa-list">
        {list.map((x) => {
          const st = seriesState(x);
          return (
            <button key={x.id} type="button" className="sa-card sa-scard" onClick={() => go({ s: x.id })}
              data-series={x.id}>
              <span className="sa-poster" style={{ width: 76, height: 114, backgroundImage: x.coverUrl ? `url(${x.coverUrl})` : undefined }} />
              <span className="sa-grow" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="sa-title">{x.title}</span>
                {has(x.author) && <span className="sa-dim">by {x.author}</span>}
                <span className="sa-small sa-dim">
                  {seriesSummary(x, x.rows.map((r) => ({ row: r, detail: x.details[r.id] })), now)}
                </span>
              </span>
              <Chip state={st}>{SERIES_LIST_CHIP[st]}</Chip>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ── 5. CHOOSING THE WRITER ────────────────────────────────────────────────────────────────
// The roster is shared with the story CMS (app/lib/writerRoster.js). A writer with no handle is
// left out: an instalment must carry all three of name, account and handle, and "their account
// and handle come with the name" — there is nothing to type.
let rosterCache = null;
function WriterPicker({ current, onClose, onUse }) {
  const [roster, setRoster] = useState(rosterCache);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState(current?.authorUid ? { uid: current.authorUid, displayName: current.author, username: current.authorHandle } : null);
  const [found, setFound] = useState([]);
  const [handle, setHandle] = useState('');
  const [handleMsg, setHandleMsg] = useState(null);
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    if (rosterCache) return;
    loadWriterRoster({ db, ref, get })
      .then((r) => { rosterCache = r.filter((w) => w.username); setRoster(rosterCache); })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const all = useMemo(() => {
    const seen = new Set();
    return [...found, ...(roster || [])].filter((w) => (seen.has(w.uid) ? false : seen.add(w.uid)));
  }, [found, roster]);
  const shown = all.filter((w) => w.displayName.toLowerCase().includes(q.trim().toLowerCase()));

  const find = async () => {
    setFinding(true); setHandleMsg(null);
    try {
      const w = await findWriterByHandle({ db, ref, get }, handle);
      if (w.error) setHandleMsg(w.error || 'Type a handle first.');
      else if (!w.displayName) setHandleMsg('That account has no name yet, so it cannot be credited.');
      else { setFound((f) => [w, ...f]); setChosen(w); setQ(''); }
    } catch {
      setHandleMsg('The lookup failed. Try again.');
    }
    setFinding(false);
  };

  return (
    <div className="sa-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sa-card sa-dialog sa-stack" role="dialog" aria-modal="true" aria-label="Choose the writer">
        <div className="sa-between">
          <h2 className="sa-h2">Choose the writer</h2>
          <button type="button" className="sa-textbtn" aria-label="Close" onClick={onClose} style={{ width: 44, justifyContent: 'center', display: 'inline-flex' }}><Close /></button>
        </div>
        <div className="sa-field">
          <label className="sa-label" htmlFor="sa-writer-q">Search writers</label>
          <input id="sa-writer-q" className="sa-input" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <div className="sa-results" role="radiogroup" aria-label="Writers">
          {!roster && !failed && <div className="sa-dim">Loading writers…</div>}
          {failed && <div className="sa-err">The writers could not be loaded. Find them by their handle below.</div>}
          {roster && !shown.length && <div className="sa-dim">No writer by that name.</div>}
          {shown.map((w) => {
            const on = chosen?.uid === w.uid;
            return (
              <button key={w.uid} type="button" role="radio" aria-checked={on} className="sa-writer" onClick={() => setChosen(w)}>
                <span className="sa-disc">{initials(w.displayName)}</span>
                <span className="sa-grow"><span style={{ display: 'block', fontWeight: 600 }}>{w.displayName}</span><span className="sa-small sa-dim">Writer on the site</span></span>
                {on && <span style={{ color: '#a78bfa' }}><Tick size={18} /></span>}
              </button>
            );
          })}
        </div>
        <div className="sa-field">
          <label className="sa-label" htmlFor="sa-writer-h">Not in the list? Find them by their handle.</label>
          <div className="sa-row" style={{ flexWrap: 'nowrap' }}>
            <input id="sa-writer-h" className="sa-input" placeholder="@handle" value={handle}
              onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') find(); }} />
            <button type="button" className="sa-btn sa-btn-s" disabled={!handle.trim() || finding} onClick={find}>{finding ? 'Finding…' : 'Find'}</button>
          </div>
          {handleMsg && <div className="sa-err" style={{ marginTop: 8 }}>{handleMsg}</div>}
        </div>
        <div className="sa-small sa-dim">Their account and handle come with the name. You never type them.</div>
        <div className="sa-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="sa-btn sa-btn-s" onClick={onClose}>Cancel</button>
          <button type="button" className="sa-btn sa-btn-p" disabled={!chosen?.username}
            onClick={() => onUse({ author: chosen.displayName, authorUid: chosen.uid, authorHandle: chosen.username })}>
            {chosen ? `Use ${chosen.displayName}` : 'Use'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A writer shown as a field: the disc, the name, a line under it, and Change. */
function WriterField({ writer, line, onChange, emptyLabel = 'Choose the writer' }) {
  if (!has(writer?.author)) {
    return <button type="button" className="sa-input" style={{ textAlign: 'left', cursor: 'pointer', color: 'rgba(255,255,255,.6)' }} onClick={onChange}>{emptyLabel}</button>;
  }
  return (
    <div className="sa-row" style={{ flexWrap: 'nowrap' }}>
      <span className="sa-disc">{initials(writer.author)}</span>
      <span className="sa-grow"><span style={{ display: 'block', fontWeight: 600 }}>{writer.author}</span>{line && <span className="sa-small sa-dim">{line}</span>}</span>
      <button type="button" className="sa-btn sa-btn-s" onClick={onChange}>Change</button>
    </div>
  );
}

// ── 6. NEW SERIES ─────────────────────────────────────────────────────────────────────────
function NewSeries({ go, reload }) {
  const [title, setTitle] = useState('');
  const [synopsis, setSynopsis] = useState('');
  const [writer, setWriter] = useState(null);
  const [picking, setPicking] = useState(false);
  const [poster, setPoster] = useState(null);
  const [upload, setUpload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const onPoster = async (file) => {
    setUpload({ pct: 0 }); setMsg(null);
    const r = await uploadSeriesImage(slugify(title), file, (p) => setUpload({ pct: Math.round(p * 100) }));
    setUpload(null);
    if (r.ok) setPoster(r.url); else setMsg({ ok: false, text: errText(r) });
  };
  const create = async () => {
    setBusy(true); setMsg(null);
    const r = await createSeries({ title: title.trim(), synopsis: synopsis.trim(), coverUrl: poster, status: 'draft', ...writer });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: errText(r) }); return; }
    await reload();
    go({ s: r.seriesId });
  };

  return (
    <>
      <nav className="sa-crumb"><button type="button" onClick={() => go({})}>The Series</button><span>/</span><span>New series</span></nav>
      <h1 className="sa-h1">New series</h1>
      <div className="sa-card sa-stack">
        <div className="sa-field">
          <label className="sa-label" htmlFor="ns-title">Title</label>
          <input id="ns-title" className="sa-input" placeholder="The series title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="sa-field">
          <span className="sa-label">Writer</span>
          <WriterField writer={writer} onChange={() => setPicking(true)} />
          <div className="sa-small sa-dim" style={{ marginTop: 8 }}>Every instalment in the series carries this writer.</div>
        </div>
        <div className="sa-field">
          <label className="sa-label" htmlFor="ns-syn">Synopsis</label>
          <textarea id="ns-syn" className="sa-input" placeholder="For the series page" value={synopsis} onChange={(e) => setSynopsis(e.target.value)} />
        </div>
        <div className="sa-field">
          <span className="sa-label">Poster</span>
          <DropZone accept="image/*" disabled={!title.trim() || !!upload} onFile={onPoster} className={poster ? 'sa-filled' : ''}>
            {(pick) => (
              <div className="sa-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <span className="sa-poster" style={{ width: 120, height: 180, backgroundImage: poster ? `url(${poster})` : undefined }} />
                <div className="sa-stack" style={{ gap: 10 }}>
                  {upload ? <div>Uploading… {upload.pct}%</div> : (
                    <>
                      {!poster && <div className="sa-dim">Drop the artwork here, or</div>}
                      <div><button type="button" className={`sa-btn ${poster ? 'sa-btn-s' : 'sa-btn-p'}`} disabled={!title.trim()} onClick={pick}>{poster ? 'Replace image' : 'Choose image'}</button></div>
                    </>
                  )}
                  <div className="sa-small sa-dim">Portrait, 2:3.</div>
                </div>
              </div>
            )}
          </DropZone>
        </div>
        <div className="sa-stack" style={{ gap: 10 }}>
          <div><button type="button" className="sa-btn sa-btn-p" disabled={!title.trim() || !writer || busy} onClick={create}>{busy ? 'Creating…' : 'Create series'}</button></div>
          <div className="sa-small sa-dim">It stays off the site until you publish its first instalment. Then the series goes live with it.</div>
          <Msg m={msg} />
        </div>
      </div>
      {picking && <WriterPicker current={writer} onClose={() => setPicking(false)} onUse={(w) => { setWriter(w); setPicking(false); }} />}
    </>
  );
}

// ── 2. ONE SERIES ─────────────────────────────────────────────────────────────────────────
function OneSeries({ entry, user, go, reload, flash }) {
  const now = useNow();
  const st = seriesState(entry);
  const next = nextFreeOrdinal(entry.rows, entry.dead);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [posterUp, setPosterUp] = useState(null);

  // A live series' title, synopsis and poster are baked into its page's link preview at build
  // time (app/series/[slug]/page.js generateMetadata), so changing them asks for one rebuild.
  const rebuildLine = async (changedBaked) => {
    if (st !== 'live' || !changedBaked) return '';
    const v = await requestRebuild({ hook: HOOKS.SERIES, getIdToken: () => user?.getIdToken() });
    return v.ok ? ' The series page’s link preview is rebuilt with it, in about two minutes.' : ` ${v.message}`;
  };

  const startEdit = () => {
    setForm({ title: entry.title, synopsis: entry.synopsis || '', writer: has(entry.author) ? { author: entry.author, authorUid: entry.authorUid, authorHandle: entry.authorHandle } : null });
    setEditing(true); setMsg(null);
  };
  const save = async () => {
    setBusy(true);
    const partial = { title: form.title.trim(), synopsis: form.synopsis.trim(), ...(form.writer || {}) };
    const r = await updateSeries(entry.id, partial);
    const tail = r.ok ? await rebuildLine(partial.title !== entry.title || partial.synopsis !== (entry.synopsis || '')) : '';
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: errText(r) }); return; }
    setEditing(false);
    setMsg({ ok: true, text: `Saved.${tail}` });
    reload();
  };
  const onPoster = async (file) => {
    setPosterUp({ pct: 0 }); setMsg(null);
    const up = await uploadSeriesImage(entry.id, file, (p) => setPosterUp({ pct: Math.round(p * 100) }));
    const r = up.ok ? await updateSeries(entry.id, { coverUrl: up.url }) : up;
    const tail = r.ok ? await rebuildLine(true) : '';
    setPosterUp(null);
    setMsg(r.ok ? { ok: true, text: `Poster replaced.${tail}` } : { ok: false, text: errText(r) });
    reload();
  };

  return (
    <>
      <nav className="sa-crumb"><button type="button" onClick={() => go({})}>The Series</button><span>/</span><span>{entry.title}</span></nav>

      <section className="sa-card">
        <div className="sa-row" style={{ alignItems: 'flex-start', gap: 24 }}>
          <div className="sa-stack" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span className="sa-poster" style={{ width: 168, height: 252, backgroundImage: entry.coverUrl ? `url(${entry.coverUrl})` : undefined }} />
            <label className="sa-textbtn" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {posterUp ? `Uploading… ${posterUp.pct}%` : entry.coverUrl ? 'Replace poster' : 'Add poster'}
              <input type="file" accept="image/*" hidden disabled={!!posterUp}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPoster(f); }} />
            </label>
          </div>
          <div className="sa-grow sa-stack" style={{ gap: 12, minWidth: 260 }}>
            <span className="sa-eyebrow">Series</span>
            {!editing ? (
              <>
                <h1 className="sa-h1">{entry.title}</h1>
                {has(entry.author) && <div className="sa-dim">by {entry.author}</div>}
                <div className="sa-row">
                  <Chip state={st}>{SERIES_CHIP[st]}</Chip>
                  {st === 'live' && <a className="sa-btn sa-btn-s" href={seriesPagePath(entry.slug || entry.id)} target="_blank" rel="noreferrer">View on site</a>}
                </div>
                {has(entry.synopsis) ? <p style={{ margin: 0 }}>{entry.synopsis}</p> : <p className="sa-amber" style={{ margin: 0 }}>No synopsis yet.</p>}
                <div><button type="button" className="sa-textbtn" onClick={startEdit}>Edit title, writer or synopsis</button></div>
              </>
            ) : (
              <div className="sa-stack">
                <div className="sa-field">
                  <label className="sa-label" htmlFor="es-title">Title</label>
                  <input id="es-title" className="sa-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </div>
                <div className="sa-field">
                  <span className="sa-label">Writer</span>
                  <WriterField writer={form.writer} onChange={() => setPicking(true)} line="Every new instalment carries this writer." />
                </div>
                <div className="sa-field">
                  <label className="sa-label" htmlFor="es-syn">Synopsis</label>
                  <textarea id="es-syn" className="sa-input" placeholder="For the series page" value={form.synopsis} onChange={(e) => setForm({ ...form, synopsis: e.target.value })} />
                </div>
                <div className="sa-row">
                  <button type="button" className="sa-btn sa-btn-p" disabled={busy || !form.title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
                  <button type="button" className="sa-btn sa-btn-s" disabled={busy} onClick={() => { setEditing(false); setMsg(null); }}>Cancel</button>
                </div>
              </div>
            )}
            <Msg m={msg} />
          </div>
        </div>
      </section>

      <section className="sa-card sa-stack">
        <div className="sa-between">
          <h2 className="sa-h2">Instalments</h2>
          <button type="button" className="sa-btn sa-btn-p" onClick={() => go({ s: entry.id, i: 'new' })}>Add instalment {next}</button>
        </div>
        <Msg m={flash} />
        {!entry.rows.length && <div className="sa-dim">No instalments yet.</div>}
        <div>
          {entry.rows.map((row) => {
            const detail = entry.details[row.id];
            const ist = instalmentState(row, now);
            const sub = rowSubline({ series: entry, row, detail, now });
            const who = tierLabel(row, detail);
            return (
              <button key={row.id} type="button" className="sa-irow" data-instalment={row.id} onClick={() => go({ s: entry.id, i: row.id })}>
                <span className="sa-ord">{row.ordinal}</span>
                <span className="sa-poster" style={{ gridArea: 'thumb', width: 44, height: 66, backgroundImage: detail?.coverUrl ? `url(${detail.coverUrl})` : undefined }} />
                <span style={{ gridArea: 'text', minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 20 }}>{detail?.title || `Instalment ${row.ordinal}`}</span>
                  {sub.text && <span className={`sa-small ${sub.amber ? 'sa-amber' : 'sa-dim'}`}>{sub.text}</span>}
                </span>
                <span className="sa-irow-meta">
                  <Chip state={ist} />
                  <span className={`sa-who ${whoClass(who)}`}>{who}</span>
                </span>
                <span className="sa-chev"><Chevron /></span>
              </button>
            );
          })}
        </div>
      </section>
      {picking && <WriterPicker current={form?.writer} onClose={() => setPicking(false)} onUse={(w) => { setForm({ ...form, writer: w }); setPicking(false); }} />}
    </>
  );
}

// ── 3. THE INSTALMENT EDITOR ──────────────────────────────────────────────────────────────
//
// THE FORM HOLDS WHAT THE EDITOR SEES; THE RECORD HOLDS WHAT IS SAVED. A draft (and a taken-down
// instalment, which no reader can see) saves as you type. A scheduled or live one waits for
// "Save changes", with Discard, so a reader never sees half-typed text. Files upload at once in
// every state: there is no half-uploaded file to protect a reader from, and the EPUB's object
// path is fixed whatever the record says.
function formFrom(rec) {
  const row = rec?.row || {};
  const detail = rec?.detail || {};
  const choice = rec?.row ? releaseChoice(row, detail) : { mode: null };
  const [date, time] = choice.mode === 'date' ? londonFields(choice.ms) : ['', ''];
  return {
    title: detail.title || '',
    logline: detail.logline || '',
    synopsis: detail.synopsis || '',
    sponsorName: detail.sponsorName || '',
    writer: has(detail.author) ? { author: detail.author, authorUid: detail.authorUid, authorHandle: detail.authorHandle } : null,
    tier: rec?.row && tierChosen(detail) ? levelOf(row) : null,
    when: choice.mode,
    date, time,
  };
}

/** What the form says, as a row and a detail record — for the checklist and the preview. */
function virtualRecord(rec, form) {
  const row = { ...(rec?.row || {}), ...(form.tier ? levelFields(form.tier) : { freeForGold: false }) };
  const detail = { ...(rec?.detail || {}) };
  detail.title = form.title.trim();
  detail.logline = form.logline.trim() || null;
  detail.synopsis = form.synopsis.trim() || null;
  detail.sponsorName = form.sponsorName.trim() || null;
  if (form.writer) Object.assign(detail, form.writer);
  const pending = { ...(detail.choicesPending || {}) };
  if (form.tier) delete pending.freeForGold;
  const ms = londonFieldsToMs(form.date, form.time);
  if (form.when === 'publish') { delete pending.releaseAtMs; detail.releaseWhen = 'publish'; }
  else if (form.when === 'date' && Number.isFinite(ms)) { delete pending.releaseAtMs; detail.releaseWhen = 'date'; row.releaseAtMs = ms; }
  detail.choicesPending = Object.keys(pending).length ? pending : null;
  return { row, detail };
}

/** The changes between the saved record and the form, as an updateInstalment() partial. */
function partialFrom(rec, form, { draft }) {
  const before = formFrom(rec);
  const p = {};
  const opts = {};
  const txt = (k, nullable) => {
    if (form[k] === before[k]) return;
    const v = form[k].trim();
    if (!v && !nullable) return;            // a title is never saved empty — the draft keeps its last one
    p[k] = v || null;
  };
  txt('title', false); txt('logline', true); txt('synopsis', true);
  if (form.sponsorName !== before.sponsorName) {
    const v = form.sponsorName.trim();
    p.sponsorName = v || null;
    // A logo needs a name, and the two save together: clearing the name takes the sponsor away.
    if (!v && rec?.detail?.sponsorLogoUrl) p.sponsorLogoUrl = null;
  }
  if (form.writer && form.writer.authorUid !== before.writer?.authorUid) Object.assign(p, form.writer);
  const pending = { ...(rec?.detail?.choicesPending || {}) };
  let pendingChanged = false;
  if (form.tier && form.tier !== before.tier) {
    // W40 — the pair, always together (the validator and the rules refuse one without the other).
    Object.assign(p, levelFields(form.tier));
    if (pending.freeForGold) { delete pending.freeForGold; pendingChanged = true; }
  }
  const ms = londonFieldsToMs(form.date, form.time);
  const whenChanged = form.when !== before.when || form.date !== before.date || form.time !== before.time;
  if (whenChanged) {
    if (form.when === 'publish') {
      if (draft) p.releaseWhen = 'publish';
      else opts.releaseNow = true;
      if (pending.releaseAtMs) { delete pending.releaseAtMs; pendingChanged = true; }
    } else if (form.when === 'date' && Number.isFinite(ms)) {
      p.releaseAtMs = ms;
      if (draft) p.releaseWhen = 'date';
      if (pending.releaseAtMs) { delete pending.releaseAtMs; pendingChanged = true; }
    }
  }
  if (pendingChanged) p.choicesPending = Object.keys(pending).length ? pending : null;
  return { partial: p, opts };
}

function InstalmentEditor({ entry, instalmentId, user, go, reload, onCreated }) {
  const initial = instalmentId ? { row: entry.rows.find((r) => r.id === instalmentId) || null, detail: entry.details[instalmentId] || null } : null;
  const [id, setId] = useState(instalmentId);
  const [rec, setRec] = useState(initial);
  const [form, setForm] = useState(() => ({
    ...formFrom(initial),
    ...(initial ? {} : { writer: has(entry.author) ? { author: entry.author, authorUid: entry.authorUid, authorHandle: entry.authorHandle } : null }),
  }));
  const [save, setSave] = useState('idle');     // idle | saving | failed
  const [saveErr, setSaveErr] = useState(null);
  const [picking, setPicking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const formRef = useRef(form);
  const recRef = useRef(rec);
  const timer = useRef(null);
  const creating = useRef(false);
  const persistRef = useRef(null);
  useLayoutEffect(() => { formRef.current = form; recRef.current = rec; });

  const ordinal = rec?.row?.ordinal ?? nextFreeOrdinal(entry.rows, entry.dead);
  const now = useNow();
  const state = rec?.row ? instalmentState(rec.row, now) : 'draft';
  const autosaves = state === 'draft' || state === 'taken-down';

  const refresh = useCallback(async (theId = id) => {
    const fresh = await readInstalment(theId);
    setRec(fresh);
    return fresh;
  }, [id]);

  // ── SAVE AS YOU TYPE (drafts) ──
  // Resolves true when everything typed is saved. It never writes to an instalment that is no
  // longer a draft or taken down: a keystroke's save that was still waiting when Publish was
  // pressed must not land on the published record (W38 found exactly that race in its suite).
  const persist = useCallback(async () => {
    const f = formRef.current;
    const r0 = recRef.current;
    if (r0?.row && r0.row.status === 'published') return true;
    if (!r0?.row) {
      // A new instalment becomes a draft the moment it has a title.
      if (!f.title.trim() || creating.current) return false;
      creating.current = true;
      setSave('saving');
      const r = await createDraftInstalment({ seriesId: entry.id, ordinal, title: f.title.trim() });
      creating.current = false;
      if (!r.ok) { setSave('failed'); setSaveErr(errText(r)); return false; }
      setId(r.instalmentId);
      const fresh = await readInstalment(r.instalmentId);
      setRec(fresh);
      recRef.current = fresh;
      onCreated(r.instalmentId);
      reload();
      // Anything chosen while the draft was being made is saved now.
      if (Object.keys(partialFrom(fresh, formRef.current, { draft: true }).partial).length) timer.current = setTimeout(() => persistRef.current(), 0);
      setSave('idle');
      return true;
    }
    const { partial } = partialFrom(r0, f, { draft: true });
    if (!Object.keys(partial).length) { setSave('idle'); return true; }
    setSave('saving');
    const r = await updateInstalment(r0.row.id, partial);
    if (!r.ok) { setSave('failed'); setSaveErr(errText(r)); return false; }
    const fresh = await refresh(r0.row.id);
    recRef.current = fresh;
    setSave('idle'); setSaveErr(null);
    reload();
    return true;
  }, [entry.id, ordinal, onCreated, refresh, reload]);

  /** Save whatever is still waiting on the autosave timer, now. Publish calls this first. */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    return persistRef.current ? persistRef.current() : true;
  }, []);
  useLayoutEffect(() => { persistRef.current = persist; });

  const change = (patch, { now: immediate = false } = {}) => {
    setForm((f) => ({ ...f, ...patch }));
    if (!autosaves && rec?.row) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persistRef.current(), immediate ? 0 : AUTOSAVE_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  // ── SAVE CHANGES (scheduled and live) ──
  const [manualMsg, setManualMsg] = useState(null);
  const pending = !autosaves && rec?.row ? partialFrom(rec, form, { draft: false }) : null;
  const dirty = !!pending && (Object.keys(pending.partial).length > 0 || !!pending.opts.releaseNow);
  const saveChanges = async () => {
    setSave('saving'); setManualMsg(null);
    const { partial, opts } = partialFrom(rec, form, { draft: false });
    const r = await updateInstalment(rec.row.id, partial, opts);
    if (!r.ok) { setSave('idle'); setManualMsg({ ok: false, text: errText(r) }); return; }
    const fresh = await refresh();
    setForm(formFrom(fresh));
    setSave('idle');
    setManualMsg({ ok: true, text: 'Saved. It shows on the site straight away.' });
    reload();
  };

  // ── FILES ──
  const [epubUp, setEpubUp] = useState(null);
  const [coverUp, setCoverUp] = useState(null);
  const [logoUp, setLogoUp] = useState(null);
  const [fileMsg, setFileMsg] = useState(null);
  const [sponsorMsg, setSponsorMsg] = useState(null);
  const onEpub = async (file) => {
    setFileMsg(null); setEpubUp(0);
    const up = await uploadInstalmentEpub(id, file, (p) => setEpubUp(Math.round(p * 100)));
    const r = up.ok ? await updateInstalment(id, { epubPath: up.epubPath, wordCount: up.wordCount }) : up;
    setEpubUp(null);
    if (!r.ok) { setFileMsg({ ok: false, text: errText(r) }); return; }
    if (up.warnings?.length) setFileMsg({ ok: true, text: up.warnings.join(' ') });
    await refresh(); reload();
  };
  const onCover = async (file) => {
    setFileMsg(null); setCoverUp(0);
    const up = await uploadInstalmentImage(id, 'cover', file, (p) => setCoverUp(Math.round(p * 100)));
    const r = up.ok ? await updateInstalment(id, { coverUrl: up.url }) : up;
    setCoverUp(null);
    if (!r.ok) { setFileMsg({ ok: false, text: errText(r) }); return; }
    await refresh(); reload();
  };
  const onLogo = async (file) => {
    setSponsorMsg(null); setLogoUp(0);
    const up = await uploadInstalmentImage(id, 'sponsor', file, (p) => setLogoUp(Math.round(p * 100)));
    // The name and the logo land in ONE write: the existing rule, a logo needs a name.
    const r = up.ok ? await updateInstalment(id, { sponsorName: form.sponsorName.trim(), sponsorLogoUrl: up.url }) : up;
    setLogoUp(null);
    if (!r.ok) { setSponsorMsg({ ok: false, text: errText(r) }); return; }
    await refresh(); reload();
  };

  // ── THE CHECKLIST ──
  const virtual = virtualRecord(rec, form);
  const needs = needsFor({ series: entry, row: virtual.row, detail: virtual.detail, now });
  const prevOrdinals = entry.rows.map((r) => r.ordinal).filter((o) => o < ordinal);
  const carried = prevOrdinals.length ? Math.max(...prevOrdinals) : null;
  const writerLine = form.writer && form.writer.authorUid === entry.authorUid
    ? (carried ? `The series’ writer, carried over from instalment ${carried}` : 'The series’ writer')
    : 'Chosen for this instalment';
  const whenMs = londonFieldsToMs(form.date, form.time);
  const words = rec?.detail?.wordCount;
  const minutes = readingMinutes(words);

  const statusLine = !rec?.row ? (save === 'saving' ? 'Saving…' : 'Saved as you type')
    : autosaves ? (save === 'saving' ? 'Saving…' : save === 'failed' ? null : 'Saved as you type') : null;

  return (
    <>
      <nav className="sa-crumb">
        <button type="button" onClick={() => go({})}>The Series</button><span>/</span>
        <button type="button" onClick={() => go({ s: entry.id })}>{entry.title}</button><span>/</span>
        <span>Instalment {ordinal}</span>
      </nav>
      <div className="sa-between" style={{ alignItems: 'flex-end' }}>
        <div className="sa-stack" style={{ gap: 6 }}>
          <span className="sa-eyebrow">Instalment {ordinal}</span>
          <h1 className="sa-h1">{form.title.trim() || 'Untitled'}</h1>
        </div>
        <div className="sa-row">
          <Chip state={state} />
          {statusLine && <span className="sa-small sa-dim" aria-live="polite">{statusLine}</span>}
          {save === 'failed' && (
            <span className="sa-small sa-err" aria-live="polite">Couldn’t save ·{' '}
              <button type="button" className="sa-textbtn" style={{ fontSize: 16, minHeight: 0 }} onClick={() => persistRef.current()}>Try again</button>
            </span>
          )}
        </div>
      </div>
      {save === 'failed' && saveErr && <div className="sa-err sa-small">{saveErr}</div>}

      <div className="sa-cols">
        <div className="sa-form">
          {/* a. The instalment */}
          <section className="sa-card sa-stack">
            <h2 className="sa-h2">The instalment</h2>
            <div className="sa-field">
              <label className="sa-label" htmlFor="ie-title">Title</label>
              <input id="ie-title" className="sa-input" value={form.title} onChange={(e) => change({ title: e.target.value })} />
            </div>
            <div className="sa-field">
              <label className="sa-label" htmlFor="ie-logline">Logline <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
              <input id="ie-logline" className="sa-input" placeholder="One line, shown in italic under the title" value={form.logline} onChange={(e) => change({ logline: e.target.value })} />
            </div>
            <div className="sa-field">
              <label className="sa-label" htmlFor="ie-syn">Synopsis <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
              <textarea id="ie-syn" className="sa-input" placeholder="A short paragraph for the instalment page" value={form.synopsis} onChange={(e) => change({ synopsis: e.target.value })} />
            </div>
            <div className="sa-field">
              <span className="sa-label">Writer</span>
              <WriterField writer={form.writer} line={writerLine} onChange={() => setPicking(true)} />
            </div>
          </section>

          {/* b. Files */}
          <section className="sa-card sa-stack">
            <h2 className="sa-h2">Files</h2>
            {!id && <div className="sa-small sa-dim">Type a title first. The files can go up as soon as the draft exists.</div>}
            <div className="sa-tiles">
              <DropZone accept=".epub,application/epub+zip" disabled={!id || epubUp !== null} onFile={onEpub} className={rec?.detail?.epubPath ? 'sa-filled' : ''}>
                {(pick) => (
                  <>
                    <span className="sa-label" style={{ margin: 0 }}>EPUB</span>
                    {epubUp !== null ? <div>Uploading… {epubUp}%</div> : rec?.detail?.epubPath ? (
                      <>
                        <div className="sa-ok" style={{ fontWeight: 700 }}>Uploaded</div>
                        {words ? <div className="sa-dim">{words.toLocaleString('en-GB')} words · about {minutes} min</div> : null}
                        <div><button type="button" className="sa-btn sa-btn-s" disabled={!id} onClick={pick}>Replace file</button></div>
                      </>
                    ) : (
                      <>
                        <div className="sa-amber" style={{ fontWeight: 700 }}>No EPUB yet</div>
                        <div className="sa-dim">Drop the file here, or</div>
                        <div><button type="button" className="sa-btn sa-btn-p" disabled={!id} onClick={pick}>Choose file</button></div>
                      </>
                    )}
                  </>
                )}
              </DropZone>
              <DropZone accept="image/*" disabled={!id || coverUp !== null} onFile={onCover} className={rec?.detail?.coverUrl ? 'sa-filled' : ''}>
                {(pick) => (
                  <>
                    <span className="sa-label" style={{ margin: 0 }}>Cover</span>
                    {coverUp !== null ? <div>Uploading… {coverUp}%</div> : rec?.detail?.coverUrl ? (
                      <div className="sa-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                        <span className="sa-tile-img" style={{ backgroundImage: `url(${rec.detail.coverUrl})` }} />
                        <div className="sa-stack" style={{ gap: 10 }}>
                          <div className="sa-ok" style={{ fontWeight: 700 }}>Added</div>
                          <div><button type="button" className="sa-btn sa-btn-s" onClick={pick}>Replace image</button></div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="sa-amber" style={{ fontWeight: 700 }}>No cover yet</div>
                        <div className="sa-dim">Drop the artwork here, or</div>
                        <div><button type="button" className="sa-btn sa-btn-p" disabled={!id} onClick={pick}>Choose image</button></div>
                      </>
                    )}
                  </>
                )}
              </DropZone>
            </div>
            <Msg m={fileMsg} />
          </section>

          {/* c. Sponsor */}
          <section className="sa-card sa-stack">
            <h2 className="sa-h2">Sponsor <span className="sa-dim" style={{ fontSize: 18, fontWeight: 400 }}>(optional)</span></h2>
            <div className="sa-field">
              <label className="sa-label" htmlFor="ie-sponsor">Name</label>
              <input id="ie-sponsor" className="sa-input" value={form.sponsorName} onChange={(e) => change({ sponsorName: e.target.value })} />
            </div>
            <DropZone accept="image/*" disabled={!id || !form.sponsorName.trim() || logoUp !== null} onFile={onLogo} className={rec?.detail?.sponsorLogoUrl ? 'sa-filled' : ''}>
              {(pick) => (
                <>
                  <span className="sa-label" style={{ margin: 0 }}>Logo</span>
                  {logoUp !== null ? <div>Uploading… {logoUp}%</div> : (
                    <div className="sa-row" style={{ flexWrap: 'nowrap' }}>
                      {rec?.detail?.sponsorLogoUrl && <span className="sa-logo-img" style={{ backgroundImage: `url(${rec.detail.sponsorLogoUrl})` }} />}
                      <div className="sa-stack" style={{ gap: 8 }}>
                        {!form.sponsorName.trim() && <div className="sa-dim sa-small">Type the sponsor’s name first. A logo needs a name.</div>}
                        <div><button type="button" className="sa-btn sa-btn-s" disabled={!id || !form.sponsorName.trim()} onClick={pick}>{rec?.detail?.sponsorLogoUrl ? 'Replace logo' : 'Choose logo'}</button></div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </DropZone>
            <Msg m={sponsorMsg} />
          </section>

          {/* d. Who can read it */}
          <section className="sa-card sa-stack">
            <h2 className="sa-h2">Who can read it</h2>
            <div className="sa-choices sa-choices-3" role="radiogroup" aria-label="Who can read it">
              {[['platinum', 'Platinum only', 'Platinum members'], ['gold', 'Gold and Platinum', 'Gold members can read this one too'], ['free', 'Free to read', 'Anyone signed in can read this one']].map(([v, t, sub]) => (
                <button key={v} type="button" role="radio" aria-checked={form.tier === v} className="sa-choice"
                  onClick={() => change({ tier: v }, { now: true })}>
                  <span className={`sa-choice-t sa-who-${v === 'platinum' ? 'plat' : v}`}>{t}</span>
                  <span className="sa-dim sa-small">{sub}</span>
                  {form.tier === v && <span className="sa-tick"><Tick size={20} /></span>}
                </button>
              ))}
            </div>
            {/* W40 — passes are about paid levels; "Free to read" needs none. */}
            {form.tier !== 'free' && <div className="sa-small sa-dim">Day and week passes never count, whichever you choose.</div>}
            {state === 'live' && rec?.row && (() => {
              const change = levelChangeLine(levelOf(rec.row), form.tier);
              return change && <div className={`sa-small ${change.loses ? 'sa-amber' : 'sa-dim'}`}>{change.text}</div>;
            })()}
          </section>

          {/* e. When it goes live — not for a live or taken-down instalment, which has gone live already */}
          {(state === 'draft' || state === 'scheduled') && (
            <section className="sa-card sa-stack" id="sa-when">
              <h2 className="sa-h2">When it goes live</h2>
              <div className="sa-choices" role="radiogroup" aria-label="When it goes live">
                {[['publish', 'As soon as I publish'], ['date', 'On a date']].map(([v, t]) => (
                  <button key={v} type="button" role="radio" aria-checked={form.when === v} className="sa-choice"
                    onClick={() => {
                      const patch = { when: v };
                      if (v === 'date' && !form.date) {
                        // A starting point the editor will change: tomorrow at 08:00 London.
                        const [d] = londonFields(Date.now() + 86400000);
                        Object.assign(patch, { date: d, time: '08:00' });
                      }
                      change(patch, { now: true });
                    }}>
                    <span className="sa-choice-t">{t}</span>
                    {form.when === v && <span className="sa-tick"><Tick size={20} /></span>}
                  </button>
                ))}
              </div>
              {form.when === 'date' && (
                <div className="sa-stack" style={{ gap: 12 }}>
                  <div className="sa-row" style={{ alignItems: 'flex-end' }}>
                    <div className="sa-field" style={{ flex: '1 1 200px' }}>
                      <label className="sa-label" htmlFor="ie-date">Date</label>
                      <input id="ie-date" type="date" className="sa-input" value={form.date} onChange={(e) => change({ date: e.target.value })} />
                    </div>
                    <div className="sa-field" style={{ flex: '1 1 140px' }}>
                      <label className="sa-label" htmlFor="ie-time">Time</label>
                      <input id="ie-time" type="time" className="sa-input" value={form.time} onChange={(e) => change({ time: e.target.value })} />
                    </div>
                  </div>
                  <div className="sa-small sa-dim">London time</div>
                  {Number.isFinite(whenMs) && (whenMs > now
                    ? <div>{goesLiveLine(whenMs, now)}</div>
                    : <div className="sa-amber">That time has passed. Choose a later one.</div>)}
                </div>
              )}
              {form.when === 'publish' && (
                <div className="sa-dim">{state === 'scheduled' ? 'It goes live the moment you save.' : 'It goes live the moment you press Publish.'}</div>
              )}
            </section>
          )}

          {!autosaves && rec?.row && (dirty || manualMsg) && (
            <div className="sa-savebar">
              {manualMsg && <div style={{ flex: '1 1 200px', alignSelf: 'center' }}><Msg m={manualMsg} /></div>}
              {dirty && (
                <>
                  <button type="button" className="sa-btn sa-btn-s" disabled={save === 'saving'} onClick={() => { setForm(formFrom(rec)); setManualMsg(null); }}>Discard</button>
                  <button type="button" className="sa-btn sa-btn-p" disabled={save === 'saving'} onClick={saveChanges}>{save === 'saving' ? 'Saving…' : 'Save changes'}</button>
                </>
              )}
            </div>
          )}
        </div>

        <aside className="sa-panel">
          <Panel entry={entry} rec={rec} state={state} needs={needs} ordinal={ordinal} user={user} go={go} flush={flush}
            refresh={refresh} reload={reload} onPreview={() => setPreviewing(true)} />
        </aside>
      </div>

      {picking && (
        <WriterPicker current={form.writer} onClose={() => setPicking(false)}
          onUse={(w) => { setPicking(false); change({ writer: w }, { now: true }); }} />
      )}
      {previewing && <Preview entry={entry} virtual={virtual} ordinal={ordinal} needs={needs} onClose={() => setPreviewing(false)} />}
    </>
  );
}

// ── THE PANEL ─────────────────────────────────────────────────────────────────────────────
function Check({ item, needed }) {
  const cls = item.done ? 'sa-dot-done' : needed ? 'sa-dot-need' : 'sa-dot-opt';
  return (
    <div className="sa-check">
      <span className={`sa-dot ${cls}`}>{item.done && <Tick size={13} />}</span>
      <span>
        <span style={{ display: 'block', fontWeight: 600 }}>{item.label}</span>
        <span className={`sa-small ${!item.done && needed ? 'sa-amber' : 'sa-dim'}`}>{item.detail}</span>
      </span>
    </div>
  );
}

const STEP = { done: 'done', spin: 'spin', wait: 'wait' };
function Step({ s, children }) {
  return (
    <div className="sa-row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
      <span style={{ flex: '0 0 22px', height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 3 }}>
        {s === STEP.done ? <span className="sa-dot sa-dot-done" style={{ marginTop: 0 }}><Tick size={13} /></span>
          : s === STEP.spin ? <span className="sa-spin" aria-label="working" />
            : <span className="sa-dot sa-dot-opt" style={{ marginTop: 0 }} />}
      </span>
      <span className={s === STEP.wait ? 'sa-dim' : ''}>{children}</span>
    </div>
  );
}

function Panel({ entry, rec, state, needs, ordinal, user, go, flush, refresh, reload, onPreview }) {
  const id = rec?.row?.id;
  // flow: null | { kind: 'publish'|'rebuild', scheduled, seriesWentLive, ms, steps, result }
  const [flow, setFlow] = useState(null);
  const [msg, setMsg] = useState(null);
  const [check, setCheck] = useState(() => (id && (state === 'live' || state === 'scheduled') ? 'checking' : null)); // null | 'checking' | 'ok' | 'missing'
  const [confirmDown, setConfirmDown] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set on unmount, and CLEARED on mount: React runs a dev mount twice (StrictMode), and a guard
  // that is only ever set stays set after the first pretend unmount — the W38 suite caught the
  // publish flow stopping dead at "Building its page" because of exactly that.
  const cancelled = useRef(false);
  useEffect(() => { cancelled.current = false; return () => { cancelled.current = true; }; }, []);

  // Reopening a published instalment re-checks its page once and shows the result.
  useEffect(() => {
    if (!id || (state !== 'live' && state !== 'scheduled') || flow) return;
    let gone = false;
    pageAnswers(instalmentPagePath(id)).then((ok) => { if (!gone) setCheck(ok ? 'ok' : 'missing'); });
    return () => { gone = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const getIdToken = () => user?.getIdToken();

  const buildAndCheck = async (base) => {
    setFlow({ ...base, build: STEP.spin, check: STEP.wait });
    const verdict = await requestRebuild({ hook: HOOKS.SERIES, getIdToken });
    if (!verdict.ok) { setFlow({ ...base, result: 'failed', detail: verdict.message }); return; }
    const paths = [instalmentPagePath(id), ...(base.seriesWentLive ? [seriesPagePath(entry.slug || entry.id)] : [])];
    const r = await waitForPages(paths, { isCancelled: () => cancelled.current });
    if (cancelled.current) return;
    if (!r.ok) { setFlow({ ...base, result: 'failed' }); return; }
    setFlow({ ...base, build: STEP.done, check: STEP.done });
    setCheck('ok');
    setFlow({ ...base, result: base.scheduled ? 'scheduled' : 'live' });
  };

  const publish = async ({ republish = false } = {}) => {
    setMsg(null);
    const scheduled = !republish && needs.mode === 'date';
    const base = { scheduled, seriesWentLive: needs.seriesGoesLive && !republish, ms: needs.releaseMs, saved: STEP.spin };
    setFlow({ ...base, build: STEP.wait, check: STEP.wait });
    // Whatever was typed last is saved before the publish reads the record.
    if (!(await flush())) { setFlow(null); setMsg({ ok: false, text: 'The last change didn’t save, so nothing was published. Try again.' }); return; }
    const r = await publishInstalment(id, { republish });
    if (!r.ok) { setFlow(null); setMsg({ ok: false, text: errText(r) }); return; }
    const fresh = await refresh();
    reload();
    const isScheduled = instalmentState(fresh.row, Date.now()) === 'scheduled';
    const next = { ...base, scheduled: isScheduled, seriesWentLive: r.seriesWentLive, ms: fresh.row.releaseAtMs, saved: STEP.done };
    await buildAndCheck(next);
  };

  const takeDown = async () => {
    setBusy(true); setMsg(null);
    const r = await takeDownInstalment(id);
    if (!r.ok) { setBusy(false); setMsg({ ok: false, text: errText(r) }); return; }
    const verdict = await requestRebuild({ hook: HOOKS.SERIES, getIdToken });
    await refresh(); reload();
    setBusy(false); setConfirmDown(false); setFlow(null);
    setMsg(verdict.ok ? { ok: true, text: 'Taken down. The site rebuilds without its page, in about two minutes.' } : { ok: false, text: verdict.message });
  };

  // ── 4. AFTER PRESSING PUBLISH ──
  if (flow && !flow.result) {
    return (
      <section className="sa-card sa-stack">
        <h2 className="sa-h2">Publishing instalment {ordinal}</h2>
        <div className="sa-steps">
          <Step s={flow.saved}>{flow.scheduled ? 'Saved as scheduled' : 'Published'}</Step>
          {flow.seriesWentLive && <Step s={flow.saved}>The series is live too. It was still a draft.</Step>}
          <Step s={flow.build}>Building its page, about two minutes</Step>
          <Step s={flow.check}>{flow.scheduled && flow.ms ? `Ready for ${londonLongDateTime(flow.ms)}` : 'Checking the page opens'}</Step>
        </div>
        <div className="sa-small sa-dim">You can leave this page. The site carries on building.</div>
      </section>
    );
  }
  if (flow?.result === 'live' || (!flow && state === 'live' && check !== 'missing' && rec)) {
    if (flow?.result === 'live') {
      return (
        <section className="sa-card sa-stack">
          <div><Chip state="live" /></div>
          <h2 className="sa-h2">Instalment {ordinal} is live on the site.</h2>
          <div className="sa-dim">Its page opens. Checked just now.</div>
          <a className="sa-btn sa-btn-p sa-btn-wide" href={instalmentPagePath(id)} target="_blank" rel="noreferrer">View on site</a>
          <button type="button" className="sa-btn sa-btn-s sa-btn-wide" onClick={() => go({ s: entry.id })}>Back to the series</button>
        </section>
      );
    }
    // ── 7. A LIVE INSTALMENT'S PANEL ──
    return (
      <section className="sa-card sa-stack">
        <div><Chip state="live" /></div>
        <div>Live since {londonLongDateTime(rec.row.releaseAtMs)}</div>
        <div className="sa-dim">{audienceLine(rec.row)}</div>
        <div className="sa-dim">Edits you save show on the site straight away.</div>
        {check === 'ok' && <div className="sa-small sa-dim">Its page opens. Checked just now.</div>}
        {check === 'checking' && <div className="sa-small sa-dim">Checking its page…</div>}
        <a className="sa-btn sa-btn-s sa-btn-wide" href={instalmentPagePath(id)} target="_blank" rel="noreferrer">View on site</a>
        {!confirmDown
          ? <button type="button" className="sa-btn sa-btn-redline sa-btn-wide" onClick={() => setConfirmDown(true)}>Take it down…</button>
          : <TakeDownConfirm ordinal={ordinal} busy={busy} onYes={takeDown} onNo={() => setConfirmDown(false)} keepLabel="Keep it live" />}
        <Msg m={msg} />
      </section>
    );
  }
  if (flow?.result === 'scheduled' || (!flow && state === 'scheduled' && check !== 'missing' && rec)) {
    const ms = flow?.ms || rec.row.releaseAtMs;
    return (
      <section className="sa-card sa-stack">
        <div><Chip state="scheduled" /></div>
        <h2 className="sa-h2">Instalment {ordinal} goes live on {londonLongDate(ms)} at {londonClock(ms)} London time.</h2>
        {(flow?.result === 'scheduled' || check === 'ok') && <div className="sa-dim">Its page is built and waiting. Nothing else to do.</div>}
        {check === 'checking' && !flow && <div className="sa-small sa-dim">Checking its page…</div>}
        <button type="button" className="sa-btn sa-btn-p sa-btn-wide" onClick={() => go({ s: entry.id })}>Back to the series</button>
        <button type="button" className="sa-btn sa-btn-s sa-btn-wide"
          onClick={() => { setFlow(null); document.getElementById('sa-when')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Change the time</button>
        {!confirmDown
          ? <button type="button" className="sa-btn sa-btn-redline sa-btn-wide" onClick={() => setConfirmDown(true)}>Take it down…</button>
          : <TakeDownConfirm ordinal={ordinal} busy={busy} onYes={takeDown} onNo={() => setConfirmDown(false)} keepLabel="Keep it scheduled" />}
        <Msg m={msg} />
      </section>
    );
  }
  if (flow?.result === 'failed' || (!flow && (state === 'live' || state === 'scheduled') && check === 'missing')) {
    return (
      <section className="sa-card sa-stack sa-warn">
        <h2 className="sa-h2">Not on the site yet</h2>
        <div>Instalment {ordinal} is saved and published, but the site didn’t rebuild, so its page isn’t there yet.</div>
        <div className="sa-dim">Nothing is lost.</div>
        {flow?.detail && <div className="sa-small sa-dim">{flow.detail}</div>}
        <button type="button" className="sa-btn sa-btn-p sa-btn-wide"
          onClick={() => buildAndCheck({ scheduled: state === 'scheduled', seriesWentLive: flow?.seriesWentLive, ms: rec.row.releaseAtMs, saved: STEP.done })}>
          Rebuild the site
        </button>
        <div className="sa-small sa-dim">If it fails again, the build needs looking at.</div>
      </section>
    );
  }

  // ── TAKEN DOWN ──
  if (state === 'taken-down') {
    return (
      <section className="sa-card sa-stack">
        <div><Chip state="taken-down" /></div>
        <h2 className="sa-h2">Off the site</h2>
        <div>Instalment {ordinal} is off the site. Nothing is deleted.</div>
        <div className="sa-dim">Publish it again whenever you’re ready.</div>
        <button type="button" className="sa-btn sa-btn-p sa-btn-wide" onClick={() => publish({ republish: true })}>Publish it again</button>
        <DeleteBlock open={confirmDelete} setOpen={setConfirmDelete} rec={rec} ordinal={ordinal} entry={entry} go={go} reload={reload} />
        <Msg m={msg} />
      </section>
    );
  }

  // ── THE DRAFT: "BEFORE IT GOES LIVE" ──
  const ready = needs.left === 0 && !!id;
  return (
    <section className="sa-card sa-stack">
      <h2 className="sa-h2">Before it goes live</h2>
      <div>
        <span className="sa-label">Needed</span>
        {needs.needed.map((n) => <Check key={n.key} item={n} needed />)}
      </div>
      <div>
        <span className="sa-label">Optional</span>
        {needs.optional.map((n) => <Check key={n.key} item={n} />)}
      </div>
      <button type="button" className="sa-btn sa-btn-p sa-btn-wide" disabled={!ready} onClick={() => publish()}>
        {publishButtonLabel(needs)}
      </button>
      {ready && (
        <div>
          <span className="sa-label">Pressing it</span>
          {pressingIt(needs, ordinal).map((l) => <div key={l} className="sa-small sa-dim">{l}</div>)}
        </div>
      )}
      <Msg m={msg} />
      <button type="button" className="sa-btn sa-btn-s sa-btn-wide" disabled={!id} onClick={onPreview}>Preview the page</button>
      {id && <DeleteBlock open={confirmDelete} setOpen={setConfirmDelete} rec={rec} ordinal={ordinal} entry={entry} go={go} reload={reload} />}
    </section>
  );
}

function TakeDownConfirm({ ordinal, busy, onYes, onNo, keepLabel }) {
  return (
    <div className="sa-stack" style={{ gap: 12, border: '1px solid rgba(248,113,113,.45)', borderRadius: 10, padding: 16, background: 'rgba(248,113,113,.06)' }}>
      <div style={{ fontWeight: 700, color: '#f87171', fontSize: 20 }}>Take instalment {ordinal} down?</div>
      <ul className="sa-small" style={{ margin: 0, paddingLeft: 20 }}>
        <li>Readers lose it straight away, until you publish it again.</li>
        <li>Their saved place is kept.</li>
        <li>The site rebuilds without its page, in about two minutes.</li>
      </ul>
      <button type="button" className="sa-btn sa-btn-red sa-btn-wide" disabled={busy} onClick={onYes}>{busy ? 'Taking it down…' : 'Take it down'}</button>
      <button type="button" className="sa-btn sa-btn-s sa-btn-wide" disabled={busy} onClick={onNo}>{keepLabel}</button>
    </div>
  );
}

/**
 * Delete — the R31 typed confirmation and its three consequences, kept as they were. Offered only
 * for a draft or a taken-down instalment; a live one is taken down first. Neither has a page on
 * the site, so a delete asks for no rebuild.
 */
function DeleteBlock({ open, setOpen, rec, ordinal, entry, go, reload }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const armed = typed.trim() === String(ordinal);
  if (!open) return <div><button type="button" className="sa-textbtn sa-textbtn-red" onClick={() => setOpen(true)}>Delete instalment…</button></div>;
  return (
    <div className="sa-stack" style={{ gap: 12, border: '1px solid rgba(248,113,113,.45)', borderRadius: 10, padding: 16, background: 'rgba(248,113,113,.06)' }}>
      <div style={{ fontWeight: 700, color: '#f87171', fontSize: 20 }}>Delete instalment {ordinal}{rec?.detail?.title ? ` — ${rec.detail.title}` : ''}?</div>
      <ul className="sa-small" style={{ margin: 0, paddingLeft: 20 }}>
        <li>The record, the EPUB and any cover or sponsor logo are removed. The EPUB cannot be downloaded first, so there is nothing to restore it from.</li>
        <li>Instalment number {ordinal} is retired for good. The instalments after it keep their own numbers, and no new instalment can ever take this one’s place.</li>
        <li>Anyone who was reading it keeps their saved place. It is harmless: the number can never be reissued to a different story.</li>
      </ul>
      <div className="sa-field">
        <label className="sa-label" htmlFor="ie-del">Type the number ({ordinal}) to confirm</label>
        <input id="ie-del" className="sa-input" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={String(ordinal)} />
      </div>
      <button type="button" className="sa-btn sa-btn-red sa-btn-wide" disabled={!armed || busy}
        onClick={async () => {
          setBusy(true);
          const r = await deleteInstalment(rec.row.id);
          setBusy(false);
          if (!r.ok) { setMsg({ ok: false, text: errText(r) }); return; }
          await reload();
          go({ s: entry.id }, {
            replace: true,
            flash: { ok: true, text: `Instalment ${ordinal} deleted. Its number is retired and cannot be reused.${r.warnings?.length ? ` ${r.warnings.join(' ')}` : ''}` },
          });
        }}>
        {busy ? 'Deleting…' : `Delete instalment ${ordinal}`}
      </button>
      <button type="button" className="sa-btn sa-btn-s sa-btn-wide" disabled={busy} onClick={() => { setOpen(false); setTyped(''); }}>Cancel</button>
      <Msg m={msg} />
    </div>
  );
}

/**
 * The page as a Platinum reader will see it once released: the instalment page's own components
 * (InstalmentBody), the admin-readable detail, and the read button such a reader is shown. No
 * public URL — it is drawn here, from the form as it stands. The site's top bar is not part of it.
 */
function Preview({ entry, virtual, ordinal, needs, onClose }) {
  const now = useNow();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const shownAt = needs.mode === 'date' ? needs.releaseMs : now;
  const row = { ...virtual.row, ordinal, releaseAtMs: shownAt === PROVISIONAL_RELEASE_MS ? now : shownAt };
  return (
    <div className="sa-preview" role="dialog" aria-modal="true" aria-label="Preview">
      <div className="sa-preview-bar">
        <span className="sa-small sa-dim">Preview · as a Platinum reader sees it once it is released</span>
        <button type="button" className="sa-btn sa-btn-s" onClick={onClose}>Close preview</button>
      </div>
      <div style={{ maxWidth: 760, margin: '0 auto', fontFamily: "'Cormorant Garamond', Georgia, serif" }}>
        <InstalmentBody row={row} series={entry} detail={virtual.detail} now={Math.max(now, row.releaseAtMs) + 1}
          action={<div style={{ padding: '1.75rem 6% 0' }}><ReadAction ordinal={ordinal} onClick={() => {}} /></div>} />
      </div>
    </div>
  );
}
