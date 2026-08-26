// R20 — THE SHELF'S WEIGHT, BUDGETED.
//
// Ikenna reported the storefront lagging as the catalogue grew from 3 titles to ~20. Measured
// on the shipped export before this round:
//
//   viewport   first paint   of which covers   layers   layer memory   frames >25ms
//   390          11.2 MiB     10.0 MiB (89.2%)    218       54.2 MiB      7.9–11.9%
//   1280         15.7 MiB     14.5 MiB (92.3%)    219      147.4 MiB     41.7–45.5%
//
// The catalogue was 33.74 MiB of raw PNG/JPEG admin uploads, up to 3931×5156, drawn into a
// board 104.7px wide on a handset and 197.6px on a laptop — a 37.5× linear oversample at worst.
// There is no image optimiser to catch this: output:'export' means next/image ran `unoptimized`
// and emitted no srcset at all. So the rungs are real objects, cut at upload time by
// /admin/bookstore and back-filled once by scripts/backfill-bookstore-cover-derivatives.mjs.
//
// ── WHAT THIS FILE IS FOR ───────────────────────────────────────────────────────────────────
// A weight regression is invisible. Nothing goes red, no test fails, no page breaks — a curator
// uploads a 4 MB cover through a browser that could not encode WebP, and the shop is simply
// slower forever. That is precisely the class of defect a budget catches and nothing else does.
//
// ⚠ THESE BUDGETS FAIL ON PRE-R20 HEAD, AND THAT WAS CHECKED RATHER THAN ASSUMED. Run against
// the build immediately before this round, `the shelf's covers fit their budget` reports
// 14.5 MiB against a 2 MiB ceiling and every one of the four largest covers over the per-cover
// ceiling. A budget nobody has ever seen fail is a number, not a test.
//
// ── WHY RELATIONS AND CEILINGS, NEVER EXACT BYTES ───────────────────────────────────────────
// The catalogue is LIVE — the same decision, for the same reason, that gate.spec.mjs,
// currency.spec.mjs and territory.spec.mjs all set out at length. A cover re-encoded by a
// curator, a title added, a WebP encoder that improves by a kilobyte: none of those is a
// regression, and a suite pinning exact bytes would go red for all three and have to be
// re-blessed by hand until nobody believed it. Every number below is a CEILING with headroom
// stated, and the headroom is written down so a future reader can see how much room they have.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { liveDetailSlug } from './live-slug.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
function stringConst(src, name, file) {
  const m = new RegExp(`^export const ${name} = '([^']*)';`, 'm').exec(src);
  if (!m) throw new Error(`${file} no longer exports a single-quoted string const named ${name}.`);
  return m[1];
}
const GATE_STORAGE_KEY = stringConst(GATE_SRC, 'GATE_STORAGE_KEY', 'app/lib/bookstore/gate.js');
const CURRENCY_KEY = 'cs_bookstore_currency';

// R20 — the grain's own record, read from the module rather than restated here. If the ruling
// is ever reversed, it is reversed in ONE file and this suite follows it there instead of
// asserting a number nobody can find the origin of.
const GRAIN_SRC = readFileSync(join(ROOT, 'app/bookstore/components/grain.js'), 'utf8');
const numConst = (name) => {
  const m = new RegExp(`^export const ${name} = (\\d+);`, 'm').exec(GRAIN_SRC);
  if (!m) throw new Error(`app/bookstore/components/grain.js no longer exports a numeric const named ${name}.`);
  return Number(m[1]);
};
const GRAIN_BLEED_PX = numConst('GRAIN_BLEED_PX');
const GRAIN_MAX_TRAVEL_PX = numConst('GRAIN_MAX_TRAVEL_PX');
// Every offset the keyframes actually use, parsed out of the CSS the page ships.
const GRAIN_OFFSETS = [...GRAIN_SRC.matchAll(/translate\((-?\d+)px,\s*(-?\d+)px\)/g)]
  .flatMap((m) => [Math.abs(Number(m[1])), Math.abs(Number(m[2]))]);

// Both pages carry the grain, and R20 changed it on both. A suite that only checked the
// storefront would let the detail page drift back on its own.
//
// The detail page's slug is RESOLVED FROM THE SHOP, not named — see tests/bookstore/live-slug.mjs
// for the incident that taught this suite the difference.
const GRAIN_PAGES = [
  { name: 'storefront', path: () => '/bookstore', ready: '.shelf-entry .entry-title' },
  { name: 'detail', path: 'resolve', ready: '.bd-cta' },
];

