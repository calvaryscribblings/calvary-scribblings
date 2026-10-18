// W54 — the Square's write Function, as the rules see it.
//
//   npm run test:rules   (emulator)
//
//   · square_rate/{uid} — the pace counter (ruling 211) — is the Function's alone: no client can
//     read or write it, the owner and the founders included.
//   · NOTHING ELSE TIGHTENS IN W54. The app keeps writing square_posts directly until A44, so a
//     direct post, reply and edit by its author still pass here, and so do reactions. W55 closes
//     the direct path; when it does, these "still allowed" cases are the ones it must flip.

import { test, before, after, beforeEach, describe } from 'node:test';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, STRANGER, FOUNDER_A as FOUNDER } from './helpers.mjs';

let env, owner, stranger, founder, anon;
before(async () => {
  env = await makeEnv();
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
  founder = env.authenticatedContext(FOUNDER).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

describe('W54 · square_rate', () => {
  test('unreachable from every client, in either direction', async () => {
    await seed(env, { [`square_rate/${OWNER}`]: { post: [1, 2], reply: [3] } });
    for (const db of [owner, stranger, founder, anon]) {
      await assertFails(db.ref(`square_rate/${OWNER}`).get());
      await assertFails(db.ref(`square_rate/${OWNER}`).set(null));
      await assertFails(db.ref(`square_rate/${OWNER}/post`).set([]));
      await assertFails(db.ref('square_rate').get());
    }
    await assertFails(owner.ref(`square_rate/${OWNER}`).set({ post: [] }));
  });
});

describe('W54 · the direct path stays open until W55 (the app still uses it)', () => {
  const rec = (over = {}) => ({ text: 'hello', authorUid: OWNER, authorName: 'Reader', createdAt: Date.now(), ...over });
  test('a direct post, reply and edit by the author still pass', async () => {
    await seed(env, { [`users/${OWNER}`]: { displayName: 'Reader' } });
    await assertSucceeds(owner.ref('square_posts/-p1').set(rec()));
    await assertSucceeds(owner.ref('square_posts/-r1').set(rec({ text: 'a reply', parentId: '-p1' })));
    await assertSucceeds(owner.ref('square_posts/-p1').update({ text: 'edited', edited: true }));
  });
  test('reactions stay direct writes, each reader’s own leaf', async () => {
    await seed(env, { 'square_posts/-p1': rec() });
    await assertSucceeds(stranger.ref(`square_reactions/-p1/like/${STRANGER}`).set(true));
    await assertFails(stranger.ref(`square_reactions/-p1/like/${OWNER}`).set(true));
  });
});
