// THE WEB SIGNUP SENDS NOTHING AND LEAVES NOTHING WHEN IT FAILS.
//
//   node --test tests/ci/signup.test.mjs      (npm run test:ci)
//
// app/lib/signup.js runs the real sequence; every Firebase call is a stand-in here that records
// what ran. See that module's header for the order and what each failure leaves behind.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerAccount, HandleRefused, AgeRefused } from '../../app/lib/signup.js';

const FORM = { email: 'ada@example.com', password: 'secret123', name: ' Ada Nwosu ', dob: '1990-01-01', handle: '@Ada_N' };

function stand({ failAt = null, rollbackFails = false, owner = null } = {}) {
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
      // usernames/{handle} as the database holds it; a function lets a test change it mid-signup.
      readHandleOwner: async (h) => { calls.push(['readHandleOwner', h]); return typeof owner === 'function' ? owner(h) : owner; },
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
    assert.deepEqual(s.names(), ['readHandleOwner', 'createUser', 'setDisplayName', 'writeProfile', 'sendVerification']);
    assert.equal(r.mailError, null);
    assert.deepEqual(s.calls[4], ['sendVerification', { uid: 'u1' }, 'Ada']);
  });

  test('an AVAILABLE handle is claimed IN the profile write — one update, the app\'s shape', async () => {
    const s = stand();
    await registerAccount(FORM, s.deps);
    const writes = s.calls.filter((c) => c[0] === 'writeProfile');
    assert.equal(writes.length, 1, 'profile, claim and search row are ONE update');
    assert.deepEqual(writes[0][1], {
      'users/u1/displayName': 'Ada Nwosu',
      'users_private/u1/dob': '1990-01-01',
      'users/u1/ageConfirmed': true,
      'users/u1/joinDate': 1790000000000,
      'users/u1/createdAt': 1790000000000,
      'users/u1/uid': 'u1',
      'users/u1/handle': 'ada_n',
      'users/u1/handleLowercased': 'ada_n',
      'users/u1/username': 'ada_n',
      'usernames/ada_n': 'u1',
      'user_search/u1': { avatarUrl: '', displayName: 'Ada Nwosu', isAuthor: false, username: 'ada_n' },
    });
  });
});

describe('the AGE decides before anything exists (minimum 18, the Terms and Privacy)', () => {
  // deps.now() is 1790000000000 = 2026-09-21. A reader born 2008-09-22 is still 17 that day.
  for (const [dob, why] of [['2008-09-22', /aged 18 and over/], ['2020-01-01', /aged 18 and over/], ['2026-09-01', /aged 18 and over/], ['', /date of birth/], ['1990-02-30', /check your date of birth/], ['2030-01-01', /check your date of birth/]]) {
    test(`dob ${JSON.stringify(dob)} → refused before the account is created, nothing looked up`, async () => {
      const s = stand();
      await assert.rejects(registerAccount({ ...FORM, dob }, s.deps), (e) => e instanceof AgeRefused && why.test(e.message));
      assert.deepEqual(s.names(), [], 'no handle lookup, no Auth account, no write, no mail');
    });
  }
  test('18 today → allowed, and ageConfirmed is written', async () => {
    const s = stand();
    await registerAccount({ ...FORM, dob: '2008-09-21' }, s.deps);
    const w = s.calls.find((c) => c[0] === 'writeProfile')[1];
    assert.equal(w['users/u1/ageConfirmed'], true);
  });
});

describe('the handle decides before anything exists', () => {
  test('a RESERVED handle is refused before the account is created', async () => {
    const s = stand();
    await assert.rejects(registerAccount({ ...FORM, handle: 'calvary' }, s.deps), (e) => e instanceof HandleRefused && e.check.state === 'reserved');
    assert.deepEqual(s.names(), []);
  });

  test('a TAKEN handle is refused before the account is created', async () => {
    const s = stand({ owner: 'someone-else' });
    await assert.rejects(registerAccount(FORM, s.deps), (e) => e instanceof HandleRefused && e.check.state === 'taken' && e.check.handle === 'ada_n');
    assert.deepEqual(s.names(), ['readHandleOwner'], 'no Auth account, no write, no mail');
  });

  for (const [bad, why] of [['ab', /At least 3/], ['a'.repeat(21), /No more than 20/], ['ada nwosu', /Letters, numbers and underscores/], ['ada-n', /Letters, numbers and underscores/], ['adá', /Letters, numbers and underscores/], ['', /Choose a handle/]]) {
    test(`a malformed handle (${JSON.stringify(bad)}) is refused with the app's rule, and never looked up`, async () => {
      const s = stand();
      await assert.rejects(registerAccount({ ...FORM, handle: bad }, s.deps), (e) => e instanceof HandleRefused && e.check.state === 'invalid' && why.test(e.message));
      assert.deepEqual(s.names(), []);
    });
  }

  test('a check that CANNOT RUN is not a refusal — the claim in the write decides', async () => {
    const s = stand();
    s.deps.readHandleOwner = async () => { throw new Error('client is offline'); };
    const r = await registerAccount(FORM, s.deps);
    assert.ok(r.user, 'the signup went ahead');
    assert.ok(s.names().includes('writeProfile'));
  });

  test('a RACE — claimed between the check and the submit — refuses the whole signup and leaves nothing', async () => {
    let claimed = false;
    const s = stand({ owner: () => (claimed ? 'the-winner' : null) });
    // The database refuses the whole update because usernames/ada_n now belongs to someone else.
    s.deps.createUser = async () => { claimed = true; s.calls.push(['createUser']); return { user: { uid: 'u1' } }; };
    s.deps.writeProfile = async () => { s.calls.push(['writeProfile']); const e = new Error('PERMISSION_DENIED: Permission denied'); throw e; };
    await assert.rejects(registerAccount(FORM, s.deps), (e) => e.rolledBack === true && e.handleTaken === true && e.handle === 'ada_n');
    assert.ok(s.names().includes('deleteAccount'), 'the Auth account is taken back out');
    assert.ok(!s.names().includes('sendVerification'));
    const del = s.names().indexOf('deleteAccount');
    const recheck = s.names().lastIndexOf('readHandleOwner');
    assert.ok(del < recheck, 'the rollback runs BEFORE the slow re-check');
  });

  test('a profile write that fails for another reason is NOT blamed on the handle', async () => {
    const s = stand({ failAt: 'writeProfile' });
    await assert.rejects(registerAccount(FORM, s.deps), (e) => e.rolledBack === true && e.handleTaken === false);
  });
});

describe('a failed signup sends nothing and leaves no half-account', () => {
  test('account creation refused → nothing else runs, the auth error surfaces as-is', async () => {
    const s = stand({ failAt: 'createUser' });
    await assert.rejects(registerAccount(FORM, s.deps), (e) => e.code === 'auth/email-already-in-use' && e.rolledBack === undefined);
    assert.deepEqual(s.names(), ['readHandleOwner', 'createUser']);
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
    assert.match(src, /await registerAccount\(\{ email, password, name, dob, handle \}, \{/);
    assert.match(src, /deleteAccount: \(u\) => deleteUser\(u\)/);
    // ONE update at the ROOT — profile, claim and search row together, or none of them.
    assert.match(src, /writeProfile: \(updates\) => update\(ref\(db\), updates\)/);
    assert.match(src, /readHandleOwner,/);
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
