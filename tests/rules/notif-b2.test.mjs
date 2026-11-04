// NOTIF-B2 — the rules the bell stands on.
//
//   npm run test:rules   (emulator)
//
// announcements: every signed-in reader reads it, nobody writes it (the announcer is an Admin SDK);
// the bell's bounded queries (newest N by `at` / `createdAt`) are allowed and indexed; opening the
// list writes seenAt; the old notes can still be marked read by their owner; the settings switches
// write notify_prefs and nothing else.
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
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

const now = () => Date.now();

describe('NOTIF-B2 P3 · announcements/{id}', () => {
  test('every signed-in reader reads the newest N; a signed-out visitor does not', async () => {
    await seed(env, { 'announcements/story_a': { kind: 'story', id: 'a', at: 1 }, 'announcements/story_b': { kind: 'story', id: 'b', at: 2 } });
    const snap = await assertSucceeds(owner.ref('announcements').orderByChild('at').limitToLast(30).get());
    assert.deepEqual(Object.keys(snap.val()).sort(), ['story_a', 'story_b']);
    await assertSucceeds(stranger.ref('announcements').orderByChild('at').limitToLast(1).get());
    await assertFails(anon.ref('announcements').get());
  });
  test('no client writes one, founders included: a forged "new story" cannot reach every bell', async () => {
    const forged = { kind: 'story', id: 'fake', at: now() };
    await assertFails(owner.ref('announcements/story_fake').set(forged));
    await assertFails(stranger.ref('announcements/story_fake').set(forged));
    await assertFails(founder.ref('announcements/story_fake').set(forged));
    await seed(env, { 'announcements/story_a': { kind: 'story', id: 'a', at: 1 } });
    await assertFails(founder.ref('announcements/story_a').remove());
    await assertFails(owner.ref('announcements/story_a/at').set(now()));
  });
});

describe('NOTIF-B2 · the bell\'s bounded reads', () => {
  test('inbox: its owner reads the newest N by `at`; nobody else', async () => {
    await seed(env, { [`inbox/${OWNER}/a`]: { kind: 'follow', actor: STRANGER, subject: { uid: STRANGER }, at: 1 } });
    await assertSucceeds(owner.ref(`inbox/${OWNER}`).orderByChild('at').limitToLast(60).get());
    await assertFails(stranger.ref(`inbox/${OWNER}`).orderByChild('at').limitToLast(60).get());
  });
  test('the two old inboxes: their owner reads the newest N by createdAt', async () => {
    for (const node of ['library_notifications', 'notifications']) {
      await seed(env, { [`${node}/${OWNER}/n1`]: { type: 'follow', fromUid: STRANGER, read: false, createdAt: 1 } });
      await assertSucceeds(owner.ref(`${node}/${OWNER}`).orderByChild('createdAt').limitToLast(60).get());
      await assertFails(stranger.ref(`${node}/${OWNER}`).orderByChild('createdAt').limitToLast(60).get());
    }
  });
  test('following: the reader\'s own list, bounded (FROM A WRITER YOU FOLLOW)', async () => {
    await seed(env, { [`following/${OWNER}/${STRANGER}`]: true });
    await assertSucceeds(owner.ref(`following/${OWNER}`).limitToFirst(1000).get());
  });
});

describe('NOTIF-B2 · opening the list', () => {
  test('seenAt: the owner sets it to now; never into the future; nobody else', async () => {
    await assertSucceeds(owner.ref(`inbox_state/${OWNER}`).update({ seenAt: now() }));
    await assertFails(owner.ref(`inbox_state/${OWNER}`).update({ seenAt: now() + 86400000 }));
    await assertFails(stranger.ref(`inbox_state/${OWNER}`).update({ seenAt: now() }));
    await assertFails(stranger.ref(`inbox_state/${OWNER}/seenAt`).get());
  });
  test('the old notes on screen are marked read by their owner, in one update per node, as the old panels did', async () => {
    await seed(env, {
      [`library_notifications/${OWNER}/a`]: { type: 'reply', fromUid: STRANGER, read: false, createdAt: 1 },
      [`library_notifications/${OWNER}/b`]: { type: 'reward', fromName: 'Calvary Scribblings', message: 'm', read: false, createdAt: 2 },
      [`notifications/${OWNER}/c`]: { type: 'mention', fromUid: STRANGER, postId: 'p', read: false, createdAt: 3, nid: 'mention:sq:p' },
    });
    await assertSucceeds(owner.ref(`library_notifications/${OWNER}`).update({ 'a/read': true, 'b/read': true }));
    await assertSucceeds(owner.ref(`notifications/${OWNER}`).update({ 'c/read': true }));
    await assertFails(stranger.ref(`notifications/${OWNER}`).update({ 'c/read': true }));
  });
});

describe('NOTIF-B2 · Push notifications settings (ruling 312)', () => {
  test('each switch is a boolean the owner writes; nothing else lands', async () => {
    for (const k of ['stories', 'replies_mentions', 'messages', 'followers', 'reactions', 'responses', 'open_pages', 'square_opens']) {
      await assertSucceeds(owner.ref(`notify_prefs/${OWNER}/${k}`).set(false));
      await assertSucceeds(owner.ref(`notify_prefs/${OWNER}/${k}`).set(true));
    }
    await assertFails(owner.ref(`notify_prefs/${OWNER}/stories`).set('off'));
    await assertFails(owner.ref(`notify_prefs/${OWNER}/everything`).set(false));
    await assertFails(stranger.ref(`notify_prefs/${OWNER}/stories`).set(false));
  });
});
