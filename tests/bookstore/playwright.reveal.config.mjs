import { defineConfig, devices } from '@playwright/test';

// R23 — THE ARRIVAL HARNESS. Driven against out/, same server and the same live-Firebase
// decision as the gate, currency, territory, placement and boundbook harnesses beside it.
//
// PORT 4332, so it runs alongside all of them.
//
// No deviceScaleFactor games here: what this suite measures is opacity and transform at a
// single frame, and neither is sub-pixel.
const PORT = process.env.REVEAL_PORT || 4332;

export default defineConfig({
  testDir: '.',
  testMatch: 'reveal.spec.mjs',
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
