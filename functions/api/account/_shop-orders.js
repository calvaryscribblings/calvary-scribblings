// SHOP-B3 — THE FILING CALL'S PARTS (docs/ACCOUNT-CONTRACT.md §6.2 (b), (b2); docs/SHOP-HANDOFF.md).
// Underscore-prefixed so Pages does not route it. The endpoint is ./shop-orders.js.
//
//   · the shop's keys, and the Ed25519 signature over one canonical string
//   · the body, checked field by field and rebuilt from the named fields only
//   · the filing itself, over a four-call io (read with ETag, conditional write), so the emulator and
//     the unit tests drive the same code the Function runs
//   · the replies: one stable `result` per outcome, each with its status
//
// NO RULE BINDS ANY WRITE HERE (§6.2 (b2)): the Function writes with the service account's token,
// which skips .read, .write and .validate alike. Every shape below is enforced by this code alone.

import { isId } from '../../../app/lib/ids.js';
import { CODE_RE } from '../../../app/lib/shopHandoff.js';
import {
  SHOP_TITLES, COPIES_MAX, AMOUNT_MIN, AMOUNT_MAX, SHOP_CURRENCY, PAID_AT_FLOOR,
  ORDER_INDEX_PATH, ORDERS_PATH,
} from '../../../app/lib/shopOrders.js';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE KEYS
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// The shop signs with Ed25519; its private key never leaves its Worker. These are PUBLIC keys, so
// they are committed. A key's id is the first 8 hex characters of the SHA-256 of its raw 32 bytes
// (tests/account/shop-orders.test.mjs proves it for each entry). Two may be listed at once: to
// replace a key, the shop sends the new public key, it is added here and deployed, the shop starts
// signing with it, and the old entry is removed in a later deploy (docs/SHOP-HANDOFF.md).

export const SHOP_KEYS = Object.freeze([
  // The shop's first key (SHOP-B3, 24 Nov 2026). SPKI: MCowBQYDK2VwAyEAJIt1JZ7k/B67fHpQCkanxZvZOAOMluLB6iIhzlMsUx4=
  Object.freeze({ id: 'b66e1054', raw: 'JIt1JZ7k_B67fHpQCkanxZvZOAOMluLB6iIhzlMsUx4' }),
]);

export const SHOP_ORDERS_PATH = '/api/account/shop-orders';
export const SIGNATURE_VERSION = 'calvary-shop-orders-v1';
export const MAX_SKEW_S = 300;
export const MAX_BODY_BYTES = 8192;
export const HEADERS = Object.freeze({ keyId: 'X-Calvary-Key-Id', timestamp: 'X-Calvary-Timestamp', signature: 'X-Calvary-Signature' });

const enc = new TextEncoder();

export function b64urlToBytes(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A key's id: the first 8 hex characters of the SHA-256 of its raw 32 bytes. */
export const keyIdOf = async (rawB64url) => (await sha256Hex(b64urlToBytes(rawB64url))).slice(0, 8);

/**
 * THE SIGNED BYTES. Five lines, each ended by a newline, then the body exactly as sent:
 *
 *   calvary-shop-orders-v1\n
 *   <key id>\n
 *   <timestamp, Unix seconds, decimal>\n
 *   POST\n
 *   /api/account/shop-orders\n
 *   <body bytes, unchanged>
 */
export function signedBytes({ keyId, timestamp, method, path, body }) {
  const head = enc.encode(`${SIGNATURE_VERSION}\n${keyId}\n${timestamp}\n${method}\n${path}\n`);
  const b = body instanceof Uint8Array ? body : new Uint8Array(body);
  const out = new Uint8Array(head.length + b.length);
  out.set(head, 0);
  out.set(b, head.length);
  return out;
}

const keyCache = new Map();
async function importKey(raw) {
  if (!keyCache.has(raw)) keyCache.set(raw, crypto.subtle.importKey('raw', b64urlToBytes(raw), { name: 'Ed25519' }, false, ['verify']));
  return keyCache.get(raw);
}

/**
 * Is this request signed by a listed key, inside the window? Returns the key id, or null. Every
 * failure is the same null: a missing header, an unknown key, a malformed or wrong signature, a
 * time outside the window, a query string (not covered by the signature), another method or path.
 */
export async function verifySignature({ method, url, headers, body, nowS, keys = SHOP_KEYS }) {
  try {
    const keyId = headers.get(HEADERS.keyId);
    const ts = headers.get(HEADERS.timestamp);
    const sig = headers.get(HEADERS.signature);
    if (!keyId || !ts || !sig) return null;
    if (!/^[0-9a-f]{8}$/.test(keyId) || !/^[0-9]{1,12}$/.test(ts)) return null;
    if (Math.abs(nowS - Number(ts)) > MAX_SKEW_S) return null;
    const u = new URL(url);
    if (method !== 'POST' || u.pathname !== SHOP_ORDERS_PATH || u.search !== '') return null;
    const key = keys.find((k) => k.id === keyId);
    if (!key) return null;
    const sigBytes = b64urlToBytes(sig);
    if (!sigBytes || sigBytes.length !== 64) return null;
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, await importKey(key.raw), sigBytes,
      signedBytes({ keyId, timestamp: ts, method, path: SHOP_ORDERS_PATH, body }));
    return ok ? keyId : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE REPLIES. `result` is the stable, machine-readable answer; the shop branches on it, never on
// the status alone. docs/SHOP-HANDOFF.md says which may be retried.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const RESULTS = Object.freeze({
  filed: 200,
  already_filed: 200,
  code_used_for_another_order: 409,
  code_expired: 410,
  code_unknown: 404,
  order_in_another_account: 409,
  not_open_yet: 403,
  bad_request: 400,
  signature_refused: 401,
  too_many_calls: 429,
  unavailable: 503,
});

