// THE SQUARE'S 48-HOUR HORIZON — R33.2.
//
// DRY RUN BY DEFAULT. Writes ONLY with --apply.
//
//   node scripts/square/horizon.mjs                 # plan only, any hour
//   node scripts/square/horizon.mjs --apply         # sweep, but ONLY at the bell
//   node scripts/square/horizon.mjs --apply --force # sweep now, ignoring the bell
//
// ═══════════════════════════════════════════════════════════════════════════
// CLEARING IS A HORIZON, NOT A DELETION
// ═══════════════════════════════════════════════════════════════════════════
//
// Records MOVE to square_archive. They are never removed. Three reasons, all
// Ikenna's: the room stays recoverable, it stays analysable, and a genuine
// delete takes a post's replies with it and cannot be undone.
//
// A move rather than a filter is also the only version that works. A filter
// leaves the node growing forever — every reader downloads all of history to be
// shown two nights of it, and the room gets slower the longer it is quiet. The
// live node has to actually shrink.
//
// ═══════════════════════════════════════════════════════════════════════════
// TWO CLOCKS, AND THEY MUST NOT FIGHT
// ═══════════════════════════════════════════════════════════════════════════
//
// The room is open 20:00–24:00 London. A 48-hour horizon measured from the
// moment of posting cuts straight across that: a post made at 20:05 on Monday
// turns 48 hours old at 20:05 on Wednesday — five minutes into Wednesday's
// session, while people are reading it. A post made at 23:50 vanishes ten
// minutes before closing. Every post gets its own arbitrary disappearing moment
// inside a live session, and two posts made four hours apart get very different
// amounts of the room.
//
// SO THE HORIZON IS EVALUATED ONCE, AT THE OPENING BELL, AND NEVER DURING A
// SESSION. At 20:00 everything past 48 hours goes; for the next four hours the
// room is stable and nothing disappears from under anyone.
//
// That yields a property worth having. Because the room only runs in the
// evening, a post from any given night is always 44–48 hours old at the bell two
// nights later, and 68–72 hours old at the bell after that. So every post lives
// exactly three sessions — the night it was made plus two more — whether it was
// posted at 20:01 or 23:59. Uniform, and describable to a reader in one line.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE HORIZON IS SCOPED TO THE THREAD, NOT THE POST
// ═══════════════════════════════════════════════════════════════════════════
//
// A reply is a post with a parentId, in the same node, with its own createdAt —
// and a reply is always NEWER than its parent. So ageing each record on its own
// clock would archive every parent before its replies and orphan the lot, in
// order, one bell at a time. Not a rare edge: the guaranteed outcome for every
// thread in the room.
//
// A thread moves as one unit, aged on its PARENT. Orphans become structurally
// impossible rather than merely unlikely, and the same rule delivers the pin:
//
//   A PINNED THREAD SURVIVES, AND SO DO ITS REPLIES.
//
// That is what the winners announcement needs — the post must not vanish, and
// neither should the replies underneath it. Because replies were never aged
// separately, they simply come along.
//
// ⚠ RE-MEASURED 4 SEP 2026, BEFORE ARMING. This docblock previously said the
// announcement carried "thirteen congratulations". It carries ONE reply, and
// always did — the congratulations arrived as separate root posts, which are
// NOT protected by the pin and DO go at the bell. The distinction matters
// exactly here, so it is recorded rather than corrected away: pinning a post
// protects its thread, not its subject. Verified against live square_posts —
// the announcement (-P0YywQIAr-6lMaUpIU2, Ikenna, 2 Sep 22:17) is pinned, and
// its thread is 2 records.
//
// ═══════════════════════════════════════════════════════════════════════════
// ⚠ WHY THIS IS A SCRIPT ON A CRON AND NOT AN ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════
//
// The thing this replaces — app/api/square-cleanup/route.js — never executed
// once in 150 days, for two independent reasons, either of which alone was
// fatal: nothing called it, and it is a Next.js route handler under app/api/,
// which `output: 'export'` never builds, so the URL 404s. It also hard-deleted,
// and carried a shared secret in committed source.
//
// This runs from .github/workflows/square-horizon.yml on an hourly cron and
// no-ops unless the London hour is 20. Hourly rather than a fixed UTC time
// because London is UTC+1 in summer and UTC+0 in winter, and a fixed schedule
// would drift an hour off the bell at each clock change and start sweeping
// mid-session.
//
// AND IT LEAVES A HEARTBEAT. Every run writes square_horizon/, so "did it stop?"
// is a question with an answer. The workflow fails loudly if the last bell is
// more than 26 hours old — a horizon that silently never runs is the defect this
// round exists to fix, and it must not be able to come back quietly.
//
// ═══════════════════════════════════════════════════════════════════════════
// CLOCK-1.1 — ONE BELL A NIGHT, HOWEVER MANY RUNS (decided 16 Nov 2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// The clock (workers-external/calvary-clock) dispatches this workflow at :05,
// and GitHub's own schedule still fires it too, often late. So two runs can land
// in the 20:00 hour, together or an hour apart. Before this, every --apply run
// in hour 20 swept with ITS OWN clock: a second run at 20:40 moved every thread
// that had turned 48 hours old since 20:00, which means posts vanishing in the
// middle of a session, the one thing this design exists to prevent.
//
// Now:
//   · THE BELL IS 20:00 LONDON, NOT THE MOMENT A RUN STARTS. Everything the bell
//     does (the plan, archivedAt, lastBellAt) is as of 20:00 that night, so any
//     run that night moves exactly the same posts. A run at 20:59 sweeps as if it
//     were 20:00.
//   · THE NIGHT IS CLAIMED BEFORE ANYTHING MOVES (square_horizon/bell, a
//     transaction), so the rest of what the bell does (the heartbeat's
//     lastBellAt / sweptAtLastRun) happens once. A second run stands down.
//   · A claim whose run failed is marked so, and the next run that hour takes it
//     at once. A run that died without saying so holds the night for LEASE_MS
//     (15 min; the job's timeout is 10), then the night may be retried. Never
//     after 21:00: outside the bell nothing is swept, and the liveness step says
//     so the next day.
//   · --force (a manual catch-up) is unchanged: it sweeps as of the moment it
//     runs, and claims nothing.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { openGuard } from '../safety/guard.mjs';
import { isId } from '../../app/lib/ids.js';
import { takeFn, settleFn, runIdOf, LEASE_MS } from '../ops/once.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

