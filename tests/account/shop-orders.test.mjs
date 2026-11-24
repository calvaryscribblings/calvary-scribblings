// SHOP-B3 — the filing call, the unit half. docs/ACCOUNT-CONTRACT.md §6.2 (b); docs/SHOP-HANDOFF.md.
// The real handler, the real Ed25519 verification (WebCrypto), over an in-memory database that keeps
// RTDB's ETag rules (a conditional write on a stale tag is refused). The emulator half,
// shop-orders.emulator.test.mjs, runs the same filing over REST against the real database.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import {
  SHOP_KEYS, keyIdOf, signedBytes, verifySignature, checkBody, fileOrder, classifyCode, RESULTS,
  SHOP_ORDERS_PATH, HEADERS, MAX_SKEW_S, MAX_BODY_BYTES, b64urlToBytes,
} from '../../functions/api/account/_shop-orders.js';
import { handleShopOrders, SHOP_ORDER_CAPS } from '../../functions/api/account/shop-orders.js';
import { SHOP_ORDERS_OPEN, SHOP_TITLES, TEST_ORDER_TTL_MS, USED_MARKER_TTL_MS } from '../../app/lib/shopOrders.js';
import { planCodeSweep, planTestOrderSweep, planScrub } from '../../scripts/account/scrub-plan.mjs';
import { planOwned, STEP_COST } from '../../functions/api/account/_deletion.js';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const EX = JSON.parse(read('tests/account/fixtures/shop-example.json'));
const EX_KEY = { id: EX.keyId, raw: EX.publicKeyRaw };
const EX_PRIV = createPrivateKey(EX.privateKeyPkcs8Pem);

const UID = 'SHOPbuyer000000000000000000001';
const OTHER = 'SHOPother00000000000000000002';
const NOW = 1_795_602_000_000;   // the example's timestamp, in ms (2026-11-25T10:20:00Z)
const sha = (s) => createHash('sha256').update(s).digest('hex');
const CODE = 'q8Zr3vY1mXc0Lw9tB2nK5sJ7hD4fG6aP-eU_iO0yR1Q';   // the example's code
const CODE2 = 'Z'.repeat(43);

const order = (o = {}) => ({ orderNo: 'CS-7KQ2MX', paidAt: '2026-11-25T09:59:12Z', titles: ['after-the-fact'], copies: 1, amount: { value: 1500000, currency: 'NGN' }, test: true, ...o });
const bodyOf = (code = CODE, o = order()) => JSON.stringify({ code, order: o });

/** RTDB-like memory: read with an ETag, write only if the tag still matches. */
function memoryDb(seed = {}) {
  const data = new Map(Object.entries(seed));
  const tagOf = (v) => (v === null || v === undefined ? 'null_etag' : sha(JSON.stringify(v)));
  const writes = [];
  return {
    data, writes,
    async read(path) { const v = data.has(path) ? data.get(path) : null; return { etag: tagOf(v), value: v === undefined ? null : structuredClone(v) }; },
    async putIf(path, value, etag) {
      const cur = data.has(path) ? data.get(path) : null;
      if (tagOf(cur) !== etag) return false;
      data.set(path, structuredClone(value));
      writes.push(path);
      return true;
    },
  };
}
const fresh = (uid = UID, exp = NOW + 60_000) => ({ uid, exp });

function signWith(priv, { keyId, ts, body, path = SHOP_ORDERS_PATH, method = 'POST' }) {
  return sign(null, Buffer.from(signedBytes({ keyId, timestamp: String(ts), method, path, body: new TextEncoder().encode(body) })), priv).toString('base64url');
}

