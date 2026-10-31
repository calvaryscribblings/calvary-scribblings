// SAFETY-1 — THE GUARD. Every script that writes to production goes through this file.
//
//   A bulk write goes through the guard: a dry run first, then a fresh, verified backup,
//   then the write. No exceptions, founders included.            (CLAUDE.md, SAFETY-1)
//
// Why it exists. PROOFS-R1 found that scripts/backfill-story-bodies.mjs PUT the whole of
// story_bodies from cms_stories. After ruling 255 story_bodies held the ONLY copy of every
// unreleased story, so one run would have deleted them all. Review caught it; nothing in the
// process would have. This file is the process.
//
// Every time a script asks it to write, in this order:
//
//   1. DRY BY DEFAULT. Without --apply on the command line nothing is written. The guard says
//      how many paths it WOULD write, how many are deletions, and returns.
//   2. A FRESH BACKUP OF EXACTLY THE PATHS IT WILL TOUCH. Each database path's current value
//      (null if absent), and every Storage object it will delete or overwrite (bytes and
//      metadata), go to gs://calvary-scribblings-default-rtdb-backups/guard/<script>/<stamp>/.
//      That bucket deletes everything after 30 days, the same life as the daily database
//      backups. That is deliberate: the account scrub goes through the guard, and a deleted
//      reader's data must not outlive the backups the deletion copy already allows for.
//   3. VERIFIED BY CHECKSUM. Each backup object is read back. Its MD5 must equal the bucket's
//      and its SHA-256 the bytes sent; each Storage object copied must match its source's MD5.
//      If anything fails the guard THROWS, and the write never happens.
//   4. THE WRITE. Database writes are ONE atomic multi-path update per batch. Storage deletes and
//      overwrites carry the backed-up generation as a precondition, so an object that changed
//      after its backup is refused, not clobbered.
//
// It prints COUNTS ONLY: paths, deletions, bytes, the backup's location. Never a value, a key,
// a slug or a uid. Actions logs are public (W12), and so is this repository.
//
// It refuses, before any of that:
//   • a write to the database ROOT, or to any path with an empty segment ('cms_stories/' + ''),
//     which is how a blank id turns a one-record write into a whole-collection write;
//   • a path segment of "undefined" or "null" (a template literal that met a missing value);
//   • a mix of emulator and production.
//
// Two ways in, same rules:
//   const guard = await openGuard('readership');            // reads --apply from argv
//   await guard.update({ 'a/b': value, 'a/c': null });      // REST, one atomic update
//   await guard.transact(['a/n'], (cur) => cur + 1);        // conditional (ETag) per path
//   await guard.storage({ deletes: [{ name }], uploads: [{ name, body, contentType }] });
// or, for a script built on firebase-admin, wrap what it already has:
//   const db = guard.adminDb(getDatabase());                // ref().set/update/remove/push/
//   const bucket = guard.adminBucket(getStorage().bucket()); //   transaction, file().save/delete…
// The wrapped objects read exactly as before; every write method goes through steps 1–4, and the
// ones the guard cannot back up (setWithPriority, onDisconnect, deleteFiles, bucket.upload,
// createWriteStream, copy, move…) throw.
//
// To restore from a guard backup:  node scripts/safety/restore.mjs gs://…/batch-N.json
// (itself guarded: dry by default, and it backs up what it is about to replace).
//
// tests/ci/safety-guard.test.mjs fails the build if a file under scripts/ writes to production
// any other way.

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DB_URL = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
export const MAIN_BUCKET = 'calvary-scribblings.firebasestorage.app';
export const BACKUP_BUCKET = 'calvary-scribblings-default-rtdb-backups';
export const BACKUP_PREFIX = 'guard';
const GCS = 'https://storage.googleapis.com';
const PARALLEL = 8;
// Every env var a scheduled workflow uses to hand a script its key file (a PATH).
const KEY_PATH_VARS = ['GUARD_SERVICE_ACCOUNT', 'SCRUB_SERVICE_ACCOUNT', 'PUSH_SERVICE_ACCOUNT', 'COVERS_SERVICE_ACCOUNT',
  'RECONCILE_SERVICE_ACCOUNT', 'BOOKSTORE_SERVICE_ACCOUNT', 'HORIZON_SERVICE_ACCOUNT', 'GOOGLE_APPLICATION_CREDENTIALS'];

