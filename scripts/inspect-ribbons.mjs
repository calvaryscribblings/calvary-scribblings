// READ-ONLY diagnostic: what shape are the live ribbon records?
//
//   node scripts/inspect-ribbons.mjs [uid]
//
// Reads readerBookmarks/{uid} with the admin REST endpoint (same service-account token
// path as scripts/rules-pull.mjs) and reports FIELD PRESENCE per record. It deliberately
// prints lengths and booleans, never excerpt text — the question is whether a record
// carries a cfi, not what the reader was reading.
//
// Writes nothing. Ever.
import { mintToken } from './rules-pull.mjs';

const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const FOUNDER_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';

const uid = process.argv[2] || FOUNDER_UID;

const token = await mintToken();
const res = await fetch(`${DB_URL}/readerBookmarks/${uid}.json?access_token=${token}`);
if (!res.ok) throw new Error(`read failed: HTTP ${res.status} — ${await res.text()}`);
const data = await res.json();

if (!data) {
  console.log(`readerBookmarks/${uid}: EMPTY — no ribbons stored for this reader.`);
  process.exit(0);
}

const rows = [];
for (const [slug, records] of Object.entries(data)) {
  for (const [pushId, r] of Object.entries(records || {})) {
    const rec = r || {};
    rows.push({
      slug,
      pushId,
      keys: Object.keys(rec).sort().join(','),
      cfi: typeof rec.cfi === 'string' && rec.cfi.length > 0 ? rec.cfi.length : (rec.cfi === undefined ? 'ABSENT' : `EMPTY(${typeof rec.cfi})`),
      cfiHead: typeof rec.cfi === 'string' ? rec.cfi.slice(0, 22) : '—',
      fraction: typeof rec.fraction === 'number' ? rec.fraction.toFixed(5) : (rec.fraction === undefined ? 'ABSENT' : `BAD(${typeof rec.fraction})`),
      excerpt: typeof rec.excerpt === 'string' ? (rec.excerpt.length || 'EMPTY_STR') : (rec.excerpt === undefined ? 'ABSENT' : `BAD(${typeof rec.excerpt})`),
      label: rec.label === undefined ? 'ABSENT' : (rec.label === null ? 'null' : `len ${String(rec.label).length}`),
      createdAt: typeof rec.createdAt === 'number' ? new Date(rec.createdAt).toISOString().slice(0, 16).replace('T', ' ') : 'ABSENT',
    });
  }
}

rows.sort((a, b) => (a.slug === b.slug ? a.createdAt.localeCompare(b.createdAt) : a.slug.localeCompare(b.slug)));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nreaderBookmarks/${uid} — ${rows.length} record(s) across ${Object.keys(data).length} slug(s)\n`);
console.log(pad('slug', 30), pad('cfi len', 9), pad('cfi head', 24), pad('fraction', 10), pad('excerpt', 9), pad('label', 10), pad('createdAt', 17), 'keys');
console.log('-'.repeat(150));
for (const r of rows) {
  console.log(
    pad(r.slug.slice(0, 29), 30), pad(r.cfi, 9), pad(r.cfiHead, 24),
    pad(r.fraction, 10), pad(r.excerpt, 9), pad(r.label, 10), pad(r.createdAt, 17), r.keys,
  );
}

const missingCfi = rows.filter((r) => r.cfi === 'ABSENT' || String(r.cfi).startsWith('EMPTY'));
const missingFraction = rows.filter((r) => r.fraction === 'ABSENT');
const unjumpable = rows.filter((r) => (r.cfi === 'ABSENT' || String(r.cfi).startsWith('EMPTY')) && r.fraction === 'ABSENT');
console.log(`\nVERDICT`);
console.log(`  records without a usable cfi : ${missingCfi.length} / ${rows.length}`);
console.log(`  records without a fraction   : ${missingFraction.length} / ${rows.length}`);
console.log(`  records with NEITHER         : ${unjumpable.length} / ${rows.length}  ← genuinely unjumpable\n`);
