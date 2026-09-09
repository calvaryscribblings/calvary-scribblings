// R46 — WHAT ACTUALLY PAINTS on the island's index. See the config header for why.
import { test, expect } from '@playwright/test';

// The two phone widths the round is judged at, plus desktop.
const WIDTHS = [390, 430, 1280];

async function rest(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/search', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('.ix-subj').length > 10, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

test.describe('the resting index', () => {
  for (const width of WIDTHS) {
    test(`a subject never breaks mid-name at ${width}`, async ({ page }) => {
      await rest(page, width);
      const bad = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.ix-subj')) {
          const label = el.querySelector('span');
          if (!label) continue;
          // A label that wrapped occupies more than one client rect. This is the direct
          // question — not "is nowrap set" but "did this name come apart".
          const rects = label.getClientRects();
          const lh = parseFloat(getComputedStyle(label).fontSize) * 2.2;
          const r = label.getBoundingClientRect();
          if (rects.length > 1 || r.height > lh) {
            out.push({ text: label.textContent, rects: rects.length, h: Math.round(r.height) });
          }
        }
        return out;
      });
      expect(bad, `subject(s) broke mid-name: ${JSON.stringify(bad)}`).toEqual([]);

      // Non-vacuous: the multi-word subjects — the ones that can actually break — are present.
      const labels = await page.locator('.ix-subj > span:first-child').allTextContents();
      for (const must of ['Slice of Life', 'Personal Essay', 'Loss & Recovery', 'Spoken Word']) {
        expect(labels, `${must} is not on the index — the break test proves less than it should`)
          .toContain(must);
      }
    });

    test(`nothing overflows the page at ${width}`, async ({ page }) => {
      await rest(page, width);
      const overflow = await page.evaluate((w) => {
        const out = [];
        for (const el of document.querySelectorAll('.ix-subj, .ix-form, .ix-voice, .ix-title')) {
          const r = el.getBoundingClientRect();
          if (r.right > w + 0.5 || r.left < -0.5) out.push({ t: el.textContent.trim().slice(0, 28), right: Math.round(r.right) });
        }
        return out;
      }, width);
      expect(overflow, `clipped at ${width}: ${JSON.stringify(overflow)}`).toEqual([]);
      const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollW, 'the page scrolls horizontally').toBeLessThanOrEqual(width + 1);
    });
  }

  test('the counts set in OLDSTYLE, and the font that carries them actually loaded', async ({ page }) => {
    await rest(page, 390);
    // 1. The font is really there. font-variant-numeric is inert on a fallback and fails
    //    silently to lining figures, which is the whole risk.
    const loaded = await page.evaluate(() => document.fonts.check('1rem "Cormorant Garamond"'));
    expect(loaded, 'Cormorant Garamond did not load — every count is setting in the fallback').toBe(true);

    // 2. The property is applied where the counts are.
    const applied = await page.evaluate(() =>
      [...document.querySelectorAll('.ix-form-n, .ix-subj-n, .ix-kicker-n')]
        .map((el) => getComputedStyle(el).fontVariantNumeric));
    expect(applied.length).toBeGreaterThan(10);
    expect(applied.every((v) => v.includes('oldstyle'))).toBe(true);

    // 3. ⭑ AND IT ACTUALLY CHANGES THE GLYPHS. Oldstyle figures have ascenders and
    //    descenders; lining figures all stand at cap height. Measuring the same digits with
    //    and without the feature must give a DIFFERENT ink box — if the two agree, the font
    //    shipped no onum set and the property did nothing.
    const differs = await page.evaluate(() => {
      const mk = (onum) => {
        const s = document.createElement('span');
        s.textContent = '3456789';
        s.style.cssText = `position:absolute;left:-9999px;font-family:'Cormorant Garamond',serif;font-size:100px;font-variant-numeric:${onum ? 'oldstyle-nums' : 'lining-nums'};font-feature-settings:'onum' ${onum ? 1 : 0};`;
        document.body.appendChild(s);
        const r = s.getBoundingClientRect();
        s.remove();
        return { w: r.width, h: r.height };
      };
      const a = mk(true), b = mk(false);
      return { old: a, lining: b, same: Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5 };
    });
    expect(differs.same, `oldstyle and lining rendered identically (${JSON.stringify(differs)}) — the feature is not in the font`).toBe(false);
  });

  test('the Voices row holds a MIX of photographs and quiet discs', async ({ page }) => {
    await rest(page, 390);
    const row = await page.evaluate(() => {
      const voices = [...document.querySelectorAll('.ix-voice')];
      return voices.map((v) => {
        const img = v.querySelector('img.ix-portrait');
        const disc = v.querySelector('.ix-portrait-none');
        const cs = disc ? getComputedStyle(disc) : null;
        return {
          name: v.querySelector('.ix-voice-n')?.textContent?.trim() || '',
          photo: !!img,
          disc: !!disc,
          discBg: cs ? cs.backgroundColor : null,
          discBorder: cs ? cs.borderTopColor : null,
          initials: disc ? disc.textContent.trim() : null,
        };
      });
    });
    expect(row.length, 'the Voices block is empty').toBeGreaterThanOrEqual(10);

    const photos = row.filter((r) => r.photo);
    const discs = row.filter((r) => r.disc);
    // ⚠ BOTH must be present, or the row has not been judged as a row.
    expect(photos.length, 'no photographs in the row').toBeGreaterThan(0);
    expect(discs.length, 'no fallback discs in the row — the quiet disc is unproven').toBeGreaterThan(0);
    expect(photos.length + discs.length).toBe(row.length);

    // ⚠ NOBODY IS HIDDEN for not having uploaded a photograph.
    expect(row.every((r) => r.name.length > 0), 'a voice rendered with no name').toBe(true);

    // ⭑ THE DISC IS QUIETER, NOT LOUDER: no fill and no violet anywhere on it.
    for (const d of discs) {
      expect(d.discBg, `the disc has a fill: ${d.discBg}`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(d.discBorder || '');
      expect(m, `disc border unreadable: ${d.discBorder}`).toBeTruthy();
      const [r, g, b] = [ +m[1], +m[2], +m[3] ];
      // violet is blue-dominant with a red lift; a neutral hairline is not.
      expect(b - g, `the disc border is violet: ${d.discBorder}`).toBeLessThan(12);
      expect(d.initials.length, 'the disc carries no initials').toBeGreaterThan(0);
    }
  });

  test('every row clears the 48px floor — box AND effective target reported', async ({ page }) => {
    await rest(page, 390);
    const rows = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.ix-form, .ix-subj, .ix-voice, .ix-random, .ix-clear')) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        // The BOX is what the element occupies. The EFFECTIVE TARGET is what a finger can
        // actually land on — for a full-width row that is the box; the axis that fails is
        // always the short one, which is why both are reported rather than the larger.
        // ⚠ REPORTED SEPARATELY, NEVER COLLAPSED INTO THE LARGER. The box is what the
        // element occupies; the effective target is what a finger can land on, which a
        // ::after extension can make larger. The Open Pages round found a pill at 47.91pt
        // against a 48 floor on the axis nobody was looking at — it was only ever visible in
        // a rendered measurement, so both numbers are printed even when they agree.
        const after = getComputedStyle(el, '::after');
        const live = after.content !== 'none' && after.position === 'absolute';
        // The extension is read off the pseudo-element's own offsets, so the measurement
        // follows the CSS instead of restating it.
        const px = (v) => (parseFloat(v) || 0);
        const extW = live ? -(px(after.left) + px(after.right)) : 0;
        const extH = live ? -(px(after.top) + px(after.bottom)) : 0;
        out.push({
          k: el.className.split(' ')[0],
          t: el.textContent.trim().slice(0, 22),
          boxW: +r.width.toFixed(2), boxH: +r.height.toFixed(2),
          targetW: +(r.width + extW).toFixed(2), targetH: +(r.height + extH).toFixed(2),
          padY: cs.paddingTop, minH: cs.minHeight,
        });
      }
      return out;
    });
    expect(rows.length).toBeGreaterThan(20);
    const short = rows.filter((r) => r.targetH < 48 || r.targetW < 48);
    // And no two extended targets may overlap — the reason the row gap was widened.
    const overlaps = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll('.ix-subj')].map((el) => {
        const r = el.getBoundingClientRect();
        const a = getComputedStyle(el, '::after');
        const px = (v) => (parseFloat(v) || 0);
        // The real extended rectangle, not a re-stated constant — a hardcoded ±24 here would
        // keep passing after the CSS changed, which is the guard-that-cannot-fail shape.
        return {
          t: el.textContent.trim().slice(0, 18),
          top: r.top + px(a.top), bottom: r.bottom - px(a.bottom),
          l: r.left + px(a.left), r: r.right - px(a.right),
        };
      });
      const bad = [];
      for (let i = 0; i < boxes.length; i++)
        for (let k = i + 1; k < boxes.length; k++) {
          const a = boxes[i], b = boxes[k];
          const EPS = 0.5;
          if (a.top < b.bottom - EPS && b.top < a.bottom - EPS && a.l < b.r - EPS && b.l < a.r - EPS) bad.push([a.t, b.t]);
        }
      return bad;
    });
    expect(overlaps, `touch targets overlap: ${JSON.stringify(overlaps)}`).toEqual([]);
    // ⚠ The Open Pages round found a pill at 47.91pt against a 48 floor, visible only in a
    // rendered measurement. Report the actual number, do not round into compliance.
    expect(short, `under the 48px floor: ${JSON.stringify(short)}`).toEqual([]);
  });

  test('no emoji paints anywhere on the index', async ({ page }) => {
    await rest(page, 390);
    const found = await page.evaluate(() => {
      const RE = /\p{Emoji_Presentation}|️/u;
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const m = n.textContent.match(RE);
        if (m) out.push({ ch: m[0], ctx: n.textContent.trim().slice(0, 30) });
      }
      return out;
    });
    expect(found, `emoji on screen: ${JSON.stringify(found)}`).toEqual([]);
    // and the typographic mark is genuinely there, so this is not passing on a blank page
    await expect(page.locator('.ix-random')).toContainText('✦');
  });

  test('the dot leaders draw, and the counts sit at the far edge', async ({ page }) => {
    await rest(page, 390);
    const leaders = await page.evaluate(() =>
      [...document.querySelectorAll('.ix-form')].map((el) => {
        const lead = el.querySelector('.ix-lead');
        const n = el.querySelector('.ix-form-n');
        const cs = getComputedStyle(lead);
        return {
          style: cs.borderBottomStyle,
          w: Math.round(lead.getBoundingClientRect().width),
          gap: Math.round(el.getBoundingClientRect().right - n.getBoundingClientRect().right),
        };
      }));
    expect(leaders.length).toBeGreaterThan(3);
    for (const l of leaders) {
      expect(l.style, 'the leader is not dotted').toBe('dotted');
      expect(l.w, 'the leader collapsed to nothing').toBeGreaterThan(10);
      expect(Math.abs(l.gap), 'the count is not at the far edge').toBeLessThan(2);
    }
  });
});

