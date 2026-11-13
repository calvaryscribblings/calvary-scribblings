// SAFETY-2B — the accounts restore test's emulator run (docs/VAULT.md §7, ruling 271).
//
//   npm run test:vault:emulator
//
// The whole pipe, offline: the puller's own age encryption of an accounts file → the reference
// library decrypts it (as `age -d` would in Cloud Shell) → scripts/backup/accounts-drill.mjs imports
// the flagged test reader, and only it, into the Auth emulator, checks the record, deletes it.
// And every refusal: no flag, a founder flagged, the reader absent or there twice, a site target,
// a drill run with no password hash. The emulator never verifies an imported password (it can't),
// which is why the password proof belongs to the drill project.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as age from 'age-encryption';
import { ageEncrypt } from '../../vault/puller/puller.mjs';
import { runDrill, pickTestReader, importBody, resolveTarget, DrillRefusal, SITE_PROJECT } from '../../scripts/backup/accounts-drill.mjs';
import { FOUNDER_UIDS } from '../../app/lib/founders.js';

const P = process.env.GCLOUD_PROJECT;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const DB = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const READER = 'driLLtestReaderUid0000000001';
const OTHERS = ['otherReaderUid00000000000001', 'otherReaderUid00000000000002'];
const HASH = { algorithm: 'SCRYPT', signerKey: 'c2lnbmVyLWtleS1mb3ItdGVzdHM=', saltSeparator: 'Bw==', rounds: 8, memoryCost: 14 };
const dir = mkdtempSync(join(tmpdir(), 'vault-drill-'));

const user = (localId, n, pw = true) => ({
  localId, email: `reader${n}@drill.invalid`, emailVerified: true, displayName: `Reader ${n}`,
  ...(pw ? { passwordHash: 'aGFzaC1ieXRlcw==', salt: 'c2FsdA==' } : {}),
  providerUserInfo: [{ providerId: 'password', rawId: `reader${n}@drill.invalid`, email: `reader${n}@drill.invalid` }],
  createdAt: '1700000000000', lastLoginAt: '1700000000000',
});
const FILE = { format: 'vault-accounts/1', project: SITE_PROJECT, exportedAt: '2026-11-15T05:30:00.000Z', hashConfig: HASH,
  users: [user(OTHERS[0], 1), user(READER, 2), user(OTHERS[1], 3)] };

