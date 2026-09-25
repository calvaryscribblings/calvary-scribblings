// W4b · founder_preview/{uid} — the founder preview, on the account.
//
// The flag the story endpoints read for a founder (app/lib/gatePreviewPolicy.js). Only that founder
// may read or write their own flag; the only value is `true` (off is the node's absence); nobody
// else can read it, write it, or plant one on a founder.

import { test, before, after, beforeEach, describe } from 'node:test';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, FOUNDER_A, FOUNDER_B } from './helpers.mjs';
import { founderPreviewPath } from '../../app/lib/gatePreviewPolicy.js';

let env, founderA, founderB, reader, anon;
before(async () => {
  env = await makeEnv();
  founderA = env.authenticatedContext(FOUNDER_A).database();
  founderB = env.authenticatedContext(FOUNDER_B).database();
  reader = env.authenticatedContext(OWNER).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

describe('W4b · founder_preview — the founder alone, and only ever true', () => {
  test('LEGITIMATE: a founder turns their own preview on, reads it, and turns it off', async () => {
    await assertSucceeds(founderA.ref(founderPreviewPath(FOUNDER_A)).set(true));
    await assertSucceeds(founderA.ref(founderPreviewPath(FOUNDER_A)).get());
    await assertSucceeds(founderA.ref(founderPreviewPath(FOUNDER_A)).remove());
  });

  test('the only value is true', async () => {
    await assertFails(founderA.ref(founderPreviewPath(FOUNDER_A)).set(false));
    await assertFails(founderA.ref(founderPreviewPath(FOUNDER_A)).set('1'));
    await assertFails(founderA.ref(founderPreviewPath(FOUNDER_A)).set({ on: true }));
  });

  test('a founder cannot touch the other founder\'s flag', async () => {
    await seed(env, { [founderPreviewPath(FOUNDER_B)]: true });
    await assertFails(founderA.ref(founderPreviewPath(FOUNDER_B)).get());
    await assertFails(founderA.ref(founderPreviewPath(FOUNDER_B)).remove());
    await assertSucceeds(founderB.ref(founderPreviewPath(FOUNDER_B)).get());
  });

  test('a reader cannot give themselves one, or plant one on a founder', async () => {
    await assertFails(reader.ref(founderPreviewPath(OWNER)).set(true));
    await assertFails(reader.ref(founderPreviewPath(FOUNDER_A)).set(true));
    await assertFails(anon.ref(founderPreviewPath(FOUNDER_A)).set(true));
  });

  test('nobody else can read a founder\'s flag, or list the node', async () => {
    await seed(env, { [founderPreviewPath(FOUNDER_A)]: true });
    await assertFails(reader.ref(founderPreviewPath(FOUNDER_A)).get());
    await assertFails(anon.ref(founderPreviewPath(FOUNDER_A)).get());
    await assertFails(reader.ref('founder_preview').get());
    await assertFails(founderA.ref('founder_preview').get());
  });
});
