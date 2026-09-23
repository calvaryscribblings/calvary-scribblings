// THE ANNOUNCER'S ONE PASS — receipts, pruning, then any newly visible item.
//
// A function of (db, expo, now) and nothing else, so tests/push/announcer.emulator.test.mjs
// can run it against the RTDB emulator with a stand-in for Expo and watch it: send once,
// refuse twice, survive a crash, prune a dead device. scripts/push/announce.mjs is the thin
// CLI around it.

import {
  planAnnouncements, planSeed, buildAudience, messagesFor, planTickets,
  receiptsToFetch, planReceipts, storyMessage, instalmentMessage, chunk,
  DEFAULT_MAX_PER_RUN, RECEIPT_BATCH, EXPO_BATCH,
} from './lib.mjs';
import * as store from './store.mjs';
import { BATCH_PAUSE_MS } from './expo.mjs';

const noop = () => {};

/** Receipts for tickets old enough to have one; dead devices come off the list. */
export async function processReceipts(db, expo, now, { apply, log = noop }) {
  const stored = await store.readReceipts(db);
  const asked = receiptsToFetch(stored, now);
  const answers = {};
  // A dry run makes no call to Expo at all, so it needs no access token to show its plan.
  if (apply) for (const ids of chunk(asked, RECEIPT_BATCH)) Object.assign(answers, await expo.getReceipts(ids));
  const plan = planReceipts(stored, answers, asked, now);
  log(`receipts: ${Object.keys(stored).length} held, ${asked.length} asked, ${plan.ok} ok, ${plan.dead.length} dead device(s), ${plan.errors.length} other error(s)`);
  for (const e of plan.errors) log(`  receipt error ${e.ticketId}: ${e.error}`);
  if (apply) {
    await store.deleteTokens(db, plan.dead);
    await store.clearReceipts(db, plan.clear);
  }
  return plan;
}

/** Rows not refreshed in 60 days. The app rewrites its row on every launch. */
export async function pruneStale(db, now, { apply, log = noop, tokens }) {
  const { stale } = buildAudience(tokens, {}, now);
  log(`prune: ${stale.length} token row(s) not refreshed in 60 days`);
  if (apply) await store.deleteTokens(db, stale);
  return stale;
}

async function messageFor(db, item, world) {
  if (item.kind === 'story') return storyMessage(item.id, world.stories[item.id]);
  const row = world.instalments[item.id];
  const detail = await store.readInstalmentDetail(db, item.id);
  return instalmentMessage(item.id, row, detail, world.series[row?.seriesId]);
}

/**
 * Send one item to the audience. Returns the entry recorded under push_announced.
 *
 * AT MOST ONCE. The claim is taken before the first batch leaves. If nothing has reached Expo
 * when something throws, the claim is released and the next run tries again; once any batch
 * has been accepted, the item is marked `partial` and is NEVER retried — a reader missing one
 * notification is a smaller failure than a reader getting the same one twice.
 */
async function announceOne(db, expo, item, message, recipients, ctx) {
  const { now, runId, log, pause } = ctx;
  if (!(await store.claim(db, item.kind, item.id, runId, now))) {
    log(`  ${item.kind}/${item.id}: already claimed by another run — skipped`);
    return null;
  }
  const batches = messagesFor(message, recipients);
  let accepted = 0, ok = 0, dead = 0, errors = 0;
  try {
    for (let i = 0; i < batches.length; i++) {
      if (i) await pause(BATCH_PAUSE_MS);
      const batch = batches[i];
      const tickets = await expo.sendBatch(batch);
      accepted++;
      const who = recipients.slice(i * EXPO_BATCH, i * EXPO_BATCH + batch.length);
      const t = planTickets(tickets, who, { kind: item.kind, id: item.id });
      await store.addReceipts(db, t.pending, now);
      await store.deleteTokens(db, t.dead);
      ok += t.pending.length; dead += t.dead.length; errors += t.errors.length;
      for (const e of t.errors) log(`  ticket error ${e.uid}/${e.tokenKey}: ${e.error}`);
    }
  } catch (err) {
    if (accepted === 0) {
      await store.release(db, item.kind, item.id);
      log(`  ${item.kind}/${item.id}: send failed before anything left — released for the next run (${err.message})`);
      throw err;
    }
    const entry = { state: 'partial', sentAt: now, batches: batches.length, accepted, ok, dead, errors, error: String(err.message).slice(0, 300) };
    await store.finish(db, item.kind, item.id, entry);
    log(`  ${item.kind}/${item.id}: PARTIAL — ${accepted}/${batches.length} batches left before: ${err.message}`);
    throw err;
  }
  const entry = { state: 'sent', sentAt: now, recipients: recipients.length, ok, dead, errors, title: message.title };
  await store.finish(db, item.kind, item.id, entry);
  log(`  ${item.kind}/${item.id}: sent to ${recipients.length} device(s) — ${ok} ok, ${dead} dead, ${errors} error(s)`);
  return entry;
}

