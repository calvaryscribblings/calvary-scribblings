import { defineConfig, devices } from '@playwright/test';

// NOTIF-B2 — the bell, the panel, /notifications and its settings, in real pages against the
// EMULATOR (NEXT_PUBLIC_FB_EMULATOR=1 and a localhost page: app/lib/firebase.js). Signed in only as
// invented emulator readers. Nothing here touches production. Run: npm run test:notify:bell
const PORT = process.env.NOTIF_BELL_PORT || 4362;

export default defineConfig({
  testDir: '.',
  testMatch: 'bell.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 240000,
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
