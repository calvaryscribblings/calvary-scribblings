// CLOCK-1 (ruling 399) — the clock that dispatches the scheduled workflows on time.
//
//   node --test tests/ci/clock-1.test.mjs          (npm run test:clock, and npm run test:ci)
//
// 1. The clock's schedules ARE the workflows' schedules: a cron changed in a workflow file without the
//    clock (or the other way round) fails here. So does a new scheduled workflow the clock doesn't know.
// 2. What it sends makes a dispatched run do what a scheduled run does, and nothing reads the input.
// 3. The cron reader, and "what is due" across a day, duplicate and skipped ticks, and London's clock
//    changes (including the two HELD workflows, whose London gates must pair with the clock's UTC).
// 4. The tick: dry run sends nothing; live claims before it sends, never twice, releases on refusal,
//    never logs the token. The Worker's entry exports only what workerd expects.
// 5. The launch check's row.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import YAML from 'yaml';
import {
  SCHEDULES, CATCH_UP_MIN, SINCE, parseCron, cronMatches, due, latestSlot, slotKey, MINUTE,
} from '../../workers-external/calvary-clock/clock.mjs';
import { tick, dispatch, publicHeartbeat, isLive, REPO } from '../../workers-external/calvary-clock/tick.mjs';
import worker, { ClockState } from '../../workers-external/calvary-clock/worker.mjs';
import { shouldRun as launchGate } from '../../scripts/launch-check-gate.mjs';
import { londonHour, BELL_HOUR } from '../../scripts/square/horizon.mjs';
import { judgeClock, GREEN, RED, NYD } from '../../scripts/launch-check.mjs';
import { CLOCK_ARMED, CLOCK_HEARTBEAT_URL, judgeClockHeartbeat, CLOCK_STALE_MS } from '../../app/lib/clock.js';

const WF = '.github/workflows';
const workflows = Object.fromEntries(readdirSync(WF).filter((f) => f.endsWith('.yml'))
  .map((f) => [f, { src: readFileSync(`${WF}/${f}`, 'utf8'), doc: YAML.parse(readFileSync(`${WF}/${f}`, 'utf8')) }]));
const scheduleOf = (doc) => (doc?.on?.schedule || []).map((s) => s.cron);
const live = SCHEDULES.filter((s) => !s.held);
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ── 1 ───────────────────────────────────────────────────────────────────────────────────────
describe('CLOCK-1 · the clock reads the workflows\' own schedules', () => {
  test('every workflow with a schedule is in the clock, with the same crons in the same order', () => {
    const scheduled = Object.entries(workflows).filter(([, w]) => scheduleOf(w.doc).length);
    assert.ok(scheduled.length >= 9);
    for (const [file, w] of scheduled) {
      const s = SCHEDULES.find((x) => x.workflow === file);
      assert.ok(s, `${file} has a schedule but the clock doesn't know it — add it to SCHEDULES (or hold it, with the reason)`);
      assert.deepEqual(s.crons, scheduleOf(w.doc), `${file}: its schedule changed without the clock's (workers-external/calvary-clock/clock.mjs)`);
    }
  });
  test('and the clock knows no workflow that has none', () => {
    for (const s of SCHEDULES) {
      assert.ok(workflows[s.workflow], `${s.workflow} does not exist`);
      assert.ok(scheduleOf(workflows[s.workflow].doc).length, `${s.workflow} has no schedule left: take it out of the clock`);
      for (const c of s.crons) assert.doesNotThrow(() => parseCron(c), c);
    }
  });
  test('none is held: all nine are dispatched (CLOCK-1.1 made the last two safe to run twice)', () => {
    assert.deepEqual(SCHEDULES.filter((s) => s.held), []);
    assert.equal(SCHEDULES.length, 9);
  });
  test('a held workflow is listed and never fired (the mechanism stays, for the next one found unsafe)', () => {
    const r = due(at('2026-11-16T10:45:00Z'), {}, { schedules: [{ workflow: 'x.yml', crons: ['*/15 * * * *'], inputs: {}, held: 'reason' }] });
    assert.equal(r.fire.length, 0);
    assert.equal(r.held.length, 1);
  });
});

