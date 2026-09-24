// THE STRICT HANDLE RULE — built and proved here, NOT deployed.
//
// database.rules.handle-strict-fragment.json replaces the GUARD on users/$uid/{handle,
// handleLowercased,username} with: the value must BE a usernames claim this uid holds, after the
// write. It closes the gap the guard leaves (showing a handle nobody has claimed). It is held back
// because it refuses an app signup that writes users/{uid} BEFORE usernames/{handle}, and that
// order cannot be seen from this repository. The last test below is that refusal, on purpose.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { DB_RULES_PATH, STORAGE_RULES_PATH, OWNER, STRANGER } from './helpers.mjs';
import { signupUpdate, renameUpdate } from '../../app/lib/handle.js';

export function strictRules() {
  const rules = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8'));
  const frag = JSON.parse(readFileSync(new URL('../../database.rules.handle-strict-fragment.json', import.meta.url), 'utf8'));
  for (const [k, v] of Object.entries(frag)) {
    if (k.startsWith('_')) continue;
    const [, , field] = k.split('/');
    rules.rules.users.$uid[field]['.validate'] = v;
  }
  return JSON.stringify(rules);
}

let env, owner;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-calvary-rules',
    database: { rules: strictRules(), host: '127.0.0.1', port: 9000 },
    storage: { rules: readFileSync(STORAGE_RULES_PATH, 'utf8'), host: '127.0.0.1', port: 9199 },
  });
  owner = env.authenticatedContext(OWNER).database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

describe('STRICT · each handle field must be a claim this uid holds', () => {
  for (const f of ['handle', 'handleLowercased', 'username']) {
    test(`${f} with no matching claim → refused`, async () => {
      await assertFails(owner.ref(`users/${OWNER}/${f}`).set('unclaimed_name'));
    });
    test(`${f} showing someone else's claim → refused`, async () => {
      await env.withSecurityRulesDisabled((c) => c.database().ref('usernames/taken').set(STRANGER));
      await assertFails(owner.ref(`users/${OWNER}/${f}`).set('taken'));
    });
  }
  test('the web signup (atomic) → allowed', async () => {
    await assertSucceeds(owner.ref('/').update(signupUpdate(OWNER, { name: 'A', dob: '1990-01-01', handle: 'areader', now: 1 })));
  });
  test('the web rename (atomic) → allowed', async () => {
    await env.withSecurityRulesDisabled((c) => c.database().ref().update({ 'usernames/old_one': OWNER, [`users/${OWNER}/handle`]: 'old_one' }));
    await assertSucceeds(owner.ref('/').update(renameUpdate(OWNER, { from: 'old_one', to: 'new_one', oldClaimOwner: OWNER })));
  });
  test('the app, claim FIRST then users → allowed', async () => {
    await assertSucceeds(owner.ref('usernames/rebel3').set(OWNER));
    await assertSucceeds(owner.ref(`users/${OWNER}`).set({ displayName: 'R', handle: 'rebel3', handleLowercased: 'rebel3', username: 'rebel3', uid: OWNER }));
  });
  test('the app, users FIRST then the claim → the profile is REFUSED (no binary does this: probe 176/176)', async () => {
    await assertFails(owner.ref(`users/${OWNER}`).set({ displayName: 'R', handle: 'rebel2', handleLowercased: 'rebel2', username: 'rebel2', uid: OWNER }));
  });
});

test('W1: the fragment IS the deployed rule, on all three fields', () => {
  // Deployed 24 Sep 2026 once the app session proved every binary (the 1.4.0 line, builds 32
  // and 34, the current OTA) writes the claim in the same update as the profile (probe 176/176).
  const live = JSON.parse(readFileSync(DB_RULES_PATH, 'utf8')).rules.users.$uid;
  const frag = JSON.parse(readFileSync(new URL('../../database.rules.handle-strict-fragment.json', import.meta.url), 'utf8'));
  for (const f of ['handle', 'handleLowercased', 'username']) {
    assert.equal(live[f]['.validate'], frag[`users/$uid/${f}/.validate`], `${f} must carry the strict rule`);
  }
});
