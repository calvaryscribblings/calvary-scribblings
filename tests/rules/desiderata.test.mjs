// W22 §7 — desiderata/{uid}/{titleId} = { addedAt }. The reader's own list of books marked to
// come back to (rulings 75, 76). Private to its owner; one field; a real title; never dated in
// the future.
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
beforeEach(async () => {
  await env.clearDatabase();
  await seed(env, { 'bookstore_titles/a-title': { title: 'A Title', status: 'published' } });
});

const path = (uid = OWNER, t = 'a-title') => `desiderata/${uid}/${t}`;
const SERVER_NOW = { '.sv': 'timestamp' };

describe('W22 · desiderata — the reader’s own list', () => {
  test('the owner writes, reads and deletes their own entry', async () => {
    await assertSucceeds(owner.ref(path()).set({ addedAt: SERVER_NOW }));
    const snap = await assertSucceeds(owner.ref(`desiderata/${OWNER}`).get());
    assert.equal(typeof snap.val()['a-title'].addedAt, 'number');
    await assertSucceeds(owner.ref(path()).remove());
  });

  test('Undo puts back the ORIGINAL addedAt — a past number is accepted', async () => {
    await assertSucceeds(owner.ref(path()).set({ addedAt: Date.now() - 86_400_000 }));
  });

  test('another reader can neither read nor write it', async () => {
    await seed(env, { [path()]: { addedAt: 1 } });
    await assertFails(stranger.ref(`desiderata/${OWNER}`).get());
    await assertFails(stranger.ref(path()).get());
    await assertFails(stranger.ref(path()).set({ addedAt: SERVER_NOW }));
    await assertFails(stranger.ref(path()).remove());
  });

  test('a guest can neither read nor write it', async () => {
    await seed(env, { [path()]: { addedAt: 1 } });
    await assertFails(anon.ref(`desiderata/${OWNER}`).get());
    await assertFails(anon.ref('desiderata').get());
    await assertFails(anon.ref(path()).set({ addedAt: SERVER_NOW }));
    await assertFails(anon.ref(path()).remove());
  });

  test('a founder is not an exception — only auth.uid === $uid', async () => {
    await seed(env, { [path()]: { addedAt: 1 } });
    await assertFails(founder.ref(`desiderata/${OWNER}`).get());
    await assertFails(founder.ref(path()).set({ addedAt: SERVER_NOW }));
  });

  test('a stray field is refused', async () => {
    await assertFails(owner.ref(path()).set({ addedAt: SERVER_NOW, note: 'x' }));
    await assertFails(owner.ref(path()).set({ note: 'x' }));
  });

  test('a future addedAt is refused, and so is a non-number', async () => {
    await assertFails(owner.ref(path()).set({ addedAt: Date.now() + 3_600_000 }));
    await assertFails(owner.ref(path()).set({ addedAt: 'yesterday' }));
    await assertFails(owner.ref(path()).set(true));
  });

  test('a title that does not exist is refused', async () => {
    await assertFails(owner.ref(path(OWNER, 'no-such-title')).set({ addedAt: SERVER_NOW }));
  });
});
