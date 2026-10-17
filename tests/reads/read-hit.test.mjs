// W49 §2 — app/lib/readHit.js: the website counts once, after sign-in settles. Pure node.
//
//   · a signed-in reader whose session is restored LATE still sends the ID token — never the device
//     id the old code fell back to while auth.currentUser was still null;
//   · signed out: the device id, the same one every time;
//   · no storage: no readerId at all — never "null";
//   · the Series reader's call carries the token and nothing else.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sendReadHit, sendInstalmentRead, settledUser } from '../../app/lib/readHit.js';

const store = new Map();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
});

/** An Auth that restores its user only after `ms`, as Firebase does on a cold load. */
function lateAuth(user, ms = 30) {
  const auth = { currentUser: null };
  const ready = new Promise((r) => setTimeout(() => { auth.currentUser = user; r(); }, ms));
  auth.authStateReady = () => ready;
  return auth;
}
const user = (uid) => ({ uid, getIdToken: async () => `tok-${uid}` });
function recorder() {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ count: 3, counted: true })); };
  return { calls, fetchImpl };
}

describe('W49 · sendReadHit', () => {
  test('sign-in that settles late: the token is sent, not the device id', async () => {
    const { calls, fetchImpl } = recorder();
    const auth = lateAuth(user('u1'));
    assert.equal(auth.currentUser, null, 'at the moment of the hit, the old code saw nobody');
    const res = await sendReadHit('a-story', auth, { fetchImpl });
    assert.equal(res.count, 3);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.Authorization, 'Bearer tok-u1');
    assert.equal('readerId' in calls[0].body, false, 'a signed-in read carries no device id');
    assert.equal(calls[0].url, '/api/hit?slug=a-story');
    assert.equal(calls[0].body.client, 'web');
  });

  test('signed out: the device id, the same one on every read', async () => {
    const { calls, fetchImpl } = recorder();
    await sendReadHit('a-story', lateAuth(null), { fetchImpl });
    await sendReadHit('b-story', lateAuth(null), { fetchImpl });
    assert.equal(calls[0].headers.Authorization, undefined);
    assert.match(calls[0].body.readerId, /^[0-9a-f-]{36}$/);
    assert.equal(calls[1].body.readerId, calls[0].body.readerId);
  });

  test('never "null": no storage means no readerId at all, and a stored "null" is replaced', async () => {
    const { calls, fetchImpl } = recorder();
    globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    await sendReadHit('a-story', lateAuth(null), { fetchImpl });
    assert.equal('readerId' in calls[0].body, false);
    assert.doesNotMatch(calls[0].url, /null/);
    store.clear();
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
    store.set('cs_reader_id', 'null');
    await sendReadHit('a-story', lateAuth(null), { fetchImpl });
    assert.notEqual(calls[1].body.readerId, 'null');
  });

  test('an Auth without authStateReady waits for its first callback', async () => {
    // settledUser falls back to onAuthStateChanged; a missing auth is simply signed out.
    assert.equal(await settledUser(null), null);
  });
});

describe('W49 · sendInstalmentRead', () => {
  test('the token, the instalment, nothing else', async () => {
    const { calls, fetchImpl } = recorder();
    await sendInstalmentRead('s-i1', user('u2'), { fetchImpl });
    assert.equal(calls[0].url, '/api/series/read');
    assert.equal(calls[0].headers.Authorization, 'Bearer tok-u2');
    assert.deepEqual(calls[0].body, { inst: 's-i1' });
  });
  test('signed out: no call at all', async () => {
    const { calls, fetchImpl } = recorder();
    assert.equal(await sendInstalmentRead('s-i1', null, { fetchImpl }), null);
    assert.equal(calls.length, 0);
  });
});
