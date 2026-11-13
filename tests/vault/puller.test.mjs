// SAFETY-2B — the vault's puller (vault/puller/puller.mjs), against fakes. No live call is made:
// every request goes to tests/vault/fake-world.mjs, which records it.
//
// What is pinned: every part lands where VAULT.md §3 says; a second run copies nothing it holds;
// the puller only ever CREATES (no DELETE, every write ifGenerationMatch=0, nothing written to the
// site); a dry run writes nothing; the accounts file opens with the age reference library and
// carries the hash parameters; Cloudflare is asked for script content and nothing else; the logs
// carry counts and never a name, uid, email or token; one failed part fails the run and the
// others still run; a missing setting exits 2 naming the variable, not its value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as age from 'age-encryption';
import { main, CF_ALLOWED, CANARY_TEXT, parseArgs, partsFor } from '../../vault/puller/puller.mjs';
import { makeWorld, ENV, SITE_FILES, SITE_PRIVATE, VAULT, CF_TOKEN } from './fake-world.mjs';

const identity = await age.generateX25519Identity();
const recipient = await age.identityToRecipient(identity);
const open = async (bytes) => { const d = new age.Decrypter(); d.addIdentity(identity); return d.decrypt(new Uint8Array(bytes), 'text'); };

const UIDS = ['uidAAAAAAAAAAAAAAAAAAAAAAAA1', 'uidBBBBBBBBBBBBBBBBBBBBBBBB2', 'uidCCCCCCCCCCCCCCCCCCCCCCCC3'];
function seeded() {
  const w = makeWorld();
  w.put(SITE_FILES, 'covers-typographic/a-story/cover.png', 'png-bytes', { contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: 'tok-1' } });
  w.put(SITE_FILES, 'bookstore_epubs/master/book.epub', 'epub-bytes');
  w.put(SITE_FILES, 'avatars/someone/face.jpg', 'jpg');
  w.put(SITE_FILES, 'unused/old-file.bin', 'old');
  w.put(SITE_FILES, 'folder-placeholder/', '');
  w.put(SITE_PRIVATE, 'gate-01/stamp/one.epub', 'private');
  w.users = [
    { localId: UIDS[0], email: 'reader.one@example.com', passwordHash: 'aGFzaDE=', salt: 'c2FsdDE=', providerUserInfo: [{ providerId: 'password' }] },
    { localId: UIDS[1], email: 'reader.two@example.com', providerUserInfo: [{ providerId: 'google.com' }] },
    { localId: UIDS[2], email: 'reader.three@example.com', passwordHash: 'aGFzaDM=', salt: 'c2FsdDM=', providerUserInfo: [{ providerId: 'password' }] },
  ];
  return w;
}
const SUNDAY = new Date('2026-11-15T05:30:00Z');
const MONDAY = new Date('2026-11-16T05:30:00Z');
async function run(w, argv = [], { now = SUNDAY, env = ENV(recipient) } = {}) {
  const logs = [];
  const code = await main(argv, { env, fetchFn: w.fetch, now: () => now, log: (o) => logs.push(o), sleep: async () => {} });
  return { code, logs, part: (p) => logs.find((l) => l.part === p), summary: logs.find((l) => l.summary) };
}
const vaultNames = (w, prefix = '') => [...w.buckets.get(VAULT).keys()].filter((n) => n.startsWith(prefix)).sort();
const writes = (w) => w.requests.filter((r) => r.method !== 'GET');

test('a full run puts every part where VAULT.md §3 says, and exits 0', async () => {
  const w = seeded();
  const r = await run(w);
  assert.equal(r.code, 0, JSON.stringify(r.logs));
  for (const [name, o] of w.buckets.get(SITE_FILES)) {
    if (name.endsWith('/')) continue;
    assert.ok(w.buckets.get(VAULT).has(`files/${o.generation}/${name}`), 'each live file is held by (name, generation)');
  }
  assert.equal(vaultNames(w, 'files/').length, 4, 'the zero-byte folder placeholder is not a file');
  assert.deepEqual(vaultNames(w, 'files-manifest/'), ['files-manifest/2026-11-15.json']);
  const manifest = JSON.parse(w.buckets.get(VAULT).get('files-manifest/2026-11-15.json').bytes);
  assert.equal(manifest.count, 4);
  const cover = manifest.objects.find((o) => o.name.startsWith('covers-typographic/'));
  assert.equal(cover.metadata.firebaseStorageDownloadTokens, 'tok-1', 'the manifest keeps the download token a restore needs');
  assert.ok(cover.md5Hash && cover.generation && cover.contentType === 'image/png');
  assert.equal(vaultNames(w, 'manual/').length, 1, 'Sunday is the manual copy day');
  assert.deepEqual(vaultNames(w, 'manual-manifest/'), ['manual-manifest/2026-11-15.json']);
  assert.equal(vaultNames(w, 'workers/').length, 2);
  for (const [id, src] of Object.entries(w.workers)) {
    const sha = createHash('sha256').update(src).digest('hex');
    assert.equal(String(w.buckets.get(VAULT).get(`workers/${id}/${sha}.js`).bytes), src, 'a Worker is stored under the SHA-256 of its content');
  }
  assert.equal(vaultNames(w, 'rules/').length, 1);
  assert.match(vaultNames(w, 'rules/')[0], /^rules\/2026-11-15\/site-files-bucket\/st0\/storage\.rules$/);
  assert.equal(r.part('accounts').accounts, 3);
  assert.equal(r.part('accounts').withPasswordHash, 2);
});

