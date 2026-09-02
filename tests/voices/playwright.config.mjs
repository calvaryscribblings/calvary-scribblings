import { defineConfig, devices } from '@playwright/test';

// R32 — the card's held heights, measured over the live pool in a real engine.
// No webServer: the harness is set with page.setContent and needs only the network for
// Google Fonts, so this runs without a build. See heights.spec.mjs for why it is a harness
// and not out/.
export default defineConfig({
  testDir: '.',
  testMatch: 'heights.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    },
  },
});
