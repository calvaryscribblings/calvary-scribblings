'use client';

// THE SEASONAL READING PROGRAM — how an edition works.
//
// R34, 3 Sept 2026. Static copy, no data reads, no clock read: this page is the
// programme's constant while editions come and go, and it static-exports like
// the terms page beside it.
//
// ⚠ THE RULE THIS PAGE IS WRITTEN UNDER, and it is Ikenna's ruling, not a hedge:
//
//   THIS PAGE MUST NOT PROMISE A SCHEDULE.
//
// Exactly two things are fixed about the programme — that it is SEASONAL, and
// that the prize pool is £100 (PROGRAM_PRIZE_POOL). Everything else is decided
// edition by edition. There is no fixed start date for a season and no fixed
// length: the next edition may run a fortnight where Summer 2026 ran a month.
//
// So every sentence below is written to be true of BOTH a two-week autumn and a
// month-long summer. Where a length or a date would naturally go, the page says
// where to find it instead — on the edition's own board, which is the only
// surface that knows.
//
// WHY THIS MATTERS ENOUGH TO WRITE DOWN: a page that says "each season runs for
// a month, beginning on the first" reads better and is a promise nobody has
// made. The moment an edition runs three weeks, the page is a lie that thirteen
// prize-winners have already read — which is the exact failure R34 was called in
// to fix on the banner above it, where "STARTS 1 AUGUST" sat over a certified,
// frozen board for a fortnight.
//
// So: DO NOT "improve" this page by adding dates, month names, season start
// days, or a length. A future editor who knows the autumn dates should put them
// on the AUTUMN BOARD, where they are a fact about one edition, and leave this
// page alone. The absence of a calendar here is the feature.
//
// The one date on the page is Summer 2026's, and it is there as a record of an
// edition that has already happened, not as a pattern.

import Navbar from '../components/Navbar';
import {
  PROGRAM_NAME, PROGRAM_PRIZE_POOL, SUMMER_2026, prizePool,
} from '../lib/leaderboards';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL   = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const GOLD    = '#c9a84c';

const para = {
  fontFamily: DISPLAY,
  fontSize: '1.05rem',
  lineHeight: 1.75,
  color: 'rgba(245,240,232,0.72)',
  margin: '0 0 1.4rem',
};

const h2 = {
  fontFamily: LABEL,
  fontSize: '0.62rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: GOLD,
  margin: '2.6rem 0 1rem',
};

