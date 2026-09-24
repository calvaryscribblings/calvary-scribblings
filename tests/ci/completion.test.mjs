// THE COMPLETION STEP — a reader with no identity chooses one; nothing is written until they do.
//
//   node --test tests/ci/completion.test.mjs      (npm run test:ci)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsCompletion, completeProfile, markSignupInFlight, signupSettled } from '../../app/lib/profileCompletion.js';
import { HandleRefused } from '../../app/lib/handle.js';
import { AgeRefused } from '../../app/lib/age.js';

// A database that applies a multi-path update the way RTDB does: each key is a path, null deletes.
function memoryDb(initial) {
  const root = structuredClone(initial);
  const setPath = (path, value) => {
    const parts = path.split('/');
    let node = root;
    for (const p of parts.slice(0, -1)) node = node[p] ??= {};
    if (value === null) delete node[parts.at(-1)]; else node[parts.at(-1)] = structuredClone(value);
  };
  return {
    root,
    writes: [],
    readHandleOwner: async (h) => root.usernames?.[h] ?? null,
    writeUpdate: async function (u) { this.writes.push(u); for (const [k, v] of Object.entries(u)) setPath(k, v); },
  };
}
const GOOGLE = { uid: 'G1', displayName: 'Ada From Google', metadata: { creationTime: 'Tue, 11 Aug 2026 10:00:00 GMT' } };
const NOW = () => Date.parse('2026-09-24T12:00:00Z');

describe('who needs the step — keyed on identity, not on the node', () => {
  test('no node at all → yes', () => assert.equal(needsCompletion(null), true));
  test('a node of reading data with no identity (the census\'s 103) → yes', () => assert.equal(needsCompletion({ displayName: null, username: null, handle: null }), true));
  test('a blank name is no identity', () => assert.equal(needsCompletion({ displayName: '  ' }), true));
  for (const k of ['displayName', 'username', 'handle']) {
    test(`${k} alone → no (a reader with a profile skips the step)`, () => assert.equal(needsCompletion({ [k]: 'x' }), false));
  }
});

