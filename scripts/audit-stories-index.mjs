// Field-level drift audit: every published cms_stories record vs its cms_stories_index
// projection. Read-only. Compares EVERY field buildIndexRecord emits, and also reports
// index keys the projection would not produce (stale shape) and orphans in both directions.
import { buildIndexRecord, isIndexed, INDEX_PATH } from '../app/lib/storyIndex.js';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const [srcRes, idxRes] = await Promise.all([
  fetch(`${DB}/cms_stories.json`),
  fetch(`${DB}/${INDEX_PATH}.json`),
]);
if (!srcRes.ok || !idxRes.ok) { console.error('read failed', srcRes.status, idxRes.status); process.exit(1); }
const src = await srcRes.json();
const idx = (await idxRes.json()) || {};

const eligible = Object.keys(src).filter(s => isIndexed(src[s]));
const hidden = Object.keys(src).filter(s => !isIndexed(src[s]));

console.log(`cms_stories: ${Object.keys(src).length} total, ${eligible.length} eligible, ${hidden.length} hidden`);
console.log(`${INDEX_PATH}: ${Object.keys(idx).length} records\n`);

const missingFromIndex = eligible.filter(s => !idx[s]);
const orphanInIndex = Object.keys(idx).filter(s => !src[s] || !isIndexed(src[s]));
if (missingFromIndex.length) console.log('ELIGIBLE BUT ABSENT FROM INDEX:', missingFromIndex.join(', '));
if (orphanInIndex.length) console.log('IN INDEX BUT NOT ELIGIBLE:', orphanInIndex.join(', '));

const driftByField = {};
const rows = [];
for (const slug of eligible) {
  const want = buildIndexRecord(slug, src[slug]);
  const got = idx[slug];
  if (!got) continue;
  const diffs = [];
  for (const k of Object.keys(want)) {
    const a = JSON.stringify(want[k]), b = JSON.stringify(got[k]);
    if (a !== b) { diffs.push({ k, want: want[k], got: got[k] }); driftByField[k] = (driftByField[k] || 0) + 1; }
  }
  // keys present in the index that the projection no longer emits
  for (const k of Object.keys(got)) {
    if (!(k in want)) { diffs.push({ k, want: '<absent>', got: got[k] }); driftByField[`+${k}`] = (driftByField[`+${k}`] || 0) + 1; }
  }
  if (diffs.length) rows.push({ slug, diffs });
}

console.log(`\nRECORDS WITH DRIFT: ${rows.length} / ${eligible.length}`);
for (const r of rows) {
  console.log(`\n  ${r.slug}`);
  for (const d of r.diffs) console.log(`    ${d.k}: index=${JSON.stringify(d.got)}  source=${JSON.stringify(d.want)}`);
}
console.log('\nDRIFT BY FIELD:', Object.keys(driftByField).length ? driftByField : '(none)');

// authorUid specifically — the reported symptom
const noUidSrc = eligible.filter(s => !src[s].authorUid);
const noUidIdx = eligible.filter(s => idx[s] && !idx[s].authorUid);
console.log(`\nauthorUid — missing/empty in SOURCE: ${noUidSrc.length}${noUidSrc.length ? ' → ' + noUidSrc.join(', ') : ''}`);
console.log(`authorUid — missing/empty in INDEX : ${noUidIdx.length}${noUidIdx.length ? ' → ' + noUidIdx.join(', ') : ''}`);
