import { defineConfig, devices } from '@playwright/test';

// R34 — THE SEASONAL READING PROGRAM. Two suites, both driven against out/ by the
// same static server the bookstore harnesses use, and both against LIVE Firebase:
// the certified Summer 2026 board is the subject, and a fixture of it would test a
// copy of the thing that broke rather than the thing itself. The board is frozen
// (final present, closedAt a number), so it is a stable two-read subject.
//
// PORT 4339, so it runs alongside every other harness in tests/.
const PORT = process.env.PROGRAM_PORT || 4339;

export default defineConfig({
  testDir: '.',
  testMatch: /(strip|phase)\.spec\.mjs/,
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: [
        '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--disable-software-rasterizer', '--disable-background-networking',
        '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
        '--renderer-process-limit=2', '--js-flags=--max-old-space-size=256',
      ],
    },
  },
  webServer: {
    command: `APP_PORT=${PORT} node ${new URL('../reader/app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/leaderboard`,
    reuseExistingServer: true,
    timeout: 20000,
    env: { APP_PORT: String(PORT) },
  },
});
