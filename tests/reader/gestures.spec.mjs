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

// ── R7.2.3: THE OWNERSHIP MATRIX ─────────────────────────────────────────────
// One gesture, one owner, at every distance. The two failure shapes this pins:
//   • two owners  → a single gesture moves TWO pages (our turn plus the paginator's)
//   • wrong owner → a gesture moves OPPOSITE to itself (the click echo of a forward drag
//                   landing in the back third, which is what R7.2.1 measured at −1 page)
//
// Every gesture below is arranged so the tap zone it releases in and the direction it
// travels AGREE, which makes one rule cover the whole table: a gesture may move zero or
// one page, and never against itself.
//
// Velocity is held near zero (touchDrag's hold before release), so the paginator's
// contribution is decided by displacement alone and the table is reproducible.
// Each row is (distance, gesture speed). The FLICK rows are the ones a slow-drag table
// cannot see: a few pixels of travel carrying enough velocity for foliate to snap a page.
// If our tap zones also fired there, one flick would move two pages.
const GESTURES = [
  { dx: 6, fast: false }, { dx: 10, fast: false }, { dx: 20, fast: false },
  { dx: 40, fast: false }, { dx: 80, fast: false }, { dx: 340, fast: false },
  { dx: 6, fast: true }, { dx: 10, fast: true }, { dx: 40, fast: true }, { dx: 120, fast: true },
];

test('ownership matrix: no distance has two owners, none moves against itself', async ({ page }) => {
  await openReader(page);

  // Calibrate one page from the reader itself.
  const base = await gotoPage(page, 4);
  await post(page, { type: 'next' });
  await settle(page, 400);
  const oneStep = (await currentFraction(page)) - base;
  expect(oneStep, 'calibration turn must move forward').toBeGreaterThan(0);

  const rows = [];
  const failures = [];

  for (const g of GESTURES) {
    const { dx, fast } = g;
    for (const dir of ['forward', 'backward']) {
      // Forward gestures travel leftward and release in the right/forward third;
      // backward gestures travel rightward and release in the left/back third.
      const from = dir === 'forward' ? 350 : 50;
      const to = dir === 'forward' ? from - dx : from + dx;

      await post(page, { type: 'goToFraction', fraction: base });
      await settle(page, 500);
      const before = await currentFraction(page);
      await clearMsgs(page);

      // fast = no hold before release, two steps: maximum velocity the pipe allows.
      if (fast) await touchDrag(page, { x: from, y: MID_Y }, { x: to, y: MID_Y }, 2, 0, 0);
      else await touchDrag(page, { x: from, y: MID_Y }, { x: to, y: MID_Y });
      await settle(page, 900);

      const after = await currentFraction(page);
      const moved = Math.round((after - before) / oneStep);
      const toggles = (await msgs(page, 'toggleChrome')).length;
      const speed = fast ? 'flick' : 'slow';
      rows.push({ dx, dir, speed, from, to, moved, toggles });

      const tag = `dx=${dx} ${speed} ${dir}`;
      if (Math.abs(moved) > 1) failures.push(`${tag}: moved ${moved} pages — two owners`);
      if (dir === 'forward' && moved < 0) failures.push(`${tag}: moved ${moved} — against itself`);
      if (dir === 'backward' && moved > 0) failures.push(`${tag}: moved ${moved} — against itself`);
    }
  }

  console.log('\n=== OWNERSHIP MATRIX (calibrated page step '
    + oneStep.toFixed(5) + ') ===');
  console.log('  dx   speed  direction   from→to     pages moved   chrome toggles');
  for (const r of rows) {
    console.log(`  ${String(r.dx).padStart(3)}  ${r.speed.padEnd(5)}  ${r.dir.padEnd(9)}  ${String(r.from).padStart(3)}→${String(r.to).padStart(3)}`
      + `      ${String(r.moved).padStart(3)}             ${r.toggles}`);
  }
  console.log('');

  expect(failures, failures.join(' | ')).toEqual([]);
});

