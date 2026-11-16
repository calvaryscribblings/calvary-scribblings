import { defineConfig, devices } from '@playwright/test';

// TEXT-W1 — every multi-line box grows the same way (390) and nothing is under the phone keyboard
// (391), in real pages on the EMULATORS. Same fence as the W5 harness: NEXT_PUBLIC_FB_EMULATOR=1 and
// a localhost page (app/lib/firebase.js). Nothing here touches production. Run: npm run test:text:w1
const PORT = process.env.TEXT_W1_PORT || 4371;

export default defineConfig({
  testDir: '.',
  testMatch: 'text-w1.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 240000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1024, height: 844 },
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
