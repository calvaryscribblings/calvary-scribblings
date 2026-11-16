// CLOCK-1 (ruling 399) — WHAT IS DUE AT THIS MINUTE. The pure half of the calvary-clock Worker.
//
// GitHub runs this repository's scheduled workflows hours late (P4-D1: push-announce, set for every 15
// minutes, ran 3 times in a day). The clock is a Cloudflare Worker on one cron trigger, every minute,
// that asks GitHub to run each scheduled workflow on time with workflow_dispatch on main. It fires
// each workflow by THAT WORKFLOW'S OWN cron expressions, copied below from the workflow files;
// tests/ci/clock-1.test.mjs reads every .github/workflows/*.yml and fails if a schedule changes
// without this table changing with it.
//
// The workflows keep their own `schedule:` triggers as the fallback, so a job can run twice for one
// slot (the clock's dispatch and GitHub's late run). Every job here is safe for that (docs/CLOCK-1.md):
// seven by construction, and since CLOCK-1.1 the two that were not, by a claim in the database (the
// Square's bell is claimed per London night and measured as of 20:00; the launch check claims each
// occasion's email). A job found unsafe again is HELD (`held: '<reason>'`): listed, never fired.
//
// A workflow's commented-out `schedule:` is its off switch (push-announce, square-horizon). The clock
// does not get round it: tests/ci/clock-1.test.mjs fails while the clock still lists a workflow
// with no schedule, so disarming means taking it out of this table (or holding it) in the same commit.
//
// Nothing in this file touches the network, the clock or a secret: every function takes `now`.
// UTC throughout, like GitHub's cron. London's clock changes are the workflows' own business (the
// launch-check gate, the horizon's 20:00 bell), and tests/ci/clock-1.test.mjs proves the pairing holds.

export const REF = 'main';

/** How far back a tick looks for a slot it has not fired. A late or skipped minute is caught up within
 *  this window; a slot older than this is left to GitHub's own schedule, which still exists. */
export const CATCH_UP_MIN = 10;

/**
 * THE SCHEDULES. `crons` must equal the workflow file's `on.schedule` list, in order (the test).
 * `inputs` is what the dispatch sends, besides `clock` (the cron that fired, which every dispatched
 * workflow accepts). Each input must make the dispatched run do what the scheduled run does.
 * `held` is a reason: the clock never dispatches that workflow.
 */
export const SCHEDULES = [
  { workflow: 'account-scrub.yml', crons: ['*/15 * * * *'], inputs: { apply: 'true' } },
  { workflow: 'backup-liveness.yml', crons: ['0 9 * * *'], inputs: {} },
  { workflow: 'covers.yml', crons: ['*/15 * * * *'], inputs: { apply: 'true' } },
  { workflow: 'index-reconcile.yml', crons: ['*/15 * * * *'], inputs: { apply: 'true' } },
  { workflow: 'launch-check.yml', crons: ['10 23 29 9 *', '5 7 30 9 *', '10 23 * * 0', '10 0 * * 1', '5 7 * * *', '5 8 * * *'], inputs: {} },
  { workflow: 'proofs-mail.yml', crons: ['7,22,37,52 * * * *'], inputs: {} },
  { workflow: 'push-announce.yml', crons: ['*/15 * * * *'], inputs: { mode: 'apply' } },
  { workflow: 'square-horizon.yml', crons: ['5 * * * *'], inputs: { apply: 'true' } },
  { workflow: 'withdrawals.yml', crons: ['7 * * * *'], inputs: { apply: 'true' } },
];

// ── cron ──────────────────────────────────────────────────────────────────────────────────────
// POSIX five-field cron, as GitHub reads it: minute hour day-of-month month day-of-week, in UTC.
// Each field: `*`, a number, `a-b`, a list `x,y`, and a step `*/n`, `a-b/n` or `a/n`. Day-of-week
// 0-7 (0 and 7 are Sunday). When BOTH day fields are restricted, a day matches if EITHER does.
// No names (JAN, MON) and no `?`/`L`/`W`: none of the workflows uses them, and parseCron refuses them.

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 7 },
];

