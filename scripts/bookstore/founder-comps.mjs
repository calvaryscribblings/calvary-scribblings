#!/usr/bin/env node
// FOUNDER COPIES — complimentary, outside sales. W3b, ruled by Ikenna 25 Sep 2026.
//
//   node scripts/bookstore/founder-comps.mjs grant             # dry run: what would be granted
//   node scripts/bookstore/founder-comps.mjs grant --apply     # grant
//   node scripts/bookstore/founder-comps.mjs revoke            # dry run: what would be removed
//   node scripts/bookstore/founder-comps.mjs revoke --apply    # remove exactly the comps it granted
//   (FIREBASE_SERVICE_ACCOUNT_PATH=serviceAccountKey.json, the default)
//
// WHY. So the Books design in My Library can be walked with real books before launch. The
// ruling is that they are COMPS, NEVER SALES: they must not reach revenue, publisher or royalty
// statements, readership/popularity, admin reports or the money alerts. How each is held is in
// app/lib/bookstore/purchaseSource.js; tests/bookstore/comps.test.mjs proves it.
//
// THE SAME ENTITLEMENT PATH A PURCHASE USES. bookstore_purchases/{uid}/{titleId} with
// status: 'active' and the four denormalised display fields a webhook grant writes — so the
// web shelf, the app's shelf and /api/bookstore/stream read a comp exactly as an owned book.
// What a comp does NOT carry: amount, currency, stripeSessionId, stripePaymentIntent,
// paystackRef (absent, not null). What it adds: source 'comp', and compGrant naming this batch,
// which is how the revoke finds its own and nothing else.
//
// THE READERSHIP COUNT IS NOT WRITTEN. A webhook grant moves bookstore_readership in the same
// atomic patch; this does not, and must not.
//
// IDEMPOTENT. A title is granted only where the account holds NO record for it — a comp
// already there, a real purchase, even a refunded one, is left exactly as it is and reported.
// So a second run grants nothing, and a comp never overwrites a sale's history.
//
// WHO. Ikenna's founder account only (ruling). Another uid needs his word and an edit here.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { COMP_SOURCE, isComp } from '../../app/lib/bookstore/purchaseSource.js';

export const COMP_GRANT = 'founder-comps-2026-09-25';
export const IKENNA_UID = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';   // @byokpara
export const ALLOWED_UIDS = [IKENNA_UID];
const DATABASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BACKUP_DIR = join('backups', 'founder-comps');

const str = (v) => (typeof v === 'string' && v ? v : null);

/** The comp record for one title. Pure. No money field, no provider field — absent, not null. */
export function compRecord(title, now) {
  const rec = {
    status: 'active',
    source: COMP_SOURCE,
    compGrant: COMP_GRANT,
    compGrantedAt: now,
    // "Added to the library" — the shelf orders by it. Not a sale date; no sale happened.
    purchasedAt: now,
  };
  for (const k of ['slug', 'title', 'author', 'coverUrl']) if (str(title?.[k])) rec[k] = title[k];
  return rec;
}

/**
 * What a grant would write. Pure.
 * @param titles     the bookstore_titles node
 * @param mine       bookstore_purchases/{uid} (or null)
 * @returns { update, granted: [titleId], skipped: [{ titleId, why }] }
 */
export function planGrant({ uid, titles, mine, now }) {
  if (!ALLOWED_UIDS.includes(uid)) throw new Error(`${uid} is not an account the ruling covers`);
  const update = {};
  const granted = [];
  const skipped = [];
  for (const [titleId, t] of Object.entries(titles || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!t || t.status !== 'published') continue;
    const existing = mine?.[titleId];
    if (existing) {
      skipped.push({ titleId, why: isComp(existing) ? 'already a comp' : `already holds a ${existing.status || 'status-less'} record — left as it is` });
      continue;
    }
    update[`bookstore_purchases/${uid}/${titleId}`] = compRecord(t, now);
    granted.push(titleId);
  }
  return { update, granted, skipped };
}

/** What a revoke would remove: exactly this batch's comps, nothing else. Pure. */
export function planRevoke({ uid, mine }) {
  const update = {};
  const removed = [];
  const kept = [];
  for (const [titleId, rec] of Object.entries(mine || {})) {
    if (isComp(rec) && rec.compGrant === COMP_GRANT) {
      update[`bookstore_purchases/${uid}/${titleId}`] = null;
      removed.push(titleId);
    } else kept.push(titleId);
  }
  return { update, removed, kept };
}

async function main() {
  const [cmd] = process.argv.slice(2);
  const apply = process.argv.includes('--apply');
  if (!['grant', 'revoke'].includes(cmd)) { console.error('usage: founder-comps.mjs grant|revoke [--apply]'); process.exit(2); }
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const sa = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'serviceAccountKey.json', 'utf8'));
  initializeApp({ credential: cert(sa), databaseURL: DATABASE_URL });
  const db = getDatabase();
  const uid = IKENNA_UID;

  const mine = (await db.ref(`bookstore_purchases/${uid}`).get()).val();
  const readershipBefore = (await db.ref('bookstore_readership').get()).val();
  const plan = cmd === 'grant'
    ? planGrant({ uid, titles: (await db.ref('bookstore_titles').get()).val(), mine, now: Date.now() })
    : planRevoke({ uid, mine });

  mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = join(BACKUP_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${cmd}${apply ? '-apply' : '-dry-run'}.json`);
  writeFileSync(backupPath, JSON.stringify({ uid, cmd, before: mine, readershipBefore, update: plan.update }, null, 2));

  const list = cmd === 'grant' ? plan.granted : plan.removed;
  console.log(`${cmd} for ${uid} — ${list.length} title(s). Backup: ${backupPath}`);
  for (const t of list) console.log(`  ${cmd === 'grant' ? '+' : '-'} ${t}`);
  for (const s of plan.skipped || []) console.log(`  = ${s.titleId}: ${s.why}`);
  if (cmd === 'revoke' && plan.kept.length) console.log(`  untouched (not this batch's comps): ${plan.kept.join(', ')}`);
  if (!apply) { console.log('\nDRY RUN — nothing written. Add --apply.'); process.exit(0); }
  if (!list.length) { console.log('\nNothing to do.'); process.exit(0); }

  await db.ref().update(plan.update);
  const after = (await db.ref(`bookstore_purchases/${uid}`).get()).val() || {};
  let ok = true;
  for (const [p, v] of Object.entries(plan.update)) {
    const got = after[p.split('/').pop()] ?? null;
    if (!isDeepStrictEqual(got, v)) { ok = false; console.error(`  ✗ ${p} did not read back as written`); }
  }
  const readershipAfter = (await db.ref('bookstore_readership').get()).val();
  if (!isDeepStrictEqual(readershipBefore, readershipAfter)) { ok = false; console.error('  ✗ bookstore_readership CHANGED — a comp must never move it'); }
  console.log(ok ? `\n✓ ${cmd} applied and read back; readership unchanged.` : '\n✗ verification failed — see above.');
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message || e); process.exit(1); });
