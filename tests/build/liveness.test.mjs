// ═══════════════════════════════════════════════════════════════════════════════════════════
// PL-12 — THE BUILD DEPENDS ON A LIVE FIREBASE READ, AND THIS IS WHAT HOLDS IT
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npm run test:build
//
// ⚠ WHAT THIS SUITE REFUSES TO BE. Seven instances have been found across this project of tests
// that pinned the SHAPE of something the product had stopped rendering — green for months while
// the thing they named was gone. So there is not one assertion here about the shape of a
// function, the name of an export, or the text of a comment. Every case injects a real fault
// and asserts what the BUILD ACTUALLY DID: its exit code, what it printed, and what it left on
// disk. If the guard is removed, these go red — and each one is proved able to go red, by
// mutation, rather than asserted to be.
//
// ── THE FACTS THIS SUITE EXISTS TO KEEP TRUE (measured 27 Aug 2026, before the fix) ────────
//
//   · firebase/database's get() NEVER SETTLES against an unreachable database. Not on DNS
//     failure, not on connection refused, not on dropped packets — still pending at 75s in all
//     three. Every try/catch around a build-time read was therefore dead code for the failure
//     that actually threatens a deploy.
//   · A full `next build` with the DB host black-holed ran 420 seconds, printed nothing,
//     exited never, and left out/ empty.
//   · With ONLY bookstore_titles failing: BUILD EXIT 0, out/bookstore/*.html = 1 (the
//     sentinel), out/reader/*.html = 188. The shelf is a live client query and shipped listing
//     all nineteen titles. Every "Full details" link 404'd. That is the case the last group
//     below reproduces and now demands a non-zero exit for.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRig } from './fixtures/fault-rig.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DRIVER = join(ROOT, 'tests/build/fixtures/drive-build-read.mjs');

