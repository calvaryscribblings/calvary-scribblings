// UNRELEASED-1 — READABLE THE MOMENT IT GOES LIVE, against the emulators.
//
//   npm run test:unreleased      (firebase emulators:exec --only database … this file)
//
// A story that is not live has no page in the export, so for the minutes between its go-live and
// the deploy after it, /stories/<slug> is the site's 404. The 404 asks /api/story, and a 200 draws
// the story with the story page's own component (app/components/NotFoundOrLiveStory.js). This
// proves it end to end, with two REAL static builds read from the database emulator and the REAL
// /api/story Pages Function (tests/unreleased/server.mjs):
//
//   1. seed: one story live, one fresh and one fresh-but-archived SCHEDULED, one scheduled to stay
//      so; build → neither fresh story has a page.
//   2. flip both fresh stories live, as the Worker or the reconciler would — and do NOT rebuild.
//      Each opens through the 404 path: hero, byline, prose and gate, the title in the tab, and the
//      read counted. The scheduled one shows exactly what a slug that never existed shows, and its
//      record is never fetched.
//   3. build again (the deploy after the go-live) and open the BUILT pages: the same hero, byline,
//      prose and gate as the fallback drew.
//
// Invented records only (fixture.mjs). Nothing here can reach production: the harness refuses
// every outside call, and the browser runs a build whose client points at the emulator.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { catalogue, seed, FRESH, FRESH_ARCHIVED, SCHEDULED, STANDING } from './fixture.mjs';
import { serve } from './server.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NEVER = 'emu-never-existed';
const tmp = mkdtempSync(join(tmpdir(), 'unreleased-'));

function build(label) {
  execFileSync('npx', ['next', 'build'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], timeout: 900000,
    env: { ...process.env, FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9000', NEXT_PUBLIC_FB_EMULATOR: '1' },
  });
  const dir = join(tmp, label);
  cpSync(join(ROOT, 'out'), dir, { recursive: true });
  return dir;
}

// The two builds write out/, which is the production build's directory in every other suite. The
// one found there is set aside first and put back after, whatever happens in between.
const OUT = join(ROOT, 'out');
const KEPT = join(tmp, 'out-as-found');
let browser;
before(async () => {
  if (existsSync(OUT)) renameSync(OUT, KEPT);
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
});
after(async () => {
  await browser?.close();
  rmSync(OUT, { recursive: true, force: true });
  if (existsSync(KEPT)) renameSync(KEPT, OUT);
  rmSync(tmp, { recursive: true, force: true });
});

/** What a reader sees of the story: the four things the built page and the fallback must share. */
async function readStory(site, slug) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  // Every HTTP request and every frame sent on the database socket: a record read is one or other.
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('websocket', (ws) => ws.on('framesent', (f) => requests.push(`ws:${String(f.payload)}`)));
  const res = await page.goto(`${site.url}/stories/${slug}`, { waitUntil: 'load' });
  const status = res.status();
  let seen = null;
  // Until the 404 has its answer it holds its words back (data-story-path); then it is a story or not.
  await page.waitForFunction(() => document.querySelector('.story-hero .story-title') || !document.documentElement.hasAttribute('data-story-path'), null, { timeout: 30000 });
  const drawn = (await page.$('.story-hero .story-title')) !== null;
  if (drawn) {
    // Wait for the endpoint's answer to land (the gate, or the full body), then read.
    await page.waitForFunction(() => document.querySelector('#story-content')?.innerText.length > 200, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    seen = await page.evaluate(() => ({
      title: document.querySelector('.story-title')?.innerText.trim(),
      byline: document.querySelector('.story-byline')?.innerText.replace(/\s+/g, ' ').trim(),
      hero: document.querySelector('.story-hero .hero-content')?.innerText.replace(/\s+/g, ' ').trim(),
      prose: [...document.querySelectorAll('#story-content p')].map((p) => p.innerText.trim()),
      gate: document.querySelector('[data-archive-lock]')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      docTitle: document.title,
    }));
    // The read is counted: scroll a quarter of the way through the article.
    const before = site.hits.length;
    await page.evaluate(() => { const a = document.querySelector('.story-body'); window.scrollTo(0, a.offsetTop + a.offsetHeight * 0.6); });
    for (let i = 0; i < 30 && site.hits.length === before; i++) await page.waitForTimeout(500);
    seen.counted = site.hits.slice(before).some((h) => JSON.stringify(h).includes(slug));
  }
  const words = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
  await ctx.close();
  return { status, seen, words, requests };
}

