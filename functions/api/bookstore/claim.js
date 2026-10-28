// Bookstore free-title claim — Cloudflare Pages Function. FREE-TITLES, 28 Oct 2026.
//
// POST /api/bookstore/claim
//   credential:  Authorization: Bearer <Firebase ID token>   or body { idToken }
//   body:        { titleId }
//   → 200 { ok: true, granted: true }    the title is now in the reader's library
//   → 200 { ok: true, already: true }    it already was (a sale, a comp, or an earlier claim)
//   → 401 { code: 'signed_out' }
//   → 403 { code: 'not_on_sale' | 'not_in_territory' }
//   → 404 { code: 'not_found' }
//   → 409 { code: 'not_free' | 'busy' }
//
// Ikenna's ruling: a price of 0 in a currency means the title is FREE in that currency.
// Stripe and Paystack cannot take a zero charge, so a free title reaches a reader's library
// HERE, without checkout — and in every other respect exactly as a sale does.
//
// THE RULES THIS ENDPOINT KEEPS, all of them the checkout endpoints' own:
//
//   1. The uid comes from a VERIFIED Firebase ID token, never from the body.
//   2. The title is RE-READ here. Nothing about it — published, the price, the currency — is
//      taken from the client. The client sends a titleId and nothing else.
//   3. "Free for this reader" is decided by the SAME region authority checkout's territory
//      check reads: countryFrom() (request.cf.country, stamped at the edge), the currency that
//      country browses in, and priceFor()'s answer for it — app/lib/pricing.js regionPriceFor,
//      the function the shelf prints "Free" from. A currency in the body is ignored.
//   4. The licence: isTitleSellableIn(), the same matcher both tills use. A free book is still
//      a publisher's book, and "not sold in your region" covers giving it away.
//   5. THE GRANT GOES THROUGH patchPurchase() — the single function that writes a purchase
//      record and the readership count together, in one multi-path PATCH. So stream.js, My
//      Library and the public count treat it exactly as a sale: status 'active', rail 'free',
//      amount 0, and a reference derived from (uid, titleId) — freeRefFor().
//   6. No Stripe, no Paystack, no receipt. Nothing here talks to a payment provider.
//
// ── GRANTS ONCE, COUNTS ONCE ───────────────────────────────────────────────────────────────
//
// A retry after a success reads an ACTIVE record and writes nothing (200 already). That covers
// the double tap and the retry in sequence. Two requests IN FLIGHT at once would both read "no
// record", and readershipDelta would give each +1 — one library counted twice, the error the
// readership ruling says this shop cannot afford.
//
// So the decision is taken under a LOCK: a conditional PUT (if-match on the ETag) of a fresh
// nonce at bookstore_claim_locks/{titleId}/{uid}. Exactly one request can move a given ETag;
// the other gets 412 and answers from a re-read. The purchase record is read AFTER the lock is
// held — never before — so a request that arrives just as another releases still sees the grant.
// The lock is removed when the claim finishes, either way.
//
// WHY A SEPARATE NODE and not a field on the purchase record: a record holding only a lock (a
// worker killed between the lock and the grant) has no `status`, and My Library draws a record
// with no active status as "Access Withdrawn". A ghost withdrawn book on a reader's shelf is
// worse than a stale lock nobody sees. A stale lock blocks nothing: the next attempt reads its
// ETag and moves it like any other. The node has no rule in database.rules.json, so no client
// can read or write it; this endpoint's admin token is the only writer.
//
// ⭑ STANDING RULING, UNCHANGED: a title in a reader's library stays there. If a free title is
// later priced, readers who claimed it keep it — nothing here or anywhere revokes a free copy.

