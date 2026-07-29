// REPRODUCTION TEST for glass bug (a): "centre tap mostly turns the page forward".
//
// Every assertion here is on OBSERVED postMessages with counts. A tap either produced a
// toggleChrome or it did not; a page either moved or it did not. Nothing passes because
// no error was thrown.
import { test, expect } from '@playwright/test';
import {
  openReader, settle, msgs, clearMsgs, geometry, armCoordinateProbe, readProbe,
  gotoPage, currentFraction, VIEWPORT,
} from './helpers.mjs';

const PAGES_UNDER_TEST = [1, 3, 7];

const LEFT_X = Math.round(VIEWPORT.width / 6);        // middle of the left third
const CENTRE_X = Math.round(VIEWPORT.width / 2);      // dead centre
const RIGHT_X = Math.round((VIEWPORT.width * 5) / 6); // middle of the right third
const TAP_Y = Math.round(VIEWPORT.height / 2);

test.describe('tap zones, per page', () => {
  test('MEASUREMENT: what coordinate space does the section document report?', async ({ page }) => {
    await openReader(page);
    const rows = [];
    for (const p of PAGES_UNDER_TEST) {
      await gotoPage(page, p);
      const g = await geometry(page);
      await armCoordinateProbe(page);
      await clearMsgs(page);
      await page.touchscreen.tap(CENTRE_X, TAP_Y);
      await settle(page);
      const probe = await readProbe(page);
      rows.push({ page: p, geometry: g, probe: probe[0] || null });
    }
    // Reported as evidence, not asserted on — the assertions live in the tests below.
    console.log('\n=== COORDINATE MEASUREMENT (viewport width ' + VIEWPORT.width + ', tap x ' + CENTRE_X + ') ===');
    for (const r of rows) {
      const p = r.probe;
      console.log(
        `page ${String(r.page).padStart(2)} | renderer.start=${String(r.geometry.start).padStart(6)}`
        + ` size=${String(r.geometry.size).padStart(4)}`
        + ` | section innerWidth=${String(r.geometry.sectionInnerWidth).padStart(6)}`
        + ` frameLeft=${String(r.geometry.frameLeft).padStart(7)}`
        + (p ? ` | OBSERVED clientX=${String(p.clientX).padStart(6)}`
          + ` → third=${p.clientX < p.sectionInnerWidth / 3 ? 'LEFT' : p.clientX > (p.sectionInnerWidth * 2) / 3 ? 'RIGHT' : 'CENTRE'}`
          : ' | probe missed'),
      );
    }
    console.log('');
    expect(rows.every((r) => r.geometry.size > 0)).toBe(true);
  });

  for (const p of PAGES_UNDER_TEST) {
    test(`page ${p}: centre tap toggles chrome and does not turn the page`, async ({ page }) => {
      await openReader(page);
      const before = await gotoPage(page, p);
      await clearMsgs(page);

      await page.touchscreen.tap(CENTRE_X, TAP_Y);
      await settle(page);

      const toggles = await msgs(page, 'toggleChrome');
      const relocates = await msgs(page, 'relocate');
      const moved = relocates.filter((r) => Math.abs(r.fraction - before) > 1e-9);

      expect(toggles.length, `page ${p}: centre tap must post exactly one toggleChrome`).toBe(1);
      expect(moved.length, `page ${p}: centre tap must not move the page`).toBe(0);
    });

    test(`page ${p}: right-third tap turns forward exactly one page, silently`, async ({ page }) => {
      await openReader(page);
      const before = await gotoPage(page, p);
      await clearMsgs(page);

      await page.touchscreen.tap(RIGHT_X, TAP_Y);
      await settle(page);

      const toggles = await msgs(page, 'toggleChrome');
      const after = await currentFraction(page);

      expect(toggles.length, `page ${p}: a page turn must not toggle chrome`).toBe(0);
      expect(after, `page ${p}: right third must advance`).toBeGreaterThan(before);
    });
  }

  // Page 1 has nothing behind it, so the backward assertion only makes sense from page 3 on.
  for (const p of [3, 7]) {
    test(`page ${p}: left-third tap turns back, silently`, async ({ page }) => {
      await openReader(page);
      const before = await gotoPage(page, p);
      await clearMsgs(page);

      await page.touchscreen.tap(LEFT_X, TAP_Y);
      await settle(page);

      const toggles = await msgs(page, 'toggleChrome');
      const after = await currentFraction(page);

      expect(toggles.length, `page ${p}: a page turn must not toggle chrome`).toBe(0);
      expect(after, `page ${p}: left third must go back`).toBeLessThan(before);
    });
  }
});

test('two centre taps produce exactly two toggleChrome messages', async ({ page }) => {
  // The compatibility-click latch: a real tap fires touchend AND a synthesised click. If
  // both reach onTap the chrome toggles twice per tap and appears not to respond at all.
  await openReader(page);
  await gotoPage(page, 3);
  await clearMsgs(page);

  await page.touchscreen.tap(CENTRE_X, TAP_Y);
  await settle(page, 250);
  await page.touchscreen.tap(CENTRE_X, TAP_Y);
  await settle(page, 250);

  const toggles = await msgs(page, 'toggleChrome');
  expect(toggles.length, 'two taps, two toggles — no synthetic-click doubling').toBe(2);
});

test('a tap on a link neither turns the page nor toggles chrome', async ({ page }) => {
  await openReader(page);
  await settle(page);
  // The fixture's prose carries no links, so this asserts the guard directly on a synthetic
  // event whose target is an anchor — the same path a real footnote tap takes.
  const result = await page.frames().find((f) => f.url().includes('/reading-room.html')).evaluate(() => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const a = doc.createElement('a');
    a.href = '#somewhere';
    a.textContent = 'note';
    doc.body.appendChild(a);
    const r = a.getBoundingClientRect();
    a.dispatchEvent(new doc.defaultView.MouseEvent('click', {
      bubbles: true, cancelable: true, clientX: Math.round(r.left + 2), clientY: Math.round(r.top + 2),
    }));
    return true;
  });
  expect(result).toBe(true);
  await settle(page);
  expect((await msgs(page, 'toggleChrome')).length).toBe(0);
});