test.describe('results and the empty state', () => {
  test('a signed-out reader gets READER results — the defect this round fixed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/search', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    // A name that exists in user_search. Unauthenticated is exactly a non-founder.
    await page.locator('.ix-input').fill('a');
    await page.waitForTimeout(3000);
    const readers = await page.locator('a[href^="/user?id="]').count();
    expect(readers, 'reader search returned nothing for a signed-out visitor — the old defect is back')
      .toBeGreaterThan(0);
  });

  test('a result shows the story\'s REAL opening line, not a content note', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/search?q=1967', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const row = page.locator('a[href="/stories/1967"]').first();
    await expect(row).toBeVisible();
    const opening = await row.locator('.ix-res-o').textContent();
    expect(opening).toContain('I was only eleven years old');
    expect(opening.toLowerCase()).not.toContain('content note');
    // the matched word is picked out in gold, in the title
    const hits = await row.locator('.ix-hit').count();
    expect(hits, 'nothing was picked out in gold').toBeGreaterThan(0);
  });

  test('the empty result is honest, and its last clause reaches Open Pages', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/search', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await page.locator('.ix-input').fill('qxzjvwkplmn');
    await page.waitForTimeout(2500);
    await expect(page.locator('.ix-empty-h')).toHaveText('Nothing under that word');
    const p = page.locator('.ix-empty-p');
    await expect(p).toContainText('The island is small enough that this happens');
    const link = p.locator('a');
    await expect(link).toHaveText('write the thing you were looking for');
    await expect(link).toHaveAttribute('href', '/open-pages/new');
    // ⚠ and the destination is real, not a promise
    const res = await page.request.get('/open-pages/new');
    expect(res.status(), 'the Open Pages composer 404s').toBeLessThan(400);
  });

  test('the press answers the finger, and reduced motion does not take it away', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await rest(page, 390);
    const t = await page.evaluate(() => {
      const el = document.querySelector('.ix-form');
      const before = getComputedStyle(el).transform;
      // :active cannot be forced from script; read the rule the browser would apply.
      let rule = null;
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const r of rules || []) {
          if (r.selectorText === '.ix-press:active') rule = r.style.transform;
          if (r.media && [...r.media].some((m) => m.includes('reduced-motion'))) {
            for (const inner of r.cssRules || []) {
              if ((inner.selectorText || '').includes('ix-press')) rule = 'DISABLED BY REDUCED MOTION';
            }
          }
        }
      }
      return { before, rule };
    });
    expect(t.rule, 'the press rule is gone').toBeTruthy();
    expect(t.rule, 'reduced motion silenced the press — a control that stops answering the finger is broken')
      .not.toBe('DISABLED BY REDUCED MOTION');
    expect(t.rule).toContain('0.985');
  });
});
