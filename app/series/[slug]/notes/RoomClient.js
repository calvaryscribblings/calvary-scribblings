'use client';
// READERS' NOTES — THE ROOM (W46, §4). /series/{slug}/notes?i={inst}[&q=side|line][&n={noteId}]
//
// FOUR STATES, decided from the reader's OWN nodes before anything gated is asked for:
//   sealed   signed out, or not finished: "You're partway through {N}." and the progress rule,
//            Continue reading, Sit with this shown, the other two under wax seals with counts.
//            Every number comes from series_notes_summary (public). NO gated path is read —
//            not even attempted: the firewall harness counts refused reads.
//   joining  finished, not a member: the three questions and the "Or tell us…" card. Any
//            answer (a side, or a note) makes the reader a member through the endpoint.
//   open     finished and a member: the questions, the notes, filters, sort, replies.
//   ?q=      a question's own view (side: the split and "Why they chose"; line: ranked lines).
//
// Rendered nothing while notesEnabled() is false.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/AuthContext';
import { db } from '../../../lib/firebase';
import { useReliableLoad } from '../../../lib/useReliable';
import Unavailable from '../../../components/Unavailable';
import AuthModal from '../../../components/AuthModal';
import { isFounder } from '../../../lib/founders';
import { resolveIdentities } from '../../../lib/squareIdentity';
import {
  NOTES_COPY, QUESTION_LABEL, PAGE_SIZE, instName, romanOf, roomHref, lineHref, sideOptions, rankLines,
  lastVisitKey, notesEnabled, NOTES_ERRORS,
} from '../../../lib/series/notes';
import {
  notesAction, readFinished, readMember, readQuestions, readNotes, readReplies, readUnderlines, readTallies,
  readMySide, readMyHeld, setUnderline, reportNote, writeLocal,
} from '../../../lib/series/notesClient';
import { loadPublic, readProgress, readFinishedAll } from '../../../components/seriesNotes/roomData';
import {
  pickInstalment, releasedRows, roomPhase, listOf, underlineCounts, kindCounts, visibleNotes, noteHeading,
  arrivals, mergeLocal, POLL_MS, sealedCounts, seriesTotals,
} from '../../../components/seriesNotes/roomModel';
import { C, DISPLAY, LABEL, NOTES_CSS, labelStyle, questionStyle } from '../../../components/seriesNotes/tokens';
import { ArrowIcon, BackIcon, LockIcon, ProgressRule, QuoteMark } from '../../../components/seriesNotes/Parts';
import NoteCard, { NoteSkeleton } from '../../../components/seriesNotes/NoteCard';
import { SealedCard, SitCard, SideCard, LineCard, ElseCard } from '../../../components/seriesNotes/QuestionCard';
import SideBars from '../../../components/seriesNotes/Bars';
import Composer, { postNote } from '../../../components/seriesNotes/Composer';

const ROOM_CSS = `
.sn-room { background: ${C.ground}; min-height: 100vh; color: ${C.cream}; font-family: ${DISPLAY}; overflow-x: clip; }
.sn-wrap { max-width: 1180px; margin: 0 auto; padding: 0 16px; box-sizing: border-box; }
.sn-cols { display: block; }
.sn-rail { display: none; }
.sn-qrow { display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 4px; scrollbar-width: none; }
.sn-qrow::-webkit-scrollbar { display: none; }
.sn-qrow > * { flex: 0 0 86%; scroll-snap-align: center; min-width: 0; }
.sn-dots { display: flex; justify-content: center; gap: 0; }
.sn-strip { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0; scrollbar-width: none; }
.sn-strip::-webkit-scrollbar { display: none; }
.sn-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.sn-chip { min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); background: transparent; color: ${C.muted}; font-family: ${DISPLAY}; font-size: 16px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.sn-chip[aria-pressed="true"], .sn-chip[aria-selected="true"] { border-color: rgba(201,168,76,0.6); color: ${C.cream}; background: rgba(201,168,76,0.10); }
.sn-chip:focus-visible { outline: 2px solid ${C.link}; outline-offset: 2px; }
.sn-list { display: grid; gap: 14px; }
.sn-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 900; padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px)); background: rgba(8,6,16,0.94); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-top: 1px solid rgba(255,255,255,0.08); }
.sn-bar-btn { all: unset; box-sizing: border-box; display: flex; align-items: center; width: 100%; max-width: 760px; margin: 0 auto; min-height: 48px; padding: 0 18px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.04); color: ${C.quiet}; font-family: ${DISPLAY}; font-size: 18px; font-style: italic; cursor: text; }
.sn-bar-btn:focus-visible { outline: 2px solid ${C.link}; outline-offset: 2px; }
.sn-pill { position: sticky; top: 76px; z-index: 30; display: flex; justify-content: center; pointer-events: none; height: 0; overflow: visible; }
.sn-pill > button { pointer-events: auto; transform: translateY(-50%); }
@media (min-width: 760px) {
  .sn-qrow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: visible; }
  .sn-qrow > * { flex: none; }
  .sn-dots { display: none; }
}
@media (min-width: 1024px) {
  .sn-cols { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 32px; align-items: start; }
  .sn-rail { display: block; position: sticky; top: 84px; }
  .sn-strip-wrap { display: none; }
  .sn-bar { display: none; }
}
`;