export const HORIZON_MS = 48 * 60 * 60 * 1000;
export const BELL_HOUR = 20;

const argv  = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const FORCE = argv.includes('--force');

export function londonHour(at = Date.now()) {
  return parseInt(new Date(at).toLocaleString('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', hour12: false,
  }), 10);
}

/**
 * Group every record into threads and decide which ones the bell clears.
 *
 * Pure, and exported so tests can assert the decision without a database. The
 * three outcomes a caller cares about: what stays, what moves, and why.
 */
export function planSweep(posts, now = Date.now()) {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const threads = new Map(); // rootId -> { root, replies[] }

  for (const p of posts) {
    if (!p.parentId) {
      if (!threads.has(p.id)) threads.set(p.id, { root: p, replies: [] });
      else threads.get(p.id).root = p;
    }
  }
  const orphans = [];
  for (const p of posts) {
    if (!p.parentId) continue;
    const t = threads.get(p.parentId);
    if (t) t.replies.push(p);
    // A reply whose parent is already gone. Should not arise once this runs —
    // threads move whole — but historical data is not owed our assumptions, and
    // an orphan must not become immortal by having nothing to be aged against.
    else orphans.push(p);
  }
  for (const o of orphans) {
    if (!threads.has(o.id)) threads.set(o.id, { root: o, replies: [], orphan: true });
  }

  const keep = [], move = [], decisions = [];
  for (const t of threads.values()) {
    const age = now - (typeof t.root.createdAt === 'number' ? t.root.createdAt : 0);
    const pinned = t.root.pinned === true;
    const past = age > HORIZON_MS;
    const records = [t.root, ...t.replies];
    const why = pinned ? 'pinned' : past ? 'past the horizon' : 'inside the horizon';
    decisions.push({
      rootId: t.root.id, pinned, past, orphan: !!t.orphan,
      ageHours: age / 3600000, replies: t.replies.length, records: records.length, why,
    });
    if (pinned || !past) keep.push(...records);
    else move.push(...records);
  }
  return { threads: threads.size, keep, move, decisions, orphans: orphans.length, byId };
}

