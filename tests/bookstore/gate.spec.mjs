// R8.1 — THE PRE-LAUNCH GATE, against the real static export.
//
// WHY THE CONSTANTS ARE PARSED OUT OF gate.js RATHER THAN IMPORTED.
//
// The reason that mattered when this was written no longer holds, and the correction is worth
// having in writing. The original claim was that package.json declares no "type": "module", so
// app/lib/bookstore/gate.js — a .js file using `export const` — is CommonJS to bare Node, which
// cannot parse it, and importing it here was therefore impossible. Node's automatic
// module-syntax detection has since made that import work: R9.1's tests/rules/database.test.mjs
// imports isEmailShaped from this very file and is green on Node 22 in CI. R8.3's
// tests/bookstore/currency.test.mjs imports app/lib/currency.js the same way.
//
// The EXTRACTORS STAY ANYWAY, because the second half of the original argument is the half that
// was really load-bearing: copying the passcode into this file is the one thing that must not
// happen — a test carrying its own copy of the key passes forever after someone changes the
// real one. Reading the source as text achieves that, every extractor throws by name if its
// constant is renamed or restyled, and a rename breaks this suite loudly. An import would do
// the same job; it would not do it better, and rewriting working extractors to prove a point
// about module resolution is not worth the risk to a suite that guards a door.
//
// FIREBASE IS LIVE for the gate mechanics. The assertion that earns its keep is that the REAL
// storefront appears once the key fits — a stubbed catalogue would only prove a stub renders.
// The waitlist block is the deliberate exception: it kills the transport first, so no test in
// this file can put a row in production bookstore_waitlist. See the note above that block.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { liveDetailSlug } from './live-slug.mjs';

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
// R20 — THE GATED CASES READ THEIR SLUG FROM THE BUILT EXPORT, not from the shop and not from
// a literal.
//
// Behind the curtain there is no shelf to read a slug from, so liveDetailSlug() cannot help
// here. The first attempt at this kept the literal 'basil' and argued that the curtain is down
// for any /bookstore/* route whether the title exists or not. THAT WAS WRONG, and CI caught it:
// a curator had unpublished that title, so generateStaticParams stopped emitting the route, the
// static export 404s at the file level, and the site's 404 page is not wrapped by LaunchGate —
// no gate, no curtain, failed assertion. It passed locally only because the local out/ still
// held a page built while the title was published.
//
// out/bookstore/*.html IS the set of detail routes that exist in the thing being served, which
// is exactly the question a route-gating case is asking. Reading it here means the case cannot
// drift from the build again.
const EXPORT_DETAIL_SLUGS = readdirSync(join(ROOT, 'out/bookstore'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, ''));
if (!EXPORT_DETAIL_SLUGS.length) {
  throw new Error('out/bookstore holds no detail pages — build the export before running this suite.');
}
const DETAIL_SLUG = EXPORT_DETAIL_SLUGS[0];

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


