// R9.10 — THE NATIVE-CLIENT CONTRACT for /api/bookstore/stream.
//
//   node --test tests/bookstore/stream-version.test.mjs      (npm run test:purchases)
//
// The Story Island app has a native Readium reader: it opens a purchased book, downloads the
// EPUB to disk and caches it. Two properties of the response make that possible, and both are
// the kind that look fine in a manual poke and break silently in production.
//
// THE LOAD-BEARING ONE: `version` must change when and ONLY when the EPUB file changes. If it
// varies per request — a timestamp, a signature fragment, anything derived from the call —
// the app's cache key changes on every open and every open re-downloads the whole book. That
// failure is invisible server-side: the endpoint returns 200 every time and looks perfectly
// healthy while every reader burns their data allowance. The test that matters is therefore
// "same book twice → SAME version, DIFFERENT urls", asserted together, because a constant
// that never changes and a url that never changes are both wrong in the opposite direction.
//
// THE OTHER: `Authorization: Bearer` was ignored before R9.10. Only body.idToken was read, so
// the app's call shape hit the missing-token branch and got a 401 holding a perfectly valid
// token. Header and body are both asserted here, because the web reader still sends the body
// field and must not be collateral damage.
//
// Offline and host-independent. Every outbound call is stubbed, which is what lets the
// metadata-failure case be tested at all — the one path that cannot be produced on demand
// against live GCS, and the one whose whole point is that it must NOT fail the request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { onRequestPost } from '../../functions/api/bookstore/stream.js';

const UID = 'reader-uid-0001';
const TITLE = 'basil';
const GENERATION = '1785243569624430';
const MD5 = 'q/sAeFGbhb5mfv37T0GrBQ==';

// A REAL key pair, generated here rather than a stub, so signGetUrl runs its actual WebCrypto
// path — the RFC-3986 canonicaliser, the V4 string-to-sign and the RSA signature all execute.
// `crypto.subtle` is a getter-only property and cannot be monkey-patched anyway; needing a
// real key turned out to be the better test.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the stub host ───────────────────────────────────────────────────────────
//
// Routes by URL so each call site can be steered independently, and RECORDS every request so
// the assertions can prove which credential was used and how many times GCS was asked.
function installHost({ purchase = { status: 'active' }, metadata = { generation: GENERATION, md5Hash: MD5 }, metadataStatus = 200 } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

    if (u.includes('identitytoolkit.googleapis.com')) return ok({ users: [{ localId: UID }] });
    if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 'stub-admin-token' });
    if (u.includes('storage.googleapis.com/storage/v1/')) {
      if (metadataStatus !== 200) return new Response('boom', { status: metadataStatus });
      return ok(metadata);
    }
    if (u.includes('firebasedatabase.app')) return ok(purchase);
    throw new Error(`unstubbed fetch: ${u}`);
  };

  return {
    calls,
    restore() { globalThis.fetch = realFetch; },
  };
}

const call = ({ headers = {}, body, url = 'https://calvaryscribblings.co.uk/api/bookstore/stream' } = {}) =>
  onRequestPost({
    env: ENV,
    request: new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    }),
  });

const readJson = async (res) => ({ status: res.status, body: await res.json() });

// ── version stability — the whole point ─────────────────────────────────────

test('the same book twice returns the SAME version and a FRESHLY MINTED url', async () => {
  const host = installHost();
  try {
    const a = await readJson(await call({ body: { idToken: 't', titleId: TITLE } }));
    // X-Goog-Date is second-granular, so two calls inside the same second sign the same
    // canonical request and yield a BYTE-IDENTICAL url. That is a property of V4 signing, not
    // a caching bug, and it is why this waits: without the gap the assertion below would be
    // flaky rather than wrong. Measured, not assumed — the first version of this test failed
    // exactly this way.
    await sleep(1100);
    const b = await readJson(await call({ body: { idToken: 't', titleId: TITLE } }));

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);

    // Same file → same cache key. This is the assertion the app's on-device cache rests on.
    assert.equal(a.body.version, GENERATION);
    assert.equal(b.body.version, GENERATION);
    assert.equal(a.body.version, b.body.version);

    // …and the url is genuinely re-minted, so "version is stable" cannot be passing merely
    // because the whole response is one frozen constant.
    assert.notEqual(a.body.url, b.body.url);
    assert.notEqual(a.body.expiresAt, b.body.expiresAt);
  } finally { host.restore(); }
});

test('version tracks the OBJECT: replace the EPUB and it changes', async () => {
  const first = installHost();
  let a;
  try { a = await readJson(await call({ body: { idToken: 't', titleId: TITLE } })); }
  finally { first.restore(); }

  const second = installHost({ metadata: { generation: '1799999999999999', md5Hash: 'ZZZZeFGbhb5mfv37T0GrBQ==' } });
  try {
    const b = await readJson(await call({ body: { idToken: 't', titleId: TITLE } }));
    assert.notEqual(a.body.version, b.body.version);
    assert.equal(b.body.version, '1799999999999999');
    assert.equal(b.body.md5, 'ZZZZeFGbhb5mfv37T0GrBQ==');
  } finally { second.restore(); }
});

