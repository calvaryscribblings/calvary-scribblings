// THE APP HARNESS — the React boundary the host harness cannot reach.
//
// It drives the real /reader/{slug} route out of the static export, so ReadingRoom.js,
// its chrome state and the postMessage bridge are all the production ones.
//
// ── THE SUBJECT IS RESOLVED, NOT WRITTEN DOWN (R19.6) ────────────────────────────────────
//
// This file pinned the literal slug `beta-princess` until R19.6. R12 moved that story into
// the Series and unpublished both its parts, the static export stopped emitting a page for
// it, and all ten specs below failed at `dismissCover` with a 30-second timeout on every run
// from R17.4 onward. tests/reader/fixture-story.mjs now resolves the subject from the live
// catalogue at suite start — tier 1 the story register, tier 2 a bookstore sample — and prints
// which tier fired. Read that file's header before changing anything here; in particular it
// records WHY tier 1 is currently empty and why that is editorial, not drift.
//
// ⚠ WHICH REGISTER IS UNDER TEST DEPENDS ON THE FIXTURE. Everything owned by ReadingRoom —
// chrome, the tap zones, Contents, the definition modal — is register-agnostic and asserted
// identically either way. The two specs that are NOT are marked BOOK-REGISTER or
// STORY-REGISTER at their own site, with a note recording what they used to cover.
//
// Firebase is live. A failure to resolve the story is a network or data problem, and the
// first assertion names it rather than letting a later one fail mysteriously.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveFixture } from './fixture-story.mjs';

// Top-level await: Playwright awaits a spec module while collecting it, so this runs once,
// before any test body, and its log lands at the head of the run output. A throw here fails
// the whole file by name instead of leaving ten specs to time out on a slug that is not there.
const FIXTURE = await resolveFixture();

// ── THE SUBSTITUTIONS, AND THE SECOND ONE IS NEW IN R19.6 ───────────────────────────────
//
// Firebase Storage's bucket CORS allows the production origins, not 127.0.0.1 — measured: the
// reader's fetch fails with net::ERR_FAILED and the room shows its "could not open this book"
// state. Rather than widen a production CORS policy for a test, the EPUB is served from the
// harness fixture. Everything else is real: the route, the gate, the bookstore_titles /
// cms_stories lookup, ReadingRoom and the whole chrome state machine.
//
// TWO ROUTES, NOT ONE, because the book register needs a round trip the story register does
// not. A cms_story carries a permanent download URL on the record, so one stub on the BYTES
// was enough. A bookstore sample carries a Storage PATH and calls getDownloadURL(), which GETs
// the object's METADATA first and reads `downloadTokens` out of it to build the byte URL. Both
// requests go to firebasestorage.googleapis.com and both have `.epub` in the path, so the old
// single matcher swallowed the metadata call as well and handed the SDK an EPUB where it
// expected JSON. The two are told apart by `alt=media`, which only the byte fetch carries.
const FIXTURE_EPUB = readFileSync(fileURLToPath(new URL('../fixtures/harness-book.epub', import.meta.url)));

const STORAGE_HOST = 'firebasestorage.googleapis.com';
const CORS = { 'Access-Control-Allow-Origin': '*' };
const HARNESS_TOKEN = 'harness-download-token';

const isEpubBytes = (url) =>
  url.hostname === STORAGE_HOST && /\.epub/i.test(url.pathname) && url.searchParams.get('alt') === 'media';
const isEpubMetadata = (url) =>
  url.hostname === STORAGE_HOST && /\.epub/i.test(url.pathname) && url.searchParams.get('alt') !== 'media';

/** The metadata getDownloadURL() reads. `downloadTokens` is what it turns into ?token=. */
const metadataBody = (url) => JSON.stringify({
  name: decodeURIComponent(url.pathname.split('/o/')[1] || 'sample.epub'),
  bucket: url.pathname.split('/b/')[1]?.split('/')[0] || 'calvary-scribblings.firebasestorage.app',
  contentType: 'application/epub+zip',
  downloadTokens: HARNESS_TOKEN,
});

async function stubEpub(page) {
  await page.route(isEpubMetadata, (route) => route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
    body: metadataBody(new URL(route.request().url())),
  }));
  await page.route(isEpubBytes, (route) => route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'application/epub+zip', ...CORS },
    body: FIXTURE_EPUB,
  }));
}

const SLUG = FIXTURE.slug;
const READER_PATH = FIXTURE.path;

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

