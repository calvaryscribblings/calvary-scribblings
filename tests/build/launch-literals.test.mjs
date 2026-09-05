// R9.1 — NO LAUNCH DATE MAY BE TYPED OUTSIDE app/lib/launch.js.
//
//   node --test tests/build/launch-literals.test.mjs      (npm run test:launch)
//
// ── THE FAILURE THIS EXISTS TO CATCH, AND WHY A GREP WAS NOT ENOUGH ──────────────────────
//
// R34 inventoried nine files carrying a launch date and recorded the list in a comment. The
// list was built by searching for "September", and it was short by exactly the two sites that
// mattered most:
//
//     app/components/Gateway.js:32     const LAUNCH = { y: 2026, m: 9, d: 30 };
//     app/my-library/page.js:42        const LAUNCH = { y: 2026, m: 9, d: 30 };
//
// Neither contains the word September. Both fed a byte-identical daysUntilLaunch() rendering a
// COUNTDOWN THE READER CAN SEE on the homepage and in My Library. A hand-copied constant
// behind a visible counter is the worst kind of duplicate — it is the one that produces a
// confidently wrong number rather than a stale sentence — and the search that found the other
// nine could not see it.
//
// So the guard is not "find the word". It is: enumerate every FORM a launch date can take,
// including the machine-readable ones, and fail on any of them outside the one file allowed to
// hold it. A future launch-date site has to either import from app/lib/launch.js or turn this
// suite red; there is no third outcome, and that is the whole point.
//
// ── SCOPE: SHIPPED CODE, NOT COMMENTS. THE REASON IS SPECIFIC. ───────────────────────────
//
// Comments are stripped before scanning, so a comment may name the date. That is a deliberate
// narrowing and not laziness: this file, app/lib/launch.js, LaunchGate.js and half a dozen
// others EXPLAIN the launch-date problem, and explaining it requires writing the date down.
// A rule that forbade that would make the codebase unable to describe its own history — and
// the history is what stopped this being found a third time.
//
// What a comment CANNOT do is reach a reader. Every failure R34 and R9 found was rendered
// copy or a constant feeding rendered copy. That is what is scanned, strictly.
//
// ⚠ THE ONE HAZARD OF THAT CHOICE: a comment naming the date can rot silently, exactly as
// R34's own note did. The defence is not this test — it is that a comment worth writing names
// the date AND the ruling behind it, so a reader who finds it stale has the context to fix it.
// Compare app/rewards/page.js, where the note explains why the Scribbles catalogue is NOT a
// launch-date site, which is a fact no constant could carry.
//
// ── WHAT IS NOT SCANNED, AND WHY ─────────────────────────────────────────────────────────
//
//   tests/      a test asserting launch copy must be able to name it. If the date moves, those
//               assertions redden, which is correct — it forces a look at the copy.
//   scripts/    build and migration tooling, never shipped to a reader.
//   public/vendor, node_modules, out, calvary-scribblings-next, calvary-app
//               third-party or vestigial; not ours to hold to a house rule.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LAUNCH, LAUNCH_DATE_LABEL, LAUNCH_DATE_SHORT, LAUNCH_MONTH_YEAR, OPENING_DATE }
  from '../../app/lib/launch.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SOURCE_OF_TRUTH = join('app', 'lib', 'launch.js');

const ROOTS = ['app', 'functions', 'emails'];
const EXTS = ['.js', '.jsx', '.mjs', '.ts', '.tsx'];
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'out', '.next', 'vendor',
  'calvary-scribblings-next', 'calvary-app',
]);

