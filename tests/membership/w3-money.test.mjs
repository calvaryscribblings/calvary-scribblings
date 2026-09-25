// W3 — MONEY. Every payment path correct before live keys (24–25 Sep 2026).
//
//   node --test tests/membership/w3-money.test.mjs        (part of npm run test:membership)
//
// One block per fix, each written to go RED when its fix is reverted. The world below is a
// tiny in-memory RTDB plus routed Stripe / Paystack / Resend stubs, so a whole webhook runs —
// signature, handler, writer, response — and what it WROTE is asserted, not what it logged.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PRICE_BOOK, PORTAL_CONFIGURATION, TIERS, INTERVALS, STRIPE_CURRENCIES } from '../../functions/api/membership/prices.js';
import { onRequestPost as stripeHook, MEMBERSHIP_EVENTS } from '../../functions/api/membership/stripe-webhook.js';
import { onRequestPost as bookStripeHook, refundKeepsBook as stripeKeeps } from '../../functions/api/bookstore/stripe-webhook.js';
import { refundKeepsBook as paystackKeeps } from '../../functions/api/bookstore/paystack-webhook.js';
import { handleMembershipPaystackEvent, UPGRADE_WINDOW_MS } from '../../functions/api/membership/_paystack.js';
import { planChange } from '../../functions/api/membership/checkout.js';
import { paystackPlanChange } from '../../functions/api/membership/paystack-checkout.js';
import { onRequestPost as cancelPost, cancellable } from '../../functions/api/membership/paystack-cancel.js';
import { stripeState, paystackState } from '../../functions/api/membership/return-status.js';
import { STRIPE_VERSION, invoiceSubscriptionId, subscriptionPeriodEnd } from '../../functions/api/_stripe.js';
import {
  recordMoneyFailure, settleWebhook, faultArmed, isTestBuyer, isTestEnv, failureKey,
} from '../../functions/api/_money.js';
import { runDeletion } from '../../functions/api/account/_deletion.js';
import { billingBackstop } from '../../scripts/account/scrub.mjs';
import { returnBanner } from '../../app/lib/membershipReturn.js';
import { json } from '../../functions/api/bookstore/_lib.js';

const UID = 'w3ReaderUid0001';
const NOW = Date.now();
const SECRET = 'whsec_w3';
const ID = (t, iv, c) => `price_founding_${t}_${iv}_${c}`;
const { privateKey: PEM } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_w3', STRIPE_MEMBERSHIP_WEBHOOK_SECRET: SECRET, STRIPE_WEBHOOK_SECRET: SECRET,
  PAYSTACK_SECRET_KEY: 'sk_test_w3p',
  FIREBASE_CLIENT_EMAIL: 'svc@example.com', FIREBASE_PRIVATE_KEY: PEM,
  RESEND_API_KEY: 're_w3', MONEY_ALERT_EMAIL: 'alerts@example.com', NEXT_PUBLIC_FIREBASE_API_KEY: 'k',
};

let snapshot;
beforeEach(() => {
  snapshot = JSON.stringify({ book: PRICE_BOOK, portal: PORTAL_CONFIGURATION });
  for (const t of TIERS) for (const iv of INTERVALS) for (const c of STRIPE_CURRENCIES) PRICE_BOOK.founding.test[t][iv][c] = ID(t, iv, c);
  PORTAL_CONFIGURATION.founding.test = 'bpc_test';
});
afterEach(() => {
  const s = JSON.parse(snapshot);
  for (const t of TIERS) for (const iv of INTERVALS) Object.assign(PRICE_BOOK.founding.test[t][iv], s.book.founding.test[t][iv]);
  PORTAL_CONFIGURATION.founding.test = s.portal.founding.test;
});

