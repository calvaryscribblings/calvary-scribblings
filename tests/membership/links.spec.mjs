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

// ── R11.17 — THE READERS' GROUP ──────────────────────────────────────────────────────────
//
// It rides this spec rather than getting its own: same page, same server, same build, and the
// assertions that matter are about where it sits RELATIVE to the two things already specified
// here — the flagged stack above it and the socials row it belongs to.
const INVITE = 'https://chat.whatsapp.com/FDsSSZtMT9L11nqr1DvFmr';

test('the WhatsApp mark closes the socials row and points at the bare invite', async ({ page }) => {
  await page.goto('/links');

  const marks = page.locator('.cs-lk-socials a.cs-lk-social, .cs-lk-socials span.cs-lk-social');
  await expect(marks).toHaveCount(5);

  const whatsapp = page.locator(`.cs-lk-socials a[href="${INVITE}"]`);
  await expect(whatsapp).toHaveCount(1);
  // LAST in the row. The four profiles are the accounts we broadcast from; the group is a
  // different kind of thing and closes the row rather than interleaving with them.
  await expect(marks.nth(4)).toHaveAttribute('href', INVITE);

  // Not the formula name. 'Story Island on WhatsApp' would announce a channel we broadcast on
  // rather than a room a reader joins — see the override in the SOCIALS table.
  await expect(whatsapp).toHaveAttribute('aria-label', /readers’ group on WhatsApp/);
  await expect(whatsapp).toHaveAttribute('rel', /noopener/);

  // NO TRACKING TAIL, anywhere on the page. `?s=cl&p=a&ilr=4` is WhatsApp's share-sheet
  // telemetry, not part of the invite, and it travels to Meta on every tap. This is the
  // assertion that stops it being pasted back the next time the link is refreshed.
  const html = await page.content();
  expect(html).not.toContain('chat.whatsapp.com/FDsSSZtMT9L11nqr1DvFmr?');
  expect(html).not.toContain('ilr=4');
});

test('the group line sits with the socials, below the flagged stack', async ({ page }) => {
  await page.goto('/links');

  const line = page.locator('.cs-lk-group');
  await expect(line).toHaveCount(1);
  await expect(line).toHaveText('the readers’ group on WhatsApp →');
  await expect(line).toHaveAttribute('href', INVITE);

  // BELOW the socials row — it is their caption, not a sixth mark.
  const socials = page.locator('.cs-lk-socials');
  const afterSocials = await socials.evaluate((el, l) => el.compareDocumentPosition(l), await line.elementHandle());
  expect(afterSocials & 4).toBeTruthy();          // DOCUMENT_POSITION_FOLLOWING

  // And BELOW the whole flagged stack — Book Store, Membership, Calvary Films. A community
  // channel is not a product door and must never drift up into that group.
  const stack = page.locator('.cs-lk-stack');
  const afterStack = await stack.evaluate((el, l) => el.compareDocumentPosition(l), await line.elementHandle());
  expect(afterStack & 4).toBeTruthy();

  // It is NOT in the stack, stated separately: document order alone would still be satisfied by
  // a fifth button appended to the stack.
  await expect(page.locator('.cs-lk-stack .cs-lk-group')).toHaveCount(0);
  await expect(page.locator(`.cs-lk-stack a[href="${INVITE}"]`)).toHaveCount(0);
});

test('the group takes no flag — it is live today, unlike the Book Store and Membership', async ({ page }) => {
  await page.goto('/links');
  // The two flagged rows still carry their dates; the group carries none and is a live anchor.
  await expect(page.locator('.cs-lk-stack .cs-lk-btn').filter({ hasText: 'Book Store' }))
    .toHaveText(/opens 30 Sept/);
  await expect(page.locator('.cs-lk-group')).not.toHaveText(/soon|opens/i);
  await expect(page.locator('.cs-lk-socials .is-soon a[href*="whatsapp"]')).toHaveCount(0);
});

test('the Book Store entry is untouched by this round', async ({ page }) => {
  await page.goto('/links');
  // BOOKSTORE_LAUNCHED is false and this round must not have moved it.
  await expect(page.locator('.cs-lk-stack .cs-lk-btn').filter({ hasText: 'Book Store' }))
    .toHaveText(/Book Store · opens 30 Sept/);
});
