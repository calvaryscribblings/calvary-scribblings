import { defineConfig, devices } from '@playwright/test';

// W5 — THE SAFETY ROUND'S BROWSER SUITE: the report queue page, the under-18 check, and the save
// toast. Same shape as tests/series/playwright.sponsor.config.mjs and for the same reasons: the
// emulator switch in app/lib/firebase.js is inlined at build time, so this drives `next dev`
// with NEXT_PUBLIC_FB_EMULATOR=1 and leaves out/ alone; the emulators are started by the npm
// script (`npm run test:safety`), not by webServer.
const PORT = process.env.SAFETY_PORT || 4327;

export default defineConfig({
  testDir: '.',
  testMatch: 'w5.spec.mjs',
  // Serial: every test reseeds the same emulator.
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
    serviceWorkers: 'block',
    launchOptions: {
      args: [
        '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--disable-software-rasterizer', '--disable-background-networking',
        '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
      ],
    },
  },
  webServer: {
    // localhost, not 127.0.0.1: the fence in app/lib/firebase.js checks the hostname.
    command: `NEXT_PUBLIC_FB_EMULATOR=1 npx next dev -p ${PORT}`,
    cwd: new URL('../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/admin/reports`,
    reuseExistingServer: false,
    timeout: 180000,
    env: { NEXT_PUBLIC_FB_EMULATOR: '1' },
  },
});