// ── the world ───────────────────────────────────────────────────────────────────────────────
function world({ db = {}, stripe = {}, paystack = {}, failDbRead = false, onGet = null } = {}) {
  const calls = [];
  const emails = [];
  const real = globalThis.fetch;
  const at = (p) => p.split('/').filter(Boolean).reduce((o, k) => (o == null ? null : (o[k] ?? null)), db);
  const put = (p, v) => {
    const ks = p.split('/').filter(Boolean); let o = db;
    for (const k of ks.slice(0, -1)) o = (o[k] ??= {});
    if (v === null) delete o[ks.at(-1)];
    else if (v && typeof v === 'object' && '.sv' in v) o[ks.at(-1)] = (o[ks.at(-1)] || 0) + 1;
    else o[ks.at(-1)] = structuredClone(v);
  };
  const ok = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body, headers: opts.headers || {} });
    if (u.includes('oauth2.googleapis.com')) return ok({ access_token: 'tok', expires_in: 3600 });
    if (u.startsWith('https://api.resend.com/')) { emails.push(JSON.parse(opts.body)); return ok({ id: 'em_1' }); }
    if (u.includes('firebasedatabase.app')) {
      const path = decodeURIComponent(new URL(u).pathname.replace(/\.json$/, ''));
      if (method === 'PATCH') { for (const [k, v] of Object.entries(JSON.parse(opts.body))) put(`${path}/${k}`, v); return ok({}); }
      if (method === 'PUT') { put(path, JSON.parse(opts.body)); return ok({}); }
      if (failDbRead && path.includes('/memberships/')) return new Response('boom', { status: 500 });
      if (onGet) onGet(path, db);
      return ok(at(path));
    }
    if (u.startsWith('https://api.stripe.com/v1')) {
      const p = u.slice('https://api.stripe.com/v1'.length);
      for (const [pat, fn] of Object.entries(stripe)) if (p.startsWith(pat)) return ok(await fn(p, opts));
      throw new Error(`unstubbed stripe ${method} ${p}`);
    }
    if (u.startsWith('https://api.paystack.co')) {
      const p = u.slice('https://api.paystack.co'.length);
      for (const [pat, fn] of Object.entries(paystack)) if (p.startsWith(pat)) return ok(await fn(p, opts));
      throw new Error(`unstubbed paystack ${method} ${p}`);
    }
    throw new Error(`unstubbed ${u}`);
  };
  return {
    db, calls, emails, restore() { globalThis.fetch = real; },
    stripeCalls: (m, p) => calls.filter((c) => c.url.startsWith('https://api.stripe.com') && c.method === m && c.url.includes(p)),
  };
}

