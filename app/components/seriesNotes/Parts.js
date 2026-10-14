'use client';
// READERS' NOTES — small shared parts (W46): SVG icons (no emoji, house rule), the wax seal,
// the house progress rule, faces, and the reduced-motion hook.
import { useEffect, useState } from 'react';
import { C, LABEL, labelStyle } from './tokens';
import { progressPercent } from './roomModel';

export function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

/**
 * A number that counts up to `target` once (~600ms, ease-out) while `run` is true; at rest, and
 * always under reduced motion, it is simply the target.
 */
export function useCountUp(target, run) {
  const reduce = useReducedMotion();
  const animate = run && !reduce;
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!animate) return undefined;
    let raf = 0;
    const start = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - start) / 600);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);
  return animate ? v : target;
}

const svg = (size) => ({ width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: 'false' });

export const ArrowIcon = ({ size = 16, color = 'currentColor' }) => (
  <svg {...svg(size)} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
);
export const BackIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg {...svg(size)} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12H5M11 6l-6 6 6 6" /></svg>
);
export const LockIcon = ({ size = 13, color = 'currentColor' }) => (
  <svg {...svg(size)} fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);
export const KeyholeIcon = ({ size = 30, color = C.gold }) => (
  <svg {...svg(size)} fill={color}><circle cx="12" cy="9" r="4" /><path d="M10.2 11.5h3.6L15 20H9z" /></svg>
);
export const MoreIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg {...svg(size)} fill={color}><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
);
export const CloseIcon = ({ size = 18, color = 'currentColor' }) => (
  <svg {...svg(size)} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
/** The hanging gold quote mark set before a chosen line. */
export const QuoteMark = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" fill={C.gold}>
    <path d="M6 22c0-6 3-10 8-12l1 2c-3 1.5-4.5 3.5-4.8 6H14v8H6zM18 22c0-6 3-10 8-12l1 2c-3 1.5-4.5 3.5-4.8 6H26v8h-8z" />
  </svg>
);
export const CheckIcon = ({ size = 14, color = 'currentColor' }) => (
  <svg {...svg(size)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

/** The wax seal: a #5a1d2a disc, a dashed #7a2c3b rim, an inner ring, the numeral in Cinzel. */
export function WaxSeal({ numeral, size = 54, label }) {
  return (
    <span role="img" aria-label={label} style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true" focusable="false" style={{ position: 'absolute', inset: 0 }}>
        <circle cx="30" cy="30" r="28" fill={C.seal} stroke={C.sealRim} strokeWidth="2.5" strokeDasharray="3 2.4" />
        <circle cx="30" cy="30" r="20" fill="none" stroke="rgba(243,217,176,0.4)" strokeWidth="1" />
      </svg>
      <span aria-hidden="true" style={{ position: 'relative', fontFamily: LABEL, color: C.sealInk, fontSize: size * 0.3, fontWeight: 600, letterSpacing: '0.04em' }}>{numeral}</span>
    </span>
  );
}

/** The house progress rule: violet to gold, a lit cap, the percent in Cinzel. */
export function ProgressRule({ fraction }) {
  const p = progressPercent(fraction);
  return (
    <div data-progress={p} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span aria-hidden="true" style={{ position: 'relative', flex: 1, height: 3, borderRadius: 2, background: 'rgba(245,240,232,0.14)' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p}%`, borderRadius: 2, background: `linear-gradient(90deg, ${C.violet}, ${C.violetHi} 45%, ${C.gold})` }} />
        <span style={{ position: 'absolute', top: '50%', left: `${p}%`, width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5, borderRadius: '50%', background: C.goldTint, boxShadow: '0 0 10px 3px rgba(226,196,122,0.55)' }} />
      </span>
      <span style={{ fontFamily: LABEL, fontSize: 13, letterSpacing: '0.08em', color: C.goldTint }}>{p}%</span>
    </div>
  );
}

/** Up to four faces: a picture or initials. Decorative; the count beside them says it. */
export function Faces({ faces = [], size = 26 }) {
  if (!faces.length) return null;
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex' }}>
      {faces.slice(0, 4).map((f, i) => (
        <span key={i} data-face style={{
          width: size, height: size, borderRadius: '50%', marginLeft: i ? -8 : 0, border: `1.5px solid ${C.card}`,
          background: f.photoURL ? `center/cover no-repeat url(${JSON.stringify(f.photoURL)})` : '#2a1d47',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: LABEL, fontSize: size * 0.36, color: C.cream, flexShrink: 0,
        }}>{f.photoURL ? null : (f.initials || 'R')}</span>
      ))}
    </span>
  );
}

export const Kicker = ({ children, color = C.gold, size = 9.5, as: Tag = 'span', style }) => (
  <Tag style={{ ...labelStyle(color, size), display: 'block', ...style }}>{children}</Tag>
);
