// ACCOUNT DELETION — the unit half. The plans, the identity gate, the sequence and its resume,
// the endpoint's refusals, and the webhook guard. The emulator half (both halves run for real,
// then the whole database is walked) is deletion.emulator.test.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  judgeIdentity, membershipAction, planOwned, handlesOf, runDeletion, StepError, STEPS,
  OWNED_NODES, KEPT_NODES, RECENT_LOGIN_S, FOUNDERS, decodeJwtPayload,
} from '../../functions/api/account/_deletion.js';
import { onRequestPost } from '../../functions/api/account/delete.js';
import { buildMembershipUpdate, writeMembership } from '../../functions/api/membership/_membership.js';
import { planScrub, dropCovered } from '../../scripts/account/scrub-plan.mjs';

const T = 'TTTTdeleted000000000000000001';
const A = 'AAAAother0000000000000000002';
const NOW_S = 1790000000;

// ── the rules file is the census of uid-keyed nodes ────────────────────────────────────────
test('every uid-keyed node in the rules is deleted or kept BY DECISION', () => {
  const rules = JSON.parse(readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8')).rules;
  const uidKeyed = Object.entries(rules)
    .filter(([, v]) => v && typeof v === 'object' && Object.keys(v).some((c) => /^\$(uid|userId|user)$/.test(c)))
    .map(([k]) => k);
  const undecided = uidKeyed.filter((n) => !OWNED_NODES.includes(n) && !(n in KEPT_NODES));
  assert.deepEqual(undecided, [], 'a uid-keyed node with no deletion decision');
  for (const n of Object.keys(KEPT_NODES)) assert.ok(!OWNED_NODES.includes(n), `${n} is both kept and deleted`);
});

// ── identity ───────────────────────────────────────────────────────────────────────────────
describe('judgeIdentity', () => {
  const user = { localId: T, email: 'reader@example.com' };
  const fresh = { sub: T, user_id: T, auth_time: NOW_S - 60 };

  test('a verified token, signed in a minute ago — allowed', () => {
    assert.deepEqual(judgeIdentity({ user, payload: fresh, nowS: NOW_S }), { ok: true, uid: T, email: 'reader@example.com' });
  });
  test('no verified user — signed_out', () => {
    assert.equal(judgeIdentity({ user: null, payload: fresh, nowS: NOW_S }).code, 'signed_out');
  });
  test('a payload that names ANOTHER uid than the one Google verified — refused', () => {
    assert.equal(judgeIdentity({ user, payload: { ...fresh, sub: A, user_id: A }, nowS: NOW_S }).code, 'signed_out');
  });
  test(`a sign-in older than ${RECENT_LOGIN_S}s — requires_recent_login, with the window`, () => {
    const v = judgeIdentity({ user, payload: { ...fresh, auth_time: NOW_S - RECENT_LOGIN_S - 1 }, nowS: NOW_S });
    assert.equal(v.code, 'requires_recent_login');
    assert.equal(v.status, 401);
    assert.equal(v.maxAgeSeconds, RECENT_LOGIN_S);
    assert.equal(judgeIdentity({ user, payload: { ...fresh, auth_time: NOW_S - RECENT_LOGIN_S }, nowS: NOW_S }).ok, true);
  });
  test('no auth_time, or one from the future — refused', () => {
    assert.equal(judgeIdentity({ user, payload: { sub: T, user_id: T }, nowS: NOW_S }).code, 'requires_recent_login');
    assert.equal(judgeIdentity({ user, payload: { ...fresh, auth_time: NOW_S + 3600 }, nowS: NOW_S }).code, 'requires_recent_login');
  });
  test('a founder account is never deleted from here', () => {
    for (const f of FOUNDERS) {
      assert.equal(judgeIdentity({ user: { localId: f }, payload: { sub: f, user_id: f, auth_time: NOW_S }, nowS: NOW_S }).code, 'house_account');
    }
  });
});

// ── the endpoint's refusals, end to end through onRequestPost ──────────────────────────────
function jwt(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256' })}.${b(payload)}.sig`;
}
async function callEndpoint({ token, body, lookup }) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push(String(url));
    if (String(url).includes('accounts:lookup')) return lookup ? new Response(JSON.stringify({ users: [lookup] })) : new Response('{}', { status: 400 });
    if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: 'x' }));
    if (String(url).includes('/deletions/')) return new Response('null');
    if (String(url).includes('rate_limits')) return new Response('1');
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const request = new Request('https://x/api/account/delete', { method: 'POST', headers, body: body ? JSON.stringify(body) : '' });
    const env = { NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'sa@x', FIREBASE_PRIVATE_KEY: 'unused' };
    const res = await onRequestPost({ request, env, waitUntil() {} });
    return { status: res.status, body: await res.json(), calls };
  } finally { globalThis.fetch = real; }
}

