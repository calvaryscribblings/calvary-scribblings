// Create the FOUNDING Stripe Products, Prices and portal configuration.
//
//   STRIPE_SECRET_KEY=sk_test_… node scripts/create-founding-prices.mjs           (dry run)
//   STRIPE_SECRET_KEY=sk_test_… node scripts/create-founding-prices.mjs --apply
//
// Dry run by default. --apply creates:
//
//   2 Products   Calvary Gold, Calvary Platinum
//   8 Prices     2 tiers × 2 intervals × 2 currencies (GBP, USD), amounts from prices.js
//   1 Portal configuration  restricted to exactly those 8 prices
//
// …then prints the PRICE_BOOK and PORTAL_CONFIGURATION blocks ready to paste into
// functions/api/membership/prices.js.
//
// ── WHY BOTH TIERS, ON DAY ONE, BEFORE ANYONE HAS BOUGHT PLATINUM ────────────────────────
//
// The founding lock is "a subscription stays on the price it started on". That holds for
// renewals by itself — Stripe never moves a subscription's price. It does NOT hold for an
// UPGRADE: a founding Gold member who moves to Platinum through the billing portal lands on
// whatever Platinum price the portal offers, and if founding Platinum does not exist, that is
// the current one. Their lock ends silently, at the moment they gave us more money, with no
// error anywhere and nothing in any log.
//
// So founding Platinum must exist before the first founding Gold is sold, and the portal must
// be configured to offer ONLY founding prices. This script does both in one pass because
// doing either alone leaves the trap open.
//
// ── IDEMPOTENT BY LOOKUP KEY ─────────────────────────────────────────────────────────────
//
// Every Price is created with a deterministic `lookup_key`
// (`founding_<tier>_<interval>_<currency>`), and the script searches for it before creating
// anything. Run it twice and the second run reports "exists" for all eight rather than
// creating a parallel set — which matters, because a duplicate Price is indistinguishable
// from the real one in the dashboard and would break the reverse lookup in prices.js.
//
// NEVER RUN THIS TO "FIX" A PRICE. Stripe Prices are immutable in amount, and a subscription
// pinned to one is pinned forever. If a founding amount is wrong, that is a new generation and
// a new block in prices.js — never an edit to this one.

import { AMOUNTS, TIERS, INTERVALS, STRIPE_CURRENCIES, modeOf } from '../functions/api/membership/prices.js';

const KEY = process.env.STRIPE_SECRET_KEY;
const APPLY = process.argv.includes('--apply');

if (!KEY) {
  console.error('\n  STRIPE_SECRET_KEY is not set.\n');
  console.error('  Test mode:  STRIPE_SECRET_KEY=sk_test_… node scripts/create-founding-prices.mjs --apply\n');
  process.exit(1);
}
const MODE = modeOf(KEY);

if (MODE === 'live' && !process.argv.includes('--i-mean-live')) {
  console.error('\n  That is a LIVE key. Founding prices created in live mode are permanent and');
  console.error('  will be charged to real cards. Re-run with --i-mean-live if that is genuinely');
  console.error('  what you want.\n');
  process.exit(1);
}

const api = async (path, params, method = 'POST') => {
  const body = params ? new URLSearchParams(params) : undefined;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body } : {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json?.error?.message || res.status}`);
  return json;
};

const INTERVAL_ARGS = { monthly: { interval: 'month', count: 1 }, annual: { interval: 'year', count: 1 } };
const PRODUCT_NAMES = { gold: 'Calvary Gold', platinum: 'Calvary Platinum' };
const lookupKey = (tier, interval, currency) => `founding_${tier}_${interval}_${currency}`;

console.log(`\nStripe mode: ${MODE}   ${APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to create)'}\n`);

// ── the plan ────────────────────────────────────────────────────────────────
const plan = [];
for (const tier of TIERS) {
  for (const interval of INTERVALS) {
    for (const currency of STRIPE_CURRENCIES) {
      plan.push({ tier, interval, currency, amount: AMOUNTS[tier][interval][currency], key: lookupKey(tier, interval, currency) });
    }
  }
}
console.log('Founding prices to ensure:');
for (const p of plan) {
  const sym = { gbp: '£', usd: '$' }[p.currency];
  console.log(`  ${p.key.padEnd(34)} ${sym}${(p.amount / 100).toFixed(2).padStart(6)}  /${p.interval === 'monthly' ? 'mo' : 'yr'}`);
}
console.log(`\n  ${plan.length} prices across ${TIERS.length} products`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing created. Re-run with --apply.\n');
  process.exit(0);
}

