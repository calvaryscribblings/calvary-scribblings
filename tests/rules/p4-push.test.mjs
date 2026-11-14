// P4-B1 — the rules personal pushes stand on.
//
//   npm run test:rules   (emulator)
//
// push_queue, push_state and the drain's lease are the server's alone: no client reads or writes
// them, founders included (the drain uses the server's token, which passes no rule). A device's own
// row takes pushCaps and installHash beside its four fields. seenAt takes the server's timestamp.
// The Stories switch (359) writes both its fields in one update.
import { test, before, after, beforeEach, describe } from 'node:test';
import { serverTimestamp } from 'firebase/database';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, STRANGER, FOUNDER_A } from './helpers.mjs';

let env, owner, stranger, founder, anon;
before(async () => {
  env = await makeEnv();
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
  founder = env.authenticatedContext(FOUNDER_A).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const KEY = `${OWNER}~reply:sq:-p1`;
const ENTRY = { uid: OWNER, rid: 'reply:sq:-p1', kind: 'reply', at: 1, dueAt: 1 };

describe('P4-B1 · push_queue, push_state, ops/push_drain: every client out', () => {
  test('nobody reads the queue or the state, founders included, the reader it is for included', async () => {
    await seed(env, { [`push_queue/${KEY}`]: ENTRY, [`push_state/${OWNER}/reply:sq:-p1`]: { pushedAt: 1, recAt: 1 } });
    for (const db of [owner, stranger, founder, anon]) {
      await assertFails(db.ref('push_queue').get());
      await assertFails(db.ref(`push_queue/${KEY}`).get());
      await assertFails(db.ref(`push_state/${OWNER}`).get());
    }
  });
  test('nobody writes them: a forged entry, a cleared one, a reset day counter, a stolen lease', async () => {
    await seed(env, { [`push_queue/${KEY}`]: ENTRY, [`push_state/${OWNER}/_day`]: { day: '2026-11-14', n: 20, morning: 3 } });
    for (const db of [owner, stranger, founder]) {
      await assertFails(db.ref(`push_queue/${STRANGER}~x`).set({ ...ENTRY, uid: STRANGER }));
      await assertFails(db.ref(`push_queue/${KEY}`).remove());
      await assertFails(db.ref(`push_queue/${KEY}/dueAt`).set(0));
      await assertFails(db.ref(`push_state/${OWNER}/_day`).set({ day: '2026-11-14', n: 0, morning: 0 }));
      await assertFails(db.ref('ops/push_drain/lease').set({ until: Date.now() + 60000 }));
      await assertFails(db.ref('ops/push_drain/lastRunAt').set(Date.now()));
    }
  });
  test('the drain\'s heartbeat: founders read it, nobody else', async () => {
    await seed(env, { 'ops/push_drain/lastRunAt': 1 });
    await assertSucceeds(founder.ref('ops/push_drain').get());
    await assertFails(owner.ref('ops/push_drain').get());
    await assertFails(anon.ref('ops/push_drain').get());
  });
});

describe('P4-B1 · a device row takes pushCaps and installHash (A60)', () => {
  const ROW = { token: 'ExponentPushToken[invented-row]', platform: 'ios', appVersion: '1.7.1', updatedAt: Date.now() };
  const HASH = 'a'.repeat(64);
  test('the owner registers with both; each alone; a later update of either', async () => {
    await assertSucceeds(owner.ref(`push_tokens/${OWNER}/k`).set({ ...ROW, pushCaps: 1, installHash: HASH }));
    await assertSucceeds(owner.ref(`push_tokens/${OWNER}/k2`).set({ ...ROW, pushCaps: 1 }));
    await assertSucceeds(owner.ref(`push_tokens/${OWNER}/k3`).set(ROW));
    await assertSucceeds(owner.ref(`push_tokens/${OWNER}/k/pushCaps`).set(2));
    await assertSucceeds(owner.ref(`push_tokens/${OWNER}/k/installHash`).set('0123456789abcdef'.repeat(4)));
  });
  test('refused: a malformed hash, a capability out of range, someone else\'s row, any other field', async () => {
    await assertFails(owner.ref(`push_tokens/${OWNER}/k`).set({ ...ROW, installHash: 'not-a-hash' }));
    await assertFails(owner.ref(`push_tokens/${OWNER}/k`).set({ ...ROW, installHash: 'A'.repeat(64) }));
    await assertFails(owner.ref(`push_tokens/${OWNER}/k`).set({ ...ROW, pushCaps: -1 }));
    await assertFails(owner.ref(`push_tokens/${OWNER}/k`).set({ ...ROW, pushCaps: 'yes' }));
    await assertFails(stranger.ref(`push_tokens/${OWNER}/k`).set({ ...ROW, pushCaps: 1 }));
    await assertFails(owner.ref(`push_tokens/${OWNER}/k`).set({ ...ROW, installId: 'the raw id must never be stored' }));
  });
});

describe('P4-B1 · the web\'s writes', () => {
  test('seenAt takes the server\'s timestamp', async () => {
    await assertSucceeds(owner.ref(`inbox_state/${OWNER}`).update({ seenAt: serverTimestamp() }));
    await assertFails(stranger.ref(`inbox_state/${OWNER}`).update({ seenAt: serverTimestamp() }));
  });
  test('359: the Stories switch writes both its fields in one update; the other switches, notify_prefs alone', async () => {
    await seed(env, { [`users/${OWNER}`]: { displayName: 'Invented', username: 'invented' } });
    await assertSucceeds(owner.ref().update({ [`notify_prefs/${OWNER}/stories`]: false, [`users/${OWNER}/storyNotifications`]: false }));
    await assertSucceeds(owner.ref().update({ [`notify_prefs/${OWNER}/replies_mentions`]: true }));
    await assertFails(stranger.ref().update({ [`notify_prefs/${OWNER}/stories`]: true, [`users/${OWNER}/storyNotifications`]: true }));
  });
});
