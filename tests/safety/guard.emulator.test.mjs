// SAFETY-1 — the guard, end to end, against the database AND storage emulators.
//
//   npm run test:safety-guard:emulator
//
// Proves: nothing is written without --apply; with it, the backup lands, is verified, and holds
// exactly the paths about to change; a failed backup means no write; the root and blank ids are
// refused; the firebase-admin wrappers route every write through the same steps; and a guard
// backup restores what was there.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import { openGuard, readOnlyDb, readOnlyBucket, BACKUP_BUCKET, MAIN_BUCKET } from '../../scripts/safety/guard.mjs';
import { restoreBatch } from '../../scripts/safety/restore.mjs';

process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= '127.0.0.1:9000';
process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= '127.0.0.1:9199';
const NS = process.env.GCLOUD_PROJECT || 'demo-safety';
process.env.GUARD_DB_NAMESPACE = NS;
const DB = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}`;
const ST = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`;
const OWNER = { Authorization: 'Bearer owner' };

const rget = async (p) => (await fetch(`${DB}/${p}.json?ns=${NS}`, { headers: OWNER })).json();
const rput = async (p, v) => fetch(`${DB}/${p}.json?ns=${NS}`, { method: 'PUT', headers: OWNER, body: JSON.stringify(v) });
const listBackups = async (prefix) => {
  const r = await fetch(`${ST}/storage/v1/b/${BACKUP_BUCKET}/o?prefix=${encodeURIComponent(prefix)}`, { headers: OWNER });
  return r.ok ? ((await r.json()).items || []) : [];
};
const readBackup = async (name) => JSON.parse(Buffer.from(await (await fetch(`${ST}/storage/v1/b/${BACKUP_BUCKET}/o/${encodeURIComponent(name)}?alt=media`, { headers: OWNER })).arrayBuffer()).toString('utf8'));
const quiet = { log: () => {} };
const lines = () => { const out = []; return { out, log: (s) => out.push(s) }; };

let app;
before(async () => {
  await fetch(`${DB}/.json?ns=${NS}`, { method: 'DELETE', headers: OWNER });
  await rput('story_bodies', { a: { content: 'A' }, b: { content: 'B' }, c: { content: 'C' } });
  app = initializeApp({ projectId: NS, databaseURL: `${DB}?ns=${NS}`, storageBucket: MAIN_BUCKET }, 'guard-test');
});
after(async () => { await deleteApp(app); });

