// THE MEMBERSHIP COPY MATRIX — what a reader actually sees, in a browser, from out/.
//
// R11.13 rewrote every string on /membership from audit/membership-copy-deck.md. This suite is
// the verification the round was asked for, and it is deliberately a BROWSER suite rather than
// a set of string assertions against the source: the three cards are rendered from a currency
// selector and an interval selector, and the combination that breaks is never the one you
// checked by reading the JSX.
//
// THE MATRIX: 3 currencies × 2 intervals × 3 cards = 18 card states, all asserted.
//
// ── THE TWO ASSERTIONS THAT ARE NOT ABOUT COPY ───────────────────────────────────────────
//
//   1. THE FREE CARD MUST READ THE WORD 'Free', NEVER A ZERO. This was a real bug once: in
//      naira formatPrice returned '₦0', which in Cormorant Garamond reads as the word 'No' —
//      the ₦ sits as a struck N and the 0 as an o. The single card most readers stay on was
//      headed with a refusal. It is asserted in all three currencies because the failure was
//      currency-specific and invisible in two of them.
//
//   2. NO BUY AFFORDANCE ANYWHERE. MEMBERSHIPS_ON_SALE is false and this round must not have
//      touched it. A copy round that accidentally ships a checkout button is the worst
//      possible outcome of a copy round, so it is checked rather than assumed.

import { test, expect } from '@playwright/test';

// The selector's own labels, from CURRENCY_LABELS in app/lib/currency.js — '£ GBP', not 'GBP'.
// The symbol is part of the button text, and a test that matched on the code alone found
// nothing and spent its timeout clicking at a locator that never resolved.
const CURRENCIES = [
  { code: 'GBP', button: '£ GBP' },
  { code: 'USD', button: '$ USD' },
  { code: 'NGN', button: '₦ NGN' },
];
const INTERVALS = ['MONTHLY', 'YEARLY'];

// The deck's prices (§3), written here as literals ON PURPOSE. This suite must fail if the
// price table changes without the deck changing — importing membershipPrices.js would make the
// assertion tautological and it would agree with any number the code happened to hold.
const EXPECTED = {
  GBP: { MONTHLY: { gold: '£2.99', platinum: '£4.99' }, YEARLY: { gold: '£29.99', platinum: '£49.99' } },
  USD: { MONTHLY: { gold: '$3.99', platinum: '$6.49' }, YEARLY: { gold: '$39.99', platinum: '$64.99' } },
  NGN: { MONTHLY: { gold: '₦1,500', platinum: '₦2,500' }, YEARLY: { gold: '₦15,000', platinum: '₦25,000' } },
};

async function choose(page, currencyButton, interval) {
  await page.getByRole('group', { name: 'Currency' }).getByRole('button', { name: currencyButton, exact: true }).click();
  await page.getByRole('group', { name: 'Billing period' }).getByRole('button', { name: interval, exact: true }).click();
}

const cardByName = (page, name) =>
  page.locator('.mb-card').filter({ has: page.locator('.mb-card-n', { hasText: new RegExp(`^${name}$`) }) });

test.beforeEach(async ({ page }) => {
  await page.goto('/membership');
  await expect(page.locator('.mb-h1')).toBeVisible();
});

test('the argument renders before any price', async ({ page }) => {
  // 'What stays free' is the page's argument and its placement is load-bearing: a reader has to
  // believe the week is free before a number means anything. Asserted as DOM ORDER, not as
  // presence — a section that exists but sits under the cards has lost the argument.
  const free = page.locator('.mb-free');
  const grid = page.locator('.mb-grid');
  await expect(free).toBeVisible();
  const order = await free.evaluate((el, g) => el.compareDocumentPosition(g), await grid.elementHandle());
  // Node.DOCUMENT_POSITION_FOLLOWING === 4
  expect(order & 4).toBeTruthy();

  await expect(free).toContainText('Seven days from publication, every story is free to read, in full, to anyone who finds it.');
  await expect(free).toContainText('The five most recent stories are always free, however quiet a week has been.');
  await expect(free).toContainText('All poetry is free. Always, and to everyone.');
  await expect(free).toContainText('The Square is free — every conversation and every competition in it.');
  await expect(free).toContainText('Every quiz on every free story is free to take.');
  await expect(free).toContainText('None of that is a trial, and none of it expires.');
});

