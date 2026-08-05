import { defineConfig, devices } from '@playwright/test';

// R9.3 — the drop-cap tagger's behavioural suite.
//
// NO WEB SERVER. Unlike tests/reader, this suite has nothing to serve: every case is a
// string of CMS prose HTML dropped into page.setContent, and the module under test is
// injected from disk. That keeps it fast and keeps it honest — it exercises the SHIPPED
// app/lib/dropcap.js and app/lib/proseCSS.js, not a transcription of them.
//
// WHY A BROWSER AT ALL, when the tagger is "just" a predicate. Two reasons, both of which
// a DOM shim would get wrong. First, .closest() over the exclusion selector list is real
// DOM traversal — a shim that fakes it is testing the shim. Second, the bug this suite
// exists to prevent is a *rendered* one: a floated 4.2em glyph next to the opening
// paragraph. Asserting a class name only proves the tagger's opinion; measuring the glyph
// proves the reader sees what we intended.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 5000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 375, height: 800 },
    // Same container facts as tests/reader: /dev/shm is 64 MB in this devcontainer and the
    // editor server holds most of the RAM. Cheap here (one page, no iframes), but a crashed
    // renderer reports as a test failure from wherever it happened to be, so don't risk it.
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    },
  },
});
