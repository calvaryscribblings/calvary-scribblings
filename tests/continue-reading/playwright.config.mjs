import { defineConfig, devices } from '@playwright/test';

// CR-2 — Continue Reading in real pages on the EMULATORS (auth, database). Same fence as the TEXT-W1
// and W5 harnesses: NEXT_PUBLIC_FB_EMULATOR=1 and a localhost page (app/lib/firebase.js) for the
// browser; FIREBASE_DATABASE_EMULATOR_HOST for the dev server's own reads of cms_stories (the
// Firebase SDK honours it in place of the production URL). The spec seeds an invented story that
// production has never had and opens its page, which proves the server read the emulator. Every
// request the browser makes off localhost is refused. Nothing here touches production.
//
//   npm run test:continue-reading
const PORT = process.env.CR2_PORT || 4381;

export default defineConfig({
  testDir: '.',
  testMatch: 'continue-reading.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300000,
  expect: { timeout: 30000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    launchOptions: { args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'] },
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    cwd: new URL('../../', import.meta.url).pathname,
    url: `http://localhost:${PORT}/about`,
    reuseExistingServer: false,
    timeout: 240000,
    env: {
      NEXT_PUBLIC_FB_EMULATOR: '1',
      FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      GOOGLE_APPLICATION_CREDENTIALS: '',
    },
  },
});
