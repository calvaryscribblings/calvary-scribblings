// ACCOUNT DELETION — the web half. DeleteAccountModal hands every Firebase and network call to
// runDeleteFlow in app/lib/accountDeletion.js, so the real sequence runs here with stand-ins:
// the order of calls is the thing under test, and a failed deletion must never look like success.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  runDeleteFlow, DELETE_RETRIES, DELETE_MAX_CALLS, conditionalLines, hasPaidMembership, CONDITIONAL_LINES, COPY, DELETE_ENDPOINT,
} from '../../app/lib/accountDeletion.js';
import { describeMembership } from '../../app/lib/membership.js';

const OK = { status: 200, body: { deleted: true, uid: 'u1', scrub: 'queued' } };
const STALE = { status: 401, body: { error: 'Sign in again.', code: 'requires_recent_login', maxAgeSeconds: 300 } };
const MORE = { status: 202, body: { deleted: false, more: true, step: 'storage', code: 'more' } };
const BOOM = { status: 500, body: { error: 'Account deletion is unavailable right now.', code: 'delete_failed', step: 'auth' } };

/** A scripted browser: each call() answers with the next response; every call is logged. */
function harness(responses, { reauth = 'ok' } = {}) {
  const log = [];
  let signedIn = true;
  const deps = {
    getIdToken: async (force) => { log.push(`token${force ? ':forced' : ''}`); return 'tok'; },
    call: async () => { log.push('call'); const r = responses.shift(); if (r instanceof Error) throw r; return r; },
    reauthenticate: async () => { log.push('reauth'); if (reauth !== 'ok') throw new Error(reauth); },
    signOut: async () => { log.push('signOut'); signedIn = false; },
    wait: async (ms) => { log.push(`wait ${ms}`); },
  };
  return { deps, log, signedIn: () => signedIn };
}

describe('runDeleteFlow', () => {
  test('confirm → endpoint called → signed out', async () => {
    const h = harness([OK]);
    const r = await runDeleteFlow(h.deps);
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(h.log, ['token', 'call', 'signOut']);
    assert.equal(h.signedIn(), false);
  });

  test('requires_recent_login → reauth → retried ONCE with a fresh token → signed out', async () => {
    const h = harness([STALE, OK]);
    const r = await runDeleteFlow(h.deps);
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(h.log, ['token', 'call', 'reauth', 'token:forced', 'call', 'signOut']);
  });

  test('requires_recent_login twice → retried once only, error shown, still signed in', async () => {
    const h = harness([STALE, STALE, OK]);
    const r = await runDeleteFlow(h.deps);
    assert.equal(r.ok, false);
    assert.equal(h.log.filter((x) => x === 'call').length, 2);
    assert.equal(h.log.filter((x) => x === 'reauth').length, 1);
    assert.equal(h.signedIn(), true);
  });

  test('reauth cancelled or failed → no second call, still signed in', async () => {
    const h = harness([STALE, OK], { reauth: 'cancelled' });
    const r = await runDeleteFlow(h.deps);
    assert.deepEqual(r, { ok: false, stage: 'reauth', message: COPY.reauthFailed });
    assert.deepEqual(h.log, ['token', 'call', 'reauth']);
    assert.equal(h.signedIn(), true);
  });

  test('an endpoint error that persists → tried again, then the message, still signed in', async () => {
    const h = harness(Array(1 + DELETE_RETRIES).fill(BOOM));
    const r = await runDeleteFlow(h.deps);
    assert.deepEqual(r, { ok: false, stage: 'endpoint', message: COPY.failed });
    assert.equal(h.log.filter((x) => x === 'call').length, 1 + DELETE_RETRIES);
    assert.ok(!h.log.includes('signOut'));
    assert.equal(h.signedIn(), true);
  });

  test('a network failure that persists → message shown, still signed in', async () => {
    const h = harness(Array(1 + DELETE_RETRIES).fill(new TypeError('Failed to fetch')));
    const r = await runDeleteFlow(h.deps);
    assert.equal(r.ok, false);
    assert.equal(h.signedIn(), true);
  });

  // LIMITS-1 — paced: the server answers 202 { more: true } while there is more to do.
  test('202 more → called again until the 200 → signed out', async () => {
    const h = harness([MORE, MORE, MORE, OK]);
    const r = await runDeleteFlow(h.deps);
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(h.log, ['token', 'call', 'token', 'call', 'token', 'call', 'token', 'call', 'signOut']);
  });

  test('a failure between batches is tried again and the reader never sees it', async () => {
    const h = harness([MORE, BOOM, new TypeError('Failed to fetch'), MORE, BOOM, OK]);
    const r = await runDeleteFlow(h.deps);
    assert.deepEqual(r, { ok: true });
    assert.equal(h.signedIn(), false);
    assert.deepEqual(h.log.filter((x) => x.startsWith('wait')), ['wait 1000', 'wait 2000', 'wait 1000'], 'the misses reset after progress');
  });

  test('requires_recent_login in the middle of a paced run → one sign-in, then it carries on', async () => {
    const h = harness([MORE, STALE, MORE, OK]);
    const r = await runDeleteFlow(h.deps);
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(h.log, ['token', 'call', 'token', 'call', 'reauth', 'token:forced', 'call', 'token', 'call', 'signOut']);
  });

  test('a 202 that is not { more: true, deleted: false } is not progress, and never success', async () => {
    const h = harness([{ status: 202, body: { deleted: true } }]);
    assert.equal((await runDeleteFlow(h.deps)).ok, false);
    assert.equal(h.signedIn(), true);
  });

  test('a run that never finishes stops at the cap, still signed in', async () => {
    const h = harness(Array(DELETE_MAX_CALLS + 5).fill(MORE));
    const r = await runDeleteFlow(h.deps);
    assert.equal(r.ok, false);
    assert.equal(h.log.filter((x) => x === 'call').length, DELETE_MAX_CALLS);
    assert.equal(h.signedIn(), true);
  });

  test('the limiter is never retried: its sentence is the answer', async () => {
    for (const res of [{ status: 429, body: { error: 'Too many attempts. Try again in an hour.', code: 'rate_limited' } },
      { status: 503, body: { error: 'We could not check just now.', code: 'limiter_unavailable' } }]) {
      const h = harness([res]);
      const r = await runDeleteFlow(h.deps);
      assert.equal(h.log.filter((x) => x === 'call').length, 1);
      assert.match(r.message, /You’re still signed in\.$/);
    }
  });

  test('a 200 that does not say deleted:true is NOT success', async () => {
    for (const odd of [{ status: 200, body: null }, { status: 200, body: { deleted: false } }, { status: 204, body: null }]) {
      const h = harness([odd]);
      assert.equal((await runDeleteFlow(h.deps)).ok, false);
      assert.equal(h.signedIn(), true);
    }
  });

  test('the limiter\'s own sentence is passed through, and still says signed in', async () => {
    const h = harness([{ status: 429, body: { error: 'Too many attempts. Try again in an hour.' } }]);
    const r = await runDeleteFlow(h.deps);
    assert.match(r.message, /Try again in an hour\. You’re still signed in\.$/);
  });
});

