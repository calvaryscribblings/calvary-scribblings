// THE /links MEMBERSHIP ENTRY — both flag states, driven against out/.
//
// MEMBERSHIP_LAUNCHED (app/links/page.js) is a BUILD-TIME constant, exactly like
// BOOKSTORE_LAUNCHED above it, so the two states cannot be exercised in one run: each needs its
// own export. This spec therefore asserts whichever state the current build carries, reading
// the expectation from MEMBERSHIP_STATE in the environment, and the round runs it twice.
//
//   MEMBERSHIP_STATE=pre   npx playwright test -c tests/membership/playwright.links.config.mjs
//   MEMBERSHIP_STATE=post  npx playwright test -c tests/membership/playwright.links.config.mjs
//
// Writing it as one parameterised spec rather than two hardcoded ones matters: the two entries
// differ by a single sentence, and a copy-pasted second spec is how one of them silently stops
// being checked.

import { test, expect } from '@playwright/test';

const STATE = process.env.MEMBERSHIP_STATE || 'pre';

// The deck's two entries (§10), verbatim. The em dash and the arrow are part of the string.
const ENTRY = {
  pre: 'Membership — opens 30 September. Read the tiers →',
  post: 'Membership — open the archive →',
};

test(`the membership entry renders its ${STATE}-launch wording`, async ({ page }) => {
  await page.goto('/links');

  const rows = page.locator('.cs-lk-stack .cs-lk-btn');
  const membership = rows.filter({ hasText: 'Membership' });

  await expect(membership).toHaveCount(1);
  // Normalised: the JSX splits the label across a <strong> and text nodes, so the assertion is
  // on the row's visible text with whitespace collapsed, not on its markup.
  await expect(membership).toHaveText(new RegExp(ENTRY[STATE].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // The other state's wording must be absent — the flag picks one, never both.
  const other = STATE === 'pre' ? ENTRY.post : ENTRY.pre;
  await expect(page.locator('body')).not.toContainText(other);

  // It is a real link to /membership, not a 'coming soon' span. The page is readable today in
  // both states; only the wording changes on launch day.
  await expect(membership).toHaveAttribute('href', '/membership');
  await expect(membership.locator('.cs-lk-soon')).toHaveCount(0);
});

test('it sits below the Book Store and above the socials', async ({ page }) => {
  await page.goto('/links');

  // allTextContents(), NOT allInnerTexts(). The stack runs a CSS entrance cascade — each row
  // carries a --lk-at delay and starts at opacity 0 — and innerText is visibility-dependent
  // with no auto-retry, so a one-shot read lands mid-animation and returns empty strings for
  // every row. textContent reads the DOM regardless of what the animation is doing, which is
  // the right question here: this test is about ORDER, not about paint.
  await expect(page.locator('.cs-lk-stack .cs-lk-btn').first()).toBeVisible();
  const labels = await page.locator('.cs-lk-stack .cs-lk-btn').allTextContents();
  const idx = (needle) => labels.findIndex((l) => l.includes(needle));

  expect(idx('Book Store')).toBeGreaterThanOrEqual(0);
  expect(idx('Membership')).toBe(idx('Book Store') + 1);
  // Calvary Films closes the stack: it is a different brand on a different domain, so the three
  // own-site rows read as a group.
  expect(idx('Calvary Films')).toBe(idx('Membership') + 1);

  // Above the socials, which live in their own list further down the page.
  const stack = page.locator('.cs-lk-stack');
  const socials = page.locator('.cs-lk-socials');
  const order = await stack.evaluate((el, s) => el.compareDocumentPosition(s), await socials.elementHandle());
  expect(order & 4).toBeTruthy();   // DOCUMENT_POSITION_FOLLOWING
});

test('the Book Store entry is untouched by this round', async ({ page }) => {
  await page.goto('/links');
  // BOOKSTORE_LAUNCHED is false and this round must not have moved it.
  await expect(page.locator('.cs-lk-stack .cs-lk-btn').filter({ hasText: 'Book Store' }))
    .toHaveText(/Book Store · opens 30 Sept/);
});
