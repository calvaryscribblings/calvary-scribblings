// SHOP-B1 — the paperback shop's two nodes (docs/ACCOUNT-CONTRACT.md §6.2).
//
//   print_orders/$uid/$orderNo    its owner reads it; NO client writes it, founders included
//   shop_handoff_codes/$sha256    no client reads or writes it
//
// Every actor: the owner, another reader, signed out, a founder. List reads of both parent nodes
// included. Only the server (the B2/B3 Functions, holding the service account's OAuth token)
// writes either node, and that token is not bound by these rules at all: see §6.2.
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, seed, assertFails, assertSucceeds, OWNER, STRANGER, FOUNDER_A, FOUNDER_B } from './helpers.mjs';

let env, owner, stranger, founderA, founderB, anon;
const ORDER = 'CS-7KQ2MX';
const HASH = 'a'.repeat(64);
const order = { date: 1_795_000_000_000, titles: { 0: { title: 'A Book', copies: 1 } }, amount: { minor: 1299, currency: 'GBP' }, filedAt: 1_795_000_000_001 };

before(async () => {
  env = await makeEnv();
  owner = env.authenticatedContext(OWNER).database();
  stranger = env.authenticatedContext(STRANGER).database();
  founderA = env.authenticatedContext(FOUNDER_A).database();
  founderB = env.authenticatedContext(FOUNDER_B).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await seed(env, {
    [`print_orders/${OWNER}/${ORDER}`]: order,
    [`print_orders/${STRANGER}/CS-ZZZZ99`]: order,
    [`shop_handoff_codes/${HASH}`]: { uid: OWNER, exp: Date.now() + 300_000 },
  });
});

const writes = (db, path, value) => [
  db.ref(path).set(value),
  db.ref(path).update({ filedAt: 2 }),
  db.ref(path).remove(),
];

describe('SHOP-B1 · print_orders — the owner reads; no client writes', () => {
  test('the owner reads their list and each order', async () => {
    const list = await assertSucceeds(owner.ref(`print_orders/${OWNER}`).get());
    assert.deepEqual(Object.keys(list.val()), [ORDER]);
    await assertSucceeds(owner.ref(`print_orders/${OWNER}/${ORDER}`).get());
  });

  test('the owner cannot write, change or delete an order, nor add one', async () => {
    for (const p of writes(owner, `print_orders/${OWNER}/${ORDER}`, order)) await assertFails(p);
    await assertFails(owner.ref(`print_orders/${OWNER}/CS-NEW001`).set(order));
    await assertFails(owner.ref(`print_orders/${OWNER}`).remove());
    await assertFails(owner.ref(`print_orders/${OWNER}`).set({ [ORDER]: order }));
  });

  test('another reader can neither read nor write it', async () => {
    await assertFails(stranger.ref(`print_orders/${OWNER}`).get());
    await assertFails(stranger.ref(`print_orders/${OWNER}/${ORDER}`).get());
    for (const p of writes(stranger, `print_orders/${OWNER}/${ORDER}`, order)) await assertFails(p);
    await assertFails(stranger.ref(`print_orders/${OWNER}/CS-NEW001`).set(order));
  });

  test('signed out: no read, no write', async () => {
    await assertFails(anon.ref(`print_orders/${OWNER}`).get());
    await assertFails(anon.ref(`print_orders/${OWNER}/${ORDER}`).get());
    for (const p of writes(anon, `print_orders/${OWNER}/${ORDER}`, order)) await assertFails(p);
  });

  test('a founder is not an exception: no client read of another reader\'s orders, no write at all', async () => {
    for (const f of [founderA, founderB]) {
      await assertFails(f.ref(`print_orders/${OWNER}`).get());
      await assertFails(f.ref(`print_orders/${OWNER}/${ORDER}`).get());
      for (const p of writes(f, `print_orders/${OWNER}/${ORDER}`, order)) await assertFails(p);
      await assertFails(f.ref(`print_orders/${OWNER}/CS-NEW001`).set(order));
    }
  });

  test('a founder cannot write their OWN orders either (founders hold no grant here)', async () => {
    await seed(env, { [`print_orders/${FOUNDER_A}/${ORDER}`]: order });
    await assertSucceeds(founderA.ref(`print_orders/${FOUNDER_A}`).get());
    for (const p of writes(founderA, `print_orders/${FOUNDER_A}/${ORDER}`, order)) await assertFails(p);
  });

  test('the list of every reader\'s orders is unreadable to everyone', async () => {
    for (const db of [owner, stranger, anon, founderA, founderB]) {
      await assertFails(db.ref('print_orders').get());
      await assertFails(db.ref('print_orders').orderByKey().limitToFirst(1).get());
      await assertFails(db.ref('print_orders').set(null));
      await assertFails(db.ref('print_orders').update({ [`${OWNER}/${ORDER}`]: null }));
    }
  });
});

describe('SHOP-B1 · shop_handoff_codes — no client reads or writes', () => {
  test('no actor reads a code, or the list of codes', async () => {
    for (const db of [owner, stranger, anon, founderA, founderB]) {
      await assertFails(db.ref(`shop_handoff_codes/${HASH}`).get());
      await assertFails(db.ref(`shop_handoff_codes/${HASH}/uid`).get());
      await assertFails(db.ref('shop_handoff_codes').get());
      await assertFails(db.ref('shop_handoff_codes').orderByChild('uid').equalTo(OWNER).get());
    }
  });

  test('no actor mints, changes or deletes a code, the owner of its uid included', async () => {
    for (const db of [owner, stranger, anon, founderA, founderB]) {
      await assertFails(db.ref(`shop_handoff_codes/${'b'.repeat(64)}`).set({ uid: OWNER, exp: Date.now() + 300_000 }));
      await assertFails(db.ref(`shop_handoff_codes/${HASH}`).update({ exp: Date.now() + 3_600_000 }));
      await assertFails(db.ref(`shop_handoff_codes/${HASH}`).remove());
      await assertFails(db.ref('shop_handoff_codes').set(null));
    }
  });
});
