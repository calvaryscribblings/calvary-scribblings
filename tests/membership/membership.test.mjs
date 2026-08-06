// R10.3 — THE MEMBERSHIP WRITER AND THE TIER ARITHMETIC.
//
//   node --test tests/membership/membership.test.mjs      (npm run test:membership)
//
// Offline and host-independent: everything pure is asserted directly, and the one function
// that touches the network is driven through a stubbed fetch. Nothing here is wired to a
// webhook yet — that is R10.4 (Stripe) and R10.5 (Paystack). The shape is tested first,
// alone, because a shape that ships wrong has to be migrated rather than fixed.
//
// THE THREE THINGS MOST WORTH BREAKING A BUILD OVER:
//
//   1. THE SCALAR IS A STRING. The app compares users/{uid}/membership with strict equality
//      and has no `.tier`. An object there downgrades every paying member to free, silently,
//      on a fleet this repo cannot deploy a fix to.
//   2. THE PAIR IS ATOMIC. The scalar and the billing record are written in ONE root PATCH.
//      Separately written, they can disagree, and nothing arbitrates.
//   3. IDEMPOTENCY IS KEYED ON THE INVOICE. Keyed on the subscription id — which never
//      changes — every renewal reads as a replay and a paying member's period end freezes on
//      the day they joined.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  TIERS, isTier, normaliseTier, needsScalarRepair, maxTier, tierAtLeast,
  activePass, effectiveTier, describeMembership,
} from '../../app/lib/membership.js';
import {
  buildDetail, buildMembershipUpdate, shouldSkipMembershipGrant, classifyDowngrade,
  applyMembershipChange, writeMembership,
  SCALAR_PATH, DETAIL_PATH, STRIPE_SUB_REF_FIELDS,
} from '../../functions/api/membership/_membership.js';

const UID = 'reader-uid-0001';
const NOW = 1786000000000;
const ENV = {};

describe('the scalar contract — a string, and total over everything else', () => {
  test('the three tiers, and nothing else, are tiers', () => {
    assert.deepEqual(TIERS, ['free', 'gold', 'platinum']);
    for (const t of TIERS) assert.equal(isTier(t), true);
    for (const bad of ['PLATINUM', 'Gold', 'silver', '', 'freemium']) assert.equal(isTier(bad), false);
  });

  test('normaliseTier is TOTAL — every malformed value becomes free, never upward', () => {
    // Matches the app's own strict-equality read, so the two agree on malformed values and
    // not merely on well-formed ones. Guessing upward would hand out perks nobody paid for.
    const junk = [null, undefined, 0, 1, true, false, 'PLATINUM', 'gold ', ' gold',
      { tier: 'platinum' }, ['platinum'], NaN, Infinity, 'platinum\n'];
    for (const v of junk) {
      assert.equal(normaliseTier(v), 'free', `normaliseTier(${JSON.stringify(v)})`);
    }
    for (const t of TIERS) assert.equal(normaliseTier(t), t);
  });

  test('THE OBJECT SHAPE the app cannot read is normalised to free, not to its .tier', () => {
    // The exact live record a Stage 3C test account carries. If normaliseTier ever "helpfully"
    // read .tier out of it, this repo would disagree with the deployed app about what that
    // reader is entitled to — and the app is the one that decides.
    assert.equal(normaliseTier({ tier: 'platinum' }), 'free');
    assert.equal(normaliseTier({ tier: 'free' }), 'free');
  });

  test('needsScalarRepair separates PRESENT-and-wrong from simply absent', () => {
    assert.equal(needsScalarRepair(undefined), false, 'a reader who never subscribed needs no repair');
    assert.equal(needsScalarRepair(null), false);
    for (const t of TIERS) assert.equal(needsScalarRepair(t), false);
    assert.equal(needsScalarRepair({ tier: 'free' }), true, 'the Stage 3C shape IS a repair case');
    for (const bad of ['PLATINUM', 3, true, [], {}]) assert.equal(needsScalarRepair(bad), true);
  });

  test('tier ordering', () => {
    assert.equal(maxTier('free', 'gold'), 'gold');
    assert.equal(maxTier('platinum', 'gold'), 'platinum');
    assert.equal(maxTier('gold', 'gold'), 'gold');
    assert.equal(maxTier('junk', 'gold'), 'gold');
    assert.equal(maxTier('junk', 'nonsense'), 'free');
    assert.equal(tierAtLeast('platinum', 'gold'), true);
    assert.equal(tierAtLeast('gold', 'platinum'), false);
    assert.equal(tierAtLeast('gold', 'gold'), true);
  });
});

