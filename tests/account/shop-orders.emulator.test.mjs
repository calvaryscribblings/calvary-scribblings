// SHOP-B3 — the filing call against the database emulator, over the same REST the Function uses
// (restIo: reads with X-Firebase-ETag, writes with if-match). Proves what the unit half's memory
// database stands in for: RTDB's own ETag answers, including on an absent location; the exact
// records; the retry; the account deletion; both sweeps; and that no client reaches the new index.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { handleShopOrders, restIo } from '../../functions/api/account/shop-orders.js';
import { signedBytes, SHOP_ORDERS_PATH, HEADERS } from '../../functions/api/account/_shop-orders.js';
import { runDeletion, realIo } from '../../functions/api/account/_deletion.js';
import { runCodeSweep, runTestOrderSweep } from '../../scripts/account/scrub.mjs';
import { TEST_ORDER_TTL_MS, USED_MARKER_TTL_MS } from '../../app/lib/shopOrders.js';

process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= '127.0.0.1:9000';
const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const NS = 'demo-calvary-account-default-rtdb';
assert.match(`http://${HOST}?ns=${NS}`, /^http:\/\/(127\.0\.0\.1|localhost):\d+\?ns=demo-/, 'refusing to run anywhere but the emulator');

const EX = JSON.parse(readFileSync(new URL('./fixtures/shop-example.json', import.meta.url), 'utf8'));
const KEYS = [{ id: EX.keyId, raw: EX.publicKeyRaw }];
const PRIV = createPrivateKey(EX.privateKeyPkcs8Pem);
const UID = 'SHOPbuyer000000000000000000001';
const OTHER = 'SHOPother00000000000000000002';
const NOW = Number(EX.timestamp) * 1000;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const C1 = 'q8Zr3vY1mXc0Lw9tB2nK5sJ7hD4fG6aP-eU_iO0yR1Q';
const C2 = 'Y'.repeat(43);
const C3 = 'X'.repeat(43);
const ENV = { FIREBASE_DATABASE_URL: `http://${HOST}` };

const realFetch = globalThis.fetch;
let app, db;
before(async () => {
  app = initializeApp({ projectId: 'demo-calvary-account', databaseURL: `http://${HOST}?ns=${NS}` }, 'shop-b3');
  db = getDatabase(app);
  globalThis.fetch = (url, opts) => {
    const u = String(url);
    if (u.startsWith(`http://${HOST}/`)) return realFetch(`${u}${u.includes('?') ? '&' : '?'}ns=${NS}`, opts);
    throw new Error(`unexpected fetch ${u}`);
  };
});
after(async () => { globalThis.fetch = realFetch; await deleteApp(app); });

const order = (o = {}) => ({ orderNo: 'CS-7KQ2MX', paidAt: '2026-11-25T09:59:12Z', titles: ['after-the-fact'], copies: 2, amount: { value: 1500000, currency: 'NGN' }, test: true, ...o });
async function file(code, o = order(), { nowMs = NOW } = {}) {
  const body = JSON.stringify({ code, order: o });
  const ts = String(Math.floor(nowMs / 1000));
  const sig = sign(null, Buffer.from(signedBytes({ keyId: EX.keyId, timestamp: ts, method: 'POST', path: SHOP_ORDERS_PATH, body: new TextEncoder().encode(body) })), PRIV).toString('base64url');
  const request = new Request(`https://calvaryscribblings.co.uk${SHOP_ORDERS_PATH}`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', [HEADERS.keyId]: EX.keyId, [HEADERS.timestamp]: ts, [HEADERS.signature]: sig },
  });
  const res = await handleShopOrders({ request, env: ENV, waitUntil() {} }, {
    nowMs: () => nowMs, keys: KEYS, consume: async () => ({ ok: true }), io: restIo(ENV, 'owner'),
  });
  return (await res.json()).result;
}
const val = async (p) => (await (p ? db.ref(p) : db.ref()).get()).val();

test('filed over REST: the exact order, the used marker in place of the code, the index; a retry is already_filed', async () => {
  await db.ref().set({ shop_handoff_codes: { [sha(C1)]: { uid: UID, exp: NOW + 60_000 } }, users: { [UID]: { handle: 'buyer' } } });
  assert.equal(await file(C1), 'filed');
  assert.deepEqual(await val(`print_orders/${UID}/CS-7KQ2MX`), {
    orderNo: 'CS-7KQ2MX', paidAt: Date.UTC(2026, 10, 25, 9, 59, 12), titles: ['after-the-fact'], copies: 2,
    amount: { value: 1500000, currency: 'NGN' }, test: true, filedAt: NOW,
  });
  assert.deepEqual(await val(`shop_handoff_codes/${sha(C1)}`), { uid: UID, exp: NOW + 60_000, used: true, orderNo: 'CS-7KQ2MX', usedAt: NOW });
  assert.equal(await val('print_order_index/CS-7KQ2MX'), UID);
  const before = await val('');
  assert.equal(await file(C1, order(), { nowMs: NOW + 10 * 60_000 }), 'already_filed', 'the retry after a lost reply, past the code\'s 5 minutes');
  assert.deepEqual(await val(''), before, 'nothing rewritten');
  assert.equal(await file(C1, order({ orderNo: 'CS-OTHER1' })), 'code_used_for_another_order');
});