describe('POST /api/account/delete — refusals, before anything is touched', () => {
  const now = Math.floor(Date.now() / 1000);
  test('no token — 401 signed_out, and no database call at all', async () => {
    const r = await callEndpoint({});
    assert.equal(r.status, 401); assert.equal(r.body.code, 'signed_out');
    assert.ok(!r.calls.some((u) => u.includes('firebasedatabase')));
  });
  test('a token Google rejects — 401 signed_out', async () => {
    const r = await callEndpoint({ token: jwt({ sub: T, user_id: T, auth_time: now }), lookup: null });
    assert.equal(r.status, 401); assert.equal(r.body.code, 'signed_out');
  });
  test('a stale sign-in — 401 requires_recent_login with maxAgeSeconds, nothing deleted', async () => {
    const r = await callEndpoint({ token: jwt({ sub: T, user_id: T, auth_time: now - 3600 }), lookup: { localId: T } });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'requires_recent_login');
    assert.equal(r.body.maxAgeSeconds, 300);
    assert.ok(!r.calls.some((u) => u.includes('rate_limits') || u.includes('deletions')));
  });
  test('ANOTHER uid in the body is ignored; a token naming another uid is refused', async () => {
    // The only uid the endpoint ever acts on is the verified one; there is no uid parameter.
    const r = await callEndpoint({ token: jwt({ sub: A, user_id: A, auth_time: now }), lookup: { localId: T } });
    assert.equal(r.body.code, 'signed_out');
  });
  test('a founder — 403 house_account', async () => {
    const f = FOUNDERS[0];
    const r = await callEndpoint({ token: jwt({ sub: f, user_id: f, auth_time: now }), lookup: { localId: f } });
    assert.equal(r.status, 403); assert.equal(r.body.code, 'house_account');
  });
});

// ── the plans ──────────────────────────────────────────────────────────────────────────────
describe('planOwned', () => {
  test('uid-keyed nodes, both halves of every follow, the handle only if it is still theirs, email rows', () => {
    const u = planOwned(T, {
      user: { username: 'Reader', handle: 'reader' },
      following: { [A]: true, [T]: true }, followers: { B1: true },
      handles: { Reader: T, reader: T, other: A },
      subscribers: { s1: { email: 'READER@example.com' }, s2: { email: 'someone@else.com' } },
      waitlist: { w1: { email: 'reader@example.com' } },
    }, 'reader@example.com');
    for (const n of OWNED_NODES) assert.equal(u[`${n}/${T}`], null);
    assert.ok(`followers/${A}/${T}` in u);
    assert.ok(`following/B1/${T}` in u);
    assert.ok(!(`followers/${T}/${T}` in u), 'a self-follow would be an overlapping path');
    assert.ok('usernames/reader' in u && 'usernames/Reader' in u && !('usernames/other' in u));
    assert.ok('subscribers/s1' in u && !('subscribers/s2' in u) && 'bookstore_waitlist/w1' in u);
    for (const kept of Object.keys(KEPT_NODES)) assert.ok(!(`${kept}/${T}` in u), `${kept} must be kept`);
    assert.deepEqual(handlesOf({ username: 'Reader', handle: 'a.b' }).sort(), ['Reader', 'reader']);
  });
  test('no email → no email rows', () => {
    const u = planOwned(T, { subscribers: { s1: { email: 'x@y' } } }, null);
    assert.ok(!('subscribers/s1' in u));
  });
});

