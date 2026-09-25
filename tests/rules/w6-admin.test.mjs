// W6 · the two nodes the admin now reads.
//
//   newsletter_sends     the archive of sent issues (and, since W6, who a partial send missed).
//                        It had NO rule, so the admin's History tab was denied for every account
//                        and the swallowed denial read as "No newsletters sent yet." Founders read;
//                        nobody writes from a client (the Worker writes with its own secret).
//   ops/publish_skips    the scheduled publisher's "not published — no cover" alerts. Founders
//                        read, and may dismiss (delete) one; nobody can write or forge one.

import { test, before, after, beforeEach, describe } from 'node:test';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, FOUNDER_A, FOUNDER_B } from './helpers.mjs';

let env, founderA, founderB, reader, anon;
before(async () => {
  env = await makeEnv();
  founderA = env.authenticatedContext(FOUNDER_A).database();
  founderB = env.authenticatedContext(FOUNDER_B).database();
  reader = env.authenticatedContext(OWNER).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await seed(env, {
    'newsletter_sends/-P1': { subject: 'Issue 9', recipientCount: 55, failedRecipients: ['a@x.test'] },
    'ops/publish_skips/phantom': { slug: 'phantom', reason: 'held_for_cover', at: 1 },
  });
});

describe('W6 · newsletter_sends', () => {
  test('LEGITIMATE: both founders read the history', async () => {
    await assertSucceeds(founderA.ref('newsletter_sends').get());
    await assertSucceeds(founderB.ref('newsletter_sends').get());
  });
  test('a reader or a stranger cannot read it (it holds subscriber addresses)', async () => {
    await assertFails(reader.ref('newsletter_sends').get());
    await assertFails(anon.ref('newsletter_sends/-P1').get());
  });
  test('nobody writes it from a client, founders included', async () => {
    await assertFails(founderA.ref('newsletter_sends/-P2').set({ subject: 'forged' }));
    await assertFails(reader.ref('newsletter_sends/-P1/failedRecipients').set(null));
  });
});

describe('W6 · ops/publish_skips', () => {
  test('LEGITIMATE: a founder reads the alerts and dismisses one', async () => {
    await assertSucceeds(founderA.ref('ops/publish_skips').get());
    await assertSucceeds(founderA.ref('ops/publish_skips/phantom').remove());
  });
  test('nobody can raise or alter an alert from a client', async () => {
    await assertFails(founderA.ref('ops/publish_skips/other').set({ slug: 'other' }));
    await assertFails(founderA.ref('ops/publish_skips/phantom/reason').set('x'));
  });
  test('a reader can neither read nor dismiss one', async () => {
    await assertFails(reader.ref('ops/publish_skips').get());
    await assertFails(reader.ref('ops/publish_skips/phantom').remove());
  });
});
