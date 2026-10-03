#!/usr/bin/env node
// AN AUTHOR'S COPY — one private book on one account, with no listing and no sale. W33.
//
//   node scripts/bookstore/author-copy.mjs status <titleId>
//   node scripts/bookstore/author-copy.mjs stage  <titleId> --from <dir> [--apply]
//   node scripts/bookstore/author-copy.mjs grant  <titleId> [--apply]
//   node scripts/bookstore/author-copy.mjs revoke <titleId> [--apply] [--keep-files]
//
// Dry run by default; --apply writes. Credentials: FIREBASE_SERVICE_ACCOUNT (the JSON itself — a
// Codespaces secret works) or FIREBASE_SERVICE_ACCOUNT_PATH (default serviceAccountKey.json).
//
// WHAT IT IS. A comp, exactly as founder-comps.mjs grants one — bookstore_purchases/{uid}/{titleId}
// with status 'active' and source 'comp' — so My Library, the app's shelf and /api/bookstore/stream
// read it as any book the reader owns, and every exclusion in the tree (purchaseSource.js) already
// keeps it out of readership, sales, statements and signals. compGrant 'author-copy' is how revoke
// finds it and nothing else.
//
// WHAT IT IS NOT. There is NO bookstore_titles record, ever, while the book is private: that node
// is `.read: true`, so any record in it, in any status, is public. No catalogue number, price,
// genre or sample. No amount, currency or provider reference on the record. This never touches
// the webhooks, bookstore_readership, salesCount, bookstore_titles, bookstore_titles_deleted,
// bookstore_signals or bookstore_sections, and it never makes a sample.epub.
//
// THE BYTES AND THE COVER live beside each other under bookstore_epubs/<titleId>/:
//   master.epub   `allow read: if false` in storage.rules; served only by stream.js's signed URL.
//                 Uploaded with NO download token — a token would be a public link to the book.
//   cover.jpg     matched by NO storage rule, so denied to every client; reachable only through
//                 the fresh download token this writes, which becomes the record's coverUrl. Never
//                 bookstore_covers/ — that prefix is public-read and its paths are guessable.
//
// THE SPECIFICS ARE NOT IN THIS REPO. The repo is public. The title, author and files come from a
// private folder outside any work tree, read at run time:
//   ~/calvary-private/author-copies/<titleId>/{handover.json, master.epub, cover.jpg}
//   handover.json = { "titleId": "...", "title": "...", "author": "..." }
// `stage` moves the two files there from wherever they were dropped (refusing to overwrite), so a
// file that landed inside a repo leaves it before anything else happens. Backups go to
// ~/calvary-backups/author-copy/. Nothing this prints is a token: the cover's link is reported as
// set, never shown.
//
// WHO. ALLOWED_UIDS from founder-comps.mjs, imported rather than restated. Another uid needs a
// ruling and an edit there.

import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync, statSync, copyFileSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { ALLOWED_UIDS } from './founder-comps.mjs';
import { COMP_SOURCE, isComp, holdersOf } from '../../app/lib/bookstore/purchaseSource.js';
import { RESERVED_TITLE_SLUGS } from '../../app/lib/bookstore/schema.js';

export const AUTHOR_COPY_GRANT = 'author-copy';
export const EPUB_MAX_BYTES = 50 * 1024 * 1024;   // storage.rules' cap on master.epub
export const COVER_MAX_BYTES = 5 * 1024 * 1024;   // the house image cap
export const EPUB_MIME = 'application/epub+zip';
export const COVER_MIME = 'image/jpeg';
const DATABASE_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
export const STORAGE_BUCKET = 'calvary-scribblings.firebasestorage.app';
export const PRIVATE_ROOT = process.env.AUTHOR_COPY_PRIVATE_DIR || join(homedir(), 'calvary-private', 'author-copies');
export const BACKUP_ROOT = process.env.AUTHOR_COPY_BACKUP_DIR || join(homedir(), 'calvary-backups', 'author-copy');