// A Firebase push id (time-ordered, 20 chars), made locally, for a guarded create under a list.
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
export function pushId(now = Date.now()) {
  let t = now, id = '';
  for (let i = 0; i < 8; i++) { id = PUSH_CHARS[t % 64] + id; t = Math.floor(t / 64); }
  for (const b of randomBytes(12)) id += PUSH_CHARS[b % 64];
  return id;
}

export class GuardRefusal extends Error {
  constructor(msg) { super(`GUARD REFUSED: ${msg}`); this.name = 'GuardRefusal'; }
}

// ── where ───────────────────────────────────────────────────────────────────────────────
export function endpoints(env = process.env) {
  const dbEmu = env.FIREBASE_DATABASE_EMULATOR_HOST;
  const stEmu = env.FIREBASE_STORAGE_EMULATOR_HOST || env.STORAGE_EMULATOR_HOST;
  if (Boolean(dbEmu) !== Boolean(stEmu)) {
    throw new GuardRefusal('one emulator variable is set and the other is not, which would mix the emulator with production. Set both (database and storage) or neither.');
  }
  if (dbEmu) {
    const ns = env.GUARD_DB_NAMESPACE || env.GCLOUD_PROJECT || env.FIREBASE_PROJECT || 'demo-safety';
    const st = stEmu.startsWith('http') ? stEmu : `http://${stEmu}`;
    return { emulator: true, db: `http://${dbEmu}`, dbQuery: `ns=${ns}`, gcs: st };
  }
  return { emulator: false, db: DB_URL, dbQuery: '', gcs: GCS };
}
const isLocalUrl = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/)/.test(String(u));

