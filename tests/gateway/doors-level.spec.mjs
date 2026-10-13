// W40, RULING 149 — THE TWO DOORS LINE UP. On iPad and laptop the Library door's title wraps onto
// two lines and the Book Store's doesn't; before W40 that left the count lines 10–11px apart and
// the glyphs out of level. Now the doors share one grid's rows (app/components/Gateway.js).
//
// At 820, 1180 and 1280 wide, with and without "The Square is open tonight ✦" (London 20:00–24:00,
// forced here by the page clock): the doors are one height, nothing is clipped, the glyphs and the
// count lines are level, and each count line sits the same distance under its own title. At 390
// the doors are stacked bands and the brief changes nothing; the distance under the title is held.
//
// Over the built export (out/), so this is the HTML Cloudflare serves.
import { test, expect } from '@playwright/test';

const mute = async (page) => {
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  await page.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (r.request().method() !== 'GET' || (u.hostname !== '127.0.0.1' && !/fonts\.(googleapis|gstatic)/.test(u.hostname))) return r.abort();
    return r.continue();
  });
};

async function measure(page) {
  return page.evaluate(() => [...document.querySelectorAll('.cs-gw-doors > .cs-gw-door')].map((door) => {
    const box = (sel) => door.querySelector(sel)?.getBoundingClientRect() || null;
    const t = box('.cs-gw-door-title'); const m = box('.cs-gw-door-meta'); const g = box('.cs-gw-door-glyph');
    return {
      height: door.getBoundingClientRect().height,
      clipped: door.scrollHeight > door.clientHeight + 0.5,
      glyphTop: g.top, titleBottom: t.bottom, metaTop: m ? m.top : null,
      gap: m ? m.top - t.bottom : null,
      square: !!door.querySelector('.cs-gw-door-square'),
    };
  }));
}

for (const square of [false, true]) {
  for (const [w, h] of [[820, 1180], [1180, 820], [1280, 800]]) {
    test(`${w} wide${square ? ', the Square open' : ''}: one height, glyphs and count lines level`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.clock.setFixedTime(new Date(square ? '2026-10-13T20:00:00Z' : '2026-10-13T11:00:00Z'));
      await mute(page);
      await page.goto('/');
      // The Square line is set by an effect after the first paint; wait for the settled doors.
      if (square) await page.locator('.cs-gw-doors.has-square .cs-gw-door-square').waitFor();
      await page.evaluate(() => document.fonts.ready);
      const [lib, store] = await measure(page);
      expect(lib.square).toBe(square);
      expect(store.metaTop, 'the Book Store door carries its count line').not.toBeNull();
      expect(Math.abs(lib.height - store.height)).toBeLessThan(0.5);
      expect(lib.clipped || store.clipped).toBe(false);
      expect(Math.abs(lib.glyphTop - store.glyphTop)).toBeLessThan(0.5);
      expect(Math.abs(lib.metaTop - store.metaTop)).toBeLessThan(0.5);
      // Each title directly above its own count line, the same distance on both doors.
      expect(Math.abs(lib.gap - store.gap)).toBeLessThan(0.5);
      expect(lib.gap).toBeGreaterThanOrEqual(0);
      expect(lib.gap).toBeLessThan(10);
    });
  }
}

test('390 wide: stacked bands, each count line the same distance under its title', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mute(page);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const [lib, store] = await measure(page);
  expect(Math.abs(lib.gap - store.gap)).toBeLessThan(0.5);
  expect(lib.height).toBe(store.height);
});
