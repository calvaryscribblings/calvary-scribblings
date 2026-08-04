// Bookstore checkout, NGN rail — Cloudflare Pages Function.
//
// POST /api/bookstore/paystack-checkout   body: { idToken, titleId }
//   → 200 { url, reference }   a Paystack authorization URL to send the browser to
//
// The twin of checkout.js, and it exists because Stripe cannot settle naira. Everything
// checkout.js says about the two rules that matter applies here verbatim:
//
//   1. The uid comes from a VERIFIED Firebase ID token, never from the request body.
//   2. The amount comes from bookstore_titles/{titleId}.prices.ngn, read server-side, in
//      kobo, used as stored. A client-supplied amount is a client-supplied discount.
//
// NO CURRENCY CONVERSION ANYWHERE. There is no FX rate in this file, in the client, or in
// the webhook. A title is sellable in naira if and only if someone typed an NGN price into
// /admin/bookstore; otherwise this endpoint says so honestly (409 not_priced_in_ngn) rather
// than inventing a number from the GBP price. A rate baked in at deploy time is a rate that
// is wrong by the time it is charged.
//
// NO CURRENCY PARAMETER either, unlike checkout.js. This endpoint IS the naira rail — the
// currency is a property of which endpoint you called, not something to negotiate.
//
// No Paystack SDK: the Workers runtime cannot pull one in without bundling, and the REST API
// is two JSON calls. Same reasoning as the hand-rolled Stripe integration next door.

import {
  json,
  dbBase,
  lookupUser,
  buildPaystackReference,
  REF_SAFE_TITLE_ID,
  PROVIDER_TIMEOUT_MS,
  FIREBASE_TIMEOUT_MS,
} from './_lib.js';

const LABEL = 'bookstore/paystack-checkout';

const TITLES_PATH = 'bookstore_titles';
const PUBLISHERS_PATH = 'bookstore_publishers';

// Documented at https://paystack.com/docs/api/transaction/ — POST, JSON, Bearer secret key.
export const PAYSTACK_INITIALIZE_API = 'https://api.paystack.co/transaction/initialize';

const DEFAULT_ORIGIN = 'https://calvaryscribblings.co.uk';

/**
 * The stored NGN price, or the reason there isn't one. Pure, so the harness can assert the
 * 409 contract without a network — and so the "no price" case is a named branch rather than
 * a fall-through that quietly charges zero.
 *
 * Kobo, integer. Paystack's smallest unit for NGN is the kobo exactly as Stripe's for GBP is
 * the penny, so the stored integer goes to the API untouched.
 */