// Runs a command and returns its outcome WITHOUT throwing, because a non-zero exit is the
// thing under test in most of these cases rather than an accident.
async function attempt(cmd, args, opts = {}) {
  try {
    const { stdout, stderr } = await run(cmd, args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, ...opts });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the contract: a build-time read either completes or the build stops', () => {
  test('THE DEADLINE — a read that never settles ends the build instead of hanging it', async () => {
    // ⭑ THE CENTRAL CASE. Before PL-12 this exact input produced no exit code at all: the
    // process waited for a promise that never resolves, and `next build` sat there for 420s
    // with an empty out/. The deadline is what converts it into an error the retry can act on.
    const r = await attempt(process.execPath, [DRIVER, 'hang']);
    assert.notEqual(r.code, 0, 'a read that never settles must fail the build');
    assert.match(r.stdout, /BUILD FAILED — FIREBASE COULD NOT BE READ/);
    assert.match(r.stdout, /deadline exceeded/, 'the reason must name the deadline, not a generic error');
    assert.match(r.stdout, /cms_stories/, 'the message must name what could not be read');
    assert.match(r.stdout, /\/stories\/\[slug\]/, 'the message must name the route that needed it');
    // ⛔ Ikenna's ruling: the message must not repeat the misdirection that cost this round its
    // diagnosis — "missing generateStaticParams()" when the function ran and the network didn't.
    assert.match(r.stdout, /THIS IS NOT A MISSING generateStaticParams\(\)/);
    // Four attempts, all of them.
    assert.match(r.stdout, /attempt 1\/4 failed/);
    assert.match(r.stdout, /attempt 3\/4 failed/);
  });

  test('THE RETRY — two transient failures then an answer is a completed read, not a failure', async () => {
    // The retry has to earn its place: a blip during a deploy must not decide whether the shop
    // exists. Three calls, exit 0, and the real value comes back.
    const r = await attempt(process.execPath, [DRIVER, 'flaky']);
    assert.equal(r.code, 0, 'a read that succeeds on the third attempt must not fail the build');
    assert.match(r.stdout, /RESULT \{"ok":true\} calls=3/);
    assert.doesNotMatch(r.stdout, /BUILD FAILED/);
  });

  test('A HARD ERROR still fails after its attempts are spent', async () => {
    // Permission-denied is the fast failure mode — measured at 10ms against the live database.
    // It was the only one the old try/catch could ever have caught.
    const r = await attempt(process.execPath, [DRIVER, 'throw']);
    assert.notEqual(r.code, 0);
    assert.match(r.stdout, /PERMISSION_DENIED/);
    assert.match(r.stdout, /calls=|attempt 3\/4 failed/);
  });

  test('EMPTY IS NOT UNREACHABLE — a successful read returning nothing stays green', async () => {
    // ⭑ THE SPLIT. One try/catch used to cover both, so "the CMS says there is nothing yet" and
    // "the CMS could not be reached" arrived at the same line and produced the same output.
    // They are opposite facts. This is the launch-day state and it must build.
    const r = await attempt(process.execPath, [DRIVER, 'empty']);
    assert.equal(r.code, 0, 'an empty catalogue is a valid answer and must not fail the build');
    assert.match(r.stdout, /RESULT \{\} calls=1/, 'and it must not be retried — nothing failed');
    assert.doesNotMatch(r.stdout, /BUILD FAILED/);
  });

  test('the two named exceptions degrade — but they still carry the deadline', async () => {
    // buildReadOptional is the gateway wall and /u/[handle], and nothing else. A hang must
    // still END, or "never fails the build" is only true of a network that answers.
    const r = await attempt(process.execPath, [DRIVER, 'optional-hang']);
    assert.equal(r.code, 0, 'a named degrade case must not fail the build');
    assert.match(r.stdout, /RESULT \{"degraded":true\} calls=4/, 'it degrades, after trying');
    assert.match(r.stdout, /DEGRADING — decoration only/, 'and it says so, with its reason');
  });

  test('a third degrade case cannot be added without writing down why', async () => {
    const r = await attempt(process.execPath, [DRIVER, 'optional-no-why']);
    assert.match(r.stdout, /THREW .*requires a written reason/);
  });

  test('the SHIPPED numbers are the ones the build will use', async () => {
    // The cases above shrink the deadline so they run in milliseconds. This is the one place
    // the real values are named, so a driver that shrinks them cannot hide a change to them.
    const { BUILD_READ } = await import('../../app/lib/build-read.mjs');
    assert.equal(BUILD_READ.attempts, 4);
    assert.equal(BUILD_READ.timeoutMs, 20000);
    assert.deepEqual(BUILD_READ.backoffMs, [1000, 3000, 8000]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('the REST pre-build script: 5xx, malformed, empty, and a host that never answers', () => {
  // scripts/generate-redirects.mjs emits public/_redirects — 335 rules today, of which 326 are
  // the legacy pre-migration story URLs Google still has indexed. Measured before PL-12: a 500,
  // an empty body and a truncated body ALL produced "(0 slugs from CMS, 9 static)" and exit 0.
  // Nine rules where there had been 335, silently, on a green build.
  const SCRIPT = join(ROOT, 'scripts/generate-redirects.mjs');
  const PROBE = join(ROOT, 'scripts/.pl12-probe-redirects.mjs');   // beside the original, so its relative import resolves
  const REDIRECTS = join(ROOT, 'public/_redirects');
  let saved;

  const makeProbe = (rigUrl) => {
    const src = readFileSync(SCRIPT, 'utf8');
    const patched = src.replace(/^const FB_DB = '[^']*';$/m, `const FB_DB = '${rigUrl}';`);
    // The probe must differ from the shipped script by EXACTLY the database URL. Anything else
    // and this suite is testing a file nobody deploys.
    assert.notEqual(patched, src, 'the probe must have replaced the FB_DB line');
    assert.equal(patched.split('\n').length, src.split('\n').length);
    writeFileSync(PROBE, patched);
    return PROBE;
  };

  before(() => { saved = readFileSync(REDIRECTS, 'utf8'); });
  after(() => {
    writeFileSync(REDIRECTS, saved);
    if (existsSync(PROBE)) unlinkSync(PROBE);
  });

  for (const [mode, why] of [['500', 'Firebase answered with an error'], ['malformed', 'the body was truncated']]) {
    test(`${mode}: fails the build and leaves public/_redirects untouched`, async () => {
      const rig = await startRig(mode);
      try {
        const before = readFileSync(REDIRECTS, 'utf8');
        const r = await attempt(process.execPath, [makeProbe(rig.url)]);
        assert.notEqual(r.code, 0, `${why} — that is unreadable, not empty`);
        assert.match(r.stdout, /BUILD FAILED — FIREBASE COULD NOT BE READ/);
        assert.match(r.stdout, /_redirects/, 'the message must name what could not be built');
        // ⭑ NOTHING PARTIAL. The script overwrites a git-tracked file in place, so a failure
        // after the write would leave a gutted _redirects for the next deploy to pick up.
        assert.equal(readFileSync(REDIRECTS, 'utf8'), before,
          'a failed read must not have rewritten _redirects');
      } finally { await rig.close(); }
    });
  }

  test('empty: a CMS with no stories writes a redirects file with no story rules, and exits 0', async () => {
    const rig = await startRig('empty');
    try {
      const r = await attempt(process.execPath, [makeProbe(rig.url)]);
      assert.equal(r.code, 0, 'an empty catalogue is a valid answer');
      assert.match(r.stdout, /\(0 slugs from CMS, 9 static\)/);
      assert.doesNotMatch(r.stdout, /BUILD FAILED/);
    } finally { await rig.close(); }
  });

  test('healthy: the story rules come back', async () => {
    const rig = await startRig('ok');
    try {
      const r = await attempt(process.execPath, [makeProbe(rig.url)]);
      assert.equal(r.code, 0);
      // Two published, one published:false. The filter is doing its job.
      assert.match(r.stdout, /\(2 slugs from CMS, 9 static\)/);
      const written = readFileSync(REDIRECTS, 'utf8');
      assert.match(written, /alpha-tale/);
      assert.doesNotMatch(written, /\/hidden\s/);
    } finally { await rig.close(); }
  });

  test('THE REAL DEADLINE, END TO END — a host that never answers ends the script', async () => {
    // ⭑ THE ONE CASE THAT PAYS FULL PRICE: the shipped 20s deadline × 4 attempts + 12s of
    // backoff ≈ 92s. Everything else shrinks the numbers; this proves the numbers that ship.
    // Before PL-12 this input hung on the OS connect timeout and then reported "0 slugs".
    const rig = await startRig('slow');
    try {
      const t0 = Date.now();
      const r = await attempt(process.execPath, [makeProbe(rig.url)]);
      const secs = (Date.now() - t0) / 1000;
      assert.notEqual(r.code, 0, 'a host that never answers must end the build');
      assert.match(r.stdout, /BUILD FAILED — FIREBASE COULD NOT BE READ/);
      assert.ok(secs > 80 && secs < 170, `expected ~92s of deadline+backoff, took ${secs.toFixed(1)}s`);
    } finally { await rig.close(); }
  }, { timeout: 240000 });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('§6 — the shop whose books do not open', () => {
  // ⛔ THE CASE PL-12 EXISTS FOR, AND IT IS RUN AGAINST A REAL `next build`.
  //
  // The structural fact: /bookstore is a CLIENT-SIDE LIVE QUERY and every /bookstore/{slug} is
  // STATIC, enumerated at build. So a build in which only bookstore_titles fails ships a shelf
  // listing every title and a single sentinel detail page. Measured before the fix: exit 0,
  // one HTML file, and nineteen dead links.
  const ROUTE = join(ROOT, 'app/bookstore/[slug]/page.js');
  const BACKUP = join(ROOT, 'app/bookstore/[slug]/.page.js.pl12-backup');
  const OUT = join(ROOT, 'out');

  const countBookstorePages = () => {
    const dir = join(OUT, 'bookstore');
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((f) => f.endsWith('.html')).length;
  };

  // ⚠ RESTORE-FIRST. These two cases edit a real source file and put it back in after(). An
  // interrupted run (Ctrl-C, a CI cancellation) would otherwise leave the mutated route on
  // disk, and the next run would back THAT up as the original — turning a stray interrupt into
  // a committed regression. If a backup is already here, the last run did not finish.
  before(() => {
    if (existsSync(BACKUP)) copyFileSync(BACKUP, ROUTE);
    copyFileSync(ROUTE, BACKUP);
  });
  after(() => {
    copyFileSync(BACKUP, ROUTE);
    unlinkSync(BACKUP);
  });

  // Injects a failure into the bookstore read ONLY — cms_stories and everything else still
  // succeed. That asymmetry is the whole point: a total outage is obvious, a partial one is not.
  const injectFailure = () => {
    const src = readFileSync(BACKUP, 'utf8');
    const marker = 'const snap = await get(query(ref(db, \'bookstore_titles\'), orderByChild(\'status\'), equalTo(\'published\')));';
    assert.ok(src.includes(marker), 'the bookstore read moved — this injection must be re-aimed');
    writeFileSync(ROUTE, src.replace(marker, 'throw new Error(\'PL12-INJECTED: bookstore_titles unreadable\');'));
  };

  test('a bookstore_titles failure now FAILS the build, loudly, with nothing left in out/', async () => {
    rmSync(OUT, { recursive: true, force: true });
    injectFailure();
    const r = await attempt('npx', ['next', 'build']);

    assert.notEqual(r.code, 0, 'the build must not succeed without a catalogue');
    const said = r.stdout + r.stderr;
    assert.match(said, /BUILD FAILED — FIREBASE COULD NOT BE READ/);
    assert.match(said, /bookstore_titles/, 'the message must name the node');
    assert.match(said, /\/bookstore\/\[slug\]/, 'and the route that needed it');
    assert.match(said, /PL12-INJECTED/, 'and the underlying error');
    // ⭑ NOTHING PARTIAL. A shelf with no detail pages must never reach a deploy.
    assert.equal(countBookstorePages(), 0, 'out/ must not carry a half-built shop');
  }, { timeout: 600000 });

  test('MUTATION — with the guard removed, the same failure ships the diminished shop', async () => {
    // ⭑ THE PROOF THAT THE CASE ABOVE CAN FAIL. This restores the pre-PL-12 behaviour verbatim
    // — a try/catch that logs and falls through to the sentinel — and asserts the exact outcome
    // that was measured on 27 Aug: exit 0, one detail page, against a shelf of nineteen.
    //
    // If this test ever goes green while the one above also passes, the guard has stopped being
    // load-bearing and the case above has become decoration.
    rmSync(OUT, { recursive: true, force: true });
    const src = readFileSync(BACKUP, 'utf8');
    const guarded = src.slice(src.indexOf('export async function generateStaticParams() {'));
    const end = guarded.indexOf('\n}\n') + 3;
    const legacy = `export async function generateStaticParams() {
  const params = [];
  try {
    throw new Error('PL12-INJECTED: bookstore_titles unreadable');
  } catch (e) {
    console.error('[bookstore/[slug]] generateStaticParams failed', e);
  }
  return params.length ? params : [{ slug: SENTINEL_SLUG }];
}
`;
    writeFileSync(ROUTE, src.replace(guarded.slice(0, end), legacy));
    const r = await attempt('npx', ['next', 'build']);

    assert.equal(r.code, 0, 'the pre-PL-12 code built green — that is what made this dangerous');
    assert.equal(countBookstorePages(), 1,
      'the sentinel and nothing else: a shelf of nineteen titles whose books do not open');
    assert.ok(existsSync(join(OUT, 'bookstore/__no-titles-yet__.html')));
    // And the shelf itself shipped, which is what made it invisible.
    assert.ok(existsSync(join(OUT, 'bookstore.html')), 'the shelf ships and runs its live query');
  }, { timeout: 600000 });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe('no build-time read can bypass the contract', () => {
  test('every Firebase read that runs at build time goes through build-read.mjs', async () => {
    // Not a shape assertion about a function — a reachability one about the tree. A new route
    // added next month with its own try/catch would restore the exact defect PL-12 removed, and
    // nothing else in this suite would notice, because the fault cases can only test the sites
    // they know about.
    const SERVER_READERS = [
      'app/bookstore/[slug]/page.js', 'app/stories/[slug]/page.js', 'app/stories/[slug]/layout.js',
      'app/reader/[slug]/page.js', 'app/lib/voices-build.js', 'app/series/[slug]/page.js',
      'app/series/instalment/[instalmentId]/page.js', 'app/series/read/[instalmentId]/page.js',
      'app/open-pages/[id]/page.js', 'app/open-pages/edit/[id]/page.js', 'app/sitemap.js',
      'app/lib/gateway-build.js', 'app/u/[handle]/page.js',
      'scripts/generate-redirects.mjs', 'scripts/generate-gateway-wall.mjs',
    ];
    // Exactly two may degrade, and they are named here rather than inferred.
    const MAY_DEGRADE = new Set(['app/lib/gateway-build.js', 'app/u/[handle]/page.js', 'scripts/generate-gateway-wall.mjs']);

    for (const rel of SERVER_READERS) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      assert.ok(/build-read\.mjs/.test(src), `${rel} must read through build-read.mjs`);
      if (!MAY_DEGRADE.has(rel)) {
        assert.ok(/buildRead\(/.test(src), `${rel} must use buildRead — it is not a named degrade case`);
        assert.ok(!/buildReadOptional\(/.test(src),
          `${rel} degrades, and only the gateway wall and /u/[handle] may. See the argument in build-read.mjs.`);
      }
    }

    // And no build-time module may still be catching its own read. A catch cannot run for a
    // promise that never settles, which is what made these dead code in the first place.
    for (const rel of SERVER_READERS.filter((r) => !MAY_DEGRADE.has(r))) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      assert.ok(!/catch\s*\([^)]*\)\s*\{[^}]*generateStaticParams/.test(src),
        `${rel} still catches around its own enumeration`);
    }
  });
});