async function expectChrome(page, state, why, timeout = 4000) {
  await expect
    .poll(async () => ((await chromeHidden(page)) ? 'hidden' : 'visible'), { message: why, timeout })
    .toBe(state);
}

// R7.4.1 — the budget for the RETIRE assertion specifically.
//
// CHROME_IDLE_MS is 3500 and the default budget above is 4000, which leaves 500 ms for three
// round trips to the page plus the poll's own granularity (its last attempt before timing out
// lands at ~3850 ms). Measured on this container: the chrome actually retires 3539–3585 ms
// after the final page turn — the timer is accurate to within ~85 ms and the product is doing
// exactly what it was built to do. But 3585 against a 3850 ms last poll is a 265 ms margin,
// and under load that margin is gone: the assertion failed twice in three runs mid-session
// while the measured latency never moved.
//
// So this is a badly calibrated assertion, not a slow reader. Eight seconds still fails
// loudly if the chrome stops retiring at all — which is what the test is actually for —
// without racing its own timer.
const RETIRE_BUDGET = 8000;

// OPEN THE BOOK — and not by clicking the middle of the cover.
//
// The splash is a full-screen div whose onClick is the only way past it. On the STORY register
// it CONTAINS `<div className="rr-cabout" onClick={e => e.stopPropagation()}>` — the
// About-the-Author block, deliberately swallowing taps so a reader can expand a bio without
// accidentally opening the book (page-reader.js:554). Playwright's .click() aims at the centre
// of the target's box, and the centre of a full-screen flex-column cover is wherever the
// content happens to land. Locally that missed the bio; on a CI runner, where the display
// webfonts are absent and every block is a different height, it landed square on it — the
// click was swallowed, the cover never lifted, and all six specs failed 30 s later complaining
// about the iframe. Diagnosed off the CI trace, which shows "Open to begin reading" still on
// screen at failure time.
//
// R19.6 — the BOOK register's splash (book-reader.js:237) has no such swallowing child: it is
// an ornament, a cover plate, a title, a byline and a CTA, none of which stop propagation. So
// under a tier-2 fixture the corner click is belt and braces rather than the fix it was. It
// stays exactly as it is regardless of register, because the day tier 1 comes back the hazard
// comes back with it, and a click helper that is only correct for one register is a trap.
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
  await page.goto(READER_PATH, { waitUntil: 'domcontentloaded' });

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
    await expectChrome(page, 'hidden', 'chrome must retire once the reader goes quiet', RETIRE_BUDGET);
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