// ── path discipline ─────────────────────────────────────────────────────────────────────
const BAD_CHARS = /[.#$\[\]]/;
export function checkPath(path) {
  if (typeof path !== 'string') throw new GuardRefusal('a write path is not a string.');
  const p = path.replace(/^\/+/, '');
  if (p === '') throw new GuardRefusal('a write to the database ROOT. The guard never writes the root.');
  const segs = p.split('/');
  if (segs.some((s) => s === '')) throw new GuardRefusal('a write path has an empty segment (a blank id would widen the write to its whole parent).');
  if (segs.some((s) => BAD_CHARS.test(s) || s === 'undefined' || s === 'null')) {
    throw new GuardRefusal('a write path has an illegal or placeholder segment (".", "#", "$", "[", "]", "undefined" or "null").');
  }
  return p;
}
export function checkObjectName(name) {
  if (!name || typeof name !== 'string' || name.endsWith('/') || name.includes('//') || name.startsWith('/')) {
    throw new GuardRefusal('a Storage object name is empty, or ends or starts with "/" (a prefix, not an object).');
  }
  if (/(^|\/)(undefined|null)(\/|$)/.test(name)) throw new GuardRefusal('a Storage object name has an "undefined" or "null" segment.');
  return name;
}
const join = (base, rel) => [base, rel].filter((s) => s !== '' && s !== undefined && s !== null).join('/').replace(/^\/+/, '');

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const md5b64 = (buf) => createHash('md5').update(buf).digest('base64');
const kb = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

function multipart(meta, bytes) {
  const boundary = `guard-${randomBytes(8).toString('hex')}`;
  return {
    type: `multipart/related; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${meta.contentType}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]),
  };
}

async function pool(items, fn, n = PARALLEL) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

function gitSha() {
  try { return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'unknown'; }
}

async function defaultToken(env) {
  const { loadServiceAccount } = await import('../security/service-account.mjs');
  const { mintToken } = await import('../rules-pull.mjs');
  return mintToken(loadServiceAccount({ pathVars: KEY_PATH_VARS, env }));
}

// ── read-only handles, for scripts that never write ────────────────────────────────────
// A script that only reads wraps its handle in one of these. Any write method throws, so "this
// script is read-only" is enforced at run time, not just claimed in a comment.
const DB_WRITES = new Set(['set', 'update', 'remove', 'push', 'transaction', 'setWithPriority', 'setPriority', 'onDisconnect']);
const FILE_WRITES = new Set(['save', 'delete', 'setMetadata', 'createWriteStream', 'copy', 'move', 'rename', 'makePublic', 'makePrivate', 'setStorageClass', 'restore', 'createResumableUpload']);
const BUCKET_WRITES = new Set(['deleteFiles', 'upload', 'setMetadata', 'combine', 'delete', 'setCorsConfiguration', 'addLifecycleRule', 'setStorageClass', 'makePublic', 'makePrivate']);
const readOnly = (target, writes, wrapChildren) => new Proxy(target, {
  get(t, prop) {
    if (writes.has(prop)) return () => { throw new GuardRefusal(`${String(prop)}() on a read-only handle. Writes go through openGuard().`); };
    const v = Reflect.get(t, prop, t);
    if (typeof v !== 'function') return wrapChildren && wrapChildren[prop] && v ? wrapChildren[prop](v) : v;
    const bound = v.bind(t);
    return wrapChildren && wrapChildren[prop] ? (...a) => wrapChildren[prop](bound(...a)) : bound;
  },
});
const roRef = (ref) => (ref ? readOnly(ref, DB_WRITES, { child: roRef, parent: roRef, root: roRef }) : ref);
export function readOnlyDb(db) {
  return new Proxy(db, {
    get(t, prop) {
      if (prop === 'ref' || prop === 'refFromURL') return (...a) => roRef(t[prop](...a));
      const v = Reflect.get(t, prop, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
const roFile = (f) => readOnly(f, FILE_WRITES);
export function readOnlyBucket(bucket) {
  return new Proxy(bucket, {
    get(t, prop) {
      if (BUCKET_WRITES.has(prop)) return () => { throw new GuardRefusal(`bucket.${String(prop)}() on a read-only handle.`); };
      if (prop === 'file') return (...a) => roFile(t.file(...a));
      if (prop === 'getFiles') return async (q) => { const [files, ...rest] = await t.getFiles(q); return [files.map(roFile), ...rest]; };
      const v = Reflect.get(t, prop, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

// ── the guard ───────────────────────────────────────────────────────────────────────────
/**
 * @param name          the script's name, which becomes the backup prefix. [a-z0-9-] only.
 * @param opts.argv     defaults to process.argv; --apply turns writing on.
 * @param opts.apply    overrides argv (for a script whose own flag means apply, e.g. a workflow input).
 * @param opts.token    an OAuth token; defaults to the service account.
 * @param opts.env      defaults to process.env (emulator detection, key location).
 * @param opts.log      defaults to console.log. It only ever receives counts.
 */
export async function openGuard(name, opts = {}) {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(name || '')) throw new GuardRefusal('openGuard needs a script name of [a-z0-9-].');
  const env = opts.env || process.env;
  const log = opts.log || ((s) => console.log(s));
  const apply = typeof opts.apply === 'boolean' ? opts.apply : (opts.argv || process.argv).includes('--apply');
  const ep = endpoints(env);
  let token = opts.token || (ep.emulator ? 'owner' : null);
  const auth = async () => {
    if (!token) token = await defaultToken(env);
    return { Authorization: `Bearer ${token}` };
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex');
  const prefix = `${BACKUP_PREFIX}/${name}/${stamp}`;
  const where = () => `${ep.emulator ? '(storage emulator) ' : ''}gs://${BACKUP_BUCKET}/${prefix}/`;
  let batch = 0;
  const totals = { batches: 0, paths: 0, deletes: 0, objects: 0, dry: 0 };

  const dbUrl = (path, q = '') => {
    const qs = [ep.dbQuery, q].filter(Boolean).join('&');
    return `${ep.db}/${path ? enc(path) : ''}.json${qs ? `?${qs}` : ''}`;
  };

  // ── backends: REST (default) and firebase-admin (adminDb) ──
  const rest = {
    async read(path) {
      const r = await fetch(dbUrl(path), { headers: await auth() });
      if (!r.ok) throw new Error(`guard: a read failed (HTTP ${r.status})`);
      return r.json();
    },
    async write(updates) {
      const r = await fetch(dbUrl(''), { method: 'PATCH', headers: { ...(await auth()), 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
      if (!r.ok) throw new Error(`guard: the write failed (HTTP ${r.status})`);
    },
    async txn(path, fn) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const r = await fetch(dbUrl(path), { headers: { ...(await auth()), 'X-Firebase-ETag': 'true' } });
        if (!r.ok) throw new Error(`guard: a read failed (HTTP ${r.status})`);
        const etag = r.headers.get('etag');
        const cur = await r.json();
        const next = fn(cur);
        if (next === undefined) return { committed: false, value: cur };
        const w = await fetch(dbUrl(path), {
          method: 'PUT', headers: { ...(await auth()), 'Content-Type': 'application/json', 'if-match': etag }, body: JSON.stringify(next),
        });
        if (w.status === 412) continue; // someone else wrote first: re-read, re-run fn
        if (!w.ok) throw new Error(`guard: a conditional write failed (HTTP ${w.status})`);
        return { committed: true, value: next };
      }
      throw new Error('guard: a conditional write lost the race eight times running.');
    },
  };
  const sdkBackend = (db) => ({
    async read(path) { return (await db.ref(path).get()).val(); },
    async write(updates) { await db.ref().update(updates); },
    async txn(path, fn) {
      const res = await db.ref(path).transaction(fn);
      return { committed: res.committed, value: res.snapshot.val(), snapshot: res.snapshot };
    },
  });

  async function get(path, { shallow = false } = {}) {
    const p = String(path || '').replace(/^\/+|\/+$/g, '');
    const r = await fetch(dbUrl(p, shallow ? 'shallow=true' : ''), { headers: await auth() });
    if (!r.ok) throw new Error(`guard: a read failed (HTTP ${r.status})`);
    return r.json();
  }

  // Upload bytes to the backup bucket (create-only: ifGenerationMatch=0), then prove they landed.
  async function putBackup(objName, body, contentType) {
    const local = { md5: md5b64(body), sha: sha256(body), bytes: body.length };
    const H = await auth();
    // Multipart, not uploadType=media: the Storage emulator hangs on a media upload of JSON.
    const mp = multipart({ name: objName, contentType }, body);
    const up = await fetch(
      `${ep.gcs}/upload/storage/v1/b/${BACKUP_BUCKET}/o?uploadType=multipart&ifGenerationMatch=0`,
      { method: 'POST', headers: { ...H, 'Content-Type': mp.type }, body: mp.body },
    ).catch(() => null);
    if (!up || !up.ok) throw new GuardRefusal(`the backup upload failed${up ? ` (HTTP ${up.status})` : ''}. Nothing was written.`);
    const meta = await up.json();
    if (meta.md5Hash && meta.md5Hash !== local.md5) throw new GuardRefusal('the backup bucket reports a different MD5 from the bytes sent. Nothing was written.');
    const back = await fetch(`${ep.gcs}/storage/v1/b/${BACKUP_BUCKET}/o/${encodeURIComponent(objName)}?alt=media`, { headers: H }).catch(() => null);
    if (!back || !back.ok) throw new GuardRefusal(`the backup could not be read back${back ? ` (HTTP ${back.status})` : ''}. Nothing was written.`);
    const got = Buffer.from(await back.arrayBuffer());
    if (sha256(got) !== local.sha) throw new GuardRefusal('the backup read back with a different SHA-256. Nothing was written.');
    return local;
  }

  async function backupPaths(paths, read, label) {
    const before = await pool(paths, (p) => read(p));
    const snapshot = Object.fromEntries(paths.map((p, i) => [p, before[i] ?? null]));
    const existing = before.filter((v) => v !== null && v !== undefined).length;
    const n = ++batch; // captured: parallel writes must not share a batch number
    const objName = `${prefix}/batch-${n}.json`;
    const body = Buffer.from(JSON.stringify({
      format: 'safety-guard/1', kind: 'rtdb', script: name, label, stamp, batch: n, git: gitSha(),
      target: ep.emulator ? 'emulator' : 'production', takenAt: new Date().toISOString(), paths: snapshot,
    }));
    const proof = await putBackup(objName, body, 'application/json');
    log(`guard · ${label}: backed up ${paths.length} path(s) (${existing} holding data, ${kb(proof.bytes)}), checksums verified → ${where()}batch-${n}.json`);
    return `${where()}batch-${n}.json`;
  }

  function normalise(updates) {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new GuardRefusal('update() takes an object of { path: value }.');
    const entries = Object.entries(updates).map(([p, v]) => [checkPath(p), v === undefined ? null : v]);
    const sorted = entries.map(([p]) => p).sort();
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] || sorted[i].startsWith(sorted[i - 1] + '/')) throw new GuardRefusal('two write paths overlap (one is inside the other).');
    }
    return entries;
  }

  /** The database write. `updates` maps absolute paths to values; null deletes. ONE atomic update. */
  async function update(updates, { label = 'update', backend = rest } = {}) {
    const entries = normalise(updates);
    if (!entries.length) return { applied: false, paths: 0, deletes: 0 };
    const paths = entries.map(([p]) => p);
    const deletes = entries.filter(([, v]) => v === null).length;
    const nodes = new Set(paths.map((p) => p.split('/')[0])).size;
    const body = Object.fromEntries(entries);
    if (!apply) {
      totals.dry += paths.length;
      log(`guard · ${label}: DRY RUN, would write ${paths.length} path(s) in ${nodes} node(s), ${deletes} of them deletions, ${kb(Buffer.byteLength(JSON.stringify(body)))}. Nothing written.`);
      return { applied: false, paths: paths.length, deletes };
    }
    const backup = await backupPaths(paths, backend.read, label);
    await backend.write(body);
    totals.batches++; totals.paths += paths.length; totals.deletes += deletes;
    log(`guard · ${label}: wrote ${paths.length} path(s), ${deletes} deletion(s).`);
    return { applied: true, paths: paths.length, deletes, backup };
  }

  /**
   * Read-modify-write per path, conditional on nothing having changed in between. `fn(current)`
   * returns the new value (null deletes; undefined leaves the path alone). All the paths are
   * backed up together first. Returns per-path { committed, value }.
   */
  async function transact(paths, fn, { label = 'transact', backend = rest } = {}) {
    const list = (Array.isArray(paths) ? paths : [paths]).map(checkPath);
    if (!list.length) return [];
    if (!apply) {
      totals.dry += list.length;
      log(`guard · ${label}: DRY RUN, would update ${list.length} path(s) conditionally. Nothing written.`);
      return Promise.all(list.map(async (p) => ({ committed: false, value: await backend.read(p) })));
    }
    await backupPaths(list, backend.read, label);
    const out = [];
    for (const p of list) out.push(await backend.txn(p, (cur) => fn(cur, p)));
    const n = out.filter((r) => r.committed).length;
    totals.batches++; totals.paths += n;
    log(`guard · ${label}: ${n} of ${list.length} conditional write(s) committed.`);
    return out;
  }

  // ── Storage ──
  async function restMeta(bucket, objName) {
    const r = await fetch(`${ep.gcs}/storage/v1/b/${bucket}/o/${encodeURIComponent(objName)}`, { headers: await auth() });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`guard: a Storage metadata read failed (HTTP ${r.status})`);
    return r.json();
  }
  async function restDownload(bucket, objName, generation) {
    const r = await fetch(`${ep.gcs}/storage/v1/b/${bucket}/o/${encodeURIComponent(objName)}?alt=media&generation=${generation}`, { headers: await auth() });
    if (!r.ok) throw new GuardRefusal(`a Storage object could not be read for its backup (HTTP ${r.status}). Nothing was written.`);
    return Buffer.from(await r.arrayBuffer());
  }

  /** Back up every object in `ops` that exists. Returns the metadata per op (null = absent). */
  async function backupObjects(ops, label, { meta, download }) {
    for (const o of ops) {
      checkObjectName(o.name);
      if (o.bucket === BACKUP_BUCKET) throw new GuardRefusal('the guard writes to the backup bucket only for its own backups.');
    }
    const n = ++batch; // captured: parallel writes must not share a batch number
    const metas = await pool(ops, (o) => meta(o));
    let copied = 0, copiedBytes = 0;
    const record = await pool(ops, async (o, i) => {
      const m = metas[i];
      if (!m) return { op: o.op, bucket: o.bucket, name: o.name, existed: false };
      const bytes = await download(o, m);
      if (m.md5Hash && md5b64(bytes) !== m.md5Hash) throw new GuardRefusal('a Storage object downloaded for backup does not match its own MD5. Nothing was written.');
      const copy = `${prefix}/batch-${n}/objects/${o.bucket}/${o.name}`;
      const proof = await putBackup(copy, bytes, m.contentType || 'application/octet-stream');
      copied++; copiedBytes += proof.bytes;
      return {
        op: o.op, bucket: o.bucket, name: o.name, existed: true, generation: String(m.generation), md5: m.md5Hash || null,
        contentType: m.contentType || null, cacheControl: m.cacheControl || null, metadata: m.metadata || null, copy,
      };
    });
    const manifest = Buffer.from(JSON.stringify({
      format: 'safety-guard/1', kind: 'storage', script: name, label, stamp, batch: n, git: gitSha(),
      target: ep.emulator ? 'emulator' : 'production', takenAt: new Date().toISOString(), objects: record,
    }));
    await putBackup(`${prefix}/batch-${n}.json`, manifest, 'application/json');
    log(`guard · ${label}: backed up ${copied} existing object(s) of ${ops.length} (${kb(copiedBytes)}), checksums verified → ${where()}batch-${n}.json`);
    return metas;
  }

  /**
   * Storage deletes, uploads (create or overwrite) and custom-metadata patches, by REST.
   * deletes: [{ name, bucket? }]; uploads: [{ name, body, contentType, metadata?, cacheControl?, bucket? }];
   * metadata: [{ name, metadata, bucket? }]. The bucket defaults to the main Firebase bucket.
   */
  async function storage({ deletes = [], uploads = [], metadata = [] } = {}, { label = 'storage' } = {}) {
    const ops = [
      ...deletes.map((d) => ({ bucket: MAIN_BUCKET, ...d, op: 'delete' })),
      ...uploads.map((u) => ({ bucket: MAIN_BUCKET, ...u, op: 'upload' })),
      ...metadata.map((m) => ({ bucket: MAIN_BUCKET, ...m, op: 'metadata' })),
    ];
    ops.forEach((o) => checkObjectName(o.name));
    if (!ops.length) return { applied: false, objects: 0 };
    if (!apply) {
      totals.dry += ops.length;
      log(`guard · ${label}: DRY RUN, would delete ${deletes.length}, write ${uploads.length}, re-label ${metadata.length} Storage object(s). Nothing written.`);
      return { applied: false, objects: ops.length };
    }
    const metas = await backupObjects(ops, label, {
      meta: (o) => restMeta(o.bucket, o.name),
      download: (o, m) => restDownload(o.bucket, o.name, m.generation),
    });
    const H = await auth();
    await pool(ops, async (o, i) => {
      const gen = metas[i] ? metas[i].generation : '0';
      let r;
      if (o.op === 'delete') {
        if (!metas[i]) return;
        r = await fetch(`${ep.gcs}/storage/v1/b/${o.bucket}/o/${encodeURIComponent(o.name)}?ifGenerationMatch=${gen}`, { method: 'DELETE', headers: H });
        if (r.status === 404) return;
      } else if (o.op === 'upload') {
        const meta = { name: o.name, contentType: o.contentType || 'application/octet-stream' };
        if (o.metadata) meta.metadata = o.metadata;
        if (o.cacheControl) meta.cacheControl = o.cacheControl;
        const mp = multipart(meta, Buffer.isBuffer(o.body) ? o.body : Buffer.from(o.body));
        r = await fetch(`${ep.gcs}/upload/storage/v1/b/${o.bucket}/o?uploadType=multipart&ifGenerationMatch=${gen}`, {
          method: 'POST', headers: { ...H, 'Content-Type': mp.type }, body: mp.body,
        });
      } else {
        if (!metas[i]) throw new Error(`guard · ${label}: cannot re-label an object that does not exist.`);
        r = await fetch(`${ep.gcs}/storage/v1/b/${o.bucket}/o/${encodeURIComponent(o.name)}?ifGenerationMatch=${gen}`, {
          method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata: o.metadata }),
        });
      }
      if (!r.ok) throw new Error(`guard · ${label}: a Storage ${o.op} failed (HTTP ${r.status}).`);
    });
    totals.batches++; totals.objects += ops.length;
    log(`guard · ${label}: deleted ${deletes.length}, wrote ${uploads.length}, re-labelled ${metadata.length} object(s).`);
    return { applied: true, objects: ops.length };
  }

  // ── firebase-admin wrappers ──
  const REFUSED_REF = new Set(['setWithPriority', 'setPriority', 'onDisconnect']);
  function adminDb(db) {
    if (!db || typeof db.ref !== 'function') throw new GuardRefusal('adminDb() takes a firebase-admin Database.');
    const url = db.ref().toString();
    if (isLocalUrl(url) !== ep.emulator) {
      throw new GuardRefusal(`the database handed to the guard is ${isLocalUrl(url) ? 'an emulator' : 'production'} but the guard is set up for ${ep.emulator ? 'the emulator' : 'production'}.`);
    }
    const be = sdkBackend(db);
    const pathOf = (ref) => decodeURIComponent(new URL(ref.toString()).pathname).replace(/^\/+|\/+$/g, '');
    const wrapRef = (ref) => {
      if (!ref) return ref;
      return new Proxy(ref, {
        get(t, prop) {
          const path = pathOf(t);
          if (prop === 'set') return (v) => update({ [path]: v }, { label: 'set', backend: be }).then(() => undefined);
          if (prop === 'remove') return () => update({ [path]: null }, { label: 'remove', backend: be }).then(() => undefined);
          if (prop === 'update') {
            return (obj) => update(Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [join(path, k), v])), { label: 'update', backend: be }).then(() => undefined);
          }
          if (prop === 'transaction') {
            return async (fn) => {
              const [r] = await transact([path], fn, { label: 'transaction', backend: be });
              return { committed: r.committed, snapshot: r.snapshot || { val: () => r.value, exists: () => r.value !== null && r.value !== undefined } };
            };
          }
          if (prop === 'push') {
            return (v) => {
              const child = t.push();
              const wrapped = wrapRef(child);
              if (v === undefined) return wrapped;
              const p = update({ [join(path, child.key)]: v }, { label: 'push', backend: be }).then(() => wrapped);
              return Object.assign(p, { key: child.key, ref: wrapped });
            };
          }
          if (prop === 'child') return (p) => wrapRef(t.child(p));
          if (prop === 'parent' || prop === 'root') return wrapRef(t[prop]);
          if (REFUSED_REF.has(prop)) return () => { throw new GuardRefusal(`${String(prop)}() is not available through the guard.`); };
          const v = Reflect.get(t, prop, t);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
    };
    return new Proxy(db, {
      get(t, prop) {
        if (prop === 'ref') return (p) => wrapRef(t.ref(p));
        if (prop === 'refFromURL') return (u) => wrapRef(t.refFromURL(u));
        const v = Reflect.get(t, prop, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  const REFUSED_FILE = new Set(['createWriteStream', 'copy', 'move', 'rename', 'makePublic', 'makePrivate', 'setStorageClass', 'restore', 'createResumableUpload']);
  const REFUSED_BUCKET = new Set(['deleteFiles', 'upload', 'setMetadata', 'combine', 'delete', 'setCorsConfiguration', 'addLifecycleRule', 'setStorageClass', 'makePublic', 'makePrivate']);
  function adminBucket(bucket) {
    if (!bucket || typeof bucket.file !== 'function') throw new GuardRefusal('adminBucket() takes a @google-cloud/storage Bucket.');
    if (bucket.name === BACKUP_BUCKET) throw new GuardRefusal('the guard writes to the backup bucket only for its own backups.');
    const sdk = {
      meta: async (o) => { try { const [m] = await o.file.getMetadata(); return m; } catch (e) { if (e && e.code === 404) return null; throw e; } },
      download: async (o) => (await o.file.download())[0],
    };
    const one = async (op, file, label, run) => {
      checkObjectName(file.name);
      const o = { op, bucket: bucket.name, name: file.name, file };
      if (!apply) {
        totals.dry++;
        log(`guard · ${label}: DRY RUN, would ${op} 1 Storage object. Nothing written.`);
        return undefined;
      }
      const [m] = await backupObjects([o], label, sdk);
      const res = await run(m ? Number(m.generation) : 0, m);
      totals.batches++; totals.objects++;
      return res;
    };
    const wrapFile = (f) => new Proxy(f, {
      get(t, prop) {
        if (prop === 'save') {
          return (data, opts = {}) => one('upload', t, 'save', (gen) => t.save(data, { ...opts, preconditionOpts: { ifGenerationMatch: gen } }));
        }
        if (prop === 'delete') {
          return (opts = {}) => one('delete', t, 'delete', (gen, m) => (m ? t.delete({ ...opts, ifGenerationMatch: gen }) : undefined));
        }
        if (prop === 'setMetadata') {
          return (md, opts = {}) => one('metadata', t, 'setMetadata', (gen, m) => {
            if (!m) throw new Error('guard: cannot re-label an object that does not exist.');
            return t.setMetadata(md, { ...opts, ifGenerationMatch: gen });
          });
        }
        if (REFUSED_FILE.has(prop)) return () => { throw new GuardRefusal(`file.${String(prop)}() is not available through the guard.`); };
        const v = Reflect.get(t, prop, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    return new Proxy(bucket, {
      get(t, prop) {
        if (prop === 'file') return (n, o) => wrapFile(t.file(n, o));
        if (prop === 'getFiles') return async (q) => { const [files, ...rest] = await t.getFiles(q); return [files.map(wrapFile), ...rest]; };
        if (REFUSED_BUCKET.has(prop)) return () => { throw new GuardRefusal(`bucket.${String(prop)}() is not available through the guard.`); };
        const v = Reflect.get(t, prop, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  function summary() {
    if (!apply) return log(`guard · ${name}: DRY RUN complete, ${totals.dry} write(s) planned, nothing written. Re-run with --apply to write.`);
    if (!totals.batches) return log(`guard · ${name}: nothing needed writing.`);
    log(`guard · ${name}: ${totals.batches} batch(es), ${totals.paths} database path(s) (${totals.deletes} deleted), ${totals.objects} Storage object(s). Backups under ${where()}`);
  }

  log(`guard · ${name}: ${apply ? 'APPLY' : 'DRY RUN'} against ${ep.emulator ? 'the emulator' : 'production'}.${apply ? ' Every write is backed up and verified first.' : ' Nothing will be written.'}`);

  return { apply, emulator: ep.emulator, name, stamp, prefix: where(), objectPrefix: `${prefix}/`, get, update, transact, storage, adminDb, adminBucket, summary, totals };
}
