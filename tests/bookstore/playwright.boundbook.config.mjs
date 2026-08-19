import { defineConfig, devices } from '@playwright/test';

// THE HOUSE-DESIGN HARNESS — R16, driven against out/.
//
// Same argument, same server and same live-Firebase decision as the gate, currency, territory
// and placement harnesses beside it. PORT 4327, so it can run alongside all four.
//
// deviceScaleFactor 4 is not cosmetic here: the contact-pool probe reads a sub-pixel edge, and
// at dsf 1 the quantisation is larger than the thing being measured.
const PORT = process.env.BOUNDBOOK_PORT || 4327;

export default defineConfig({
  testDir: '.',
  testMatch: 'boundbook.spec.mjs',
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
    deviceScaleFactor: 4,
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
