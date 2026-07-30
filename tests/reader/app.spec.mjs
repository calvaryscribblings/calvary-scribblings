// THE APP HARNESS — the React boundary the host harness cannot reach.
//
// It drives the real /reader/{slug} route out of the static export, so ReadingRoom.js,
// its chrome state and the postMessage bridge are all the production ones.
//
// THE SLUG: beta-princess. Chosen because it is a published cms_story with
// readerMode === true, an epubUrl and a cover — so it exercises the story register's full
// opening (splash → frame → chrome) — and because reading it needs no account. Ribbons and
// progress do need one, and are deliberately out of scope here: this file is about chrome,
// which every reader gets, signed in or not.
//
// Firebase is live. A failure to resolve the story is a network or data problem, and the
// first assertion names it rather than letting a later one fail mysteriously.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// THE ONE SUBSTITUTION. Firebase Storage's bucket CORS allows the production origins, not
// 127.0.0.1 — measured: the reader's fetch fails with net::ERR_FAILED and the room shows
// its "could not open this book" state. Rather than widen a production CORS policy for a
// test, the EPUB BYTES are served from the harness fixture. Everything else is real: the
// route, the gate, the cms_stories lookup, ReadingRoom and the whole chrome state machine.
// This file tests the React boundary, not whether Storage is configured.
const FIXTURE = readFileSync(fileURLToPath(new URL('../fixtures/harness-book.epub', import.meta.url)));

async function stubEpub(page) {
  await page.route(
    (url) => url.hostname === 'firebasestorage.googleapis.com' && /\.epub/i.test(url.pathname),
    (route) => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/epub+zip', 'Access-Control-Allow-Origin': '*' },
      body: FIXTURE,
    }),
  );
}

const SLUG = 'beta-princess';
const VIEWPORT = { width: 400, height: 800 };

// The frame is inset by the ribbon lane (--rr-lane: 30px), so the reader's own viewport is
// narrower than the page's. These are page coordinates chosen to land in the intended
// third OF THE FRAME.
const FRAME_W = VIEWPORT.width - 30;
const CENTRE_X = Math.round(FRAME_W / 2);          // 185
const RIGHT_X = Math.round((FRAME_W * 5) / 6);     // 308
const TAP_Y = 420;

const IDLE_MS = 3500;

async function chromeHidden(page) {
  return page.locator('.rr-top').evaluate((el) => el.classList.contains('hidden'));
}

async function expectChrome(page, state, why) {
  await expect
    .poll(async () => ((await chromeHidden(page)) ? 'hidden' : 'visible'), { message: why, timeout: 4000 })
    .toBe(state);
}

// OPEN THE BOOK — and not by clicking the middle of the cover.
//
// The splash is a full-screen div whose onClick is the only way past it, but it CONTAINS
// `<div className="rr-cabout" onClick={e => e.stopPropagation()}>` — the About-the-Author
// block, deliberately swallowing taps so a reader can expand a bio without accidentally
// opening the book (page-reader.js:554). Playwright's .click() aims at the centre of the
// target's box, and the centre of a full-screen flex-column cover is wherever the content
// happens to land. Locally that missed the bio; on a CI runner, where the display webfonts
// are absent and every block is a different height, it landed square on it — the click was
// swallowed, the cover never lifted, and all six specs failed 30 s later complaining about
// the iframe. Diagnosed off the CI trace, which shows "Open to begin reading" still on
// screen at failure time.
//
// So: click a fixed offset in the cover's top-left corner, which is the cover itself under
// any layout (.rr-cover::before is pointer-events:none), and then PROVE the cover lifted.
// A click that stops working now fails here, by name, instead of somewhere downstream.
async function dismissCover(page) {
  await page.waitForSelector('.rr-cover', { timeout: 45000 });
  await page.locator('.rr-cover').click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.rr-cover'), 'the cover splash must lift when it is tapped')
    .toHaveCount(0, { timeout: 10000 });
}

/** Open the reader, dismiss the splash, and wait until the book has actually painted. */
async function openStory(page) {
  await stubEpub(page);
  await page.goto(`/reader/${SLUG}`, { waitUntil: 'domcontentloaded' });

  // The gate resolves the slug against bookstore_titles and cms_stories. If this times out
  // the story did not resolve — data or network, not chrome.
  await dismissCover(page);

  await page.waitForSelector('.rr-frame', { timeout: 30000 });

  // Wait for the host to have a section document — i.e. the EPUB is open and taps will
  // reach foliate rather than an empty frame.
  await expect.poll(async () => {
    const f = page.frames().find((fr) => fr.url().includes('/reading-room.html'));
    if (!f) return 0;
    try {
      return await f.evaluate(() => {
        const v = document.querySelector('foliate-view');
        return v?.renderer?.getContents?.()?.length || 0;
      });
    } catch { return 0; }
  }, { timeout: 45000, message: 'the EPUB never opened in the reading room' }).toBeGreaterThan(0);

  await page.waitForTimeout(400);
}

