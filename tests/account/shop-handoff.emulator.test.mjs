// SHOP-B2 — the code-minting Function's write, for real, against the database emulator.
// The unit half (shop-handoff.test.mjs) proves what the Function sends; this proves what the
// database then holds: exactly { uid, exp } at the code's SHA-256, nothing else anywhere, and that
// the conditional write (if-match: null_etag) cannot land on a key that is already there.
// Only Google's two services (accounts:lookup, the OAuth token exchange) and the limiter are stood in.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { handleShopCode, SHOP_CODES_PATH } from '../../functions/api/account/shop-code.js';
import { SHOP_RETURN_URL, CODE_TTL_MS } from '../../app/lib/shopHandoff.js';

process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= '127.0.0.1:9000';
const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const NS = 'demo-calvary-account-default-rtdb';
assert.match(`http://${HOST}?ns=${NS}`, /^http:\/\/(127\.0\.0\.1|localhost):\d+\?ns=demo-/, 'refusing to run anywhere but the emulator');

const UID = 'SHOPreader00000000000000000001';
const NOW = 1_795_000_000_000;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'svc@demo.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_DATABASE_URL: `http://${HOST}`,
};

const realFetch = globalThis.fetch;
let app, db;
before(async () => {
  app = initializeApp({ projectId: 'demo-calvary-account', databaseURL: `http://${HOST}?ns=${NS}` }, 'shop-b2');
  db = getDatabase(app);
  await db.ref().set({ users: { [UID]: { handle: 'keeper' } }, shop_handoff_codes: { ['e'.repeat(64)]: { uid: 'someoneElse0000000000000000003', exp: NOW } } });
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://identitytoolkit.googleapis.com/')) return Response.json({ users: [{ localId: UID }] });
    if (u === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'owner' });   // the emulator's admin
    if (u.startsWith(`http://${HOST}/`)) return realFetch(`${u}${u.includes('?') ? '&' : '?'}ns=${NS}`, opts);
    throw new Error(`unexpected fetch ${u}`);
  };
});
after(async () => { globalThis.fetch = realFetch; await deleteApp(app); });

const call = (mint) => handleShopCode({
  request: new Request('https://x/api/account/shop-code', {
    method: 'POST',
    headers: { Authorization: 'Bearer good', 'CF-Connecting-IP': '198.51.100.9', 'Content-Type': 'application/json' },
    body: JSON.stringify({ return: SHOP_RETURN_URL, state: 'st-1', uid: 'notMe', exp: 1 }),
  }),
  env: ENV, waitUntil() {},
}, { now: () => NOW, consume: async () => ({ ok: true }), ...(mint ? { mint } : {}) });

test('the database holds exactly { uid, exp } at sha256(code), and nothing else changed', async () => {
  const before = (await db.ref().get()).val();
  const res = await call();
  assert.equal(res.status, 200);
  const { code } = await res.json();
  const key = createHash('sha256').update(code).digest('hex');
  const after = (await db.ref().get()).val();
  assert.deepEqual(after[SHOP_CODES_PATH][key], { uid: UID, exp: NOW + CODE_TTL_MS });
  delete after[SHOP_CODES_PATH][key];
  assert.deepEqual(after, before, 'one new entry, and not another byte anywhere');
});

test('a key already there is never written over: 412 from the database, 500 to the page, no code given', async () => {
  const fixed = 'F'.repeat(43);
  const first = await call(() => fixed);
  assert.equal(first.status, 200);
  const key = createHash('sha256').update(fixed).digest('hex');
  await db.ref(`${SHOP_CODES_PATH}/${key}`).set({ uid: 'someoneElse0000000000000000003', exp: 42 });
  const second = await call(() => fixed);
  assert.equal(second.status, 500);
  assert.deepEqual(await second.json(), { code: 'unavailable' });
  assert.deepEqual((await db.ref(`${SHOP_CODES_PATH}/${key}`).get()).val(), { uid: 'someoneElse0000000000000000003', exp: 42 });
});
