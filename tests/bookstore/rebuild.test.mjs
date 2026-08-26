// R19.6 — THE PUBLISH → DEPLOY HANDSHAKE, specified end to end.
//
//   node --test tests/bookstore/rebuild.test.mjs      (npm run test:purchases)
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
//   4. THE URL NEVER REACHES A CLIENT — asserted next door, in
//      tests/ci/deploy-hook-secrecy.test.mjs, which also scans built out/.
//
// Offline. Nothing here reaches the network: fetch is injected, and the endpoint is driven as
// a function with a fabricated env.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as rebuildEndpoint } from '../../functions/api/bookstore/rebuild.js';
import {
  rebuildNeeded,
  requestRebuild,
  REBUILD_ENDPOINT,
  REBUILD_STARTED,
} from '../../app/lib/bookstore/rebuild.js';

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
  impl.hookCalls = () => calls.filter((c) => c.url === HOOK);
  return impl;
}

const post = (token) => new Request('https://calvaryscribblings.co.uk/api/bookstore/rebuild', {
  method: 'POST',
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});

async function drive(opts = {}, env = {}) {
  const fetchImpl = stubFetch(opts);
  const real = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const res = await rebuildEndpoint({
      request: post(opts.token === undefined ? 'a-token' : opts.token),
      env: { NEXT_PUBLIC_FIREBASE_API_KEY: 'k', DEPLOY_HOOK_URL: HOOK, ...env },
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
    assert.deepEqual(body, { building: true });
    assert.equal(fetchImpl.hookCalls().length, 1, 'exactly one POST to the hook');
    assert.equal(fetchImpl.hookCalls()[0].method, 'POST');
  });

  test('DEPLOY_HOOK_URL absent → 503 with an honest message, not a 500 and not a lie', async () => {
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
        return requestRebuild({ getIdToken: async () => 'tok', fetchImpl });
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
    await requestRebuild({ getIdToken: async () => 'tok', fetchImpl });
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
    const verdict = await requestRebuild({ getIdToken: async () => 'tok', fetchImpl });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.status, 503);
    assert.match(verdict.message, /not configured/);
    assert.match(verdict.message, /published either way/, 'the reader must be told the save stood');
  });

  test('the network throwing becomes a verdict, never an exception', async () => {
    const fetchImpl = async () => { throw new Error('offline'); };
    const verdict = await requestRebuild({ getIdToken: async () => 'tok', fetchImpl });
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /Cloudflare Pages dashboard/, 'the manual fallback must be named');
  });

  test('getIdToken throwing becomes a verdict, never an exception', async () => {
    // The one that would otherwise land in handleSave's own catch and read as a failed save.
    const verdict = await requestRebuild({
      getIdToken: async () => { throw new Error('token refresh failed'); },
      fetchImpl: async () => { throw new Error('must not be called'); },
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /Cloudflare Pages dashboard/);
  });

  test('a body that will not parse still fails loudly, with the status', async () => {
    const fetchImpl = async () => new Response('<html>502 Bad Gateway</html>', { status: 502 });
    const verdict = await requestRebuild({ getIdToken: async () => 'tok', fetchImpl });
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /502/);
  });

  test('202 is the only success, and it says what happens next', async () => {
    const fetchImpl = async () => new Response('{"building":true}', { status: 202 });
    const verdict = await requestRebuild({ getIdToken: async () => 'tok', fetchImpl });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.message, REBUILD_STARTED);
    assert.match(verdict.message, /two minutes/, 'the wait is stated, not implied');
  });

  test('200 is NOT treated as success — the contract is 202', async () => {
    // A 200 from this path would mean something other than this endpoint answered — a redirect
    // to an HTML 404 page, most likely, which is exactly what a missing Function looks like on
    // a static host.
    const fetchImpl = async () => new Response('{}', { status: 200 });
    const verdict = await requestRebuild({ getIdToken: async () => 'tok', fetchImpl });
    assert.equal(verdict.ok, false);
  });
});
