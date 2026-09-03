import { test, expect } from '@playwright/test';
import { SUMMER_2026 } from '../../app/lib/leaderboards.js';

// R34 — THE STRIP CANNOT DRAW ITSELF OVER ITSELF.
//
//   npm run test:strip
//
// The live defect: on the certified Summer 2026 board the reader's handle sat on
// the line below their name, inside a flex-wrap row, and it was the ONLY text node
// in that column with no overflow rule. flex-wrap put it on its own line at full
// intrinsic width with nothing to stop it growing, so a long enough handle runs
// straight under the score. Measured on the thirteen certified rows at 320px before
// the fix, the worst row (@adam_sadiq_olamide) had 11.7px of clearance left.
//
// R34's fix, both halves, because neither works alone:
//   * THE HANDLE IS CUT.  Frees vertical room. Does NOT fix truncation.
//   * THE NAME GETS TWO LINES IN A WIDER CARD.  Fixes truncation. Would not have
//     stopped the handle overflowing, because the handle was a different node.
//
// WHAT THIS SUITE ASSERTS, and each of these is a thing that was false before:
//   1. no handle node survives in the strip at all;
//   2. NOTHING in the name column reaches the score column, at any width;
//   3. no name is clipped — not horizontally, and not by the two-line clamp;
//   4. the score is house gold and clears 4.5:1 on the ground it is actually
//      painted on, measured from computed styles rather than asserted from a
//      colour name.
//
// WIDTHS. Not the app's numbers. Ikenna's measurement was a 200pt card whose
// furniture cost 140pt; the web's row at 320px is 294.4px and its furniture cost
// 164.4px. The ruling ports, the numbers do not, so these are the web's own
// phone widths from the smallest still in service upward.
const WIDTHS = [320, 344, 360, 375, 390, 414, 430];

const BOARD = `/leaderboard/${SUMMER_2026.boardId}`;

// sRGB relative luminance, WCAG 2.x.
function luminance([r, g, b]) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const parseRGB = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);

// Composite a possibly-translucent stack down to an opaque colour. The row tints
// are 4–5% washes over the page, so the ground the score sits on is neither the
// row's declared background nor the page's.
function flatten(layers) {
  let out = [10, 10, 10];
  for (const { rgb, alpha } of layers) out = out.map((c, i) => rgb[i] * alpha + c * (1 - alpha));
  return out;
}

async function rows(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(BOARD, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sb-row', { timeout: 45000 });
  // Fonts settle after hydration; a measurement taken against the fallback face
  // is a measurement of a different layout.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  return page.evaluate(() => {
    const intrinsic = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect().width;
    };
    return [...document.querySelectorAll('.sb-row')].slice(0, 25).map((row) => {
      const name = row.querySelector('.sb-name');
      const score = row.querySelector('.sb-score');
      const col = name.parentElement;
      const scoreNum = score.firstElementChild;
      const cs = getComputedStyle(scoreNum);
      const rowCs = getComputedStyle(row);
      return {
        text: name.textContent.trim(),
        // Every element in the name column, not just the name: the handle was
        // caught out by being the one node nobody thought to measure.
        colRight: Math.max(...[...col.querySelectorAll('*'), col].map((n) => n.getBoundingClientRect().right)),
        colWidth: col.getBoundingClientRect().width,
        nameWidest: intrinsic(name),
        clampedAway: name.scrollHeight > name.clientHeight + 1,
        overflowsX: name.scrollWidth > name.clientWidth + 1,
        // Deliberately loose: the handle sat immediately after the name with no
        // separator, so textContent reads "…Paradang@peedee£5". A pattern needing
        // whitespace before the @ misses it entirely — which it did, on the first
        // mutation run.
        hasHandle: /@[a-z0-9_]{2,}/i.test(col.textContent),
        scoreLeft: score.getBoundingClientRect().left,
        scoreColour: cs.color,
        rowBg: rowCs.backgroundColor,
        rowW: row.getBoundingClientRect().width,
      };
    });
  });
}

// THE STRESS STRINGS, and why the suite needs them.
//
// The live board is the subject, but the live board is not the worst case, and a
// suite that only ever measured today's twenty-six rows would be a test that
// cannot fail. Measured before the fix, the longest handle on the board
// (@adam_sadiq_olamiposi, 98px) came within 11.7px of the score at 320px — close
// enough to prove the node was unguarded, not close enough for any assertion over
// live data to have caught it. Two more characters and it would have.
//
// So the geometry is also measured against content the column has to survive but
// does not happen to hold today. These are written into the REAL name node of the
// REAL rendered row: every computed style, the flex container, the media query and
// the column width are the shipped ones, and only the text is adversarial. What is
// under test here is CSS, and CSS applies to whatever text arrives.
const STRESS = [
  // No space to break at. Without overflow-wrap:anywhere this walks straight out
  // of the column and under the score — the handle's failure, in the node that
  // replaced it.
  { label: 'one unbroken 44-character token', text: 'Zikorahnachukwudimmaakunneogechukwuamarachi' },
  // Breakable, but far longer than any name on the board. Tests the clamp and the
  // widening rather than the wrap.
  { label: 'a six-part name', text: 'Zikorahnachukwudimma Chukwuemeka Olamiposi Adebayo Paradang Akunne' },
];