describe('passes — resolved at read time, never written into the scalar', () => {
  const withPass = (over = {}) => ({ tier: 'free', pass: { kind: 'day', tier: 'gold', expiresAt: NOW + 3600_000, ...over } });

  test('an unexpired pass lifts the effective tier', () => {
    assert.equal(effectiveTier('free', withPass(), NOW), 'gold');
    assert.equal(activePass(withPass(), NOW).kind, 'day');
  });

  test('AN EXPIRED PASS LIFTS NOTHING — the whole reason a pass is computed, not stored', () => {
    // Nothing comes along to write the scalar back down when a pass lapses. If a pass were
    // stored as a tier, an expired one would be permanent.
    assert.equal(effectiveTier('free', withPass({ expiresAt: NOW - 1 }), NOW), 'free');
    assert.equal(activePass(withPass({ expiresAt: NOW - 1 }), NOW), null);
    // and exactly at the boundary it is over
    assert.equal(activePass(withPass({ expiresAt: NOW }), NOW), null);
  });

  test('AN ISO-STRING EXPIRY IS TREATED AS NO PASS — the trap, asserted', () => {
    // A string compares against Date.now() as a string and would never expire. Refusing it
    // costs a reader a perk they paid £1 for, which is recoverable; honouring it would hand
    // out perks forever, which is not.
    assert.equal(activePass(withPass({ expiresAt: '2026-09-01T00:00:00Z' }), NOW), null);
    assert.equal(activePass(withPass({ expiresAt: String(NOW + 3600_000) }), NOW), null);
    assert.equal(activePass(withPass({ expiresAt: NaN }), NOW), null);
    assert.equal(activePass(withPass({ expiresAt: Infinity }), NOW), null);
  });

  test('a pass never DOWNGRADES a better subscription', () => {
    assert.equal(effectiveTier('platinum', withPass({ tier: 'gold' }), NOW), 'platinum');
    assert.equal(describeMembership('platinum', withPass({ tier: 'gold' }), NOW).source, 'subscription');
  });

  test('missing, malformed and absent passes are all simply no pass', () => {
    for (const d of [null, undefined, {}, { pass: null }, { pass: 'gold' }, { pass: 42 }]) {
      assert.equal(activePass(d, NOW), null);
      assert.equal(effectiveTier('gold', d, NOW), 'gold');
    }
  });

  test('describeMembership words the source honestly', () => {
    assert.equal(describeMembership('free', null, NOW).source, 'none');
    assert.equal(describeMembership('gold', null, NOW).source, 'subscription');
    assert.equal(describeMembership('free', withPass(), NOW).source, 'pass');
    // past_due keeps the tier — entitlement, not billing state
    const pastDue = { tier: 'gold', status: 'past_due' };
    assert.equal(describeMembership('gold', pastDue, NOW).tier, 'gold');
    assert.equal(describeMembership('gold', pastDue, NOW).status, 'past_due');
  });
});

describe('buildDetail — every key present, null when unknown', () => {
  test('a full record', () => {
    const d = buildDetail({
      tier: 'gold', interval: 'monthly', currency: 'GBP', rail: 'stripe', status: 'active',
      currentPeriodEnd: NOW + 30 * 86400_000, cancelAtPeriodEnd: false,
      founding: true, foundingSince: NOW, invoiceRef: 'in_123',
      refs: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' }, now: NOW,
    });
    assert.equal(d.tier, 'gold');
    assert.equal(d.currency, 'gbp', 'currency is lowercased to match the store');
    assert.equal(d.lastInvoiceRef, 'in_123');
    assert.equal(d.stripeCustomerId, 'cus_1');
    assert.equal(d.founding, true);
    assert.equal(d.updatedAt, NOW);
  });

  test('unknown values are explicit nulls, not absent keys', () => {
    const d = buildDetail({ tier: 'free', now: NOW });
    for (const k of ['interval', 'currency', 'rail', 'status', 'currentPeriodEnd',
      'foundingSince', 'lastInvoiceRef', 'pass']) {
      assert.ok(k in d, `${k} must be present`);
      assert.equal(d[k], null, `${k} must be null`);
    }
    assert.equal(d.cancelAtPeriodEnd, false);
    assert.equal(d.founding, false);
  });

  test('a bad enum becomes null rather than being stored verbatim', () => {
    const d = buildDetail({ tier: 'gold', interval: 'weekly', rail: 'paypal', status: 'trialing', now: NOW });
    assert.equal(d.interval, null);
    assert.equal(d.rail, null);
    assert.equal(d.status, null);
  });

  test('an empty rail identifier is DROPPED, never stored as null', () => {
    // _lib.js's rule: a null sitting in a record looking like a reference compares equal to
    // nothing and would send every later event to manual review.
    const d = buildDetail({ tier: 'gold', refs: { stripeSubscriptionId: '', stripeCustomerId: null, paystackSubscriptionCode: 'SUB_x' }, now: NOW });
    assert.equal('stripeSubscriptionId' in d, false);
    assert.equal('stripeCustomerId' in d, false);
    assert.equal(d.paystackSubscriptionCode, 'SUB_x');
  });

  test('a malformed tier cannot enter the record', () => {
    assert.equal(buildDetail({ tier: 'PLATINUM', now: NOW }).tier, 'free');
    assert.equal(buildDetail({ tier: { tier: 'gold' }, now: NOW }).tier, 'free');
  });
});

