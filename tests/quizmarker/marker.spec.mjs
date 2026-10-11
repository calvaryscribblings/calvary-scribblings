// R45 — WHAT ACTUALLY PAINTS. The half that a source grep cannot do.
//
// Counts marker chips on screen after the real data has loaded. See the config header for why
// this exists alongside tests/ci/quiz-marker.test.mjs.

import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { advertisesQuiz } from '../../app/lib/readerCollection.js';

const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const OUT = fileURLToPath(new URL('../../out', import.meta.url));

/** Every word the pill can print. It is one component with three states, and all three go. */
const MARKER_WORDS = ['✦ Quiz', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Locked'];

/**
 * A marker chip, defined by what it LOOKS like rather than by a class or a test id — the
 * regression this guards against is somebody re-creating the chip, and a re-creation would
 * not carry the old hook. Absolutely positioned, pill-shaped, and printing one of the words.
 */
async function countMarkers(page) {
  return page.evaluate((words) => {
    const found = [];
    for (const el of document.querySelectorAll('span, div')) {
      const text = (el.textContent || '').trim();
      if (!words.includes(text)) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'absolute') continue;
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      found.push({ text, w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor });
    }
    return found;
  }, MARKER_WORDS);
}

/** Wait for the client-side CMS fetch to have populated the grid. */
async function loadCards(page, path) {
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => document.querySelectorAll('a[href^="/stories/"]').length > 0,
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(2500);
}

// Every surface that draws story cards, at both widths the site is designed for.
const CARD_SURFACES = ['/public-library', '/poetry', '/short', '/flash', '/news', '/inspiring'];
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

for (const vp of VIEWPORTS) {
  test.describe(`R45 — no card paints the marker (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const path of CARD_SURFACES) {
      test(`${path} paints no marker chip`, async ({ page }) => {
        await loadCards(page, path);
        const cards = await page.locator('a[href^="/stories/"]').count();
        expect(cards, `${path} rendered no cards — the check would pass vacuously`).toBeGreaterThan(0);

        const markers = await countMarkers(page);
        expect(markers, `${path} still paints ${markers.length} marker chip(s): ${JSON.stringify(markers.slice(0, 4))}`)
          .toEqual([]);
      });
    }

    test('a story with a quiz and one without are indistinguishable on a card', async ({ page }) => {
      // The ruling as a property of the SCREEN. /public-library carries stories that do and
      // do not advertise a quiz; if any card were still marking the difference, it would show
      // up as a chip on some cards and not others — which is exactly what countMarkers finds.
      await loadCards(page, '/public-library');
      expect(await countMarkers(page)).toEqual([]);

      // And the cards are otherwise alive: covers and titles still paint, so "no markers" is
      // not "no cards".
      expect(await page.locator('a[href^="/stories/"] img').count()).toBeGreaterThan(0);
    });
  });
}

test.describe('R45 — what is NOT a card keeps its marker', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the story page keeps its jump link and its quiz card', async ({ page }) => {
    // Resolve a live story that advertises a quiz rather than hardcoding a slug — a hardcoded
    // slug broke five suites in this repo once already. W38: it used to take the first twelve
    // story links on /public-library, but the shelf is newest-first and by 11 Oct 2026 the
    // newest 37 published stories carried no quiz, so the window held none and the step went
    // red on data alone. It now asks the record the page itself decides from (cms_stories is
    // public-read; advertisesQuiz is the page's own predicate), among stories with a built page.
    const all = await (await fetch(`${DB}/cms_stories.json`)).json();
    const slug = Object.entries(all || {})
      .filter(([, st]) => st && st.published !== false && !st.hiddenAt && advertisesQuiz(st))
      .map(([k]) => k)
      .sort()
      .find((k) => existsSync(`${OUT}/stories/${k}.html`) || existsSync(`${OUT}/stories/${k}/index.html`));
    expect(slug, 'no built story advertises a quiz').toBeTruthy();

    let checked = 0;
    await page.goto(`/stories/${slug}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const link = page.getByText('This story has a quiz', { exact: false });
    if (await link.count()) {
      await expect(link.first()).toBeVisible();
      await expect(page.locator('#quiz-card')).toHaveCount(1);
      checked++;
    }
    expect(checked, `/stories/${slug} advertises a quiz in its record but the page shows no jump link`)
      .toBe(1);
  });

  test('/search still paints a pill for a story that advertises a quiz', async ({ page }) => {
    await page.goto('/search', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.locator('input').first().fill('a');
    await page.waitForTimeout(2500);
    const results = await page.locator('a[href^="/stories/"]').count();
    expect(results, 'search returned nothing — the check would pass vacuously').toBeGreaterThan(0);

    const markers = await countMarkers(page);
    expect(markers.length, '/search lost its pill — the ruling was about cards')
      .toBeGreaterThan(0);
  });
});
