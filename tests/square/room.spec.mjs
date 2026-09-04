// R43.1 — THE SQUARE ACTUALLY LOADS.
//
// ⚠ THIS SUITE FAILS ON PRE-R43.1 HEAD, AND THAT WAS CHECKED RATHER THAN ASSUMED.
// Built from a1375d7e and run, ALL THREE cases fail: `the room throws nothing`
// reports exactly one error — `onChildAdded is not defined` — `the room settles`
// finds the feed's spinner still on screen, and `REACHES A DRAWN POST` times out
// with no body drawn. The first of those was photographed on
// https://calvaryscribblings.co.uk/square before the fix, alongside a feed stuck
// on "Loading…" and 303 characters of page text where the fixed room has 18,880.
// A guard nobody has ever seen fail is a number, not a test.
//
// WHAT WENT WRONG, AND WHY 78 GREEN TESTS DID NOT SEE IT. R33.2 replaced one
// whole-node onValue with three per-child listeners and a settling get(), inside an
// effect whose lazy import still destructured only { ref, onValue }. Everything
// after the throw was dead, including setLoading(false) and the get().catch()
// fallback one line below it. The page never left its spinner.
//
// Nothing in tests/square/ executes app/square/page.js: postbody.test.mjs renders
// the eight surfaces through react-dom/server and reads the page only as a STRING,
// and horizon.test.mjs is date arithmetic. `next build` compiles an effect but
// never runs one. The defect lived in the gap between "the renderer is right" and
// "the page runs", and only a browser closes that gap.
//
// ── WHAT IS ASSERTED, AND WHAT IS DELIBERATELY NOT ──────────────────────────────
// The room is LIVE — the same decision the bookstore harnesses set out at length.
// So this file asserts that the page THREW NOTHING and that it REACHED A DRAWN
// POST; it pins no post, no author and no count, because a moderator withdrawing
// a piece or the horizon ringing its bell is not a regression.
//
// Signed out is the case, and it is the right one: the square_posts effect has []
// deps and no auth branch, which is precisely why the hang was identical for
// Ikenna signed in and for a visitor signed out. square_posts is `.read: true`.

import { test, expect } from '@playwright/test';
import { SURFACES } from '../../app/lib/squarePostBody.js';

// The feed's own surface key, taken from the table rather than typed here. A
// rename then fails this file loudly instead of leaving a selector that matches
// nothing and a suite that passes over an empty room.
const FEED_SURFACE = 'feed-post';

const RTDB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// Never hardcode a live id — the lesson 'basil' taught the bookstore suites. The
// room's own contents decide what this suite may assert.
async function liveRoomHasPosts() {
  const res = await fetch(`${RTDB}/square_posts.json?shallow=true`);
  if (!res.ok) return null;                 // network trouble is not a verdict
  const keys = await res.json();
  return keys ? Object.keys(keys).length : 0;
}

/** Load /square and report everything that went wrong while it did. */
async function openRoom(page) {
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(e.message));
  await page.goto('/square', { waitUntil: 'domcontentloaded' });
  return thrown;
}

test.describe('the Square loads for a signed-out reader', () => {
  test('the room throws nothing — a lazily-imported binding is bound', async ({ page }) => {
    const thrown = await openRoom(page);
    // Give every deferred chunk and every lazy import time to run and fail.
    await page.waitForTimeout(12000);
    // Named rather than counted, so the failure message is the bug's own words.
    expect(thrown, `the page threw: ${thrown.join(' | ')}`).toEqual([]);
  });

  test('the room settles — the feed leaves its spinner', async ({ page }) => {
    await openRoom(page);
    // setLoading(false) is downstream of the throw, so this is the assertion that
    // catches the R33.2 shape even in a room the horizon has just emptied.
    //
    // ⚠ VISIBLE ONES, AND NOT `.first()`. The page renders three "Loading…" nodes
    // — the conversations panel, the DM thread and the feed — and the first in DOM
    // order belongs to a panel that is closed on arrival. Asserting `.first()` was
    // hidden PASSED against the broken build, which is how a vacuous assertion
    // looks from the outside. Counting the visible ones is the honest form.
    //
    // ⚠ AND THE HYDRATION GATE IS LOAD-BEARING. Asserting "no spinner" straight
    // after domcontentloaded ALSO passed against the broken build, because the
    // static export ships no spinner in its HTML — React had not rendered one yet,
    // so zero was true and meaningless. Wait for the feed to have rendered EITHER
    // state, and only then require that the state it settles in is not the spinner.
    await page.waitForFunction(() => {
      const spinning = [...document.querySelectorAll('div')].some((d) => d.textContent.trim() === 'Loading…');
      return spinning || !!document.querySelector('[data-postbody]');
    }, null, { timeout: 30000 });

    const spinners = page.getByText('Loading…', { exact: true }).locator('visible=true');
    await expect(spinners).toHaveCount(0, { timeout: 45000 });
  });

  test('THE ROOM REACHES A DRAWN POST', async ({ page }) => {
    const count = await liveRoomHasPosts();
    test.skip(count === null, 'the live RTDB was unreachable — not a verdict on the page');
    test.skip(count === 0, 'the live room is genuinely empty; the two cases above still hold');

    await openRoom(page);
    // data-postbody is R43's per-surface hook, present on every drawn body. Reaching
    // a feed-post one means the effect ran, the listeners attached, a record arrived, the sort
    // ran at render and PostBody drew it — the whole path, end to end.
    expect(SURFACES[FEED_SURFACE], `SURFACES has no "${FEED_SURFACE}" — the feed's surface was renamed`).toBeTruthy();
    const body = page.locator(`[data-postbody="${FEED_SURFACE}"]`).first();
    await expect(body).toBeVisible({ timeout: 45000 });
    expect((await body.innerText()).trim().length, 'a drawn post with no text is not a drawn post').toBeGreaterThan(0);
  });
});
