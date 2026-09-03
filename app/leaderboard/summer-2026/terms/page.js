'use client';

// The Summer 2026 edition — terms.
//
// Static copy, no data reads. A literal route segment under the board it
// belongs to, so it static-exports alongside it. The wording is fixed: it is
// what readers are held to and what the certification in
// scripts/leaderboard-audit.mjs enforces, so only typography lives here.
//
// R34 renamed the programme and touched NOTHING ELSE on this page. These are
// the terms thirteen certified winners were held to and the audit script
// enforces clause by clause; the only edit a rename licenses is the programme's
// own name in the heading. Every date, sum and rule below is the record.

import Navbar from '../../../components/Navbar';
import { SUMMER_2026 } from '../../../lib/leaderboards';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL   = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

const para = {
  fontFamily: DISPLAY,
  fontSize: '1.05rem',
  lineHeight: 1.75,
  color: 'rgba(245,240,232,0.72)',
  margin: '0 0 1.5rem',
};

export default function SummerReadingTermsPage() {
  const board = SUMMER_2026;

  return (
    <>
      <Navbar />
      <div style={{ minHeight: '100vh', background: '#0a0a0a', paddingTop: 68 }}>
        <div style={{ maxWidth: 660, margin: '0 auto', padding: '2.5rem 6% 5rem' }}>

          <a
            href={`/leaderboard/${board.boardId}`}
            style={{ fontFamily: LABEL, fontSize: '0.6rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(167,139,250,0.7)', textDecoration: 'none', display: 'inline-block', marginBottom: '1.5rem' }}
          >
            ← Back to the board
          </a>

          <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(1.6rem, 5.5vw, 2.4rem)', fontWeight: 300, color: '#f5f0e8', lineHeight: 1.15, margin: '0 0 2rem', letterSpacing: '0.01em' }}>
            The Seasonal Reading Program — Summer 2026 Terms
          </h1>

          <p style={para}>
            The program runs 1&ndash;31 August 2026, London time. It&rsquo;s open to registered
            Calvary Scribblings readers; joining is automatic &mdash; read, take the quizzes, and
            your progress counts from the moment the program opens. One account per reader.
          </p>

          <p style={para}>
            Standings on the leaderboard are provisional throughout. Final places are certified
            after close by checking each leading reader&rsquo;s points against their verified
            activity record &mdash; quizzes taken, comments made, stories read &mdash; cut precisely
            at 23:59:59 on 31 August, London time, whatever the board showed in the moment. Points
            that cannot be traced to real activity are removed, and accounts found manipulating
            balances are disqualified without appeal.
          </p>

          <p style={para}>
            Prizes: 1st &pound;25 &middot; 2nd &pound;15 &middot; 3rd &pound;10 &middot;
            4th&ndash;13th &pound;5 each. Winners are contacted through their account email within
            seven days of certification and paid by bank transfer or an agreed equivalent. If a
            winner doesn&rsquo;t respond within fourteen days, the place passes down the board.
          </p>

          <p style={{ ...para, marginBottom: '2.5rem' }}>
            A note on visibility: readers who&rsquo;ve opted out of leaderboards stay off this board
            too, though point totals are technically readable within the platform&rsquo;s systems.
            Questions to{' '}
            <a href="mailto:contact@calvaryscribblings.co.uk" style={{ color: '#a78bfa', textDecoration: 'underline' }}>
              contact@calvaryscribblings.co.uk
            </a>.
          </p>

          <p style={{ fontFamily: DISPLAY, fontSize: '0.95rem', color: 'rgba(245,240,232,0.4)', margin: 0, paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            &mdash; Calvary Media UK Ltd.
          </p>

        </div>
      </div>
    </>
  );
}