test('generation stays a STRING — it exceeds Number.MAX_SAFE_INTEGER', async () => {
  const host = installHost();
  try {
    const { body } = await readJson(await call({ body: { idToken: 't', titleId: TITLE } }));
    assert.equal(typeof body.version, 'string');
    // Parsing it would round: 1785243569624430 survives, but the next digit of growth would
    // not, and a silently-corrupted cache key is unfixable from the app side.
    assert.ok(Number(body.version) > Number.MAX_SAFE_INTEGER / 10);
  } finally { host.restore(); }
});

// ── the fail-soft contract ──────────────────────────────────────────────────

test('a metadata failure returns the url with version: null — NOT an error', async () => {
  // Refusing a paid-for book because a metadata read hiccuped is the worst of the options.
  // The reader still gets their bytes; the app sees an explicit null and re-downloads.
  const host = installHost({ metadataStatus: 503 });
  try {
    const { status, body } = await readJson(await call({ body: { idToken: 't', titleId: TITLE } }));
    assert.equal(status, 200);
    assert.ok(body.url.startsWith('https://storage.googleapis.com/'));
    assert.equal(body.version, null);
    assert.equal(body.md5, null);
  } finally { host.restore(); }
});

test('version and md5 are ALWAYS present as keys, never omitted', async () => {
  // An absent key is ambiguous — old build? error? not implemented? An explicit null is a
  // fact the app can branch on, and its contract is do-not-cache.
  for (const metadataStatus of [200, 500]) {
    const host = installHost({ metadataStatus });
    try {
      const { body } = await readJson(await call({ body: { idToken: 't', titleId: TITLE } }));
      assert.ok('version' in body, `version key missing (metadata ${metadataStatus})`);
      assert.ok('md5' in body, `md5 key missing (metadata ${metadataStatus})`);
    } finally { host.restore(); }
  }
});

test('a generation-less metadata response degrades to null rather than a junk key', async () => {
  const host = installHost({ metadata: { md5Hash: MD5 } });
  try {
    const { status, body } = await readJson(await call({ body: { idToken: 't', titleId: TITLE } }));
    assert.equal(status, 200);
    assert.equal(body.version, null);
  } finally { host.restore(); }
});

// ── the credential ──────────────────────────────────────────────────────────

test('Authorization: Bearer is accepted — the native app\'s call shape', async () => {
  const host = installHost();
  try {
    const { status, body } = await readJson(await call({
      headers: { Authorization: `Bearer id-token-from-app` },
      body: { titleId: TITLE },
    }));
    assert.equal(status, 200);
    assert.equal(body.version, GENERATION);
    // The header token, not a body field, is what went to Identity Toolkit.
    const lookup = host.calls.find((c) => c.url.includes('identitytoolkit'));
    assert.match(lookup.opts.body, /id-token-from-app/);
  } finally { host.restore(); }
});

test('body idToken still works — the web reader is untouched', async () => {
  const host = installHost();
  try {
    const { status, body } = await readJson(await call({ body: { idToken: 'id-token-from-web', titleId: TITLE } }));
    assert.equal(status, 200);
    const lookup = host.calls.find((c) => c.url.includes('identitytoolkit'));
    assert.match(lookup.opts.body, /id-token-from-web/);
    assert.equal(body.version, GENERATION);
  } finally { host.restore(); }
});

test('the header WINS when a caller sends both', async () => {
  const host = installHost();
  try {
    await call({ headers: { Authorization: 'Bearer header-wins' }, body: { idToken: 'body-loses', titleId: TITLE } });
    const lookup = host.calls.find((c) => c.url.includes('identitytoolkit'));
    assert.match(lookup.opts.body, /header-wins/);
    assert.doesNotMatch(lookup.opts.body, /body-loses/);
  } finally { host.restore(); }
});

test('no credential at all is still 401 signed_out', async () => {
  const host = installHost();
  try {
    const { status, body } = await readJson(await call({ body: { titleId: TITLE } }));
    assert.equal(status, 401);
    assert.equal(body.code, 'signed_out');
  } finally { host.restore(); }
});

test('a malformed Authorization header does not pass as a token', async () => {
  const host = installHost();
  try {
    for (const h of ['Bearer', 'Bearer    ', 'Basic abc123', 'id-token-without-scheme']) {
      const { status, body } = await readJson(await call({ headers: { Authorization: h }, body: { titleId: TITLE } }));
      assert.equal(status, 401, `header ${JSON.stringify(h)} should not authenticate`);
      assert.equal(body.code, 'signed_out');
    }
  } finally { host.restore(); }
});

