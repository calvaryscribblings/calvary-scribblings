#!/usr/bin/env node
// One-shot migration: split bookstore_publishers/{slug} from a single combined
// shape into two sibling nodes — public bookstore_publishers/{slug} (no
// contactEmail / paymentDetails) and admin-only bookstore_publishers_private/{slug}.
//
// Idempotent: detects whether any combined-shape doc still has contactEmail or
// paymentDetails and exits cleanly when nothing's left to migrate.
//
// Auth: same pattern as workers/calvary-account-purge — service-account JSON
// at FIREBASE_SERVICE_ACCOUNT_PATH, OAuth2 access token via RS256-signed JWT,
// REST writes to the Realtime Database. No firebase-admin dependency.
//
// Run command:
//   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json \
//     node scripts/migrate-publishers-split.js

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const DATABASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const PUBLIC_FIELDS = new Set([
  'schemaVersion', 'slug', 'name', 'status', 'salesSplit',
  'titlesCount', 'addedAt', 'updatedAt',
]);

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function mintAccessToken(saPath) {
  const raw = readFileSync(saPath, 'utf8');
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer.sign(sa.private_key);
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${t}`);
  }
  const { access_token } = await res.json();
  return access_token;
}

async function rtdb(method, path, token, body) {
  const url = `${DATABASE_URL}${path}.json?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`RTDB ${method} ${path} failed: ${res.status} ${t}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function splitDoc(combined) {
  const pub = {};
  const priv = {};
  for (const [k, v] of Object.entries(combined)) {
    if (PUBLIC_FIELDS.has(k)) pub[k] = v;
  }
  if (typeof combined.contactEmail === 'string' && combined.contactEmail.length > 0) {
    priv.contactEmail = combined.contactEmail;
  }
  if (combined.paymentDetails && typeof combined.paymentDetails === 'object') {
    const cleaned = {};
    if (combined.paymentDetails.method) cleaned.method = combined.paymentDetails.method;
    if (typeof combined.paymentDetails.notes === 'string' && combined.paymentDetails.notes.length > 0) {
      cleaned.notes = combined.paymentDetails.notes;
    }
    if (Object.keys(cleaned).length > 0) priv.paymentDetails = cleaned;
  }
  return { pub, priv };
}

async function main() {
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH env var is required');
    process.exit(2);
  }

  console.log('[migrate] minting access token…');
  const token = await mintAccessToken(saPath);

  console.log('[migrate] fetching bookstore_publishers/…');
  const pubs = await rtdb('GET', '/bookstore_publishers', token);
  if (!pubs || typeof pubs !== 'object') {
    console.log('[migrate] no publishers found — nothing to do');
    return;
  }

  const slugs = Object.keys(pubs);
  console.log(`[migrate] ${slugs.length} publisher record(s) on file`);

  const needsMigration = slugs.filter((slug) => {
    const doc = pubs[slug];
    return doc && (
      typeof doc.contactEmail === 'string' ||
      (doc.paymentDetails && typeof doc.paymentDetails === 'object')
    );
  });

  if (needsMigration.length === 0) {
    console.log('[migrate] Already migrated — no combined-shape records detected. Exiting.');
    return;
  }

  console.log(`[migrate] ${needsMigration.length} record(s) need splitting:`);
  for (const slug of needsMigration) console.log(`  - ${slug}`);

  let migrated = 0;
  let skippedNoPrivate = 0;
  for (const slug of needsMigration) {
    const combined = pubs[slug];
    const { pub, priv } = splitDoc(combined);

    console.log(`[migrate] ${slug}:`);
    console.log(`    public  -> ${Object.keys(pub).join(', ')}`);
    if (Object.keys(priv).length > 0) {
      console.log(`    private -> ${Object.keys(priv).join(', ')}`);
    } else {
      console.log('    private -> (none — no contactEmail or paymentDetails to relocate)');
      skippedNoPrivate++;
    }

    // Single multi-path PATCH: rewrite public node, write/clear private node,
    // strip contactEmail + paymentDetails from public via explicit nulls.
    const patch = {
      [`bookstore_publishers/${slug}`]: pub,
    };
    if (Object.keys(priv).length > 0) {
      patch[`bookstore_publishers_private/${slug}`] = priv;
    }
    await rtdb('PATCH', '', token, patch);
    migrated++;
  }

  console.log('');
  console.log(`[migrate] DONE. ${migrated} record(s) split.`);
  console.log(`[migrate]      ${migrated - skippedNoPrivate} private node(s) written.`);
  console.log(`[migrate]      ${skippedNoPrivate} record(s) had nothing to relocate.`);
  console.log('');
  console.log('Verify in Firebase Console:');
  console.log('  - bookstore_publishers/{slug} should NOT have contactEmail or paymentDetails');
  console.log('  - bookstore_publishers_private/{slug} should hold those fields where present');
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message);
  process.exit(1);
});
