#!/usr/bin/env node
// READERSHIP — the backfill and the reconciler, one script, two verbs.
//
//   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/key.json node scripts/readership.mjs report
//   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/key.json node scripts/readership.mjs backfill [--dry-run]
//
//   report    Recompute from bookstore_purchases and print every title with the stored
//             number beside the true one. WRITES NOTHING, EVER, including when it finds
//             drift. Exits 1 if anything disagrees, so it can be run on a schedule and
//             noticed. This is the reconciliation the brief asked for.
//
//   backfill  The one-time write at ship time. Computes the same numbers and PUTs the whole
//             bookstore_readership node. Run `report` first, and `backfill --dry-run` after
//             that; both print the exact payload.
//
// ⚠ THEY SHARE ONE DEFINITION OF THE TRUTH — readershipFromPurchases() in
// scripts/readership-source.mjs, which is also what tests/bookstore/readership.test.mjs
// asserts over a synthetic set. A backfill and a reconciler with separate arithmetic would
// mean the reconciler certifying the backfill's bug.
//
// ⚠ AND THE RECONCILER NEVER PATCHES. A discrepancy means the counter's atomicity broke or
// something wrote the node that should not have — see the note on reconcile(). Repair is a
// human, with the number this printed.
//
// Auth: service-account JSON at FIREBASE_SERVICE_ACCOUNT_PATH → an OAuth2 token from an
// RS256-signed JWT → REST. The pattern scripts/migrate-publishers-split.js established; no
// firebase-admin dependency. bookstore_purchases is founder-read-only, so this credential is
// not optional — there is no anonymous way to compute this and there must not be.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { readershipFromPurchases, reconcile } from './readership-source.mjs';

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const DATABASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const PURCHASES_PATH = 'bookstore_purchases';
const READERSHIP_PATH = 'bookstore_readership';

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function mintAccessToken(saPath) {
  const sa = JSON.parse(readFileSync(saPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const jwt = `${signingInput}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function rtdb(method, path, token, body) {
  const res = await fetch(`${DATABASE_URL}${path}.json`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`RTDB ${method} ${path} failed: ${res.status} ${await res.text()}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function printTable(rows) {
  if (rows.length === 0) {
    console.log('  (no titles on either side — nothing has been bought, and nothing is stored)');
    return;
  }
  const w = Math.max(7, ...rows.map((r) => r.titleId.length));
  console.log(`  ${'title'.padEnd(w)}  ${'stored'.padStart(6)}  ${'true'.padStart(6)}   status`);
  console.log(`  ${'-'.repeat(w)}  ------  ------   ------`);
  for (const r of rows) {
    const have = r.have === null ? '—' : String(r.have);
    console.log(`  ${r.titleId.padEnd(w)}  ${have.padStart(6)}  ${String(r.want).padStart(6)}   ${r.ok ? 'ok' : 'DRIFT'}`);
  }
}

async function main() {
  const verb = process.argv[2];
  const dry = process.argv.includes('--dry-run');
  if (verb !== 'report' && verb !== 'backfill') {
    console.error('usage: node scripts/readership.mjs report | backfill [--dry-run]');
    process.exit(2);
  }
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH env var is required — bookstore_purchases is founder-read-only.');
    process.exit(2);
  }

  const token = await mintAccessToken(saPath);

  console.log(`[readership] reading ${PURCHASES_PATH}/ …`);
  const purchases = await rtdb('GET', `/${PURCHASES_PATH}`, token);
  const readers = purchases ? Object.keys(purchases).length : 0;
  const records = purchases
    ? Object.values(purchases).reduce((n, t) => n + Object.keys(t || {}).length, 0)
    : 0;
  console.log(`[readership] ${records} purchase record(s) across ${readers} reader(s)`);

  const computed = readershipFromPurchases(purchases);
  console.log(`[readership] reading ${READERSHIP_PATH}/ …`);
  const stored = await rtdb('GET', `/${READERSHIP_PATH}`, token);

  const { rows, drift } = reconcile(computed, stored || {});
  console.log('');
  printTable(rows);
  console.log('');

  if (verb === 'report') {
    if (drift.length === 0) {
      console.log('[readership] ✓ stored counts agree with the purchase records.');
      return;
    }
    console.error(`[readership] ✗ ${drift.length} title(s) DRIFT. Nothing was written — this command never writes.`);
    for (const d of drift) {
      console.error(`  ${d.titleId}: stored ${d.have === null ? '(absent)' : d.have}, should be ${d.want}`);
    }
    console.error('[readership] The counter rides the purchase write atomically, so drift means either that');
    console.error('[readership] atomicity broke or something else wrote the node. Investigate before repairing.');
    process.exitCode = 1;
    return;
  }

  // backfill
  const payload = {};
  for (const [titleId, count] of [...computed.entries()].sort()) payload[titleId] = { count };

  console.log(`[readership] backfill payload — ${Object.keys(payload).length} title(s) with at least one active record:`);
  console.log(JSON.stringify(payload, null, 2));
  // Titles with nobody are ABSENT from the payload, not written as 0. Absent is absent.
  console.log('[readership] titles with no active purchase are deliberately NOT written — absent is absent.');

  if (dry) {
    console.log('[readership] --dry-run: nothing written.');
    return;
  }

  // PUT, not PATCH: the backfill establishes the whole node from source, so a stale key left
  // by an earlier partial run must not survive. It is a one-time operation and `report` is
  // what to run afterwards.
  await rtdb('PUT', `/${READERSHIP_PATH}`, token, payload);
  console.log('[readership] written. Run `report` to confirm.');
}

main().catch((err) => {
  console.error('[readership] FAILED:', err.message);
  process.exit(1);
});
