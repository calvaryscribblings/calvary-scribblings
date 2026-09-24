import { defineConfig, devices } from '@playwright/test';

// W2 — THE DESIGNED-STATES HARNESS. Serves the built export (tests/reader/app-server.mjs, which
// answers a missing address with out/404.html as Cloudflare Pages does) and drives each surface
// with the Realtime Database made unreachable, then reachable again. Needs `next build` first.
const PORT = process.env.STATES_PORT || 4343;
// STATES_BASE_URL points the suite at a deployed site instead (no local server). Used in W2 to
// watch it fail against the live site before the deploy, and pass after.
const REMOTE = process.env.STATES_BASE_URL || null;

export default defineConfig({
  testDir: '.',
  testMatch: 'states.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  // Each failure case waits out the real 12s read deadline — deliberately not shortened for the
  // test, so what is asserted is the deadline the site ships.
  timeout: 90000,
  expect: { timeout: 25000 },
  reporter: [['list']],
  use: {
    baseURL: REMOTE || `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'] },
  },
  webServer: REMOTE ? undefined : {
    command: `APP_PORT=${PORT} node ${new URL('../reader/app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/public-library`,
    reuseExistingServer: false,
    timeout: 20000,
    env: { APP_PORT: String(PORT) },
  },
});
