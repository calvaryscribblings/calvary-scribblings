// ═══════════════════════════════════════════════════════════════════════════════════════════
// R29 — A BLURRED STAND-IN ON EVERY BOARD, AND IT IS A FLOOR
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npm run test:cover-standin
//
// Ikenna's ruling, 27 August 2026, on R28's measurements: a board must never show an empty
// plate while its cover is in flight. R28 measured the storefront cold, per cover, from
// entering the viewport to painting — 61ms and 664ms on 4G, 1,882ms and 5,647ms on Fast 3G,
// 7,818ms and 23,732ms on Slow 3G — with the board drawing spine, sheen, fore-edge and shadow
// around a flat rgb(14,10,22) plate holding nothing.
//
// ── WHAT IS BEING HELD, AND WHY EACH CASE EXISTS ───────────────────────────────────────────
//
//   THE PLATE IS FILLED. Every board whose title has a cover carries an inline stand-in.
//   IT IS A FLOOR. The stand-in is never what the board is showing once the cover has pixels —
//     not for one frame. This is the defect the app hit — it had to make the cached rung
//     outrank the blurhash — and the reason it cannot happen here is structural: the stand-in
//     is the face's BACKGROUND and the cover is an <img> on top of it, so paint order does the
//     ranking and there is no state to get wrong. See the long note at THE FLOOR below for the
//     one frame a warm cache DOES still spend on the stand-in, why it is not this defect, and
//     why pretending otherwise would have bought a flaky suite instead of a true one.
//   NOTHING ANIMATES. The handover is the image arriving over the background.
//   NOTHING WAS ADDED. No element, no canvas — the background sits on a face that already
//     existed, which is what keeps the composited layer count where R27 left it.
//
// ── WHAT THIS SUITE REFUSES TO BE ──────────────────────────────────────────────────────────
//
// Ten tests in this project have now been found that could not fail. Every case below drives
// the real built page in a real browser, and each has a twin that injects the DEFECT — the
// background removed, the image held transparent (the app's own failure mode), a placeholder
// painted over the cover, a transition on the handover, a canvas in the face — and requires
// the assertion to invert.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_COVER_LQIP_BYTES, COVER_LQIP_WIDTH } from '../../app/lib/bookstore/covers.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
const GATE_STORAGE_KEY = (() => {
  const m = /^export const GATE_STORAGE_KEY = '([^']*)';/m.exec(GATE_SRC);
  if (!m) throw new Error('app/lib/bookstore/gate.js no longer exports GATE_STORAGE_KEY as a single-quoted string.');
  return m[1];
})();
// A cold detail page cannot visit the shelf first, so the slug comes from the build's own
// output — the same list generateStaticParams emitted, which cannot name a title the shop is
// not showing. See live-slug.mjs for why a slug is never typed into a test file here.
const SLUGS = readdirSync(join(ROOT, 'out/bookstore'))
  .filter((f) => f.endsWith('.html') && !f.startsWith('__'))
  .map((f) => f.replace('.html', ''));

const IS_STAND_IN = 'url("data:image/';

// ── THE TWINS ──────────────────────────────────────────────────────────────────────────────
// The stand-in taken away.
const NO_STAND_IN = '.bb-front{background-image:none!important}';
// ⭑ THE APP'S OWN DEFECT, injected: the cover held transparent until something decides it may
// show. That is precisely what puts a placeholder IN FRONT of a cached cover, and it is what
// the floor case has to be able to catch.
const HOLD_THE_COVER_BACK = '.bb-front img{opacity:0!important}';
// A handover that fades instead of simply happening.
const FADE_THE_HANDOVER = '.bb-front img{transition:opacity 600ms ease!important}';

