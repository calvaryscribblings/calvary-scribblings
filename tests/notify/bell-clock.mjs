// BELL-1 (after SAFETY-2B.1, f85b86c4, reverted in 832abe4a) — the one instant the bell spec
// (tests/notify/bell.spec.mjs) is dated from.
//
// The bell's TODAY is London's calendar day (sectionOf in app/lib/bell.js). The spec dates its
// "today" fixtures minutes before its instant, so in about the first 90 minutes after London midnight,
// with the instant at the real time, they fell on the day before and the page drew THIS WEEK for
// them: the spec failed by the hour. The instant therefore has to leave room in its London day for
// every fixture meant to be TODAY:
//
//   · the real time, when London's day so far already holds them all (TODAY_SPAN_MIN minutes);
//   · otherwise, just after midnight, an instant on the evening before (6½ hours back at most),
//     whose London day holds them all.
//
// SELF-CONTAINED, ON PURPOSE. f85b86c4 asked app/lib/bell.js's sectionOf, and under Playwright's
// loader on CI's Node 22 that import failed ("request for '../../app/lib/taxonomy.js' is from a
// module not been linked"), so rules-browsers found no tests and the round was reverted. This file
// imports nothing: London's date comes from Intl. tests/ci/bell-clock.test.mjs (node --test, which
// loads app code on Node 22) proves it agrees with the page's own sectionOf at every five minutes of
// an ordinary day and both 2026 clock-change days, and fails if this file or the spec ever imports
// app code again.
//
// It is never in the future (the database's rules check seenAt against the emulator's real `now`),
// and it is at most six and a half hours old. The page's clock is pinned to it with Playwright's
// page.clock.setFixedTime, an ABSOLUTE time: setting it again sets the same value, so it cannot
// stack the way the spec's old relative shift of Date did under next dev.

const MIN = 60000;

/**
 * The oldest fixture meant to be TODAY is the reaction group's firstAt, 300 minutes back (its `at`
 * is 40); the room asked for is that plus half an hour.
 */
export const TODAY_SPAN_MIN = 330;

const LONDON_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
/** London's calendar date of an instant, as YYYY-MM-DD. */
export const londonDate = (t) => LONDON_DAY.format(new Date(t));

/** The instant the spec and its page run at, for a real time `now`. */
export function bellInstant(now = Date.now()) {
  // Real elapsed time, not wall-clock minutes: on the spring-forward day 05:30 BST is 270 minutes in.
  if (londonDate(now - TODAY_SPAN_MIN * MIN) === londonDate(now)) return now;
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