// ── the selector ────────────────────────────────────────────────────────────

test('titleId may arrive in the body or the query string, with slug as an alias', async () => {
  for (const variant of [
    { label: 'body titleId', body: { titleId: TITLE } },
    { label: 'body slug', body: { slug: TITLE } },
    { label: 'query titleId', url: `https://x/api/bookstore/stream?titleId=${TITLE}` },
    { label: 'query slug', url: `https://x/api/bookstore/stream?slug=${TITLE}` },
  ]) {
    const host = installHost();
    try {
      const { status, body } = await readJson(await call({
        headers: { Authorization: 'Bearer t' }, body: variant.body, url: variant.url,
      }));
      assert.equal(status, 200, `${variant.label} should resolve`);
      assert.equal(body.version, GENERATION);
    } finally { host.restore(); }
  }
});

test('a no-body request works — header credential, query selector', async () => {
  // The shape that 400d before R9.10: request.json() threw on an empty body.
  const host = installHost();
  try {
    const { status, body } = await readJson(await call({
      headers: { Authorization: 'Bearer t' }, url: `https://x/api/bookstore/stream?titleId=${TITLE}`,
    }));
    assert.equal(status, 200);
    assert.equal(body.version, GENERATION);
  } finally { host.restore(); }
});

test('a PRESENT but malformed body still 400s', async () => {
  const host = installHost();
  try {
    const res = await call({ headers: { Authorization: 'Bearer t' }, body: '{not json' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Invalid request body.');
  } finally { host.restore(); }
});

test('a traversing titleId is still refused before anything is signed', async () => {
  const host = installHost();
  try {
    for (const bad of ['../../secrets/master', 'basil/../../x', 'a'.repeat(129), 'has space']) {
      const res = await call({ headers: { Authorization: 'Bearer t' }, body: { titleId: bad } });
      assert.equal(res.status, 400, `${bad} should be refused`);
    }
    assert.equal(host.calls.filter((c) => c.url.includes('storage.googleapis.com')).length, 0);
  } finally { host.restore(); }
});

// ── the entitlement checks, unchanged — asserted so this round cannot have moved them ──

test('not_purchased and revoked keep their distinct 403s', async () => {
  const absent = installHost({ purchase: null });
  try {
    const { status, body } = await readJson(await call({ headers: { Authorization: 'Bearer t' }, body: { titleId: TITLE } }));
    assert.equal(status, 403);
    assert.equal(body.code, 'not_purchased');
    assert.equal(body.version, undefined, 'a 403 carries no version');
  } finally { absent.restore(); }

  const revoked = installHost({ purchase: { status: 'revoked', revokedReason: 'refund' } });
  try {
    const { status, body } = await readJson(await call({ headers: { Authorization: 'Bearer t' }, body: { titleId: TITLE } }));
    assert.equal(status, 403);
    assert.equal(body.code, 'revoked');
    assert.equal(body.reason, 'refund');
  } finally { revoked.restore(); }
});

test('a non-owner never reaches the object — no metadata call on a 403', async () => {
  // The version read sits AFTER the entitlement check on purpose: a caller who does not own
  // the book learns nothing about the object, not even that it exists.
  for (const purchase of [null, { status: 'revoked' }]) {
    const host = installHost({ purchase });
    try {
      await call({ headers: { Authorization: 'Bearer t' }, body: { titleId: TITLE } });
      assert.equal(host.calls.filter((c) => c.url.includes('storage.googleapis.com')).length, 0);
    } finally { host.restore(); }
  }
});

test('the TTL is unchanged at 300s', async () => {
  const host = installHost();
  try {
    const before = Date.now();
    const { body } = await readJson(await call({ headers: { Authorization: 'Bearer t' }, body: { titleId: TITLE } }));
    // expiresAt is issuedAt + 300s, and issuedAt is stamped INSIDE signGetUrl — a few ms
    // after `before`. The window is loose on both sides for that reason; X-Goog-Expires
    // below is the exact assertion.
    const ttlMs = body.expiresAt - before;
    assert.ok(ttlMs > 295_000 && ttlMs < 305_000, `expected ~300s, got ${ttlMs}ms`);
    assert.match(body.url, /X-Goog-Expires=300/);
  } finally { host.restore(); }
});

test('the admin token carries storage read scope, and ONLY read', async () => {
  const host = installHost();
  try {
    await call({ headers: { Authorization: 'Bearer t' }, body: { titleId: TITLE } });
    const mint = host.calls.find((c) => c.url.includes('oauth2.googleapis.com'));
    const claim = JSON.parse(atob(decodeURIComponent(mint.opts.body).split('assertion=')[1].split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    assert.match(claim.scope, /firebase\.database/);
    assert.match(claim.scope, /devstorage\.read_only/);
    assert.doesNotMatch(claim.scope, /devstorage\.read_write|devstorage\.full_control/);
  } finally { host.restore(); }
});