describe('SAFETY-1 · the guard (REST)', () => {
  test('without --apply nothing is written and nothing is backed up', async () => {
    const L = lines();
    const g = await openGuard('t-dry', { argv: ['node', 'x'], ...L });
    const r = await g.update({ 'story_bodies/a': null, 'story_bodies/z': { content: 'Z' } });
    assert.equal(r.applied, false);
    assert.equal((await rget('story_bodies/a')).content, 'A');
    assert.equal(await rget('story_bodies/z'), null);
    assert.equal((await listBackups('guard/t-dry/')).length, 0);
    assert.match(L.out.join('\n'), /DRY RUN, would write 2 path\(s\) in 1 node\(s\), 1 of them deletions/);
  });

  test('with --apply: backup of EXACTLY the touched paths, verified, then the write', async () => {
    const g = await openGuard('t-apply', { argv: ['node', 'x', '--apply'], ...quiet });
    const r = await g.update({ 'story_bodies/a': { content: 'A2' }, 'story_bodies/new': { content: 'N' } });
    assert.equal(r.applied, true);
    const objs = await listBackups('guard/t-apply/');
    assert.equal(objs.length, 1);
    const doc = await readBackup(objs[0].name);
    assert.deepEqual(Object.keys(doc.paths).sort(), ['story_bodies/a', 'story_bodies/new']);
    assert.deepEqual(doc.paths['story_bodies/a'], { content: 'A' });
    assert.equal(doc.paths['story_bodies/new'], null);
    assert.equal((await rget('story_bodies/a')).content, 'A2');
    assert.equal((await rget('story_bodies/b')).content, 'B', 'an untouched sibling is untouched');
  });

  test('a wholesale PUT of a node is backed up whole before it lands', async () => {
    const g = await openGuard('t-whole', { argv: ['--apply'], ...quiet });
    const before = await rget('story_bodies');
    await g.update({ story_bodies: { only: { content: 'O' } } });
    const [obj] = await listBackups('guard/t-whole/');
    assert.deepEqual((await readBackup(obj.name)).paths.story_bodies, before);
    await rput('story_bodies', before); // put the fixture back for the next tests
  });

  test('a failed backup means NO write', async () => {
    const env = { ...process.env, FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:1' }; // nothing listens there
    const g = await openGuard('t-fail', { argv: ['--apply'], env, ...quiet });
    await assert.rejects(g.update({ 'story_bodies/b': null }), /GUARD REFUSED: the backup upload failed/);
    assert.equal((await rget('story_bodies/b')).content, 'B');
  });

  test('the root, a blank id, and an "undefined" segment are refused before anything happens', async () => {
    const g = await openGuard('t-paths', { argv: ['--apply'], ...quiet });
    const slug = '';
    await assert.rejects(g.update({ '': {} }), /ROOT/);
    await assert.rejects(g.update({ [`story_bodies/${slug}`]: null }), /empty segment/);
    await assert.rejects(g.update({ [`story_bodies/${undefined}`]: null }), /placeholder/);
    await assert.rejects(g.update({ 'story_bodies/a': 1, 'story_bodies/a/content': 2 }), /overlap/);
    assert.equal((await listBackups('guard/t-paths/')).length, 0);
  });

  test('emulator and production are never mixed', async () => {
    await assert.rejects(openGuard('t-mix', { env: { FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000' }, ...quiet }), /mix the emulator with production/);
  });

  test('transact: conditional, backed up, and null deletes', async () => {
    await rput('counters', { x: 3, y: 1 });
    const g = await openGuard('t-txn', { argv: ['--apply'], ...quiet });
    const res = await g.transact(['counters/x', 'counters/y'], (c) => (c > 1 ? c - 1 : null));
    assert.deepEqual(res.map((r) => r.committed), [true, true]);
    assert.deepEqual(await rget('counters'), { x: 2 });
    const [obj] = await listBackups('guard/t-txn/');
    assert.deepEqual((await readBackup(obj.name)).paths, { 'counters/x': 3, 'counters/y': 1 });
  });

  test('a guard backup restores what was there (and the restore is guarded too)', async () => {
    const g = await openGuard('t-undo', { argv: ['--apply'], ...quiet });
    const r = await g.update({ 'story_bodies/c': null, 'story_bodies/d': { content: 'D' } });
    assert.equal(await rget('story_bodies/c'), null);
    const name = r.backup.replace(/^.*gs:\/\/[^/]+\//, '');
    await restoreBatch(name, { argv: ['node', 'x'], ...quiet }); // dry
    assert.equal(await rget('story_bodies/c'), null, 'a dry restore writes nothing');
    await restoreBatch(name, { argv: ['--apply'], ...quiet });
    assert.equal((await rget('story_bodies/c')).content, 'C');
    assert.equal(await rget('story_bodies/d'), null, 'a path the write created is removed again');
    assert.equal((await listBackups('guard/restore/')).length, 1, 'the restore backed up what it replaced');
  });

  test('it prints counts, never a value or a key', async () => {
    const L = lines();
    const g = await openGuard('t-quiet', { argv: ['--apply'], ...L });
    await g.update({ 'story_bodies/secret-slug-xyz': { content: 'the secret text' } });
    const all = L.out.join('\n');
    assert.doesNotMatch(all, /secret-slug-xyz|the secret text/);
  });
});

describe('SAFETY-1 · the guard (firebase-admin wrappers)', () => {
  test('adminDb: set / update / remove / push / transaction all go through the backup', async () => {
    const g = await openGuard('t-sdk', { argv: ['--apply'], ...quiet });
    const db = g.adminDb(getDatabase(app));
    await db.ref('w/one').set({ v: 1 });
    await db.ref('w').update({ two: 2, 'one/v': 9 });
    await db.ref('w').child('two').remove();
    const pushed = await db.ref('w/list').push({ p: true });
    assert.ok(pushed.key);
    const t = await db.ref('w/one/v').transaction((c) => (typeof c === 'number' ? c + 1 : c));
    assert.equal(t.committed, true);
    assert.equal(t.snapshot.val(), 10);
    assert.deepEqual((await rget('w')).one, { v: 10 });
    assert.equal((await listBackups('guard/t-sdk/')).filter((o) => /batch-\d+\.json$/.test(o.name)).length, 5);
    await assert.rejects(async () => db.ref().set({}), /ROOT/);
    assert.throws(() => db.ref('w').setWithPriority(1, 1), /not available through the guard/);
  });

  // LIVE-PATHS-2 (sweep, guard gap 1): firebase-admin drops empty segments, so `users/${''}`
  // arrives at the wrapper as `users`. The string is now checked before firebase-admin sees it.
  // On 75cb7710..dc568418 the remove() below took the whole `gap` node.
  test('adminDb: a path with an empty segment is refused before firebase-admin drops it', async () => {
    await rput('gap', { keep: { v: 1 }, also: { v: 2 } });
    const g = await openGuard('t-sdk-gap', { argv: ['--apply'], ...quiet });
    const db = g.adminDb(getDatabase(app));
    const blank = '';
    assert.throws(() => db.ref(`gap/${blank}`), /empty segment/);
    assert.throws(() => db.ref(`gap//keep`), /empty segment/);
    assert.throws(() => db.ref('gap').child(`${blank}/`), /empty segment|empty path/);
    assert.throws(() => db.ref('gap').child(blank), /empty path/);
    assert.throws(() => db.refFromURL(`${DB}/gap/?ns=${NS}`), /empty segment/);
    // The attack as a script would have written it, end to end: refused, and nothing changed.
    await assert.rejects(async () => db.ref(`gap/${blank}`).remove(), /empty segment/);
    assert.deepEqual(await rget('gap'), { keep: { v: 1 }, also: { v: 2 } });
    // What stays allowed: a leading slash, the root for a read, an ordinary child.
    assert.equal((await db.ref('/gap/keep/v').get()).val(), 1);
    assert.ok(db.ref());
    await db.ref('gap').child('also').remove();
    assert.deepEqual(await rget('gap'), { keep: { v: 1 } });
  });

  test('adminDb dry: reads work, writes do not', async () => {
    const g = await openGuard('t-sdk-dry', { argv: [], ...quiet });
    const db = g.adminDb(getDatabase(app));
    assert.equal((await db.ref('w/one/v').get()).val(), 10);
    await db.ref('w/one').remove();
    assert.equal((await rget('w/one/v')), 10);
  });

  test('readOnlyDb / readOnlyBucket: reads work, every write throws', async () => {
    const db = readOnlyDb(getDatabase(app));
    assert.equal((await db.ref('w').child('one').get()).exists(), true);
    for (const w of ['set', 'update', 'remove', 'push', 'transaction']) {
      assert.throws(() => db.ref('w').child('one')[w]({}), /read-only handle/, w);
    }
    const bucket = readOnlyBucket(getStorage(app).bucket(MAIN_BUCKET));
    assert.throws(() => bucket.file('x').save('y'), /read-only handle/);
    assert.throws(() => bucket.deleteFiles(), /read-only handle/);
  });

  test('adminBucket: delete and overwrite are backed up byte-exact, conditional on the generation', async () => {
    const raw = getStorage(app).bucket(MAIN_BUCKET);
    await raw.file('voices/x/a.txt').save('first');
    await raw.file('voices/x/b.txt').save('second');
    const g = await openGuard('t-bucket', { argv: ['--apply'], ...quiet });
    const bucket = g.adminBucket(raw);
    const [files] = await bucket.getFiles({ prefix: 'voices/x/' });
    await Promise.all(files.map((f) => f.delete()));
    assert.equal((await raw.getFiles({ prefix: 'voices/x/' }))[0].length, 0);
    const copies = (await listBackups('guard/t-bucket/')).filter((o) => o.name.includes('/objects/'));
    assert.equal(copies.length, 2);
    await bucket.file('covers/y.txt').save('new');
    assert.throws(() => bucket.deleteFiles({ prefix: 'covers/' }), /not available through the guard/);
    assert.throws(() => bucket.file('covers/y.txt').copy('z'), /not available through the guard/);
  });

  test('REST storage + restore: a deleted object comes back byte-exact', async () => {
    const raw = getStorage(app).bucket(MAIN_BUCKET);
    await raw.file('covers/keep.png').save(Buffer.from([1, 2, 3, 4]), { contentType: 'image/png', metadata: { metadata: { firebaseStorageDownloadTokens: 'tok' } } });
    const g = await openGuard('t-st', { argv: ['--apply'], ...quiet });
    const r = await g.storage({ deletes: [{ name: 'covers/keep.png' }] });
    assert.equal(r.applied, true);
    assert.equal((await raw.file('covers/keep.png').exists())[0], false);
    const [manifest] = (await listBackups('guard/t-st/')).filter((o) => /batch-\d+\.json$/.test(o.name));
    await restoreBatch(manifest.name, { argv: ['--apply'], ...quiet });
    const [bytes] = await raw.file('covers/keep.png').download();
    assert.deepEqual([...bytes], [1, 2, 3, 4]);
    const [m] = await raw.file('covers/keep.png').getMetadata();
    assert.equal(m.metadata.firebaseStorageDownloadTokens, 'tok', 'the download token comes back with it');
  });
});
