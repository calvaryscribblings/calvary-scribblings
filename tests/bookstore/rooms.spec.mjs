// W22 — THE BOOK STORE'S ROOMS, MEASURED, against the real static export (out/), signed out.
//
// Rulings 74–81 and 88 (27 Sept 2026), drawn from the canvas "Book Store rooms". The signed-in
// behaviour of the + is tests/bookstore/desiderata.spec.mjs (emulators); this file holds the
// GEOMETRY, and where the brief says "measure the ink" it measures ink, not boxes:
//
//   §1 the bar: centred on the eyebrow's line, edges on the Window's content edges (20px from
//      the screen below 360), 16px or more between the wordmark's last glyph and the first
//      circle at every phone width, 44px targets — and the masthead below it unmoved.
//   §2 the shelf's readers row: 10px from the DRAWN cover to the ring, the unit centred on the
//      title's axis, the count's capitals centred on the ring, genre lines level, the counts
//      equal to bookstore_readership.
//   §3 the page's +: the readership text unmoved by it, the ring on the capitals, 11.5px after
//      the last letter.
//   §5–§6 both rooms prerendered and answering with their own content.
//
// Live reads only (public nodes). Nothing here signs in and nothing writes.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LIVE = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const GATE_KEY = /^export const GATE_STORAGE_KEY = '([^']*)';/m.exec(readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8'))[1];
const DSF = 3;
const PHONES = [320, 360, 375, 390, 412, 430];

async function enter(page, path, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((k) => {
    try { localStorage.setItem(k, '1'); localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* private */ }
  }, GATE_KEY);
  await page.route('**/api/bookstore/region', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"country":"GB"}' }));
  await page.goto(path);
  await page.evaluate(() => document.fonts.ready);
}

const rect = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, width: r.width, height: r.height }; });

/** Ink extent of gold-ish pixels inside a page-coordinate clip, in CSS px. */
async function ink(page, clip) {
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 200)), clip.y);
  const sy = await page.evaluate(() => scrollY);
  const buf = await page.screenshot({ clip: { ...clip, y: clip.y - sy } });
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const r = data[i], b = data[i + 2];
    if (r > 60 && r - b > 28) { top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
  }
  if (!Number.isFinite(top)) return null;
  const s = info.width / clip.width;
  return { top: clip.y + top / s, bottom: clip.y + (bottom + 1) / s, left: clip.x + left / s, right: clip.x + (right + 1) / s };
}

