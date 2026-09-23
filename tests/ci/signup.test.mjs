// THE WEB SIGNUP SENDS NOTHING AND LEAVES NOTHING WHEN IT FAILS.
//
//   node --test tests/ci/signup.test.mjs      (npm run test:ci)
//
// app/lib/signup.js runs the real sequence; every Firebase call is a stand-in here that records
// what ran. See that module's header for the order and what each failure leaves behind.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerAccount, profileUpdate } from '../../app/lib/signup.js';

const FORM = { email: 'ada@example.com', password: 'secret123', name: ' Ada Nwosu ', dob: '1990-01-01' };

function stand({ failAt = null, rollbackFails = false } = {}) {
  const calls = [];
  const step = (name, value) => async (...args) => {
    calls.push([name, ...args]);
    if (name === failAt) { const e = new Error(`${name} failed`); if (name === 'createUser') e.code = 'auth/email-already-in-use'; throw e; }
    if (name === 'deleteAccount' && rollbackFails) throw new Error('delete failed');
    return value;
  };
  const u = { uid: 'u1' };
  return {
    calls,
    names: () => calls.map((c) => c[0]),
    deps: {
      createUser: step('createUser', { user: u }),
      setDisplayName: step('setDisplayName'),
      writeProfile: step('writeProfile'),
      deleteAccount: step('deleteAccount'),
      sendVerification: step('sendVerification'),
      now: () => 1790000000000,
    },
  };
}

describe('the order, when everything works', () => {
  test('create → name → profile (ONE write) → verification; no welcome here, no deletion', async () => {
    const s = stand();
    const r = await registerAccount(FORM, s.deps);
    assert.deepEqual(s.names(), ['createUser', 'setDisplayName', 'writeProfile', 'sendVerification']);
    assert.equal(r.mailError, null);
    assert.deepEqual(s.calls[2], ['writeProfile', 'u1', { displayName: ' Ada Nwosu ', dob: '1990-01-01', joinDate: 1790000000000 }]);
    assert.deepEqual(s.calls[3], ['sendVerification', { uid: 'u1' }, 'Ada']);
  });

  test('the profile is exactly the three fields the signup has always written', () => {
    assert.deepEqual(Object.keys(profileUpdate({ name: 'A', dob: 'd', now: 1 })).sort(), ['displayName', 'dob', 'joinDate']);
  });
});

describe('a failed signup sends nothing and leaves no half-account', () => {
  test('account creation refused → nothing else runs, the auth error surfaces as-is', async () => {
    const s = stand({ failAt: 'createUser' });
    await assert.rejects(registerAccount(FORM, s.deps), (e) => e.code === 'auth/email-already-in-use' && e.rolledBack === undefined);
    assert.deepEqual(s.names(), ['createUser']);
  });

  for (const failAt of ['setDisplayName', 'writeProfile']) {
    test(`${failAt} fails → the account is DELETED and NO mail is sent`, async () => {
      const s = stand({ failAt });
      await assert.rejects(registerAccount(FORM, s.deps), (e) => e.rolledBack === true);
      assert.ok(s.names().includes('deleteAccount'), 'the half-account is taken back out');
      assert.ok(!s.names().includes('sendVerification'), 'no verification mail for an account that is gone');
    });
  }

  test('if even the rollback fails, the caller is told so (rolledBack: false), and still no mail', async () => {
    const s = stand({ failAt: 'writeProfile', rollbackFails: true });
    await assert.rejects(registerAccount(FORM, s.deps), (e) => e.rolledBack === false && e.rollbackError instanceof Error);
    assert.ok(!s.names().includes('sendVerification'));
  });

  test('a failed VERIFICATION MAIL keeps the complete account and reports the failure', async () => {
    const s = stand({ failAt: 'sendVerification' });
    const r = await registerAccount(FORM, s.deps);
    assert.equal(r.mailError, 'sendVerification failed');
    assert.ok(!s.names().includes('deleteAccount'), 'a complete account is never deleted over a mail');
  });
});

describe('AuthModal runs this sequence, and nothing else', () => {
  const src = readFileSync(new URL('../../app/components/AuthModal.js', import.meta.url), 'utf8');

  test('register goes through registerAccount with a real deleteUser rollback', () => {
    assert.match(src, /await registerAccount\(\{ email, password, name, dob \}, \{/);
    assert.match(src, /deleteAccount: \(u\) => deleteUser\(u\)/);
    assert.match(src, /writeProfile: \(uid, fields\) => update\(ref\(db, `users\/\$\{uid\}`\), fields\)/);
  });

  test('the old inline sequence — three separate set() calls after createUser — is gone', () => {
    assert.doesNotMatch(src, /set\(ref\(db, `users\/\$\{cred\.user\.uid\}\//);
    assert.equal((src.match(/createUserWithEmailAndPassword\(/g) || []).length, 1, 'one call site, inside the deps');
  });

  test('the welcome is only ever sent from the verify poll, after verification', () => {
    const sends = src.match(/postAuthMail\('welcome'/g) || [];
    assert.equal(sends.length, 1);
    const at = src.indexOf("postAuthMail('welcome'");
    assert.ok(src.lastIndexOf('if (user.emailVerified && !welcomeSentRef.current)', at) !== -1);
  });
});
