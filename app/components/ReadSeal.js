'use client';

import { useEffect, useRef, useState } from 'react';

// The Sealed Companion — a wax-seal read counter that draws itself as the last
// page closes. Shared by the story page (cream ground, ink number) and the book
// reader's end card (dark ground, light number) so both get the exact same
// markup, CSS and ceremony. `active` is the trigger: the story page passes
// endReached (the sentinel observer), the reader passes true on end-card mount.
//
// Ceremony (chained via transition-delays, mirroring the ✦ + rule staging):
//   outer ring draws (stroke-dashoffset 283→0, 1.1s) → inner ring + content fade
//   in mid-draw → the number counts 0→N (1.1s, rAF) → the caption rises last.
// prefers-reduced-motion: everything static-visible, final number immediately.
const prefersReduce = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function ReadSeal({ count, active, ink = '#1a1a1a' }) {
  // A read of 0 / unavailable shows "—" and skips the count-up.
  const has = typeof count === 'number' && count > 0;
  const [display, setDisplay] = useState(0);
  const [on, setOn] = useState(false);
  const started = useRef(false);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!active) return undefined;
    setOn(true);
    if (!has) return undefined;
    if (prefersReduce()) { setDisplay(count); return undefined; }
    if (started.current) return undefined;
    started.current = true;
    // Count-up begins mid-ceremony, as the seal content fades in.
    const startDelay = 2000;
    const duration = 1100;
    const t = setTimeout(() => {
      const t0 = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 3); // cubic ease-out
        setDisplay(Math.round(count * eased));
        if (p < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, startDelay);
    return () => { clearTimeout(t); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active, has, count]);

  const shown = has ? display.toLocaleString() : '—';

  return (
    <div className={`rs-wrap${on ? ' on' : ''}`}>
      <style>{`
        .rs-wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .rs-seal { position: relative; width: 92px; height: 92px; }
        .rs-seal svg { display: block; width: 92px; height: 92px; }
        .rs-ring-outer { fill: none; stroke: rgba(201,168,76,0.6); stroke-width: 1; stroke-dasharray: 283; stroke-dashoffset: 283; transform: rotate(-90deg); transform-origin: center; transition: stroke-dashoffset 1100ms cubic-bezier(0.65,0,0.35,1) 1500ms; }
        .rs-ring-inner { fill: none; stroke: rgba(201,168,76,0.25); stroke-width: 1; opacity: 0; transition: opacity 600ms ease 2000ms; }
        .rs-content { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; opacity: 0; transition: opacity 600ms ease 2000ms; }
        .rs-num { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.55rem; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
        .rs-label { font-family: 'Cinzel', serif; font-size: 0.44rem; letter-spacing: 0.32em; color: #a8862f; text-transform: uppercase; }
        .rs-caption { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 0.95rem; font-style: italic; opacity: 0; transform: translateY(6px); transition: opacity 700ms ease 3100ms, transform 700ms ease 3100ms; }
        .rs-wrap.on .rs-ring-outer { stroke-dashoffset: 0; }
        .rs-wrap.on .rs-ring-inner { opacity: 1; }
        .rs-wrap.on .rs-content { opacity: 1; }
        .rs-wrap.on .rs-caption { opacity: 0.5; transform: translateY(0); }
        @media (prefers-reduced-motion: reduce) {
          .rs-ring-outer { stroke-dashoffset: 0; transition: none; }
          .rs-ring-inner, .rs-content { opacity: 1; transition: none; }
          .rs-caption { opacity: 0.5; transform: none; transition: none; }
        }
      `}</style>
      <div className="rs-seal">
        <svg viewBox="0 0 92 92" aria-hidden="true">
          <circle className="rs-ring-outer" cx="46" cy="46" r="45" />
          <circle className="rs-ring-inner" cx="46" cy="46" r="40" />
        </svg>
        <div className="rs-content">
          <span className="rs-num" style={{ color: ink }}>{shown}</span>
          <span className="rs-label">Reads</span>
        </div>
      </div>
      <span className="rs-caption" style={{ color: ink }}>on the island</span>
    </div>
  );
}