function fail(msg) { console.error(`\n  ✗ ${msg}\n`); process.exit(1); }

const LONDON_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const londonParts = (ms) => Object.fromEntries(LONDON_PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));

/**
 * The bell of the London night containing `now`: { night: 'YYYY-MM-DD', at: epoch ms of 20:00 London }.
 * London's offset at 20:00 is the offset all evening (the clocks change at 01:00 UTC), so it is read
 * at `now` when `now` is in the bell hour, and at 20:00 UTC on that date otherwise.
 */
export function bellOf(now) {
  const p = londonParts(now);
  const night = `${p.year}-${p.month}-${p.day}`;
  const guessUtc = Date.UTC(+p.year, +p.month - 1, +p.day, BELL_HOUR);
  const q = londonParts(guessUtc);
  const offsetH = ((Date.UTC(+q.year, +q.month - 1, +q.day, +q.hour, +q.minute) - guessUtc) / 3600000);
  return { night, at: guessUtc - offsetH * 3600000 };
}

/**
 * ONE RUN. `db` is a guarded firebase-admin handle in production (any object with
 * ref(path).get/update/transaction and ref().update in the tests). Returns what it did.
 *   action: 'dry-run' | 'not-the-bell' | 'already-rung' | 'in-flight' | 'swept'
 */
