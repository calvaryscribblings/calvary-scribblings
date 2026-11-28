import { defineConfig, devices } from '@playwright/test';
import { WEBKIT_ENV } from './webkit.mjs';

// BAR-1 — the site bar on /public-library, in WebKit with an iPhone profile, through every state the
// page passes through. Against the EMULATORS (auth, database) and `next dev`: invented records only,
// every browser request off localhost refused. Nothing here touches production.
//
//   npm run test:bar-1
const PORT = process.env.BAR1_PORT || 4383;
const { deviceScaleFactor: _dsf, defaultBrowserType: _b, ...iphone } = devices['iPhone 13'];

export default defineConfig({
  testDir: '.',
  testMatch: 'bar-1.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 300000,
  expect: { timeout: 60000 },
  reporter: [['list']],
  use: {
    ...iphone,
    // 1× density: softpipe renders every pixel in software (tests/storybar/webkit.mjs).
    deviceScaleFactor: 1,
    browserName: 'webkit',
    baseURL: `http://localhost:${PORT}`,
    serviceWorkers: 'block',
    launchOptions: { env: { ...process.env, ...WEBKIT_ENV } },
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
