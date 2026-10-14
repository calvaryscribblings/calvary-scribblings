'use client';
// READERS' NOTES — THE ADMIN SECTION ON THE INSTALMENT SCREEN (W46 §7, rulings 159, 162, 164, 166).
//
// Three fixed slots in the contract's order (QUESTION_KINDS: sit → side → line), saved as a DRAFT
// while the editor types, the same way the rest of this screen saves a draft instalment. Drafts
// live at series_question_drafts/{inst}; nothing here can reach a reader. "Publish questions" is
// the endpoint's publish-questions, which writes series_questions + series_questions_public in
// one act and updates the door's summary.
//
// ── THE W38 RACE, AND WHY EVERY ENDPOINT CALL FLUSHES FIRST ──────────────────────────────
// W38's suite caught a keystroke's pending autosave landing AFTER Publish had read the record.
// Here the endpoint reads the DRAFT NODE, so a save still waiting on the timer would publish the
// questions as they were a moment ago. Publish and Draft three therefore flush first, wait for any
// save already in flight, and refuse to go on if the last change did not save.
//
// ── DRAFT THREE NEVER SILENTLY OVERWRITES ────────────────────────────────────────────────
// The endpoint writes the drafts; this screen then re-reads the node and loads it into the slots.
// What the editor typed is saved (flushed) first, and if any slot holds text the screen asks
// before replacing it. The inputs are locked while the model is drafting, so nothing typed in
// that window can be lost either.
//
// ── THE REVIEW LIST ──────────────────────────────────────────────────────────────────────
// Held notes (series_notes_held/{inst}: screening flagged them) and reported live notes
// (series_note_reports/{inst} + the note from series_notes/{inst}). Founders can read all three.
// The author is shown by NAME here, because this screen is admin-only; it is never logged.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ref, get } from 'firebase/database';
import { db } from '../../lib/firebase';
import { saveQuestionDraft } from '../../lib/series/admin-writes';
import { notesAction } from '../../lib/series/notesClient';
import {
  NOTES_PATHS as P, NOTES_COPY, QUESTION_LABEL, QUESTION_MAX, OPTION_MAX, SIDE_MIN, SIDE_MAX,
} from '../../lib/series/notes';
import { londonLongDateTime } from '../../lib/londonTime';
import {
  EMPTY_SLOTS, slotsFrom, draftFields, slotsReady, slotIsReady, addOption, removeOption, slotsEmpty,
  publishState, counter, reviewItems, HELD_REASON, DECISION_LABEL,
} from './notesModel';

const AUTOSAVE_MS = 600; // the screen's own debounce (page.js)
const LETTERS = ['A', 'B', 'C', 'D'];

const CSS = `
.rn-slot{display:flex;flex-direction:column;gap:10px;padding:18px;border:1px solid #2e2e2e;border-radius:10px;background:#141414}
.rn-slot-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.rn-ready{font-size:15px;font-weight:700;display:inline-flex;align-items:center;gap:6px}
.rn-ready-on{color:#86efac}.rn-ready-off{color:rgba(255,255,255,.45)}
.rn-count{font-size:15px;color:rgba(255,255,255,.62);text-align:right}
.rn-count-over{color:#f87171;font-weight:700}
.rn-opt{display:grid;grid-template-columns:32px minmax(0,1fr) 44px;gap:10px;align-items:center}
.rn-letter{font-size:20px;font-weight:700;color:#c9a84c;text-align:center}
.rn-x{width:44px;height:44px;border-radius:8px;border:1px solid #2e2e2e;background:transparent;color:rgba(255,255,255,.7);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.rn-x:disabled{opacity:.3;cursor:default}
.rn-item{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid #2e2e2e;border-radius:10px;background:#141414}
.rn-item-held{border-color:rgba(252,211,77,.45)}
.rn-item-reported{border-color:rgba(248,113,113,.45)}
.rn-quote{margin:0;white-space:pre-wrap;font-size:19px;line-height:1.45}
.rn-confirm{display:flex;flex-direction:column;gap:12px;border:1px solid rgba(252,211,77,.45);border-radius:10px;padding:16px;background:rgba(252,211,77,.06)}
`;

