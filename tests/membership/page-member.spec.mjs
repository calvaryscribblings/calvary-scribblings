// W27 — /membership and /settings for a MEMBER, from a mocked membership: the reader and their
// membership record live only in the Firebase EMULATOR (auth + database), seeded here by the
// admin SDK, and the page signs in with an emulator custom token. No real account, never a
// founder's, nothing near production.
//
//   npm run test:membership-member        (emulators + an emulator-only `next dev`)
//
// Measured at 1440: YOUR PLAN centred on its column (within 0.5px), the nine rows level in the
// member state, the paid actions equal; YOU'RE IN's words (108); and /settings carrying no
// Founding badge for a reader whose record says founding:true.
import { test, expect } from '@playwright/test';
import { adminApp, adminToken, closeApp } from '../series/harness.mjs';
import { getDatabase } from 'firebase-admin/database';
import { MEMBERSHIPS_ON_SALE } from '../../app/lib/membershipPrices.js';

const READER = 'w27MembershipReader00000001';
let app, db;

test.beforeAll(async () => { app = adminApp('w27-member'); db = getDatabase(app); });
test.afterAll(async () => { await closeApp(app); });

async function asMember(page, tier, path) {
  const now = Date.now();
  await db.ref().update({
    [`users/${READER}`]: { displayName: 'W27 Reader', username: 'wtwentysevenreader' },
    'usernames/wtwentysevenreader': READER,
    [`memberships/${READER}`]: tier ? {
      tier, status: 'active', founding: true, foundingSince: now - 86400000,
      currentPeriodEnd: now + 30 * 86400000, rail: 'stripe', interval: 'monthly', currency: 'gbp',
    } : null,
  });
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* private */ } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(path);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), await adminToken(app, READER));
}

const rowTops = (page) => page.locator('.mb-grid > .mb-card').evaluateAll((cards) => cards.map((c) =>
  [...c.children].filter((el) => getComputedStyle(el).position !== 'absolute').map((el) => el.getBoundingClientRect().top)));

for (const tier of ['gold', 'platinum']) {
  test(`a ${tier} member at 1440: YOUR PLAN centred on its column, rows level, actions equal`, async ({ page }) => {
    await asMember(page, tier, '/membership');
    const yours = page.locator('.mb-grid .mb-yours');
    await expect(yours).toHaveCount(1, { timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    const m = await yours.evaluate((y) => {
      const card = y.closest('.mb-card').getBoundingClientRect();
      const b = y.getBoundingClientRect();
      const frame = y.closest('.mb-grid').getBoundingClientRect();
      return { dx: (b.left + b.width / 2) - (card.left + card.width / 2), dy: (b.top + b.height / 2) - frame.top, name: y.closest('.mb-card').querySelector('.mb-card-n').textContent };
    });
    console.log(`\n=== ${tier} (${MEMBERSHIPS_ON_SALE ? 'open' : 'shut'}): YOUR PLAN on ${m.name}, off-centre by ${m.dx.toFixed(3)}px; its middle ${m.dy.toFixed(3)}px from the frame's top edge ===\n`);
    expect(m.name).toBe(tier.toUpperCase());
    expect(Math.abs(m.dx)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(m.dy - 0.5)).toBeLessThanOrEqual(0.75);      // centred ON the 1px top edge

    const cols = await rowTops(page);
    const worst = Math.max(...cols[0].map((_, r) => Math.max(...cols.map((c) => c[r])) - Math.min(...cols.map((c) => c[r]))));
    console.log(`=== ${tier}: worst row misalignment ${worst.toFixed(3)}px ===`);
    expect(worst).toBeLessThanOrEqual(0.5);

    if (MEMBERSHIPS_ON_SALE) {
      // The reader's own column says MANAGE; the other says SWITCH TO, with its note beneath.
      await expect(page.locator('.mb-grid a.mb-btn', { hasText: 'MANAGE' })).toHaveCount(1);
      await expect(page.locator('.mb-grid button.mb-btn', { hasText: /^SWITCH TO / })).toHaveCount(1);
      await expect(page.locator('.mb-switch-note')).toHaveCount(1);
      const w = await page.locator('.mb-grid .mb-btn').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      expect(Math.abs(w[0] - w[1])).toBeLessThanOrEqual(0.5);
    } else {
      await expect(page.locator('.mb-grid .mb-flat')).toHaveCount(2);
    }
    expect(await page.locator('body').innerText()).not.toMatch(/founding/i);
  });
}

test('a free reader, signed in: YOUR PLAN on Free, centred', async ({ page }) => {
  await asMember(page, null, '/membership');
  const yours = page.locator('.mb-grid .mb-yours');
  await expect(yours).toHaveCount(1, { timeout: 30000 });
  const dx = await yours.evaluate((y) => { const c = y.closest('.mb-card').getBoundingClientRect(); const b = y.getBoundingClientRect(); return (b.left + b.width / 2) - (c.left + c.width / 2); });
  expect(Math.abs(dx)).toBeLessThanOrEqual(0.5);
  await expect.poll(() => yours.evaluate((y) => y.closest('.mb-card').querySelector('.mb-card-n').textContent)).toBe('FREE');
});

test('YOU’RE IN reads as ruled (108), with no founding clause, even for a founding member', async ({ page }) => {
  await asMember(page, 'gold', '/membership?join=success');
  const banner = page.locator('.mb-banner');
  await expect(banner).toContainText('YOU’RE IN', { timeout: 30000 });
  await expect(banner.locator('.mb-banner-p')).toHaveText('Your Gold membership is active. Thank you for keeping this place going.');
  expect(await page.locator('body').innerText()).not.toMatch(/founding/i);
});

test('/settings shows the member\'s tier and no Founding badge (108)', async ({ page }) => {
  await asMember(page, 'gold', '/settings');
  await expect(page.locator('.ms-tier').first()).toContainText('Gold', { timeout: 60000 });
  await expect(page.locator('.ms-badge')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/founding/i);
});
