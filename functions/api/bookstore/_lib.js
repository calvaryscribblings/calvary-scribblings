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

export async function verifyIdToken(token, apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.users?.[0]?.localId ?? null;
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

export async function mintAccessToken(clientEmail, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: SCOPES,
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