// ── THE BUDGETS ─────────────────────────────────────────────────────────────────────────────
//
// PER COVER. Measured after R20, the heaviest rung any board pulls is 43 KB
// (the-tenant-of-wildfell-hall at 360w) and the heaviest 720w rung is 174 KB. 250 KB is a
// ceiling with roughly 6× headroom over what a shelf board actually takes, chosen so a genuinely
// detailed cover — a dense illustration, a photographic wrap — has somewhere to go without a
// curator having to argue with CI. Before R20 the worst was 4567 KB, eighteen times this.
const PER_COVER_MAX_BYTES = 250 * 1024;

// THE WHOLE FIRST PAINT'S WORTH OF COVERS. After R20 a laptop first paint pulls about 0.3 MiB
// of covers; before, 14.5 MiB. 2 MiB sits between them with roughly 6× headroom, which is also
// enough for the catalogue to double without anyone touching this number.
const SHELF_COVER_MAX_BYTES = 2 * 1024 * 1024;

// OVERSAMPLE. The real defect was never the byte count on its own — it was serving 3931px into
// a 104.7px board. A rung may legitimately be larger than its board (DPR3 is a 3× device, and
// `sizes` deliberately over-states so it never picks a rung too small), so the ceiling is 4×
// the CSS width the board is actually drawn at. Before R20 this ran to 37.5×.
const MAX_OVERSAMPLE = 4;

// LAYERS FOR A FULL SHELF. Measured 219 at 1280 and 218 at 390, for 23 boards — the detail page
// draws one board in 17, so about 9 layers per board is inherent to a 3D object with a
// preserve-3d parent, hidden backfaces and translateZ children.
//
// ⚠ THIS ONE DOES NOT FAIL ON PRE-R20 HEAD, AND SAYING SO IS THE POINT. R20 changed no
// compositing: `will-change:transform` was MEASURED not to be the promoter (removing it left
// the count at 219), the contact shadow's blur was measured to cost nothing, and the front
// face's box-shadow — which does cost about 7 points of dropped frames — is protected by
// ruling and was deliberately not touched. So this is a RATCHET, not a repair: it holds the
// count where it is so the next round cannot add a layer per board unnoticed. It is proven to
// be able to fail by the case below it, which adds layers and watches it trip.
const LAYER_MAX = 260;

const VIEWPORTS = [
  { name: '390 handset', width: 390, height: 844 },
  { name: '1280 laptop', width: 1280, height: 900 },
];

async function enterShop(page) {
  await page.addInitScript(
    ([gateKey, curKey]) => {
      try {
        window.localStorage.setItem('cs_cookie_consent', 'accepted');
        window.localStorage.setItem(gateKey, '1');
        window.localStorage.setItem(curKey, 'gbp');
      } catch { /* private mode */ }
    },
    [GATE_STORAGE_KEY, CURRENCY_KEY],
  );
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
}

/**
 * Loads the shop and returns every image response with its transferred size.
 *
 * content-length is preferred and the body is only read when the header is missing: reading a
 * body forces Playwright to buffer it, and on a page that used to pull 14.5 MiB of covers that
 * is the difference between a test and a timeout.
 */