test('the accounts file opens with the age reference library and carries every account and the hash parameters', async () => {
  const w = seeded();
  await run(w);
  const [name] = vaultNames(w, 'accounts/');
  assert.equal(name, 'accounts/20261115T053000Z.json.age');
  const sealed = w.buckets.get(VAULT).get(name).bytes;
  assert.ok(!sealed.includes(Buffer.from('reader.one@example.com')), 'no plaintext in the stored file');
  assert.ok(!sealed.includes(Buffer.from('aGFzaDE=')), 'no hash in the stored file');
  const plain = JSON.parse(await open(sealed));
  assert.equal(plain.format, 'vault-accounts/1');
  assert.deepEqual(plain.hashConfig, w.hashConfig);
  assert.deepEqual(plain.users.map((u) => u.localId), UIDS);
  assert.equal(plain.users[0].passwordHash, 'aGFzaDE=');
  const [check] = vaultNames(w, 'accounts-check/');
  assert.equal(await open(w.buckets.get(VAULT).get(check).bytes), CANARY_TEXT, 'the key check file opens to the fixed sentence');
});

test('the puller only creates: no DELETE, every write create-only, nothing written to the site', async () => {
  const w = seeded();
  w.rewriteSteps = 3; // a large object takes several rewrite calls
  await run(w);
  await run(w, [], { now: new Date('2026-11-15T09:00:00Z') });
  for (const r of w.requests) {
    assert.notEqual(r.method, 'DELETE');
    assert.notEqual(r.method, 'PUT');
    assert.notEqual(r.method, 'PATCH');
  }
  for (const r of writes(w).filter((x) => x.url.hostname === 'storage.googleapis.com')) {
    assert.equal(r.url.searchParams.get('ifGenerationMatch'), '0', 'every vault write is create-only');
    const dst = r.url.pathname.includes('/rewriteTo/') ? decodeURIComponent(r.url.pathname.split('/rewriteTo/b/')[1].split('/')[0]) : decodeURIComponent(r.url.pathname.split('/b/')[1].split('/')[0]);
    assert.equal(dst, VAULT, 'the only bucket written is the vault');
  }
  assert.ok(writes(w).every((r) => ['storage.googleapis.com'].includes(r.url.hostname)), 'no write to Auth, Rules or Cloudflare');
});

test('a second run holds everything already: it copies nothing, and its manifest does not replace the first', async () => {
  const w = seeded();
  await run(w);
  const before = vaultNames(w, 'files/');
  const r = await run(w, [], { now: new Date('2026-11-15T09:00:00Z') });
  assert.equal(r.code, 0);
  assert.equal(r.part('files').copied, 0);
  assert.equal(r.part('files').alreadyHeld, 4);
  assert.deepEqual(vaultNames(w, 'files/'), before);
  assert.deepEqual(vaultNames(w, 'files-manifest/'), ['files-manifest/2026-11-15.090000Z.json', 'files-manifest/2026-11-15.json']);
  assert.equal(r.part('workers').unchanged, 2);
  assert.equal(r.part('workers').stored, 0);
  assert.equal(r.part('rules').alreadyToday, 1, 'the same ruleset on the same day is held once');
  assert.equal(vaultNames(w, 'rules/').length, 1);
  assert.equal(vaultNames(w, 'accounts/').length, 2, 'accounts are copied every run');
  assert.equal(r.part('accounts').check, 'exists');
});

