'use client';
// Arrival half of the gateway's door transition. The gateway sets sessionStorage 'cs_arriving'
// just before pushing here; if it's set, the library holds a beat at full black and then fades
// up from the same veil the door closed with, so the two halves read as one move.
//
// Without the flag — direct visits, refresh, back-button, every other route — this renders
// its children and nothing else. It never gates data fetching: the page mounts and its
// Firebase listeners attach underneath the veil as normal, so the fade reveals a ready page
// rather than a loading one.
import { useState, useLayoutEffect, useEffect } from 'react';
import { ARRIVE_HOLD, ARRIVE_FADE, ARRIVE_RISE_PX, ARRIVE_EASE } from '../lib/gatewayTransition';

const ARRIVING_KEY = 'cs_arriving';

// The flag must be read before the browser paints, or the library would flash unveiled for
// a frame before the veil mounted. useLayoutEffect does that, but doesn't exist on the
// server — fall back to useEffect there (it never runs: the server pass is always idle).
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default function ArrivalVeil({ children }) {
  // false: normal load, no veil, no transform.
  // true: holding at black, then the veil lifts and the content settles.
  // It ends back at false so the transform is REMOVED rather than left at translateY(0) —
  // a lingering transform would make this element the containing block for the library's
  // position:fixed navbar and break it on scroll.
  const [arriving, setArriving] = useState(false);

  useIsomorphicLayoutEffect(() => {
    let flagged = false;
    try {
      flagged = sessionStorage.getItem(ARRIVING_KEY) === '1';
      // Consume it immediately: a refresh after arriving must load plainly.
      if (flagged) sessionStorage.removeItem(ARRIVING_KEY);
    } catch {}
    if (!flagged) return;
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    } catch {}
    setArriving(true);
  }, []);

  useEffect(() => {
    if (!arriving) return;
    const t = setTimeout(() => setArriving(false), ARRIVE_HOLD + ARRIVE_FADE);
    return () => clearTimeout(t);
  }, [arriving]);

  if (!arriving) return children;

  return (
    <>
      <style>{`
        @keyframes cs-arrive-veil-out { from { opacity:1; } to { opacity:0; } }
        @keyframes cs-arrive-rise {
          from { transform:translateY(${ARRIVE_RISE_PX}px); }
          to { transform:translateY(0); }
        }
        .cs-arrive-veil {
          position:fixed; inset:0; background:#050309; opacity:1;
          /* Above the library's fixed navbar (z 1000) AND the cookie banner (z 9999), so the
             veil the gateway closed with is the same veil that opens here. */
          pointer-events:none; z-index:10000;
          /* The delay is the hold: opacity sits at its initial 1 until the animation starts. */
          animation:cs-arrive-veil-out ${ARRIVE_FADE}ms ${ARRIVE_EASE} ${ARRIVE_HOLD}ms both;
        }
        .cs-arrive-rise {
          animation:cs-arrive-rise ${ARRIVE_FADE}ms ${ARRIVE_EASE} ${ARRIVE_HOLD}ms both;
        }
      `}</style>
      <div className="cs-arrive-veil" aria-hidden="true" />
      <div className="cs-arrive-rise">{children}</div>
    </>
  );
}
