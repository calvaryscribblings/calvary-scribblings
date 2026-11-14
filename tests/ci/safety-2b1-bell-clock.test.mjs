// SAFETY-2B.1 — the bell spec's instant leaves room for TODAY at every minute of the London day.
//
// tests/notify/bell.spec.mjs went red on main at 00:12 London (14 Nov): its TODAY fixtures, dated
// minutes before the real time, fell on the day before. bellInstant() (tests/notify/bell-clock.mjs)
// picks the instant the spec and its page run at. Proven here for every minute of an ordinary London
// day and of both 2026 clock-change days, against the page's own sectionOf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionOf } from '../../app/lib/bell.js';
import { bellInstant, runnerNow, TODAY_SPAN_MIN } from '../notify/bell-clock.mjs';

const MIN = 60000, H = 60 * MIN;
const TODAY_MINUTES = [1, 5, 8, 12, 20, 40, 70, 80, 90, 300]; // as in bell.spec.mjs
const WEEK_MINUTES = [26 * 60, 2 * 24 * 60, 3 * 24 * 60, 5 * 24 * 60];
const EARLIER_MINUTES = [10 * 24 * 60];

function check(now) {
  const at = bellInstant(now);
  assert.ok(at <= now, `${new Date(now).toISOString()}: the instant is in the future`);
  assert.ok(now - at <= (TODAY_SPAN_MIN + 60) * MIN, `${new Date(now).toISOString()}: the instant is more than 6½ hours old`);
  for (const m of TODAY_MINUTES) assert.equal(sectionOf(at - m * MIN, at), 'TODAY', `${new Date(now).toISOString()}: ${m}m`);
  for (const m of WEEK_MINUTES) assert.equal(sectionOf(at - m * MIN, at), 'THIS WEEK', `${new Date(now).toISOString()}: ${m}m`);
  for (const m of EARLIER_MINUTES) assert.equal(sectionOf(at - m * MIN, at), 'EARLIER', `${new Date(now).toISOString()}: ${m}m`);
}

test('the failure it fixes: at 00:05 London, 12 minutes ago is not TODAY', () => {
  const now = Date.parse('2026-11-14T00:05:00Z'); // GMT
  assert.equal(sectionOf(now - 12 * MIN, now), 'THIS WEEK');
  assert.equal(sectionOf(bellInstant(now) - 12 * MIN, bellInstant(now)), 'TODAY');
});

test('00:05, 12:00 and 23:58 London', () => {
  for (const iso of ['2026-11-14T00:05:00Z', '2026-11-13T12:00:00Z', '2026-11-13T23:58:00Z']) check(Date.parse(iso));
  assert.equal(bellInstant(Date.parse('2026-11-13T12:00:00Z')), Date.parse('2026-11-13T12:00:00Z'), 'noon runs on the real time');
  assert.equal(bellInstant(Date.parse('2026-11-13T23:58:00Z')), Date.parse('2026-11-13T23:58:00Z'), '23:58 runs on the real time');
});

test('the spring-forward day counts real minutes, not the wall clock', () => {
  const now = Date.parse('2026-03-29T04:30:00Z'); // 05:30 BST, but only 270 minutes since midnight
  assert.notEqual(bellInstant(now), now);
  check(now);
});

test('every five minutes of an ordinary day and both clock-change days', () => {
  for (const start of ['2026-11-13T00:00:00Z', '2026-03-28T23:00:00Z', '2026-10-24T23:00:00Z']) {
    const t0 = Date.parse(start);
    for (let t = t0; t < t0 + 26 * H; t += 5 * MIN) check(t);
  }
});

test('the real time is kept whenever the day already holds the fixtures', () => {
  const now = Date.parse('2026-11-13T05:30:00Z'); // 05:30 GMT: exactly the span into the day
  assert.equal(bellInstant(now), now);
  assert.notEqual(bellInstant(now - MIN), now - MIN);
});

test('BELL_SPEC_NOW fakes the runner, never into the future', () => {
  const real = Date.parse('2026-11-14T01:00:00Z');
  assert.equal(runnerNow({}, real), real);
  assert.equal(runnerNow({ BELL_SPEC_NOW: '2026-11-14T00:05:00Z' }, real), Date.parse('2026-11-14T00:05:00Z'));
  assert.throws(() => runnerNow({ BELL_SPEC_NOW: '2026-11-14T02:00:00Z' }, real), /future/);
  assert.throws(() => runnerNow({ BELL_SPEC_NOW: 'soon' }, real), /not a date/);
});
