// W46 — the flag OFF: /series is the grid that shipped before W46 (2 / 3 / 4 columns, no door,
// no door reads), and the room draws nothing. Same emulator fixture as notes-ui.spec.mjs.
import { test, expect } from '@playwright/test';
import { adminApp, closeApp, borrowSlug, ids, seed, fence, recordPaths, signIn } from './fixture.mjs';

let app, slug, I;
test.beforeAll(async () => { slug = await borrowSlug(); I = ids(slug); app = adminApp('w46-notes-off'); });
test.afterAll(async () => { if (app) await closeApp(app); });

test('flag off: /series has no door, no notes reads, and today’s 2 / 3 / 4-column grid', async ({ page }) => {
  await seed(app, slug, { reader: 'member' });
  await fence(page, app);
  const paths = recordPaths(page);
  for (const [w, cols] of [[390, 2], [834, 3], [1280, 4]]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/series');
    await expect(page.locator('.sr-card').first()).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.sn-door')).toHaveCount(0);
    await expect(page.locator('.sn-unit')).toHaveCount(0);
    await expect(page.locator('.sr-grid')).toHaveAttribute('class', 'sr-grid');
    // The cards are the grid's own children, as before W46.
    expect(await page.locator('.sr-grid > a.sr-card').count()).toBe(4);
    const tracks = await page.locator('.sr-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(tracks, `columns at ${w}`).toBe(cols);
  }
  expect(paths.filter((p) => /^series_(notes_summary|questions_public)/.test(p)), 'no door reads').toEqual([]);
});

test('flag off: the room draws nothing, even for a finished member', async ({ page }) => {
  await seed(app, slug, { reader: 'member' });
  await fence(page, app);
  const paths = recordPaths(page);
  await page.goto(`/series/${slug}/notes?i=${I.i2}&endsheet=1`);
  await signIn(page, app);
  await page.waitForTimeout(4000);
  await expect(page.locator('.sn-room')).toHaveCount(0);
  await expect(page.locator('[data-end-sheet]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('READERS’ NOTES');
  expect(paths.filter((p) => p.startsWith('series_')), 'no notes reads at all').toEqual([]);
});