// A title id is a catalogue slug: kebab-case, the shape schema.js requires of every title.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const epubPath = (titleId) => `bookstore_epubs/${titleId}/master.epub`;
export const coverPath = (titleId) => `bookstore_epubs/${titleId}/cover.jpg`;
export const purchasePath = (uid, titleId) => `bookstore_purchases/${uid}/${titleId}`;
export const tokenUrl = (path, token) =>
  `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
/** The two unsigned addresses a stranger could try. Both must answer 403. */
export const unsignedUrls = (path) => [
  `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(path)}?alt=media`,
  `https://storage.googleapis.com/${STORAGE_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`,
];

// ── the files ───────────────────────────────────────────────────────────────────────────────

/**
 * An EPUB as the OCF container spec requires it: a zip whose FIRST entry is `mimetype`, STORED
 * (uncompressed), reading exactly application/epub+zip; with META-INF/container.xml; within the
 * master.epub cap. Pure — reads only the buffer. Returns the list of what is wrong (empty = good).
 */
export function checkEpub(buf) {
  const errs = [];
  if (!Buffer.isBuffer(buf) || buf.length < 30) return ['not a zip (too short)'];
  if (buf.length > EPUB_MAX_BYTES) errs.push(`larger than ${EPUB_MAX_BYTES / 1048576} MB (${buf.length} bytes)`);
  if (buf.readUInt32LE(0) !== 0x04034b50) return [...errs, 'not a zip (no local file header at byte 0)'];
  const method = buf.readUInt16LE(8);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const name = buf.subarray(30, 30 + nameLen).toString('latin1');
  if (name !== 'mimetype') errs.push(`first entry is "${name}", not "mimetype"`);
  else {
    if (method !== 0) errs.push('mimetype is compressed; it must be stored');
    const size = buf.readUInt32LE(18);
    const body = buf.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + size).toString('latin1');
    if (body !== EPUB_MIME) errs.push(`mimetype reads "${body.slice(0, 40)}", not ${EPUB_MIME}`);
  }
  // The central directory, from the end-of-central-directory record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [...errs, 'no zip central directory'];
  const entries = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < entries && at + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) { errs.push('corrupt zip central directory'); break; }
    const nl = buf.readUInt16LE(at + 28), xl = buf.readUInt16LE(at + 30), cl = buf.readUInt16LE(at + 32);
    names.push(buf.subarray(at + 46, at + 46 + nl).toString('utf8'));
    at += 46 + nl + xl + cl;
  }
  if (names[0] !== undefined && names[0] !== 'mimetype') errs.push('mimetype is not the first entry in the central directory');
  if (!names.includes('META-INF/container.xml')) errs.push('META-INF/container.xml is missing');
  return errs;
}

/** A JPEG (SOI + a marker, EOI at the end) within the cover cap. Pure. */
export function checkJpeg(buf) {
  const errs = [];
  if (!Buffer.isBuffer(buf) || buf.length < 4) return ['not a JPEG (too short)'];
  if (buf.length > COVER_MAX_BYTES) errs.push(`larger than ${COVER_MAX_BYTES / 1048576} MB (${buf.length} bytes)`);
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) errs.push('not a JPEG (no SOI marker)');
  let end = buf.length;
  while (end > 2 && (buf[end - 1] === 0x00 || buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) end--;
  if (!(buf[end - 2] === 0xff && buf[end - 1] === 0xd9)) errs.push('not a complete JPEG (no EOI marker)');
  return errs;
}

/** The handover's shape. Pure. */
export function checkHandover(h, titleId) {
  const errs = [];
  if (!h || typeof h !== 'object' || Array.isArray(h)) return ['handover.json is not an object'];
  if (h.titleId !== titleId) errs.push('handover.json names a different titleId');
  for (const k of ['title', 'author']) if (typeof h[k] !== 'string' || !h[k].trim()) errs.push(`handover.json has no ${k}`);
  return errs;
}

// ── the paths ───────────────────────────────────────────────────────────────────────────────

