import { defineConfig, devices } from '@playwright/test';

// R30.2 — THE OPENING ROW OF EACH HALF IS CENTRED. Driven against out/, same server and the
// same live-Firebase decision as the gate, currency, territory, placement, rhythm, boundbook,
// reveal and cover-arrival harnesses beside it. PORT 4338, so it runs alongside all of them.
//
// The viewport is set per-case inside the spec, and it sweeps FIVE widths — not because the
// column count changes (R16 fixed it at three everywhere) but because that claim is exactly
// what a suite about "the first row" has to hold the line on. If a future round reintroduces
// an auto-fill rule, the widths below are where it shows up.
const PORT = process.env.OPENING_ROW_PORT || 4338;

export default defineConfig({
  testDir: '.',
  testMatch: 'opening-row.spec.mjs',
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
