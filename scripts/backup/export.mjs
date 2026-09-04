// THE BACKUP. Everything a script can copy out, with checksums, in one run.
//
//   node scripts/backup/export.mjs                 # → backups/<utc-timestamp>/
//   node scripts/backup/export.mjs --out /mnt/x    # somewhere else
//   node scripts/backup/export.mjs --skip-epubs    # database + accounts only (fast)
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// 🚨 CORRECTION, R37 (4 Sep 2026) — THE PARAGRAPH THAT STOOD HERE WAS TRUE FOR 48 MINUTES
// AND THEN WRONG FOR TWELVE DAYS, AND IT COST REAL WORK.
//
// It said: "the project contains exactly ONE Cloud Storage bucket — the live one. Realtime
// Database automated backups have never been enabled; they would have created a second
// bucket, and there isn't one."
//
// The reasoning was sound and the conclusion became false almost immediately. This file was
// written at 19:22 UTC on 23 Aug 2026. The bucket
// calvary-scribblings-default-rtdb-backups was created at 20:10 UTC the same evening —
// forty-eight minutes later — when the automated backup was switched on. Nobody came back
// to this comment.
//
// WHAT IT COST. On 4 Sep 2026 a probe wrote test text into a live Open Pages piece. Acting
// on this comment, that round concluded no backup existed, restored the record from a stale
// mirror holding older text, and reported 267 characters of Ikenna's own writing as
// permanently lost. They were sitting in that morning's automated backup the whole time and
// were recovered byte-for-byte an hour later. A false statement about a safety net is worse
// than no statement: it is believed, and the belief is what stops anyone looking.
//
// THE STATE TODAY, measured rather than reasoned:
//   · The project is on the BLAZE plan (two buckets; automated backups are Blaze-only).
//   · Firebase's scheduled RTDB backup is ENABLED and has run daily at ~00:13 UTC since
//     23 Aug 2026, writing <ts>_..._data.json.gz and _rules.json.gz to that bucket, which
//     carries a 30-day delete lifecycle rule.
//   · scripts/backup/liveness.mjs watches it and FAILS a daily workflow if it stops,
//     shrinks, or stops parsing. scripts/backup/restore-drill.mjs proves it restores.
//
// SO WHAT IS THIS SCRIPT FOR NOW? The two things the automated backup does NOT cover:
// Firebase AUTH ACCOUNTS and the EPUBs. The database half is redundant with the automated
// backup and is kept as a portable, off-Google copy. See RESTORE.md.
//
// ⚠ If you are about to write a comment asserting that some safety net does not exist,
// check it at the source instead, and date the check.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHAT THIS DOES NOT RECOVER — read before trusting it
// ═══════════════════════════════════════════════════════════════════════════════════════
//
//   · PASSWORD HASH PARAMETERS. The account export carries each password's hash and salt,
//     but NOT the project-level parameters needed to re-import them (algorithm, signer key,
//     salt separator, rounds, memory cost). Those live in the Firebase console and cannot
//     be read through any API. Without them the hashes are inert and every password-based
//     reader would have to reset. RESTORE.md gives the exact click path; record them ONCE
//     and keep them with the backups, not in this repo.
//   · THE OTHER 774 MB OF STORAGE. Covers, avatars, open-pages images and the rest are not
//     copied — only the 13 master EPUBs, because those are the sellable inventory and
//     nothing else here is irreplaceable. Covers regenerate from scripts/covers/.
//   · THE FIVE CLOUDFLARE WORKERS. Their source lives in a dashboard, not in git. See
//     workers-external/README.md.
//   · SECRETS. Nothing in the Cloudflare or GitHub environments is copied, deliberately. A
//     backup that carries live credentials is a breach waiting for a misplaced disk.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// EVERY BYTE IS VERIFIED, NOT ASSUMED
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// A backup nobody has checked is a hope. Each EPUB is verified against the MD5 that Cloud
// Storage itself reports for the stored object — a real end-to-end check of the transfer,
// not a hash of the bytes against themselves. Any mismatch fails the whole run, loudly and
// non-zero, because a backup that is quietly half-right is worse than none: it is the one
// you will reach for.
//
// The manifest also records each master's Cloud Storage GENERATION. That number is not
// decoration — it IS the reading-position pin (docs/reading-position-pin.md). A restore
// that produces new generations drops every reader of that title from an exact resume
// position to an approximate one, so knowing the original is the difference between a
// restore and a re-upload.

import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mintToken } from '../rules-pull.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const BUCKET = 'calvary-scribblings.firebasestorage.app';
const PROJECT = 'calvary-scribblings';

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const SKIP_EPUBS = argv.includes('--skip-epubs');

// A UTC stamp, so runs from different machines sort together and never collide.
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = resolve(arg('--out') || resolve(ROOT, 'backups'), STAMP);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const md5b64 = (buf) => createHash('md5').update(buf).digest('base64');

const manifest = {
  takenAt: new Date().toISOString(),
  project: PROJECT,
  databaseUrl: DB,
  bucket: BUCKET,
  parts: {},
  notRecovered: [
    'Firebase Auth password hash parameters (console only — see RESTORE.md)',
    'Cloud Storage objects other than the master EPUBs',
    'The five Cloudflare Worker sources (see workers-external/README.md)',
    'Any secret in the Cloudflare Pages, GitHub Actions or Cloudflare dashboard environments',
  ],
};

await mkdir(OUT, { recursive: true });
console.log(`backup → ${OUT}\n`);

const token = await mintToken();