// ── 2 ───────────────────────────────────────────────────────────────────────────────────────
describe('CLOCK-1 · a dispatched run does what the scheduled run does', () => {
  for (const s of live) {
    const { doc, src } = workflows[s.workflow];
    const inputs = doc.on.workflow_dispatch?.inputs || {};
    test(`${s.workflow}: every input the clock sends is declared, with a value it accepts`, () => {
      const sent = { ...s.inputs, clock: s.crons[0] };
      for (const [k, v] of Object.entries(sent)) {
        assert.ok(inputs[k], `${s.workflow} declares no input "${k}" (GitHub refuses a dispatch with an unknown input)`);
        if (inputs[k].type === 'choice') assert.ok(inputs[k].options.includes(v), `${k}=${v} is not an option`);
        if (inputs[k].type === 'boolean') assert.ok(['true', 'false'].includes(v));
      }
      for (const [k, d] of Object.entries(inputs)) if (d.required) assert.ok(k in sent, `${s.workflow}: required input "${k}" is not sent`);
    });
    test(`${s.workflow}: the clock input never reaches a run script (an env value or an if: only)`, () => {
      for (const job of Object.values(doc.jobs)) {
        for (const step of job.steps || []) assert.ok(!/inputs\.clock|github\.event\.schedule/.test(step.run || ''), `${step.name || step.run}: interpolated into the script`);
      }
      void src;
    });
    test(`${s.workflow}: one run at a time, never cancelled mid-run`, () => {
      assert.ok(doc.concurrency?.group, 'no concurrency group');
      assert.equal(doc.concurrency['cancel-in-progress'], false);
    });
  }
  test('the write-or-send switch each one reads is what the clock sets', () => {
    // A boolean `apply` the run script tests as "true" on a dispatch; push-announce's MODE.
    for (const f of ['account-scrub.yml', 'covers.yml', 'index-reconcile.yml', 'withdrawals.yml', 'square-horizon.yml']) {
      assert.equal(SCHEDULES.find((s) => s.workflow === f).inputs.apply, 'true', f);
      assert.match(workflows[f].src, /inputs\.apply \}\}"? = "true"|IN_APPLY" = "true"/, f);
    }
    assert.equal(SCHEDULES.find((s) => s.workflow === 'push-announce.yml').inputs.mode, 'apply');
    assert.match(workflows['push-announce.yml'].src, /MODE: \$\{\{ github\.event_name == 'schedule' && 'apply' \|\| inputs\.mode \}\}/);
    assert.match(workflows['push-announce.yml'].src, /\s+apply\)\s+node scripts\/push\/announce\.mjs --apply/);
  });
  test('square-horizon: a clock run is a scheduled run (apply, and the liveness step)', () => {
    const w = workflows['square-horizon.yml'];
    const steps = w.doc.jobs.sweep.steps;
    assert.equal(steps.find((x) => /Liveness/.test(x.name || '')).if, "github.event_name == 'schedule' || inputs.clock != ''");
    assert.ok(w.doc.jobs.sweep['timeout-minutes'] <= 10, 'under the bell claim\'s lease');
  });
  test('launch-check: the gate and the check read the cron that fired, from a schedule or the clock alike', () => {
    const steps = workflows['launch-check.yml'].doc.jobs.check.steps;
    const gate = steps.find((x) => x.id === 'gate');
    const check = steps.find((x) => /Check, and email/.test(x.name || ''));
    for (const st of [gate, check]) assert.equal(st.env.SCHEDULE, '${{ github.event.schedule || inputs.clock }}');
    assert.match(gate.run, /launch-check-gate\.mjs "\$SCHEDULE"/);
    assert.match(check.run, /--email-if-red --slot "\$SCHEDULE" --apply/);
    assert.match(check.run, /--email --slot "\$SCHEDULE" --apply/);
    assert.equal(check.env.GUARD_SERVICE_ACCOUNT, check.env.LAUNCH_SERVICE_ACCOUNT);
    assert.ok(workflows['launch-check.yml'].doc.jobs.check['timeout-minutes'] <= 10, 'under the email claim\'s lease');
  });
  test('index-reconcile: a dispatch\'s max default is the script\'s own default', async () => {
    const { DEFAULT_MAX_RECORDS } = await import('../../scripts/reconcile-index.mjs');
    assert.equal(String(workflows['index-reconcile.yml'].doc.on.workflow_dispatch.inputs.max.default), String(DEFAULT_MAX_RECORDS));
  });
});