describe('completing', () => {
  test('a Google first sign-in → the app\'s exact shape, in ONE update', async () => {
    const db = memoryDb({ usernames: {} });
    await completeProfile(GOOGLE, { name: ' Ada Nwosu ', dob: '1990-01-01', handle: '@Ada_N' }, { ...db, now: NOW });
    assert.equal(db.writes.length, 1);
    const since = Date.parse(GOOGLE.metadata.creationTime);
    assert.deepEqual(db.root.users_private.G1, { dob: '1990-01-01' }, 'the date of birth is PRIVATE');
    assert.deepEqual(db.root.users.G1, {
      displayName: 'Ada Nwosu', ageConfirmed: true, joinDate: since, createdAt: since,
      uid: 'G1', handle: 'ada_n', handleLowercased: 'ada_n', username: 'ada_n',
    });
    assert.equal(db.root.usernames.ada_n, 'G1');
    assert.deepEqual(db.root.user_search.G1, { avatarUrl: '', displayName: 'Ada Nwosu', isAuthor: false, username: 'ada_n' });
  });

  test('a profile-less reader WITH READING DATA → that data is byte-identical afterwards', async () => {
    const reading = {
      readCount: 14,
      readStories: { 'the-flint': true, '1967': true, 'a-slug': { at: 1780000000000 } },
      readerScore: 312, scoreUpdatedAt: 1781234567890,
      readerProgress: { 'the-flint': { cfi: 'epubcfi(/6/4!/4/2/1:0)', generation: '1756' } },
    };
    const db = memoryDb({ users: { G1: structuredClone(reading) }, usernames: {} });
    const before = JSON.stringify(Object.fromEntries(Object.keys(reading).map((k) => [k, db.root.users.G1[k]])));
    await completeProfile(GOOGLE, { name: 'Ada', dob: '1990-01-01', handle: 'ada' }, { ...db, now: NOW });
    const after = JSON.stringify(Object.fromEntries(Object.keys(reading).map((k) => [k, db.root.users.G1[k]])));
    assert.equal(after, before);
    // …and the write named none of them
    for (const k of Object.keys(db.writes[0])) for (const r of Object.keys(reading)) assert.ok(!k.startsWith(`users/G1/${r}`), k);
  });

  test('under 18 → refused, and NOTHING is written', async () => {
    const db = memoryDb({ usernames: {} });
    await assert.rejects(completeProfile(GOOGLE, { name: 'Kid', dob: '2012-05-05', handle: 'kid' }, { ...db, now: NOW }), AgeRefused);
    assert.equal(db.writes.length, 0);
  });

  test('a taken or reserved handle → refused, and NOTHING is written', async () => {
    const db = memoryDb({ usernames: { ada: 'SOMEONE' } });
    await assert.rejects(completeProfile(GOOGLE, { name: 'Ada', dob: '1990-01-01', handle: 'ada' }, { ...db, now: NOW }), (e) => e instanceof HandleRefused && e.check.state === 'taken');
    await assert.rejects(completeProfile(GOOGLE, { name: 'Ada', dob: '1990-01-01', handle: 'storyisland' }, { ...db, now: NOW }), (e) => e instanceof HandleRefused && e.check.state === 'reserved');
    assert.equal(db.writes.length, 0);
  });

  test('a race → the write is refused whole and the reader is told the handle went', async () => {
    let n = 0;
    const deps = { readHandleOwner: async () => (n++ === 0 ? null : 'WINNER'), writeUpdate: async () => { throw new Error('PERMISSION_DENIED'); }, now: NOW };
    await assert.rejects(completeProfile(GOOGLE, { name: 'Ada', dob: '1990-01-01', handle: 'ada' }, deps), (e) => e.handleTaken === true);
  });

  test('ABANDONED — the step writes only inside completeProfile, only from submit', () => {
    // The component: no write in its effect (it only READS the three identity leaves), and the one
    // write goes through completeProfile from the submit handler. Leaving, or signing out, runs neither.
    const src = readFileSync(new URL('../../app/components/ProfileCompletion.js', import.meta.url), 'utf8');
    const effect = src.slice(src.indexOf('useEffect('), src.indexOf('if (!needed || !user) return null;'));
    assert.doesNotMatch(effect, /\b(update|set|push|remove)\(/, 'the gate only reads');
    assert.equal((src.match(/completeProfile\(/g) || []).length, 1);
    assert.equal((src.match(/update\(ref\(db\)/g) || []).length, 1);
    const submit = src.slice(src.indexOf('const submit = async'), src.indexOf('return (\n    <div className="pc-backdrop"'));
    assert.match(submit, /completeProfile\(/);
    assert.doesNotMatch(src, /localStorage|sessionStorage/, 'no half-profile parked anywhere either');
  });
});

describe('an email signup in flight is not mistaken for a reader with no identity', () => {
  test('signupSettled waits for the flight, and resolves at once when there is none', async () => {
    await signupSettled();
    const settle = markSignupInFlight();
    let done = false;
    signupSettled().then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(done, false);
    settle();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(done, true);
  });
  test('AuthModal marks the flight before registerAccount and settles it on every path', () => {
    const src = readFileSync(new URL('../../app/components/AuthModal.js', import.meta.url), 'utf8');
    const mark = src.indexOf('markSignupInFlight()');
    assert.ok(mark !== -1 && mark < src.indexOf('await registerAccount('));
    assert.ok((src.match(/settle\(\);/g) || []).length >= 2);
  });
  test('Providers mounts the step inside AuthProvider', () => {
    const src = readFileSync(new URL('../../app/components/Providers.js', import.meta.url), 'utf8');
    assert.ok(src.indexOf('<ProfileCompletion />') > src.indexOf('<AuthProvider>'));
  });
});
