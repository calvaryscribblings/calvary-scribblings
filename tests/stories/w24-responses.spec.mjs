// W24 — STORY RESPONSES, SIGNED OUT (the web half of Ikenna's 27 Sep parity ruling).
//
//   npm run test:responses          (needs a built out/: `npx next build` first)
//
// A signed-out reader sees Reply on a response, as the app shows it, and Reply, a heart or a fire
// opens the site's sign-in prompt (AuthModal) in place instead of doing nothing.
//
// Over the BUILT site (out/, served by tests/reader/app-server.mjs), reading the LIVE responses a
// signed-out reader would — `comments` is public-read. Signed out, nothing CAN be written, and the
// W17 firewall (tests/live/firewall.mjs) makes that a fact rather than an assumption: every
// non-GET, every long-poll and every database write frame is stopped and counted, and the counts
// are asserted to be zero at the end of each test.
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installFirewall, newStats, statsLine } from '../live/firewall.mjs';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const OUT = fileURLToPath(new URL('../../out', import.meta.url));

/** A story with a built page and at least one live top-level response, found at run time. */
let SLUG = null;
test.beforeAll(async () => {
  const shallow = await (await fetch(`${DB}/comments.json?shallow=true`)).json();
  for (const slug of Object.keys(shallow || {}).sort()) {
    if (!existsSync(`${OUT}/stories/${slug}.html`) && !existsSync(`${OUT}/stories/${slug}/index.html`)) continue;
    const all = await (await fetch(`${DB}/comments/${encodeURIComponent(slug)}.json`)).json();
    if (Object.values(all || {}).some((c) => c && c.text && !c.parentId && !c.deletedAt)) { SLUG = slug; break; }
  }
  if (!SLUG) throw new Error('no built story with a live response to test against');
});

let stats;
test.beforeEach(async ({ context, baseURL }) => {
  stats = newStats();
  await installFirewall(context, { site: baseURL, stats });
});
test.afterEach(async () => {
  console.log(`firewall: ${statsLine(stats)}`);
  expect(stats.wsWritesStopped + stats.restAborted + stats.apiAborted, 'nothing may even try to write').toBe(0);
});

async function openResponses(page) {
  await page.goto(`/stories/${SLUG}`);
  const first = page.locator('.cs-comments-list .cs-comment').first();
  await first.scrollIntoViewIfNeeded({ timeout: 45000 });
  await expect(first).toBeVisible({ timeout: 45000 });
  return first;
}

const prompt = (page) => page.locator('.auth-modal');

test('signed out, a response shows Reply', async ({ page }) => {
  const first = await openResponses(page);
  await expect(first.locator('.cs-reply-btn')).toHaveText('Reply');
  await expect(prompt(page)).toHaveCount(0);
});

test('signed out, Reply opens the sign-in prompt in place, and no reply box', async ({ page }) => {
  const first = await openResponses(page);
  const url = page.url();
  await first.locator('.cs-reply-btn').click();
  await expect(prompt(page)).toBeVisible();
  expect(page.url(), 'in place: no navigation').toBe(url);
  await expect(page.locator('.cs-reply-compose')).toHaveCount(0);
});

for (const kind of ['heart', 'fire']) {
  test(`signed out, a ${kind} opens the sign-in prompt, and the count does not move`, async ({ page }) => {
    const first = await openResponses(page);
    const btn = first.locator(`.rx[data-kind="${kind}"]`);
    const before = await btn.getAttribute('aria-label');
    await btn.click();
    await expect(prompt(page)).toBeVisible();
    expect(await btn.getAttribute('aria-label'), 'nothing counted').toBe(before);
  });
}

test('the prompt closes back to the story', async ({ page }) => {
  const first = await openResponses(page);
  await first.locator('.cs-reply-btn').click();
  await expect(prompt(page)).toBeVisible();
  await page.locator('.auth-close').click();
  await expect(prompt(page)).toHaveCount(0);
  await expect(first).toBeVisible();
});