// ── 3 ───────────────────────────────────────────────────────────────────────────────────────
const at = (iso) => Date.parse(iso);
describe('CLOCK-1 · the cron reader', () => {
  test('steps, lists, ranges', () => {
    assert.ok(cronMatches('*/15 * * * *', at('2026-11-16T10:45:00Z')));
    assert.ok(!cronMatches('*/15 * * * *', at('2026-11-16T10:44:00Z')));
    assert.ok(cronMatches('7,22,37,52 * * * *', at('2026-11-16T10:37:00Z')));
    assert.ok(!cronMatches('7,22,37,52 * * * *', at('2026-11-16T10:36:00Z')));
    assert.ok(cronMatches('10-20/5 * * * *', at('2026-11-16T10:15:00Z')));
    assert.ok(!cronMatches('10-20/5 * * * *', at('2026-11-16T10:25:00Z')));
    assert.ok(cronMatches('5 * * * *', at('2026-11-16T03:05:59Z')), 'the whole minute matches');
  });
  test('day of week: 0 and 7 are Sunday; both day fields restricted means either', () => {
    assert.ok(cronMatches('10 23 * * 0', at('2026-11-15T23:10:00Z')));   // a Sunday
    assert.ok(cronMatches('10 23 * * 7', at('2026-11-15T23:10:00Z')));
    assert.ok(!cronMatches('10 23 * * 0', at('2026-11-16T23:10:00Z')));
    assert.ok(cronMatches('0 0 1 * 1', at('2026-11-16T00:00:00Z')), 'a Monday that is not the 1st');
    assert.ok(cronMatches('0 0 1 * 1', at('2026-12-01T00:00:00Z')), 'the 1st, a Tuesday');
    assert.ok(cronMatches('10 23 29 9 *', at('2027-09-29T23:10:00Z')));
    assert.ok(!cronMatches('10 23 29 9 *', at('2027-09-28T23:10:00Z')));
  });
  test('it refuses what it cannot read', () => {
    for (const bad of ['* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * JAN *', '* * * * MON', '*/0 * * * *', '5-1 * * * *', '? * * * *']) {
      assert.throws(() => parseCron(bad), bad);
    }
  });
});

/** Tick every minute over [from, to), optionally skipping or repeating; returns dispatches per workflow. */
function simulate(from, to, { schedules = SCHEDULES, skip = () => false, repeat = () => false } = {}) {
  let state = {};
  const fired = [];
  for (let t = from; t < to; t += MINUTE) {
    if (skip(t)) continue;
    for (let n = 0; n < (repeat(t) ? 3 : 1); n++) {
      const r = due(t, state, { schedules });
      state = r.state;
      fired.push(...r.fire.map((f) => ({ ...f, tickAt: t })));
    }
  }
  return fired;
}
const count = (fired, wf) => fired.filter((f) => f.workflow === wf).length;