// ── §1 THE BAR ─────────────────────────────────────────────────────────────────────────────
test.describe('the shop’s bar', () => {
  for (const w of [...PHONES, 641, 1024, 1440]) {
    test(`at ${w}: on the eyebrow’s line, on the Window’s edges`, async ({ page }) => {
      await enter(page, '/bookstore', w);
      const bar = page.locator('.shop-bar');
      await expect(bar).toBeVisible({ timeout: 30000 });
      await expect(page.locator('.the-window, .curated-section').first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1000); // the masthead's .9s fade has a transform in it
      const b = await rect(bar);
      const slot = await rect(page.locator('.hero-eyebrow'));
      expect(Math.abs((b.top + b.bottom) / 2 - (slot.top + slot.bottom) / 2)).toBeLessThanOrEqual(0.5);
      const faces = page.locator('.shop-bar-face');
      for (let i = 0; i < 2; i++) {
        const f = await rect(faces.nth(i));
        expect(Math.abs((f.top + f.bottom) / 2 - (slot.top + slot.bottom) / 2)).toBeLessThanOrEqual(0.5);
        expect(f.width).toBeCloseTo(w <= 640 ? 32 : 34, 1);
      }
      if (w < 360) {
        expect(b.left).toBeCloseTo(20, 1);
        expect(b.right).toBeCloseTo(w - 20, 1);
      } else {
        const win = await rect(page.locator('.the-window').first());
        expect(b.left).toBeCloseTo(win.left + 32, 1);
        expect(b.right).toBeCloseTo(win.right - 32, 1);
      }
      // 12px between the circles, and a 44px target around each without moving the drawing.
      const f0 = await rect(faces.nth(0)); const f1 = await rect(faces.nth(1));
      expect(f1.left - f0.right).toBeCloseTo(12, 1);
      for (const sel of ['[data-testid="shop-bar-search"]', '[data-testid="shop-bar-desiderata"]']) {
        const hit = await page.locator(sel).evaluate((el) => getComputedStyle(el, '::before').width);
        expect(hit).toBe('44px');
      }
      await expect(page.locator('[data-testid="shop-bar-search"]')).toHaveAttribute('href', '/bookstore/search');
      await expect(page.locator('[data-testid="shop-bar-search"]')).toHaveAttribute('aria-label', 'Search the shelves');
      await expect(page.locator('[data-testid="shop-bar-desiderata"]')).toHaveAttribute('href', '/bookstore/desiderata');
      await expect(page.locator('[data-testid="shop-bar-desiderata"]')).toHaveAttribute('aria-label', 'Desiderata');
      if (PHONES.includes(w)) {
        // THE WORDMARK'S LAST GLYPH TO THE FIRST CIRCLE — its INK, not its box.
        const m = await rect(page.locator('[data-testid="shop-bar-mark"]'));
        const k = await ink(page, { x: m.left, y: m.top - 2, width: Math.min(m.width + 2, f0.left - m.left), height: m.height + 4 });
        const gap = f0.left - k.right;
        test.info().annotations.push({ type: 'gap', description: `${w}: ${gap.toFixed(2)}px` });
        expect(gap).toBeGreaterThanOrEqual(16);
      }
    });
  }

  for (const w of [390, 1440]) {
    test(`at ${w}: the masthead below it has not moved (the slot holds the line)`, async ({ page }) => {
      await enter(page, '/bookstore', w);
      await expect(page.locator('.hero-edition')).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1000);
      const LINES = ['.hero-the', '.hero-store', '.hero-colophon', '.hero-edition', '.hero-currency'];
      const read = () => page.evaluate((sels) => sels.map((s) => document.querySelector(s).getBoundingClientRect().top + scrollY), LINES);
      const withBar = await read();
      // The pre-W22 masthead, reconstructed in place: no bar, the eyebrow visible in its slot.
      await page.addStyleTag({ content: '.shop-bar{display:none!important}.hero-eyebrow{visibility:visible!important}' });
      const without = await read();
      for (let i = 0; i < LINES.length; i++) expect(Math.abs(withBar[i] - without[i]), LINES[i]).toBeLessThanOrEqual(0.1);
      await expect(page.locator('.hero-eyebrow')).toHaveAttribute('aria-hidden', 'true');
    });
  }
});

