// CARRY SAVED PLACES ACROSS A REPLACED MASTER — the write mode of map-positions.mjs.
//
//   node scripts/epub-repair/carry-over.mjs --title <titleId> --old <original.epub> --new <repair.epub> \
//        [--old-generation <g>]   default: the live master's generation (true BEFORE a swap)
//        [--new-generation <g>]   required with --apply
//        [--slug <slug>]          the ribbons' key; default: the title record's slug
//        [--backup-dir <dir>]     default: the folder holding --old
//        [--apply]                write. Without it, nothing is written (the default).
//
// --apply refuses unless the live master's generation IS --new-generation: the records are
// moved to a file that is already being served, never to one that might not be.
//
// For every saved place of the title (positions: bookstore_reading_progress/*/{titleId};
// ribbons: readerBookmarks/*/{slug}/*):
//
//   pinned to the new generation   → leave (already carried, or taken in the new file)
//   pinned to the old generation   → kept, mapped or landed by W42's rules (map-positions.mjs);
//                                    written with epubVersion = new
//   unpinned                       → whichFile(): the file its CFI resolves in AND its own stored
//                                    fraction agrees with. Old → as pinned-old. New → leave.
//                                    Neither → leave and report.
//   pinned to anything else        → leave and report
//   no cfi                         → leave (a fraction-only record already reads by fraction)
//
// The written fraction is the stored one shifted by the mapping's own delta (new estimate − old
// estimate), clamped to 0–1: the reader's pagination is kept, only the structure is corrected.
// A ribbon's label is rewritten from the new contents when the ribbon changes file.
//
// SAFETY. Every record to be written is backed up first (outside the repo). Each write is a
// REST PUT with `if-match` on the ETag read with the record, so a reader's save in between wins
// (412) and is reported, never overwritten. Every written record is re-read and compared. A
// second run leaves what it carried (now pinned new) and picks up anything a session still on
// the old file saved since (pinned old again).
//
// Output: record letters, files, element indices, results, fractions. Never a path with an
// account in it, never a line of the book, never a stored label.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapPositions } from './map-positions.mjs';
import { outsideRepo, args } from './paths.mjs';

export const PROD_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
export const STORAGE_BUCKET = 'calvary-scribblings.firebasestorage.app';
export const masterPath = (titleId) => `bookstore_epubs/${titleId}/master.epub`;

/** How far a stored fraction may sit from a file's estimate and still say "taken in this file". */
export const AGREE = 0.02;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const round = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Which file was an UNPINNED record taken in? The one its CFI resolves in and whose estimate
 * agrees with the record's own fraction (within AGREE). If both do, the closer one. Pure.
 * Returns { file: 'old' | 'new' | null, dOld, dNew }.
 */
export function whichFile(storedFraction, probe) {
  const d = (p) => (p?.resolves && typeof storedFraction === 'number' && typeof p.fraction === 'number'
    ? Math.abs(storedFraction - p.fraction) : null);
  const dOld = d(probe?.old);
  const dNew = d(probe?.new);
  const okOld = dOld != null && dOld <= AGREE;
  const okNew = dNew != null && dNew <= AGREE;
  let file = null;
  if (okOld && okNew) file = dNew < dOld ? 'new' : 'old';
  else if (okOld) file = 'old';
  else if (okNew) file = 'new';
  return { file, dOld, dNew };
}

/**
 * The decision for one record. Pure.
 *   rec:    { kind, value }            the stored record as read
 *   mapped: map-positions' result for value.cfi (with .probe), or undefined if no cfi
 * Returns { action: 'write' | 'leave', why, from?, next? }.
 */
export function decide(rec, mapped, { oldGen, newGen }) {
  const v = rec.value || {};
  if (typeof v.cfi !== 'string' || !v.cfi) return { action: 'leave', why: 'no cfi' };
  const pin = typeof v.epubVersion === 'string' && v.epubVersion ? v.epubVersion : null;
  let from = null;
  if (pin === newGen) return { action: 'leave', why: 'pinned new' };
  if (pin === oldGen) from = 'pinned old';
  else if (pin) return { action: 'leave', why: 'pinned other' };
  else {
    const w = whichFile(v.fraction, mapped?.probe);
    if (w.file === 'new') return { action: 'leave', why: 'unpinned, read in the new file', which: w };
    if (w.file !== 'old') return { action: 'leave', why: 'unpinned, no file agrees', which: w };
    from = 'unpinned, read in the old file';
  }
  if (!mapped || !['kept', 'mapped', 'landed'].includes(mapped.result) || !mapped.roundTrip) {
    return { action: 'leave', why: `unmappable (${mapped?.result ?? 'no result'})`, from };
  }
  if (mapped.result === 'mapped' && !mapped.textMatches) return { action: 'leave', why: 'mapped text differs', from };
  return { action: 'write', why: mapped.result, from, next: nextValue(rec, mapped, newGen) };
}

