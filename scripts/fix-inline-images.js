#!/usr/bin/env node
// Follow-up to scripts/migrate-hardcoded-stories.js. Three of the 20 migrated
// stories have inline <img src="../filename.ext"> tags carried over from the
// legacy HTML files (where /stories/<slug>.html lived one level below the
// images). The relative paths happen to resolve in the current Next.js layout
// but are fragile.
//
// For each affected story:
//   1. GET cms_stories/{slug}/content
//   2. Discover every src="../filename" in the content
//   3. Upload calvary-scribblings-next/public/{filename} to Firebase Storage at
//      inline-images/{slug}/{filename} (GCS JSON API multipart upload, same
//      pattern as migrate-hardcoded-stories.js — IAM-auth bypasses Storage
//      Rules, downloadTokens metadata gives us a working Firebase URL).
//   4. Replace every "../{filename}" in the content with the new Storage URL.
//   5. PATCH cms_stories/{slug} with { content: <updated> }.
//
// Run:
//   node scripts/fix-inline-images.js --dry-run   # show what would change
//   node scripts/fix-inline-images.js             # do it

import { readFileSync, existsSync } from 'node:fs';
import { createSign, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(REPO_ROOT, 'calvary-scribblings-next/.env.local');
const PUBLIC_DIR = resolve(REPO_ROOT, 'calvary-scribblings-next/public');

const DATABASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const STORAGE_BUCKET = 'calvary-scribblings.firebasestorage.app';

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/devstorage.read_write',
].join(' ');

const SLUGS = ['oscars-2026', 'how-to-make-peppersoup', 'macbook-neo'];

