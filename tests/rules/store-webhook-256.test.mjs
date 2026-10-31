// RULING 256 — bookstore_duplicate_payments: server-written, founder-read, never the reader's.
//
// A second payment for a copy the reader already owns is filed here by the webhooks (Admin SDK,
// which the rules do not bind) for Ikenna to refund by hand. It names payment references and the
// reader's uid, so no client may read it but the two founders, and no client writes it at all —
// founders included: a refund is recorded by the provider's webhook, never by a hand in /admin.
import { test, before, after, beforeEach, describe } from 'node:test';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, STRANGER, FOUNDER_A, FOUNDER_B } from './helpers.mjs';

const P = 'bookstore_duplicate_payments';
let env, founderA, founderB, owner, stranger, anon;
before(async () => {
  env = await makeEnv();
  founderA = env.authenticatedContext(FOUNDER_A).database();
  founderB = env.authenticatedContext(FOUNDER_B).database();
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await seed(env, {
    [`${P}/${OWNER}/a-title/stripe_cs_test_dup`]: { rail: 'stripe', uid: OWNER, titleId: 'a-title', amount: 999, currency: 'GBP', refs: { stripeSessionId: 'cs_test_dup' }, receivedAt: 1, status: 'open' },
  });
});

describe('256 · bookstore_duplicate_payments', () => {
  test('LEGITIMATE: both founders read the whole node, as /admin does', async () => {
    await assertSucceeds(founderA.ref(P).get());
    await assertSucceeds(founderB.ref(P).get());
  });
  test('the reader whose payment it is cannot read it, not the node and not their own entry', async () => {
    await assertFails(owner.ref(P).get());
    await assertFails(owner.ref(`${P}/${OWNER}`).get());
    await assertFails(owner.ref(`${P}/${OWNER}/a-title/stripe_cs_test_dup`).get());
  });
  test('a stranger and a signed-out visitor (the storefront) cannot read it', async () => {
    await assertFails(stranger.ref(`${P}/${OWNER}`).get());
    await assertFails(anon.ref(P).get());
  });
  test('nobody writes it from a client, founders included: no filing, no marking, no dismissing', async () => {
    await assertFails(founderA.ref(`${P}/${OWNER}/a-title/stripe_cs_test_dup/status`).set('refunded'));
    await assertFails(founderB.ref(`${P}/${OWNER}/a-title/stripe_cs_test_dup`).remove());
    await assertFails(owner.ref(`${P}/${OWNER}/a-title/stripe_cs_test_forged`).set({ status: 'open' }));
    await assertFails(owner.ref(`${P}/${OWNER}`).remove());
    await assertFails(anon.ref(`${P}/x/y/z`).set({ status: 'open' }));
  });
});
