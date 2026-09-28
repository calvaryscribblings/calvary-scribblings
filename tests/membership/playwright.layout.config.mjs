// W27 — /membership's drawing, measured over out/ (tests/reader/app-server.mjs). Signed out.
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.APP_PORT || 4322;

export default defineConfig({
  testDir: '.',
  testMatch: 'page-layout.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    serviceWorkers: 'block',
    launchOptions: { args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-background-networking', '--disable-features=IsolateOrigins,site-per-process,TranslateUI'] },
  },
  webServer: {
    command: `node ${new URL('../reader/app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/reading-room.html`,
    reuseExistingServer: true,
    timeout: 20000,
    env: { APP_PORT: String(PORT) },
  },
});
