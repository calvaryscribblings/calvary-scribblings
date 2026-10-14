// W46 §5 — the reading-room FRAME's opt-in line chip, in CHROMIUM AND WEBKIT.
//
//   npm run test:series-notes:reader   (runs this, then the two Series reader configs)
//
// Serves public/ with tests/ at /__t/ through the reader harness's own static server, on its
// OWN port with no reuse: a parallel worktree's harness on 4321 would serve that worktree's
// public/, and this suite would be testing someone else's frame.
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.W46_FRAME_PORT || 4461;

const CHROMIUM_ARGS = [
  '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
  '--disable-software-rasterizer', '--disable-background-networking',
  '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
  '--renderer-process-limit=2', '--js-flags=--max-old-space-size=256',
];
const shape = { serviceWorkers: 'block', viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1, baseURL: `http://127.0.0.1:${PORT}` };

export default defineConfig({
  testDir: '.',
  testMatch: 'line-chip.spec.mjs',
  workers: 1,
  fullyParallel: false,
  // The reader harness's reasoning: one retry for this container's memory, none in CI.
  retries: process.env.CI ? 0 : 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  projects: [
    { name: 'frame-chromium', use: { ...devices['Desktop Chrome'], ...shape, launchOptions: { args: CHROMIUM_ARGS } } },
    { name: 'frame-webkit', use: { ...devices['Desktop Safari'], ...shape } },
  ],
  webServer: {
    command: `node ${new URL('../../reader/static-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/reading-room.html`,
    reuseExistingServer: false,
    timeout: 20000,
    env: { HARNESS_PORT: String(PORT) },
  },
});
