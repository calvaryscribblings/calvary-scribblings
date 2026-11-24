// POST /api/account/shop-code — SHOP-B2: mint the paperback shop's one-time handoff code.
// docs/ACCOUNT-CONTRACT.md §6.2 (a) and (b2).
//
//   Authorization: Bearer <Firebase ID token>
//   body { return, state }        return must be SHOP_RETURN_URL exactly, state 1–128 URL-safe
//
//   200 { code }                   43 characters, base64url; the page sends the reader to
//                                  returnHref(code, state). Cache-Control: no-store.
//   400 { code: 'bad_request' | 'bad_return' | 'bad_state' }
//   401 { code: 'signed_out' }     no token, or one Google does not accept
//   429 / 503                      the house limiter (limitResponse)
//   500 { code: 'unavailable' }    not configured, or the write failed — nothing is kept
//
// WHAT IT WRITES, AND NOTHING ELSE: shop_handoff_codes/{sha256(code), 64 lowercase hex} =
// { uid, exp }, uid the VERIFIED token's (never the body's), exp now + 5 minutes. The hash is taken
// over the code's 43 ASCII characters as sent to the shop, so B3 hashes the string it is handed.
// The record is built from those two names, never spread from anything. The write is a service-
// account write, which NO RULE binds (.validate included — §6.2 (b2)), so this code is the only
// check on its shape. It is conditional on the key being absent (if-match: null_etag): a code is
// never written over another, however impossible a 256-bit collision is.
//
// It also refuses a `return` that is not the one address, so no code is ever minted for a link the
// page itself would refuse (the page builds the address from the constant either way).
//
// LOGS CARRY COUNTS ONLY: never the code, its hash, the uid, the state, or an address. The limiter's
// own refusal line names the bucket as 'uid' / 'ip' (logAs), not the value.

import { consume, limitResponse, capFromEnv, clientIp } from '../_ratelimit.js';
import { lookupUser, mintAccessToken, dbBase, b64url, bytesToHex, SCOPES, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import { isAllowedReturn, isState, CODE_TTL_MS } from '../../../app/lib/shopHandoff.js';
import { SHOP_CODE_KEY } from './_deletion.js';
import { isId } from '../../../app/lib/ids.js';

const LABEL = 'account/shop-code';
export const SHOP_CODES_PATH = 'shop_handoff_codes';

// THE DERIVATION. A reader keeps an order once, after paying for it (ruling 403); a failed attempt,
// a second tab or a double tap makes it a handful. 5 a minute and 30 a day per reader is several
// times that. Per address, a household or a library shares one: 10 a minute and 100 a day. 2,000 a
// day across everyone is far above the shop's order volume and still bounds what a flood of fresh
// accounts could make this endpoint write (each code lives 5 minutes and is swept every 15).
export const SHOP_CODE_CAPS = (env, uid, ip) => ([
  { scope: 'shopcode', period: 'minute', id: uid, logAs: 'uid', limit: capFromEnv(env, 'SHOP_CODE_MINUTE_CAP', 5) },
  { scope: 'shopcode', period: 'day', id: uid, logAs: 'uid', limit: capFromEnv(env, 'SHOP_CODE_DAY_CAP', 30) },
  { scope: 'shopcode-ip', period: 'minute', id: ip, logAs: 'ip', limit: capFromEnv(env, 'SHOP_CODE_IP_MINUTE_CAP', 10) },
  { scope: 'shopcode-ip', period: 'day', id: ip, logAs: 'ip', limit: capFromEnv(env, 'SHOP_CODE_IP_DAY_CAP', 100) },
  { scope: 'shopcode', period: 'day', limit: capFromEnv(env, 'SHOP_CODE_GLOBAL_DAY_CAP', 2000) },
]);

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/** 32 random bytes, base64url without padding: 43 characters. */
export function mintCode() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The node's key for a code: SHA-256 over its ASCII characters, 64 lowercase hex. */
export async function codeKey(code) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))));
}

function readIdToken(request) {
  const m = /^Bearer\s+(\S+)$/i.exec((request.headers.get('Authorization') || '').trim());
  return m ? m[1] : null;
}

export const onRequestPost = (context) => handleShopCode(context);

/** `opts` is the test seam: `now`, `consume`, `mint`. */
export async function handleShopCode(context, { now = () => Date.now(), consume: charge = consume, mint = mintCode } = {}) {
  const { request, env } = context;
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error(`[${LABEL}] credentials not configured`);
    return reply({ code: 'unavailable' }, 500);
  }

  let body;
  try { body = JSON.parse(await request.text()); } catch { return reply({ code: 'bad_request' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ code: 'bad_request' }, 400);
  if (!isAllowedReturn(body.return)) return reply({ code: 'bad_return' }, 400);
  if (!isState(body.state)) return reply({ code: 'bad_state' }, 400);

  const idToken = readIdToken(request);
  if (!idToken) return reply({ code: 'signed_out' }, 401);
  const user = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
  const uid = user?.localId;
  // Google verified it; the house shape is checked too, as everywhere a uid could become a path.
  if (!isId('uid', uid)) return reply({ code: 'signed_out' }, 401);

  // Unattributable is refused, as at every other limited endpoint.
  const ip = clientIp(request);
  if (!ip) return limitResponse({ ok: false, reason: 'unavailable' });
  const limited = await charge(context, SHOP_CODE_CAPS(env, uid, ip));
  if (!limited.ok) {
    console.warn(`[${LABEL}] refused: ${limited.reason}`);
    return limitResponse(limited);
  }

  const code = mint();
  const key = await codeKey(code);
  if (!SHOP_CODE_KEY.test(key)) {   // cannot happen; the address is never built from anything else
    console.error(`[${LABEL}] key not addressable`);
    return reply({ code: 'unavailable' }, 500);
  }
  const record = { uid, exp: now() + CODE_TTL_MS };

  try {
    const token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'), SCOPES);
    const res = await fetch(`${dbBase(env)}/${SHOP_CODES_PATH}/${key}.json`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Firebase-ETag': 'true',
        'if-match': 'null_etag',
      },
      body: JSON.stringify({ uid: record.uid, exp: record.exp }),
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[${LABEL}] write refused: ${res.status}`);
      return reply({ code: 'unavailable' }, 500);
    }
  } catch (e) {
    console.error(`[${LABEL}] write failed: ${e?.name === 'TimeoutError' ? 'timed out' : 'error'}`);
    return reply({ code: 'unavailable' }, 500);
  }

  console.log(`[${LABEL}] minted 1`);
  return reply({ code });
}
