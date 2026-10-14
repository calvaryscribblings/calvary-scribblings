'use client';
// READERS' NOTES — THE QUESTION CARDS (W46, §4).
//
// Sealed: Sit with this is shown (it is public, ruling 162); Take a side and The line sit under
// wax seals with their counts only. Joining and open: the three questions in full, plus the
// dashed "Or tell us…" card. Every action is a real button or link, 44px or more.
import Link from 'next/link';
import { NOTES_COPY, QUESTION_LABEL, sideOptions } from '../../lib/series/notes';
import { C, DISPLAY, labelStyle, questionStyle } from './tokens';
import { WaxSeal } from './Parts';
import SideBars from './Bars';

const cardStyle = { padding: '18px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 220, boxSizing: 'border-box', height: '100%' };

const Count = ({ n, href }) => (href
  ? <Link href={href} className="sn-text sn-link" style={{ color: C.link, paddingLeft: 0 }}>{NOTES_COPY.answers(n)}</Link>
  : <span style={{ fontFamily: DISPLAY, fontSize: 16, color: C.quiet }}>{NOTES_COPY.answers(n)}</span>);

/** A sealed question: the wax seal and its count, nothing of its words. */
export function SealedCard({ kind, count, roman }) {
  return (
    <div className="sn-card" data-question={kind} data-sealed="true" style={{ ...cardStyle, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <span style={labelStyle(C.gold, 9.5)}>{QUESTION_LABEL[kind]}</span>
      <WaxSeal numeral={roman} label={`${QUESTION_LABEL[kind]}, ${NOTES_COPY.sealed}`} />
      <span style={labelStyle(C.muted, 9)}>{NOTES_COPY.sealed}</span>
      <Count n={count} />
    </div>
  );
}

/** Sit with this. `onWrite` absent = shown for reading only (the sealed room). */
export function SitCard({ question, count, onWrite }) {
  return (
    <div className="sn-card" data-question="sit" style={cardStyle}>
      <span style={labelStyle(C.gold, 9.5)}>{QUESTION_LABEL.sit}</span>
      <p style={{ ...questionStyle(22), flex: 1 }}>{question}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Count n={count} />
        {onWrite && <button type="button" className="sn-btn sn-gold" onClick={onWrite}>{NOTES_COPY.leaveNote}</button>}
      </div>
    </div>
  );
}

/** Take a side: the sides as buttons, or — once chosen — the split with the reader's side marked. */
export function SideCard({ side, mySide, tallies, count, busy, onChoose, onWrite, viewHref, animate = false }) {
  const opts = sideOptions(side);
  const optText = Object.fromEntries(opts);
  return (
    <div className="sn-card" data-question="side" style={cardStyle}>
      <span style={labelStyle(C.gold, 9.5)}>{mySide ? NOTES_COPY.tookASide(optText[mySide] || mySide) : QUESTION_LABEL.side}</span>
      <p style={questionStyle(22)}>{side?.text}</p>
      {mySide && tallies ? (
        <SideBars options={opts} tallies={tallies} mine={mySide} animate={animate} />
      ) : (
        <div role="group" aria-label={QUESTION_LABEL.side} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {opts.map(([k, t]) => (
            <button key={k} type="button" className="sn-btn sn-secondary" disabled={busy} onClick={() => onChoose?.(k)} data-side-option={k}
              style={{ fontFamily: DISPLAY, fontSize: 18, letterSpacing: 0, textTransform: 'none', fontWeight: 500, flex: '1 1 120px' }}>{t}</button>
          ))}
        </div>
      )}
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Count n={count} href={mySide ? viewHref : null} />
        {mySide && onWrite && <button type="button" className="sn-btn sn-gold" onClick={onWrite}>{NOTES_COPY.sayWhy(optText[mySide] || mySide)}</button>}
      </div>
    </div>
  );
}

/** The line. */
export function LineCard({ question, count, onWrite, viewHref }) {
  return (
    <div className="sn-card" data-question="line" style={cardStyle}>
      <span style={labelStyle(C.gold, 9.5)}>{QUESTION_LABEL.line}</span>
      <p style={{ ...questionStyle(22), flex: 1 }}>{question}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Count n={count} href={viewHref} />
        {onWrite && <button type="button" className="sn-btn sn-gold" onClick={onWrite}>{NOTES_COPY.leaveNote}</button>}
      </div>
    </div>
  );
}

/** The dashed fourth card: "Or tell us about anything else from {N} that stayed with you." */
export function ElseCard({ N, onWrite }) {
  return (
    <button type="button" className="sn-card-btn" data-question="else" onClick={onWrite}
      style={{ padding: '16px', borderRadius: 14, border: '1px dashed rgba(201,168,76,0.45)', minHeight: 64 }}>
      <span style={{ ...questionStyle(20), color: C.muted, display: 'block' }}>{NOTES_COPY.elseCard(N)}</span>
    </button>
  );
}
