'use client';
// READERS' NOTES — THE LAST-PAGE SHEET (W46, §5).
//
//   <EndSheet inst ordinal slug seriesId user onClose={() => {}} />
//
// The Series reader mounts it AFTER writing series_finished/{uid}/{inst} (the reads below
// depend on it: series_questions is readable once finished; the tallies once finished AND a
// member, which the first side makes the reader).
//
//   END OF INSTALMENT {N} · ❦ · TAKE A SIDE · 1 OF 3 · the question, the sides as large buttons ·
//   "Choose, and see how {n} readers split."
//   after choosing: the bars fill once, the reader's side marked · "You're with {p}% of {n}
//   readers." · "Say why you chose {side}" (the composer) · "Step inside: two more questions,
//   {n} notes" · "Choose again" (secondary).
//   "Not now" closes. No Take a side published: "Or tell us about anything else…" instead.
//   Once answered, it always opens on its results.
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { NOTES_COPY, romanOf, instName, sideOptions, tallyShares, roomHref, notesEnabled, NOTES_ERRORS } from '../../lib/series/notes';
import { notesAction, readQuestions, readMySide, readMember, readTallies, readSummary } from '../../lib/series/notesClient';
import { C, DISPLAY, NOTES_CSS, labelStyle, questionStyle } from './tokens';
import SideBars from './Bars';
import Composer from './Composer';
import { ElseCard } from './QuestionCard';
import { useCountUp } from './Parts';

