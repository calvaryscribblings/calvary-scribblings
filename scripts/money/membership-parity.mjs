#!/usr/bin/env node
// W25 — THE FOUNDING MEMBERSHIP SET, TEST AGAINST LIVE. Read-only: every request is a GET.
//
//   node scripts/money/membership-parity.mjs            the table
//   node scripts/money/membership-parity.mjs --json     the same, as JSON
//
// Keys, from the environment (never printed): STRIPE_TEST_SECRET_KEY, STRIPE_LIVE_SECRET_KEY,
// PAYSTACK_TEST_SECRET_KEY, PAYSTACK_LIVE_SECRET_KEY.
//
// Every object is reported by its INTERNAL NAME — gold-monthly-gbp, the gold product, the founding
// portal, gold-annual-ngn — and compared with its test twin FIELD BY FIELD. Fields that are
// identifiers by nature (ids, created, livemode, a product id inside a price) are compared as the
// internal name they resolve to, never as the raw id, so "same" means the same shape in both modes.
//
// Exit 0 when every live object exists and matches; 1 otherwise (including "not created yet").

import { STRIPE_VERSION } from '../../functions/api/_stripe.js';
import { TIERS, INTERVALS, STRIPE_CURRENCIES, AMOUNTS } from '../../functions/api/membership/prices.js';
import { AMOUNTS as NGN_AMOUNTS } from '../../functions/api/membership/paystack-plans.js';

const KEYS = {
  stripe: { test: process.env.STRIPE_TEST_SECRET_KEY, live: process.env.STRIPE_LIVE_SECRET_KEY },
  paystack: { test: process.env.PAYSTACK_TEST_SECRET_KEY, live: process.env.PAYSTACK_LIVE_SECRET_KEY },
};
for (const [rail, m] of Object.entries(KEYS)) for (const [mode, k] of Object.entries(m)) {
  if (!k) { console.error(`${rail} ${mode} key is not set`); process.exit(2); }
  const live = /^(sk|rk)_live_/.test(k);
  if (live !== (mode === 'live')) { console.error(`the ${rail} ${mode} key is not a ${mode} key`); process.exit(2); }
}

const stripe = async (mode, path) => {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${KEYS.stripe[mode]}`, 'Stripe-Version': STRIPE_VERSION } });
  const j = await r.json();
  if (!r.ok) throw new Error(`stripe ${mode} GET ${path.split('?')[0]} → ${r.status} ${j?.error?.message || ''}`);
  return j;
};
const paystack = async (mode, path) => {
  const r = await fetch(`https://api.paystack.co/${path}`, { headers: { Authorization: `Bearer ${KEYS.paystack[mode]}` } });
  const j = await r.json();
  if (!r.ok || j.status !== true) throw new Error(`paystack ${mode} GET ${path.split('?')[0]} → ${r.status} ${j?.message || ''}`);
  return j;
};

export const lookupKey = (tier, interval, currency) => `founding_${tier}_${interval}_${currency}`;
export const internal = (tier, interval, currency) => `${tier}-${interval}-${currency}`;
export const planName = (tier, interval) =>
  `Calvary ${tier[0].toUpperCase()}${tier.slice(1)} — ${interval === 'monthly' ? 'Monthly' : 'Annual'}`;   // "(Founding)" dropped by ruling 111

// ── gather one mode ───────────────────────────────────────────────────────────────────────
// LIST endpoints only: Stripe's search is eventually consistent and misses objects created moments
// ago (the W25 duplicate-product incident — see scripts/create-founding-prices.mjs).
async function listAll(mode, path) {
  const out = [];
  for (let after = null; ;) {
    const page = await stripe(mode, `${path}${path.includes('?') ? '&' : '?'}limit=100${after ? `&starting_after=${after}` : ''}`);
    out.push(...(page.data || []));
    if (!page.has_more || !page.data?.length) return out;
    after = page.data[page.data.length - 1].id;
  }
}

async function stripeSet(mode) {
  const all = await listAll(mode, '/products?active=true');
  const products = {};
  for (const tier of TIERS) products[tier] = all.filter((p) => p.metadata?.calvary_tier === tier && p.metadata?.calvary_generation === 'founding');
  const prices = {};
  for (const tier of TIERS) for (const interval of INTERVALS) for (const currency of STRIPE_CURRENCIES) {
    const s = await stripe(mode, `/prices?lookup_keys[0]=${encodeURIComponent(lookupKey(tier, interval, currency))}&limit=10`);
    prices[internal(tier, interval, currency)] = s.data || [];
  }
  const configs = await listAll(mode, '/billing_portal/configurations');
  const founding = configs.filter((c) => c.active && c.metadata?.calvary_generation === 'founding');
  const portal = [];
  for (const c of founding) portal.push(await stripe(mode, `/billing_portal/configurations/${c.id}?expand[]=features.subscription_update.products`));
  return { products, prices, portal };
}

async function paystackSet(mode) {
  const all = (await paystack(mode, 'plan?perPage=200')).data || [];
  const plans = {};
  for (const tier of TIERS) for (const interval of INTERVALS) plans[internal(tier, interval, 'ngn')] = all.filter((p) => p.name === planName(tier, interval) && !p.is_deleted);
  return { plans };
}

