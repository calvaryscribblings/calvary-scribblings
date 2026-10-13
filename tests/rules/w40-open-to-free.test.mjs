// W40 — "FREE TO READ" (rulings 146–147) AGAINST THE REAL RULES (emulator).
//
// The public row gains openToFree, a boolean. An instalment open to Free must also carry
// freeForGold: true, so an app that does not know the new field still treats it as at least the
// Gold taste. The pair is held by the rules from BOTH sides: neither field can be written into
// openToFree true + freeForGold false, whether in one write or by changing one leaf later.
import { test, before, after, beforeEach, describe } from 'node:test';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, FOUNDER_A } from './helpers.mjs';

const T0 = 1_760_000_000_000;
const ROW = { schemaVersion: 1, seriesId: 'probe-series', ordinal: 1, releaseAtMs: T0, freeForGold: true, status: 'published', addedAt: T0, updatedAt: T0 };
const PATH = 'series_instalments/probe-series-i1';

let env, founder, reader;
before(async () => {
  env = await makeEnv();
  founder = env.authenticatedContext(FOUNDER_A).database();
  reader = env.authenticatedContext(OWNER).database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

describe('W40 · openToFree on the public row', () => {
  test('a founder writes a free row: openToFree true with freeForGold true', async () => {
    await assertSucceeds(founder.ref(PATH).set({ ...ROW, openToFree: true }));
  });
  test('a row without the field is still valid (every row from before W40)', async () => {
    await assertSucceeds(founder.ref(PATH).set(ROW));
  });
  test('openToFree false is valid with either freeForGold', async () => {
    await assertSucceeds(founder.ref(PATH).set({ ...ROW, openToFree: false }));
    await assertSucceeds(founder.ref(PATH).set({ ...ROW, freeForGold: false, openToFree: false }));
  });
  test('⛔ openToFree true with freeForGold false is refused, in one write', async () => {
    await assertFails(founder.ref(PATH).set({ ...ROW, freeForGold: false, openToFree: true }));
  });
  test('⛔ ...and leaf by leaf, from either side', async () => {
    await seed(env, { [PATH]: { ...ROW, openToFree: true } });
    await assertFails(founder.ref(`${PATH}/freeForGold`).set(false));
    await seed(env, { [PATH]: { ...ROW, freeForGold: false } });
    await assertFails(founder.ref(`${PATH}/openToFree`).set(true));
  });
  test('a free row moves back to Gold or Platinum in one update', async () => {
    await seed(env, { [PATH]: { ...ROW, openToFree: true } });
    await assertSucceeds(founder.ref(PATH).update({ openToFree: false }));
    await assertSucceeds(founder.ref(PATH).update({ openToFree: false, freeForGold: false }));
  });
  test('the field is a boolean, never a string', async () => {
    await assertFails(founder.ref(PATH).set({ ...ROW, openToFree: 'true' }));
  });
  test('a reader cannot write it', async () => {
    await seed(env, { [PATH]: ROW });
    await assertFails(reader.ref(`${PATH}/openToFree`).set(true));
  });
});
