// SAFETY-2B.1 — the one instant the bell spec (tests/notify/bell.spec.mjs) is dated from.
//
// The bell's TODAY is London's calendar day (sectionOf in app/lib/bell.js). The spec dates its
// "today" fixtures minutes before its instant, so at 00:12 London on 14 Nov, with the instant at the
// real time, they fell on the 13th, the page drew THIS WEEK and EARLIER only, and the full-page case
// went red on main. The instant therefore has to leave room in its London day for every fixture
// meant to be TODAY:
//
//   · the real time, when London's day so far already holds them all (TODAY_SPAN_MIN minutes);
//   · otherwise, just after midnight, an instant on the evening before (6½ hours back at most),
//     whose London day holds them all.
//
// It is never in the future (the database's rules check seenAt against the emulator's real `now`),
// and it is at most six and a half hours old. The page's clock is pinned to it with Playwright's
// page.clock.setFixedTime, an ABSOLUTE time: setting it again sets the same value, so it cannot
// stack the way the spec's old relative shift of Date did under next dev. The spec asserts the
// page's Date.now() equals the instant exactly after every load.

import { sectionOf } from '../../app/lib/bell.js';

const MIN = 60000;

/**
 * The oldest fixture meant to be TODAY is the reaction group's firstAt, 300 minutes back (its `at`
 * is 40); the room asked for is that plus half an hour.
 */
export const TODAY_SPAN_MIN = 330;

/** The instant the spec and its page run at, for a real time `now`. */
export function bellInstant(now = Date.now()) {
  // Asked of the page's own rule, in real elapsed time: counting wall-clock minutes since midnight
  // overcounts by an hour on the spring-forward day (05:30 BST is 270 minutes into the day).
  if (sectionOf(now - TODAY_SPAN_MIN * MIN, now) === 'TODAY') return now;
  // London midnight lies inside the span, so step back past all of it and an hour more: the
  // instant is in the evening before, and the span behind it is inside that day.
  return now - (TODAY_SPAN_MIN + 60) * MIN;
}

/**
 * The runner's "now". BELL_SPEC_NOW (an ISO instant, never in the future) fakes it, so the spec can
 * be proven at a chosen London hour; the page follows, since it is pinned to bellInstant(this).
 */
export function runnerNow(env = process.env, real = Date.now()) {
  if (!env.BELL_SPEC_NOW) return real;
  const t = Date.parse(env.BELL_SPEC_NOW);
  if (!Number.isFinite(t)) throw new Error('BELL_SPEC_NOW is not a date');
  if (t > real) throw new Error('BELL_SPEC_NOW is in the future; the emulator\'s rules run on the real clock');
  return t;
}