describe('membershipAction', () => {
  test('active Stripe → cancel; active Paystack → disable; passes, cancelled, absent → nothing', () => {
    assert.deepEqual(membershipAction({ rail: 'stripe', status: 'active', stripeSubscriptionId: 'sub_1' }), { rail: 'stripe', id: 'sub_1' });
    assert.deepEqual(membershipAction({ rail: 'paystack', status: 'past_due', paystackSubscriptionCode: 'SUB_x' }), { rail: 'paystack', code: 'SUB_x' });
    assert.equal(membershipAction({ rail: 'stripe', status: 'cancelled', stripeSubscriptionId: 'sub_1' }), null);
    assert.equal(membershipAction({ pass: { kind: 'day', expiresAt: 1 } }), null);
    assert.equal(membershipAction(null), null);
  });
});

describe('planScrub — rulings 29–34 (Ikenna, 26 Sep 2026)', () => {
  const B = 'BBBBother0000000000000000003';
  const NOW = 1790500000000;
  const snap = {
    comments: {
      story: {
        c1: { authorUid: T, text: 'mine', heartCount: 1, createdAt: 10 },
        c2: { authorUid: A, text: 'reply to mine', parentId: 'c1', createdAt: 11 },
        c3: { authorUid: A, text: 'theirs', heartCount: 3, replies: { r1: { authorUid: T, text: 'nested' }, r2: { authorUid: A } } },
        c4: { authorUid: T, text: 'mine, alone', createdAt: 12 },
        c5: { authorUid: T, text: 'mine, with only my own reply', createdAt: 13 },
        c6: { authorUid: T, text: 'my reply to myself', parentId: 'c5' },
      },
      op2: {
        oc1: { authorUid: T, text: 'mine on their piece', createdAt: 20, replies: { or1: { authorUid: A, text: 'A under mine' } } },
        oc2: { authorUid: A, text: 'theirs', replies: { or2: { authorUid: T, text: 'mine', replies: { or3: { authorUid: B, text: 'B, two deep' } } }, or4: { authorUid: A, replies: { or5: { authorUid: T, text: 'mine, two deep' } } } } },
      },
    },
    comment_reactions: { story: { [T]: { c3: { heart: true } }, [A]: { c1: { heart: true } } } },
    commentReactions: { story: { c3: { [T]: { heart: true } }, c1: { [A]: { heart: true } } } },
    comment_likes: { op2: { oc1: { [A]: true }, oc2: { [T]: true, replies: { or4: { [T]: true, replies: { or5: { [A]: true } } } } } } },
    square_posts: {
      p1: { authorUid: A, likeCount: 2 }, p2: { authorUid: T, text: 'mine', createdAt: 5, likeCount: 1 },
      p3: { authorUid: A, parentId: 'p2' }, p4: { authorUid: T, text: 'mine, no replies' }, p5: { authorUid: T, parentId: 'p1', text: 'my reply' },
    },
    square_likes: { p1: { [T]: true, [A]: true }, p2: { [A]: true } },
    square_reactions: { p1: { like: { [T]: true } }, p2: { like: { [A]: true } } },
    storyReactionUsers: { story: { [T]: { heart: true, fire: false } } },
    leaderboards: { 'summer-2026': { final: { [T]: { points: 5 }, [A]: { points: 9 } } } },
    notifications: { [A]: { n1: { fromUid: T }, n2: { fromUid: 'X' } } },
    dm_messages: { [[A, T].sort().join('_')]: { m1: { senderUid: T }, m2: { senderUid: A } } },
    cms_voices: { v1: { matchUid: T, slug: 'v1', message: 'their words' }, v2: { matchUid: A, message: 'stays' } },
  };
  const plan = planScrub(T, snap, { now: NOW });
  const has = (p) => plan.nulls.includes(p);
  const tomb = (p) => plan.sets[p];

  test('29: their comment with nothing of anyone else\'s beneath it is deleted — and so is a thread that is all theirs', () => {
    assert.ok(has('comments/story/c4'));
    assert.ok(has('comments/story/c5') && has('comments/story/c6'));
    assert.equal(tomb('comments/story/c4'), undefined);
  });
  test('30: their comment with another reader\'s reply beneath it becomes a TOMBSTONE; the reply stays, parent intact', () => {
    assert.deepEqual(tomb('comments/story/c1'), { deleted: true, deletedAt: NOW, createdAt: 10 });
    assert.ok(!has('comments/story/c1') && !has('comments/story/c2'));
    assert.equal(plan.counts.commentTombstones, 3, 'c1, oc1 and the nested or2');
    assert.ok(plan.counts.repliesByOthersKept >= 2);
  });
  test('30: the tombstone carries no words, no author, no counts', () => {
    for (const [, t] of Object.entries(plan.sets)) {
      for (const k of ['text', 'authorUid', 'uid', 'authorName', 'heartCount', 'likeCount']) assert.equal(t[k], undefined, k);
    }
  });
  test('30, nested (Open Pages): a tombstone keeps the replies beneath it; their two-deep reply goes', () => {
    assert.deepEqual(tomb('comments/op2/oc1'), { deleted: true, deletedAt: NOW, createdAt: 20, replies: { or1: { authorUid: A, text: 'A under mine' } } });
    assert.deepEqual(tomb('comments/op2/oc2/replies/or2'), { deleted: true, deletedAt: NOW, replies: { or3: { authorUid: B, text: 'B, two deep' } } });
    assert.ok(has('comments/op2/oc2/replies/or4/replies/or5'), 'the two-deep reply of theirs — missed before W17');
    assert.ok(!has('comments/op2/oc2') && !has('comments/op2/oc2/replies/or4'));
  });
  test('reactions and likes ON a tombstoned comment go with its words; their likes elsewhere go at any depth', () => {
    assert.ok(has('commentReactions/story/c1') && has(`comment_reactions/story/${A}/c1`));
    assert.ok(has('comment_likes/op2/oc1'));
    assert.ok(has(`comment_likes/op2/oc2/${T}`) && has(`comment_likes/op2/oc2/replies/or4/${T}`));
    assert.ok(has('comment_likes/op2/oc2/replies/or4/replies/or5'), 'likes on their deleted two-deep reply');
  });
  test('their nested reply inside a comment that stays — and nothing else of it', () => {
    assert.ok(has('comments/story/c3/replies/r1'));
    assert.ok(!has('comments/story/c3') && !has('comments/story/c3/replies/r2'));
  });
  test('a reaction recorded in BOTH legacy shapes takes the counter down ONCE', () => {
    assert.deepEqual(plan.decrements.filter((d) => d === 'comments/story/c3/heartCount'), ['comments/story/c3/heartCount']);
  });
  test('29/30 Square: a post of theirs with another reader\'s reply is a tombstone; alone, or a reply of theirs, it goes', () => {
    assert.deepEqual(tomb('square_posts/p2'), { deleted: true, deletedAt: NOW, parentId: null, createdAt: 5 });
    assert.ok(!has('square_posts/p3'), 'the other reader\'s reply stays');
    assert.ok(has('square_posts/p4') && has('square_posts/p5'));
    assert.ok(has('square_likes/p2') && has('square_reactions/p2'), 'reactions on the tombstoned post go');
    assert.ok(has(`square_likes/p1/${T}`) && has(`square_reactions/p1/like/${T}`));
    assert.equal(plan.decrements.filter((d) => d === 'square_posts/p1/likeCount').length, 1);
    assert.equal(plan.counts.squareTombstones, 1);
  });
  test('31: their row comes off a finished season\'s board', () => {
    assert.ok(has(`leaderboards/summer-2026/final/${T}`) && !has(`leaderboards/summer-2026/final/${A}`));
  });
  test('32: DMs — only what they sent', () => {
    const conv = [A, T].sort().join('_');
    assert.ok(has(`dm_messages/${conv}/m1`) && !has(`dm_messages/${conv}/m2`));
  });
  test('33: the reader voice quoting them comes down — the record and its images; another voice stays', () => {
    assert.ok(has('cms_voices/v1') && !has('cms_voices/v2'));
    assert.deepEqual(plan.voices, [{ id: 'v1', storagePrefixes: ['voices/v1/'] }]);
    assert.equal(plan.counts.voicesRemoved, 1);
  });
  test('story reactions: only the types that were on; notifications they caused', () => {
    assert.ok(plan.decrements.includes('storyReactions/story/heart'));
    assert.ok(!plan.decrements.includes('storyReactions/story/fire'));
    assert.ok(has(`notifications/${A}/n1`) && !has(`notifications/${A}/n2`));
  });
  test('no counter under a path being deleted or tombstoned; no path overlaps another, removal or tombstone', () => {
    assert.ok(!plan.decrements.some((d) => d.startsWith('comments/story/c1/') || d.startsWith('square_posts/p2/')));
    assert.deepEqual(dropCovered(plan.nulls), plan.nulls);
    const all = [...plan.nulls, ...Object.keys(plan.sets)];
    for (const p of all) for (const q of all) if (p !== q) assert.ok(!q.startsWith(`${p}/`), `${q} under ${p}`);
    assert.deepEqual(dropCovered(['a/b', 'a', 'a/bc', 'ab']), ['a', 'ab']);
  });
  test('a second plan over the scrubbed data finds nothing of theirs (tombstones carry no author)', () => {
    const after = structuredClone(snap);
    const setAt = (p, v) => { const ks = p.split('/'); let o = after; for (const k of ks.slice(0, -1)) o = o[k] ??= {}; if (v === null) delete o[ks.at(-1)]; else o[ks.at(-1)] = v; };
    for (const p of plan.nulls) setAt(p, null);
    for (const [p, v] of Object.entries(plan.sets)) setAt(p, v);
    const again = planScrub(T, after, { now: NOW + 1 });
    assert.deepEqual(again.nulls, []);
    assert.deepEqual(again.sets, {});
  });
});

