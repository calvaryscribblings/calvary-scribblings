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

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

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

async function main() {
  const sa = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(sa), databaseURL: DB_URL });
  const db = getDatabase();

  const now = Date.now();
  const hour = londonHour(now);
  const atBell = hour === BELL_HOUR;

  const [postSnap, reactSnap] = await Promise.all([
    db.ref('square_posts').get(),
    db.ref('square_reactions').get(),
  ]);
  const posts = Object.entries(postSnap.val() || {}).map(([id, p]) => ({ id, ...p }));
  const reactions = reactSnap.val() || {};

  const plan = planSweep(posts, now);
  const london = new Date(now).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'medium' });

  console.log(`\n  THE HORIZON — 48h, thread-scoped, evaluated at the ${BELL_HOUR}:00 bell`);
  console.log(`  ${'─'.repeat(62)}`);
  console.log(`  London now ............... ${london}`);
  console.log(`  at the bell .............. ${atBell ? 'YES' : `no (hour ${hour}) — a sweep would no-op`}`);
  console.log(`  records in the room ...... ${posts.length}`);
  console.log(`  threads .................. ${plan.threads}   (orphaned replies adopted: ${plan.orphans})`);
  console.log(`  ${'─'.repeat(62)}`);
  console.log(`  STAYS .................... ${plan.keep.length} records`);
  console.log(`  MOVES to square_archive .. ${plan.move.length} records`);
  console.log(`  ${'─'.repeat(62)}`);

  const pinned = plan.decisions.filter((d) => d.pinned);
  const inside = plan.decisions.filter((d) => !d.pinned && !d.past);
  console.log(`  pinned threads (exempt) .. ${pinned.length}`);
  for (const d of pinned) console.log(`      ${d.rootId.slice(0, 14)}…  ${d.replies} replies  ${d.ageHours.toFixed(1)}h old`);
  console.log(`  inside the horizon ....... ${inside.length}`);
  for (const d of inside.slice(0, 8)) console.log(`      ${d.rootId.slice(0, 14)}…  ${d.replies} replies  ${d.ageHours.toFixed(1)}h old`);

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing was written. Re-run with --apply.\n`);
    process.exit(0);
  }
  if (!atBell && !FORCE) {
    console.log(`\n  NOT THE BELL — no sweep. The horizon is evaluated once a day, at ${BELL_HOUR}:00 London,`);
    console.log(`  so nothing is ever removed while a session is open. Heartbeat updated.\n`);
    await db.ref('square_horizon').update({ lastRunAt: now, lastRunHour: hour, sweptAtLastRun: 0 });
    process.exit(0);
  }

  // ── the sweep ────────────────────────────────────────────────────────────
  // One multi-path update per thread-batch: the archive write and the live
  // removal land together, so a record is never in neither place.
  let moved = 0;
  const CHUNK = 100;
  for (let i = 0; i < plan.move.length; i += CHUNK) {
    const batch = plan.move.slice(i, i + CHUNK);
    const patch = {};
    for (const p of batch) {
      const { id, ...rec } = p;
      patch[`square_archive/${id}`] = { ...rec, archivedAt: now, archivedBy: 'horizon' };
      if (reactions[id]) patch[`square_archive_reactions/${id}`] = reactions[id];
      patch[`square_posts/${id}`] = null;
      patch[`square_reactions/${id}`] = null;
      if (p.authorUid) patch[`user_square_posts/${p.authorUid}/${id}`] = null;
    }
    await db.ref().update(patch);
    moved += batch.length;
  }

  await db.ref('square_horizon').update({
    lastRunAt: now, lastRunHour: hour, lastBellAt: now,
    sweptAtLastRun: moved, remaining: plan.keep.length,
  });

  console.log(`\n  ✓ SWEPT — ${moved} records moved to square_archive. ${plan.keep.length} remain in the room.\n`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => fail(e.stack || e.message));
}
