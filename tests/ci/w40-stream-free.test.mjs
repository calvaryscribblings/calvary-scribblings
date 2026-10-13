// W40 — /api/series/stream GRANTS WHAT THE POLICY GRANTS (ruling 146), run for real.
//
//   node --test tests/ci/w40-stream-free.test.mjs      (part of npm run test:ci)
//
// The endpoint's onRequestPost, with every outbound call stubbed (identity, the admin token,
// the database, Cloud Storage), as tests/bookstore/stream-version.test.mjs does. A real RSA key
// so the URL signing runs its own path. Nothing reaches a network.
//
// The claim: a released free instalment opens for ANY signed-in reader — Free, a day-pass
// holder, Gold, Platinum — and asks a signed-out caller to sign in, saying it is free. And the
// controls: a Gold-taste or Platinum instalment still refuses a Free reader, and a free one that
// hasn't released yet refuses everyone.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { onRequestPost } from '../../functions/api/series/stream.js';
import { policyGrantForInstalment } from '../../app/lib/series/access.js';
import { GATE_ON_MS } from '../../app/lib/storyAccess.js';
import { effectiveTier } from '../../app/lib/membership.js';

const UID = 'reader-uid-w40';
const ID = 'probe-series-i1';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ENV = { NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key', FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey };

const PAST = Date.now() - 86_400_000;
const FUTURE = Date.now() + 30 * 86_400_000;
const row = (over = {}) => ({ schemaVersion: 1, seriesId: 'probe-series', ordinal: 1, releaseAtMs: PAST, freeForGold: true, openToFree: true, status: 'published', addedAt: 1, updatedAt: 1, ...over });
const PASS = { pass: { tier: 'gold', expiresAt: Date.now() + 3_600_000 } };

let realFetch = null;
function installHost({ instalment, membership = null, detail = null }) {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('identitytoolkit.googleapis.com')) return ok({ users: [{ localId: UID }] });
    if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 'stub-admin-token' });
    if (u.includes('storage.googleapis.com/storage/v1/')) return ok({ generation: '1', md5Hash: 'x' });
    if (u.includes(`/series_instalments/${ID}.json`)) return ok(instalment);
    if (u.includes(`/users/${UID}/membership.json`)) return ok(membership);
    if (u.includes(`/memberships/${UID}.json`)) return ok(detail);
    if (u.includes('/founder_preview/')) return ok(null);
    throw new Error(`unstubbed fetch: ${u}`);
  };
}
afterEach(() => { if (realFetch) globalThis.fetch = realFetch; realFetch = null; });

async function ask({ signedIn }) {
  const body = { instalmentId: ID, ...(signedIn ? { idToken: 'a-token' } : {}) };
  const res = await onRequestPost({ request: new Request('https://x.test/api/series/stream', { method: 'POST', body: JSON.stringify(body) }), env: ENV });
  return { status: res.status, body: await res.json() };
}

describe('W40 · the stream endpoint and a free instalment', () => {
  test('the tier gate is on (these are the after-launch answers, not the gate-off ones)', () => {
    assert.ok(Date.now() >= GATE_ON_MS);
    assert.equal(effectiveTier('free', PASS), 'gold', 'the day-pass fixture is a live pass');
  });

  for (const [who, membership, detail] of [['a Free reader', null, null], ['a day-pass holder', 'free', PASS], ['Gold', 'gold', null], ['Platinum', 'platinum', null]]) {
    test(`a released free instalment opens for ${who}`, async () => {
      installHost({ instalment: row(), membership, detail });
      const { status, body } = await ask({ signedIn: true });
      assert.equal(status, 200);
      assert.equal(body.reason, 'free_to_read');
      assert.ok(body.url, 'a signed URL');
    });
  }

  test('signed out, it asks for a sign-in and says the instalment is free', async () => {
    installHost({ instalment: row() });
    const { status, body } = await ask({ signedIn: false });
    assert.equal(status, 401);
    assert.equal(body.code, 'signed_out');
    assert.equal(body.openToFree, true);
    assert.equal(body.url, undefined);
  });

  test('control: a signed-out refusal of a paid instalment says nothing about free', async () => {
    installHost({ instalment: row({ openToFree: undefined }) });
    const { status, body } = await ask({ signedIn: false });
    assert.equal(status, 401);
    assert.equal('openToFree' in body, false);
  });

  test('control: the release gate still comes first — unreleased refuses even a signed-in reader', async () => {
    installHost({ instalment: row({ releaseAtMs: FUTURE }) });
    const { status, body } = await ask({ signedIn: true });
    assert.equal(status, 403);
    assert.equal(body.code, 'not_released');
  });

  for (const [what, over, reason] of [['a Gold-taste', { openToFree: undefined }, 'needs_gold'], ['a Platinum-only', { openToFree: false, freeForGold: false }, 'needs_platinum']]) {
    test(`control: ${what} instalment still refuses a Free reader`, async () => {
      installHost({ instalment: row(over) });
      const { status, body } = await ask({ signedIn: true });
      assert.equal(status, 403);
      assert.equal(body.reason, reason);
    });
  }

  test('the endpoint and the policy agree, reader by reader', async () => {
    for (const tier of ['free', 'gold', 'platinum']) {
      for (const over of [{}, { openToFree: undefined }, { openToFree: false, freeForGold: false }]) {
        const r = row(over);
        installHost({ instalment: r, membership: tier });
        const { body } = await ask({ signedIn: true });
        globalThis.fetch = realFetch; realFetch = null;
        const p = policyGrantForInstalment(r, { subscriptionTier: tier, signedIn: true });
        assert.equal(body.reason, p.reason, `${tier} ${JSON.stringify(over)}`);
      }
    }
  });
});