/** Every board on the page, and what its face is carrying. */
const READ_BOARDS = (scope) => {
  const fronts = [...document.querySelectorAll(`${scope} .bb-front`)];
  return fronts.map((f) => {
    const img = f.querySelector('img');
    const cs = getComputedStyle(f);
    const ics = img ? getComputedStyle(img) : null;
    const fb = f.getBoundingClientRect();
    const ib = img ? img.getBoundingClientRect() : null;
    return {
      standIn: cs.backgroundImage,
      hasImg: !!img,
      painted: !!(img && img.complete && img.naturalWidth > 0),
      // The face's own element children — the stand-in must not have added one.
      children: [...f.children].map((c) => (c.className || c.tagName).toString()),
      canvases: f.querySelectorAll('canvas').length,
      imgAnimation: ics ? ics.animationName : null,
      imgTransition: ics ? `${ics.transitionProperty}|${ics.transitionDuration}|${ics.transitionDelay}` : null,
      faceAnimation: cs.animationName,
      // The stand-in must occupy exactly the cover's box: same element, so same box by
      // construction — recorded so a future background-position/size change cannot slip past.
      faceBox: [+fb.width.toFixed(1), +fb.height.toFixed(1)],
      imgBox: ib ? [+ib.width.toFixed(1), +ib.height.toFixed(1)] : null,
      bgSize: cs.backgroundSize,
      bgPosition: cs.backgroundPosition,
    };
  });
};

