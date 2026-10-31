// RULING 261 — ops/editor_alerts: the alert service's write-once record. Server-written, founder-read.
//
// Each record is what makes an alert send ONCE (functions/api/_alerts.js claims it before it
// mails). So no client may write one — a forged record would SILENCE a real alert, and a deleted
// one would let it send twice. Founders read it (to see what was raised and whether it went); no
// one else does.
import { test, before, after, beforeEach, describe } from 'node:test';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, STRANGER, FOUNDER_A, FOUNDER_B } from './helpers.mjs';

const P = 'ops/editor_alerts';
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
  await seed(env, { [`${P}/duplicate_payment/0123abcd`]: { kind: 'duplicate_payment', subject: '[alert] Paid twice', raisedAt: 1, sent: true } });
});

describe('261 · ops/editor_alerts', () => {
  test('LEGITIMATE: both founders read what was raised', async () => {
    await assertSucceeds(founderA.ref(P).get());
    await assertSucceeds(founderB.ref(`${P}/duplicate_payment/0123abcd`).get());
  });
  test('a reader, a stranger and a signed-out visitor cannot read it', async () => {
    await assertFails(owner.ref(P).get());
    await assertFails(stranger.ref(`${P}/duplicate_payment`).get());
    await assertFails(anon.ref(P).get());
  });
  test('nobody writes it from a client, founders included: no forged claim to silence an alert, no delete to resend one', async () => {
    await assertFails(founderA.ref(`${P}/duplicate_payment/ffff0000`).set({ kind: 'duplicate_payment', sent: true }));
    await assertFails(founderB.ref(`${P}/duplicate_payment/0123abcd`).remove());
    await assertFails(owner.ref(`${P}/duplicate_payment/ffff0000`).set({ sent: true }));
    await assertFails(anon.ref(`${P}/x/y`).set({ sent: true }));
  });
});