describe('CLOCK-1 · what is due', () => {
  const T = at('2026-11-16T10:45:00Z');
  test('on the minute: the */15 jobs', () => {
    const r = due(T, {});
    assert.deepEqual(r.fire.map((f) => f.workflow).sort(), ['account-scrub.yml', 'covers.yml', 'index-reconcile.yml', 'push-announce.yml']);
    assert.deepEqual(r.fire.find((f) => f.workflow === 'push-announce.yml').inputs, { mode: 'apply', clock: '*/15 * * * *' });
    for (const f of r.fire) assert.equal(f.slot, T);
  });
  test('the clock\'s first tick fires only what is due that minute: earlier slots were GitHub\'s', () => {
    const r = due(T + 7 * MINUTE + 30_000, {}); // 10:52:30 — proofs-mail's minute; the 10:45 jobs are not caught up
    assert.deepEqual(r.fire.map((f) => f.workflow), ['proofs-mail.yml']);
    assert.equal(r.state[SINCE], T + 7 * MINUTE);
    assert.equal(due(T + 8 * MINUTE, r.state).state[SINCE], T + 7 * MINUTE, 'kept');
  });
  test('the same minute again fires nothing', () => {
    const r1 = due(T, {});
    assert.equal(due(T, r1.state).fire.length, 0);
    assert.equal(due(T + 30_000, r1.state).fire.length, 0);
  });
  test('a late tick fires the slot it missed, once, inside the window; outside it, GitHub\'s schedule has it', () => {
    const before = due(T - MINUTE, {}).state; // 10:44 — the clock's first tick; nothing due
    const late = due(T + 4 * MINUTE, before);
    assert.equal(late.fire.filter((f) => f.workflow === 'covers.yml').length, 1);
    assert.equal(late.fire.find((f) => f.workflow === 'covers.yml').slot, T);
    assert.equal(due(T + 5 * MINUTE, late.state).fire.filter((f) => f.workflow === 'covers.yml').length, 0);
    const prior = { [SINCE]: T - HOUR, [slotKey('covers.yml', '*/15 * * * *')]: T - 15 * MINUTE };
    assert.equal(due(T + CATCH_UP_MIN * MINUTE, prior).fire.filter((f) => f.workflow === 'covers.yml').length, 0, 'past the window');
    assert.equal(due(T + (CATCH_UP_MIN - 1) * MINUTE, prior).fire.filter((f) => f.workflow === 'covers.yml').length, 1, 'just inside it');
  });
  test('latestSlot looks back exactly the window', () => {
    assert.equal(latestSlot('*/15 * * * *', T + 9 * MINUTE), T);
    assert.equal(latestSlot('*/15 * * * *', T + 10 * MINUTE), null);
  });
  test('a whole day, ticking every minute: each job fires exactly as often as its cron', () => {
    const fired = simulate(at('2026-11-16T00:00:00Z'), at('2026-11-17T00:00:00Z'));
    assert.equal(count(fired, 'account-scrub.yml'), 96);
    assert.equal(count(fired, 'covers.yml'), 96);
    assert.equal(count(fired, 'index-reconcile.yml'), 96);
    assert.equal(count(fired, 'push-announce.yml'), 96);
    assert.equal(count(fired, 'proofs-mail.yml'), 96);
    assert.equal(count(fired, 'withdrawals.yml'), 24);
    assert.equal(count(fired, 'backup-liveness.yml'), 1);
    assert.equal(count(fired, 'square-horizon.yml'), 24);
    assert.equal(count(fired, 'launch-check.yml'), 3, 'a Monday: 00:10, 07:05 and 08:05 UTC; the gate keeps what London means');
    for (const f of fired) assert.equal(f.tickAt, f.slot, 'on time');
  });
  test('the same day with repeated ticks and skipped minutes (shorter than the window): the same counts, never a slot twice', () => {
    let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const skipped = new Set(); const repeated = new Set();
    for (let t = at('2026-11-16T00:00:00Z'); t < at('2026-11-17T00:00:00Z'); t += MINUTE) {
      const x = rnd();
      if (x < 0.15) skipped.add(t); else if (x < 0.3) repeated.add(t);
    }
    // never more than CATCH_UP_MIN-1 skipped in a row, and the day's last slot is inside the day
    const fired = simulate(at('2026-11-16T00:00:00Z'), at('2026-11-17T00:10:00Z'), { skip: (t) => skipped.has(t) && t < at('2026-11-16T23:50:00Z'), repeat: (t) => repeated.has(t) });
    const inDay = fired.filter((f) => f.slot < at('2026-11-17T00:00:00Z'));
    for (const [wf, n] of [['covers.yml', 96], ['proofs-mail.yml', 96], ['withdrawals.yml', 24], ['backup-liveness.yml', 1]]) assert.equal(count(inDay, wf), n, wf);
    const keys = fired.map((f) => `${f.workflow}@${f.slot}`);
    assert.equal(new Set(keys).size, keys.length, 'no slot fired twice');
    assert.ok(fired.some((f) => f.tickAt > f.slot), 'some were caught up late');
  });
  test('a long outage fires each job once on return (the newest slot), not a backlog', () => {
    const fired = simulate(at('2026-11-16T10:00:00Z'), at('2026-11-16T12:00:00Z'), { skip: (t) => t > at('2026-11-16T10:00:00Z') && t < at('2026-11-16T11:52:00Z') });
    const back = fired.filter((f) => f.tickAt >= at('2026-11-16T11:52:00Z') && f.tickAt < at('2026-11-16T12:00:00Z'));
    assert.equal(count(back, 'covers.yml'), 1);
    assert.equal(back.find((f) => f.workflow === 'covers.yml').slot, at('2026-11-16T11:45:00Z'));
    assert.equal(count(back, 'proofs-mail.yml'), 1, '11:52');
  });
});

