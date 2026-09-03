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

// R34 — THE THIRD BRANCH.
//
// This hook shipped answering two questions, `visible` and `open`, and every
// caller read them as a pair: open ? "Now on" : "Starts 1 August". That is a
// two-valued answer to a three-valued question. `visible` runs for a fortnight
// past the close so the certified board stays linked while places are paid, and
// for the whole of that fortnight `open` is false — so the banner sitting above
// a frozen, certified board advertised a start date already a month in the past.
// Thirteen winners read it.
//
// `closed` is the missing branch and `phase` is the shape that makes the mistake
// hard to repeat: a caller that switches on `phase` gets a compile-visible list
// of the cases it has to answer, where `open ? a : b` silently folds two of them
// together. The word for the closed branch is CLOSED, which is what the app
// already says — the two surfaces should not disagree about a fact this plain.
//
// The clock, not the data, decides this. Whether the closing capture has landed
// is a different question, answered by the two-term frozen predicate inside
// SeasonBoard (final present AND closedAt a number). A banner saying "closed"
// after the window ends is true whether or not the capture has been taken; the
// board below it is what distinguishes "closing" from "closed".

/**
 * @param board  a config object from app/lib/leaderboards.js
 * @param leadInDays  how long before startsAt the banner starts teasing
 * @param tailDays    how long after endsAt it lingers while results are certified
 * @returns { visible, open, closed, phase } — phase is 'hidden' | 'pre' | 'open' | 'closed'.
 *          During prerender and first paint everything is false and phase is 'hidden'.
 */
export function useContestPhase(board, leadInDays = 7, tailDays = 14) {
  const now = useSyncExternalStore(subscribe, nowSnapshot, serverSnapshot);
  if (!now) return { visible: false, open: false, closed: false, phase: 'hidden' };

  const visible = now >= board.startsAt - leadInDays * DAY && now <= board.endsAt + tailDays * DAY;
  const open    = now >= board.startsAt && now <= board.endsAt;
  const closed  = now > board.endsAt;

  return { visible, open, closed, phase: !visible ? 'hidden' : open ? 'open' : closed ? 'closed' : 'pre' };
}
