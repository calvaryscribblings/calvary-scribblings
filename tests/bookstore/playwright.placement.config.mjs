import { defineConfig, devices } from '@playwright/test';

// THE PLACEMENT HARNESS — R15, driven against out/.
//
// Same argument, same server and same live-Firebase decision as the gate, currency and
// territory harnesses beside it: next.config.mjs sets output:'export', so out/ IS the
// application, and the shelves under test are the real ones.
//
// A DIFFERENT PORT (4326) so it can run beside the reader (4322), gate (4323), currency (4324)
// and territory (4325) suites without any of them stealing another's `reuseExistingServer`.
//
// The viewport is a LAPTOP here and the two phone cases set their own — placement is a fact
// about the scroll, and the scroll is a different length on each.
const PORT = process.env.PLACEMENT_PORT || 4326;

export default defineConfig({
  testDir: '.',
  testMatch: 'placement.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
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
