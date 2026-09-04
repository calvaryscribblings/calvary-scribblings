// R36 — THE ORDER TEST. The limiter must be consulted BEFORE the Anthropic call.
//
// This is the assertion the whole feature rests on, and it is the one that cannot be
// made by reading _rate-limit.js: evaluate() can be perfect while the call site sits
// one line below `await moderateWithClaude(...)`, in which case every refused
// submission has already been paid for and the limiter has protected nothing.
//
// So this imports the REAL Pages Function, replaces global fetch with a router, and
// counts requests to api.anthropic.com. Rate-limited submission => the count must be
// ZERO. Move the check below the model call and this test goes 0 -> 1 and fails.
//
// Everything the handler needs is stubbed, including a genuine RSA key so the real
// service-account JWT signing path runs rather than being bypassed.

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { onRequestPost } from '../../functions/api/open-pages/moderate.js';
import { HOURLY_LIMIT, DAILY_LIMIT, HOUR_MS } from '../../functions/api/open-pages/_rate-limit.js';

const FB = 'https://db.example';
const UID = 'writer-uid-1';
let PRIVATE_KEY;

before(() => {
  PRIVATE_KEY = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
});

const ENV = () => ({
  NEXT_PUBLIC_FIREBASE_API_KEY: 'web-key',
  FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: PRIVATE_KEY,
  FIREBASE_DATABASE_URL: FB,
  ANTHROPIC_API_KEY: 'sk-test',
});

// The world the handler talks to. `state` is mutable per test.
let state, realFetch;

