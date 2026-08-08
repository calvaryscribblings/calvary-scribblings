// T3's number: what share of story opens comes from a client that has migrated?
//
//   node scripts/adoption-report.mjs            # last 14 days
//   node scripts/adoption-report.mjs --days=30
//
// READ-ONLY. Writes nothing, changes nothing.
//
// See STORY-SERVING-CONTRACT.md §7 (T2/T3) and functions/api/_telemetry.js.
//
// ── HOW TO READ THIS ─────────────────────────────────────────────────────────
//
// The counters live at story_clients/<YYYY-MM-DD>/<surface>/<bucket>, written by
// two endpoints:
//
//   hit    — /api/hit. THE DENOMINATOR. Every client version fires it on a story
//            open, including binaries that predate all of this and send no body.
//   story  — /api/story. Migrated traffic only, by definition: a stale client never
//            calls it.
//
// So the number that matters is on the `hit` row:
//
//     unknown share of /api/hit  =  the un-migrated fleet
//
// It is the only view we have of clients that cannot be asked anything, and it is
// the reason /api/hit was instrumented at all. Counting /api/story alone would have
// produced a number that rises forever while still describing 5% of readers.
//
// ── WHAT WOULD MAKE THIS LIE ─────────────────────────────────────────────────
//
// Web traffic landing in `unknown`. The web clients send `client: 'web'` for exactly
// this reason (app/stories/[slug]/page-client.js, app/reader/[slug]/page-reader.js).
// If `unknown` ever spikes at the same moment as a web deploy, suspect that before
// concluding the fleet regressed.
//
// A second caveat, stated rather than buried: /api/hit is fired behind an ENGAGEMENT
// GATE on web (not on mount) and unconditionally by old app binaries. The two are
// therefore not perfectly comparable per-open. The ratio is a fleet-composition
// signal, not a precise per-read census, and T3 wants an order of magnitude — "is
// the old path still 40% or is it 2%" — which it answers honestly.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const daysArg = process.argv.find((a) => a.startsWith('--days='));
const DAYS = daysArg ? Math.max(1, Number(daysArg.split('=')[1]) || 14) : 14;

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const bar = (n, d, w = 28) => '█'.repeat(d ? Math.round((w * n) / d) : 0);

async function main() {
  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  const token = (await cert(svc).getAccessToken()).access_token;

  const res = await fetch(`${DB_URL}/story_clients.json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`story_clients read failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const all = (await res.json()) || {};

  const days = Object.keys(all).sort().slice(-DAYS);
  if (!days.length) {
    console.log('No counters yet. story_clients is empty.');
    console.log('That is expected until /api/hit and /api/story have served traffic');
    console.log('with the T2 instrumentation deployed.');
    return;
  }

  // ── per-day headline ───────────────────────────────────────────────────────
  console.log(`story_clients — last ${days.length} day(s) with data\n`);
  console.log('date          hits   attributed   unknown   migrated share');
  let totHit = 0;
  let totUnknown = 0;
  const buckets = new Map();

  for (const day of days) {
    const hit = all[day]?.hit || {};
    const unknown = Number(hit.unknown || 0);
    const total = Object.values(hit).reduce((a, b) => a + Number(b || 0), 0);
    const attributed = total - unknown;
    totHit += total;
    totUnknown += unknown;

    for (const [k, v] of Object.entries(hit)) buckets.set(k, (buckets.get(k) || 0) + Number(v || 0));

    console.log(
      `${day}  ${String(total).padStart(6)}  ${String(attributed).padStart(10)}  `
      + `${String(unknown).padStart(8)}   ${pct(attributed, total).padStart(6)}  ${bar(attributed, total, 20)}`,
    );
  }

  console.log('');
  console.log('── THE T3 NUMBER ────────────────────────────────────────────');
  console.log(`  story opens counted     ${totHit}`);
  console.log(`  un-migrated (unknown)   ${totUnknown}   ${pct(totUnknown, totHit)}`);
  console.log(`  MIGRATED                ${totHit - totUnknown}   ${pct(totHit - totUnknown, totHit)}`);
  console.log('');
  console.log('  T3 cuts the body out of cms_stories. Every reader still in the');
  console.log('  unknown bucket sees the TOMBSTONE SENTENCE from that day on —');
  console.log('  which is why it is a sentence and not a deletion (contract §7).');

  // ── who the attributed traffic is ──────────────────────────────────────────
  console.log('\n── BY CLIENT (all days above, /api/hit) ─────────────────────');
  const rows = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, v] of rows) {
    console.log(`  ${String(v).padStart(7)}  ${pct(v, totHit).padStart(6)}  ${k}`);
  }

  // ── cross-check against /api/story ─────────────────────────────────────────
  const storyTotals = new Map();
  let totStory = 0;
  for (const day of days) {
    for (const [k, v] of Object.entries(all[day]?.story || {})) {
      storyTotals.set(k, (storyTotals.get(k) || 0) + Number(v || 0));
      totStory += Number(v || 0);
    }
  }
  console.log('\n── CROSS-CHECK: /api/story (migrated traffic only) ──────────');
  console.log(`  total ${totStory}`);
  for (const [k, v] of [...storyTotals.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(7)}  ${k}`);
  }
  if (totStory && storyTotals.get('unknown')) {
    console.log('\n  ⚠ /api/story has an `unknown` bucket. Every caller of that endpoint');
    console.log('    is new enough to identify itself, so this means a client is omitting');
    console.log('    the telemetry fields — the adoption number is understated until fixed.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
