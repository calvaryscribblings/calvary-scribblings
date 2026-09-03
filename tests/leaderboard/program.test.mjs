// R34 — THE SEASONAL READING PROGRAM'S STANDING RULINGS, HELD OFFLINE.
//
//   node --test tests/leaderboard/program.test.mjs      (npm run test:program)
//
// Three rulings live here because all three are the kind that a later, reasonable
// edit undoes by accident while making the page read better:
//
//   1. THE DETAILS PAGE MUST NOT PROMISE A SCHEDULE. Only two things about the
//      programme are fixed — that it is seasonal, and that the pool is £100. There
//      is no fixed date per season and no fixed length; the next edition may run a
//      fortnight where Summer 2026 ran a month. A page that says "each season runs
//      for a month from the first" reads better and is a promise nobody made, and
//      it becomes a lie the first time an edition runs three weeks.
//
//   2. THE POOL IS £100, and it is a property of the PROGRAMME, not of a board.
//      An edition may split it across a different number of places; the total may
//      not move.
//
//   3. THE PHASE WORD COMES FROM ONE PLACE. The live defect was `open ? 'Now on' :
//      'Starts 1 August'` written out in banner files, wrong in every copy. A
//      banner that spells a phase word itself is the defect returning.
//
// R34a — AND A CENSUS IS ONLY AS GOOD AS THE SWEEP THAT BUILT ITS LIST.
//
// Ruling 3 shipped with its banner list TYPED OUT: two paths, app/leaderboard and
// app/rewards. There were three banners. The third, SummerProgramBanner on the
// home feed — the site's landing surface — still carried
// `open ? 'NOW ON' : 'STARTS 1 AUGUST'` and `open ? 'View standings' : 'See the
// prizes'`, and because it was not on the list this file reported clean while the
// front page invited readers to see prizes that had already been paid out.
//
// This project's standing rule is that a grep proves presence and never absence.
// Here that rule was turned on a GUARD rather than on a claim, and the guard was
// the thing asserting the absence. So the list is now SWEPT, not typed:
//
//   PHASE_BANNERS — every component in app/ that reads the contest phase, found
//     by walking the tree. Any banner that prints a phase word can print an
//     untrue one, so the census must find them rather than be told about them.
//   ENTRY_BANNERS — the two that are entry points to the programme: they link to
//     /reading-program and carry the gated edition shortcut. That membership is
//     an editorial decision about two surfaces, not a property discoverable in
//     the source, so it stays written down.
//
// And because a sweep can itself go blind, two backstops: a floor (the three
// known banners must all be found, or the walk is broken) and a whole-tree guard
// that fails when ANY file spells phase copy and is not the one place that may.
//
// A note on why the sweep reads files with node:fs rather than shelling out to
// grep: app/public-library/page.js contains a literal NUL byte inside a string,
// which makes grep classify the file as binary and drop it from plain -r results.
// The blind census had a blind search sitting behind it. R34a replaced that byte
// with \u0000 — same string, no longer invisible — but the sweep does not depend
// on that having stayed fixed.
//
// Offline and instant: filesystem plus two pure modules. No browser, no network,
// no Firebase.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  PROGRAM_NAME, PROGRAM_PRIZE_POOL, PROGRAM_DETAILS_HREF,
  SUMMER_2026, BOARDS, prizePool, programStatusLabel, programBoardCta,
} from '../../app/lib/leaderboards.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const DETAILS_PAGE = 'app/reading-program/page.js';
const PHASE_SOURCE = 'app/lib/useContestPhase.js';
// The one file that may spell the words. Everything else asks it.
const WORD_SOURCE = 'app/lib/leaderboards.js';

