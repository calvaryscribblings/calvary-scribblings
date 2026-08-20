import { defineConfig, devices } from '@playwright/test';

// THE FLIP HARNESS — R17.3, driven against out/, the real static export.
//
// Same server and same live-Firebase decision as the gate, currency, territory, placement,
// boundbook and masthead harnesses beside it. PORT 4329, so it can run alongside all six.
//
// deviceScaleFactor 1 on purpose: nothing here is measured, only pressed. A wide viewport so
// the Window's case, a curated case and a full shelf row are all on one page.
const PORT = process.env.FLIP_PORT || 4329;

export default defineConfig({
  testDir: '.',
  testMatch: 'flip.spec.mjs',
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
