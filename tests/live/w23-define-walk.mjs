// W23 — THE DEFINE WALK, live and read-only. Opens a public sample in the Reading Room, selects a
// word, taps Define, and records what the reader sees and how long it took from tap to text.
//
//   node tests/live/w23-define-walk.mjs [--slug after-the-fact] [--words word1,word2]
//
// Signed out, behind the W17 firewall (tests/live/firewall.mjs): no write leaves the browser by
// any route. The keyholder pass is the localStorage flag the curtain reads, set before load.
// Prints the word, the outcome (senses / miss / still looking), the source line and the time.
import { chromium, webkit } from '@playwright/test';
import { liveContext, statsLine } from './firewall.mjs';
import { GATE_STORAGE_KEY } from '../../app/lib/bookstore/gate.js';

const SITE = process.env.LAUNCH_SITE || 'https://calvaryscribblings.co.uk';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const SLUG = arg('--slug', 'after-the-fact');
const WORDS = arg('--words', '').split(',').filter(Boolean).map((w) => (/^\d+$/.test(w) ? Number(w) : w));
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];

async function frameOf(page) {
  for (let i = 0; i < 100; i++) {
    const f = page.frames().find((fr) => /^https?:\/\/[^/]+\/reading-room(\.html)?(\?|$)/.test(fr.url()));
    if (f) return f;
    await page.waitForTimeout(200);
  }
  throw new Error('no reading-room frame');
}

/**
 * Select a word in the section the way a long-press leaves it. A string picks that word; a number
 * picks the n-th lowercase word of six letters or more in the rendered section.
 */
async function select(frame, want) {
  return frame.evaluate((w) => {
    const view = document.querySelector('foliate-view');
    let seen = 0;
    for (const c of view.renderer.getContents()) {
      const doc = c.doc;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const re = typeof w === 'string' ? new RegExp(`\\b${w}\\b`, 'gi') : /\b[a-z]{6,}\b/g;
        let m;
        while ((m = re.exec(node.nodeValue || ''))) {
          const range = doc.createRange();
          range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
          // Only a word the reader can SEE: foliate lays every column of the section out, and a
          // word in an off-screen column has a rect no finger could reach. Mapped into this
          // document's coordinates, it must sit clear of the chrome bands.
          const r = range.getBoundingClientRect();
          const f = doc.defaultView.frameElement?.getBoundingClientRect() || { left: 0, top: 0 };
          const x = r.left + f.left, y = r.top + f.top;
          if (!r.width || x < 0 || x + r.width > innerWidth || y < 110 || y > innerHeight - 110) continue;
          if (typeof w === 'number' && seen++ < w) continue;
          const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(range);
          return m[0];
        }
      }
    }
    return null;
  }, want);
}

async function walk(browserType, vp) {
  const browser = await browserType.launch();
  const { ctx, stats } = await liveContext(browser, { viewport: vp }, { site: SITE });
  await ctx.addInitScript(([k]) => { try { localStorage.setItem(k, '1'); } catch {} }, [GATE_STORAGE_KEY]);
  const page = await ctx.newPage();
  const out = [];
  try {
    await page.goto(`${SITE}/reader/${SLUG}?sample=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // The cookie notice sits over the cover; declining it is a local choice, not a write.
    await page.waitForTimeout(4000);
    await page.getByText('Decline', { exact: true }).click({ timeout: 3000 }).catch(() => {});
    await page.locator('.rr-ccta').click({ timeout: 30000 });
    const frame = await frameOf(page);
    await frame.waitForFunction(() => {
      const v = document.querySelector('foliate-view');
      return !!v?.renderer?.getContents?.()?.[0]?.doc?.body;
    }, null, { timeout: 60000 });
    await page.waitForTimeout(800);
    // Walk forward a couple of pages so a paragraph of prose is on screen, not the half-title.
    for (const want of (WORDS.length ? WORDS : [0, 4, 11])) {
      // Turn pages until the word is on screen (at 390 the first pages are the chapter's title).
      let word = await select(frame, want);
      for (let i = 0; !word && typeof want === 'number' && i < 15; i++) {
        await frame.evaluate(() => document.querySelector('foliate-view').next());
        await page.waitForTimeout(700);
        word = await select(frame, want);
      }
      if (!word) { out.push({ word: want, outcome: 'word not on these pages' }); continue; }
      const chip = frame.locator('#define-chip.show');
      const chipShown = await chip.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
      if (!chipShown) { out.push({ word, chip: false, outcome: 'NO CHIP' }); continue; }
      if (process.env.W23_SHOT) {
        const st = await page.evaluate(() => { const h = document.querySelector('.rr-top'); const r = h?.getBoundingClientRect(); return { top: r && [Math.round(r.top), Math.round(r.bottom)], vis: h && getComputedStyle(h).opacity + '/' + getComputedStyle(h).visibility + '/' + getComputedStyle(h).pointerEvents }; });
        const cr = await chip.boundingBox();
        console.log('chrome', JSON.stringify(st), 'chip', JSON.stringify(cr));
        await page.screenshot({ path: `${process.env.W23_SHOT}/${browserType.name()}-${vp.width}-${word}.png` });
      }
      const t0 = Date.now();
      await chip.click();
      const done = page.locator('.rr-define-senses, .rr-define-miss');
      const settled = await done.first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
      const ms = Date.now() - t0;
      const outcome = !settled ? 'still "Looking it up…" at 30 s'
        : (await page.locator('.rr-define-senses').count()) ? `${await page.locator('.rr-define-sense').count()} sense(s)` : 'miss';
      const src = (await page.locator('.rr-define-src').first().textContent().catch(() => '')) || '';
      const first = (await page.locator('.rr-define-def').first().textContent({ timeout: 500 }).catch(() => '')) || '';
      out.push({ word, chip: true, outcome, ms, src: src.trim(), first: first.slice(0, 70) });
      // Closing the modal leaves the chrome up for its idle period (CHROME_IDLE_MS, 3.5 s), and a
      // chip on the top line sits under it until then. Wait it out, as a reader's eye would.
      await page.keyboard.press('Escape'); await page.waitForTimeout(4500);
    }
  } catch (e) {
    out.push({ error: String(e.message || e).split('\n').filter((l) => /Timeout|intercepts|not visible|outside/.test(l)).slice(0, 3).join(' | ') });
  }
  await browser.close();
  return { engine: browserType.name(), vp: `${vp.width}`, out, fw: statsLine(stats) };
}

for (const bt of (process.env.W23_ENGINES === 'chromium' ? [chromium] : [chromium, webkit])) for (const vp of VIEWPORTS) {
  const r = await walk(bt, vp);
  console.log(`\n── ${r.engine} @ ${r.vp} ──`);
  for (const o of r.out) console.log(JSON.stringify(o));
  console.log(`firewall: ${r.fw}`);
}
