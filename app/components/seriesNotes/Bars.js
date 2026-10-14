'use client';
// READERS' NOTES — the Take a side bars (W46, §5 and the question view).
//
// They fill ONCE to their share (~600ms, ease-out) and their numbers count up; under
// prefers-reduced-motion both arrive at once. Every bar carries its words (barLabel:
// "Freedom, 58 percent, your side") so colour is never the only signal, and the reader's own
// side is marked in text and with a check, not only in gold.
import { useEffect, useState } from 'react';
import { barLabel, tallyShares } from '../../lib/series/notes';
import { C, DISPLAY, LABEL } from './tokens';
import { CheckIcon, useCountUp, useReducedMotion } from './Parts';

function Bar({ text, share, mine, run, reduce }) {
  const animate = run && !reduce;
  const [grown, setGrown] = useState(0);
  useEffect(() => {
    if (!animate) return undefined;
    // Two frames, so the bar paints at zero before it fills.
    let id2 = 0;
    const id = requestAnimationFrame(() => { id2 = requestAnimationFrame(() => setGrown(share)); });
    return () => { cancelAnimationFrame(id); cancelAnimationFrame(id2); };
  }, [share, animate]);
  const width = animate ? grown : share;
  const shown = useCountUp(share, run);
  return (
    <li data-bar data-mine={mine ? 'true' : 'false'} data-label={barLabel(text, share, mine)}
      style={{ listStyle: 'none', position: 'relative', borderRadius: 12, overflow: 'hidden', minHeight: 48,
        border: `1px solid ${mine ? 'rgba(201,168,76,0.6)' : 'rgba(255,255,255,0.12)'}`, background: 'rgba(255,255,255,0.03)' }}>
      <span className="sn-sr">{barLabel(text, share, mine)}</span>
      <span aria-hidden="true" className="sn-bar-fill" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${width}%`,
        background: mine ? 'linear-gradient(90deg, rgba(124,58,237,0.55), rgba(201,168,76,0.45))' : 'rgba(124,58,237,0.28)' }} />
      <span aria-hidden="true" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', minHeight: 48, boxSizing: 'border-box' }}>
        <span style={{ flex: 1, fontFamily: DISPLAY, fontSize: 18, color: C.cream, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {mine && <CheckIcon color={C.goldTint} />}
          {text}
        </span>
        <span data-bar-value style={{ fontFamily: LABEL, fontSize: 14, color: mine ? C.goldTint : C.muted, letterSpacing: '0.06em' }}>{shown}%</span>
      </span>
    </li>
  );
}

/**
 * <SideBars options={[['a','Freedom'],…]} tallies={{a:3,b:1}} mine="a" animate />
 * `animate` false draws them at their share at once (a returning reader, not a fresh choice).
 */
export default function SideBars({ options = [], tallies = {}, mine = null, animate = true }) {
  const reduce = useReducedMotion();
  const shares = tallyShares(tallies, options.map(([k]) => k));
  return (
    <ul data-side-bars style={{ display: 'grid', gap: 10, margin: 0, padding: 0 }}>
      {options.map(([k, text]) => (
        <Bar key={k} text={text} share={shares[k] || 0} mine={mine === k} run={animate} reduce={reduce} />
      ))}
    </ul>
  );
}
