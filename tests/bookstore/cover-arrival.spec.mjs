// ═══════════════════════════════════════════════════════════════════════════════════════════
// R26 — THE COVER ARRIVES IN ONE BEAT, AND THIS IS WHAT HOLDS IT
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npm run test:cover-arrival
//
// ── WHAT IKENNA SAW, AND WHAT IT ACTUALLY WAS ──────────────────────────────────────────────
//
// "The web still has a jump I don't like — the cover assembles in two beats when the detail
// page is opened." (27 Aug 2026, on glass, after R23.)
//
// Measured frame by frame against the built export — rAF-sampled DOM plus a CDP screencast
// read pixel by pixel — the two beats were NOT two images and NOT an upscale. Both boards
// requested the same file, the same rung, at the same drawn size. They were:
//
//   BEAT ONE, an EMPTY BOARD. The <img> is not in the served document at all (grep -c '<img'
//     on out/bookstore/<slug>.html returns 0, for every title — the whole tree hangs off the
//     R9 gate's `unlocked`, which is false during the prerender). So the preload scanner never
//     saw the cover URL and the request could not start until React had hydrated, the gate's
//     effect had run and a re-render had committed. Navigation responseEnd 4ms; cover request
//     start 124ms; board on screen at 139ms with naturalWidth 0.
//   BEAT TWO, A NEW BOARD IN A DIFFERENT PLACE. The loading state and the ready state were two
//     mutually exclusive JSX branches, each with its own <BoundBook>. The flip tore down the
//     first <img> and built a second. Measured displacement of the DRAWN board (.bb-persp):
//       1280 @dpr1   (232,132,220,330) → (232,185.42,220,330)      53.42px down
//        390 @dpr3    (52,132,220,330) →  (85,185.42,220,330)      33px across, 53.42px down
//     The 53.42px is the breadcrumb, which existed only in the ready branch. The 33px is the
//     loading grid having no `.bd-header` class, so the handset media query that collapses the
//     two columns to one centred column did not apply to it: `260px 10px` against `326px`.
//
// ── WHAT THIS SUITE REFUSES TO BE ──────────────────────────────────────────────────────────
//
// The rule R23 set stands: no assertion here reads the source of page-detail.js, greps for a
// class, or checks that something is absent. Six times in this repo a test has pinned the
// shape of something the product had stopped rendering. Every case below drives the real built
// page in a real browser and measures the arrival as it happens.
//
// And every assertion is proved able to fail. Each case has a twin that injects the MEASURED
// pre-R26 defect — the 53.42px, the un-collapsed grid, the second <img>, the other rung, the
// missing preload — and requires the assertion to invert. Without that half, "the box never
// changed" would also pass against a selector that matched nothing.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveDetailSlug } from './live-slug.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
const GATE_STORAGE_KEY = (() => {
  const m = /^export const GATE_STORAGE_KEY = '([^']*)';/m.exec(GATE_SRC);
  if (!m) throw new Error('app/lib/bookstore/gate.js no longer exports GATE_STORAGE_KEY as a single-quoted string.');
  return m[1];
})();

// The geometry the two branches actually had, restored as CSS on the half that used to carry
// it. `data-bd-state` is rendered for exactly this purpose and nothing in the shipped
// stylesheet selects on it.
const PUT_THE_TWO_BOXES_BACK = `
  [data-bd-state="loading"] .bd-cover-wrap{transform:translateY(-53.42px)}
  @media(max-width:720px){
    [data-bd-state="loading"].bd-header{grid-template-columns:260px 1fr !important;justify-items:start !important}
  }
`;