export function selectNgnAmount(title) {
  const amount = title?.prices?.ngn;
  if (!Number.isInteger(amount) || amount <= 0) {
    return {
      ok: false,
      status: 409,
      code: 'not_priced_in_ngn',
      error: 'This book is not yet priced in naira. Please buy it in pounds instead.',
    };
  }
  return { ok: true, amount };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const fbDb = dbBase(env);
  const origin = (env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');

  if (!env.PAYSTACK_SECRET_KEY) {
    console.error(`[${LABEL}] PAYSTACK_SECRET_KEY is not set`);
    return json({ error: 'Naira payments are not configured yet. Please try again later.' }, 500);
  }
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error(`[${LABEL}] NEXT_PUBLIC_FIREBASE_API_KEY is not set`);
    return json({ error: 'Purchasing is not configured yet. Please try again later.' }, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  const { idToken, titleId } = body || {};

  if (!idToken || typeof idToken !== 'string') return json({ error: 'Sign in to buy this book.' }, 401);
  if (!titleId || typeof titleId !== 'string') return json({ error: 'titleId required.' }, 400);

  // ── identity ───────────────────────────────────────────────────────────────
  // The full user record rather than just the uid: Paystack requires a customer email at
  // initialize, and it must be the address Firebase holds for the verified account. Taking it
  // from the body would let a buyer post someone else's receipt address.
  const user = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const uid = user?.localId;
  if (!uid) return json({ error: 'Your session has expired. Please sign in again.' }, 401);

  const email = typeof user.email === 'string' ? user.email.trim() : '';
  if (!email) {
    // Anonymous and phone-only accounts land here. Paystack has nowhere to send a receipt,
    // and inventing a placeholder address would break the buyer's own refund trail.
    return json(
      {
        error: 'Add an email address to your account before buying in naira.',
        code: 'no_email',
      },
      400,
    );
  }

  // ── the title, and its price ───────────────────────────────────────────────
  // bookstore_titles is world-readable (database.rules.json), so this needs no credential.
  let title;
  try {
    const res = await fetch(`${fbDb}/${TITLES_PATH}/${encodeURIComponent(titleId)}.json`,
      { signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${res.status}`);
    title = await res.json();
  } catch (e) {
    console.error(`[${LABEL}] title read failed:`, e.message || e);
    return json({ error: 'Could not reach the catalogue. Please try again.' }, 502);
  }

  if (!title || typeof title !== 'object') return json({ error: 'That title is not in the catalogue.' }, 404);
  if (title.status !== 'published') return json({ error: 'That title is not on sale.' }, 403);

  // The publisher suspension cascade, identical to checkout.js: fail OPEN on a read error
  // (a transient Firebase blip must not stop sales), CLOSED on a definite non-active status.
  if (title.publisherId) {
    try {
      const pres = await fetch(`${fbDb}/${PUBLISHERS_PATH}/${encodeURIComponent(title.publisherId)}.json`,
        { signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS) });
      if (pres.ok) {
        const pub = await pres.json();
        if (pub && pub.status && pub.status !== 'active') {
          return json({ error: 'That title is not on sale.' }, 403);
        }
      }
    } catch {
      // fall through — see above
    }
  }

  const priced = selectNgnAmount(title);
  if (!priced.ok) {
    console.error(`[${LABEL}] title ${titleId} has no usable ngn price:`, title.prices?.ngn);
    return json({ error: priced.error, code: priced.code }, priced.status);
  }
  const amount = priced.amount;

  // ── the reference ──────────────────────────────────────────────────────────
  // Minted here, not by Paystack, because it is the only identifier guaranteed to appear on
  // every later event about this transaction. See the format note in _lib.js.
  if (!REF_SAFE_TITLE_ID.test(titleId)) {
    console.error(`[${LABEL}] titleId ${titleId} cannot be encoded in a Paystack reference`);
    return json(
      { error: 'This title cannot be purchased in naira.', code: 'unsupported_title_id' },
      400,
    );
  }

  let reference;
  try {
    reference = buildPaystackReference(uid, titleId);
  } catch (e) {
    console.error(`[${LABEL}] reference build failed for ${uid}/${titleId}:`, e.message || e);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 500);
  }

  // ── the Paystack transaction ───────────────────────────────────────────────
  const slug = typeof title.slug === 'string' && title.slug ? title.slug : titleId;

  // Paystack appends ?reference= and ?trxref= to this on return, so the detail page sees both
  // its own marker and the transaction. The page shows "success" optimistically; the WEBHOOK
  // is what actually grants the book. A reader who closes the tab still gets their purchase.
  const callbackUrl = `${origin}/bookstore/${slug}?purchase=success`;

  const payload = {
    email,
    amount,              // kobo, verbatim from the catalogue
    currency: 'NGN',
    reference,
    callback_url: callbackUrl,
    // Belt to the reference's braces: charge.success carries this back, and it is the
    // fallback identity when a reference somehow fails to parse.
    metadata: { uid, titleId },
  };

  let result;
  try {
    const res = await fetch(PAYSTACK_INITIALIZE_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    result = await res.json();
    if (!res.ok || result?.status !== true) {
      const msg = result?.message || `HTTP ${res.status}`;
      console.error(`[${LABEL}] initialize failed for ${titleId}:`, msg);
      return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
    }
  } catch (e) {
    console.error(`[${LABEL}] Paystack request failed:`, e.message || e);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
  }

  const url = result?.data?.authorization_url;
  if (!url) {
    console.error(`[${LABEL}] Paystack returned no authorization_url for ${reference}`);
    return json({ error: 'Checkout could not be opened. Please try again.' }, 502);
  }

  console.log(`[${LABEL}] initialized ${reference} uid=${uid} titleId=${titleId} ngn/${amount}`);
  return json({ url, reference });
}