// ── the two conditional lines ──────────────────────────────────────────────────────────────
describe('conditional lines', () => {
  const NOW = 1790000000000;
  const free = describeMembership('free', null, NOW);
  const gold = describeMembership('gold', { tier: 'gold', status: 'active' }, NOW);
  const livePass = describeMembership('free', { pass: { tier: 'gold', expiresAt: NOW + 3600e3 } }, NOW);
  const lapsedPass = describeMembership('free', { pass: { tier: 'gold', expiresAt: NOW - 1 } }, NOW);

  test('the membership line shows only with an active paid membership', () => {
    assert.equal(hasPaidMembership(gold), true);
    assert.equal(hasPaidMembership(livePass), true);
    assert.equal(hasPaidMembership(free), false);
    assert.equal(hasPaidMembership(lapsedPass), false);
    assert.equal(hasPaidMembership(null), false);
    assert.deepEqual(conditionalLines({ hasPaidMembership: true, isAuthor: false }), [CONDITIONAL_LINES.membership]);
    assert.deepEqual(conditionalLines({ hasPaidMembership: false, isAuthor: false }), []);
  });

  test('the author line shows only to authors', () => {
    assert.deepEqual(conditionalLines({ hasPaidMembership: false, isAuthor: true }), [CONDITIONAL_LINES.author]);
    assert.deepEqual(conditionalLines({ hasPaidMembership: false, isAuthor: undefined }), []);
    assert.deepEqual(conditionalLines({ hasPaidMembership: false, isAuthor: 'true' }), []);
    assert.deepEqual(conditionalLines({ hasPaidMembership: true, isAuthor: true }),
      [CONDITIONAL_LINES.membership, CONDITIONAL_LINES.author]);
  });
});

// ── the copy says only what the endpoint does ──────────────────────────────────────────────
describe('copy and wiring', () => {
  const modal = readFileSync(new URL('../../app/components/DeleteAccountModal.js', import.meta.url), 'utf8');
  const allCopy = JSON.stringify({ COPY, CONDITIONAL_LINES });

  test('no grace period, no restore promise, no CMS-story deletion', () => {
    assert.doesNotMatch(allCopy, /7[- ]day|seven days|restore everything|within \d+ days|schedul/i);
    assert.doesNotMatch(allCopy, /stories you.ve published on the CMS/i);
    assert.match(COPY.intro, /can’t be undone/);
  });

  test('the modal calls the endpoint and writes no soft-delete flag', () => {
    assert.equal(DELETE_ENDPOINT, '/api/account/delete');
    assert.match(modal, /runDeleteFlow/);
    assert.doesNotMatch(modal, /isDeleted|pendingDeletion|firebase\/database/);
  });

  test('nothing in app/ reads or writes the soft-delete flags any more', async () => {
    const { execSync } = await import('node:child_process');
    const root = new URL('../../', import.meta.url).pathname;
    const hits = execSync(
      `grep -rlE "pendingDeletion|\\.isDeleted|/isDeleted|userVisibility" app || true`, { cwd: root, encoding: 'utf8' },
    ).trim();
    assert.equal(hits, '', `soft-delete readers remain:\n${hits}`);
  });
});
