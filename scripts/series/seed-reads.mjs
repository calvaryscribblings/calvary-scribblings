// W49 §6, RULING 178 — EACH INSTALMENT'S READ COUNT STARTS FROM THE READERS WHO ALREADY HAVE A
// SAVED PLACE IN IT. A one-off production write, approved in the brief.
//
//   node scripts/series/seed-reads.mjs            DRY RUN (the default): per instalment, the readers
//                                                 with a record in series_reading_progress
//   node scripts/series/seed-reads.mjs --apply    run it, once /api/series/read is live
//
// WHAT --apply DOES, per instalment:
//   1. writes a ledger entry series_read_ledger/{inst}/{uid} for each reader with a saved place who
//      has none yet, each a CONDITIONAL PUT (functions/api/_ledger.js claimOnce). An entry the live
//      endpoint wrote first is left alone and not counted twice.
//   2. sets series_reads/{inst} to the ledger's size with an ETag-conditional write. It writes only
//      when the ledger AND the count have both held still across a settle window (default 1.5 s),
//      because the live endpoint claims an entry and THEN increments the count, a few milliseconds
//      apart: a count set inside that gap would be bumped once more and double-count. Holding still
//      means no claim is in flight; the if-match means no increment landed in between. A 412, or
//      anything that moved, reads again.
//
// SEEDED READS CREDIT NOBODY (ruling 179 is "from now on"): this writes the ledger and the count,
// never users/{uid}/readCount, readInstalments, points or streaks. A seeded reader who opens the
// instalment again is told counted:false, so the Series reader credits nothing.
//
// PRINTS COUNTS ONLY. Instalment ids are public; no uid is ever printed.
//
// Proven against the emulator, with live reads racing it: tests/reads/seed.emulator.test.mjs.
import { fileURLToPath } from 'node:url';
import { claimOnce } from '../../functions/api/_ledger.js';
import { readsPath, ledgerPath, readsOf, SERIES_READ_LEDGER } from '../../app/lib/series/reads.js';

const PROD = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** A REST client: `base` is the database URL, `query` extra query (the emulator's ?ns=). */
export function restDb({ base, token, query = '' }) {
  const headers = { Authorization: `Bearer ${token}` };
  const url = (path, extra = '') => {
    const q = [query, extra].filter(Boolean).join('&');
    return `${base}/${path.split('/').map(encodeURIComponent).join('/')}.json${q ? `?${q}` : ''}`;
  };
  return {
    headers,
    url,
    async get(path, extra = '') {
      const res = await fetch(url(path, extra), { headers });
      if (!res.ok) throw new Error(`GET ${res.status}`);
      return res.json();
    },
    async getWithEtag(path) {
      const res = await fetch(url(path), { headers: { ...headers, 'X-Firebase-ETag': 'true' } });
      if (!res.ok) throw new Error(`GET(etag) ${res.status}`);
      return { value: await res.json(), etag: res.headers.get('ETag') || res.headers.get('etag') };
    },
    async putIfMatch(path, value, etag) {
      const res = await fetch(url(path), { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', 'if-match': etag }, body: JSON.stringify(value) });
      if (res.status === 412) return 'stale';
      if (!res.ok) throw new Error(`PUT ${res.status}`);
      return 'ok';
    },
  };
}

/** The plan: { inst: [uid, …] } for every instalment that exists, from series_reading_progress. */
export async function planSeed(db) {
  const [progress, rows] = await Promise.all([db.get('series_reading_progress'), db.get('series_instalments', 'shallow=true')]);
  const known = new Set(Object.keys(rows || {}));
  const plan = {};
  for (const [uid, byInst] of Object.entries(progress || {})) {
    if (!UID_RE.test(uid) || !byInst || typeof byInst !== 'object') continue;
    for (const [inst, rec] of Object.entries(byInst)) {
      if (!known.has(inst) || !rec || typeof rec !== 'object') continue;
      (plan[inst] ||= []).push(uid);
    }
  }
  return plan;
}

const ledgerSize = async (db, inst) => Object.keys((await db.get(`${SERIES_READ_LEDGER}/${inst}`, 'shallow=true')) || {}).length;

/** Step 2 for one instalment: the count becomes the ledger's size, once nothing is moving. */
export async function settleCount(db, inst, { settleMs = 1500, tries = 20 } = {}) {
  for (let i = 0; i < tries; i++) {
    const a = await db.getWithEtag(readsPath(inst));
    const sizeA = await ledgerSize(db, inst);
    await sleep(settleMs);
    const b = await db.getWithEtag(readsPath(inst));
    const sizeB = await ledgerSize(db, inst);
    if (a.etag !== b.etag || sizeA !== sizeB) continue; // a live read is in flight: look again
    if (readsOf(b.value) === sizeB) return { count: sizeB, wrote: false };
    if ((await db.putIfMatch(readsPath(inst), sizeB, b.etag)) === 'ok') return { count: sizeB, wrote: true };
  }
  throw new Error(`series_reads/${inst} did not settle`);
}

/** --apply. Returns per instalment { readers, created, count }. */
export async function applySeed(db, plan, opts = {}) {
  const out = {};
  for (const [inst, uids] of Object.entries(plan)) {
    let created = 0;
    for (const uid of uids) if (await claimOnce(db.url(ledgerPath(inst, uid)), db.headers)) created++;
    const { count } = await settleCount(db, inst, opts);
    out[inst] = { readers: uids.length, created, count };
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { mintToken } = await import('../rules-pull.mjs');
  const db = restDb({ base: PROD, token: await mintToken() });
  const plan = await planSeed(db);
  const ids = Object.keys(plan).sort();
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${ids.length} instalment(s) with saved places`);
  if (!apply) {
    for (const inst of ids) {
      const now = readsOf(await db.get(readsPath(inst)));
      console.log(`  ${inst}  readers with a saved place: ${plan[inst].length}  ·  series_reads now: ${now}`);
    }
    console.log('Nothing written. Re-run with --apply to seed.');
    return;
  }
  const res = await applySeed(db, plan);
  for (const inst of ids) console.log(`  ${inst}  readers: ${res[inst].readers}  ·  ledger entries created: ${res[inst].created}  ·  series_reads: ${res[inst].count}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`seed-reads failed: ${e.message}`); process.exit(1); });
}
