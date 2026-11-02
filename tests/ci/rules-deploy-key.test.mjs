// EDGE-2 — `npm run rules:deploy:db` finds the admin key from a worktree, and never prints it.
//
// It used to be `GOOGLE_APPLICATION_CREDENTIALS=serviceAccountKey.json firebase deploy`, a path only
// the main checkout has. Every key here is invented on the spot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveKeyFile, mainCheckoutOf } from '../../scripts/rules-deploy.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const FAKE = { type: 'service_account', project_id: 'calvary-scribblings', private_key_id: 'feedface00000000', private_key: PEM, client_email: 'fixture@calvary-scribblings.iam.gserviceaccount.com' };
const PEM_BODY = PEM.split('\n')[5];

test('the package scripts go through the wrapper, not a checkout-relative key path', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const s of ['rules:deploy', 'rules:deploy:db', 'rules:deploy:storage']) {
    assert.match(pkg.scripts[s], /^node scripts\/rules-deploy\.mjs (database|storage|database,storage)$/, s);
  }
});

test('the key: GOOGLE_APPLICATION_CREDENTIALS, then this checkout, then a secret written to a private temporary file', () => {
  const d = mkdtempSync(join(tmpdir(), 'rules-key-'));
  try {
    const keyFile = join(d, 'k.json');
    writeFileSync(keyFile, JSON.stringify(FAKE));
    assert.equal(resolveKeyFile({ root: d, env: { GOOGLE_APPLICATION_CREDENTIALS: keyFile } }).source, 'GOOGLE_APPLICATION_CREDENTIALS');

    writeFileSync(join(d, 'serviceAccountKey.json'), JSON.stringify(FAKE));
    assert.equal(resolveKeyFile({ root: d, env: {} }).source, 'this checkout');
    rmSync(join(d, 'serviceAccountKey.json'));

    const t = resolveKeyFile({ root: d, env: { FIREBASE_SA_KEY: Buffer.from(JSON.stringify(FAKE)).toString('base64') } });
    assert.equal(t.temporary, true);
    assert.equal(statSync(t.path).mode & 0o777, 0o600, 'only its owner can read it');
    assert.equal(statSync(dirname(t.path)).mode & 0o777, 0o700);
    assert.equal(JSON.parse(readFileSync(t.path, 'utf8')).private_key_id, 'feedface00000000');
    rmSync(dirname(t.path), { recursive: true, force: true });

    assert.throws(() => resolveKeyFile({ root: d, env: {} }), /no admin key/);
    assert.throws(() => resolveKeyFile({ root: d, env: { FIREBASE_SA_KEY: '{"not": "a key", "x": "SECRET-VALUE"}' } }), (e) => !/SECRET-VALUE/.test(e.message));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('from a worktree, the main checkout is found through git\'s common directory', () => {
  const main = mainCheckoutOf(ROOT);
  assert.ok(main, 'this checkout is a git checkout');
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(main, dirname(common));
});

test('a dry run names the key by its public fields and prints nothing of the key itself', () => {
  const d = mkdtempSync(join(tmpdir(), 'rules-key-'));
  try {
    const keyFile = join(d, 'k.json');
    writeFileSync(keyFile, JSON.stringify(FAKE));
    const out = execFileSync('node', ['scripts/rules-deploy.mjs', 'database', '--dry-run'], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, GOOGLE_APPLICATION_CREDENTIALS: keyFile } });
    assert.match(out, /key id feedface00000000/);
    assert.match(out, /would run npx firebase deploy --only database --project calvary-scribblings --non-interactive/);
    assert.doesNotMatch(out, /PRIVATE KEY/);
    assert.ok(!out.includes(PEM_BODY), 'no line of the key');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
