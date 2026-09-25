#!/usr/bin/env node
// THE TWO STRIPE WEBHOOK ENDPOINTS — created or checked from code, never by hand. W3 / MON-01.
//
//   STRIPE_KEY=sk_test_… node scripts/money/stripe-webhooks.mjs                 # report only
//   STRIPE_KEY=sk_test_… node scripts/money/stripe-webhooks.mjs --apply --secret-out <file>
//   STRIPE_KEY=sk_live_… node scripts/money/stripe-webhooks.mjs --apply --secret-out <file> --i-mean-live
//
// Two endpoints on the site, each with its own signing secret:
//
//   /api/bookstore/stripe-webhook    STRIPE_WEBHOOK_SECRET               books
//   /api/membership/stripe-webhook   STRIPE_MEMBERSHIP_WEBHOOK_SECRET    memberships and passes
//
// --apply makes each one exist with exactly the events its handler handles (the membership list
// is imported from the handler, so the two cannot drift) at STRIPE_VERSION. A new endpoint's
// signing secret is written to --secret-out (mode 0600) and NEVER printed; that file is what
// `wrangler pages secret put` reads. Stripe shows a secret only at creation, so an endpoint that
// already exists keeps its secret and nothing is written.
//
// An endpoint at the WRONG API version cannot be changed in place — Stripe fixes it at creation.
// The script says so and stops; delete it in the dashboard (or pass --recreate) and run again.

import { writeFileSync } from 'node:fs';
import { MEMBERSHIP_EVENTS } from '../../functions/api/membership/stripe-webhook.js';
import { STRIPE_VERSION } from '../../functions/api/_stripe.js';

const ORIGIN = process.env.SITE_ORIGIN || 'https://calvaryscribblings.co.uk';
export const ENDPOINTS = [
  {
    name: 'membership', secretVar: 'STRIPE_MEMBERSHIP_WEBHOOK_SECRET', url: `${ORIGIN}/api/membership/stripe-webhook`,
    events: MEMBERSHIP_EVENTS,
  },
  {
    name: 'bookstore', secretVar: 'STRIPE_WEBHOOK_SECRET', url: `${ORIGIN}/api/bookstore/stripe-webhook`,
    events: ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'charge.refunded', 'charge.dispute.created'],
  },
];

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

async function api(key, path, { method = 'GET', form } = {}) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_VERSION, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${body?.error?.message || ''}`);
  return body;
}

async function main() {
  const key = process.env.STRIPE_KEY;
  if (!key) { console.error('STRIPE_KEY is not set.'); process.exit(2); }
  const live = /^(sk|rk)_live_/.test(key);
  if (live && flag('--apply') && !flag('--i-mean-live')) { console.error('A LIVE key with --apply needs --i-mean-live.'); process.exit(2); }
  const acct = await api(key, '/account');
  console.log(`account ${acct.id} (${live ? 'LIVE' : 'test'}) · pinned version ${STRIPE_VERSION}`);

  const existing = (await api(key, '/webhook_endpoints?limit=100')).data;
  const secrets = {};
  let bad = 0;
  for (const ep of ENDPOINTS) {
    const found = existing.find((w) => w.url === ep.url);
    const events = [...ep.events].sort();
    if (found && found.api_version !== STRIPE_VERSION && flag('--recreate') && flag('--apply')) {
      await api(key, `/webhook_endpoints/${found.id}`, { method: 'DELETE' });
      console.log(`  ${ep.name}: deleted ${found.id} (api ${found.api_version}) to recreate at ${STRIPE_VERSION}`);
    } else if (found) {
      const missing = events.filter((e) => !found.enabled_events.includes(e) && !found.enabled_events.includes('*'));
      const versionOk = found.api_version === STRIPE_VERSION;
      console.log(`  ${ep.name}: ${found.id} ${found.status} api=${found.api_version}${versionOk ? '' : ' ✗ WRONG VERSION'} missing=[${missing.join(', ') || '—'}]`);
      if (!versionOk) bad++;
      if (missing.length && flag('--apply')) {
        const form = {};
        [...new Set([...found.enabled_events, ...events])].forEach((e, i) => { form[`enabled_events[${i}]`] = e; });
        await api(key, `/webhook_endpoints/${found.id}`, { method: 'POST', form });
        console.log(`    ✓ events added: ${missing.join(', ')}`);
      } else if (missing.length) bad++;
      continue;
    }
    if (!flag('--apply')) { console.log(`  ${ep.name}: MISSING — ${ep.url}`); bad++; continue; }
    const form = { url: ep.url, api_version: STRIPE_VERSION, description: `Calvary Scribblings — ${ep.name} (scripts/money/stripe-webhooks.mjs)` };
    events.forEach((e, i) => { form[`enabled_events[${i}]`] = e; });
    const created = await api(key, '/webhook_endpoints', { method: 'POST', form });
    secrets[ep.secretVar] = created.secret;
    console.log(`  ${ep.name}: ✓ created ${created.id} at ${created.api_version} with ${events.length} events`);
  }
  const out = opt('--secret-out');
  if (Object.keys(secrets).length) {
    if (!out) { console.error('::error:: an endpoint was created but --secret-out was not given; its secret is lost — delete it and rerun.'); process.exit(1); }
    writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 });
    console.log(`  secrets for ${Object.keys(secrets).join(', ')} written to ${out} (not printed)`);
  }
  if (bad && !flag('--apply')) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
