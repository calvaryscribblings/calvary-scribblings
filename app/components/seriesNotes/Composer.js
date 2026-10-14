'use client';
// READERS' NOTES — THE COMPOSER (W46, §6). One composer: a sheet on phones, a dialog on wide
// screens. The room and the last-page sheet both mount it.
//
//   <Composer open inst ordinal slug questions={series_questions|null}
//             initialKind="side"|"sit"|"line"|"else" mySide="a" user
//             onPosted={(event) => {}} onClose={() => {}} onSide={(result) => {}} />
//
// onPosted receives the posting states, so the surface that mounted it can show the note at
// once and keep it honest afterwards:
//   { phase: 'pending', tempId, note }                      — the instant Post is pressed
//   { phase: 'done', tempId, noteId, status, note }          — status 'live' | 'held' | 'unscreened'
//   { phase: 'failed', tempId, note, error, retry() }        — "Not sent." with Try again / Remove
// `note` is the reader's own optimistic copy (uid, kind, text, side?, line?, author, createdAt).
// onSide (optional) hears a side recorded from inside the composer.
//
// The field is Cormorant at 20px (the house allows it: every field is 16px or more on touch).
// Drafts are kept per question on the device (loadDraft/saveDraft). The counter shows only
// near the limit. "Add a line from {N}" appears when the reader's margin holds one.
import { useEffect, useRef, useState } from 'react';
import {
  NOTES_COPY, NOTE_MAX, COUNTER_FROM, QUESTION_LABEL, instName, sideOptions, notesEnabled, NOTES_ERRORS,
} from '../../lib/series/notes';
import { notesAction, loadDraft, saveDraft, readMargin } from '../../lib/series/notesClient';
import { C, DISPLAY, NOTES_CSS, labelStyle, questionStyle } from './tokens';
import { CloseIcon, CheckIcon } from './Parts';

let tmpSeq = 0;
const tempIdOf = () => `tmp-${Date.now().toString(36)}-${(tmpSeq += 1)}`;

function selfAuthor(user) {
  const name = user?.displayName || 'You';
  const out = { name };
  if (user?.photoURL) out.photoURL = user.photoURL;
  return out;
}

/**
 * Post a note through the endpoint and report its states. Exported so the room's "Try again"
 * re-runs exactly the same call.
 */
export function postNote(user, body, note, tempId, emit) {
  emit({ phase: 'pending', tempId, note });
  return notesAction(user, { action: 'note', ...body }).then(
    (res) => {
      saveDraft(body.inst, body.kind, '');
      emit({ phase: 'done', tempId, noteId: res.noteId, status: res.status || 'live', note: { ...note, ...(res.note || {}), id: res.noteId } });
      return res;
    },
    (err) => {
      emit({ phase: 'failed', tempId, note, error: err?.message || NOTES_ERRORS.unavailable, retry: () => postNote(user, body, note, tempId, emit) });
      return null;
    },
  );
}

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 720px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return wide;
}

/** One of the question choices (and the dashed fourth card). */
function Choice({ label, question, dashed = false, onClick }) {
  return (
    <button type="button" className="sn-card-btn" onClick={onClick} data-choice={label}
      style={{ padding: '14px 16px', borderRadius: 14, minHeight: 44, background: dashed ? 'transparent' : C.card,
        border: dashed ? '1px dashed rgba(201,168,76,0.45)' : `1px solid ${C.border}` }}>
      {label && <span style={{ ...labelStyle(C.gold, 9.5), display: 'block', marginBottom: 6 }}>{label}</span>}
      <span style={{ ...questionStyle(19), display: 'block', color: dashed ? C.muted : C.cream }}>{question}</span>
    </button>
  );
}