describe('buildMembershipUpdate — the atomic pair', () => {
  test('exactly two paths: the scalar and the detail', () => {
    const detail = buildDetail({ tier: 'platinum', rail: 'stripe', now: NOW });
    const body = buildMembershipUpdate(UID, detail);
    assert.deepEqual(Object.keys(body).sort(), [DETAIL_PATH(UID), SCALAR_PATH(UID)].sort());
    assert.equal(Object.keys(body).length, 2);
  });

  test('THE SCALAR IS A STRING — the assertion this whole file exists for', () => {
    const body = buildMembershipUpdate(UID, buildDetail({ tier: 'platinum', now: NOW }));
    const scalar = body[SCALAR_PATH(UID)];
    assert.equal(typeof scalar, 'string');
    assert.equal(scalar, 'platinum');
    assert.notDeepEqual(scalar, { tier: 'platinum' });
    assert.equal(TIERS.includes(scalar), true);
  });

  test('the scalar always agrees with the detail it is written beside', () => {
    for (const t of TIERS) {
      const body = buildMembershipUpdate(UID, buildDetail({ tier: t, now: NOW }));
      assert.equal(body[SCALAR_PATH(UID)], body[DETAIL_PATH(UID)].tier);
    }
    // and a malformed detail tier cannot desynchronise them
    const body = buildMembershipUpdate(UID, { tier: 'PLATINUM' });
    assert.equal(body[SCALAR_PATH(UID)], 'free');
  });

  test('the paths are fully qualified from the root, so one PATCH spans both nodes', () => {
    const body = buildMembershipUpdate(UID, buildDetail({ tier: 'gold', now: NOW }));
    assert.equal(SCALAR_PATH(UID), `users/${UID}/membership`);
    assert.equal(DETAIL_PATH(UID), `memberships/${UID}`);
    for (const p of Object.keys(body)) assert.equal(p.startsWith('/'), false);
  });

  test('a missing uid throws rather than writing to a path built from undefined', () => {
    assert.throws(() => buildMembershipUpdate(undefined, {}), /uid is required/);
    assert.throws(() => buildMembershipUpdate('', {}), /uid is required/);
  });
});

describe('idempotency — keyed on the INVOICE, never the subscription', () => {
  const detail = (over) => buildDetail({ tier: 'gold', invoiceRef: 'in_001', refs: { stripeSubscriptionId: 'sub_ABC' }, now: NOW, ...over });

  test('the same invoice twice is a replay', () => {
    assert.equal(shouldSkipMembershipGrant(detail(), 'in_001'), true);
  });

  test('A RENEWAL IS NOT A REPLAY — the bug this key exists to avoid', () => {
    // Same subscription, new invoice. Keyed on sub_ABC this would be skipped every month and
    // the member's period end would freeze on the day they joined.
    assert.equal(shouldSkipMembershipGrant(detail(), 'in_002'), false);
    assert.equal(shouldSkipMembershipGrant(detail(), 'sub_ABC'), false,
      'the subscription id must never match the invoice key');
  });

  test('STATUS PLAYS NO PART — R8.2.1, restated for subscriptions', () => {
    // A renewal arriving after a past_due is the normal shape of a recovered payment. A guard
    // that also required status==='active' would skip it and strand a member who has paid.
    for (const status of ['active', 'past_due', 'cancelled']) {
      assert.equal(shouldSkipMembershipGrant(detail({ status }), 'in_001'), true, `replay under ${status}`);
      assert.equal(shouldSkipMembershipGrant(detail({ status }), 'in_002'), false, `renewal under ${status}`);
    }
  });

  test('no record, or no reference, is never a skip', () => {
    assert.equal(shouldSkipMembershipGrant(null, 'in_001'), false);
    assert.equal(shouldSkipMembershipGrant(undefined, 'in_001'), false);
    assert.equal(shouldSkipMembershipGrant(detail(), ''), false);
    assert.equal(shouldSkipMembershipGrant(detail(), null), false);
    // two missing references must not compare equal and skip a write that should have happened
    assert.equal(shouldSkipMembershipGrant(buildDetail({ tier: 'gold', now: NOW }), ''), false);
  });
});

