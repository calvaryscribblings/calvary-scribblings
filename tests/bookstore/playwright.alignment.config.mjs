import { defineConfig, devices } from '@playwright/test';

// R28 — THE DETAIL PAGE'S ALIGNMENT. Driven against out/, same server and the same
// live-Firebase decision as the gate, reveal, cover-arrival, rhythm and shelf-arrival
// harnesses beside it. PORT 4336, so it runs alongside all of them.
//
// Both widths, because the ruling is a DIFFERENCE between them: the head blocks are centred at
// 402 and left at 1280, and a suite pinned to one width could not tell the ruling from a
// blanket.
const PORT = process.env.ALIGNMENT_PORT || 4336;

export default defineConfig({
  testDir: '.',
  testMatch: 'alignment.spec.mjs',
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
    url: `http://127.0.0.1:${PORT}/bookstore`,
    reuseExistingServer: true,
    timeout: 20000,
    env: { APP_PORT: String(PORT) },
  },
});