function mimeFor(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpeg') || lower.endsWith('.jpg') || lower.endsWith('.jpeg.jpg')) return 'image/jpeg';
  if (lower.endsWith('.png'))  return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  throw new Error(`Unknown image type: ${filename}`);
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function getServiceAccount() {
  const env = { ...parseEnvFile(ENV_PATH), ...process.env };
  const project_id   = env.FIREBASE_PROJECT_ID;
  const client_email = env.FIREBASE_CLIENT_EMAIL;
  let   private_key  = env.FIREBASE_PRIVATE_KEY;
  if (!project_id || !client_email || !private_key) {
    throw new Error(`Missing service-account fields. Looked in env and ${ENV_PATH}. Need FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.`);
  }
  if (private_key.includes('\\n')) private_key = private_key.replace(/\\n/g, '\n');
  return { project_id, client_email, private_key };
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function mintAccessToken(sa) {
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
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

async function rtdbGet(path, token) {
  const url = `${DATABASE_URL}${path}.json${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RTDB GET ${path} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function rtdbPatch(path, token, body) {
  const url = `${DATABASE_URL}${path}.json?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RTDB PATCH ${path} failed: ${res.status} ${await res.text()}`);
  return JSON.parse(await res.text());
}

async function uploadInlineImage(filename, slug, token) {
  const src = resolve(PUBLIC_DIR, filename);
  if (!existsSync(src)) throw new Error(`File not found: ${src}`);
  const bytes = readFileSync(src);
  const objectPath = `inline-images/${slug}/${filename}`;
  const encoded = encodeURIComponent(objectPath);
  const downloadToken = randomUUID();
  const contentType = mimeFor(filename);
  const metadata = {
    name: objectPath,
    contentType,
    metadata: { firebaseStorageDownloadTokens: downloadToken },
  };
  const boundary = `cs-inline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([head, bytes, tail]);

  const url = `https://storage.googleapis.com/upload/storage/v1/b/${STORAGE_BUCKET}/o?uploadType=multipart`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encoded}?alt=media&token=${downloadToken}`;
}

function findRelativeImagePaths(content) {
  // Match src="../filename" or src='../filename'. Dedupe — a file referenced
  // twice in the same story only needs uploading once.
  const re = /src=["']\.\.\/([^"']+)["']/g;
  const out = new Set();
  let m;
  while ((m = re.exec(content)) !== null) out.add(m[1]);
  return [...out];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[fix-inline-images] ${dryRun ? 'DRY-RUN' : 'LIVE'} mode  (${SLUGS.length} stories)`);
  console.log('');

  let token = null;
  if (dryRun) {
    try {
      const sa = getServiceAccount();
      console.log(`[fix-inline-images] service-account loaded for ${sa.client_email} (token mint skipped in dry-run)`);
    } catch (e) {
      console.log(`[fix-inline-images] (no service-account; dry-run uses anonymous reads) — ${e.message}`);
    }
  } else {
    const sa = getServiceAccount();
    console.log('[fix-inline-images] minting access token…');
    token = await mintAccessToken(sa);
  }
  console.log('');

  let totalImages = 0, uploaded = 0, replacements = 0, failed = 0, patched = 0;
  for (const slug of SLUGS) {
    console.log(`=== ${slug} ===`);
    try {
      const content = await rtdbGet(`/cms_stories/${slug}/content`, token);
      if (typeof content !== 'string') throw new Error(`content is not a string (got ${typeof content})`);

      const filenames = findRelativeImagePaths(content);
      console.log(`  found ${filenames.length} unique inline image reference(s)`);
      if (filenames.length === 0) { console.log(''); continue; }

      let updated = content;
      for (const filename of filenames) {
        const src = resolve(PUBLIC_DIR, filename);
        if (!existsSync(src)) {
          console.log(`  ❌ ${slug}/${filename} — source not found at public/${filename}`);
          failed++;
          continue;
        }
        const sizeKb = (readFileSync(src).length / 1024).toFixed(1);
        totalImages++;

        let storageUrl;
        if (dryRun) {
          storageUrl = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(`inline-images/${slug}/${filename}`)}?alt=media&token=<UUID>`;
          console.log(`  DRY ${slug}/${filename}  (${sizeKb} KB)`);
          console.log(`      → ${storageUrl}`);
        } else {
          storageUrl = await uploadInlineImage(filename, slug, token);
          uploaded++;
          console.log(`  ✅ ${slug}/${filename}  (${sizeKb} KB)`);
          console.log(`      → ${storageUrl}`);
        }

        const oldSrc = `../${filename}`;
        const occurrences = updated.split(oldSrc).length - 1;
        updated = updated.split(oldSrc).join(storageUrl);
        replacements += occurrences;
        console.log(`      replaced ${occurrences} occurrence(s) of "${oldSrc}"`);
      }

      const sizeBefore = content.length;
      const sizeAfter = updated.length;
      console.log(`  content: ${sizeBefore} → ${sizeAfter} chars  (delta ${sizeAfter - sizeBefore >= 0 ? '+' : ''}${sizeAfter - sizeBefore})`);

      // Sanity check: no stray ../ refs remain (only counts the ones we tried).
      const stillRelative = findRelativeImagePaths(updated);
      if (stillRelative.length > 0) {
        console.log(`  ⚠️  ${stillRelative.length} relative ref(s) remain after rewrite: ${stillRelative.join(', ')}`);
      }

      if (!dryRun) {
        await rtdbPatch(`/cms_stories/${slug}`, token, { content: updated });
        patched++;
        console.log(`  ✅ PATCH cms_stories/${slug} — content updated`);
      } else {
        console.log(`  DRY (would PATCH cms_stories/${slug} with updated content)`);
      }
    } catch (e) {
      console.log(`  ❌ ${slug} — ERROR: ${e.message}`);
      failed++;
    }
    console.log('');
  }

  console.log(`[fix-inline-images] DONE.  images=${totalImages}  ${dryRun ? 'would-upload' : 'uploaded'}=${dryRun ? totalImages : uploaded}  src-replacements=${replacements}  ${dryRun ? 'would-patch' : 'patched'}=${dryRun ? SLUGS.length : patched}  failed=${failed}`);
  if (dryRun) console.log('[fix-inline-images] Dry-run only — no Firebase writes performed.');
}

main().catch((err) => {
  console.error('[fix-inline-images] FAILED:', err.message);
  process.exit(1);
});