describe('downgrades — fail closed, matched on the subscription', () => {
  const stored = buildDetail({ tier: 'gold', refs: { stripeSubscriptionId: 'sub_LIVE', stripeCustomerId: 'cus_1' }, now: NOW });

  test('a matching subscription downgrades', () => {
    assert.equal(classifyDowngrade(stored, STRIPE_SUB_REF_FIELDS, ['sub_LIVE']).verdict, 'revoke');
  });

  test('A STALE SUBSCRIPTION DOES NOT — the resubscribe case', () => {
    // customer.subscription.deleted for a subscription the member already replaced must not
    // take away the one they are currently paying for.
    const r = classifyDowngrade(stored, STRIPE_SUB_REF_FIELDS, ['sub_OLD']);
    assert.equal(r.verdict, 'review');
    assert.deepEqual(r.stored, ['sub_LIVE', 'cus_1']);
  });

  test('no membership at all is `absent`, not a downgrade', () => {
    assert.equal(classifyDowngrade(null, STRIPE_SUB_REF_FIELDS, ['sub_LIVE']).verdict, 'absent');
  });

  test('two empty reference lists do NOT agree', () => {
    assert.equal(classifyDowngrade(buildDetail({ tier: 'gold', now: NOW }), STRIPE_SUB_REF_FIELDS, []).verdict, 'review');
    assert.equal(classifyDowngrade(stored, STRIPE_SUB_REF_FIELDS, []).verdict, 'review');
  });
});