/**
 * Blank out comments, preserving every byte position so a reported line number still points at
 * the real line. Blanking rather than deleting is what makes that true.
 *
 * ── ⚠ THIS IS NOT A PARSER, AND THE FIRST VERSION OF IT WAS WORSE FOR TRYING TO BE ──────
 *
 * The first draft tracked string state, so that `'// not a comment'` inside a literal would
 * not be mistaken for one. It failed immediately, and instructively: JSX TEXT IS NOT A STRING
 * LITERAL. Prose like `<p>Ikenna's ruling</p>` puts a bare apostrophe in what the scanner reads
 * as code, which opened a single-quote state that never closed — and every real comment after
 * it in the file went unstripped. Four legitimate comments were reported as violations on the
 * first run, in three files, all of them prose with an apostrophe earlier in the file.
 *
 * So string tracking is gone. What is left handles the two things that actually appear:
 *
 *   · block comments, across lines, including the JSX `{​/* … *​/}` form
 *   · line comments, EXCEPT where `//` is preceded by `:` — which is a URL, and is the only
 *     realistic way `//` appears inside a shipped string in this corpus
 *
 * THE TRADE, STATED PLAINLY. Without string tracking, a `//` inside a string blanks the rest of
 * that line, which is a false NEGATIVE — a launch date sitting after a non-URL `//` inside a
 * string literal, on one line, would be missed. That shape does not occur here and would be
 * visible to any reader of the line. It is the residual risk, and it is smaller than the
 * alternative: a guard that reports comments as violations is a guard somebody disables.
 */
function stripComments(src) {
  const out = [...src];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '*') {
      out[i] = ' '; out[i + 1] = ' ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    // `://` is a URL, not a comment. The only in-string `//` this corpus contains.
    if (c === '/' && d === '/' && src[i - 1] !== ':') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    i++;
  }
  return out.join('');
}

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return acc; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (EXTS.some((e) => name.endsWith(e))) acc.push(full);
  }
  return acc;
}

// ── THE FORMS A LAUNCH DATE CAN TAKE ─────────────────────────────────────────────────────
//
// Built FROM app/lib/launch.js rather than typed, so moving the date moves the patterns with
// it and this file never becomes the twelfth place the date is written down.
const D = LAUNCH.d;
const M = LAUNCH.m;
const Y = LAUNCH.y;
const pad = (v) => String(v).padStart(2, '0');

const PATTERNS = [
  ['the full date', new RegExp(escape(OPENING_DATE), 'i')],
  ['day and month', new RegExp(escape(LAUNCH_DATE_LABEL), 'i')],
  ['abbreviated day and month', new RegExp(escape(LAUNCH_DATE_SHORT), 'i')],
  ['month and year', new RegExp(escape(LAUNCH_MONTH_YEAR), 'i')],
  // ⭑ THE ONE THAT WAS MISSED. A {y,m,d} object literal in any spacing or key order.
  ['a {y,m,d} date object', new RegExp(
    `\\{[^{}]*\\by\\s*:\\s*${Y}\\b[^{}]*\\bm\\s*:\\s*${M}\\b[^{}]*\\bd\\s*:\\s*${D}\\b[^{}]*\\}`)],
  ['a {y,m,d} date object (any order)', new RegExp(
    `\\{[^{}]*\\bd\\s*:\\s*${D}\\b[^{}]*\\bm\\s*:\\s*${M}\\b[^{}]*\\by\\s*:\\s*${Y}\\b[^{}]*\\}`)],
  ['an ISO date', new RegExp(`${Y}-${pad(M)}-${pad(D)}`)],
  ['a slashed date', new RegExp(`\\b${pad(D)}/${pad(M)}/${Y}\\b`)],
  // Date.UTC(2026, 8, 30) — month is zero-based here, which is its own trap.
  ['a Date.UTC call', new RegExp(`Date\\.UTC\\(\\s*${Y}\\s*,\\s*${M - 1}\\s*,\\s*${D}\\s*\\)`)],
  ['a new Date literal', new RegExp(`new\\s+Date\\(\\s*['"\`]${Y}-${pad(M)}-${pad(D)}`)],
];

