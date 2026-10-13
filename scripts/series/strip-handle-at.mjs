// W39, §1 — STORE EVERY SERIES WRITER'S HANDLE WITHOUT ITS "@".
//
//   node scripts/series/strip-handle-at.mjs            dry run: lists what it would change
//   node scripts/series/strip-handle-at.mjs --apply    backs up, writes, re-reads
//
// W38 found two instalment detail records saved by hand as "@name" (Beta Princess i3, Diary i2).
// No usernames/ entry answers to "@name", so the credit's link went nowhere. This sweeps every
// record under series/, series_instalments/ and series_instalments_detail/ that carries an
// authorHandle, and removes the leading "@" — nothing else. Not updatedAt, not any other field.
//
// The write path now strips it (bareHandle() in app/lib/series/admin-writes.js) and the
// validators refuse it, so this should be needed once.
//
// Prints record ids and counts only. Never a uid. The backup goes to ~/calvary-backups/w39/,
// outside the repo (the repo is public).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const APPLY = process.argv.includes('--apply');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const NODES = ['series', 'series_instalments', 'series_instalments_detail'];

/** Pure: the [path, bare] pairs a set of nodes needs. Exported for the CI suite. */
export function strayHandles(trees) {
  const out = [];
  for (const [node, records] of Object.entries(trees)) {
    for (const [id, rec] of Object.entries(records || {})) {
      const h = rec && rec.authorHandle;
      if (typeof h === 'string' && /^\s*@/.test(h)) out.push([`${node}/${id}/authorHandle`, h.trim().replace(/^@+/, '')]);
    }
  }
  return out;
}

async function main() {
  initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: DB_URL });
  const db = getDatabase();
  const trees = Object.fromEntries(await Promise.all(NODES.map((p) => db.ref(p).get().then((s) => [p, s.val() || {}]))));

  const withHandle = Object.values(trees).reduce((n, recs) => n + Object.values(recs).filter((r) => r && 'authorHandle' in r).length, 0);
  const plan = strayHandles(trees);
  console.log(`${withHandle} records carry a handle; ${plan.length} store it with a stray "@":`);
  for (const [path] of plan) console.log(`  ${path.replace(/\/authorHandle$/, '')}`);
  if (!plan.length) process.exit(0);
  if (!APPLY) { console.log('\nDry run. Run with --apply.'); process.exit(0); }

  const dir = join(homedir(), 'calvary-backups', 'w39');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `series-handles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(trees, null, 2));
  console.log(`\nBacked up ${NODES.join(', ')} to ${file}`);

  await db.ref().update(Object.fromEntries(plan));

  // Re-read every touched record whole: the handle is bare, and every other field is as it was.
  let ok = 0;
  for (const [path, bare] of plan) {
    const recPath = path.replace(/\/authorHandle$/, '');
    const [node, id] = recPath.split('/');
    const after = (await db.ref(recPath).get()).val() || {};
    const before = trees[node][id];
    const rest = (o) => JSON.stringify(Object.entries(o).filter(([k]) => k !== 'authorHandle').sort(([a], [b]) => a.localeCompare(b)));
    const good = after.authorHandle === bare && rest(after) === rest(before);
    console.log(`  ${recPath}: ${good ? 'handle bare · every other field unchanged' : '⛔ NOT AS EXPECTED'}`);
    if (good) ok++;
  }
  console.log(`\n${ok} of ${plan.length} verified.`);
  process.exit(ok === plan.length ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
