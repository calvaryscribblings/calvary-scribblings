// SERIES-MOVE (ruling 233) — The Series under Just Added, measured on the homepage
// (tests/series/home-placement.spec.mjs). Same shape as playwright.w38.config.mjs beside it,
// and for the same reasons (next dev with the emulator flag, never out/); run by
// `npm run test:series-home`.
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.SERIES_HOME_PORT || 4328;

export default defineConfig({
  testDir: '.',
  testMatch: 'home-placement.spec.mjs',
  // SERIAL: every test reseeds the same nodes.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 30000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    // The reveal animation translates headers by 16px until it runs; measure the settled page.
    reducedMotion: 'reduce',
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    },
  },
  webServer: {
    // localhost, not 127.0.0.1: the fence in app/lib/firebase.js checks the HOSTNAME.
    command: `NEXT_PUBLIC_FB_EMULATOR=1 npx next dev -p ${PORT}`,
    cwd: new URL('../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/public-library`,
    reuseExistingServer: false,
    timeout: 240000,
    env: { NEXT_PUBLIC_FB_EMULATOR: '1' },
  },
});
