'use client';
// Arrival half of the gateway's door transition, for BOTH doors (W32): the Public Library
// (app/public-library/layout.js) and the Book Store (app/bookstore/page.js). The gateway sets
// sessionStorage 'cs_arriving' to the DESTINATION PATH just before pushing; the page holds at
// full black and then fades up from the same veil the door closed with, so the two halves read
// as one move.
//
// W32 — THE FLAG NAMES ITS ROUTE. It was '1', read by whichever ArrivalVeil mounted, which is why
// W31 kept the Book Store door from setting it (a stray flag would have played the veil on the
// next Home visit) — and so the storefront drew in pieces in full view: Ikenna's "flash". Now it
// is '/public-library' or '/bookstore', a veil plays ONLY when the flag names its own `route` AND
// the page is on that route, and ANY flag this reads is cleared. A stray flag cannot play a veil
// anywhere by construction.
//
// Without a matching flag — direct visits, refresh, back-button, every other route — this renders
// its children with no veil, no transform and no animation.
//
// ARRIVED, AND STAYS ARRIVED. The wrapper carries data-arrival="" from the moment a veil starts
// until the page unmounts, so a page can switch off its OWN entrance animations while the lift is
// the entrance (the storefront's masthead and shop bar). A class that came off at 'idle' would
// start those animations the instant the lift ended.
//
// It never gates data fetching: the page mounts and its Firebase listeners attach underneath
// the veil as normal. The veil waits for them, rather than the other way round.
//
// STRUCTURAL RULE: the wrapper <div> is rendered on EVERY path, and only its className
// changes. An earlier version returned `children` bare when idle and a wrapped tree while
// arriving; toggling between those two shapes made React unmount and rebuild the entire
// library twice — resetting its state back to the skeleton in full view after the veil had
// already lifted. Never make the tree shape depend on transition state.
import {
  useState, useLayoutEffect, useEffect, useRef, useCallback, useContext, createContext,
} from 'react';
import {
  ARRIVE_HOLD, ARRIVE_FADE, ARRIVE_MAX_WAIT, ARRIVE_RISE_PX, ARRIVE_EASE,
} from '../lib/gatewayTransition';

export const ARRIVING_KEY = 'cs_arriving';

// '/bookstore/' and '/bookstore' are the same route (a static host may add the slash).
const samePath = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

const ReadyContext = createContext(null);
const RiseContext = createContext('');

// W32 — WHERE THE RISE GOES. By default (the Library) the wrapper itself rises. But a transform
// on an ancestor becomes the containing block of every position:fixed descendant: a page that
// renders its own fixed chrome inside the wrapper (the storefront's Navbar and TabBar) would have
// its tab bar pinned to the bottom of the WHOLE PAGE for the length of the lift, then snap back
// into the viewport at full strength when the lift ends. With rise="page" the wrapper stays
// untransformed and the page puts this class on its own content box (the storefront's <main>);
// the fixed chrome stays where it lives, under the veil, and is uncovered by the fade.
export function useArrivalRise() {
  return useContext(RiseContext);
}

// Called by the page inside the veil to report that it has real content to show — pass its
// existing first-data condition. Inert on every route that doesn't call it (the cap lifts
// the veil regardless), and inert when there's no veil to lift.
export function useArrivalReady(ready) {
  const signal = useContext(ReadyContext);
  useEffect(() => {
    if (ready && signal) signal();
  }, [ready, signal]);
}

