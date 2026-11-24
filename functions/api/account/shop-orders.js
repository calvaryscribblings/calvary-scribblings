// POST /api/account/shop-orders — SHOP-B3: the paperback shop files a paid order to the reader's
// Calvary account. docs/ACCOUNT-CONTRACT.md §6.2 (b); the shop's copy of every rule here is
// docs/SHOP-HANDOFF.md.
//
// Called by the shop's server only: no browser, no ID token, no cookies. Every call is signed with
// Ed25519 by a key in SHOP_KEYS (./_shop-orders.js), over the key id, a Unix-seconds timestamp, the
// method, the path and the exact body bytes. The order of work:
//
//   1. the body's size; 2. the signature (one refusal for every way it can fail); 3. the limiter, by
//   key id; 4. the body, field by field; 5. the switch (test orders only until B4); 6. the filing.
//
// LOGS CARRY COUNTS ONLY: the result name and nothing else. Never a code, uid, order number, amount
// or key.

import { consume, capFromEnv } from '../_ratelimit.js';
import { mintAccessToken, dbBase, SCOPES, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import {
  verifySignature, checkBody, fileOrder, reply, MAX_BODY_BYTES, SHOP_KEYS,
} from './_shop-orders.js';
import { SHOP_ORDERS_OPEN } from '../../../app/lib/shopOrders.js';

const LABEL = 'account/shop-orders';

// THE DERIVATION. One call per paid order, plus a few retries after a lost reply or a 503. The shop
// is small: 60 a minute and 3,000 a day per key is many times its busiest plausible hour and day,
// and still bounds what a leaked key could make this endpoint write before it is removed.
export const SHOP_ORDER_CAPS = (env, keyId) => ([
  { scope: 'shoporders', period: 'minute', id: keyId, logAs: 'key', limit: capFromEnv(env, 'SHOP_ORDERS_MINUTE_CAP', 60) },
  { scope: 'shoporders', period: 'day', id: keyId, logAs: 'key', limit: capFromEnv(env, 'SHOP_ORDERS_DAY_CAP', 3000) },
]);

/** The database, over REST with the service account's token: a read with its ETag, a conditional write. */
export function restIo(env, token) {
  const url = (p) => `${dbBase(env)}/${p}.json`;
  return {
    async read(path) {
      const res = await fetch(url(path), {
        headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' },
        signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`read ${res.status}`);
      return { etag: res.headers.get('ETag'), value: await res.json() };
    },
    async putIf(path, value, etag) {
      const res = await fetch(url(path), {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'if-match': etag },
        body: JSON.stringify(value),
        signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
      });
      if (res.status === 412) return false;
      if (!res.ok) throw new Error(`write ${res.status}`);
      return true;
    },
  };
}

export const onRequestPost = (context) => handleShopOrders(context);

/** `opts` is the test seam: nowMs, keys, open (the switch), consume, io. */
export async function handleShopOrders(context, {
  nowMs = () => Date.now(), keys = SHOP_KEYS, open = SHOP_ORDERS_OPEN, consume: charge = consume, io: givenIo = null,
} = {}) {
  const { request, env } = context;
  const done = (result, extra, headers) => { console.log(`[${LABEL}] ${result}`); return reply(result, extra, headers); };

  // 1. Size first, so nothing large is hashed or verified.
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return done('bad_request', { field: 'body' });
  const body = new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (body.length > MAX_BODY_BYTES) return done('bad_request', { field: 'body' });

  // 2. The signature. One refusal for every failure.
  const now = nowMs();
  const keyId = await verifySignature({
    method: request.method, url: request.url, headers: request.headers, body, nowS: Math.floor(now / 1000), keys,
  });
  if (!keyId) return done('signature_refused');

  if (!givenIo && (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY)) {
    console.error(`[${LABEL}] credentials not configured`);
    return done('unavailable');
  }

  // 3. The limiter, by key id: after the signature, so nobody else can spend the shop's allowance.
  const limited = await charge(context, SHOP_ORDER_CAPS(env, keyId));
  if (!limited.ok) {
    return limited.reason === 'limit'
      ? done('too_many_calls', { retryAfter: limited.retryAfter }, { 'Retry-After': String(limited.retryAfter) })
      : done('unavailable', {}, { 'Retry-After': '30' });
  }

  // 4. The body.
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch { return done('bad_request', { field: 'body' }); }
  const checked = checkBody(parsed, now);
  if (!checked.ok) return done('bad_request', { field: checked.field });

  // 5. The switch: test orders only until B4 (its code stays unused).
  if (!open && checked.order.test !== true) return done('not_open_yet');

  // 6. The filing.
  try {
    let io = givenIo;
    if (!io) {
      const token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'), SCOPES);
      io = restIo(env, token);
    }
    const result = await fileOrder(io, { code: checked.code, order: checked.order, nowMs: now });
    return done(result);
  } catch (e) {
    console.error(`[${LABEL}] failed: ${e?.name === 'TimeoutError' ? 'timed out' : 'error'}`);
    return done('unavailable', {}, { 'Retry-After': '30' });
  }
}