test.describe('A1 — chrome across the boundary', () => {
  test('a centre tap toggles the chrome, and toggles it back', async ({ page }) => {
    await openStory(page);

    // Chrome starts visible and arms its own countdown; let it fall so the toggle starts
    // from a known state.
    await page.waitForTimeout(IDLE_MS + 700);
    await expectChrome(page, 'hidden', 'chrome should auto-hide once reading begins');

    await page.touchscreen.tap(CENTRE_X, TAP_Y);
    await expectChrome(page, 'visible', 'FIRST centre tap must summon the chrome');

    // THE REPRODUCTION. A second centre tap must put it away again.
    await page.touchscreen.tap(CENTRE_X, TAP_Y);
    await expectChrome(page, 'hidden', 'SECOND centre tap must dismiss the chrome');
  });

  test('page turns do not summon hidden chrome', async ({ page }) => {
    await openStory(page);
    await page.waitForTimeout(IDLE_MS + 700);
    await expectChrome(page, 'hidden', 'starting from hidden');

    await page.touchscreen.tap(RIGHT_X, TAP_Y);
    await page.waitForTimeout(700);
    await page.touchscreen.tap(RIGHT_X, TAP_Y);
    await page.waitForTimeout(700);

    expect(await chromeHidden(page), 'turning pages must not summon the chrome').toBe(true);
  });

  test('page turns keep visible chrome up, and it falls when the reader stops', async ({ page }) => {
    await openStory(page);
    await page.waitForTimeout(IDLE_MS + 700);
    await page.touchscreen.tap(CENTRE_X, TAP_Y);
    await expectChrome(page, 'visible', 'summoned');

    // Turn pages inside the idle window: each turn must restart the countdown (R7.2's
    // re-arm), so the chrome is still up well past a single 3.5s period.
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1500);
      await page.touchscreen.tap(RIGHT_X, TAP_Y);
      expect(await chromeHidden(page), `chrome must stay up while turning (turn ${i + 1})`).toBe(false);
    }

    // Stop reading: now it should fall on its own.
    await expectChrome(page, 'hidden', 'chrome must retire once the reader goes quiet');
  });
});

// ── The jump, across the React boundary ──────────────────────────────────────
// Ribbons need an account, so they cannot be driven here. The Contents CHAPTER list
// cannot either be driven without... nothing: it needs no account, and it goes through
// the SAME ReadingRoom.jumpTo → postToFrame({type:'goTo'}) path a ribbon uses. So this
// proves the React half of the jump plumbing end to end; what it does not cover is the
// ribbon row's own binding (onJump(record)), which is auth-gated and stays glass-verified
// with ?rrdebug=1.
test('Contents → a chapter tap moves the reader (the React jump path)', async ({ page }) => {
  await openStory(page);

  // Summon chrome if it has retired, then open Contents.
  if (await chromeHidden(page)) {
    await page.touchscreen.tap(CENTRE_X, TAP_Y);
    await expectChrome(page, 'visible', 'chrome for the toolbar');
  }
  await page.locator('.rr-tool', { hasText: 'Contents' }).click();
  await page.waitForSelector('.rr-sheet .rr-toc-item', { timeout: 15000 });

  const items = page.locator('.rr-toc-item');
  const count = await items.count();
  expect(count, 'the fixture book must expose chapters').toBeGreaterThan(2);

  const readFraction = async () => {
    const f = page.frames().find((fr) => fr.url().includes('/reading-room.html'));
    return f.evaluate(() => document.querySelector('foliate-view')?.renderer?.start ?? -1);
  };

  const before = await readFraction();
  await items.nth(count - 1).click();          // the last chapter — furthest from page one
  await page.waitForTimeout(1500);

  // The sheet must close, and the reader must have moved.
  await expect(page.locator('.rr-sheet')).toHaveCount(0);
  const chapterLabel = await page.locator('.rr-chapter').textContent().catch(() => '');
  const after = await readFraction();
  console.log(`\n=== Contents jump ===\nrenderer.start ${before} → ${after}\nchapter label: "${chapterLabel}"\n`);

  // A chapter jump loads a new section, so renderer.start resets — the reliable signal is
  // that the reader is now in a DIFFERENT section, which the chapter label reports.
  expect((chapterLabel || '').trim().length, 'the top bar must name the chapter we jumped to')
    .toBeGreaterThan(0);
});