export async function ringBell(db, now, { apply = false, force = false, runId = runIdOf(process.env, now), log = console.log, leaseMs = LEASE_MS } = {}) {
  const hour = londonHour(now);
  const atBell = hour === BELL_HOUR;
  const bell = bellOf(now);
  const asOf = force || !atBell ? now : bell.at;

  const readRoom = async () => {
    const [postSnap, reactSnap] = await Promise.all([db.ref('square_posts').get(), db.ref('square_reactions').get()]);
    // LIVE-PATHS-1: the KEY is the id; a stored `id` field never overrides it.
    return { posts: Object.entries(postSnap.val() || {}).map(([id, p]) => ({ ...p, id })), reactions: reactSnap.val() || {} };
  };

  let { posts, reactions } = await readRoom();
  let plan = planSweep(posts, asOf);
  report(log, { now, hour, atBell, asOf, posts, plan });

  if (!apply) { log(`\n  DRY RUN — nothing was written. Re-run with --apply.\n`); return { action: 'dry-run', plan }; }
  if (!atBell && !force) {
    log(`\n  NOT THE BELL — no sweep. The horizon is evaluated once a day, at ${BELL_HOUR}:00 London,`);
    log(`  so nothing is ever removed while a session is open. Heartbeat updated.\n`);
    await db.ref('square_horizon').update({ lastRunAt: now, lastRunHour: hour, sweptAtLastRun: 0 });
    return { action: 'not-the-bell' };
  }

  // ── claim the night ──────────────────────────────────────────────────────
  if (!force) {
    const record = { night: bell.night, state: 'claimed', at: now, runId, asOf: bell.at };
    const res = await db.ref('square_horizon/bell').transaction(
      takeFn(record, now, { leaseMs, free: (cur) => !cur || cur.night !== bell.night }),
    );
    if (!res.committed) {
      const cur = res.snapshot?.val?.() || {};
      const action = cur.state === 'claimed' ? 'in-flight' : 'already-rung';
      log(`\n  ${action === 'in-flight' ? 'ANOTHER RUN HOLDS TONIGHT\'S BELL' : 'TONIGHT\'S BELL HAS ALREADY RUNG'} (${bell.night}) — no sweep. Heartbeat updated.\n`);
      await db.ref('square_horizon').update({ lastRunAt: now, lastRunHour: hour });
      return { action };
    }
    // The room as it is now that the night is ours: a run before us may have moved some of it.
    ({ posts, reactions } = await readRoom());
    plan = planSweep(posts, asOf);
  }

  // ── the sweep ────────────────────────────────────────────────────────────
  // One multi-path update per thread-batch: the archive write and the live
  // removal land together, so a record is never in neither place.
  let moved = 0;
  let badAuthorUid = 0;
  const CHUNK = 100;
  try {
    for (let i = 0; i < plan.move.length; i += CHUNK) {
      const batch = plan.move.slice(i, i + CHUNK);
      const patch = {};
      for (const p of batch) {
        const { id, ...rec } = p;
        patch[`square_archive/${id}`] = { ...rec, archivedAt: asOf, archivedBy: 'horizon' };
        if (reactions[id]) patch[`square_archive_reactions/${id}`] = reactions[id];
        patch[`square_posts/${id}`] = null;
        patch[`square_reactions/${id}`] = null;
        // LIVE-PATHS-1: authorUid is a field the post's owner can rewrite to any string. A '.' in it
        // made the guard throw and stalled every hourly sweep; a '/' nested the write. Only a real
        // uid builds a path; anything else leaves that one index entry alone (counted below).
        if (isId('uid', p.authorUid)) patch[`user_square_posts/${p.authorUid}/${id}`] = null;
        else if (p.authorUid) badAuthorUid++;
      }
      await db.ref().update(patch);
      moved += batch.length;
    }
    await db.ref('square_horizon').update({
      lastRunAt: now, lastRunHour: hour, lastBellAt: asOf,
      sweptAtLastRun: moved, remaining: plan.keep.length,
    });
  } catch (e) {
    // Say so, so the next run this hour takes the night at once rather than after the lease.
    if (!force) await db.ref('square_horizon/bell').transaction(settleFn(runId, { state: 'failed', failedAt: now })).catch(() => {});
    throw e;
  }
  if (!force) await db.ref('square_horizon/bell').transaction(settleFn(runId, { state: 'done', doneAt: now, moved }));

  log(`\n  ✓ SWEPT as of ${new Date(asOf).toISOString()} — ${moved} records moved to square_archive. ${plan.keep.length} remain in the room.\n`);
  if (badAuthorUid) log(`  ⚠ ${badAuthorUid} moved post(s) carried an authorUid that is not a uid: their user_square_posts entry was left alone.\n`);
  return { action: 'swept', moved, plan };
}

function report(log, { now, hour, atBell, asOf, posts, plan }) {
  const london = new Date(now).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'medium' });
  log(`\n  THE HORIZON — 48h, thread-scoped, evaluated at the ${BELL_HOUR}:00 bell`);
  log(`  ${'─'.repeat(62)}`);
  log(`  London now ............... ${london}`);
  log(`  at the bell .............. ${atBell ? 'YES' : `no (hour ${hour}) — a sweep would no-op`}`);
  log(`  measured as of ........... ${new Date(asOf).toISOString()}`);
  log(`  records in the room ...... ${posts.length}`);
  log(`  threads .................. ${plan.threads}   (orphaned replies adopted: ${plan.orphans})`);
  log(`  ${'─'.repeat(62)}`);
  log(`  STAYS .................... ${plan.keep.length} records`);
  log(`  MOVES to square_archive .. ${plan.move.length} records`);
  log(`  ${'─'.repeat(62)}`);
  const pinned = plan.decisions.filter((d) => d.pinned);
  const inside = plan.decisions.filter((d) => !d.pinned && !d.past);
  log(`  pinned threads (exempt) .. ${pinned.length}`);
  log(`  inside the horizon ....... ${inside.length}`);
}

async function main() {
  const sa = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(sa), databaseURL: DB_URL });
  // SAFETY-1: every write goes through the guard (dry without --apply; backup, verify, write).
  const guard = await openGuard('square-horizon');
  const db = guard.adminDb(getDatabase());
  await ringBell(db, Date.now(), { apply: APPLY, force: FORCE });
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => fail(e.stack || e.message));
}