// Every .js/.jsx file under app/, read off the filesystem rather than listed.
function appFiles(dir = 'app', out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      appFiles(path, out);
    } else if (/\.jsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

// Every top-level function declaration in a file, with the span it owns: from its
// own opening line to the next top-level declaration. Bounded rather than read to
// end-of-file, because a banner may be declared ABOVE the page component (rewards
// does exactly that) and reading past it would drag in every unrelated string on
// the page.
function declarations(src) {
  const DECL = /^(?:export default |export )?function (\w+)\s*\(/gm;
  const found = [...src.matchAll(DECL)].map((m) => ({ name: m[1], at: m.index }));
  return found.map((d, i) => ({
    ...d,
    end: i + 1 < found.length ? found[i + 1].at : src.length,
  }));
}

// PHASE_BANNERS — SWEPT, NOT TYPED. Every component that reads the contest phase
// is a component that can print a phase word, and the walk finds them wherever
// they are. Typing this list is what let the third banner ship wrong.
function sweepPhaseBanners() {
  const found = [];
  for (const path of appFiles()) {
    if (path === PHASE_SOURCE) continue;
    const src = codeOf(path);
    if (!src.includes('useContestPhase')) continue;
    const decls = declarations(src);
    for (const m of src.matchAll(/useContestPhase\s*\(/g)) {
      // The import line sits above every declaration; it owns no component.
      const owner = decls.find((d) => m.index > d.at && m.index < d.end);
      if (!owner) continue;
      if (!found.some((f) => f.path === path && f.name === owner.name)) {
        found.push({ path, name: owner.name, fn: `function ${owner.name}(` });
      }
    }
  }
  return found;
}
const PHASE_BANNERS = sweepPhaseBanners();

// ENTRY_BANNERS — the surfaces that are a way IN to the programme: the card links
// to /reading-program and the gated pill to the edition's board. Written down
// rather than swept, and the difference from PHASE_BANNERS is the point. Which
// surfaces are entry points is an editorial decision; whether a surface prints a
// phase word is a fact about its source. You can sweep for the second. The first
// you can only be told, so it is told here — and a file that stops declaring its
// banner fails loudly rather than dropping quietly off a list.
//
// R34b — THE HOME FEED IS THE THIRD, and all three are now the same shape. It was
// left off for one round on the reasoning that making it an entry point would
// leave the front page with no route to the certified board once
// SHOW_SUMMER_2026_BUTTON is flipped off. That reasoning was wrong twice over:
// the route it was protecting is a one-tap link the banner had ALREADY reduced to
// the pill, and the two-tap route through the details page is guarded below
// rather than merely hoped for.
const ENTRY_BANNERS = [
  { path: 'app/leaderboard/page.js',     fn: 'function ProgramBanner(' },
  { path: 'app/rewards/page.js',         fn: 'function ProgramCard(' },
  { path: 'app/public-library/page.js',  fn: 'function SummerProgramBanner(' },
];

// The component's own body, bounded by declarations() above.
function bannerSource({ path, fn }) {
  const src = codeOf(path);
  const at = src.indexOf(fn);
  assert.notEqual(at, -1, `${path} no longer declares ${fn}`);
  const owner = declarations(src).find((d) => d.at <= at && at < d.end);
  return owner ? src.slice(owner.at, owner.end) : src.slice(at);
}

// Source with its comments stripped. Every guard below runs on this rather than
// on the raw file, and the reason is the same for all of them: each comment
// EXPLAINS the rule it sits beside, and explaining it means quoting the thing the
// rule forbids — the details page's header names months while saying why months
// are banned; the banner's header quotes `open ? 'Now on' : 'Starts 1 August'`
// while saying why that shape is the defect. A guard that could not tell a
// comment from shipped copy would forbid writing the reason down, and the reason
// is the most valuable thing on the file.
//
// Line comments are dropped only when the line STARTS with // after trimming, so
// a URL inside a string survives.
function codeOf(path) {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

describe('the details page promises no schedule', () => {
  // Month names. The page may not name one — not for a season's start, not for
  // its length, not as an example.
  const MONTHS = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/g;

  // A length or a cadence stated as a promise.
  //
  // THE MODAL IS THE WHOLE DISTINCTION, and it is why the lookbehind is here
  // rather than a looser pattern: "one may run a month; the next may run a
  // fortnight" is the page saying lengths VARY, which is the point of the page.
  // "each season runs for a month" is a promise. The words either side are
  // otherwise identical, so a guard without the modal exclusion would forbid the
  // sentence that states the ruling.
  const MODAL = '(?<!\\b(?:may|might|could|can|would|should)\\s)';
  const PROMISES = [
    new RegExp(`${MODAL}\\b(runs?|lasts?|opens?|begins?|starts?)\\s+(for\\s+)?(a|each|every|the)\\s+(month|fortnight|four weeks|two weeks|30 days|14 days)\\b`, 'i'),
    /\bevery\s+(1st|first)\b/i,
    /\b(on|from)\s+the\s+(1st|first)\s+of\b/i,
    /\bthe\s+(1st|first)\s+of\s+(each|every)\b/i,
  ];

  test('names no month in its copy', () => {
    const prose = codeOf(DETAILS_PAGE);
    const hits = [...prose.matchAll(MONTHS)].map((m) => m[0]);

    // The Summer 2026 edition line is the one dated thing allowed, and it comes
    // from the board config rather than from typed prose — so a month appearing
    // literally in this file is always a new promise.
    assert.deepEqual(
      hits, [],
      `${DETAILS_PAGE} names ${hits.join(', ')}. The programme has no fixed date per season and no `
      + 'fixed length — the next edition may run a fortnight where Summer 2026 ran a month. Dates '
      + "belong on the EDITION'S board, where they are a fact about one edition. See the file header.",
    );
  });

  test('states no fixed length or cadence', () => {
    const prose = codeOf(DETAILS_PAGE);
    for (const re of PROMISES) {
      const m = prose.match(re);
      assert.equal(
        m, null,
        `${DETAILS_PAGE} promises a schedule: ${JSON.stringify(m?.[0])}. Only two things are fixed — `
        + 'seasonal, and a £100 pool. Everything else is set edition by edition.',
      );
    }
  });

  test('says the two things that ARE fixed', () => {
    const prose = codeOf(DETAILS_PAGE);
    assert.match(prose, /seasonal|each season|the seasons/i, 'the page never says the programme is seasonal');
    assert.ok(
      prose.includes('PROGRAM_PRIZE_POOL') || prose.includes(`£${PROGRAM_PRIZE_POOL}`),
      `the page never states the £${PROGRAM_PRIZE_POOL} pool`,
    );
  });

  test('says the all-time board does not reset, and why', () => {
    const prose = codeOf(DETAILS_PAGE);
    assert.match(prose, /does not reset|never starts again|carries across/i,
      'the page does not say the all-time board carries across seasons');
    // The REASON, not just the claim: editions vary in length, so only a
    // cumulative board compares.
    assert.match(prose, /cannot be compared|different lengths|the calendar/i,
      'the page states the rule without the reason — which is what gets it "improved" away');
  });
});

describe('the pool is the programme\'s, not the board\'s', () => {
  test('Summer 2026\'s places sum to the programme pool', () => {
    assert.equal(
      prizePool(SUMMER_2026), PROGRAM_PRIZE_POOL,
      `${SUMMER_2026.edition} pays £${prizePool(SUMMER_2026)} across ${SUMMER_2026.prizes.length} places, `
      + `but the programme's pool is £${PROGRAM_PRIZE_POOL}. An edition may divide the pool differently; `
      + 'it may not change the total.',
    );
  });

  test('the board carries the programme name and its own edition', () => {
    assert.equal(SUMMER_2026.title, PROGRAM_NAME);
    assert.equal(SUMMER_2026.edition, 'Summer 2026');
    assert.notEqual(SUMMER_2026.edition, PROGRAM_NAME, 'an edition that names itself after the programme is the old bug');
  });
});

describe('the census finds every banner', () => {
  // THE FLOOR, NOT THE LIST. The census is the sweep; these three are what the
  // sweep must at minimum find for it to be working at all. R34's list WAS three
  // paths short of one and had no way to know — a walk that silently returns two
  // entries is indistinguishable from a codebase that has two banners, so the
  // floor is written down separately from the thing it checks.
  const KNOWN = [
    'app/leaderboard/page.js',
    'app/rewards/page.js',
    'app/public-library/page.js',   // the home feed — the one R34 missed
  ];

  test('the sweep finds all three known banners', () => {
    const swept = PHASE_BANNERS.map((b) => b.path);
    for (const path of KNOWN) {
      assert.ok(
        swept.includes(path),
        `the sweep did not find a phase banner in ${path}. Found: ${swept.join(', ') || 'nothing'}. `
        + 'Either the banner has gone or the walk has — and a walk that has gone blind reports every '
        + 'banner clean, which is exactly how STARTS 1 AUGUST stayed on the front page over a closed board.',
      );
    }
  });

  test('the sweep is a walk, not a list', () => {
    // A control on the control: the walk must actually be reading the tree. If it
    // ever collapses to the three known files, this notices.
    assert.ok(appFiles().length > 50, `the walk found only ${appFiles().length} files under app/`);
  });
});

describe('the phase word comes from one place', () => {
  test('every phase has a word, and the closed one is CLOSED', () => {
    assert.equal(programStatusLabel('closed'), 'Closed');
    assert.equal(programStatusLabel('open'), 'Now on');
    assert.equal(programStatusLabel('pre'), 'Opening soon');
    assert.equal(programStatusLabel('hidden'), null);
  });

  test('every phase has a call to action too', () => {
    // The chip is the half everyone looks at; the CTA is the half that did the
    // damage. "See the prizes" over a certified, paid board is not stale copy —
    // it is an invitation to something that is over.
    assert.equal(programBoardCta('open'), 'View standings');
    assert.equal(programBoardCta('closed'), 'See the results');
    assert.equal(programBoardCta('pre'), 'See the prizes');
    assert.equal(typeof programBoardCta('hidden'), 'string', 'every phase answers, including the prerender\'s');
  });

  test('no phase copy is spelled outside the one place that may', () => {
    // The backstop for a banner that prints a phase word WITHOUT reading the
    // phase hook — which the sweep above would never see. Whole tree, every file.
    const PHASE_COPY = /\b(now on|opening soon|see the prizes|view standings|see the results|starts \d{1,2} [a-z]+)\b/i;
    const offenders = [];
    for (const path of appFiles()) {
      if (path === WORD_SOURCE) continue;
      const m = codeOf(path).match(PHASE_COPY);
      if (m) offenders.push(`${path} (${JSON.stringify(m[0])})`);
    }
    assert.deepEqual(
      offenders, [],
      `phase copy is spelled in ${offenders.join(', ')}. Every phase word belongs in ${WORD_SOURCE}, `
      + 'behind programStatusLabel or programBoardCta. A surface that types one can type an untrue one, '
      + 'and the census above only finds surfaces that read the phase hook — this catches the ones that '
      + 'do not bother.',
    );
  });

  test('no banner spells a phase word itself', () => {
    for (const banner of PHASE_BANNERS) {
      const src = bannerSource(banner);
      assert.ok(src.includes('programStatusLabel'), `${banner.path} does not use programStatusLabel`);

      // The exact shape of the defect: a ternary on `open` deciding what the
      // banner says. `open` is still exported for callers that need the boolean;
      // what may not come back is a banner branching on it into typed copy.
      assert.equal(
        /open\s*\?\s*['"]/.test(src), false,
        `${banner.path} branches on \`open\` straight into a string literal. That is the R34 defect: `
        + '`open ? \'Now on\' : \'Starts 1 August\'` had no branch for closed, so for the fortnight '
        + 'after the close it advertised a start date a month in the past.',
      );

      // And no typed date in the banner copy, in any branch.
      assert.equal(
        /['"][^'"]*\b(Aug|August|Sept|September)\b[^'"]*['"]/.test(src), false,
        `${banner.path} carries a hard-coded month in a string. An edition's dates live on its board.`,
      );
    }
  });

  test('the details page is where the entry banners point', () => {
    for (const banner of ENTRY_BANNERS) {
      assert.ok(bannerSource(banner).includes('PROGRAM_DETAILS_HREF'), `${banner.path} does not link to the programme page`);
    }
    assert.equal(PROGRAM_DETAILS_HREF, '/reading-program');
  });
});

describe('the temporary edition button is one edit', () => {
  test('every entry banner reads the same switch and none hard-codes the decision', () => {
    for (const banner of ENTRY_BANNERS) {
      const src = bannerSource(banner);
      assert.ok(
        src.includes('SHOW_SUMMER_2026_BUTTON'),
        `${banner.path} renders the edition button without reading SHOW_SUMMER_2026_BUTTON — the button `
        + 'would then take two edits to remove, not one.',
      );
    }
    // And the switch is a bare boolean, not an expression that would need reading
    // to know what flipping it does.
    assert.match(
      read('app/lib/leaderboards.js'),
      /export const SHOW_SUMMER_2026_BUTTON = (true|false);/,
      'SHOW_SUMMER_2026_BUTTON is no longer a plain literal — the one edit stops being one edit',
    );
  });

  // R34b — THE SECOND TAP, which is what makes flipping the switch safe.
  //
  // Every entry banner reduces to a single link to /reading-program once the pill
  // is gone. From there the reader must still be able to reach the certified
  // board, or flipping a switch that is documented as cosmetic would quietly
  // strand thirteen winners' standings behind a URL nobody has.
  //
  // Two things have to hold, and they are separate failures: the details page
  // must LINK to the board, and it must not read the switch or the phase — a
  // conditional Editions list would satisfy the first guard and still vanish.
  test('the details page reaches every board, and no switch can take that away', () => {
    const details = codeOf(DETAILS_PAGE);

    for (const boardId of Object.keys(BOARDS)) {
      assert.ok(
        details.includes(`/leaderboard/${boardId}`) || details.includes('${SUMMER_2026.boardId}')
          || details.includes('board.boardId') || details.includes('.boardId}'),
        `${DETAILS_PAGE} does not link to the ${boardId} board. It is the only route to the `
        + 'certified standings once SHOW_SUMMER_2026_BUTTON is off — the home feed, /leaderboard '
        + 'and /rewards all reduce to a link to this page.',
      );
    }

    assert.equal(
      /SHOW_SUMMER_2026_BUTTON|useContestPhase/.test(details), false,
      `${DETAILS_PAGE} now reads the button switch or the contest phase. Its Editions list is the `
      + 'second tap of the only surviving route to the board; gating any of it on the switch means '
      + 'flipping the switch removes the route it was supposed to leave behind.',
    );
  });

  test('the certified board itself is not gated on it', () => {
    // The button goes; the board stays reachable forever.
    const route = codeOf(`app/leaderboard/${SUMMER_2026.boardId}/page.js`);
    assert.equal(
      route.includes('SHOW_SUMMER_2026_BUTTON'), false,
      'the board route reads the button switch — flipping it would take the certified board down with it',
    );
  });
});

describe('the all-time board carries across seasons', () => {
  // WHY THIS IS A RULING AND NOT AN IMPLEMENTATION DETAIL: editions vary in
  // length. A fortnight in autumn cannot be compared with a month of summer — the
  // reader who won the longer edition simply had longer — so a cumulative board is
  // the only one that means the same thing from one season to the next. It must
  // not reset, re-base, or window itself at an edition boundary.
  //
  // The Playwright half of this (tests/leaderboard/phase.spec.mjs) reads the board
  // at three instants straddling the boundary and requires the same list. That
  // catches a reset TRIGGERED BY THE CLOCK — and only that. A re-basing written as
  // a fixed filter ("only readers who have scored since the edition opened")
  // answers identically at every instant and walks straight past it; the mutation
  // run proved it did. These two guards are the other half.

  test('the all-time list applies no time bound, while This Week does', () => {
    const src = codeOf('app/leaderboard/page.js');

    const line = src.split('\n').find((l) => /const\s+allList\s*=/.test(l));
    assert.ok(line, 'app/leaderboard/page.js no longer builds allList — this guard has gone blind');

    const TIME_BOUND = /(cutoff|scoreUpdatedAt|startsAt|endsAt|Date\.now|WEEK_MS|SUMMER_)/;
    assert.equal(
      TIME_BOUND.test(line), false,
      `the All Time board is windowed: ${line.trim()}\n`
      + 'All-time carries across seasons — it is the only board that compares a two-week autumn with '
      + 'a month of summer, and a time bound on it is a reset however it is spelled.',
    );

    // And the control: This Week IS windowed, so the guard above is discriminating
    // between two lists rather than matching nothing in the file.
    const weekLine = src.split('\n').find((l) => /const\s+weekList\s*=/.test(l));
    assert.ok(weekLine, 'app/leaderboard/page.js no longer builds weekList');
    assert.equal(
      TIME_BOUND.test(weekLine), true,
      'This Week has lost its time bound, which means the pattern above would no longer detect one',
    );
  });

  test('readerScore has exactly one writer, and it reads lifetime totals', () => {
    // A second writer is where a seasonal reset would arrive.
    const files = ['app/lib/badgeEngine.js', 'app/lib/badges.js', 'app/leaderboard/page.js',
      'app/components/SeasonBoard.js', 'app/lib/leaderboards.js'];
    const writers = files.filter((f) => /(users|leaderboard)\/\$\{uid\}\/readerScore.\]?\s*=/.test(read(f))
      || /readerScore.\s*=\s*readerScore/.test(read(f)));
    assert.deepEqual(
      writers, ['app/lib/badgeEngine.js'],
      `readerScore is written by ${writers.join(', ') || 'nothing'} — it must have exactly one writer, `
      + 'app/lib/badgeEngine.js, which recomputes it from lifetime aggregates.',
    );

    // And that writer takes no window: its inputs are every submission, the
    // longest streak, the read count and the comment count — none of them dated.
    const engine = codeOf('app/lib/badgeEngine.js');
    assert.equal(
      /(startsAt|endsAt|boardId|leaderboards\/)/.test(engine), false,
      'badgeEngine has become contest-aware. The all-time score must not know an edition exists.',
    );
  });
});

describe('neither board carries a handle', () => {
  // R34 cut it from the seasonal strip; R34a cut it from the all-time board on
  // Ikenna's ruling of 3 Sept 2026, so the two surfaces do not differ on it.
  // Both are named here rather than one, because the failure mode is one board
  // getting it back on its own.
  const ROWS = [
    ['app/components/SeasonBoard.js', 'function Row('],
    ['app/leaderboard/page.js', 'displayed.map('],
  ];

  test('no @username survives in either row', () => {
    for (const [path, marker] of ROWS) {
      const src = codeOf(path);
      const at = src.indexOf(marker);
      assert.notEqual(at, -1, `${path} no longer contains ${marker} — this guard has gone blind`);
      assert.equal(
        /@\{row\.username\}/.test(src.slice(at)), false,
        `the handle is back in ${path}. On the seasonal strip it was the only text node in the name `
        + 'column with no overflow rule, so flex-wrap put it on its own line at full intrinsic width and '
        + 'a long enough handle was painted under the score. On both boards it adds nothing the tap does '
        + 'not already give — the row links to /user?id={uid}, where the full identity is the heading.',
      );
    }
  });

  test('the score is house gold in the source, not only on screen', () => {
    // Scoped to the score block, not the whole Row. The first cut of this guard
    // matched anywhere in Row and so was satisfied by the PRIZE PILL, which is
    // gold too — it passed the mutation that painted the score #6b2fad. A guard
    // that a mutation walks past is not a guard.
    const rendered = codeOf('app/components/SeasonBoard.js');
    const at = rendered.indexOf('className="sb-score"');
    assert.notEqual(at, -1, 'the score block has lost its .sb-score hook');
    const block = rendered.slice(at, at + 400);
    assert.match(
      block, /color: '#c9a84c'/,
      'the score is no longer house gold. It is the single number the card exists to show; '
      + 'gold measures 8.19:1 on the first-place tint where the old purple measured 6.88:1.',
    );
  });
});