// ── the sequence, its order, and its resume ────────────────────────────────────────────────
function memIo(db, { failOnce = null, providerSubs = { stripe: [], paystack: [] } } = {}) {
  const calls = [];
  let failed = false;
  const trip = (what) => { if (failOnce === what && !failed) { failed = true; throw new Error(`injected ${what}`); } };
  const get = (p) => p.split('/').reduce((o, k) => (o == null ? null : o[k] ?? null), db);
  const set = (p, v) => {
    const ks = p.split('/'); let o = db;
    for (const k of ks.slice(0, -1)) o = o[k] ??= {};
    if (v === null) delete o[ks.at(-1)]; else o[ks.at(-1)] = structuredClone(v);
  };
  let t = 1000;
  return {
    calls,
    now: () => ++t,
    async get(p) { calls.push(`get ${p}`); return structuredClone(get(p)); },
    async patch(u) {
      const touchesOwned = Object.keys(u).some((k) => k.startsWith('users/'));
      if (touchesOwned) trip('owned');
      calls.push(`patch ${Object.keys(u).length}`);
      for (const [p, v] of Object.entries(u)) set(p, v);
    },
    async stripeCancel(id) { trip('membership'); calls.push(`stripe ${id}`); },
    async paystackDisable(code) { trip('membership'); calls.push(`paystack ${code}`); },
    // W3 / MON-05: what the providers hold for this uid, beyond the record.
    async stripeFindSubscriptions() { return providerSubs.stripe; },
    async paystackFindSubscriptions() { return providerSubs.paystack; },
    async storageList(prefix) { trip('storage'); calls.push(`list ${prefix}`); return prefix.startsWith('avatars/') ? [prefix, `${prefix}EXTRA`] : []; },
    async storageDelete(name) { calls.push(`rm ${name}`); },
    async authDelete(uid) { trip('auth'); calls.push(`auth ${uid}`); },
  };
}
const fixture = () => ({
  users: { [T]: { displayName: 'T', username: 'tee' } },
  usernames: { tee: T },
  memberships: { [T]: { rail: 'stripe', status: 'active', stripeSubscriptionId: 'sub_T' } },
  following: { [T]: { [A]: true } }, followers: { [A]: { [T]: true } },
});

