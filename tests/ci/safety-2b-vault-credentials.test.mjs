// SAFETY-2B (docs/VAULT.md §10, item 9) — NO FILE IN THE REPO CARRIES A VAULT CREDENTIAL.
//
// The vault exists because everything the site's key can reach, it can also delete. The site
// therefore holds no credential for the vault (§2, §4): the puller has no key file, its Cloudflare
// token lives only in the vault's Secret Manager, and the accounts key is on two cards. This
// repository is public. This test walks every tracked file and fails on anything shaped like one of
// those credentials, and it pins the structure that keeps them out: no workflow names a vault
// setting, and the puller takes every name and key from its environment, none from its source.
// (docs/VAULT.md's own pin, no project ID, bucket or email, is tests/ci/safety-2p-vault.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SELF = 'tests/ci/safety-2b-vault-credentials.test.mjs';

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  } catch {
    const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => {
      if (/^(node_modules|\.next|out|\.git)$/.test(f)) return [];
      const p = d ? `${d}/${f}` : f;
      return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
    });
    return walk('');
  }
}
const isText = (buf) => !buf.subarray(0, 8000).includes(0);

// Built from pieces so this file does not match itself.
const K = (...parts) => parts.join('');
const SHAPES = [
  [new RegExp(K('AGE-SECRET', '-KEY-1', '[0-9A-Z]{20,}')), 'an age private key (the accounts key lives on two cards, nowhere else)'],
  [new RegExp(K('-----BEGIN [A-Z ]*PRIV', 'ATE KEY-----', '(?:\\s|\\\\n|[A-Za-z0-9+/=]){200,}')), 'a PEM private key with a real body'],
  [new RegExp(K('"private_key_id"', '\\s*:\\s*"[0-9a-f]{40}"')), 'a service-account key file (the puller has no key; the site key is never committed)'],
  [new RegExp(K('vault[a-z0-9-]*@[a-z0-9-]+\\.iam\\.gservice', 'account\\.com'), 'i'), "a vault service account's address (names live in ~/calvary-private/vault/NAMES.md)"],
  [new RegExp(K('(CF_API_TOKEN|CLOUDFLARE_API_TOKEN)', '\\s*[=:]\\s*[\'"]?', '[A-Za-z0-9_-]{40}\\b')), 'a Cloudflare API token value'],
  [new RegExp(K('\\bR2_SECRET', '_ACCESS_KEY\\s*[=:]\\s*[\'"]?[A-Za-z0-9/+]{32,}')), 'an R2 secret key value'],
];

test('no tracked file carries a vault credential', () => {
  const offenders = [];
  for (const f of trackedFiles()) {
    if (f === SELF) continue;
    let buf;
    try { buf = readFileSync(join(ROOT, f)); } catch { continue; }
    if (!isText(buf)) continue;
    const s = buf.toString('utf8');
    for (const [re, what] of SHAPES) if (re.test(s)) offenders.push(`${f}: ${what}`);
  }
  assert.deepEqual(offenders, []);
});

test('the shapes catch what they are for (so a green run means something)', () => {
  const fake = {
    age: K('AGE-SECRET', '-KEY-1', 'Q'.repeat(58)),
    pem: K('-----BEGIN PRIV', 'ATE KEY-----\n', 'A'.repeat(64), '\n', 'B'.repeat(64), '\n', 'C'.repeat(64), '\n', 'D'.repeat(64)),
    sa: K('{"private_key_id": "', 'a'.repeat(40), '"}'),
    email: K('vault-puller@some-project', '.iam.gservice', 'account.com'),
    cf: K('CF_API_TOKEN=', 'x'.repeat(40)),
    r2: K('R2_SECRET', '_ACCESS_KEY=', 'y'.repeat(40)),
  };
  for (const [i, [re]] of SHAPES.entries()) assert.match(Object.values(fake)[i], re);
  // and the repo's own harmless mentions are not caught
  assert.doesNotMatch('Write the `AGE-SECRET-KEY-1…` line down on paper', SHAPES[0][0]);
  assert.doesNotMatch(".replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\n/g, '')", SHAPES[1][0]);
  assert.doesNotMatch("const TOKEN = process.env.CLOUDFLARE_API_TOKEN;", SHAPES[4][0]);
  assert.doesNotMatch('--set-secrets=CF_API_TOKEN=cloudflare-workers-read:latest', SHAPES[4][0]);
});

