'use client';

// Where "now" sits relative to a contest board's window.
//
// Every contest banner needs this, and the obvious implementation gets it wrong
// twice over. These pages are prerendered to static HTML at build time
// (next.config.mjs sets output: 'export'), so calling Date.now() during render
// means a build-time clock decides what the HTML says while a runtime clock
// decides what React renders on hydration — a mismatch that widens the longer a
// deploy sits. React Compiler flags it as react-hooks/purity. Moving the clock
// read into an effect fixes the mismatch but trips react-hooks/set-state-in-effect.
//
// useSyncExternalStore is the primitive built for this: a value the server
// cannot know, with an explicit server snapshot. The prerendered HTML gets
// `hidden`, which is also the honest answer — a contest banner baked into static
// HTML at build time would be stale by the time anyone read it. React swaps in
// the client snapshot on hydration.

import { useSyncExternalStore } from 'react';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

// getSnapshot must return a value that is stable between calls within a render,
// or React re-renders forever chasing it. Bucketing the clock to the minute
// makes it stable at far finer resolution than any window boundary needs.
let bucket = -1;
let bucketedNow = 0;
function nowSnapshot() {
  const b = Math.floor(Date.now() / MINUTE);
  if (b !== bucket) { bucket = b; bucketedNow = b * MINUTE; }
  return bucketedNow;
}

// Nothing pushes updates; the value refreshes on the next render the page does
// anyway. A contest window is measured in weeks — it does not need a ticker.
const subscribe = () => () => {};

// 0 is before every real window, so the server snapshot renders nothing.
const serverSnapshot = () => 0;

/**
 * @param board  a config object from app/lib/leaderboards.js
 * @param leadInDays  how long before startsAt the banner starts teasing
 * @param tailDays    how long after endsAt it lingers while results are certified
 * @returns { visible, open } — both false during prerender and first paint.
 */
export function useContestPhase(board, leadInDays = 7, tailDays = 14) {
  const now = useSyncExternalStore(subscribe, nowSnapshot, serverSnapshot);
  if (!now) return { visible: false, open: false };
  return {
    visible: now >= board.startsAt - leadInDays * DAY && now <= board.endsAt + tailDays * DAY,
    open:    now >= board.startsAt && now <= board.endsAt,
  };
}
