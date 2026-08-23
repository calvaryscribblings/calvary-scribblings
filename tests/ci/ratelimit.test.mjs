// R19.1 — THE LIMITER, AND ABOVE ALL THE PROOF THAT IT FAILS CLOSED.
//
//   node --test tests/ci/ratelimit.test.mjs      (npm run test:ci)
//
// functions/api/_ratelimit.js is the only thing standing between /api/evaluate-quiz and an
// unbounded Anthropic bill, and between /api/hit and RTDB's 1,000-writes-per-second
// ceiling. A limiter has one failure mode that matters more than every other combined:
// erroring OPEN. If the counter store is unreachable and the limiter waves the call
// through, then "make the counter store unreachable" is the documented bypass — and a flood
// does exactly that to a dependency, for free, as a side effect of being a flood.
//
// So the centre of this suite is not "does it count correctly". It is: for every way the
// counter store can fail, does the request get REFUSED. Those are the tests that must never
// be relaxed, and the ones to look at first if anyone ever "fixes" a flaky limiter by
// wrapping it in a try/catch that returns ok.
//
// The module is plain functions over `fetch`, so stubbing global fetch drives the real code:
// no network, no emulator, no secrets, milliseconds. The RSA key is generated in-process —
// mintAccessToken() signs a real JWT, so a fake PEM would fail the import and every test
// would pass for the wrong reason (refused, but because of the key, not the store).

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  consume, limitResponse, clientIp, capFromEnv,
  minuteWindow, dayWindow, RATE_LIMIT_PATH,
} from '../../functions/api/_ratelimit.js';

// A real PKCS8 key, so importSigningKey() and crypto.subtle.sign() do their actual work.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const ENV = {
  FIREBASE_CLIENT_EMAIL: 'test@calvary-scribblings.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_DATABASE_URL: 'https://db.test',
};

const TOKEN_URL = /oauth2\.googleapis\.com/;

let realFetch, calls, deferred;

before(() => { realFetch = globalThis.fetch; });
after(() => { globalThis.fetch = realFetch; });

beforeEach(() => {
  calls = [];
  deferred = [];
});

/**
 * `counter` decides what the store answers for each increment, in call order.
 * A number is returned as the new total; an Error is thrown; a Response is returned as-is.
 */
function stub(counter, { tokenOk = true } = {}) {
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ u, method: init.method || 'GET' });
    if (TOKEN_URL.test(u)) {
      return tokenOk
        ? new Response(JSON.stringify({ access_token: 'stub-token' }), { status: 200 })
        : new Response('nope', { status: 403 });
    }
    if (init.method === 'DELETE') return new Response('null', { status: 200 });
    const answer = typeof counter === 'function' ? counter(n++, u) : counter;
    if (answer instanceof Error) throw answer;
    if (answer instanceof Response) return answer;
    return new Response(String(answer), { status: 200 });
  };
}

/** A context whose waitUntil collects promises rather than dropping them. */
const ctx = (env = ENV) => ({ env, waitUntil: (p) => deferred.push(p) });

