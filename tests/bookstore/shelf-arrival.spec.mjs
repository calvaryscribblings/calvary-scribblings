// ═══════════════════════════════════════════════════════════════════════════════════════════
// R27 — THE SHELF ARRIVES FINISHED, AND THIS IS WHAT HOLDS IT
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
//   npm run test:shelf-arrival
//
// Ikenna's ruling, 27 August 2026, walking the storefront: the books fade in one at a time on
// every genre tab switch, and it goes. One declaration —
// `.shelf-entry{animation:fadeUp .5s ease forwards}` — the same mechanism R23 cut from the
// detail page, firing on every tab switch instead of once per visit, on the busiest surface in
// the store. R23's sweep named it and left it; the storefront was outside that round's scope.
//
// ── THE TWO PATHS, AND WHY BOTH ARE HERE ───────────────────────────────────────────────────
//
// FIRST LOAD and TAB SWITCH are different code paths and they did not behave the same. On
// first load the entries mount 1,783px (1280x900) or 2,213px (402x874) below the fold, so the
// 500ms had finished before a reader could scroll to it — the fade was there and invisible. On
// a tab switch the shelf is in view and EVERY ENTRY REMOUNTS (the run structure changes with
// the filter, so books move between runs and React cannot reuse their nodes), which is why it
// fired again, and that is the one Ikenna described. A suite that only measured first paint
// would have been green through the whole complaint.
//
// ── WHAT THIS SUITE REFUSES TO BE ──────────────────────────────────────────────────────────
//
// Nine tests in this project have now been found that could not fail. So: no assertion here
// reads the source of shopVernacular.js, no grep for `animation:`, no check that a string is
// absent. Every case drives the real built page in a real browser and reads computed style and
// geometry ON THE FRAME THE ENTRIES FIRST EXIST — the exact frame that used to read opacity 0
// and translateY(20px).
//
// And the twin injects the declaration VERBATIM, read out of SHELF_FADE_REMOVED.wasDeclaration
// rather than retyped here, so the thing proved-fatal is exactly the thing that was removed
// and cannot drift from it.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELF_FADE_REMOVED } from '../../app/bookstore/components/shopVernacular.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');
const GATE_STORAGE_KEY = (() => {
  const m = /^export const GATE_STORAGE_KEY = '([^']*)';/m.exec(GATE_SRC);
  if (!m) throw new Error('app/lib/bookstore/gate.js no longer exports GATE_STORAGE_KEY as a single-quoted string.');
  return m[1];
})();

// The removed rule, restored. The keyframes are still defined by the page (.hero-inner uses
// them), but they are carried here too so the twin does not depend on that staying true.
const PUT_THE_FADE_BACK = `
  ${SHELF_FADE_REMOVED.wasKeyframes}
  .shelf-entry{${SHELF_FADE_REMOVED.wasDeclaration}}
`;

// Records, frame by frame from document_start, the first frame on which a shelf entry that was
// NOT THERE ON THE PREVIOUS FRAME exists — and what it looked like on it. A fade is precisely
// something that is not in its final state when it first appears, so that frame is the whole
// measurement.
//
// ⚠ FRESHLY MOUNTED ENTRIES, NOT "ANY ENTRIES", AND THAT DISTINCTION IS THE SUITE. The first
// version of this armed on `document.querySelectorAll(...).length` and, on the tab-switch path,
// read the frame BEFORE the switch — the outgoing shelf, long settled at opacity 1. Every
// assertion passed, and passed just as happily with the fade injected back: a test that could
// not fail, in a suite written not to add the tenth. An entry the previous frame did not have
// is the only thing that can be arriving.
const RECORDER = () => {
  window.__first = null;
  window.__phase = 'load';
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return +o.toFixed(4); };
  const look = () => {
    const all = [...document.querySelectorAll('#fiction .shelf-entry')];
    const entries = all.filter((e) => !e.__seenByProbe);
    for (const e of all) e.__seenByProbe = true;
    if (entries.length && !window.__first) {
      // Every element in every entry, so a per-element delay anywhere is caught and not just
      // one on the entry itself.
      const offenders = [];
      for (const e of entries) {
        for (const el of [e, ...e.querySelectorAll('*')]) {
          const s = getComputedStyle(el);
          const delayed = s.transitionDelay.split(',').some((d) => parseFloat(d) > 0);
          if (s.animationName !== 'none' || delayed) {
            offenders.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), animation: s.animationName, animationDelay: s.animationDelay, transitionDelay: s.transitionDelay });
          }
        }
      }
      window.__first = {
        phase: window.__phase,
        t: Math.round(performance.now()),
        count: entries.length,
        total: all.length,
        // Effective opacity, so an ancestor fading would be caught as well as the entry itself.
        opacities: [...new Set(entries.map(eff))],
        transforms: [...new Set(entries.map((e) => { const t = getComputedStyle(e).transform; return t === 'none' ? 'none' : t; }))],
        animations: [...new Set(entries.map((e) => getComputedStyle(e).animationName))],
        offenders,
        running: document.getAnimations()
          .filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#fiction .shelf'))
          .map((a) => a.animationName || a.transitionProperty).filter(Boolean),
      };
    }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};

