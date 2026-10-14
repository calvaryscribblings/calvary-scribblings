// W46 §7 — the Readers' Notes section of the Series admin, driven on the emulators.
//   npm run test:series-notes-admin
// Same harness as tests/series/playwright.w38.config.mjs (read its notes on why `next dev` and not
// out/, and why the emulators are started by the npm script). /api/series/notes is stubbed with
// page.route in the spec; nothing here reaches production.
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.W46_ADMIN_PORT || 4361;

export default defineConfig({
  testDir: '.',
  testMatch: 'admin-notes.spec.mjs',
  // SERIAL: every test reseeds the same fixture records.
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
      ],
    },
  },
  webServer: {
    // localhost, not 127.0.0.1: the emulator fence in app/lib/firebase.js checks the hostname.
    command: `NEXT_PUBLIC_FB_EMULATOR=1 npx next dev -p ${PORT}`,
    cwd: new URL('../../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/admin/series`,
    reuseExistingServer: false,
    timeout: 180000,
    env: { NEXT_PUBLIC_FB_EMULATOR: '1' },
  },
});