function router() {
  return async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';

    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'svc-token' }), { status: 200 });
    }
    if (u.includes('identitytoolkit.googleapis.com')) {
      return new Response(JSON.stringify({ users: [{ localId: UID }] }), { status: 200 });
    }
    if (u.includes('api.anthropic.com')) {
      state.anthropicCalls++;
      return new Response(JSON.stringify({
        content: [{ type: 'tool_use', name: 'moderate_post', input: { decision: 'pass', categories: [], reason: 'clean' } }],
      }), { status: 200 });
    }
    if (u.startsWith(`${FB}/open_pages_rate/`)) {
      if (method === 'GET') {
        return new Response(JSON.stringify(state.recent), { status: 200, headers: { ETag: 'e1' } });
      }
      state.counterWrites.push(JSON.parse(opts.body));
      return new Response('{}', { status: 200 });
    }
    if (u.startsWith(`${FB}/users/`)) {
      return new Response(JSON.stringify({ displayName: 'A Writer', username: 'awriter' }), { status: 200 });
    }
    if (u.startsWith(`${FB}/open_pages/`)) {                 // edit-mode read of the stored post
      return new Response(JSON.stringify(state.existing), { status: 200 });
    }
    if (u === `${FB}/.json` && method === 'PATCH') {
      state.patches.push(JSON.parse(opts.body));
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unrouted fetch: ${method} ${u}`);
  };
}

function post(body) {
  return onRequestPost({
    env: ENV(),
    request: new Request('https://site/api/open-pages/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer real-looking-token' },
      body: JSON.stringify(body),
    }),
  });
}

beforeEach(() => {
  state = { anthropicCalls: 0, patches: [], counterWrites: [], recent: [], existing: null };
  realFetch = globalThis.fetch;
  globalThis.fetch = router();
});
afterEach(() => { globalThis.fetch = realFetch; });

// ═══════════════════════════════════════════════════════════════════════════════
describe('R36 · the limiter is checked BEFORE the model call, never after', () => {
// ═══════════════════════════════════════════════════════════════════════════════

  test('an account under the limit is screened and published', async () => {
    const res = await post({ title: 'A piece', body: 'Some writing.' });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, 'published');
    assert.equal(state.anthropicCalls, 1, 'the screen must actually run for an allowed submission');
    assert.equal(state.counterWrites.length, 1, 'and the submission must be recorded');
  });

  test('⭐ AN ACCOUNT OVER THE HOURLY LIMIT NEVER REACHES THE MODEL', async () => {
    const now = Date.now();
    state.recent = Array.from({ length: HOURLY_LIMIT }, (_, i) => now - i * 60_000);

    const res = await post({ title: 'The sixth', body: 'Some writing.' });
    const data = await res.json();

    assert.equal(res.status, 429);
    assert.equal(data.status, 'rate_limited');
    assert.equal(data.scope, 'hour');
    // THE ASSERTION. If the check ever moves below moderateWithClaude, this is 1.
    assert.equal(state.anthropicCalls, 0, 'the refusal must cost nothing — no model call');
    assert.equal(state.patches.length, 0, 'and nothing may be stored');
    assert.ok(data.retryAt > now, 'the caller must be told when they can write again');
    assert.match(data.reason, /safe/i, 'and told their work is not lost');
  });

  test('an account over the DAILY limit never reaches the model either', async () => {
    const now = Date.now();
    // Spread so the hourly window is clear and only the daily one binds.
    state.recent = Array.from({ length: DAILY_LIMIT }, (_, i) => now - (i + 1) * 90 * 60_000);
    const res = await post({ title: 'The sixteenth', body: 'Some writing.' });
    const data = await res.json();
    assert.equal(res.status, 429);
    assert.equal(data.scope, 'day');
    assert.equal(state.anthropicCalls, 0);
  });

  test('a validation failure is refused ABOVE the limiter, so it consumes no slot', async () => {
    const res = await post({ title: '', body: 'Some writing.' });
    assert.equal(res.status, 400);
    assert.equal(state.anthropicCalls, 0);
    assert.equal(state.counterWrites.length, 0, 'a 400 must not spend the writer\'s allowance');
  });

  test('an edit by someone who is not the author is refused, and consumes no slot', async () => {
    state.existing = { authorUid: 'someone-else', title: 'T', body: 'B', createdAt: 1, status: 'live' };
    const res = await post({ title: 'T2', body: 'B2', postId: '-Oabc' });
    assert.equal(res.status, 403);
    assert.equal(state.anthropicCalls, 0);
    assert.equal(state.counterWrites.length, 0);
  });

  test('AN EDIT THAT CHANGES NO SCREENED TEXT costs neither a screen nor a slot', async () => {
    // The commonest honest edit is swapping a cover. The gate reads title + body and
    // nothing else, so there is nothing new to screen — and charging it to the
    // limiter is what would make five an hour bite a writer who is polishing.
    state.existing = {
      authorUid: UID, title: 'Same', body: 'Identical body.', createdAt: 1,
      status: 'live', readCount: 9,
      moderation: { decision: 'pass', checkedAt: 1, reason: 'clean' },
    };
    const res = await post({ title: 'Same', body: 'Identical body.', coverImage: 'https://x/new.jpg', postId: '-Oabc' });
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.status, 'published');
    assert.equal(data.rescreened, false);
    assert.equal(state.anthropicCalls, 0, 'unchanged text must not be re-screened');
    assert.equal(state.counterWrites.length, 0, 'and must not spend a slot');

    // The verdict must survive untouched — it still describes exactly this text.
    const written = state.patches[0][`open_pages/-Oabc`];
    assert.equal(written.moderation.decision, 'pass');
    assert.equal(written.body, 'Identical body.');
    assert.equal(written.coverImage, 'https://x/new.jpg');
    assert.equal(written.readCount, 9, 'the read count must not be reset by an edit');
    assert.ok(written.updatedAt > 1, 'but it is still an edit, and carries the mark');
  });

  test('an edit that DOES change the body is screened, and spends a slot', async () => {
    state.existing = {
      authorUid: UID, title: 'Same', body: 'Original body.', createdAt: 1, status: 'live',
      moderation: { decision: 'pass', checkedAt: 1, reason: 'clean' },
    };
    const res = await post({ title: 'Same', body: 'A DIFFERENT body.', postId: '-Oabc' });
    const data = await res.json();
    assert.equal(data.status, 'published');
    assert.equal(state.anthropicCalls, 1, 'changed text must be re-screened');
    assert.equal(state.counterWrites.length, 1);
    const written = state.patches[0][`open_pages/-Oabc`];
    assert.equal(written.moderation.checkedAt > 1, true, 'and it carries the FRESH verdict');
  });
});
