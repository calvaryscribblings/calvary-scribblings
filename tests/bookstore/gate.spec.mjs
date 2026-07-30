// R8.1 — THE PRE-LAUNCH GATE, against the real static export.
//
// WHY THE CONSTANTS ARE PARSED OUT OF gate.js RATHER THAN IMPORTED. package.json declares no
// "type": "module", so app/lib/bookstore/gate.js — a .js file using `export const` — is ESM to
// the bundler and CommonJS to bare Node, which cannot parse it. Importing it here is therefore
// not available, and copying the passcode into this file is the one thing that must not happen:
// a test that carries its own copy of the key passes forever after someone changes the real one.
// So the source is read as text and the literal is extracted, and every extractor throws by name
// if its constant is renamed or restyled. A rename breaks this suite loudly, which is the point.
//
// FIREBASE IS LIVE for the gate mechanics. The assertion that earns its keep is that the REAL
// storefront appears once the key fits — a stubbed catalogue would only prove a stub renders.
// The waitlist block is the deliberate exception: it kills the transport first, so no test in
// this file can put a row in production bookstore_waitlist. See the note above that block.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GATE_MODULE = join(ROOT, 'app/lib/bookstore/gate.js');
const GATE_SRC = readFileSync(GATE_MODULE, 'utf8');

function stringConst(name) {
  const m = new RegExp(`^export const ${name} = '([^']*)';`, 'm').exec(GATE_SRC);
  if (!m) throw new Error(`app/lib/bookstore/gate.js no longer exports a single-quoted string const named ${name} — update the extractor, do not inline the value here.`);
  return m[1];
}
function boolConst(name) {
  const m = new RegExp(`^export const ${name} = (true|false);`, 'm').exec(GATE_SRC);
  if (!m) throw new Error(`app/lib/bookstore/gate.js no longer exports a boolean const named ${name}.`);
  return m[1] === 'true';
}

const GATE_PASSCODE = stringConst('GATE_PASSCODE');
const GATE_STORAGE_KEY = stringConst('GATE_STORAGE_KEY');
const GATE_ENABLED = boolConst('GATE_ENABLED');

// A published slug, so the detail route has something real behind the curtain.
const DETAIL_SLUG = 'basil';

// The storefront's own DOM, by class rather than by text: the gate says "The Book Store" too,
// and a text selector would pass while the curtain was still down.
const SHELF_DOM = ['.hero-store', '.catalogue-section', '.shelf-entry', '.the-window', '.shelf'];

// THE COOKIE BANNER IS NOT UNDER TEST, and it is in the way. Providers renders it site-wide at
// z-index 9999 — deliberately above the gate's 9000, because consent UI has to stay reachable —
// and on a 400px viewport it lands squarely over the waitlist row, so Playwright's actionability
// check correctly refuses to click a button another element is covering. Seeding consent models
// a reader who has already answered it, which is every reader after their first page view. The
// overlap itself is real and is on the glass list; it is not something this suite should assert
// around by clicking through a banner whose copy could change.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('cs_cookie_consent', 'accepted'); } catch { /* private mode */ }
  });
});

async function expectNoShelfDom(page) {
  for (const sel of SHELF_DOM) {
    await expect(page.locator(sel), `${sel} must not exist while the gate is up`).toHaveCount(0);
  }
}

test.describe('the flag', () => {
  test('GATE_ENABLED is on, and has exactly one point of use in app/', async () => {
    expect(GATE_ENABLED, 'R8.1 ships with the curtain down').toBe(true);

    // A second reader of the flag is the failure this guards against: R9 flips one line, and
    // "which line?" must have exactly one answer. isStoreUnlocked() in gate.js is that answer.
    const hits = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.jsx?$/.test(name)) continue;
        if (readFileSync(full, 'utf8').includes('GATE_ENABLED')) hits.push(relative(ROOT, full));
      }
    })(join(ROOT, 'app'));

    expect(hits).toEqual(['app/lib/bookstore/gate.js']);
  });

  // WHAT THIS SUITE CANNOT DO, stated rather than quietly skipped. GATE_ENABLED is baked into a
  // JavaScript chunk at build time, so proving "false ⇒ the store renders directly" needs a
  // SECOND `next build` with the flag flipped — a full export against live Firebase, minutes
  // long, doubling the CI build step to assert one branch of one `if`. That trade is not worth
  // it, so it is not made. The coverage above is the substitute the brief allows: the flag has
  // one reader, that reader is `isStoreUnlocked()`, and its false branch is `return true` — one
  // line, visible in the diff, with nothing between it and the storefront.
});