function req({ body = bodyOf(), keyId = EX.keyId, ts = Math.floor(NOW / 1000), priv = EX_PRIV, sig, drop = [], url = `https://calvaryscribblings.co.uk${SHOP_ORDERS_PATH}`, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json', [HEADERS.keyId]: keyId, [HEADERS.timestamp]: String(ts), [HEADERS.signature]: sig ?? signWith(priv, { keyId, ts, body }) };
  for (const h of drop) delete headers[h];
  return new Request(url, { method, headers, body: method === 'POST' ? body : undefined });
}

async function call(r, { db = memoryDb(), keys = [EX_KEY], open = false, consume = async () => ({ ok: true }), nowMs = NOW } = {}) {
  const res = await handleShopOrders({ request: r, env: {}, waitUntil() {} }, { nowMs: () => nowMs, keys, open, consume, io: db });
  return { status: res.status, json: await res.json(), headers: res.headers, db };
}

// ── the keys ───────────────────────────────────────────────────────────────────────────────────
describe('the keys', () => {
  test("the shop's key: its id is the first 8 hex of SHA-256 of the raw 32 bytes (b66e1054), and the SPKI is that key", async () => {
    assert.equal(SHOP_KEYS.length, 1);
    const [k] = SHOP_KEYS;
    assert.equal(k.raw, 'JIt1JZ7k_B67fHpQCkanxZvZOAOMluLB6iIhzlMsUx4');
    const raw = Buffer.from(k.raw, 'base64url');
    assert.equal(raw.length, 32);
    assert.equal(createHash('sha256').update(raw).digest('hex').slice(0, 8), 'b66e1054');
    assert.equal(k.id, 'b66e1054');
    assert.equal(await keyIdOf(k.raw), 'b66e1054');
    const spki = Buffer.from('MCowBQYDK2VwAyEAJIt1JZ7k/B67fHpQCkanxZvZOAOMluLB6iIhzlMsUx4=', 'base64');
    assert.deepEqual(spki.subarray(0, 12), Buffer.from('302a300506032b6570032100', 'hex'), 'an Ed25519 SPKI header');
    assert.deepEqual(spki.subarray(12), raw);
  });
  test('every listed key has a well-formed id that matches its bytes', async () => {
    for (const k of SHOP_KEYS) assert.equal(await keyIdOf(k.raw), k.id);
  });
  test('the worked example is a THROWAWAY pair, not the shop\'s, and its id follows the same rule', async () => {
    assert.notEqual(EX.publicKeyRaw, SHOP_KEYS[0].raw);
    assert.ok(!SHOP_KEYS.some((k) => k.id === EX.keyId));
    assert.equal(await keyIdOf(EX.publicKeyRaw), EX.keyId);
  });
});

// ── the worked example ─────────────────────────────────────────────────────────────────────────
describe('the worked example in docs/SHOP-HANDOFF.md', () => {
  test('the signed string, the signature and the headers in the note are exactly these', () => {
    const doc = read('docs/SHOP-HANDOFF.md');
    for (const v of [EX.publicKeyRaw, EX.keyId, EX.timestamp, EX.body, EX.signature, EX.privateKeyJwkD, EX.publicKeySpki]) {
      assert.ok(doc.includes(v), `the note carries ${v.slice(0, 20)}…`);
    }
    for (const line of EX.privateKeyPkcs8Pem.trim().split('\n')) assert.ok(doc.includes(line), 'the PEM is in the note');
    assert.ok(doc.includes(EX.signed.split('\n').slice(0, 5).join('\n')), 'the five header lines, in order');
  });
  test('the signed bytes are the five lines and the body, and the signature reproduces (Ed25519 is deterministic)', () => {
    const bytes = signedBytes({ keyId: EX.keyId, timestamp: EX.timestamp, method: 'POST', path: SHOP_ORDERS_PATH, body: new TextEncoder().encode(EX.body) });
    assert.equal(new TextDecoder().decode(bytes), EX.signed);
    assert.equal(sign(null, Buffer.from(bytes), EX_PRIV).toString('base64url'), EX.signature);
  });
  test('the example call, sent as written, is accepted and files', async () => {
    const db = memoryDb({ [`shop_handoff_codes/${sha(CODE)}`]: fresh() });
    const r = new Request(`https://calvaryscribblings.co.uk${SHOP_ORDERS_PATH}`, {
      method: 'POST', body: EX.body,
      headers: { 'Content-Type': 'application/json', 'X-Calvary-Key-Id': EX.keyId, 'X-Calvary-Timestamp': EX.timestamp, 'X-Calvary-Signature': EX.signature },
    });
    const res = await call(r, { db });
    assert.deepEqual(res.json, { result: 'filed' });
  });
});

// ── the signature ──────────────────────────────────────────────────────────────────────────────
describe('the signature: every failure, one refusal', () => {
  const REFUSED = { status: 401, json: { result: 'signature_refused' } };
  const expectRefused = async (r, opts) => {
    const db = memoryDb({ [`shop_handoff_codes/${sha(CODE)}`]: fresh() });
    let charged = false;
    const res = await call(r, { db, consume: async () => { charged = true; return { ok: true }; }, ...opts });
    assert.deepEqual({ status: res.status, json: res.json }, REFUSED);
    assert.equal(charged, false, 'not charged to the limiter');
    assert.deepEqual(db.writes, [], 'nothing written');
  };
  const other = generateKeyPairSync('ed25519').privateKey;

  test('signed by another key under the listed id', () => expectRefused(req({ priv: other })));
  test('a tampered body (one byte)', async () => {
    const body = bodyOf();
    const sig = signWith(EX_PRIV, { keyId: EX.keyId, ts: NOW / 1000, body });
    await expectRefused(req({ body: body.replace('"copies":1', '"copies":2'), sig }));
  });
  for (const h of Object.values(HEADERS)) test(`missing ${h}`, () => expectRefused(req({ drop: [h] })));
  test(`stale: ${MAX_SKEW_S + 1}s behind`, () => expectRefused(req({ ts: NOW / 1000 - MAX_SKEW_S - 1 })));
  test(`future: ${MAX_SKEW_S + 1}s ahead`, () => expectRefused(req({ ts: NOW / 1000 + MAX_SKEW_S + 1 })));
  test('exactly at the window\'s edges, either way: accepted', async () => {
    for (const ts of [NOW / 1000 - MAX_SKEW_S, NOW / 1000 + MAX_SKEW_S]) {
      const db = memoryDb({ [`shop_handoff_codes/${sha(CODE)}`]: fresh() });
      assert.equal((await call(req({ ts }), { db })).json.result, 'filed');
    }
  });
  test('an unknown key id (well-formed, signed correctly by its own key)', async () => {
    const pair = generateKeyPairSync('ed25519');
    const id = createHash('sha256').update(Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url')).digest('hex').slice(0, 8);
    await expectRefused(req({ keyId: id, priv: pair.privateKey }));
  });
  test('a malformed id, timestamp or signature', async () => {
    await expectRefused(req({ keyId: 'B66E1054' }));
    await expectRefused(req({ ts: '17955e5' }));
    await expectRefused(req({ ts: '-1795602000' }));
    await expectRefused(req({ sig: 'not base64url!' }));
    await expectRefused(req({ sig: signWith(EX_PRIV, { keyId: EX.keyId, ts: NOW / 1000, body: bodyOf() }).slice(0, 80) }));
    await expectRefused(req({ sig: '' }));
  });
  test('a signature over another path or method, or a query string the signature does not cover', async () => {
    await expectRefused(req({ sig: signWith(EX_PRIV, { keyId: EX.keyId, ts: NOW / 1000, body: bodyOf(), path: '/api/account/shop-order' }) }));
    await expectRefused(req({ sig: signWith(EX_PRIV, { keyId: EX.keyId, ts: NOW / 1000, body: bodyOf(), method: 'PUT' }) }));
    await expectRefused(req({ url: `https://calvaryscribblings.co.uk${SHOP_ORDERS_PATH}?x=1` }));
    await expectRefused(req({ url: `https://calvaryscribblings.co.uk${SHOP_ORDERS_PATH}/` }));
  });
  test('the timestamp is part of what is signed: a fresh time on an old signature is refused', async () => {
    const sig = signWith(EX_PRIV, { keyId: EX.keyId, ts: NOW / 1000 - 10, body: bodyOf() });
    await expectRefused(req({ sig, ts: NOW / 1000 }));
  });
  test('the key id is part of what is signed: two listed keys, a signature by one named as the other is refused', async () => {
    const pair = generateKeyPairSync('ed25519');
    const raw = pair.publicKey.export({ format: 'jwk' }).x;
    const second = { id: await keyIdOf(raw), raw };
    const sig = signWith(pair.privateKey, { keyId: second.id, ts: NOW / 1000, body: bodyOf() });
    await expectRefused(req({ keyId: EX.keyId, sig }), { keys: [EX_KEY, second] });
  });
  test('TWO KEYS, BOTH VALID: a call signed by either is accepted', async () => {
    const pair = generateKeyPairSync('ed25519');
    const raw = pair.publicKey.export({ format: 'jwk' }).x;
    const second = { id: await keyIdOf(raw), raw };
    const keys = [EX_KEY, second];
    const a = await call(req({ body: bodyOf(CODE, order()) }), { keys, db: memoryDb({ [`shop_handoff_codes/${sha(CODE)}`]: fresh() }) });
    const b = await call(req({ keyId: second.id, priv: pair.privateKey, body: bodyOf(CODE2, order({ orderNo: 'CS-ABC123' })) }), { keys, db: memoryDb({ [`shop_handoff_codes/${sha(CODE2)}`]: fresh() }) });
    assert.equal(a.json.result, 'filed');
    assert.equal(b.json.result, 'filed');
    // And the limiter is charged by the key that signed.
    let charged;
    await call(req({ keyId: second.id, priv: pair.privateKey }), { keys, consume: async (_c, buckets) => { charged = buckets; return { ok: true }; } });
    assert.ok(charged.every((b) => b.id === second.id && b.logAs === 'key'));
  });
  test('verification is WebCrypto Ed25519 (what the Pages runtime has), not node:crypto', () => {
    const src = read('functions/api/account/_shop-orders.js');
    assert.match(src, /crypto\.subtle\.verify\(\{ name: 'Ed25519' \}/);
    assert.match(src, /importKey\('raw', b64urlToBytes\(raw\), \{ name: 'Ed25519' \}, false, \['verify'\]\)/);
    assert.doesNotMatch(src, /from 'node:/);
  });
});

// ── the body ───────────────────────────────────────────────────────────────────────────────────
describe('the body: each field, and nothing else', () => {
  const bad = async (body, field) => {
    const db = memoryDb({ [`shop_handoff_codes/${sha(CODE)}`]: fresh() });
    const res = await call(req({ body }), { db });
    assert.deepEqual({ status: res.status, json: res.json }, { status: 400, json: { result: 'bad_request', field } }, `${field}: ${body.slice(0, 120)}`);
    assert.deepEqual(db.writes, []);
  };
  const withOrder = (o) => bodyOf(CODE, o);

  test('not JSON, not an object, not UTF-8', async () => {
    await bad('not json', 'body');
    await bad('[]', 'body');
    await bad('null', 'body');
    await bad('"x"', 'body');
  });
  test('too large: refused before anything is verified', async () => {
    const big = JSON.stringify({ code: CODE, order: order(), pad: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await call(req({ body: big }));
    assert.deepEqual(res.json, { result: 'bad_request', field: 'body' });
  });
  test('missing or extra top-level fields, named', async () => {
    await bad(JSON.stringify({ order: order() }), 'code');
    await bad(JSON.stringify({ code: CODE }), 'order');
    await bad(JSON.stringify({ code: CODE, order: order(), uid: OTHER }), 'uid');
    await bad(JSON.stringify({ code: CODE, order: order(), 'bad key!': 1 }), 'body');
  });
  test('code: a 43-character base64url string', async () => {
    for (const c of ['', 'short', `${CODE}=`, CODE.replace('q', '+'), 43, null]) await bad(JSON.stringify({ code: c, order: order() }), 'code');
  });
  test('order: an object with exactly its six fields; extras named and refused', async () => {
    await bad(JSON.stringify({ code: CODE, order: [] }), 'order');
    for (const extra of ['address', 'email', 'name', 'uid', 'paystackRef', 'phone']) await bad(withOrder({ ...order(), [extra]: 'x' }), `order.${extra}`);
    for (const k of ['orderNo', 'paidAt', 'titles', 'copies', 'amount', 'test']) { const o = order(); delete o[k]; await bad(withOrder(o), `order.${k}`); }
  });
  test('orderNo: the ids.js kind, never cleaned', async () => {
    for (const v of ['cs-7kq2mx', 'CS-7KQ2M', 'CS-7KQ2MXX', ' CS-7KQ2MX', 'CS-7KQ2MX ', 'CS_7KQ2MX', 'CS-7KQ/MX', 'CS-7KQ.MX', 12345, null]) await bad(withOrder(order({ orderNo: v })), 'order.orderNo');
  });
  test('paidAt: ISO 8601 in UTC, a real instant, not before 2026, not in the future', async () => {
    for (const v of ['2026-11-25', '2026-11-25T09:59:12', '2026-11-25T09:59:12+01:00', '2026-11-25 09:59:12Z', '2026-02-30T10:00:00Z',
      '2026-11-25T24:00:00Z', '2025-12-31T23:59:59Z', '2026-11-25T10:25:01Z', 1795536000000, '2026-11-25T09:59:12.1234Z', '']) {
      await bad(withOrder(order({ paidAt: v })), 'order.paidAt');
    }
    for (const v of ['2026-11-25T09:59:12Z', '2026-11-25T09:59:12.5Z', '2026-01-01T00:00:00Z', '2026-11-25T10:24:59Z']) {
      assert.equal(checkBody(JSON.parse(withOrder(order({ paidAt: v }))), NOW).ok, true, v);
    }
    assert.equal(checkBody(JSON.parse(withOrder(order())), NOW).order.paidAt, Date.UTC(2026, 10, 25, 9, 59, 12), 'stored as epoch ms');
  });
  test('titles: one or both of the fixed list, no repeats', async () => {
    assert.deepEqual([...SHOP_TITLES], ['after-the-fact', 'where-the-story-begins']);
    for (const v of [[], ['another-book'], ['after-the-fact', 'after-the-fact'], ['After-The-Fact'], 'after-the-fact', [1], ['after-the-fact', 'where-the-story-begins', 'x']]) {
      await bad(withOrder(order({ titles: v })), 'order.titles');
    }
    assert.equal(checkBody(JSON.parse(withOrder(order({ titles: ['where-the-story-begins', 'after-the-fact'] }))), NOW).ok, true);
  });
  test('copies: a whole number, 1 to 99', async () => {
    for (const v of [0, -1, 100, 1.5, '3', null, true]) await bad(withOrder(order({ copies: v })), 'order.copies');
    for (const v of [1, 99]) assert.equal(checkBody(JSON.parse(withOrder(order({ copies: v }))), NOW).ok, true);
  });
  test('amount: { value: whole kobo, currency: "NGN" } and nothing else', async () => {
    await bad(withOrder(order({ amount: 1500000 })), 'order.amount');
    await bad(withOrder(order({ amount: { value: 1500000 } })), 'order.amount.currency');
    await bad(withOrder(order({ amount: { value: 1500000, currency: 'NGN', minor: 1 } })), 'order.amount.minor');
    for (const v of [0, 99, 15000.5, '1500000', -100, 1_000_000_001, null]) await bad(withOrder(order({ amount: { value: v, currency: 'NGN' } })), 'order.amount.value');
    for (const c of ['GBP', 'ngn', 'USD', '', null]) await bad(withOrder(order({ amount: { value: 1500000, currency: c } })), 'order.amount.currency');
  });
  test('test: a boolean', async () => {
    for (const v of ['true', 1, null]) await bad(withOrder(order({ test: v })), 'order.test');
  });
});

// ── the replies ────────────────────────────────────────────────────────────────────────────────
describe('every reply', () => {
  const codeAt = (c = CODE) => `shop_handoff_codes/${sha(c)}`;

  test('the table: one result, one status each', () => {
    assert.deepEqual(RESULTS, {
      filed: 200, already_filed: 200, code_used_for_another_order: 409, code_expired: 410, code_unknown: 404,
      order_in_another_account: 409, not_open_yet: 403, bad_request: 400, signature_refused: 401, too_many_calls: 429, unavailable: 503,
    });
  });

  test('FILED: the record is exactly the named fields and filedAt, the code becomes a used marker, the index points at the account', async () => {
    const db = memoryDb({ [codeAt()]: fresh() });
    const res = await call(req({ body: bodyOf(CODE, order({ titles: ['after-the-fact', 'where-the-story-begins'], copies: 3 })) }), { db });
    assert.deepEqual({ status: res.status, json: res.json }, { status: 200, json: { result: 'filed' } });
    assert.deepEqual(db.data.get(`print_orders/${UID}/CS-7KQ2MX`), {
      orderNo: 'CS-7KQ2MX', paidAt: Date.UTC(2026, 10, 25, 9, 59, 12), titles: ['after-the-fact', 'where-the-story-begins'], copies: 3,
      amount: { value: 1500000, currency: 'NGN' }, test: true, filedAt: NOW,
    });
    assert.deepEqual(db.data.get(codeAt()), { uid: UID, exp: NOW + 60_000, used: true, orderNo: 'CS-7KQ2MX', usedAt: NOW });
    assert.equal(db.data.get('print_order_index/CS-7KQ2MX'), UID);
    assert.deepEqual(db.writes, [codeAt(), 'print_order_index/CS-7KQ2MX', `print_orders/${UID}/CS-7KQ2MX`]);
  });

  test('THE RETRY AFTER A LOST REPLY: the same code and order again → already_filed, nothing rewritten', async () => {
    const db = memoryDb({ [codeAt()]: fresh() });
    assert.equal((await call(req(), { db })).json.result, 'filed');
    const before = structuredClone(Object.fromEntries(db.data));
    const n = db.writes.length;
    for (const later of [NOW + 1000, NOW + 10 * 60_000]) {   // even after the code's own 5 minutes
      const r = await call(req({ ts: later / 1000 }), { db, nowMs: later });
      assert.deepEqual({ status: r.status, json: r.json }, { status: 200, json: { result: 'already_filed' } });
    }
    assert.equal(db.writes.length, n);
    assert.deepEqual(Object.fromEntries(db.data), before);
  });

  test('a retry after a crash between the marker and the order completes the filing', async () => {
    const db = memoryDb({ [codeAt()]: { uid: UID, exp: NOW + 60_000, used: true, orderNo: 'CS-7KQ2MX', usedAt: NOW - 1000 } });
    const r = await call(req(), { db });
    assert.equal(r.json.result, 'filed');
    assert.ok(db.data.get(`print_orders/${UID}/CS-7KQ2MX`));
    assert.equal(db.data.get('print_order_index/CS-7KQ2MX'), UID);
  });

  test('already_filed: a NEW code for an order this account already holds; the code is used up, the order untouched', async () => {
    const db = memoryDb({ [codeAt()]: fresh(), [codeAt(CODE2)]: fresh() });
    await call(req(), { db });
    const held = db.data.get(`print_orders/${UID}/CS-7KQ2MX`);
    const r = await call(req({ body: bodyOf(CODE2, order({ copies: 7 })) }), { db });
    assert.deepEqual(r.json, { result: 'already_filed' });
    assert.deepEqual(db.data.get(`print_orders/${UID}/CS-7KQ2MX`), held, 'never overwritten');
    assert.equal(db.data.get(codeAt(CODE2)).used, true);
  });

  test('code_used_for_another_order (409)', async () => {
    const db = memoryDb({ [codeAt()]: fresh() });
    await call(req(), { db });
    const r = await call(req({ body: bodyOf(CODE, order({ orderNo: 'CS-OTHER1' })) }), { db });
    assert.deepEqual({ status: r.status, json: r.json }, { status: 409, json: { result: 'code_used_for_another_order' } });
    assert.equal(db.data.has(`print_orders/${UID}/CS-OTHER1`), false);
  });

  test('code_expired (410): unused and past its exp; nothing written', async () => {
    for (const exp of [NOW, NOW - 1]) {
      const db = memoryDb({ [codeAt()]: fresh(UID, exp) });
      const r = await call(req(), { db });
      assert.deepEqual({ status: r.status, json: r.json }, { status: 410, json: { result: 'code_expired' } });
      assert.deepEqual(db.writes, []);
    }
  });

  test('code_unknown (404): never minted, or malformed; nothing written', async () => {
    for (const seed of [{}, { [codeAt()]: { exp: NOW + 1 } }, { [codeAt()]: { uid: 'a/b', exp: NOW + 1 } }, { [codeAt()]: { uid: UID, exp: NOW + 1, used: 'yes' } }, { [codeAt()]: 'x' }]) {
      const db = memoryDb(seed);
      const r = await call(req(), { db });
      assert.deepEqual({ status: r.status, json: r.json }, { status: 404, json: { result: 'code_unknown' } });
      assert.deepEqual(db.writes, []);
    }
  });

  test('the key is the SHA-256 of the code string EXACTLY as received', async () => {
    const db = memoryDb({ [`shop_handoff_codes/${sha(CODE.toLowerCase())}`]: fresh() });
    assert.equal((await call(req(), { db })).json.result, 'code_unknown');
  });

  test('order_in_another_account (409): refused, nothing written, and an unused code stays unused', async () => {
    const db = memoryDb({ [codeAt()]: fresh(), 'print_order_index/CS-7KQ2MX': OTHER });
    const r = await call(req(), { db });
    assert.deepEqual({ status: r.status, json: r.json }, { status: 409, json: { result: 'order_in_another_account' } });
    assert.deepEqual(db.writes, []);
    assert.deepEqual(db.data.get(codeAt()), fresh());
  });

  test('two accounts racing for one order: one files, the other is refused', async () => {
    const db = memoryDb({ [codeAt()]: fresh(UID), [codeAt(CODE2)]: fresh(OTHER) });
    const [a, b] = await Promise.all([call(req(), { db }), call(req({ body: bodyOf(CODE2) }), { db })]);
    assert.deepEqual([a.json.result, b.json.result].sort(), ['filed', 'order_in_another_account']);
    const holder = db.data.get('print_order_index/CS-7KQ2MX');
    assert.ok(db.data.has(`print_orders/${holder}/CS-7KQ2MX`));
    assert.equal(db.data.has(`print_orders/${holder === UID ? OTHER : UID}/CS-7KQ2MX`), false);
  });

  test('one code, two calls at once: same order → filed + already_filed; different orders → one is refused', async () => {
    let db = memoryDb({ [codeAt()]: fresh() });
    let rs = await Promise.all([call(req(), { db }), call(req(), { db })]);
    assert.deepEqual(rs.map((r) => r.json.result).sort(), ['already_filed', 'filed']);
    db = memoryDb({ [codeAt()]: fresh() });
    rs = await Promise.all([call(req(), { db }), call(req({ body: bodyOf(CODE, order({ orderNo: 'CS-OTHER1' })) }), { db })]);
    assert.deepEqual(rs.map((r) => r.json.result).sort(), ['code_used_for_another_order', 'filed']);
  });

  test('not_open_yet (403): a real order while the switch is off; nothing written, its code still unused', async () => {
    assert.equal(SHOP_ORDERS_OPEN, false, 'the switch ships OFF; B4 flips it');
    const db = memoryDb({ [codeAt()]: fresh() });
    const r = await call(req({ body: bodyOf(CODE, order({ test: false })) }), { db });
    assert.deepEqual({ status: r.status, json: r.json }, { status: 403, json: { result: 'not_open_yet' } });
    assert.deepEqual(db.writes, []);
    // A test order is filed meanwhile, and keeps test: true; with the switch on, a real one is filed.
    assert.equal((await call(req(), { db })).json.result, 'filed');
    assert.equal(db.data.get(`print_orders/${UID}/CS-7KQ2MX`).test, true);
    const db2 = memoryDb({ [codeAt()]: fresh() });
    assert.equal((await call(req({ body: bodyOf(CODE, order({ test: false })) }), { db: db2, open: true })).json.result, 'filed');
    assert.equal(db2.data.get(`print_orders/${UID}/CS-7KQ2MX`).test, false);
  });

  test('the switch is read by the Function from app/lib/shopOrders.js, one constant', () => {
    assert.match(read('functions/api/account/shop-orders.js'), /open = SHOP_ORDERS_OPEN/);
    assert.match(read('app/lib/shopOrders.js'), /^export const SHOP_ORDERS_OPEN = false;$/m);
  });

  test('too_many_calls (429) with Retry-After, and a limiter that fails is unavailable (503); nothing written', async () => {
    const db = memoryDb({ [codeAt()]: fresh() });
    let r = await call(req(), { db, consume: async () => ({ ok: false, reason: 'limit', retryAfter: 42 }) });
    assert.deepEqual({ status: r.status, json: r.json, ra: r.headers.get('Retry-After') }, { status: 429, json: { result: 'too_many_calls', retryAfter: 42 }, ra: '42' });
    r = await call(req(), { db, consume: async () => ({ ok: false, reason: 'unavailable' }) });
    assert.deepEqual({ status: r.status, json: r.json }, { status: 503, json: { result: 'unavailable' } });
    assert.deepEqual(db.writes, []);
  });

  test('the limiter: by key id, a minute and a day, never removable', () => {
    assert.deepEqual(SHOP_ORDER_CAPS({}, 'b66e1054').map(({ scope, period, id, logAs, limit }) => [scope, period, id, logAs, limit]),
      [['shoporders', 'minute', 'b66e1054', 'key', 60], ['shoporders', 'day', 'b66e1054', 'key', 3000]]);
    assert.equal(SHOP_ORDER_CAPS({ SHOP_ORDERS_MINUTE_CAP: '0' }, 'x')[0].limit, 60);
  });

  test('our own failure (503, retry): the database failing mid-way answers unavailable, and the retry then files', async () => {
    const db = memoryDb({ [codeAt()]: fresh() });
    const flaky = { ...db, read: db.read, async putIf(p, v, t) { if (p.startsWith('print_orders/')) throw new Error('boom'); return db.putIf(p, v, t); } };
    const r = await call(req(), { db: flaky });
    assert.deepEqual({ status: r.status, json: r.json, ra: r.headers.get('Retry-After') }, { status: 503, json: { result: 'unavailable' }, ra: '30' });
    assert.equal((await call(req(), { db })).json.result, 'filed', 'the retry finds its own marker and finishes');
  });

  test('every reply is JSON with a result, never an echo of the code, the order or the uid', async () => {
    const db = memoryDb({ [codeAt()]: fresh() });
    const r = await call(req(), { db });
    const text = JSON.stringify(r.json);
    for (const v of [CODE, UID, 'CS-7KQ2MX', '1500000']) assert.ok(!text.includes(v));
  });

  test('classifyCode, directly', () => {
    assert.equal(classifyCode(null, 'CS-AAAAAA', NOW), 'code_unknown');
    assert.equal(classifyCode({ uid: UID, exp: NOW + 1 }, 'CS-AAAAAA', NOW), 'fresh');
    assert.equal(classifyCode({ uid: UID, exp: NOW }, 'CS-AAAAAA', NOW), 'code_expired');
    assert.equal(classifyCode({ uid: UID, exp: 0, used: true, orderNo: 'CS-AAAAAA', usedAt: 1 }, 'CS-AAAAAA', NOW), 'retry');
    assert.equal(classifyCode({ uid: UID, exp: 0, used: true, orderNo: 'CS-BBBBBB', usedAt: 1 }, 'CS-AAAAAA', NOW), 'code_used_for_another_order');
  });
});

// ── the sweeps and deletion ────────────────────────────────────────────────────────────────────
describe('the scrub and deletion', () => {
  const H = (c) => c.repeat(64);
  test('the code sweep: a used marker stays 24 hours from usedAt, whatever its exp; unused codes go at exp; malformed go', () => {
    const p = planCodeSweep({
      [H('1')]: { uid: UID, exp: NOW - 10_000, used: true, orderNo: 'CS-AAAAAA', usedAt: NOW - USED_MARKER_TTL_MS + 1 },   // kept
      [H('2')]: { uid: UID, exp: NOW + 10_000, used: true, orderNo: 'CS-AAAAAA', usedAt: NOW - USED_MARKER_TTL_MS },       // gone
      [H('3')]: { uid: UID, exp: NOW + 1 },                                                                                  // kept
      [H('4')]: { uid: UID, exp: NOW },                                                                                      // gone
      [H('5')]: { uid: UID, exp: NOW + 1, used: true, orderNo: 'CS-AAAAAA' },                                                // malformed: no usedAt
      [H('6')]: { uid: UID, exp: NOW + 1, used: false },                                                                     // malformed
      'not-a-hash': { uid: UID, exp: 0 },
    }, NOW);
    assert.deepEqual(p.nulls.sort(), [H('2'), H('4'), H('5'), H('6')].map((h) => `shop_handoff_codes/${h}`));
    assert.deepEqual({ expired: p.expired, usedRemoved: p.usedRemoved, malformed: p.malformed, unaddressable: p.unaddressable, live: p.live, usedLive: p.usedLive },
      { expired: 1, usedRemoved: 1, malformed: 2, unaddressable: 1, live: 1, usedLive: 1 });
  });
  test('the test-order sweep: test orders 7 days after filing, with their index entry; real orders never', () => {
    const p = planTestOrderSweep({
      [UID]: {
        'CS-OLDTST': { test: true, filedAt: NOW - TEST_ORDER_TTL_MS },
        'CS-NEWTST': { test: true, filedAt: NOW - TEST_ORDER_TTL_MS + 1 },
        'CS-REAL01': { test: false, filedAt: 0 },
      },
      [OTHER]: { 'CS-OTHTST': { test: true, filedAt: 0 } },
      'bad/uid': { 'CS-XXXXXX': { test: true, filedAt: 0 } },
    }, { 'CS-OLDTST': UID, 'CS-OTHTST': UID }, NOW);
    assert.deepEqual(p.nulls.sort(), [`print_order_index/CS-OLDTST`, `print_orders/${OTHER}/CS-OTHTST`, `print_orders/${UID}/CS-OLDTST`].sort(),
      'an index entry pointing at ANOTHER account is left alone');
    assert.deepEqual({ removed: p.removed, kept: p.kept }, { removed: 2, kept: 1 });
  });
  test('deletion (owned step): orders whole, their index entries, and the reader\'s codes and markers', () => {
    const u = planOwned(UID, {
      user: {}, orders: { 'CS-AAAAAA': {}, 'CS-BBBBBB': {}, '../x': {} },
      codes: { [H('a')]: { uid: UID, exp: 1, used: true, orderNo: 'CS-AAAAAA', usedAt: 1 }, [H('b')]: { uid: OTHER, exp: 1 } },
    }, null);
    assert.equal(u[`print_orders/${UID}`], null);
    assert.equal(u['print_order_index/CS-AAAAAA'], null);
    assert.equal(u['print_order_index/CS-BBBBBB'], null);
    assert.ok(!Object.keys(u).some((k) => k.includes('..')));
    assert.equal(u[`shop_handoff_codes/${H('a')}`], null, 'a used marker goes by its uid too');
    assert.ok(!(`shop_handoff_codes/${H('b')}` in u));
    assert.equal(STEP_COST.owned, 16);
  });
  test('the scrub\'s backstop takes an index entry still pointing at a deleted reader', () => {
    const plan = planScrub(UID, { print_order_index: { 'CS-LATE01': UID, 'CS-KEEP01': OTHER }, userNode: null });
    assert.ok(plan.nulls.includes('print_order_index/CS-LATE01'));
    assert.ok(!plan.nulls.includes('print_order_index/CS-KEEP01'));
  });
});

// ── logs ───────────────────────────────────────────────────────────────────────────────────────
describe('logs', () => {
  const lines = [];
  const real = { log: console.log, warn: console.warn, error: console.error };
  before(() => { for (const k of Object.keys(real)) console[k] = (...a) => lines.push(a.map(String).join(' ')); });
  after(() => Object.assign(console, real));

  test('NOTHING SENSITIVE: every path logs its result name only', async () => {
    const codeAt = `shop_handoff_codes/${sha(CODE)}`;
    const db = memoryDb({ [codeAt]: fresh() });
    await call(req(), { db });                                               // filed
    await call(req(), { db });                                               // already_filed
    await call(req({ body: bodyOf(CODE, order({ orderNo: 'CS-OTHER1' })) }), { db });
    await call(req({ body: bodyOf(CODE2) }), { db });                        // unknown
    await call(req({ body: bodyOf(CODE, order({ test: false, orderNo: 'CS-REAL99' })) }), { db });
    await call(req({ drop: [HEADERS.signature] }), { db });
    await call(req({ body: bodyOf(CODE, order({ amount: { value: 7, currency: 'NGN' } })) }), { db });
    await call(req(), { db, consume: async () => ({ ok: false, reason: 'limit', retryAfter: 5 }) });
    const boom = { read: async () => { throw new Error(`boom ${UID} ${CODE}`); }, putIf: async () => false };
    await call(req({ body: bodyOf(CODE2) }), { db: boom });
    assert.ok(lines.length >= 9);
    const secrets = [CODE, CODE2, sha(CODE), sha(CODE2), UID, 'CS-7KQ2MX', 'CS-OTHER1', 'CS-REAL99', '1500000', EX.keyId, EX.publicKeyRaw, SHOP_KEYS[0].id, SHOP_KEYS[0].raw];
    for (const l of lines) {
      for (const s of secrets) assert.ok(!l.includes(s), `a log line carries a sensitive value: ${l.replace(s, '<redacted>')}`);
      assert.match(l, /^\[account\/shop-orders\] [a-z_]+$|^\[account\/shop-orders\] failed: (error|timed out)$/, l);
    }
  });
});

test('a base64url decoder that refuses rather than guesses', () => {
  assert.equal(b64urlToBytes('a+b'), null);
  assert.equal(b64urlToBytes(5), null);
  assert.equal(b64urlToBytes(EX.signature).length, 64);
});

test('no rules change: print_order_index has no entry and the root grants nothing, so no client reaches it', () => {
  const rules = JSON.parse(read('database.rules.json')).rules;
  assert.equal('print_order_index' in rules, false);
  assert.equal(rules['.read'], undefined);
  assert.equal(rules['.write'], undefined);
  assert.deepEqual(rules.shop_handoff_codes, { '.read': false, '.write': false });
});

test('the worked example\'s THROWAWAY key is never a working key: neither its id nor its public key is in SHOP_KEYS', async () => {
  assert.equal(EX.keyId, 'b3642903');
  assert.equal(EX.publicKeyRaw, '4ZgIF4MKpoevYvb4ceeZ2JmUy5ctDlUSg5NyKe_29tI');
  assert.ok(!SHOP_KEYS.some((k) => k.id === 'b3642903'), 'its id is not listed');
  assert.ok(!SHOP_KEYS.some((k) => k.raw === EX.publicKeyRaw), 'its public key is not listed, under any id');
  for (const k of SHOP_KEYS) assert.notEqual(await keyIdOf(k.raw), 'b3642903');
  // And the example call, sent against the real list, is refused.
  const r = new Request(`https://calvaryscribblings.co.uk${SHOP_ORDERS_PATH}`, {
    method: 'POST', body: EX.body,
    headers: { 'Content-Type': 'application/json', 'X-Calvary-Key-Id': EX.keyId, 'X-Calvary-Timestamp': EX.timestamp, 'X-Calvary-Signature': EX.signature },
  });
  const res = await handleShopOrders({ request: r, env: {}, waitUntil() {} }, { nowMs: () => NOW, io: memoryDb(), consume: async () => ({ ok: true }) });
  assert.deepEqual(await res.json(), { result: 'signature_refused' });
});

test('paidAt allows the same clock skew as the timestamp: up to MAX_SKEW_S ahead is accepted, a second more is refused', () => {
  const at = (ms) => checkBody({ code: CODE, order: order({ paidAt: new Date(ms).toISOString().replace('.000Z', 'Z') }) }, NOW);
  assert.equal(MAX_SKEW_S, 300);
  assert.equal(at(NOW + MAX_SKEW_S * 1000).ok, true, 'exactly +300 s, the timestamp window\'s own edge');
  assert.deepEqual(at(NOW + MAX_SKEW_S * 1000 + 1000), { ok: false, field: 'order.paidAt' });
  assert.equal(checkBody({ code: CODE, order: order({ paidAt: new Date(NOW + MAX_SKEW_S * 1000 + 1).toISOString() }) }, NOW).ok, false, 'even a millisecond over');
  // The signature window is the same constant, with the same inclusive edge.
  const src = read('functions/api/account/_shop-orders.js');
  assert.match(src, /if \(Math\.abs\(nowS - Number\(ts\)\) > MAX_SKEW_S\) return null;/);
  assert.match(src, /ms > nowMs \+ MAX_SKEW_S \* 1000\) return null;/);
});