function escape(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const FILES = ROOTS.flatMap((r) => walk(join(ROOT, r)));

describe('⭑ THE LAUNCH DATE IS WRITTEN IN ONE FILE', () => {
  test('the corpus is real — this suite cannot pass by scanning nothing', () => {
    assert.ok(FILES.length > 100, `only ${FILES.length} source files found; the walk is broken`);
    assert.ok(
      FILES.some((f) => relative(ROOT, f) === SOURCE_OF_TRUTH),
      'app/lib/launch.js was not reached by the walk',
    );
  });

  test('⭑ NO LAUNCH DATE IS TYPED IN SHIPPED CODE OUTSIDE app/lib/launch.js', () => {
    const hits = [];
    for (const file of FILES) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (rel === SOURCE_OF_TRUTH.split(sep).join('/')) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      const lines = code.split('\n');
      for (const [what, re] of PATTERNS) {
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) hits.push(`  ${rel}:${i + 1}  ${what}\n      ${lines[i].trim().slice(0, 110)}`);
        }
      }
    }
    assert.deepEqual(
      hits, [],
      `${hits.length} launch date(s) typed outside app/lib/launch.js:\n\n${hits.join('\n')}\n\n`
      + '  Import from app/lib/launch.js instead. It exports OPENING_DATE, LAUNCH_DATE_LABEL,\n'
      + '  LAUNCH_DATE_SHORT, LAUNCH_MONTH_YEAR, LAUNCH_TEXT, OPENS_SHORT, LAUNCH_NOTICE,\n'
      + '  BOOKSTORE_OPENS and daysUntilLaunch().\n\n'
      + '  If what you are writing is NOT the Book Store / membership launch — the Scribbles\n'
      + '  catalogue is the standing example — do not wire it to launch.js and do not give it\n'
      + '  a date it does not have. See the note in app/rewards/page.js.',
    );
  });

  test('⚠ THE GUARD CAN FAIL — every pattern is proved against a sample it must catch', () => {
    // A guard that cannot redden is the thing R9.1 exists to remove, so each pattern is fired
    // at a line built to trip it. Without this, a regex typo would leave the suite green
    // forever and nothing would ever say so.
    const samples = [
      `const OPENING = '${OPENING_DATE}';`,
      `const label = '${LAUNCH_DATE_LABEL}';`,
      `const tight = 'opens ${LAUNCH_DATE_SHORT}';`,
      `const note = 'Available ${LAUNCH_MONTH_YEAR}';`,
      `const LAUNCH = { y: ${Y}, m: ${M}, d: ${D} };`,
      `const LAUNCH = { d: ${D}, m: ${M}, y: ${Y} };`,
      `const iso = '${Y}-${pad(M)}-${pad(D)}';`,
      `const slashed = '${pad(D)}/${pad(M)}/${Y}';`,
      `const t = Date.UTC(${Y}, ${M - 1}, ${D});`,
      `const t = new Date('${Y}-${pad(M)}-${pad(D)}');`,
    ];
    assert.equal(samples.length, PATTERNS.length, 'every pattern needs a sample that trips it');
    samples.forEach((sample, i) => {
      const [what, re] = PATTERNS[i];
      assert.ok(re.test(sample), `the "${what}" pattern did not match its own sample: ${sample}`);
    });
  });

  test('comments are stripped, strings and templates are not', () => {
    const src = [
      `// a comment saying ${LAUNCH_DATE_LABEL} is allowed`,
      `/* and a block one naming ${OPENING_DATE} too */`,
      `const shipped = 'this ${LAUNCH_DATE_LABEL} is not';`,
    ].join('\n');
    const code = stripComments(src);
    const lines = code.split('\n');
    const re = new RegExp(escape(LAUNCH_DATE_LABEL), 'i');
    assert.equal(re.test(lines[0]), false, 'a line comment was not stripped');
    assert.equal(re.test(lines[1]), false, 'a block comment was not stripped');
    assert.equal(re.test(lines[2]), true, 'a string literal must NOT be stripped — it ships');
    assert.equal(code.split('\n').length, 3, 'stripping must preserve line numbering');
  });

  test('a URL in a string does not blank the rest of its line', () => {
    // The one thing the simplified stripper must still get right: `://` is not a comment. If
    // this regressed, every date after a URL on the same line would be invisible to the scan.
    const src = `const u = 'https://calvaryscribblings.co.uk'; const d = '${LAUNCH_DATE_LABEL}';`;
    assert.ok(
      new RegExp(escape(LAUNCH_DATE_LABEL), 'i').test(stripComments(src)),
      'a URL was treated as a line comment and swallowed the date after it',
    );
  });

  test('a template literal spanning lines keeps its line count, so hits point at the real line', () => {
    const src = `const a = \`line one\nline two ${LAUNCH_DATE_LABEL}\`;\nconst b = 2;`;
    const code = stripComments(src);
    assert.equal(code.split('\n').length, 3);
    assert.ok(new RegExp(escape(LAUNCH_DATE_LABEL), 'i').test(code.split('\n')[1]));
  });
});