async function open(page, { url, scope, holdCoversMs = 0, inject, wait }) {
  await page.addInitScript((k) => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
  if (holdCoversMs) {
    // The cover genuinely in flight — delayed, not aborted, so the <img> is PENDING rather
    // than broken and what is measured is the window this round exists for.
    await page.route('**/bookstore_covers*', async (route) => {
      await new Promise((r) => setTimeout(r, holdCoversMs));
      await route.continue();
    });
  }
  if (inject) {
    await page.addInitScript((css) => {
      const s = document.createElement('style');
      s.textContent = css;
      const put = () => (document.head || document.documentElement).appendChild(s);
      if (document.head) put(); else document.addEventListener('readystatechange', put, { once: true });
    }, inject);
  }
  await page.goto(url);
  await expect(page.locator(`${scope} .bb-front`).first()).toBeAttached({ timeout: 60000 });
  if (wait) await wait(page);
  await page.waitForTimeout(600);
  return page.evaluate(READ_BOARDS, scope);
}

const SURFACES = [
  { name: 'the storefront shelf', url: '/bookstore', scope: '#fiction .shelf-entry',
    wait: async (page) => { await page.locator('#fiction .shelf').first().scrollIntoViewIfNeeded(); } },
  { name: 'the detail page', url: `/bookstore/${SLUGS[0]}`, scope: '.bd-cover-wrap' },
];

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

for (const s of SURFACES) {
  test.describe(s.name, () => {
    test('THE PLATE IS FILLED — every board carries an inline stand-in while its cover is in flight', async ({ page }) => {
      // ⭑ THE CENTRAL CASE. Before R29 this read `none` on every board and the plate was the
      // flat rgb(14,10,22) Ikenna photographed.
      const boards = await open(page, { ...s, holdCoversMs: 4000 });
      expect(boards.length, 'no boards were drawn at all').toBeGreaterThan(0);
      const bare = boards.filter((b) => b.hasImg && !b.standIn.startsWith(IS_STAND_IN));
      expect(bare, `${bare.length} of ${boards.length} boards drew an empty plate: ${JSON.stringify(bare.slice(0, 2))}`).toEqual([]);
      // …and it is the cover's own box, at the cover's own size, not a tile or a stretch.
      for (const b of boards) {
        expect(b.bgSize, 'the stand-in must fill the plate exactly as the cover does').toBe('cover');
        expect(b.faceBox, 'the stand-in and the cover must occupy the same box').toEqual(b.imgBox);
      }
    });

    test('PROOF — take the stand-in away and the plate is bare again', async ({ page }) => {
      const boards = await open(page, { ...s, holdCoversMs: 4000, inject: NO_STAND_IN });
      const withStandIn = boards.filter((b) => b.standIn.startsWith(IS_STAND_IN));
      expect(withStandIn, 'with the background removed no board may still report a stand-in').toEqual([]);
    });

    test('NOTHING WAS ADDED — no element, no canvas, on the face the cover already had', async ({ page }) => {
      // What keeps the composited layer count where R27 left it: the stand-in is a background
      // on an element that already existed. payload.spec.mjs holds the 260 ceiling; this holds
      // the reason it did not move.
      const boards = await open(page, { ...s, holdCoversMs: 2000 });
      for (const b of boards) {
        expect(b.canvases, 'a canvas has appeared inside the board — see why the blurhash was not chosen, in covers.js').toBe(0);
        expect(b.children.filter((c) => !/^(IMG|bb-spine|bb-sheen)$/.test(c)),
          `the face has grown a child: ${JSON.stringify(b.children)}`).toEqual([]);
      }
    });

    test('NOTHING ANIMATES — the handover is the image arriving, and that is all', async ({ page }) => {
      const boards = await open(page, { ...s, holdCoversMs: 1500 });
      for (const b of boards) {
        expect(b.faceAnimation, 'the face carries an animation').toBe('none');
        expect(b.imgAnimation, 'the cover carries an animation').toBe('none');
        const [, dur, delay] = b.imgTransition.split('|');
        expect(dur.split(',').map(parseFloat).filter((d) => d > 0),
          `the cover transitions on the handover: ${b.imgTransition}`).toEqual([]);
        expect(delay.split(',').map(parseFloat).filter((d) => d > 0),
          `the cover is delayed on the handover: ${b.imgTransition}`).toEqual([]);
      }
    });

    test('PROOF — fade the handover and the no-animation case goes red', async ({ page }) => {
      const boards = await open(page, { ...s, holdCoversMs: 1500, inject: FADE_THE_HANDOVER });
      expect(boards.length).toBeGreaterThan(0);
      const faded = boards.filter((b) => b.imgTransition.split('|')[1].split(',').some((d) => parseFloat(d) > 0));
      expect(faded.length, 'with a transition injected the recorder must see it').toBe(boards.length);
    });
  });
}


// ═══════════════════════════════════════════════════════════════════════════════════════════
// ⭑ THE FLOOR. The one property this round could most easily get wrong.
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// ── WHAT WAS MEASURED, AND WHY THIS IS TWO CASES AND NOT ONE ───────────────────────────────
//
// The first draft of this suite asserted a single thing: that on a warm cache NO frame ever
// shows the stand-in. It failed 1 run in 3, and the failing frames were all the same frame —
// the FIRST one on which the board exists, with the <img> attached but reporting
// complete:false, naturalWidth:0, currentSrc:''. Measured over six warm runs: 0, 1, 1, 1, 2, 0
// such frames, always at the head of the run, always resolved by the next tick (~40ms).
//
// THAT IS NOT THE DEFECT THIS ROUND IS GUARDING AGAINST, and asserting it away would have
// meant either a flaky suite or a loosened one. An <img> whose bytes are in the HTTP cache is
// still resolved ASYNCHRONOUSLY — the element is created, and the cache read lands a tick
// later. No markup can close that gap, and before R29 that same frame drew the flat
// rgb(14,10,22) plate instead. The stand-in did not take anything from the cached cover there;
// it filled a frame that was empty before.
//
// The defect the app actually hit is a DIFFERENT statement, and it is the one worth pinning:
// a placeholder that is still what the viewer sees WHEN THE COVER ALREADY HAS PIXELS. That is
// what an `onLoad`-gated overlay does, and it is why the app had to make its cached rung
// outrank its blurhash. So:
//
//   CASE A — NEVER IN FRONT OF A COVER THAT HAS PIXELS. On any frame where the <img> has
//     decoded pixels, the thing painted at the middle of the board must BE that <img>, at
//     full opacity. Judged by document.elementFromPoint, so an overlay, a wrapper or a held
//     back image is caught by what a viewer would actually be looking at — not by reading
//     back the style we ourselves set. Two twins invert it: the app's own failure mode (the
//     cover held transparent) and a placeholder painted over the top.
//
//   CASE B — A WARM CACHE CLOSES THE WINDOW AT ONCE. The stand-in may only be visible in the
//     frames before the cover has any pixels at all, and warm that is a handful of frames.
//     Held back, it is every frame of the run. The twin is the same page with the cover in
//     flight, and the two numbers are ~1 against ~75 — this is not a threshold balanced on a
//     knife edge.
//
// Only boards ON SCREEN are judged by what is painted at their centre: elementFromPoint
// returns null outside the viewport, and the shelf's lower boards are legitimately lazy and
// legitimately have no pixels. A board that cannot be seen cannot be showing anything.
const WATCH_FLOOR = () => {
  window.__floor = [];
  const look = () => {
    const t = Math.round(performance.now());
    for (const f of document.querySelectorAll('.bd-cover-wrap .bb-front, #fiction .shelf-entry .bb-front')) {
      const img = f.querySelector('img');
      if (!img) continue;
      const r = f.getBoundingClientRect();
      const onScreen = r.width > 0 && r.height > 0
        && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
      const top = onScreen ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      window.__floor.push({
        t,
        onScreen,
        standIn: getComputedStyle(f).backgroundImage.startsWith('url("data:image/'),
        hasPixels: !!(img.complete && img.naturalWidth > 0),
        opaque: parseFloat(getComputedStyle(img).opacity) === 1,
        // ⭑ What the viewer is actually looking at in the middle of the board. A pseudo-element
        // laid over the face reports as the face, not as the cover, so it is caught here too.
        topIsCover: onScreen ? top === img : null,
      });
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};

/** Warm the cover the honest way — by looking at the page once, which is the journey (shelf →
 *  detail, or a revisit) the floor rule is about — then watch the second visit frame by frame. */
async function watchFloor(page, { url, ready, inject, holdCoversMs = 0, settleMs = 1200 }) {
  await page.addInitScript((k) => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
  await page.goto(url);
  await ready(page);

  if (holdCoversMs) {
    await page.route('**/bookstore_covers*', async (route) => {
      await new Promise((r) => setTimeout(r, holdCoversMs));
      await route.continue();
    });
  }
  if (inject) {
    await page.addInitScript((css) => {
      const s = document.createElement('style');
      s.textContent = css;
      const put = () => (document.head || document.documentElement).appendChild(s);
      if (document.head) put(); else document.addEventListener('readystatechange', put, { once: true });
    }, inject);
  }
  await page.addInitScript(WATCH_FLOOR);
  await page.reload();
  await expect(page.locator('.bb-front').first()).toBeAttached({ timeout: 60000 });
  // ⚠ ready() RUNS AGAIN ON THE SECOND VISIT, and it has to. A reload puts the shelf back at
  // the top of the document, and the shelf's covers are LAZY BY RULING (R27) — without the
  // same scroll the first visit made, the fiction shelf never enters the viewport, no cover is
  // ever asked for, and every case here would pass by measuring nothing. That is precisely the
  // shape of the ten dead tests this project has already found. The watcher is installed
  // BEFORE this, so the frames either side of the scroll are all recorded.
  await ready(page);
  await page.waitForTimeout(settleMs);
  const frames = await page.evaluate(() => window.__floor);
  expect(frames.length, 'the watcher never saw a board — this case measured nothing').toBeGreaterThan(0);
  return frames;
}

// ⭑ A PLACEHOLDER PAINTED OVER THE COVER. The second twin for Case A, and the shape of the
// mistake this round was told not to repeat: something in FRONT of the image rather than behind
// it. A pseudo-element is used so no markup is touched — elementFromPoint reports it as the
// face, which is exactly "the viewer is not looking at the cover".
const COVER_THE_COVER = '.bb-front::after{content:"";position:absolute;inset:0;background:#0e0a16;z-index:9}';

const FLOOR_SURFACES = [
  {
    name: 'the detail page',
    url: `/bookstore/${SLUGS[0]}`,
    ready: async (page) => {
      await expect(page.locator('.bd-cover-wrap .bb-front img')).toBeAttached({ timeout: 60000 });
      await expect.poll(async () => page.locator('.bd-cover-wrap .bb-front img')
        .evaluate((i) => i.complete && i.naturalWidth > 0), { timeout: 60000 }).toBe(true);
    },
  },
  {
    name: 'the storefront shelf',
    url: '/bookstore',
    ready: async (page) => {
      await expect(page.locator('#fiction .shelf-entry .bb-front img').first()).toBeAttached({ timeout: 60000 });
      await page.locator('#fiction .shelf').first().scrollIntoViewIfNeeded();
      await expect.poll(async () => page.locator('#fiction .shelf-entry .bb-front img').first()
        .evaluate((i) => i.complete && i.naturalWidth > 0), { timeout: 60000 }).toBe(true);
    },
  },
];

test.describe('the floor', () => {
  for (const s of FLOOR_SURFACES) {
    test.describe(s.name, () => {
      // ── CASE A, and its two twins ──────────────────────────────────────────────────────
      const inFront = (frames) => frames.filter((f) => f.onScreen && f.hasPixels && !(f.opaque && f.topIsCover));

      test('CASE A — the stand-in is never in front of a cover that has pixels', async ({ page }) => {
        const frames = await watchFloor(page, s);
        const judged = frames.filter((f) => f.onScreen && f.hasPixels);
        expect(judged.length, 'no frame ever had a decoded cover on screen — this case measured nothing').toBeGreaterThan(0);
        expect(inFront(frames).length,
          `on ${inFront(frames).length} of ${judged.length} judged frames the cover had pixels and was NOT what the board `
          + 'was showing — the stand-in is behaving as an override, not a floor').toBe(0);
      });

      test('PROOF — hold the cover transparent (the app\'s own defect) and Case A goes red', async ({ page }) => {
        const frames = await watchFloor(page, { ...s, inject: HOLD_THE_COVER_BACK });
        expect(inFront(frames).length,
          'with the cover held transparent the watcher MUST catch it — otherwise Case A proves nothing').toBeGreaterThan(0);
      });

      test('PROOF — paint a placeholder over the cover and Case A goes red', async ({ page }) => {
        const frames = await watchFloor(page, { ...s, inject: COVER_THE_COVER });
        expect(inFront(frames).length,
          'with a placeholder over the cover the watcher MUST catch it — otherwise Case A proves nothing').toBeGreaterThan(0);
      });
    });
  }

  // ── CASE B, on the one board whose arrival is not also a scroll decision ────────────────
  // The detail board is eager and alone on the page; the shelf's are lazy by ruling (R27), so
  // "frames before the cover has pixels" is a scroll question there, not a cache question.
  const s = FLOOR_SURFACES[0];
  const blind = (frames) => frames.filter((f) => f.onScreen && f.standIn && !f.hasPixels);

  test('CASE B — a warm cache closes the stand-in\'s window at once', async ({ page }) => {
    const frames = await watchFloor(page, s);
    const n = blind(frames).length;
    // Measured warm, six runs: 0, 1, 1, 1, 2, 0 — the single frame between the <img> being
    // attached and its cache read landing. Eight is a ceiling with room in it, and the twin
    // below lands an order of magnitude above it.
    expect(n, `the stand-in was the whole of the board for ${n} of ${frames.length} frames on a WARM cache`)
      .toBeLessThanOrEqual(8);
  });

  test('PROOF — put the cover back in flight and the window is wide open', async ({ page }) => {
    const frames = await watchFloor(page, { ...s, holdCoversMs: 3000 });
    const n = blind(frames).length;
    expect(n, 'with the cover in flight the stand-in MUST be holding the board — otherwise Case B proves nothing')
      .toBeGreaterThan(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE BUDGET, read off the served bytes.
// ═══════════════════════════════════════════════════════════════════════════════════════════
test.describe('the budget', () => {
  test('every detail page carries its stand-in inline, under the ceiling', async ({ page }) => {
    // A stand-in that needed its own request would not be one. On the detail page that means
    // it has to be in the HTML, which is what this reads — the served bytes, not the DOM.
    let total = 0; let seen = 0; let largest = 0;
    for (const slug of SLUGS) {
      const html = await (await page.request.get(`/bookstore/${slug}`)).text();
      const m = /coverLqip\\?":\\?"(data:image\/[^"\\]+)/.exec(html);
      expect(m, `/bookstore/${slug} carries no inline stand-in`).toBeTruthy();
      const bytes = m[1].length;
      expect(bytes, `${slug}'s stand-in is ${bytes} bytes, over the ${MAX_COVER_LQIP_BYTES}-byte ceiling`)
        .toBeLessThanOrEqual(MAX_COVER_LQIP_BYTES);
      total += bytes; seen++; largest = Math.max(largest, bytes);
    }
    expect(seen, 'no detail pages were checked').toBeGreaterThan(0);
    console.log(`\n${seen} detail pages: ${(total / seen).toFixed(0)} bytes average, ${largest} largest, `
      + `${(total / 1024).toFixed(1)} KiB across the catalogue (${COVER_LQIP_WIDTH}px wide WebP)\n`);
  });
});