describe('runDeletion', () => {
  test('ORDER: record → cancel → owned → storage → Auth LAST; the record is written before money moves', async () => {
    const db = fixture();
    const io = memIo(db);
    await runDeletion(T, null, io, { log() {} });
    const i = (s) => io.calls.findIndex((c) => c.startsWith(s));
    assert.ok(i('patch') < i('stripe'), 'record first');
    assert.ok(i('stripe') < io.calls.findIndex((c, k) => k > i('stripe') && c.startsWith('patch')), 'cancel before owned');
    assert.equal(io.calls.at(-2), `auth ${T}`, 'auth is the last outside call');
    assert.deepEqual(Object.keys(db.deletions[T].steps).sort(), [...STEPS].sort());
    assert.equal(db.users[T], undefined);
    assert.equal(db.usernames.tee, undefined);
    assert.equal(db.followers[A]?.[T], undefined);
    assert.ok(db.memberships[T], 'kept');
    assert.ok(io.calls.includes(`rm avatars/${T}`) && !io.calls.includes(`rm avatars/${T}EXTRA`), 'never another uid that extends this one');
  });

  test('Paystack is disabled, not Stripe, on the Paystack rail', async () => {
    const db = fixture();
    db.memberships[T] = { rail: 'paystack', status: 'active', paystackSubscriptionCode: 'SUB_p' };
    const io = memIo(db);
    await runDeletion(T, null, io, { log() {} });
    assert.ok(io.calls.includes('paystack SUB_p') && !io.calls.some((c) => c.startsWith('stripe')));
  });

  for (const step of STEPS) {
    test(`a failure at "${step}" throws that step, claims nothing after it, and a retry finishes`, async () => {
      const db = fixture();
      const io = memIo(db, { failOnce: step });
      await assert.rejects(runDeletion(T, null, io, { log() {} }), (e) => e instanceof StepError && e.step === step);
      assert.equal(db.deletions[T].steps[step], undefined, 'the failed step is not recorded');
      if (step !== 'auth') assert.ok(!io.calls.includes(`auth ${T}`), 'Auth is never reached past a failure');
      await runDeletion(T, null, io, { log() {} });
      assert.deepEqual(Object.keys(db.deletions[T].steps).sort(), [...STEPS].sort());
      assert.equal(io.calls.filter((c) => c === 'stripe sub_T').length, 1, 'a finished step is not repeated');
      assert.equal(io.calls.filter((c) => c === `auth ${T}`).length, 1);
    });
  }
});