export default function ReadingProgramPage() {
  const money = `£${PROGRAM_PRIZE_POOL}`;

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#0a0a0a', paddingTop: 68 }}>
        <div style={{ maxWidth: 660, margin: '0 auto', padding: '2.5rem 6% 5rem' }}>

          <span style={{ fontFamily: LABEL, fontSize: '0.6rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: GOLD, display: 'block', marginBottom: 10 }}>
            The programme
          </span>

          <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(1.9rem, 6vw, 2.9rem)', fontWeight: 300, color: '#f5f0e8', lineHeight: 1.1, margin: '0 0 1.5rem' }}>
            {PROGRAM_NAME}
          </h1>

          <p style={{ ...para, fontSize: '1.15rem', color: 'rgba(245,240,232,0.8)' }}>
            A reading contest that comes round with the seasons. Each edition opens with a
            starting line, runs for a set stretch of weeks, and closes with a board of
            certified places and {money} shared between them.
          </p>

          <p style={para}>
            Taking part is simply reading. There is nothing to enter and nothing to sign:
            every reader with an account is in from the moment an edition opens, and the
            Scribbles you earn — reading stories, passing quizzes, leaving comments,
            completing exercises — are what rank you.
          </p>

          {/* ── What's fixed ─────────────────────────────────────────────── */}
          <h2 style={h2}>What is fixed</h2>

          <p style={para}>
            Two things, and they are the whole of it.
          </p>

          <p style={para}>
            <strong style={{ color: '#f5f0e8', fontWeight: 600 }}>It is seasonal.</strong>{' '}
            There is an edition in the spring, one in the summer, one in the autumn and one
            in the winter.
          </p>

          <p style={para}>
            <strong style={{ color: '#f5f0e8', fontWeight: 600 }}>The pool is {money}.</strong>{' '}
            Every edition puts the same {money} on the table. How it is divided — how many
            places pay, and what each one pays — is set for each edition and printed on its
            board before it opens.
          </p>

          {/* ── What isn't ───────────────────────────────────────────────── */}
          <h2 style={h2}>What is not</h2>

          <p style={para}>
            Everything else. An edition has no fixed date and no fixed length. One may run a
            month; the next may run a fortnight. We set the window when we set the edition,
            and we would rather say so here than print a calendar we then have to break.
          </p>

          <p style={para}>
            So this page will never tell you when the next edition begins. The edition&rsquo;s
            own board will — it carries its dates, its window, its prize table and its terms,
            and it is the only page that can be right about them. When one is coming, it is
            announced, and the banner across the site changes to say the programme is on.
          </p>

          {/* ── How an edition works ─────────────────────────────────────── */}
          <h2 style={h2}>How an edition works</h2>

          <p style={para}>
            <strong style={{ color: '#f5f0e8', fontWeight: 600 }}>It opens with a baseline.</strong>{' '}
            Before the first minute of the window, everyone&rsquo;s Scribbles total is recorded.
            An edition ranks what you earn <em>after</em> that mark, so a reader who has been
            here for years and a reader who joined that morning start the edition level.
          </p>

          <p style={para}>
            <strong style={{ color: '#f5f0e8', fontWeight: 600 }}>The board runs live, and says so.</strong>{' '}
            While an edition is open the standings move as readers read, and they are marked
            provisional throughout — because they are a display of a running total, not a
            result.
          </p>

          <p style={para}>
            <strong style={{ color: '#f5f0e8', fontWeight: 600 }}>It closes on the certified count.</strong>{' '}
            When the window ends, the leading readers&rsquo; totals are rebuilt from their
            actual record — quizzes taken, comments made, stories read — cut precisely at the
            closing second. Points that cannot be traced to real reading come off. Those are
            the places that pay, and once the closing capture is taken the board freezes and
            stays that way.
          </p>

          <p style={para}>
            <strong style={{ color: '#f5f0e8', fontWeight: 600 }}>The board stays up.</strong>{' '}
            A closed edition is not taken down. Its board, its standings and its terms remain
            at their own address for good.
          </p>

          {/* ── The all-time board ───────────────────────────────────────── */}
          <h2 style={h2}>The all-time board does not reset</h2>

          <p style={para}>
            The Island&rsquo;s{' '}
            <a href="/leaderboard" style={{ color: '#a78bfa', textDecoration: 'underline' }}>all-time leaderboard</a>{' '}
            is a separate thing from the programme, and no edition touches it. It carries
            across seasons: nothing is zeroed when an edition opens, and nothing is zeroed
            when one closes.
          </p>

          <p style={para}>
            That is deliberate, and it follows from editions being different lengths. A
            fortnight in autumn cannot be compared with a month of summer — the reader who
            won the longer edition simply had longer — so a board that reset each season
            would be measuring the calendar as much as the reading. The cumulative board is
            the only one that means the same thing from one season to the next, which is why
            it is the one that never starts again.
          </p>

          {/* ── Past editions ────────────────────────────────────────────── */}
          <h2 style={h2}>Editions</h2>

          <p style={para}>
            <a href={`/leaderboard/${SUMMER_2026.boardId}`} style={{ color: '#a78bfa', textDecoration: 'underline' }}>
              {SUMMER_2026.edition}
            </a>{' '}
            — {SUMMER_2026.windowLabel}. {SUMMER_2026.prizes.length} places,
            £{prizePool(SUMMER_2026)} shared. Closed and certified;{' '}
            <a href={SUMMER_2026.termsHref} style={{ color: '#a78bfa', textDecoration: 'underline' }}>
              its terms
            </a>{' '}
            stand as they were written.
          </p>

          <p style={{ fontFamily: DISPLAY, fontSize: '0.95rem', color: 'rgba(245,240,232,0.4)', margin: '2.5rem 0 0', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)', lineHeight: 1.7 }}>
            Questions about the programme go to{' '}
            <a href="mailto:contact@calvaryscribblings.co.uk" style={{ color: '#a78bfa', textDecoration: 'underline' }}>
              contact@calvaryscribblings.co.uk
            </a>. Each edition&rsquo;s own terms are the ones that bind it.
          </p>

        </div>
      </div>
    </>
  );
}
