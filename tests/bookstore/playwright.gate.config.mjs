import { defineConfig, devices } from '@playwright/test';

// THE GATE HARNESS — R8.1's curtain, driven against out/.
//
// Same argument as tests/reader/playwright.app.config.mjs, and it reuses that suite's server
// (tests/reader/app-server.mjs) rather than standing up a second one: next.config.mjs sets
// output:'export', so out/ IS the application, and a dev server would exercise a different
// bundler pipeline than the one Cloudflare Pages serves.
//
// A DIFFERENT PORT (4323) so this can run beside the reader suite without either stealing the
// other's `reuseExistingServer`.
//
// FIREBASE IS LIVE for the gate mechanics, deliberately: the assertion that matters most is
// that the real storefront appears once the key fits, and a stubbed catalogue would prove only
// that a stub renders. The waitlist spec is the exception and stubs its own transport — see the
// long note in gate.spec.mjs. Nothing in this suite writes to production.
const PORT = process.env.GATE_PORT || 4323;

export default defineConfig({
  testDir: '.',
  testMatch: 'gate.spec.mjs',
  workers: 1,
  fullyParallel: false,
  // Matches the reader suite: the local retry absorbs this container's memory ceiling, which is
  // a container fact and absent on a runner. Green in CI means green, not green on the retry.
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
