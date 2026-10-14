// W46 §5 — the Series reader's last page, line and place (last-page.spec.mjs), against the
// Firebase emulators and `next dev`, ONCE PER BUILD OF THE FLAG:
//
//   W46_NOTES=0  → notes-off: forced off (NEXT_PUBLIC_SERIES_NOTES_PREVIEW=0), the rollback state
//   W46_NOTES=1  → notes-on:  the preview build (NEXT_PUBLIC_SERIES_NOTES_PREVIEW=1)
//
// The flag is inlined at build time, so the two cannot share a server; `npm run
// test:series-notes:reader` runs this config twice, one after the other (two `next dev`s in one
// worktree would fight over .next). Emulator only: NEXT_PUBLIC_FB_EMULATOR=1 on localhost (the
// fence in app/lib/firebase.js). The one production touch is a signed-out, read-only GET of the
// PUBLIC series_instalments node, to borrow an id the static route knows (see the spec).
import { defineConfig, devices } from '@playwright/test';

const ON = process.env.W46_NOTES === '1';
const PORT = process.env.W46_READER_PORT || (ON ? 4463 : 4464);
// Set to '' when off rather than left out, so a value exported in a developer's shell cannot
// leak into the off build.
const env = { NEXT_PUBLIC_FB_EMULATOR: '1', NEXT_PUBLIC_SERIES_NOTES_PREVIEW: ON ? '1' : '0' };

export default defineConfig({
  testDir: '.',
  testMatch: 'last-page.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 240000,
  expect: { timeout: 20000 },
  reporter: [['list']],
  projects: [{ name: ON ? 'notes-on' : 'notes-off', metadata: { notes: ON } }],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1100, height: 900 },
    serviceWorkers: 'block',
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    },
  },
  webServer: {
    command: `${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')} npx next dev -p ${PORT}`,
    cwd: new URL('../../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/series`,
    reuseExistingServer: false,
    timeout: 240000,
    env,
  },
});
