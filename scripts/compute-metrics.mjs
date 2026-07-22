// One-shot analytics computation from the live DB, using the SAME pure module
// the dashboard uses (app/lib/analyticsMetrics.js) so the numbers match exactly.
//
//   node scripts/compute-metrics.mjs
//
// Read-only. Mints an OAuth token from serviceAccountKey.json (service account
// bypasses rules) and reads the nodes the dashboard reads, then prints
// DAU/WAU/MAU, registered total, activation, cohorts, and honest reads.
// Nothing is written.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';
import {
  extractActivity, computeActives, computeCohorts,
  computeActivation, computeHonestReads,
} from '../app/lib/analyticsMetrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

async function getToken() {
  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  return (await cert(svc).getAccessToken()).access_token;
}

async function readNode(path, token) {
  const res = await fetch(`${DB_URL}/${path}.json?access_token=${token}`);
  if (!res.ok) {
    console.error(`  ! ${path} read failed: HTTP ${res.status}`);
    return null;
  }
  return res.json();
}

function pct(x) { return x == null ? '  — ' : `${Math.round(x * 100)}%`; }

async function main() {
  console.log('Minting service-account token …');
  const token = await getToken();

  console.log('Reading nodes …');
  const [storyReads, users, streaks, submissions, badges, points, comments, squarePosts, openPages, stories] =
    await Promise.all([
      readNode('storyReads', token),
      readNode('users', token),
      readNode('userStreaks', token),
      readNode('quiz_submissions', token),
      readNode('userBadges', token),
      readNode('points', token),
      readNode('comments', token),
      readNode('square_posts', token),
      readNode('open_pages', token),
      readNode('cms_stories', token),
    ]);

  const raw = { storyReads, users, streaks, submissions, badges, points, comments, squarePosts, openPages, stories };
  const now = Date.now();
  const titleFor = (slug) => stories?.[slug]?.title || slug;

  const activity = extractActivity(raw);
  const actives = computeActives(activity.byIdentity, now);
  const cohorts = computeCohorts(raw, activity, now);
  const activation = computeActivation(raw, activity);
  const reads = computeHonestReads(activity, titleFor);

  const registeredTotal = users ? Object.keys(users).length : 0;
  const identities = Object.keys(activity.byIdentity).length;
  const userIds = users ? new Set(Object.keys(users)) : new Set();
  const anonIdentities = Object.keys(activity.byIdentity).filter(id => !userIds.has(id)).length;

  console.log('\n══════════════════ HONEST ANALYTICS (live) ══════════════════');
  console.log(`  Computed at        : ${new Date(now).toISOString()}`);
  console.log(`  Registered users   : ${registeredTotal}`);
  console.log(`  Distinct identities: ${identities}  (signed-in ${identities - anonIdentities} + anon ${anonIdentities})`);
  console.log('  ── Active (rolling) ──');
  console.log(`  DAU (today so far) : ${actives.dau}`);
  console.log(`  DAU avg (last 7d)  : ${actives.avg7}`);
  console.log(`  WAU (last 7 days)  : ${actives.wau}`);
  console.log(`  MAU (last 30 days) : ${actives.mau}`);
  console.log(`  DAU line (30d)     : [${actives.line.join(',')}]`);
  if (activation) {
    console.log('  ── Activation ──');
    console.log(`  Signup→first read  : ${pct(activation.rate)}  (${activation.activated}/${activation.eligible} cohortable users; median ${activation.medianDays ?? '—'}d to first read)`);
  }
  console.log('  ── Registered cohorts (W1..W4) ──');
  for (const c of cohorts.registered) {
    console.log(`  ${c.label}  n=${String(c.size).padStart(4)}  W1 ${pct(c.w1)}  W2 ${pct(c.w2)}  W3 ${pct(c.w3)}  W4 ${pct(c.w4)}`);
  }
  console.log('  ── Anonymous cohorts (W1..W4) ──');
  for (const c of cohorts.anonymous) {
    console.log(`  ${c.label}  n=${String(c.size).padStart(4)}  W1 ${pct(c.w1)}  W2 ${pct(c.w2)}  W3 ${pct(c.w3)}  W4 ${pct(c.w4)}`);
  }
  console.log('  ── Honest unique reads per story (top 10) ──');
  console.log(`  Ledger total reads : ${reads.total} across ${reads.storyCount} stories`);
  for (const r of reads.rows) {
    console.log(`  ${String(r.readers).padStart(5)}  ${r.title}`);
  }
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
