import { defineConfig, devices } from '@playwright/test';

// R29 — THE STAND-IN. Driven against out/, same server and the same live-Firebase decision as
// the harnesses beside it. PORT 4337.
//
// One viewport, 390 @dpr3, on purpose: what this measures is paint order and the presence of a
// background, neither of which is a function of width. The suites that DO vary by width
// (rhythm, alignment, shelf-arrival) say so in their own headers.
const PORT = process.env.STANDIN_PORT || 4337;

export default defineConfig({
  testDir: '.',
  testMatch: 'cover-standin.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 180000,
  expect: { timeout: 60000 },
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
