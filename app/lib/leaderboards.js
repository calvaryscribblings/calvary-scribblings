// Contest board configuration.
//
// One entry per board. The board component (R1) takes a config object as props
// — boardId, window, prizes, copy — so a new board is an entry here plus a
// route file, not new component work. The weekly board is a config call away:
// add a WEEKLY entry with kind 'weekly' and a Monday 00:00 London window, and
// point a route at it.
//
// Data for every board lives under leaderboards/{boardId} in RTDB:
//   snapshot/{uid} = { points, reads }   opening baseline (absent ⇒ 0/0)
//   final/{uid}    = { points, reads }   closing capture
//   startedAt / closedAt                 ms epoch of each capture
//
// Captured by scripts/leaderboard-snapshot.mjs — see that file for the timing
// discipline and for why `reads` is readCount rather than a readStories count.

// The Summer Reading Program — the seasonal board this contest inaugurates.
//
// Window is Europe/London wall-clock: 1 Aug 00:00:00 through 31 Aug 23:59:59.999,
// which is BST (UTC+1) for the whole month. Stored as epoch ms so no client-side
// timezone maths is needed to decide whether the contest is open.
export const SUMMER_2026 = {
  boardId: 'summer-2026',
  kind: 'seasonal',

  title: 'Summer Reading Program',
  kicker: 'AUGUST 2026',
  blurb: 'Read, take quizzes, comment — every Scribble you earn in August counts toward your place.',

  // 2026-08-01T00:00:00+01:00 → 2026-08-31T23:59:59.999+01:00
  startsAt: 1785538800000,
  endsAt:   1788217199999,
  timeZone: 'Europe/London',
  windowLabel: '1 – 31 August 2026',

  // Thirteen places. Amounts are prize units in `currency`.
  prizes: [
    { place: 1,  amount: 25 },
    { place: 2,  amount: 15 },
    { place: 3,  amount: 10 },
    { place: 4,  amount: 5 },
    { place: 5,  amount: 5 },
    { place: 6,  amount: 5 },
    { place: 7,  amount: 5 },
    { place: 8,  amount: 5 },
    { place: 9,  amount: 5 },
    { place: 10, amount: 5 },
    { place: 11, amount: 5 },
    { place: 12, amount: 5 },
    { place: 13, amount: 5 },
  ],
  currency: 'GBP',

  // points/{uid}/total is open to any signed-in user's own writes, so the live
  // delta is a display, not a result. Places are certified by the recompute at
  // the window boundaries (R2). The board must say so.
  provisional: true,
};

export const BOARDS = { [SUMMER_2026.boardId]: SUMMER_2026 };

export function getBoard(boardId) {
  return BOARDS[boardId] ?? null;
}

// Total prize pool, derived rather than restated so it cannot drift from the array.
export function prizePool(board) {
  return board.prizes.reduce((sum, p) => sum + p.amount, 0);
}

export function prizeForPlace(board, place) {
  return board.prizes.find((p) => p.place === place) ?? null;
}

// Collapse runs of consecutive places paying the same amount into one band.
// Thirteen places where ten of them pay £5 is ten identical tiles — on a phone
// that is seven rows of chrome between the reader and the actual standings.
// Bands render as "4th – 13th · £5 each" instead. Fully general: a board with
// thirteen distinct amounts produces thirteen bands and nothing is collapsed.
export function prizeBands(board) {
  const bands = [];
  for (const p of board.prizes) {
    const last = bands[bands.length - 1];
    if (last && last.amount === p.amount && last.to === p.place - 1) last.to = p.place;
    else bands.push({ from: p.place, to: p.place, amount: p.amount });
  }
  return bands;
}

const ORDINALS = ['0th', '1st', '2nd', '3rd'];
export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return ORDINALS[n % 10] ? `${n}${ORDINALS[n % 10].slice(1)}` : `${n}th`;
}