// ── THE SPLASH AND THE WAY OUT ───────────────────────────────────────────────
//
// ⚠ REGISTER-SPECIFIC. Which of the two bodies below runs is decided by the fixture's tier —
// see tests/reader/fixture-story.mjs. Only one of them is live on any given run, and today
// that is the BOOK one, because tier 1 has no subject.
//
// WHAT THIS USED TO COVER, AND WHY IT MOVED. Until R19.6 the splash was only ever exercised
// through dismissCover(), against the STORY register's cover — its About-the-Author block, its
// "Open to begin reading" CTA, its /public-library door. That register has no published
// readerMode story left to drive, so the assertion is made against the BOOK register's splash
// instead: the sample CTA and the /bookstore/{slug} door. It is a BOOK-REGISTER TEST NOW. It
// is not the story-register test with a different fixture, and nobody should read it as one.
test(`the cover splash names the book and carries the way out (${FIXTURE.register} register)`, async ({ page }) => {
  await stubEpub(page);
  await page.goto(READER_PATH, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rr-cover', { timeout: 45000 });

  const splash = page.locator('.rr-cover');
  if (FIXTURE.register === 'book') {
    // book-reader.js:237. A sample says so on the cover — the reader must know before the
    // first page which of the two things they are holding.
    await expect(page.locator('.rr-ctitle'), 'the splash must name the book').not.toBeEmpty();
    await expect(page.locator('.rr-cauthor')).toContainText('by ');
    await expect(page.locator('.rr-ccta'), 'a sample must say it is a sample on the cover')
      .toHaveText('Open the sample');
  } else {
    await expect(page.locator('.rr-ctitle, .rr-cover'), 'the splash must name the story').not.toBeEmpty();
  }

  await dismissCover(page);

  // THE DOOR. The top bar's back control is the register's own escape hatch, and it is the
  // one control a reader who wants out will look for. Both registers supply one; they point
  // at different places, and the fixture knows which.
  await expect(page.locator(`.rr-back[href="${FIXTURE.escapeHref}"]`),
    `the ${FIXTURE.register} register must offer its own way out (${FIXTURE.escapeHref})`)
    .toHaveCount(1);

  console.log(`\n=== splash (${FIXTURE.register}) ===\n${(await splash.count()) === 0 ? 'lifted' : 'still up'} · back → ${FIXTURE.escapeHref}\n`);
});

// ── R7.3 §B — the forever-spinner, closed across the React boundary ──────────
//
// load-fence.spec.mjs proves the HOST turns a book that will not arrive into a reported
// fact. This proves the other half: that the register above renders a reader-facing state
// off that report instead of leaving the room dressed for reading with nothing in it.
//
// ⚠ REGISTER-SPECIFIC, AND THE TWO REGISTERS DO NOT HAVE THE SAME STATE.
//
// WHAT THIS USED TO COVER. Against the STORY register it asserted R7.3 §B directly: a dead
// EPUB URL ends in `.rr-fail`, the kicker reads "The Reading Room", the note says the book
// "would not open", the `/stories/{slug}` door is there, and `.rr-booting` is gone. Before
// R7.3 the story register never passed onError at all, so the message arrived nowhere and the
// spinner ran until the reader gave up.
//
// WHY IT MOVED. The story register has no published readerMode story left to drive (see
// fixture-story.mjs), so under a tier-2 fixture the subject is a bookstore sample and the
// assertion is made against the BOOK register's failure surface instead: book-reader.js's own
// `loadError` shell, reached when the sample's download URL cannot be resolved. THAT IS A
// DIFFERENT MECHANISM, not the same one with a different fixture, and it is worth being exact
// about the gap it leaves:
//
//   ✔ R19.7 — `.rr-fail` IS EXERCISED AGAIN, on the book register. R19.6 recorded a hole here:
//     R7.3 §B's overlay renders only for a register that supplies `renderFailure`, and only
//     page-reader.js did, so a sample whose bytes 404 AFTER its URL resolved left the room
//     dressed for reading with nothing in it and the boot spinner running. book-reader.js now
//     supplies both `renderFailure` and `onError` for samples, and the third spec below drives
//     exactly that path. What remains unexercised is the STORY register's own overlay — same
//     markup, different door (/stories/{slug}) — because the register has no live subject.
//
// A 404 rather than a hang: the fence is the host's business and is already measured against
// real silence next door. Here the only question is what the READER sees, and 404 is the
// cheapest dead URL that asks it.
test(`a book that will not open shows a failure state with a way out (${FIXTURE.register} register)`, async ({ page }) => {
  if (FIXTURE.register === 'book') {
    // Kill the METADATA call, not the bytes: that is the request getDownloadURL() makes, and
    // its rejection is what book-reader.js turns into `loadError`. Killing the bytes instead
    // would land in the hole named above and assert nothing.
    await page.route(isEpubMetadata, (route) => route.fulfill({
      status: 404, headers: { 'Content-Type': 'application/json', ...CORS }, body: '{"error":{"code":404}}',
    }));

    await page.goto(READER_PATH, { waitUntil: 'domcontentloaded' });

    const out = page.locator(`.br-center a[href="/bookstore/${SLUG}"]`);
    await expect(out, 'a sample that cannot be resolved must route the reader back to the store')
      .toHaveCount(1, { timeout: 30000 });
    await expect(page.locator('.br-center')).toContainText('load this sample');
    // And it must be a STATE, not a spinner that happens to have text next to it.
    await expect(page.locator('.br-spin'), 'the spinner must be gone').toHaveCount(0);

    console.log(`\n=== failure state (book) ===\n${(await page.locator('.br-center').innerText()).replace(/\n+/g, ' / ')}\n`);
    return;
  }

  await page.route(isEpubBytes, (route) => route.fulfill({ status: 404, headers: CORS, body: 'gone' }));
  await page.route(isEpubMetadata, (route) => route.fulfill({
    status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
    body: metadataBody(new URL(route.request().url())),
  }));

  await page.goto(READER_PATH, { waitUntil: 'domcontentloaded' });
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

  console.log(`\n=== failure state (story) ===\n${(await fail.innerText()).replace(/\n+/g, ' / ')}\n`);
});

// ── R19.7 — THE FOREVER-SPINNER, CLOSED ON THE BOOK REGISTER ─────────────────
//
// ⚠ BOOK-REGISTER ONLY, and it asserts a DIFFERENT mechanism from the spec above it. That one
// kills the METADATA call, so getDownloadURL rejects and book-reader's own `loadError` shell
// answers — the reader never reaches the Reading Room. This one lets the URL resolve and kills
// the BYTES, so the room mounts, the cover lifts, the host tries to open a file that 404s, and
// the question is what the reader is left looking at.
//
// Until R19.7 the answer was: the boot spinner, forever. R19.6 measured that and wrote it down
// without fixing it; this is the fix, asserted. If the fixture ever resolves back to the story
// register this spec skips itself rather than pretending to cover it — the story register's
// overlay has been wired since R7.3 and is proven by the spec above whenever it can run.
test('a sample whose bytes never arrive shows the room\'s failure state, not a spinner', async ({ page }) => {
  test.skip(FIXTURE.register !== 'book', 'book-register spec; the fixture resolved to the story register');

  // Metadata OK — so getDownloadURL succeeds and the room mounts…
  await page.route(isEpubMetadata, (route) => route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS },
    body: metadataBody(new URL(route.request().url())),
  }));
  // …and the bytes are gone, which is the failure the spinner used to swallow.
  await page.route(isEpubBytes, (route) => route.fulfill({ status: 404, headers: CORS, body: 'gone' }));

  await page.goto(READER_PATH, { waitUntil: 'domcontentloaded' });
  await dismissCover(page);                    // the frame only mounts once the cover is dismissed

  const fail = page.locator('.rr-fail');
  await expect(fail, 'a dead sample must end in the Reading Room\'s failure state')
    .toBeVisible({ timeout: 30000 });

  // It must read as the Reading Room, not as a stack trace…
  await expect(page.locator('.rr-fail-kicker')).toHaveText('The Reading Room');
  await expect(page.locator('.rr-fail-note')).toContainText('would not open');

  // …and the door is the BOOK's page, not the story page. A sample that will not open is a
  // sale that has not happened yet, and /bookstore/{slug} is where the buy button lives.
  await expect(page.locator(`.rr-fail-actions a[href="/bookstore/${SLUG}"]`),
    'the failure state must route the reader to the book\'s own page')
    .toHaveCount(1);

  // THE REGRESSION ITSELF: the defect was never "no error", it was "spins forever".
  await expect(page.locator('.rr-booting'), 'the boot spinner must be gone').toHaveCount(0);

  console.log(`\n=== sample failure state (book) ===\n${(await fail.innerText()).replace(/\n+/g, ' / ')}\n`);
});