test('another account cannot take the order; extra fields never reach the database', async () => {
  await db.ref(`shop_handoff_codes/${sha(C2)}`).set({ uid: OTHER, exp: NOW + 60_000 });
  assert.equal(await file(C2), 'order_in_another_account');
  assert.deepEqual(await val(`shop_handoff_codes/${sha(C2)}`), { uid: OTHER, exp: NOW + 60_000 }, 'its code is still unused');
  assert.equal(await val(`print_orders/${OTHER}`), null);
  const before = await val('');
  assert.equal(await file(C2, { ...order({ orderNo: 'CS-EXTRA1' }), address: '1 Somewhere Road', email: 'x@example.com' }), 'bad_request');
  assert.deepEqual(await val(''), before);
});

test('code_expired and code_unknown write nothing; a real order is not_open_yet and leaves its code unused', async () => {
  await db.ref(`shop_handoff_codes/${sha(C3)}`).set({ uid: OTHER, exp: NOW });
  const before = await val('');
  assert.equal(await file(C3, order({ orderNo: 'CS-EXPIR1' })), 'code_expired');
  assert.equal(await file('W'.repeat(43), order({ orderNo: 'CS-UNKNW1' })), 'code_unknown');
  await db.ref(`shop_handoff_codes/${sha(C3)}`).set({ uid: OTHER, exp: NOW + 60_000 });
  assert.equal(await file(C3, order({ orderNo: 'CS-REAL01', test: false })), 'not_open_yet');
  assert.deepEqual(await val(`shop_handoff_codes/${sha(C3)}`), { uid: OTHER, exp: NOW + 60_000 });
  await db.ref(`shop_handoff_codes/${sha(C3)}`).set({ uid: OTHER, exp: NOW });
  assert.deepEqual(await val(''), before);
});

test('the sweeps: a used marker after 24 hours, test orders after 7 days with their index entries', async () => {
  // Day 2: the marker (usedAt NOW) goes; the expired unused code goes; the live one stays.
  await db.ref(`shop_handoff_codes/${sha('L'.repeat(43))}`).set({ uid: OTHER, exp: NOW + 2 * USED_MARKER_TTL_MS });
  let c = await runCodeSweep(db, { apply: true, now: () => NOW + USED_MARKER_TTL_MS - 1 });
  assert.equal(c.usedRemoved, 0);
  assert.ok(await val(`shop_handoff_codes/${sha(C1)}`), 'a marker under 24 hours stays');
  c = await runCodeSweep(db, { apply: true, now: () => NOW + USED_MARKER_TTL_MS });
  assert.equal(c.usedRemoved, 1);
  assert.equal(await val(`shop_handoff_codes/${sha(C1)}`), null);
  assert.ok(await val(`shop_handoff_codes/${sha('L'.repeat(43))}`));
  // A real order filed under the same account (as the switch would allow) is never swept.
  await db.ref(`print_orders/${UID}/CS-REAL02`).set({ orderNo: 'CS-REAL02', test: false, filedAt: 0 });
  let t = await runTestOrderSweep(db, { apply: true, now: () => NOW + TEST_ORDER_TTL_MS - 1 });
  assert.deepEqual(t, { removed: 0, wouldRemove: 0, kept: 1 });
  t = await runTestOrderSweep(db, { apply: false, now: () => NOW + TEST_ORDER_TTL_MS });
  assert.deepEqual(t, { removed: 0, wouldRemove: 1, kept: 0 }, 'a dry run writes nothing');
  assert.ok(await val(`print_orders/${UID}/CS-7KQ2MX`));
  t = await runTestOrderSweep(db, { apply: true, now: () => NOW + TEST_ORDER_TTL_MS });
  assert.equal(t.removed, 1);
  assert.equal(await val(`print_orders/${UID}/CS-7KQ2MX`), null);
  assert.equal(await val('print_order_index/CS-7KQ2MX'), null);
  assert.ok(await val(`print_orders/${UID}/CS-REAL02`));
});

test('deleting the account removes its orders, its index entries and its codes and markers, and nobody else\'s', async () => {
  const H = (c) => c.repeat(64);
  await db.ref().set({
    users: { [UID]: { handle: 'buyer' }, [OTHER]: { handle: 'other' } },
    print_orders: { [UID]: { 'CS-AAAAAA': { test: true }, 'CS-BBBBBB': { test: false } }, [OTHER]: { 'CS-CCCCCC': { test: true } } },
    print_order_index: { 'CS-AAAAAA': UID, 'CS-BBBBBB': UID, 'CS-CCCCCC': OTHER },
    shop_handoff_codes: {
      [H('a')]: { uid: UID, exp: 1, used: true, orderNo: 'CS-AAAAAA', usedAt: 1 },
      [H('b')]: { uid: UID, exp: NOW + 1 },
      [H('c')]: { uid: OTHER, exp: NOW + 1 },
    },
  });
  const quiet = { log() {}, warn() {}, error() {} };
  const base = realIo(ENV, 'owner');
  const io = {
    ...base,
    async stripeCancel() {}, async paystackDisable() {}, async stripeFindSubscriptions() { return []; }, async paystackFindSubscriptions() { return []; },
    async storageList() { return []; }, async storageDelete() {}, async authDelete() {},
  };
  await runDeletion(UID, null, io, quiet);
  const after = await val('');
  assert.deepEqual(Object.keys(after.print_orders), [OTHER]);
  assert.deepEqual(after.print_order_index, { 'CS-CCCCCC': OTHER });
  assert.deepEqual(Object.keys(after.shop_handoff_codes), [H('c')]);
});

test('no client reaches the index: unauthenticated reads and writes of print_order_index are refused', async () => {
  for (const [method, body] of [['GET'], ['PUT', '"x"']]) {
    const res = await realFetch(`http://${HOST}/print_order_index/CS-CCCCCC.json?ns=${NS}`, { method, body });
    assert.equal(res.status, 401, `${method} refused`);
  }
  assert.equal(await val('print_order_index/CS-CCCCCC'), OTHER);
});
