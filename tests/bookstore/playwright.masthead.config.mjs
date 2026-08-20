import { defineConfig, devices } from '@playwright/test';

// THE MASTHEAD HARNESS — driven against out/, the real static export.
//
// Same server and same live-Firebase decision as the gate, currency, territory, placement and
// boundbook harnesses beside it. PORT 4328, so it can run alongside all five.
//
// 390px is not an arbitrary phone: it is where .hero-store's clamp() bottoms out on its 3.6rem
// floor, which is the narrowest the display line ever sets and the worst case for the lockup.
// deviceScaleFactor 3 because the probe reads a glyph edge — at dsf 1 the quantisation is
// comparable to the thing being measured.
const PORT = process.env.MASTHEAD_PORT || 4328;

export default defineConfig({
  testDir: '.',
  testMatch: 'masthead.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 900 },
    deviceScaleFactor: 3,
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