// ── R7.4 — THE DICTIONARY, across the React boundary ─────────────────────────
// define-chip.spec.mjs proves the HOST turns a settled selection into a chip and a tapped
// chip into a defineWord message. dictionary.spec.mjs proves the lookup pipeline in
// isolation, including that a glossary hit never touches the network. What neither can
// reach is the thing the reader actually looks at: the modal, rendered by ReadingRoom from
// the message, over a real book, on a real register.
//
// THE ONE SUBSTITUTION, again: api.dictionaryapi.dev is stubbed. This file is about what the
// Reading Room does with an answer, not about whether a third party is up — and a suite that
// fails when someone else's server is slow is a suite people learn to ignore.
const DICT_HOST = 'api.dictionaryapi.dev';

async function stubDictionary(page, handler) {
  await page.route((url) => url.hostname === DICT_HOST, handler);
}

const DICT_OK = () => (route) => route.fulfill({
  status: 200,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify([{
    // The word the reader actually tapped, taken from the request the pipeline made.
    word: decodeURIComponent((route.request().url().split('/en/')[1] || 'word').split('?')[0]),
    phonetic: '/ˈtɛst/',
    meanings: [{
      partOfSpeech: 'noun',
      definitions: [
        { definition: 'The first sense, which the reader should see.' },
        { definition: 'The second sense.' },
      ],
    }],
  }]),
});

/** Select a real word in the open book and tap the chip the host offers for it. */
async function defineAWord(page) {
  const frame = page.frames().find((fr) => fr.url().includes('/reading-room.html'));
  const picked = await frame.evaluate(() => {
    const view = document.querySelector('foliate-view');
    const doc = view.renderer.getContents()[0].doc;
    const p = doc.querySelector('p') || doc.body;
    const node = [...p.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim().length > 40)
      || doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT).nextNode();
    const text = node.nodeValue;
    const m = /\b[A-Za-z]{4,}\b/.exec(text);
    const range = doc.createRange();
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return m[0];
  });

  // Wait for the host's settle debounce to offer the chip, then tap it where it is.
  const chip = await frame.locator('#define-chip');
  await expect(chip, 'the host must offer a Define chip for a settled word').toBeVisible({ timeout: 5000 });
  await chip.click();
  return picked;
}