// ── the webhook guard ──────────────────────────────────────────────────────────────────────
describe('membership webhooks after a deletion', () => {
  test('buildMembershipUpdate: a deleted account gets the billing record and nothing under users/', () => {
    const detail = { tier: 'gold', status: 'active' };
    assert.ok(`users/${T}/membership` in buildMembershipUpdate(T, detail));
    const deleted = Object.keys(buildMembershipUpdate(T, detail, { accountDeleted: true }));
    assert.ok(deleted.length > 0);
    assert.ok(deleted.every((k) => k.startsWith(`memberships/${T}/`)), deleted.join(', '));
  });

  test('writeMembership reads deletions/{uid} and withholds the scalar', async () => {
    const real = globalThis.fetch;
    const patches = [];
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).includes(`/deletions/${T}.json`)) return new Response(JSON.stringify({ uid: T }));
      if (opts.method === 'PATCH') { patches.push(JSON.parse(opts.body)); return new Response('{}'); }
      throw new Error(`unexpected ${url}`);
    };
    try { await writeMembership({}, 'tok', T, { tier: 'gold', status: 'active', lastInvoiceRef: 'in_1' }); }
    finally { globalThis.fetch = real; }
    const keys = Object.keys(patches[0]);
    assert.equal(keys.some((k) => k.startsWith('users/')), false);
    assert.ok(keys.every((k) => k.startsWith(`memberships/${T}/`)));
  });
});

test('decodeJwtPayload reads base64url', () => {
  assert.deepEqual(decodeJwtPayload(jwt({ sub: 'a-b_c', auth_time: 1 })), { sub: 'a-b_c', auth_time: 1 });
  assert.equal(decodeJwtPayload('garbage'), null);
});