// London's clock changes. The clock fires in UTC, as GitHub does; London is the workflows' business.
const londonDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(ms));
const unheld = SCHEDULES;
const CHANGES = [
  { name: 'spring 2026 (29 Mar, 23 hours)', day: '2026-03-29', hours: 23 },
  { name: 'autumn 2026 (25 Oct, 25 hours)', day: '2026-10-25', hours: 25 },
  { name: 'spring 2027 (28 Mar, 23 hours)', day: '2027-03-28', hours: 23 },
  { name: 'autumn 2027 (31 Oct, 25 hours)', day: '2027-10-31', hours: 25 },
];
describe('CLOCK-1 · London\'s clock changes', () => {
  for (const c of CHANGES) {
    // Simulate the change week, from the Wednesday before to the Wednesday after, in UTC.
    const from = at(`${c.day}T00:00:00Z`) - 4 * DAY;
    const to = at(`${c.day}T00:00:00Z`) + 4 * DAY;
    const fired = simulate(from, to, { schedules: unheld });
    test(`${c.name}: the hourly and quarter-hourly jobs follow UTC, so London's day of change gets ${c.hours} and ${c.hours * 4}`, () => {
      const onDay = fired.filter((f) => londonDay(f.slot) === c.day);
      assert.equal(count(onDay, 'withdrawals.yml'), c.hours);
      assert.equal(count(onDay, 'covers.yml'), c.hours * 4);
      assert.equal(count(onDay, 'proofs-mail.yml'), c.hours * 4);
      assert.equal(count(onDay, 'backup-liveness.yml'), 1);
    });
    test(`${c.name}: square-horizon — the clock's hourly :05 meets the 20:00 London bell exactly once a day`, () => {
      const bells = fired.filter((f) => f.workflow === 'square-horizon.yml' && londonHour(f.slot) === BELL_HOUR);
      const days = bells.map((f) => londonDay(f.slot));
      assert.equal(new Set(days).size, days.length, 'one bell a day');
      const expect = new Set();
      for (let t = from; t < to; t += HOUR) if (londonHour(t) === BELL_HOUR) expect.add(londonDay(t));
      assert.deepEqual(days.sort(), [...expect].sort(), 'every London day in the window, none missed');
    });
    test(`${c.name}: launch-check — with the cron the clock fired, the gate keeps one Monday 00:10 and one 08:05 a day`, () => {
      const kept = fired.filter((f) => f.workflow === 'launch-check.yml' && launchGate(f.inputs.clock, f.slot));
      const monday = kept.filter((f) => /^10 /.test(f.inputs.clock) && !/ 9 \*$/.test(f.inputs.clock));
      const daily = kept.filter((f) => /^5 [78] \* \* \*$/.test(f.inputs.clock));
      assert.equal(monday.length, 1, 'one Monday 00:10 London');
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      assert.match(p.format(new Date(monday[0].slot)), /Mon.*00:10/);
      for (const f of daily) assert.match(p.format(new Date(f.slot)), /08:05/);
      const dailyDays = daily.map((f) => londonDay(f.slot));
      assert.equal(new Set(dailyDays).size, dailyDays.length);
      // every London day in the window, but the Monday, whose 08:05 falls inside it
      const expect = new Set();
      for (let t = from; t < to; t += MINUTE) {
        const s = p.format(new Date(t));
        if (/08:05/.test(s) && !/^Mon/.test(s)) expect.add(londonDay(t));
      }
      assert.deepEqual([...new Set(dailyDays)].sort(), [...expect].sort());
    });
  }
});

