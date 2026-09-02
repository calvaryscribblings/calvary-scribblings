// Cover image payload benchmark, Phase B.
//
//   node scripts/bench-cover-payload.mjs
//
// Measures the bytes a visitor pulls for story covers, before vs after the
// derivative pipeline. "Before" = the original cover each card used to load at
// full resolution with cache-control: private, max-age=0 (re-fetched every
// visit). "After" = the w360 WebP rung a phone actually pulls, cache-control:
// public, max-age=31536000, immutable (fetched once, then served from cache).
//
// Uses HEAD requests (content-length) — no image bytes are downloaded. Reports a
// first-load estimate (the ~18 cards a fresh /public-library paints before the
// fold + first lazy rows) and the full published set, plus the repeat-visit
// story that the cache headers now tell.

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const FIRST_LOAD = 18;
const FAST_3G_BPS = 1.6 * 1024 * 1024;
const s3g = (b) => `${((b * 8) / FAST_3G_BPS).toFixed(1)}s`;
const mb = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
const kb = (b) => `${(b / 1024).toFixed(0)} KB`;

async function len(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok ? Number(r.headers.get('content-length') || 0) : 0;
  } catch { return 0; }
}
async function cacheOf(url) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.headers.get('cache-control') || '(none)'; }
  catch { return '(error)'; }
}

const idx = await (await fetch(`${DB}/cms_stories_index.json`)).json();
// Newest-first, mirroring the library's default sort, so "first load" is realistic.
const rows = Object.entries(idx)
  .filter(([, r]) => r.cover && r.coverSizes?.w360)
  .map(([slug, r]) => ({ slug, cover: r.cover, w360: r.coverSizes.w360, w720: r.coverSizes.w720, t: Date.parse(r.date) || 0 }))
  .sort((a, b) => b.t - a.t);

console.log(`\nCover payload — ${rows.length} covers with derivatives\n`);

let firstOrig = 0, firstW360 = 0, allOrig = 0, allW360 = 0;
for (let i = 0; i < rows.length; i++) {
  const [o, d] = await Promise.all([len(rows[i].cover), len(rows[i].w360)]);
  allOrig += o; allW360 += d;
  if (i < FIRST_LOAD) { firstOrig += o; firstW360 += d; }
}

console.log(`FIRST LOAD (${FIRST_LOAD} cards)`);
console.log(`  before (originals) : ${mb(firstOrig)}   Fast 3G ${s3g(firstOrig)}`);
console.log(`  after  (w360 WebP) : ${kb(firstW360)}   Fast 3G ${s3g(firstW360)}`);
console.log(`  → −${((1 - firstW360 / firstOrig) * 100).toFixed(1)}% image bytes\n`);

console.log(`FULL PUBLISHED SET (${rows.length} covers)`);
console.log(`  before (originals) : ${mb(allOrig)}   Fast 3G ${s3g(allOrig)}`);
console.log(`  after  (w360 WebP) : ${mb(allW360)}   Fast 3G ${s3g(allW360)}`);
console.log(`  → −${((1 - allW360 / allOrig) * 100).toFixed(1)}% image bytes\n`);

const sample = rows[0];
console.log('REPEAT VISIT (cache-control on a sample cover)');
console.log(`  original  : ${await cacheOf(sample.cover)}`);
console.log(`  w360 WebP : ${await cacheOf(sample.w360)}`);
console.log('  → originals were private, max-age=0 (re-fetched every visit). Now immutable:');
console.log('    a revisit inside a year pulls 0 cover bytes from the network.\n');
