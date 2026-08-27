import { defineConfig, devices } from '@playwright/test';

// R25 — THE STOREFRONT'S VERTICAL RHYTHM. Driven against out/, same server and the same
// live-Firebase decision as the gate, currency, territory, placement, boundbook, reveal and
// cover-arrival harnesses beside it. PORT 4334, so it runs alongside all of them.
//
// The viewport is set per-describe inside the spec — every case runs at 402 (the handset
// Ikenna measured on) and at 1280, because the catalogue's vertical padding used to be a
// BREAKPOINT (48 on a handset, 64 on a laptop) and a suite pinned to one width would have
// been green through half the defect.
const PORT = process.env.RHYTHM_PORT || 4334;

export default defineConfig({
  testDir: '.',
  testMatch: 'rhythm.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
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