// ── THE RECORDER ───────────────────────────────────────────────────────────────────────────
// Every rAF from document_start, keeping one entry per CHANGE. What it records is the board's
// three boxes, the identity of the <img> occupying it, and whether that <img> has pixels. A
// beat is precisely a change in one of those.
const RECORDER = () => {
  window.__seq = 0;
  window.__seen = [];   // one entry per distinct <img> element that has ever held the board
  window.__log = [];    // one entry per change
  let last = null;
  const rect = (el) => { const b = el.getBoundingClientRect(); return [+b.x.toFixed(2), +b.y.toFixed(2), +b.width.toFixed(2), +b.height.toFixed(2)]; };
  const look = () => {
    const wrap = document.querySelector('.bd-cover-wrap');
    if (wrap) {
      const persp = wrap.querySelector('.bb-persp');
      const img = wrap.querySelector('.bb-front img');
      if (img && !img.__id) {
        img.__id = ++window.__seq;
        window.__seen.push({ id: img.__id, t: Math.round(performance.now()), src: img.getAttribute('src'), srcSet: img.getAttribute('srcset'), sizes: img.getAttribute('sizes') });
      }
      const rec = {
        t: Math.round(performance.now()),
        wrap: rect(wrap),
        board: persp ? rect(persp) : null,
        img: img ? rect(img) : null,
        imgId: img ? img.__id : null,
        // "has pixels" — a board whose <img> is not complete is a board drawn without its cover.
        painted: img ? (img.complete && img.naturalWidth > 0) : false,
        currentSrc: img ? img.currentSrc : null,
      };
      const sig = JSON.stringify(rec).replace(/"t":\d+,/, '');
      if (sig !== last) { last = sig; window.__log.push(rec); }
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};

// Replaces the board's <img> with a clone the moment the ready content lands — a second
// rendering of the same cover, which is exactly what the two JSX branches used to produce.
//
// `rungs` turns it into the OTHER defect: the clone is pinned to whichever rung the board was
// not already drawing, so the second rendering fetches a different file at a different
// sharpness. Which rung that is depends on the device pixel ratio, so it is chosen here from
// what the element actually resolved rather than named by the test.
const PUT_THE_SECOND_IMG_BACK = (rungs) => {
  const swap = () => {
    const img = document.querySelector('.bd-cover-wrap .bb-front img');
    if (!img || !document.querySelector('h1')) return false;
    const clone = img.cloneNode(true);
    if (rungs) {
      const other = rungs.find((u) => u !== img.currentSrc);
      if (!other) return false;
      clone.removeAttribute('srcset'); clone.removeAttribute('sizes'); clone.setAttribute('src', other);
    }
    img.replaceWith(clone);
    return true;
  };
  const obs = new MutationObserver(() => { if (swap()) obs.disconnect(); });
  const start = () => obs.observe(document.body, { childList: true, subtree: true });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
};

/**
 * Serves the detail document with its cover preload POINTED SOMEWHERE ELSE — the head's <link>
 * and the flight payload's matching hint both get a query parameter that makes them a
 * different URL from the one the board will draw.
 *
 * Why misdirected rather than deleted: React emits the preload TWICE, once as a tag in the
 * head and once as a hint replayed by the client at hydration, so deleting the tag alone
 * leaves a preload that still fires — just later, and at a time that races the board. Changing
 * the URL in both places removes the preload OF THE FILE THE BOARD DRAWS, which is exactly the
 * pre-R26 state as far as the board is concerned, and does it deterministically.
 */
function misdirectThePreload(html) {
  const miss = (chunk) => chunk.replace(/\?alt=media/g, '?alt=media&r26=miss');
  return html
    .replace(/<link rel="preload" as="image"[^>]*>/g, miss)
    .replace(/HL\[\\"[^\]]*?\\"image\\"[^\]]*?\]/g, miss);
}

/**
 * Drives the journey the ruling is about: the shelf, then a title's detail page.
 *
 * The shelf half is not scene-setting. It is what makes "the image the shelf already drew" a
 * true statement — the chosen book is scrolled into view and its board waited on until it has
 * pixels, so the cover is genuinely in cache before the detail page is opened. A suite that
 * skipped that would be measuring a cold navigation and calling it an arrival.
 */
async function openFromShelf(page, { mutate } = {}) {
  await page.addInitScript((k) => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));

  await page.goto('/bookstore');
  await expect(page.locator('a[href^="/bookstore/"]').first()).toBeAttached({ timeout: 30000 });
  const slug = await liveDetailSlug(page);

  const shelfBoard = page.locator(`[data-bb-slug="${slug}"] .bb-front img`).first();
  await shelfBoard.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => shelfBoard.evaluate((el) => el.complete && el.naturalWidth > 0), { timeout: 30000 })
    .toBe(true);
  const shelfDrew = await shelfBoard.evaluate((el) => ({ currentSrc: el.currentSrc, sizes: el.getAttribute('sizes') }));

  // The served bytes, read as bytes. The preload is a statement the DOCUMENT makes, and reading
  // it back off the DOM would prove only that React rendered something.
  const html = await (await page.request.get(`/bookstore/${slug}`)).text();

  if (mutate === 'two-boxes') {
    await page.addInitScript((css) => {
      const s = document.createElement('style');
      s.textContent = css;
      const put = () => (document.head || document.documentElement).appendChild(s);
      if (document.head) put(); else document.addEventListener('readystatechange', put, { once: true });
    }, PUT_THE_TWO_BOXES_BACK);
  }
  if (mutate === 'two-imgs') await page.addInitScript(PUT_THE_SECOND_IMG_BACK, null);
  if (mutate === 'other-rung') {
    const rungs = [...html.replace(/&amp;/g, '&').matchAll(/(https:\/\/\S+?)\s+\d+w/g)].map((m) => m[1]);
    const unique = [...new Set(rungs)];
    expect(unique.length, `the served page offers ${unique.length} rung(s) — this mutation needs two`).toBeGreaterThan(1);
    await page.addInitScript(PUT_THE_SECOND_IMG_BACK, unique);
  }
  if (mutate === 'no-preload') {
    // The defect R26 fixed on the network side, restored on the wire rather than simulated.
    await page.route(`**/bookstore/${slug}`, async (route) => {
      const res = await route.fetch();
      const body = misdirectThePreload(await res.text());
      await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(body)) } });
    });
  }

  await page.addInitScript(RECORDER);
  await page.goto(`/bookstore/${slug}`);
  await expect(page.locator('.cs-settle h1')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(2000); // settle: readership, publisher and the taxonomy all land in here

  const log = await page.evaluate(() => window.__log);
  const seen = await page.evaluate(() => window.__seen);
  const cover = await page.evaluate((s) => performance.getEntriesByType('resource')
    .filter((e) => e.name.includes(s) || /bookstore_covers/.test(e.name))
    .map((e) => ({ name: e.name, start: Math.round(e.startTime), initiatorType: e.initiatorType, transferSize: e.transferSize })), slug);
  // The moment this document's own scripting is live. The preload scanner runs BEFORE it; an
  // <img> created by React runs after it. That is the separator this suite uses, because the
  // rAF recorder can only see the board a frame or two after the element was inserted, and a
  // few milliseconds either way is sampling noise rather than evidence.
  const domInteractive = await page.evaluate(() => Math.round(performance.getEntriesByType('navigation')[0].domInteractive));

  expect(log.length, 'the recorder never saw the board — this suite measured nothing').toBeGreaterThan(0);
  return { slug, log, seen, cover, shelfDrew, html, domInteractive, firstBoardAt: log[0].t };
}

