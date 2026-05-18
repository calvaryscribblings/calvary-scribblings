#!/usr/bin/env node
// One-shot migration: move 20 hardcoded entries from
// calvary-scribblings-next/app/lib/stories.js into Firebase cms_stories/{slug}.
//
// For each story this script:
//   1. Skips if cms_stories/{slug} already exists (idempotent).
//   2. Reads stories/{slug}.html and extracts the <body> innerHTML.
//   3. Uploads calvary-scribblings-next/public/{cover} to Firebase Storage at
//      covers/{slug}_{cover filename}.
//   4. Writes cms_stories/{slug} via RTDB REST.
//
// Auth: same JWT + REST pattern as scripts/migrate-publishers-split.js, but
// reads service-account fields directly from calvary-scribblings-next/.env.local
// (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY). No
// firebase-admin dependency.
//
// Does NOT trigger Cloudflare Pages deploy or follower notifications.
//
// Run:
//   node scripts/migrate-hardcoded-stories.js --dry-run   # show what would happen
//   node scripts/migrate-hardcoded-stories.js             # do it

import { readFileSync, existsSync } from 'node:fs';
import { createSign, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(REPO_ROOT, 'calvary-scribblings-next/.env.local');
const STORIES_HTML_DIR = resolve(REPO_ROOT, 'stories');
const PUBLIC_DIR = resolve(REPO_ROOT, 'calvary-scribblings-next/public');

const DATABASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const STORAGE_BUCKET = 'calvary-scribblings.firebasestorage.app';

const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/devstorage.read_write',
].join(' ');

const AUTHORS = {
  'Tricia Ajax':    { uid: 'fPPw0MXT0SPc9fsYeyXpdH6ZKDy1', handle: 'tricia_ajax',        displayName: 'Tricia Ajax' },
  'Ufedo Adaji':    { uid: '6JduwshjOYM9sEVKH6PspSttnEH3', handle: '_fedajee_',          displayName: 'Ufedo-Ojo Adaji' },
  'Chioma Okonkwo': { uid: 'u6I4c3x5xVd5ZdeBOqSQ7JLqj0T2', handle: 'chioma',             displayName: 'chioma nnenna' },
  'Ikenna Okpara':  { uid: 'XaG6bTGqdDXh7VkBTw4y1H2d2s82', handle: 'byokpara',           displayName: 'Ikenna Okpara' },
  'Calvary':        { uid: 'Rq29LDmDSwY5cld6Q58Nyp0E79d2', handle: 'calvaryscribblings', displayName: 'Calvary Scribblings' },
};

