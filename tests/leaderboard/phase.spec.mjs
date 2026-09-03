import { test, expect } from '@playwright/test';
import { SUMMER_2026 } from '../../app/lib/leaderboards.js';

// R34 — THE POST-CLOSE PHASE SAYS CLOSED, NOT A DATE IN THE PAST.
//
//   npm run test:phase
//
// The live defect: useContestPhase answered two questions, `visible` and `open`,
// and both banners read them as a pair — `open ? 'Now on' : 'Starts 1 August'`.
// `visible` runs for a fortnight past the close so the certified board stays
// linked while places are paid, and for all fourteen of those days `open` was
// false, so the banner above a frozen, certified board advertised a start date a
// month in the past. Thirteen prize-winners read it.
//
// This suite drives the SHIPPED page with the clock moved, which is the only way
// to see the bug: the phase is a function of Date.now() and nothing else, so a
// unit test of the helper proves the helper and not the page. Playwright's clock
// is installed BEFORE navigation because useContestPhase reads it through
// useSyncExternalStore DURING render, not in an effect — an install after load
// would be too late to change what hydration produced.
//
// /leaderboard only. /rewards carries the same card from the same helper, but it
// renders behind auth and this harness has no session; that surface is held by
// the source guard in tests/leaderboard/program.test.mjs instead, which asserts
// neither banner can reach a phase word except through programStatusLabel.
const DAY = 24 * 60 * 60 * 1000;

const INSTANTS = [
  { name: 'before it opens',  at: SUMMER_2026.startsAt - 2 * DAY, says: 'Opening soon' },
  { name: 'while it is open', at: SUMMER_2026.startsAt + 2 * DAY, says: 'Now on' },
  // The fourteen days the bug lived in. This is the case that was wrong.
  { name: 'after it closes',  at: SUMMER_2026.endsAt + 2 * DAY,   says: 'Closed' },
];

// Anything that reads as a promise of a date. The bug was not "the wrong word" —
// it was a DATE surviving into a phase where it had become false, so the banner
// is held to carrying no date at all in any phase.
const DATEISH = /\b(\d{1,2}\s*(Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul)|January|February|March|April|June|July|August|September|October|November|December|starts|begins)\b/i;

for (const instant of INSTANTS) {
  test(`${instant.name}, the banner says "${instant.says}"`, async ({ page }) => {
    await page.clock.install({ time: new Date(instant.at) });
    await page.goto('/leaderboard', { waitUntil: 'networkidle' });

    const banner = page.locator('[data-program-banner]');
    await expect(banner).toBeVisible({ timeout: 30000 });

    const status = page.locator('[data-program-status]');
    await expect(status, 'the banner rendered no status word at all').toHaveCount(1);
    await expect(status).toHaveText(instant.says);

    const text = (await banner.textContent()) || '';
    expect(DATEISH.test(text), `the banner carries a date: ${JSON.stringify(text.trim())}`).toBe(false);
  });
}

test('the banner links to the programme, and the edition button to the board', async ({ page }) => {
  await page.clock.install({ time: new Date(SUMMER_2026.endsAt + 2 * DAY) });
  await page.goto('/leaderboard', { waitUntil: 'networkidle' });

  await expect(page.locator('[data-program-banner] a[href="/reading-program"]')).toHaveCount(1);
  await expect(page.locator(`[data-edition-button][href="/leaderboard/${SUMMER_2026.boardId}"]`)).toHaveCount(1);
});

// R34 — ALL-TIME CARRIES ACROSS SEASONS.
//
// The reason, for the record: editions vary in length, so a fortnight in autumn
// cannot be compared with a month of summer, and a cumulative board is the only
// one that means the same thing on both sides of an edition boundary.
//
// Asserted by RUNNING it rather than by reading badgeEngine: the All Time list is
// read at three instants straddling the Summer 2026 boundary — before the edition
// opened, during it, and after it closed — and the three must be the same list. A
// board that zeroed or re-based at an edition boundary would answer differently
// after the close, and this is what would catch it.
test('the all-time board is the same list on both sides of an edition boundary', async ({ page }) => {
  const readings = [];
  for (const at of [SUMMER_2026.startsAt - DAY, SUMMER_2026.startsAt + DAY, SUMMER_2026.endsAt + 2 * DAY]) {
    await page.clock.install({ time: new Date(at) });
    await page.goto('/leaderboard', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'All Time' }).click();
    await page.waitForSelector('a[href^="/user?id="]', { timeout: 45000 });
    readings.push(await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="/user?id="]')]
        .map((a) => `${a.getAttribute('href')}=${a.lastElementChild?.firstElementChild?.textContent?.trim()}`)
        .join('|')));
  }

  expect(readings[0].length, 'the all-time board rendered nothing — the comparison would be vacuous').toBeGreaterThan(200);
  expect(readings[1], 'the all-time board changed when the edition opened').toBe(readings[0]);
  expect(readings[2], 'the all-time board changed when the edition closed — it reset at the boundary').toBe(readings[0]);
});
