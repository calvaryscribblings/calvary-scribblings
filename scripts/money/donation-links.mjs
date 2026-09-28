#!/usr/bin/env node
// W26 — THE SIX "SUPPORT CALVARY SCRIBBLINGS" DONATION LINKS (ruling 107: they come down when
// memberships open).
//
//   node scripts/money/donation-links.mjs                              report (read-only)
//   node scripts/money/donation-links.mjs --apply --i-mean-live        deactivate them (Wednesday)
//
// WHERE THEY LIVE. Not on the website. They are Stripe Payment Links on the LIVE account, and
// the web stopped showing them on 29 Apr 2026 (d4e58598, "remove tip box from all pages" — the
// TipBox component was their only placement). So a MEMBERSHIP_LAUNCHED gate in app/ would gate
// nothing. What takes them down is Stripe: a deactivated Payment Link answers "no longer
// available" to anyone holding its URL, wherever that URL is posted (the app, a bio, an email).
//
// Deactivating is REVERSIBLE (active=true again) and moves no money. Nothing is deleted.
// Key: STRIPE_LIVE_SECRET_KEY, never printed. Links are named by amount, never by URL.

import { STRIPE_VERSION } from '../../functions/api/_stripe.js';

export const DONATION_NAME = 'Support Calvary Scribblings';

/** The donation links among a list of Payment Links with their line items. Pure. */
export function donationLinks(links) {
  return links.filter((l) => (l.lineItems || []).length === 1 && l.lineItems[0].description === DONATION_NAME);
}

const money = (a, c) => `${{ gbp: '£', usd: '$' }[c] || ''}${(a / 100).toFixed(a % 100 ? 2 : 0)}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.env.STRIPE_LIVE_SECRET_KEY;
  if (!key || !/^(sk|rk)_live_/.test(key)) { console.error('STRIPE_LIVE_SECRET_KEY is not a live key'); process.exit(2); }
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--i-mean-live')) { console.error('--apply needs --i-mean-live'); process.exit(2); }
  const api = async (path, form) => {
    const r = await fetch(`https://api.stripe.com/v1${path}`, {
      method: form ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_VERSION, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form) : undefined,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`${path.split('?')[0]} → ${r.status} ${j?.error?.message || ''}`);
    return j;
  };
  const all = (await api('/payment_links?limit=100')).data;
  for (const l of all) l.lineItems = (await api(`/payment_links/${l.id}/line_items`)).data;
  const mine = donationLinks(all).sort((a, b) => a.lineItems[0].price.unit_amount - b.lineItems[0].price.unit_amount);
  const active = mine.filter((l) => l.active);
  console.log(`${DONATION_NAME}: ${mine.length} links, ${active.length} active\n`);
  for (const l of mine) {
    const p = l.lineItems[0].price;
    console.log(`  ${money(p.unit_amount, p.currency).padEnd(5)} ${l.active ? 'ACTIVE' : 'inactive'}`);
  }
  if (!apply) { console.log('\nReport only. On Wednesday, after 6b is live: --apply --i-mean-live'); process.exit(0); }
  for (const l of active) {
    const r = await api(`/payment_links/${l.id}`, { active: 'false' });
    const p = l.lineItems[0].price;
    console.log(`  ${money(p.unit_amount, p.currency).padEnd(5)} deactivated: ${r.active === false}`);
  }
  process.exit(0);
}
