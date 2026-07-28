// Set the bucket-level CORS policy that lets the Reading Room fetch a signed EPUB URL.
//
//   node scripts/bookstore-set-cors.mjs --dry     # read and print the CURRENT policy, change nothing
//   node scripts/bookstore-set-cors.mjs           # read, print, MERGE our entry, PATCH, print again
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
// functions/api/bookstore/stream.js mints a V4 signed URL on storage.googleapis.com. The
// browser then fetches it from https://calvaryscribblings.co.uk — a cross-origin request. A
// signed URL proves *authorisation*; it says nothing about CORS. Without the policy below the
// browser blocks the response before foliate ever sees a byte, and the failure surfaces as a
// generic "couldn't open this book" with a console CORS error and nothing else. There is no
// server-side workaround: CORS is bucket configuration, not request configuration.
//
// This is deliberately NOT part of `npm run build` or any deploy step. It is a one-off
// operator action against live infrastructure, run by hand, reviewed by eye.
//
// ── WHAT THE BUCKET ALREADY HAD (dry read, 2026-07-28) ──────────────────────────────────────
// One entry, spanning production + the pages.dev preview + localhost:3000, method GET only,
// responseHeader [Content-Type, Content-Disposition, Content-Length, Cache-Control],
// maxAgeSeconds 86400 — left over from the sample/cover work. So the GET that foliate actually
// performs was ALREADY permitted, and this script's only real effect is to add HEAD to that
// entry as insurance. That is a much smaller change than "CORS is missing" would suggest, and
// worth knowing before blaming CORS for a failed open.
//
// ── WHY IT MERGES ───────────────────────────────────────────────────────────────────────────
// The GCS JSON API's `cors` field is a WHOLE-ARRAY replacement — PATCHing it with one entry
// deletes every other entry the bucket had. Other surfaces on this project may rely on rules
// nobody has written down. So: read first, keep everything, add or update only the entry whose
// origin list is ours, and refuse to proceed at all if the read fails. A blind write here
// could silently break an unrelated upload path.
//
// ── CREDENTIALS ─────────────────────────────────────────────────────────────────────────────
// serviceAccountKey.json at the repo root (the same file `npm run rules:deploy` uses via
// GOOGLE_APPLICATION_CREDENTIALS), or point GOOGLE_APPLICATION_CREDENTIALS at another key.
// The account needs storage.buckets.get and storage.buckets.update — the Firebase Admin SDK
// service account has both.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSign } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// app/lib/firebaseCore.js — the bucket the app actually uses. Newer Firebase projects are
// provisioned as <project>.firebasestorage.app, NOT the legacy <project>.appspot.com, and the
// two are different buckets. Configuring CORS on the wrong one looks like it worked and
// changes nothing.
const BUCKET = process.env.BOOKSTORE_BUCKET || 'calvary-scribblings.firebasestorage.app';

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://calvaryscribblings.co.uk';

// GET and HEAD only: the browser never writes to this bucket over a signed URL. Content-Type
// and Content-Length are what foliate reads to size and type the EPUB before parsing it.
const DESIRED = {
  origin: [SITE_ORIGIN],
  method: ['GET', 'HEAD'],
  responseHeader: ['Content-Type', 'Content-Length'],
  maxAgeSeconds: 3600,
};

const DRY = process.argv.includes('--dry') || process.argv.includes('--dry-run');

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function mintToken() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || resolve(ROOT, 'serviceAccountKey.json');
  let svc;
  try {
    svc = JSON.parse(await readFile(keyPath, 'utf8'));
  } catch (e) {
    throw new Error(
      `Could not read service-account credentials at ${keyPath}: ${e.message}\n` +
      `Put serviceAccountKey.json at the repo root, or set GOOGLE_APPLICATION_CREDENTIALS.`,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: svc.client_email,
    // devstorage.full_control is what buckets.get + buckets.update (the cors field) require.
    scope: 'https://www.googleapis.com/auth/devstorage.full_control',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
  const signature = b64url(createSign('RSA-SHA256').update(signingInput).end().sign(svc.private_key));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`token mint failed: HTTP ${res.status} — ${await res.text()}`);
  return { token: (await res.json()).access_token, clientEmail: svc.client_email };
}

