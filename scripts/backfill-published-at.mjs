// Backfill cms_stories/<slug>/publishedAtMs from the live node.
//
// DRY RUN BY DEFAULT. Writes ONLY with --apply.
//
//   node scripts/backfill-published-at.mjs            # plan + distribution, no writes
//   node scripts/backfill-published-at.mjs --apply    # perform the write
//   node scripts/backfill-published-at.mjs --window=30 # bucket the report at 30 days
//
// P1 of the story-gating work. See STORY-SERVING-CONTRACT.md §2.
//
// WHAT IT WRITES: one number per story, at cms_stories/<slug>/publishedAtMs, derived
// by app/lib/storyAccess.js:publishedAtMsFor — the SAME function the composer calls on
// every save and the serving endpoint reads. There is no second copy of the
// derivation, which is the whole point of that module.
//
// WHAT IT DOES NOT WRITE:
//   - Nothing else on the record. This is a per-field multi-path PATCH, never a node
//     overwrite. The composer already learned that lesson the expensive way (16
//     quizzes lost their quizMeta to a wholesale write — see app/admin/page.js).
//   - Nothing on cms_stories_index. The index projection gains publishedAtMs in a
//     later phase, in lockstep with the external calvary-newsletter Worker's mirror;
//     adding it here alone would leave scheduled-publish writing records without it.
//   - Nothing for a story whose date cannot be parsed. Those are REPORTED BY NAME and
//     skipped. Stamping a guess is how an archive story ends up inside the free
//     window, and null is a record that wants a human.
//
// IDEMPOTENT. Re-running writes the same numbers. A story whose stored value already
// matches is counted as up-to-date and left out of the patch.
//
// Uses the RTDB REST API — read is a public GET (cms_stories is world-readable), write
// is a PATCH with an OAuth token minted from serviceAccountKey.json at the repo root.
// Same shape as scripts/backfill-stories-index.mjs, for the same reason: the
// firebase-admin websocket is not reachable from every runner, REST always is.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';
import { publishedAtMsFor } from '../app/lib/storyAccess.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');

// Candidate windows the report buckets against. The live window is a server constant
// in the serving endpoint and is NOT set here — this script exists partly to let that
// number be chosen against real dates rather than guessed.
const WINDOW_ARG = process.argv.find(a => a.startsWith('--window='));
const WINDOWS = WINDOW_ARG
  ? [Number(WINDOW_ARG.split('=')[1])].filter(Number.isFinite)
  : [7, 14, 30, 60, 90, 180];

const DAY = 86400000;

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

async function main() {
  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));

  const res = await fetch(`${DB_URL}/cms_stories.json`);
  if (!res.ok) {
    console.error(`cms_stories read failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const all = await res.json();
  if (!all || typeof all !== 'object') {
    console.error('cms_stories is empty — nothing to backfill.');
    process.exit(1);
  }

  const now = Date.now();
  const patch = {};
  const rows = [];
  const unparseable = [];
  let unchanged = 0;

  for (const slug of Object.keys(all)) {
    const story = all[slug] || {};
    const ms = publishedAtMsFor(story);

    if (ms === null) {
      unparseable.push({ slug, date: story.date, published: story.published !== false });
      continue;
    }

    rows.push({
      slug,
      ms,
      date: story.date,
      fromPublishAt: typeof story.publishAt === 'string' && Number.isFinite(Date.parse(story.publishAt)),
      dayless: /^[A-Za-z]{3,9}\s+\d{4}$/.test(String(story.date || '').trim()),
      published: story.published !== false,
      readerMode: story.readerMode === true || story.bookReader === true
        || story.category === 'novel' || (story.category === 'poetry' && !!story.epubUrl),
    });

    if (story.publishedAtMs === ms) { unchanged++; continue; }
    patch[`${slug}/publishedAtMs`] = ms;
  }

  // ── the plan ───────────────────────────────────────────────────────────────
  console.log(`cms_stories: ${Object.keys(all).length} records`);
  console.log(`  derivable        ${rows.length}`);
  console.log(`    from publishAt ${rows.filter(r => r.fromPublishAt).length}`);
  console.log(`    from date      ${rows.filter(r => !r.fromPublishAt && !r.dayless).length}`);
  console.log(`    dayless → 1st  ${rows.filter(r => !r.fromPublishAt && r.dayless).length}`);
  console.log(`  unparseable      ${unparseable.length}`);
  console.log(`  already correct  ${unchanged}`);
  console.log(`  to write         ${Object.keys(patch).length}`);

  if (unparseable.length) {
    console.log('\nUNPARSEABLE — skipped, not guessed. These need a human:');
    for (const u of unparseable) {
      console.log(`  ${u.published ? 'published' : 'hidden   '}  ${JSON.stringify(u.date)}  ${u.slug}`);
    }
  }

  // ── the distribution: where the window's edge falls against real dates ─────
  const live = rows.filter(r => r.published && !r.readerMode).sort((a, b) => b.ms - a.ms);
  const readerLive = rows.filter(r => r.published && r.readerMode);

  console.log(`\n── DISTRIBUTION ─────────────────────────────────────────────`);
  console.log(`today ${iso(now)}   published prose stories: ${live.length}`
    + `   (+${readerLive.length} reader-mode, gated elsewhere — contract §4.4)`);
  if (live.length) {
    console.log(`newest ${iso(live[0].ms)}   oldest ${iso(live[live.length - 1].ms)}`);
  }

  // Per month, so the shape of the archive is visible rather than just the totals.
  const byMonth = new Map();
  for (const r of live) {
    const k = new Date(r.ms).toISOString().slice(0, 7);
    byMonth.set(k, (byMonth.get(k) || 0) + 1);
  }
  console.log('\nby month (published prose):');
  for (const [k, n] of [...byMonth.entries()].sort()) {
    console.log(`  ${k}  ${String(n).padStart(3)}  ${'█'.repeat(n)}`);
  }

  console.log('\nif the free window were N days, as of today:');
  console.log('   N     free   gated    edge falls on');
  for (const w of WINDOWS) {
    const edge = now - w * DAY;
    const free = live.filter(r => r.ms >= edge).length;
    console.log(`  ${String(w).padStart(3)}  ${String(free).padStart(6)}  ${String(live.length - free).padStart(6)}    ${iso(edge)}`);
  }

  // The stories nearest the boundary are the ones whose day-precision actually
  // decides anything — printed so the dayless rule can be sanity-checked against
  // real records rather than trusted.
  console.log('\nnearest the edge (10 most recent published prose stories):');
  for (const r of live.slice(0, 10)) {
    const age = Math.floor((now - r.ms) / DAY);
    console.log(`  ${iso(r.ms)}  ${String(age).padStart(3)}d ago  ${r.fromPublishAt ? 'publishAt' : 'date     '}  ${r.slug}`);
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write ${Object.keys(patch).length} field(s).`);
    return;
  }

  if (!Object.keys(patch).length) {
    console.log('\nNothing to write.');
    return;
  }

  const token = (await cert(svc).getAccessToken()).access_token;

  // ONE PATCH on cms_stories, keyed by "<slug>/publishedAtMs". RTDB treats a PATCH
  // key containing a slash as a deep path, so this touches exactly one child per
  // story and nothing else on the node.
  const writeRes = await fetch(`${DB_URL}/cms_stories.json`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!writeRes.ok) {
    console.error(`PATCH failed: HTTP ${writeRes.status} ${(await writeRes.text()).slice(0, 400)}`);
    process.exit(1);
  }
  console.log(`\n✓ wrote publishedAtMs on ${Object.keys(patch).length} record(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
