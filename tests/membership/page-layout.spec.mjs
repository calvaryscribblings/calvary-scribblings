// W27 — /membership, redrawn (rulings 109, 110): the drawing's geometry, measured in the built page.
//
//   npm run test:membership-layout        (over out/: run `npx next build` first)
//
// Signed out, over the static export, in whichever state the build carries (MEMBERSHIPS_ON_SALE:
// shut on main, open on the 6b merge). The member states — YOUR PLAN, SWITCH TO, MANAGE — need a
// signed-in reader and are measured against the emulator in page-member.spec.mjs.
import { test, expect } from '@playwright/test';
import { MEMBERSHIPS_ON_SALE } from '../../app/lib/membershipPrices.js';

const WIDTHS = [1440, 1280, 1000, 820, 390, 360, 320];
const PHONES = [390, 360, 320];

async function open(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/membership');
  await expect(page.locator('.mb-h1')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

/** The top of each of the nine rows, per column. The absolutely placed YOUR PLAN is not a row. */
const rowTops = (page) => page.locator('.mb-grid > .mb-card').evaluateAll((cards) => cards.map((c) =>
  [...c.children].filter((el) => getComputedStyle(el).position !== 'absolute').map((el) => el.getBoundingClientRect().top)));

test('at 1440 the nine rows sit level across the three columns, within 0.5px', async ({ page }) => {
  await open(page, 1440);
  const cols = await rowTops(page);
  expect(cols).toHaveLength(3);
  for (const c of cols) expect(c).toHaveLength(9);
  const worst = Math.max(...cols[0].map((_, r) => Math.max(...cols.map((c) => c[r])) - Math.min(...cols.map((c) => c[r]))));
  console.log(`\n=== 1440, ${MEMBERSHIPS_ON_SALE ? 'open' : 'shut'}: worst row misalignment ${worst.toFixed(3)}px ===\n`);
  expect(worst).toBeLessThanOrEqual(0.5);
});

test('at 1440 the paid actions are the same width', async ({ page }) => {
  await open(page, 1440);
  const sel = MEMBERSHIPS_ON_SALE ? '.mb-grid .mb-btn' : '.mb-grid .mb-flat';
  const widths = await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  console.log(`\n=== 1440 paid actions (${sel}): ${widths.map((w) => w.toFixed(2)).join(' / ')} ===\n`);
  expect(widths).toHaveLength(2);
  expect(Math.abs(widths[0] - widths[1])).toBeLessThanOrEqual(0.5);
  if (MEMBERSHIPS_ON_SALE) expect(widths[0]).toBeGreaterThanOrEqual(240);
});

for (const w of WIDTHS) {
  test(`at ${w}: no horizontal scroll, and no rendered line begins with a dash`, async ({ page }) => {
    await open(page, w);
    for (const cur of ['£ GBP', '₦ NGN']) {
      await page.getByRole('group', { name: 'Currency' }).getByRole('button', { name: cur, exact: true }).click();
      for (const iv of ['MONTHLY', 'YEARLY']) {
        await page.getByRole('group', { name: 'Billing period' }).getByRole('button', { name: iv, exact: true }).click();
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(scroll, `${cur} ${iv}: the page scrolls sideways by ${scroll}px`).toBeLessThanOrEqual(0);
        // Every visible character of the page body, grouped into rendered lines per block: the
        // first character of each line must not be a dash.
        const bad = await page.evaluate(() => {
          const root = document.querySelector('.mb-body');
          const blockOf = (n) => { let e = n.parentElement; while (e && getComputedStyle(e).display === 'inline') e = e.parentElement; return e; };
          const firsts = new Map();
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const r = document.createRange();
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const t = n.nodeValue;
            const block = blockOf(n);
            for (let i = 0; i < t.length; i++) {
              if (/\s/.test(t[i])) continue;
              r.setStart(n, i); r.setEnd(n, i + 1);
              const b = r.getBoundingClientRect();
              if (!b.width && !b.height) continue;
              if (!firsts.has(block)) firsts.set(block, new Map());
              const lines = firsts.get(block);
              const key = Math.round(b.top);
              if (![...lines.keys()].some((k) => Math.abs(k - key) <= 3)) lines.set(key, { ch: t[i], ctx: t.slice(i, i + 24) });
            }
          }
          const out = [];
          for (const lines of firsts.values()) for (const { ch, ctx } of lines.values()) if (/[—–-]/.test(ch)) out.push(ctx);
          return out;
        });
        expect(bad, `${cur} ${iv}: lines beginning with a dash`).toEqual([]);
      }
    }
  });
}

for (const w of PHONES) {
  test(`at ${w} the h1 stays on two lines`, async ({ page }) => {
    await open(page, w);
    const lines = await page.locator('.mb-h1').evaluate((h) => {
      const tops = new Set();
      const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
      const r = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        for (let i = 0; i < n.nodeValue.length; i++) {
          if (/\s/.test(n.nodeValue[i])) continue;
          r.setStart(n, i); r.setEnd(n, i + 1);
          tops.add(Math.round(r.getBoundingClientRect().top));
        }
      }
      return tops.size;
    });
    expect(lines).toBe(2);
  });
}

test('the naira prices render in Cormorant Garamond (CDP getPlatformFontsForNode)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP is Chromium-only');
  await open(page, 1440);
  await page.getByRole('group', { name: 'Currency' }).getByRole('button', { name: '₦ NGN', exact: true }).click();
  await page.waitForTimeout(200);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.mb-price' });
  const report = [];
  for (const nodeId of nodeIds) {
    const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId });
    if (!/₦/.test(outerHTML)) continue;
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    report.push({ price: outerHTML.replace(/<[^>]+>/g, ''), fonts: fonts.map((f) => `${f.familyName} ×${f.glyphCount}`) });
    for (const f of fonts) expect(f.familyName, `${outerHTML}: a glyph fell back to ${f.familyName}`).toMatch(/Cormorant Garamond/);
  }
  console.log(`\n=== naira prices ===\n${report.map((r) => `${r.price}: ${r.fonts.join(', ')}`).join('\n')}\n`);
  expect(report.length).toBeGreaterThanOrEqual(3);
});

test('the built page carries no founding copy, even in its style block', async ({ request }) => {
  const html = await (await request.get('/membership')).text();
  expect(html).not.toMatch(/founding/i);
});
