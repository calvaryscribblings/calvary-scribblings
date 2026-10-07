// W24 — printing and copying (ruling 93), in CHROMIUM AND WEBKIT.
//
//   npm run test:print-copy        (needs a built out/ for the app half: `npx next build` first)
//
// Two halves, two servers:
//   • harness-*  print-copy.spec.mjs over public/ (static-server.mjs) — the reader FRAME.
//   • app-*      the "W24" tests of app.spec.mjs over out/ (app-server.mjs) — the reader PAGE.
// The main reader configs stay Chromium-only; this one exists so the ruling is proven in WebKit too.
import { defineConfig, devices } from '@playwright/test';

const HARNESS = process.env.HARNESS_PORT || 4321;
const APP = process.env.APP_PORT || 4322;

const CHROMIUM_ARGS = [
  '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
  '--disable-software-rasterizer', '--disable-background-networking',
  '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
  '--renderer-process-limit=2', '--js-flags=--max-old-space-size=256',
];
// W36 — serviceWorkers: 'block'. The site's worker (public/sw.js) registers on every page of
// out/. It passes Storage requests through untouched, so real readers are unaffected, but once
// WebKit treats the page as controlled, Playwright's page.route() stops catching the reading
// room's EPUB fetch. The stub was bypassed and the harness token reached real Storage (404), so
// "the EPUB never opened". Intermittent on CI from the day this step was added (98293fde,
// 28 Sep): it depended on whether the worker had taken control before the fetch. Locally it
// failed every time. Same remedy as every other harness that stubs the network (W2).
const shape = { serviceWorkers: 'block', viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1 };
const chromium = { ...devices['Desktop Chrome'], ...shape, launchOptions: { args: CHROMIUM_ARGS } };
const webkit = { ...devices['Desktop Safari'], ...shape };

export default defineConfig({
  testDir: '.',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  projects: [
    { name: 'harness-chromium', testMatch: 'print-copy.spec.mjs', use: { ...chromium, baseURL: `http://127.0.0.1:${HARNESS}` } },
    { name: 'harness-webkit', testMatch: 'print-copy.spec.mjs', use: { ...webkit, baseURL: `http://127.0.0.1:${HARNESS}` } },
    { name: 'app-chromium', testMatch: 'app.spec.mjs', grep: /W24/, use: { ...chromium, baseURL: `http://127.0.0.1:${APP}` } },
    { name: 'app-webkit', testMatch: 'app.spec.mjs', grep: /W24/, use: { ...webkit, baseURL: `http://127.0.0.1:${APP}` } },
  ],
  webServer: [
    {
      command: `node ${new URL('./static-server.mjs', import.meta.url).pathname}`,
      url: `http://127.0.0.1:${HARNESS}/reading-room.html`,
      reuseExistingServer: true, timeout: 20000, env: { HARNESS_PORT: String(HARNESS) },
    },
    {
      command: `node ${new URL('./app-server.mjs', import.meta.url).pathname}`,
      url: `http://127.0.0.1:${APP}/reading-room.html`,
      reuseExistingServer: true, timeout: 20000, env: { APP_PORT: String(APP) },
    },
  ],
});