describe('applyMembershipChange — the wiring, against a stubbed host', () => {
  function host({ detail = null, scalar = null, patchStatus = 200 } = {}) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      calls.push({ url: u, method: opts.method || 'GET', body: opts.body });
      const ok = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (opts.method === 'PATCH') {
        return patchStatus === 200 ? ok({}) : new Response('nope', { status: patchStatus });
      }
      if (u.includes('/memberships/')) return ok(detail);
      if (u.includes('/membership.json')) return ok(scalar);
      throw new Error(`unstubbed: ${u}`);
    };
    return { calls, restore() { globalThis.fetch = real; }, patch: () => calls.find((c) => c.method === 'PATCH') };
  }

  const grant = (over = {}) => ({
    kind: 'grant', invoiceRef: 'in_new',
    detail: buildDetail({ tier: 'gold', rail: 'stripe', status: 'active', invoiceRef: 'in_new', now: NOW }),
    ...over,
  });

  test('a grant writes ONE root PATCH carrying both paths', async () => {
    const h = host();
    try {
      const r = await applyMembershipChange(ENV, 'tok', UID, grant());
      assert.equal(r.verdict, 'written');
      const patch = h.patch();
      assert.ok(patch, 'a PATCH must have been issued');
      assert.match(patch.url, /\/\.json$/, 'the PATCH must be at the ROOT — that is what makes it atomic');
      const body = JSON.parse(patch.body);
      assert.deepEqual(Object.keys(body).sort(), [DETAIL_PATH(UID), SCALAR_PATH(UID)].sort());
      assert.equal(body[SCALAR_PATH(UID)], 'gold');
      assert.equal(typeof body[SCALAR_PATH(UID)], 'string');
      // exactly ONE write — never two sequential ones
      assert.equal(h.calls.filter((c) => c.method === 'PATCH').length, 1);
    } finally { h.restore(); }
  });

  test('a replayed invoice writes NOTHING', async () => {
    const h = host({ detail: buildDetail({ tier: 'gold', invoiceRef: 'in_new', now: NOW }) });
    try {
      const r = await applyMembershipChange(ENV, 'tok', UID, grant());
      assert.equal(r.verdict, 'skipped');
      assert.equal(h.patch(), undefined);
    } finally { h.restore(); }
  });

  test('a renewal on the same subscription DOES write', async () => {
    const h = host({ detail: buildDetail({ tier: 'gold', invoiceRef: 'in_old', refs: { stripeSubscriptionId: 'sub_A' }, now: NOW }) });
    try {
      const r = await applyMembershipChange(ENV, 'tok', UID, grant());
      assert.equal(r.verdict, 'written');
      assert.equal(JSON.parse(h.patch().body)[SCALAR_PATH(UID)], 'gold');
    } finally { h.restore(); }
  });

  test('a grant whose idempotency read FAILS still writes — fail open', async () => {
    const h = host();
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).includes('/memberships/') && (opts.method || 'GET') === 'GET') {
        return new Response('boom', { status: 500 });
      }
      return real(url, opts);
    };
    try {
      const r = await applyMembershipChange(ENV, 'tok', UID, grant());
      assert.equal(r.verdict, 'written', 'a paying member must not be dropped on a read blip');
    } finally { h.restore(); }
  });

  test('a downgrade whose read FAILS writes NOTHING — fail closed, the opposite posture', async () => {
    const h = host();
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).includes('/memberships/') && (opts.method || 'GET') === 'GET') {
        return new Response('boom', { status: 500 });
      }
      return real(url, opts);
    };
    try {
      const r = await applyMembershipChange(ENV, 'tok', UID, {
        kind: 'downgrade', refFields: STRIPE_SUB_REF_FIELDS, candidates: ['sub_LIVE'],
        detail: buildDetail({ tier: 'free', now: NOW }),
      });
      assert.equal(r.verdict, 'review');
      assert.equal(h.patch(), undefined, 'nothing may be written when the match cannot be proven');
    } finally { h.restore(); }
  });

  test('a downgrade for a STALE subscription writes nothing', async () => {
    const h = host({ detail: buildDetail({ tier: 'gold', refs: { stripeSubscriptionId: 'sub_LIVE' }, now: NOW }) });
    try {
      const r = await applyMembershipChange(ENV, 'tok', UID, {
        kind: 'downgrade', refFields: STRIPE_SUB_REF_FIELDS, candidates: ['sub_OLD'],
        detail: buildDetail({ tier: 'free', now: NOW }),
      });
      assert.equal(r.verdict, 'review');
      assert.equal(h.patch(), undefined);
    } finally { h.restore(); }
  });

  test('a matched downgrade writes free as a STRING', async () => {
    const h = host({ detail: buildDetail({ tier: 'gold', refs: { stripeSubscriptionId: 'sub_LIVE' }, now: NOW }) });
    try {
      const r = await applyMembershipChange(ENV, 'tok', UID, {
        kind: 'downgrade', refFields: STRIPE_SUB_REF_FIELDS, candidates: ['sub_LIVE'],
        detail: buildDetail({ tier: 'free', status: 'cancelled', now: NOW }),
      });
      assert.equal(r.verdict, 'written');
      assert.equal(JSON.parse(h.patch().body)[SCALAR_PATH(UID)], 'free');
    } finally { h.restore(); }
  });

  test('THE REPAIR CASE: a malformed scalar is overwritten, not trusted', async () => {
    // The live Stage 3C record: users/{uid}/membership = { tier: 'free' }, an object the app
    // cannot read. The write corrects it in passing; the point of naming the case is that
    // something upstream wrote a shape nobody expected and that must be visible.
    const h = host({ scalar: { tier: 'free' } });
    try {
      const r = await applyMembershipChange(ENV, 'tok', UID, grant());
      assert.equal(r.verdict, 'written');
      const scalar = JSON.parse(h.patch().body)[SCALAR_PATH(UID)];
      assert.equal(typeof scalar, 'string');
      assert.equal(scalar, 'gold');
    } finally { h.restore(); }
  });

  test('a failing repair probe never blocks the write', async () => {
    const h = host();
    const real = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      if (String(url).includes('/membership.json')) return new Response('boom', { status: 500 });
      return real(url, opts);
    };
    try {
      assert.equal((await applyMembershipChange(ENV, 'tok', UID, grant())).verdict, 'written');
    } finally { h.restore(); }
  });

  test('a failed PATCH throws — the caller decides the response policy', async () => {
    const h = host({ patchStatus: 500 });
    try {
      await assert.rejects(() => writeMembership(ENV, 'tok', UID, buildDetail({ tier: 'gold', now: NOW })),
        /root PATCH failed/);
    } finally { h.restore(); }
  });
});