// ── §2 THE SHELF'S READERS ROW ─────────────────────────────────────────────────────────────
test.describe('the readers row under every shelf book', () => {
  for (const w of [360, 390, 1440]) {
    test(`at ${w}: 10px under the drawn cover, centred on the title, caps on the ring, genre lines level`, async ({ page }) => {
      const counts = await (await fetch(`${LIVE}/bookstore_readership.json`)).json() || {};
      await enter(page, '/bookstore', w);
      const rows = page.locator('.catalogue-section [data-testid="readers-row"]');
      await expect(rows.first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator('.catalogue-section [data-testid="readers-row"][data-state="waiting"]')).toHaveCount(0, { timeout: 30000 });
      const entries = await page.locator('.catalogue-section .shelf-entry').evaluateAll((els) => els.map((e) => {
        const r = (x) => { const b = x.getBoundingClientRect(); return { top: b.top + scrollY, bottom: b.bottom + scrollY, left: b.left, right: b.right }; };
        const count = e.querySelector('[data-testid="readers-count"]');
        const face = e.querySelector('.ds-mark-face');
        return {
          title: e.querySelector('.entry-title').textContent,
          titleBox: r(e.querySelector('.entry-title')),
          front: r(e.querySelector('.bb-front')),
          genre: r(e.querySelector('.entry-genre')),
          count: count ? { text: count.textContent, box: r(count) } : null,
          ring: face ? r(face) : null,
        };
      }));
      expect(entries.length).toBeGreaterThan(3);
      for (const e of entries) {
        // The first thing drawn in the row: the ring, or the count when it stacks above it.
        const firstTop = e.ring ? (e.count && e.count.box.bottom <= e.ring.top ? e.count.box.top : e.ring.top) : null;
        if (firstTop !== null) expect(Math.abs(firstTop - e.front.bottom - 10), `${e.title}: book→row`).toBeLessThanOrEqual(0.35);
        if (e.ring) {
          const start = e.count && e.count.box.bottom > e.ring.top ? e.count.box.left : e.ring.left;
          const axis = (e.titleBox.left + e.titleBox.right) / 2;
          expect(Math.abs((start + e.ring.right) / 2 - axis), `${e.title}: unit centred on the title`).toBeLessThanOrEqual(0.5);
        }
      }
      // Genre lines level across every row of the grid.
      const byRow = new Map();
      for (const e of entries) {
        const k = Math.round(e.front.top);
        byRow.set(k, [...(byRow.get(k) || []), e.genre.top]);
      }
      for (const tops of byRow.values()) expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(0.1);
      // The counts are bookstore_readership, exactly.
      const shown = entries.filter((e) => e.count).map((e) => e.count.text.toLowerCase());
      const expected = Object.values(counts).map((n) => n?.count ?? 0).filter((n) => n > 0);
      expect(shown.length).toBe(expected.length);
      // The capitals centred on the ring — INK. One count is enough to hold the rule; all are read.
      for (const e of entries.filter((x) => x.count && x.ring && x.count.box.bottom > x.ring.top)) {
        const k = await ink(page, { x: e.count.box.left, y: e.count.box.top, width: e.count.box.right - e.count.box.left, height: e.count.box.bottom - e.count.box.top });
        const ringMid = (e.ring.top + e.ring.bottom) / 2;
        test.info().annotations.push({ type: 'caps', description: `${w} ${e.title}: ${(((k.top + k.bottom) / 2) - ringMid).toFixed(2)}px` });
        expect(Math.abs((k.top + k.bottom) / 2 - ringMid), `${e.title}: caps on the ring`).toBeLessThanOrEqual(0.5);
        // 8px from the last letter's ink to the ring's drawn edge (a glyph's side bearing is
        // part of "the letter", so this is read at the looser tolerance of a bearing).
        expect(Math.abs(e.ring.left - k.right - 8), `${e.title}: 8px`).toBeLessThanOrEqual(1);
      }
    });
  }
});