export default function EndSheet({ inst, ordinal, slug, seriesId, user, onClose }) {
  const enabled = notesEnabled();
  const [phase, setPhase] = useState('loading'); // loading | choose | result | else
  const [questions, setQuestions] = useState(null);
  const [mySide, setMySide] = useState(null);
  const [tally, setTally] = useState(null);
  const [summaryInst, setSummaryInst] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false); // the bars animate on a fresh choice only
  const [composer, setComposer] = useState(null); // null | 'side' | 'else'
  const [posted, setPosted] = useState(null);
  const [message, setMessage] = useState('');
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!enabled || !user?.uid || !inst) return undefined;
    let live = true;
    (async () => {
      const [q, side, member, summary] = await Promise.all([
        readQuestions(inst),
        readMySide(user.uid, inst),
        readMember(user.uid, inst),
        seriesId ? readSummary(seriesId).catch(() => null) : null,
      ]);
      // Tallies only for a member: a non-member's read would be refused, and the sheet makes none.
      const t = member ? await readTallies(inst) : null;
      if (!live) return;
      setQuestions(q);
      setMySide(side);
      setTally(t);
      setSummaryInst(summary?.byInst?.[inst] || null);
      const hasSide = sideOptions(q?.side).length >= 2 && !!q?.side?.text;
      setPhase(!hasSide ? 'else' : side ? 'result' : 'choose');
    })();
    return () => { live = false; };
  }, [enabled, user?.uid, inst, seriesId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(() => panel.current?.querySelector('button, a')?.focus(), 40);
    const onKey = (e) => { if (e.key === 'Escape' && !composer) closeRef.current?.(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [enabled, composer, phase]);

  const choose = useCallback(async (option) => {
    setBusy(true);
    setMessage('');
    try {
      const res = await notesAction(user, { action: 'side', inst, option });
      setMySide(res.side || option);
      setTally(res.tally || {});
      setFresh(true);
      setPhase('result');
    } catch (e) {
      setMessage(e?.message || NOTES_ERRORS.unavailable);
    } finally { setBusy(false); }
  }, [user, inst]);

  const opts = sideOptions(questions?.side);
  const optText = Object.fromEntries(opts);
  const shares = tallyShares(tally || {}, opts.map(([k]) => k));
  const total = tally ? shares.total : (Number(summaryInst?.kinds?.side) || 0);
  const notesCount = Number(summaryInst?.notes) || 0;
  const pct = useCountUp(shares[mySide] || 0, fresh);
  const N = instName(ordinal);

  if (!enabled || !user) return null;

  const onPosted = (ev) => {
    if (ev.phase === 'pending') setPosted({ phase: 'pending' });
    else if (ev.phase === 'done') setPosted({ phase: 'done', status: ev.status });
    else if (ev.phase === 'failed') setPosted({ phase: 'failed', retry: ev.retry });
  };

  return (
    <div data-end-sheet={phase} style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <style>{NOTES_CSS}</style>
      <div aria-hidden="true" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(4,2,10,0.6)' }} />
      <section ref={panel} role="dialog" aria-modal="true" aria-labelledby="sn-end-title" className="sn-rise"
        style={{ position: 'relative', width: 'min(560px, 100vw)', maxHeight: '92vh', overflowY: 'auto', boxSizing: 'border-box',
          background: 'linear-gradient(180deg, #14082a 0%, #0b0716 100%)', borderRadius: '26px 26px 0 0', border: `1px solid ${C.border}`, borderBottom: 'none',
          padding: '22px 20px calc(20px + env(safe-area-inset-bottom, 0px))', textAlign: 'center' }}>
        <h2 id="sn-end-title" style={{ ...labelStyle(C.gold, 10), margin: 0 }}>{NOTES_COPY.endOf(romanOf(ordinal))}</h2>
        <p aria-hidden="true" style={{ fontFamily: DISPLAY, fontSize: 22, color: C.gold, margin: '6px 0 8px' }}>❦</p>

        {phase === 'loading' && <div aria-hidden="true" style={{ height: 260 }} />}

        {(phase === 'choose' || phase === 'result') && (
          <>
            <p style={{ ...labelStyle(C.muted, 9), margin: '0 0 10px' }}>{NOTES_COPY.sideStep}</p>
            <p style={{ ...questionStyle(25), margin: '0 auto 18px', maxWidth: 460 }}>{questions?.side?.text}</p>
          </>
        )}

        {phase === 'choose' && (
          <>
            <div role="group" aria-label={questions?.side?.text} style={{ display: 'grid', gap: 10, textAlign: 'left' }}>
              {opts.map(([k, t]) => (
                <button key={k} type="button" disabled={busy} onClick={() => choose(k)} data-side-option={k} className="sn-card-btn"
                  style={{ minHeight: 56, padding: '14px 18px', borderRadius: 14, border: '1px solid rgba(201,168,76,0.4)', background: 'rgba(255,255,255,0.03)',
                    fontFamily: DISPLAY, fontSize: 21, color: C.cream, textAlign: 'center' }}>{t}</button>
              ))}
            </div>
            <p style={{ fontFamily: DISPLAY, fontSize: 16, color: C.muted, margin: '14px 0 0' }}>{NOTES_COPY.chooseAndSee(total)}</p>
          </>
        )}

        {phase === 'result' && (
          <>
            <div style={{ textAlign: 'left' }}>
              <SideBars options={opts} tallies={tally || {}} mine={mySide} animate={fresh} />
            </div>
            <p data-youre-with style={{ fontFamily: DISPLAY, fontSize: 18, color: C.cream, margin: '14px 0 16px' }}>
              <span className="sn-sr">{NOTES_COPY.youreWith(shares[mySide] || 0, total)}</span>
              <span aria-hidden="true">{NOTES_COPY.youreWith(pct, total)}</span>
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              <button type="button" className="sn-btn sn-primary" onClick={() => setComposer('side')}>{NOTES_COPY.sayWhy(optText[mySide] || mySide)}</button>
              <Link className="sn-btn sn-gold" href={roomHref(slug, inst)}>{NOTES_COPY.stepInsideMore(notesCount)}</Link>
              <button type="button" className="sn-text" style={{ justifySelf: 'center' }} onClick={() => { setFresh(false); setPhase('choose'); }}>{NOTES_COPY.chooseAgain}</button>
            </div>
          </>
        )}

        {phase === 'else' && (
          <div style={{ textAlign: 'left', display: 'grid', gap: 12 }}>
            <ElseCard N={N} onWrite={() => setComposer('else')} />
            <Link className="sn-btn sn-gold" href={roomHref(slug, inst)}>{NOTES_COPY.stepInside}</Link>
          </div>
        )}

        <div aria-live="polite" role="status" style={{ fontFamily: DISPLAY, fontSize: 16, minHeight: 0 }}>
          {message && <p style={{ color: '#fda4af', margin: '10px 0 0' }}>{message}</p>}
          {posted?.phase === 'done' && posted.status === 'held' && <p style={{ ...labelStyle(C.goldTint, 9), margin: '12px 0 0' }}>{NOTES_COPY.waitingReview}</p>}
          {posted?.phase === 'failed' && (
            <p style={{ margin: '10px 0 0', color: '#fda4af' }}>
              {NOTES_COPY.notSent}{' '}
              <button type="button" className="sn-text sn-link" style={{ color: C.link }} onClick={() => posted.retry?.()}>{NOTES_COPY.tryAgain}</button>
              <button type="button" className="sn-text" onClick={() => setPosted(null)}>{NOTES_COPY.remove}</button>
            </p>
          )}
        </div>

        <button type="button" className="sn-text" style={{ marginTop: 8 }} onClick={onClose}>{NOTES_COPY.notNow}</button>
      </section>

      <Composer open={!!composer} inst={inst} ordinal={ordinal} slug={slug} questions={questions} initialKind={composer}
        mySide={mySide} user={user} onPosted={onPosted} onClose={() => setComposer(null)} />
    </div>
  );
}