export function reply(result, extra = {}, headers = {}) {
  return new Response(JSON.stringify({ result, ...extra }), {
    status: RESULTS[result],
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE BODY: { code, order: { orderNo, paidAt, titles, copies, amount: { value, currency }, test } }
// Exactly these fields; anything else is refused, naming the field. The record is BUILT from the
// named fields, never spread from the body.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const SAFE_FIELD = /^[A-Za-z0-9_]{1,40}$/;

function onlyKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) return SAFE_FIELD.test(k) ? `${where ? `${where}.` : ''}${k}` : (where || 'body');
  }
  for (const k of allowed) if (!(k in obj)) return `${where ? `${where}.` : ''}${k}`;
  return null;
}

/** paidAt: ISO 8601 in UTC (Z), a real calendar instant, not before the shop, not in the future. */
export function parsePaidAt(s, nowMs) {
  if (typeof s !== 'string') return null;
  const m = ISO_UTC.exec(s);
  if (!m) return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  // No rollover: 2026-02-30 parses in some engines to 2 March; refuse it.
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() + 1 !== +m[2] || d.getUTCDate() !== +m[3] || d.getUTCHours() !== +m[4]
    || d.getUTCMinutes() !== +m[5] || d.getUTCSeconds() !== +m[6]) return null;
  if (ms < PAID_AT_FLOOR || ms > nowMs + MAX_SKEW_S * 1000) return null;
  return ms;
}

/**
 * Check the parsed body. Returns { ok: true, code, order } with the order rebuilt from the named
 * fields (paidAt as epoch ms), or { ok: false, field }.
 */
export function checkBody(body, nowMs) {
  if (!isPlain(body)) return { ok: false, field: 'body' };
  const top = onlyKeys(body, ['code', 'order'], '');
  if (top) return { ok: false, field: top };
  if (typeof body.code !== 'string' || !CODE_RE.test(body.code)) return { ok: false, field: 'code' };
  const o = body.order;
  if (!isPlain(o)) return { ok: false, field: 'order' };
  const bad = onlyKeys(o, ['orderNo', 'paidAt', 'titles', 'copies', 'amount', 'test'], 'order');
  if (bad) return { ok: false, field: bad };
  if (!isId('orderNo', o.orderNo)) return { ok: false, field: 'order.orderNo' };
  const paidAt = parsePaidAt(o.paidAt, nowMs);
  if (paidAt === null) return { ok: false, field: 'order.paidAt' };
  if (!Array.isArray(o.titles) || o.titles.length < 1 || o.titles.length > SHOP_TITLES.length
    || !o.titles.every((t) => typeof t === 'string' && SHOP_TITLES.includes(t))
    || new Set(o.titles).size !== o.titles.length) return { ok: false, field: 'order.titles' };
  if (!Number.isInteger(o.copies) || o.copies < 1 || o.copies > COPIES_MAX) return { ok: false, field: 'order.copies' };
  if (!isPlain(o.amount)) return { ok: false, field: 'order.amount' };
  const badAmount = onlyKeys(o.amount, ['value', 'currency'], 'order.amount');
  if (badAmount) return { ok: false, field: badAmount };
  if (!Number.isInteger(o.amount.value) || o.amount.value < AMOUNT_MIN || o.amount.value > AMOUNT_MAX) return { ok: false, field: 'order.amount.value' };
  if (o.amount.currency !== SHOP_CURRENCY) return { ok: false, field: 'order.amount.currency' };
  if (typeof o.test !== 'boolean') return { ok: false, field: 'order.test' };
  return {
    ok: true,
    code: body.code,
    order: {
      orderNo: o.orderNo,
      paidAt,
      titles: [...o.titles],
      copies: o.copies,
      amount: { value: o.amount.value, currency: SHOP_CURRENCY },
      test: o.test,
    },
  };
}

