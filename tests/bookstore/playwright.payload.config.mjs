import { defineConfig, devices } from '@playwright/test';

// THE PAYLOAD HARNESS — R20, driven against out/, the real static export.
//
// Same server and same live-Firebase decision as the gate, currency, territory, placement,
// boundbook, masthead, flip and pair harnesses beside it, and PORT 4331 so it runs alongside
// all eight.
//
// A SUITE OF ITS OWN rather than cases in boundbook.spec.mjs, which is the nearest suite that
// already measures boards: that one asserts the DRAWING — three across, the fore-edge width,
// the shadow derivation — and every number in it is a ruling about how the shop looks. This
// one asserts what the shop WEIGHS, sets its own viewports per case, and needs a CDP session
// for the compositor's layer count. Mixing a budget into a design suite would mean a cover
// re-encode could turn the shadow-derivation cases red.
//
// deviceScaleFactor 1 is load-bearing: the oversample assertion compares a decoded bitmap's
// natural width against the CSS width it is drawn at, and a scale factor of 2 would make every
// board legitimately pull twice the pixels and quietly halve the ceiling's meaning.
const PORT = process.env.PAYLOAD_PORT || 4331;

export default defineConfig({
  testDir: '.',
  testMatch: 'payload.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  // Longer than its siblings on purpose. Every case here loads the whole shop and, in two
  // cases, scrolls it to the foot so the lazy covers are actually asked for.
  timeout: 180000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
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
    command: `APP_PORT=${PORT} node ${new URL('../reader/app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/bookstore`,
    reuseExistingServer: true,
    timeout: 20000,
    env: { APP_PORT: String(PORT) },
  },
});
