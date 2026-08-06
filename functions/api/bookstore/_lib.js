// Shared server-side helpers for the bookstore Pages Functions.
//
// NOT A ROUTE. Cloudflare Pages excludes underscore-prefixed files from Functions routing,
// so this module is bundled into its importers and never served. It also exports no
// onRequest* handler, so even if that convention ever changed the worst case is a 404.
//
// Everything here was lifted verbatim out of checkout.js and stripe-webhook.js when
// stream.js became the third caller. Two copies of an RS256 JWT minter is a drift risk;
// three is a certainty. The behaviour is unchanged from the originals — this is a move,
// not a rewrite, and the money paths above it must keep working byte-for-byte.

export const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// The bucket the app actually uses — app/lib/firebaseCore.js. Firebase's newer projects hand
// out `<project>.firebasestorage.app` rather than the legacy `<project>.appspot.com`, and the
// two are DIFFERENT buckets. Signing against the wrong one yields a URL that authenticates
// perfectly and 404s.
export const STORAGE_BUCKET = 'calvary-scribblings.firebasestorage.app';

export const SCOPES = [
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// R9.10: read-only Cloud Storage, for reading an object's `generation` — the per-EPUB
// version stream.js hands the native app so it can cache the file on disk. Deliberately
// NOT added to SCOPES above: the money paths (checkout, both webhooks) keep the exact
// two-scope credential they have always minted, and only stream.js opts in by passing
// this to mintAccessToken(). read_only, so the widened token still cannot write bytes.
export const STORAGE_READ_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

// ──────────────────────────────────────────────────────────────────────────
// OUTBOUND TIMEOUTS — R9.1 LB-10.
//
// Every fetch() in the bookstore surface carries one. Without a signal, fetch has NO default
// timeout: a provider that accepts the connection and then stops talking holds the request
// until the platform kills the invocation, and Cloudflare kills it by wall-clock, not by
// anything this code can catch. On a checkout that is a reader staring at a dead button; on a
// webhook it is a non-2xx that makes Stripe or Paystack retry a request that already moved
// money.
//
// TWO BUDGETS, chosen by who is on the other end:
//
//   PROVIDER_TIMEOUT_MS (10s)  Stripe, Paystack, Google Identity Toolkit, Google OAuth.
//                              Third-party APIs across the public internet, some of which do
//                              real work (card authorisation) before answering. 10s is long
//                              enough that a slow-but-working provider still completes.
//
//   FIREBASE_TIMEOUT_MS (5s)   RTDB REST, same region (europe-west1), no computation beyond a
//                              key lookup. A healthy call is single-digit milliseconds; 5s
//                              means something is wrong, and waiting longer will not fix it.
//
// AbortSignal.timeout() rejects with a TimeoutError DOMException, which every call site below
// already handles the same way it handles a connection error — so adding these changes NO
// fail-posture. That is deliberate and load-bearing: the webhooks still answer 200 once a
// signature has verified, because the money has already moved and a retry storm helps nobody.
// ──────────────────────────────────────────────────────────────────────────

export const PROVIDER_TIMEOUT_MS = 10_000;
export const FIREBASE_TIMEOUT_MS = 5_000;

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const dbBase = (env) => (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');

// ──────────────────────────────────────────────────────────────────────────
// Identity. An Identity Toolkit accounts:lookup round-trip keyed by
// NEXT_PUBLIC_FIREBASE_API_KEY — the pattern functions/api/record-attempt.js established.
// That key name looks alarming in a server file and is not a secret: Firebase Web API keys
// are public project identifiers shipped in every client bundle. The id token is the
// credential, and it is what gets verified.
// ──────────────────────────────────────────────────────────────────────────

// R8.2: the lookup body is now reachable on its own, because the Paystack rail needs the
// verified user's EMAIL as well as the uid — Paystack's initialize call requires an email and
// it must be the one Firebase holds, not one the browser typed. verifyIdToken keeps its exact
// previous contract (uid string or null) and is now a projection of this.
export async function lookupUser(token, apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.users?.[0] ?? null;
}

export async function verifyIdToken(token, apiKey) {
  const user = await lookupUser(token, apiKey);
  return user?.localId ?? null;
}

// ──────────────────────────────────────────────────────────────────────────
// Byte/encoding helpers.
// ──────────────────────────────────────────────────────────────────────────

export function b64url(input) {
  let str;
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes = new Uint8Array(input instanceof ArrayBuffer ? input : input.buffer);
    let bin = '';
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    str = btoa(bin);
  } else {
    str = btoa(input);
  }
  return str.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function bytesToHex(bytes) {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let hex = '';
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
  return hex;
}

export function pemToArrayBuffer(pem) {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

// Secrets paste in with literal `\n` rather than newlines when the value was copied out of the
// JSON-escaped service-account file — normalise so the PEM parser is happy.
export function normalisePem(privateKeyPem) {
  return privateKeyPem.includes('\\n') ? privateKeyPem.replace(/\\n/g, '\n') : privateKeyPem;
}

export async function importSigningKey(privateKeyPem) {
  return crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(normalisePem(privateKeyPem)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Firebase service-account OAuth token minting (RS256 via Web Crypto).
//
// The resulting token carries Admin privilege and bypasses security rules entirely, which is
// why bookstore_purchases is written and read here rather than in the browser. Do not relax
// database.rules.json to make anything easier: the rules ARE the boundary for everyone else.
// ──────────────────────────────────────────────────────────────────────────

// `scope` defaults to SCOPES, so every existing caller mints exactly the token it minted
// before — this parameter is additive and changes nothing for checkout or either webhook.
export async function mintAccessToken(clientEmail, privateKeyPem, scope = SCOPES) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await importSigningKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  const { access_token } = await res.json();
  return access_token;
}

// ──────────────────────────────────────────────────────────────────────────
// GCS V4 signed URLs.
//
// Signed with the SAME service-account key as the OAuth token above, but there is no token
// exchange — the signature IS the credential, computed locally and verified by GCS on
// arrival. That is what makes it usable from a Worker with no SDK.
//
// A signed URL bypasses Firebase Storage rules by design: it is a Google-Cloud-level grant,
// evaluated before Firebase's rule layer ever sees the request. That is precisely why
// bookstore_epubs/{titleId}/master.epub can keep `allow read: if false` in storage.rules —
// no browser can reach it, and the only path to the bytes runs through an endpoint that has
// checked the purchase first. Do NOT "fix" the rules to make a download work; if a download
// is failing, the signature or the CORS config is wrong, not the rules.
// ──────────────────────────────────────────────────────────────────────────

const SIGNING_HOST = 'storage.googleapis.com';

// RFC 3986, which is stricter than encodeURIComponent: the six characters below are
// "unreserved" to JS and reserved to Google's canonicaliser. Leaving them raw produces a
// canonical request that differs from the one GCS reconstructs, and the signature fails with
// a message that names none of this.
function encodeRFC3986(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// Path segments are encoded individually so the separators survive.
const encodePath = (p) => p.split('/').map(encodeRFC3986).join('/');

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(digest);
}

/**
 * Mint a V4 signed GET URL for a Cloud Storage object.
 *
 * Path-style (`storage.googleapis.com/<bucket>/<object>`) rather than virtual-hosted style,
 * deliberately: the bucket name is `calvary-scribblings.firebasestorage.app`, and
 * `calvary-scribblings.firebasestorage.app.storage.googleapis.com` is a multi-label host that
 * Google's wildcard certificate does not cover. Virtual-hosted style would fail TLS before it
 * ever failed auth.
 */
export async function signGetUrl({ bucket, objectPath, clientEmail, privateKeyPem, expiresSeconds = 300 }) {
  const issuedAt = Date.now();
  // GCS wants basic-format ISO 8601: 20260728T101530Z.
  const stamp = new Date(issuedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const datestamp = stamp.slice(0, 8);
  const credentialScope = `${datestamp}/auto/storage/goog4_request`;

  const canonicalUri = `/${encodePath(bucket)}/${encodePath(objectPath)}`;

  const params = {
    'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
    'X-Goog-Credential': `${clientEmail}/${credentialScope}`,
    'X-Goog-Date': stamp,
    'X-Goog-Expires': String(expiresSeconds),
    'X-Goog-SignedHeaders': 'host',
  };
  // Sorted by encoded key — required, and already alphabetical above; the sort is here so a
  // future added parameter cannot silently break the signature.
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${encodeRFC3986(k)}=${encodeRFC3986(params[k])}`)
    .join('&');

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    `host:${SIGNING_HOST}\n`, // canonical headers block ends with its own newline
    'host',                   // signed headers
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'GOOG4-RSA-SHA256',
    stamp,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const key = await importSigningKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(stringToSign),
  );

  return {
    url: `https://${SIGNING_HOST}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${bytesToHex(sig)}`,
    expiresAt: issuedAt + expiresSeconds * 1000,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// PURCHASE RECORDS — shared by both payment rails.
//
// R8.2 lifted this block verbatim out of stripe-webhook.js when paystack-webhook.js became
// the second writer. A purchase record is the only thing standing between a reader and a
// book they paid for; two hand-copies of the code that writes it is how a reader ends up
// with a shelf that renders on one rail and not the other. This is a MOVE — the Stripe
// path's behaviour is unchanged, and must stay unchanged.
//
// A record now carries EITHER stripeSessionId OR paystackRef, never both. Nothing reads
// either field except the webhook that wrote it (its own idempotency guard) — verified
// across app/my-library, app/reader and functions/api/bookstore/stream.js in R8.2. Anything
// added later that reads a rail-specific field must tolerate its absence.
// ──────────────────────────────────────────────────────────────────────────

export const PURCHASES_PATH = 'bookstore_purchases';
export const TITLES_PATH = 'bookstore_titles';

export const purchaseUrl = (env, uid, titleId) =>
  `${dbBase(env)}/${PURCHASES_PATH}/${encodeURIComponent(uid)}/${encodeURIComponent(titleId)}.json`;

export async function readPurchase(env, token, uid, titleId) {
  const res = await fetch(purchaseUrl(env, uid, titleId), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB GET failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// PATCH so we never clobber sibling fields a later flow might add (fulfilment notes,
// refund trails). A grant and a later revocation therefore layer on the same record.
export async function patchPurchase(env, token, uid, titleId, payload) {
  const res = await fetch(purchaseUrl(env, uid, titleId), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB PATCH failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}

// The full title record, read with the admin token. The Paystack rail needs the stored NGN
// price out of it to re-check the paid amount, and both rails need the four display fields
// below — one read, not two. Never throws: a missing title costs the cosmetic fields (and,
// on the Paystack rail, the price cross-check), not the purchase.
export async function fetchTitleRecord(env, token, titleId, label) {
  try {
    const res = await fetch(
      `${dbBase(env)}/${TITLES_PATH}/${encodeURIComponent(titleId)}.json`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const t = await res.json();
    if (!t || typeof t !== 'object') return null;
    return t;
  } catch (e) {
    console.error(`[${label}] title lookup failed for ${titleId}:`, e.message || e);
    return null;
  }
}

// Denormalised display fields, so My Library can render a shelf without a second read and
// still shows something sane if the title doc is later renamed or removed. This mirrors the
// fallback chain in app/my-library/page.js.
export function denormalisedFields(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    slug: typeof t.slug === 'string' ? t.slug : null,
    title: typeof t.title === 'string' ? t.title : null,
    author: typeof t.author === 'string' ? t.author : null,
    coverUrl: typeof t.coverUrl === 'string' ? t.coverUrl : null,
  };
}

export async function fetchTitleFields(env, token, titleId, label) {
  return denormalisedFields(await fetchTitleRecord(env, token, titleId, label));
}

/**
 * The grant payload, identical in shape on both rails apart from which reference field
 * names the transaction. Pure so the harness can assert it without a network.
 */
export function buildGrantPayload({ amount, currency, refField, refValue, fields, extraRefs }) {
  return {
    purchasedAt: Date.now(),
    amount: typeof amount === 'number' ? amount : null,
    currency: currency || null,
    [refField]: refValue,
    // R9.1 LB-7: additional identifiers for the SAME transaction, so a later refund or
    // dispute can prove it is talking about this purchase. Only non-empty strings are
    // stored — a null here would sit in the record looking like a reference and compare
    // equal to nothing, which is the failure mode the guard below is built to avoid.
    ...Object.fromEntries(
      Object.entries(extraRefs || {}).filter(([, v]) => typeof v === 'string' && v),
    ),
    status: 'active',
    ...(fields || {}),
  };
}

export function buildRevokePayload(reason) {
  return {
    status: 'revoked',
    revokedAt: Date.now(),
    revokedReason: reason,
  };
}

/**
 * REPLAY PROTECTION — the one guard standing between a refunded reader and a book they no
 * longer own. Shared by both rails since R8.2.1, because both got it wrong the same way.
 *
 * THE RULE: skip whenever the stored record already names THIS transaction, whatever its
 * status. Otherwise write.
 *
 * That splits every incoming grant event into exactly two cases, and the whole bug lives in
 * failing to tell them apart:
 *
 *   REPLAY      Same reference as the stored one. Both providers deliver at least once —
 *               Stripe retries any non-2xx for 72 hours, Paystack for 72 hours too — so the
 *               SAME transaction can arrive again long after a refund revoked it. There is no
 *               new money here, so there is nothing to grant. SKIP, and skip *especially* when
 *               the record reads 'revoked': re-applying the payload would set status back to
 *               'active' and hand back a book that was paid back for.
 *
 *   REPURCHASE  Different reference. The reader bought the book AGAIN — commonly after a
 *               refund, which is exactly the case that looks identical from a distance. This
 *               is new money and a genuine entitlement. WRITE, and let status:'active' in the
 *               grant payload overwrite the old 'revoked'. This path is proven on glass and
 *               must keep working; a guard that refuses to write over any revoked record
 *               would silently take payment for a book it never delivered.
 *
 * WHAT THIS REPLACES (R8.1–R8.2, both rails): `existing[refField] === refValue && existing
 * .status === 'active'`. That trailing clause inverted the guard in the one case it existed
 * for — a replay against a revoked record failed the condition, fell through, and resurrected
 * the purchase. Status must play no part in the decision; the reference alone decides.
 *
 * refValue must be a non-empty string, so a pair of missing fields cannot compare equal and
 * skip a write that should have happened.
 */
export function shouldSkipGrant(existing, refField, refValue) {
  if (!existing || typeof existing !== 'object') return false;
  if (typeof refValue !== 'string' || !refValue) return false;
  return existing[refField] === refValue;
}

/**
 * REVOCATION MATCHING — R9.1 LB-7, the mirror image of shouldSkipGrant above.
 *
 * THE BUG THIS REPLACES: both rails used to PATCH status:'revoked' onto
 * bookstore_purchases/{uid}/{titleId} on the strength of uid + titleId alone. The stored
 * transaction reference was never consulted. That is fine right up until a reader refunds a
 * book and buys it again — after which the OLD charge's dispute can still arrive (Stripe and
 * Paystack both retry for up to 72 hours, and a bank dispute can be raised months later) and
 * revoke the NEW purchase the reader has just paid for. The record has room for exactly one
 * purchase per (uid, titleId), so a late event about a dead transaction is indistinguishable
 * from one about the live one unless the reference is checked.
 *
 * THE RULE: revoke ONLY when an identifier on the incoming event matches an identifier stored
 * on the record. Anything else writes NOTHING and is logged for manual review.
 *
 * Three verdicts, and the middle one is the whole point:
 *
 *   'revoke'  An incoming identifier matches a stored one. This event is about the purchase
 *             that is on the shelf. Take it away.
 *
 *   'review'  The record exists but nothing matches — the classic case being a dispute for an
 *             old charge arriving after a repurchase. Also covers a record written before
 *             R9.1 that carries no comparable identifier at all. WRITE NOTHING. Both
 *             references go to the log so a human can reconcile, and the webhook still
 *             answers 200: the event is genuine and retrying it would change nothing.
 *
 *   'absent'  No record at all. Nothing to revoke; a refund for a purchase that was never
 *             recorded is a reconciliation problem, not a write.
 *
 * FAIL-CLOSED ON REVOCATION, deliberately, and it is the opposite of the grant path's
 * posture. A failed idempotency read on a grant falls through to the write, because a
 * duplicate grant beats a paying reader with no book. Here the asymmetry reverses: if we
 * cannot PROVE the event is about the purchase on the shelf, the wrong write takes a paid-for
 * book away from someone who owns it. Leaving a refunded book readable until a human looks is
 * the cheaper error, and it is loud in the log rather than silent.
 *
 * refFields is a list because the Stripe rail stores two identifiers for one transaction: the
 * Checkout Session id it was bought under, and the PaymentIntent id, which is the only thing
 * a charge- or dispute-shaped event carries that reaches back to the session. Paystack needs
 * one, because its reference is on every event about a transaction by construction.
 */
export function storedReferences(existing, refFields) {
  if (!existing || typeof existing !== 'object') return [];
  return (refFields || [])
    .map((f) => existing[f])
    .filter((v) => typeof v === 'string' && v);
}

export const STRIPE_REF_FIELDS = ['stripeSessionId', 'stripePaymentIntent'];
export const PAYSTACK_REF_FIELDS = ['paystackRef'];

export function classifyRevocation(existing, refFields, candidates) {
  const incoming = (candidates || []).filter((v) => typeof v === 'string' && v);

  if (!existing || typeof existing !== 'object') {
    return { verdict: 'absent', stored: [], incoming };
  }

  const stored = storedReferences(existing, refFields);
  // Both sides must be non-empty. Two empty lists trivially "agree", and agreeing on nothing
  // is exactly how an unattributable event would revoke an arbitrary purchase.
  const matched = stored.length > 0 && incoming.length > 0
    && incoming.some((c) => stored.includes(c));

  return { verdict: matched ? 'revoke' : 'review', stored, incoming };
}

// ──────────────────────────────────────────────────────────────────────────
// Constant-time signature comparison. Both webhooks verify a hex-encoded HMAC — Stripe
// SHA-256, Paystack SHA-512 — so the byte plumbing is shared even though the schemes are not.
// ──────────────────────────────────────────────────────────────────────────

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

// Returns false straight away for length mismatches — the lengths themselves are not
// secret, so leaking that is fine.
export function timingSafeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ──────────────────────────────────────────────────────────────────────────
// PAYSTACK TRANSACTION REFERENCES.
//
// Paystack, unlike Stripe, gives us no client_reference_id and no guarantee that a refund or
// dispute event will carry the metadata we set at initialize time. The reference is the one
// identifier that is present on every event about a transaction, so we mint our own and make
// it self-describing: EVERY purchase must be reconcilable from the reference ALONE.
//
//   cs.<uid>.<titleId>.<nonce>
//
//   cs        fixed prefix, so a foreign reference is rejected rather than misparsed
//   uid       Firebase uid — [A-Za-z0-9], 28 chars in practice
//   titleId   the catalogue slug — slugify() in app/lib/bookstore/admin-writes.js emits
//             [a-z0-9-] only, so it can never contain the '.' separator
//   nonce     12 hex chars of CSPRNG, so a retried purchase of the same book by the same
//             reader is a distinct transaction rather than a Paystack duplicate-reference
//             rejection
//
// '.' is deliberate: Paystack permits only alphanumerics and -, . and = in a reference, and
// '-' is already spent inside slugs. Typical length is ~70 characters.
// ──────────────────────────────────────────────────────────────────────────

const PAYSTACK_REF_RE = /^cs\.([A-Za-z0-9]{1,64})\.([A-Za-z0-9-]{1,128})\.([a-f0-9]{8,32})$/;

// Guards on the way IN, so an id that would produce an unparseable reference is refused at
// checkout rather than discovered at reconciliation time, after the money has moved.
export const REF_SAFE_UID = /^[A-Za-z0-9]{1,64}$/;
export const REF_SAFE_TITLE_ID = /^[A-Za-z0-9-]{1,128}$/;

export function buildPaystackReference(uid, titleId, nonce) {
  if (!REF_SAFE_UID.test(uid || '')) throw new Error('uid is not reference-safe');
  if (!REF_SAFE_TITLE_ID.test(titleId || '')) throw new Error('titleId is not reference-safe');
  const n = nonce || bytesToHex(crypto.getRandomValues(new Uint8Array(6)));
  return `cs.${uid}.${titleId}.${n}`;
}

export function parsePaystackReference(ref) {
  const m = PAYSTACK_REF_RE.exec(typeof ref === 'string' ? ref : '');
  if (!m) return null;
  return { uid: m[1], titleId: m[2], nonce: m[3] };
}
