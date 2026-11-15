// BELL-1 — the bell spec's instant leaves room for TODAY at every minute of the London day, and the
// spec loads under CI's Node 22.
//
// tests/notify/bell.spec.mjs failed in about the first 90 minutes after London midnight: its TODAY
// fixtures, dated minutes before the real time, fell on the day before. bellInstant()
// (tests/notify/bell-clock.mjs) picks the instant the spec and its page run at. It reads London's
// date through Intl and imports nothing, because the first fix (f85b86c4) imported app/lib/bell.js
// into the Playwright spec and Playwright's loader on Node 22 could not link it. Here, under
// node --test, it is proven against the page's own sectionOf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sectionOf } from '../../app/lib/bell.js';
import { bellInstant, runnerNow, londonDate, TODAY_SPAN_MIN } from '../notify/bell-clock.mjs';

const MIN = 60000, H = 60 * MIN;
const TODAY_MINUTES = [1, 3, 5, 8, 12, 20, 36, 40, 70, 80, 90, 300]; // bell.spec.mjs's, and the canvas fixtures' 3–36
const WEEK_MINUTES = [26 * 60, 2 * 24 * 60, 3 * 24 * 60, 5 * 24 * 60];
const EARLIER_MINUTES = [10 * 24 * 60];
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

function check(now) {
  const at = bellInstant(now);
  const when = new Date(now).toISOString();
  assert.ok(at <= now, `${when}: the instant is in the future`);
  assert.ok(now - at <= (TODAY_SPAN_MIN + 60) * MIN, `${when}: the instant is more than 6½ hours old`);
  for (const m of TODAY_MINUTES) assert.equal(sectionOf(at - m * MIN, at), 'TODAY', `${when}: ${m}m`);
  for (const m of WEEK_MINUTES) assert.equal(sectionOf(at - m * MIN, at), 'THIS WEEK', `${when}: ${m}m`);
  for (const m of EARLIER_MINUTES) assert.equal(sectionOf(at - m * MIN, at), 'EARLIER', `${when}: ${m}m`);
}

test('the failure it fixes: at 00:30 London, 12 minutes before the real time is not TODAY; before the instant it is', () => {
  const now = Date.parse('2026-11-15T00:30:00Z'); // GMT
  assert.equal(sectionOf(now - 40 * MIN, now), 'THIS WEEK');
  const at = bellInstant(now);
  assert.notEqual(at, now);
  assert.equal(sectionOf(at - 40 * MIN, at), 'TODAY');
});

test('00:30, 12:00 and 23:58 London', () => {
  for (const iso of ['2026-11-15T00:30:00Z', '2026-11-14T12:00:00Z', '2026-11-13T23:58:00Z']) check(Date.parse(iso));
  assert.equal(bellInstant(Date.parse('2026-11-14T12:00:00Z')), Date.parse('2026-11-14T12:00:00Z'), 'noon runs on the real time');
});

test('London\'s date, as Intl gives it, is the date sectionOf counts from (both clock changes)', () => {
  assert.equal(londonDate(Date.parse('2026-11-14T23:59:00Z')), '2026-11-14');
  assert.equal(londonDate(Date.parse('2026-07-14T23:30:00Z')), '2026-07-15'); // 00:30 BST
  assert.equal(londonDate(Date.parse('2026-03-29T00:30:00Z')), '2026-03-29');
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

test('BELL_SPEC_NOW fakes the runner, never into the future', () => {
  const real = Date.parse('2026-11-14T01:00:00Z');
  assert.equal(runnerNow({}, real), real);
  assert.equal(runnerNow({ BELL_SPEC_NOW: '2026-11-14T00:30:00Z' }, real), Date.parse('2026-11-14T00:30:00Z'));
  assert.throws(() => runnerNow({ BELL_SPEC_NOW: '2026-11-14T02:00:00Z' }, real), /future/);
  assert.throws(() => runnerNow({ BELL_SPEC_NOW: 'soon' }, real), /not a date/);
});

test('Node 22: the clock imports nothing, and the spec imports no app code (the import that broke CI)', () => {
  assert.ok(!/^\s*import\s/m.test(src('tests/notify/bell-clock.mjs')), 'bell-clock.mjs must stay self-contained');
  const spec = src('tests/notify/bell.spec.mjs');
  const imports = [...spec.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  assert.ok(imports.includes('./bell-clock.mjs'));
  assert.deepEqual(imports.filter((p) => /(^|\/)app\//.test(p)), [], 'the Playwright spec must not import app code');
});
