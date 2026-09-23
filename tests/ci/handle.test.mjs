// A HANDLE: the app's rules, a check that never calls a network failure "taken", and the shape.
//
//   node --test tests/ci/handle.test.mjs      (npm run test:ci)
//
// The rules and the shape are derived from live app records — see app/lib/handle.js's header.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseHandle, handleProblem, checkHandle, signupUpdate, handleStatusLine, HANDLE_RE, HANDLE_COPY,
} from '../../app/lib/handle.js';

describe('the rules — identical to the app\'s', () => {
  test('the pattern is the one every live usernames/ key already matches', () => {
    assert.equal(String(HANDLE_RE), String(/^[a-z0-9_]{3,20}$/));
  });

  test('normalised as stored: no leading @, trimmed, lowercase', () => {
    assert.equal(normaliseHandle('  @Ada_N '), 'ada_n');
    assert.equal(normaliseHandle('@@MayaUGC'), 'mayaugc');
    assert.equal(normaliseHandle(undefined), '');
  });

  for (const ok of ['abc', 'a'.repeat(20), 'x_ali_x', '_fedajee_', '9szhkvv9dn', 'facebook']) {
    test(`accepted: ${ok}`, () => assert.equal(handleProblem(ok), null));
  }
  for (const [bad, why] of [['', /Choose/], ['ab', /At least 3/], ['a'.repeat(21), /No more than 20/], ['a b', /underscores only/], ['a.b', /underscores only/], ['a-b', /underscores only/], ['ünï', /underscores only/], ['Abc', /underscores only/]]) {
    test(`refused: ${JSON.stringify(bad)}`, () => assert.match(handleProblem(bad), why));
  }
  test('handleProblem agrees with HANDLE_RE on every refusal and every acceptance', () => {
    for (const h of ['abc', 'ab', 'a'.repeat(20), 'a'.repeat(21), 'a_b', 'a-b', 'ABC']) {
      assert.equal(handleProblem(h) === null, HANDLE_RE.test(h), h);
    }
  });
});

describe('the availability check', () => {
  test('nobody holds it → available', async () => {
    assert.deepEqual(await checkHandle('Ada', async () => null), { state: 'available', handle: 'ada' });
  });

  test('someone holds it → taken', async () => {
    assert.equal((await checkHandle('ada', async () => 'uid-x')).state, 'taken');
  });

  test('this reader holds it → available (their own claim)', async () => {
    assert.equal((await checkHandle('ada', async () => 'me', { uid: 'me' })).state, 'available');
  });

  test('a malformed handle is never looked up', async () => {
    let looked = false;
    const r = await checkHandle('a b', async () => { looked = true; return null; });
    assert.equal(r.state, 'invalid');
    assert.equal(looked, false);
  });

  test('a NETWORK ERROR is unknown, never taken', async () => {
    const r = await checkHandle('ada', async () => { throw new Error('client is offline'); });
    assert.equal(r.state, 'unknown');
    assert.match(r.error, /offline/);
  });

  test('a read that NEVER SETTLES (firebase get() when unreachable) times out to unknown', { timeout: 2000 }, async () => {
    const r = await checkHandle('ada', () => new Promise(() => {}), { deadlineMs: 30 });
    assert.equal(r.state, 'unknown');
  });

  test('a readOwner that throws synchronously is still unknown', async () => {
    const r = await checkHandle('ada', () => { throw new Error('boom'); });
    assert.equal(r.state, 'unknown');
  });

  test('the words for unknown never say taken, and the words for taken never say unknown', () => {
    const unknown = handleStatusLine({ state: 'unknown', handle: 'ada' });
    const taken = handleStatusLine({ state: 'taken', handle: 'ada' });
    assert.doesNotMatch(unknown.text, /taken|belongs|another reader/i);
    assert.notEqual(unknown.tone, 'bad');
    assert.equal(taken.tone, 'bad');
    assert.equal(taken.text, HANDLE_COPY.taken('ada'));
  });
});

describe('the shape the signup writes — the app\'s, field for field', () => {
  const u = signupUpdate('U1', { name: 'rebel', dob: '1995-08-15', handle: '@Rebel', now: 1790196135417 });

  test('users/{uid} carries every field the app writes, except ageConfirmed (see report)', () => {
    // The app's eight: ageConfirmed, createdAt, displayName, dob, handle, handleLowercased, uid, username.
    const fields = Object.keys(u).filter((k) => k.startsWith('users/U1/')).map((k) => k.slice('users/U1/'.length)).sort();
    assert.deepEqual(fields, ['createdAt', 'displayName', 'dob', 'handle', 'handleLowercased', 'joinDate', 'uid', 'username']);
  });

  test('the handle is written three times, lowercase, identical — as every app record since 28 Jun', () => {
    assert.equal(u['users/U1/handle'], 'rebel');
    assert.equal(u['users/U1/handleLowercased'], 'rebel');
    assert.equal(u['users/U1/username'], 'rebel');
  });

  test('the claim is keyed by the lowercase handle and holds the uid', () => {
    assert.equal(u['usernames/rebel'], 'U1');
  });

  test('the search row is the app\'s four fields', () => {
    assert.deepEqual(u['user_search/U1'], { avatarUrl: '', displayName: 'rebel', isAuthor: false, username: 'rebel' });
  });

  test('nothing else is written', () => {
    assert.equal(Object.keys(u).length, 10);
  });
});
