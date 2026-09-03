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

// R34 — THE PROGRAM AND ITS EDITIONS.
//
// The program is THE SEASONAL READING PROGRAM. It runs every spring, summer,
// autumn and winter, and each run is an EDITION with its own board, its own
// window and its own certified result. "Summer Reading Program" was the name of
// the first edition mistaken for the name of the thing.
//
// So the name lives here, once, as PROGRAM_NAME, and a board carries an
// `edition` instead of a title. A board that named itself would drift from the
// programme the moment a second edition existed.
//
// What is fixed about the programme is written on PROGRAM_DETAILS_HREF and is
// deliberately short: it is seasonal, and the pool is £100. Nothing here encodes
// a schedule, a season length or a start date beyond the edition actually
// configured below — see app/reading-program/page.js for why.
export const PROGRAM_NAME = 'The Seasonal Reading Program';

// THE POOL IS £100. Ikenna's ruling, 3 Sept 2026: alongside "it is seasonal",
// this is the ONLY thing fixed about the programme. It is a property of the
// programme, not of a board — a future edition may split £100 across a
// different number of places, and the total still has to be £100.
//
// It is stated here rather than derived from SUMMER_2026.prizes because
// deriving it would make one edition's prize table the definition of the
// programme's promise, which is backwards. tests/leaderboard/program.test.mjs
// asserts the two agree, so a board whose places do not sum to the pool fails
// the suite rather than quietly rewriting the promise.
export const PROGRAM_PRIZE_POOL = 100;
export const PROGRAM_CURRENCY = 'GBP';

// How an edition works — the page a reader lands on from the banner. Editions
// come and go; this page is the constant.
export const PROGRAM_DETAILS_HREF = '/reading-program';

// ── THE ONE EDIT ────────────────────────────────────────────────────────────
// The Summer 2026 button beside the programme banner. Ikenna asked for it to be
// removable in a single edit, in about a week from 3 Sept 2026.
//
//   THAT EDIT IS THIS LINE. Set it to false (or delete the constant's `true`)
//   and the button disappears from every banner at once — /leaderboard and
//   /rewards both read it, and neither has a copy of the decision.
//
// The certified board is NOT temporary. /leaderboard/summer-2026 stays reachable
// forever, keeps its route file, its config entry and its terms; the programme
// details page links to it as a past edition. Only the shortcut goes.
export const SHOW_SUMMER_2026_BUTTON = true;

// The Summer 2026 edition — the board this contest inaugurated.
//
// Window is Europe/London wall-clock: 1 Aug 00:00:00 through 31 Aug 23:59:59.999,
// which is BST (UTC+1) for the whole month. Stored as epoch ms so no client-side
// timezone maths is needed to decide whether the contest is open.
export const SUMMER_2026 = {
  boardId: 'summer-2026',
  kind: 'seasonal',

  // `title` is the PROGRAMME's name and is shared by every edition; `edition`
  // is what distinguishes this board from the next one.
  title: PROGRAM_NAME,
  edition: 'Summer 2026',
  kicker: 'SUMMER 2026 EDITION',
  // Tense-neutral on purpose: this line renders above the board while the
  // edition is open AND for as long as the certified result stands, so a blurb
  // written in either tense goes wrong on one side of the close.
  blurb: 'Read, take quizzes, comment — every Scribble earned inside the window counts toward your place.',

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

  // Optional. Boards without published terms simply omit it and the board
  // renders no terms line.
  termsHref: '/leaderboard/summer-2026/terms',

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

// The one word a programme banner says about where the current edition stands.
//
// R34 shipped this as a helper rather than a ternary at each banner because the
// bug it replaces was a ternary at each banner: `open ? 'Now on' : 'Starts 1
// August'` in two files, both of which went on saying "Starts 1 August" for the
// fortnight AFTER the edition closed. Two copies of a decision are two chances
// to get it wrong, and both took it.
//
// `phase` comes from useContestPhase and is 'hidden' | 'pre' | 'open' | 'closed'.
// 'hidden' returns null: it is both the prerender snapshot and the state between
// editions, and there is no honest word that covers a static build's guess about
// the clock. The banner renders without a chip in that case rather than printing
// something it cannot know.
export function programStatusLabel(phase) {
  if (phase === 'open')   return 'Now on';
  if (phase === 'closed') return 'Closed';
  if (phase === 'pre')    return 'Opening soon';
  return null;
}

// The banner's own call to action, which is a phase word wearing a verb.
//
// R34a — the home feed's banner was the THIRD copy of the R34 defect, and it had
// it twice: `open ? 'NOW ON' : 'STARTS 1 AUGUST'` on the chip and
// `open ? 'View standings' : 'See the prizes'` underneath it. The second is the
// worse of the two, because a chip that is merely stale reads as a mistake while
// "See the prizes" over a certified board reads as an invitation to prizes that
// were paid a fortnight ago. Both come from here now, for the same reason the
// chip does: a decision written out at each banner is a decision each banner can
// get wrong on its own.
//
// 'hidden' cannot render on any current banner (they all return null when the
// phase is not visible), but it is answered rather than left to fall through —
// the whole point of switching on `phase` is that every case has a word.
export function programBoardCta(phase) {
  if (phase === 'open')   return 'View standings';
  if (phase === 'closed') return 'See the results';
  if (phase === 'pre')    return 'See the prizes';
  return 'View the board';
}

const ORDINALS = ['0th', '1st', '2nd', '3rd'];
export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return ORDINALS[n % 10] ? `${n}${ORDINALS[n % 10].slice(1)}` : `${n}th`;
}