const ONE = [{ scope: 'test', period: 'day', id: 'u1', limit: 3 }];

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('fails closed — the property the limiter exists for', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  test('counter store answers 500 → refuses', async () => {
    stub(() => new Response('boom', { status: 500 }));
    const v = await consume(ctx(), ONE);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'unavailable');
  });

  test('counter store answers 401 (permission denied) → refuses', async () => {
    stub(() => new Response('{"error":"Permission denied"}', { status: 401 }));
    assert.equal((await consume(ctx(), ONE)).ok, false);
  });

  test('counter store unreachable (fetch throws) → refuses', async () => {
    stub(() => new Error('ECONNREFUSED'));
    const v = await consume(ctx(), ONE);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'unavailable');
  });

  test('counter store returns a non-numeric body → refuses', async () => {
    stub('null');
    assert.equal((await consume(ctx(), ONE)).ok, false);
  });

  test('counter store returns an object instead of an integer → refuses', async () => {
    stub('{"n":1}');
    assert.equal((await consume(ctx(), ONE)).ok, false);
  });

  test('credential missing → refuses, and never reaches the store', async () => {
    stub(1);
    const v = await consume(ctx({ FIREBASE_DATABASE_URL: 'https://db.test' }), ONE);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'unavailable');
    assert.equal(calls.length, 0, 'must not call out at all without a credential');
  });

  test('token exchange fails → refuses', async () => {
    stub(1, { tokenOk: false });
    const v = await consume(ctx(), ONE);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'unavailable');
  });

  test('one bucket failing refuses the whole request, even if others are under', async () => {
    stub((i) => (i === 1 ? new Error('down') : 1));
    const v = await consume(ctx(), [
      { scope: 'test', period: 'minute', id: 'u1', limit: 99 },
      { scope: 'test', period: 'day', id: 'u1', limit: 99 },
      { scope: 'test', period: 'day', limit: 99 },
    ]);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'unavailable');
  });

  test('consume() never throws — a thrown error could be swallowed upstream', async () => {
    for (const answer of [new Error('x'), 'garbage', new Response('', { status: 503 })]) {
      stub(() => answer);
      await assert.doesNotReject(() => consume(ctx(), ONE));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('counting and the verdict', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  test('under the cap → allowed', async () => {
    stub(1);
    assert.equal((await consume(ctx(), ONE)).ok, true);
  });

  test('exactly at the cap → allowed (the cap is the last permitted call)', async () => {
    stub(3);
    assert.equal((await consume(ctx(), ONE)).ok, true);
  });

  test('one past the cap → refused, as a limit rather than an outage', async () => {
    stub(4);
    const v = await consume(ctx(), ONE);
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'limit');
    assert.equal(v.bucket, 'actor');
    assert.equal(v.limit, 3);
    assert.ok(v.retryAfter > 0);
  });

  test('a global bucket refuses as global, not as the actor', async () => {
    stub(99);
    const v = await consume(ctx(), [{ scope: 'test', period: 'day', limit: 5 }]);
    assert.equal(v.bucket, 'global');
  });

  test('every bucket is charged — no short-circuit on the first refusal', async () => {
    stub(1000);
    await consume(ctx(), [
      { scope: 'test', period: 'minute', id: 'u1', limit: 1 },
      { scope: 'test', period: 'day', id: 'u1', limit: 1 },
      { scope: 'test', period: 'day', limit: 1 },
    ]);
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 3, 'a partial charge would leak which bucket is nearest its cap');
  });

  test('a refused request still counted — the increment precedes the verdict', async () => {
    stub(4);
    await consume(ctx(), ONE);
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('bucket paths', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  test('an actor bucket is keyed by the actor; a global one by _all', async () => {
    stub(1);
    await consume(ctx(), [
      { scope: 'evalq', period: 'day', id: 'uid-abc', limit: 9 },
      { scope: 'evalq', period: 'day', limit: 9 },
    ]);
    const puts = calls.filter((c) => c.method === 'PUT').map((c) => c.u);
    assert.ok(puts[0].includes(`${RATE_LIMIT_PATH}/evalq/day/${dayWindow()}/uid-abc.json`), puts[0]);
    assert.ok(puts[1].endsWith(`/${dayWindow()}/_all.json`), puts[1]);
  });

  test('an actor id is URL-encoded, so it cannot escape its node', async () => {
    stub(1);
    await consume(ctx(), [{ scope: 'hit', period: 'minute', id: 'a/../../etc', limit: 9 }]);
    const put = calls.find((c) => c.method === 'PUT').u;
    assert.ok(!put.includes('/../'), 'a traversal must not survive into the path');
    assert.ok(put.includes(minuteWindow()));
  });

  test('minute and day windows are distinct namespaces', async () => {
    stub(1);
    await consume(ctx(), [
      { scope: 's', period: 'minute', id: 'u', limit: 9 },
      { scope: 's', period: 'day', id: 'u', limit: 9 },
    ]);
    const puts = calls.filter((c) => c.method === 'PUT').map((c) => c.u);
    assert.ok(puts[0].includes('/minute/'));
    assert.ok(puts[1].includes('/day/'));
    assert.notEqual(puts[0], puts[1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('self-cleaning', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  test('the first request of a global window sweeps the previous one', async () => {
    stub(1);
    await consume(ctx(), [{ scope: 'hit', period: 'minute', limit: 9 }]);
    await Promise.all(deferred);
    const del = calls.find((c) => c.method === 'DELETE');
    assert.ok(del, 'expected a sweep');
    assert.ok(del.u.includes(`/hit/minute/${minuteWindow(Date.now() - 60_000)}.json`), del.u);
  });

  test('a later request in the same window does not sweep', async () => {
    stub(2);
    await consume(ctx(), [{ scope: 'hit', period: 'minute', limit: 9 }]);
    await Promise.all(deferred);
    assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
  });

  test('an actor bucket never sweeps — only the global one owns the window', async () => {
    stub(1);
    await consume(ctx(), [{ scope: 'hit', period: 'day', id: 'u1', limit: 9 }]);
    await Promise.all(deferred);
    assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0);
  });

  test('a failed sweep does not affect the verdict', async () => {
    let n = 0;
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      calls.push({ u, method: init.method || 'GET' });
      if (TOKEN_URL.test(u)) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
      if (init.method === 'DELETE') throw new Error('sweep exploded');
      return new Response(String(++n), { status: 200 });
    };
    const v = await consume(ctx(), [{ scope: 'hit', period: 'minute', limit: 9 }]);
    await Promise.allSettled(deferred);
    assert.equal(v.ok, true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('the refusal a reader actually sees', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  test('a limit reads as plain English, carries 429 and a real Retry-After', async () => {
    const res = limitResponse({ ok: false, reason: 'limit', bucket: 'actor', limit: 200, retryAfter: 120 });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('Retry-After'), '120');
    const body = await res.json();
    assert.equal(body.code, 'rate_limited');
    assert.match(body.error, /give it a little while/i);
    assert.doesNotMatch(body.error, /rate limit|quota|429|bucket|exceeded/i,
      'the reader is not an operator — no mechanism words');
  });

  test('a global limit says it is us, not them', async () => {
    const body = await limitResponse({ ok: false, reason: 'limit', bucket: 'global', retryAfter: 60 }).json();
    assert.match(body.error, /busier than usual/i);
    assert.doesNotMatch(body.error, /you.?ve done/i);
  });

  test('an unavailable limiter does NOT tell the reader they did too much', async () => {
    const res = limitResponse({ ok: false, reason: 'unavailable' });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'limiter_unavailable');
    assert.doesNotMatch(body.error, /you.?ve done|too many|busier/i,
      'blaming the reader for our outage would be a lie');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('caps cannot be disabled', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  test('a valid positive integer overrides the default', () => {
    assert.equal(capFromEnv({ X: '50' }, 'X', 10), 50);
  });

  test('zero, negatives, fractions, junk and absence all fall back to the default', () => {
    for (const v of ['0', '-1', '1.5', 'off', 'false', '', null, undefined, {}]) {
      assert.equal(capFromEnv({ X: v }, 'X', 10), 10, `env value ${JSON.stringify(v)} must not disable the cap`);
    }
    assert.equal(capFromEnv(undefined, 'X', 10), 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
describe('the caller address', () => {
// ═══════════════════════════════════════════════════════════════════════════════════════

  const req = (h) => new Request('https://x.test/', { headers: h });

  test('reads CF-Connecting-IP, which the edge sets and a client cannot forge', () => {
    assert.equal(clientIp(req({ 'CF-Connecting-IP': '203.0.113.7' })), '203.0.113.7');
  });

  test('X-Forwarded-For is ignored — a caller can append to it freely', () => {
    assert.equal(clientIp(req({ 'X-Forwarded-For': '1.2.3.4' })), null);
  });

  test('absent or absurd → null, and callers refuse on null', () => {
    assert.equal(clientIp(req({})), null);
    assert.equal(clientIp(req({ 'CF-Connecting-IP': 'x'.repeat(65) })), null);
  });
});
