import { defineConfig, devices } from '@playwright/test';

// THE SERIES ADMIN HARNESS.
//
// ── WHY next dev AND NOT out/, WHICH EVERY OTHER SUITE HERE USES ─────────────────────────
//
// tests/reader/playwright.app.config.mjs makes the case for driving the static export: with
// output:'export', out/ IS the application, and a dev server exercises a different pipeline
// than Cloudflare Pages serves. That argument is right and it does not apply here, for a
// reason specific to this suite.
//
// The emulator switch in app/lib/firebase.js is keyed on NEXT_PUBLIC_FB_EMULATOR, which Next
// INLINES AT BUILD TIME. Driving out/ would therefore mean building the whole site with that
// flag set — and that build would overwrite the same out/ that the reader and gate suites, and
// any local `npm run build`, expect to be a production export. A directory that is sometimes
// pointed at 127.0.0.1 depending on which suite ran last is a trap worth more than the
// fidelity it buys. `next dev` compiles with the variable in its own process and leaves out/
// alone.
//
// What this suite is asserting is a client component's own logic and the Firebase calls it
// makes. Neither is a bundler-pipeline question, which is the thing out/ protects.
//
// ── THE EMULATORS ARE STARTED BY THE npm SCRIPT, NOT BY webServer ────────────────────────
//
// `npm run test:sponsor` wraps the whole run in `firebase emulators:exec`, the same way
// test:rules does. They must already be up when the dev server serves its first page, and a
// Playwright webServer entry gives no way to order two processes.
const PORT = process.env.SPONSOR_PORT || 4325;

export default defineConfig({
  testDir: '.',
  testMatch: 'sponsor-logo.spec.mjs',
  // SERIAL, and load-bearing. Every test in the file reseeds the same fixture records in
  // beforeEach; two workers would be clearing each other's rows mid-assertion.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1100, height: 900 },
    launchOptions: {
      args: [
        '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--disable-software-rasterizer', '--disable-background-networking',
        '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
      ],
    },
  },
  webServer: {
    // localhost, not 127.0.0.1: the fence in app/lib/firebase.js checks the HOSTNAME, and a
    // baseURL that did not satisfy it would silently drive the suite against production.
    command: `NEXT_PUBLIC_FB_EMULATOR=1 npx next dev -p ${PORT}`,
    // webServer inherits the CONFIG's directory, not the repo root, and `next dev` started
    // from tests/series/ reports "Couldn't find any `pages` or `app` directory".
    cwd: new URL('../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/admin/series`,
    reuseExistingServer: false,
    timeout: 180000,
    env: { NEXT_PUBLIC_FB_EMULATOR: '1' },
  },
});
