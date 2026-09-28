// W26 — ruling 107: the six "Support Calvary Scribblings" links come down when memberships open.
// They are Stripe Payment Links, not web placements (the TipBox left every page on 29 Apr 2026,
// d4e58598), so the web half of the ruling is: nothing on the site links to them, in either state.
//
//   node --test tests/ci/w26-donation-links.test.mjs          (npm run test:ci)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { donationLinks, DONATION_NAME } from '../../scripts/money/donation-links.mjs';

const link = (description, active = true) => ({ active, lineItems: [{ description, price: { unit_amount: 500, currency: 'gbp' } }] });

test('only the donation links are chosen — never another Payment Link', () => {
  const all = [link(DONATION_NAME), link(DONATION_NAME, false), link('A retired paywalled story', false),
    { active: true, lineItems: [{ description: DONATION_NAME }, { description: 'x' }] }];
  assert.equal(donationLinks(all).length, 2);
  assert.ok(donationLinks(all).every((l) => l.lineItems[0].description === DONATION_NAME));
});

test('no page, component or function links to a Stripe Payment Link, open or shut', () => {
  // The whole tracked site: app/, functions/, public/ (the dictionary excepted — it is data).
  const out = execSync("git grep -n -I -e 'buy.stripe.com' -- app functions public ':!public/dict' || true", { encoding: 'utf8' });
  assert.equal(out.trim(), '', `a Payment Link is placed on the site:\n${out}`);
  const tip = execSync("git grep -n -I -e 'TipBox' -- app || true", { encoding: 'utf8' });
  assert.equal(tip.trim(), '', 'the TipBox is back');
});
