import { defineConfig, devices } from '@playwright/test';

// W53 — Mute, Block and Report a message, on the EMULATOR. Same fence as the W5 harness:
// NEXT_PUBLIC_FB_EMULATOR=1 and a localhost page (app/lib/firebase.js). Nothing here touches
// production. Run: npm run test:square:w53
const PORT = process.env.SQUARE_W53_PORT || 4353;

export default defineConfig({
  testDir: '.',
  testMatch: 'w53.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    launchOptions: { args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'] },
  },
  webServer: {
    command: `NEXT_PUBLIC_FB_EMULATOR=1 npx next dev -p ${PORT}`,
    cwd: new URL('../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/square`,
    reuseExistingServer: false,
    timeout: 180000,
    env: { NEXT_PUBLIC_FB_EMULATOR: '1' },
  },
});