/**
 * The whole pass. `apply: false` reads everything and writes and sends nothing.
 */
export async function runAnnouncer(db, expo, now, {
  apply = false, max = DEFAULT_MAX_PER_RUN, runId = `local-${now}`, log = noop,
  pause = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const hb = await store.readHeartbeat(db);
  // ⚠ THE SEED RAIL. No seed, no send — see planSeed() for what the first run would do.
  if (!hb.seededAt) {
    throw new Error('NOT SEEDED: ops/push_announcer/seededAt is absent. Run the seed first ' +
      '(scripts/push/announce.mjs --seed --apply) or the first run announces the whole back catalogue.');
  }

  const receipts = await processReceipts(db, expo, now, { apply, log });
  const tokens = await store.readTokens(db);
  const pruned = await pruneStale(db, now, { apply, log, tokens });

  const world = await store.readWorld(db);
  const due = planAnnouncements(world, now);
  log(`due: ${due.length} item(s) visible and never announced`);
  for (const d of due) log(`  ${d.kind}/${d.id}`);
  if (due.length > max) {
    throw new Error(`REFUSED: ${due.length} items due, over the limit of ${max}. A mass diff is a ` +
      'missing seed or a broken predicate, not a busy day. Read the list above; raise --max only on purpose.');
  }

  const uids = Object.keys(tokens);
  const prefs = await store.readPrefs(db, uids);
  const { recipients, optedOut } = buildAudience(tokens, prefs, now);
  log(`audience: ${recipients.length} device(s), ${optedOut} switched off`);

  const results = [];
  for (const item of due) {
    const built = await messageFor(db, item, world);
    if (built.refused) {
      log(`  ${item.kind}/${item.id}: REFUSED — ${built.refused}. Recorded, never sent.`);
      if (apply && await store.claim(db, item.kind, item.id, runId, now)) {
        await store.finish(db, item.kind, item.id, { state: 'refused', reason: built.refused });
      }
      results.push({ ...item, refused: built.refused });
      continue;
    }
    if (built.dropped) log(`  ${item.kind}/${item.id}: tail dropped (carried "${built.dropped}") — byline only`);
    log(`  ${item.kind}/${item.id}: "${built.message.title}" — ${built.message.body}`);
    if (!apply) { results.push({ ...item, message: built.message, dryRun: true }); continue; }
    const entry = await announceOne(db, expo, item, built.message, recipients, { now, runId, log, pause });
    results.push({ ...item, message: built.message, entry });
  }

  if (apply) {
    await store.writeHeartbeat(db, {
      lastRunAt: now,
      announcedAtLastRun: results.filter((r) => r.entry).length,
      audienceAtLastRun: recipients.length,
      receiptsOkAtLastRun: receipts.ok,
      deadAtLastRun: receipts.dead.length,
      prunedAtLastRun: pruned.length,
      ...(results.some((r) => r.entry) ? { lastSendAt: now } : {}),
    });
  }
  return { due, results, receipts, pruned, recipients: recipients.length, optedOut };
}

/** The seed pass. Refuses to run twice unless forced — a late re-seed silently eats announcements. */
export async function runSeed(db, now, { apply = false, force = false, log = noop } = {}) {
  const hb = await store.readHeartbeat(db);
  if (hb.seededAt && !force) {
    throw new Error(`ALREADY SEEDED at ${new Date(hb.seededAt).toISOString()}. Re-seeding marks every ` +
      'story published since then as announced without announcing it. Pass --force only if that is the intent.');
  }
  const world = await store.readSeedWorld(db);
  const plan = planSeed(world, now);
  log(`seed: ${plan.mark.length} item(s) to mark announced, ${plan.pending.length} left to announce when they go live`);
  for (const p of plan.pending) log(`  pending ${p.kind}/${p.id}`);
  if (apply) await store.writeSeed(db, plan.mark, now);
  return plan;
}