// ── products ────────────────────────────────────────────────────────────────
const products = {};
for (const tier of TIERS) {
  const existing = await api(`products/search?query=${encodeURIComponent(`metadata['calvary_tier']:'${tier}'`)}`, null, 'GET');
  if (existing.data?.length) {
    products[tier] = existing.data[0].id;
    console.log(`\n  product ${tier}: exists ${products[tier]}`);
  } else {
    const p = await api('products', {
      name: PRODUCT_NAMES[tier],
      'metadata[calvary_tier]': tier,
      'metadata[calvary_generation]': 'founding',
    });
    products[tier] = p.id;
    console.log(`\n  product ${tier}: CREATED ${p.id}`);
  }
}

// ── prices ──────────────────────────────────────────────────────────────────
const created = {};
for (const p of plan) {
  const found = await api(`prices/search?query=${encodeURIComponent(`lookup_key:'${p.key}'`)}`, null, 'GET');
  let price = found.data?.[0];
  if (price) {
    // Verify rather than trust. A price whose amount has drifted from the settled table is a
    // price the marketing page would misquote, and it must not be used.
    if (price.unit_amount !== p.amount || price.currency !== p.currency) {
      console.error(
        `\n  ✗ ${p.key} exists as ${price.id} but is ${price.currency} ${price.unit_amount}, ` +
        `expected ${p.currency} ${p.amount}. REFUSING — resolve by hand.\n`,
      );
      process.exit(1);
    }
    console.log(`  price ${p.key.padEnd(34)} exists  ${price.id}`);
  } else {
    price = await api('prices', {
      product: products[p.tier],
      currency: p.currency,
      unit_amount: String(p.amount),
      'recurring[interval]': INTERVAL_ARGS[p.interval].interval,
      'recurring[interval_count]': String(INTERVAL_ARGS[p.interval].count),
      lookup_key: p.key,
      'metadata[calvary_tier]': p.tier,
      'metadata[calvary_interval]': p.interval,
      'metadata[calvary_generation]': 'founding',
    });
    console.log(`  price ${p.key.padEnd(34)} CREATED ${price.id}`);
  }
  (created[p.tier] ||= {});
  (created[p.tier][p.interval] ||= {});
  created[p.tier][p.interval][p.currency] = price.id;
}

// ── portal configuration, restricted to exactly these prices ────────────────
const portalParams = {
  'business_profile[headline]': 'Calvary Scribblings — manage your membership',
  'features[customer_update][enabled]': 'true',
  'features[customer_update][allowed_updates][0]': 'email',
  'features[customer_update][allowed_updates][1]': 'address',
  'features[invoice_history][enabled]': 'true',
  'features[payment_method_update][enabled]': 'true',
  'features[subscription_cancel][enabled]': 'true',
  'features[subscription_cancel][mode]': 'at_period_end',
  'features[subscription_update][enabled]': 'true',
  'features[subscription_update][default_allowed_updates][0]': 'price',
  'features[subscription_update][proration_behavior]': 'create_prorations',
  'metadata[calvary_generation]': 'founding',
};
// THE RESTRICTION. Only these products, and within them only the founding prices — so an
// upgrade cannot land anywhere else.
TIERS.forEach((tier, i) => {
  portalParams[`features[subscription_update][products][${i}][product]`] = products[tier];
  INTERVALS.forEach((interval, j) => {
    STRIPE_CURRENCIES.forEach((currency, k) => {
      const idx = j * STRIPE_CURRENCIES.length + k;
      portalParams[`features[subscription_update][products][${i}][prices][${idx}]`] = created[tier][interval][currency];
    });
  });
});

const config = await api('billing_portal/configurations', portalParams);
console.log(`\n  portal configuration: CREATED ${config.id}`);
console.log('    restricted to the 8 founding prices — an upgrade cannot leave the generation');

// ── the block to paste ──────────────────────────────────────────────────────
const fmt = (t) => INTERVALS.map((iv) =>
  `${iv}: { ${STRIPE_CURRENCIES.map((c) => `${c}: '${created[t][iv][c]}'`).join(', ')} }`).join(', ');

console.log(`\n${'─'.repeat(78)}`);
console.log('Paste into functions/api/membership/prices.js:\n');
console.log(`    ${MODE}: {`);
for (const tier of TIERS) console.log(`      ${tier}:${' '.repeat(Math.max(1, 9 - tier.length))}{ ${fmt(tier)} },`);
console.log('    },');
console.log(`\n  PORTAL_CONFIGURATION.founding.${MODE} = '${config.id}'`);
console.log(`${'─'.repeat(78)}\n`);