test('a replaced file gets its new generation beside the old one; a changed Worker is stored again', async () => {
  const w = seeded();
  await run(w);
  const old = w.buckets.get(SITE_FILES).get('bookstore_epubs/master/book.epub').generation;
  const neu = w.put(SITE_FILES, 'bookstore_epubs/master/book.epub', 'epub-bytes-v2').generation;
  w.workers['worker-one'] += '\n// edited';
  const r = await run(w, [], { now: MONDAY });
  assert.equal(r.part('files').copied, 1);
  assert.ok(w.buckets.get(VAULT).has(`files/${old}/bookstore_epubs/master/book.epub`));
  assert.ok(w.buckets.get(VAULT).has(`files/${neu}/bookstore_epubs/master/book.epub`));
  const m = JSON.parse(w.buckets.get(VAULT).get('files-manifest/2026-11-16.json').bytes);
  assert.equal(m.objects.find((o) => o.name === 'bookstore_epubs/master/book.epub').generation, neu, "the day's manifest names the live generation");
  assert.equal(r.part('workers').stored, 1);
  assert.equal(vaultNames(w, 'workers/worker-one/').length, 2);
  assert.equal(r.part('manual'), undefined, 'Monday is not the manual copy day');
});

test('a file replaced between the listing and the copy is counted, left out of the manifest, and not a failure', async () => {
  const w = seeded();
  w.vanishOnCopy.add('avatars/someone/face.jpg');
  const r = await run(w, ['--only', 'files']);
  assert.equal(r.code, 0);
  assert.equal(r.part('files').vanished, 1);
  const m = JSON.parse(w.buckets.get(VAULT).get('files-manifest/2026-11-15.json').bytes);
  assert.equal(m.count, 3);
});

test('a dry run reads everything and writes nothing', async () => {
  const w = seeded();
  const r = await run(w, ['--dry-run']);
  assert.equal(r.code, 0, JSON.stringify(r.logs));
  assert.equal(writes(w).length, 0, 'no POST, PUT, PATCH or DELETE at all');
  assert.equal(w.buckets.get(VAULT).size, 0);
  assert.equal(r.part('files').wouldCopy, 4);
  assert.equal(r.part('files').manifest, 'dry');
  assert.equal(r.part('workers').wouldStore, 2);
  assert.equal(r.part('accounts').file, 'dry');
  assert.equal(r.part('rules').files, 1);
});

test('one failed part fails the run, and the other parts still run', async () => {
  const w = seeded();
  w.failRewriteFor.add('avatars/someone/face.jpg');
  const r = await run(w);
  assert.equal(r.code, 1);
  assert.equal(r.part('files').ok, false);
  assert.equal(r.part('files').failed, 1);
  assert.equal(r.part('files').copied, 3, 'the other files were still copied');
  for (const p of ['manual', 'accounts', 'workers', 'rules']) assert.equal(r.part(p).ok, true, `${p} still ran`);
  assert.equal(r.summary.failed, 1);
  assert.equal(r.summary.severity, 'ERROR');
});

test('Cloudflare is asked for the script list and script content, and nothing else', async () => {
  const w = seeded();
  await run(w, ['--only', 'workers']);
  const cf = w.requests.filter((r) => r.url.hostname === 'api.cloudflare.com');
  assert.equal(cf.length, 3);
  for (const r of cf) {
    const path = r.url.pathname.replace(/^\/client\/v4/, '');
    assert.ok(CF_ALLOWED.some((re) => re.test(path)), `an endpoint outside the allow-list: ${path}`);
    assert.doesNotMatch(path, /settings|bindings|secrets|schedules|subdomain|routes|tails|deployments|versions/);
    assert.equal(r.method, 'GET');
  }
  assert.equal(CF_ALLOWED.length, 2);
  assert.ok(w.requests.filter((r) => r.url.hostname !== 'api.cloudflare.com').every((r) => !JSON.stringify(r.headers).includes(CF_TOKEN)), 'the Cloudflare token goes to Cloudflare only');
});

test('the logs carry counts only: no object name, uid, email, Worker name, bucket or token', async () => {
  const w = seeded();
  w.failRewriteFor.add('avatars/someone/face.jpg');
  const r1 = await run(w);
  const r2 = await run(w, ['--check-accounts']);
  const text = JSON.stringify([...r1.logs, ...r2.logs]);
  for (const bad of [...UIDS, 'reader.one@example.com', 'example.com', 'covers-typographic', 'avatars', 'face.jpg', 'worker-one', 'worker-two',
    SITE_FILES, SITE_PRIVATE, VAULT, CF_TOKEN, 'google-token', 'aGFzaDE=', 'c2lnbmVy', recipient, 'gate-01']) {
    assert.ok(!text.includes(bad), `a log line carries ${bad}`);
  }
});

