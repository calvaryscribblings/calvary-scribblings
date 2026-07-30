import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.HARNESS_PORT || 4321;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  // app.spec.mjs is the OTHER harness: it needs out/ and its own server, and runs from
  // playwright.app.config.mjs. A negative lookahead in testMatch does not work here —
  // Playwright matches the absolute path, so the anchor never sees the filename.
  testIgnore: 'app.spec.mjs',
  // The reader is a geometry surface: two specs racing the same paginator on the same
  // machine produce timing noise that looks like a bug. One worker, in order.
  workers: 1,
  fullyParallel: false,
  // The container runs with ~130 MB free (the editor server holds ~3 GB), and a renderer
  // that loses that race reports "Target crashed" from wherever it happened to be. One
  // retry absorbs that; it cannot hide a real defect, because a real defect fails again.
  //
  // R7.3 §G: NONE in CI. The retry is compensation for a codespace's memory, not for the
  // reader — a GitHub runner has 16 GB and a normal /dev/shm, so the crash it absorbs
  // cannot happen there and the only thing a retry could still hide is a real flake.
  retries: process.env.CI ? 0 : 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // A phone-shaped viewport with touch: the tap-zone bug is a touch bug, and a desktop
    // context would never dispatch the compatibility click the latch exists to swallow.
    ...devices['Desktop Chrome'],
    viewport: { width: 400, height: 800 },
    hasTouch: true,
    isMobile: false,
    deviceScaleFactor: 1,
    // /dev/shm is 64 MB in a devcontainer and Chromium renders each EPUB section in its own
    // iframe — measured: the shell crashes ("Target crashed") within a few navigations
    // without this. A container fact, not a product one. Declared after the device spread
    // so nothing can shadow it.
    launchOptions: {
      args: [
        '--disable-dev-shm-usage',      // /dev/shm is 64 MB here
        '--no-sandbox',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-background-networking',
        // Every EPUB section is its own iframe. Without this the shell spawns a renderer
        // per frame and the container (measured: ~130 MB free with the editor running)
        // runs out of memory mid-suite, which surfaces as "Target crashed".
        '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
        '--renderer-process-limit=2',
        '--js-flags=--max-old-space-size=256',
      ],
    },
  },
  webServer: {
    command: `node ${new URL('./static-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/reading-room.html`,
    reuseExistingServer: true,
    timeout: 20000,
    env: { HARNESS_PORT: String(PORT) },
  },
});
