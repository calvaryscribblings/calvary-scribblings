// Purchased-title streaming — Cloudflare Pages Function.
//
// POST /api/bookstore/stream   body: { idToken, titleId }
//   → 200 { url, expiresAt }   a ~5-minute GCS V4 signed URL for the master EPUB
//   → 401                      no/expired id token
//   → 403 { code: 'not_purchased' | 'revoked' }
//
// This is the other half of the loop R5 opened: checkout.js takes the money, stripe-webhook.js
// records the grant, and this hands over the bytes. It is the ONLY path to master.epub —
// storage.rules keeps `allow read: if false` on that object and R5b does not touch it. A signed
// URL is a Cloud-Storage-level grant evaluated before Firebase's rule layer, so the two
// coexist by design rather than by accident. If a download breaks, suspect the signature or
// the bucket CORS config (scripts/bookstore-set-cors.mjs), never the rules.
//
// THREE THINGS THIS ENDPOINT EXISTS TO ENFORCE:
//
//   1. The uid comes from a VERIFIED Firebase ID token, never from the request body. Same rule
//      as checkout.js, for the same reason inverted: there, a body-supplied uid buys a book
//      into someone else's library; here it reads one out of theirs.
//
//   2. The purchase is read with an ADMIN token, not the caller's. bookstore_purchases is
//      written only by the webhook, and reading it server-side means the entitlement decision
//      never passes through a client that could lie about it.
//
//   3. status must be exactly 'active'. The webhook writes 'revoked' on refunds and disputes,
//      and a refunded reader keeping the book forever is the failure this check prevents. The
//      two 403 codes are distinguished so the reader is told the truth: 'not_purchased' is an
//      invitation to buy, 'revoked' is not.
//
// The signed URL is short-lived (300s) on purpose. It only has to survive the one fetch the
// Reading Room makes at load; nothing holds it afterwards. The client re-requests once on a
// failed fetch (see app/reader/[slug]/book-reader.js) rather than the server issuing something
// long-lived that could be pasted into a group chat.

import {
  json,
  dbBase,
  verifyIdToken,
  mintAccessToken,
  signGetUrl,
  STORAGE_BUCKET,
  FIREBASE_TIMEOUT_MS,
} from './_lib.js';

const PURCHASES_PATH = 'bookstore_purchases';

const SIGNED_URL_TTL_SECONDS = 300;

// titleId is a slug produced by slugify() in app/lib/bookstore/admin-writes.js, so this is
// generous rather than tight. It exists to stop a crafted id from walking out of
// bookstore_epubs/ and signing a URL for some other object in the bucket.
const TITLE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    console.error('[bookstore/stream] NEXT_PUBLIC_FIREBASE_API_KEY is not set');
    return json({ error: 'Reading is not configured yet. Please try again later.' }, 500);
  }
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error('[bookstore/stream] Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY');
    return json({ error: 'Reading is not configured yet. Please try again later.' }, 500);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  const { idToken, titleId } = body || {};

  if (!idToken || typeof idToken !== 'string') {
    return json({ error: 'Sign in to read this book.', code: 'signed_out' }, 401);
  }
  if (!titleId || typeof titleId !== 'string' || !TITLE_ID_RE.test(titleId)) {
    return json({ error: 'titleId required.' }, 400);
  }

  // ── identity ───────────────────────────────────────────────────────────────
  const uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) {
    return json({ error: 'Your session has expired. Please sign in again.', code: 'signed_out' }, 401);
  }

  // ── entitlement ────────────────────────────────────────────────────────────
  let token;
  try {
    token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
  } catch (e) {
    console.error('[bookstore/stream] admin token mint failed:', e.message || e);
    return json({ error: 'Could not open your copy just now. Please try again.' }, 502);
  }

  let purchase;
  try {
    const url = `${dbBase(env)}/${PURCHASES_PATH}/${encodeURIComponent(uid)}/${encodeURIComponent(titleId)}.json`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`RTDB GET failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    purchase = await res.json();
  } catch (e) {
    // Fail CLOSED. A read error here is indistinguishable from "no purchase", and the safe
    // reading of an unknown entitlement is to withhold the file, not hand it over. 502 rather
    // than 403 so the client shows "try again" instead of "buy this book".
    console.error(`[bookstore/stream] purchase read failed for ${uid}/${titleId}:`, e.message || e);
    return json({ error: 'Could not open your copy just now. Please try again.' }, 502);
  }

  if (!purchase || typeof purchase !== 'object') {
    return json({ error: 'You do not own this book yet.', code: 'not_purchased' }, 403);
  }
  if (purchase.status !== 'active') {
    return json(
      { error: 'Access to this book has been withdrawn.', code: 'revoked', reason: purchase.revokedReason || null },
      403,
    );
  }

  // ── the bytes ──────────────────────────────────────────────────────────────
  // Canonical path, matching uploadEpub() in app/lib/bookstore/admin-writes.js, which is the
  // only writer. The title doc's epubPath field records the same string; it is not read here
  // because a second RTDB round-trip to learn a constant would cost latency on every open.
  const objectPath = `bookstore_epubs/${titleId}/master.epub`;
  const bucket = env.FIREBASE_STORAGE_BUCKET || STORAGE_BUCKET;

  let signed;
  try {
    signed = await signGetUrl({
      bucket,
      objectPath,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKeyPem: env.FIREBASE_PRIVATE_KEY,
      expiresSeconds: SIGNED_URL_TTL_SECONDS,
    });
  } catch (e) {
    console.error(`[bookstore/stream] signing failed for ${objectPath}:`, e.message || e);
    return json({ error: 'Could not open your copy just now. Please try again.' }, 500);
  }

  console.log(`[bookstore/stream] signed uid=${uid} titleId=${titleId} ttl=${SIGNED_URL_TTL_SECONDS}s`);
  return json({ url: signed.url, expiresAt: signed.expiresAt });
}