test('hero carries the deck headline, sub-headline and standfirst', async ({ page }) => {
  await expect(page.locator('.mb-h1')).toHaveText('Every story is free the week it is published.');
  await expect(page.locator('.mb-subhead')).toHaveText('Membership opens everything before that.');
  // 'several times a week' — never a number. See the footer test for why.
  await expect(page.locator('.mb-lede')).toContainText('The island publishes new stories several times a week');
  await expect(page.locator('.mb-lede')).toContainText('more than a hundred and sixty stories are waiting');
});

test('what you keep, and the footer that carries no number', async ({ page }) => {
  await expect(page.locator('.mb-keep')).toContainText('Anything you have saved is yours.');
  await expect(page.locator('.mb-keep-line')).toHaveText('We do not take saved stories back.');
  await expect(page.locator('.mb-foot')).toContainText('New stories every week, free to everyone. That does not change.');
  // The retired footer, and the retired cadence claim. Both must be gone.
  await expect(page.locator('body')).not.toContainText('Stories stay free for everyone, members or not.');
  await expect(page.locator('body')).not.toContainText('Three new stories a week');
});

test('short answers ship as three pairs, and the writers-pay question is absent', async ({ page }) => {
  const qa = page.locator('.mb-qa-list');
  await expect(qa.locator('dt')).toHaveCount(3);
  await expect(qa.locator('dd')).toHaveCount(3);
  await expect(qa.locator('dt').nth(0)).toHaveText('Can I cancel?');
  await expect(qa.locator('dt').nth(1)).toHaveText('What happens to the archive if I stop?');
  await expect(qa.locator('dt').nth(2)).toHaveText('Why is poetry free?');
  // Held back until the line exists. A placeholder answer to THIS question would be worse than
  // not asking it.
  await expect(page.locator('body')).not.toContainText('Does this change what writers are paid?');
});

test('both boxes lost their headings and kept their sentences', async ({ page }) => {
  await expect(page.locator('.mb-notice-p')).toContainText('Memberships open on 30 September.');
  await expect(page.locator('.mb-notice-p')).toContainText('Everything on this page is the real price');
  await expect(page.locator('.mb-founding-p')).toContainText('Join before we open and your price never goes up');
  await expect(page.locator('body')).not.toContainText('NOT YET ON SALE');
  await expect(page.locator('body')).not.toContainText('FOUNDING MEMBERS');
  await expect(page.locator('body')).not.toContainText('NOT READY TO SUBSCRIBE?');
});

test('the dated perks carry a month, and no badge anywhere says coming soon', async ({ page }) => {
  const gold = cardByName(page, 'GOLD');
  const plat = cardByName(page, 'PLATINUM');

  await expect(gold).toContainText('Island Games in full, from November');
  await expect(gold).toContainText('A Gold mark on your profile, from October');
  await expect(plat).toContainText('The Calvary Scribblings Series, from October');
  await expect(plat).toContainText('A Platinum mark on your profile, from October');
  await expect(plat).toContainText('First word on what we publish next, from November');

  // Each month is an italic clause, never a badge.
  //
  // FIVE, and the number is worth pinning down because two different counts are both correct
  // and it is easy to assert the wrong one. There are FIVE dated LINES on the page — Island
  // Games, the Gold mark, the Series, the Platinum mark, first word — but deck §9 enumerates
  // FOUR dated PROMISES, because 'the profile marks' is one promise blocked by one decision
  // and it appears on two cards. Lines are what a reader counts; promises are what §9 tracks.
  await expect(page.locator('.mb-when')).toHaveCount(5);
  await expect(page.locator('.mb-perk .mb-when')).toHaveCount(5);
  await expect(page.locator('body')).not.toContainText('COMING SOON');

  // The Series title is italicised per house style.
  await expect(plat.locator('em', { hasText: 'Calvary Scribblings Series' })).toHaveCount(1);

  // RULING 3: both Book Reader Collection lines are cut. They were undated, so they read as
  // claims about today, and the mechanic does not exist.
  await expect(page.locator('body')).not.toContainText('Book Reader Collection');
  await expect(page.locator('body')).not.toContainText('halfway mark');
});

