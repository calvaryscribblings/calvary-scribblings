// CLOCK-1.1 — the two jobs that were not safe to run twice, made safe, so the clock runs all nine.
//
//   node --test tests/ci/clock-11.test.mjs          (npm run test:clock, and npm run test:ci)
//
// square-horizon: the bell is 20:00 London, not the moment a run starts, and the night is claimed
// before anything moves. Two runs at once, back to back, a run at 20:59, a night whose first run failed.
// launch-check: the cron that fired reaches the gate from a schedule or the clock alike, and each
// occasion's email is claimed before it goes. Two runs at once, back to back, a dispatched daily run,
// a dispatched Monday run.
//
// The database is an in-memory stand-in whose transaction is atomic, as RTDB's is, and whose every
// call yields, so concurrent runs really interleave.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';
import { ringBell, bellOf, HORIZON_MS } from '../../scripts/square/horizon.mjs';
import { reportOnce, lastReportedAt, LEDGER } from '../../scripts/launch-check.mjs';
import { shouldRun, emailMode, slotOf, slotKey } from '../../scripts/launch-check-gate.mjs';
import { claimable, settleFn, LEASE_MS } from '../../scripts/ops/once.mjs';
import { SCHEDULES } from '../../workers-external/calvary-clock/clock.mjs';