export default function Composer({ open, inst, ordinal, slug, questions = null, initialKind = null, mySide = null, user, onPosted, onClose, onSide }) {
  void slug;
  const N = instName(ordinal);
  const wide = useWide();
  const [kind, setKind] = useState(initialKind);
  const [text, setText] = useState('');
  const [side, setSide] = useState(mySide);
  const [margin, setMargin] = useState(null);
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const panel = useRef(null);
  const field = useRef(null);
  const returnTo = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  // A fresh open starts from the kind it was opened with.
  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setSide(mySide);
    setStatus('');
  }, [open, initialKind, mySide]);

  // The draft for this question, kept on the device.
  useEffect(() => {
    if (!open || !kind) return;
    setText(loadDraft(inst, kind));
  }, [open, inst, kind]);

  // The reader's margin line, for "Add a line from {N}".
  useEffect(() => {
    if (!open || !user?.uid || !inst) return undefined;
    let live = true;
    readMargin(user.uid, inst).then((m) => {
      if (!live) return;
      const ok = m && typeof m.text === 'string' && m.text && m.cfi && m.epubVersion;
      setMargin(ok ? { text: m.text, cfi: m.cfi, epubVersion: m.epubVersion } : null);
      setAttach(!!ok);
    });
    return () => { live = false; };
  }, [open, user?.uid, inst]);

  // Focus in, Escape out, focus back where it came from.
  useEffect(() => {
    if (!open) return undefined;
    returnTo.current = document.activeElement;
    const t = setTimeout(() => (field.current || panel.current?.querySelector('button, textarea'))?.focus(), 30);
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      try { returnTo.current?.focus?.(); } catch { /* gone */ }
    };
  }, [open]);

  if (!open || !notesEnabled()) return null;

  const opts = sideOptions(questions?.side);
  const optText = Object.fromEntries(opts);
  const len = Array.from(text).length;
  const nearLimit = len >= Math.floor(NOTE_MAX * COUNTER_FROM);
  const lineReady = kind !== 'line' || (attach && margin);
  const sideReady = kind !== 'side' || !!side;
  const canPost = !busy && len > 0 && len <= NOTE_MAX && lineReady && sideReady;

  const heading = (() => {
    if (kind === 'side') return { label: side ? NOTES_COPY.tookASide(optText[side] || side) : QUESTION_LABEL.side.toUpperCase(), q: questions?.side?.text || '' };
    if (kind === 'sit') return { label: QUESTION_LABEL.sit.toUpperCase(), q: questions?.sit || '' };
    if (kind === 'line') return { label: QUESTION_LABEL.line.toUpperCase(), q: questions?.line || '' };
    if (kind === 'else') return { label: QUESTION_LABEL.else.toUpperCase(), q: NOTES_COPY.elseCard(N) };
    return null;
  })();

  const chooseSide = async (option) => {
    setBusy(true);
    setStatus('');
    try {
      const res = await notesAction(user, { action: 'side', inst, option });
      setSide(res.side || option);
      onSide?.(res);
    } catch (e) {
      setStatus(e?.message || NOTES_ERRORS.unavailable);
    } finally { setBusy(false); }
  };

  const submit = () => {
    if (!canPost) return;
    const body = { inst, kind, text };
    if (kind === 'line' && margin) body.line = margin;
    const note = {
      uid: user?.uid, kind, text: text.trim(), createdAt: Date.now(), author: selfAuthor(user),
      ...(kind === 'side' && side ? { side } : {}), ...(body.line ? { line: body.line } : {}),
    };
    const tempId = tempIdOf();
    setBusy(true);
    postNote(user, body, note, tempId, (ev) => onPosted?.(ev)).finally(() => setBusy(false));
    onClose?.();
  };

  const sheetStyle = wide
    ? { position: 'relative', width: 'min(600px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 48px)', borderRadius: 16 }
    : { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92vh', borderRadius: '26px 26px 0 0' };

  return (
    <div data-composer={wide ? 'dialog' : 'sheet'} style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: wide ? 'center' : 'flex-end', justifyContent: 'center' }}>
      <style>{NOTES_CSS}</style>
      <div aria-hidden="true" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(4,2,10,0.72)' }} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="sn-composer-title" className={wide ? 'sn-pop' : 'sn-rise'}
        style={{ ...sheetStyle, background: '#100b1e', border: `1px solid ${C.border}`, overflowY: 'auto', boxSizing: 'border-box', padding: '18px 18px calc(18px + env(safe-area-inset-bottom, 0px))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <h2 id="sn-composer-title" style={{ ...labelStyle(C.gold, 10), margin: 0 }}>{NOTES_COPY.kicker} · {N.toUpperCase()}</h2>
          <button type="button" className="sn-text" aria-label={NOTES_COPY.notNow} onClick={onClose}><CloseIcon /></button>
        </div>

        {!kind && (
          <div data-chooser>
            <p style={{ ...questionStyle(22), margin: '4px 0 14px' }}>{NOTES_COPY.whatAbout}</p>
            <div style={{ display: 'grid', gap: 10 }}>
              {questions?.side?.text && <Choice label={QUESTION_LABEL.side.toUpperCase()} question={questions.side.text} onClick={() => setKind('side')} />}
              {questions?.sit && <Choice label={QUESTION_LABEL.sit.toUpperCase()} question={questions.sit} onClick={() => setKind('sit')} />}
              {questions?.line && <Choice label={QUESTION_LABEL.line.toUpperCase()} question={questions.line} onClick={() => setKind('line')} />}
              <Choice dashed question={NOTES_COPY.elseCard(N)} onClick={() => setKind('else')} />
            </div>
          </div>
        )}

        {kind && heading && (
          <div data-field-kind={kind}>
            <div style={{ marginBottom: 12 }}>
              <span style={{ ...labelStyle(C.gold, 9.5), display: 'block', marginBottom: 6 }}>{heading.label}</span>
              {heading.q && <p style={questionStyle(20)}>{heading.q}</p>}
            </div>

            {kind === 'side' && !side && opts.length > 0 && (
              <div role="group" aria-label={QUESTION_LABEL.side} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {opts.map(([k, t]) => (
                  <button key={k} type="button" className="sn-btn sn-secondary" disabled={busy} onClick={() => chooseSide(k)} style={{ fontFamily: DISPLAY, fontSize: 18, letterSpacing: 0, textTransform: 'none', fontWeight: 500 }}>{t}</button>
                ))}
              </div>
            )}

            {kind === 'line' && margin && (
              <div style={{ marginBottom: 10 }}>
                <button type="button" className="sn-text" aria-pressed={attach} onClick={() => setAttach((a) => !a)} style={{ color: attach ? C.goldTint : C.link, padding: 0 }}>
                  {attach && <CheckIcon />}{NOTES_COPY.addLine(N)}
                </button>
                {attach && (
                  <blockquote style={{ margin: '6px 0 0', padding: '8px 12px', borderLeft: `2px solid ${C.gold}`, fontFamily: DISPLAY, fontStyle: 'italic', fontSize: 17, color: C.muted }}>{margin.text}</blockquote>
                )}
              </div>
            )}

            <textarea
              ref={field}
              value={text}
              aria-label={heading.q || heading.label}
              maxLength={NOTE_MAX + 50}
              onChange={(e) => { setText(e.target.value); saveDraft(inst, kind, e.target.value); }}
              rows={wide ? 7 : 6}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: DISPLAY, fontSize: 20, lineHeight: 1.5, color: C.cream,
                background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', outline: 'none' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
              <p style={{ fontFamily: DISPLAY, fontSize: 15, color: C.quiet, margin: 0, flex: '1 1 220px' }}>{NOTES_COPY.onlyFinishers(N)}</p>
              {nearLimit && (
                <span data-counter style={{ fontFamily: DISPLAY, fontSize: 15, color: len > NOTE_MAX ? '#fda4af' : C.quiet }}>{len} / {NOTE_MAX}</span>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="sn-btn sn-primary" disabled={!canPost} onClick={submit} aria-busy={busy}>{NOTES_COPY.post}</button>
            </div>
          </div>
        )}
        <p aria-live="polite" role="status" style={{ fontFamily: DISPLAY, fontSize: 15, color: '#fda4af', margin: status ? '10px 0 0' : 0 }}>{status}</p>
      </div>
    </div>
  );
}
