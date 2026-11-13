// SAFETY-2B — restoring from the vault, against the database and storage emulators.
//
//   npm run test:vault:emulator
//
// Files: a manifest and its generations copied in under from-vault/ are put back through the
// guard. Dry by default; --apply backs up what it overwrites, keeps download tokens, skips what is
// already identical, never deletes, refuses bytes that don't match the manifest, and exits 1 when
// anything listed wasn't copied in. Archives: from-vault/ copies are restorable but never count as
// the scheduled backup (liveness would otherwise call a stopped schedule fresh).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { BACKUP_BUCKET, MAIN_BUCKET } from '../../scripts/safety/guard.mjs';
import { restoreFiles, planRestore, selectObjects, batches } from '../../scripts/backup/restore-files.mjs';
import { isScheduledArchive, isRestorableArchive, isVaultArchive, parseArchive } from '../../scripts/backup/archives.mjs';
import { assess } from '../../scripts/backup/assess.mjs';

process.env.GUARD_DB_NAMESPACE = process.env.GCLOUD_PROJECT;
const ST = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`;
const OWNER = { Authorization: 'Bearer owner' };
const md5 = (b) => createHash('md5').update(b).digest('base64');

async function put(bucket, name, body, meta = {}) {
  const boundary = 'b' + Math.random().toString(16).slice(2);
  const m = { name, contentType: meta.contentType || 'application/octet-stream', ...(meta.metadata ? { metadata: meta.metadata } : {}), ...(meta.cacheControl ? { cacheControl: meta.cacheControl } : {}) };
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(m)}\r\n--${boundary}\r\nContent-Type: ${m.contentType}\r\n\r\n`),
    Buffer.from(body), Buffer.from(`\r\n--${boundary}--`)]);
  const r = await fetch(`${ST}/upload/storage/v1/b/${bucket}/o?uploadType=multipart`, { method: 'POST', headers: { ...OWNER, 'Content-Type': `multipart/related; boundary=${boundary}` }, body: payload });
  assert.ok(r.ok, `seed upload failed ${r.status}`);
  return r.json();
}
const meta = async (bucket, name) => { const r = await fetch(`${ST}/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}`, { headers: OWNER }); return r.ok ? r.json() : null; };
const bytes = async (bucket, name) => Buffer.from(await (await fetch(`${ST}/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`, { headers: OWNER })).arrayBuffer());
const list = async (bucket, prefix) => ((await (await fetch(`${ST}/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}`, { headers: OWNER })).json()).items || []);

const FILES = {
  'covers-typographic/a/cover.png': { body: 'cover-v1', contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: 'token-a' }, cacheControl: 'public, max-age=31536000' },
  'bookstore_epubs/master/book.epub': { body: 'epub-v1', contentType: 'application/epub+zip', metadata: { firebaseStorageDownloadTokens: 'token-b' } },
  'avatars/u/face.jpg': { body: 'face-v1', contentType: 'image/jpeg' },
  'unused/kept.bin': { body: 'kept', contentType: 'application/octet-stream' },
};
let manifest;
const MANIFEST = 'from-vault/files-manifest/2026-11-15.json';

before(async () => {
  // The vault's manifest and generations, as Ikenna copies them in (RESTORE.md, "From the vault").
  const objects = Object.entries(FILES).map(([name, f], i) => ({
    name, generation: String(1700000000000000 + i), size: Buffer.byteLength(f.body), md5Hash: md5(f.body),
    contentType: f.contentType, metadata: f.metadata || null, cacheControl: f.cacheControl || null, contentEncoding: null,
  }));
  manifest = { format: 'vault-files-manifest/1', source: 'site-files', vaultPrefix: 'files/', takenAt: '2026-11-15T05:30:00Z', count: objects.length, bytes: 0, objects };
  for (const o of objects) {
    if (o.name === 'avatars/u/face.jpg') continue; // listed, but not copied in: the run must say so
    await put(BACKUP_BUCKET, `from-vault/files/${o.generation}/${o.name}`, FILES[o.name].body, { contentType: o.contentType, metadata: o.metadata });
  }
  await put(BACKUP_BUCKET, MANIFEST, JSON.stringify(manifest), { contentType: 'application/json' });
  // The live bucket after the damage: one file overwritten, one deleted, one identical, one new.
  await put(MAIN_BUCKET, 'covers-typographic/a/cover.png', 'DAMAGED', { contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: 'token-new' } });
  await put(MAIN_BUCKET, 'unused/kept.bin', 'kept');
  await put(MAIN_BUCKET, 'new-since/upload.png', 'new');
});

const run = async (argv) => { const logs = []; const r = await restoreFiles({ argv, log: (s) => logs.push(s) }); return { ...r, logs }; };

test('the dry run writes nothing and counts the plan', async () => {
  const r = await run(['--manifest', MANIFEST]);
  assert.deepEqual(r.plan, { identical: 1, restore: 2, missing: 1, byHand: 0 });
  assert.equal(r.notInManifest, 1);
  assert.equal(String(await bytes(MAIN_BUCKET, 'covers-typographic/a/cover.png')), 'DAMAGED');
  assert.equal((await list(BACKUP_BUCKET, 'guard/restore-files/')).length, 0, 'a dry run takes no backup');
  assert.equal(r.exitCode, 1, 'a listed file that was not copied in fails the run');
  assert.ok(!r.logs.join('\n').includes('cover.png'), 'counts only, no paths');
});

