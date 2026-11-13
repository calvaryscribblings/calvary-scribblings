// SAFETY-2B — put the site's files back as they were on a date, from the vault. THROUGH THE GUARD.
//
//   node scripts/backup/restore-files.mjs --manifest from-vault/files-manifest/<date>.json                 # dry run
//   node scripts/backup/restore-files.mjs --manifest from-vault/files-manifest/<date>.json --only <path>   # one file
//   node scripts/backup/restore-files.mjs --manifest from-vault/files-manifest/<date>.json --prefix covers-typographic/
//   … --apply                                                                                              # write
//
// The site's key can't read the vault (docs/VAULT.md §4), so the files come to it. In Cloud Shell,
// in the vault project, Ikenna copies the date's manifest and the generations it lists from the
// vault into the database-backup bucket under from-vault/ (RESTORE.md, "From the vault"):
//
//   from-vault/files-manifest/<date>.json
//   from-vault/files/<generation>/<path>       (the vault's own names, unchanged)
//
// Then this script, with the site's key, copies each listed object back to <path> in the file
// bucket. Dry by default. With --apply each batch goes through the SAFETY-1 guard's Storage half:
// a verified backup of every live object it will overwrite, then the write with that object's
// generation as a precondition. Every restored object is read back and its MD5 compared with the
// manifest.
//
// What it does NOT do:
//   · delete. A file that is live now but wasn't on that date is counted and left alone.
//   · keep generations. A restored object is a NEW generation (RESTORE.md §4): a restored master
//     EPUB moves every reader's position pin. The manifest records the old generation.
//   · restore an object stored with Content-Encoding (its bytes can't be fetched raw through
//     fetch()). It is counted as "by hand" and the run exits 1.
//
// Prints counts only, never a path (Actions logs are public, W12). It follows the emulator variables
// as the guard does (both FIREBASE_DATABASE_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST).

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGuard, endpoints, checkObjectName, BACKUP_BUCKET, MAIN_BUCKET } from '../safety/guard.mjs';
import { FROM_VAULT } from './archives.mjs';

export const MANIFEST_PREFIX = `${FROM_VAULT}files-manifest/`;
const BATCH_OBJECTS = 20;
const BATCH_BYTES = 64 * 1024 * 1024;

export const sourceName = (o) => `${FROM_VAULT}files/${o.generation}/${o.name}`;

/** Validate a manifest and choose its objects. Throws on anything that isn't a vault files manifest. */
export function selectObjects(manifest, { only = [], prefix = null } = {}) {
  if (!manifest || manifest.format !== 'vault-files-manifest/1' || !Array.isArray(manifest.objects)) {
    throw new Error('that is not a vault files manifest (format vault-files-manifest/1)');
  }
  for (const o of manifest.objects) {
    checkObjectName(o.name);
    if (!/^\d+$/.test(String(o.generation))) throw new Error('a manifest entry has no generation');
  }
  let objs = manifest.objects;
  if (only.length) {
    const want = new Set(only);
    objs = objs.filter((o) => want.has(o.name));
    if (objs.length !== want.size) throw new Error(`${want.size - objs.length} of the --only paths are not in this manifest`);
  }
  if (prefix) objs = objs.filter((o) => o.name.startsWith(prefix));
  return objs;
}

/**
 * The plan, from what is live and what was copied in. Pure.
 * live: Map name → { md5Hash } ; staged: Set of source names present under from-vault/files/.
 */
export function planRestore(objs, live, staged) {
  const plan = { identical: [], restore: [], missing: [], byHand: [] };
  for (const o of objs) {
    const cur = live.get(o.name);
    if (cur && o.md5Hash && cur.md5Hash === o.md5Hash) plan.identical.push(o);
    else if (!staged.has(sourceName(o))) plan.missing.push(o);
    else if (o.contentEncoding) plan.byHand.push(o);
    else plan.restore.push(o);
  }
  return plan;
}