const setFlag = (uid) => fetch(`${DB}/ops/live_test_reader.json?ns=${P}`, { method: 'PUT', headers: OWNER, body: JSON.stringify(uid ? { uid } : null) });
const accounts = async () => ((await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${P}/accounts:batchGet?maxResults=100`, { headers: OWNER })).json()).users || []);
const writeFile = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
const drill = (file, extra = [], env = process.env) => {
  const logs = [];
  return runDrill({ argv: ['--accounts', file, '--target', 'emulator', ...extra], env: { ...env }, log: (s) => logs.push(s) }).then((r) => ({ ...r, logs }));
};

before(async () => {
  await fetch(`${AUTH}/emulator/v1/projects/${P}/accounts`, { method: 'DELETE' });
  await setFlag(READER);
});

test('the full pipe: puller-encrypted file → decrypted → the one test reader imported, checked and deleted', async () => {
  const id = await age.generateX25519Identity();
  const sealed = ageEncrypt(Buffer.from(JSON.stringify(FILE)), await age.identityToRecipient(id));
  const d = new age.Decrypter(); d.addIdentity(id);
  const path = join(dir, 'decrypted.json');
  writeFileSync(path, await d.decrypt(new Uint8Array(sealed), 'text'));
  const seen = [];
  const realFetch = globalThis.fetch;
  const r = await runDrill({ argv: ['--accounts', path, '--target', 'emulator'], env: { ...process.env }, log: () => {},
    fetchFn: async (u, init) => { if (String(u).includes('accounts:batchCreate')) seen.push(JSON.parse(init.body)); return realFetch(u, init); } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.imported, true);
  assert.equal(r.recordMatches, true);
  assert.equal(r.deleted, true);
  assert.equal(seen.length, 1, 'one import call');
  assert.deepEqual(seen[0].users.map((u) => u.localId), [READER], 'it carried the test reader and nobody else');
  assert.equal(seen[0].hashAlgorithm, 'SCRYPT', 'with the file\'s hash parameters');
  assert.deepEqual(await accounts(), [], 'nothing is left in the emulator afterwards');
});

test('the drill leaves nothing behind and prints no uid, email or hash', async () => {
  const r = await drill(writeFile('f.json', FILE));
  assert.equal(r.ok, true);
  assert.equal((await accounts()).length, 0);
  const text = r.logs.join('\n');
  for (const s of [READER, ...OTHERS, '@drill.invalid', 'aGFzaC1ieXRlcw==', HASH.signerKey]) assert.ok(!text.includes(s), 'the drill prints no uid, email or hash');
  assert.match(text, /password: not provable here/);
});

test('it refuses every account but the flagged test reader', async () => {
  await assert.rejects(drill(writeFile('absent.json', { ...FILE, users: FILE.users.filter((u) => u.localId !== READER) })), /not in this accounts file/);
  await assert.rejects(drill(writeFile('twice.json', { ...FILE, users: [...FILE.users, user(READER, 9)] })), /more than once/);
  await assert.rejects(drill(writeFile('notvault.json', { users: FILE.users })), /not a vault accounts file/);
  await setFlag(null);
  await assert.rejects(drill(writeFile('f2.json', FILE)), /not flagged/);
  await setFlag(FOUNDER_UIDS[0]);
  await assert.rejects(drill(writeFile('f3.json', { ...FILE, users: [...FILE.users, user(FOUNDER_UIDS[0], 7)] })), /founder/);
  await setFlag(READER);
  assert.deepEqual(await accounts(), [], 'no refusal imported anything');
});

test('the import body can only ever hold the one record', () => {
  const { record, others } = pickTestReader(FILE, READER);
  assert.equal(record.localId, READER);
  assert.equal(others, 2);
  assert.deepEqual(importBody(record, HASH, READER).users.length, 1);
  assert.throws(() => importBody(record, HASH, OTHERS[0]), DrillRefusal);
  assert.throws(() => importBody(record, null, READER), /no hash parameters/);
});

test('it never targets the site: the emulator needs a demo- project, the drill refuses the site by name', () => {
  assert.throws(() => resolveTarget({ target: 'emulator', env: { FIREBASE_AUTH_EMULATOR_HOST: 'x', FIREBASE_DATABASE_EMULATOR_HOST: 'y', GCLOUD_PROJECT: SITE_PROJECT } }), /demo-/);
  assert.throws(() => resolveTarget({ target: 'emulator', env: { GCLOUD_PROJECT: 'demo-x' } }), /FIREBASE_AUTH_EMULATOR_HOST/);
  const drillEnv = { DRILL_API_KEY: 'k', DRILL_PASSWORD: 'p' };
  assert.throws(() => resolveTarget({ target: 'drill', drillProject: SITE_PROJECT, env: drillEnv }), /is the site/);
  assert.throws(() => resolveTarget({ target: 'drill', env: drillEnv }), /--drill-project/);
  assert.throws(() => resolveTarget({ target: 'drill', drillProject: 'some-drill', env: { DRILL_API_KEY: 'k' } }), /DRILL_PASSWORD/);
  assert.throws(() => resolveTarget({ target: 'drill', drillProject: 'some-drill', env: { ...drillEnv, FIREBASE_AUTH_EMULATOR_HOST: 'x' } }), /mix with the emulator/);
  assert.throws(() => resolveTarget({ target: 'live', env: {} }), /emulator or drill/);
  assert.equal(resolveTarget({ target: 'drill', drillProject: 'some-drill', env: drillEnv }).project, 'some-drill');
});

test('a drill run refuses a test reader with no password hash: it would prove nothing', async () => {
  const noPw = { ...FILE, users: FILE.users.map((u) => (u.localId === READER ? user(READER, 2, false) : u)) };
  const path = writeFile('nopw.json', noPw);
  const calls = [];
  await assert.rejects(runDrill({
    argv: ['--accounts', path, '--target', 'drill', '--drill-project', 'some-drill'], env: { DRILL_API_KEY: 'k', DRILL_PASSWORD: 'p' }, log: () => {}, token: 't',
    fetchFn: async (u) => { calls.push(String(u)); return new Response(JSON.stringify(READER), { status: 200 }); },
  }), /no password in this file/);
  assert.equal(calls.length, 1, 'only the flag was read; nothing was sent to the drill project');
  assert.ok(!calls[0].includes('identitytoolkit'));
});

test('a drill run signs in with the password and deletes the account (fake drill project)', async () => {
  const path = writeFile('drill.json', FILE);
  const env = { DRILL_API_KEY: 'k', DRILL_PASSWORD: 'the-password' };
  const calls = [];
  const fake = async (u, init = {}) => {
    const url = String(u); calls.push({ url, body: init.body, headers: init.headers });
    if (url.includes('firebasedatabase.app')) return new Response(JSON.stringify(READER), { status: 200 });
    if (url.endsWith('accounts:batchCreate')) return new Response('{}', { status: 200 });
    if (url.endsWith('accounts:lookup')) return new Response(JSON.stringify({ users: [user(READER, 2)] }), { status: 200 });
    if (url.includes('signInWithPassword')) return new Response(JSON.stringify({ localId: READER }), { status: 200 });
    if (url.endsWith('accounts:delete')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const r = await runDrill({ argv: ['--accounts', path, '--target', 'drill', '--drill-project', 'some-drill'], env, log: () => {}, token: 't', fetchFn: fake });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.passwordProved, true);
  assert.ok(calls.filter((c) => c.url.includes('/projects/')).every((c) => c.url.includes('/projects/some-drill/')), 'every admin call goes to the drill project');
  assert.ok(calls.filter((c) => c.url.includes('firebasedatabase.app')).length === 1, 'the site is read once (the flag) and never written');
  assert.ok(calls.filter((c) => c.url.includes('/projects/')).every((c) => c.headers['x-goog-user-project'] === 'some-drill'));
  assert.equal(env.DRILL_PASSWORD, undefined, 'the password is dropped from the environment after use');
  rmSync(dir, { recursive: true, force: true });
});
