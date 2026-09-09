import { defineConfig, devices } from '@playwright/test';

// R45 — the browser half of the quiz-marker removal.
//
// WHY A BROWSER AT ALL, when tests/ci/quiz-marker.test.mjs already greps the sources. Because
// this repo has twice shipped a census that read THE CALLER rather than WHAT THE CALLER
// RENDERS, and passed while the screen disagreed. A source grep proves that StoryCard.js does
// not mount QuizPill; it cannot prove that no card on /public-library paints a purple pill,
// because /public-library builds three cards of its own and a fourth could appear tomorrow.
//
// So this suite asks the only question that settles it: after the page has loaded its real
// data, how many absolutely-positioned marker chips are on screen? The answer must be zero on
// every card surface, and non-zero on /search, which keeps its pill by the same ruling.
//
// SERVES THE STATIC EXPORT. `next build` first (npm run test:quiz-marker does it), then this
// serves out/ — the same bytes Cloudflare Pages publishes. The pages fetch cms_stories_index
// live from the browser, so the corpus is production's, which is the point: a marker that
// only appears on a story nobody thought to fixture is exactly the kind this must catch.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  webServer: {
    command: 'npx serve out -l 4321 --no-clipboard',
    url: 'http://localhost:4321/public-library',
    reuseExistingServer: true,
    timeout: 120000,
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4321',
    // Same container facts as tests/reader and tests/dropcap: /dev/shm is 64 MB here.
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    },
  },
});
