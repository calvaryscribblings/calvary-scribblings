// W49 §1 — functions/api/hit.js against the RTDB emulator (ruling 180: one reader, one read).
//
//   npm run test:reads:emulator
//
// What it holds:
//   · the token beats the body: a signed-in read is keyed by the VERIFIED uid, whatever the body says;
//   · no identity, no count: no token and no readerId → counted:false and the count unmoved
//     (the back-compat branch is gone), and "null"/"undefined" are not identities;
//   · a token that does not verify counts nothing, and does not fall back to the device id;
//   · one reader on two devices counts once (the same uid from both);
//   · two hits at once from one reader count once;
//   · a counted read bumps today's UTC hitsByDay bucket, an uncounted one does not;
//   · existing uid-keyed ledger entries keep deduplicating.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, wipe, get, set, request, context, tokenFor } from './harness.mjs';
import { onRequestPost, onRequestGet } from '../../functions/api/hit.js';
import { claimOnce } from '../../functions/api/_ledger.js';

const SLUG = 'w49-probe-story';
const UID = 'w49ReaderUid0000000000000001';
const DEVICE = '3f0d3a52-7c1e-4a5b-9d2f-0123456789ab';
const today = () => new Date().toISOString().slice(0, 10);

async function hit({ token, body = {}, query = '', method = 'POST' } = {}) {
  const req = request(`/api/hit?slug=${SLUG}${query}`, { method, token, body: method === 'POST' ? { slug: SLUG, client: 'web', ...body } : undefined });
  const { ctx, settle } = context(req);
  const res = await (method === 'POST' ? onRequestPost(ctx) : onRequestGet(ctx));
  await settle();
  return { status: res.status, ...(await res.json()) };
}
const hits = async () => (await get(`stories/${SLUG}/hits`)) || 0;
const bucket = async () => (await get(`stories/${SLUG}/hitsByDay/${today()}`)) || 0;

before(install);
after(uninstall);
beforeEach(async () => {
  await wipe();
  await set(`stories/${SLUG}`, { hits: 100 });
});

describe('W49 · /api/hit — one reader, one read', () => {
  test('the token beats the body: keyed by the verified uid, never the body readerId', async () => {
    const a = await hit({ token: tokenFor(UID), body: { readerId: DEVICE } });
    assert.equal(a.counted, true);
    assert.equal(a.count, 101);
    const ledger = await get(`storyReads/${SLUG}`);
    assert.deepEqual(Object.keys(ledger), [UID], 'the ledger key is the uid, not the device id in the body');
    // The same reader, the same token, a different device id in the body: still counted once.
    const b = await hit({ token: tokenFor(UID), body: { readerId: 'someone-else-entirely' } });
    assert.equal(b.counted, false);
    assert.equal(await hits(), 101);
  });

  test('no identity, no count — and the back-compat branch is gone (GET and bare POST)', async () => {
    for (const r of [await hit(), await hit({ method: 'GET' }), await hit({ query: '&readerId=null' }), await hit({ body: { readerId: 'undefined' } })]) {
      assert.equal(r.counted, false);
      assert.equal(r.count, 100);
    }
    assert.equal(await hits(), 100);
    assert.equal(await get(`storyReads/${SLUG}`), null, 'nothing was written to the ledger');
    assert.equal(await bucket(), 0, 'and no day bucket');
  });

  test('a token that does not verify counts nothing, and does not fall back to the device id', async () => {
    const r = await hit({ token: 'forged', body: { readerId: DEVICE } });
    assert.equal(r.counted, false);
    assert.equal(await hits(), 100);
    assert.equal(await get(`storyReads/${SLUG}`), null);
  });

  test('signed out: the device id counts once', async () => {
    assert.equal((await hit({ body: { readerId: DEVICE } })).counted, true);
    assert.equal((await hit({ body: { readerId: DEVICE } })).counted, false);
    assert.equal(await hits(), 101);
  });

  test('one reader on two devices counts once (the uid from both)', async () => {
    // Device A signs in and reads; device B, the same account, reads later.
    assert.equal((await hit({ token: tokenFor(UID), body: { readerId: 'device-a-0000' } })).counted, true);
    assert.equal((await hit({ token: tokenFor(UID), body: { readerId: 'device-b-0000' } })).counted, false);
    assert.equal(await hits(), 101);
  });

  test('two hits at once from one reader count once (the claim cannot race)', async () => {
    const all = await Promise.all(Array.from({ length: 8 }, () => hit({ token: tokenFor(UID) })));
    assert.equal(all.filter((r) => r.counted).length, 1, 'exactly one of eight simultaneous first reads wins');
    assert.equal(await hits(), 101);
    assert.equal(await bucket(), 1);
  });

  test('the claim itself: twenty simultaneous claims of one entry, exactly one winner', async () => {
    // Driven directly, so the race is certain rather than left to the endpoint's timing.
    const url = 'https://w49.test/storyReads/w49-probe-story/racer.json';
    for (let round = 0; round < 3; round++) {
      await set(`storyReads/${SLUG}/racer`, null);
      const wins = await Promise.all(Array.from({ length: 20 }, () => claimOnce(url, {})));
      assert.equal(wins.filter(Boolean).length, 1, `round ${round}: one winner`);
    }
  });

  test('a counted read bumps today’s UTC bucket; an uncounted one does not', async () => {
    await set(`stories/${SLUG}/hitsByDay/${today()}`, 4);
    await hit({ token: tokenFor(UID) });
    assert.equal(await bucket(), 5);
    await hit({ token: tokenFor(UID) });
    await hit();
    assert.equal(await bucket(), 5);
  });

  test('an existing uid-keyed ledger entry (from before W49) keeps deduplicating', async () => {
    await set(`storyReads/${SLUG}/${UID}`, 1_760_000_000_000);
    const r = await hit({ token: tokenFor(UID) });
    assert.equal(r.counted, false);
    assert.equal(await hits(), 100);
  });
});
