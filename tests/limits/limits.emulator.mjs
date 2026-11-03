// LIMITS-1 — the bulk quiz reset and account deletion under Cloudflare's real limits: 50
// subrequests per request and 6 connections at once, enforced on every outbound call by the
// PROOFS-R3.1 shim (tests/proofs/harness.mjs installLimits). The 51st fetch in a request throws as
// workerd does, and every test asserts no request reached it.
//
// Sizes: TODAY = the largest real case measured read-only on 3 Nov 2026 (the busiest quiz has 44
// readers; the reader with the most Storage objects holds 12), and TEN TIMES that (440 readers,
// 120 objects). Each loop is also interrupted mid-run and resumed, and must do nothing twice.
//
//   npm run test:limits:emulator
//
// Invented readers only. The real handlers run unmodified against the RTDB emulator; Google's
// token, sign-in and Storage endpoints and Stripe are stood in for. Nothing reaches production.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, installLimits, loadRules, wipe, get, set, request, context, tokenFor, STAND_IN_FOUNDER, ENV } from '../proofs/harness.mjs';
import { handleReset } from '../../functions/api/admin/reset-attempt.js';
import { handleDelete } from '../../functions/api/account/delete.js';
import { SUBREQUEST_LIMIT } from '../../functions/api/_budget.js';
import { runBulkReset } from '../../app/lib/quizResetLoop.js';
import { runDeleteFlow } from '../../app/lib/accountDeletion.js';
import { OWNED_NODES } from '../../functions/api/account/_deletion.js';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SLUG = 'invented-quiz';
const TODAY = { readers: 44, objects: 12 };
const TENX = { readers: 440, objects: 120 };
let L;

// ── the stand-ins: Storage (in memory), Auth delete, Stripe, and JWT-shaped sign-in tokens ──────
const store = new Set();            // object names
const deletes = new Map();          // name → DELETE calls that reached the store
const authDeleted = [];
const stripe = { subs: new Map() }; // id → { status, uid }
const stripeCancels = new Map();
const lose = { nextRootPatch: false };   // let the next root PATCH land, then lose its answer

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** An ID token shaped like Firebase's: the endpoint reads sub, user_id and auth_time from it. */
const idTokenFor = (uid, authTime) => `h.${b64({ sub: uid, user_id: uid, auth_time: authTime })}.s`;

function installStandIns() {
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init.method || 'GET').toUpperCase();
    if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup')) {
      const { idToken } = JSON.parse(init.body || '{}');
      const p = /^h\.([^.]+)\.s$/.exec(idToken || '');
      if (p) {
        const { sub } = JSON.parse(Buffer.from(p[1], 'base64url').toString());
        if (authDeleted.includes(sub)) return new Response('{"error":{"message":"USER_NOT_FOUND"}}', { status: 400 });
        return new Response(JSON.stringify({ users: [{ localId: sub, email: `${sub}@example.test` }] }), { status: 200 });
      }
      return inner(input, init);
    }
    if (/identitytoolkit\.googleapis\.com\/v1\/projects\/[^/]+\/accounts:delete/.test(url)) {
      authDeleted.push(JSON.parse(init.body).localId);
      return new Response('{}', { status: 200 });
    }
    if (url.startsWith('https://storage.googleapis.com/storage/v1/b/')) {
      const u = new URL(url);
      if (method === 'GET') {
        // Pages of 50, so a long listing really pages (GCS's own default is 1,000). The token is
        // the last name returned, as GCS's is in effect, so deleting while listing skips nothing.
        const prefix = u.searchParams.get('prefix');
        const after = u.searchParams.get('pageToken') ? decodeURIComponent(u.searchParams.get('pageToken')) : '';
        const all = [...store].filter((n) => n.startsWith(prefix) && n > after).sort();
        const page = all.slice(0, 50);
        const body = { items: page.map((name) => ({ name })) };
        if (all.length > 50) body.nextPageToken = encodeURIComponent(page.at(-1));
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (method === 'DELETE') {
        const name = decodeURIComponent(u.pathname.split('/o/')[1]);
        deletes.set(name, (deletes.get(name) || 0) + 1);
        return store.delete(name) ? new Response(null, { status: 204 }) : new Response(null, { status: 404 });
      }
    }
    if (url.startsWith('https://api.stripe.com/v1/subscriptions/search')) {
      const uid = /metadata\['uid'\]:'([^']+)'/.exec(new URL(url).searchParams.get('query'))?.[1];
      const data = [...stripe.subs].filter(([, s]) => s.uid === uid && s.status !== 'canceled').map(([id, s]) => ({ id, status: s.status }));
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    if (url.startsWith('https://api.stripe.com/v1/subscriptions/') && method === 'DELETE') {
      const id = decodeURIComponent(url.split('/').pop());
      stripeCancels.set(id, (stripeCancels.get(id) || 0) + 1);
      stripe.subs.get(id).status = 'canceled';
      return new Response('{}', { status: 200 });
    }
    if (method === 'PATCH' && new URL(url).pathname === '/.json' && lose.nextRootPatch) {
      lose.nextRootPatch = false;
      const res = await inner(input, init);
      if (!res.ok) return res;
      throw new TypeError('the connection dropped after the write landed');
    }
    return inner(input, init);
  };
  return () => { globalThis.fetch = inner; };
}