/** The stored record: the checked order and filedAt. Nothing else, ever. */
export const orderRecord = (order, filedAt) => ({
  orderNo: order.orderNo,
  paidAt: order.paidAt,
  titles: [...order.titles],
  copies: order.copies,
  amount: { value: order.amount.value, currency: order.amount.currency },
  test: order.test,
  filedAt,
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE FILING
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// io: { read(path) → { etag, value }, putIf(path, value, etag) → true | false (412) }
//
// 1. The code: shop_handoff_codes/{sha256 of the code string as received}, read with its ETag.
//      absent or malformed                → code_unknown
//      unused, exp <= now                 → code_expired
//      used for another order             → code_used_for_another_order
//      used for THIS order                → a retry: carry on (nothing re-consumed)
//      unused, in date                    → carry on, and consume it below
// 2. The index, print_order_index/{orderNo}: another account's → order_in_another_account (and an
//    unused code stays unused).
// 3. Consume: the code is REPLACED, in one conditional write on its ETag, by a used marker
//    { uid, exp, used: true, orderNo, usedAt }. A 412 means another call got there first: read again.
// 4. Claim the index for this account (create-only; if another account won the race, refuse).
// 5. Write the order, create-only. Created → filed. Already there → already_filed.
//
// So a retry after a lost reply finds its own marker (same order), its own index entry and its own
// order, and answers already_filed. A crash between steps leaves a state the retry completes.

export const SHOP_CODES_PATH = 'shop_handoff_codes';

export function classifyCode(c, orderNo, nowMs) {
  if (!isPlain(c) || typeof c.uid !== 'string' || !isId('uid', c.uid) || typeof c.exp !== 'number') return 'code_unknown';
  if (c.used === true) return c.orderNo === orderNo ? 'retry' : 'code_used_for_another_order';
  if (c.used !== undefined) return 'code_unknown';
  return c.exp <= nowMs ? 'code_expired' : 'fresh';
}

export async function fileOrder(io, { code, order, nowMs }) {
  const key = await sha256Hex(enc.encode(code));
  const codePath = `${SHOP_CODES_PATH}/${key}`;
  const indexPath = `${ORDER_INDEX_PATH}/${order.orderNo}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { etag: codeTag, value: c } = await io.read(codePath);
    const kind = classifyCode(c, order.orderNo, nowMs);
    if (kind !== 'fresh' && kind !== 'retry') return kind;
    const uid = c.uid;

    const idx = await io.read(indexPath);
    if (idx.value !== null && idx.value !== uid) return 'order_in_another_account';

    if (kind === 'fresh') {
      const marker = { uid, exp: c.exp, used: true, orderNo: order.orderNo, usedAt: nowMs };
      if (!(await io.putIf(codePath, marker, codeTag))) continue;   // someone else redeemed it: look again
    }

    if (idx.value === null && !(await io.putIf(indexPath, uid, idx.etag))) {
      const again = await io.read(indexPath);
      if (again.value !== uid) return 'order_in_another_account';
    }

    const created = await io.putIf(`${ORDERS_PATH}/${uid}/${order.orderNo}`, orderRecord(order, nowMs), 'null_etag');
    return created ? 'filed' : 'already_filed';
  }
  throw new Error('the code kept changing under three attempts');
}
