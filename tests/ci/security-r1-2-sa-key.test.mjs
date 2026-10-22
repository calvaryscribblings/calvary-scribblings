// SECURITY-R1.2 — THE CODESPACES SECRET TAKES THE KEY FILE AS IT IS.
//
//   node --test tests/ci/security-r1-2-sa-key.test.mjs      (part of npm run test:ci)
//
// FIREBASE_SA_KEY may hold the whole key file pasted as it is (it starts with "{"), or base64 of
// it, the older form. Two readers have to agree on that:
//   1. .devcontainer/devcontainer.json's postCreateCommand, which writes serviceAccountKey.json
//      when a Codespace is created or rebuilt. It is run here, under /bin/sh, in a temporary folder.
//   2. scripts/security/service-account.mjs, which every script that reads the secret goes through.
//
// Every key below is MADE UP. No real key is read, and no assertion prints a value: a failed
// comparison reports which form failed, never the text.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readSaKeySecret, loadServiceAccount } from '../../scripts/security/service-account.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Shaped like a Google key file, pretty-printed as it downloads. The private key's line breaks are
// JSON \n escapes: the case that sh's echo would have turned into real line breaks.
const FAKE = {
  type: 'service_account',
  project_id: 'not-a-project',
  private_key_id: '0000000000000000000000000000000000000000',
  private_key: '-----BEGIN PRIVATE KEY-----\nTUFERS1VUC1OT1QtQS1LRVk=\nTk9ULUEtS0VZLUVJVEhFUg==\n-----END PRIVATE KEY-----\n',
  client_email: 'nobody@not-a-project.iam.gserviceaccount.com',
  client_id: '000000000000000000000',
};
const FILE_TEXT = JSON.stringify(FAKE, null, 2) + '\n';

const FORMS = {
  'the key file as it is': FILE_TEXT,
  'the key file on one line': JSON.stringify(FAKE),
  'the key file after a stray leading line break': '\n' + FILE_TEXT,
  'base64 of the key file': Buffer.from(FILE_TEXT).toString('base64'),
  'base64 with a trailing line break': Buffer.from(FILE_TEXT).toString('base64') + '\n',
};

const same = (sa) => sa && sa.private_key === FAKE.private_key && sa.client_email === FAKE.client_email
  && sa.private_key_id === FAKE.private_key_id;

const postCreate = JSON.parse(readFileSync(join(ROOT, '.devcontainer', 'devcontainer.json'), 'utf8')).postCreateCommand;

function runPostCreate(value) {
  const dir = mkdtempSync(join(tmpdir(), 'r1-2-'));
  try {
    const env = { PATH: process.env.PATH };
    if (value !== undefined) env.FIREBASE_SA_KEY = value;
    const r = spawnSync('/bin/sh', ['-c', postCreate], { cwd: dir, env, encoding: 'utf8' });
    const file = join(dir, 'serviceAccountKey.json');
    return { status: r.status, written: existsSync(file), text: existsSync(file) ? readFileSync(file, 'utf8') : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('postCreateCommand writes a key file that parses', () => {
  for (const [form, value] of Object.entries(FORMS)) {
    test(form, () => {
      const r = runPostCreate(value);
      assert.ok(r.status === 0 && r.written, `${form}: the command failed or wrote nothing`);
      let sa = null;
      try { sa = JSON.parse(r.text); } catch { /* reported below, without the text */ }
      assert.ok(sa, `${form}: the written file is not valid JSON`);
      assert.ok(same(sa), `${form}: the written key differs from the one given`);
    });
  }

  test('the file is the secret byte for byte when it is pasted as it is', () => {
    assert.ok(runPostCreate(FILE_TEXT).text === FILE_TEXT, 'the key file was altered on the way through');
  });

  test('an unset secret writes nothing', () => {
    const r = runPostCreate(undefined);
    assert.ok(r.status === 0 && !r.written);
  });

  test('printf, never echo', () => {
    assert.ok(!/\becho\b/.test(postCreate), 'postCreateCommand uses echo');
  });
});

describe('the loader reads FIREBASE_SA_KEY in either form', () => {
  for (const [form, value] of Object.entries(FORMS)) {
    test(form, () => {
      assert.ok(same(readSaKeySecret(value)), `${form}: readSaKeySecret`);
      assert.ok(same(loadServiceAccount({ env: { FIREBASE_SA_KEY: value } })), `${form}: loadServiceAccount`);
    });
  }

  test('a broken value names the source and withholds the value', () => {
    const broken = [FILE_TEXT.slice(0, -10), Buffer.from(FILE_TEXT.slice(0, -10)).toString('base64')];
    for (const value of broken) {
      let message = null;
      try { readSaKeySecret(value); } catch (e) { message = String(e.message); }
      assert.ok(message, 'a broken value was accepted');
      assert.ok(message.includes('FIREBASE_SA_KEY') && message.includes('value withheld'), 'the error does not name its source');
      assert.ok(!message.includes('PRIVATE KEY') && !message.includes(value.slice(0, 20)), 'the error carries the value');
    }
  });
});

describe('nothing reads FIREBASE_SA_KEY around the loader', () => {
  for (const p of ['scripts/launch-check.mjs', 'scripts/dictionary/coverage.mjs', 'scripts/security/verify-admin-key.mjs']) {
    test(p, () => {
      const src = readFileSync(join(ROOT, p), 'utf8');
      assert.ok(src.includes('readSaKeySecret(process.env.FIREBASE_SA_KEY)'), 'does not read it through readSaKeySecret');
      assert.ok(!/(decodeBase64ServiceAccount|JSON\.parse|Buffer\.from)\(\s*process\.env\.FIREBASE_SA_KEY/.test(src), 'reads it directly');
    });
  }
});
