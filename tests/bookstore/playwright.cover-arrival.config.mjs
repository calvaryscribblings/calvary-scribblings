import { defineConfig, devices } from '@playwright/test';

// R26 — THE COVER'S OWN ARRIVAL. Driven against out/, same server and the same live-Firebase
// decision as the gate, currency, territory, placement, boundbook and reveal harnesses beside
// it. PORT 4333, so it runs alongside all of them.
//
// The viewport is set per-describe inside the spec — this suite runs every case twice, at
// 1280 @dpr1 and at 390 @dpr3, because the two beats were not the same on the two. The
// handset carried a horizontal displacement the laptop did not.
const PORT = process.env.COVER_ARRIVAL_PORT || 4333;

export default defineConfig({
  testDir: '.',
  testMatch: 'cover-arrival.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    // W2 — THE SERVICE WORKER IS BLOCKED IN THIS HARNESS. It now registers site-wide (Providers),
    // and a /bookstore navigation goes through its respondWith(fetch(...)). page.route cannot see
    // a request a service worker makes, so the no-preload PROOF's rewrite of the detail page's
    // HTML stopped landing and the proof went red with nothing wrong in the page. The worker
    // passes these bytes through untouched in production; what this suite measures is the
    // document and its preload, so it measures them without the worker in the way.
    serviceWorkers: 'block',
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
