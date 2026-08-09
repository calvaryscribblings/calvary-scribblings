import { defineConfig, devices } from '@playwright/test';

// THE MEMBERSHIP COPY HARNESS — R11.13's page, driven against out/.
//
// Same argument as tests/bookstore/playwright.gate.config.mjs and the reader app suite, and it
// reuses their server (tests/reader/app-server.mjs): next.config.mjs sets output:'export', so
// out/ IS the application. A dev server would exercise a different bundler pipeline than the
// one Cloudflare Pages serves, and this suite's whole job is to assert what actually ships.
//
// A DIFFERENT PORT (4327) so it can run beside the reader, gate, currency, territory and links
// suites without either stealing the other's reuseExistingServer.
//
// IT WAS 4325, WHICH WAS ALREADY TAKEN. tests/bookstore/playwright.territory.config.mjs has
// held 4325 since R8.4, and this file claimed it too — the header above used to list the suites
// it could run beside and territory was not among them, which is exactly how the clash got
// written. It never bit, because until now these two suites never ran in the same job:
// territory runs in reader-tests.yml and this one only ever ran from the npm script. R11.17
// puts both in that workflow, so the collision stops being theoretical.
//
// The failure it would have produced is worth naming, because it is not a crash. app-server.mjs
// serves out/ and nothing else, so a suite reusing the other's server would have loaded the
// right pages and passed — until one run finished, tore the server down, and the next started
// against a dead port. Green, green, green, then an inexplicable connection refused.
//
// The allocation, so the next suite takes 4328: 4321 reader host · 4322 reader app · 4323 gate
// · 4324 currency · 4325 territory · 4326 links · 4327 copy.
//
// NO FIREBASE DEPENDENCE. Every assertion here is about copy that renders for a SIGNED-OUT
// reader from the static HTML and the client's own price table. Nothing in this suite reads or
// writes production data, and nothing in it needs an account.
const PORT = process.env.MEMBERSHIP_PORT || 4327;

export default defineConfig({
  testDir: '.',
  testMatch: 'copy.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1200, height: 900 },
    launchOptions: {
      args: [
        '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--disable-software-rasterizer', '--disable-background-networking',
      ],
    },
  },
  webServer: {
    command: `APP_PORT=${PORT} node ${new URL('../reader/app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/membership`,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