let restoreStandIns;
before(async () => {
  install();
  restoreStandIns = installStandIns();
  L = installLimits({ limit: SUBREQUEST_LIMIT, connections: 6 });
  await loadRules();
});
after(() => { L.uninstall(); restoreStandIns(); uninstall(); });
beforeEach(() => {
  L.calls.length = 0; L.refused = 0; L.peak = 0; L.killAt = null;
  store.clear(); deletes.clear(); authDeleted.length = 0; stripe.subs.clear(); stripeCancels.clear(); lose.nextRootPatch = false;
});

const within = (label) => {
  assert.equal(L.refused, 0, `${label}: a request went past ${SUBREQUEST_LIMIT} subrequests`);
  assert.ok(Math.max(...L.calls) <= SUBREQUEST_LIMIT, `${label}: worst request used ${Math.max(...L.calls)}`);
  assert.ok(L.peak <= 6, `${label}: ${L.peak} connections at once`);
};

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE BULK QUIZ RESET
// ═════════════════════════════════════════════════════════════════════════════════════════════

const reader = (i) => `limReader${String(i).padStart(4, '0')}`;

async function seedQuiz(n, { others = 3 } = {}) {
  await wipe();
  const subs = {}; const users = {}; const counted = {}; const tiers = {};
  for (let i = 0; i < n; i++) {
    const u = reader(i);
    subs[u] = { [SLUG]: { hardballPassed: true, submittedAt: NOW - 1000 }, 'another-quiz': { hardballPassed: true } };
    users[u] = { username: `invented${i}` };
    counted[u] = { [SLUG]: true }; tiers[u] = { [SLUG]: 'gold' };
  }
  for (let j = 0; j < others; j++) subs[`limOther${j}`] = { 'another-quiz': { hardballPassed: false } };
  await set('quiz_submissions', subs);
  await set('users', users);
  await set('quizAttemptCounted', counted);
  await set('userStoryTiers', tiers);
  await set(`cms_stories/${SLUG}/quizMeta/attemptCount`, n + 7);
}

/** One request to the endpoint, as the page's call(): the shim counts it as one request. */
async function resetCall(body) {
  L.begin();
  try {
    const { ctx } = context(request('/api/admin/reset-attempt', { body, token: tokenFor(STAND_IN_FOUNDER) }));
    const res = await handleReset(ctx, { admin: (c) => c?.uid === STAND_IN_FOUNDER, now: NOW });
    return { ok: res.ok, status: res.status, data: await res.json() };
  } finally { L.end(); }
}

