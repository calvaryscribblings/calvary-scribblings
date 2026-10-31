// SAFETY-1 — put back what a guarded write replaced.
//
//   node scripts/safety/restore.mjs gs://calvary-scribblings-default-rtdb-backups/guard/<script>/<stamp>/batch-N.json
//   node scripts/safety/restore.mjs <same> --apply
//
// Every guarded write leaves one batch file per write: the value of each database path just
// before it was written (null = it did not exist), or for Storage a manifest of each object it
// deleted or overwrote with a byte-exact copy beside it. This puts those back.
//
// A restore is itself a bulk write, so it goes through the guard like any other: DRY BY DEFAULT,
// and with --apply it first backs up what it is about to replace (so a restore can be undone the
// same way). Counts only on screen.
//
// Storage caveat (RESTORE.md §4): a restored object is a NEW generation. If the object was a
// master EPUB, its generation is the reading-position pin, and readers fall back to an approximate
// position whatever you do.

import { pathToFileURL } from 'node:url';
import { openGuard, BACKUP_BUCKET, endpoints } from './guard.mjs';

export function parseBackupUrl(u) {
  const m = /^gs:\/\/([^/]+)\/(.+\.json)$/.exec(String(u || ''));
  if (!m) throw new Error('give the backup as gs://<bucket>/guard/<script>/<stamp>/batch-N.json');
  if (m[1] !== BACKUP_BUCKET) throw new Error(`guard backups live in ${BACKUP_BUCKET}`);
  return m[2];
}

/** The writes that undo one batch. Pure, so it can be tested without a bucket. */
export function planRestore(batchDoc) {
  if (!batchDoc || batchDoc.format !== 'safety-guard/1') throw new Error('not a guard backup');
  if (batchDoc.kind === 'rtdb') return { kind: 'rtdb', updates: { ...batchDoc.paths } };
  if (batchDoc.kind === 'storage') {
    const restore = batchDoc.objects.filter((o) => o.existed);
    const remove = batchDoc.objects.filter((o) => !o.existed && o.op === 'upload'); // created by the write
    return { kind: 'storage', restore, remove };
  }
  throw new Error(`unknown backup kind ${batchDoc.kind}`);
}

export async function restoreBatch(objName, { argv = process.argv, env = process.env, log = console.log, token } = {}) {
  const guard = await openGuard('restore', { argv, env, log, token });
  const ep = endpoints(env);
  const H = { Authorization: `Bearer ${token || (ep.emulator ? 'owner' : await (async () => {
    const { loadServiceAccount } = await import('../security/service-account.mjs');
    const { mintToken } = await import('../rules-pull.mjs');
    return mintToken(loadServiceAccount({ env }));
  })())}` };
  const fetchObj = async (name) => {
    const r = await fetch(`${ep.gcs}/storage/v1/b/${BACKUP_BUCKET}/o/${encodeURIComponent(name)}?alt=media`, { headers: H });
    if (!r.ok) throw new Error(`could not read the backup (HTTP ${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  };
  const doc = JSON.parse((await fetchObj(objName)).toString('utf8'));
  const plan = planRestore(doc);
  log(`backup: ${doc.kind}, taken ${doc.takenAt} by ${doc.script} (${doc.target}), batch ${doc.batch}`);
  if ((doc.target === 'emulator') !== ep.emulator) throw new Error(`this backup was taken against ${doc.target}; restore it there.`);
  if (plan.kind === 'rtdb') {
    const n = Object.keys(plan.updates).length;
    const nulls = Object.values(plan.updates).filter((v) => v === null).length;
    log(`restore: ${n} path(s), ${nulls} of which did not exist before and will be removed.`);
    await guard.update(plan.updates, { label: 'restore' });
  } else {
    const uploads = await Promise.all(plan.restore.map(async (o) => ({
      bucket: o.bucket, name: o.name, body: await fetchObj(o.copy), contentType: o.contentType || 'application/octet-stream',
      metadata: o.metadata || undefined, cacheControl: o.cacheControl || undefined,
    })));
    log(`restore: ${uploads.length} object(s) back, ${plan.remove.length} created by the write removed.`);
    await guard.storage({ uploads, deletes: plan.remove.map((o) => ({ bucket: o.bucket, name: o.name })) }, { label: 'restore' });
  }
  guard.summary();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = process.argv.slice(2).find((a) => a.startsWith('gs://'));
  restoreBatch(parseBackupUrl(arg)).catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