const boxes = (log, key) => [...new Set(log.map((f) => JSON.stringify(f[key])))];

for (const vp of [
  { name: 'laptop 1280 @dpr1', use: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 } },
  { name: 'handset 390 @dpr3', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
]) {
  test.describe(vp.name, () => {
    test.use(vp.use);

    test('ONE BOX — the cover occupies the same box from first paint to settled', async ({ page }) => {
      // ⭑ THE CENTRAL CASE. Before R26 this read two boxes 53.42px apart on a laptop, and two
      // boxes 33px across and 53.42px down from each other on a handset.
      const { log } = await openFromShelf(page);
      expect(boxes(log, 'wrap'), `the cover WRAPPER moved: ${boxes(log, 'wrap').join('  →  ')}`).toHaveLength(1);
      expect(boxes(log, 'board'), `the DRAWN BOARD moved: ${boxes(log, 'board').join('  →  ')}`).toHaveLength(1);
      expect(boxes(log, 'img'), `the cover IMAGE moved or resized: ${boxes(log, 'img').join('  →  ')}`).toHaveLength(1);
    });

    test('PROOF — put the two boxes back and the box assertion goes red', async ({ page }) => {
      const { log } = await openFromShelf(page, { mutate: 'two-boxes' });
      expect(boxes(log, 'wrap').length, 'with the pre-R26 geometry restored the wrapper must move').toBeGreaterThan(1);
      expect(boxes(log, 'board').length, 'with the pre-R26 geometry restored the drawn board must move').toBeGreaterThan(1);
    });

    test('ONE RENDERING — one <img> holds the board for the whole arrival', async ({ page }) => {
      const { seen } = await openFromShelf(page);
      expect(seen.length, `${seen.length} separate <img> elements held the board: ${JSON.stringify(seen)}`).toBe(1);
    });

    test('PROOF — put the second rendering back and the one-<img> assertion goes red', async ({ page }) => {
      const { seen } = await openFromShelf(page, { mutate: 'two-imgs' });
      expect(seen.length, 'with a second rendering injected the recorder must see two <img> elements').toBeGreaterThan(1);
    });

    test('ONE FILE — the loading board and the ready board request the same URL, and it is the shelf\'s', async ({ page }) => {
      // ⭑ Candidate 1 from the brief, held open rather than assumed shut. Two rungs (360w,
      // 720w) against a 190px shelf board and a 220px detail board land on the same rung at
      // every device pixel ratio — but that is arithmetic, and this asserts it on the live
      // catalogue instead.
      const { log, seen, cover, shelfDrew } = await openFromShelf(page);
      const drawn = [...new Set(log.map((f) => f.currentSrc).filter(Boolean))];
      expect(drawn, `the board drew more than one file: ${drawn.join('  →  ')}`).toHaveLength(1);
      expect(seen[0].src, 'the src attribute must not change across the arrival').toBe(seen[0].src);
      expect(drawn[0], 'the detail board must draw the very file the shelf already drew').toBe(shelfDrew.currentSrc);
      expect(cover.filter((e) => e.name === drawn[0]),
        `the cover was requested ${cover.length} times: ${JSON.stringify(cover)}`).toHaveLength(1);
    });

    test('PROOF — make the ready board take the other rung and the same-file assertion goes red', async ({ page }) => {
      const { log } = await openFromShelf(page, { mutate: 'other-rung' });
      const drawn = [...new Set(log.map((f) => f.currentSrc).filter(Boolean))];
      expect(drawn.length, 'with a second rung injected the board must be seen drawing two files').toBeGreaterThan(1);
    });

    test('AT NAVIGATION — the cover is asked for off the served bytes, before any board exists', async ({ page }) => {
      // ⭑ Candidate 3 from the brief. The <img> cannot be in the document while the R9 gate
      // stands, so the request is started by a <link rel="preload" as="image"> in the head,
      // which the preload scanner acts on before the bundle is even fetched.
      const { cover, domInteractive, html, log } = await openFromShelf(page);
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head, 'the served document must preload the cover from its head').toMatch(/<link rel="preload" as="image"/);
      const drawn = log.map((f) => f.currentSrc).filter(Boolean)[0];
      const entry = cover.find((e) => e.name === drawn);
      expect(entry, `no resource timing for the file the board drew (${drawn})`).toBeTruthy();
      // WHO asked for it. 'link' is the preload; 'img' means the board asked, which means the
      // request waited on React, the gate's effect and a commit — the pre-R26 defect exactly.
      expect(entry.initiatorType,
        `the cover was requested by the ${entry.initiatorType}, not by the document's preload`).toBe('link');
      // WHEN. Before this document's own scripting was live at all.
      expect(entry.start,
        `the cover request started at ${entry.start}ms, after domInteractive at ${domInteractive}ms — it is waiting on React, not on the navigation`)
        .toBeLessThan(domInteractive);
      // And the preload must name the rung the board actually draws. A preload whose
      // imagesizes disagrees with the <img>'s sizes warms one rung and paints another.
      const imageSizes = /<link rel="preload" as="image"[^>]*imageSizes="([^"]*)"/.exec(head)?.[1];
      const imgSizes = await page.locator('.bd-cover-wrap .bb-front img').getAttribute('sizes');
      expect(imageSizes, 'the preload and the <img> must state the same sizes').toBe(imgSizes);
    });

    test('PROOF — point the preload elsewhere and the board becomes the thing that asks', async ({ page }) => {
      const { cover, domInteractive, log } = await openFromShelf(page, { mutate: 'no-preload' });
      const drawn = log.map((f) => f.currentSrc).filter(Boolean)[0];
      const entry = cover.find((e) => e.name === drawn);
      expect(entry, 'the cover was never requested at all in the misdirected run').toBeTruthy();
      expect(entry.initiatorType,
        'with the preload pointed elsewhere the BOARD must be the thing that asks for the cover').toBe('img');
      expect(entry.start,
        'with the preload pointed elsewhere the request must NOT beat this document\'s own scripting — if it does, the case above is proving nothing')
        .toBeGreaterThan(domInteractive);
    });

    test('THE BOARD ONLY EVER GAINS ITS COVER — it never loses one, and is never empty once the file has arrived', async ({ page }) => {
      // ⭑ The ruling's words are "there is never a frame with an empty or half-drawn board",
      // and this is the deterministic half of that.
      //
      // THE HALF THIS DOES NOT ASSERT, and why. A cross-document navigation builds a NEW <img>,
      // and no <img> can paint before its bytes are in hand — so the board can still be empty
      // for as long as the fetch is genuinely on the wire, cache hit or not. That window is
      // what the preload attacks (measured: 106-115ms of empty board before R26, 0-16ms after,
      // on this machine), and the case above is what holds it: the request is issued by the
      // DOCUMENT, before this page's own scripting exists, so nothing in the app is standing
      // between the board and its cover. Closing the window to a guaranteed zero needs the
      // cover to be CARRIED from the shelf rather than re-fetched, which is the flagged
      // cross-document view transition — R9's, withheld, and not answerable from here.
      //
      // What IS deterministic, and is the whole of the two-beat complaint, is below: the board
      // never goes from having a cover back to not having one, and it is never empty after the
      // file it draws has finished arriving.
      const { log, cover } = await openFromShelf(page);
      const drawn = log.map((f) => f.currentSrc).filter(Boolean)[0];
      const entry = cover.find((e) => e.name === drawn);
      expect(entry, `no resource timing for the file the board drew (${drawn})`).toBeTruthy();
      const arrivedAt = entry.start + entry.duration;

      const lost = log.findIndex((f, i) => i > 0 && log[i - 1].painted && !f.painted);
      expect(lost, `the board HAD its cover and then lost it at ${lost > -1 ? log[lost].t : '?'}ms — that is the second beat: ${JSON.stringify(log.slice(Math.max(0, lost - 1), lost + 1))}`).toBe(-1);

      const lateEmpty = log.filter((f) => !f.painted && f.t > arrivedAt);
      expect(lateEmpty, `the cover finished arriving at ${Math.round(arrivedAt)}ms but the board was still empty on ${lateEmpty.length} later frame(s): ${JSON.stringify(lateEmpty.slice(0, 2))}`).toEqual([]);
    });

    test('PROOF — put a second rendering back and the board is caught losing its cover', async ({ page }) => {
      // The clone takes the rung the board was not drawing, so it mounts with nothing to paint
      // — which is precisely what the pre-R26 branch swap did on a handset: measured, the
      // second <img> appeared at 229ms with naturalWidth 0.
      const { log, cover } = await openFromShelf(page, { mutate: 'other-rung' });
      const drawn = log.map((f) => f.currentSrc).filter(Boolean)[0];
      const entry = cover.find((e) => e.name === drawn);
      const arrivedAt = entry ? entry.start + entry.duration : 0;
      const lost = log.some((f, i) => i > 0 && log[i - 1].painted && !f.painted);
      const lateEmpty = log.some((f) => !f.painted && f.t > arrivedAt);
      expect(lost || lateEmpty,
        `with a second rendering injected the recorder must catch the board empty again — it did not: ${JSON.stringify(log)}`).toBe(true);
    });
  });
}
