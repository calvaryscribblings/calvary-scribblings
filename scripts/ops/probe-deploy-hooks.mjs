// Fire the deploy hooks the runners hold, once, on demand — the "trigger one build" step of
// docs/OPERATOR-W1-DEPLOY-HOOK.md, runnable without the URL ever leaving the Actions secret.
//
//   node scripts/ops/probe-deploy-hooks.mjs            # report which hooks are SET, fire nothing
//   node scripts/ops/probe-deploy-hooks.mjs --fire     # POST CMS_DEPLOY_HOOK_URL once
//
// Only CMS_DEPLOY_HOOK_URL is ever fired. BOOKSTORE_DEPLOY_HOOK_URL is reported set/unset and
// nothing more: one build proves the Pages project answers, and a second is a wasted build.
// Exit 1 when the CMS hook is unset or does not answer 2xx, so the run goes red.

import { fireDeployHook } from '../deploy-hook.mjs';

const fire = process.argv.includes('--fire');

for (const name of ['CMS_DEPLOY_HOOK_URL', 'BOOKSTORE_DEPLOY_HOOK_URL']) {
  console.log(`${name.padEnd(26)} ${process.env[name] ? 'set' : 'NOT SET'}`);
}

if (!fire) process.exit(process.env.CMS_DEPLOY_HOOK_URL ? 0 : 1);

const verdict = await fireDeployHook(process.env.CMS_DEPLOY_HOOK_URL, {
  envName: 'CMS_DEPLOY_HOOK_URL',
  what: 'nothing (a probe)',
});
console.log(`CMS_DEPLOY_HOOK_URL fired   ${verdict}`);
process.exit(verdict === 'fired' ? 0 : 1);