const STORIES = [
  { slug: 'the-enabler',                       title: 'The Enabler',                                                      category: 'flash',        author: 'Ufedo Adaji',    cover: 'the-enabler-cover.jpeg',                    date: 'Jan 2026' },
  { slug: 'rise-and-shine',                    title: 'Rise and Shine',                                                   category: 'flash',        author: 'Ufedo Adaji',    cover: 'rise-and-shine-cover.jpeg',                 date: 'Jan 2026' },
  { slug: 'dont-worry',                        title: "Don't Worry",                                                      category: 'flash',        author: 'Ufedo Adaji',    cover: 'dont-worry-cover.jpeg',                     date: 'Jan 2026' },
  { slug: 'terms-and-conditions',              title: 'Terms and Conditions',                                             category: 'short',        author: 'Tricia Ajax',    cover: 'terms-and-conditions-cover.jpeg',           date: 'Jan 2026' },
  { slug: 'oscars-2026',                       title: 'The Oscar Showdowns',                                              category: 'news (Film)',  author: 'Chioma Okonkwo', cover: 'oscars-2026-cover.jpeg',                    date: 'Mar 2026' },
  { slug: 'how-to-make-peppersoup',            title: 'How to Make Peppersoup',                                           category: 'inspiring',    author: 'Ufedo Adaji',    cover: 'peppersoup-cover.jpeg',                     date: 'Jan 2026' },
  { slug: 'this-is-nigeria',                   title: 'This is Nigeria',                                                  category: 'news (Op-Ed)', author: 'Ikenna Okpara',  cover: 'this-is-nigeria-cover.jpeg',                date: 'Jan 2026' },
  { slug: 'london-tube-strike',                title: 'Another London Underground Strike!',                               category: 'news',         author: 'Chioma Okonkwo', cover: 'london-tube-strike-cover.jpeg',             date: 'Jan 2026' },
  { slug: 'the-bride-box-office',              title: 'Why The Bride Struggled at the Box Office',                        category: 'news (Film)',  author: 'Chioma Okonkwo', cover: 'the-bride-box-office-cover.jpeg',           date: 'Feb 2026' },
  { slug: '1967',                              title: '1967',                                                             category: 'short',        author: 'Ikenna Okpara',  cover: '1967-cover.jpeg',                           date: 'Jan 2026' },
  { slug: 'you-didnt-ask',                     title: "You Didn't Ask",                                                   category: 'short',        author: 'Tricia Ajax',    cover: 'you-didnt-ask-cover.jpg',                   date: 'Jan 2026' },
  { slug: 'macbook-neo',                       title: 'The All New MacBook Neo!',                                         category: 'news (Tech)',  author: 'Chioma Okonkwo', cover: 'macbook-neo-cover.PNG',                     date: 'Feb 2026' },
  { slug: 'netflix-harry-styles',              title: "Netflix to Stream Harry Styles' New Album",                        category: 'news',         author: 'Chioma Okonkwo', cover: 'netflix-harry-styles-cover.jpg',            date: 'Feb 2026' },
  { slug: 'paramount-wbd-plans',               title: 'Paramount Reveals Plans for the Future',                           category: 'news',         author: 'Calvary',        cover: 'paramount-wbd-plans-cover.jpg',             date: 'Feb 2026' },
  { slug: 'paramount-warner-bros-discovery',   title: 'Hollywood Reacts: Paramount Moves to Take Control of WBD',         category: 'news',         author: 'Chioma Okonkwo', cover: 'paramount-warner-bros-discovery-cover.jpg', date: 'Feb 2026' },
  { slug: 'the-girl-who-sang-through-the-dark',title: 'The Girl Who Sang Through the Dark',                               category: 'inspiring',    author: 'Tricia Ajax',    cover: 'the-girl-who-sang-through-the-dark-cover.jpg', date: 'Jan 2026' },
  { slug: 'john-davidson-bafta-tourettes',     title: 'The Man in the Middle: John Davidson',                             category: 'news',         author: 'Chioma Okonkwo', cover: 'john-davidson-bafta-cover.jpeg',            date: 'Mar 2026' },
  { slug: 'bafta-2026',                        title: 'BAFTA 2026: Winners...',                                           category: 'news',         author: 'Chioma Okonkwo', cover: 'bafta-2026-cover.webp',                     date: 'Mar 2026' },
  { slug: 'early',                             title: 'Early',                                                            category: 'short',        author: 'Calvary',        cover: 'early-cover.png',                           date: 'Jan 2026' },
  { slug: 'miss-lady',                         title: 'Miss Lady',                                                        category: 'flash',        author: 'Calvary',        cover: 'B4E36CD1-7C81-4ED0-BD27-63A125FDFD2D.png',  date: 'Jan 2026', contentEmpty: true },
];

function categoryMeta(cat) {
  if (cat === 'flash')     return { category: 'flash',     categoryName: 'Flash Fiction',  subcategory: '' };
  if (cat === 'short')     return { category: 'short',     categoryName: 'Short Story',    subcategory: '' };
  if (cat === 'inspiring') return { category: 'inspiring', categoryName: 'Inspiring',      subcategory: '' };
  if (cat === 'news')      return { category: 'news',      categoryName: 'News & Updates', subcategory: '' };
  const m = cat.match(/^news \(([^)]+)\)$/);
  if (m) return { category: 'news', categoryName: 'News & Updates', subcategory: m[1] };
  throw new Error(`Unknown category: ${cat}`);
}

function mimeFor(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpeg') || lower.endsWith('.jpg')) return 'image/jpeg';
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
  const fileEnv = parseEnvFile(ENV_PATH);
  const env = { ...fileEnv, ...process.env };
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

async function rtdbPut(path, token, body) {
  const url = `${DATABASE_URL}${path}.json?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RTDB PUT ${path} failed: ${res.status} ${await res.text()}`);
  return JSON.parse(await res.text());
}

