import { defineConfig, devices } from '@playwright/test';

// THE W22 ROOMS HARNESS — the shop's bar, the shelf's readers row, the page's +, and the two
// rooms — driven against out/, the real static export, signed out.
//
// Same server and same live-Firebase decision (public reads only) as the masthead, gate,
// currency, territory, placement and boundbook harnesses beside it. PORT 4345.
//
// deviceScaleFactor 3 because several probes read INK — a cap's top and bottom, a glyph's edge —
// and at dsf 1 the quantisation is comparable to the half-pixel being asserted.
const PORT = process.env.ROOMS_PORT || 4345;

export default defineConfig({
  testDir: '.',
  testMatch: 'rooms.spec.mjs',
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
