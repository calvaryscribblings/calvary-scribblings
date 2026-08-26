// THE PUBLISH → DEPLOY HANDSHAKE, specified end to end. R19.6, generalised in R19.7.
//
//   node --test tests/ci/rebuild.test.mjs      (npm run test:ci)
//
// THE DEFECT IT CLOSES. `output: 'export'` means every /bookstore/{slug} page is a FILE
// enumerated at build time. Publishing a title in the CMS wrote a record that nothing served:
// measured 26 Aug 2026, `rogues-of-the-east` answered 404 in production for days while an older
// title answered 200 from the same deploy. Nothing was making a build run.
//
// FOUR THINGS ARE ASSERTED, and they are four different failures:
//
//   1. A NON-FOUNDER IS REFUSED. The hook is an unauthenticated trigger, so the endpoint in
//      front of it is the only thing standing between it and the internet.
//   2. EXACTLY ONCE PER FLIP. A build is minutes of compute. A transition nobody can see must
//      not spend them, and one that can must not spend them twice.
//   3. THE PUBLISH SURVIVES A FAILED TRIGGER. The record is already public by the time the
//      trigger runs; a rebuild that will not start must never be able to un-publish a book.
//   4. THE CLIENT NAMES A HOOK AND NEVER HOLDS ONE. An identifier maps to an environment
//      variable on the SERVER; an unknown identifier is a 400 that names the allowed set. The
//      absence of any URL is asserted next door, in tests/ci/deploy-hook-secrecy.test.mjs,
//      which also scans built out/.
//
// Offline. Nothing here reaches the network: fetch is injected, and the endpoint is driven as
// a function with a fabricated env.

import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';

import { onRequestPost as rebuildEndpoint } from '../../functions/api/rebuild.js';
import { HOOK_ENV, HOOK_IDS as SERVER_HOOK_IDS, resolveHook } from '../../functions/api/_deploy-hooks.js';
import {
  rebuildNeeded,
  requestRebuild,
  REBUILD_ENDPOINT,
  REBUILD_STARTED,
  HOOKS,
} from '../../app/lib/rebuild.js';

const FOUNDER = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const OTHER_FOUNDER = 'GfXFIc0dThZ1cs2SBBQIFao4aSz1';
const A_READER = 'someoneElseEntirely00000000001';
const HOOK = 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/deadbeef';

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';

/**
 * A fetch that answers identitytoolkit with `uid` and the deploy hook with `hookStatus`,
 * recording every call it received. `uid: null` stands for a token the platform rejects.
 */
function stubFetch({ uid = FOUNDER, hookStatus = 200, hookThrows = false } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET', init });
    if (String(url).startsWith(IDENTITY)) {
      if (!uid) return new Response('{}', { status: 400 });
      return new Response(JSON.stringify({ users: [{ localId: uid }] }), { status: 200 });
    }
    if (hookThrows) throw new Error('connection reset');
    return new Response('{"success":true}', { status: hookStatus });
  };
  impl.calls = calls;
  impl.hookCalls = () => calls.filter((c) => c.url.startsWith(HOOK));
  return impl;
}

// `raw` lets a spec send something that is NOT valid JSON — or nothing at all. A default
// parameter cannot express "no body", because `undefined` is exactly what triggers the default.
const post = (token, body = { hook: 'bookstore' }, raw) =>
  new Request('https://calvaryscribblings.co.uk/api/rebuild', {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });

const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'k',
  DEPLOY_HOOK_URL: HOOK,
  CMS_DEPLOY_HOOK_URL: `${HOOK}-cms`,
  OPEN_PAGES_DEPLOY_HOOK_URL: `${HOOK}-open`,
};

