// SAFETY-2P (5 Nov 2026): docs/VAULT.md is the vault's plan, in a PUBLIC repo. It names no project
// ID, bucket, account email or credential: those live in ~/calvary-private/vault/NAMES.md. This
// pins that, and pins the parts of the design a later edit could quietly drop: the vault pulls
// (the site holds no vault credential), the 30-day retention trialled unlocked then locked, the
// accounts file encrypted to a key only Ikenna holds, and the custom role (Viewer can't see hashes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vault = readFileSync(new URL('../../docs/VAULT.md', import.meta.url), 'utf8');

const FORBIDDEN = [
  [/calvary-scribblings[-.]/i, "one of the site's bucket or project names"],
  [/firebasestorage\.app/i, "the file bucket's name"],
  [/gs:\/\/[a-z0-9]/i, 'a bucket URL'],
  [/\bcalvary-vault\b|\bcalvary-drill\b/i, 'a suggested vault project ID (keep those in NAMES.md)'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, 'an email address'],
  [/\bproject-\d{6,}\b/, 'a project number'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a PEM private key'],
  [/AGE-SECRET-KEY-1[0-9A-Z]{10,}/, 'an age private key'],
  [/\bage1[0-9a-z]{50,}\b/, 'an age public key (keep it in NAMES.md)'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'a JWT'],
  [/(?<![A-Za-z0-9])[A-Za-z0-9]{28}(?![A-Za-z0-9])/, 'a Firebase uid-shaped string'],
];

test('VAULT.md names no project, bucket, email or credential', () => {
  for (const [re, what] of FORBIDDEN) assert.doesNotMatch(vault, re, `docs/VAULT.md carries ${what}`);
});

test('the design keeps its load-bearing decisions', () => {
  assert.match(vault, /The site holds \*\*no vault credential\*\*/);
  assert.match(vault, /A \*\*bucket retention policy of 30 days\*\*/);
  assert.match(vault, /\*\*Weeks 1–2: unlocked\.\*\*/);
  assert.match(vault, /\*\*After two weeks: locked\.\*\*/);
  assert.match(vault, /europe-west1/);
  assert.match(vault, /encrypted to a key only Ikenna holds, offline/);
  assert.match(vault, /firebaseauth\.configs\.getHashConfig/);
  assert.match(vault, /326 MB of unused files/);
  assert.match(vault, /export\.mjs` is retired/);
});

test('every console step cites its source', () => {
  const steps = vault.slice(vault.indexOf('## 11.'));
  const numbered = steps.match(/^\*\*1\.\d+ /gm) || [];
  assert.ok(numbered.length >= 10, 'the setup steps are missing');
  const blocks = steps.split(/^\*\*1\.\d+ /m).slice(1);
  blocks.forEach((b, i) => assert.match(b, /Source: \[/, `step 1.${i} has no source`));
});