test('--check-accounts proves the role by counting fields, and fails when the hashes or the parameters are missing', async () => {
  const ok = await run(seeded(), ['--check-accounts']);
  assert.equal(ok.code, 0);
  assert.deepEqual(ok.summary.parts, { check: 'ok' });
  const c = ok.part('check');
  assert.equal(c.proved, true);
  assert.equal(c.passwordAccounts, 2);
  assert.equal(c.withPasswordHash, 2);
  assert.equal(c.withSalt, 2);
  assert.equal(c.hashParameterFields, 5);

  const noParams = seeded(); noParams.hashConfig = null;
  const r1 = await run(noParams, ['--check-accounts']);
  assert.equal(r1.code, 1);
  assert.match(r1.part('check').error, /hash parameters were not returned/);

  const noHashes = seeded(); noHashes.users = noHashes.users.map(({ passwordHash, salt, ...u }) => u);
  const r2 = await run(noHashes, ['--check-accounts']);
  assert.equal(r2.code, 1);
  assert.match(r2.part('check').error, /hashes or salts were not returned/);
  assert.equal(r2.part('check').withPasswordHash, 0);

  const fresh = seeded();
  await run(fresh, ['--check-accounts']);
  assert.equal(writes(fresh).length, 0, 'the check writes nothing');
  assert.ok(fresh.requests.every((r) => r.url.hostname !== 'storage.googleapis.com'), 'the check reads accounts only');
});

test('the accounts copy refuses to store a file the role could not fill', async () => {
  const w = seeded(); w.users = w.users.map(({ passwordHash, ...u }) => u);
  const r = await run(w, ['--only', 'accounts']);
  assert.equal(r.code, 1);
  assert.equal(vaultNames(w, 'accounts/').length, 0);
});

test('a missing setting exits 2 and names the variable, never a value', async () => {
  const w = seeded();
  const env = ENV(recipient); delete env.CF_API_TOKEN; env.AGE_RECIPIENT = 'not-a-key';
  const r = await run(w, [], { env });
  assert.equal(r.code, 2);
  assert.ok(r.logs[0].missing.includes('CF_API_TOKEN'));
  assert.ok(r.logs[0].missing.some((m) => m.startsWith('AGE_RECIPIENT')));
  assert.ok(!JSON.stringify(r.logs).includes('not-a-key'));
  assert.equal(w.requests.length, 0, 'nothing is called before the configuration is complete');
  const r2 = await run(seeded(), ['--check-accounts'], { env: { SITE_PROJECT_ID: 'site-project' } });
  assert.equal(r2.code, 0, 'the role check needs only the site project');
});

test('arguments: the manual copy is weekly unless forced; unknown arguments are refused', async () => {
  assert.deepEqual(partsFor(parseArgs([]), {}, MONDAY), ['files', 'accounts', 'workers', 'rules']);
  assert.deepEqual(partsFor(parseArgs([]), {}, SUNDAY), ['files', 'manual', 'accounts', 'workers', 'rules']);
  assert.deepEqual(partsFor(parseArgs(['--force-manual']), {}, MONDAY), ['files', 'manual', 'accounts', 'workers', 'rules']);
  assert.deepEqual(partsFor(parseArgs([]), { MANUAL_WEEKDAY: '1' }, MONDAY), ['files', 'manual', 'accounts', 'workers', 'rules']);
  assert.deepEqual(partsFor(parseArgs(['--check-accounts']), {}, SUNDAY), ['check']);
  assert.throws(() => parseArgs(['--apply']));
  assert.throws(() => parseArgs(['--only', 'database']));
  const r = await run(seeded(), ['--delete-everything']);
  assert.equal(r.code, 2);
});

test('the job token comes from the metadata server once and is reused', async () => {
  const w = seeded();
  await run(w, ['--only', 'files']);
  assert.equal(w.tokenCalls, 1);
  const meta = w.requests.find((r) => r.url.hostname === 'metadata.google.internal');
  assert.equal(meta.headers['Metadata-Flavor'], 'Google');
});

test('puller.mjs.sha256 is the SHA-256 of puller.mjs (the bootstrap checks the file against it)', () => {
  const file = readFileSync(new URL('../../vault/puller/puller.mjs', import.meta.url));
  const pinned = readFileSync(new URL('../../vault/puller/puller.mjs.sha256', import.meta.url), 'utf8').trim();
  assert.equal(createHash('sha256').update(file).digest('hex'), pinned, 'run: sha256sum vault/puller/puller.mjs | cut -d" " -f1 > vault/puller/puller.mjs.sha256');
});
