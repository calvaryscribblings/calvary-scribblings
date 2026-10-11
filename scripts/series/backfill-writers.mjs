// W38, §1.1 — GIVE EACH EXISTING SERIES ITS WRITER, FROM ITS INSTALMENTS.
//
//   node scripts/series/backfill-writers.mjs            dry run: says what it would write
//   node scripts/series/backfill-writers.mjs --apply    backs up series/, writes, re-reads
//
// Ruling 140 moves the writer onto the series: author, authorUid and authorHandle, all three or
// none. A series created before W38 has none, so this reads each one's instalment detail records
// and writes the writer they agree on.
//
// WHAT "AGREE" MEANS. The writer is the ACCOUNT: every instalment must carry the same authorUid
// and the same author name, or the script stops and writes nothing at all. The handle is compared
// after stripping a leading "@", because two instalments were saved by hand as "@name" (Beta
// Princess i3, Diary i2) — the same account and the same name, with a typed character no
// usernames/ entry answers to. The handle written is the bare one, and it must resolve through
// usernames/<handle> to that same uid, or the script stops.
//
// The instalments' own records are NOT touched: they keep what they carry. Voices, search and
// myStories key off each instalment's authorUid, which this never changes.
//
// Prints counts, series ids and names only. Never a uid. The backup goes to
// ~/calvary-backups/w38/, outside the repo (the repo is public).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const APPLY = process.argv.includes('--apply');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';


/** Pure: the writer a series' instalments agree on, or why they do not. Exported for the CI suite. */
export function agreedWriter(details) {
  const writers = details.filter(Boolean).map((d) => ({
    author: String(d.author || '').trim(),
    authorUid: String(d.authorUid || '').trim(),
    authorHandle: String(d.authorHandle || '').trim().replace(/^@+/, ''),
  }));
  if (!writers.length) return { none: true };
  const uids = new Set(writers.map((w) => w.authorUid));
  const names = new Set(writers.map((w) => w.author));
  const handles = new Set(writers.map((w) => w.authorHandle));
  if (uids.size !== 1 || names.size !== 1 || handles.size !== 1 || [...uids][0] === '' || [...names][0] === '' || [...handles][0] === '') {
    return { disagree: { accounts: uids.size, names: names.size, handles: handles.size } };
  }
  return { writer: writers[0], strayAt: details.filter((d) => /^@/.test(String(d?.authorHandle || ''))).length };
}

async function main() {
  initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: DB_URL });
  const db = getDatabase();
  const [series, rows, details] = await Promise.all(['series', 'series_instalments', 'series_instalments_detail']
    .map((p) => db.ref(p).get().then((s) => s.val() || {})));

  const plan = [];
  let stop = false;
  for (const [sid, s] of Object.entries(series)) {
    if (s.authorUid) { console.log(`${sid}: has a writer already — skipped`); continue; }
    const mine = Object.entries(rows).filter(([, r]) => r.seriesId === sid).map(([id]) => details[id]);
    const verdict = agreedWriter(mine);
    if (verdict.none) { console.log(`${sid}: no instalments — nothing to copy`); continue; }
    if (verdict.disagree) {
      const d = verdict.disagree;
      console.log(`${sid}: ⛔ its instalments disagree — ${d.accounts} accounts, ${d.names} names, ${d.handles} handles`);
      stop = true;
      continue;
    }
    const owner = (await db.ref(`usernames/${verdict.writer.authorHandle.toLowerCase()}`).get()).val();
    if (owner !== verdict.writer.authorUid) {
      console.log(`${sid}: ⛔ @${verdict.writer.authorHandle} does not resolve to the instalments' account`);
      stop = true;
      continue;
    }
    console.log(`${sid}: ${mine.length} instalments agree on ${verdict.writer.author} (@${verdict.writer.authorHandle})`
      + (verdict.strayAt ? ` — ${verdict.strayAt} of them store the handle with a stray "@", left as it is` : ''));
    plan.push([sid, verdict.writer]);
  }

  if (stop) { console.log('\nSTOPPED: nothing written. Resolve the series marked ⛔ first.'); process.exit(1); }
  if (!plan.length) { console.log('\nNothing to write.'); process.exit(0); }
  if (!APPLY) { console.log(`\nDry run: ${plan.length} series would gain a writer. Run with --apply.`); process.exit(0); }

  const dir = join(homedir(), 'calvary-backups', 'w38');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `series-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(series, null, 2));
  console.log(`\nBacked up series/ (${Object.keys(series).length} records) to ${file}`);

  const patch = {};
  const now = Date.now();
  for (const [sid, w] of plan) {
    patch[`series/${sid}/author`] = w.author;
    patch[`series/${sid}/authorUid`] = w.authorUid;
    patch[`series/${sid}/authorHandle`] = w.authorHandle;
    patch[`series/${sid}/updatedAt`] = now;
  }
  await db.ref().update(patch);

  const after = (await db.ref('series').get()).val() || {};
  let ok = 0;
  for (const [sid, w] of plan) {
    const a = after[sid] || {};
    const same = a.author === w.author && a.authorUid === w.authorUid && a.authorHandle === w.authorHandle;
    // Everything else on the record is exactly as it was.
    const rest = (o) => JSON.stringify(Object.fromEntries(Object.entries(o || {}).filter(([k]) => !['author', 'authorUid', 'authorHandle', 'updatedAt'].includes(k)).sort()));
    const untouched = rest(a) === rest(series[sid]);
    console.log(`${sid}: writer ${same ? 'written' : '⛔ NOT AS WRITTEN'} · other fields ${untouched ? 'unchanged' : '⛔ CHANGED'}`);
    if (same && untouched) ok++;
  }
  console.log(`\n${ok} of ${plan.length} series verified.`);
  process.exit(ok === plan.length ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
