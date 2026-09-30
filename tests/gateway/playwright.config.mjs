// W31 — the gateway's two doors, over out/ (tests/reader/app-server.mjs). Signed out.
//   npm run test:gateway      (builds first)
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.GATEWAY_PORT || 4347;

export default defineConfig({
  testDir: '.',
  testMatch: 'doors.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    serviceWorkers: 'block',
    launchOptions: { args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-background-networking'] },
  },
  webServer: {
    command: `node ${new URL('../reader/app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/reading-room.html`,
    reuseExistingServer: true,
    timeout: 20000,
    env: { APP_PORT: String(PORT) },
  },
});