test.describe('the curtain', () => {
  test('/bookstore renders the gate and no shelf DOM', async ({ page }) => {
    await page.goto('/bookstore');
    await expect(page.getByTestId('bookstore-gate')).toBeVisible();
    await expect(page.getByText('30 September 2026')).toBeVisible();
    await expect(page.getByText('Keyholders may enter')).toBeVisible();
    await expectNoShelfDom(page);
  });

  test('/bookstore/[slug] is gated too', async ({ page }) => {
    await page.goto(`/bookstore/${DETAIL_SLUG}`);
    await expect(page.getByTestId('bookstore-gate')).toBeVisible();
    await expectNoShelfDom(page);
    await expect(page.locator('.bd-buy')).toHaveCount(0);
  });

  test('a wrong key shows the error and leaves the curtain down', async ({ page }) => {
    await page.goto('/bookstore');
    await page.getByTestId('gate-passcode').fill('not-the-key');
    await page.getByTestId('gate-enter').click();

    await expect(page.getByTestId('gate-error')).toHaveText(/doesn.t fit this door/);
    await expect(page.getByTestId('bookstore-gate')).toBeVisible();
    await expectNoShelfDom(page);
    // A failed attempt must not leave a pass behind.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), GATE_STORAGE_KEY)).toBeNull();
  });

  test('the right key lifts the curtain and reveals the storefront', async ({ page }) => {
    await page.goto('/bookstore');
    await page.getByTestId('gate-passcode').fill(GATE_PASSCODE);
    await page.getByTestId('gate-enter').click();

    await expect(page.getByTestId('gate-welcome')).toHaveText('Welcome back.');
    // The real catalogue, out of live Firebase, behind the lift.
    await expect(page.locator('.hero-store')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('bookstore-gate')).toHaveCount(0);
    expect(await page.evaluate((k) => window.localStorage.getItem(k), GATE_STORAGE_KEY)).toBe('1');
  });

  test('the key is trimmed and case-insensitive', async ({ page }) => {
    await page.goto('/bookstore');
    await page.getByTestId('gate-passcode').fill(`  ${GATE_PASSCODE.toLowerCase()}  `);
    await page.getByTestId('gate-enter').click();
    await expect(page.getByTestId('gate-welcome')).toBeVisible();
  });

  test('the pass survives a reload, and clearing it closes the curtain again', async ({ page }) => {
    await page.goto('/bookstore');
    await page.getByTestId('gate-passcode').fill(GATE_PASSCODE);
    await page.getByTestId('gate-enter').click();
    await expect(page.locator('.hero-store')).toBeVisible({ timeout: 30000 });

    await page.reload();
    await expect(page.locator('.hero-store')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('bookstore-gate')).toHaveCount(0);

    // The pass is the only thing holding it open.
    await page.evaluate((k) => window.localStorage.removeItem(k), GATE_STORAGE_KEY);
    await page.reload();
    await expect(page.getByTestId('bookstore-gate')).toBeVisible();
    await expectNoShelfDom(page);
  });

  test('a pass earned at the front door opens the detail route as well', async ({ page }) => {
    await page.goto('/bookstore');
    await page.getByTestId('gate-passcode').fill(GATE_PASSCODE);
    await page.getByTestId('gate-enter').click();
    await expect(page.locator('.hero-store')).toBeVisible({ timeout: 30000 });

    await page.goto(`/bookstore/${DETAIL_SLUG}`);
    await expect(page.getByTestId('bookstore-gate')).toHaveCount(0);
  });
});

test.describe('the curtain, without motion', () => {
  // emulateMedia rather than test.use({ reducedMotion }): measured, the describe-scoped option
  // did not reach the context on this Playwright build — the page reported
  // matchMedia('(prefers-reduced-motion: reduce)').matches === false and the test failed against
  // a gate that was behaving correctly. Emulating on the page is explicit, and it fails loudly
  // rather than silently testing the wrong preference.
  test('lifts with no transform and still reveals the store', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/bookstore');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      'the preference must actually be emulated, or this test proves nothing').toBe(true);
    const gate = page.getByTestId('bookstore-gate');
    await expect(gate).toBeVisible();
    // The lift is a transition on the gate; under the preference it must not be one.
    expect(await gate.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');

    await page.getByTestId('gate-passcode').fill(GATE_PASSCODE);
    await page.getByTestId('gate-enter').click();
    await expect(page.getByTestId('gate-welcome')).toBeVisible();
    // It leaves by unmounting rather than by travelling — and it does leave, which is the
    // failure the reduced-motion path invites: a cancelled animation whose onTransitionEnd
    // never fires would strand the reader behind a curtain that no longer moves.
    await expect(gate).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('.hero-store')).toBeVisible({ timeout: 30000 });
  });
});

