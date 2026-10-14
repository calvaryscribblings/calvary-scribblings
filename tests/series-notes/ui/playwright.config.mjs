// W46 — Readers' Notes, the reader's screens (tests/series-notes/ui/notes-ui.spec.mjs).
//
//   npm run test:series-notes:ui
//
// Emulators only (NEXT_PUBLIC_FB_EMULATOR=1 on localhost, the fence in app/lib/firebase.js), and
// the feature switched on for THIS build only by NEXT_PUBLIC_SERIES_NOTES_PREVIEW=1, which
// notesEnabled() honours and Cloudflare's build never sets. Screenshots go to test-results/
// (gitignored). The flag-off half is playwright.flagoff.config.mjs, run after this one.
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.W46_UI_PORT || 4381;

export default defineConfig({
  testDir: '.',
  testMatch: 'notes-ui.spec.mjs',
  outputDir: '../../../test-results/series-notes-ui/artifacts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 240000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    },
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    cwd: new URL('../../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/series`,
    reuseExistingServer: false,
    timeout: 240000,
    env: { NEXT_PUBLIC_FB_EMULATOR: '1', NEXT_PUBLIC_SERIES_NOTES_PREVIEW: '1' },
  },
});
