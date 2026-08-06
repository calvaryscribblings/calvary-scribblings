// Purchased-title streaming — Cloudflare Pages Function.
//
// POST /api/bookstore/stream
//   credential:  Authorization: Bearer <Firebase ID token>   (preferred)
//                or body { idToken }                          (the web reader; still works)
//   selector:    body { titleId } — or ?titleId= in the query string
//
//   → 200 { url, expiresAt, version, md5 }
//   → 401 { code: 'signed_out' }
//   → 403 { code: 'not_purchased' | 'revoked' }
//
// R9.10 — SERVING A NATIVE CLIENT. The Story Island app has a native Readium reader, opens
// purchased books directly, downloads the EPUB to disk and caches it. Two things it needed
// that the old response could not give:
//
//   1. `Authorization: Bearer` was IGNORED. Only body.idToken was read, so the app's call
//      shape fell into the missing-token branch and got a 401 with a valid token. The header
//      is now the preferred credential and the body field is the fallback, in that order, so
//      app/lib/bookstore/stream.js is untouched and keeps working byte-for-byte.
//
//   2. `version` — A STABLE PER-EPUB IDENTIFIER, and the load-bearing field here. The app
//      keys its on-device cache by it. It is the Cloud Storage object's `generation`, which
//      changes when and ONLY when the object is replaced. It is NOT derived from the request,
//      the clock, the signature or the token: two calls one second apart return the SAME
//      version and DIFFERENT urls, and there is a live probe proving exactly that. Get this
//      wrong and every open re-downloads the whole book.
//
//      `generation` rather than `md5Hash` because generation is ALWAYS present — GCS omits
//      md5Hash on composite objects, and a field that can silently vanish is the hole we keep
//      finding. md5Hash rides along as `md5` for optional post-download integrity checking,
//      since the metadata read is already paid for.
//
//      `version: null` IS A STATED FACT, NOT AN OMISSION. If the metadata read fails, the url
//      is still returned and version/md5 are explicitly null. An absent key is ambiguous — old
//      build? error? not implemented? — where an explicit null is something the app can branch
//      on, and its contract is DO NOT CACHE: re-download for that session. A redundant
//      download is a far cheaper error than caching a book under a guessed key, which would
//      serve a stale copy forever. Refusing a paid-for book because a metadata read hiccuped
//      is the worst option of the three, so this path never fails the request — but it logs
//      loudly, because a persistent breakage would otherwise be invisible and cost every
//      reader a re-download on every open.
//
// The title's RTDB key IS the selector. `titleId` and the title's `slug` field are the same
// string on every live title — slugify() in app/lib/bookstore/admin-writes.js produces the
// key — so there is no second namespace to support; `slug` is accepted as a body/query alias
// purely so a caller that reaches for the familiar name is not met with a 400.
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
// NO TERRITORY CHECK HERE, DELIBERATELY (R8.4). checkout.js and paystack-checkout.js refuse to
// SELL a title outside its licensed territories; this endpoint does not refuse to OPEN one that
// was already bought, and it never should. A territory restriction governs the sale — where a
// publisher may offer the book — not the copy. A reader who buys in London and opens the book
// on a plane, on holiday, or after emigrating owns the same book they owned at the till, and a
// shop that took their money and then locked the file because they crossed a border has sold
// them something it then took away. That is not licence enforcement; it is a broken product.
//
// The check is therefore ABSENT ON PURPOSE rather than forgotten, and there is a test that
// fails if someone adds one — see tests/bookstore/territory.test.mjs, "ownership survives
// travel". If a publisher ever genuinely requires geo-locked reading, that is a new contract
// term, a new field and a conversation, not a line quietly added here.
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
  STORAGE_READ_SCOPE,
  SCOPES,
  FIREBASE_TIMEOUT_MS,
  PROVIDER_TIMEOUT_MS,
} from './_lib.js';

const PURCHASES_PATH = 'bookstore_purchases';

const SIGNED_URL_TTL_SECONDS = 300;