import {
  json,
  dbBase,
  verifyIdToken,
  mintAccessToken,
  readPurchase,
  patchPurchase,
  buildGrantPayload,
  denormalisedFields,
  FIREBASE_TIMEOUT_MS,
  TITLES_PATH,
} from './_lib.js';
import { countryFrom } from './region.js';
import { isTitleSellableIn } from '../../../app/lib/bookstore/territory.js';
import { holdsBook } from '../../../app/lib/bookstore/purchaseSource.js';
import { regionPriceFor, isFreePrice, freeRefFor, FREE_RAIL, FREE_REF_FIELD } from '../../../app/lib/pricing.js';

const LABEL = 'bookstore/claim';
const PUBLISHERS_PATH = 'bookstore_publishers';
export const CLAIM_LOCKS_PATH = 'bookstore_claim_locks';

// Same shape stream.js accepts — and narrow enough to be a safe RTDB path segment.
const TITLE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function readIdToken(request, body) {
  const auth = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1].trim();
  return typeof body?.idToken === 'string' && body.idToken ? body.idToken : null;
}

const lockUrl = (env, uid, titleId) =>
  `${dbBase(env)}/${CLAIM_LOCKS_PATH}/${encodeURIComponent(titleId)}/${encodeURIComponent(uid)}.json`;

/**
 * Take the claim lock. true = held; false = another request holds it (412). Throws on anything
 * else, which the caller treats as "could not decide safely" and refuses.
 */
async function takeLock(env, token, uid, titleId) {
  const url = lockUrl(env, uid, titleId);
  const get = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-Firebase-ETag': 'true' },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!get.ok) throw new Error(`lock read failed: ${get.status}`);
  const etag = get.headers.get('ETag');
  if (!etag) throw new Error('lock read returned no ETag');
  const put = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'if-match': etag, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce: crypto.randomUUID(), at: Date.now() }),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (put.status === 412) return false;
  if (!put.ok) throw new Error(`lock write failed: ${put.status}`);
  return true;
}