test('a story flipped live with no page built reads as its built page will; a scheduled one stays not found', { timeout: 1800000 }, async (t) => {
  await seed(catalogue({ freshLive: false }));
  const first = build('before-go-live');
  for (const slug of [FRESH, FRESH_ARCHIVED, SCHEDULED]) {
    assert.equal(existsSync(join(first, 'stories', `${slug}.html`)), false, `${slug} is not live, so the build gave it no page`);
  }
  assert.ok(existsSync(join(first, 'stories', `${STANDING}.html`)), 'the live story has its page');

  // The flip, with no deploy.
  await seed(catalogue({ freshLive: true }));
  const siteA = await serve(first);
  const fallback = {};
  try {
    for (const slug of [FRESH, FRESH_ARCHIVED]) {
      const r = await readStory(siteA, slug);
      assert.equal(r.status, 404, `${slug}: no page is built, so the address is the 404`);
      assert.ok(r.seen, `${slug}: drawn as a story through the 404 path`);
      fallback[slug] = r.seen;
    }

    await t.test('the fresh story is whole: hero, byline, full prose, no gate, its title in the tab, the read counted', () => {
      const s = fallback[FRESH];
      assert.equal(s.title, 'The Fresh Tale');
      assert.match(s.byline, /Ada Fixture/);
      assert.equal(s.prose.length, 14, 'inside its free week a signed-out reader gets every paragraph');
      assert.equal(s.gate, null);
      assert.equal(s.docTitle, 'The Fresh Tale — Calvary Scribblings');
      assert.equal(s.counted, true, 'the page sent its read hit');
    });

    await t.test('the fresh-but-archived story gets the preview and the gate, as the endpoint decided', () => {
      const s = fallback[FRESH_ARCHIVED];
      assert.ok(s.prose.length > 0 && s.prose.length < 14, `a preview, not the whole: ${s.prose.length} paragraphs`);
      assert.ok(s.gate, 'the archive gate is drawn');
    });

    await t.test('a scheduled story shows exactly what a slug that never existed shows, and its record is never read', async () => {
      const sched = await readStory(siteA, SCHEDULED);
      const never = await readStory(siteA, NEVER);
      assert.equal(sched.status, 404);
      assert.equal(sched.seen, null, 'not drawn as a story');
      assert.equal(sched.words, never.words, 'the same words as any missing page');
      assert.doesNotMatch(sched.words, /Scheduled Tale/);
      const touched = sched.requests.filter((u) => u.includes(SCHEDULED) && !u.endsWith(`/stories/${SCHEDULED}`));
      assert.deepEqual(touched, [], 'nothing but the address itself named the scheduled slug — no record read, over HTTP or the socket (the endpoint is asked by POST body)');
      // and the same check can see a read when one happens: the fresh story's record was read
      const fresh = await readStory(siteA, FRESH);
      assert.ok(fresh.requests.some((u) => u.startsWith('ws:') && u.includes(`cms_stories/${FRESH}`)), 'a live story\'s record read is visible to this check');
      const asked = siteA.storyCalls.filter((c) => c.slug === SCHEDULED);
      assert.ok(asked.length >= 1 && asked.every((c) => c.status === 404), 'the endpoint was asked, and said 404');
    });
  } finally { await siteA.close(); }

  // The deploy after the go-live.
  const second = build('after-go-live');
  for (const slug of [FRESH, FRESH_ARCHIVED]) assert.ok(existsSync(join(second, 'stories', `${slug}.html`)), `${slug} now has its built page`);
  assert.equal(existsSync(join(second, 'stories', `${SCHEDULED}.html`)), false);
  const siteB = await serve(second);
  try {
    for (const slug of [FRESH, FRESH_ARCHIVED]) {
      await t.test(`${slug}: the fallback drew what the built page draws`, async () => {
        const built = await readStory(siteB, slug);
        assert.equal(built.status, 200);
        const fb = fallback[slug];
        for (const k of ['title', 'byline', 'hero', 'prose', 'gate', 'docTitle', 'counted']) {
          assert.deepEqual(fb[k], built.seen[k], `${slug}: ${k} differs between the fallback and the built page`);
        }
      });
    }
  } finally { await siteB.close(); }
});