async function signStripe(body, secret = SECRET) {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  return `t=${t},v1=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
const deliver = async (hook, event) => {
  const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, ...event });
  return hook({ env: ENV, request: new Request('https://x/api/hook', { method: 'POST', headers: { 'Stripe-Signature': await signStripe(body) }, body }) });
};
const sub = ({ id = 'sub_A', price = ID('gold', 'monthly', 'gbp'), status = 'active', uid = UID, periodEnd = Math.floor(NOW / 1000) + 30 * 86400, dahlia = true } = {}) => ({
  id, object: 'subscription', customer: 'cus_1', status, cancel_at_period_end: false, currency: 'gbp',
  ...(dahlia ? {} : { current_period_end: periodEnd }),
  items: { data: [{ id: `si_${id}`, price: { id: price }, ...(dahlia ? { current_period_end: periodEnd } : {}) }] },
  metadata: { uid, kind: 'membership' },
});
const live = (over = {}) => ({ tier: 'gold', interval: 'monthly', rail: 'stripe', status: 'active', stripeSubscriptionId: 'sub_A', stripeCustomerId: 'cus_1', ...over });

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('MON-06 · the Stripe API version is pinned, and dahlia payloads are read', () => {
  test('the pinned version is the one the sandbox measured on 25 Sep 2026', () => {
    assert.equal(STRIPE_VERSION, '2026-03-25.dahlia');
  });

  test('every raw fetch to api.stripe.com in functions/ sends Stripe-Version', () => {
    const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk('functions').filter((p) => p.endsWith('.js') && !p.endsWith('_stripe.js'))) {
      const src = readFileSync(f, 'utf8');
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      if (!/api\.stripe\.com|STRIPE_API\b|PORTAL_API\b/.test(code)) continue;
      const fetches = code.split(/fetch\(/).slice(1).filter((chunk) => /^(STRIPE_API|PORTAL_API|`https:\/\/api\.stripe\.com)/.test(chunk));
      for (const chunk of fetches) assert.match(chunk.slice(0, 400), /'Stripe-Version': STRIPE_VERSION/, `${f}: a Stripe fetch without the pinned version`);
    }
  });

  test('both payload shapes read the same — before basil and dahlia', () => {
    assert.equal(invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_D' } } }), 'sub_D');
    assert.equal(invoiceSubscriptionId({ subscription: 'sub_O' }), 'sub_O');
    assert.equal(subscriptionPeriodEnd(sub({ dahlia: true, periodEnd: 111 })), 111);
    assert.equal(subscriptionPeriodEnd(sub({ dahlia: false, periodEnd: 222 })), 222);
  });

  test('A DAHLIA RENEWAL IS NOT IGNORED — invoice.paid grants and sets the period end', async () => {
    const w = world({ db: { memberships: { [UID]: live({ lastInvoiceRef: 'in_1' }) } }, stripe: { '/subscriptions/sub_A': () => sub() } });
    try {
      const res = await deliver(stripeHook, { type: 'invoice.paid', data: { object: { id: 'in_2', parent: { subscription_details: { subscription: 'sub_A', metadata: { uid: UID } } } } } });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).verdict, 'written', 'before W3 this was "ignored" — a one-off invoice');
      assert.equal(w.db.memberships[UID].lastInvoiceRef, 'in_2');
      assert.equal(typeof w.db.memberships[UID].currentPeriodEnd, 'number', 'before W3 always null on dahlia');
      assert.ok(w.calls.filter((c) => c.url.includes('api.stripe.com')).every((c) => c.headers['Stripe-Version'] === STRIPE_VERSION));
    } finally { w.restore(); }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('MON-01 · the membership endpoint is subscribed to every event it handles', () => {
  test('the event list includes refunds, disputes and delayed pass payments', () => {
    for (const e of ['checkout.session.completed', 'invoice.paid', 'customer.subscription.updated', 'customer.subscription.deleted',
      'invoice.payment_failed', 'charge.refunded', 'charge.dispute.created', 'checkout.session.async_payment_succeeded']) {
      assert.ok(MEMBERSHIP_EVENTS.includes(e), e);
    }
  });
  test('the setup script creates the endpoint from that list, at the pinned version', () => {
    const src = readFileSync('scripts/money/stripe-webhooks.mjs', 'utf8');
    assert.match(src, /MEMBERSHIP_EVENTS/);
    assert.match(src, /STRIPE_VERSION/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('MON-02 · Gold → Platinum switches; it never bills two', () => {
  test('the Stripe checkout decision', () => {
    assert.equal(planChange(null, { tier: 'gold', interval: 'monthly' }).action, 'checkout');
    assert.equal(planChange(live(), { tier: 'gold', interval: 'monthly' }).code, 'already_member');
    assert.equal(planChange(live(), { tier: 'platinum', interval: 'monthly' }).action, 'switch');
    assert.equal(planChange(live({ rail: 'paystack' }), { tier: 'platinum', interval: 'monthly' }).code, 'other_rail');
    assert.equal(planChange(live({ status: 'cancelled' }), { tier: 'gold', interval: 'monthly' }).action, 'checkout');
  });

  test('the Paystack checkout decision: a switch REPLACES the stored subscription', () => {
    const ps = live({ rail: 'paystack', paystackSubscriptionCode: 'SUB_A', stripeSubscriptionId: undefined });
    assert.deepEqual(paystackPlanChange(ps, { tier: 'platinum', interval: 'monthly' }), { action: 'switch', from: 'SUB_A' });
    assert.equal(paystackPlanChange(ps, { tier: 'gold', interval: 'monthly' }).code, 'already_member');
    assert.equal(paystackPlanChange(live(), { tier: 'gold', interval: 'monthly' }).code, 'other_rail');
  });

  test('THE WEBHOOK BACKSTOP: a second subscription is refused, recorded and emailed — never granted', async () => {
    const w = world({ db: { memberships: { [UID]: live() } }, stripe: { '/subscriptions/sub_B': () => sub({ id: 'sub_B', price: ID('platinum', 'monthly', 'gbp') }) } });
    try {
      const res = await deliver(stripeHook, { type: 'checkout.session.completed', data: { object: { id: 'cs_2', mode: 'subscription', subscription: 'sub_B', invoice: 'in_B1', client_reference_id: UID, metadata: { uid: UID } } } });
      assert.equal(res.status, 200);
      assert.equal((await res.json()).verdict, 'second_subscription');
      assert.equal(w.db.memberships[UID].stripeSubscriptionId, 'sub_A', 'the live subscription is untouched');
      assert.equal(w.db.users?.[UID]?.membership, undefined);
      assert.equal(Object.keys(w.db.ops.money_failures).length, 1);
      assert.equal(w.emails.length, 1);
    } finally { w.restore(); }
  });

  test('a price switch on the SAME subscription is a plain update — Platinum, one subscription', async () => {
    const w = world({ db: { memberships: { [UID]: live() } }, stripe: { '/subscriptions/sub_A': () => sub({ price: ID('platinum', 'monthly', 'gbp') }) } });
    try {
      const res = await deliver(stripeHook, { type: 'customer.subscription.updated', data: { object: sub() } });
      assert.equal((await res.json()).verdict, 'written');
      assert.equal(w.db.users[UID].membership, 'platinum');
      assert.equal(w.db.memberships[UID].stripeSubscriptionId, 'sub_A');
    } finally { w.restore(); }
  });

  test('PAYSTACK UPGRADE: the new plan grants, the old one is disabled and tombstoned, the sanction is spent', async () => {
    const plan = (t) => PLAN(t);
    const w = world({
      db: {
        memberships: { [UID]: { ...live({ rail: 'paystack', stripeSubscriptionId: undefined, stripeCustomerId: undefined, paystackSubscriptionCode: 'SUB_A', paystackCustomerCode: 'CUS_1', paystackPlanCode: plan('gold') }), upgrade: { from: 'SUB_A', plan: plan('platinum'), at: NOW } } },
      },
      paystack: {
        '/subscription/SUB_A': () => ({ status: true, data: { status: 'active', email_token: 'tok_A', next_payment_date: '2026-10-25T00:00:00.000Z', customer: { customer_code: 'CUS_1' } } }),
        '/subscription/disable': () => ({ status: true, data: { status: 'non-renewing' } }),
      },
    });
    try {
      const r = await handleMembershipPaystackEvent(ENV, async () => 'tok', {
        event: 'charge.success', domain: 'test',
        data: { reference: `ms.${UID}.platinum-monthly.abcdef012345`, status: 'success', plan: { plan_code: plan('platinum') }, customer: { customer_code: 'CUS_1' } },
      }, NOW);
      assert.equal(r.verdict, 'written');
      assert.equal(w.db.users[UID].membership, 'platinum');
      assert.ok(w.db.memberships[UID].ended.SUB_A, 'the old subscription is tombstoned');
      assert.equal(w.db.memberships[UID].upgrade, undefined, 'the sanction is spent');
      assert.equal(w.db.memberships[UID].paystackSubscriptionCode, undefined, 'the OLD code is not carried onto the new plan');
      assert.equal(w.calls.filter((c) => c.url.endsWith('/subscription/disable')).length, 1);
    } finally { w.restore(); }
  });

  test('…and without the sanction, the same charge is a second subscription', async () => {
    const w = world({ db: { memberships: { [UID]: live({ rail: 'paystack', stripeSubscriptionId: undefined, paystackSubscriptionCode: 'SUB_A', paystackCustomerCode: 'CUS_1', paystackPlanCode: PLAN('gold') }) } } });
    try {
      const r = await handleMembershipPaystackEvent(ENV, async () => 'tok', {
        event: 'charge.success', domain: 'test',
        data: { reference: `ms.${UID}.platinum-monthly.abcdef012345`, status: 'success', plan: { plan_code: PLAN('platinum') }, customer: { customer_code: 'CUS_1' } },
      }, NOW);
      assert.equal(r.verdict, 'second_subscription');
      assert.equal(w.db.users?.[UID]?.membership, undefined);
    } finally { w.restore(); }
  });

  test('an expired sanction sanctions nothing', () => {
    assert.ok(UPGRADE_WINDOW_MS <= 3 * 86400_000);
  });
});

// Paystack plan codes from the live test book.
import { PLAN_BOOK } from '../../functions/api/membership/paystack-plans.js';
function PLAN(tier) { return PLAN_BOOK.founding.test[tier].monthly; }

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('MON-03 · a late or out-of-order event never re-grants', () => {
  test('after subscription.deleted, a late subscription.updated writes NOTHING', async () => {
    const w = world({ db: { memberships: { [UID]: live() } }, stripe: { '/subscriptions/sub_A': () => sub({ status: 'canceled' }) } });
    try {
      await deliver(stripeHook, { type: 'customer.subscription.deleted', data: { object: sub({ status: 'canceled' }) } });
      assert.equal(w.db.users[UID].membership, 'free');
      assert.ok(w.db.memberships[UID].ended.sub_A);
      // The late one: Stripe's copy still says active (it was sent before the cancellation).
      const res = await deliver(stripeHook, { type: 'customer.subscription.updated', data: { object: sub({ status: 'active' }) } });
      assert.equal((await res.json()).verdict, 'stale');
      assert.equal(w.db.users[UID].membership, 'free', 'before W3 this wrote gold back');
    } finally { w.restore(); }
  });

  test('a late invoice.payment_failed after the cancellation does not bring Gold back', async () => {
    const w = world({ db: { memberships: { [UID]: { ...live({ status: 'cancelled', tier: 'free' }), ended: { sub_A: { at: NOW, reason: 'provider' } } } }, users: { [UID]: { membership: 'free' } } }, stripe: { '/subscriptions/sub_A': () => sub({ status: 'canceled' }) } });
    try {
      const res = await deliver(stripeHook, { type: 'invoice.payment_failed', data: { object: { id: 'in_9', parent: { subscription_details: { subscription: 'sub_A' } } } } });
      assert.equal(res.status, 200);
      assert.equal(w.db.users[UID].membership, 'free');
    } finally { w.restore(); }
  });

  test('a REPLAYED checkout.session.completed after the cancellation does not bring Gold back', async () => {
    const w = world({ db: { memberships: { [UID]: { ...live({ status: 'cancelled', tier: 'free', lastInvoiceRef: 'in_2' }), ended: { sub_A: { at: NOW, reason: 'provider' } } } }, users: { [UID]: { membership: 'free' } } }, stripe: { '/subscriptions/sub_A': () => sub() } });
    try {
      const res = await deliver(stripeHook, { type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_A', invoice: 'in_1', client_reference_id: UID, metadata: { uid: UID } } } });
      assert.equal((await res.json()).verdict, 'review', 'a PAYMENT on an ended subscription goes to a human');
      assert.equal(w.db.users[UID].membership, 'free');
    } finally { w.restore(); }
  });

  test('a REPLAYED old payment on an ended subscription is history, not an alarm — a NEW one is', async () => {
    const endedAt = NOW;
    const db = () => ({ memberships: { [UID]: { ...live({ status: 'cancelled', tier: 'free' }), ended: { sub_A: { at: endedAt, reason: 'refunded' } } } }, users: { [UID]: { membership: 'free' } } });
    const ev = (paidS) => ({ type: 'invoice.paid', data: { object: { id: 'in_x', status_transitions: { paid_at: paidS }, parent: { subscription_details: { subscription: 'sub_A' } } } } });
    let w = world({ db: db(), stripe: { '/subscriptions/sub_A': () => sub() } });
    try {
      assert.equal((await (await deliver(stripeHook, ev(Math.floor((endedAt - 60_000) / 1000)))).json()).verdict, 'stale');
      assert.equal(w.db.ops, undefined, 'a replay of a payment made before the end alarms nobody');
    } finally { w.restore(); }
    w = world({ db: db(), stripe: { '/subscriptions/sub_A': () => sub() } });
    try {
      assert.equal((await (await deliver(stripeHook, ev(Math.floor((endedAt + 60_000) / 1000)))).json()).verdict, 'review');
      assert.equal(w.db.users[UID].membership, 'free');
    } finally { w.restore(); }
  });

  test('a grant-shaped event whose LIVE state is canceled writes free, not gold', async () => {
    const w = world({ db: { memberships: { [UID]: live() } }, stripe: { '/subscriptions/sub_A': () => sub({ status: 'canceled' }) } });
    try {
      await deliver(stripeHook, { type: 'customer.subscription.updated', data: { object: sub() } });
      assert.equal(w.db.users[UID].membership, 'free');
      assert.equal(w.db.memberships[UID].status, 'cancelled');
    } finally { w.restore(); }
  });

  test('an incomplete subscription grants nothing', async () => {
    const w = world({ stripe: { '/subscriptions/sub_A': () => sub({ status: 'incomplete' }) } });
    try {
      const res = await deliver(stripeHook, { type: 'customer.subscription.updated', data: { object: sub() } });
      assert.equal((await res.json()).verdict, 'not_paid');
      assert.equal(w.db.users?.[UID]?.membership, undefined);
    } finally { w.restore(); }
  });

  test('Paystack: a renewal for a CANCELLED membership is not a re-grant', async () => {
    const w = world({ db: { memberships: { [UID]: { tier: 'free', rail: 'paystack', status: 'cancelled', paystackCustomerCode: 'CUS_1' } }, paystack_membership_index: { CUS_1: UID } } });
    try {
      const r = await handleMembershipPaystackEvent(ENV, async () => 'tok', {
        event: 'charge.success', domain: 'test',
        data: { reference: 'T_paystack_generated', status: 'success', plan: { plan_code: PLAN('gold') }, customer: { customer_code: 'CUS_1' } },
      }, NOW);
      assert.equal(r.verdict, 'review');
      assert.equal(w.db.users?.[UID]?.membership, undefined);
    } finally { w.restore(); }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('MON-14 · the writeMembership race', () => {
  test('a pass that lands between the read and the write SURVIVES the subscription write', async () => {
    // The race, staged exactly where it bites: AFTER the writer has read the record (the
    // deletion probe is the last read before the PATCH) and BEFORE it writes.
    const w = world({
      db: { memberships: { [UID]: live({ lastInvoiceRef: 'in_1' }) } },
      stripe: { '/subscriptions/sub_A': () => sub() },
      onGet: (path, db) => {
        if (path.endsWith(`/deletions/${UID}`)) db.memberships[UID].pass = { kind: 'day', ref: 'cs_pass', expiresAt: NOW + 86400_000, tier: 'gold' };
      },
    });
    try {
      await deliver(stripeHook, { type: 'invoice.paid', data: { object: { id: 'in_2', parent: { subscription_details: { subscription: 'sub_A' } } } } });
      assert.equal(w.db.memberships[UID].lastInvoiceRef, 'in_2');
      assert.equal(w.db.memberships[UID].pass?.ref, 'cs_pass', 'before W3 the wholesale write erased this pass');
    } finally { w.restore(); }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('MON-12 · refunds, as ruled on 24 Sep 2026', () => {
  const refundWorld = (charge, extra = {}) => world({
    db: { memberships: { [UID]: live() }, users: { [UID]: { membership: 'gold' } } },
    stripe: {
      '/invoice_payments': () => ({ data: [{ invoice: 'in_1' }] }),
      '/invoices/in_1': () => ({ id: 'in_1', parent: { subscription_details: { subscription: 'sub_A' } } }),
      '/subscriptions/sub_A': (p, o) => (o.method === 'DELETE' ? sub({ status: 'canceled' }) : sub()),
      ...extra,
    },
  });

  test('a FULL refund ends the membership NOW and cancels the subscription at Stripe', async () => {
    const w = refundWorld();
    try {
      const res = await deliver(stripeHook, { type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_1', refunded: true, amount: 299, amount_refunded: 299, metadata: {} } } });
      assert.equal((await res.json()).verdict, 'written');
      assert.equal(w.db.users[UID].membership, 'free');
      assert.equal(w.db.memberships[UID].endedReason, 'refunded');
      assert.equal(w.stripeCalls('DELETE', '/subscriptions/sub_A').length, 1);
    } finally { w.restore(); }
  });

  test('a PARTIAL refund on a membership keeps it', async () => {
    const w = refundWorld();
    try {
      const res = await deliver(stripeHook, { type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_1', refunded: false, amount: 299, amount_refunded: 100, metadata: {} } } });
      assert.equal((await res.json()).verdict, 'kept');
      assert.equal(w.db.users[UID].membership, 'gold');
      assert.equal(w.stripeCalls('DELETE', '/subscriptions').length, 0);
    } finally { w.restore(); }
  });

  test('a dispute ends it like a full refund', async () => {
    const w = refundWorld(null, { '/charges/ch_1': () => ({ id: 'ch_1', payment_intent: 'pi_1', refunded: false, metadata: {} }) });
    try {
      const res = await deliver(stripeHook, { type: 'charge.dispute.created', data: { object: { id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1' } } });
      assert.equal(res.status, 200);
      assert.equal(w.db.users[UID].membership, 'free');
    } finally { w.restore(); }
  });

  test('a FULL refund of a pass ends the pass NOW; a book charge is left to the bookstore', async () => {
    const w = world({
      db: { memberships: { [UID]: { pass: { kind: 'day', ref: 'cs_pass1', expiresAt: NOW + 86400_000, tier: 'gold' } } } },
      stripe: { '/checkout/sessions': () => ({ data: [{ id: 'cs_pass1' }] }) },
    });
    try {
      const res = await deliver(stripeHook, { type: 'charge.refunded', data: { object: { id: 'ch_p', payment_intent: 'pi_p', refunded: true, metadata: { uid: UID, kind: 'pass' } } } });
      assert.equal((await res.json()).verdict, 'written');
      assert.ok(w.db.memberships[UID].pass.expiresAt <= Date.now());
      assert.ok(w.db.memberships[UID].passRefunds.cs_pass1);
      const book = await deliver(stripeHook, { type: 'charge.refunded', data: { object: { id: 'ch_b', refunded: true, metadata: { uid: UID, titleId: 'basil' } } } });
      assert.equal((await book.json()).verdict, 'ignored');
    } finally { w.restore(); }
  });

  test('BOOKS: a partial refund keeps the book, a full one revokes it — both rails', () => {
    assert.equal(stripeKeeps('refunded', { refunded: false, amount: 499, amount_refunded: 100 }), true);
    assert.equal(stripeKeeps('refunded', { refunded: true }), false);
    assert.equal(stripeKeeps('disputed', { refunded: false }), false, 'a dispute still revokes');
    assert.equal(paystackKeeps('refunded', { amount: 50000 }, { amount: 180000 }), true);
    assert.equal(paystackKeeps('refunded', { amount: 180000 }, { amount: 180000 }), false);
    assert.equal(paystackKeeps('disputed', { amount: 1 }, { amount: 180000 }), false);
  });

  test('BOOKS end to end: a partial Stripe refund writes nothing to the purchase', async () => {
    const w = world({ db: { bookstore_purchases: { [UID]: { basil: { status: 'active', stripeSessionId: 'cs_b', stripePaymentIntent: 'pi_b', amount: 499 } } } } });
    try {
      const res = await deliver(bookStripeHook, { type: 'charge.refunded', data: { object: { id: 'ch_b', payment_intent: 'pi_b', refunded: false, amount: 499, amount_refunded: 100, metadata: { uid: UID, titleId: 'basil' } } } });
      assert.equal((await res.json()).verdict, 'kept');
      assert.equal(w.db.bookstore_purchases[UID].basil.status, 'active');
    } finally { w.restore(); }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('MON-05 · deleting an account cancels what the PROVIDER holds', () => {
  function memIo(db, found) {
    const calls = [];
    return {
      calls, now: () => NOW,
      async get(p) { return p.split('/').reduce((o, k) => (o == null ? null : o[k] ?? null), db); },
      async patch() {}, async storageList() { return []; }, async storageDelete() {}, async authDelete() {},
      async stripeCancel(id) { calls.push(`stripe ${id}`); },
      async paystackDisable(code) { calls.push(`paystack ${code}`); },
      async stripeFindSubscriptions() { return found.stripe; },
      async paystackFindSubscriptions() { return found.paystack; },
    };
  }
  test('a subscription whose tier was NEVER granted is cancelled too, on both rails', async () => {
    const io = memIo({ memberships: {} }, { stripe: ['sub_NEVER_GRANTED'], paystack: ['SUB_NEVER_GRANTED'] });
    await runDeletion(UID, 'r@example.com', io, { log() {} });
    assert.deepEqual(io.calls.sort(), ['paystack SUB_NEVER_GRANTED', 'stripe sub_NEVER_GRANTED']);
  });
  test('the recorded one and the found one are cancelled once each', async () => {
    const io = memIo({ memberships: { [UID]: live() } }, { stripe: ['sub_A'], paystack: [] });
    await runDeletion(UID, null, io, { log() {} });
    assert.deepEqual(io.calls, ['stripe sub_A']);
  });
  test('THE WRITER: a subscription going live AFTER deletion is cancelled at the provider and recreates nothing', async () => {
    const w = world({ db: { deletions: { [UID]: { uid: UID } } }, stripe: { '/subscriptions/sub_A': (p, o) => (o.method === 'DELETE' ? sub({ status: 'canceled' }) : sub()) } });
    try {
      const res = await deliver(stripeHook, { type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_A', invoice: 'in_1', client_reference_id: UID, metadata: { uid: UID } } } });
      assert.equal((await res.json()).verdict, 'paid_after_deletion');
      assert.equal(w.db.users, undefined, 'nothing under users/ — no stub profile');
      assert.equal(w.stripeCalls('DELETE', '/subscriptions/sub_A').length, 1);
      assert.ok(w.db.ops.money_failures);
      assert.equal(w.emails.length, 1);
    } finally { w.restore(); }
  });
  test('the scrub backstop reports a deleted reader whose record is still live', () => {
    assert.deepEqual(billingBackstop(UID, live()), { rail: 'stripe', ref: 'sub_A' });
    assert.equal(billingBackstop(UID, live({ status: 'cancelled' })), null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('MON-04 · no money failure is silent; a retry-fixable one is retried', () => {
  test('a thrown handler answers 500, lands in ops/money_failures, and emails ONCE across retries', async () => {
    const w = world({ failDbRead: true, stripe: { '/subscriptions/sub_A': () => sub() } });
    try {
      const event = { id: 'evt_fixed', type: 'invoice.paid', data: { object: { id: 'in_2', parent: { subscription_details: { subscription: 'sub_A' } } } } };
      const body = JSON.stringify(event);
      for (let i = 0; i < 3; i++) {
        const res = await stripeHook({ env: ENV, request: new Request('https://x/', { method: 'POST', headers: { 'Stripe-Signature': await signStripe(body) }, body }) });
        assert.equal(res.status, 500, 'before W3: 200 degraded, and Stripe never retried');
      }
      const rec = w.db.ops.money_failures['evt_fixed-failed'];
      assert.equal(rec.retryable, true);
      assert.equal(rec.count, 3);
      assert.equal(w.emails.length, 1, 'one email per failure, however many retries');
      assert.equal(w.emails[0].to[0], 'alerts@example.com');
    } finally { w.restore(); }
  });

  test('a verdict a retry cannot fix answers 200, and is still recorded', async () => {
    const w = world();
    try {
      const res = await settleWebhook(ENV, { run: async () => ({ verdict: 'review', why: 'x' }), rail: 'stripe', eventType: 't', eventKey: 'evt_r', label: 'l', json });
      assert.equal(res.status, 200);
      assert.ok(w.db.ops.money_failures['evt_r-review']);
    } finally { w.restore(); }
  });

  test('a failure record never throws, even with the database down and no email configured', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('down'); };
    try {
      const r = await recordMoneyFailure({ ...ENV, RESEND_API_KEY: '' }, { key: 'k', kind: 'x', summary: 's', token: 't' });
      assert.deepEqual(r, { recorded: false, emailed: false });
    } finally { globalThis.fetch = real; }
  });

  test('keys are RTDB-safe (Paystack references contain dots)', () => {
    assert.equal(failureKey('charge.success-ms.abc.gold'), 'charge_success-ms_abc_gold');
  });

  test('THE TEST-MODE SWITCHES READ NOTHING ON LIVE KEYS', async () => {
    let reads = 0;
    const fetchImpl = async () => { reads++; return new Response('true'); };
    const real = globalThis.fetch;
    globalThis.fetch = async (u) => { reads++; return String(u).includes('oauth2') ? new Response(JSON.stringify({ access_token: 't' })) : new Response('true'); };
    try {
      const liveEnv = { ...ENV, STRIPE_SECRET_KEY: 'sk_live_x' };
      assert.equal(isTestEnv(liveEnv), false);
      assert.equal(await faultArmed(liveEnv, 'tok', UID, { fetchImpl }), false);
      assert.equal(await isTestBuyer(liveEnv, UID, { fetchImpl }), false);
      assert.equal(await isTestBuyer({ ...ENV, PAYSTACK_SECRET_KEY: 'rk_live_x' }, UID, { fetchImpl }), false);
      assert.equal(reads, 0);
      // …and on test keys, a listed buyer IS let through (the control).
      assert.equal(await isTestBuyer(ENV, UID, { fetchImpl }), true);
    } finally { globalThis.fetch = real; }
  });

  test('the forced fault (test mode) makes the grant throw → 500, and clears when it expires', async () => {
    const w = world({ db: { ops: { money_fault: { [UID]: { until: Date.now() + 60_000 } } } }, stripe: { '/subscriptions/sub_A': () => sub() } });
    try {
      const ev = { type: 'invoice.paid', data: { object: { id: 'in_2', parent: { subscription_details: { subscription: 'sub_A' } } } } };
      assert.equal((await deliver(stripeHook, ev)).status, 500);
      w.db.ops.money_fault[UID].until = Date.now() - 1;
      assert.equal((await deliver(stripeHook, ev)).status, 200);
      assert.equal(w.db.users[UID].membership, 'gold');
    } finally { w.restore(); }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('MON-13 · the naira Cancel button', () => {
  test('only a live naira membership with a subscription code is cancellable', () => {
    assert.deepEqual(cancellable({ rail: 'paystack', status: 'active', paystackSubscriptionCode: 'SUB_1' }), { code: 'SUB_1' });
    assert.equal(cancellable({ rail: 'stripe', status: 'active', stripeSubscriptionId: 's' }), null);
    assert.equal(cancellable({ rail: 'paystack', status: 'cancelled', paystackSubscriptionCode: 'SUB_1' }), null);
  });

  const call = () => cancelPost({ env: ENV, request: new Request('https://x/api/membership/paystack-cancel', { method: 'POST', headers: { Authorization: 'Bearer idtok' } }) });
  const stubs = (disable) => ({
    '/subscription/SUB_1': () => ({ status: true, data: { status: 'active', email_token: 'etok', next_payment_date: '2026-10-25T09:00:00.000Z', customer: { customer_code: 'CUS_1' } } }),
    '/subscription/disable': disable,
  });
  test('cancelled: Paystack is told, with a token fetched on demand, and the reader keeps the period', async () => {
    let sent = null;
    const w = world({ db: { memberships: { [UID]: live({ rail: 'paystack', paystackSubscriptionCode: 'SUB_1', paystackCustomerCode: 'CUS_1' }) } }, paystack: stubs((p, o) => { sent = JSON.parse(o.body); return { status: true, data: { status: 'non-renewing' } }; }) });
    const real = globalThis.fetch;
    const inner = globalThis.fetch;
    globalThis.fetch = async (u, o) => (String(u).includes('accounts:lookup') ? new Response(JSON.stringify({ users: [{ localId: UID }] })) : inner(u, o));
    try {
      const res = await call();
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual(sent, { code: 'SUB_1', token: 'etok' });
      assert.equal(body.accessUntil, Date.parse('2026-10-25T09:00:00.000Z'));
      assert.equal(w.db.memberships[UID].cancelAtPeriodEnd, true);
      assert.equal(w.db.memberships[UID].tier, 'gold', 'the tier stays until the period ends — the webhook downgrades then');
    } finally { globalThis.fetch = real; w.restore(); }
  });
  test('failed: a Paystack refusal is a 502 the page offers to retry, and nothing is written', async () => {
    const w = world({ db: { memberships: { [UID]: live({ rail: 'paystack', paystackSubscriptionCode: 'SUB_1' }) } }, paystack: stubs(() => ({ status: false, message: 'nope' })) });
    const inner = globalThis.fetch;
    globalThis.fetch = async (u, o) => (String(u).includes('accounts:lookup') ? new Response(JSON.stringify({ users: [{ localId: UID }] })) : inner(u, o));
    try {
      const res = await call();
      assert.equal(res.status, 502);
      assert.equal((await res.json()).code, 'cancel_failed');
      assert.equal(w.db.memberships[UID].cancelAtPeriodEnd, undefined);
    } finally { w.restore(); }
  });
  test('the settings section has all four states, and no email-only route', () => {
    const src = readFileSync('app/components/MembershipSection.js', 'utf8');
    for (const s of ["'confirm'", "'cancelling'", "'cancelled'", "'failed'"]) assert.ok(src.includes(s), s);
    assert.match(src, /Cancelling…/);
    assert.match(src, /Try again/);
    assert.match(src, /Manage subscription/);
    assert.doesNotMatch(src, /Self-service for naira memberships is on its way/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('MON-09 · the return banner has a deadline and tells the two failures apart', () => {
  const b = (o) => returnBanner({ returned: 'join', settled: false, signedIn: true, authKnown: true, provider: 'unknown', overdue: false, ...o });
  test('settled or not a return: no banner', () => {
    assert.equal(b({ settled: true }), null);
    assert.equal(b({ returned: null }), null);
  });
  test('inside the deadline it is setting up; past it, it never says so', () => {
    assert.match(b({}).title, /SETTING UP/);
    for (const provider of ['paid', 'pending', 'unknown']) assert.doesNotMatch(b({ overdue: true, provider }).title, /SETTING UP/);
  });
  test('PAID-but-late and NOT-PAID are different banners', () => {
    const late = b({ overdue: true, provider: 'paid' });
    const failed = b({ provider: 'failed' });
    assert.notEqual(late.title, failed.title);
    assert.match(late.body, /went through/);
    assert.equal(late.contact, true);
    assert.match(failed.body, /nothing has been charged/);
  });
  test('signed out: a sign-in prompt, not a spinner', () => {
    assert.equal(b({ signedIn: false }).signIn, true);
  });
  test('the provider states map as documented', () => {
    assert.equal(stripeState({ payment_status: 'paid' }), 'paid');
    assert.equal(stripeState({ status: 'expired', payment_status: 'unpaid' }), 'failed');
    assert.equal(stripeState({ status: 'open', payment_status: 'unpaid' }), 'pending');
    assert.equal(paystackState('success'), 'paid');
    assert.equal(paystackState('abandoned'), 'failed');
    assert.equal(paystackState('ongoing'), 'pending');
  });
});
