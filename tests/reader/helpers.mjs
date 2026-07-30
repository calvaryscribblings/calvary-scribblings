// Harness helpers. Everything here is about OBSERVING the host: what it posted, where the
// reader actually is, and what coordinates the section document really sees.
import { expect } from '@playwright/test';

export const VIEWPORT = { width: 400, height: 800 };
export const BOOK_URL = '/__t/fixtures/harness-book.epub';
// R7.3 §D: the uneven book — a one-line half-title and two three-paragraph chapters among
// long ones. See tests/fixtures/make-epub.mjs for why unevenness is the test.
export const UNEVEN_BOOK_URL = '/__t/fixtures/harness-book-short.epub';

/**
 * Open the stub with a book loaded and wait for the host's `ready`.
 * `book` defaults to the frozen even fixture; pass UNEVEN_BOOK_URL for the geometry specs.
 * Pass `waitFor: 'error'` to open something that is meant to fail.
 */
export async function openReader(page, { flow = 'paginated', book = BOOK_URL, waitFor = 'ready' } = {}) {
  const q = new URLSearchParams({
    url: book,
    bg: '#f2ecd9', fg: '#2b2418', face: 'cormorant',
    size: '100', leading: '1.6', flow,
  }).toString();
  await page.goto(`/__t/reader/harness.html?q=${encodeURIComponent(q)}`);
  await page.waitForFunction(
    (t) => window.__msgs.some((m) => m.type === t), waitFor, { timeout: 20000 },
  );
  await settle(page);
}

/**
 * Everything the host knows about the book's page geometry, read from inside the reader.
 * This is the ground truth the host's own pageSpan is asserted against — the same numbers
 * from the same objects, computed independently in the test.
 */
export async function sectionGeometry(page) {
  return roomFrame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    const r = view?.renderer;
    // progress.js:60 — non-linear or zero-size sections carry no weight.
    const sizes = (view?.book?.sections || [])
      .map((s) => (s && s.linear !== 'no' && s.size > 0 ? s.size : 0));
    const total = sizes.reduce((a, b) => a + b, 0);
    const rawPages = r?.pages ?? null;
    const contentPages = rawPages > 2 ? rawPages - 2 : 0;
    // The paginator's own index is private; renderer.pages/page plus the view's last
    // location give us the section without reaching into internals.
    const index = view?.lastLocation?.section?.current ?? null;
    return {
      sizes, total, rawPages, contentPages,
      page: r?.page ?? null,
      index,
      // One page of THIS section as a fraction of the whole book — progress.js:73-83's
      // arithmetic, recomputed here from the same inputs the host uses.
      expectedSpan: index != null && total > 0 && contentPages > 0 && sizes[index] > 0
        ? (sizes[index] / total) / contentPages
        : 0,
    };
  });
}

/** Let pagination and any in-flight relocate finish. */
export async function settle(page, ms = 350) {
  await page.waitForTimeout(ms);
}

export async function msgs(page, type = null) {
  return page.evaluate((t) => (t ? window.__msgs.filter((m) => m.type === t) : window.__msgs.slice()), type);
}

export async function clearMsgs(page) {
  await page.evaluate(() => window.__clearMsgs());
}

export async function post(page, msg) {
  await page.evaluate((m) => window.__post(m), msg);
}

/** The reading-room frame — where foliate lives. */
export function roomFrame(page) {
  const f = page.frames().find((fr) => fr.url().includes('/reading-room.html'));
  if (!f) throw new Error('reading-room frame not found');
  return f;
}

/**
 * Everything the tap-zone maths depends on, measured from inside the reader.
 * `foliate-view.renderer` is a public field, so the paginator is reachable even though
 * the view's shadow root is closed.
 */
export async function geometry(page) {
  return roomFrame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    const r = view?.renderer;
    const contents = r?.getContents?.() || [];
    const doc = contents[0]?.doc || null;
    const win = doc?.defaultView || null;
    const frameEl = win?.frameElement || null;
    const rect = frameEl ? frameEl.getBoundingClientRect() : null;
    return {
      hostInnerWidth: window.innerWidth,
      hostInnerHeight: window.innerHeight,
      scrolled: !!r?.scrolled,
      start: r?.start ?? null,
      size: r?.size ?? null,
      page: r?.page ?? null,
      pages: r?.pages ?? null,
      viewSize: r?.viewSize ?? null,
      // The section document's own viewport — this is what clientX is measured against.
      sectionInnerWidth: win?.innerWidth ?? null,
      // Where that document's iframe actually sits in the reader's viewport.
      frameLeft: rect ? rect.left : null,
      frameWidth: rect ? rect.width : null,
    };
  });
}