// The admin token this endpoint mints carries the two shared scopes PLUS read-only Cloud
// Storage, so ONE token serves both the purchase read and the object-metadata read. Minting a
// second token for the metadata call would double the OAuth round-trips on every book open.
const STREAM_SCOPES = `${SCOPES} ${STORAGE_READ_SCOPE}`;

/**
 * The object's `generation` and `md5Hash`, or nulls if it cannot be read.
 *
 * NEVER THROWS, and that is the contract: the caller has already proved entitlement, so a
 * metadata hiccup must not stand between a reader and a book they paid for. Returns nulls and
 * logs; stream.js turns that into an explicit `version: null`, which the app reads as
 * do-not-cache.
 *
 * PROVIDER_TIMEOUT_MS rather than FIREBASE_TIMEOUT_MS: this is a Google API across the public
 * internet, the same class as the OAuth exchange in mintAccessToken, not a same-region RTDB
 * lookup. See the two-budget note in _lib.js.
 */
async function readObjectVersion({ bucket, objectPath, token }) {
  try {
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}`
      + `/o/${encodeURIComponent(objectPath)}?fields=generation,md5Hash`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GCS metadata GET failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const meta = await res.json();
    // generation is a decimal string in the JSON API and must stay a string — it exceeds
    // Number.MAX_SAFE_INTEGER, so parsing it would quietly corrupt the cache key.
    const version = typeof meta?.generation === 'string' && meta.generation ? meta.generation : null;
    if (!version) throw new Error(`GCS metadata carried no generation: ${JSON.stringify(meta).slice(0, 200)}`);
    return { version, md5: typeof meta?.md5Hash === 'string' && meta.md5Hash ? meta.md5Hash : null };
  } catch (e) {
    // LOUD on purpose. Silently degrading to version:null costs every reader a re-download on
    // every open, which is invisible from the outside — this line is the only thing that makes
    // a persistent breakage findable.
    console.error(`[bookstore/stream] version lookup FAILED for ${objectPath} — serving version:null:`, e.message || e);
    return { version: null, md5: null };
  }
}

/**
 * The ID token, preferring `Authorization: Bearer` over the body field.
 *
 * The native app sends the header; the web reader (app/lib/bookstore/stream.js) sends the body
 * field and is deliberately left alone. Header first because it is the one a proxy or SDK will
 * set for you, and because a caller sending both means the header.
 */
function readIdToken(request, body) {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (m && m[1].trim()) return m[1].trim();
  const fromBody = body?.idToken;
  return typeof fromBody === 'string' && fromBody ? fromBody : null;
}

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

  // A body is now OPTIONAL — the native client may carry the credential in the Authorization
  // header and the selector in the query string, and would otherwise 400 on an empty body. A
  // body that is PRESENT BUT MALFORMED still 400s exactly as before; that is a caller bug and
  // swallowing it would hide it.
  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) {
    try { body = JSON.parse(raw); }
    catch { return json({ error: 'Invalid request body.' }, 400); }
  }

  const idToken = readIdToken(request, body);

  // titleId is canonical. `slug` is accepted as an alias because the two are the same string
  // on every live title (see the header note) — a caller reaching for the familiar name gets
  // the book rather than a 400.
  const query = new URL(request.url).searchParams;
  const titleId = body?.titleId || body?.slug || query.get('titleId') || query.get('slug');

  if (!idToken) {
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
    token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, STREAM_SCOPES);
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

  // AFTER the entitlement check, deliberately: a caller who does not own the book learns
  // nothing about the object, not even that it exists.
  const { version, md5 } = await readObjectVersion({ bucket, objectPath, token });

  console.log(
    `[bookstore/stream] signed uid=${uid} titleId=${titleId} ttl=${SIGNED_URL_TTL_SECONDS}s version=${version ?? 'null'}`,
  );
  // version/md5 are ALWAYS present as keys, null when unknown. See the header note: an
  // explicit null is a fact the app branches on; an omitted key is a guess.
  return json({ url: signed.url, expiresAt: signed.expiresAt, version, md5 });
}
