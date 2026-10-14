// W46 — Readers' Notes with the flag OFF (tests/series-notes/ui/notes-flagoff.spec.mjs): the same
// emulator fixture, a build WITHOUT NEXT_PUBLIC_SERIES_NOTES_PREVIEW, so notesEnabled() is the
// committed constant (false). /series must draw the pre-W46 grid and no door; the room nothing.
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.W46_UI_OFF_PORT || 4382;

export default defineConfig({
  testDir: '.',
  testMatch: 'notes-flagoff.spec.mjs',
  outputDir: '../../../test-results/series-notes-ui/artifacts-off',
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
    env: { NEXT_PUBLIC_FB_EMULATOR: '1' },
  },
});
