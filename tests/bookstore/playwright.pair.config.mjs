import { defineConfig, devices } from '@playwright/test';

// THE PAIR HARNESS — R19.8, driven against out/, the real static export.
//
// WHY A SUITE OF ITS OWN RATHER THAN A CASE IN territory.spec.mjs OR currency.spec.mjs.
// Those two are the nearest bookstore browser suites that open /bookstore/[slug] and both
// already run in CI, so either would have been a shorter diff. Neither fits:
//
//   1. THEY ARE PINNED TO ONE VIEWPORT (400×800), by their configs, because what they assert
//      — which mark is shown, which currency the button names — is viewport-independent. This
//      suite's whole subject is geometry at THREE widths, and the mismatch it guards was
//      11.83px at 820 and 1280 but 87.34px at 390, where the row wrapped. A contract that only
//      one of those three widths could ever fail is not the contract Ikenna asked for.
//
//   2. THEY ARE INVARIANT SUITES OVER A LIVE CATALOGUE and say so at length in their heads:
//      they assert the ruling over whatever is on the shelf and never touch the DOM. This one
//      MUTATES the page on purpose — it deletes the availability note to prove neither control
//      moves, and it forces [data-unavailable] on because no title in the catalogue is
//      restricted today. Mixing a mutating suite into an observing one would quietly weaken
//      both, and the next reader would not know which cases could be trusted to be reading the
//      real page.
//
// So it follows the house pattern instead — gate, currency, territory, placement, boundbook,
// masthead and flip are each their own spec, config and port. PORT 4330, beside all seven.
//
// FIREBASE IS LIVE, like its siblings: the book under measurement is a real catalogue record,
// and every assertion here is a relation BETWEEN the two controls rather than a pixel count,
// so it survives any price, any label and any font that loads. /api/bookstore/region is always
// stubbed — out/ is static, there are no Pages Functions behind it, and a geometry test whose
// result depended on where CI happened to run would fail in Lagos.
//
// deviceScaleFactor 1 is NOT cosmetic here. Everything below is measured in CSS pixels off
// getBoundingClientRect(), and a scale factor of 2 would halve the resolution of the 0.5px
// tolerance the ruling is stated in.
const PORT = process.env.PAIR_PORT || 4330;

export default defineConfig({
  testDir: '.',
  testMatch: 'pair.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    // The per-test viewport is set inside the spec — see VIEWPORTS there. This is only the
    // starting size.
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--disable-software-rasterizer', '--disable-background-networking',
        '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
        '--renderer-process-limit=2', '--js-flags=--max-old-space-size=256',
      ],
    },
  },
  webServer: {
    command: `APP_PORT=${PORT} node ${new URL('../reader/app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/bookstore`,
    reuseExistingServer: true,
    timeout: 20000,
    env: { APP_PORT: String(PORT) },
  },
});