async function uploadCover(coverFilename, slug, token) {
  // Upload via the GCS JSON API (storage.googleapis.com) so we authenticate by
  // IAM, not by Firebase Storage Rules — the firebasestorage.googleapis.com
  // endpoint returns 403 for service-account tokens against a default rule set.
  // We attach metadata.firebaseStorageDownloadTokens = <uuid> so the Firebase
  // download URL works without further rule changes.
  const src = resolve(PUBLIC_DIR, coverFilename);
  if (!existsSync(src)) throw new Error(`Cover not found: ${src}`);
  const bytes = readFileSync(src);
  const objectPath = `covers/${slug}_${coverFilename}`;
  const encoded = encodeURIComponent(objectPath);
  const downloadToken = randomUUID();
  const metadata = {
    name: objectPath,
    contentType: mimeFor(coverFilename),
    metadata: { firebaseStorageDownloadTokens: downloadToken },
  };
  const boundary = `cs-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeFor(coverFilename)}\r\n\r\n`,
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

function extractArticle(html) {
  // The prose lives inside <article class="article-content">…</article>. Using
  // <body> directly would drag in the site header, nav, cover banner, footer,
  // and Disqus block. Fall back to <body> only if no article wrapper exists.
  const art = html.match(/<article\b[^>]*class="[^"]*\barticle-content\b[^"]*"[^>]*>([\s\S]*?)<\/article>/i);
  if (art) return art[1].trim();
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!body) throw new Error('No <article class="article-content"> or <body> tag found in HTML');
  return body[1].trim();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`[migrate] ${dryRun ? 'DRY-RUN' : 'LIVE'} mode  (${STORIES.length} candidate stories)`);
  console.log('');

  let token = null;
  if (dryRun) {
    // For dry-run, anonymous reads suffice for the existence check (cms_stories
    // is publicly readable). Skip the token mint so a dry-run works even without
    // service-account creds locally.
    try {
      const sa = getServiceAccount();
      console.log(`[migrate] service-account loaded for ${sa.client_email} (token mint skipped in dry-run)`);
    } catch (e) {
      console.log(`[migrate] (no service-account in env; dry-run will use anonymous reads) — ${e.message}`);
    }
  } else {
    const sa = getServiceAccount();
    console.log('[migrate] minting access token…');
    token = await mintAccessToken(sa);
  }
  console.log('');

  let written = 0, skipped = 0, failed = 0;
  for (const story of STORIES) {
    try {
      const existing = await rtdbGet(`/cms_stories/${story.slug}`, token);
      if (existing) {
        console.log(`SKIP ${story.slug} — already in Firebase`);
        skipped++;
        continue;
      }

      let content = '';
      if (!story.contentEmpty) {
        const htmlPath = resolve(STORIES_HTML_DIR, `${story.slug}.html`);
        if (!existsSync(htmlPath)) throw new Error(`HTML not found: ${htmlPath}`);
        content = extractArticle(readFileSync(htmlPath, 'utf8'));
      }

      const coverSrc = resolve(PUBLIC_DIR, story.cover);
      if (!existsSync(coverSrc)) throw new Error(`Cover not found: ${coverSrc}`);

      const cat = categoryMeta(story.category);
      const author = AUTHORS[story.author];
      if (!author) throw new Error(`Unknown author key: ${story.author}`);

      let coverUrl;
      if (dryRun) {
        coverUrl = `<would upload covers/${story.slug}_${story.cover} → firebasestorage download URL>`;
      } else {
        coverUrl = await uploadCover(story.cover, story.slug, token);
      }

      const record = {
        title: story.title,
        author: author.displayName,
        authorHandle: author.handle,
        authorUid: author.uid,
        category: cat.category,
        categoryName: cat.categoryName,
        subcategory: cat.subcategory,
        date: story.date,
        content,
        cover: coverUrl,
        url: `/stories/${story.slug}`,
        published: true,
      };

      if (dryRun) {
        console.log(`DRY ${story.slug}:`);
        console.log(`    title:       ${record.title}`);
        console.log(`    author:      ${record.author}  (uid=${record.authorUid}  handle=${record.authorHandle})`);
        console.log(`    category:    ${record.category} / ${record.categoryName}${record.subcategory ? ` / ${record.subcategory}` : ''}`);
        console.log(`    date:        ${record.date}`);
        console.log(`    url:         ${record.url}`);
        console.log(`    published:   ${record.published}`);
        console.log(`    cover src:   public/${story.cover}  (${(readFileSync(coverSrc).length / 1024).toFixed(1)} KB)`);
        console.log(`    cover dest:  ${coverUrl}`);
        const preview = content ? `${content.replace(/\s+/g, ' ').slice(0, 120)}…` : '(empty)';
        console.log(`    content:     [${content.length} chars]  ${preview}`);
        written++;
      } else {
        await rtdbPut(`/cms_stories/${story.slug}`, token, record);
        console.log(`✅ ${story.slug} — uploaded cover + wrote CMS record`);
        written++;
      }
    } catch (e) {
      console.log(`❌ ${story.slug} — ERROR: ${e.message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`[migrate] DONE. ${dryRun ? 'would-write' : 'wrote'}=${written}  skipped=${skipped}  failed=${failed}`);
  if (dryRun) console.log('[migrate] Dry-run only — no Firebase writes performed.');
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err.message);
  process.exit(1);
});
