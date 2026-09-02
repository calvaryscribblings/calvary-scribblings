// Backfill cms_stories_index from the live cms_stories node.
//
// DRY RUN BY DEFAULT. Writes ONLY when invoked with --apply.
//
//   node scripts/backfill-stories-index.mjs            # plan only, no writes
//   node scripts/backfill-stories-index.mjs --apply    # perform the write
//
// What it does:
//   - Reads the whole cms_stories node once.
//   - Keeps the index-ELIGIBLE rows (published !== false; hidden rows are
//     excluded, exactly as the runtime dual-write drops them).
//   - Projects each eligible row through app/lib/storyIndex.js:buildIndexRecord
//     — the SAME projection the admin dual-write uses, so backfill and live
//     writes can never diverge.
//   - --apply: writes the whole index in one set() on cms_stories_index, so the
//     node ends up mirroring exactly the eligible set (any stale entry a prior
//     run left is dropped). The dual-write keeps it in lockstep from then on.
//
// Requires serviceAccountKey.json at the repo root (same as the other scripts/).
// The index rules must already be published (public read, admin write,
// .indexOn ["authorUid","author"]) — a PERMISSION_DENIED on --apply means the
// console block is not live yet, not that this script is wrong.
//
// Uses the RTDB REST API (read = public GET, write = PUT with an OAuth token
// minted from the service account) rather than firebase-admin's realtime
// websocket — the websocket is not reachable from every runner, REST always is.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert } from 'firebase-admin/app';
import { buildIndexRecord, isIndexed, INDEX_PATH } from '../app/lib/storyIndex.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const APPLY = process.argv.includes('--apply');

function bytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

async function main() {
  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));

  // Read the whole node over REST (cms_stories is world-readable).
  const readRes = await fetch(`${DB_URL}/cms_stories.json`);
  if (!readRes.ok) {
    console.error(`cms_stories read failed: HTTP ${readRes.status}`);
    process.exit(1);
  }
  const all = await readRes.json();
  if (!all || typeof all !== 'object') {
    console.error('cms_stories is empty — nothing to backfill.');
    process.exit(1);
  }
  const slugs = Object.keys(all);

  const index = {};
  const skipped = [];
  for (const slug of slugs) {
    const story = all[slug];
    if (!isIndexed(story)) { skipped.push(slug); continue; }
    index[slug] = buildIndexRecord(slug, story);
  }
  const kept = Object.keys(index);

  const fullBytes = bytes(all);
  const indexBytes = bytes(index);
  console.log('cms_stories → cms_stories_index backfill plan');
  console.log('  total records      :', slugs.length);
  console.log('  eligible (indexed) :', kept.length);
  console.log('  hidden (skipped)   :', skipped.length, skipped.length ? `→ ${skipped.join(', ')}` : '');
  console.log('  full node size     :', (fullBytes / 1024).toFixed(1), 'KB');
  console.log('  index size         :', (indexBytes / 1024).toFixed(1), 'KB',
    `(${(fullBytes / indexBytes).toFixed(1)}× smaller, ~${Math.round(indexBytes / kept.length)} B/record)`);

  // Show three sample projections so the field set is eyeballable before writing.
  console.log('\n  sample records:');
  for (const slug of kept.slice(0, 3)) {
    console.log('   ', slug, '→', JSON.stringify(index[slug]));
  }

  if (!APPLY) {
    console.log('\nDRY RUN — no writes. Re-run with --apply to write cms_stories_index.');
    return;
  }

  // PUT the whole index in one shot so the node ends up mirroring exactly the
  // eligible set (a prior run's stale entries are dropped). Auth via an OAuth
  // token minted from the service account.
  const token = (await cert(svc).getAccessToken()).access_token;
  console.log(`\nWriting ${kept.length} records to ${INDEX_PATH} …`);
  const putRes = await fetch(`${DB_URL}/${INDEX_PATH}.json?access_token=${token}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(index),
  });
  if (!putRes.ok) {
    console.error(`WRITE FAILED: HTTP ${putRes.status} — ${await putRes.text()}`);
    console.error('A 401/403 here means the index rules are not published yet.');
    process.exit(1);
  }
  console.log('Done. Reading back 3 for verification:');
  for (const slug of kept.slice(0, 3)) {
    const rb = await fetch(`${DB_URL}/${INDEX_PATH}/${slug}.json`);
    const val = rb.ok ? await rb.json() : null;
    console.log('   ', slug, '→', val ? 'ok' : 'MISSING');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