// ── R11.21 — THE GLIDE, AND THE SECOND TAP THAT LANDS INSIDE IT ──────────────
//
// `animated` on the renderer buys a 300ms easeOutQuad instead of one scrollLeft assignment
// (paginator.js:901), which is what removed the page-turn flash. It also puts the reader in a
// state that could not exist before: the columns are MOVING while no finger is down.
//
// Two rules in reading-room.html were written when only a finger could move them, and the
// defect this pins was measured, not predicted — two taps 40/60/80ms apart slid half a page
// forward and rubber-banded back to the page they started on:
//
//   • the Band B scroll test read our own glide as "the paginator already acted", and
//     disowned a tap the paginator had never seen;
//   • foliate snaps on EVERY touchend in paginated flow (paginator.js:853). On a settled page
//     that is a no-op — it targets the page already on screen and #scrollTo returns at the
//     equality check. Mid-glide it reads the INTERPOLATED position, which in the first half of
//     the glide rounds to the page behind, so it animated back to where the turn started.
//
// The sweep runs across the whole glide because the defect only appeared in its first half:
// a fixed gap would have passed against the broken build.
test('two fast taps: the second never fights the first, anywhere in the glide', async ({ page }) => {
  await openReader(page);
  await settle(page);

  const still = () => roomFrame(page).evaluate(() => {
    const r = document.querySelector('foliate-view').renderer;
    return { start: Math.round(r.start), page: r.page, pages: r.pages, size: r.size };
  });

  const failures = [];
  for (const gap of [20, 40, 60, 80, 100, 140, 200, 260]) {
    // Back to a page with runway, by SEEK — never animated, so each trial starts identical.
    await post(page, { type: 'goToFraction', fraction: 0 });
    await settle(page, 500);
    const before = await still();

    // Sample the paginator's own scroll offset every frame, so the motion is observed rather
    // than inferred from where it ended up.
    await roomFrame(page).evaluate(() => {
      const r = document.querySelector('foliate-view').renderer;
      window.__trace = [];
      const t0 = performance.now();
      window.__tracing = true;
      const tick = () => {
        if (!window.__tracing) return;
        window.__trace.push(Math.round(r.start));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.touchscreen.tap(340, MID_Y);
    await page.waitForTimeout(gap);
    await page.touchscreen.tap(340, MID_Y);
    await settle(page, 1200);

    const trace = await roomFrame(page).evaluate(() => { window.__tracing = false; return window.__trace; });
    const after = await still();
    const peak = Math.max(before.start, ...trace);
    const moved = (after.start - before.start) / before.size;
    const rem = after.start % before.size;
    const offBoundary = Math.min(rem, before.size - rem);

    console.log(`gap ${String(gap).padStart(3)}ms: ${before.start} → ${after.start} (${moved} page), peak ${peak}, off-boundary ${offBoundary}`);

    // It must never come to rest behind the peak it reached — that IS the fight, whether it
    // shows as a full revert or as a partial rubber-band.
    if (peak - after.start > 1) failures.push(`gap ${gap}ms: slid to ${peak} then fell back to ${after.start}`);
    // And it must rest ON a page, not part-way across two.
    if (offBoundary > 1) failures.push(`gap ${gap}ms: rests ${offBoundary}px off a page boundary`);
    // Forward, always: the two taps are worth one page while the lock is held, never zero.
    if (moved < 1) failures.push(`gap ${gap}ms: moved ${moved} pages`);
  }

  expect(failures, failures.join(' | ')).toEqual([]);
});

// A seek is not a turn. The glide is reached only through `smooth` (set by #scrollPrev and
// #scrollNext alone) and through reason==='snap'; goTo travels #display → scrollToAnchor,
// which carries 'anchor'/'navigation'/'selection' and passes no `smooth`. Asserted rather
// than assumed, because a resume that animated would show the reader a page they never
// turned to.
test('seeks do not glide: goToFraction and goTo(cfi) land in one step', async ({ page }) => {
  await openReader(page);
  await settle(page);

  const steps = async (fn) => {
    await roomFrame(page).evaluate(() => {
      const r = document.querySelector('foliate-view').renderer;
      window.__trace = [];
      window.__tracing = true;
      const tick = () => { if (!window.__tracing) return; window.__trace.push(Math.round(r.start)); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await fn();
    await settle(page, 1200);
    const trace = await roomFrame(page).evaluate(() => { window.__tracing = false; return window.__trace; });
    return trace.filter((v, i) => i && v !== trace[i - 1]).length;
  };

  await post(page, { type: 'requestBookmark' });
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'bookmarkCFI'));
  const [bm] = await msgs(page, 'bookmarkCFI');

  // A glide is ~18 changed frames across 300ms. A seek is one assignment; two allows for the
  // relocate that follows re-measuring the same offset.
  const frac = await steps(() => post(page, { type: 'goToFraction', fraction: 0.6 }));
  expect(frac, `goToFraction moved through ${frac} positions — a seek must not animate`).toBeLessThanOrEqual(2);

  const cfi = await steps(() => post(page, { type: 'goTo', cfi: bm.cfi }));
  expect(cfi, `goTo(cfi) moved through ${cfi} positions — a resume must not animate`).toBeLessThanOrEqual(2);
});