async function quizState() {
  const subs = (await get('quiz_submissions')) || {};
  const log = (await get('quizResetLog')) || {};
  return {
    left: Object.values(subs).filter((s) => s?.[SLUG]).length,
    others: Object.values(subs).filter((s) => s?.['another-quiz']).length,
    log: Object.values(log),
    counted: Object.values((await get('quizAttemptCounted')) || {}).filter((s) => s?.[SLUG]).length,
    tiers: Object.values((await get('userStoryTiers')) || {}).filter((s) => s?.[SLUG]).length,
    attemptCount: await get(`cms_stories/${SLUG}/quizMeta/attemptCount`),
  };
}

for (const [label, size] of [['today\'s size', TODAY], ['ten times today\'s size', TENX]]) {
  describe(`bulk quiz reset at ${label} (${size.readers} readers on one quiz)`, () => {
    beforeEach(() => seedQuiz(size.readers));

    test('the page\'s loop finishes; every batch within 50; one audit entry per reader, nobody twice', async () => {
      const r = await runBulkReset(resetCall, { slug: SLUG, reason: 'invented', wait: async () => {} });
      assert.equal(r.ok, true, r.error);
      assert.equal(r.count, size.readers);
      const s = await quizState();
      assert.equal(s.left, 0, 'every submission on the quiz is reset');
      assert.equal(s.others, size.readers + 3, 'no other quiz touched');
      assert.equal(s.counted, 0); assert.equal(s.tiers, 0);
      assert.equal(s.attemptCount, 7, 'attemptCount went down by exactly the readers reset');
      assert.equal(s.log.length, size.readers, 'one audit entry per reader: none dropped');
      assert.equal(new Set(s.log.map((e) => e.targetUid)).size, size.readers, 'nobody logged twice');
      assert.ok(s.log.every((e) => e.action === 'bulk' && e.slug === SLUG && e.reason === 'invented' && e.targetHandle && e.runId), 'complete entries, handles included');
      assert.equal(new Set(s.log.map((e) => e.runId)).size, 1, 'one run');
      within(label);
      console.log(`# bulk reset, ${label}: ${r.calls} calls, worst ${Math.max(...L.calls)} subrequests`);
    });

    test('a batch killed before its write: the next call does it, nothing twice', async () => {
      let patches = 0;
      // Kill the 2nd batch's PATCH (or the 1st, at today's size) before it reaches the database.
      const killAt = size.readers > 45 ? 2 : 1;
      L.killAt = (url) => (url === 'https://proofs.test/.json' && ++patches === killAt ? new Error('isolate died') : null);
      const r = await runBulkReset(resetCall, { slug: SLUG, wait: async () => {} });
      assert.equal(r.ok, true, r.error);
      const s = await quizState();
      assert.equal(s.left, 0);
      assert.equal(s.log.length, size.readers, 'one entry per reader');
      assert.equal(new Set(s.log.map((e) => e.targetUid)).size, size.readers, 'nobody twice');
      assert.equal(s.attemptCount, 7, 'decremented once per reader, not again for the retried batch');
      within(`${label}, killed`);
    });

    test('a batch whose write LANDED but whose answer was lost: the retry skips it, nothing twice', async () => {
      lose.nextRootPatch = true;
      const r = await runBulkReset(resetCall, { slug: SLUG, wait: async () => {} });
      assert.equal(r.ok, true, r.error);
      const s = await quizState();
      assert.equal(s.left, 0);
      assert.equal(s.log.length, size.readers);
      assert.equal(s.attemptCount, 7);
      within(`${label}, lost answer`);
    });
  });
}