// The flag must be read before the browser paints, or the library would flash unveiled for
// a frame before the veil mounted. useLayoutEffect does that, but doesn't exist on the
// server — fall back to useEffect there (it never runs: the server pass is always idle).
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default function ArrivalVeil({ route, rise = 'wrapper', children }) {
  // 'idle'    — no transition: no veil, no transform, nothing animating.
  // 'holding' — veil at full black, waiting for content (at least ARRIVE_HOLD).
  // 'lifting' — veil fading out, content settling.
  // Ends at 'done' (no veil, no class) so the transform is REMOVED rather than left at translateY(0) —
  // a lingering transform would make this element the containing block for the library's
  // position:fixed navbar and break it on scroll.
  // 'done'    — (W32) the veil has lifted: like 'idle' (no veil, no transform), but the page
  //             arrived through a door, so data-arrival stays on the wrapper.
  const [phase, setPhase] = useState('idle');
  const startedAt = useRef(0);
  const lifted = useRef(false);
  const timers = useRef([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  // Lift now, or at the end of the hold if the beat hasn't been served yet. Whichever of
  // content-ready and the cap gets here first wins; the rest are no-ops.
  const beginLift = useCallback(() => {
    if (lifted.current) return;
    lifted.current = true;
    const elapsed = performance.now() - startedAt.current;
    const wait = Math.max(0, ARRIVE_HOLD - elapsed);
    timers.current.push(setTimeout(() => {
      setPhase('lifting');
      timers.current.push(setTimeout(() => setPhase('done'), ARRIVE_FADE));
    }, wait));
  }, []);

  useIsomorphicLayoutEffect(() => {
    let flagged = false;
    try {
      const flag = sessionStorage.getItem(ARRIVING_KEY);
      // Consume ANY flag, matching or not: a refresh after arriving must load plainly, and a flag
      // naming another route must not outlive this page.
      if (flag !== null) sessionStorage.removeItem(ARRIVING_KEY);
      flagged = !!route && flag === route && samePath(window.location.pathname, route);
    } catch {}
    if (!flagged) return;
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    } catch {}
    startedAt.current = performance.now();
    setPhase('holding');
    // Never trap anyone in the dark on a slow connection.
    timers.current.push(setTimeout(beginLift, ARRIVE_MAX_WAIT));
  }, [beginLift, route]);

  // Stable identity: a changing signal would re-fire the consumer's effect.
  const signalReady = useCallback(() => {
    if (startedAt.current === 0) return; // no veil in play
    beginLift();
  }, [beginLift]);

  const arriving = phase === 'holding' || phase === 'lifting';
  const arrived = phase !== 'idle';
  const riseClass = arriving ? `cs-arrive-rise${phase === 'lifting' ? ' is-lifting' : ''}` : '';
  const wrapperClass = rise === 'page' ? '' : riseClass;

  return (
    <ReadyContext.Provider value={signalReady}>
    <RiseContext.Provider value={rise === 'page' ? riseClass : ''}>
      {arriving && (
        <style>{`
          @keyframes cs-arrive-veil-out { from { opacity:1; } to { opacity:0; } }
          @keyframes cs-arrive-rise {
            from { transform:translateY(${ARRIVE_RISE_PX}px); }
            to { transform:translateY(0); }
          }
          .cs-arrive-veil {
            position:fixed; inset:0; background:#050309; opacity:1;
            /* Above the library's fixed navbar (z 1000) AND the cookie banner (z 9999), so
               the veil the gateway closed with is the same veil that opens here. */
            pointer-events:none; z-index:10000;
          }
          .cs-arrive-veil.is-lifting {
            animation:cs-arrive-veil-out ${ARRIVE_FADE}ms ${ARRIVE_EASE} forwards;
          }
          /* Held at the offset while black, then animated home exactly once. The animation
             lives on this wrapper and is never keyed to the page's data state, so a
             skeleton→content swap inside cannot replay the entrance. */
          .cs-arrive-rise { transform:translateY(${ARRIVE_RISE_PX}px); }
          .cs-arrive-rise.is-lifting {
            animation:cs-arrive-rise ${ARRIVE_FADE}ms ${ARRIVE_EASE} forwards;
          }
        `}</style>
      )}
      {arriving && <div className={`cs-arrive-veil${phase === 'lifting' ? ' is-lifting' : ''}`} aria-hidden="true" />}
      {/* Always rendered, always the same element — see STRUCTURAL RULE above. */}
      <div className={wrapperClass} data-arrival={arrived ? '' : undefined}>{children}</div>
    </RiseContext.Provider>
    </ReadyContext.Provider>
  );
}
