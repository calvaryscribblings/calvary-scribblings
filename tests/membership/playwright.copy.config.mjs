import { defineConfig, devices } from '@playwright/test';

// THE MEMBERSHIP COPY HARNESS — R11.13's page, driven against out/.
//
// Same argument as tests/bookstore/playwright.gate.config.mjs and the reader app suite, and it
// reuses their server (tests/reader/app-server.mjs): next.config.mjs sets output:'export', so
// out/ IS the application. A dev server would exercise a different bundler pipeline than the
// one Cloudflare Pages serves, and this suite's whole job is to assert what actually ships.
//
// A DIFFERENT PORT (4325) so it can run beside the reader and gate suites without either
// stealing the other's reuseExistingServer.
//
// NO FIREBASE DEPENDENCE. Every assertion here is about copy that renders for a SIGNED-OUT
// reader from the static HTML and the client's own price table. Nothing in this suite reads or
// writes production data, and nothing in it needs an account.
const PORT = process.env.MEMBERSHIP_PORT || 4325;

export default defineConfig({
  testDir: '.',
  testMatch: 'copy.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1200, height: 900 },
    launchOptions: {
      args: [
        '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--disable-software-rasterizer', '--disable-background-networking',
      ],
    },
  },
  webServer: {
    command: `APP_PORT=${PORT} node ${new URL('../reader/app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/membership`,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