async function drive(opts = {}, env = {}) {
  const fetchImpl = stubFetch(opts);
  const real = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const res = await rebuildEndpoint({
      request: post(opts.token === undefined ? 'a-token' : opts.token, opts.body, opts.raw),
      env: { ...ENV, ...env },
    });
    return { res, body: await res.clone().json().catch(() => null), fetchImpl };
  } finally {
    globalThis.fetch = real;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. WHO MAY SUMMON A DEPLOY
// ═══════════════════════════════════════════════════════════════════════════════

describe('1 · the endpoint refuses everyone but a founder', () => {
  test('no Authorization header at all → 401, and the hook is never touched', async () => {
    const { res, fetchImpl } = await drive({ token: null });
    assert.equal(res.status, 401);
    assert.deepEqual(fetchImpl.hookCalls(), []);
  });

  test('THE FINDING: a signed-in reader who is not a founder → 401', async () => {
    // The uid comes back VERIFIED from identitytoolkit and is still refused. This is the
    // assertion that matters: possession of a valid Firebase account is not authorisation to
    // spend the account's build minutes.
    const { res, fetchImpl } = await drive({ uid: A_READER });
    assert.equal(res.status, 401);
    assert.deepEqual(fetchImpl.hookCalls(), [], 'a refused caller must not reach the hook');
  });

  test('a token the platform rejects → 401', async () => {
    const { res, fetchImpl } = await drive({ uid: null });
    assert.equal(res.status, 401);
    assert.deepEqual(fetchImpl.hookCalls(), []);
  });

  test('the uid is DERIVED from the token, never read off the request', async () => {
    // The founder uids are public — they are in database.rules.json. If this endpoint ever
    // trusted a caller-supplied uid it would have no authorisation at all, which is exactly
    // what the newsletter drafts endpoint once shipped. Proven by the identitytoolkit call
    // being made at all, with the presented token in its body.
    const { fetchImpl } = await drive({ uid: FOUNDER });
    const lookup = fetchImpl.calls.find((c) => c.url.startsWith(IDENTITY));
    assert.ok(lookup, 'the endpoint must verify the token with identitytoolkit');
    assert.equal(JSON.parse(lookup.init.body).idToken, 'a-token');
  });

  test('both founders are allowed', async () => {
    for (const uid of [FOUNDER, OTHER_FOUNDER]) {
      const { res } = await drive({ uid });
      assert.equal(res.status, 202, `${uid} must be able to summon a deploy`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. WHAT IT ANSWERS
// ═══════════════════════════════════════════════════════════════════════════════

describe('2 · the endpoint answers honestly', () => {
  test('a founder gets 202 { building: true } — accepted, not finished', async () => {
    const { res, body, fetchImpl } = await drive();
    assert.equal(res.status, 202);
    // The identifier is echoed; the URL never is. Two surfaces publishing at once should be
    // able to tell which answer was theirs.
    assert.deepEqual(body, { building: true, hook: 'bookstore' });
    assert.equal(fetchImpl.hookCalls().length, 1, 'exactly one POST to the hook');
    assert.equal(fetchImpl.hookCalls()[0].method, 'POST');
  });

  test('the surface\'s env var absent → 503 with an honest message, not a 500 and not a lie', async () => {
    const { res, body, fetchImpl } = await drive({}, { DEPLOY_HOOK_URL: undefined });
    assert.equal(res.status, 503, 'not configured is not a bug and is not a success');
    assert.equal(body.code, 'deploy_hook_unconfigured');
    assert.match(body.error, /DEPLOY_HOOK_URL/, 'the message must name what to set');
    assert.match(body.error, /Cloudflare/, 'and where the manual fallback lives');
    assert.deepEqual(fetchImpl.hookCalls(), []);
  });

  test('the hook refusing → 502, and the URL is NOT in the answer', async () => {
    const { res, body } = await drive({ hookStatus: 403 });
    assert.equal(res.status, 502);
    assert.equal(body.code, 'deploy_hook_refused');
    assert.match(body.error, /403/, 'the status is useful and is not a secret');
    assert.ok(!JSON.stringify(body).includes(HOOK), 'the hook URL must never be echoed');
    assert.ok(!JSON.stringify(body).includes('deadbeef'));
  });

  test('the hook unreachable → 502, and the URL is NOT in the answer', async () => {
    const { res, body } = await drive({ hookThrows: true });
    assert.equal(res.status, 502);
    assert.equal(body.code, 'deploy_hook_unreachable');
    assert.ok(!JSON.stringify(body).includes(HOOK));
  });

  test('LB-10: every outbound call carries a timeout signal', async () => {
    // fetch has no default timeout. A hook that accepts the connection and then stops talking
    // would hold the invocation until Cloudflare kills it by wall-clock, which no catch block
    // in this file can observe.
    const { fetchImpl } = await drive();
    for (const call of fetchImpl.calls) {
      assert.ok(call.init?.signal, `no timeout signal on ${call.url}`);
      assert.equal(typeof call.init.signal.aborted, 'boolean');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2b. THE IDENTIFIER → ENV MAPPING — R19.7's whole point
// ═══════════════════════════════════════════════════════════════════════════════

describe('2b · a hook is NAMED by the caller and RESOLVED by the server', () => {
  test('each identifier fires its own hook, and only its own', async () => {
    // Three surfaces, three Cloudflare projects' worth of build minutes. A mapping that sent
    // the CMS's publish to the bookstore's hook would look like it worked — a build would
    // start, and the wrong pages would be rebuilt.
    const cases = [
      ['bookstore', ENV.DEPLOY_HOOK_URL],
      ['cms', ENV.CMS_DEPLOY_HOOK_URL],
      ['openPages', ENV.OPEN_PAGES_DEPLOY_HOOK_URL],
    ];
    for (const [hook, expected] of cases) {
      const { res, body, fetchImpl } = await drive({ body: { hook } });
      assert.equal(res.status, 202, `${hook} must be accepted`);
      assert.equal(body.hook, hook);
      const fired = fetchImpl.hookCalls();
      assert.equal(fired.length, 1, `${hook} must fire exactly one hook`);
      assert.equal(fired[0].url, expected, `${hook} must fire ITS OWN hook`);
    }
  });

  test('THE FINDING: an unknown identifier is a 400 that names the allowed set', async () => {
    for (const hook of ['nonsense', 'BOOKSTORE', 'book store', '', 42, null]) {
      const { res, body, fetchImpl } = await drive({ body: { hook } });
      assert.equal(res.status, 400, `${JSON.stringify(hook)} must be refused`);
      assert.equal(body.code, 'unknown_hook');
      assert.deepEqual(body.allowed, ['bookstore', 'cms', 'openPages'],
        'the refusal must say what WOULD have been accepted');
      assert.deepEqual(fetchImpl.hookCalls(), [], 'nothing may fire on an unknown identifier');
    }
  });

  test('a body with no hook, an empty body, or one that will not parse — all the same 400', async () => {
    const cases = [
      { label: 'no hook key', opts: { body: {} } },
      { label: 'empty body', opts: { raw: '' } },
      { label: 'not JSON', opts: { raw: 'not json at all' } },
      { label: 'JSON, not an object', opts: { raw: '"bookstore"' } },
    ];
    for (const { label, opts } of cases) {
      const { res, body: served, fetchImpl } = await drive(opts);
      assert.equal(res.status, 400, `${label} must be a 400`);
      assert.equal(served.code, 'unknown_hook', label);
      assert.deepEqual(fetchImpl.hookCalls(), [], `${label} must fire nothing`);
    }
  });

  test('⛔ A URL IN THE BODY IS NOT A HOOK. It is refused like any other unknown.', async () => {
    // The failure mode this shape exists to prevent: if the endpoint accepted a URL, it would
    // be an open POST proxy to anywhere on the internet, authenticated by a founder token.
    const { res, body, fetchImpl } = await drive({ body: { hook: 'https://evil.example/steal' } });
    assert.equal(res.status, 400);
    assert.equal(body.code, 'unknown_hook');
    assert.deepEqual(fetchImpl.hookCalls(), []);
    assert.ok(!JSON.stringify(body).includes('evil.example'),
      'and the refusal must not echo what was asked for');
  });

  test('the env var name is stated on a 503 — it is configuration, not a secret', async () => {
    const { res, body } = await drive({ body: { hook: 'cms' } }, { CMS_DEPLOY_HOOK_URL: undefined });
    assert.equal(res.status, 503);
    assert.match(body.error, /CMS_DEPLOY_HOOK_URL/,
      'the message must name the variable to set, or it is not actionable');
    // …and one surface being unconfigured must not take the others down.
    const other = await drive({ body: { hook: 'bookstore' } }, { CMS_DEPLOY_HOOK_URL: undefined });
    assert.equal(other.res.status, 202);
  });

  test('resolveHook: the mapping itself, without the HTTP', () => {
    assert.deepEqual(HOOK_ENV, {
      bookstore: 'DEPLOY_HOOK_URL',
      cms: 'CMS_DEPLOY_HOOK_URL',
      openPages: 'OPEN_PAGES_DEPLOY_HOOK_URL',
    });
    assert.equal(resolveHook(ENV, 'cms').url, ENV.CMS_DEPLOY_HOOK_URL);
    assert.equal(resolveHook(ENV, 'nope').reason, 'unknown');
    assert.equal(resolveHook({}, 'cms').reason, 'unconfigured');
    assert.equal(resolveHook({}, 'cms').envVar, 'CMS_DEPLOY_HOOK_URL');
    // Prototype keys are not hooks. `hook: "constructor"` must not resolve to anything.
    for (const k of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(resolveHook(ENV, k).reason, 'unknown', `${k} must not resolve`);
    }
  });

  test('THE MIRROR HOLDS: the client\'s identifiers are exactly the server\'s', () => {
    // The one way a two-sided table like this rots. The client can only name what the server
    // can resolve, and the server must not carry a hook nothing can ask for.
    assert.deepEqual(Object.values(HOOKS).sort(), [...SERVER_HOOK_IDS].sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ONCE PER FLIP — the rule that decides whether a build is owed at all
// ═══════════════════════════════════════════════════════════════════════════════

describe('3 · rebuildNeeded — publishedness changed, not status changed', () => {
  test('the flips that owe a build', () => {
    assert.equal(rebuildNeeded('draft', 'published'), true);
    assert.equal(rebuildNeeded('unpublished', 'published'), true);
    assert.equal(rebuildNeeded('published', 'unpublished'), true);
    assert.equal(rebuildNeeded('published', 'draft'), true);
    // A title that does not exist yet is not published, so creating one AS published is a flip.
    assert.equal(rebuildNeeded(null, 'published'), true);
  });

  test('the flips that owe nothing — and this is the half that saves the minutes', () => {
    assert.equal(rebuildNeeded('draft', 'unpublished'), false, 'invisible either way');
    assert.equal(rebuildNeeded('unpublished', 'draft'), false);
    assert.equal(rebuildNeeded('published', 'published'), false, 'a no-op save is not a flip');
    assert.equal(rebuildNeeded('draft', 'draft'), false);
    assert.equal(rebuildNeeded(null, 'draft'), false, 'a new draft has nothing to serve');
  });
});

describe('3b · the trigger fires exactly once per flip', () => {
  // The admin page's handler, reduced to the two lines that decide: the gate and the call.
  // Kept here rather than driven through the React tree because the assertion is about
  // ARITHMETIC — how many POSTs a sequence of flips produces — and a browser cannot make that
  // clearer than a counter can.
  function flipper() {
    let posts = 0;
    const fetchImpl = async () => { posts += 1; return new Response('{"building":true}', { status: 202 }); };
    return {
      posts: () => posts,
      async flip(was, now) {
        if (!rebuildNeeded(was, now)) return null;
        return requestRebuild({ hook: HOOKS.BOOKSTORE, getIdToken: async () => 'tok', fetchImpl });
      },
    };
  }

  test('one publish → one request', async () => {
    const f = flipper();
    await f.flip('draft', 'published');
    assert.equal(f.posts(), 1);
  });

  test('publish then unpublish → two requests, one each', async () => {
    const f = flipper();
    await f.flip('draft', 'published');
    await f.flip('published', 'unpublished');
    assert.equal(f.posts(), 2);
  });

  test('saving a published title again → no request at all', async () => {
    const f = flipper();
    await f.flip('published', 'published');
    await f.flip('published', 'published');
    assert.equal(f.posts(), 0, 'a save that changes no publishedness must not spend a build');
  });

  test('a draft edited five times → no requests', async () => {
    const f = flipper();
    for (let i = 0; i < 5; i++) await f.flip('draft', 'draft');
    assert.equal(f.posts(), 0);
  });

  test('the request goes to the endpoint, as a POST, bearing the token', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, init }); return new Response('{}', { status: 202 }); };
    await requestRebuild({ hook: HOOKS.BOOKSTORE, getIdToken: async () => 'tok', fetchImpl });
    assert.equal(seen[0].url, REBUILD_ENDPOINT);
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.headers.Authorization, 'Bearer tok');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. THE PUBLISH SURVIVES A FAILED TRIGGER
// ═══════════════════════════════════════════════════════════════════════════════

describe('4 · a failed trigger is not a failed publish', () => {
  test('a 503 from the endpoint becomes a verdict, never an exception', async () => {
    const fetchImpl = async () => new Response(
      JSON.stringify({ error: 'Rebuilds are not configured on this deployment.', code: 'deploy_hook_unconfigured' }),
      { status: 503 },
    );
    const verdict = await requestRebuild({ hook: HOOKS.BOOKSTORE, getIdToken: async () => 'tok', fetchImpl });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.status, 503);
    assert.match(verdict.message, /not configured/);
    assert.match(verdict.message, /published either way/, 'the reader must be told the save stood');
  });

  test('the network throwing becomes a verdict, never an exception', async () => {
    const fetchImpl = async () => { throw new Error('offline'); };
    const verdict = await requestRebuild({ hook: HOOKS.BOOKSTORE, getIdToken: async () => 'tok', fetchImpl });
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /Cloudflare Pages dashboard/, 'the manual fallback must be named');
  });

  test('getIdToken throwing becomes a verdict, never an exception', async () => {
    // The one that would otherwise land in handleSave's own catch and read as a failed save.
    const verdict = await requestRebuild({
      hook: HOOKS.BOOKSTORE,
      getIdToken: async () => { throw new Error('token refresh failed'); },
      fetchImpl: async () => { throw new Error('must not be called'); },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /Cloudflare Pages dashboard/);
  });

  test('a body that will not parse still fails loudly, with the status', async () => {
    const fetchImpl = async () => new Response('<html>502 Bad Gateway</html>', { status: 502 });
    const verdict = await requestRebuild({ hook: HOOKS.BOOKSTORE, getIdToken: async () => 'tok', fetchImpl });
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /502/);
  });

  test('202 is the only success, and it says what happens next', async () => {
    const fetchImpl = async () => new Response('{"building":true}', { status: 202 });
    const verdict = await requestRebuild({ hook: HOOKS.BOOKSTORE, getIdToken: async () => 'tok', fetchImpl });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.message, REBUILD_STARTED);
    assert.match(verdict.message, /two minutes/, 'the wait is stated, not implied');
  });

  test('200 is NOT treated as success — the contract is 202', async () => {
    // A 200 from this path would mean something other than this endpoint answered — a redirect
    // to an HTML 404 page, most likely, which is exactly what a missing Function looks like on
    // a static host.
    const fetchImpl = async () => new Response('{}', { status: 200 });
    const verdict = await requestRebuild({ hook: HOOKS.BOOKSTORE, getIdToken: async () => 'tok', fetchImpl });
    assert.equal(verdict.ok, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. THE FOUR PUBLISH PATHS ARE ACTUALLY WIRED
// ═══════════════════════════════════════════════════════════════════════════════
//
// Everything above proves the endpoint is correct. This proves it is CALLED — which is a
// different claim, and the one that was false for three of these four surfaces until R19.7.
//
// It reads the sources rather than driving the admin screens in a browser, deliberately. Each
// of these is a signed-in founder flow behind a live Firebase write; a browser test of them
// would need real credentials and would either mutate production data or prove nothing. What
// can go wrong here is not a rendering fault — it is a call site that was never moved, or one
// moved onto the wrong hook, and both of those are visible in the text.

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const src = (f) => readFileSync(join(APP, f), 'utf8');

describe('5 · every publish path asks for its own deploy', () => {
  const SITES = [
    ['admin/bookstore/page.js', 'HOOKS.BOOKSTORE', 'a bookstore title is published or unpublished'],
    ['admin/page.js', 'HOOKS.CMS', 'a story is saved in the CMS'],
    ['admin/voices/page.js', 'HOOKS.CMS', 'a voice is added, edited or reordered'],
    ['admin/forum/page.jsx', 'HOOKS.OPEN_PAGES', 'an Open Pages post is approved'],
  ];

  for (const [file, hook, when] of SITES) {
    test(`${file} → ${hook} (when ${when})`, () => {
      const text = src(file);
      assert.match(text, /from '(\.\.\/)+lib\/rebuild'/,
        `${file} must import the shared module, not roll its own request`);
      assert.match(text, new RegExp(`hook:\\s*${hook.replace('.', '\\.')}`),
        `${file} must ask for ${hook} — a call site on the wrong hook rebuilds the wrong pages, `
        + 'and looks like it worked');
    });
  }

  test('THE REGRESSION: no publish path holds a hook URL or calls Cloudflare itself', () => {
    // The shape all three CMS sites had until R19.7. Asserted here as well as in
    // deploy-hook-secrecy.test.mjs because THIS file is the one somebody reads when they add a
    // fifth publish path, and the wrong instinct is to copy what the old ones did.
    for (const [file] of SITES) {
      const text = src(file);
      assert.doesNotMatch(text, /deploy_hooks\//, `${file} must not name a deploy hook`);
      assert.doesNotMatch(text, /['"`]https:\/\/api\.cloudflare\.com/, `${file} must not call Cloudflare directly`);
    }
  });

  test('the Open Pages SERVER path resolves its hook from the environment too', () => {
    // functions/api/open-pages/moderate.js auto-publishes without a human, and it held the same
    // UUID app/admin/forum/page.jsx did. That URL was rotated on 26 Aug 2026, so the literal it
    // used to carry is now a dead endpoint that would 404 forever while reporting nothing —
    // every auto-published post's detail page 404ing until an unrelated deploy happened to run.
    const text = readFileSync(fileURLToPath(new URL('../../functions/api/open-pages/moderate.js', import.meta.url)), 'utf8');
    assert.doesNotMatch(text, /deploy_hooks\//, 'the literal must be gone');
    assert.match(text, /resolveHook\(env, 'openPages'\)/, 'it must resolve through the shared table');
  });
});
