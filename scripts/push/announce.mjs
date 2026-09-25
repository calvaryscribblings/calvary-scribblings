// THE PUSH ANNOUNCER — one notification per story or instalment, when it first becomes visible.
//
//   node scripts/push/announce.mjs                    # dry run: the plan, no writes, no sends
//   node scripts/push/announce.mjs --apply            # send, mark announced, receipts, prune
//   node scripts/push/announce.mjs --seed             # dry run of the seed
//   node scripts/push/announce.mjs --seed --apply     # ⚠ ONCE, before the first --apply
//   node scripts/push/announce.mjs --frequency        # what the last 30 days would have sent
//   --max N                                           # raise the mass-diff refusal (default 5)
//
// Credentials: PUSH_SERVICE_ACCOUNT (a path) or ./serviceAccountKey.json for the database;
// EXPO_ACCESS_TOKEN for Expo, required by --apply and nothing else.
//
// ⚡ ARMED 25 Sep 2026 (W8): .github/workflows/push-announce.yml runs --apply every 15 minutes.
// Its `schedule:` block is the switch. The go-live record is docs/PUSH-GO-LIVE.md.

import { runAnnouncer, runSeed } from './run.mjs';
import { sendBatch, getReceipts } from './expo.mjs';
import { readWorld } from './store.mjs';
import { frequencyReport } from './frequency.mjs';
import { openProductionDb } from './db.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

async function main() {
  const apply = has('--apply');
  const db = await openProductionDb();
  const now = Date.now();
  const log = (s) => console.log(`  ${s}`);
  console.log(`\n  PUSH ANNOUNCER — ${apply ? 'APPLY' : 'dry run'} — ${new Date(now).toISOString()}\n`);

  if (has('--frequency')) {
    frequencyReport(await readWorld(db), now, log);
    return;
  }
  if (has('--seed')) {
    await runSeed(db, now, { apply, force: has('--force'), log });
    if (!apply) log('dry run — nothing written. Re-run with --apply to seed.');
    return;
  }

  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (apply && !accessToken) throw new Error('EXPO_ACCESS_TOKEN is not set — refusing to send without it.');
  const expo = {
    sendBatch: (msgs) => sendBatch(msgs, { accessToken }),
    getReceipts: (ids) => getReceipts(ids, { accessToken }),
  };
  const max = arg('--max') ? Number(arg('--max')) : undefined;
  const runId = `${process.env.GITHUB_RUN_ID || 'local'}-${process.pid}-${now}`;
  await runAnnouncer(db, expo, now, { apply, runId, log, ...(max ? { max } : {}) });
  if (!apply) log('dry run — nothing sent, nothing written.');
}

main().then(() => process.exit(0), (err) => {
  console.error(`\n  ✗ ${err.message}\n`);
  process.exit(1);
});
