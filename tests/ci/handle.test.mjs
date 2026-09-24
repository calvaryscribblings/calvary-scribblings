// A HANDLE: the app's rules, a check that never calls a network failure "taken", and the shape.
//
//   node --test tests/ci/handle.test.mjs      (npm run test:ci)
//
// The rules and the shape are derived from live app records — see app/lib/handle.js's header.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseHandle, handleProblem, checkHandle, signupUpdate, handleStatusLine, HANDLE_RE, HANDLE_COPY,
  isReserved, RESERVED_WORDS, RESERVED_PREFIXES, FOUNDER_UIDS, renameUpdate, renameHandle, completionUpdate, HandleRefused,
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

  test('users/{uid} carries every field the app writes — ageConfirmed now included, because the age is checked', () => {
    // The app's eight: ageConfirmed, createdAt, displayName, dob, handle, handleLowercased, uid, username.
    const fields = Object.keys(u).filter((k) => k.startsWith('users/U1/')).map((k) => k.slice('users/U1/'.length)).sort();
    assert.deepEqual(fields, ['ageConfirmed', 'createdAt', 'displayName', 'dob', 'handle', 'handleLowercased', 'joinDate', 'uid', 'username']);
    assert.equal(u['users/U1/ageConfirmed'], true);
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
    assert.equal(Object.keys(u).length, 11);
  });
});

describe('reserved names (ruling, 24 Sep 2026)', () => {
  for (const h of ['calvary', 'calvaryscribblings', 'calvary_2', 'storyisland', 'storyislandhq', 'story_island', 'story_island_x', ...RESERVED_WORDS]) {
    test(`reserved: ${h}`, () => assert.equal(isReserved(h), true));
  }
  for (const h of ['calvar', 'mycalvary', 'story', 'storyislander'.slice(0, 5), 'admins', 'moderators', 'helper', 'teamwork', 'modern', 'rooted', 'editorial', 'founders', 'story_isle']) {
    test(`not reserved: ${h}`, () => assert.equal(isReserved(h), false));
  }
  test('the list is exactly the ruling', () => {
    assert.deepEqual(RESERVED_PREFIXES, ['calvary', 'storyisland', 'story_island']);
    assert.deepEqual(RESERVED_WORDS, ['admin', 'administrator', 'support', 'help', 'official', 'staff', 'team', 'editor', 'editors', 'moderator', 'mod', 'system', 'root', 'security', 'founder']);
  });
  test('signing up: a reserved name is refused without a lookup', async () => {
    let looked = false;
    const r = await checkHandle('Calvary_Fan', async () => { looked = true; return null; });
    assert.equal(r.state, 'reserved');
    assert.equal(looked, false);
    assert.equal(handleStatusLine(r).tone, 'bad');
    assert.match(handleStatusLine(r).text, /reserved/);
  });
  test('the current holder keeps theirs (a reader who already holds calvaryfilms)', async () => {
    assert.equal((await checkHandle('calvaryfilms', async () => 'holder', { uid: 'holder' })).state, 'available');
    assert.equal((await checkHandle('calvaryfilms', async () => 'holder', { uid: 'someone' })).state, 'reserved');
  });
  test('founders are exempt', async () => {
    assert.equal((await checkHandle('admin', async () => null, { uid: FOUNDER_UIDS[0] })).state, 'available');
  });
});

describe('the completion write', () => {
  test('is the signup shape, dated from the Auth account\'s creation', () => {
    const c = completionUpdate('G1', { name: 'Ada', dob: '1990-01-01', handle: 'ada', since: 1780000000000 });
    assert.deepEqual(c, signupUpdate('G1', { name: 'Ada', dob: '1990-01-01', handle: 'ada', now: 1780000000000 }));
  });
});

describe('a rename — ONE write', () => {
  test('three fields, the search row\'s copy, the new claim and the release of the old', () => {
    assert.deepEqual(renameUpdate('U1', { from: 'old_one', to: '@New_One', oldClaimOwner: 'U1' }), {
      'users/U1/handle': 'new_one', 'users/U1/handleLowercased': 'new_one', 'users/U1/username': 'new_one',
      'user_search/U1/username': 'new_one', 'usernames/new_one': 'U1', 'usernames/old_one': null,
    });
  });
  test('an old claim someone ELSE holds is not released (it would sink the whole write)', () => {
    assert.equal('usernames/lizbest' in renameUpdate('U1', { from: 'lizbest', to: 'liz_b', oldClaimOwner: 'OTHER' }), false);
  });
  test('a reader with no handle before claims one and releases nothing', () => {
    const r = renameUpdate('U1', { from: '', to: 'fresh', oldClaimOwner: null });
    assert.equal(Object.keys(r).filter((k) => k.startsWith('usernames/')).join(), 'usernames/fresh');
  });

  const deps = (owners, { failWrite = false } = {}) => {
    const writes = [];
    return {
      writes,
      readHandleOwner: async (h) => (typeof owners === 'function' ? owners(h) : owners[h] ?? null),
      writeUpdate: async (u) => { writes.push(u); if (failWrite) throw new Error('PERMISSION_DENIED'); },
    };
  };
  test('available → ONE update carrying the rename AND the rest of the save', async () => {
    const d = deps({ old_one: 'U1' });
    const r = await renameHandle('U1', { from: 'old_one', to: 'new_one', extra: { 'users/U1/bio': 'hi' } }, d);
    assert.equal(d.writes.length, 1);
    assert.equal(d.writes[0]['users/U1/bio'], 'hi');
    assert.equal(d.writes[0]['usernames/new_one'], 'U1');
    assert.equal(d.writes[0]['usernames/old_one'], null);
    assert.equal(r.released, true);
  });
  test('taken → refused before anything is written', async () => {
    const d = deps({ new_one: 'OTHER' });
    await assert.rejects(renameHandle('U1', { from: 'old_one', to: 'new_one' }, d), (e) => e instanceof HandleRefused && e.check.state === 'taken');
    assert.equal(d.writes.length, 0);
  });
  test('reserved → refused before anything is written', async () => {
    const d = deps({});
    await assert.rejects(renameHandle('U1', { from: 'old_one', to: 'support' }, d), (e) => e instanceof HandleRefused && e.check.state === 'reserved');
    assert.equal(d.writes.length, 0);
  });
  test('a RACE — claimed between the check and the write → the write is refused whole and the reader is told', async () => {
    let n = 0;
    const d = deps((h) => (h === 'new_one' ? (n++ === 0 ? null : 'WINNER') : 'U1'), { failWrite: true });
    await assert.rejects(renameHandle('U1', { from: 'old_one', to: 'new_one' }, d), (e) => e.handleTaken === true && e.handle === 'new_one');
    assert.equal(d.writes.length, 1, 'one attempted write, and the database refused all of it');
  });
  test('unchanged handle → only the rest of the save is written, no claim touched', async () => {
    const d = deps({});
    await renameHandle('U1', { from: 'same', to: '@Same', extra: { 'users/U1/bio': 'x' } }, d);
    assert.deepEqual(d.writes, [{ 'users/U1/bio': 'x' }]);
  });
});
