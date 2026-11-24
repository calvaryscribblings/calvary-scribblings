// APPLE-W1 — Continue with Apple against the emulators: npm run test:apple-signin (tests/account/apple.spec.mjs).
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.APPLE_W1_PORT || 4372;

export default defineConfig({
  testDir: '.',
  testMatch: 'apple.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    launchOptions: { args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'] },
  },
  webServer: {
    command: `NEXT_PUBLIC_FB_EMULATOR=1 npx next dev -p ${PORT}`,
    cwd: new URL('../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/about`,
    reuseExistingServer: false,
    timeout: 180000,
    env: { NEXT_PUBLIC_FB_EMULATOR: '1' },
  },
});
