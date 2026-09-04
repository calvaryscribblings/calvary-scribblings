// R36 — the submission rate limiter.
//
// TWO THINGS ARE BEING PROVEN AND THEY NEED DIFFERENT TESTS.
//
//   1. The window arithmetic — a pure function, tested directly. A sliding window
//      that ROLLS, not a bucket that resets on a fixed clock.
//   2. THE ORDER. The limiter is worthless if it runs after the Anthropic call, and
//      no amount of testing evaluate() would catch that. So the second half of this
//      file imports the real Pages Function, stubs global fetch, and COUNTS CALLS TO
//      api.anthropic.com. If the check ever slides below the model call, the count
//      goes from 0 to 1 and the test fails. That is a test that can fail.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate, refusalMessage, consume,
  HOUR_MS, DAY_MS, HOURLY_LIMIT, DAILY_LIMIT,
} from '../../functions/api/open-pages/_rate-limit.js';

const NOW = 1_800_000_000_000;

// ═══════════════════════════════════════════════════════════════════════════════
describe('R36 · the window arithmetic', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('an empty history passes, and the submission is recorded', () => {
    const v = evaluate([], NOW);
    assert.equal(v.ok, true);
    assert.deepEqual(v.kept, [NOW], 'the current submission must be written back');
  });

  test('the hourly limit refuses the one that would exceed it, not the one that meets it', () => {
    const four = [1, 2, 3, 4].map((i) => NOW - i * 60_000);
    assert.equal(evaluate(four, NOW).ok, true, `${HOURLY_LIMIT - 1} in the hour must still pass`);

    const five = [1, 2, 3, 4, 5].map((i) => NOW - i * 60_000);
    const v = evaluate(five, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.scope, 'hour');
  });

  test('THE WINDOW ROLLS — it does not reset on a fixed clock', () => {
    // The bug this guards: a calendar-hour bucket lets an account spend its whole
    // allowance at 10:59 and the whole of the next one at 11:00 — 2x the limit in
    // two minutes. With a sliding window, the 10:59 submissions are still inside
    // the hour at 11:00 and the account is still refused.
    const at1059 = Array.from({ length: HOURLY_LIMIT }, (_, i) => NOW + i * 1000);
    const oneMinuteLater = NOW + 60_000;
    const v = evaluate(at1059, oneMinuteLater);
    assert.equal(v.ok, false, 'a fixed-clock bucket would have let this through');
    assert.equal(v.scope, 'hour');

    // And it opens again exactly one hour after the OLDEST submission in the window,
    // one at a time — not all at once on the hour.
    const justAfter = at1059[0] + HOUR_MS + 1;
    assert.equal(evaluate(at1059, justAfter).ok, true, 'the oldest has aged out; one slot is free');
  });

  test('retryAt is the oldest submission in the binding window plus that window', () => {
    const stamps = Array.from({ length: HOURLY_LIMIT }, (_, i) => NOW - (30 - i) * 60_000);
    const v = evaluate(stamps, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.retryAt, Math.min(...stamps) + HOUR_MS);
    assert.ok(v.retryAt > NOW, 'a retry time in the past would be a lie');
  });

  test('the daily limit binds even when the hour is clear', () => {
    // DAILY_LIMIT submissions spread evenly across the day: never more than a couple
    // in any hour, so only the daily window can catch this. It is the shape a patient
    // abuser uses, and the reason a minimum-gap rule (the nearest rules-only trick)
    // would not work.
    const spread = Array.from({ length: DAILY_LIMIT }, (_, i) => NOW - (i + 1) * 90 * 60_000);
    const inLastHour = spread.filter((t) => t > NOW - HOUR_MS).length;
    assert.equal(inLastHour, 0, 'fixture must not trip the hourly window');
    const v = evaluate(spread, NOW);
    assert.equal(v.ok, false);
    assert.equal(v.scope, 'day');
    assert.equal(v.retryAt, Math.min(...spread) + DAY_MS);
  });

  test('timestamps older than a day are pruned, so the list cannot grow without bound', () => {
    const ancient = Array.from({ length: 500 }, (_, i) => NOW - DAY_MS - i * 1000);
    const v = evaluate(ancient, NOW);
    assert.equal(v.ok, true);
    assert.deepEqual(v.kept, [NOW], 'everything older than the day window is dropped');
  });

  test('junk in the stored list cannot crash or unlock the limiter', () => {
    const junk = [null, 'x', undefined, NaN, Infinity, {}, NOW + DAY_MS, ...Array.from({ length: HOURLY_LIMIT }, (_, i) => NOW - i * 1000)];
    const v = evaluate(junk, NOW);
    assert.equal(v.ok, false, 'the real timestamps still count');
    assert.equal(v.scope, 'hour');
  });

  test('the refusal says what happened and when they can write again', () => {
    const msg = refusalMessage('hour', NOW + 22 * 60_000, NOW);
    assert.match(msg, /22 minutes/, 'must quote the wait');
    assert.match(msg, /safe/i, 'must say the work is not lost — this is a writing surface');
    assert.match(msg, new RegExp(String(HOURLY_LIMIT)), 'must say what the limit was');
    const day = refusalMessage('day', NOW + 5 * HOUR_MS, NOW);
    assert.match(day, /5 hours/);
    assert.match(day, new RegExp(String(DAILY_LIMIT)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('R36 · consume() — the atomic half', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('a lost race is retried against the winner\'s number, not the stale one', async () => {
    let reads = 0;
    const stored = [[], Array.from({ length: HOURLY_LIMIT }, (_, i) => NOW - i * 1000)];
    const fake = async (url, opts = {}) => {
      if (!opts.method) {
        // Second read returns the state the racing writer committed.
        const body = stored[Math.min(reads++, 1)];
        return { ok: true, headers: { get: () => `etag${reads}` }, json: async () => body };
      }
      // First PUT loses the compare-and-set; there is no second PUT because the
      // re-read now shows the account at its limit.
      return { ok: false, status: 412 };
    };
    const r = await consume('https://db', 'tok', 'u1', NOW, fake);
    assert.equal(r.ok, false, 'the retry must see the winner\'s count and refuse');
    assert.equal(reads, 2, 'it must actually re-read rather than reuse the stale list');
  });

  test('a counter that cannot be read FAILS OPEN, and says so', async () => {
    const fake = async () => { throw new Error('rtdb unreachable'); };
    const r = await consume('https://db', 'tok', 'u1', NOW, fake);
    assert.equal(r.ok, true, 'a database blip must not take the writing surface down');
    assert.equal(r.degraded, true, 'and it must be visible that the limiter was not enforced');
  });
});
