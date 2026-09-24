// W1 / ADM-35 — every path that PUBLISHES a story summons a rebuild, from a secret.
//
//   node --test tests/ci/runner-deploy-hook.test.mjs      (npm run test:ci)
//
// Two unattended paths flip a story live without a person at the admin:
//   · the scheduled-publish cron in the calvary-newsletter Worker — tests/newsletter/cron-path.test.mjs
//   · the covers reconciler, which publishes a cover-held draft — THIS file
// Before W1 the first POSTed a dead literal and the second summoned nothing at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fireDeployHook } from '../../scripts/deploy-hook.mjs';

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const HOOK = 'https://hooks.invalid/fixture';

async function quietly(fn) {
  const errors = [];
  const real = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try { return { value: await fn(), errors }; } finally { console.error = real; }
}

test('fired: one POST to the URL given', async () => {
  const calls = [];
  const v = await fireDeployHook(HOOK, { envName: 'X_HOOK', what: '1 story', fetchImpl: async (u, i) => { calls.push([u, i.method]); return new Response('', { status: 200 }); } });
  assert.equal(v, 'fired');
  assert.deepEqual(calls, [[HOOK, 'POST']]);
});

test('unconfigured / refused / unreachable are named, and the URL is never printed', async () => {
  const none = await quietly(() => fireDeployHook(undefined, { envName: 'X_HOOK', what: '1 story' }));
  assert.equal(none.value, 'unconfigured');
  assert.match(none.errors.join(), /X_HOOK is not set/);

  const refused = await quietly(() => fireDeployHook(HOOK, { envName: 'X_HOOK', what: '1 story', fetchImpl: async () => new Response('', { status: 404 }) }));
  assert.equal(refused.value, 'refused');
  assert.match(refused.errors.join(), /HTTP 404/);

  const down = await quietly(() => fireDeployHook(HOOK, { envName: 'X_HOOK', what: '1 story', fetchImpl: async () => { throw new TypeError(`fetch failed ${HOOK}`); } }));
  assert.equal(down.value, 'unreachable');
  for (const r of [none, refused, down]) assert.doesNotMatch(r.errors.join(), /hooks\.invalid/);
});

test('the covers reconciler fires the stories hook once, only after it published something', () => {
  const src = read('scripts/covers/on-publish.mjs');
  assert.match(src, /import \{ fireDeployHook \} from '\.\.\/deploy-hook\.mjs';/);
  // counted where the patch actually published, not where a cover was merely refreshed
  assert.match(src, /if \(extras\.published === true\) \{\s*wentLive\+\+;/);
  assert.match(src, /if \(APPLY && wentLive > 0\) \{\s*const verdict = await fireDeployHook\(process\.env\.CMS_DEPLOY_HOOK_URL,/);
});

test('the covers workflow hands the reconciler the hook from a secret', () => {
  const yml = read('.github/workflows/covers.yml');
  assert.match(yml, /CMS_DEPLOY_HOOK_URL: \$\{\{ secrets\.CMS_DEPLOY_HOOK_URL \}\}/);
});