const Bar = ({ children }) => <div className="sn-bar">{children}</div>;

function Nav({ series, slug }) {
  return (
    <nav style={{ position: 'sticky', top: 0, zIndex: 100, height: 64, display: 'flex', alignItems: 'center', background: 'rgba(8,6,16,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="sn-wrap" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <Link href={`/series/${slug}`} className="sn-text" style={{ color: C.cream, paddingLeft: 0 }}>
          <BackIcon />
          <span style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600 }}>{series?.title || ''}</span>
        </Link>
      </div>
    </nav>
  );
}

function Hero({ series, totals }) {
  const cover = series.coverUrl;
  return (
    <header style={{ position: 'relative', overflow: 'hidden', background: `linear-gradient(180deg, ${C.headerTop} 0%, ${C.ground} 100%)`, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      {cover && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: -40, backgroundImage: `url(${JSON.stringify(cover)})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(42px) saturate(1.2)', opacity: 0.38 }} />
      )}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(8,6,16,0.2) 0%, rgba(8,6,16,0.92) 100%)' }} />
      <div className="sn-wrap" style={{ position: 'relative', display: 'flex', gap: 16, alignItems: 'flex-end', padding: '28px 16px 22px' }}>
        <div role="presentation" style={{ width: 84, flexShrink: 0, aspectRatio: '2 / 3', borderRadius: 8, border: '1px solid rgba(255,255,255,0.14)', background: cover ? `center/cover no-repeat url(${JSON.stringify(cover)})` : 'linear-gradient(160deg, #1a0f2e, #0d0a18)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} />
        <div style={{ minWidth: 0 }}>
          <span style={{ ...labelStyle(C.goldTint, 10), display: 'block', marginBottom: 6 }}>{NOTES_COPY.kicker}</span>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 'clamp(1.7rem, 6vw, 2.5rem)', lineHeight: 1.08, margin: '0 0 4px', color: C.cream }}>{series.title}</h1>
          {series.author && <p style={{ fontFamily: DISPLAY, fontSize: 17, color: C.muted, margin: '0 0 4px' }}>{series.author}</p>}
          <p data-hero-counts style={{ fontFamily: DISPLAY, fontSize: 16, color: C.quiet, margin: 0 }}>{NOTES_COPY.heroCounts(totals.notes, totals.readers)}</p>
        </div>
      </div>
    </header>
  );
}

/** The instalment strip: released only, roman numerals, a count on each; a sealed one is locked. */
function Strip({ slug, rows, current, summary, finished }) {
  return (
    <div className="sn-strip-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="sn-wrap">
        <nav aria-label="Instalments" className="sn-strip">
          {rows.map((r) => {
            const sealed = !finished[r.id];
            const count = Number(summary?.byInst?.[r.id]?.notes) || 0;
            const on = r.id === current;
            return (
              <Link key={r.id} href={roomHref(slug, r.id)} aria-current={on ? 'page' : undefined} data-strip={r.id} data-sealed={sealed ? 'true' : 'false'}
                className="sn-chip" style={on ? { borderColor: 'rgba(201,168,76,0.6)', color: C.cream, background: 'rgba(201,168,76,0.10)', textDecoration: 'none', flexShrink: 0 } : { textDecoration: 'none', flexShrink: 0 }}>
                <span style={{ fontFamily: LABEL, fontSize: 13, letterSpacing: '0.06em' }}>{romanOf(r.ordinal)}</span>
                {sealed
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, color: C.quiet }}><LockIcon />{NOTES_COPY.sealed}</span>
                  : <span style={{ fontFamily: LABEL, fontSize: 12, color: C.quiet }}>{count}</span>}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function Rail({ series, slug, rows, current, summary, finished, titles, onLeave }) {
  return (
    <aside className="sn-rail" aria-label={series.title}>
      <div role="presentation" style={{ width: 120, aspectRatio: '2 / 3', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: series.coverUrl ? `center/cover no-repeat url(${JSON.stringify(series.coverUrl)})` : '#1a0f2e', marginBottom: 12 }} />
      <p style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 600, margin: '0 0 12px' }}>{series.title}</p>
      <ul style={{ listStyle: 'none', margin: '0 0 16px', padding: 0, display: 'grid', gap: 2 }}>
        {rows.map((r) => {
          const sealed = !finished[r.id];
          const on = r.id === current;
          return (
            <li key={r.id}>
              <Link href={roomHref(slug, r.id)} aria-current={on ? 'page' : undefined} className="sn-text"
                style={{ width: '100%', justifyContent: 'space-between', boxSizing: 'border-box', borderRadius: 10, padding: '6px 10px', background: on ? 'rgba(201,168,76,0.10)' : 'transparent', color: on ? C.cream : C.muted }}>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                  <span style={{ fontFamily: LABEL, fontSize: 12, color: C.goldTint }}>{romanOf(r.ordinal)}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titles[r.id] || instName(r.ordinal)}</span>
                </span>
                {sealed
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14 }}><LockIcon />{NOTES_COPY.sealed}</span>
                  : <span style={{ fontFamily: LABEL, fontSize: 12 }}>{Number(summary?.byInst?.[r.id]?.notes) || 0}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
      {onLeave && <button type="button" className="sn-btn sn-primary" style={{ width: '100%' }} onClick={onLeave}>{NOTES_COPY.leaveNote}</button>}
    </aside>
  );
}

/** Swipeable on phones with page dots; three across on wide screens. */
function QuestionRow({ children, labels }) {
  const row = useRef(null);
  const [active, setActive] = useState(0);
  const onScroll = () => {
    const el = row.current;
    if (!el) return;
    const kids = [...el.children];
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    kids.forEach((k, i) => { if (Math.abs(k.offsetLeft + k.offsetWidth / 2 - mid) < Math.abs(kids[best].offsetLeft + kids[best].offsetWidth / 2 - mid)) best = i; });
    setActive(best);
  };
  const go = (i) => {
    const k = row.current?.children?.[i];
    if (k) row.current.scrollTo({ left: k.offsetLeft - (row.current.clientWidth - k.offsetWidth) / 2, behavior: 'smooth' });
  };
  return (
    <div>
      <div ref={row} className="sn-qrow" onScroll={onScroll} data-question-row>{children}</div>
      <div className="sn-dots" role="group" aria-label={NOTES_COPY.kicker}>
        {labels.map((l, i) => (
          <button key={l} type="button" aria-label={l} aria-current={i === active ? 'true' : undefined} onClick={() => go(i)}
            style={{ width: 44, height: 44, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <span aria-hidden="true" style={{ width: i === active ? 18 : 7, height: 7, borderRadius: 999, background: i === active ? C.gold : 'rgba(245,240,232,0.3)' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

export default function RoomClient({ slug, sentinel }) {
  const enabled = notesEnabled();
  const params = useSearchParams();
  const wanted = params.get('i');
  const view = params.get('q');
  const focusId = params.get('n');
  const { user, loading: authLoading } = useAuth() || {};
  const uid = user?.uid || null;

  const pub = useReliableLoad(
    () => (!enabled || slug === sentinel ? null : loadPublic(slug)),
    [slug, sentinel, enabled],
  );
  const series = pub.data?.series || null;
  const rows = useMemo(() => pub.data?.rows || [], [pub.data]);
  const summary = pub.data?.summary || null;
  const inst = useMemo(() => pickInstalment(rows, wanted, summary), [rows, wanted, summary]);
  const instId = inst?.id || null;
  const released = useMemo(() => releasedRows(rows), [rows]);
  const N = inst ? instName(inst.ordinal) : '';

  // ── the reader's own state, then (only if allowed) the gated data ──────────────────────────
  const [priv, setPriv] = useState({ phase: 'pending' });
  const [finishedAll, setFinishedAll] = useState({});
  const [loadTick, setLoadTick] = useState(0);
  const reload = useCallback(() => setLoadTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled || authLoading || !instId) return undefined;
    let live = true;
    (async () => {
      if (!uid) { if (live) { setPriv({ phase: 'sealed', signedOut: true }); setFinishedAll({}); } return; }
      const [finished, all] = await Promise.all([readFinished(uid, instId), readFinishedAll(uid)]);
      if (!live) return;
      setFinishedAll(all || {});
      if (!finished) {
        const progress = await readProgress(uid, instId);
        if (live) setPriv({ phase: 'sealed', progress });
        return;
      }
      const member = await readMember(uid, instId);
      const phase = roomPhase({ user: { uid }, finished, member });
      if (phase === 'joining') {
        const [questions, mySide] = await Promise.all([readQuestions(instId), readMySide(uid, instId)]);
        if (live) setPriv({ phase, questions, mySide });
        return;
      }
      if (live) setPriv((p) => (p.phase === 'open' && p.inst === instId ? { ...p, refreshing: true } : { phase: 'open', inst: instId, loading: true }));
      const [questions, notes, replies, underlines, tallies, mySide, held] = await Promise.all([
        readQuestions(instId), readNotes(instId), readReplies(instId), readUnderlines(instId), readTallies(instId),
        readMySide(uid, instId), readMyHeld(uid, instId),
      ]);
      if (!live) return;
      setPriv({
        phase: 'open', inst: instId, loading: false, questions, mySide, tallies: tallies || {},
        notes: listOf(notes).map((n) => ({ ...n, inst: instId })),
        replies: replies || {}, underlines: underlines || {},
        held: listOf(held).filter((n) => n.kind !== 'reply').map((n) => ({ ...n, inst: instId, status: 'held' })),
        heldReplies: listOf(held).filter((n) => n.kind === 'reply'),
      });
    })();
    return () => { live = false; };
  }, [enabled, authLoading, uid, instId, loadTick]);

  // "{n} new" on the door counts from this visit.
  useEffect(() => {
    if (!enabled || !series?.id) return;
    writeLocal(lastVisitKey(series.id), Date.now());
  }, [enabled, series?.id, instId]);

  // ── local, optimistic state ────────────────────────────────────────────────────────────────
  const [local, setLocal] = useState([]);          // the reader's unsent / just-sent notes
  const [localReplies, setLocalReplies] = useState({}); // noteId -> [reply]
  const [incoming, setIncoming] = useState([]);   // arrived mid-read, behind the pill
  const [reported, setReported] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('underlined');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [composer, setComposer] = useState(null); // null | { kind }
  const [showAuth, setShowAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [identities, setIdentities] = useState(() => new Map());
  const [freshSide, setFreshSide] = useState(false);

  // Reset per instalment.
  useEffect(() => { setLocal([]); setLocalReplies({}); setIncoming([]); setFilter('all'); setLimit(PAGE_SIZE); }, [instId]);

  const open = priv.phase === 'open' && !priv.loading && priv.inst === instId;
  const heldIds = useMemo(() => new Set((priv.held || []).map((h) => h.id)), [priv.held]);
  const allNotes = useMemo(() => (open ? mergeLocal(priv.notes, local, heldIds) : []), [open, priv.notes, local, heldIds]);
  const { counts, mine: myUnderlines } = useMemo(() => underlineCounts(priv.underlines, uid), [priv.underlines, uid]);

  // Identities, the Square's way: live record first, snapshot second.
  useEffect(() => {
    if (!open) return undefined;
    const uids = new Set(allNotes.map((n) => n.uid));
    for (const thread of Object.values(priv.replies || {})) for (const r of Object.values(thread || {})) if (r?.uid) uids.add(r.uid);
    let live = true;
    resolveIdentities(db, [...uids]).then((m) => { if (live) setIdentities(m); });
    return () => { live = false; };
  }, [open, allNotes, priv.replies]);

  // A light poll while visible: new notes wait behind the pill.
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const fresh = listOf(await readNotes(instId)).map((n) => ({ ...n, inst: instId }));
      const shown = new Set(priv.notes.map((n) => n.id));
      local.forEach((l) => l.realId && shown.add(l.realId));
      setIncoming(arrivals(fresh, shown, uid));
    }, POLL_MS);
    return () => clearInterval(t);
  }, [open, instId, priv.notes, local, uid]);

  // A linked note (?n=) is brought into view once.
  const focused = useRef(false);
  useEffect(() => {
    if (!open || !focusId || focused.current) return;
    const el = document.getElementById(`note-${focusId}`);
    if (el) { focused.current = true; el.scrollIntoView({ block: 'center' }); }
  }, [open, focusId, allNotes]);

  // Notes load twenty at a time, on scroll.
  const more = useRef(null);
  useEffect(() => {
    if (!open || !more.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE_SIZE); }, { rootMargin: '400px' });
    io.observe(more.current);
    return () => io.disconnect();
  }, [open, limit, filter]);

  if (!enabled) return null;

  // ── actions ─────────────────────────────────────────────────────────────────────────────────
  const onPosted = (ev) => {
    if (ev.phase === 'pending') {
      setLocal((l) => [{ ...ev.note, id: ev.tempId, inst: instId, local: 'pending' }, ...l.filter((x) => x.id !== ev.tempId)]);
    } else if (ev.phase === 'failed') {
      setLocal((l) => l.map((x) => (x.id === ev.tempId ? { ...x, local: 'failed', retry: ev.retry } : x)));
      setAnnounce(NOTES_COPY.notSent);
    } else if (ev.phase === 'done') {
      const note = { ...ev.note, id: ev.noteId, inst: instId };
      if (ev.status === 'held') {
        setLocal((l) => l.filter((x) => x.id !== ev.tempId));
        setPriv((p) => ({ ...p, held: [{ ...note, status: 'held' }, ...(p.held || [])] }));
        setAnnounce(NOTES_COPY.waitingReview);
      } else {
        // Shown at once, in place of the pending copy, until the next read carries it.
        setLocal((l) => l.map((x) => (x.id === ev.tempId ? { ...note, id: ev.noteId, realId: ev.noteId, local: undefined } : x)));
      }
      if (priv.phase !== 'open') reload(); // the first note makes the reader a member
    }
  };

  const chooseSide = async (option) => {
    setBusy(true);
    try {
      const res = await notesAction(user, { action: 'side', inst: instId, option });
      setFreshSide(true);
      if (priv.phase === 'open') setPriv((p) => ({ ...p, mySide: res.side || option, tallies: res.tally || p.tallies }));
      else reload();
    } catch (e) {
      setAnnounce(e?.message || NOTES_ERRORS.unavailable);
    } finally { setBusy(false); }
  };

  const toggleUnderline = async (note) => {
    const on = !myUnderlines.has(note.id);
    const apply = (yes) => setPriv((p) => {
      const u = { ...(p.underlines || {}) };
      const who = { ...(u[note.id] || {}) };
      if (yes) who[uid] = true; else delete who[uid];
      u[note.id] = who;
      return { ...p, underlines: u };
    });
    apply(on);
    try { await setUnderline(uid, instId, note.id, on); } catch { apply(!on); }
  };

  const removeNote = async (note) => {
    try {
      await notesAction(user, { action: 'remove', inst: instId, noteId: note.id });
      setPriv((p) => ({ ...p, notes: (p.notes || []).filter((n) => n.id !== note.id), held: (p.held || []).filter((n) => n.id !== note.id) }));
      setLocal((l) => l.filter((x) => x.realId !== note.id && x.id !== note.id));
    } catch (e) { setAnnounce(e?.message || NOTES_ERRORS.unavailable); }
  };

  const report = async (note) => {
    try { await reportNote(uid, instId, note.id); setReported((s) => new Set(s).add(note.id)); } catch (e) { setAnnounce(e?.message || NOTES_ERRORS.unavailable); }
  };

  const copyLink = (note) => {
    const href = `${window.location.origin}${roomHref(slug, instId, { n: note.id })}`;
    try { navigator.clipboard?.writeText(href); } catch { /* no clipboard */ }
  };

  const sendReply = (noteId, text, replyTo, tempId = `tmp-r-${Date.now().toString(36)}`) => {
    const entry = { id: tempId, uid, text: text.trim(), replyTo, createdAt: Date.now(), author: { name: user?.displayName || 'You' }, local: 'pending' };
    setLocalReplies((m) => ({ ...m, [noteId]: [...(m[noteId] || []).filter((r) => r.id !== tempId), entry] }));
    notesAction(user, { action: 'reply', inst: instId, noteId, text, ...(replyTo ? { replyTo } : {}) }).then(
      (res) => {
        setLocalReplies((m) => ({ ...m, [noteId]: (m[noteId] || []).filter((r) => r.id !== tempId) }));
        setPriv((p) => ({ ...p, replies: { ...(p.replies || {}), [noteId]: { ...((p.replies || {})[noteId] || {}), [res.replyId]: { ...entry, ...(res.reply || {}), local: undefined, status: res.status } } } }));
        if (res.status === 'held') setAnnounce(NOTES_COPY.waitingReview);
      },
      () => {
        setLocalReplies((m) => ({ ...m, [noteId]: (m[noteId] || []).map((r) => (r.id === tempId ? { ...r, local: 'failed', retry: () => sendReply(noteId, text, replyTo, tempId) } : r)) }));
        setAnnounce(NOTES_COPY.notSent);
      },
    );
  };

  const removeReply = async (noteId, reply) => {
    try {
      await notesAction(user, { action: 'remove', inst: instId, noteId, replyId: reply.id });
      setPriv((p) => ({ ...p, replies: { ...(p.replies || {}), [noteId]: { ...((p.replies || {})[noteId] || {}), [reply.id]: { ...reply, text: '', removed: true } } } }));
    } catch (e) { setAnnounce(e?.message || NOTES_ERRORS.unavailable); }
  };

  const repliesOf = (noteId) => {
    const server = Object.entries((priv.replies || {})[noteId] || {}).filter(([, r]) => r && typeof r === 'object').map(([id, r]) => ({ ...r, id }));
    const heldR = (priv.heldReplies || []).filter((r) => r.noteId === noteId).map((r) => ({ ...r, status: 'held' }));
    return [...server, ...heldR, ...(localReplies[noteId] || [])];
  };

  const revealIncoming = () => {
    setPriv((p) => ({ ...p, notes: [...incoming, ...(p.notes || []).filter((n) => !incoming.some((x) => x.id === n.id))] }));
    setIncoming([]);
    readUnderlines(instId).then((u) => u && setPriv((p) => ({ ...p, underlines: u })));
    readReplies(instId).then((r) => r && setPriv((p) => ({ ...p, replies: r })));
  };

  // ── render ──────────────────────────────────────────────────────────────────────────────────
  if (pub.phase === 'loading') return <div className="sn-room"><style>{NOTES_CSS + ROOM_CSS}</style><Nav series={null} slug={slug} /></div>;
  if (pub.phase === 'failed') return <div className="sn-room"><style>{NOTES_CSS + ROOM_CSS}</style><Nav series={null} slug={slug} /><Unavailable kind={pub.failure} onRetry={pub.retry} refreshing={pub.refreshing} subject="this room" /></div>;
  if (!series) {
    return (
      <div className="sn-room"><style>{NOTES_CSS + ROOM_CSS}</style>
        <section style={{ padding: '5rem 16px', textAlign: 'center' }}>
          <Link href="/series" className="sn-text sn-link" style={{ color: C.link }}><BackIcon />The Series</Link>
        </section>
      </div>
    );
  }

  const totals = seriesTotals(summary);
  const sc = sealedCounts(summary, instId);
  const q = priv.questions || null;
  const canWrite = priv.phase === 'open' || priv.phase === 'joining';
  const founder = isFounder(uid);
  const writeKind = (kind) => setComposer({ kind });

  const card = (note) => (
    <NoteCard key={note.id} note={note} heading={noteHeading(note, q, inst.ordinal)} identities={identities}
      count={counts[note.id] || 0} underlined={myUnderlines.has(note.id)} user={user} isOwn={note.uid === uid} canRemove={founder}
      replies={repliesOf(note.id)} reported={reported.has(note.id)}
      onUnderline={() => toggleUnderline(note)} onRemove={() => removeNote(note)} onReport={() => report(note)} onCopy={() => copyLink(note)}
      onSendReply={(text, replyTo) => sendReply(note.id, text, replyTo)}
      onRetryReply={(r) => r.retry?.()} onDropReply={(r) => setLocalReplies((m) => ({ ...m, [note.id]: (m[note.id] || []).filter((x) => x.id !== r.id) }))}
      onRemoveReply={(r) => removeReply(note.id, r)}
      onRetry={() => note.retry?.()} onDrop={() => setLocal((l) => l.filter((x) => x.id !== note.id))} />
  );

  let body = null;
  if (!inst) {
    body = <p style={{ fontFamily: DISPLAY, fontSize: 18, color: C.muted, padding: '32px 0' }}>{NOTES_ERRORS.not_released}</p>;
  } else if (priv.phase === 'pending') {
    body = <div aria-hidden="true" style={{ display: 'grid', gap: 14, paddingTop: 18 }}><NoteSkeleton /><NoteSkeleton /></div>;
  } else if (priv.phase === 'sealed') {
    body = (
      <section data-room="sealed" style={{ paddingTop: 22 }}>
        {!priv.signedOut && (
          <>
            <p style={{ ...questionStyle(24), marginBottom: 12 }}>{NOTES_COPY.partway(N)}</p>
            <ProgressRule fraction={priv.progress} />
          </>
        )}
        <p style={{ fontFamily: DISPLAY, fontSize: 18, lineHeight: 1.5, color: C.muted, margin: '14px 0 16px', maxWidth: 560 }}>{NOTES_COPY.sealedBody(sc.notes)}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
          {priv.signedOut && <button type="button" className="sn-btn sn-primary" onClick={() => setShowAuth(true)}>Sign in</button>}
          <Link href={`/series/read/${instId}`} className={`sn-btn ${priv.signedOut ? 'sn-secondary' : 'sn-primary'}`}>{NOTES_COPY.continueReading(N)}<ArrowIcon /></Link>
        </div>
        <QuestionRow labels={[QUESTION_LABEL.sit, QUESTION_LABEL.side, QUESTION_LABEL.line]}>
          <SitCard question={pub.data.sitByInst?.[instId] || ''} count={sc.sit} />
          <SealedCard kind="side" count={sc.side} roman={romanOf(inst.ordinal)} />
          <SealedCard kind="line" count={sc.line} roman={romanOf(inst.ordinal)} />
        </QuestionRow>
      </section>
    );
  } else if (priv.phase === 'joining') {
    body = (
      <section data-room="joining" style={{ paddingTop: 22, display: 'grid', gap: 14 }}>
        <QuestionRow labels={[QUESTION_LABEL.side, QUESTION_LABEL.sit, QUESTION_LABEL.line]}>
          <SideCard side={q?.side} mySide={priv.mySide} tallies={null} count={sc.side} busy={busy} onChoose={chooseSide} />
          <SitCard question={q?.sit || ''} count={sc.sit} onWrite={() => writeKind('sit')} />
          <LineCard question={q?.line || ''} count={sc.line} onWrite={() => writeKind('line')} />
        </QuestionRow>
        <ElseCard N={N} onWrite={() => writeKind('else')} />
      </section>
    );
  } else if (priv.phase === 'open' && (priv.loading || priv.inst !== instId)) {
    body = <div aria-hidden="true" style={{ display: 'grid', gap: 14, paddingTop: 18 }}><NoteSkeleton /><NoteSkeleton /><NoteSkeleton /></div>;
  } else if (open && view === 'side') {
    body = <SideView q={q} priv={priv} allNotes={allNotes} card={card} slug={slug} instId={instId} animate={freshSide} />;
  } else if (open && view === 'line') {
    body = <LineView allNotes={allNotes} uid={uid} instId={instId} slug={slug} />;
  } else if (open) {
    const kc = kindCounts(allNotes);
    const list = visibleNotes(allNotes, { filter, sort, counts });
    const held = (priv.held || []).filter((h) => filter === 'all' || h.kind === filter);
    body = (
      <section data-room="open" style={{ paddingTop: 22, display: 'grid', gap: 14 }}>
        <QuestionRow labels={[QUESTION_LABEL.side, QUESTION_LABEL.sit, QUESTION_LABEL.line]}>
          <SideCard side={q?.side} mySide={priv.mySide} tallies={priv.tallies} count={sc.side || kc.side} busy={busy} onChoose={chooseSide}
            onWrite={() => writeKind('side')} viewHref={roomHref(slug, instId, { q: 'side' })} animate={freshSide} />
          <SitCard question={q?.sit || ''} count={kc.sit} onWrite={() => writeKind('sit')} />
          <LineCard question={q?.line || ''} count={kc.line} onWrite={() => writeKind('line')} viewHref={roomHref(slug, instId, { q: 'line' })} />
        </QuestionRow>
        <ElseCard N={N} onWrite={() => writeKind('else')} />

        <h2 style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 26, margin: '18px 0 0' }}>{NOTES_COPY.theNotes}</h2>
        <div className="sn-chips" role="group" aria-label={NOTES_COPY.theNotes}>
          {['all', 'side', 'sit', 'line', 'else'].map((k) => (
            <button key={k} type="button" className="sn-chip" aria-pressed={filter === k} onClick={() => { setFilter(k); setLimit(PAGE_SIZE); }} data-filter={k}>
              {NOTES_COPY.filters[k]}<span style={{ fontFamily: LABEL, fontSize: 12, color: C.quiet }}>{kc[k]}</span>
            </button>
          ))}
        </div>
        <div className="sn-chips" role="group" aria-label="Sort">
          <button type="button" className="sn-chip" aria-pressed={sort === 'underlined'} onClick={() => setSort('underlined')}>{NOTES_COPY.sortUnderlined}</button>
          <button type="button" className="sn-chip" aria-pressed={sort === 'newest'} onClick={() => setSort('newest')}>{NOTES_COPY.sortNewest}</button>
        </div>
        {incoming.length > 0 && (
          <div className="sn-pill">
            <button type="button" className="sn-btn sn-primary" onClick={revealIncoming} data-new-pill>{NOTES_COPY.newNotes(incoming.length)}</button>
          </div>
        )}
        <div className="sn-list" data-notes>
          {held.map(card)}
          {list.slice(0, limit).map(card)}
        </div>
        {list.length > limit && <div ref={more} aria-hidden="true" style={{ height: 1 }} />}
      </section>
    );
  }

  return (
    <div className="sn-room" data-phase={priv.phase}>
      <style>{NOTES_CSS + ROOM_CSS}</style>
      <Nav series={series} slug={slug} />
      <Hero series={series} totals={totals} />
      {released.length > 0 && <Strip slug={slug} rows={released} current={instId} summary={summary} finished={finishedAll} />}
      <div className="sn-wrap" style={{ paddingBottom: canWrite ? 110 : 48 }}>
        <div className="sn-cols">
          <Rail series={series} slug={slug} rows={released} current={instId} summary={summary} finished={finishedAll} titles={pub.data.titles || {}}
            onLeave={canWrite ? () => setComposer({ kind: null }) : null} />
          <main>{body}</main>
        </div>
      </div>
      {canWrite && (
        <Bar>
          <button type="button" className="sn-bar-btn" onClick={() => setComposer({ kind: null })} data-composer-bar>{NOTES_COPY.composerBar(N)}</button>
        </Bar>
      )}
      <p className="sn-sr" aria-live="polite" role="status">{announce}</p>
      {inst && (
        <Composer open={!!composer} inst={instId} ordinal={inst.ordinal} slug={slug} questions={q} initialKind={composer?.kind || null}
          mySide={priv.mySide || null} user={user} onPosted={onPosted} onClose={() => setComposer(null)}
          onSide={(res) => { if (priv.phase === 'open') setPriv((p) => ({ ...p, mySide: res.side, tallies: res.tally || p.tallies })); else reload(); }} />
      )}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}

function Back({ slug, instId }) {
  return (
    <Link href={roomHref(slug, instId)} className="sn-text" style={{ color: C.link, paddingLeft: 0 }}>
      <BackIcon />{NOTES_COPY.theNotes}
    </Link>
  );
}

/** ?q=side — the split, your side marked, then "Why they chose" with a tab per side. */
function SideView({ q, priv, allNotes, card, slug, instId, animate }) {
  const opts = sideOptions(q?.side);
  const [tab, setTab] = useState(priv.mySide || opts[0]?.[0] || 'a');
  const notes = allNotes.filter((n) => n.kind === 'side' && n.side === tab);
  return (
    <section data-room="side" style={{ paddingTop: 18, display: 'grid', gap: 16 }}>
      <Back slug={slug} instId={instId} />
      <span style={labelStyle(C.gold, 9.5)}>{QUESTION_LABEL.side}</span>
      <p style={questionStyle(25)}>{q?.side?.text}</p>
      <SideBars options={opts} tallies={priv.tallies || {}} mine={priv.mySide} animate={animate} />
      <h2 style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 24, margin: '12px 0 0' }}>{NOTES_COPY.whyTheyChose}</h2>
      <div role="tablist" aria-label={NOTES_COPY.whyTheyChose} className="sn-chips">
        {opts.map(([k, t]) => (
          <button key={k} type="button" role="tab" id={`sn-tab-${k}`} aria-controls="sn-tabpanel" aria-selected={tab === k} className="sn-chip" onClick={() => setTab(k)}>{t}</button>
        ))}
      </div>
      <div role="tabpanel" id="sn-tabpanel" aria-labelledby={`sn-tab-${tab}`} className="sn-list">
        {notes.map(card)}
      </div>
    </section>
  );
}

/** ?q=line — lines ranked by how many readers chose them. */
function LineView({ allNotes, uid, instId, slug }) {
  const ranked = rankLines(allNotes.filter((n) => n.kind === 'line' && !n.local), uid);
  return (
    <section data-room="line" style={{ paddingTop: 18, display: 'grid', gap: 14 }}>
      <Back slug={slug} instId={instId} />
      <span style={labelStyle(C.gold, 9.5)}>{QUESTION_LABEL.line}</span>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
        {ranked.map((g) => (
          <li key={g.key} className="sn-card" data-line-rank={g.count} style={{ padding: '16px 16px 8px' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {g.mostChosen && <span data-most-chosen style={{ ...labelStyle(C.goldTint, 9), border: '1px solid rgba(201,168,76,0.5)', borderRadius: 999, padding: '3px 9px' }}>{NOTES_COPY.mostChosen}</span>}
              {g.mine && <span data-your-line style={{ ...labelStyle(C.link, 9), border: '1px solid rgba(196,181,253,0.5)', borderRadius: 999, padding: '3px 9px' }}>{NOTES_COPY.yourLine}</span>}
            </div>
            <figure style={{ position: 'relative', margin: 0, padding: '2px 0 0 34px' }}>
              <span style={{ position: 'absolute', left: 0, top: 0 }}><QuoteMark /></span>
              <blockquote style={{ margin: 0, fontFamily: DISPLAY, fontStyle: 'italic', fontSize: 20, lineHeight: 1.45, color: C.goldTint }}>{g.line.text}</blockquote>
            </figure>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <span style={{ fontFamily: DISPLAY, fontSize: 16, color: C.quiet }}>{NOTES_COPY.answers(g.count)}</span>
              <a className="sn-text sn-link" href={lineHref(instId, g.line)} style={{ color: C.link }}>{NOTES_COPY.readInPlace}</a>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