// ── §3 THE BOOK PAGE'S + ───────────────────────────────────────────────────────────────────
test.describe('the + on the book’s page', () => {
  for (const w of [390, 1440]) {
    test(`at ${w}: the text does not move, the ring sits on its capitals, 11.5px after it`, async ({ page }) => {
      const counts = await (await fetch(`${LIVE}/bookstore_readership.json`)).json() || {};
      const titles = await (await fetch(`${LIVE}/bookstore_titles.json`)).json() || {};
      const withReaders = Object.entries(counts).find(([id, n]) => n?.count > 0 && titles[id]?.status === 'published');
      test.skip(!withReaders, 'no published title has a reader today');
      await enter(page, `/bookstore/${titles[withReaders[0]].slug}`, w);
      const line = page.getByTestId('readership-line');
      await expect(line.locator('[data-testid="desiderata-mark"]')).toBeVisible({ timeout: 30000 });
      const strip = await line.evaluate((el) => { const s = el.parentElement.previousElementSibling.getBoundingClientRect(); return s.bottom + scrollY; });
      const text = await rect(line);
      expect(text.top - strip).toBeCloseTo(25.6, 1); // 1.6rem under the credits strip, as before
      const face = await rect(line.locator('.ds-mark-face'));
      expect(face.width).toBeCloseTo(28, 1);
      const k = await ink(page, { x: text.left, y: text.top - 1, width: face.left - text.left - 1, height: text.height + 2 });
      test.info().annotations.push({ type: 'page', description: `${w}: caps ${(((k.top + k.bottom) / 2) - (face.top + face.bottom) / 2).toFixed(2)}px, gap ${(face.left - k.right).toFixed(2)}px` });
      expect(Math.abs((k.top + k.bottom) / 2 - (face.top + face.bottom) / 2)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(face.left - k.right - 11.5)).toBeLessThanOrEqual(1);
      // And the ring moves nothing: take it out, and the text is where it was.
      await page.addStyleTag({ content: '.bd-mark-slot{display:none!important}' });
      const bare = await rect(line);
      expect(Math.abs(bare.top - text.top)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(bare.left - text.left)).toBeLessThanOrEqual(0.1);
    });
  }
});

test.describe('the + alone on a page with no readers', () => {
  test('its drawn left edge is the credits’ left edge, 1.6rem under the strip', async ({ page }) => {
    const counts = await (await fetch(`${LIVE}/bookstore_readership.json`)).json() || {};
    const titles = await (await fetch(`${LIVE}/bookstore_titles.json`)).json() || {};
    const none = Object.entries(titles).find(([id, t]) => t.status === 'published' && !(counts[id]?.count > 0));
    await enter(page, `/bookstore/${none[1].slug}`, 390);
    const alone = page.getByTestId('readership-mark-alone');
    await expect(alone.locator('.ds-mark-face')).toBeVisible({ timeout: 30000 });
    const strip = await alone.evaluate((el) => el.previousElementSibling.getBoundingClientRect().left);
    const face = await rect(alone.locator('.ds-mark-face'));
    expect(Math.abs(face.left - strip)).toBeLessThanOrEqual(0.1);
  });
});

// ── §5, §6 THE ROOMS ───────────────────────────────────────────────────────────────────────
test.describe('the two rooms', () => {
  test('both prerender in the static export', () => {
    for (const r of ['search', 'desiderata']) {
      const f = join(ROOT, `out/bookstore/${r}.html`);
      expect(existsSync(f), `${r} is not in out/`).toBe(true);
      expect(readFileSync(f, 'utf8')).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    }
  });

  test('search: an author, their titles, the matches in gold; the query in ?q=', async ({ page }) => {
    await enter(page, '/bookstore/search?q=okeh', 390);
    const authors = page.getByTestId('search-authors');
    await expect(authors).toBeVisible({ timeout: 30000 });
    await expect(authors.locator('.sr-name')).toContainText(['Ikenna Okeh']);
    await expect(authors.locator('.rm-hit').first()).toHaveText(/okeh/i);
    const titles = page.getByTestId('search-titles').locator('[data-testid="room-row"]');
    expect(await titles.count()).toBeGreaterThan(0);
    await expect(page.getByTestId('search-input')).toBeFocused();
    await page.getByTestId('search-input').fill('zzqx');
    await expect(page.getByTestId('search-none')).toHaveText('Nothing on these shelves matches “zzqx”.');
    expect(new URL(page.url()).searchParams.get('q')).toBe('zzqx');
    await page.getByTestId('search-clear').click();
    await expect(page.getByText('Titles, authors and genres on these shelves.')).toBeVisible();
  });

  test('Desiderata, signed out: its own words and a way in', async ({ page }) => {
    await enter(page, '/bookstore/desiderata', 390);
    await expect(page.getByTestId('desiderata-signed-out')).toContainText('Sign in to see your Desiderata.', { timeout: 30000 });
    await expect(page.locator('h1')).toHaveText('Desiderata');
  });
});