// ── the stand-in ────────────────────────────────────────────────────────────────────────────
const yieldNow = () => new Promise((r) => setImmediate(r));
class FakeDb {
  constructor(data = {}) { this.data = structuredClone(data); this.failUpdates = 0; this.writes = []; }
  #segs(p) { return String(p || '').split('/').filter(Boolean); }
  read(p) { let n = this.data; for (const k of this.#segs(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : structuredClone(n); }
  write(p, v) {
    const segs = this.#segs(p); this.writes.push(p);
    if (!segs.length) throw new Error('root write');
    let n = this.data;
    for (const k of segs.slice(0, -1)) { if (n[k] == null || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
    const last = segs.at(-1);
    if (v === null || v === undefined) delete n[last]; else n[last] = structuredClone(v);
  }
  ref(path = '') {
    const snap = (v) => ({ val: () => v, exists: () => v !== null });
    return {
      get: async () => { await yieldNow(); const v = this.read(path); this.onGet?.(path); return snap(v); },
      update: async (obj) => {
        await yieldNow();
        if (this.failUpdates > 0 && !path) { this.failUpdates--; throw new Error('the database went away'); }
        for (const [k, v] of Object.entries(obj)) this.write(path ? `${path}/${k}` : k, v);
      },
      transaction: async (fn) => {
        await yieldNow();
        const cur = this.read(path);          // read, decide and write with no yield between:
        const next = fn(cur);                 // RTDB's transaction is atomic per path
        if (next === undefined) return { committed: false, snapshot: snap(cur) };
        this.write(path, next);
        return { committed: true, snapshot: snap(next) };
      },
    };
  }
}
const quiet = () => {};

// ── square-horizon ──────────────────────────────────────────────────────────────────────────
// Tuesday 17 Nov 2026 (GMT): the bell is 20:00 UTC.
const BELL = Date.parse('2026-11-17T20:00:00Z');
const H = 3600_000, M = 60_000;
const at = (min) => BELL + min * M;               // minutes after the bell
function room() {
  return {
    square_posts: {
      old: { authorUid: 'u0000000000000000000000000001', text: 't', createdAt: BELL - 49 * H, parentId: null },
      oldReply: { authorUid: 'u0000000000000000000000000002', text: 't', createdAt: BELL - 30 * H, parentId: 'old' },
      // posted at 20:30 two nights ago: 47.5h old at the bell, 48h old at 20:30 tonight
      edge: { authorUid: 'u0000000000000000000000000003', text: 't', createdAt: BELL - HORIZON_MS + 30 * M, parentId: null },
      pinned: { authorUid: 'u0000000000000000000000000004', text: 't', createdAt: BELL - 90 * H, parentId: null, pinned: true },
      fresh: { authorUid: 'u0000000000000000000000000005', text: 't', createdAt: BELL - 2 * H, parentId: null },
    },
    square_reactions: { old: { r: 1 } },
    square_horizon: { lastBellAt: BELL - 24 * H },
  };
}
const inRoom = (db) => Object.keys(db.read('square_posts') || {}).sort();
const archived = (db) => Object.keys(db.read('square_archive') || {}).sort();
const SWEPT_ROOM = ['edge', 'fresh', 'pinned'];

describe('CLOCK-1.1 · square-horizon: one bell a night, as of 20:00', () => {
  test('bellOf: the night and its 20:00 London, either side of the clock changes', () => {
    assert.deepEqual(bellOf(at(59)), { night: '2026-11-17', at: BELL });
    assert.equal(bellOf(Date.parse('2026-07-01T19:30:00Z')).at, Date.parse('2026-07-01T19:00:00Z'));
    assert.equal(bellOf(Date.parse('2026-03-29T19:05:00Z')).at, Date.parse('2026-03-29T19:00:00Z'), 'the spring change, BST');
    assert.equal(bellOf(Date.parse('2026-10-25T20:05:00Z')).at, Date.parse('2026-10-25T20:00:00Z'), 'the autumn change, GMT');
  });

  test('one run at 20:05: the thread past 48h at 20:00 moves, whole; archivedAt and lastBellAt are 20:00', async () => {
    const db = new FakeDb(room());
    const r = await ringBell(db, at(5), { apply: true, runId: 'a', log: quiet });
    assert.equal(r.action, 'swept');
    assert.deepEqual(inRoom(db), SWEPT_ROOM);
    assert.deepEqual(archived(db), ['old', 'oldReply']);
    assert.equal(db.read('square_archive/old/archivedAt'), BELL);
    assert.deepEqual(db.read('square_archive_reactions/old'), { r: 1 });
    assert.equal(db.read('square_horizon/lastBellAt'), BELL);
    assert.equal(db.read('square_horizon/sweptAtLastRun'), 2);
    assert.equal(db.read('square_horizon/bell/state'), 'done');
    assert.equal(db.read('square_horizon/bell/night'), '2026-11-17');
  });

  test('a run at 20:59, the night\'s first: as of 20:00, so the 20:30 post stays', async () => {
    const db = new FakeDb(room());
    const r = await ringBell(db, at(59), { apply: true, runId: 'a', log: quiet });
    assert.equal(r.action, 'swept');
    assert.deepEqual(inRoom(db), SWEPT_ROOM, 'measured from 20:59 the edge thread would have gone mid-session');
    assert.equal(db.read('square_archive/old/archivedAt'), BELL);
  });

  test('back to back (20:05, then GitHub\'s late run at 20:40): the second moves nothing and leaves the bell\'s record alone', async () => {
    const db = new FakeDb(room());
    await ringBell(db, at(5), { apply: true, runId: 'clock', log: quiet });
    const before = db.read('square_horizon');
    const r = await ringBell(db, at(40), { apply: true, runId: 'github', log: quiet });
    assert.equal(r.action, 'already-rung');
    assert.deepEqual(inRoom(db), SWEPT_ROOM);
    assert.deepEqual(archived(db), ['old', 'oldReply']);
    const after = db.read('square_horizon');
    assert.equal(after.lastBellAt, before.lastBellAt);
    assert.equal(after.sweptAtLastRun, 2, 'not overwritten with 0');
    assert.deepEqual(after.bell, before.bell);
    assert.equal(after.lastRunAt, at(40), 'the heartbeat still beats');
  });

  test('two runs at once: exactly one sweeps; the posts move once', async () => {
    const db = new FakeDb(room());
    const [a, b] = await Promise.all([
      ringBell(db, at(5), { apply: true, runId: 'clock', log: quiet }),
      ringBell(db, at(5) + 2000, { apply: true, runId: 'github', log: quiet }),
    ]);
    assert.equal([a, b].filter((x) => x.action === 'swept').length, 1);
    assert.ok(['in-flight', 'already-rung'].includes([a, b].find((x) => x.action !== 'swept').action));
    assert.deepEqual(inRoom(db), SWEPT_ROOM);
    assert.deepEqual(archived(db), ['old', 'oldReply']);
    assert.equal(db.writes.filter((p) => p === 'square_archive/old').length, 1, 'archived once');
  });

  test('a night whose first run failed: marked failed, and the next run that hour sweeps it whole', async () => {
    const db = new FakeDb(room());
    db.failUpdates = 1;
    await assert.rejects(ringBell(db, at(5), { apply: true, runId: 'first', log: quiet }), /went away/);
    assert.equal(db.read('square_horizon/bell/state'), 'failed');
    assert.deepEqual(archived(db), []);
    const r = await ringBell(db, at(20), { apply: true, runId: 'second', log: quiet });
    assert.equal(r.action, 'swept');
    assert.deepEqual(inRoom(db), SWEPT_ROOM, 'still as of 20:00');
    assert.equal(db.read('square_horizon/bell/runId'), 'second');
    assert.equal(db.read('square_horizon/bell/state'), 'done');
  });

  test('a run that died without saying so holds the night for the lease, then the night may be retried within the hour', async () => {
    const db = new FakeDb({ ...room(), square_horizon: { bell: { night: '2026-11-17', state: 'claimed', at: at(5), runId: 'dead' } } });
    assert.equal((await ringBell(db, at(15), { apply: true, runId: 'b', log: quiet })).action, 'in-flight');
    assert.deepEqual(archived(db), []);
    const r = await ringBell(db, at(5) + LEASE_MS, { apply: true, runId: 'c', log: quiet });
    assert.equal(r.action, 'swept');
    assert.deepEqual(inRoom(db), SWEPT_ROOM);
  });

  test('never after the hour: a failed night is not swept at 21:05', async () => {
    const db = new FakeDb({ ...room(), square_horizon: { bell: { night: '2026-11-17', state: 'failed', at: at(5), runId: 'x' } } });
    assert.equal((await ringBell(db, at(65), { apply: true, runId: 'late', log: quiet })).action, 'not-the-bell');
    assert.deepEqual(archived(db), []);
  });

  test('it sweeps the room as it is once the night is claimed: a post its author deleted meanwhile is not resurrected in the archive', async () => {
    const db = new FakeDb(room());
    let first = true;
    db.onGet = (p) => { if (p === 'square_posts' && first) { first = false; db.write('square_posts/old', null); db.write('square_posts/oldReply', null); } };
    const r = await ringBell(db, at(5), { apply: true, runId: 'a', log: quiet });
    assert.equal(r.action, 'swept');
    assert.deepEqual(archived(db), [], 'nothing the author removed reappears in square_archive');
  });

  test('yesterday\'s record does not hold tonight\'s bell', async () => {
    const db = new FakeDb({ ...room(), square_horizon: { bell: { night: '2026-11-16', state: 'done', at: BELL - 24 * H, runId: 'y' } } });
    assert.equal((await ringBell(db, at(5), { apply: true, runId: 't', log: quiet })).action, 'swept');
  });

  test('a dry run writes nothing; --force sweeps as of its own moment and claims nothing', async () => {
    const db = new FakeDb(room());
    assert.equal((await ringBell(db, at(5), { apply: false, log: quiet })).action, 'dry-run');
    assert.equal(db.writes.length, 0);
    const f = new FakeDb(room());
    const r = await ringBell(f, BELL + 3 * H, { apply: true, force: true, log: quiet }); // 23:00, a manual catch-up
    assert.equal(r.action, 'swept');
    assert.deepEqual(Object.keys(f.read('square_archive')).sort(), ['edge', 'old', 'oldReply']);
    assert.equal(f.read('square_horizon/bell'), null);
  });
});

// ── launch-check ────────────────────────────────────────────────────────────────────────────
function sender({ fail = 0, delay = 0 } = {}) {
  const s = async () => {
    s.calls++;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (s.calls <= fail) throw new Error('the email was NOT sent: 502');
    return { subject: 's', id: 'i' };
  };
  s.calls = 0;
  return s;
}
const KEY = '2026-11-17-0805';
const NOW = Date.parse('2026-11-17T08:05:30Z');

describe('CLOCK-1.1 · launch-check: one email per occasion', () => {
  test('two runs at once: one email', async () => {
    const db = new FakeDb(); const send = sender({ delay: 10 });
    const [a, b] = await Promise.all([
      reportOnce(db, { key: KEY, now: NOW, runId: 'clock', wantEmail: true, send }),
      reportOnce(db, { key: KEY, now: NOW + 1000, runId: 'github', wantEmail: true, send }),
    ]);
    assert.equal(send.calls, 1);
    assert.deepEqual([a.state, b.state].sort(), ['sent', 'stood-down']);
    assert.equal(db.read(`${LEDGER}/${KEY}/state`), 'sent');
  });
  test('back to back (GitHub\'s run six hours late): no second email', async () => {
    const db = new FakeDb(); const send = sender();
    await reportOnce(db, { key: KEY, now: NOW, runId: 'clock', wantEmail: true, send });
    const r = await reportOnce(db, { key: KEY, now: NOW + 6 * H, runId: 'github', wantEmail: true, send });
    assert.deepEqual(r, { state: 'stood-down', prior: 'sent' });
    assert.equal(send.calls, 1);
  });
  test('a send that failed may be retried by a later run, and then only once', async () => {
    const db = new FakeDb(); const send = sender({ fail: 1 });
    await assert.rejects(reportOnce(db, { key: KEY, now: NOW, runId: 'a', wantEmail: true, send }), /NOT sent/);
    assert.equal(db.read(`${LEDGER}/${KEY}/state`), 'failed');
    assert.equal((await reportOnce(db, { key: KEY, now: NOW + H, runId: 'b', wantEmail: true, send })).state, 'sent');
    assert.equal((await reportOnce(db, { key: KEY, now: NOW + 2 * H, runId: 'c', wantEmail: true, send })).state, 'stood-down');
    assert.equal(send.calls, 2);
  });
  test('a run that died mid-send holds the email for the lease, then a later run may send it', async () => {
    const db = new FakeDb({ ops: { launch_check: { slots: { [KEY]: { state: 'claimed', at: NOW, runId: 'dead', checkedAt: NOW } } } } });
    const send = sender();
    assert.equal((await reportOnce(db, { key: KEY, now: NOW + 5 * M, runId: 'b', wantEmail: true, send })).state, 'stood-down');
    assert.equal((await reportOnce(db, { key: KEY, now: NOW + LEASE_MS, runId: 'c', wantEmail: true, send })).state, 'sent');
    assert.equal(send.calls, 1);
  });
  test('a green daily records the occasion as judged, sends nothing, and a later run does not send it', async () => {
    const db = new FakeDb(); const send = sender();
    assert.equal((await reportOnce(db, { key: KEY, now: NOW, runId: 'a', wantEmail: false, send })).state, 'quiet');
    assert.equal((await reportOnce(db, { key: KEY, now: NOW + H, runId: 'b', wantEmail: true, send })).state, 'stood-down');
    assert.equal(send.calls, 0);
  });
  test('"since the last check" is the last occasion judged and reported, never a run that stood down', () => {
    const slots = {
      '2026-11-16-0010': { state: 'sent', checkedAt: Date.parse('2026-11-16T00:10:20Z') },
      '2026-11-17-0805': { state: 'quiet', checkedAt: NOW },
      '2026-11-18-0805': { state: 'claimed', checkedAt: NOW + 24 * H },
      '2026-11-19-0805': { state: 'failed', checkedAt: NOW + 48 * H },
    };
    assert.equal(lastReportedAt(slots, NOW + 72 * H), NOW);
    assert.equal(lastReportedAt(slots, NOW), Date.parse('2026-11-16T00:10:20Z'), 'only before now');
    assert.equal(lastReportedAt({}, NOW), null);
  });
  test('claimable: free, failed, or a claim past its lease; never sent, quiet or done', () => {
    assert.ok(claimable(null, NOW));
    assert.ok(claimable({ state: 'failed' }, NOW));
    assert.ok(!claimable({ state: 'claimed', at: NOW - LEASE_MS + 1 }, NOW));
    assert.ok(claimable({ state: 'claimed', at: NOW - LEASE_MS }, NOW));
    for (const state of ['sent', 'quiet', 'done']) assert.ok(!claimable({ state, at: 0 }, NOW));
  });
});

// The workflow's own branch, run in bash with node stubbed, for the four kinds of run.
const wf = YAML.parse(readFileSync('.github/workflows/launch-check.yml', 'utf8'));
const checkRun = wf.jobs.check.steps.find((s) => /Check, and email/.test(s.name || '')).run;
function branch({ schedule, email = 'true', mode }) {
  const script = 'node() { if [ "$1" = scripts/ops/log-guard.mjs ]; then cat; else echo "ARGS ${*:2}"; fi; }\n'
    + checkRun.replaceAll('${{ inputs.email }}', email).replaceAll('${{ steps.gate.outputs.mode }}', mode);
  return execFileSync('bash', ['-c', script], { env: { PATH: process.env.PATH, SCHEDULE: schedule }, encoding: 'utf8' }).trim();
}
/** What the gate step prints for this cron at this moment. */
const gate = (cron, ms) => ({ run: shouldRun(cron, ms), mode: emailMode(cron) });

describe('CLOCK-1.1 · launch-check: a dispatched run sends the right table', () => {
  test('the clock passes the cron that fired, as its only input', () => {
    assert.deepEqual(SCHEDULES.find((s) => s.workflow === 'launch-check.yml').inputs, {});
  });
  test('a dispatched daily run (Tuesday 08:05 GMT): the gate runs it, emails only on red, claims the 08:05 slot', () => {
    const cron = '5 8 * * *'; const t = Date.parse('2026-11-17T08:05:20Z');
    assert.deepEqual(gate(cron, t), { run: true, mode: 'if-red' });
    assert.equal(branch({ schedule: cron, mode: 'if-red' }), `ARGS --email-if-red --slot ${cron} --apply`);
    assert.equal(slotKey(slotOf(cron, t)), '2026-11-17-0805');
    assert.equal(slotKey(slotOf(cron, Date.parse('2026-11-17T14:35:00Z'))), '2026-11-17-0805', 'GitHub\'s late run shares the slot');
    assert.equal(gate('5 7 * * *', Date.parse('2026-11-17T07:05:20Z')).run, false, 'its BST twin does not run in GMT');
    assert.equal(gate(cron, Date.parse('2026-11-16T08:05:20Z')).run, false, 'not on a Monday');
  });
  test('a dispatched Monday run (00:10 GMT): the gate runs it, emails the table always, claims the Monday slot', () => {
    const cron = '10 0 * * 1'; const t = Date.parse('2026-11-16T00:10:15Z');
    assert.deepEqual(gate(cron, t), { run: true, mode: 'always' });
    assert.equal(branch({ schedule: cron, mode: 'always' }), `ARGS --email --slot ${cron} --apply`);
    assert.equal(slotKey(slotOf(cron, t)), '2026-11-16-0010');
    assert.equal(slotKey(slotOf(cron, Date.parse('2026-11-16T09:00:00Z'))), '2026-11-16-0010');
    assert.equal(gate('10 23 * * 0', Date.parse('2026-11-15T23:10:00Z')).run, false, 'its BST twin does not run in GMT');
  });
  test('the BST Monday and its slot: Sunday 23:10 UTC is Monday 00:10 London', () => {
    const t = Date.parse('2026-06-07T23:10:00Z');
    assert.deepEqual(gate('10 23 * * 0', t), { run: true, mode: 'always' });
    assert.equal(slotKey(slotOf('10 23 * * 0', t)), '2026-06-08-0010');
  });
  test('a dispatch by hand (no clock) is unchanged: emails when ticked, claims nothing', () => {
    assert.equal(branch({ schedule: '', email: 'true', mode: 'always' }), 'ARGS --email');
    assert.equal(branch({ schedule: '', email: 'false', mode: 'always' }), 'ARGS');
  });
  test('slotOf refuses a cron that is not the gate\'s', () => {
    assert.equal(slotOf('* * * * *', NOW), null);
    assert.equal(slotOf('5 8 * * *; rm -rf /', NOW), null);
  });
});

// ── SHOP-2 §1: the claim was taken and never settled ────────────────────────────────────────
// firebase-admin runs a transaction's function FIRST against its local cache, which a script
// holding no listener has empty (null), and aborts there if the function returns undefined. Only
// a defined answer goes to the server, which refuses it if the guess was wrong and the SDK runs the
// function again with the real value. The stand-in above skipped that first call, so settleFn's
// "undefined for null" passed here and aborted every settle in production (proven against the RTDB
// emulator with the real SDK: the settle saw null, aborted, and the record stayed `claimed`).
class ColdCacheDb extends FakeDb {
  ref(path = '') {
    const base = super.ref(path);
    const snap = (v) => ({ val: () => v, exists: () => v !== null });
    return {
      ...base,
      transaction: async (fn) => {
        await yieldNow();
        let guess = null;                       // the SDK's empty local cache
        for (let i = 0; i < 25; i++) {
          const next = fn(structuredClone(guess));
          if (next === undefined) return { committed: false, snapshot: snap(guess) };
          const cur = this.read(path);
          if (JSON.stringify(cur) === JSON.stringify(guess)) { this.write(path, next); return { committed: true, snapshot: snap(next) }; }
          guess = cur;                          // the server refused the stale guess: run again
        }
        throw new Error('maxretry');
      },
    };
  }
}

describe('SHOP-2 §1 · a claim settles under firebase-admin\'s cold cache', () => {
  test('launch-check: the morning run records `sent`, and GitHub\'s late run that afternoon sends nothing', async () => {
    const db = new ColdCacheDb(); const send = sender();
    assert.equal((await reportOnce(db, { key: KEY, now: NOW, runId: 'clock', wantEmail: true, send })).state, 'sent');
    assert.equal(db.read(`${LEDGER}/${KEY}/state`), 'sent', 'the settle reached the server');
    const late = await reportOnce(db, { key: KEY, now: NOW + 9 * H, runId: 'github', wantEmail: true, send });
    assert.deepEqual(late, { state: 'stood-down', prior: 'sent' });
    assert.equal(send.calls, 1, 'one email for the 08:05 slot');
  });
  test('launch-check: a failed send is recorded `failed` under the cold cache too', async () => {
    const db = new ColdCacheDb(); const send = sender({ fail: 1 });
    await assert.rejects(reportOnce(db, { key: KEY, now: NOW, runId: 'a', wantEmail: true, send }), /NOT sent/);
    assert.equal(db.read(`${LEDGER}/${KEY}/state`), 'failed');
  });
  test('square-horizon: the 20:05 bell records `done`, and a run at 20:40 moves nothing', async () => {
    const db = new ColdCacheDb(room());
    assert.equal((await ringBell(db, at(5), { apply: true, runId: 'clock', log: quiet })).action, 'swept');
    assert.equal(db.read('square_horizon/bell/state'), 'done');
    const r = await ringBell(db, at(40), { apply: true, runId: 'github', log: quiet });
    assert.equal(r.action, 'already-rung');
    assert.equal(db.writes.filter((p) => p === 'square_archive/old').length, 1, 'archived once');
  });
  test('settleFn never aborts on the cache\'s null, and still never writes over another run\'s claim', () => {
    assert.equal(settleFn('r', { state: 'sent' })(null), null, 'null in, null out: the SDK then asks the server');
    assert.equal(settleFn('r', { state: 'sent' })({ state: 'claimed', runId: 'other' }), undefined);
    assert.deepEqual(settleFn('r', { state: 'sent' })({ state: 'claimed', runId: 'r', at: 1 }), { state: 'sent', runId: 'r', at: 1 });
  });
});
