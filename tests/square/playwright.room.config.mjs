import { defineConfig, devices } from '@playwright/test';

// THE ROOM HARNESS — R43.1. A RENDERED PAGE, NOT A RENDERER.
//
// Why this exists at all is the whole point of the round. R33.2 rewrote the
// square_posts effect in app/square/page.js from one whole-node onValue to three
// per-child listeners plus a settling get(), and did not widen that effect's own
// `await import('firebase/database')` destructure past { ref, onValue }. The async
// IIFE threw `onChildAdded is not defined` before setLoading(false) could run, so
// the Square hung on "Loading…" for every reader — and, because that effect has []
// deps and no auth branch, it hung identically signed in and signed out.
//
// 78 tests were green over it. tests/square/postbody.test.mjs renders the eight
// surfaces through react-dom/server, and reaches app/square/page.js only as a
// STRING through readFileSync, to check that each surface is drawn somewhere.
// tests/square/horizon.test.mjs is pure date arithmetic. Neither one ever executes
// the page, so a missing binding inside a lazily-imported effect body was invisible
// to all of them, and to `next build`, which does not evaluate an effect.
//
// So this harness drives the real static export in a real browser and asserts the
// two things a unit test over a renderer structurally cannot: that the page threw
// nothing, and that a post is actually on the screen.
//
// Same server and same live-Firebase decision as the bookstore harnesses beside it
// — see tests/bookstore/payload.spec.mjs for that reasoning at length — and PORT
// 4340 so it runs alongside all of them.
//
// Signed out is the case CI can run deterministically, and it is sufficient: the
// posts effect takes no account of auth, which is exactly why Ikenna saw the hang
// while signed in. square_posts is `.read: true`, so the feed draws for a visitor.
const PORT = process.env.SQUARE_ROOM_PORT || 4340;

export default defineConfig({
  testDir: '.',
  testMatch: 'room.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 0 : 1,
  // The room loads the live catalogue and the live post node before it settles.
  timeout: 120000,
  expect: { timeout: 30000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: [
        '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
      ],
    },
  },
  webServer: {
    command: `APP_PORT=${PORT} node ${new URL('../reader/app-server.mjs', import.meta.url).pathname}`,
    url: `http://127.0.0.1:${PORT}/square`,
    reuseExistingServer: true,
    timeout: 20000,
    env: { APP_PORT: String(PORT) },
  },
});
