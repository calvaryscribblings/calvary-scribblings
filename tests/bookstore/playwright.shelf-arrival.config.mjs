import { defineConfig, devices } from '@playwright/test';

// R27 — THE SHELF ARRIVES FINISHED. Driven against out/, same server and the same live-Firebase
// decision as the gate, currency, territory, placement, boundbook, reveal, cover-arrival and
// rhythm harnesses beside it. PORT 4335, so it runs alongside all of them.
//
// Both viewports, because the two paths this measures did not behave the same at both: at 1280
// a tab switch left two of ten covers still to decode where at 402 all ten were already in
// cache, and the shelf's distance below the fold at first load differs by 430px.
const PORT = process.env.SHELF_ARRIVAL_PORT || 4335;

export default defineConfig({
  testDir: '.',
  testMatch: 'shelf-arrival.spec.mjs',
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
