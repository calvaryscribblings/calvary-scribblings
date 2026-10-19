// W55.1 — how many reader records carry a join date the reader card can show. READ-ONLY: one
// read of users/, nothing written, counts only (no uid, name or date is printed).
//
//   node scripts/square/reading-since-count.mjs
//
// Credential: serviceAccountKey.json at the repo root (or SCRUB_SERVICE_ACCOUNT), as the
// account scripts use. Its contents and the environment are never printed.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { joinedAt } from '../../app/lib/squareSafety.js';

export function countJoinDates(users) {
  const c = { records: 0, joinDate: 0, createdAt: 0, both: 0, neither: 0, cardShowsLine: 0, unusable: 0, joinDateTypes: {}, createdAtTypes: {} };
  const has = (v) => v !== undefined && v !== null && v !== '';
  for (const rec of Object.values(users || {})) {
    if (!rec || typeof rec !== 'object') continue;
    c.records++;
    const j = has(rec.joinDate), k = has(rec.createdAt);
    if (j) { c.joinDate++; c.joinDateTypes[typeof rec.joinDate] = (c.joinDateTypes[typeof rec.joinDate] || 0) + 1; }
    if (k) { c.createdAt++; c.createdAtTypes[typeof rec.createdAt] = (c.createdAtTypes[typeof rec.createdAt] || 0) + 1; }
    if (j && k) c.both++;
    if (!j && !k) c.neither++;
    if (joinedAt(rec) !== null) c.cardShowsLine++;
    else if (j || k) c.unusable++;
  }
  return c;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const keyPath = process.env.SCRUB_SERVICE_ACCOUNT || resolve(ROOT, 'serviceAccountKey.json');
  let credential;
  try { credential = cert(JSON.parse(readFileSync(keyPath, 'utf8'))); } catch { credential = applicationDefault(); }
  const app = initializeApp({ credential, databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app' });
  try {
    const snap = await getDatabase(app).ref('users').get();
    console.log(JSON.stringify(countJoinDates(snap.val())));
  } catch (e) {
    console.error('Count failed:', e?.code || 'error');
    process.exitCode = 1;
  } finally {
    process.exit();
  }
}