async function loadShelf(page, { scroll = false } = {}) {
  const responses = [];
  page.on('response', async (res) => {
    try {
      const headers = await res.allHeaders();
      const ct = headers['content-type'] || '';
      if (res.request().resourceType() !== 'image' && !/^image\//.test(ct)) return;
      let bytes = Number(headers['content-length'] || 0);
      if (!bytes) { try { bytes = (await res.body()).length; } catch { bytes = 0; } }
      responses.push({ url: res.url(), ct, bytes });
    } catch { /* a response that vanished with its frame tells us nothing */ }
  });

  await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
  await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
  if (scroll) {
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    const step = await page.evaluate(() => Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < docH; y += step) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(120); }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await page.waitForTimeout(2500);
  return responses;
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('the cover payload', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: the shelf's covers fit their budget`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await enterShop(page);
      const images = await loadShelf(page);

      // Only the catalogue's own covers. The house logo and any decoration are a different
      // budget's problem and would make this number mean two things.
      const covers = images.filter((r) => /bookstore_covers/.test(decodeURIComponent(r.url)));
      expect(covers.length, 'the shop must have fetched some covers to measure').toBeGreaterThan(0);

      const total = covers.reduce((a, b) => a + b.bytes, 0);
      const worst = covers.slice().sort((a, b) => b.bytes - a.bytes)[0];
      const name = (u) => decodeURIComponent(u).split('/').pop().split('?')[0];

      expect(worst.bytes,
        `the heaviest cover on this shelf is ${kb(worst.bytes)} — ${name(worst.url)}. `
        + `The ceiling is ${kb(PER_COVER_MAX_BYTES)}. A cover this heavy means its sized rungs are `
        + `missing: check coverSizes on the record, and re-upload it through /admin/bookstore, `
        + `which cuts them. scripts/backfill-bookstore-cover-derivatives.mjs is the bulk tool.`)
        .toBeLessThanOrEqual(PER_COVER_MAX_BYTES);

      expect(total,
        `this shelf pulled ${kb(total)} of covers across ${covers.length} requests. `
        + `The ceiling is ${kb(SHELF_COVER_MAX_BYTES)}. Before R20 it was 14.5 MiB.`)
        .toBeLessThanOrEqual(SHELF_COVER_MAX_BYTES);
    });

    test(`${vp.name}: no board is served a cover it cannot use`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await enterShop(page);
      await loadShelf(page, { scroll: true });

      // naturalWidth is the rung the browser ACTUALLY CHOSE, not the one the srcset offered —
      // which is the only number that answers "what did this reader pay for this board".
      const boards = await page.evaluate(() => [...document.querySelectorAll('.bb-front img')]
        .filter((i) => i.complete && i.naturalWidth > 0)
        .map((i) => {
          const r = i.getBoundingClientRect();
          return {
            natural: i.naturalWidth,
            drawn: +r.width.toFixed(1),
            src: (i.currentSrc || i.src).split('/').pop().split('?')[0],
            loading: i.loading,
            decoding: i.decoding,
          };
        })
        .filter((b) => b.drawn > 0));

      expect(boards.length, 'some board must have decoded a cover to measure').toBeGreaterThan(0);

      const over = boards
        .map((b) => ({ ...b, ratio: b.natural / b.drawn }))
        .filter((b) => b.ratio > MAX_OVERSAMPLE)
        .sort((a, b) => b.ratio - a.ratio);

      expect(over,
        over.length
          ? `${over.length} board(s) are served a cover far larger than they draw. Worst: `
            + `${over[0].src} at ${over[0].natural}px into a ${over[0].drawn}px board `
            + `(${over[0].ratio.toFixed(1)}×, ceiling ${MAX_OVERSAMPLE}×). That is the R20 defect `
            + `returning: the board fell back to the full-size original because its rungs are absent.`
          : '')
        .toEqual([]);

      // The shelf must still DEFER what is below the fold. This is not a byte count — it is the
      // other half of the same promise, and it costs nothing to hold.
      for (const b of boards) {
        expect(b.decoding, `${b.src} must decode off the main thread`).toBe('async');
      }
    });
  }

  test('every board that has rungs asks for them, and states which it wants', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterShop(page);
    await loadShelf(page, { scroll: true });

    const boards = await page.evaluate(() => [...document.querySelectorAll('.bb-front img')].map((i) => ({
      hasSrcSet: !!i.getAttribute('srcset'),
      hasSizes: !!i.getAttribute('sizes'),
      src: (i.currentSrc || i.src).split('/').pop().split('?')[0],
    })));
    expect(boards.length).toBeGreaterThan(0);

    // A board with NO rungs is a supported state — a cover uploaded before the door existed, or
    // one whose encode failed. It falls back to the original, which is heavier and correct. What
    // is NOT supported is a srcset with no sizes: the browser then assumes 100vw and pulls the
    // largest rung onto the smallest board, which would undo the round while looking fixed.
    for (const b of boards) {
      if (b.hasSrcSet) {
        expect(b.hasSizes, `${b.src} offers rungs but does not say how wide it is drawn — the browser will assume 100vw and take the largest`).toBeTruthy();
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('compositing', () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: a full shelf stays under the layer ratchet`, async ({ page, context }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await enterShop(page);
      await loadShelf(page);

      const count = await layerCount(context, page);
      expect(count,
        `a full shelf composited ${count} layers, over the ${LAYER_MAX} ratchet. Each board costs `
        + `about 9 (preserve-3d, hidden backfaces, translateZ children) and the detail page draws `
        + `one in 17. A jump usually means a new promoted element inside BoundBook — check for a `
        + `transform, filter or will-change added to the board.`)
        .toBeLessThanOrEqual(LAYER_MAX);
    });
  }

  // THE RATCHET CAN FAIL, PROVEN HERE RATHER THAN CLAIMED. Unlike the byte budgets, the layer
  // ceiling does not trip on pre-R20 HEAD — R20 changed no compositing on purpose. A ceiling
  // nobody has watched fail is indistinguishable from a ceiling that cannot, so this case adds
  // promoted elements until it does.
  test('the layer ratchet is a real ceiling — it trips when layers are added', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterShop(page);
    await loadShelf(page);

    const before = await layerCount(context, page);
    expect(before).toBeLessThanOrEqual(LAYER_MAX);

    // One more promoted element per board, which is exactly the regression the ratchet exists
    // to catch — a transform quietly added inside BoundBook.
    await page.evaluate((n) => {
      for (const persp of document.querySelectorAll('.bb-persp')) {
        for (let i = 0; i < n; i++) {
          const d = document.createElement('div');
          d.style.cssText = 'position:absolute;inset:0;transform:translateZ(1px);will-change:transform;pointer-events:none';
          persp.appendChild(d);
        }
      }
    }, 4);
    await page.waitForTimeout(1200);

    const after = await layerCount(context, page);
    expect(after, 'adding four promoted elements per board must push the count past the ratchet').toBeGreaterThan(LAYER_MAX);
  });
});

/**
 * Composited layer count, straight from the compositor via CDP — not inferred from CSS.
 *
 * THE LISTENER GOES ON BEFORE LayerTree.enable. `enable` itself pushes the first tree, so a
 * handler attached afterwards can miss it and then wait forever for a change that already
 * happened — which is how the first draft of this helper timed out, returned an empty array,
 * and made the budget pass by measuring nothing.
 *
 * AND A MISSING TREE THROWS rather than counting zero. A ceiling that is satisfied because the
 * measurement failed is precisely the defect this file's header warns about.
 */
async function layerCount(context, page) {
  const cdp = await context.newCDPSession(page);
  let settle;
  const tree = new Promise((resolve) => { settle = resolve; });
  cdp.on('LayerTree.layerTreeDidChange', (e) => settle(e.layers || []));
  await cdp.send('DOM.enable');
  await cdp.send('LayerTree.enable');
  // The tree is only pushed on a change; nudge one, and AWAIT it so nothing is left in flight
  // when the test ends.
  await page.evaluate(() => window.scrollBy(0, 1));
  const layers = await Promise.race([
    tree,
    new Promise((resolve) => setTimeout(() => resolve(null), 15000)),
  ]);
  await cdp.detach().catch(() => {});
  if (layers === null) throw new Error('the compositor never reported a layer tree — this measured nothing, which is not the same as passing');
  return layers.length;
}


// ═══════════════════════════════════════════════════════════════════════════════
// THE GRAIN — R20, Ikenna's ruling of 26 August 2026.
//
//   "Grain that holds still while the page moves reads as dust on the lens; grain that
//    travels with the page reads as texture in the paper."
//
// The grain IS the single largest cost in a scroll of the storefront — but un-fixing it is not
// what recovers that, and the header of app/bookstore/components/grain.js sets out the faulty
// ablation that briefly suggested otherwise. These cases guard a DRAWING.
//
// WHAT THESE CASES GUARD is the ATTACHMENT, because that is the whole of the change and it is
// a single word in a stylesheet. `position:fixed` would restore a viewport-locked layer that
// re-composites against every scroll offset, and nothing else on this platform would notice.
// It would not break a page, fail a build, or move a pixel at rest.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('the grain', () => {
  for (const pg of GRAIN_PAGES) {
    for (const vp of VIEWPORTS) {
      test(`${pg.name} ${vp.name}: the grain travels with the page and covers it`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await enterShop(page);

        let target = '/bookstore';
        if (pg.path === 'resolve') {
          // Go via the shop so the slug is one it is actually showing.
          await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
          await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
          target = `/bookstore/${await liveDetailSlug(page)}`;
        }
        await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
        await expect(page.locator(pg.ready).first()).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(1500);

        const g = await page.evaluate(() => {
          const el = document.querySelector('.bookstore-grain');
          if (!el) return null;
          const cs = getComputedStyle(el);
          const parent = el.parentElement;
          const r = el.getBoundingClientRect();
          return {
            position: cs.position,
            parentTag: parent.tagName,
            parentPositioned: getComputedStyle(parent).position !== 'static',
            isFirstChild: parent.firstElementChild === el,
            height: Math.round(r.height),
            parentScrollHeight: parent.scrollHeight,
            viewportH: window.innerHeight,
            animationName: cs.animationName,
            animationDuration: cs.animationDuration,
            animationTimingFunction: cs.animationTimingFunction,
            opacity: cs.opacity,
            backgroundImage: cs.backgroundImage,
          };
        });
        expect(g, 'the grain must be on the page').not.toBeNull();

        // THE RULING ITSELF.
        expect(g.position,
          'the grain must travel with the page — Ikenna\'s ruling of 26 Aug 2026. position:fixed '
          + 'is the pre-R20 arrangement. This is a DESIGN assertion, not a performance one: the '
          + 'two positioning schemes measure the same, and the header of '
          + 'app/bookstore/components/grain.js corrects an earlier claim that they did not. '
          + 'Read that before changing this.')
          .toBe('absolute');

        // AND THE ARRANGEMENT THAT MAKES IT WORK. An absolutely positioned element with no
        // positioned ancestor resolves against the viewport-sized initial containing block —
        // so the grain would cover one screenful and stop, which looks fine above the fold and
        // is why this is asserted rather than left to review.
        expect(g.parentTag, 'the grain must live inside <main>').toBe('MAIN');
        expect(g.parentPositioned, '<main> must be positioned, or the grain resolves against the viewport and runs out').toBeTruthy();

        // COVERAGE, to the full height of the shop's own surface plus the bleed.
        expect(g.height,
          `the grain is ${g.height}px against a ${g.parentScrollHeight}px page — it must reach the foot`)
          .toBeGreaterThanOrEqual(g.parentScrollHeight);

        // A SHORT PAGE still gets a full screen of it.
        expect(g.height, 'a short page must still be covered to the fold').toBeGreaterThanOrEqual(g.viewportH);

        // THE ANIMATION STAYS — the ruling kept it, and the frames were bought elsewhere.
        expect(g.animationName).toBe('grainShift');
        expect(g.animationDuration).toBe('8s');
        expect(g.animationTimingFunction).toContain('steps(10');

        // THE LOOK. Opacity and both gradient passes are what make the texture; they are
        // unchanged by R20 and this is where that is written down.
        expect(g.opacity).toBe('0.05');
        expect(g.backgroundImage).toContain('repeating-linear-gradient');
        expect((g.backgroundImage.match(/repeating-linear-gradient/g) || []).length,
          'both gradient passes — the 0deg and the 90deg — make the texture').toBe(2);
      });
    }
  }

  test('the bleed covers the largest step the animation takes', async () => {
    // Pure arithmetic over the shipped CSS, no browser needed. If someone widens a keyframe
    // offset past the bleed, a step drags an uncovered edge into view at the page foot — which
    // is a one-frame flash every eight seconds and almost impossible to catch by eye.
    expect(GRAIN_OFFSETS.length, 'the keyframes must be in px so the travel is bounded').toBeGreaterThan(0);
    const worst = Math.max(...GRAIN_OFFSETS);
    expect(worst, 'GRAIN_MAX_TRAVEL_PX must describe the actual keyframes').toBeLessThanOrEqual(GRAIN_MAX_TRAVEL_PX);
    expect(GRAIN_BLEED_PX, `the bleed (${GRAIN_BLEED_PX}px) must exceed the largest offset (${worst}px)`).toBeGreaterThan(worst);
  });

  test('there is exactly one definition of the grain', async () => {
    // It used to be duplicated byte-for-byte in app/bookstore/page.js and
    // app/bookstore/[slug]/page-detail.js. Two copies of a ruling is one copy that gets
    // reversed on its own, which is precisely the failure the cases above are guarding.
    for (const f of ['app/bookstore/page.js', 'app/bookstore/[slug]/page-detail.js']) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src.includes('position:fixed;inset:-50%'),
        `${f} still carries its own copy of the pre-R20 grain rule`).toBeFalsy();
      expect(src.includes('GRAIN_CSS'), `${f} must render the shared grain`).toBeTruthy();
    }
  });
});