async function releaseLock(env, token, uid, titleId) {
  try {
    await fetch(lockUrl(env, uid, titleId), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
  } catch (e) {
    // Harmless: a stale lock blocks nothing (see the header). Logged, not surfaced.
    console.error(`[${LABEL}] lock release failed for ${uid}/${titleId}:`, e.message || e);
  }
}

/**
 * The free grant's payload. buildGrantPayload — the paid rails' own — with the free rail's
 * reference, amount 0, and the provider references NULLED: a free copy laid over a refunded
 * sale must not keep that sale's ids, or isSale() would count it as revenue and a late dispute
 * on the dead charge could match it and take the free copy away.
 */
export function buildFreeGrantPayload({ uid, titleId, currency, title }) {
  return buildGrantPayload({
    amount: 0,
    currency,
    refField: FREE_REF_FIELD,
    refValue: freeRefFor(uid, titleId),
    fields: {
      ...(denormalisedFields(title) || {}),
      rail: FREE_RAIL,
      stripeSessionId: null,
      stripePaymentIntent: null,
      paystackRef: null,
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error(`[${LABEL}] missing NEXT_PUBLIC_FIREBASE_API_KEY, FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY`);
    return json({ error: 'Adding books isn’t configured yet. Please try again later.' }, 500);
  }

  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) {
    try { body = JSON.parse(raw); }
    catch { return json({ error: 'Invalid request body.' }, 400); }
  }

  const idToken = readIdToken(request, body);
  if (!idToken) return json({ error: 'Sign in to add this book.', code: 'signed_out' }, 401);

  const titleId = body?.titleId;
  if (typeof titleId !== 'string' || !TITLE_ID_RE.test(titleId)) return json({ error: 'titleId required.' }, 400);

  // ── identity ───────────────────────────────────────────────────────────────
  const uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return json({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401);

  let token;
  try {
    token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
  } catch (e) {
    console.error(`[${LABEL}] admin token mint failed:`, e.message || e);
    return json({ error: 'Couldn’t add this book just now. Please try again.' }, 502);
  }

  // ── the title, re-read here ────────────────────────────────────────────────
  let title;
  try {
    const res = await fetch(`${dbBase(env)}/${TITLES_PATH}/${encodeURIComponent(titleId)}.json`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    title = await res.json();
  } catch (e) {
    console.error(`[${LABEL}] title read failed:`, e.message || e);
    return json({ error: 'Couldn’t reach the catalogue. Please try again.' }, 502);
  }
  if (!title || typeof title !== 'object') return json({ error: 'That title isn’t in the catalogue.', code: 'not_found' }, 404);
  if (title.status !== 'published') return json({ error: 'That title isn’t on sale.', code: 'not_on_sale' }, 403);

  // The /admin/publishers suspension cascade, as checkout keeps it: fail OPEN on a read error,
  // CLOSED on a definite non-active status.
  if (title.publisherId) {
    try {
      const pres = await fetch(`${dbBase(env)}/${PUBLISHERS_PATH}/${encodeURIComponent(title.publisherId)}.json`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
      });
      if (pres.ok) {
        const pub = await pres.json();
        if (pub && pub.status && pub.status !== 'active') {
          return json({ error: 'That title isn’t on sale.', code: 'not_on_sale' }, 403);
        }
      }
    } catch {
      // fall through — see above
    }
  }

  // ── territory, then price — checkout's order ───────────────────────────────
  const country = countryFrom(request);
  if (!isTitleSellableIn(title, country)) {
    console.warn(`[${LABEL}] refused ${titleId} uid=${uid} country=${country ?? 'unknown'} (territory)`);
    return json({ error: 'This title isn’t licensed for sale in your region.', code: 'not_in_territory' }, 403);
  }
  const priced = regionPriceFor(title, country);
  if (!isFreePrice(priced)) {
    return json({ error: 'This title isn’t free here. You can buy it from its page.', code: 'not_free' }, 409);
  }

  // ── the grant, under the lock ──────────────────────────────────────────────
  let held;
  try {
    held = await takeLock(env, token, uid, titleId);
  } catch (e) {
    console.error(`[${LABEL}] lock failed for ${uid}/${titleId}:`, e.message || e);
    return json({ error: 'Couldn’t add this book just now. Please try again.' }, 502);
  }

  if (!held) {
    // Another request for this reader and this title is mid-claim. Answer from the record.
    try {
      if (holdsBook(await readPurchase(env, token, uid, titleId))) return json({ ok: true, already: true });
    } catch { /* fall through */ }
    return json({ error: 'Adding this book — please try again in a moment.', code: 'busy' }, 409);
  }

  try {
    // Read AFTER the lock is held. FAIL CLOSED on a failed read, unlike the paid webhooks: no
    // money has moved, so "try again" costs the reader nothing, and a guess here could count
    // one library twice.
    let existing;
    try {
      existing = await readPurchase(env, token, uid, titleId);
    } catch (e) {
      console.error(`[${LABEL}] purchase read failed for ${uid}/${titleId}:`, e.message || e);
      return json({ error: 'Couldn’t add this book just now. Please try again.' }, 502);
    }

    // Already in the library — a sale, a comp, or an earlier claim. Write NOTHING: a comp stays
    // a comp, a sale stays a sale, and the count does not move.
    if (holdsBook(existing)) return json({ ok: true, already: true });

    const payload = buildFreeGrantPayload({ uid, titleId, currency: priced.currency, title });
    try {
      const { delta } = await patchPurchase(env, token, uid, titleId, payload, existing);
      console.log(`[${LABEL}] granted ${titleId} uid=${uid} ${priced.currency}/0 readership${delta >= 0 ? '+' : ''}${delta}`);
    } catch (e) {
      console.error(`[${LABEL}] grant write failed for ${uid}/${titleId}:`, e.message || e);
      return json({ error: 'Couldn’t add this book just now. Please try again.' }, 502);
    }
    return json({ ok: true, granted: true });
  } finally {
    await releaseLock(env, token, uid, titleId);
  }
}
