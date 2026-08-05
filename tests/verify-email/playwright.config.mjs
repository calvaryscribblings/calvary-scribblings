import { defineConfig, devices } from '@playwright/test';

// R9.5 — the verification resend's request shape and failure mapping, in a real browser.
//
// NO WEB SERVER and no app build. The modules under test are plain JS with no JSX, so they
// are injected from disk and driven directly; /api/auth/send-verification is intercepted by
// Playwright rather than called. That last part is not a shortcut — it is the only way to
// test this locally at all. The endpoint is a Cloudflare Pages Function, and next.config.mjs
// sets output:'export', so it does not exist in a local build. It runs on the deployed site
// or nowhere.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    },
  },
});
