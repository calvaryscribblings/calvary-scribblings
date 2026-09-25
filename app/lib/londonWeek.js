// THE LONDON WEEK — the one clock the free week runs on. W4, ruled by Ikenna 24–25 Sep 2026.
//
// A week is Monday 00:00 to Sunday 23:59:59.999, Europe/London. Every story published in a
// week is free to everyone until that week ends; at Monday 00:00 London the whole week goes to
// the archive together — the story published on Sunday night included. No story calculates a
// window of its own: its free time ends when ITS WEEK ends, and every story of a week ends at
// the same instant.
//
// Pure, and platform-neutral: Intl with timeZone 'Europe/London' is in every browser, in Node
// and in the Workers runtime. The app's port (lib/londonWeek.ts) must agree with this by VALUE;
// app/lib/storyAccess.parity.json is the fixture both sides run.
//
// ── WHY MIDNIGHT IS NEVER AMBIGUOUS ──────────────────────────────────────────────────────
// UK clocks change at 01:00 UTC on a Sunday (last Sunday of March and of October). A Monday
// 00:00 London is therefore always a single instant, at +00:00 or +01:00, and the offset at
// that instant is the offset of the whole preceding Sunday afternoon. londonMidnightUtc() asks
// Intl for the offset AT the candidate instant, so it holds across both changes.

const DAY_MS = 86400000;

let fmt = null;
function londonParts(ms) {
  fmt ||= new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    hh: Number(p.hour), mm: Number(p.minute), ss: Number(p.second),
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday),   // 0 = Monday
  };
}

/** London's offset from UTC, in ms, at the instant `ms` (0 in GMT, 3600000 in BST). */
export function londonOffsetMs(ms) {
  const p = londonParts(ms);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The UTC instant of 00:00 London on the calendar date y-m-d (m is 1-based). */
export function londonMidnightUtc(y, m, d) {
  const naive = Date.UTC(y, m - 1, d);
  // Try the offset in force at the naive instant, then correct once: midnight is never inside
  // a transition, so one correction always lands.
  const guess = naive - londonOffsetMs(naive);
  return naive - londonOffsetMs(guess);
}

/** The Monday 00:00 London that begins the week containing `ms`. */
export function londonWeekStart(ms) {
  const p = londonParts(ms);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d) - p.weekday * DAY_MS);
  return londonMidnightUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
}

/** The Monday 00:00 London that ENDS the week containing `ms` (the next week's start). */
export function londonNextWeekStart(ms) {
  const p = londonParts(ms);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d) + (7 - p.weekday) * DAY_MS);
  return londonMidnightUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
}

/** The last millisecond of the London week containing `ms`: Sunday 23:59:59.999. */
export const londonWeekEnd = (ms) => londonNextWeekStart(ms) - 1;

/** Is `ms` within one tick after a Monday 00:00 London? For the scheduled rebuild. */
export function isJustAfterLondonMonday(ms, windowMs = 15 * 60000) {
  const start = londonWeekStart(ms);
  return ms >= start && ms - start < windowMs;
}
