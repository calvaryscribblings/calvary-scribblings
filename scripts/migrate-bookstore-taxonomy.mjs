#!/usr/bin/env node
// R13 — ONE-SHOT MIGRATION: the genre taxonomy and the Window's claim.
//
// Writes two nodes that did not exist before this round:
//
//   bookstore_genres/{slug}     twelve records — label, group, order. The vocabulary the shop
//                               already renders, moved out of three hard-coded tables.
//   bookstore_sections/{id}     ONE record: the WINDOW section carrying whichever published
//                               title currently has `featured` set. Nothing else. The other
//                               five section types are Ikenna's to claim in the CMS, and this
//                               script deliberately seeds none of them.
//
// ── THE PROOF THIS MIGRATION OWES ────────────────────────────────────────────────────────
//
// The shop must render IDENTICALLY before and after. Two halves:
//
//   TABS      — the genre records reproduce app/bookstore/page.js's pre-R13 GENRE_LABELS and
//               the FICTION_GENRES / NONFICTION_GENRES split exactly, so the same tabs appear
//               in the same order with the same words. Asserted offline, against the pre-R13
//               source, by tests/bookstore/genres.test.mjs — this script cannot be the proof
//               of its own correctness, so the test reads the old file out of git history.
//   THE WINDOW— the section claims the slug `featured` already pointed at, so the same book
//               stands in the same case. Asserted by tests/bookstore/sections.test.mjs.
//
// ── IDEMPOTENT, AND IT REFUSES RATHER THAN OVERWRITES ────────────────────────────────────
//
// Genres are upserted (a re-run restores the seed values, which is the point of a seed).
// SECTIONS ARE NOT. If bookstore_sections already holds anything, this script leaves it alone
// and says so: after the migration that node is a curator's working document, and a second
// run of a migration must never quietly flatten a shelf plan somebody has since arranged.
//
// ── AUTH ─────────────────────────────────────────────────────────────────────────────────
//
// Same pattern as scripts/migrate-publishers-split.js: a service-account JSON at
// FIREBASE_SERVICE_ACCOUNT_PATH, an OAuth2 token from an RS256-signed JWT, REST writes. No
// firebase-admin dependency.
//
// Run:
//   FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json \
//     node scripts/migrate-bookstore-taxonomy.mjs [--dry-run]
//
// --dry-run prints the exact payload and writes nothing. Run it first.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { buildGenreMigration, buildWindowMigration, validateSection } from '../app/lib/bookstore/sections.js';
import { validateGenre } from '../app/lib/bookstore/genres.js';

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const DATABASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function mintAccessToken(saPath) {
  const sa = JSON.parse(readFileSync(saPath, 'utf8'));
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
  const jwt = `${signingInput}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
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
  if (!res.ok) throw new Error(`RTDB ${method} ${path} failed: ${res.status} ${await res.text()}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!saPath) {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH env var is required');
    process.exit(2);
  }

  console.log('[migrate] minting access token…');
  const token = await mintAccessToken(saPath);
  const at = Date.now();

  // ── 1. GENRES ──────────────────────────────────────────────────────────────────────────
  const genrePayload = buildGenreMigration(at);
  const genrePatch = {};
  for (const g of genrePayload) {
    const { valid, errors } = validateGenre(g);
    if (!valid) throw new Error(`seed genre ${g.slug} invalid: ${errors.join('; ')}`);
    genrePatch[g.slug] = g;
  }
  console.log(`[migrate] genres: ${genrePayload.length} records`);
  for (const g of genrePayload) console.log(`  ${String(g.order).padStart(2)} ${g.group.padEnd(10)} ${g.slug.padEnd(24)} "${g.label}"`);

  // ── 2. THE WINDOW ──────────────────────────────────────────────────────────────────────
  console.log('[migrate] reading bookstore_sections/…');
  const existingSections = await rtdb('GET', '/bookstore_sections', token);
  let sectionPatch = null;

  if (existingSections && typeof existingSections === 'object' && Object.keys(existingSections).length > 0) {
    console.log(`[migrate] bookstore_sections already holds ${Object.keys(existingSections).length} record(s) — LEAVING IT ALONE.`);
    console.log('[migrate] (a migration must never flatten a shelf plan a curator has arranged)');
  } else {
    console.log('[migrate] reading published titles…');
    const titlesRaw = await rtdb('GET', '/bookstore_titles', token);
    const titles = Object.entries(titlesRaw || {}).map(([id, v]) => ({ id, ...v }));
    const published = titles.filter((t) => t.status === 'published');
    console.log(`[migrate] ${published.length} published of ${titles.length} on file`);

    const windowPayload = buildWindowMigration(published, at);
    if (windowPayload.length === 0) {
      console.log('[migrate] ⚠ no published title carries `featured` — no Window claim to write.');
      console.log('[migrate]   The shop will render no display case, which is what it renders today.');
    } else {
      sectionPatch = {};
      for (const sec of windowPayload) {
        const { id, ...doc } = sec;
        const { valid, errors } = validateSection(doc);
        if (!valid) throw new Error(`window section invalid: ${errors.join('; ')}`);
        sectionPatch[id] = doc;
        console.log(`[migrate] sections: WINDOW "${doc.displayTitle}" claims ${doc.slugs.join(', ')} (order ${doc.order})`);
      }
    }
  }

  if (dry) {
    console.log('\n[migrate] --dry-run: NOTHING WRITTEN. Payload follows.\n');
    console.log(JSON.stringify({ bookstore_genres: genrePatch, bookstore_sections: sectionPatch }, null, 2));
    return;
  }

  console.log('[migrate] writing bookstore_genres/…');
  await rtdb('PATCH', '/bookstore_genres', token, genrePatch);
  if (sectionPatch) {
    console.log('[migrate] writing bookstore_sections/…');
    await rtdb('PATCH', '/bookstore_sections', token, sectionPatch);
  }
  console.log('[migrate] done.');
  console.log('[migrate] NEXT: load /bookstore and confirm the tabs and the Window are unchanged.');
  console.log('[migrate] THEN: delete the bootstrap branches in app/lib/bookstore/loader.js (getGenres, getSections).');
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message);
  process.exit(1);
});
