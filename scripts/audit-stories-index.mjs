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

// authorHandle / readTime — the two fields the app's search, profile myStories and
// user author-list surfaces read off the index alone. The field-by-field diff above
// already flags value drift; these lines make COVERAGE visible, which is the failure
// that matters here. An index record predating the widening simply has no key at all
// (so the app renders a blank handle / no "N min read"), and that reads as "absent"
// rather than "wrong". authorHandle absence is only a fault where the SOURCE has one
// — 7 legacy/guest-authored stories genuinely carry none. readTime must be present
// on EVERY record: the projection always emits it (0 for contentless stories, which
// is a real value, not a gap), so a missing key means a stale record.
const handleInSrc = eligible.filter(s => src[s].authorHandle);
const handleMissingIdx = handleInSrc.filter(s => idx[s] && !idx[s].authorHandle);
const noHandleSrc = eligible.filter(s => !src[s].authorHandle);
console.log(`\nauthorHandle — present in SOURCE: ${handleInSrc.length}/${eligible.length} (${noHandleSrc.length} source-side blank${noHandleSrc.length ? ': ' + noHandleSrc.join(', ') : ''})`);
if (handleMissingIdx.length) console.log(`  ⚠ SOURCE HAS A HANDLE, INDEX DOES NOT: ${handleMissingIdx.length} → ${handleMissingIdx.join(', ')}`);
else console.log(`  ✓ every source handle is mirrored in the index`);

const readTimeMissingIdx = eligible.filter(s => idx[s] && !('readTime' in idx[s]));
const readTimeWrong = eligible.filter(s => idx[s] && 'readTime' in idx[s] && idx[s].readTime !== buildIndexRecord(s, src[s]).readTime);
const noContent = eligible.filter(s => !src[s].content);
console.log(`readTime — present in INDEX: ${eligible.filter(s => idx[s] && 'readTime' in idx[s]).length}/${eligible.length} (${noContent.length} contentless → readTime 0${noContent.length ? ': ' + noContent.join(', ') : ''})`);
if (readTimeMissingIdx.length) console.log(`  ⚠ KEY ABSENT (stale pre-widening record): ${readTimeMissingIdx.length} → ${readTimeMissingIdx.join(', ')}`);
if (readTimeWrong.length) console.log(`  ⚠ VALUE DRIFT vs recomputed: ${readTimeWrong.length} → ${readTimeWrong.join(', ')}`);
if (!readTimeMissingIdx.length && !readTimeWrong.length) console.log(`  ✓ every index record carries a readTime matching the projection`);

// SCHEDULED-PUBLISH INTEGRITY — the specific failure mode of the external
// calvary-newsletter cron flipping a scheduled story to published:true when its
// publishAt arrives WITHOUT writing the index entry (a bare published deep-path
// write). Such a story is eligible but absent-or-partial in the index, so it goes
// live invisible on every index-fed surface. The generic orphan check above catches
// the absent case; this section names it explicitly and also flags PARTIAL index
// records (present but missing the load-bearing scalars buildIndexRecord emits), so
// a cron regression is obvious rather than buried. See app/lib/storyIndex.js note 3.
const now = Date.now();
const scheduled = Object.keys(src).filter(s => src[s] && src[s].publishAt);
const due = scheduled.filter(s => new Date(src[s].publishAt).getTime() <= now);
const future = scheduled.filter(s => new Date(src[s].publishAt).getTime() > now);
// A "due, published" story MUST have a complete index record. Report anything that
// is live (published !== false, publishAt passed) yet absent or partial in the index.
const dueLive = due.filter(s => src[s].published !== false);
const dueBad = dueLive.filter(s => {
  const rec = idx[s];
  if (!rec) return true; // absent — the classic bare-flip symptom
  const want = buildIndexRecord(s, src[s]);
  // partial: any field the projection emits is missing from the stored record
  return Object.keys(want).some(k => !(k in rec)) || !rec.authorUid || !rec.title;
});
console.log(`\nSCHEDULED-PUBLISH INTEGRITY`);
console.log(`  stories carrying publishAt: ${scheduled.length} (${due.length} due / ${future.length} future)`);
console.log(`  due & live (published, publishAt passed): ${dueLive.length}`);
if (dueBad.length) {
  console.log(`  ⚠ DUE+LIVE BUT ABSENT/PARTIAL IN INDEX: ${dueBad.length} → ${dueBad.join(', ')}`);
  console.log(`    → the scheduled-publish cron flipped published without a full index write. Run scripts/backfill-stories-index.mjs.`);
} else {
  console.log(`  ✓ every due, live scheduled story has a complete index record`);
}
// Future-scheduled stories are correctly held out of the index (published:false); flag any that leaked in.
const futureLeaked = future.filter(s => idx[s]);
if (futureLeaked.length) console.log(`  ⚠ FUTURE-SCHEDULED but present in index (should be held out until publishAt): ${futureLeaked.join(', ')}`);