async function openShop(page, { putTheFadeBack = false } = {}) {
  await page.addInitScript((k) => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
  if (putTheFadeBack) {
    await page.addInitScript((css) => {
      const s = document.createElement('style');
      s.textContent = css;
      const put = () => (document.head || document.documentElement).appendChild(s);
      if (document.head) put(); else document.addEventListener('readystatechange', put, { once: true });
    }, PUT_THE_FADE_BACK);
  }
  await page.addInitScript(RECORDER);
  await page.goto('/bookstore');
  await expect(page.locator('#fiction .shelf-entry').first()).toBeAttached({ timeout: 30000 });
}

/** The frame the shelf first existed on, at first load. */
async function firstLoad(page, opts) {
  await openShop(page, opts);
  await page.waitForTimeout(1500);
  const first = await page.evaluate(() => window.__first);
  expect(first, 'the recorder never saw a shelf entry — this suite measured nothing').toBeTruthy();
  return first;
}

/** The frame the shelf first existed on AFTER a genre tab switch, with the shelf in view. */
async function afterTabSwitch(page, opts) {
  await openShop(page, opts);
  await page.locator('#fiction .genre-tabs').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  const tabs = page.locator('#fiction .genre-tab');
  expect(await tabs.count(), 'the fiction shelf offers no genre tab to switch to').toBeGreaterThan(1);
  // Arm the recorder for the second path, then switch.
  await page.evaluate(() => { window.__first = null; window.__phase = 'tab'; });
  await tabs.nth(1).click();
  await page.waitForTimeout(1500);
  const first = await page.evaluate(() => window.__first);
  expect(first, 'the recorder never saw the shelf come back after the tab switch').toBeTruthy();
  expect(first.phase, 'the recorder read the first-load frame, not the tab-switch one').toBe('tab');
  return first;
}

for (const vp of [
  { name: 'handset 402', use: { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'laptop 1280', use: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 } },
]) {
  test.describe(vp.name, () => {
    test.use(vp.use);

    for (const [path, arrive] of [['at first paint', firstLoad], ['on the frame after a genre tab switch', afterTabSwitch]]) {
      test(`the shelf is at final opacity and final position ${path}`, async ({ page }) => {
        // ⭑ THE CENTRAL CASE. Before R27 this frame read opacity 0 and matrix(1,0,0,1,0,20)
        // for every entry on it.
        const f = await arrive(page);
        expect(f.count, 'no entries were on the shelf at all').toBeGreaterThan(0);
        expect(f.opacities, `entries arrived at ${f.opacities.join(', ')} — the shelf must be fully drawn on the frame it appears`).toEqual([1]);
        expect(f.transforms, `entries arrived translated: ${f.transforms.join(', ')}`)
          .toEqual(expect.arrayContaining([expect.stringMatching(/^(none|matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\))$/)]));
        expect(f.transforms.length, `entries arrived at more than one position: ${f.transforms.join(' | ')}`).toBe(1);
      });

      test(`nothing on the shelf is animating or delayed ${path}`, async ({ page }) => {
        // Every element inside every entry, not just the entry — a stagger would live on the
        // children, and a per-element animation-delay is what "one at a time" would look like
        // if it had ever really been staggered.
        const f = await arrive(page);
        expect(f.animations, 'an entry carries an entrance animation').toEqual(['none']);
        expect(f.offenders, `these elements arrive animated or delayed: ${JSON.stringify(f.offenders.slice(0, 4))}`).toEqual([]);
        expect(f.running, `animations running on the shelf at that frame: ${f.running.join(', ')}`).toEqual([]);
      });

      test(`PROOF — put the fade back and both assertions go red ${path}`, async ({ page }) => {
        // ⭑ Without this, "opacity is 1" would also pass against a selector that matched
        // nothing, a shelf that never rendered, or a recorder armed on the wrong phase. The CSS
        // injected is SHELF_FADE_REMOVED.wasDeclaration verbatim — the rule that was removed,
        // not a retyping of it.
        const f = await arrive(page, { putTheFadeBack: true });
        expect(f.opacities.every((o) => o < 1), `with the fade back the entries must NOT be fully drawn: ${f.opacities.join(', ')}`).toBe(true);
        expect(f.transforms.every((t) => !/^(none|matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\))$/.test(t)),
          `with the fade back the entries must NOT be at their final position: ${f.transforms.join(', ')}`).toBe(true);
        expect(f.animations, 'with the fade back the entries must carry it').toEqual([SHELF_FADE_REMOVED.wasKeyframeName]);
        expect(f.offenders.length, 'with the fade back the subtree scan must find offenders').toBeGreaterThan(0);
        expect(f.running, 'with the fade back it must be running on the shelf').toContain(SHELF_FADE_REMOVED.wasKeyframeName);
      });
    }

    test('⛔ THE SHELF KEEPS ITS IMPERFECTION — uneven entries and an alternating slant', async ({ page }) => {
      // Ikenna chose this and a round that regularises it removes something wanted.
      //
      // ⚠ WHAT IS ACTUALLY UNEVEN, MEASURED RATHER THAN ASSUMED. The TICKETS are all the same
      // height today — 51.4px at 402, 63.3px at 1280 — because every card's note runs to the
      // full two lines .shelf-card-body clamps at. What is uneven is the ENTRIES: six distinct
      // heights across seventeen books at 402 (393, 431, 417, 450, 380, 399), from title
      // length, from whether a price note is printed, from the territory sentence. So that is
      // what is asserted. A case written against "the tickets are different heights" would have
      // been red the moment it ran, for a reason that has nothing to do with this round.
      //
      // Asserted as VARIETY, never as values: pinning the numbers would fail the first time a
      // curator rewrote a card, and pinning them is itself the thing being guarded against.
      await openShop(page);
      await page.waitForTimeout(2000);
      const t = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('#fiction .shelf-card')];
        const entries = [...document.querySelectorAll('#fiction .shelf-entry')];
        return {
          tilts: [...new Set(cards.map((c) => getComputedStyle(c).transform))],
          cards: cards.length,
          entryHeights: [...new Set(entries.map((e) => Math.round(e.getBoundingClientRect().height)))],
          ticketHeights: [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().height)))],
        };
      });
      expect(t.cards, 'no shelf tickets are being drawn at all').toBeGreaterThan(1);
      expect(t.entryHeights.length,
        `every shelf entry is the same height (${t.entryHeights.join(', ')}) — the shelf's unevenness is a ruling`)
        .toBeGreaterThan(1);
      // The slant alternates by index, so a shelf of two or more must show both directions and
      // neither may be flat. That is the mechanism, not a screenshot of it.
      expect(t.tilts.length,
        `every shelf ticket has the same tilt (${t.tilts.join(' | ')}) — the alternating slant is a ruling`).toBe(2);
      expect(t.tilts.every((x) => x !== 'none'), `a shelf ticket lost its slant: ${t.tilts.join(' | ')}`).toBe(true);
      // …and the two are mirror images, which is what "alternating" means and what a stray
      // single-direction rotate would break.
      const skews = t.tilts.map((x) => parseFloat(/matrix\(([^,]+),\s*([^,]+)/.exec(x)[2]));
      expect(+(skews[0] + skews[1]).toFixed(6), `the two tilts are not mirror images: ${t.tilts.join(' | ')}`).toBe(0);
    });

    test('⛔ THE COVERS STILL LOAD LAZILY — an image arriving is not an animation', async ({ page }) => {
      // The other half of the ruling. R27 removed an animation; it must not have removed, or
      // been "fixed" by removing, the loading behaviour R20 budgeted and R26 left alone here.
      await openShop(page);
      await page.waitForTimeout(1500);
      const loading = await page.evaluate(() => [...new Set(
        [...document.querySelectorAll('#fiction .shelf-entry .bb-front img')].map((i) => i.getAttribute('loading')))]);
      expect(loading, `shelf covers must stay lazy — found loading=${JSON.stringify(loading)}`).toEqual(['lazy']);
    });
  });
}