test('the bridge lines replaced the containment bullets', async ({ page }) => {
  await expect(cardByName(page, 'GOLD').locator('.mb-bridge')).toHaveText('Everything on the free island, and —');
  await expect(cardByName(page, 'PLATINUM').locator('.mb-bridge')).toHaveText('Everything in Gold, and —');
  await expect(page.locator('body')).not.toContainText('Everything in Free');
  // 'Everything in Gold' survives ONLY as the Platinum bridge line, never as a bullet.
  await expect(page.locator('.mb-perk', { hasText: 'Everything in Gold' })).toHaveCount(0);
});

test('the free card has no CTA and no zero', async ({ page }) => {
  const free = cardByName(page, 'FREE');
  await expect(free).toContainText('Read the island as it is published.');
  await expect(free.locator('.mb-cta')).toHaveCount(0);
  await expect(free.locator('button')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('You already have this.');
  // The computed shelf line, spelled per house style, from capFor('story','free') === 2.
  await expect(free).toContainText('Two stories saved for offline reading');
});

// ── THE MATRIX ───────────────────────────────────────────────────────────────────────────
for (const { code: currency, button } of CURRENCIES) {
  for (const interval of INTERVALS) {
    test(`matrix · ${currency} · ${interval}`, async ({ page }) => {
      await choose(page, button, interval);

      // FREE — the word, never a zero, in every currency.
      const free = cardByName(page, 'FREE');
      await expect(free.locator('.mb-price')).toHaveText('Free');
      await expect(free.locator('.mb-price')).not.toContainText('0');

      // GOLD and PLATINUM — the deck's prices.
      await expect(cardByName(page, 'GOLD').locator('.mb-price')).toHaveText(EXPECTED[currency][interval].gold);
      await expect(cardByName(page, 'PLATINUM').locator('.mb-price')).toHaveText(EXPECTED[currency][interval].platinum);

      // The computed shelf lines, in every state.
      await expect(cardByName(page, 'GOLD')).toContainText('Twenty stories saved for offline reading');
      await expect(cardByName(page, 'PLATINUM')).toContainText('As many stories saved as your device will hold');

      // THE WEEK PASS IS NAIRA-ONLY. Not a country check and not a feature flag — the week
      // simply has no gbp or usd price, so passesFor(currency) does not return the row.
      const weekPass = page.locator('.mb-card-n', { hasText: 'WEEK PASS' });
      await expect(weekPass).toHaveCount(currency === 'NGN' ? 1 : 0);
      await expect(page.locator('.mb-card-n', { hasText: 'DAY PASS' })).toHaveCount(1);

      // NO BUY AFFORDANCE, in any state. MEMBERSHIPS_ON_SALE is false.
      await expect(page.locator('button', { hasText: /CHOOSE|BUY THE/ })).toHaveCount(0);
      await expect(page.locator('.mb-btn')).toHaveCount(0);
      // Every card's CTA slot carries the launch notice instead.
      await expect(page.locator('.mb-flat').first()).toHaveText('Memberships open on 30 September.');
    });
  }
}

test('the passes block lost its negative heading and its duplicated sentence', async ({ page }) => {
  await choose(page, '₦ NGN', 'MONTHLY');
  const sec = page.locator('.mb-sec').filter({ hasText: 'A pass, if a subscription is not what you want' });
  await expect(sec).toContainText('Some readers want the archive for an afternoon');
  await expect(sec.locator('.mb-sec-close')).toHaveText('A pass is a one-off. It ends on its own.');
  // The pass-card perk STAYS — it belongs in the context of a thing that expires.
  await expect(sec).toContainText('What you save is yours to keep afterwards');
  // The old paragraph's clause is gone. Anchored on the unique fragment so it cannot be
  // confused with §5's deliberate 'We do not take saved stories back.'
  await expect(page.locator('body')).not.toContainText('after it ends — we do not take saved stories back');
});
