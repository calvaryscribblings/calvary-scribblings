import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.APP_PORT || 4322;

// THE APP HARNESS — Playwright across the React boundary.
//
// It drives out/ — the real static export, the exact artifact Cloudflare Pages serves —
// rather than `next dev`. Three reasons, in order of weight:
//   1. next.config.mjs sets output:'export'. There is no server half to develop against;
//      out/ IS the application. A dev server would test a different bundler pipeline.
//   2. Measured, this container runs with ~200 MB free (the editor server holds ~3 GB) and
//      Chromium already crashes there under load. next dev adds a second Node process, a
//      compiler and HMR sockets to a machine that cannot afford them.
//   3. It is reproducible: no compile-on-navigate, no first-hit latency.
//
// Firebase is NOT stubbed. The reader resolves its story from live cms_stories over the
// real network, which is what makes this an app test rather than a second host test. It
// needs a working connection and a published slug.
export default defineConfig({
  testDir: '.',
  testMatch: 'app.spec.mjs',
  workers: 1,
  fullyParallel: false,
  // R7.3 §G: no retries in CI — see the note in playwright.config.mjs. The retry exists for
  // this container's memory ceiling and nothing else.
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 400, height: 800 },
    hasTouch: true,
    isMobile: false,
    deviceScaleFactor: 1,
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
    command: `node ${new URL('./app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/reading-room.html`,
    reuseExistingServer: true,
    timeout: 20000,
    env: { APP_PORT: String(PORT) },
  },
});
