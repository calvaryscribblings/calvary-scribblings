import { defineConfig, devices } from '@playwright/test';

// W22 — Desiderata signed in, against the EMULATORS. `npm run test:desiderata` starts them
// (firebase emulators:exec) before this config serves the app, the way test:sponsor does.
//
// localhost, not 127.0.0.1: the fence in app/lib/firebase.js checks the HOSTNAME, and a baseURL
// that did not satisfy it would silently drive the suite against production.
const PORT = process.env.DESIDERATA_PORT || 4344;

export default defineConfig({
  testDir: '.',
  testMatch: 'desiderata.spec.mjs',
  // SERIAL: every test reseeds the same reader's nodes in beforeEach.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 180000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
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
    command: `NEXT_PUBLIC_FB_EMULATOR=1 npx next dev -p ${PORT}`,
    cwd: new URL('../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/bookstore`,
    // A first compile of /bookstore under Turbopack takes ~55s here, during which new connections
    // are refused; a warm server started beforehand (same command) is reused.
    reuseExistingServer: true,
    timeout: 240000,
    env: { NEXT_PUBLIC_FB_EMULATOR: '1' },
  },
});