// ── shapes: what is compared, identifiers resolved to internal names ─────────────────────
const productShape = (p) => p && {
  name: p.name, description: p.description ?? null, active: p.active, metadata: p.metadata,
  tax_code: p.tax_code ?? null, statement_descriptor: p.statement_descriptor ?? null, unit_label: p.unit_label ?? null,
  type: p.type ?? null, shippable: p.shippable ?? null, url: p.url ?? null, images: (p.images || []).length,
  marketing_features: (p.marketing_features || []).map((f) => f.name),
};
const priceShape = (p, productName) => p && {
  product: productName(p.product), unit_amount: p.unit_amount, currency: p.currency, active: p.active,
  type: p.type, billing_scheme: p.billing_scheme, tax_behavior: p.tax_behavior, nickname: p.nickname ?? null,
  lookup_key: p.lookup_key, metadata: p.metadata,
  recurring: p.recurring && { interval: p.recurring.interval, interval_count: p.recurring.interval_count, usage_type: p.recurring.usage_type, trial_period_days: p.recurring.trial_period_days ?? null, meter: p.recurring.meter ?? null },
};
const portalShape = (c, productName, priceName) => c && {
  business_profile: c.business_profile, default_return_url: c.default_return_url ?? null, login_page_enabled: !!c.login_page?.enabled,
  metadata: c.metadata, is_default: c.is_default, active: c.active,
  features: {
    ...c.features,
    subscription_update: c.features?.subscription_update && {
      ...c.features.subscription_update,
      products: (c.features.subscription_update.products || [])
        .map((p) => ({ product: productName(p.product), prices: (p.prices || []).map(priceName).sort(), adjustable_quantity: p.adjustable_quantity ?? null }))
        .sort((a, b) => String(a.product).localeCompare(String(b.product))),
    },
  },
};
const planShape = (p) => p && {
  name: p.name, amount: p.amount, currency: p.currency, interval: p.interval, description: p.description ?? null,
  send_invoices: p.send_invoices, send_sms: p.send_sms, hosted_page: p.hosted_page, invoice_limit: p.invoice_limit ?? 0,
  is_archived: p.is_archived ?? false,
};

// Flatten to path → value, so a difference is named by its field.
function flat(o, pre = '', out = {}) {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const k of Object.keys(o).sort()) flat(o[k], pre ? `${pre}.${k}` : k, out);
  } else out[pre] = JSON.stringify(o);
  return out;
}
const diff = (a, b) => {
  const fa = flat(a), fb = flat(b);
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort().filter((k) => fa[k] !== fb[k]);
};

export async function parity() {
  const [st, sl, pt, pl] = await Promise.all([stripeSet('test'), stripeSet('live'), paystackSet('test'), paystackSet('live')]);
  const rows = [];
  const names = (set) => {
    const byId = {};
    for (const tier of TIERS) for (const p of set.products[tier]) byId[p.id] = `${tier} product`;
    for (const [n, ps] of Object.entries(set.prices)) for (const p of ps) byId[p.id] = n;
    return (id) => byId[id] || '(not in the founding set)';
  };
  const nt = names(st), nl = names(sl);
  const row = (name, t, l, shapeT, shapeL) => {
    const status = !t.length ? 'NO TEST TWIN' : !l.length ? 'not in live' : (t.length > 1 || l.length > 1) ? `DUPLICATES (test ${t.length}, live ${l.length})` : null;
    if (status) { rows.push({ name, status, fields: 0, differ: [] }); return; }
    const a = shapeT(t[0]), b = shapeL(l[0]);
    const d = diff(a, b);
    rows.push({ name, status: d.length ? 'DIFFERS' : 'match', fields: Object.keys(flat(a)).length, differ: d.map((k) => `${k}: test ${flat(a)[k]} / live ${flat(b)[k]}`) });
  };
  for (const tier of TIERS) row(`${tier} product (Stripe)`, st.products[tier], sl.products[tier], productShape, productShape);
  for (const tier of TIERS) for (const interval of INTERVALS) for (const currency of STRIPE_CURRENCIES) {
    const n = internal(tier, interval, currency);
    // The settled table, too: a price that matches its twin but not the table is still wrong.
    const want = AMOUNTS[tier][interval][currency];
    row(n, st.prices[n], sl.prices[n], (p) => priceShape(p, nt), (p) => priceShape(p, nl));
    const r = rows[rows.length - 1];
    for (const [mode, set] of [['test', st], ['live', sl]]) {
      const p = set.prices[n][0];
      if (p && p.unit_amount !== want) { r.status = 'DIFFERS'; r.differ.push(`${mode} amount ${p.unit_amount} ≠ the table's ${want}`); }
    }
  }
  row('founding portal (Stripe)', st.portal, sl.portal, (c) => portalShape(c, nt, nt), (c) => portalShape(c, nl, nl));
  for (const tier of TIERS) for (const interval of INTERVALS) {
    const n = internal(tier, interval, 'ngn');
    row(n, pt.plans[n], pl.plans[n], planShape, planShape);
    const r = rows[rows.length - 1];
    for (const [mode, set] of [['test', pt], ['live', pl]]) {
      const p = set.plans[n][0];
      if (p && p.amount !== NGN_AMOUNTS[tier][interval]) { r.status = 'DIFFERS'; r.differ.push(`${mode} amount ${p.amount} ≠ the table's ${NGN_AMOUNTS[tier][interval]}`); }
    }
  }
  return { rows, ids: { stripe: sl, paystack: pl } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rows } = await parity();
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else {
    console.log(`Founding membership set — test against live · Stripe ${STRIPE_VERSION}\n`);
    console.log(`${'object'.padEnd(28)} ${'fields'.padStart(6)}  result`);
    for (const r of rows) {
      console.log(`${r.name.padEnd(28)} ${String(r.fields || '—').padStart(6)}  ${r.status}`);
      for (const d of r.differ) console.log(`${' '.repeat(37)}${d}`);
    }
  }
  const bad = rows.filter((r) => r.status !== 'match').length;
  console.log(`\n${rows.length - bad} of ${rows.length} match`);
  process.exit(bad ? 1 : 0);
}