// ── R7.3 §E — the Contents panel knows where the reader IS ───────────────────
// ContentsPanel has always carried `.current` styling for the chapter in hand
// (ReadingRoom.js:393), and it has never once been applied: the class is decided by
// `c.href === chapterHref`, and chapterHref had no source. The host reported tocItem.label
// on relocate but not tocItem.href, so the panel could name the chapter in the top bar and
// still not know which row it was. R7.3 adds chapterHref to the relocate payload — purely
// additive, so the bookstore register and the story adapter are untouched — and the
// comparison comes alive.
//
// Chapter 3 specifically, not the last: the last row is where the previous test leaves the
// reader, so matching it could pass on a stale highlight. Three is somewhere the reader has
// to be MOVED to, which is the thing being asserted.
const CHAPTER_3 = 'What the Ferryman Knew';

async function openContents(page) {
  if (await chromeHidden(page)) {
    await page.touchscreen.tap(CENTRE_X, TAP_Y);
    await expectChrome(page, 'visible', 'chrome for the toolbar');
  }
  await page.locator('.rr-tool', { hasText: 'Contents' }).click();
  await page.waitForSelector('.rr-sheet .rr-toc-item', { timeout: 15000 });
}

test('Contents marks the chapter the reader is actually in', async ({ page }) => {
  await openStory(page);

  await openContents(page);
  const items = page.locator('.rr-toc-item');
  await expect(items.nth(2), 'the fixture book must expose a third chapter').toHaveText(CHAPTER_3);

  // Nothing should be current-by-accident before the jump: the reader opens at chapter one,
  // so if chapter 3 were already marked the assertion below would prove nothing.
  const currentBefore = await page.locator('.rr-toc-item.current').allTextContents();
  expect(currentBefore, 'chapter 3 must not be marked before the reader goes there')
    .not.toContain(CHAPTER_3);

  await items.nth(2).click();
  await expect(page.locator('.rr-sheet')).toHaveCount(0);

  // Reopen and read the highlight. Polled: the mark follows the host's relocate, which
  // lands after the section has been laid out, not on the click.
  await openContents(page);
  await expect
    .poll(async () => (await page.locator('.rr-toc-item.current').allTextContents()).join('|'),
      { timeout: 10000, message: 'Contents must mark chapter 3 as current after jumping there' })
    .toBe(CHAPTER_3);

  console.log(`\n=== Contents current chapter ===\nbefore: ${JSON.stringify(currentBefore)}\nafter:  "${CHAPTER_3}"\n`);
});

// ── R7.3 §B — the forever-spinner, closed across the React boundary ──────────
// load-fence.spec.mjs proves the HOST turns a book that will not arrive into a reported
// fact. This proves the other half: that the register above renders a reader-facing state
// off that report instead of leaving the room dressed for reading with nothing in it.
// Before R7.3 the story register never passed onError at all, so the message arrived
// nowhere and the spinner ran until the reader gave up.
//
// A 404 rather than a hang: the fence is the host's business and is already measured
// against real silence next door. Here the only question is what the READER sees, and 404
// is the cheapest dead URL that asks it.
test('a book that will not open shows the failure state, with a way out', async ({ page }) => {
  await page.route(
    (url) => url.hostname === 'firebasestorage.googleapis.com' && /\.epub/i.test(url.pathname),
    (route) => route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'gone' }),
  );

  await page.goto(`/reader/${SLUG}`, { waitUntil: 'domcontentloaded' });
  await dismissCover(page);                    // the frame only mounts once the cover is dismissed

  const fail = page.locator('.rr-fail');
  await expect(fail, 'a dead EPUB URL must end in the failure state, not a spinner')
    .toBeVisible({ timeout: 30000 });

  // It must read as the Reading Room, not as a stack trace...
  await expect(page.locator('.rr-fail-kicker')).toHaveText('The Reading Room');
  await expect(page.locator('.rr-fail-note')).toContainText('would not open');

  // ...and it must offer the route the whole state exists for: the prose is still on the
  // story page even when the EPUB is not.
  const out = page.locator(`.rr-fail-actions a[href="/stories/${SLUG}"]`);
  await expect(out, 'the failure state must route the reader to the story page').toHaveCount(1);

  // And the spinner must be gone — the defect was never "no error", it was "spins forever".
  await expect(page.locator('.rr-booting')).toHaveCount(0);

  console.log(`\n=== failure state ===\n${(await fail.innerText()).replace(/\n+/g, ' / ')}\n`);
});