// ── THE WAITLIST ─────────────────────────────────────────────────────────────
//
// THE TRANSPORT IS KILLED BEFORE THE PAGE LOADS, and that is what makes it safe to type a
// well-formed address into a production form: window.WebSocket is replaced with a recorder that
// never connects, and every HTTP request to the RTDB host is aborted and counted. The Firebase
// SDK is otherwise untouched — it is the real SDK, taking the real code path, reaching a wire
// that goes nowhere. Nothing this block does can reach bookstore_waitlist.
//
// The dead wire is also the instrument. "An invalid address writes NOTHING" is not asserted from
// the absence of a success message — a message proves what was rendered, not what was sent — but
// from zero transport activity of any kind: no socket constructed, no request attempted. A valid
// address, by contrast, must produce activity, which is what proves the validator is a gate in
// front of a real write rather than decoration in front of nothing.
test.describe('the waitlist', () => {
  async function deadenTransport(page) {
    const hits = [];
    await page.addInitScript(() => {
      window.__wsUrls = [];
      window.__wsFrames = [];
      class DeadSocket {
        constructor(url) {
          window.__wsUrls.push(String(url));
          this.url = String(url);
          this.readyState = 0;
        }
        send(data) { window.__wsFrames.push(String(data)); }
        close() {}
        addEventListener() {}
        removeEventListener() {}
      }
      DeadSocket.CONNECTING = 0; DeadSocket.OPEN = 1; DeadSocket.CLOSING = 2; DeadSocket.CLOSED = 3;
      window.WebSocket = DeadSocket;
    });
    await page.route(/firebasedatabase\.app|firebaseio\.com/, (route) => {
      hits.push(route.request().url());
      route.abort();
    });
    const activity = async () => hits.length + (await page.evaluate(() => window.__wsUrls.length + window.__wsFrames.length));
    return { activity, sentText: async () => hits.join('\n') + (await page.evaluate(() => window.__wsFrames.join('\n'))) };
  }

  test('a malformed address is refused and nothing leaves the browser', async ({ page }) => {
    const wire = await deadenTransport(page);
    await page.goto('/bookstore');
    await expect(page.getByTestId('bookstore-gate')).toBeVisible();
    expect(await wire.activity(), 'the gate itself must not touch the database at all').toBe(0);

    for (const bad of ['reader', 'reader@', '@example.com', 'reader@example', 'a@b', 'read er@example.com']) {
      await page.getByTestId('waitlist-email').fill(bad);
      await page.getByTestId('waitlist-submit').click();
      await expect(page.getByTestId('waitlist-error')).toBeVisible();
      await expect(page.getByTestId('waitlist-done')).toHaveCount(0);
      expect(await wire.activity(), `"${bad}" must not reach the wire`).toBe(0);
      expect(await wire.sentText()).not.toContain(bad);
    }

    // Refused, not disabled: the reader can still correct the typo in front of them.
    await expect(page.getByTestId('waitlist-email')).toBeEnabled();
  });

  test('a well-formed address passes validation and enters the write path', async ({ page }) => {
    const wire = await deadenTransport(page);
    await page.goto('/bookstore');
    await expect(page.getByTestId('bookstore-gate')).toBeVisible();

    await page.getByTestId('waitlist-email').fill('reader@example.com');
    await page.getByTestId('waitlist-submit').click();

    await expect(page.getByTestId('waitlist-error')).toHaveCount(0);
    // 'Sending' + a disabled row is the observable proof the validator let it through: the
    // component only reaches that state after isEmailShaped() passes and push() is in flight.
    await expect(page.getByTestId('waitlist-submit')).toHaveText(/Sending/i);
    await expect(page.getByTestId('waitlist-email')).toBeDisabled();
    await expect.poll(wire.activity, { timeout: 15000 }).toBeGreaterThan(0);
  });
});