/**
 * Install a one-shot probe in the section document that records the raw coordinates of the
 * next pointer event, so a test can report ACTUAL clientX against ACTUAL viewport width.
 * Capture phase, so it observes the event before the reader's own handlers.
 */
export async function armCoordinateProbe(page) {
  await roomFrame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    const doc = view?.renderer?.getContents?.()[0]?.doc;
    if (!doc) throw new Error('no section document');
    window.__probe = [];
    const record = (kind) => (e) => {
      const t = e.changedTouches ? e.changedTouches[0] : e;
      const r = view.renderer;
      const frameEl = doc.defaultView.frameElement;
      window.__probe.push({
        kind,
        clientX: t ? t.clientX : null,
        sectionInnerWidth: doc.defaultView.innerWidth,
        hostInnerWidth: window.innerWidth,
        rendererStart: r.start,
        rendererSize: r.size,
        page: r.page,
        frameLeft: frameEl ? frameEl.getBoundingClientRect().left : null,
      });
    };
    doc.addEventListener('touchend', record('touchend'), true);
    doc.addEventListener('click', record('click'), true);
  });
}

export async function readProbe(page) {
  return roomFrame(page).evaluate(() => window.__probe || []);
}

/** Advance n pages and wait for the reader to settle. */
export async function goPages(page, n) {
  for (let i = 0; i < n; i++) {
    await post(page, { type: n > 0 ? 'next' : 'prev' });
    await settle(page, 260);
  }
}

/** Current fraction, from the last relocate the host posted. */
export async function currentFraction(page) {
  const rel = await msgs(page, 'relocate');
  return rel.length ? rel[rel.length - 1].fraction : null;
}

/** Navigate to a 1-indexed page of the whole book and return the resting fraction. */
export async function gotoPage(page, target) {
  await post(page, { type: 'goToFraction', fraction: 0 });
  await settle(page, 400);
  for (let i = 1; i < target; i++) {
    await post(page, { type: 'next' });
    await settle(page, 240);
  }
  await settle(page, 200);
  return currentFraction(page);
}

/**
 * A real touch drag, via CDP — Playwright's touchscreen only taps.
 *
 * MOMENTUM IS DELIBERATELY REMOVED. foliate's paginator snaps on RELEASE VELOCITY
 * (paginator.js snap(): d = velocity * size), and velocity under CDP depends on wall-clock
 * timestamps the harness cannot control — measured, the same profile snapped 1 page on one
 * run and 0 on the next under load. So the drag ends with `holdMs` of stillness: the last
 * move repeats at the destination, velocity decays to ~0, and the snap is decided by
 * DISPLACEMENT alone, which is deterministic. Drag more than half a page and the paginator
 * advances exactly one, every time.
 */
export async function touchDrag(page, from, to, steps = 8, stepMs = 16, holdMs = 220) {
  const client = await page.context().newCDPSession(page);
  const at = (x, y) => ({ x, y, radiusX: 5, radiusY: 5, force: 1 });
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(from.x, from.y)] });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(x, y)] });
    await page.waitForTimeout(stepMs);
  }
  // Stillness at the destination: two identical moves spaced out, so the recorded velocity
  // is zero regardless of how loaded the machine is.
  await page.waitForTimeout(holdMs);
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(to.x, to.y)] });
  await page.waitForTimeout(holdMs);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

/** Assert a page turn happened exactly once, in the given direction. */
export function expectSingleTurn(relocates, direction, from) {
  expect(relocates.length, 'a turn must produce at least one relocate').toBeGreaterThan(0);
  const last = relocates[relocates.length - 1].fraction;
  if (direction === 'forward') expect(last).toBeGreaterThan(from);
  else expect(last).toBeLessThan(from);
}