function parseField(src, { name, min, max }) {
  const set = new Set();
  for (const part of src.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron ${name}: cannot read "${part}"`);
    let lo, hi;
    if (m[1] === '*') { lo = min; hi = max; } else {
      const [a, b] = m[1].split('-').map(Number);
      lo = a; hi = b ?? (m[2] ? max : a);
    }
    const step = m[2] ? Number(m[2]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`cron ${name}: "${part}" is out of range`);
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return set;
}

/** Parse a five-field cron. Throws on anything it does not understand. */
export function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron "${expr}": five fields expected`);
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (dow.has(7)) { dow.delete(7); dow.add(0); }
  return { minute, hour, dom, month, dow, domStar: parts[2] === '*', dowStar: parts[4] === '*' };
}

/** Does the parsed cron fire at the UTC minute containing `ms`? */
export function cronMatches(cron, ms) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  const d = new Date(ms);
  if (!c.minute.has(d.getUTCMinutes()) || !c.hour.has(d.getUTCHours()) || !c.month.has(d.getUTCMonth() + 1)) return false;
  const domHit = c.dom.has(d.getUTCDate());
  const dowHit = c.dow.has(d.getUTCDay());
  if (c.domStar && c.dowStar) return true;
  if (c.domStar) return dowHit;
  if (c.dowStar) return domHit;
  return domHit || dowHit;
}

export const MINUTE = 60_000;
export const floorMinute = (ms) => Math.floor(ms / MINUTE) * MINUTE;
export const slotKey = (workflow, cron) => `${workflow} ${cron}`;

const PARSED = new Map();
const parsed = (expr) => { if (!PARSED.has(expr)) PARSED.set(expr, parseCron(expr)); return PARSED.get(expr); };

/** The latest minute in (now − window, now] at which `expr` fires, or null. */
export function latestSlot(expr, now, windowMin = CATCH_UP_MIN) {
  const top = floorMinute(now);
  for (let i = 0; i < windowMin; i++) {
    const t = top - i * MINUTE;
    if (cronMatches(parsed(expr), t)) return t;
  }
  return null;
}

/**
 * WHAT IS DUE. `state` is the record of the last slot dispatched per (workflow, cron), as epoch ms.
 * A slot is due when it is the latest one inside the catch-up window and newer than the record, so:
 *   · a repeated minute (the same tick twice, or two ticks racing) never fires a slot twice;
 *   · a late or skipped minute fires the slot it missed, once, if it is still inside the window;
 *   · several missed slots of one cron fire ONCE, for the newest (the job reads the world as it is).
 *   · a slot from before the clock's first tick (SINCE, kept in the record) was GitHub's to run: on
 *     its first tick the clock fires only what is due that very minute.
 * Returns the dispatches and the new state. Held workflows are listed, never fired. Pure.
 */
export const SINCE = '@since';
export function due(now, state = {}, { schedules = SCHEDULES, windowMin = CATCH_UP_MIN } = {}) {
  const fire = [];
  const held = [];
  const since = Number.isFinite(state[SINCE]) ? state[SINCE] : floorMinute(now);
  const next = { [SINCE]: since };
  for (const s of schedules) {
    for (const cron of s.crons) {
      const key = slotKey(s.workflow, cron);
      const last = Number.isFinite(state[key]) ? state[key] : null;
      const slot = latestSlot(cron, now, windowMin);
      if (s.held) { if (slot !== null) held.push({ workflow: s.workflow, cron, slot, reason: s.held }); continue; }
      if (last !== null) next[key] = last;
      if (slot !== null && slot >= since && (last === null || slot > last)) {
        fire.push({ workflow: s.workflow, cron, slot, inputs: { ...s.inputs, clock: cron } });
        next[key] = slot;
      }
    }
  }
  return { fire, held, state: next };
}