const Tick = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="5 12.5 10 17.5 19 7" /></svg>
);
const Cross = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
);
const Msg = ({ m }) => (m ? <div role="status" className={m.ok ? 'sa-ok' : 'sa-err'}>{m.text}</div> : null);

const val = async (path) => {
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
};

/** The state words, shared by the section's chip and the panel's checklist line. */
export const QUESTIONS_STATE = Object.freeze({
  none: { chip: 'Not yet live', cls: 'draft' },
  published: { chip: 'Published', cls: 'live' },
  changed: { chip: 'Unpublished changes', cls: 'taken-down' },
});

function Count({ text, max }) {
  const c = counter(text, max);
  if (!c) return null;
  return <div className={`rn-count ${c.over ? 'rn-count-over' : ''}`} aria-live="polite">{c.text}</div>;
}

function Ready({ on }) {
  return on
    ? <span className="rn-ready rn-ready-on"><Tick /> Ready</span>
    : <span className="rn-ready rn-ready-off">Not ready</span>;
}

/**
 * props: inst (the instalment id), user (for the endpoint's ID token),
 *        onStatus({ ready, state }) — the panel's checklist line follows it.
 */
export default function ReadersNotes({ inst, user, onStatus }) {
  const [slots, setSlots] = useState(EMPTY_SLOTS);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const [live, setLive] = useState(null);       // series_questions/{inst}
  const [pub, setPub] = useState(null);         // series_questions_public/{inst}
  const [save, setSave] = useState('idle');     // idle | saving | failed
  const [saveErr, setSaveErr] = useState(null);
  const [busy, setBusy] = useState(null);       // null | 'publish' | 'draft'
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState(null);

  const slotsRef = useRef(slots);
  const timer = useRef(null);
  const dirty = useRef(false);
  const inflight = useRef(Promise.resolve(true));
  const persistRef = useRef(null);
  const statusRef = useRef(onStatus);
  useLayoutEffect(() => { statusRef.current = onStatus; });

  const ready = slotsReady(slots);
  const state = publishState(slots, live);

  // The panel's line is told whenever the inputs to it change — from the handlers, not an effect.
  const tell = useCallback((nextSlots, nextLive) => {
    statusRef.current?.({ ready: slotsReady(nextSlots), state: publishState(nextSlots, nextLive) });
  }, []);

  // ── LOAD ──
  const readQuestions = useCallback(async () => {
    const [d, q, p] = await Promise.all([val(`${P.drafts}/${inst}`), val(`${P.questions}/${inst}`), val(`${P.questionsPublic}/${inst}`)]);
    return { d, q, p };
  }, [inst]);

  useEffect(() => {
    let gone = false;
    readQuestions().then(({ d, q, p }) => {
      if (gone) return;
      // No draft yet but live questions exist: start from what readers see.
      const s = d ? slotsFrom(d) : q ? slotsFrom(q) : EMPTY_SLOTS;
      slotsRef.current = s;
      setSlots(s); setLive(q); setPub(p); setLoaded(true);
      tell(s, q);
    }).catch(() => { if (!gone) setLoadErr('The questions could not be loaded. Reload the page to try again.'); });
    return () => { gone = true; };
  }, [readQuestions, tell]);

  // ── SAVE AS YOU TYPE ──
  // Saves whatever the slots hold now. Saves are chained, so two never race to the node.
  const persist = useCallback(() => {
    const run = inflight.current.then(async () => {
      if (!dirty.current) return true;
      dirty.current = false;
      setSave('saving');
      const r = await saveQuestionDraft(inst, draftFields(slotsRef.current));
      if (!r.ok) { dirty.current = true; setSave('failed'); setSaveErr((r.errors || []).join(' ')); return false; }
      setSave('idle'); setSaveErr(null);
      return true;
    });
    inflight.current = run.catch(() => false);
    return run;
  }, [inst]);
  useLayoutEffect(() => { persistRef.current = persist; });

  /** Save what is waiting on the timer, now, and wait for every save in flight. */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    return persistRef.current();
  }, []);

  // Leaving the screen with a save still waiting saves it rather than dropping it.
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (dirty.current) persistRef.current?.();
  }, []);

  const change = (next) => {
    slotsRef.current = next;
    setSlots(next);
    tell(next, live);
    dirty.current = true;
    setMsg(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persistRef.current(), AUTOSAVE_MS);
  };
  const setSide = (patch) => change({ ...slotsRef.current, side: { ...slotsRef.current.side, ...patch } });
  const setOption = (i, v) => {
    const options = slotsRef.current.side.options.slice();
    options[i] = v;
    setSide({ options });
  };

  // ── PUBLISH ──
  const publish = async () => {
    setBusy('publish'); setMsg(null);
    if (!(await flush())) { setBusy(null); setMsg({ ok: false, text: 'The last change didn’t save, so the questions didn’t go out. Try again.' }); return; }
    try {
      await notesAction(user, { action: 'publish-questions', inst });
      const { q, p } = await readQuestions();
      setLive(q); setPub(p);
      tell(slotsRef.current, q);
      setMsg({ ok: true, text: 'Published. Readers who finish this instalment see these three, and the door shows Sit with this.' });
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'The questions didn’t publish. Try again.' });
    }
    setBusy(null);
  };

  // ── DRAFT THREE FROM THE TEXT ──
  const draftNow = async () => {
    setConfirming(false); setBusy('draft'); setMsg(null);
    // Anything typed while the question was open is saved too, before the endpoint writes.
    if (!(await flush())) { setBusy(null); setMsg({ ok: false, text: 'The last change didn’t save. Try again before drafting.' }); return; }
    try {
      await notesAction(user, { action: 'draft-questions', inst });
      const { d } = await readQuestions();
      const s = d ? slotsFrom(d) : slotsRef.current;
      slotsRef.current = s;
      dirty.current = false;
      setSlots(s);
      tell(s, live);
      setMsg({ ok: true, text: 'Drafted from the text. Read them through: readers see nothing until you press Publish questions.' });
    } catch (e) {
      setMsg({ ok: false, text: e?.message || 'The draft didn’t come back. Try again.' });
    }
    setBusy(null);
  };
  const askDraft = async () => {
    setMsg(null);
    // What was typed is saved before anything else happens to the node.
    if (!(await flush())) { setMsg({ ok: false, text: 'The last change didn’t save. Try again before drafting.' }); return; }
    if (!slotsEmpty(slotsRef.current)) { setConfirming(true); return; }
    await draftNow();
  };

  const locked = !loaded || !!busy;
  const statusLine = save === 'saving' ? 'Saving…' : save === 'failed' ? null : 'Saved as you type';
  const chip = QUESTIONS_STATE[state];
  const doorMismatch = live && (!pub || pub.sit !== live.sit);

  return (
    <section className="sa-card sa-stack" id="sa-notes" aria-labelledby="rn-h">
      <style>{CSS}</style>
      <div className="sa-between">
        <h2 className="sa-h2" id="rn-h">{NOTES_COPY.adminSection}</h2>
        <div className="sa-row">
          <span className={`sa-chip sa-chip-${chip.cls}`} data-testid="rn-state">{chip.chip}</span>
          {loaded && statusLine && <span className="sa-small sa-dim" aria-live="polite">{statusLine}</span>}
          {save === 'failed' && (
            <span className="sa-small sa-err" aria-live="polite">Couldn’t save ·{' '}
              <button type="button" className="sa-textbtn" style={{ fontSize: 16 }} onClick={() => { dirty.current = true; persistRef.current(); }}>Try again</button>
            </span>
          )}
        </div>
      </div>
      {save === 'failed' && saveErr && <div className="sa-err sa-small">{saveErr}</div>}
      {loadErr && <div className="sa-err">{loadErr}</div>}
      <div className="sa-small sa-dim">
        One of each, all three or none. Readers see them on the last page.
        {live?.publishedAt ? ` Published ${londonLongDateTime(live.publishedAt)}.` : ''}
      </div>
      {doorMismatch && <div className="sa-small sa-amber">The door’s Sit with this doesn’t match the live questions. Publish again to put it right.</div>}

      {/* 1. Sit with this */}
      <div className="rn-slot" data-slot="sit">
        <div className="rn-slot-head">
          <label className="sa-label" htmlFor="rn-sit" style={{ margin: 0 }}>{NOTES_COPY.adminSit}</label>
          <Ready on={slotIsReady('sit', slots)} />
        </div>
        <textarea id="rn-sit" className="sa-input" disabled={locked} value={slots.sit}
          placeholder="A question about how it felt, with nothing that happens in it"
          onChange={(e) => change({ ...slotsRef.current, sit: e.target.value })} />
        <Count text={slots.sit} max={QUESTION_MAX} />
      </div>

      {/* 2. Take a side */}
      <div className="rn-slot" data-slot="side" role="group" aria-labelledby="rn-side-l">
        <div className="rn-slot-head">
          <span className="sa-label" id="rn-side-l" style={{ margin: 0 }}>{NOTES_COPY.adminSide}</span>
          <Ready on={slotIsReady('side', slots)} />
        </div>
        <label className="sa-label" htmlFor="rn-side" style={{ margin: 0 }}>The question</label>
        <textarea id="rn-side" className="sa-input" disabled={locked} value={slots.side.text}
          onChange={(e) => setSide({ text: e.target.value })} />
        <Count text={slots.side.text} max={QUESTION_MAX} />
        <div className="sa-stack" style={{ gap: 10 }}>
          {slots.side.options.map((v, i) => (
            <div key={i} className="rn-opt-wrap">
              <div className="rn-opt">
                <span className="rn-letter" aria-hidden="true">{LETTERS[i]}</span>
                <input className="sa-input" aria-label={`Side ${LETTERS[i]}`} disabled={locked} value={v}
                  onChange={(e) => setOption(i, e.target.value)} />
                <button type="button" className="rn-x" aria-label={`Remove side ${LETTERS[i]}`}
                  disabled={locked || slots.side.options.length <= SIDE_MIN}
                  onClick={() => setSide({ options: removeOption(slotsRef.current.side.options, i) })}><Cross /></button>
              </div>
              <Count text={v} max={OPTION_MAX} />
            </div>
          ))}
        </div>
        <div className="sa-row">
          <button type="button" className="sa-btn sa-btn-s" disabled={locked || slots.side.options.length >= SIDE_MAX}
            onClick={() => setSide({ options: addOption(slotsRef.current.side.options) })}>Add a side</button>
          <span className="sa-small sa-dim">{slots.side.options.length} of {SIDE_MAX} sides</span>
        </div>
      </div>

      {/* 3. The line */}
      <div className="rn-slot" data-slot="line">
        <div className="rn-slot-head">
          <label className="sa-label" htmlFor="rn-line" style={{ margin: 0 }}>{NOTES_COPY.adminLine}</label>
          <Ready on={slotIsReady('line', slots)} />
        </div>
        <textarea id="rn-line" className="sa-input" disabled={locked} value={slots.line}
          onChange={(e) => change({ ...slotsRef.current, line: e.target.value })} />
        <Count text={slots.line} max={QUESTION_MAX} />
      </div>

      <div className="sa-small" data-testid="rn-ready">{NOTES_COPY.checklist(ready)}</div>

      {confirming && (
        <div className="rn-confirm" role="alertdialog" aria-label="Replace the questions?">
          <div style={{ fontWeight: 700, color: '#fcd34d', fontSize: 20 }}>Replace what’s in the three slots?</div>
          <div className="sa-small">What you typed is saved as the draft now. Drafting from the text writes three new questions over it.</div>
          <div className="sa-row">
            <button type="button" className="sa-btn sa-btn-p" onClick={draftNow}>Replace them</button>
            <button type="button" className="sa-btn sa-btn-s" onClick={() => setConfirming(false)}>Keep mine</button>
          </div>
        </div>
      )}

      <div className="sa-row">
        <button type="button" className="sa-btn sa-btn-s" disabled={locked || confirming} onClick={askDraft}>
          {busy === 'draft' ? 'Drafting…' : NOTES_COPY.draftFromText}
        </button>
        <button type="button" className="sa-btn sa-btn-p" disabled={locked || ready !== 3 || state === 'published'} onClick={publish}>
          {busy === 'publish' ? 'Publishing…' : NOTES_COPY.publishQuestions}
        </button>
      </div>
      {ready === 3 && state === 'published' && <div className="sa-small sa-dim">These are the questions readers see.</div>}
      <Msg m={msg} />

      <ReviewList inst={inst} user={user} />
    </section>
  );
}

