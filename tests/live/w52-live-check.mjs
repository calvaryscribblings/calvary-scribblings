// W52 — THE LIVE CHECK for ruling 190, read-only. No reader sees a build ID.
//
//   node tests/live/w52-live-check.mjs [expected-commit-prefix]   (needs serviceAccountKey.json, for the test reader)
//
// At 390 and 1280, signed out and as the W17 test reader (never a founder), behind the W17
// firewall (tests/live/firewall.mjs):
//   · /public-library's site footer has no build stamp, and ends on the copyright line (no gap)
//   · a story page whose closing is drawn has no build stamp; .story-footer (the byline row) is
//     the last thing in the story's <main>, with its 2rem bottom padding intact
//   · /build.json still answers with the commit (the deploy check reads that, never the page)
// The test reader's own records are read before and after, and compared (CLAUDE.md, rule 4).
// Screenshots go to test-results/w52-live/ (git-ignored) and stay local.
import { readFileSync, mkdirSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { chromium } from '@playwright/test';
import { liveContext, statsLine } from './firewall.mjs';
import { ensureTestReader, testReaderSession, signInPage, testReaderWatch } from './test-reader.mjs';

const SITE = process.env.LAUNCH_SITE || 'https://calvaryscribblings.co.uk';
const DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const EXPECT = process.argv[2] || '';
const OUT = 'test-results/w52-live';
mkdirSync(OUT, { recursive: true });

const results = [];
const record = (check, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${detail ? ` — ${detail}` : ''}`); };

initializeApp({ credential: cert(JSON.parse(readFileSync('serviceAccountKey.json', 'utf8'))), databaseURL: DB });
const db = getDatabase();
const READER = await ensureTestReader();
const account = await testReaderSession(READER);
const watch = testReaderWatch(READER);
const snapshot = async () => JSON.stringify(await Promise.all(watch.map(async (p) => (await db.ref(p).get()).val())));
const before = await snapshot();

{
  const b = await (await fetch(`${SITE}/build.json`, { cache: 'no-store' })).json();
  record('/build.json answers with a commit', typeof b.commit === 'string' && /^[0-9a-f]{12}$/.test(b.commit), b.commit);
  if (EXPECT) record(`/build.json is the expected build`, b.commit.startsWith(EXPECT.slice(0, 12)), `${b.commit} vs ${EXPECT.slice(0, 12)}`);
}

// Story slugs from the live sitemap, newest first as listed; the first whose closing is drawn.
const sitemap = await (await fetch(`${SITE}/sitemap.xml`)).text();
const slugs = [...sitemap.matchAll(/<loc>https:\/\/[^<]+\/stories\/([^<]+)<\/loc>/g)].map((m) => m[1]).slice(0, 25);

const browser = await chromium.launch();
try {
  for (const width of [390, 1280]) {
    for (const who of ['signed-out', 'test-reader']) {
      const { ctx, stats } = await liveContext(browser, { viewport: { width, height: 900 }, serviceWorkers: 'block' }, { site: SITE });
      const page = await ctx.newPage();
      if (who === 'test-reader') await signInPage(page, SITE, account);

      await page.goto(`${SITE}/public-library`, { waitUntil: 'load', timeout: 90000 });
      const footer = page.locator('footer').last();
      await footer.scrollIntoViewIfNeeded({ timeout: 60000 });
      await page.waitForTimeout(4000);                                  // auth has answered
      const fstamp = await page.locator('[data-build-stamp]').count();
      const lastLine = await footer.evaluate((f) => f.lastElementChild?.textContent || '');
      record(`/public-library footer, ${width}px, ${who}: no build stamp, ends on the copyright line`, fstamp === 0 && /All rights reserved\./.test(lastLine), `stamps ${fstamp}`);
      await footer.screenshot({ path: `${OUT}/footer-${width}-${who}.png` });

      let checked = false;
      for (const slug of slugs) {
        await page.goto(`${SITE}/stories/${slug}`, { waitUntil: 'load', timeout: 90000 });
        const end = page.locator('main .story-footer');
        if (!(await end.count())) continue;                            // a locked or held story: try the next
        await end.scrollIntoViewIfNeeded();
        await page.waitForTimeout(2500);                               // the closing fades in
        const sstamp = await page.locator('[data-build-stamp]').count();
        const shape = await end.evaluate((e) => ({ last: e === e.parentElement.lastElementChild, pad: getComputedStyle(e).paddingBottom, byline: /^By /.test(e.textContent.trim()) }));
        record(`story end (/stories/${slug}), ${width}px, ${who}: no stamp; the byline row ends the story with its padding`, sstamp === 0 && shape.last && shape.pad === '32px' && shape.byline, JSON.stringify({ stamps: sstamp, ...shape }));
        await page.evaluate(() => document.querySelector('main .story-footer').scrollIntoView({ block: 'end' }));
        await page.screenshot({ path: `${OUT}/story-end-${width}-${who}.png` });
        checked = true;
        break;
      }
      record(`a story whose closing is drawn was found, ${width}px, ${who}`, checked);
      console.log(`firewall (${width}, ${who}): ${statsLine(stats)}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

record('the test reader\'s records are unchanged', (await snapshot()) === before);
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
