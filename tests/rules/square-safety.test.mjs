// W53 — Mute and Block in the rules.
//
//   npm run test:rules   (emulator)
//
//   · muted_users/{uid}: a new node, its owner's alone to read or write; each entry is `true`.
//   · blocked_users/{uid}: the existing list Open Pages uses (ruling 209), still owner-only.
//   · A block stops messages EITHER WAY — dm_messages and the other reader's dm_conversations
//     entry — checked by reading both lists inside the rule. No public index of who blocked whom.
//   · A block stops notifications from the blocked reader to the blocker.
//   · A mute never stops messages, and the rules do not see it at all: muting is the reader's own
//     view (the feed, the thread, the notifications panel), applied in the client.

import { test, before, after, beforeEach, describe } from 'node:test';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, STRANGER, OTHER, convIdFor } from './helpers.mjs';

const A = OWNER, B = STRANGER, C = OTHER;
const CONV = convIdFor(A, B);
let env, a, b, c;
before(async () => {
  env = await makeEnv();
  a = env.authenticatedContext(A).database();
  b = env.authenticatedContext(B).database();
  c = env.authenticatedContext(C).database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const msg = (from, text = 'hello') => ({ text, senderUid: from, createdAt: Date.now() });
const notif = (from) => ({ type: 'square_reply', fromUid: from, fromName: 'R', postId: '-p', threadId: '-t', read: false, createdAt: Date.now() });

describe('W53 · messages across a block', () => {
  test('no block: both ways allowed (control)', async () => {
    await assertSucceeds(a.ref(`dm_messages/${CONV}/m1`).set(msg(A)));
    await assertSucceeds(b.ref(`dm_messages/${CONV}/m2`).set(msg(B)));
    await assertSucceeds(b.ref(`dm_conversations/${A}/${CONV}`).update({ unread: 1, lastAt: Date.now() }));
  });

  test('A blocks B: B cannot message A, and A cannot message B', async () => {
    await seed(env, { [`blocked_users/${A}/${B}`]: true });
    await assertFails(b.ref(`dm_messages/${CONV}/m1`).set(msg(B)));
    await assertFails(a.ref(`dm_messages/${CONV}/m2`).set(msg(A)));
  });

  test('…nor touch the other reader\'s conversation entry, either way; your own entry is still yours', async () => {
    await seed(env, { [`blocked_users/${A}/${B}`]: true });
    await assertFails(b.ref(`dm_conversations/${A}/${CONV}`).update({ unread: 1, lastAt: Date.now() }));
    await assertFails(a.ref(`dm_conversations/${B}/${CONV}`).update({ unread: 1, lastAt: Date.now() }));
    await assertSucceeds(b.ref(`dm_conversations/${B}/${CONV}`).update({ unread: 0 }));
    await assertSucceeds(a.ref(`dm_conversations/${A}/${CONV}`).update({ unread: 0 }));
  });

  test('the block is read from the blocked side too (B blocks A)', async () => {
    await seed(env, { [`blocked_users/${B}/${A}`]: true });
    await assertFails(a.ref(`dm_messages/${CONV}/m1`).set(msg(A)));
    await assertFails(b.ref(`dm_messages/${CONV}/m2`).set(msg(B)));
  });

  test('a block between A and B leaves A and C alone', async () => {
    await seed(env, { [`blocked_users/${A}/${B}`]: true });
    const ac = convIdFor(A, C);
    await assertSucceeds(c.ref(`dm_messages/${ac}/m1`).set(msg(C)));
    await assertSucceeds(a.ref(`dm_messages/${ac}/m2`).set(msg(A)));
  });

  test('unblocked: messages flow again', async () => {
    await seed(env, { [`blocked_users/${A}/${B}`]: true });
    await assertFails(b.ref(`dm_messages/${CONV}/m1`).set(msg(B)));
    await assertSucceeds(a.ref(`blocked_users/${A}/${B}`).remove());
    await assertSucceeds(b.ref(`dm_messages/${CONV}/m1`).set(msg(B)));
    await assertSucceeds(a.ref(`dm_messages/${CONV}/m2`).set(msg(A)));
  });

  test('a mute never stops messages', async () => {
    await seed(env, { [`muted_users/${A}/${B}`]: true });
    await assertSucceeds(b.ref(`dm_messages/${CONV}/m1`).set(msg(B)));
    await assertSucceeds(b.ref(`dm_conversations/${A}/${CONV}`).update({ unread: 1 }));
  });
});

describe('W53 · notifications across a block', () => {
  test('a notification from a reader A has blocked is refused', async () => {
    await seed(env, { [`blocked_users/${A}/${B}`]: true });
    await assertFails(b.ref(`notifications/${A}/n1`).push(notif(B)));
  });
  test('from anyone else, and from A to B, still allowed', async () => {
    await seed(env, { [`blocked_users/${A}/${B}`]: true });
    await assertSucceeds(c.ref(`notifications/${A}`).push(notif(C)));
    await assertSucceeds(a.ref(`notifications/${C}`).push(notif(A)));
  });
  test('a reader can still mark their own notifications read', async () => {
    await seed(env, { [`blocked_users/${A}/${B}`]: true, [`notifications/${A}/n0`]: { ...notif(C), read: false } });
    await assertSucceeds(a.ref(`notifications/${A}/n0/read`).set(true));
  });
});

describe('W53 · the lists are their owner\'s alone', () => {
  test('blocked_users: only the owner reads or writes', async () => {
    await seed(env, { [`blocked_users/${A}/${B}`]: true });
    await assertSucceeds(a.ref(`blocked_users/${A}`).get());
    await assertFails(b.ref(`blocked_users/${A}`).get());
    await assertFails(c.ref(`blocked_users/${A}`).get());
    await assertFails(b.ref('blocked_users').get());
    await assertFails(b.ref(`blocked_users/${A}/${C}`).set(true));
    await assertFails(env.unauthenticatedContext().database().ref(`blocked_users/${A}`).get());
  });
  test('muted_users: only the owner reads or writes', async () => {
    await seed(env, { [`muted_users/${A}/${B}`]: true });
    await assertSucceeds(a.ref(`muted_users/${A}`).get());
    await assertFails(b.ref(`muted_users/${A}`).get());
    await assertFails(c.ref(`muted_users/${A}`).get());
    await assertFails(b.ref('muted_users').get());
    await assertFails(b.ref(`muted_users/${A}/${C}`).set(true));
    await assertFails(env.unauthenticatedContext().database().ref(`muted_users/${A}`).get());
  });
  test('muted_users entries are `true` and nothing else; never yourself; unmute deletes', async () => {
    await assertSucceeds(a.ref(`muted_users/${A}/${B}`).set(true));
    await assertFails(a.ref(`muted_users/${A}/${C}`).set(false));
    await assertFails(a.ref(`muted_users/${A}/${C}`).set('yes'));
    await assertFails(a.ref(`muted_users/${A}/${C}`).set({ at: 1 }));
    await assertFails(a.ref(`muted_users/${A}/${A}`).set(true));
    await assertSucceeds(a.ref(`muted_users/${A}/${B}`).remove());
  });
});

// W55.1 / ruling 218 — Mute this conversation. dm_muted/{uid}/{convId} = true, the owner's alone.
// The rules don't read it anywhere else: a muted conversation's messages still arrive, and the
// other reader is never told.
describe('W55.1 · dm_muted', () => {
  test('only the owner reads or writes it', async () => {
    await seed(env, { [`dm_muted/${A}/${CONV}`]: true });
    await assertSucceeds(a.ref(`dm_muted/${A}`).get());
    await assertFails(b.ref(`dm_muted/${A}`).get());
    await assertFails(c.ref(`dm_muted/${A}`).get());
    await assertFails(b.ref('dm_muted').get());
    await assertFails(env.unauthenticatedContext().database().ref(`dm_muted/${A}`).get());
    await assertFails(b.ref(`dm_muted/${A}/${CONV}`).remove());
    await assertFails(b.ref(`dm_muted/${A}/${convIdFor(A, C)}`).set(true));
    await assertFails(env.unauthenticatedContext().database().ref(`dm_muted/${A}/${convIdFor(A, C)}`).set(true));
  });
  test('true and nothing else; only a conversation of yours; unmute deletes', async () => {
    await assertSucceeds(a.ref(`dm_muted/${A}/${CONV}`).set(true));
    for (const v of [false, 'yes', 1, { at: 1 }]) await assertFails(a.ref(`dm_muted/${A}/${convIdFor(A, C)}`).set(v));
    await assertFails(a.ref(`dm_muted/${A}`).set(true));                       // not a bare value at the top
    await assertFails(a.ref(`dm_muted/${A}/${convIdFor(B, C)}`).set(true));   // someone else's conversation
    await assertFails(a.ref(`dm_muted/${A}/x${A}_y`).set(true));
    await assertSucceeds(a.ref(`dm_muted/${A}`).update({ [convIdFor(A, C)]: true }));
    await assertSucceeds(a.ref(`dm_muted/${A}/${CONV}`).remove());
  });
  test('a muted conversation still takes messages both ways (the rules never read the mute)', async () => {
    await seed(env, { [`dm_muted/${A}/${CONV}`]: true });
    await assertSucceeds(b.ref(`dm_messages/${CONV}/m1`).set(msg(B)));
    await assertSucceeds(b.ref(`dm_conversations/${A}/${CONV}`).update({ unread: 1, lastAt: Date.now() }));
    await assertSucceeds(a.ref(`dm_messages/${CONV}/m2`).set(msg(A)));
  });
});