/** The git work tree a path sits in, or null. Walks up looking for `.git`. */
export function workTreeOf(p) {
  let d = resolve(p);
  try { d = realpathSync(d); } catch { /* not yet created: judge the path as written */ }
  for (;;) {
    if (existsSync(join(d, '.git'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** A refusal when a private path is inside ANY work tree — the repos are surfaces. */
export function refuseInsideWorkTree(p, label) {
  const tree = workTreeOf(p);
  return tree ? `${label} is inside the work tree ${tree}; it must live outside every repo` : null;
}

// ── the plans (pure) ────────────────────────────────────────────────────────────────────────

/** The one record a grant writes. No money field, no provider field — absent, not null. */
export function authorCopyRecord({ titleId, handover, coverUrl, now }) {
  return {
    status: 'active',
    source: COMP_SOURCE,
    compGrant: AUTHOR_COPY_GRANT,
    compGrantedAt: now,
    // "Added to the library" — the shelf orders by it. Not a sale date; no sale happened.
    purchasedAt: now,
    slug: titleId,
    title: handover.title.trim(),
    author: handover.author.trim(),
    coverUrl,
  };
}

/**
 * Every reason a grant must not happen. Pure: the caller reads the world, this decides.
 * @returns string[] — empty means the grant may proceed
 */
export function grantRefusals({ uid, titleId, titleDoc, tombstone, mine, epubExists, coverExists }) {
  const why = [];
  if (!ALLOWED_UIDS.includes(uid)) why.push('the uid is not an account the ruling covers');
  if (typeof titleId !== 'string' || !SLUG_RE.test(titleId) || titleId.length > 128) why.push('the titleId is not a kebab-case slug');
  if (RESERVED_TITLE_SLUGS.includes(titleId)) why.push('the slug is reserved for a Book Store room');
  if (tombstone != null) why.push('the slug is reserved: a deleted title left a tombstone at bookstore_titles_deleted');
  if (titleDoc != null) why.push('bookstore_titles has a record for this id — a private copy must have none');
  if (mine && typeof mine === 'object' && mine[titleId] != null) why.push('the account already holds a record for this title');
  if (epubExists) why.push('an object already exists at the master.epub path');
  if (coverExists) why.push('an object already exists at the cover.jpg path');
  return why;
}

/** Is this record the author copy revoke may remove? Exactly that, and nothing else. */
export const isAuthorCopy = (rec) => isComp(rec) && rec.compGrant === AUTHOR_COPY_GRANT;

/**
 * What a revoke does. Pure.
 *   purchases  the WHOLE bookstore_purchases node, as read (for the holder count after removal)
 * @returns { refusals, update, deleteFiles, holdersAfter }
 */
export function planRevoke({ uid, titleId, purchases, titleDoc, keepFiles }) {
  const rec = purchases?.[uid]?.[titleId] ?? null;
  if (!isAuthorCopy(rec)) {
    return { refusals: [rec == null ? 'the account holds no record for this title' : 'the record is not an author copy (a sale or another comp) — left exactly as it is'], update: {}, deleteFiles: false, holdersAfter: null };
  }
  const after = { ...purchases, [uid]: { ...purchases[uid] } };
  delete after[uid][titleId];
  const holdersAfter = holdersOf(after, titleId);
  return {
    refusals: [],
    update: { [purchasePath(uid, titleId)]: null },
    deleteFiles: !keepFiles && holdersAfter.count === 0 && titleDoc == null,
    holdersAfter,
  };
}

// ── I/O ─────────────────────────────────────────────────────────────────────────────────────

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  return JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 'serviceAccountKey.json', 'utf8'));
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function backup(titleId, cmd, apply, body) {
  const refusal = refuseInsideWorkTree(BACKUP_ROOT, 'the backup folder');
  if (refusal) throw new Error(refusal);
  mkdirSync(BACKUP_ROOT, { recursive: true, mode: 0o700 });
  const p = join(BACKUP_ROOT, `${stamp()}-${titleId}-${cmd}${apply ? '-apply' : '-dry-run'}.json`);
  writeFileSync(p, JSON.stringify(body, null, 2), { mode: 0o600 });
  return p;
}

async function connect() {
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  const { getStorage } = await import('firebase-admin/storage');
  const app = initializeApp({ credential: cert(loadServiceAccount()), databaseURL: DATABASE_URL, storageBucket: STORAGE_BUCKET });
  return { db: getDatabase(app), bucket: getStorage(app).bucket() };
}

const val = async (db, p) => (await db.ref(p).get()).val();

async function objectState(bucket, path) {
  const f = bucket.file(path);
  const [exists] = await f.exists();
  if (!exists) return { exists: false };
  const [m] = await f.getMetadata();
  return { exists: true, contentType: m.contentType, size: Number(m.size), hasToken: !!m.metadata?.firebaseStorageDownloadTokens };
}

async function statusOf(uid, titleId, { db, bucket }) {
  const [purchases, titleDoc, tombstone, readership] = await Promise.all([
    val(db, 'bookstore_purchases'), val(db, `bookstore_titles/${titleId}`),
    val(db, `bookstore_titles_deleted/${titleId}`), val(db, `bookstore_readership/${titleId}`),
  ]);
  const rec = purchases?.[uid]?.[titleId] ?? null;
  return {
    record: rec ? { status: rec.status, source: rec.source ?? null, compGrant: rec.compGrant ?? null, keys: Object.keys(rec).sort(), coverUrl: rec.coverUrl ? 'set (not shown)' : null } : null,
    catalogueRecord: titleDoc != null, tombstone: tombstone != null, readershipEntry: readership != null,
    master: await objectState(bucket, epubPath(titleId)),
    cover: await objectState(bucket, coverPath(titleId)),
    holders: holdersOf(purchases, titleId),
  };
}

async function httpStatus(url) {
  try { return (await fetch(url, { redirect: 'manual' })).status; } catch (e) { return `error ${e.message}`; }
}

function readPrivate(titleId) {
  const dir = join(PRIVATE_ROOT, titleId);
  const refusal = refuseInsideWorkTree(dir, 'the private folder');
  if (refusal) throw new Error(refusal);
  const need = ['handover.json', 'master.epub', 'cover.jpg'].filter((f) => !existsSync(join(dir, f)));
  if (need.length) throw new Error(`missing in ${dir}: ${need.join(', ')}`);
  return {
    dir,
    handover: JSON.parse(readFileSync(join(dir, 'handover.json'), 'utf8')),
    epub: readFileSync(join(dir, 'master.epub')),
    cover: readFileSync(join(dir, 'cover.jpg')),
  };
}

/** Move the two files out of wherever they were dropped, into the private folder. */
function stage(titleId, from, apply) {
  const dir = join(PRIVATE_ROOT, titleId);
  const refusal = refuseInsideWorkTree(dir, 'the private folder');
  if (refusal) throw new Error(refusal);
  const moves = ['master.epub', 'cover.jpg'].map((f) => ({ f, src: resolve(from, f), dst: join(dir, f) }));
  for (const m of moves) {
    if (!existsSync(m.src)) throw new Error(`no ${m.f} in ${from}`);
    if (existsSync(m.dst)) throw new Error(`${m.dst} already exists — refusing to overwrite`);
  }
  for (const m of moves) console.log(`  ${apply ? 'move' : 'would move'} ${m.f} (${statSync(m.src).size} bytes) → ${dir}`);
  if (!apply) return console.log('\nDRY RUN — nothing moved. Add --apply.');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const m of moves) {
    const before = sha256(readFileSync(m.src));
    copyFileSync(m.src, m.dst);
    if (sha256(readFileSync(m.dst)) !== before) throw new Error(`${m.f} did not copy intact — the original is left where it was`);
    unlinkSync(m.src);
  }
  console.log('\n✓ moved; the originals are gone from the drop folder.');
}

async function grant(uid, titleId, apply) {
  const p = readPrivate(titleId);
  const fileErrs = [
    ...checkHandover(p.handover, titleId),
    ...checkEpub(p.epub).map((e) => `master.epub: ${e}`),
    ...checkJpeg(p.cover).map((e) => `cover.jpg: ${e}`),
  ];
  if (fileErrs.length) { for (const e of fileErrs) console.error(`  ✗ ${e}`); throw new Error('the files did not pass; nothing was read or written'); }
  console.log(`  ✓ files: master.epub ${p.epub.length} bytes (EPUB container valid), cover.jpg ${p.cover.length} bytes`);

  const fb = await connect();
  const { db, bucket } = fb;
  const [titleDoc, tombstone, mine, readershipBefore] = await Promise.all([
    val(db, `bookstore_titles/${titleId}`), val(db, `bookstore_titles_deleted/${titleId}`),
    val(db, `bookstore_purchases/${uid}`), val(db, 'bookstore_readership'),
  ]);
  const [epubExists] = await bucket.file(epubPath(titleId)).exists();
  const [coverExists] = await bucket.file(coverPath(titleId)).exists();
  const refusals = grantRefusals({ uid, titleId, titleDoc, tombstone, mine, epubExists, coverExists });
  const bp = backup(titleId, 'grant', apply, { uid, titleId, before: mine?.[titleId] ?? null, readershipBefore, refusals, epubSha256: sha256(p.epub), coverSha256: sha256(p.cover) });
  console.log(`grant ${titleId} → an allowed account. Backup: ${bp}`);
  if (refusals.length) { for (const r of refusals) console.error(`  ✗ REFUSED: ${r}`); throw new Error('refused — nothing written'); }
  console.log(`  + ${epubPath(titleId)} (no download token)\n  + ${coverPath(titleId)} (a fresh download token)\n  + ${purchasePath('<uid>', titleId)} (source comp, compGrant ${AUTHOR_COPY_GRANT})`);
  if (!apply) { console.log('\nDRY RUN — nothing written. Add --apply.'); return; }

  // Uploads: ifGenerationMatch 0 means "only if nothing is there" — a race cannot overwrite.
  const created = [];
  const token = randomUUID();
  try {
    await bucket.file(epubPath(titleId)).save(p.epub, { resumable: false, contentType: EPUB_MIME, preconditionOpts: { ifGenerationMatch: 0 } });
    created.push(epubPath(titleId));
    await bucket.file(coverPath(titleId)).save(p.cover, {
      resumable: false, contentType: COVER_MIME, preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });
    created.push(coverPath(titleId));
    const record = authorCopyRecord({ titleId, handover: p.handover, coverUrl: tokenUrl(coverPath(titleId), token), now: Date.now() });
    // The record, only where there is none — a transaction, so a write that raced this one wins.
    const tx = await db.ref(purchasePath(uid, titleId)).transaction((cur) => (cur === null ? record : undefined));
    if (!tx.committed) throw new Error('a record appeared at the purchase path during the run');
    created.push('record');
    await verifyGrant({ uid, titleId, record, readershipBefore, token, db, bucket });
  } catch (e) {
    if (!created.includes('record')) {
      for (const path of created) await bucket.file(path).delete().catch(() => {});
      console.error(`  ↩ rolled back ${created.length} upload(s); no record was written`);
    }
    throw e;
  }
}

async function verifyGrant({ uid, titleId, record, readershipBefore, token, db, bucket }) {
  const checks = [];
  const ok = (name, pass) => { checks.push(pass); console.log(`  ${pass ? '✓' : '✗'} ${name}`); };
  ok('the record reads back as written', isDeepStrictEqual(await val(db, purchasePath(uid, titleId)), record));
  ok('the record carries no amount, currency or provider reference', !['amount', 'currency', 'stripeSessionId', 'stripePaymentIntent', 'paystackRef'].some((k) => k in record));
  ok('bookstore_readership is exactly as it was', isDeepStrictEqual(await val(db, 'bookstore_readership'), readershipBefore));
  ok('no bookstore_titles record exists', (await val(db, `bookstore_titles/${titleId}`)) == null);
  const m = await objectState(bucket, epubPath(titleId));
  ok(`master.epub exists as ${EPUB_MIME}, with no download token`, m.exists && m.contentType === EPUB_MIME && !m.hasToken);
  const c = await objectState(bucket, coverPath(titleId));
  ok(`cover.jpg exists as ${COVER_MIME}`, c.exists && c.contentType === COVER_MIME);
  for (const path of [epubPath(titleId), coverPath(titleId)]) {
    for (const u of unsignedUrls(path)) ok(`unsigned GET of ${path.split('/').pop()} (${new URL(u).host}) → 403`, (await httpStatus(u)) === 403);
  }
  ok('the cover\'s token link → 200', (await httpStatus(tokenUrl(coverPath(titleId), token))) === 200);
  if (!checks.every(Boolean)) throw new Error('verification failed — see above. Run `status` and, if needed, `revoke`.');
  console.log('\n✓ granted, read back and verified.');
}

async function revoke(uid, titleId, apply, keepFiles) {
  const fb = await connect();
  const { db, bucket } = fb;
  const [purchases, titleDoc] = await Promise.all([val(db, 'bookstore_purchases'), val(db, `bookstore_titles/${titleId}`)]);
  const plan = planRevoke({ uid, titleId, purchases, titleDoc, keepFiles });
  const bp = backup(titleId, 'revoke', apply, { uid, titleId, before: purchases?.[uid]?.[titleId] ?? null, plan: { ...plan, update: Object.keys(plan.update) } });
  console.log(`revoke ${titleId}. Backup: ${bp}`);
  if (plan.refusals.length) { for (const r of plan.refusals) console.error(`  ✗ REFUSED: ${r}`); throw new Error('refused — nothing written'); }
  console.log(`  - ${purchasePath('<uid>', titleId)}`);
  console.log(plan.deleteFiles
    ? `  - ${epubPath(titleId)}\n  - ${coverPath(titleId)}`
    : `  = the files stay (${keepFiles ? '--keep-files' : `holders after: ${plan.holdersAfter.count}${titleDoc != null ? ', and a catalogue record exists' : ''}`})`);
  if (!apply) { console.log('\nDRY RUN — nothing written. Add --apply.'); return; }
  // Delete only if it is STILL the author copy at the moment of writing.
  const tx = await db.ref(purchasePath(uid, titleId)).transaction((cur) => (isAuthorCopy(cur) ? null : undefined));
  if (!tx.committed) throw new Error('the record changed during the run — nothing removed');
  if (plan.deleteFiles) {
    // Re-count holders after the record is gone, against the live node, before touching bytes.
    const again = holdersOf(await val(db, 'bookstore_purchases'), titleId);
    if (again.count === 0 && (await val(db, `bookstore_titles/${titleId}`)) == null) {
      for (const path of [epubPath(titleId), coverPath(titleId)]) await bucket.file(path).delete({ ignoreNotFound: true });
      console.log('  - files removed');
    } else console.log(`  = files kept: a holder or a catalogue record appeared (${again.count} holder(s))`);
  }
  console.log('\n✓ revoked.');
}

async function main() {
  const argv = process.argv.slice(2);
  const [cmd, titleId] = argv;
  const apply = argv.includes('--apply');
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const uid = flag('--uid') || ALLOWED_UIDS[0];
  if (!['status', 'stage', 'grant', 'revoke'].includes(cmd) || !titleId) {
    console.error('usage: author-copy.mjs status|stage|grant|revoke <titleId> [--apply] [--from <dir>] [--keep-files]');
    process.exit(2);
  }
  if (!SLUG_RE.test(titleId)) throw new Error('the titleId is not a kebab-case slug');
  if (!ALLOWED_UIDS.includes(uid)) throw new Error('the uid is not an account the ruling covers');
  if (cmd === 'stage') return stage(titleId, flag('--from') || '.', apply);
  if (cmd === 'grant') return grant(uid, titleId, apply);
  if (cmd === 'revoke') return revoke(uid, titleId, apply, argv.includes('--keep-files'));
  console.log(JSON.stringify(await statusOf(uid, titleId, await connect()), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (e) => { console.error(e.message || e); process.exit(1); });
}