// ── 4 ───────────────────────────────────────────────────────────────────────────────────────
function memStorage() {
  const m = new Map();
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    m,
    async get(k) { return clone(m.get(k)); },
    async put(k, v) { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) m.set(a, clone(b)); else m.set(k, clone(v)); },
  };
}
const TOKEN = 'test-token-not-a-real-one';
function fakeFetch(statusFor = () => 204, { delay = 0 } = {}) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const s = statusFor(url);
    if (s === 'throw') throw new Error('network');
    return new Response(null, { status: s });
  };
  f.calls = calls;
  return f;
}
const quiet = () => {};

describe('CLOCK-1 · the tick', () => {
  const T = at('2026-11-16T10:45:00Z');
  test('dry run unless CLOCK_MODE is exactly "live"', () => {
    assert.equal(isLive({}), false);
    assert.equal(isLive({ CLOCK_MODE: 'LIVE' }), false);
    assert.equal(isLive({ CLOCK_MODE: 'true' }), false);
    assert.equal(isLive({ CLOCK_MODE: 'live' }), true);
  });
  test('dry run: logs what it would dispatch, sends nothing, still records the slot', async () => {
    const s = memStorage(); const f = fakeFetch(); const lines = [];
    const out = await tick(s, { GITHUB_DISPATCH_TOKEN: TOKEN }, T, { fetchImpl: f, log: (l) => lines.push(l) });
    assert.equal(f.calls.length, 0);
    assert.equal(out.mode, 'dry-run');
    assert.equal(lines.length, 4);
    for (const l of lines) assert.match(l, /dry run — would dispatch [a-z-]+\.yml for 2026-11-16T10:45Z/);
    const again = []; await tick(s, {}, T, { fetchImpl: f, log: (l) => again.push(l) });
    assert.equal(again.length, 0, 'once per slot, as live would');
    assert.equal((await s.get('heartbeat')).mode, 'dry-run');
  });
  test('live with no token: nothing sent, nothing claimed, the refusal recorded', async () => {
    const s = memStorage(); const f = fakeFetch();
    const err = console.error; console.error = quiet;
    try { await tick(s, { CLOCK_MODE: 'live' }, T, { fetchImpl: f, log: quiet }); } finally { console.error = err; }
    assert.equal(f.calls.length, 0);
    assert.equal(await s.get('state'), undefined);
    assert.equal((await s.get('heartbeat')).lastFailStatus, 'no-token');
  });
  test('live: one workflow_dispatch per due workflow, on main, with its inputs; never twice for a slot', async () => {
    const s = memStorage(); const f = fakeFetch(); const lines = [];
    const env = { CLOCK_MODE: 'live', GITHUB_DISPATCH_TOKEN: TOKEN };
    const now = T + 2000;
    await tick(s, env, T, { fetchImpl: f, log: (l) => lines.push(l), now });
    assert.equal(f.calls.length, 4);
    for (const c of f.calls) {
      assert.match(c.url, new RegExp(`^https://api\\.github\\.com/repos/${REPO}/actions/workflows/[a-z-]+\\.yml/dispatches$`));
      assert.equal(c.init.method, 'POST');
      assert.equal(c.init.headers.Authorization, `Bearer ${TOKEN}`);
      assert.equal(c.body.ref, 'main');
      assert.equal(c.body.inputs.clock, '*/15 * * * *');
    }
    assert.deepEqual(f.calls.find((c) => c.url.includes('push-announce')).body.inputs, { mode: 'apply', clock: '*/15 * * * *' });
    for (const l of lines) assert.ok(!l.includes(TOKEN));
    assert.equal((await s.get('heartbeat')).lastOkAt, now);
    await tick(s, env, T, { fetchImpl: f, log: quiet });
    await tick(s, env, T + MINUTE, { fetchImpl: f, log: quiet });
    assert.equal(f.calls.length, 4, 'a repeated or later minute does not fire the slot again');
  });
  test('a refused or unanswered dispatch releases its claim; the next tick inside the window tries again', async () => {
    const s = memStorage(); const env = { CLOCK_MODE: 'live', GITHUB_DISPATCH_TOKEN: TOKEN };
    const f1 = fakeFetch((u) => (u.includes('covers') ? 503 : u.includes('push-announce') ? 'throw' : 204));
    const out = await tick(s, env, T, { fetchImpl: f1, log: quiet });
    assert.deepEqual(out.failed.sort(), ['covers.yml', 'push-announce.yml']);
    const hb = await s.get('heartbeat');
    assert.ok([503, 'unreachable'].includes(hb.lastFailStatus));
    const f2 = fakeFetch();
    await tick(s, env, T + MINUTE, { fetchImpl: f2, log: quiet });
    assert.deepEqual(f2.calls.map((c) => c.url.split('/').at(-2)).sort(), ['covers.yml', 'push-announce.yml']);
    const f3 = fakeFetch();
    await tick(s, env, T + 2 * MINUTE, { fetchImpl: f3, log: quiet });
    assert.equal(f3.calls.length, 0);
  });
  test('a released claim never rolls back a later slot another tick has taken', async () => {
    const s = memStorage(); const env = { CLOCK_MODE: 'live', GITHUB_DISPATCH_TOKEN: TOKEN };
    const key = slotKey('covers.yml', '*/15 * * * *');
    // the dispatch for T fails, but while it is in flight a tick for T+15 claims and succeeds
    let release;
    const slow = async (url, init) => { if (url.includes('covers')) { await new Promise((r) => { release = r; }); return new Response(null, { status: 500 }); } return new Response(null, { status: 204 }); };
    const p = tick(s, env, T, { fetchImpl: slow, log: quiet });
    await new Promise((r) => setTimeout(r, 5));
    await tick(s, env, T + 15 * MINUTE, { fetchImpl: fakeFetch(), log: quiet });
    release(); await p;
    assert.equal((await s.get('state'))[key], T + 15 * MINUTE);
  });
  test('a second tick arriving while the first is still dispatching does not send the same slot', async () => {
    // In the Durable Object, no event interleaves a storage operation, so the claim (a put with no
    // network await before it) is in place before the first dispatch leaves.
    const s = memStorage(); const env = { CLOCK_MODE: 'live', GITHUB_DISPATCH_TOKEN: TOKEN };
    const f = fakeFetch(() => 204, { delay: 20 });
    const a = tick(s, env, T, { fetchImpl: f, log: quiet });
    await new Promise((r) => setTimeout(r, 5));
    await tick(s, env, T, { fetchImpl: f, log: quiet });
    await a;
    assert.equal(f.calls.length, 4);
  });
  test('dispatch() never throws and never reports more than a status', async () => {
    assert.equal(await dispatch(fakeFetch(() => 'throw'), TOKEN, { workflow: 'covers.yml', inputs: {} }), 'unreachable');
    assert.equal(await dispatch(fakeFetch(() => 422), TOKEN, { workflow: 'covers.yml', inputs: {} }), 422);
  });
  test('the public heartbeat carries times, the mode and a status, nothing else', () => {
    const hb = publicHeartbeat({ tickAt: 1, mode: 'live', lastOkAt: 2, lastFailAt: 3, lastFailStatus: 401, token: TOKEN, state: { x: 1 } });
    assert.deepEqual(Object.keys(hb).sort(), ['lastFailAt', 'lastFailStatus', 'lastOkAt', 'mode', 'tickAt']);
    assert.ok(!JSON.stringify(hb).includes(TOKEN));
  });
});

