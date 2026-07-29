// Swipe ownership and the selection guard.
import { test, expect } from '@playwright/test';
import {
  openReader, settle, msgs, clearMsgs, post, gotoPage, currentFraction, touchDrag, roomFrame, VIEWPORT,
} from './helpers.mjs';

const MID_Y = Math.round(VIEWPORT.height / 2);

test('paginated: our layer contributes NOTHING to a drag — no second turn', async ({ page }) => {
  // THE DOUBLE-TURN (recon §8.3), pinned deterministically.
  //
  // A real drag cannot be used for this assertion: foliate snaps on release VELOCITY, and
  // velocity under CDP depends on wall-clock timing the harness does not control —
  // measured, an identical profile snapped 1 page on three runs and 2 on the fourth. So
  // this dispatches the SHAPE of a drag with no movement for the paginator to act on: a
  // touch sequence with 340px of travel, followed by the compatibility click a real drag
  // produces. Both are ours to swallow, and neither may move the reader.
  //
  // Before R7.2 the touchend turned the page (|dx| > 50). Before R7.2.1 the click did,
  // because the latch was only set on handled taps and a declined drag left it cold.
  await openReader(page);
  const before = await gotoPage(page, 3);
  await clearMsgs(page);

  await roomFrame(page).evaluate(() => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const win = doc.defaultView;
    const mk = (x) => new win.Touch({ identifier: 1, target: doc.body, clientX: x, clientY: 400 });
    const start = mk(370);
    const end = mk(30);
    doc.body.dispatchEvent(new win.TouchEvent('touchstart', { bubbles: true, touches: [start], changedTouches: [start] }));
    doc.body.dispatchEvent(new win.TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [end] }));
    // The echo a real drag leaves behind.
    doc.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: 30, clientY: 400 }));
  });
  await settle(page, 700);

  const after = await currentFraction(page);
  const toggles = await msgs(page, 'toggleChrome');
  const relocates = await msgs(page, 'relocate');

  console.log(`\n=== drag-shaped touch + compat click ===\nfraction ${before} → ${after}`
    + `\nrelocates: ${relocates.length}, toggleChrome: ${toggles.length}\n`);

  expect(after, 'our layer must not turn the page on a drag').toBe(before);
  expect(toggles.length, 'a drag is not a tap — no chrome toggle').toBe(0);
});

// NOT TESTED HERE, DELIBERATELY: a real paginated drag's landing page.
//
// foliate decides it in snap() from release velocity, and under CDP-synthesised touch that
// velocity is a function of wall-clock timing this container does not control. Measured
// across repeated runs of one identical profile: 1 page, 1 page, 0 pages, 1 page — and with
// velocity removed (a still hold before release) it still alternated 1 and 0. The variation
// is entirely inside the paginator; our layer's contribution is pinned deterministically by
// the test above. Where a real drag lands on real hardware stays a glass check.

test('scrolled: one drag still advances — the swipe is ours in this flow', async ({ page }) => {
  await openReader(page, { flow: 'scrolled' });
  await settle(page, 500);
  const before = await currentFraction(page);
  await clearMsgs(page);

  await touchDrag(page, { x: 320, y: MID_Y }, { x: 80, y: MID_Y });
  await settle(page, 900);

  const after = await currentFraction(page);
  console.log(`\n=== scrolled drag ===\nfraction ${before} → ${after}\n`);

  expect(after, 'in scrolled flow our handler must still turn the page').toBeGreaterThan(before ?? 0);
});

test('selection guard: releasing a selection in the centre third does nothing', async ({ page }) => {
  await openReader(page);
  await gotoPage(page, 3);
  const before = await currentFraction(page);
  await clearMsgs(page);

  // Synthetic events, deliberately: a REAL touchstart collapses the selection before our
  // handler ever runs, so a real tap could not exercise this guard. What we reproduce is
  // the state the guard exists for — a live selection at the moment of release.
  const madeSelection = await roomFrame(page).evaluate(() => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const win = doc.defaultView;
    const p = doc.querySelector('p');
    if (!p || !p.firstChild) return false;
    const range = doc.createRange();
    range.setStart(p.firstChild, 0);
    range.setEnd(p.firstChild, Math.min(20, p.firstChild.length));
    const sel = win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (sel.isCollapsed) return false;

    const x = Math.round(win.innerWidth / 2);
    const y = Math.round(win.innerHeight / 2);
    const touch = new win.Touch({ identifier: 1, target: doc.body, clientX: x, clientY: y });
    doc.body.dispatchEvent(new win.TouchEvent('touchstart', { bubbles: true, touches: [touch], changedTouches: [touch] }));
    doc.body.dispatchEvent(new win.TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch] }));
    doc.body.dispatchEvent(new win.MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    return true;
  });
  expect(madeSelection, 'the test must have made a live selection').toBe(true);
  await settle(page, 400);

  const toggles = await msgs(page, 'toggleChrome');
  const after = await currentFraction(page);

  expect(toggles.length, 'a selection release must not toggle chrome').toBe(0);
  expect(after, 'a selection release must not turn the page').toBe(before);
});

test('the host reports pageSpan once the reader has moved forward', async ({ page }) => {
  // The ribbon epsilon is derived from this; if it never arrives the tab can never light.
  await openReader(page);
  await gotoPage(page, 4);
  const relocates = await msgs(page, 'relocate');
  const withSpan = relocates.filter((r) => typeof r.pageSpan === 'number' && r.pageSpan > 0);
  console.log(`\n=== pageSpan ===\nrelocates: ${relocates.length}, carrying a positive pageSpan: ${withSpan.length}`
    + `\nlast pageSpan: ${relocates.length ? relocates[relocates.length - 1].pageSpan : 'n/a'}\n`);
  expect(withSpan.length, 'pageSpan must be reported after forward movement').toBeGreaterThan(0);
});