describe('bulk quiz reset: the run is the unit', () => {
  test('a reader reset in batch 1 who retakes before batch 2 keeps the new attempt', async () => {
    await seedQuiz(100);
    const first = await resetCall({ slug: SLUG, action: 'bulk', runId: null });
    assert.equal(first.data.more, true);
    const early = reader(0);
    await set(`quiz_submissions/${early}/${SLUG}`, { hardballPassed: true, submittedAt: NOW + 5000 });
    let runId = first.data.runId; let more = true;
    while (more) { const r = await resetCall({ slug: SLUG, action: 'bulk', runId }); more = r.data.more; runId = r.data.runId; }
    assert.ok(await get(`quiz_submissions/${early}/${SLUG}`), 'the retake survives the rest of the run');
    assert.equal((await quizState()).log.length, 100, 'and is not logged twice');
    within('retake');
  });

  test('a run id that is not a push id is refused before any path is built', async () => {
    await seedQuiz(3);
    for (const runId of ['../x', 'a/b', '', 'x'.repeat(21), 7]) {
      const r = await resetCall({ slug: SLUG, action: 'bulk', runId });
      assert.equal(r.status, 400, JSON.stringify(runId));
    }
    assert.equal((await quizState()).left, 3);
  });

  test('a single reset carries its audit entry in the same write', async () => {
    await seedQuiz(2);
    const r = await resetCall({ slug: SLUG, action: 'reset', uid: reader(1), reason: 'invented' });
    assert.equal(r.data.wasReset, true);
    const s = await quizState();
    assert.equal(s.left, 1);
    assert.equal(s.log.length, 1);
    assert.equal(s.log[0].targetUid, reader(1));
    assert.equal(s.attemptCount, 2 + 7 - 1);
    assert.ok(L.calls.at(-1) <= 6, `single reset used ${L.calls.at(-1)}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ACCOUNT DELETION
// ═════════════════════════════════════════════════════════════════════════════════════════════

const LEAVER = 'limLeaver000000000000000001';
const DENV = { ...ENV, STRIPE_SECRET_KEY: 'sk_test_invented' };

async function seedLeaver(objects, { sub = true } = {}) {
  await wipe();
  await set('users', { [LEAVER]: { username: 'leaver', displayName: 'Invented' }, limFriend: { username: 'friend' } });
  await set('usernames', { leaver: LEAVER, friend: 'limFriend' });
  await set('following', { [LEAVER]: { limFriend: true }, limFriend: { [LEAVER]: true } });
  await set('followers', { [LEAVER]: { limFriend: true }, limFriend: { [LEAVER]: true } });
  await set(`quiz_submissions/${LEAVER}`, { q: { x: 1 } });
  await set(`points/${LEAVER}`, 10);
  if (sub) {
    await set(`memberships/${LEAVER}`, { status: 'active', rail: 'stripe', stripeSubscriptionId: 'sub_invented1', tier: 'gold' });
    stripe.subs.set('sub_invented1', { status: 'active', uid: LEAVER });
    stripe.subs.set('sub_invented2', { status: 'past_due', uid: LEAVER });
  }
  store.add(`avatars/${LEAVER}`);
  store.add(`headers/${LEAVER}`);
  for (let i = 0; i < objects - 2; i++) store.add(`open_pages/${LEAVER}/img-${String(i).padStart(4, '0')}.webp`);
  store.add('avatars/limFriend');
  store.add(`open_pages/limFriend/keep.webp`);
}

/** One request to the endpoint, as the page's call(). */
async function deleteCall(token) {
  L.begin();
  try {
    const { ctx, settle } = context(new Request('https://calvaryscribblings.co.uk/api/account/delete', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), DENV);
    const res = await handleDelete(ctx, { nowS: Math.floor(NOW / 1000) });
    await settle();          // the limiter's sweep runs in waitUntil, and counts against the request
    let body = null; try { body = await res.json(); } catch { /* none */ }
    return { status: res.status, body };
  } finally { L.end(); }
}

function flowDeps(authTime = Math.floor(NOW / 1000) - 60) {
  const out = { signedOut: false, calls: 0 };
  out.deps = {
    getIdToken: async () => idTokenFor(LEAVER, authTime),
    call: async (t) => { out.calls += 1; return deleteCall(t); },
    reauthenticate: async () => { throw new Error('not expected'); },
    signOut: async () => { out.signedOut = true; },
    wait: async () => {},
  };
  return out;
}

async function assertGone(label) {
  for (const n of OWNED_NODES) assert.equal(await get(`${n}/${LEAVER}`), null, `${label}: ${n} still holds the reader`);
  assert.equal(await get('usernames/leaver'), null);
  assert.equal(await get(`following/limFriend/${LEAVER}`), null);
  assert.deepEqual([...store].sort(), ['avatars/limFriend', 'open_pages/limFriend/keep.webp'], `${label}: only other readers' objects remain`);
  assert.deepEqual(authDeleted, [LEAVER], `${label}: the Auth account deleted once, last`);
  const rec = await get(`deletions/${LEAVER}`);
  assert.deepEqual(Object.keys(rec.steps).sort(), ['auth', 'membership', 'owned', 'storage']);
  assert.ok([...deletes.values()].every((n) => n === 1), `${label}: an object was deleted twice`);
}

for (const [label, size] of [['today\'s size', TODAY], ['ten times today\'s size', TENX]]) {
  describe(`account deletion at ${label} (${size.objects} Storage objects, two subscriptions)`, () => {
    beforeEach(() => seedLeaver(size.objects));

    test('the page\'s flow finishes with no failure shown; every request within 50', async () => {
      const f = flowDeps();
      const r = await runDeleteFlow(f.deps);
      assert.deepEqual(r, { ok: true });
      assert.equal(f.signedOut, true);
      await assertGone(label);
      assert.deepEqual([...stripeCancels.values()], [1, 1], 'each subscription cancelled once');
      const m = await get(`memberships/${LEAVER}`);
      assert.equal(m.status, 'cancelled', 'the billing record is kept, and says cancelled');
      within(label);
      console.log(`# account deletion, ${label}: ${f.calls} calls, worst ${Math.max(...L.calls)} subrequests`);
      if (size === TODAY) assert.equal(f.calls, 1, 'today\'s worst reader is still one call');
    });

    test('a request killed mid-Storage: the flow resumes, nothing deleted twice, no failure shown', async () => {
      let n = 0;
      L.killAt = (url) => (url.startsWith('https://storage.googleapis.com/') && url.includes('/o/open_pages') && ++n === 3 ? new Error('isolate died') : null);
      const f = flowDeps();
      const r = await runDeleteFlow(f.deps);
      assert.deepEqual(r, { ok: true });
      await assertGone(`${label}, killed`);
      within(`${label}, killed`);
    });

    test('a request killed between the Stripe cancel and its record: resumed, the reader still deleted', async () => {
      let n = 0;
      // The 2nd root PATCH is the membership step's outcome write, after both cancels.
      L.killAt = (url) => (url === 'https://proofs.test/.json' && ++n === 2 ? new Error('isolate died') : null);
      const f = flowDeps();
      const r = await runDeleteFlow(f.deps);
      assert.deepEqual(r, { ok: true });
      await assertGone(`${label}, killed in membership`);
      // The step resumes from the billing record, which still said 'active', so the recorded
      // subscription is asked to cancel once more: a no-op at Stripe (already cancelled), and the
      // same as before LIMITS-1. The one found only by search is not asked again.
      assert.equal(stripeCancels.get('sub_invented2'), 1);
      assert.ok(stripeCancels.get('sub_invented1') <= 2);
      within(`${label}, killed in membership`);
    });
  });
}

describe('account deletion: pacing', () => {
  test('a paced call answers 202 { more: true }, never a failure, and the next call resumes', async () => {
    await seedLeaver(TENX.objects);
    const first = await deleteCall(idTokenFor(LEAVER, Math.floor(NOW / 1000) - 60));
    assert.equal(first.status, 202);
    assert.deepEqual(first.body, { deleted: false, more: true, step: 'storage', code: 'more' });
    assert.ok(store.size > 2, 'work remains');
    assert.deepEqual(authDeleted, [], 'the Auth account is never deleted while anything remains');
    within('paced');
  });

  test('a continuation is not held to the first call\'s 5-a-minute cap', async () => {
    await seedLeaver(TENX.objects * 3);   // 360 objects: about ten calls inside one minute
    const f = flowDeps();
    const r = await runDeleteFlow(f.deps);
    assert.deepEqual(r, { ok: true });
    assert.ok(f.calls > 5, `${f.calls} calls`);
    within('continuation');
  });
});