test.describe('the seasonal board strip', () => {
  for (const width of WIDTHS) {
    test(`at ${width}px nothing in the name column reaches the score`, async ({ page }) => {
      const found = await rows(page, width);
      expect(found.length, 'the certified board rendered no rows — the suite would pass vacuously').toBeGreaterThan(5);

      for (const r of found) {
        // 1 — the handle is gone. Not guarded, not ellipsised: gone.
        expect(r.hasHandle, `"${r.text}" still carries a handle in the strip`).toBe(false);

        // 2 — the overlap itself, stated as the geometry rather than as a symptom.
        expect(
          r.colRight,
          `"${r.text}" paints to ${r.colRight.toFixed(1)}px, past the score's left edge at ${r.scoreLeft.toFixed(1)}px`,
        ).toBeLessThanOrEqual(r.scoreLeft);

        // 3 — and the name survives whole. Two lines are allowed; a third,
        // clipped by the clamp, is the truncation this round exists to end.
        expect(r.clampedAway, `"${r.text}" loses a line to the two-line clamp at ${width}px`).toBe(false);
        expect(r.overflowsX, `"${r.text}" is cut off horizontally at ${width}px`).toBe(false);
      }
    });
  }

  for (const width of WIDTHS) {
    for (const stress of STRESS) {
      test(`at ${width}px ${stress.label} still cannot reach the score`, async ({ page }) => {
        await rows(page, width);

        const worst = await page.evaluate((text) => {
          const out = [];
          for (const row of [...document.querySelectorAll('.sb-row')].slice(0, 6)) {
            const name = row.querySelector('.sb-name');
            const score = row.querySelector('.sb-score');
            const col = name.parentElement;
            name.textContent = text;
            out.push({
              colRight: Math.max(...[...col.querySelectorAll('*'), col].map((n) => n.getBoundingClientRect().right)),
              scoreLeft: score.getBoundingClientRect().left,
              rowRight: row.getBoundingClientRect().right,
              overflowsX: name.scrollWidth > name.clientWidth + 1,
            });
          }
          return out;
        }, stress.text);

        for (const r of worst) {
          expect(
            r.colRight,
            `the name column paints to ${r.colRight.toFixed(1)}px, past the score at ${r.scoreLeft.toFixed(1)}px`,
          ).toBeLessThanOrEqual(r.scoreLeft);
          expect(r.overflowsX, 'the name overflows its column horizontally').toBe(false);
          expect(r.colRight, 'the name column paints past the row itself').toBeLessThanOrEqual(r.rowRight);
        }
      });
    }
  }

  test('the score is house gold and legible on the ground it is painted on', async ({ page }) => {
    const found = await rows(page, 390);
    for (const r of found) {
      const fg = parseRGB(r.scoreColour);
      expect(fg, `the score is ${r.scoreColour}, not house gold #c9a84c`).toEqual([201, 168, 76]);

      // The row tint is a wash; flatten it over the page before measuring.
      const bgParts = r.rowBg.match(/[\d.]+/g).map(Number);
      const ground = flatten([{ rgb: bgParts.slice(0, 3), alpha: bgParts[3] ?? 1 }]);
      const ratio = contrast(fg, ground);
      expect(ratio, `the score measures ${ratio.toFixed(2)}:1 on ${r.rowBg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// R34a — THE SAME RULING, ON THE ALL-TIME BOARD.
//
// R34 cut the handle from the seasonal strip and left /leaderboard's own row
// carrying one, guarded with an ellipsis: that board has no prize pill, and the
// handle was the only identity beside the display name. Ikenna overruled it on
// 3 Sept 2026 — the reasoning that cut it from the strip applies here unchanged,
// and consistency between the two boards beats this row keeping a second identity
// line. The badge stays; it is the thing the reader earned.
//
// So this board is now held to the same three properties, by the same
// measurements, and this suite is what stops the two drifting apart again.
test.describe('the all-time board row', () => {
  async function allTimeRows(page, width) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/leaderboard', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'All Time' }).click();
    await page.waitForSelector('.lb-row', { timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    return page.evaluate(() => [...document.querySelectorAll('.lb-row')].slice(0, 20).map((row) => {
      const name = row.querySelector('.lb-name');
      const score = row.querySelector('.lb-score');
      const col = name.parentElement;
      return {
        text: name.textContent.trim(),
        colRight: Math.max(...[...col.querySelectorAll('*'), col].map((n) => n.getBoundingClientRect().right)),
        scoreLeft: score.getBoundingClientRect().left,
        clampedAway: name.scrollHeight > name.clientHeight + 1,
        overflowsX: name.scrollWidth > name.clientWidth + 1,
        hasHandle: /@[a-z0-9_]{2,}/i.test(col.textContent),
      };
    }));
  }

  for (const width of WIDTHS) {
    test(`at ${width}px it carries no handle and nothing reaches the score`, async ({ page }) => {
      const found = await allTimeRows(page, width);
      expect(found.length, 'the all-time board rendered no rows — the suite would pass vacuously').toBeGreaterThan(5);

      for (const r of found) {
        expect(r.hasHandle, `"${r.text}" still carries a handle on the all-time board`).toBe(false);
        expect(
          r.colRight,
          `"${r.text}" paints to ${r.colRight.toFixed(1)}px, past the score at ${r.scoreLeft.toFixed(1)}px`,
        ).toBeLessThanOrEqual(r.scoreLeft);
        expect(r.clampedAway, `"${r.text}" loses a line to the two-line clamp at ${width}px`).toBe(false);
        expect(r.overflowsX, `"${r.text}" is cut off horizontally at ${width}px`).toBe(false);
      }
    });
  }
});
