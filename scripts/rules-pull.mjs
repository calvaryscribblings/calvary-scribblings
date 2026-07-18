// Pull LIVE Firebase security rules into scratch files for diffing.
//
//   node scripts/rules-pull.mjs [rtdbOut] [storageOut]
//
// Fetches the rules the Firebase backend is actually serving RIGHT NOW, using the
// same service-account credentials the Phase A backfill used for REST writes
// (serviceAccountKey.json → an OAuth access token). Writes them VERBATIM to the
// given scratch paths (defaults under the OS temp dir) so a caller can diff them
// against the canonical repo files (database.rules.json / storage.rules).
//
//   RTDB    — GET <databaseURL>/.settings/rules.json  (the live rules text)
//   Storage — Firebase Rules API: the firebase.storage release → its ruleset →
//             the rule file's source content.
//
// This script NEVER writes to Firebase and never modifies the canonical files.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createSign } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PROJECT = 'calvary-scribblings';
const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const RTDB_OUT = process.argv[2] || resolve(tmpdir(), 'live-rtdb-rules.json');
const STORAGE_OUT = process.argv[3] || resolve(tmpdir(), 'live-storage-rules');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Mint a Google OAuth access token from the service-account key using a Node-crypto
// RS256 JWT — no firebase-admin / google-auth-library dependency, so this workflow
// survives any node_modules churn. Same credentials the Phase A backfill used.
export async function mintToken() {
  const svc = JSON.parse(await readFile(resolve(ROOT, 'serviceAccountKey.json'), 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: svc.client_email,
    // firebase.database + userinfo.email are BOTH required to read/write the RTDB
    // admin endpoints (.settings/rules.json); cloud-platform covers the Rules API.
    scope: 'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const head = { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(head))}.${b64url(JSON.stringify(claim))}`;
  const signature = b64url(createSign('RSA-SHA256').update(signingInput).end().sign(svc.private_key));
  const jwt = `${signingInput}.${signature}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`token mint failed: HTTP ${res.status} — ${await res.text()}`);
  return (await res.json()).access_token;
}

export async function pullRtdb(t, out = RTDB_OUT) {
  const res = await fetch(`${DB_URL}/.settings/rules.json?access_token=${t}`);
  if (!res.ok) throw new Error(`RTDB rules read failed: HTTP ${res.status} — ${await res.text()}`);
  const text = await res.text();
  await writeFile(out, text);
  return { out, bytes: text.length };
}

// Returns { out, bytes, ruleset } or { skipped, reason } if the API is not usable.
export async function pullStorage(t, out = STORAGE_OUT) {
  const rel = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!rel.ok) return { skipped: true, reason: `releases list HTTP ${rel.status}: ${(await rel.text()).slice(0, 200)}` };
  const releases = (await rel.json()).releases || [];
  // The storage release is named firebase.storage/<bucket> (or plain firebase.storage).
  const storageRel = releases.find((r) => /\/firebase\.storage(\/|$)/.test(r.name));
  if (!storageRel) return { skipped: true, reason: 'no firebase.storage release found' };
  const rs = await fetch(`https://firebaserules.googleapis.com/v1/${storageRel.rulesetName}`, {
    headers: { Authorization: `Bearer ${t}` },
  });
  if (!rs.ok) return { skipped: true, reason: `ruleset fetch HTTP ${rs.status}: ${(await rs.text()).slice(0, 200)}` };
  const files = (await rs.json()).source?.files || [];
  if (!files.length) return { skipped: true, reason: 'ruleset has no source files' };
  await writeFile(out, files[0].content);
  return { out, bytes: files[0].content.length, ruleset: storageRel.rulesetName.split('/').pop(), file: files[0].name };
}

// Run directly (not imported): pull both and report.
if (import.meta.url === `file://${process.argv[1]}`) {
  const t = await mintToken();
  const r = await pullRtdb(t);
  console.log(`RTDB    → ${r.out}  (${r.bytes} bytes)`);
  const s = await pullStorage(t);
  if (s.skipped) console.log(`Storage → SKIPPED: ${s.reason}`);
  else console.log(`Storage → ${s.out}  (${s.bytes} bytes)  ruleset=${s.ruleset} file=${s.file}`);
}
