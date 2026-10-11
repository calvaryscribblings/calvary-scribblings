// W37 — THE PUBLIC PAGES, SIGNED OUT: NO UNCAUGHT ERROR, AND NO READ THE RULES REFUSE.
//
//   npm run test:responses          (needs a built out/: `npx next build` first)
//
// W36 found every story page throwing an uncaught "Permission denied" for a signed-out reader.
// The cause was ExerciseSection: it read story_exercises/<slug> for every visitor, and the rules
// allow that node only when signed in. A refused read is invisible on the page (the section draws
// nothing either way), so only a harness that watches for it can keep it fixed.
//
// Over the BUILT site (out/, served by tests/reader/app-server.mjs) against the LIVE database, as
// a signed-out reader. The W17 firewall stops anything that could write and, since W37, records
// every read the database refuses (stats.readsRefused). Each page is held open long enough for its
// reads to come back, then two things are asserted:
//   1. no uncaught error — neither a thrown exception nor an unhandled rejection;
//   2. no refused read.
import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installFirewall, newStats, statsLine } from '../live/firewall.mjs';

const OUT = fileURLToPath(new URL('../../out', import.meta.url));
const SETTLE_MS = 8000;

/** The first built story page, so the check never names a slug that may be withdrawn. */
const firstBuilt = (dir) => readdirSync(`${OUT}/${dir}`).filter((f) => f.endsWith('.html')).sort()[0]?.replace(/\.html$/, '');

let stats, errors;
test.beforeEach(async ({ context, page, baseURL }) => {
  stats = newStats();
  errors = [];
  await installFirewall(context, { site: baseURL, stats });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 160)}`));
  page.on('console', (m) => { if (m.type() === 'error' && /Uncaught/i.test(m.text())) errors.push(`console: ${m.text().slice(0, 160)}`); });
});
test.afterEach(async () => {
  // Paths only: signed out, nothing under a uid is asked for, and a slug is public.
  console.log(`firewall: ${statsLine(stats)} · reads refused ${stats.readsRefused.length}${stats.readsRefused.length ? ` (${stats.readsRefused.join(', ')})` : ''}`);
  expect(stats.wsWritesStopped + stats.restAborted + stats.apiAborted, 'nothing may even try to write').toBe(0);
});

async function visit(page, path) {
  await page.goto(path, { waitUntil: 'load' });
  await page.waitForTimeout(SETTLE_MS);
  expect(errors, `${path}: no uncaught error`).toEqual([]);
  expect(stats.readsRefused, `${path}: no read the rules refuse`).toEqual([]);
}

test('a story page, signed out', async ({ page }) => {
  const slug = firstBuilt('stories');
  expect(slug, 'a built story').toBeTruthy();
  await visit(page, `/stories/${slug}`);
});

test('Home, signed out', async ({ page }) => { await visit(page, '/'); });
test('the Series page, signed out', async ({ page }) => { await visit(page, '/series'); });
test('an instalment page, signed out', async ({ page }) => {
  await visit(page, `/series/instalment/${firstBuilt('series/instalment')}`);
});
test('the Book Store, signed out', async ({ page }) => { await visit(page, '/bookstore'); });
test('a Book Store title, signed out', async ({ page }) => {
  // Resolved from the shop rather than named (a hardcoded slug broke five suites in R20); the
  // rooms (Desiderata, Search) share the /bookstore/ prefix and are not titles.
  await page.goto('/bookstore', { waitUntil: 'load' });
  const isTitle = (h) => !/^\/bookstore\/(desiderata|search)(\/|$|\?)/.test(h);
  await page.waitForFunction(() => [...document.querySelectorAll('a[href^="/bookstore/"]')]
    .some((a) => !/^\/bookstore\/(desiderata|search)(\/|$|\?)/.test(a.getAttribute('href'))), null, { timeout: 45000 });
  const hrefs = await page.locator('a[href^="/bookstore/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  const href = hrefs.find(isTitle);
  expect(href, 'a title on the shop').toBeTruthy();
  errors.length = 0; stats.readsRefused.length = 0;
  await visit(page, href);
});
