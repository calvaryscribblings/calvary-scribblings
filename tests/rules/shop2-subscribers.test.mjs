// SHOP-2 §3 — subscribers: a visitor may add a new entry, never change or read an existing one.
//
// `subscribers/$entry .write: "newData.exists()"` (Part D, 456bf90) closed the wipe of the whole
// list but left every entry open to overwrite by anyone, signed out: a stranger who learned a key
// could rewrite a subscriber's address, or unsubscribe them. Today's writers, read before the change:
//   · sign-up:     the calvary-newsletter Worker's /subscribe POSTs a new push id, with the database
//                  secret (rules not evaluated);
//   · unsubscribe: the same Worker PATCHes subscribers/<key>/status with the secret;
//   · deletion:    /api/account/delete and scripts/account/scrub.mjs null the entry with an admin
//                  token (rules not evaluated);
//   · /admin/newsletter only reads, as a founder.
// So the one write a rule still has to allow is a visitor creating an entry that does not exist.
import { test, before, after, beforeEach, describe } from 'node:test';
import { makeEnv, seed, assertFails, assertSucceeds, STRANGER, FOUNDER_A, FOUNDER_B } from './helpers.mjs';

const P = 'subscribers';
const ROW = { email: 'reader@example.com', name: 'A Reader', status: 'active', subscribedAt: '2026-11-18T22:00:00.000Z' };
let env, founderA, founderB, stranger, anon;
before(async () => {
  env = await makeEnv();
  founderA = env.authenticatedContext(FOUNDER_A).database();
  founderB = env.authenticatedContext(FOUNDER_B).database();
  stranger = env.authenticatedContext(STRANGER).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await seed(env, { [`${P}/-Nexisting0000000001`]: ROW });
});

describe('SHOP-2 §3 · subscribers', () => {
  test('LEGITIMATE: a signed-out visitor adds a new entry (a push id), full or legacy shape', async () => {
    await assertSucceeds(anon.ref(P).push({ ...ROW, email: 'new@example.com' }));
    await assertSucceeds(anon.ref(`${P}/-Nnew00000000000000002`).set({ email: 'b@example.com', subscribedAt: '2026-11-18T22:00:00.000Z' }));
    await assertSucceeds(stranger.ref(P).push({ ...ROW, email: 'c@example.com' }));
  });
  test('LEGITIMATE: both founders read the list, as /admin/newsletter does', async () => {
    await assertSucceeds(founderA.ref(P).get());
    await assertSucceeds(founderB.ref(P).get());
  });
  test('a signed-out visitor cannot overwrite an existing entry', async () => {
    await assertFails(anon.ref(`${P}/-Nexisting0000000001`).set({ ...ROW, email: 'attacker@example.com' }));
  });
  test('a signed-out visitor cannot change one field of an existing entry (unsubscribe someone, change their address)', async () => {
    await assertFails(anon.ref(`${P}/-Nexisting0000000001/status`).set('unsubscribed'));
    await assertFails(anon.ref(`${P}/-Nexisting0000000001/email`).set('attacker@example.com'));
    await assertFails(anon.ref(`${P}/-Nexisting0000000001`).update({ status: 'unsubscribed' }));
  });
  test('a signed-in stranger cannot overwrite or change one either', async () => {
    await assertFails(stranger.ref(`${P}/-Nexisting0000000001`).set({ ...ROW, email: 'attacker@example.com' }));
    await assertFails(stranger.ref(`${P}/-Nexisting0000000001/status`).set('unsubscribed'));
  });
  test('nobody but a founder reads: not the list, not an entry, not a field', async () => {
    for (const db of [anon, stranger]) {
      await assertFails(db.ref(P).get());
      await assertFails(db.ref(`${P}/-Nexisting0000000001`).get());
      await assertFails(db.ref(`${P}/-Nexisting0000000001/email`).get());
    }
  });
  test('still closed: no wipe of the list or of an entry, no unknown field, no update that touches an existing entry', async () => {
    await assertFails(anon.ref(P).set(null));
    await assertFails(anon.ref(`${P}/-Nexisting0000000001`).remove());
    await assertFails(anon.ref(`${P}/-Nnew00000000000000003`).set({ ...ROW, source: 'x' }));
    await assertFails(anon.ref(P).update({ '-Nnew00000000000000004': ROW, '-Nexisting0000000001': { ...ROW, email: 'attacker@example.com' } }));
  });
});
