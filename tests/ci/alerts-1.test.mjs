// ALERTS-1 (ruling 261) — the covers alarm in the launch check, on fixtures only (no production
// read), and the daily run that mails it on red. The alert service itself, and the duplicate
// payment that uses it, run against the emulator in tests/store-webhook/alerts.emulator.test.mjs.
//
//   node --test tests/ci/alerts-1.test.mjs          (npm run test:ci)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIN = 60_000;
const NOW = Date.parse('2026-11-02T08:05:00Z');      // a Monday in GMT; the judge does not care
const at = (mins) => new Date(NOW + mins * MIN).toISOString();
const lc = () => import('../../scripts/launch-check.mjs');
const gate = () => import('../../scripts/launch-check-gate.mjs');
const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// The library as the check reads it: one held story per case, plus everything that must NOT count.
const library = (held) => ({
  live: { published: true, publishAt: at(-600) },
  scheduledWithCover: { published: false, publishAt: at(60) },
  hiddenAndHeld: { published: false, coverHold: true, hiddenAt: 1, publishAt: at(60) },
  ...held,
});

describe('ALERTS-1 · the Covers row', () => {
  test('green: reconciled 10 minutes ago, nothing held within 72 hours', async () => {
    const { judgeCovers, heldGoingLive, GREEN } = await lc();
    const held = heldGoingLive(library({ far: { published: false, coverHold: true, publishAt: at(73 * 60) } }), NOW);
    assert.equal(held.count, 0);
    assert.equal(judgeCovers({ lastReconcileOkAt: NOW - 10 * MIN, held }, NOW).status, GREEN);
  });

  test('red: the last successful reconcile is more than an hour old', async () => {
    const { judgeCovers, RED, GREEN } = await lc();
    const none = { count: 0, earliestMs: NaN };
    assert.equal(judgeCovers({ lastReconcileOkAt: NOW - 61 * MIN, held: none }, NOW).status, RED);
    assert.equal(judgeCovers({ lastReconcileOkAt: NOW - 60 * MIN, held: none }, NOW).status, GREEN, 'an hour exactly is still green');
  });

  test('red: no successful reconcile could be found at all', async () => {
    const { judgeCovers, RED } = await lc();
    const r = judgeCovers({ lastReconcileOkAt: NaN, held: { count: 0, earliestMs: NaN } }, NOW);
    assert.equal(r.status, RED);
    assert.match(r.evidence, /last successful reconcile never/);
  });

  test('red: a held story goes live within 72 hours — or is already overdue', async () => {
    const { judgeCovers, heldGoingLive, RED } = await lc();
    for (const publishAt of [at(71 * 60), at(5), at(-30)]) {
      const held = heldGoingLive(library({ soon: { published: false, coverHold: true, publishAt } }), NOW);
      assert.equal(held.count, 1, publishAt);
      assert.equal(judgeCovers({ lastReconcileOkAt: NOW - 5 * MIN, held }, NOW).status, RED, publishAt);
    }
  });

  test('a hidden held story, a scheduled one with its cover, and a live one never count', async () => {
    const { heldGoingLive } = await lc();
    assert.equal(heldGoingLive(library({}), NOW).count, 0);
    assert.equal(heldGoingLive(null, NOW).count, 0);
  });

  test('the evidence names counts and times, never a slug (Actions logs are public)', async () => {
    const { judgeCovers, heldGoingLive } = await lc();
    const held = heldGoingLive(library({ 'a-secret-unreleased-title': { published: false, coverHold: true, publishAt: at(120) } }), NOW);
    const r = judgeCovers({ lastReconcileOkAt: NOW - 90 * MIN, held }, NOW);
    assert.doesNotMatch(r.evidence, /secret/);
    assert.match(r.evidence, /1 held for a cover and going live within 72 h, the first at 2026-11-02T10:05:00Z/);
    assert.match(r.evidence, /\(90 min ago\)/);
  });

  test('the row is in the table', async () => {
    assert.match(src('scripts/launch-check.mjs'), /judgeCovers\(g\.covers, now\),/);
  });
});

describe('ALERTS-1 · on red, the check mails every day', () => {
  test('a daily 08:05 London run, in BST and in GMT — never both, and never on a Monday', async () => {
    const { shouldRun, emailMode } = await gate();
    const bstTue = Date.parse('2026-10-20T07:05:00Z');   // Tue 08:05 BST
    const gmtTue = Date.parse('2026-11-03T08:05:00Z');   // Tue 08:05 GMT
    const gmtMon = Date.parse('2026-11-02T08:05:00Z');   // Mon 08:05 GMT
    assert.equal(shouldRun('5 7 * * *', bstTue), true);
    assert.equal(shouldRun('5 8 * * *', bstTue + 3600_000), false);
    assert.equal(shouldRun('5 8 * * *', gmtTue), true);
    assert.equal(shouldRun('5 7 * * *', gmtTue - 3600_000), false);
    assert.equal(shouldRun('5 8 * * *', gmtMon), false, 'Monday 00:10 has already mailed the table');
    assert.equal(emailMode('5 8 * * *'), 'if-red');
    assert.equal(emailMode('5 7 * * *'), 'if-red');
    assert.equal(emailMode('10 0 * * 1'), 'always');
    assert.equal(emailMode(''), 'always', 'a dispatch mails as it always did');
  });

  test('the workflow runs the daily crons with --email-if-red, by the path it already uses', () => {
    const yml = src('.github/workflows/launch-check.yml');
    assert.match(yml, /- cron: '5 7 \* \* \*'/);
    assert.match(yml, /- cron: '5 8 \* \* \*'/);
    assert.match(yml, /grep -E '\^\(run\|mode\)='/);
    assert.match(yml, /steps\.gate\.outputs\.mode \}\}" = "if-red" \]; then\n\s+node scripts\/launch-check\.mjs --email-if-red/);
  });

  test('--email-if-red mails only when a row is red, through /api/ops/launch-email', () => {
    const s = src('scripts/launch-check.mjs');
    assert.match(s, /if \(args\.includes\('--email'\) \|\| \(args\.includes\('--email-if-red'\) && red\)\) \{\n\s+const sent = await email\(g\.sa, rows, now\);/);
    assert.match(s, /fetch\(`\$\{SITE\}\/api\/ops\/launch-email`/);
  });
});
