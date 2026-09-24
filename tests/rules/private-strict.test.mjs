// THE HELD-BACK REFUSAL — private fields may not be written to users/{uid} at all.
//
// Built and proved here, NOT deployed: old app binaries still write users/{uid}/dob at signup,
// and this refuses that whole write. database.rules.users-private-strict-fragment.json holds it;
// the 15-minute sweep (scripts/account/private-fields.mjs) covers the gap until it ships.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { DB_RULES_PATH, STORAGE_RULES_PATH, OWNER } from './helpers.mjs';
import { signupUpdate } from '../../app/lib/handle.js';

const FRAGMENT = new URL('../../database.rules.users-private-strict-fragment.json', import.meta.url);

export function privateStrictRules() {
  const rules = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8'));
  const frag = JSON.parse(readFileSync(FRAGMENT, 'utf8'));
  const nodeAt = (parts) => parts.reduce((o, k) => o[k], rules.rules);
  for (const p of frag.remove) { const parts = p.split('/'); delete nodeAt(parts.slice(0, -1))[parts.at(-1)]; }
  for (const [p, v] of Object.entries(frag.set)) { const parts = p.split('/'); nodeAt(parts.slice(0, -1))[parts.at(-1)] = v; }
  return JSON.stringify(rules);
}

let env, owner;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-calvary-rules',
    database: { rules: privateStrictRules(), host: '127.0.0.1', port: 9000 },
    storage: { rules: readFileSync(STORAGE_RULES_PATH, 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  owner = env.authenticatedContext(OWNER).database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

describe('STRICT PRIVATE · no private field on the public record', () => {
  test('users/{uid}/dob → refused, as a leaf', async () => {
    await assertFails(owner.ref(`users/${OWNER}/dob`).set('1990-01-01'));
  });
  test('users/{uid}/email → refused', async () => {
    await assertFails(owner.ref(`users/${OWNER}/email`).set('a@example.com'));
  });
  test('profile/dob, profile/email, profile/country → refused', async () => {
    for (const k of ['dob', 'email', 'country']) await assertFails(owner.ref(`users/${OWNER}/profile`).set({ displayName: 'A', [k]: 'x' }));
    await assertSucceeds(owner.ref(`users/${OWNER}/profile`).set({ displayName: 'A', handle: 'a' }));
  });
  test('WHY IT IS NOT DEPLOYED: an old app binary\'s signup (dob inside the object) is REFUSED whole', async () => {
    await assertFails(owner.ref(`users/${OWNER}`).set({ ageConfirmed: true, createdAt: 1, displayName: 'R', dob: '1995-08-15', handle: 'r', handleLowercased: 'r', uid: OWNER, username: 'r' }));
  });
  test('the web signup (dob private) still lands', async () => {
    await assertSucceeds(owner.ref('/').update(signupUpdate(OWNER, { name: 'A', dob: '1990-01-01', handle: 'areader', now: 1 })));
  });
});

test('the fragment is not in the deployed rules', () => {
  const live = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8')).rules.users.$uid;
  assert.ok(live.dob && live.email, 'the live rules still grant users/{uid}/dob and email (old binaries)');
});
