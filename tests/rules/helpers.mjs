// Shared harness for the rules assertion suites.
//
// HERMETIC BY CONSTRUCTION. Everything runs against the Firebase emulator with a
// `demo-` project id, which the emulator serves without credentials. No service
// account, no GitHub secret, no network, no production data. That is the whole
// point: this suite is the one that can run on every push.
//
// WHAT THIS SUITE IS FOR, and it is not what `npm run rules:check` is for.
// rules:check proves repo === live. It was GREEN throughout the R9.0 audit and
// caught none of the nine launch-blocking holes, because the holes were in the
// repo and in production, in perfect parity. Drift detection and permissiveness
// detection are different jobs. THIS is the permissiveness job.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DB_RULES_PATH = resolve(ROOT, 'database.rules.json');
export const STORAGE_RULES_PATH = resolve(ROOT, 'storage.rules');

// The two founder UIDs the rules hardcode. Kept here so a rotation is one edit.
export const FOUNDER_A = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
export const FOUNDER_B = 'GfXFIc0dThZ1cs2SBBQIFao4aSz1';

// Synthetic identities. OWNER and STRANGER are both ordinary signed-in readers —
// "stranger" means "a second real account", because sign-up is open and that is
// the actual threat model, not an exotic attacker.
export const OWNER = 'AAAAowner0000000000000000001';
export const STRANGER = 'BBBBstranger00000000000000002';
export const OTHER = 'CCCCother00000000000000000003';

// dm ids are [uidA, uidB].sort().join('_') — app/square/page.js:518.
export const convIdFor = (a, b) => [a, b].sort().join('_');

// THE SUITE MUST RUN ITS FILES SERIALLY — package.json passes --test-concurrency=1, and it
// is load-bearing rather than tidiness.
//
// initializeTestEnvironment() UPLOADS both rule sets into the emulator. database.test.mjs and
// storage.test.mjs each call this from their own before() hook, and there is one emulator
// behind both. Run the files concurrently and the two uploads overlap: for the window while
// one file is replacing the storage rules, the emulator answers storage/unauthorized to the
// other file's legitimate writes. The denial assertions pass straight through that window —
// they expect a refusal — so the failure lands ONLY on assertSucceeds, and only in whichever
// describe block happens to be running at t≈0.
//
// This bit on 2026-08-04 (CI run 30893313840): LB-6 film_submissions, the first block in
// storage.test.mjs, failed its two assertSucceeds cases while every later block passed. It is
// invisible on a 2-core machine, because node --test defaults file concurrency to
// availableParallelism() - 1, which is 1 there — so the suite is already serial locally and
// green forever. The CI runner has 4 cores. Do not remove the flag to "speed the suite up";
// the ~20s it costs is the price of the emulator being shared.
export async function makeEnv() {
  return initializeTestEnvironment({
    projectId: 'demo-calvary-rules',
    database: {
      rules: readFileSync(DB_RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 9000,
    },
    storage: {
      rules: readFileSync(STORAGE_RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
}

// Seed data with rules DISABLED, so a fixture never depends on the rule under
// test. Anything a test needs to already exist goes through here.
export async function seed(env, writes) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.database();
    for (const [path, value] of Object.entries(writes)) {
      await db.ref(path).set(value);
    }
  });
}

export const dbOf = (ctx) => ctx.database();

export { assertFails, assertSucceeds };
