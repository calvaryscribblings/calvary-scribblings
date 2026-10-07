// W35 — an open Series page unlocks at its release minute without a reload.
//
//   npm run test:release-recheck
//
// Emulator only: NEXT_PUBLIC_FB_EMULATOR=1 on localhost (the fence in app/lib/firebase.js).
// The one production touch is a signed-out, read-only GET of the PUBLIC series_instalments
// node to pick an id `next dev` will serve — see the spec's header.
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.RELEASE_PORT || 4327;

export default defineConfig({
  testDir: '.',
  testMatch: 'release-recheck.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1100, height: 900 },
    serviceWorkers: 'block',
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    },
  },
  webServer: {
    command: `NEXT_PUBLIC_FB_EMULATOR=1 npx next dev -p ${PORT}`,
    cwd: new URL('../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/series`,
    reuseExistingServer: false,
    timeout: 240000,
    env: { NEXT_PUBLIC_FB_EMULATOR: '1' },
  },
});
