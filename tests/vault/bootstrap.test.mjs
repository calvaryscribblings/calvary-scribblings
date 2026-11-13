// SAFETY-2B — the one line the Cloud Run job runs (vault/puller/BOOTSTRAP.txt). The job's image is
// the stock node:22-slim; the bootstrap fetches puller.mjs at a full commit from GitHub, refuses it
// unless its SHA-256 equals PULLER_SHA256, and runs it with the job's arguments. Offline here: a
// preloaded fetch serves the file (tests/vault/bootstrap-fetch.cjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BOOT = readFileSync(new URL('../../vault/puller/BOOTSTRAP.txt', import.meta.url), 'utf8');
const SHA = readFileSync(new URL('../../vault/puller/puller.mjs.sha256', import.meta.url), 'utf8').trim();
const PRELOAD = fileURLToPath(new URL('./bootstrap-fetch.cjs', import.meta.url));
const COMMIT = 'a'.repeat(40);
const URL_OK = `https://raw.githubusercontent.com/calvaryscribblings/calvary-scribblings/${COMMIT}/vault/puller/puller.mjs`;

function boot(env, args = []) {
  const r = spawnSync(process.execPath, ['--require', PRELOAD, '-e', BOOT, '--', ...args], {
    env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20000,
  });
  return { code: r.status, out: r.stdout + r.stderr, lines: r.stdout.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } }) };
}

test('the bootstrap is one line with no spaces and no ~~, so the job definition can carry it', () => {
  // gcloud splits a list flag on commas unless told otherwise: docs/VAULT.md uses the ^~~^ form,
  // so the line must never contain ~~. No spaces, so a console field that splits on spaces can't
  // break it either.
  assert.ok(!BOOT.includes('\n'));
  assert.ok(!/\s/.test(BOOT));
  assert.ok(!BOOT.includes('~~'));
  assert.ok(BOOT.length < 1000);
});

test('with the right file it runs the puller, handing it the job arguments', () => {
  const r = boot({ PULLER_URL: URL_OK, PULLER_SHA256: SHA }, ['--check-accounts']);
  assert.equal(r.code, 2, r.out); // the puller ran: --check-accounts with no SITE_PROJECT_ID is a configuration error
  assert.equal(r.lines[0].error, 'configuration incomplete');
  assert.deepEqual(r.lines[0].missing, ['SITE_PROJECT_ID']);
});

test('a file that does not match PULLER_SHA256 is refused before it runs', () => {
  const r = boot({ PULLER_URL: URL_OK, PULLER_SHA256: SHA, TEST_PULLER_BODY: 'tampered' }, ['--check-accounts']);
  assert.equal(r.code, 1);
  assert.match(r.lines[0].error, /does_not_match_PULLER_SHA256/);
  const r2 = boot({ PULLER_URL: URL_OK, PULLER_SHA256: 'b'.repeat(64) });
  assert.equal(r2.code, 1);
});

test('PULLER_URL must name the puller at a full commit in this repository', () => {
  for (const u of [
    'https://raw.githubusercontent.com/calvaryscribblings/calvary-scribblings/main/vault/puller/puller.mjs',
    `https://raw.githubusercontent.com/someone-else/calvary-scribblings/${COMMIT}/vault/puller/puller.mjs`,
    `https://raw.githubusercontent.com/calvaryscribblings/calvary-scribblings/${COMMIT}/scripts/anything.mjs`,
    `http://raw.githubusercontent.com/calvaryscribblings/calvary-scribblings/${COMMIT}/vault/puller/puller.mjs`,
    '',
  ]) {
    const r = boot({ PULLER_URL: u, PULLER_SHA256: SHA });
    assert.equal(r.code, 1, u);
    assert.match(r.lines[0].error, /PULLER_URL_must_name/);
  }
});
