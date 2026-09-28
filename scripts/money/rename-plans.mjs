#!/usr/bin/env node
// W27 — ruling 111: Paystack's four membership plans lose "(Founding)" from their names and
// "founding" from their descriptions, in test and in live. Billing is untouched.
//
//   node scripts/money/rename-plans.mjs                               dry run, both modes
//   node scripts/money/rename-plans.mjs --apply test                  rename the test plans
//   node scripts/money/rename-plans.mjs --apply live --i-mean-live    rename the live plans
//
// PUT /plan/{code} with NAME AND DESCRIPTION ONLY. Paystack's Update Plan takes every field as
// optional (PaystackOSS/openapi, PlanUpdate), so nothing else is sent: not the amount, the
// interval, the currency or the invoice settings. Plans are found by listing, and one is only
// touched when its amount, interval and currency are the settled table's — never by name alone.
// After a run every plan is read again: its code, amount and interval must be what they were.
//
// Keys: PAYSTACK_TEST_SECRET_KEY / PAYSTACK_LIVE_SECRET_KEY, never printed.

import { AMOUNTS, TIERS, INTERVALS, PAYSTACK_INTERVAL } from '../../functions/api/membership/paystack-plans.js';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const ivWord = (iv) => (iv === 'monthly' ? 'Monthly' : 'Annual');
export const oldName = (t, iv) => `Calvary ${cap(t)} — ${ivWord(iv)} (Founding)`;
export const newName = (t, iv) => `Calvary ${cap(t)} — ${ivWord(iv)}`;
export const newDescription = (t, iv) => `Calvary Scribblings membership — ${t}, ${iv}.`;

/** The plan for tier/interval among a listing: by old or new name, and only with the settled terms. */
export function planFor(plans, t, iv) {
  const named = plans.filter((p) => !p.is_deleted && (p.name === oldName(t, iv) || p.name === newName(t, iv)));
  const right = named.filter((p) => p.amount === AMOUNTS[t][iv] && p.interval === PAYSTACK_INTERVAL[iv]
    && String(p.currency).toUpperCase() === 'NGN');
  if (named.length !== 1 || right.length !== 1) return { error: `${named.length} named, ${right.length} with the settled terms` };
  return { plan: right[0] };
}

const naira = (k) => `₦${(k / 100).toLocaleString('en-NG')}`;

async function run(mode, apply) {
  const key = mode === 'live' ? process.env.PAYSTACK_LIVE_SECRET_KEY : process.env.PAYSTACK_TEST_SECRET_KEY;
  if (!key || /^(sk|rk)_live_/.test(key) !== (mode === 'live')) throw new Error(`the ${mode} key is missing or is not a ${mode} key`);
  const api = async (path, method = 'GET', body) => {
    const r = await fetch(`https://api.paystack.co/${path}`, {
      method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok || j.status !== true) throw new Error(`${method} ${path.split('?')[0]} → ${r.status} ${j?.message || ''}`);
    return j;
  };
  const before = (await api('plan?perPage=200')).data || [];
  console.log(`\n── ${mode.toUpperCase()} ${apply ? '(applying)' : '(dry run)'}`);
  const found = {};
  for (const t of TIERS) for (const iv of INTERVALS) {
    const r = planFor(before, t, iv);
    if (r.error) throw new Error(`${t}-${iv}-ngn: ${r.error} — nothing changed`);
    found[`${t}-${iv}`] = r.plan;
    const p = r.plan;
    const todo = p.name !== newName(t, iv) || p.description !== newDescription(t, iv);
    console.log(`  ${`${t}-${iv}-ngn`.padEnd(20)} "${p.name}" → "${newName(t, iv)}"   ${todo ? '' : '(already)'}`);
    if (apply && todo) await api(`plan/${p.plan_code}`, 'PUT', { name: newName(t, iv), description: newDescription(t, iv) });
  }
  if (!apply) return;
  const after = (await api('plan?perPage=200')).data || [];
  console.log(`  after:`);
  let bad = 0;
  for (const t of TIERS) for (const iv of INTERVALS) {
    const was = found[`${t}-${iv}`];
    const now = after.find((p) => p.plan_code === was.plan_code);
    const ok = now && now.name === newName(t, iv) && now.description === newDescription(t, iv)
      && now.amount === was.amount && now.interval === was.interval && now.currency === was.currency;
    if (!ok) bad++;
    console.log(`    ${now?.name?.padEnd(28)} ${was.plan_code}  ${naira(now?.amount)}  ${now?.interval}  code+amount+interval unchanged: ${ok}`);
  }
  if (bad) throw new Error(`${bad} plan(s) did not come out as expected`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--apply');
  const which = i >= 0 ? process.argv[i + 1] : null;
  if (which === 'live' && !process.argv.includes('--i-mean-live')) { console.error('--apply live needs --i-mean-live'); process.exit(2); }
  if (which && !['test', 'live'].includes(which)) { console.error('--apply test | --apply live --i-mean-live'); process.exit(2); }
  for (const mode of ['test', 'live']) await run(mode, which === mode);
}
