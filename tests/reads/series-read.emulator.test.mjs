// W49 §3 — functions/api/series/read.js against the RTDB emulator (ruling 176).
//
// What it holds:
//   · a reader's first read: the ledger entry and the increment land; any later read changes nothing;
//   · two first reads at once count once;
//   · the uid comes from the token only: no token is signed_out, a forged one is too;
//   · an unreleased, unpublished or missing instalment never counts;
//   · after the gate, an instalment the reader's membership does not open never counts;
//   · it is not behind SERIES_NOTES_ENABLED.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, wipe, get, set, patch, request, context, tokenFor, ENV } from './harness.mjs';
import { onRequestPost } from '../../functions/api/series/read.js';
import { seriesGateOn } from '../../app/lib/series/access.js';

const INST = 'w49-probe-i1';
const READER = 'w49SeriesReader000000000001';
const OTHER = 'w49SeriesOther0000000000002';
const PAST = Date.now() - 86_400_000;
const row = (over = {}) => ({ schemaVersion: 1, seriesId: 'w49-probe', ordinal: 1, releaseAtMs: PAST, freeForGold: true, status: 'published', addedAt: 1, updatedAt: 1, ...over });
const PLATINUM = (uid) => ({ [`users/${uid}/membership`]: 'platinum', [`memberships/${uid}`]: { tier: 'platinum', status: 'active', currentPeriodEnd: Date.now() + 30 * 86_400_000 } });

async function read(inst = INST, { token = tokenFor(READER), env = ENV } = {}) {
  const { ctx, settle } = context(request('/api/series/read', { token, body: { inst } }), env);
  const res = await onRequestPost(ctx);
  await settle();
  return { status: res.status, ...(await res.json()) };
}
const count = async (inst = INST) => (await get(`series_reads/${inst}`)) || 0;

before(install);
after(uninstall);
beforeEach(async () => {
  await wipe();
  await patch({ [`series_instalments/${INST}`]: row(), ...PLATINUM(READER), ...PLATINUM(OTHER) });
});

describe('W49 · /api/series/read — one reader, one read (176)', () => {
  test('the first read counts: the ledger entry and the increment land together', async () => {
    const r = await read();
    assert.deepEqual([r.status, r.counted, r.count], [200, true, 1]);
    assert.equal(typeof (await get(`series_read_ledger/${INST}/${READER}`)), 'number', 'the ledger holds a server timestamp');
    assert.equal(await count(), 1);
  });

  test('a later read changes nothing', async () => {
    await read();
    const again = await read();
    assert.deepEqual([again.counted, again.count], [false, 1]);
    assert.equal(await count(), 1);
  });

  test('two first reads at once count once', async () => {
    const all = await Promise.all(Array.from({ length: 8 }, () => read()));
    assert.equal(all.filter((r) => r.counted).length, 1);
    assert.equal(await count(), 1);
  });

  test('two readers: two reads', async () => {
    await read();
    await read(INST, { token: tokenFor(OTHER) });
    assert.equal(await count(), 2);
  });

  test('the uid comes from the token only: none, or a forged one, is signed_out and counts nothing', async () => {
    assert.equal((await read(INST, { token: null })).status, 401);
    assert.equal((await read(INST, { token: 'forged' })).status, 401);
    assert.equal(await count(), 0);
    assert.equal(await get(`series_read_ledger/${INST}`), null);
  });

  test('an unreleased, an unpublished or a missing instalment never counts', async () => {
    await patch({ 'series_instalments/w49-later': row({ releaseAtMs: Date.now() + 86_400_000 }), 'series_instalments/w49-draft': row({ status: 'draft' }) });
    assert.equal((await read('w49-later')).status, 409);
    assert.equal((await read('w49-draft')).status, 409);
    assert.equal((await read('w49-nowhere')).status, 404);
    for (const i of ['w49-later', 'w49-draft', 'w49-nowhere']) {
      assert.equal(await count(i), 0);
      assert.equal(await get(`series_read_ledger/${i}`), null);
    }
  });

  test('an instalment this reader cannot open never counts (after the gate)', { skip: !seriesGateOn(Date.now()) && 'the tier gate is off' }, async () => {
    await set(`users/${READER}/membership`, null);
    await set(`memberships/${READER}`, null);
    const r = await read();
    assert.equal(r.status, 403);
    assert.equal(r.code, 'no_access');
    assert.equal(await count(), 0);
    assert.equal(await get(`series_read_ledger/${INST}/${READER}`), null);
  });

  test('not behind SERIES_NOTES_ENABLED: counts with the notes flag forced off', async () => {
    const r = await read(INST, { env: { ...ENV, SERIES_NOTES_TEST: '0', SERIES_NOTES_ENABLED: 'false' } });
    assert.equal(r.counted, true);
  });
});
