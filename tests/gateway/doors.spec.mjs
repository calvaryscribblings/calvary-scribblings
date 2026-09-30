// W31 — THE GATEWAY'S BOOK STORE DOOR. On launch night the door at / still opened the pre-launch
// box ("The shelves are being built…"). From doorsOpen() it is a Link to /bookstore that walks
// through like the Library door. The stored choice (cs_gateway_choice) is the Library's alone.
//
// W32 — AND IT ARRIVES LIKE THE LIBRARY DOOR. cs_arriving holds the destination path, and only
// that route's ArrivalVeil plays it; the storefront holds the veil until its first real state
// and lifts as one move. W31 had kept the flag off this door, and the shop drew in pieces in
// full view (Ikenna's "flash", 30 Sep 02:06). Films: tests/gateway/film-doors.mjs; the settled
// page against a direct visit: tests/gateway/settled-match.mjs.
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

// W32: the flag holds the DESTINATION PATH, and only that route's ArrivalVeil plays it.
const spyFlag = (page) => page.evaluate(() => {
  window.__flagWrites = [];
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === 'cs_arriving') window.__flagWrites.push(v); return set.call(this, k, v); };
});
// On the far side: record, per frame, whether the arrival veil is up, lifting, and whether the
// shop's skeleton is still standing — from the first frame of the new document tree.
const watchArrival = (page) => page.addInitScript(() => {
  window.__arr = [];
  const f = () => {
    const v = document.querySelector('.cs-arrive-veil');
    window.__arr.push({ path: location.pathname, veil: !!v, lifting: !!(v && v.classList.contains('is-lifting')), skeleton: !!document.querySelector('.skeleton'), nav: !!document.querySelector('.cs-nav'), arrival: !!document.querySelector('[data-arrival]') });
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});

test.describe('at 402x874, where the tab bar is drawn', () => {
test.use({ viewport: { width: 402, height: 874 } });
test('the Book Store door walks through with the flag "/bookstore", and the storefront holds the veil until it is drawn', async ({ page }) => {
  await mute(page);
  await page.goto('/');
  const lib = page.locator('a.cs-gw-door[href="/public-library"]');
  const door = page.locator('a.cs-gw-door[href="/bookstore"]');
  await expect(door).toBeVisible();
  await spyFlag(page);
  await page.evaluate(() => {
    window.__arr = [];
    const f = () => {
      const v = document.querySelector('.cs-arrive-veil');
      const tb = document.querySelector('.cs-tabbar');
      window.__arr.push({ path: location.pathname, veil: !!v, lifting: !!(v && v.classList.contains('is-lifting')), skeleton: !!document.querySelector('.skeleton'), nav: !!document.querySelector('.cs-nav'), gw: !!document.querySelector('.cs-gw-veil'), tabBottom: tb ? Math.round(tb.getBoundingClientRect().bottom) : null, h: window.innerHeight });
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  await door.click();
  // The chosen door swells; the other falls away with the room; the veil closes.
  await expect(door).toHaveClass(/is-entering/);
  await expect(lib).toHaveClass(/cs-gw-fade/);
  await expect(page.locator('.cs-gw-veil .cs-gw-hairline')).toBeAttached();
  await expect(page.locator('#cs-gw-store')).toHaveCount(0);
  await page.waitForURL('**/bookstore', { timeout: 15000 });
  const writes = await page.evaluate(() => window.__flagWrites);
  expect(writes, 'the Book Store door must hand the storefront its arrival').toEqual(['/bookstore']);
  // The storefront's own veil takes over and then lifts.
  await expect(page.locator('[data-arrival]')).toBeAttached();
  await expect(page.locator('.cs-arrive-veil')).toHaveCount(0, { timeout: 8000 });
  const log = await page.evaluate(() => window.__arr);
  const onStore = log.filter((e) => e.path === '/bookstore');
  expect(onStore.length).toBeGreaterThan(0);
  // Every frame on /bookstore until the lift begins is veiled — no frame of the shop in pieces.
  const firstLift = onStore.findIndex((e) => e.lifting);
  expect(firstLift, 'the veil never lifted').toBeGreaterThanOrEqual(0);
  const before = onStore.slice(0, firstLift);
  expect(before.every((e) => e.veil), `an unveiled frame on /bookstore before the lift: ${JSON.stringify(before.find((e) => !e.veil))}`).toBe(true);
  // It lifted onto the shop's first real state: no skeleton left standing when the fade began.
  expect(onStore[firstLift].skeleton, 'the veil lifted onto the skeleton shelf').toBe(false);
  // The fixed chrome stays on the glass through the lift: a transform on an ancestor of the tab
  // bar would pin it to the bottom of the whole page, then snap it back when the lift ends.
  const lifting = onStore.filter((e) => e.lifting);
  expect(lifting.length).toBeGreaterThan(0);
  expect(lifting.every((e) => e.tabBottom > 0), 'no tab bar box at this width').toBe(true);
  for (const e of lifting) expect(Math.abs(e.tabBottom - e.h), `tab bar off the glass during the lift: ${JSON.stringify(e)}`).toBeLessThanOrEqual(1);
  // The flag was consumed, and the shop's entrance animations did not also run.
  const s = await store(page);
  expect(s.arriving).toBeNull();
  expect(s.choice, 'the Book Store door recorded a Library choice').toBeNull();
  const anim = await page.evaluate(() => ['.hero-inner', '.shop-bar'].map((q) => getComputedStyle(document.querySelector(q)).animationDuration));
  expect(anim, 'the masthead / shop bar ran their own fadeUp on top of the lift').toEqual(['0s', '0s']);
  // After walking in, Home plays no veil (and the Library, visited directly, none either).
  await page.goto('/');
  await expect(page.locator('.cs-arrive-veil')).toHaveCount(0);
  await page.goto('/public-library');
  await page.waitForTimeout(300);
  await expect(page.locator('.cs-arrive-veil')).toHaveCount(0);
});
});

test('a direct visit to /bookstore is untouched: no veil, no data-arrival, no rise, its own entrance plays', async ({ page }) => {
  await mute(page);
  await watchArrival(page);
  await page.goto('/bookstore');
  await expect(page.locator('#fiction .shelf').first()).toBeVisible({ timeout: 30000 });
  const log = await page.evaluate(() => window.__arr);
  expect(log.some((e) => e.veil || e.arrival), 'a direct visit showed a veil or carried data-arrival').toBe(false);
  await expect(page.locator('.cs-arrive-rise')).toHaveCount(0);
  const anim = await page.evaluate(() => ['.hero-inner', '.shop-bar'].map((q) => getComputedStyle(document.querySelector(q)).animationDuration));
  expect(anim).toEqual(['0.9s', '0.9s']);
});

for (const [flag, visit] of [['/bookstore', '/public-library'], ['/public-library', '/bookstore'], ['1', '/public-library'], ['1', '/bookstore']]) {
  test(`a stray flag "${flag}" plays no veil on ${visit}, and is cleared`, async ({ page }) => {
    await mute(page);
    await watchArrival(page);
    await page.addInitScript((f) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('cs_arriving', f); sessionStorage.setItem('__seeded', '1'); } }, flag);
    await page.goto(visit);
    await page.waitForTimeout(1500);
    const log = await page.evaluate(() => window.__arr);
    expect(log.some((e) => e.veil), `a veil played on ${visit} for the flag "${flag}"`).toBe(false);
    expect((await store(page)).arriving, 'the stray flag survived').toBeNull();
  });
}

test('the Library door behaves as before, with the flag now naming its route', async ({ page }) => {
  await mute(page);
  await page.goto('/');
  const lib = page.locator('a.cs-gw-door[href="/public-library"]');
  const door = page.locator('a.cs-gw-door[href="/bookstore"]');
  await spyFlag(page);
  await lib.click();
  await expect(lib).toHaveClass(/is-entering/);
  await expect(door).toHaveClass(/cs-gw-fade/);
  await page.waitForURL('**/public-library', { timeout: 15000 });
  expect(await page.evaluate(() => window.__flagWrites)).toEqual(['/public-library']);
  await expect(page.locator('[data-arrival]')).toBeAttached();
  await expect(page.locator('.cs-arrive-veil')).toHaveCount(0, { timeout: 8000 });
  const s = await store(page);
  expect(s.choice).toBe('library');
  expect(s.arriving).toBeNull();
});

test.describe('reduced motion', () => {
  test('both doors are plain navigation: no press, no veil, no arrival flag', async ({ page }) => {
    await mute(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'the emulation did not reach the page').toBe(true);
    await spyFlag(page);
    await page.locator('a.cs-gw-door[href="/bookstore"]').click();
    await page.waitForURL('**/bookstore', { timeout: 15000 });
    await page.waitForTimeout(300);
    await expect(page.locator('.cs-arrive-veil')).toHaveCount(0);
    expect(await page.evaluate(() => window.__flagWrites ?? [])).toEqual([]);
    expect((await store(page)).arriving).toBeNull();
    await page.goto('/');
    await spyFlag(page);
    const lib = page.locator('a.cs-gw-door[href="/public-library"]');
    await lib.click();
    await page.waitForURL('**/public-library', { timeout: 15000 });
    await page.waitForTimeout(300);
    await expect(page.locator('.cs-arrive-veil')).toHaveCount(0);
    const s = await store(page);
    expect(s.arriving).toBeNull();
    expect(s.choice).toBe('library');
  });
});
