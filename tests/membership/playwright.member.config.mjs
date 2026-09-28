// W27 — /membership and /settings in MEMBER states, from a membership mocked in the Firebase
// emulator. Run with `npm run test:membership-member` (emulators:exec + an emulator-only next dev).
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.MEMBER_PORT || 4346;

export default defineConfig({
  testDir: '.',
  testMatch: 'page-member.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 240000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block',
    launchOptions: { args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-background-networking', '--disable-features=IsolateOrigins,site-per-process,TranslateUI'] },
  },
  webServer: {
    command: `NEXT_PUBLIC_FB_EMULATOR=1 npx next dev -p ${PORT}`,
    cwd: new URL('../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/membership`,
    reuseExistingServer: true,
    timeout: 240000,
    env: { NEXT_PUBLIC_FB_EMULATOR: '1' },
  },
});