/** The record to write: same record, new CFI + pin, fraction shifted, label if the file changed. */
export function nextValue(rec, mapped, newGen) {
  const v = rec.value;
  const out = { ...v, cfi: mapped.newCfi, epubVersion: newGen };
  if (typeof v.fraction === 'number' && typeof mapped.newFraction === 'number' && typeof mapped.oldFractionComputed === 'number') {
    out.fraction = round(clamp01(v.fraction + (mapped.newFraction - mapped.oldFractionComputed)));
  }
  if (rec.kind === 'ribbon' && mapped.newFile !== mapped.oldFile && mapped.newLabel) out.label = mapped.newLabel;
  return out;
}

/** Key-order-independent equality for JSON values (the database does not keep key order). */
export function sameJson(a, b) {
  const canon = (x) => (Array.isArray(x) ? x.map(canon)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x);
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

// ── IO ───────────────────────────────────────────────────────────────────────────────────────

/**
 * A minimal RTDB REST client: shallow keys, read-with-ETag, conditional put. The same code runs
 * against production (access token) and the emulator (ns + owner bearer).
 */
export function restDb({ url, ns = null, token = null }) {
  const u = (path, extra = '') => {
    const q = [ns && `ns=${encodeURIComponent(ns)}`, token && `access_token=${encodeURIComponent(token)}`, extra].filter(Boolean).join('&');
    return `${url}/${path}.json${q ? `?${q}` : ''}`;
  };
  const headers = ns ? { Authorization: 'Bearer owner' } : {};
  const fail = async (r, what) => { throw new Error(`${what}: HTTP ${r.status}`); };
  return {
    async shallow(path) {
      const r = await fetch(u(path, 'shallow=true'), { headers });
      if (!r.ok) await fail(r, 'shallow read');
      return Object.keys((await r.json()) || {});
    },
    async read(path) {
      const r = await fetch(u(path), { headers: { ...headers, 'X-Firebase-ETag': 'true' } });
      if (!r.ok) await fail(r, 'read');
      return { value: await r.json(), etag: r.headers.get('etag') };
    },
    async put(path, value, etag) {
      const r = await fetch(u(path), { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', 'if-match': etag }, body: JSON.stringify(value) });
      if (r.status === 412) return { ok: false, conflict: true };
      if (!r.ok) await fail(r, 'write');
      return { ok: true };
    },
  };
}

const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : letter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/** Every saved place of the title, each with its ETag, lettered A, B, … (positions first). */
export async function gather(db, { titleId, slug }) {
  const out = [];
  for (const uid of (await db.shallow('bookstore_reading_progress')).sort()) {
    const path = `bookstore_reading_progress/${uid}/${titleId}`;
    const { value, etag } = await db.read(path);
    if (value != null) out.push({ kind: 'position', path, value, etag });
  }
  for (const uid of (await db.shallow('readerBookmarks')).sort()) {
    for (const id of (await db.shallow(`readerBookmarks/${uid}/${slug}`)).sort()) {
      const path = `readerBookmarks/${uid}/${slug}/${id}`;
      const { value, etag } = await db.read(path);
      if (value != null) out.push({ kind: 'ribbon', path, value, etag });
    }
  }
  return out.map((r, i) => ({ ...r, key: letter(i) }));
}

/**
 * The whole carry-over. Dry run unless `apply`. `liveGeneration` is an async function returning
 * the live master's generation; `beforeWrite` is a test seam (a reader's save landing between
 * the read and the write).
 */
export async function carryOver({ db, oldBytes, newBytes, titleId, slug, oldGen, newGen, apply = false,
  backupDir = null, liveGeneration = null, beforeWrite = null, stamp = new Date().toISOString().replace(/[:.]/g, '-') }) {
  if (!titleId || !slug || !oldGen) throw new Error('titleId, slug and the old generation are required');
  if (apply) {
    if (!newGen) throw new Error('--apply needs the new generation');
    if (!backupDir) throw new Error('--apply needs a backup folder');
    if (typeof liveGeneration !== 'function') throw new Error('--apply needs a live-generation check');
    const live = await liveGeneration();
    if (live !== newGen) throw new Error(`refused: the live master is generation ${live}, not ${newGen}. Upload first; carry second.`);
  }
  const records = await gather(db, { titleId, slug });
  const withCfi = records.filter((r) => typeof r.value?.cfi === 'string' && r.value.cfi);
  const res = withCfi.length
    ? await mapPositions({ oldBytes, newBytes, records: withCfi.map((r) => ({ key: r.key, kind: r.kind, cfi: r.value.cfi, fraction: r.value.fraction ?? null })) })
    : { records: [] };
  const byKey = new Map(res.records.map((m) => [m.key, m]));
  const rows = records.map((r) => ({ ...r, mapped: byKey.get(r.key), decision: decide(r, byKey.get(r.key), { oldGen, newGen: newGen || 'NEW' }) }));

  const summary = { records: rows.length, write: 0, written: 0, conflicts: 0, verified: 0, mismatched: 0, left: 0, backup: null };
  for (const r of rows) (r.decision.action === 'write' ? summary.write++ : summary.left++);
  if (!apply) return { applied: false, rows, summary };

  const toWrite = rows.filter((r) => r.decision.action === 'write');
  if (toWrite.length) {
    const dir = outsideRepo(backupDir, 'the backup folder');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    summary.backup = join(dir, `carry-over-${titleId}-${stamp}.json`);
    await writeFile(summary.backup, JSON.stringify({ titleId, slug, oldGen, newGen, at: stamp,
      records: toWrite.map((r) => ({ key: r.key, path: r.path, etag: r.etag, before: r.value, after: r.decision.next })) }, null, 2), { mode: 0o600 });
  }
  for (const r of toWrite) {
    if (beforeWrite) await beforeWrite(r);
    const put = await db.put(r.path, r.decision.next, r.etag);
    if (!put.ok) { r.outcome = 'reader save won'; summary.conflicts++; continue; }
    summary.written++;
    const back = await db.read(r.path);
    if (sameJson(back.value, r.decision.next)) { r.outcome = 'written, re-read equal'; summary.verified++; }
    else { r.outcome = 'written, RE-READ DIFFERS'; summary.mismatched++; }
  }
  return { applied: true, rows, summary };
}

/** One line per record. Structure only. */
export function describe(r) {
  const f3 = (x) => (typeof x === 'number' ? x.toFixed(3) : '—');
  const m = r.mapped || {};
  const d = r.decision;
  const where = m.oldFile ? ` · ${m.oldFile}#${m.oldElement} → ${m.newFile ?? '—'}#${m.newElement ?? '—'}` : '';
  const frac = d.action === 'write' ? ` · fraction ${f3(r.value.fraction)} → ${f3(d.next.fraction)}` : '';
  const label = r.kind === 'ribbon' && d.action === 'write' ? ` · label ${d.next.label === r.value.label ? 'unchanged' : 'rewritten'}` : '';
  const which = d.which ? ` · Δold ${f3(d.which.dOld)} Δnew ${f3(d.which.dNew)}` : '';
  return `${r.key} ${r.kind}: ${d.action === 'write' ? 'WRITE' : 'leave'} (${d.why}${d.from ? `; ${d.from}` : ''})${where}${frac}${label}${which}${r.outcome ? ` · ${r.outcome}` : ''}`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────

export async function prodDeps() {
  const { mintToken } = await import('../rules-pull.mjs');
  const db = restDb({ url: PROD_DB, token: await mintToken() });
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getStorage } = await import('firebase-admin/storage');
  const key = JSON.parse(await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../../serviceAccountKey.json'), 'utf8'));
  const app = getApps().find((a) => a.name === 'carry-over') || initializeApp({ credential: cert(key), storageBucket: STORAGE_BUCKET }, 'carry-over');
  const bucket = getStorage(app).bucket();
  return { db, bucket, liveGenerationOf: async (titleId) => String((await bucket.file(masterPath(titleId)).getMetadata())[0].generation) };
}

async function main() {
  const a = args(process.argv.slice(2), ['title', 'old', 'new', 'old-generation', 'new-generation', 'slug', 'backup-dir', 'apply']);
  if (!a.title) throw new Error('--title is required');
  const oldPath = outsideRepo(a.old, '--old');
  const newBytes = await readFile(outsideRepo(a.new, '--new'));
  const { db, liveGenerationOf } = await prodDeps();
  const slug = a.slug || (await db.read(`bookstore_titles/${a.title}/slug`)).value || a.title;
  const oldGen = a['old-generation'] || (a.apply ? null : await liveGenerationOf(a.title));
  if (!oldGen) throw new Error('--apply needs --old-generation');
  const out = await carryOver({
    db, oldBytes: await readFile(oldPath), newBytes, titleId: a.title, slug, oldGen,
    newGen: a['new-generation'] || null, apply: !!a.apply,
    backupDir: a['backup-dir'] || dirname(oldPath), liveGeneration: () => liveGenerationOf(a.title),
  });
  for (const r of out.rows) console.log(describe(r));
  const { backup, ...counts } = out.summary;
  console.log(`summary: ${JSON.stringify(counts)}`);
  console.log(out.applied ? `applied. backup: ${backup ? 'written (private folder)' : 'none needed'}` : 'dry run: nothing was written.');
  if (out.summary.mismatched) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`carry-over failed: ${e.message}`); process.exit(2); });
}