/** Batches small enough to hold in memory: at most 20 objects or 64 MB. */
export function batches(objs) {
  const out = [];
  let cur = [], bytes = 0;
  for (const o of objs) {
    if (cur.length && (cur.length >= BATCH_OBJECTS || bytes + o.size > BATCH_BYTES)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(o); bytes += Number(o.size || 0);
  }
  if (cur.length) out.push(cur);
  return out;
}

const md5 = (b) => createHash('md5').update(b).digest('base64');

export async function restoreFiles({ argv = process.argv.slice(2), env = process.env, log = console.log, token: givenToken } = {}) {
  const opt = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
  const only = argv.flatMap((a, i) => (a === '--only' ? [argv[i + 1]] : []));
  const prefix = opt('--prefix');
  const manifestName = opt('--manifest');
  if (!manifestName || !manifestName.startsWith(MANIFEST_PREFIX) || !manifestName.endsWith('.json')) {
    throw new Error(`--manifest must name a manifest copied in under ${MANIFEST_PREFIX} (see the top of this file)`);
  }
  const ep = endpoints(env);
  const token = givenToken || (ep.emulator ? 'owner' : await (await import('../rules-pull.mjs')).mintToken());
  const H = { Authorization: `Bearer ${token}` };
  const gcs = ep.gcs;

  const get = async (bucket, name) => fetch(`${gcs}/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`, { headers: H });
  async function list(bucket, pfx) {
    const out = new Map();
    let pageToken = '';
    do {
      const q = new URLSearchParams({ fields: 'items(name,md5Hash,generation),nextPageToken', maxResults: '1000' });
      if (pfx) q.set('prefix', pfx);
      if (pageToken) q.set('pageToken', pageToken);
      const r = await fetch(`${gcs}/storage/v1/b/${bucket}/o?${q}`, { headers: H });
      if (!r.ok) throw new Error(`listing a bucket failed (HTTP ${r.status})`);
      const j = await r.json();
      for (const it of j.items || []) out.set(it.name, it);
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  const mr = await get(BACKUP_BUCKET, manifestName);
  if (!mr.ok) throw new Error(`the manifest could not be read (HTTP ${mr.status}); copy it in first (RESTORE.md, "From the vault")`);
  const manifest = JSON.parse(Buffer.from(await mr.arrayBuffer()).toString('utf8'));
  const objs = selectObjects(manifest, { only, prefix });
  const live = await list(MAIN_BUCKET, prefix || '');
  const staged = new Set((await list(BACKUP_BUCKET, `${FROM_VAULT}files/`)).keys());
  const plan = planRestore(objs, live, staged);
  const manifestNames = new Set(manifest.objects.map((o) => o.name));
  const notInManifest = prefix || only.length ? null : [...live.keys()].filter((n) => !n.endsWith('/') && !manifestNames.has(n)).length;

  log(`manifest: ${manifest.count} object(s) taken ${String(manifest.takenAt).slice(0, 10)}; chosen ${objs.length}`);
  log(`  ${plan.identical.length} already identical live, ${plan.restore.length} to restore, ${plan.missing.length} not copied in from the vault, ${plan.byHand.length} need restoring by hand (Content-Encoding)`);
  if (notInManifest !== null) log(`  ${notInManifest} live object(s) not in the manifest: left alone (nothing here deletes)`);

  const guard = await openGuard('restore-files', { argv, env, log, token: ep.emulator ? undefined : token });
  let restored = 0, mismatched = 0, readBackFailed = 0;
  for (const batch of batches(plan.restore)) {
    const uploads = [];
    for (const o of batch) {
      const r = await get(BACKUP_BUCKET, sourceName(o));
      if (!r.ok) { mismatched++; continue; }
      const body = Buffer.from(await r.arrayBuffer());
      if (o.md5Hash && md5(body) !== o.md5Hash) { mismatched++; continue; }
      uploads.push({
        bucket: MAIN_BUCKET, name: o.name, body, contentType: o.contentType || 'application/octet-stream',
        ...(o.metadata ? { metadata: o.metadata } : {}), ...(o.cacheControl ? { cacheControl: o.cacheControl } : {}),
        ...(o.contentDisposition ? { contentDisposition: o.contentDisposition } : {}), ...(o.contentLanguage ? { contentLanguage: o.contentLanguage } : {}),
      });
    }
    if (!uploads.length) continue;
    const res = await guard.storage({ uploads }, { label: 'restore files from the vault' });
    if (!res.applied) continue;
    const after = await list(MAIN_BUCKET, prefix || '');
    for (const u of uploads) {
      const want = objs.find((o) => o.name === u.name).md5Hash;
      if (after.get(u.name) && (!want || after.get(u.name).md5Hash === want)) restored++; else readBackFailed++;
    }
  }
  if (guard.apply) log(`read back: ${restored} restored and identical to the manifest, ${readBackFailed} not, ${mismatched} refused (the copied-in bytes did not match the manifest)`);
  guard.summary();
  const bad = plan.missing.length + plan.byHand.length + mismatched + readBackFailed;
  return { plan: Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length])), restored, mismatched, readBackFailed, notInManifest, exitCode: bad ? 1 : 0 };
}

const direct = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  restoreFiles().then((r) => { process.exitCode = r.exitCode; }, (e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; });
}