test('--apply restores through the guard: backup first, the bytes and the download token back, nothing deleted', async () => {
  const r = await run(['--manifest', MANIFEST, '--apply']);
  assert.equal(r.restored, 2);
  assert.equal(r.readBackFailed, 0);
  assert.equal(String(await bytes(MAIN_BUCKET, 'covers-typographic/a/cover.png')), 'cover-v1');
  const m = await meta(MAIN_BUCKET, 'covers-typographic/a/cover.png');
  assert.equal(m.metadata.firebaseStorageDownloadTokens, 'token-a', 'the old download token is back, so stored URLs work again');
  assert.equal(m.cacheControl, 'public, max-age=31536000');
  assert.equal(String(await bytes(MAIN_BUCKET, 'bookstore_epubs/master/book.epub')), 'epub-v1', 'a deleted file comes back');
  assert.ok(await meta(MAIN_BUCKET, 'new-since/upload.png'), 'a file newer than the manifest is left alone');
  const backups = await list(BACKUP_BUCKET, 'guard/restore-files/');
  assert.ok(backups.some((b) => b.name.endsWith('.json')), 'the guard recorded the batch');
  assert.ok(backups.some((b) => b.name.includes('/objects/') && b.name.endsWith('covers-typographic/a/cover.png')), 'the overwritten object was backed up before the write');
});

test('a second --apply finds everything identical and writes nothing', async () => {
  const before = (await list(BACKUP_BUCKET, 'guard/restore-files/')).length;
  const r = await run(['--manifest', MANIFEST, '--apply', '--prefix', 'covers-typographic/']);
  assert.deepEqual(r.plan, { identical: 1, restore: 0, missing: 0, byHand: 0 });
  assert.equal(r.exitCode, 0);
  assert.equal((await list(BACKUP_BUCKET, 'guard/restore-files/')).length, before);
});

test('bytes that do not match the manifest are refused', async () => {
  await put(BACKUP_BUCKET, `from-vault/files/${manifest.objects[2].generation}/avatars/u/face.jpg`, 'TAMPERED', { contentType: 'image/jpeg' });
  const r = await run(['--manifest', MANIFEST, '--apply', '--only', 'avatars/u/face.jpg']);
  assert.equal(r.mismatched, 1);
  assert.equal(r.restored, 0);
  assert.equal(r.exitCode, 1);
  assert.equal(await meta(MAIN_BUCKET, 'avatars/u/face.jpg'), null);
});

test('it reads only a manifest copied in under from-vault/', async () => {
  await assert.rejects(run(['--manifest', 'guard/x.json']), /from-vault\/files-manifest\//);
  await assert.rejects(run(['--manifest', MANIFEST, '--only', 'not/in/it.png']), /not in this manifest/);
});

test('the plan and the batches (pure)', () => {
  const objs = selectObjects(manifest);
  const plan = planRestore(objs, new Map([['unused/kept.bin', { md5Hash: md5('kept') }]]), new Set(objs.map((o) => `from-vault/files/${o.generation}/${o.name}`)));
  assert.equal(plan.identical.length, 1);
  assert.equal(plan.restore.length, 3);
  assert.equal(planRestore([{ ...objs[0], contentEncoding: 'gzip' }], new Map(), new Set([`from-vault/files/${objs[0].generation}/${objs[0].name}`])).byHand.length, 1);
  assert.throws(() => selectObjects({ format: 'x' }));
  assert.throws(() => selectObjects({ ...manifest, objects: [{ name: '', generation: '1' }] }));
  const many = Array.from({ length: 45 }, (_, i) => ({ name: `f${i}`, size: 10 }));
  assert.deepEqual(batches(many).map((b) => b.length), [20, 20, 5]);
  assert.deepEqual(batches([{ name: 'a', size: 60e6 }, { name: 'b', size: 60e6 }]).map((b) => b.length), [1, 1]);
});

test('archives: a from-vault copy is restorable but never counts as the scheduled backup', () => {
  const sched = '2026-11-15T00:13:25Z_calvary-scribblings-default-rtdb_data.json.gz';
  assert.ok(isScheduledArchive(sched) && isRestorableArchive(sched) && !isVaultArchive(sched));
  assert.ok(isVaultArchive(`from-vault/${sched}`) && isRestorableArchive(`from-vault/${sched}`) && !isScheduledArchive(`from-vault/${sched}`));
  assert.ok(isVaultArchive(`from-vault/database/${sched}`));
  for (const bad of ['guard/x/batch-1.json', `guard/${sched}`, 'from-vault/../x_data.json.gz', 'from-vault//x_data.json.gz', 'x_rules.json.gz', `from-vault/${sched.replace('_data', '_rules')}`]) {
    assert.ok(!isRestorableArchive(bad), bad);
  }
  // liveness: a stopped schedule stays STALE even after a vault copy was staged today
  const NOW = Date.parse('2026-11-15T09:00:00Z');
  const old = { name: sched, size: String(6e6), timeCreated: '2026-11-12T00:13:25Z' };
  const staged = { name: `from-vault/${sched}`, size: String(6e6), timeCreated: '2026-11-15T08:00:00Z' };
  assert.match(assess([old, staged], NOW, {}).problems[0], /^STALE/);
  assert.equal(assess([old, staged], NOW, {}).newest.name, sched);
  // parseArchive: gzip by magic bytes, or already inflated by the transport
  const tree = { a: 1, b: { c: 'd' } };
  assert.deepEqual(parseArchive(gzipSync(JSON.stringify(tree))), tree);
  assert.deepEqual(parseArchive(Buffer.from(JSON.stringify(tree))), tree);
});