const bucketUrl = (fields) =>
  `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(BUCKET)}?fields=${fields}`;

async function readCors(token) {
  const res = await fetch(bucketUrl('cors'), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`bucket read failed: HTTP ${res.status} — ${(await res.text()).slice(0, 500)}`);
  }
  const body = await res.json();
  return Array.isArray(body.cors) ? body.cors : [];
}

// An entry already COVERS us when our origin appears in its origin list — it need not be an
// exact match. This bucket, for instance, already carries one entry spanning production,
// the pages.dev preview and localhost. Widening that entry is right; appending a second,
// narrower one for the same origin would be redundant clutter, and GCS resolves a request
// against the first entry matching origin+method, so the near-duplicate would rarely even be
// consulted. Matching on coverage rather than equality is also what makes a re-run a no-op.
const covers = (entry) =>
  (entry.origin || []).some((o) => String(o).toLowerCase() === SITE_ORIGIN.toLowerCase());

function merge(existing) {
  const out = existing.map((e) => ({ ...e }));
  const at = out.findIndex(covers);

  if (at === -1) return { next: [...out, { ...DESIRED }], action: 'added' };

  // Widen, never overwrite: the origins, methods and headers already there may be load-bearing
  // for a surface nobody remembers, and this script must not be the thing that removes them.
  const cur = out[at];
  const union = (a = [], b = []) => [...new Set([...a, ...b])];
  const merged = {
    ...cur,
    origin: union(cur.origin, DESIRED.origin),
    method: union(cur.method, DESIRED.method),
    responseHeader: union(cur.responseHeader, DESIRED.responseHeader),
    // Keep the longer preflight cache if the bucket already had one — a shorter max-age is
    // only ever more preflight traffic for the same result.
    maxAgeSeconds: Math.max(Number(cur.maxAgeSeconds) || 0, DESIRED.maxAgeSeconds),
  };
  out[at] = merged;
  return { next: out, action: JSON.stringify(merged) === JSON.stringify(cur) ? 'unchanged' : 'widened' };
}

async function writeCors(token, cors) {
  const res = await fetch(bucketUrl('cors'), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cors }),
  });
  if (!res.ok) {
    throw new Error(`bucket PATCH failed: HTTP ${res.status} — ${(await res.text()).slice(0, 500)}`);
  }
  const body = await res.json();
  return Array.isArray(body.cors) ? body.cors : [];
}

const show = (label, cors) => {
  console.log(`\n── ${label} ──`);
  console.log(cors.length ? JSON.stringify(cors, null, 2) : '(no CORS entries configured)');
};

async function main() {
  console.log(`bucket : ${BUCKET}`);
  console.log(`origin : ${SITE_ORIGIN}`);
  console.log(`mode   : ${DRY ? 'DRY READ — nothing will be written' : 'READ, MERGE, PATCH'}`);

  const { token, clientEmail } = await mintToken();
  console.log(`as     : ${clientEmail}`);

  // Hard stop if the before-state is unreadable. Without it there is no merge, only a blind
  // replacement — and this script exists specifically to never do that.
  const before = await readCors(token);
  show('BEFORE', before);

  const { next, action } = merge(before);

  if (action === 'unchanged') {
    console.log('\nAn existing entry already covers this origin with GET/HEAD and the required');
    console.log('response headers. Nothing to do.');
    return;
  }

  show(`PROPOSED (${action})`, next);

  if (DRY) {
    console.log('\nDry run — no PATCH sent. Re-run without --dry to apply.');
    return;
  }

  const after = await writeCors(token, next);
  show('AFTER', after);
  console.log('\nDone. CORS is bucket-wide and takes effect immediately; browsers may cache a');
  console.log('preflight for up to maxAgeSeconds, so a hard reload may be needed while testing.');
}

main().catch((e) => {
  console.error(`\n[bookstore-set-cors] ${e.message}`);
  process.exit(1);
});
