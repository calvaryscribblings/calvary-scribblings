// W31 — THE GATEWAY'S BOOK STORE DOOR. On launch night the door at / still opened the pre-launch
// box ("The shelves are being built…"). From doorsOpen() it is a Link to /bookstore that walks
// through like the Library door — without the Library's two private effects: the stored choice
// (cs_gateway_choice) and the arrival flag (cs_arriving).
//
// Over the built export (out/), so this is the HTML Cloudflare serves. Needs a build made on or
// after 30 Sep 2026 (the doors are a date); before that, the first test says so plainly.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../../out/index.html', import.meta.url), 'utf8');
const mute = async (page) => {
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  // Nothing here may reach production: every non-GET, and anything off-origin, is refused.
  await page.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (r.request().method() !== 'GET' || (u.hostname !== '127.0.0.1' && !/fonts\.(googleapis|gstatic)/.test(u.hostname))) return r.abort();
    return r.continue();
  });
};
const store = async (page) => page.evaluate(() => ({
  arriving: sessionStorage.getItem('cs_arriving'),
  choice: localStorage.getItem('cs_gateway_choice'),
}));

test('the served gateway HTML carries <a href="/bookstore"> on the Book Store door, and no modal button', () => {
  const door = HTML.match(/<a class="cs-gw-door[^"]*" href="\/bookstore">[\s\S]*?THE BOOK STORE/);
  expect(door, 'out/index.html has no <a href="/bookstore"> door — was this build made before 30 Sep 2026?').not.toBeNull();
  expect(HTML).not.toMatch(/<button class="cs-gw-door[^"]*"[^>]*>[\s\S]{0,300}THE BOOK STORE/);
  expect(HTML).not.toContain('The shelves are being built');
});

test('a tap on the Book Store door walks through and lands on /bookstore, leaving no cs_arriving behind', async ({ page }) => {
  await mute(page);
  await page.goto('/');
  const lib = page.locator('a.cs-gw-door[href="/public-library"]');
  const door = page.locator('a.cs-gw-door[href="/bookstore"]');
  await expect(door).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem('cs_arriving'));
  await door.click();
  // The chosen door swells; the other falls away with the room; the veil closes.
  await expect(door).toHaveClass(/is-entering/);
  await expect(lib).toHaveClass(/cs-gw-fade/);
  await expect(lib).not.toHaveClass(/is-entering/);
  await expect(page.locator('.cs-gw-veil .cs-gw-hairline')).toBeAttached();
  await expect(page.locator('#cs-gw-store')).toHaveCount(0);
  await page.waitForURL('**/bookstore', { timeout: 15000 });
  const s = await store(page);
  expect(s.arriving, 'cs_arriving was left for /public-library\'s veil to find later').toBeNull();
  expect(s.choice, 'the Book Store door recorded a Library choice').toBeNull();
});

test('a stale cs_arriving in the tab is cleared on the way to the Book Store', async ({ page }) => {
  await mute(page);
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('cs_arriving', '1'));
  await page.locator('a.cs-gw-door[href="/bookstore"]').click();
  await page.waitForURL('**/bookstore', { timeout: 15000 });
  expect((await store(page)).arriving).toBeNull();
});

test('the Library door behaves exactly as before: choice recorded, it swells, the flag hands the veil over', async ({ page }) => {
  await mute(page);
  await page.goto('/');
  const lib = page.locator('a.cs-gw-door[href="/public-library"]');
  const door = page.locator('a.cs-gw-door[href="/bookstore"]');
  // Watch the flag being set before the push (ArrivalVeil consumes it on the far side).
  await page.evaluate(() => {
    window.__arrivingSet = false;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'cs_arriving' && v === '1') window.__arrivingSet = true; return set.call(this, k, v); };
  });
  await lib.click();
  await expect(lib).toHaveClass(/is-entering/);
  await expect(door).toHaveClass(/cs-gw-fade/);
  await expect.poll(() => page.evaluate(() => window.__arrivingSet).catch(() => true)).toBe(true);
  await page.waitForURL('**/public-library', { timeout: 15000 });
  expect((await store(page)).choice).toBe('library');
});

test.describe('reduced motion', () => {
  test('both doors are plain navigation: no press, no veil, no arrival flag', async ({ page }) => {
    await mute(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'the emulation did not reach the page').toBe(true);
    await page.locator('a.cs-gw-door[href="/bookstore"]').click();
    await page.waitForURL('**/bookstore', { timeout: 15000 });
    expect((await store(page)).arriving).toBeNull();
    await page.goto('/');
    await page.evaluate(() => {
      window.__arrivingSet = false;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'cs_arriving') window.__arrivingSet = true; return set.call(this, k, v); };
    });
    await expect(page.locator('.cs-gw-veil')).toHaveCount(0);
    const lib = page.locator('a.cs-gw-door[href="/public-library"]');
    await lib.click();
    await page.waitForURL('**/public-library', { timeout: 15000 });
    const s = await store(page);
    expect(s.arriving).toBeNull();
    expect(s.choice).toBe('library');
  });
});
