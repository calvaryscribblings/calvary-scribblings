// Create the FOUNDING Paystack Plans (naira).
//
//   PAYSTACK_SECRET_KEY=sk_test_… node scripts/create-founding-plans.mjs           (dry run)
//   PAYSTACK_SECRET_KEY=sk_test_… node scripts/create-founding-plans.mjs --apply
//
// Creates 4 Plans — 2 tiers × 2 intervals, NGN only — and prints the PLAN_BOOK block ready to
// paste into functions/api/membership/paystack-plans.js.
//
// ── THE FOUNDING LOCK IS ALMOST FREE ON THIS RAIL, AND THE CAVEAT IS DELETION ────────────
//
// A Paystack Plan's amount cannot be changed once it has subscribers, and a subscription is
// bound to its plan — so grandfathering happens by itself. There is no equivalent of Stripe's
// "the portal quietly moved them to a newer price", because Paystack has no portal that can
// move anybody, and an upgrade here is a NEW subscription on a plan code WE choose.
//
// The one way to break it is to DELETE a founding plan. A deleted plan code cannot be
// recreated, describePlan() would stop recognising existing subscribers, and every renewal for
// every founding naira member would land in manual review at once. Never delete one. If a
// founding amount is wrong, that is a new generation and a new block in paystack-plans.js.
//
// ── IDEMPOTENT BY NAME ──────────────────────────────────────────────────────────────────
//
// Paystack has no lookup_key, so plans are matched on their exact name. The script lists
// existing plans and reuses a match rather than creating a parallel set — a duplicate plan is
// indistinguishable in the dashboard and would break the reverse lookup. A plan that exists
// with the WRONG amount is refused rather than used, because the amount is what the marketing
// page will quote.

import { AMOUNTS, TIERS, INTERVALS, PAYSTACK_INTERVAL, modeOf } from '../functions/api/membership/paystack-plans.js';

const KEY = process.env.PAYSTACK_SECRET_KEY;
const APPLY = process.argv.includes('--apply');

if (!KEY) {
  console.error('\n  PAYSTACK_SECRET_KEY is not set.\n');
  console.error('  Test mode:  PAYSTACK_SECRET_KEY=sk_test_… node scripts/create-founding-plans.mjs --apply\n');
  process.exit(1);
}
const MODE = modeOf(KEY);
if (MODE === 'live' && !process.argv.includes('--i-mean-live')) {
  console.error('\n  That is a LIVE key. Founding plans created live are permanent — they can never');
  console.error('  be deleted without breaking every founding member\'s renewals. Re-run with');
  console.error('  --i-mean-live if that is genuinely what you want.\n');
  process.exit(1);
}

const api = async (path, params, method = 'GET') => {
  const res = await fetch(`https://api.paystack.co/${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(params ? { 'Content-Type': 'application/json' } : {}) },
    ...(params ? { body: JSON.stringify(params) } : {}),
  });
  const json = await res.json();
  if (!res.ok || json?.status !== true) throw new Error(`${path}: ${json?.message || res.status}`);
  return json;
};

const planName = (tier, interval) =>
  `Calvary ${tier[0].toUpperCase()}${tier.slice(1)} — ${interval === 'monthly' ? 'Monthly' : 'Annual'} (Founding)`;

const plan = [];
for (const tier of TIERS) {
  for (const interval of INTERVALS) {
    plan.push({ tier, interval, amount: AMOUNTS[tier][interval], name: planName(tier, interval) });
  }
}

console.log(`\nPaystack mode: ${MODE}   ${APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to create)'}\n`);
console.log('Founding plans to ensure:');
for (const p of plan) {
  console.log(`  ${p.name.padEnd(46)} ₦${(p.amount / 100).toLocaleString('en-NG').padStart(9)}  /${p.interval === 'monthly' ? 'mo' : 'yr'}`);
}
console.log(`\n  ${plan.length} plans, NGN only (Stripe carries GBP and USD)`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing created. Re-run with --apply.\n');
  process.exit(0);
}

const existing = (await api('plan?perPage=200')).data || [];
const created = {};
for (const p of plan) {
  let found = existing.find((e) => e.name === p.name);
  if (found) {
    if (found.amount !== p.amount || String(found.currency).toUpperCase() !== 'NGN') {
      console.error(
        `\n  ✗ "${p.name}" exists as ${found.plan_code} at ${found.currency} ${found.amount}, ` +
        `expected NGN ${p.amount}. REFUSING — a plan's amount cannot be changed once it has\n` +
        '    subscribers, so this needs a new generation, not an edit.\n',
      );
      process.exit(1);
    }
    console.log(`  ${p.name.padEnd(46)} exists  ${found.plan_code}`);
  } else {
    const res = await api('plan', {
      name: p.name,
      amount: p.amount,
      interval: PAYSTACK_INTERVAL[p.interval],
      currency: 'NGN',
      description: `Calvary Scribblings founding membership — ${p.tier}, ${p.interval}.`,
    }, 'POST');
    found = res.data;
    console.log(`  ${p.name.padEnd(46)} CREATED ${found.plan_code}`);
  }
  (created[p.tier] ||= {});
  created[p.tier][p.interval] = found.plan_code;
}

console.log(`\n${'─'.repeat(78)}`);
console.log('Paste into functions/api/membership/paystack-plans.js:\n');
console.log(`    ${MODE}: {`);
for (const tier of TIERS) {
  console.log(`      ${tier}:${' '.repeat(Math.max(1, 9 - tier.length))}{ ${INTERVALS.map((iv) => `${iv}: '${created[tier][iv]}'`).join(', ')} },`);
}
console.log('    },');
console.log(`${'─'.repeat(78)}\n`);
console.log('NEVER DELETE THESE PLANS. A deleted plan code cannot be recreated and every');
console.log('founding member\'s renewals would land in manual review at once.\n');
