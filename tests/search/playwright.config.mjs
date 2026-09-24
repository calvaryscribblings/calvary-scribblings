import { defineConfig, devices } from '@playwright/test';

// R46 — THE ISLAND'S INDEX, the half a source grep cannot settle.
//
// tests/ci/search-index.test.mjs proves the DATA and the SOURCE: that the run is a list of
// labels and not a joined string, that each item is declared nowrap, that every count carries
// the oldstyle class. None of that proves what a reader sees. This repo has twice shipped a
// census that read the caller rather than what the caller renders, and the two questions this
// round cannot answer without a browser are exactly of that kind:
//
//   · does a subject ever BREAK MID-NAME at a real width? "Slice of Life" split across two
//     lines is a layout fact, not a source fact — the CSS can be right and the container
//     still too narrow.
//   · do the counts actually SET IN OLDSTYLE? font-variant-numeric is inert if the font did
//     not load, and it fails silently to lining figures. Only a rendered measurement knows.
//   · does the VOICES ROW hold up as a row, with six photographs and four fallback discs
//     beside each other? That was Ikenna's explicit ask and it is a judgement about a row,
//     not about a component.
//
// SERVES THE STATIC EXPORT — the same bytes Cloudflare Pages publishes — and the pages fetch
// live data from the browser, so the corpus is production's.
const PORT = process.env.SEARCH_INDEX_PORT || 4342;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  // CI-05 — THE SERVER IS THE REPO'S OWN, ON A PORT NOBODY ELSE HOLDS. This used to be
  // `npx serve out -l 4329`: `serve` is not a dependency, so every CI run downloaded it
  // unpinned, and 4329 is already claimed by an earlier harness in the same job (FLIP_PORT).
  // With reuseExistingServer:true a stale listener on that port is silently "reused", and
  // this step timed out on config.webServer on every run from 9 Sep. tests/reader/app-server.mjs
  // is what every other harness serves out/ with; 4342 is the next free port after the
  // Square room's 4340; and reuse is OFF, so a collision fails by name instead of by hanging.
  webServer: {
    command: `APP_PORT=${PORT} node ${new URL('../reader/app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/search`,
    reuseExistingServer: false,
    timeout: 20000,
    env: { APP_PORT: String(PORT) },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    },
  },
});