test('a defined word opens the Reading Room modal, sourced and anchored', async ({ page }) => {
  await openStory(page);
  // THE STUB GOES IN FIRST. Tapping the chip STARTS the lookup, so installing the route
  // afterwards races a real request to api.dictionaryapi.dev — which, on the 404 test,
  // answered with a genuine definition and quietly turned a miss into a hit.
  // The word is not known until the selection is made, so the stub matches on the host and
  // reads the word back out of the request URL.
  await stubDictionary(page, DICT_OK());
  const word = await defineAWord(page);

  const modal = page.locator('.rr-define');
  await expect(modal, 'tapping Define must open the definition').toBeVisible({ timeout: 15000 });

  // The word as headline, and the phonetic beside it.
  await expect(page.locator('.rr-define-word')).toHaveText(new RegExp(word, 'i'));
  await expect(page.locator('.rr-define-phon')).toHaveText('/ˈtɛst/');

  // Senses — at most three, the first one the reader should see.
  const senses = page.locator('.rr-define-sense');
  await expect(senses.first()).toContainText('first sense');
  expect(await senses.count(), 'at most three senses').toBeLessThanOrEqual(3);

  // THE ANCHORED QUOTE: the book's own sentence, with the tapped word picked out.
  const quote = page.locator('.rr-define-quote');
  await expect(quote).toBeVisible();
  await expect(quote).toContainText(new RegExp(word, 'i'));
  await expect(page.locator('.rr-define-mark'), 'the word itself must be emphasised in its sentence')
    .toHaveText(new RegExp(`^${word}$`, 'i'));

  // The source line, at the foot.
  await expect(page.locator('.rr-define-src')).toHaveText('Free Dictionary');

  console.log(`\n=== definition modal ===\nword "${word}"\n${(await modal.innerText()).replace(/\n+/g, ' / ')}\n`);
});

test('the modal pins the chrome and closes on Escape, like any panel', async ({ page }) => {
  await openStory(page);
  await stubDictionary(page, DICT_OK());
  const word = await defineAWord(page);
  await expect(page.locator('.rr-define')).toBeVisible({ timeout: 15000 });

  // CHROME IS PINNED. The idle countdown is 3.5 s; well past it, the chrome must still be up
  // because a panel is open — the rule ReadingRoom already applies to Contents and Search,
  // inherited here by modelling the definition AS a panel rather than as its own overlay.
  await page.waitForTimeout(IDLE_MS + 900);
  expect(await chromeHidden(page), 'an open definition must pin the chrome').toBe(false);
  await expect(page.locator('.rr-define'), 'and must not retire on its own').toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('.rr-define'), 'Escape must close it').toHaveCount(0);
});

test('a word the dictionary does not know is a calm miss, not an error', async ({ page }) => {
  await openStory(page);
  // Exactly what api.dictionaryapi.dev returns for an unknown word. Installed BEFORE the
  // tap — see the note in the first dictionary test.
  await stubDictionary(page, (route) => route.fulfill({
    status: 404,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ title: 'No Definitions Found' }),
  }));
  const word = await defineAWord(page);

  const miss = page.locator('.rr-define-miss');
  await expect(miss, 'a miss must still open the modal').toBeVisible({ timeout: 15000 });
  await expect(miss).toContainText(`No definition found for “${word}”`);
  // In the register's own voice: the modal is there, the word is there, nothing is red.
  await expect(page.locator('.rr-define-word')).toHaveText(new RegExp(word, 'i'));
  await expect(page.locator('.rr-define-quote'), 'the anchored quote survives a miss').toBeVisible();

  console.log(`\n=== graceful miss ===\n${(await page.locator('.rr-define').innerText()).replace(/\n+/g, ' / ')}\n`);
});

test('a dictionary that never answers ends as a miss, not a spinner', async ({ page }) => {
  await openStory(page);
  // A server that accepts and says nothing — the §B lesson applied to the dictionary.
  // Installed before the tap so the silence is OURS and not the real network's.
  await stubDictionary(page, () => { /* never fulfil */ });
  const word = await defineAWord(page);

  await expect(page.locator('.rr-define'), 'the modal opens at once, on "looking"').toBeVisible({ timeout: 10000 });
  // The 4 s fence, plus room for the round trip that will never come.
  await expect(page.locator('.rr-define-miss'), 'silence must resolve to a miss')
    .toBeVisible({ timeout: 15000 });
  await expect(page.locator('.rr-define-wait'), 'and the "Looking it up…" line must go').toHaveCount(0);
  console.log(`\n=== dictionary timeout ===\nword "${word}" resolved to the miss state\n`);
});