describe('CLOCK-1 · the Worker', () => {
  const src = readFileSync('workers-external/calvary-clock/worker.mjs', 'utf8');
  const all = ['clock.mjs', 'tick.mjs', 'worker.mjs'].map((f) => readFileSync(`workers-external/calvary-clock/${f}`, 'utf8')).join('\n');
  test('the entry exports the handlers and the Durable Object, and nothing workerd would trip on', () => {
    const named = [...src.matchAll(/^export\s+(?:class|const|function|async function|let)\s+(\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(named, ['ClockState']);
    assert.match(src, /^export default clock;$/m);
  });
  test('it holds no secret, prints no secret, and calls nothing but GitHub\'s API', () => {
    assert.ok(!/ghp_|github_pat_|gho_/.test(all));
    assert.ok(!/console\.\w+\([^)]*(\$\{[^}]*GITHUB_DISPATCH_TOKEN|,\s*env\.GITHUB_DISPATCH_TOKEN)/.test(all));
    assert.ok(!/log\([^)]*\$\{[^}]*(token|TOKEN)/.test(all));
    const urls = [...all.matchAll(/https:\/\/[a-z0-9.-]+/g)].map((m) => m[0]);
    assert.deepEqual([...new Set(urls)].sort(), ['https://api.github.com', 'https://clock']);
  });
  test('the repository is this one', () => {
    let remote = '';
    try { remote = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim(); } catch { /* no remote */ }
    if (!remote) return test.skip?.('no remote in this checkout');
    assert.ok(remote.replace(/\.git$/, '').endsWith(REPO));
  });
  test('the web reaches GET /heartbeat and nothing else; never /tick', async () => {
    const s = memStorage(); await s.put('heartbeat', { tickAt: 5, mode: 'live', lastOkAt: 4, secret: 'x' });
    const obj = new ClockState({ storage: s }, {});
    const seen = [];
    const env = { CLOCK: { idFromName: (n) => n, get: () => ({ fetch: (u) => { seen.push(String(u)); return obj.fetch(new Request(String(u))); } }) } };
    const r = await worker.fetch(new Request('https://w.example/heartbeat'), env);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { tickAt: 5, mode: 'live', lastOkAt: 4, lastFailAt: null, lastFailStatus: null });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    for (const [m, p] of [['GET', '/tick?at=1'], ['POST', '/heartbeat'], ['GET', '/'], ['GET', '/heartbeat/x']]) {
      assert.equal((await worker.fetch(new Request(`https://w.example${p}`, { method: m }), env)).status, 404, `${m} ${p}`);
    }
    assert.deepEqual(seen, ['https://clock/heartbeat']);
  });
  test('scheduled() ticks the one Durable Object at the minute the cron meant', async () => {
    const s = memStorage();
    const obj = new ClockState({ storage: s }, {});
    const env = { CLOCK: { idFromName: (n) => { assert.equal(n, 'clock'); return n; }, get: () => ({ fetch: (u) => obj.fetch(new Request(String(u))) }) } };
    const log = console.log; console.log = quiet;
    try { await worker.scheduled({ scheduledTime: at('2026-11-16T10:45:00Z') }, env); } finally { console.log = log; }
    assert.equal((await s.get('heartbeat')).mode, 'dry-run');
    assert.equal((await s.get('state'))[slotKey('covers.yml', '*/15 * * * *')], at('2026-11-16T10:45:00Z'));
  });
});

// ── 5 ───────────────────────────────────────────────────────────────────────────────────────
describe('CLOCK-1 · the launch check watches the heartbeat', () => {
  const now = at('2026-11-16T10:45:00Z');
  const well = { tickAt: now - 30_000, mode: 'live', lastOkAt: now - 4 * MINUTE };
  test('not armed: not yet due', () => assert.equal(judgeClock({ hb: null, armed: false }, now).status, NYD));
  test('armed and well: green', () => assert.equal(judgeClock({ hb: well, armed: true }, now).status, GREEN));
  test('armed: red when unreadable, stale, not ticking, or still a dry run', () => {
    assert.equal(judgeClock({ hb: null, armed: true }, now).status, RED);
    assert.equal(judgeClock({ hb: { ...well, lastOkAt: now - CLOCK_STALE_MS - 1 }, armed: true }, now).status, RED);
    assert.equal(judgeClock({ hb: { ...well, tickAt: now - 6 * MINUTE }, armed: true }, now).status, RED);
    assert.equal(judgeClock({ hb: { ...well, mode: 'dry-run' }, armed: true }, now).status, RED);
  });
  test('a refusal newer than the last acceptance is named by its status (an expired token reads 401)', () => {
    const r = judgeClockHeartbeat({ ...well, lastOkAt: now - 25 * MINUTE, lastFailAt: now - MINUTE, lastFailStatus: 401 }, now);
    assert.equal(r.ok, false);
    assert.match(r.evidence, /last refusal 1 min ago \(401\)/);
  });
  test('the switch and the address go together', () => {
    if (CLOCK_ARMED) assert.match(String(CLOCK_HEARTBEAT_URL), /^https:\/\/[^/]+\/heartbeat$/);
    else assert.equal(CLOCK_HEARTBEAT_URL, null);
  });
});
