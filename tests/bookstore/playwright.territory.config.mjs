import { defineConfig, devices } from '@playwright/test';

// THE TERRITORY HARNESS — R8.4, driven against out/.
//
// Same argument as playwright.gate.config.mjs and playwright.currency.config.mjs, and it reuses
// the same server (tests/reader/app-server.mjs): next.config.mjs sets output:'export', so out/
// IS the application, and a dev server would exercise a different bundler pipeline than the one
// Cloudflare Pages serves.
//
// A DIFFERENT PORT (4325) so this can run beside the reader (4322), gate (4323) and currency
// (4324) suites without any of them stealing another's `reuseExistingServer`.
//
// FIREBASE IS LIVE, deliberately — the shelf under test is the real catalogue, and the
// assertions are invariants over whatever is on it rather than fixtures. The head of
// territory.spec.mjs sets out why, and which of its cases are dormant until a restricted title
// exists. /api/bookstore/region is ALWAYS stubbed: out/ is static, so there are no Pages
// Functions behind it, and marks that depended on where CI runs would fail in Lagos.
const PORT = process.env.TERRITORY_PORT || 4325;

export default defineConfig({
  testDir: '.',
  testMatch: 'territory.spec.mjs',
  workers: 1,
  fullyParallel: false,
  // Matches the sibling suites: the local retry absorbs this container's memory ceiling, which
  // is a container fact and absent on a runner. Green in CI means green, not green on retry.
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 400, height: 800 },
    hasTouch: true,
    isMobile: false,
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
