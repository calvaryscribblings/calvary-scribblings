// R17.3 — EVERY BOOK ON THE SHOP TURNS OVER, against the real static export.
//
// tests/bookstore/flip.test.mjs pins the source: the gesture is inside BoundBook, the props
// that used to bypass it are gone, and every call site is registered. This one asserts the
// thing those exist for — that a finger on the glass actually turns the book over, on each
// surface, and that the surfaces are not quietly different from one another underneath.
//
// ── THE PARITY CHECK IS A PROPERTY, NOT A LEVEL ───────────────────────────────────────────
//
// The brief asked that whatever affordance the grid gives keyboard and assistive users comes
// along to the new surfaces IDENTICALLY. The grid's affordance is pointer-only — there is no
// tabIndex, no role and no key handler on a book anywhere, and there never was. So "identical"
// is satisfied, and it is satisfied at a level worth naming out loud rather than passing over.
//
// What this asserts is therefore the PROPERTY: every surface's book carries the same attribute
// set. If the grid ever gains a real keyboard affordance, these fail until the other three have
// it too — which is the only version of "identically" that survives the next change.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BOOK_SRC = readFileSync(join(ROOT, 'app/bookstore/components/BoundBook.js'), 'utf8');
const GATE_SRC = readFileSync(join(ROOT, 'app/lib/bookstore/gate.js'), 'utf8');

const GATE_STORAGE_KEY = (() => {
  const m = /^export const GATE_STORAGE_KEY = '([^']*)';/m.exec(GATE_SRC);
  if (!m) throw new Error('app/lib/bookstore/gate.js no longer exports a single-quoted GATE_STORAGE_KEY.');
  return m[1];
})();

const SURFACES = (() => {
  const m = /export const BOOK_SURFACES = ([\s\S]*?)\n\};/.exec(BOOK_SRC);
  if (!m) throw new Error('BoundBook.js no longer exports BOOK_SURFACES as a literal');
  return new Function(`return ${m[1]}\n};`)();
})();

// The breathe before a quick release opens the modal. Read from the module, not retyped.
const BREATHE_MS = Number(/const BREATHE_MS = (\d+);/.exec(
  readFileSync(join(ROOT, 'app/bookstore/components/useBookGesture.js'), 'utf8'))[1]);

// Where each registered surface's book stands on a rendered page. `key` matches BOOK_SURFACES.
const ON_SCREEN = [
  { key: 'shelf',        path: '/bookstore', sel: '.catalogue-section .shelf-entry .bb-persp' },
  { key: 'window',       path: '/bookstore', sel: '.window-book .bb-persp' },
  { key: 'curated-case', path: '/bookstore', sel: '.curated-case-book .bb-persp' },
  { key: 'detail',       path: '/bookstore/after-the-fact', sel: '.bd-cover-wrap .bb-persp' },
];

async function enterShop(page, path) {
  await page.addInitScript((k) => {
    try { localStorage.setItem('cs_cookie_consent', 'accepted'); localStorage.setItem(k, '1'); } catch { /* private mode */ }
  }, GATE_STORAGE_KEY);
  await page.route('**/api/bookstore/region', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ country: 'GB' }) }));
  await page.goto(path);
  await expect(page.locator('.bb-front').first()).toBeVisible({ timeout: 30000 });
}

test.describe('every book on the shop turns over', () => {

  test('the four registered surfaces are the four this suite drives', () => {
    // A fifth surface added to the register with no on-screen assertion here would otherwise
    // be "covered" by the source suite alone, which cannot tell whether a book actually moves.
    expect(ON_SCREEN.map((s) => s.key).sort()).toEqual(SURFACES.surfaces.map((s) => s.key).sort());
  });

  for (const surface of ON_SCREEN) {
    const registered = SURFACES.surfaces.find((s) => s.key === surface.key);

    test(`${surface.key}: a tap turns the book over`, async ({ page }) => {
      await enterShop(page, surface.path);
      const book = page.locator(surface.sel).first();
      await expect(book, `${surface.key} renders no book at ${surface.sel}`).toBeVisible();

      const face = book.locator('.bb-book');
      await expect(face).not.toHaveClass(/bb-flipped/);
      await book.click();
      // This is the whole defect: before R17.3 the Window's book and the curated case's book
      // sat here unchanged, because the gesture lived in a wrapper only the shelf used.
      await expect(face, `${surface.key} did not flip — this book is dead`).toHaveClass(/bb-flipped/);
    });

    if (registered.opens === 'quick-look') {
      test(`${surface.key}: the flip leads into Quick Look, and closing it puts the book back`, async ({ page }) => {
        await enterShop(page, surface.path);
        const book = page.locator(surface.sel).first();
        await book.click();
        const modal = page.locator('[role="dialog"][aria-modal="true"]');
        await expect(modal).toBeVisible({ timeout: BREATHE_MS + 4000 });
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0, { timeout: 5000 });
        // `reset` runs on close, so the book is face-up again and can be tapped afresh.
        await expect(book.locator('.bb-book')).not.toHaveClass(/bb-flipped/);
      });
    } else {
      test(`${surface.key}: with nowhere to go, the book turns back rather than sticking`, async ({ page }) => {
        await enterShop(page, surface.path);
        const book = page.locator(surface.sel).first();
        const face = book.locator('.bb-book');
        await book.click();
        await expect(face).toHaveClass(/bb-flipped/);
        // No modal is opened here, and none should be — this page IS the quick look.
        await expect(face, 'the book stayed face-down with nothing to press')
          .not.toHaveClass(/bb-flipped/, { timeout: BREATHE_MS + 4000 });
        await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
      });
    }
  }

  test('the three books on the storefront carry an IDENTICAL affordance set', async ({ page }) => {
    await enterShop(page, '/bookstore');
    const read = async (sel) => page.locator(sel).first().evaluate((el) => {
      const book = el.querySelector('.bb-book');
      const pick = (n) => ({
        tabindex: n.getAttribute('tabindex'),
        role: n.getAttribute('role'),
        aria: [...n.attributes].map((a) => a.name).filter((a) => a.startsWith('aria-')).sort(),
      });
      return { persp: pick(el), book: pick(book) };
    });

    const onScreen = ON_SCREEN.filter((s) => s.path === '/bookstore');
    const first = await read(onScreen[0].sel);
    for (const s of onScreen.slice(1)) {
      expect(await read(s.sel), `${s.key}'s book is not the same affordance as ${onScreen[0].key}'s`)
        .toEqual(first);
    }

    // And the level itself, stated rather than assumed. This is the gap the round did not
    // close — a book is not reachable by keyboard on ANY surface, and it was not before either.
    // Both faces are in the DOM at all times, so the back cover's copy is announced regardless;
    // the flip is decorative for assistive tech. If any of this changes, change it everywhere.
    expect(first.persp.tabindex).toBeNull();
    expect(first.book.tabindex).toBeNull();
  });

  test('the back cover is in the accessibility tree whether or not the book has turned', async ({ page }) => {
    // This is why the missing keyboard affordance is a discoverability gap and not a content
    // one. backface-visibility hides a face from the eye, not from the tree.
    await enterShop(page, '/bookstore');
    const back = page.locator('.window-book .bb-back');
    await expect(back).toHaveCount(1);
    await expect(back.locator('.bb-barcode')).toHaveCount(1);
    const text = (await back.innerText()).trim();
    expect(text.length, 'the back cover prints nothing for a screen reader to read').toBeGreaterThan(0);
  });
});