test('no workflow names a vault setting: the site\'s CI holds nothing for the vault', () => {
  const dir = join(ROOT, '.github/workflows');
  for (const f of readdirSync(dir)) {
    const s = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(s, /\b(VAULT_BUCKET|AGE_RECIPIENT|PULLER_URL|PULLER_SHA256|CF_API_TOKEN|vault-puller|cloudflare-workers-read)\b/, `${f} names a vault setting`);
  }
});

test('the puller takes every name and key from its environment, none from its source', () => {
  const src = readFileSync(join(ROOT, 'vault/puller/puller.mjs'), 'utf8');
  assert.doesNotMatch(src, /calvary-scribblings[-.]|firebasestorage\.app|gs:\/\/[a-z]/i, 'a site bucket or project name in the puller');
  assert.doesNotMatch(src, /\bage1[02-9ac-hj-np-z]{58}\b/, 'an age key in the puller');
  for (const v of ['VAULT_BUCKET', 'SITE_PROJECT_ID', 'SITE_FILES_BUCKET', 'SITE_PRIVATE_BUCKET', 'AGE_RECIPIENT', 'CF_ACCOUNT_ID', 'CF_API_TOKEN']) {
    assert.match(src, new RegExp(`'${v}'`), `${v} is read from the environment`);
  }
  // keyless: the token comes from the metadata server, and nothing reads a key file
  assert.match(src, /metadata\.google\.internal/);
  assert.doesNotMatch(src, /GOOGLE_APPLICATION_CREDENTIALS|serviceAccountKey|readFileSync/);
});

test('vault/ holds only the puller, its pin, its bootstrap and its readme', () => {
  const files = readdirSync(join(ROOT, 'vault/puller')).sort();
  assert.deepEqual(files, ['BOOTSTRAP.txt', 'README.md', 'puller.mjs', 'puller.mjs.sha256']);
  assert.deepEqual(readdirSync(join(ROOT, 'vault')), ['puller']);
});

test("Ikenna's phase-2 steps: every step cites its source, both routes, and the job runs the pinned bootstrap", () => {
  const vault = readFileSync(join(ROOT, 'docs/VAULT.md'), 'utf8');
  const p2 = vault.slice(vault.indexOf('## 12.'));
  assert.ok(p2.length > 1000, 'docs/VAULT.md §12 (phase 2) is missing');
  const blocks = p2.split(/^\*\*(?=(?:2\.\d+|D\.\d+) )/m).slice(1);
  const ids = blocks.map((b) => b.split(' ')[0]);
  for (let i = 0; i <= 14; i++) assert.ok(ids.includes(`2.${i}`), `step 2.${i} is missing`);
  for (let i = 1; i <= 5; i++) assert.ok(ids.includes(`D.${i}`), `drill step D.${i} is missing`);
  blocks.forEach((b) => assert.match(b, /Source: \[/, `step ${b.split(' ')[0]} has no source`));
  assert.match(p2, /--command="\^~~\^node~~-e~~\$\(cat vault\/puller\/BOOTSTRAP\.txt\)~~--"/, 'the job command carries the bootstrap');
  assert.match(p2, /--args=--check-accounts/, 'the role check runs first');
  assert.ok(p2.indexOf('**2.8 ') < p2.indexOf('**2.10 '), 'the role check comes before the first real run');
  assert.match(p2, /--set-secrets=CF_API_TOKEN=cloudflare-workers-read:latest/);
  assert.doesNotMatch(p2, /keys create/, 'no step creates a service-account key');
  assert.match(p2, /\*\*A\.\*\*/); assert.match(p2, /\*\*B\.\*\*/);
});
