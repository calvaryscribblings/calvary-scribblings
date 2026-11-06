// STORY-W1 — the responses line under the byline (rulings 315 and 316), signed out, over the
// BUILT site (out/), reading the live public `comments` node the way a signed-out reader does.
// Behind the W17 firewall like its siblings: nothing may even try to write.
//
//   315  "1 response" / "{n} responses", and tapping it goes to the responses.
//   316  With none, "Be the first to respond", and it opens the response box — for a signed-out
//        reader, the box is the sign-in prompt.
//   and  the byline's type, colour and row gap.
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installFirewall, newStats, statsLine } from '../live/firewall.mjs';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const OUT = fileURLToPath(new URL('../../out', import.meta.url));
const built = (slug) => existsSync(`${OUT}/stories/${slug}.html`) || existsSync(`${OUT}/stories/${slug}/index.html`);

let WITH = null; let NONE = null;
test.beforeAll(async () => {
  const shallow = (await (await fetch(`${DB}/comments.json?shallow=true`)).json()) || {};
  for (const slug of Object.keys(shallow).sort()) {
    if (!built(slug)) continue;
    const all = await (await fetch(`${DB}/comments/${encodeURIComponent(slug)}.json`)).json();
    if (Object.values(all || {}).some((c) => c && c.text && !c.deletedAt)) { WITH = slug; break; }
  }
  const index = (await (await fetch(`${DB}/cms_stories_index.json?shallow=true`)).json()) || {};
  NONE = Object.keys(index).sort().find((slug) => !shallow[slug] && built(slug)) || null;
  if (!WITH || !NONE) throw new Error('need one built story with responses and one with none');
});

let stats;
test.beforeEach(async ({ context, baseURL }) => { stats = newStats(); await installFirewall(context, { site: baseURL, stats }); });
test.afterEach(async () => {
  console.log(`firewall: ${statsLine(stats)}`);
  expect(stats.wsWritesStopped + stats.restAborted + stats.apiAborted, 'nothing may even try to write').toBe(0);
});

const line = (page) => page.locator('.story-responses-line a.story-responses-link');

test('with responses: the count, matching the section, and a tap goes to them', async ({ page }) => {
  await page.goto(`/stories/${WITH}`);
  await expect(line(page)).toBeVisible({ timeout: 45000 });
  const n = Number(await line(page).getAttribute('data-count'));
  expect(n).toBeGreaterThan(0);
  await expect(line(page)).toHaveText(n === 1 ? '1 response' : `${n} responses`);
  await expect(page.locator('.cs-count')).toHaveText(n === 1 ? '1 response' : `${n} responses`);
  await line(page).click();
  await expect.poll(async () => page.locator('#responses').evaluate((el) => Math.round(el.getBoundingClientRect().top)), { timeout: 10000 })
    .toBeLessThan(120);
  await expect(page.locator('.auth-modal')).toHaveCount(0);
});

test('with none: "Be the first to respond", and a tap opens the box (signed out: the sign-in prompt)', async ({ page }) => {
  await page.goto(`/stories/${NONE}`);
  await expect(line(page)).toBeVisible({ timeout: 45000 });
  await expect(line(page)).toHaveText('Be the first to respond');
  await line(page).click();
  await expect(page.locator('.auth-modal')).toBeVisible();
});

test('the byline\'s type, colour and row gap', async ({ page }) => {
  await page.goto(`/stories/${WITH}`);
  await expect(line(page)).toBeVisible({ timeout: 45000 });
  const m = await page.evaluate(() => {
    const by = document.querySelector('.story-byline');
    const items = Array.from(by.querySelectorAll('.byline-item'));
    const ln = document.querySelector('.story-responses-line');
    const a = ln.querySelector('a');
    const cs = (el) => { const s = getComputedStyle(el); return { size: s.fontSize, family: s.fontFamily, color: s.color, ls: s.letterSpacing, weight: s.fontWeight, style: s.fontStyle }; };
    const bottom = Math.max(...items.map((i) => i.getBoundingClientRect().bottom));
    return { by: cs(items[1]), ln: cs(a), gap: ln.getBoundingClientRect().top - bottom, rowGap: parseFloat(getComputedStyle(by).rowGap) };
  });
  expect(m.ln).toEqual(m.by);
  expect(Math.abs(m.gap - m.rowGap), `gap ${m.gap} vs the byline's row gap ${m.rowGap}`).toBeLessThanOrEqual(1);
});
