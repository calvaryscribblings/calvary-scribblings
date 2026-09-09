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
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  webServer: {
    command: 'npx serve out -l 4329 --no-clipboard',
    url: 'http://localhost:4329/search',
    reuseExistingServer: true,
    timeout: 120000,
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4329',
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    },
  },
});
