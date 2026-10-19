#!/usr/bin/env node
// W55.2, ruling 224 — THE 24-HOUR CLEAR-OUT for images in messages.
//
//   npm run storage:lifecycle            dry run: prints the bucket's rules now and what would be set
//   npm run storage:lifecycle -- --apply sets storage/lifecycle.json on the bucket
//
// The rule (storage/lifecycle.json): Delete, once an object is a day old, ONLY under dm_images/.
// A reported image is held under dm_reported/ (functions/api/square/report-image.js), which the
// prefix does not match; nothing else in the bucket is touched.
//
// Setting a bucket's lifecycle REPLACES its whole rule list. So --apply refuses when the bucket
// holds any rule that is not in storage/lifecycle.json: someone added one by hand, and this would
// silently delete it. Merge it into the file first.
//
// Notes for whoever reads the result:
//   · Cloud Storage acts on lifecycle rules asynchronously — an image goes some time after its
//     24 hours, not at them; the conversation stops drawing it at the mark (imageExpired).
//   · The bucket keeps soft-deleted objects 30 days (W5). A cleared image is soft-deleted, and is
//     billed for those 30 days like any other delete.
//
// Credentials: serviceAccountKey.json (or LIFECYCLE_SERVICE_ACCOUNT). Needs storage.buckets.get and
// storage.buckets.update. Prints rules and counts only.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BUCKET = 'calvary-scribblings.firebasestorage.app';
export const WANTED = JSON.parse(readFileSync(new URL('../../storage/lifecycle.json', import.meta.url), 'utf8')).lifecycle.rule;

const key = (r) => JSON.stringify({ action: r.action, condition: Object.fromEntries(Object.entries(r.condition || {}).sort()) });

/** The bucket's rules that the file does not carry. --apply refuses while any exist. */
export function foreignRules(current = []) {
  const ours = new Set(WANTED.map(key));
  return current.filter((r) => !ours.has(key(r)));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { Storage } = require('@google-cloud/storage');
  const keyFilename = process.env.LIFECYCLE_SERVICE_ACCOUNT || `${ROOT}serviceAccountKey.json`;
  const bucket = new Storage({ keyFilename }).bucket(BUCKET);
  const [meta] = await bucket.getMetadata();
  const current = meta.lifecycle?.rule || [];
  console.log(`bucket rules now: ${current.length ? JSON.stringify(current) : 'none'}`);
  console.log(`rules to set:     ${JSON.stringify(WANTED)}`);
  const foreign = foreignRules(current);
  if (foreign.length) {
    console.error(`REFUSING: the bucket has ${foreign.length} rule(s) storage/lifecycle.json does not carry. Setting would delete them. Merge them into the file first.`);
    process.exit(2);
  }
  if (current.length === WANTED.length && foreign.length === 0) { console.log('already set — nothing to do'); return; }
  if (!apply) { console.log('dry run — pass --apply to set'); return; }
  await bucket.setMetadata({ lifecycle: { rule: WANTED } });
  const [after] = await bucket.getMetadata();
  console.log(`bucket rules after: ${JSON.stringify(after.lifecycle?.rule || [])}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`lifecycle: ${e?.code || e?.message || 'error'}`); process.exit(1); });
}