// ── 1. The database ────────────────────────────────────────────────────────────────────
// One GET of the root. At 13.3 MB this is a few seconds and gzips to a fraction of that.
// It is a POINT-IN-TIME read and not a transaction: RTDB has no snapshot isolation, so a
// write landing mid-read can be included or not. For a nightly backup that is fine and it
// is worth saying rather than implying otherwise.
process.stdout.write('database … ');
{
  const res = await fetch(`${DB}/.json?access_token=${token}`);
  if (!res.ok) throw new Error(`RTDB export failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const gz = gzipSync(raw, { level: 9 });
  await writeFile(resolve(OUT, 'rtdb.json.gz'), gz);
  const tree = JSON.parse(raw.toString('utf8'));
  manifest.parts.database = {
    file: 'rtdb.json.gz',
    rawBytes: raw.length,
    gzipBytes: gz.length,
    sha256Raw: sha256(raw),
    sha256Gzip: sha256(gz),
    topLevelNodes: Object.keys(tree).length,
    counts: {
      users: Object.keys(tree.users || {}).length,
      cms_stories: Object.keys(tree.cms_stories || {}).length,
      bookstore_purchases: Object.keys(tree.bookstore_purchases || {}).length,
      comments_threads: Object.keys(tree.comments || {}).length,
    },
  };
  console.log(`${(raw.length / 1048576).toFixed(2)} MB → ${(gz.length / 1048576).toFixed(2)} MB gzip, ${manifest.parts.database.topLevelNodes} nodes`);
}

// ── 2. The accounts ────────────────────────────────────────────────────────────────────
// Shelled out to firebase-tools rather than reimplemented: auth:export is the documented
// counterpart of auth:import, and a hand-rolled listUsers() dump is NOT interchangeable
// with it. Restoring is the whole point, so the export has to be in the shape the importer
// actually reads.
process.stdout.write('accounts … ');
{
  const file = resolve(OUT, 'auth-users.json');
  const r = spawnSync(
    'npx',
    ['firebase', 'auth:export', file, '--format=json', '--project', PROJECT],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: resolve(ROOT, 'serviceAccountKey.json') } }
  );
  if (r.status !== 0) throw new Error(`auth:export failed:\n${r.stderr || r.stdout}`);
  const buf = Buffer.from(await (await import('node:fs/promises')).readFile(file));
  const users = JSON.parse(buf.toString('utf8')).users || [];
  const withHash = users.filter((u) => u.passwordHash).length;
  manifest.parts.accounts = {
    file: 'auth-users.json',
    bytes: buf.length,
    sha256: sha256(buf),
    users: users.length,
    withPasswordHash: withHash,
    federatedOnly: users.length - withHash,
    warning: 'Hashes are inert without the project hash parameters — see RESTORE.md.',
  };
  console.log(`${users.length} accounts (${withHash} with a password hash, ${users.length - withHash} federated)`);
}

// ── 3. The master EPUBs ────────────────────────────────────────────────────────────────
// The sellable inventory. `allow read: if false` in storage.rules keeps every client out of
// these, so they are read with the service account through the JSON API — the same grant
// path functions/api/bookstore/stream.js signs URLs with.
if (SKIP_EPUBS) {
  console.log('epubs … skipped (--skip-epubs)');
  manifest.parts.epubs = { skipped: true };
} else {
  process.stdout.write('epubs … ');
  await mkdir(resolve(OUT, 'epubs'), { recursive: true });
  const listUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=&fields=items(name,size,md5Hash,generation,contentType),nextPageToken`;
  const objects = [];
  let pageToken;
  do {
    const res = await fetch(pageToken ? `${listUrl}&pageToken=${pageToken}` : listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`bucket list failed: ${res.status}`);
    const page = await res.json();
    objects.push(...(page.items || []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  const masters = objects.filter((o) => o.name.endsWith('/master.epub'));
  const files = [];
  let bad = 0;
  for (const o of masters) {
    const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(o.name)}?alt=media`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`download ${o.name} failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    // END-TO-END VERIFICATION: compare against the MD5 Cloud Storage reports for the STORED
    // object, not a hash of what we just downloaded against itself. A truncated transfer
    // fails here rather than sitting silently in the backup.
    const ok = md5b64(buf) === o.md5Hash;
    if (!ok) { bad++; console.error(`\n  ✗ CHECKSUM MISMATCH: ${o.name}`); }

    const safe = o.name.replace(/\//g, '__');
    await writeFile(resolve(OUT, 'epubs', safe), buf);
    files.push({
      object: o.name,
      file: `epubs/${safe}`,
      bytes: buf.length,
      sha256: sha256(buf),
      md5: o.md5Hash,
      verified: ok,
      // THE READING-POSITION PIN. Not decoration — see the header.
      generation: o.generation,
    });
  }
  manifest.parts.epubs = { count: files.length, totalBytes: files.reduce((s, f) => s + f.bytes, 0), files };
  if (bad) {
    await writeFile(resolve(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
    console.error(`\n✗ ${bad} of ${files.length} EPUBs failed verification. Backup is NOT trustworthy.`);
    process.exit(1);
  }
  console.log(`${files.length} masters, ${(manifest.parts.epubs.totalBytes / 1048576).toFixed(2)} MB, all verified against Cloud Storage MD5`);
}

await writeFile(resolve(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));

console.log(`
✓ backup complete — ${OUT}

  Verify it before you trust it:   node scripts/backup/rehearse.mjs ${OUT}

  A backup nobody has restored is a hope. The rehearsal restores into a scratch
  location and checks what came back; it changes nothing live.
`);
