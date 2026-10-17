// W49 §6 — scripts/series/seed-reads.mjs against the RTDB emulator, with LIVE READS RACING IT.
//
// Ruling 178: each instalment's count starts from the readers with a saved place. The proof the
// brief asks for before --apply touches production: a live read during the run is neither lost nor
// counted twice. Live reads go through the real endpoint (functions/api/series/read.js) while the
// seed runs; afterwards every instalment's count equals its ledger's size, and every reader has
// exactly one entry.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, wipe, get, patch, request, context, tokenFor, ENV } from './harness.mjs';
import { onRequestPost } from '../../functions/api/series/read.js';
import { restDb, planSeed, applySeed } from '../../scripts/series/seed-reads.mjs';

const A = 'w49-seed-i1', B = 'w49-seed-i2', LATER = 'w49-seed-i3';
const PAST = Date.now() - 86_400_000;
const row = (over = {}) => ({ schemaVersion: 1, seriesId: 'w49-seed', ordinal: 1, releaseAtMs: PAST, freeForGold: true, status: 'published', addedAt: 1, updatedAt: 1, ...over });
const uid = (i) => `w49SeedReader${String(i).padStart(15, '0')}`;
const place = { fraction: 0.4, updatedAt: PAST };
const plat = (u) => ({ [`users/${u}/membership`]: 'platinum', [`memberships/${u}`]: { tier: 'platinum', status: 'active', currentPeriodEnd: Date.now() + 30 * 86_400_000 } });

async function live(inst, u) {
  const { ctx, settle } = context(request('/api/series/read', { token: tokenFor(u), body: { inst } }));
  const r = await (await onRequestPost(ctx)).json();
  await settle();
  return r;
}
// The seeder's client, pointed at the emulator (the same REST calls it makes against production).
// Through the harness's fake host, like the endpoints, so it reaches the same namespace.
const db = () => restDb({ base: ENV.FIREBASE_DATABASE_URL, token: 'owner' });

before(install);
after(uninstall);
beforeEach(async () => {
  await wipe();
  const u = { [`series_instalments/${A}`]: row(), [`series_instalments/${B}`]: row({ ordinal: 2 }) };
  // 30 readers with a place in A, 12 of them also in B; one place in an instalment that does not exist.
  for (let i = 0; i < 30; i++) { u[`series_reading_progress/${uid(i)}/${A}`] = place; Object.assign(u, plat(uid(i))); }
  for (let i = 0; i < 12; i++) u[`series_reading_progress/${uid(i)}/${B}`] = place;
  u[`series_reading_progress/${uid(0)}/${LATER}`] = place;
  for (let i = 30; i < 40; i++) Object.assign(u, plat(uid(i)));
  await patch(u);
});

const ledgerKeys = async (inst) => Object.keys((await get(`series_read_ledger/${inst}`)) || {});

describe('W49 · seed-reads (178)', () => {
  test('the dry run counts readers with a saved place, per existing instalment, and writes nothing', async () => {
    const plan = await planSeed(db());
    assert.deepEqual(Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length])), { [A]: 30, [B]: 12 });
    assert.equal(await get('series_read_ledger'), null);
    assert.equal(await get('series_reads'), null);
  });

  test('--apply: count = ledger size; readers already counted live are not counted twice', async () => {
    // Five readers of A were counted live before the seed (the endpoint is live first).
    for (let i = 0; i < 5; i++) assert.equal((await live(A, uid(i))).counted, true);
    // …and three readers with no saved place were counted live too: the count must keep them.
    for (let i = 30; i < 33; i++) assert.equal((await live(A, uid(i))).counted, true);
    const res = await applySeed(db(), await planSeed(db()), { settleMs: 300 });
    assert.deepEqual(res[A], { readers: 30, created: 25, count: 33 });
    assert.deepEqual(res[B], { readers: 12, created: 12, count: 12 });
    assert.equal(await get(`series_reads/${A}`), 33);
    assert.equal(await get(`series_reads/${B}`), 12);
    // A seeded reader opening it again is NOT a counted read (so the reader credits nothing).
    assert.equal((await live(A, uid(7))).counted, false);
    assert.equal(await get(`series_reads/${A}`), 33);
  });

  test('live reads DURING the run are neither lost nor counted twice', async () => {
    const plan = await planSeed(db());
    // Racing the seed: seeded readers reading (0–29, would double-count if the claim raced), and
    // new readers with no saved place (30–39, would be lost if the count were overwritten blindly).
    const racers = [];
    const seeding = applySeed(db(), plan, { settleMs: 400 });
    for (let wave = 0; wave < 4; wave++) {
      await new Promise((r) => setTimeout(r, 120));
      for (let i = wave; i < 40; i += 4) racers.push(live(A, uid(i)));
    }
    const [res] = await Promise.all([seeding, Promise.all(racers)]);
    await new Promise((r) => setTimeout(r, 50));
    const keys = await ledgerKeys(A);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(keys.length, 40, 'every reader once: 30 seeded + 10 live-only');
    assert.equal(await get(`series_reads/${A}`), 40, 'the count is the ledger’s size — nothing lost, nothing doubled');
    assert.ok(res[A].count <= 40);
  });

  test('seeded reads credit nobody: no readCount, no marker, no points', async () => {
    await applySeed(db(), await planSeed(db()), { settleMs: 200 });
    for (const i of [0, 5, 29]) {
      assert.equal(await get(`users/${uid(i)}/readCount`), null);
      assert.equal(await get(`users/${uid(i)}/readInstalments`), null);
      assert.equal(await get(`points/${uid(i)}`), null);
    }
  });

  test('running it twice changes nothing', async () => {
    await applySeed(db(), await planSeed(db()), { settleMs: 200 });
    const again = await applySeed(db(), await planSeed(db()), { settleMs: 200 });
    assert.equal(again[A].created, 0);
    assert.equal(await get(`series_reads/${A}`), 30);
  });
});