// R20 — THE DETAIL SLUG IS RESOLVED FROM THE SHOP, NOT NAMED.
//
// This file used to open `/bookstore/basil`. Mid-way through R20 a curator set that title to
// `status: unpublished` — an ordinary thing to do to a shop — and every case here began
// rendering the site's 404 and failing on a selector, with nothing wrong in the code under
// test. See tests/bookstore/live-slug.mjs.
async function gotoDetail(page) {
  await page.goto('/bookstore', { waitUntil: 'networkidle', timeout: 60000 });
  await expect(page.locator('.shelf-entry .entry-title').first()).toBeVisible({ timeout: 30000 });
  const slug = await liveDetailSlug(page);
  await page.goto(`/bookstore/${slug}`);
  return slug;
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
        // ⚠ A SUBSTRING SEARCH WAS WRONG, and it went red on main without being noticed —
        // found by R16's full sweep, broken since R13. `GATE_ENABLED` is a substring of
        // SERIES_TIER_GATE_ENABLED, which is a different flag with a different owner
        // (app/lib/series/access.js) read by three series surfaces, and it is also quoted in
        // prose by the two bookstore modules that argue about the platform's four flags.
        // Six false positives, none of them a second reader of THIS flag.
        //
        // The lookbehind is the fix and it is the whole fix: a real second reader would import
        // `GATE_ENABLED` under exactly that name, so the character before it is never [A-Z_].
        if (/(?<![A-Z_])GATE_ENABLED/.test(readFileSync(full, 'utf8'))) hits.push(relative(ROOT, full));
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

// ── R9.0 PL-5 / PL-6 · THE GATE AS A DIALOG ─────────────────────────────────────────────────
//
// The gate always BEHAVED like a modal — a full-screen opaque overlay at z-index 9000 with the
// storefront mounted and unreachable underneath — but declared none of it. R8.3 made the
// contract explicit. These assertions are the behavioural half; the structural half (the
// attributes, and the two contrast ratios) is pinned in tests/bookstore/gate-contrast.test.mjs,
// which runs in the fast suite.
//
// The static-analysis tests cannot prove focus went anywhere, and this file cannot cheaply
// measure a computed colour on a pseudo-element. Between them they cover it.
test.describe('the gate is a dialog', () => {
  test('it declares itself as one, labelled by its heading', async ({ page }) => {
    await page.goto('/bookstore');
    const gate = page.getByTestId('bookstore-gate');
    await expect(gate).toBeVisible();

    await expect(gate).toHaveAttribute('role', 'dialog');
    await expect(gate).toHaveAttribute('aria-modal', 'true');
    await expect(gate).toHaveAttribute('aria-labelledby', 'bg-gate-title');
    // The accessible name resolves to something a reader can act on, not an empty id.
    await expect(page.locator('#bg-gate-title')).toHaveText('The Book Store');
    await expect(page.getByRole('dialog', { name: 'The Book Store' })).toBeVisible();
  });

  test('focus lands on the passcode field on mount', async ({ page }) => {
    await page.goto('/bookstore');
    await expect(page.getByTestId('bookstore-gate')).toBeVisible();
    // The field IS the task. Landing on the container would make every keyboard reader tab
    // past the brand line and the date to reach the only thing they can act on.
    await expect(page.getByTestId('gate-passcode')).toBeFocused();
  });

  test('the storefront behind is inert AND hidden from the accessibility tree', async ({ page }) => {
    await page.goto('/bookstore');
    await expect(page.getByTestId('bookstore-gate')).toBeVisible();

    const siblings = await page.evaluate(() => {
      const gate = document.querySelector('[data-testid="bookstore-gate"]');
      return Array.from(gate.parentElement.children)
        .filter((el) => el !== gate)
        .map((el) => ({
          cls: el.className?.toString?.() ?? '',
          inert: el.inert === true,
          hidden: el.getAttribute('aria-hidden') === 'true',
        }));
    });

    for (const s of siblings) {
      // THE COOKIE BANNER IS THE ONE EXEMPTION, deliberately: Providers renders it above the
      // gate at z-index 9999 so consent stays reachable behind a curtain. Inerting it would
      // trap the one control that must never be trapped.
      if (s.cls.includes('cs-cookie')) {
        expect(s.inert, 'the cookie banner must stay reachable').toBeFalsy();
        continue;
      }
      // aria-hidden alone would hide the shop while leaving every link in it tabbable, which
      // is the worse half of the bug. Both, or neither is any use.
      expect(s.inert, `sibling "${s.cls}" must be inert while the curtain is down`).toBeTruthy();
      expect(s.hidden, `sibling "${s.cls}" must be aria-hidden while the curtain is down`).toBeTruthy();
    }
  });

  test('Tab is trapped inside the curtain and wraps', async ({ page }) => {
    await page.goto('/bookstore');
    await expect(page.getByTestId('gate-passcode')).toBeFocused();

    const insideGate = () => page.evaluate(() => {
      const gate = document.querySelector('[data-testid="bookstore-gate"]');
      return !!gate && gate.contains(document.activeElement);
    });

    // The curtain holds four controls (passcode, Enter, email, Keep me posted), so eight
    // presses is two full cycles — enough to prove the wrap in both directions without
    // paying for twenty-four round trips to the browser. This suite runs with retries:0 in
    // CI and shares a container with a memory ceiling; a cheap assertion is a reliable one.
    const CYCLES = 8;
    for (let i = 0; i < CYCLES; i++) {
      await page.keyboard.press('Tab');
      expect(await insideGate(), `focus escaped the curtain after ${i + 1} tabs`).toBeTruthy();
    }
    // And backwards, which is the direction a naive trap forgets.
    for (let i = 0; i < CYCLES; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await insideGate(), `focus escaped backwards after ${i + 1} shift-tabs`).toBeTruthy();
    }
  });

  test('Escape does NOT dismiss the curtain', async ({ page }) => {
    // A dialog usually closes on Escape; this one has nothing to close to. The shop is not
    // open and there is no prior view to return to — a curtain a keystroke could lift would
    // not be a gate. Asserted so nobody adds it for consistency with other dialogs.
    await page.goto('/bookstore');
    await expect(page.getByTestId('bookstore-gate')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('bookstore-gate')).toBeVisible();
    await expectNoShelfDom(page);
  });

  test('the storefront is released when the curtain lifts', async ({ page }) => {
    await page.goto('/bookstore');
    await page.getByTestId('gate-passcode').fill(GATE_PASSCODE);
    await page.getByTestId('gate-enter').click();

    await expect(page.locator('.hero-store')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('bookstore-gate')).toHaveCount(0);

    // Every sibling the gate inerted must have been handed back — a shop nobody can tab into
    // is a worse outcome than the bug this fixed.
    //
    // INERT IS THE THING CHECKED, not aria-hidden. The gate's sweep is the ONLY code in this
    // application that sets `inert`, so "nothing is inert" is an exact statement that the
    // cleanup ran. aria-hidden is not usable as the signal: the storefront legitimately ships
    // it on decorative nodes — the lamp, the fleurons, the barcode on every book spine, the
    // tab-bar spacer — and asserting on it means maintaining a denylist of ornaments that
    // grows every time someone draws another one.
    const stuck = await page.evaluate(() =>
      Array.from(document.body.querySelectorAll('*'))
        .filter((el) => el.inert === true)
        .map((el) => el.tagName + '.' + (el.className?.toString?.() ?? '')));

    expect(stuck, `left inert after the lift: ${stuck.join(', ')}`).toHaveLength(0);

    // And the shop is genuinely operable — asserted by FOCUSING a real control inside it
    // rather than by pressing Tab. An inert subtree silently refuses focus, so a control that
    // accepts it is direct proof the sweep was undone; whereas "Tab moved focus somewhere"
    // depends on where focus happened to start and on browser chrome, and was flaky for
    // exactly that reason. The currency selector is a good probe: it lives in the storefront
    // hero, so it is inside the region that was inert a moment ago.
    const probe = page.getByTestId('currency-gbp');
    await expect(probe).toBeVisible();
    await probe.focus();
    await expect(probe).toBeFocused();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R9.2 PL-20 — THE COVERS BEHIND THE CURTAIN ARE DECORATIVE.
//
// Why here rather than in a suite of its own: this file is already the only bookstore harness
// that walks a real browser from the curtain onto the real storefront, and it is already where
// the round's a11y work lives ("the gate is a dialog" above is PL-5). A fifth Playwright
// config, port and CI step to assert one attribute would cost more than it proves.
//
// THE FINDING. BoundBook rendered <Image alt={title.title}>, and every call site prints the
// title again as adjacent text. A screen reader therefore announced each book twice —
// "The Rescue, image" then "The Rescue" — on a shelf of them. app/my-library/page.js:78 had
// always had this right; the storefront had not.
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('cover images are decorative', () => {
  async function enterShop(page) {
    await page.goto('/bookstore');
    await page.getByTestId('gate-passcode').fill(GATE_PASSCODE);
    await page.getByTestId('gate-enter').click();
    await expect(page.locator('.hero-store')).toBeVisible({ timeout: 30000 });
  }

  test('every BoundBook cover on the shelf carries an empty alt', async ({ page }) => {
    await enterShop(page);

    // .bb-front is BoundBook's own face class, so this cannot drift onto some other image.
    const covers = page.locator('.bb-front img');
    // WAIT FOR A COVER, NOT FOR AN ENTRY. The catalogue arrives from live Firebase and the
    // sections paint progressively: .shelf-entry becomes visible a beat before its <img>
    // exists, so counting on the entry alone raced and read 0. toBeAttached retries; count()
    // does not — an unretried count is the classic false negative in this harness.
    await expect(covers.first()).toBeAttached({ timeout: 30000 });
    const n = await covers.count();
    expect(n, 'the live catalogue must put at least one bound book on the shelf').toBeGreaterThan(0);

    for (let i = 0; i < n; i++) {
      // '' not null: the attribute has to be PRESENT and empty. A missing alt is an entirely
      // different announcement — assistive tech falls back to reading the file name.
      await expect(covers.nth(i)).toHaveAttribute('alt', '');
    }
  });

  test('the title is still announced once, as text beside the cover', async ({ page }) => {
    // The other half of the fix, and the half that makes alt="" correct rather than lossy.
    // If a redesign ever drops .entry-title, the cover becomes the only carrier of the name
    // and alt="" turns a decorative image into a silent one — this is what would catch it.
    await enterShop(page);
    const entry = page.locator('.shelf-entry').first();
    await expect(entry.locator('.bb-front img')).toBeAttached({ timeout: 30000 });

    const titleText = (await entry.locator('.entry-title').innerText()).trim();
    expect(titleText.length, 'every shelf entry must print its title as text').toBeGreaterThan(0);
    await expect(entry.locator('.bb-front img')).toHaveAttribute('alt', '');
  });

  test('the detail page names the book once in the heading, not twice', async ({ page }) => {
    await enterShop(page);
    await gotoDetail(page);

    const cover = page.locator('.bd-cover-wrap .bb-front img');
    await expect(cover).toBeAttached({ timeout: 30000 });
    await expect(cover).toHaveAttribute('alt', '');
    await expect(page.locator('h1')).toBeVisible();
  });
});
