// Fast-3G content-ready benchmark for /public-library, Phase A.
//
//   node scripts/bench-library-fast3g.mjs
//
// What it measures: the WHOLESALE Firebase read that gates the story list.
// /public-library renders skeletons until its onValue snapshot arrives and
// setAllStories() fires; everything downstream (JS parse, hydrate, card render,
// the small parallel author-name reads) is byte-for-byte identical before and
// after Phase A. So the change in content-ready IS the change in this payload's
// transfer time. Before = cms_stories (full node); after = cms_stories_index.
//
// Throttle model: Chrome DevTools "Fast 3G" preset, exact constants —
//   download 1.6 Mbit/s * 0.9 / 8 = 188,743 B/s ; added latency 562.5 ms (RTT).
// Content-ready(read) ≈ one RTT to first byte + payload / throughput. This
// undercounts nothing Phase A touched; it deliberately ignores the constant
// terms (bundle, hydrate) that are unchanged, so the delta is apples-to-apples.

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const THROUGHPUT = 1.6 * 1024 * 1024 * 0.9 / 8; // 188,743 B/s
const RTT = 0.5625; // 562.5 ms

async function measure(label, path) {
  // Actual bytes over the wire (gzip is not applied by the RTDB REST endpoint by
  // default; we measure the decoded size the client must receive+parse, which is
  // what the JS SDK transfers).
  const res = await fetch(`${DB}/${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const bytes = buf.length;
  const records = Object.keys(JSON.parse(buf.toString('utf8')) || {}).length;
  const transfer = bytes / THROUGHPUT;
  const contentReady = RTT + transfer;
  return { label, path, bytes, records, transfer, contentReady };
}

function fmtKB(b) { return (b / 1024).toFixed(1) + ' KB'; }
function fmtS(s) { return s.toFixed(2) + ' s'; }

const before = await measure('BEFORE  (cms_stories, full node)', 'cms_stories.json');
const after = await measure('AFTER   (cms_stories_index, slim)', 'cms_stories_index.json');

console.log('\nFast-3G content-ready — /public-library gating read');
console.log('  model: DevTools Fast 3G — 188.7 KB/s down, 562.5 ms RTT\n');
for (const r of [before, after]) {
  console.log(`  ${r.label}`);
  console.log(`    payload      : ${fmtKB(r.bytes)}  (${r.records} records)`);
  console.log(`    transfer     : ${fmtS(r.transfer)}`);
  console.log(`    content-ready: ${fmtS(r.contentReady)}   (RTT + transfer)\n`);
}
const dropB = (1 - after.bytes / before.bytes) * 100;
const dropT = (1 - after.contentReady / before.contentReady) * 100;
console.log(`  RESULT: ${fmtKB(before.bytes)} → ${fmtKB(after.bytes)}  (−${dropB.toFixed(1)}% bytes)`);
console.log(`          ${fmtS(before.contentReady)} → ${fmtS(after.contentReady)}  (−${dropT.toFixed(1)}% content-ready)`);
console.log(`          ${(before.contentReady - after.contentReady).toFixed(2)} s shaved off the gating read under Fast 3G.\n`);
