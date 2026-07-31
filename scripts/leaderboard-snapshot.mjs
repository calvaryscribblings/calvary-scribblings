// Capture a leaderboard baseline (or closing) snapshot for a contest board.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/leaderboard-snapshot.mjs summer-2026                    # plan only
//   node scripts/leaderboard-snapshot.mjs summer-2026 --apply            # opening capture
//   node scripts/leaderboard-snapshot.mjs summer-2026 --final --apply    # closing capture
//   node scripts/leaderboard-snapshot.mjs summer-2026 --apply --force    # overwrite existing
//
// WHAT IT WRITES
//
//   leaderboards/{boardId}/snapshot/{uid} = { points, reads }   (opening)
//   leaderboards/{boardId}/startedAt      = <ms epoch>
//   leaderboards/{boardId}/final/{uid}    = { points, reads }   (--final)
//   leaderboards/{boardId}/closedAt       = <ms epoch>
//
// Opening and closing captures are byte-identical in shape — the same builder
// produces both, so a board's delta is always (final - snapshot) field by field.
// A uid absent from `snapshot` is treated as 0/0 by the board (new accounts).
//
// WHY TWO FIELDS
//
//   points — points/{uid}/total. The contest currency.
//   reads  — users/{uid}/readCount.
//
// `reads` is readCount, NOT the child count of users/{uid}/readStories, because
// readCount is the exact scalar the awarding code reads and modulos:
// app/stories/[slug]/page-client.js:1156 re-reads users/{uid}/readCount after
// its transaction and awards 5 points when `newCount % 10 === 0`. Certifying
// in-window read-milestone points is milestone arithmetic over THAT counter, so
// the snapshot has to capture THAT counter. The two sources disagree for 42 of
// 205 users on live data (readCount runs low — a set() on readStories/{slug}
// that lands while the readCount transaction does not), and using the child
// count would compute a different milestone schedule for every one of them.
// The dry run reports the divergence count so it stays on the record.
//
// TIMING
//
// The opening capture must happen as close to the contest start as practical.
// A capture taken a day early folds that day's earnings into the contest delta.
// The certified result is not the delta, though — it is the recompute cut at the
// window boundaries (quiz_submissions.submittedAt, comments.createdAt, and
// milestone arithmetic over this snapshot's `reads`). The delta is the live
// board; the recompute is the payout.
//
// Rules note: the service account bypasses RTDB rules entirely, including
// .validate. The validators on leaderboards/{boardId} document the shape and
// guard against a future client write; they do not gate this script.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const argv    = process.argv.slice(2);
const APPLY   = argv.includes('--apply');
const FINAL   = argv.includes('--final');
const FORCE   = argv.includes('--force');
const boardId = argv.find(a => !a.startsWith('--'));

const KIND  = FINAL ? 'final' : 'snapshot';
const STAMP = FINAL ? 'closedAt' : 'startedAt';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

async function main() {
  if (!boardId) {
    fail('Board id required.\n    node scripts/leaderboard-snapshot.mjs <boardId> [--apply] [--final] [--force]');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(boardId)) {
    fail(`Invalid board id "${boardId}" — lowercase letters, digits and hyphens only.`);
  }

  const serviceAccount = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  initializeApp({ credential: cert(serviceAccount), databaseURL: DB_URL });
  const db = getDatabase();

  const boardRef = db.ref(`leaderboards/${boardId}`);

  // Refuse to clobber a capture that already exists. An opening snapshot taken
  // twice would silently re-baseline the contest and zero everyone's progress.
  const existing = await boardRef.child(KIND).get();
  if (existing.exists() && !FORCE) {
    const n = Object.keys(existing.val() || {}).length;
    const when = (await boardRef.child(STAMP).get()).val();
    fail(
      `leaderboards/${boardId}/${KIND} already exists — ${n} entries, ${STAMP} ${when ? new Date(when).toISOString() : 'unset'}.\n` +
      `    Re-capturing would re-baseline the contest. Pass --force only if that is genuinely intended.`
    );
  }

  const [pointsSnap, usersSnap] = await Promise.all([
    db.ref('points').get(),
    db.ref('users').get(),
  ]);
  const points = pointsSnap.val() || {};
  const users  = usersSnap.val()  || {};

  // Universe: every account that exists at capture time. Snapshotting an idle
  // user at 0/0 is numerically identical to omitting them, but it keeps the
  // "absent means 0" rule meaning exactly one thing — an account created after
  // the capture — rather than doubling as "existed but was idle".
  const uids = [...new Set([...Object.keys(users), ...Object.keys(points)])].sort();

  const map = {};
  let totalPoints = 0, totalReads = 0;
  let withPoints = 0, withReads = 0, deleted = 0, diverged = 0;

  for (const uid of uids) {
    const u = users[uid] || {};
    const p = num(points[uid]?.total);
    const r = num(u.readCount);

    map[uid] = { points: p, reads: r };
    totalPoints += p;
    totalReads  += r;
    if (p > 0) withPoints++;
    if (r > 0) withReads++;
    if (u.isDeleted === true) deleted++;

    const shelf = u.readStories && typeof u.readStories === 'object' ? Object.keys(u.readStories).length : 0;
    if (shelf !== r) diverged++;
  }

  const now = Date.now();
  const london = new Date(now).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'medium' });

  console.log(`\n  ${FINAL ? 'CLOSING' : 'OPENING'} CAPTURE — leaderboards/${boardId}/${KIND}`);
  console.log(`  ${'─'.repeat(58)}`);
  console.log(`  uids captured .............. ${uids.length}`);
  console.log(`    with points > 0 .......... ${withPoints}`);
  console.log(`    with reads > 0 ........... ${withReads}`);
  console.log(`    flagged isDeleted ........ ${deleted}   (captured; the board filters at render)`);
  console.log(`  total points captured ...... ${totalPoints.toLocaleString()}`);
  console.log(`  total reads captured ....... ${totalReads.toLocaleString()}`);
  console.log(`  readCount ≠ readStories .... ${diverged}   (pre-existing drift; readCount is authoritative)`);
  console.log(`  ${STAMP} ................ ${now}`);
  console.log(`  London time ................ ${london}`);
  console.log(`  ${'─'.repeat(58)}`);

  const top = Object.entries(map)
    .filter(([, v]) => v.points > 0)
    .sort((a, b) => b[1].points - a[1].points)
    .slice(0, 10);
  console.log(`  Top 10 by points at capture:`);
  for (const [uid, v] of top) {
    console.log(`    ${uid.slice(0, 10)}…  points ${String(v.points).padStart(5)}   reads ${String(v.reads).padStart(4)}`);
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN — nothing was written. Re-run with --apply to capture.\n`);
    process.exit(0);
  }

  await boardRef.update({ [KIND]: map, [STAMP]: now });
  console.log(`\n  ✓ WROTE leaderboards/${boardId}/${KIND} — ${uids.length} entries, ${STAMP} ${now}.\n`);
  process.exit(0);
}

main().catch((e) => fail(e.stack || e.message));