// ── THE REVIEW LIST ───────────────────────────────────────────────────────────────────────
function ReviewList({ inst, user }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);        // item key
  const [itemMsg, setItemMsg] = useState({});    // key → message

  const load = useCallback(async () => {
    const [held, reports] = await Promise.all([val(`${P.held}/${inst}`), val(`${P.reports}/${inst}`)]);
    const ids = Object.keys(reports || {});
    const notes = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await val(`${P.notes}/${inst}/${id}`)])));
    return reviewItems({ held, reports, notes });
  }, [inst]);

  useEffect(() => {
    let gone = false;
    load().then((list) => { if (!gone) setItems(list); })
      .catch(() => { if (!gone) setErr('The notes waiting for review could not be loaded.'); });
    return () => { gone = true; };
  }, [load]);

  const decide = async (item, decision) => {
    setBusy(item.key); setItemMsg((m) => ({ ...m, [item.key]: null }));
    try {
      await notesAction(user, { action: 'review', inst, noteId: item.noteId, decision });
      setItems(await load());
    } catch (e) {
      setItemMsg((m) => ({ ...m, [item.key]: { ok: false, text: e?.message || 'That didn’t go through. Try again.' } }));
    }
    setBusy(null);
  };

  const counts = useMemo(() => {
    const list = items || [];
    return { held: list.filter((x) => x.source === 'held').length, reported: list.filter((x) => x.source === 'reported').length };
  }, [items]);

  return (
    <div className="sa-stack" style={{ gap: 12, borderTop: '1px solid #242424', paddingTop: 20 }} data-testid="rn-review">
      <span className="sa-label" style={{ margin: 0 }}>Waiting for review</span>
      {err && <div className="sa-err">{err}</div>}
      {!items && !err && <div className="sa-dim sa-small">Loading…</div>}
      {items && !items.length && <div className="sa-dim sa-small">Nothing held or reported.</div>}
      {items && items.length > 0 && (
        <div className="sa-small sa-dim">{counts.held} held by the check · {counts.reported} reported by readers</div>
      )}
      {(items || []).map((it) => (
        <article key={it.key} className={`rn-item rn-item-${it.source}`} data-note={it.noteId} data-source={it.source}>
          <div className="sa-between" style={{ gap: 8 }}>
            <span className="sa-small" style={{ fontWeight: 700 }}>
              {it.source === 'held'
                ? `Held · ${HELD_REASON[it.reason] || HELD_REASON.other}`
                : `Reported ${it.reportCount} ${it.reportCount === 1 ? 'time' : 'times'}`}
            </span>
            <span className="sa-small sa-dim">{it.kind === 'reply' ? 'A reply' : QUESTION_LABEL[it.kind] || QUESTION_LABEL.else}</span>
          </div>
          {it.gone
            ? <p className="rn-quote sa-dim">This note has already gone.</p>
            : <p className="rn-quote">{it.text}</p>}
          <div className="sa-small sa-dim">
            {it.authorName}{it.at ? ` · ${londonLongDateTime(it.at)}` : ''}
          </div>
          {it.reasons.length > 0 && (
            <ul className="sa-small" style={{ margin: 0, paddingLeft: 20 }}>
              {it.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          <div className="sa-row">
            {it.decisions.map((d) => (
              <button key={d} type="button"
                className={`sa-btn ${d === 'remove' ? 'sa-btn-redline' : d === 'approve' ? 'sa-btn-p' : 'sa-btn-s'}`}
                disabled={busy === it.key} onClick={() => decide(it, d)}>
                {DECISION_LABEL[d]}
              </button>
            ))}
          </div>
          <Msg m={itemMsg[it.key]} />
        </article>
      ))}
    </div>
  );
}
