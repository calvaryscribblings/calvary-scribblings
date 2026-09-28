// W24 — THE POST-DEPLOY CHECK, live and read-only. Signed out, behind the W17 firewall
// (tests/live/firewall.mjs): nothing leaves the browser that could write, by any route.
//
//   node tests/live/w24-live-check.mjs
//
// 1. "saw" and "left" show both groups — asked of the DEPLOYED Reading Room: the frame posts the
//    same defineWord message the chip posts, and the modal is read back.
// 2. "grand isle" gets the chip in its book (The Awakening's sample) — a real selection.
// 3. Printing shows the one line (print media on the live reader page, and in its frame).
// 4. A long copy is trimmed to fifty words and credited to the title.
// 5. A signed-out Reply tap on a story's response opens the sign-in prompt.
import { chromium, webkit } from '@playwright/test';
import { liveContext, statsLine } from './firewall.mjs';
import { GATE_STORAGE_KEY } from '../../app/lib/bookstore/gate.js';
import { PRINT_LINE } from '../../app/lib/readerCopy.js';
import { DICT_SOURCE } from '../../app/lib/dictionary.js';

const SITE = process.env.LAUNCH_SITE || 'https://calvaryscribblings.co.uk';
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const results = [];
const record = (engine, check, ok, detail) => { results.push({ engine, check, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${engine}] ${check} — ${detail}`); };

const frameOf = async (page) => {
  for (let i = 0; i < 150; i++) {
    const f = page.frames().find((fr) => /^https?:\/\/[^/]+\/reading-room(\.html)?(\?|$)/.test(fr.url()));
    if (f) return f;
    await page.waitForTimeout(200);
  }
  throw new Error('no reading-room frame');
};

async function openSample(ctx, slug) {
  const page = await ctx.newPage();
  await page.goto(`${SITE}/reader/${slug}?sample=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.getByText('Decline', { exact: true }).click({ timeout: 3000 }).catch(() => {});
  await page.locator('.rr-ccta').click({ timeout: 30000 });
  const frame = await frameOf(page);
  await frame.waitForFunction(() => !!document.querySelector('foliate-view')?.renderer?.getContents?.()?.[0]?.doc?.body, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  return { page, frame };
}

async function run(bt) {
  const engine = bt.name();
  const browser = await bt.launch();
  const { ctx, stats } = await liveContext(browser, { viewport: { width: 390, height: 844 } }, { site: SITE });
  await ctx.addInitScript(([k]) => { try { localStorage.setItem(k, '1'); } catch {} }, [GATE_STORAGE_KEY]);
  try {
    // ── 1. groups ──────────────────────────────────────────────────────────────────────────
    {
      const { page, frame } = await openSample(ctx, 'after-the-fact');
      for (const [word, want] of [['saw', ['saw', 'see']], ['left', ['left', 'leave']]]) {
        const t0 = Date.now();
        await frame.evaluate((w) => window.parent.postMessage({ type: 'defineWord', word: w, sentence: '' }, location.origin), word);
        await page.locator('.rr-define-senses').first().waitFor({ timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(300);
        const heads = await page.locator('.rr-define-word').allTextContents();
        const src = (await page.locator('.rr-define-src').first().textContent().catch(() => '')) || '';
        const n = await page.locator('.rr-define-sense').count();
        record(engine, `"${word}" shows both groups`, JSON.stringify(heads) === JSON.stringify(want) && src === DICT_SOURCE && n <= 6,
          `headings ${JSON.stringify(heads)}, ${n} senses, "${src}", ${Date.now() - t0} ms`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
      // ── 3. print ─────────────────────────────────────────────────────────────────────────
      await page.emulateMedia({ media: 'print' });
      const pr = await page.evaluate(() => ({ line: getComputedStyle(document.body, '::before').content, text: document.body.innerText.trim() }));
      const fr = await frame.evaluate(() => ({ line: getComputedStyle(document.body, '::before').content, view: getComputedStyle(document.querySelector('foliate-view')).display }));
      record(engine, 'printing shows the one line', pr.line === JSON.stringify(PRINT_LINE) && pr.text === '' && fr.line === JSON.stringify(PRINT_LINE) && fr.view === 'none',
        `page ${pr.line} (other text: ${pr.text.length} chars); frame ${fr.line}, book ${fr.view}`);
      await page.emulateMedia({ media: 'screen' });
      // ── 4. copy ──────────────────────────────────────────────────────────────────────────
      const title = await page.locator('.rr-frame').getAttribute('title');
      const cp = await frame.evaluate(() => {
        const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
        const r = doc.createRange(); r.selectNodeContents(doc.body);
        const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        const dt = new DataTransfer();
        doc.body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
        sel.removeAllRanges();
        return { selected: String(r).trim().split(/\s+/).length, text: dt.getData('text/plain') };
      });
      const lines = cp.text.split('\n'); const credit = lines.pop();
      const copied = lines.join(' ').trim().split(/\s+/).length;
      record(engine, 'a long copy is trimmed and credited', cp.selected > 50 && copied === 50 && credit.startsWith(`— from ${title}`) && credit.endsWith('· Calvary Scribblings'),
        `${cp.selected} words selected → ${copied} copied; "${credit}"`);
      await page.close();
    }
    // ── 2. the glossary phrase ─────────────────────────────────────────────────────────────
    {
      const { page, frame } = await openSample(ctx, 'the-awakening');
      let picked = null;
      for (let i = 0; i < 40 && !picked; i++) {
        picked = await frame.evaluate(() => {
          const view = document.querySelector('foliate-view');
          for (const c of view.renderer.getContents()) {
            const doc = c.doc;
            const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = w.nextNode())) {
              const m = /Grand\s+Isle/.exec(n.nodeValue || '');
              if (!m) continue;
              const r = doc.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
              const b = r.getBoundingClientRect();
              const f = doc.defaultView.frameElement?.getBoundingClientRect() || { left: 0, top: 0 };
              if (!b.width || b.left + f.left < 0 || b.right + f.left > innerWidth || b.top + f.top < 110 || b.bottom + f.top > innerHeight - 110) continue;
              const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(r);
              return m[0];
            }
          }
          return null;
        });
        if (!picked) { await frame.evaluate(() => document.querySelector('foliate-view').next()); await page.waitForTimeout(700); }
      }
      if (!picked) record(engine, '"grand isle" gets the chip', false, 'the phrase was not reached in the sample');
      else {
        const shown = await frame.locator('#define-chip.show').waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
        let def = '';
        if (shown) {
          await page.waitForTimeout(3700);                      // let the chrome retire, as a reader's eye would
          await frame.locator('#define-chip').click({ timeout: 5000 }).catch(() => frame.evaluate(() => document.getElementById('define-chip').click()));
          await page.locator('.rr-define-senses').first().waitFor({ timeout: 10000 }).catch(() => {});
          def = `${(await page.locator('.rr-define-word').first().textContent()) || ''} / ${(await page.locator('.rr-define-src').first().textContent().catch(() => '')) || ''}`;
        }
        record(engine, '"grand isle" gets the chip', shown && /House glossary/.test(def), `selected "${picked}" → chip ${shown ? 'shown' : 'NOT shown'}; ${def}`);
      }
      await page.close();
    }
    // ── 5. Reply, signed out ───────────────────────────────────────────────────────────────
    {
      const shallow = await (await fetch(`${DB}/comments.json?shallow=true`)).json();
      let slug = null;
      for (const s of Object.keys(shallow || {}).sort()) {
        const all = await (await fetch(`${DB}/comments/${encodeURIComponent(s)}.json`)).json();
        if (Object.values(all || {}).some((c) => c && c.text && !c.parentId && !c.deletedAt)) {
          const r = await fetch(`${SITE}/stories/${s}`, { method: 'HEAD' });
          if (r.ok) { slug = s; break; }
        }
      }
      const page = await ctx.newPage();
      await page.goto(`${SITE}/stories/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByText('Decline', { exact: true }).click({ timeout: 6000 }).catch(() => {});
      const first = page.locator('.cs-comments-list .cs-comment').first();
      await first.scrollIntoViewIfNeeded({ timeout: 45000 });
      await first.locator('.cs-reply-btn').click({ timeout: 15000 });
      const ok = await page.locator('.auth-modal').waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      record(engine, 'a signed-out Reply opens the prompt', ok, `/stories/${slug}: ${ok ? 'AuthModal open' : 'no prompt'}`);
      await page.close();
    }
  } catch (e) {
    record(engine, 'harness', false, String(e.message || e).split('\n')[0]);
  }
  console.log(`[${engine}] firewall: ${statsLine(stats)}`);
  await browser.close();
}

for (const bt of [chromium, webkit]) await run(bt);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} passed`);
process.exit(failed ? 1 : 0);
