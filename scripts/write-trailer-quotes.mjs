// SCRIPT B — Apply reviewed trailer quotes to Firebase.
//
// Reads scripts/trailer-quotes-report.json (produced by extract-trailer-quotes.mjs)
// and writes each status:"ok" quote to cms_stories/{id}/trailerQuote — except ids
// listed in EXCLUSIONS below. Add any id you rejected during review to that array.
//
// Auth (writes require credentials; pick one):
//   FIREBASE_SERVICE_ACCOUNT=/path/to/serviceAccountKey.json  (or inline JSON)
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
//   FIREBASE_DB_SECRET=<legacy database secret>
//   FIREBASE_ACCESS_TOKEN=<OAuth access token, e.g. from a firebase-tools login>
//
// Usage: node scripts/write-trailer-quotes.mjs [--dry-run]

// ── ids rejected during review — will NOT be written ────────────────
const EXCLUSIONS = [
  'my-daddy-is-a-superhero',
  'cybercrime-has-a-calendar',
  'shots-fired-at-white-house-correspondents-dinner-trump-evacuated-unhurt',
  'a-daub-of-blue',
  'mask-with-no-memory',
  'early',
];

import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const DRY_RUN = process.argv.includes('--dry-run');

// ── service-account OAuth (no SDK needed — signed JWT → access token) ─
async function getAccessToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!raw) return null;
  const json = raw.trim().startsWith('{') ? raw : await readFile(raw, 'utf8');
  const sa = JSON.parse(json);
  const now = Math.floor(Date.now() / 1000);
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const report = JSON.parse(await readFile(resolve(here, 'trailer-quotes-report.json'), 'utf8'));

  const approved = report.rows.filter(r => r.status === 'ok' && !EXCLUSIONS.includes(r.id));
  const excluded = report.rows.filter(r => r.status === 'ok' && EXCLUSIONS.includes(r.id));
  console.log(`${approved.length} quotes to write · ${excluded.length} excluded by review · ${report.rows.length - approved.length - excluded.length} skip/failed in report${DRY_RUN ? ' · DRY RUN' : ''}\n`);

  let authQuery = '';
  if (!DRY_RUN) {
    const token = process.env.FIREBASE_ACCESS_TOKEN || await getAccessToken();
    if (token) authQuery = `?access_token=${token}`;
    else if (process.env.FIREBASE_DB_SECRET) authQuery = `?auth=${process.env.FIREBASE_DB_SECRET}`;
    else {
      console.error('No credentials. Set FIREBASE_SERVICE_ACCOUNT (path or inline JSON), GOOGLE_APPLICATION_CREDENTIALS, or FIREBASE_DB_SECRET.');
      process.exit(1);
    }
  }

  let written = 0, failed = 0;
  for (const row of approved) {
    if (DRY_RUN) {
      console.log(`[dry-run] cms_stories/${row.id}/trailerQuote ← "${row.quote}"`);
      continue;
    }
    const res = await fetch(`${FB_DB}/cms_stories/${encodeURIComponent(row.id)}/trailerQuote.json${authQuery}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(row.quote),
    });
    if (res.ok) { written++; console.log(`✓ ${row.id}`); }
    else { failed++; console.error(`✗ ${row.id}: ${res.status} ${await res.text()}`); }
  }

  if (!DRY_RUN) console.log(`\nDone: ${written} written, ${failed} failed, ${excluded.length} excluded.`);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
