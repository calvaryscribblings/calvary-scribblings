// CR-2 — Continue Reading in real pages, against the EMULATORS (auth, database), signed in as
// invented emulator readers, never a founder. Every record below is invented; the slugs have never
// existed in production, so a story page that renders one proves the dev server read the emulator.
// The browser refuses every request off localhost (FIREWALL below) and the suite asserts none was
// even attempted to the production database.
//
//   npm run test:continue-reading
//
// What it proves (the brief's list, in order):
//   · the row appears for a reader with something started, and stays absent signed out (with NO
//     reads at all) and for a reader with nothing started (no reserved space);
//   · the card's measurements, as drawn; every bar in a row of mixed cards sits level;
//   · the ✕ by hover, by keyboard focus, and on a touch screen (always shown);
//   · a ✕'d card comes back after the reader reads on;
//   · the resume jump: straight there, no animation, the hash taken off;
//   · a locked card (an archived story, a lapsed membership's instalment);
//   · the page's saving: the first write at the threshold, then 0.02 AND 15 s, the end-of-story
//     removal, and a refused write failing quietly.
//
// No app/lib import here: under Node 22 (CI) a Playwright spec that imports app/lib modules with
// nested imports fails to link (SAFETY-2B.1). The two constants it needs are restated and checked
// against the source by tests/ci/continue-reading.test.mjs's sibling assertion below.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp } from '../series/harness.mjs';

const app = adminApp('cr-2');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

const RESUME_HASH = '#continue-reading';
test('the restated constant matches the source', () => {
  const src = readFileSync(new URL('../../app/lib/continueReading/schema.js', import.meta.url), 'utf8');
  expect(src).toContain(`export const RESUME_HASH = '${RESUME_HASH}';`);
});

const R = 'cr2testreader';        // a free reader with five things started
const E = 'cr2emptyreader';       // a free reader with nothing started
const FRESH = 'cr2-fresh-tale', SECOND = 'cr2-second-tale', ARCHIVED = 'cr2-archived-tale';
const GONE = 'cr2-gone-tale', UNINDEXED = 'cr2-unindexed-tale';
const SERIES = 'cr2series', I1 = 'cr2series-i1', I2 = 'cr2series-i2', I3 = 'cr2series-i3';

const MIN = 60000, DAY = 86400000;
const svg = (fill) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="${fill}"/></svg>`)}`;
const POSTER = svg('#3a2a5a'), OWN_COVER = svg('#5a2a3a'), STORY_COVER = svg('#2a3a5a');
const para = (n, t) => Array.from({ length: n }, (_, i) => `<p>${t}, paragraph ${i + 1}. ${'The tide came in over the stones and went out again, and the light moved with it. '.repeat(5)}</p>`).join('');

function story(title, { daysAgo = 1, category = 'short', subcategory = '', readTime = 12, paras = 60 } = {}) {
  const at = Date.now() - daysAgo * DAY;
  const rec = {
    title, author: 'Ada Fixture', authorUid: 'cr2author', category, subcategory, cover: STORY_COVER,
    published: true, publishAt: new Date(at).toISOString(), publishedAtMs: at, date: new Date(at).toDateString(),
    trailerQuote: 'A line from the fixture.',
  };
  return { full: { ...rec, content: para(paras, title) }, index: { ...rec, readTime, url: '' } };
}

async function reset({ positions = true } = {}) {
  const now = Date.now();
  const s = {
    [FRESH]: story('The Fresh Tale', { subcategory: 'Horror', readTime: 12 }),
    [SECOND]: story('A Considerably Longer Title That Has To Run To Two Lines', { category: 'flash', readTime: 3, paras: 30 }),
    [ARCHIVED]: story('The Archived Tale', { daysAgo: 60, category: 'news', subcategory: 'Essay', readTime: 8 }),
    [UNINDEXED]: story('The Unindexed Tale'),
  };
  const cms = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.full]));
  const index = Object.fromEntries(Object.entries(s).filter(([k]) => k !== UNINDEXED).map(([k, v]) => [k, { ...v.index, url: `/stories/${k}` }]));
  const inst = (ordinal, o = {}) => ({ schemaVersion: 1, seriesId: SERIES, ordinal, releaseAtMs: now - 10 * DAY, freeForGold: false, status: 'published', addedAt: 1, updatedAt: 1, ...o });
  const detail = (o = {}) => ({ schemaVersion: 1, title: 'An instalment', author: 'Ser Writer', authorUid: 'cr2author', authorHandle: 'serwriter', updatedAt: 1, ...o });
  await db.ref().set({
    cms_stories: cms,
    story_bodies: Object.fromEntries(Object.entries(cms).map(([k, v]) => [k, { content: v.content }])),
    cms_stories_index: index,
    users: {
      cr2author: { displayName: 'Ada Fixture', username: 'adafixture' },
      [R]: { displayName: 'Reader Ar', username: 'readerar', createdAt: now - 90 * DAY },
      [E]: { displayName: 'Reader Ee', username: 'readeree', createdAt: now - 90 * DAY },
    },
    series: { [SERIES]: { schemaVersion: 1, slug: SERIES, title: 'The Glass Series', synopsis: '', coverUrl: POSTER, author: 'Ser Writer', status: 'published', addedAt: 1, updatedAt: 1 } },
    series_instalments: { [I1]: inst(1, { freeForGold: true, openToFree: true }), [I2]: inst(2), [I3]: inst(3, { freeForGold: true, openToFree: true }) },
    series_instalments_detail: { [I1]: detail({ wordCount: 2200, coverUrl: OWN_COVER }), [I2]: detail({ wordCount: 4400 }), [I3]: detail({ wordCount: 2200 }) },
    ...(positions ? {
      reading_position: { [R]: { stories: {
        [FRESH]: { fraction: 0.42, updatedAt: now - 5 * MIN },
        [SECOND]: { fraction: 0.1, updatedAt: now - 4 * MIN },
        [ARCHIVED]: { fraction: 0.3, updatedAt: now - 3 * MIN },
        [GONE]: { fraction: 0.5, updatedAt: now - 1 * MIN },
      } } },
      series_reading_progress: { [R]: {
        [I1]: { fraction: 0.25, updatedAt: now - 2 * MIN },
        [I2]: { fraction: 0.6, updatedAt: now - 6 * MIN },
        [I3]: { fraction: 0.95, updatedAt: now - 1 * MIN },
      } },
      series_finished: { [R]: { [I3]: now - MIN } },
    } : {}),
  });
}

// ── THE FIREWALL: nothing off localhost, and a record of anything that tried ──────────────────
async function fence(context) {
  const refused = [];
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return route.continue();
    refused.push(u.hostname);
    return route.abort();
  });
  return refused;
}
const noProduction = (refused) => expect(refused.filter((h) => /firebasedatabase\.app|firebaseio\.com/.test(h))).toEqual([]);

/** Every path the page's database socket asked for. */
function watchReads(page) {
  const paths = [];
  page.on('websocket', (ws) => ws.on('framesent', ({ payload }) => {
    const m = String(payload).match(/"p":"([^"]*)"/g);
    if (m) for (const x of m) paths.push(x.slice(5, -1));
  }));
  return paths;
}

async function signIn(page, uid) {
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), await getAuth(app).createCustomToken(uid));
}
async function decline(page) {
  const b = page.getByRole('button', { name: /^decline$/i });
  try { await b.waitFor({ timeout: 4000 }); await b.click(); } catch {}
}
async function openLibrary(page, uid) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/public-library');
  await decline(page);
  if (uid) await signIn(page, uid);
  return errors;
}
const cards = (page) => page.locator('[data-continue-reading] .cr-card');

// The thread's measure, from the page's own article.
const fractionNow = (page) => page.evaluate(() => {
  const a = document.querySelector('article.story-body').getBoundingClientRect();
  const top = a.top + window.scrollY, range = a.height - window.innerHeight;
  return Math.min(1, Math.max(0, (window.scrollY - top) / range));
});
const scrollToFraction = (page, f) => page.evaluate((f) => {
  const a = document.querySelector('article.story-body').getBoundingClientRect();
  const top = a.top + window.scrollY, range = a.height - window.innerHeight;
  window.scrollTo({ top: top + f * range, behavior: 'instant' });
}, f);
const positionOf = async (uid, slug) => (await db.ref(`reading_position/${uid}/stories/${slug}`).get()).val();

// ── THE ROW: PRESENT, ABSENT, AND NO READS SIGNED OUT ──────────────────────────────────────────

test('signed out: no row, and not one read of a reader\'s records', async ({ page, context }) => {
  await reset();
  const refused = await fence(context);
  const paths = watchReads(page);
  const errors = await openLibrary(page, null);
  await expect(page.locator('.just-added-scroll a').first()).toBeVisible({ timeout: 120000 });
  await page.waitForTimeout(4000);
  await expect(page.locator('[data-continue-reading]')).toHaveCount(0);
  // Not one read of a reader's own records. (The page's Series row reads the public series nodes
  // for everyone; that is the Series row, not this one, and it is not a reader's data.)
  expect(paths.filter((p) => /reading_position|series_reading_progress|series_finished/.test(p))).toEqual([]);
  expect(paths.some((p) => /cms_stories_index/.test(p))).toBe(true);   // the socket was watched
  noProduction(refused);
  expect(errors).toEqual([]);
});

test('signed in with nothing started: the row reads, draws nothing, and holds no space', async ({ page, context }) => {
  await reset();
  const refused = await fence(context);
  const paths = watchReads(page);
  await openLibrary(page, null);
  await expect(page.locator('.just-added-scroll a').first()).toBeVisible({ timeout: 120000 });
  const before = await page.locator('.sq-banner-desktop').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await signIn(page, E);
  await expect.poll(() => paths.some((p) => p.includes(`reading_position/${E}`)), { timeout: 60000 }).toBe(true);
  await page.waitForTimeout(3000);
  await expect(page.locator('[data-continue-reading]')).toHaveCount(0);
  const after = await page.locator('.sq-banner-desktop').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  expect(after).toBe(before);
  noProduction(refused);
});

test('signed in with five started: the row, its order, its words and its locks', async ({ page, context }) => {
  await reset();
  const refused = await fence(context);
  const errors = await openLibrary(page, R);
  await expect(cards(page)).toHaveCount(5, { timeout: 120000 });
  const row = page.locator('[data-continue-reading]');
  await expect(row.locator('h3')).toHaveText('Continue Reading');
  await expect(row.locator('span').first()).toHaveText('Where you left off');

  // Under the hero, above the desktop Square banner.
  const [rowTop, bannerTop, heroBottom] = await page.evaluate(() => [
    document.querySelector('[data-continue-reading]').getBoundingClientRect().top,
    document.querySelector('.sq-banner-desktop').getBoundingClientRect().top,
    document.querySelector('.hero-card').closest('section').getBoundingClientRect().bottom,
  ]);
  expect(rowTop).toBeLessThan(bannerTop);
  expect(rowTop).toBeGreaterThanOrEqual(heroBottom - 1);

  const seen = await cards(page).evaluateAll((els) => els.map((c) => ({
    kind: c.querySelector('.cr-kind').textContent,
    title: c.querySelector('.cr-title').textContent,
    writer: c.querySelector('.cr-writer')?.textContent ?? null,
    mins: c.querySelector('.cr-mins')?.textContent ?? null,
    lock: c.querySelector('.cr-lock')?.textContent ?? null,
    pct: c.querySelector('.ml-bar-l').textContent,
    href: c.querySelector('a').getAttribute('href'),
    cover: c.querySelector('.cr-cover img')?.getAttribute('src') ?? null,
    x: c.querySelector('button.cr-x').getAttribute('aria-label'),
  })));
  // Newest first; the finished instalment and the story that left the index are gone.
  expect(seen).toEqual([
    { kind: 'The Series · Instalment 1', title: 'The Glass Series', writer: 'Ser Writer', mins: '8 minutes left', lock: null, pct: '25%', href: `/series/read/${I1}`, cover: OWN_COVER, x: 'Remove The Glass Series from Continue Reading' },
    { kind: 'essay', title: 'The Archived Tale', writer: 'Ada Fixture', mins: null, lock: 'Members', pct: '30%', href: `/stories/${ARCHIVED}`, cover: expect.any(String), x: 'Remove The Archived Tale from Continue Reading' },
    { kind: 'flash fiction', title: 'A Considerably Longer Title That Has To Run To Two Lines', writer: 'Ada Fixture', mins: '3 minutes left', lock: null, pct: '10%', href: `/stories/${SECOND}${RESUME_HASH}`, cover: expect.any(String), x: 'Remove A Considerably Longer Title That Has To Run To Two Lines from Continue Reading' },
    { kind: 'short story', title: 'The Fresh Tale', writer: 'Ada Fixture', mins: '7 minutes left', lock: null, pct: '42%', href: `/stories/${FRESH}${RESUME_HASH}`, cover: expect.any(String), x: 'Remove The Fresh Tale from Continue Reading' },
    // A lapsed membership's instalment: locked, its series poster (no cover of its own).
    { kind: 'The Series · Instalment 2', title: 'The Glass Series', writer: 'Ser Writer', mins: null, lock: 'Members', pct: '60%', href: `/series/instalment/${I2}`, cover: POSTER, x: 'Remove The Glass Series from Continue Reading' },
  ]);
  // The kind line is SET in capitals; the words are the push table's.
  expect(await cards(page).first().locator('.cr-kind').evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase');
  noProduction(refused);
  expect(errors).toEqual([]);
});

test('the card, as drawn — and every bar in a row of mixed cards sits level', async ({ page, context }) => {
  await reset();
  await fence(context);
  await openLibrary(page, R);
  await expect(cards(page)).toHaveCount(5, { timeout: 120000 });
  await cards(page).first().scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  // At rest: no card hovered, every border back from its 0.2s transition.
  await expect.poll(() => cards(page).evaluateAll((els) => els.every((c) => getComputedStyle(c).borderTopColor === 'rgba(107, 47, 173, 0.28)'))).toBe(true);
  const m = await cards(page).evaluateAll((els) => els.map((c) => {
    const r = (el) => el.getBoundingClientRect();
    const cs = (el) => getComputedStyle(el);
    const card = r(c), inner = { left: card.left + 1, top: card.top + 1, right: card.right - 1, bottom: card.bottom - 1 };
    const text = c.querySelector('.cr-text'), kind = c.querySelector('.cr-kind'), title = c.querySelector('.cr-title');
    const writer = c.querySelector('.cr-writer'), mins = c.querySelector('.cr-mins'), lock = c.querySelector('.cr-lock');
    const bar = c.querySelector('.ml-bar'), x = c.querySelector('.cr-x'), cover = c.querySelector('.cr-cover');
    const below = (a, b) => Math.round((r(a).top - r(b).bottom) * 10) / 10;
    return {
      w: card.width, h: card.height, radius: cs(c).borderTopLeftRadius,
      bg: cs(c).backgroundColor, border: `${cs(c).borderTopWidth} ${cs(c).borderTopColor}`, shadow: cs(c).boxShadow,
      cover: [r(cover).left - inner.left, r(cover).top - inner.top, r(cover).width, r(cover).height],
      pad: [cs(text).paddingTop, cs(text).paddingRight, cs(text).paddingBottom, cs(text).paddingLeft],
      kind: [cs(kind).fontFamily.split(',')[0].replace(/['"]/g, ''), cs(kind).fontSize, cs(kind).letterSpacing, cs(kind).color, below(title, kind)],
      title: [cs(title).fontFamily.split(',')[0].replace(/['"]/g, ''), cs(title).fontWeight, cs(title).fontSize, cs(title).lineHeight, cs(title).color, Math.round(r(title).height / parseFloat(cs(title).lineHeight))],
      writer: [cs(writer).fontSize, cs(writer).letterSpacing, cs(writer).textTransform, cs(writer).color, below(writer, title)],
      mins: mins && [cs(mins).fontStyle, cs(mins).fontSize, cs(mins).color, below(mins, writer)],
      lock: lock && [cs(lock).fontFamily.split(',')[0].replace(/['"]/g, ''), cs(lock).fontSize, cs(lock).letterSpacing, cs(lock).color, cs(lock).columnGap, below(lock, writer),
        r(lock.querySelector('svg')).width, r(lock.querySelector('svg')).height],
      bar: [r(bar).height, cs(bar).columnGap, Math.round((inner.bottom - r(bar).bottom) * 10) / 10, r(bar).top],
      x: [r(x).width, r(x).height, r(x).top - inner.top, inner.right - r(x).right, cs(x).borderRadius, cs(x).borderTopColor, cs(x).backgroundColor,
        r(x.querySelector('svg')).width, x.querySelector('path').getAttribute('stroke-width'), x.querySelector('path').getAttribute('stroke')],
      gapToNext: c.nextElementSibling ? r(c.nextElementSibling).left - card.right : null,
    };
  }));
  for (const c of m) {
    expect([c.w, c.h, c.radius]).toEqual([300, 146, '12px']);
    expect(c.bg).toBe('rgba(107, 47, 173, 0.08)');
    expect(c.border).toBe('1px rgba(107, 47, 173, 0.28)');
    expect(c.shadow).toBe('rgba(107, 47, 173, 0.15) 0px 4px 20px 0px');
    expect(c.cover).toEqual([0, 0, 96, 144]);                     // flush to the card's left edge, 2:3
    expect(c.pad).toEqual(['14px', '16px', '14px', '16px']);
    expect(c.kind.slice(0, 4)).toEqual(['Cinzel', '8px', '1.6px', 'rgb(201, 168, 76)']);
    expect(Math.abs(c.kind[4] - 6)).toBeLessThan(0.6);              // 6px below it
    expect(c.title.slice(0, 5)).toEqual(['Cormorant Garamond', '600', '17px', '19.55px', 'rgb(245, 240, 232)']);
    expect(c.title[5]).toBeLessThanOrEqual(2);                      // two lines at most
    expect(c.writer.slice(0, 4)).toEqual(['10.4px', '0.832px', 'uppercase', 'rgba(245, 240, 232, 0.7)']);
    expect(Math.abs(c.writer[4] - 4)).toBeLessThan(0.6);
    if (c.mins) {
      expect(c.mins.slice(0, 3)).toEqual(['italic', '12.5px', 'rgba(245, 240, 232, 0.55)']);
      expect(Math.abs(c.mins[3] - 3)).toBeLessThan(0.6);
    } else {
      expect(c.lock.slice(0, 5)).toEqual(['Cinzel', '7.5px', '1.2px', 'rgb(201, 168, 76)', '5px']);
      expect(Math.abs(c.lock[5] - 5)).toBeLessThan(0.6);
      expect(c.lock.slice(6)).toEqual([9, 10]);
    }
    expect(c.bar.slice(0, 3)).toEqual([12, '7px', 14]);            // 12px row, 7px gap, pinned to the foot
    expect(c.x.slice(0, 4)).toEqual([28, 28, 8, 8]);               // 8px from the top and right
    expect(c.x.slice(4)).toEqual(['50%', 'rgba(245, 240, 232, 0.25)', 'rgba(10, 10, 10, 0.7)', 10, '1.3', '#f5f0e8']);
    if (c.gapToNext !== null) expect(c.gapToNext).toBe(14);       // Just Added's own gap
  }
  // Two-line title, one-line title, minutes, lock: every bar on one line.
  const tops = m.map((c) => c.bar[3]);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(0.5);
  expect(new Set(m.map((c) => c.title[5]))).toEqual(new Set([1, 2]));
  expect(m.some((c) => c.mins) && m.some((c) => c.lock)).toBe(true);

  // Just Added's header and strip, not a copy: the same left margin for both rows' first cards.
  const [crLeft, jaLeft] = await page.evaluate(() => [
    document.querySelector('[data-continue-reading] .cr-card').getBoundingClientRect().left,
    document.querySelector('.just-added-scroll > a').getBoundingClientRect().left,
  ]);
  expect(crLeft).toBe(jaLeft);
});

// ── THE ✕ ─────────────────────────────────────────────────────────────────────────────────────

const xOpacity = (card) => card.locator('button.cr-x').evaluate((b) => getComputedStyle(b).opacity);

test('the ✕ by hover: hidden at rest, shown on hover, lights the border; it hides the card with the server\'s time', async ({ page, context }) => {
  await reset();
  await fence(context);
  await openLibrary(page, R);
  await expect(cards(page)).toHaveCount(5, { timeout: 120000 });
  const card = cards(page).filter({ hasText: 'The Fresh Tale' });
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await expect.poll(() => xOpacity(card)).toBe('0');
  expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(false);
  await card.hover();
  await expect.poll(() => xOpacity(card)).toBe('1');
  await expect.poll(() => card.evaluate((c) => getComputedStyle(c).borderTopColor)).toBe('rgba(107, 47, 173, 0.6)');
  // A real button beside the link, not inside it.
  expect(await card.locator('button.cr-x').evaluate((b) => !b.closest('a') && b.parentElement.classList.contains('cr-card'))).toBe(true);
  const t0 = Date.now();
  await card.getByRole('button', { name: 'Remove The Fresh Tale from Continue Reading' }).click();
  await expect(cards(page)).toHaveCount(4);
  await expect.poll(async () => (await db.ref(`reading_position/${R}/hidden/stories/${FRESH}`).get()).val(), { timeout: 20000 }).toBeGreaterThanOrEqual(t0 - 5000);
  await page.reload();
  await decline(page);
  await expect(cards(page)).toHaveCount(4, { timeout: 120000 });
  await expect(cards(page).filter({ hasText: 'The Fresh Tale' })).toHaveCount(0);
});

test('the ✕ by keyboard focus: shown while the card or the ✕ has focus; Enter hides the card', async ({ page, context }) => {
  await reset();
  await fence(context);
  await openLibrary(page, R);
  await expect(cards(page)).toHaveCount(5, { timeout: 120000 });
  const card = cards(page).filter({ hasText: 'The Archived Tale' });
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await expect.poll(() => xOpacity(card)).toBe('0');
  await card.locator('a').focus();
  await expect.poll(() => xOpacity(card)).toBe('1');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Remove The Archived Tale from Continue Reading');
  await expect.poll(() => xOpacity(card)).toBe('1');
  await page.keyboard.press('Enter');
  await expect(cards(page)).toHaveCount(4);
  await expect.poll(async () => typeof (await db.ref(`reading_position/${R}/hidden/stories/${ARCHIVED}`).get()).val(), { timeout: 20000 }).toBe('number');
});

test('the ✕ on a touch screen: no hover there, so it shows on every card, same size and place', async ({ browser }) => {
  await reset();
  const { devices } = await import('@playwright/test');
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' });
  try {
    await fence(context);
    const page = await context.newPage();
    await openLibrary(page, R);
    await expect(cards(page)).toHaveCount(5, { timeout: 120000 });
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    const xs = await cards(page).evaluateAll((els) => els.map((c) => {
      const b = c.querySelector('button.cr-x'), r = b.getBoundingClientRect(), k = c.getBoundingClientRect();
      return [getComputedStyle(b).opacity, r.width, r.height, r.top - k.top - 1, k.right - 1 - r.right];
    }));
    for (const x of xs) expect(x).toEqual(['1', 28, 28, 8, 8]);
    await cards(page).filter({ hasText: 'The Fresh Tale' }).locator('button.cr-x').tap();
    await expect(cards(page)).toHaveCount(4);
  } finally {
    await context.close();
  }
});

// ── READING ON, RESUMING, SAVING ───────────────────────────────────────────────────────────────

test('a ✕\'d card comes back once the reader reads on', async ({ page, context }) => {
  await reset();
  await fence(context);
  await openLibrary(page, R);
  await expect(cards(page)).toHaveCount(5, { timeout: 120000 });
  await cards(page).filter({ hasText: 'The Fresh Tale' }).locator('button.cr-x').click({ force: true });
  await expect(cards(page)).toHaveCount(4);
  await expect.poll(async () => typeof (await db.ref(`reading_position/${R}/hidden/stories/${FRESH}`).get()).val(), { timeout: 20000 }).toBe('number');
  const hiddenAt = (await db.ref(`reading_position/${R}/hidden/stories/${FRESH}`).get()).val();

  await page.goto(`/stories/${FRESH}`);
  await expect(page.locator('article.story-body p').first()).toBeVisible({ timeout: 120000 });
  await scrollToFraction(page, 0.55);
  await expect.poll(async () => (await positionOf(R, FRESH))?.updatedAt ?? 0, { timeout: 30000 }).toBeGreaterThan(hiddenAt);

  await page.goto('/public-library');
  await expect(cards(page)).toHaveCount(5, { timeout: 120000 });
  await expect(cards(page).first()).toContainText('The Fresh Tale');   // newest now
  await expect(cards(page).first().locator('.ml-bar-l')).toHaveText(/^5[45]%$/);
});

test('the resume jump: from the card, straight to the saved place, no animation, the hash taken off', async ({ page, context }) => {
  await reset();
  await db.ref(`reading_position/${R}/stories/${FRESH}`).set({ fraction: 0.6, updatedAt: Date.now() });
  await fence(context);
  await page.addInitScript(() => {
    window.__scrolls = [];
    addEventListener('scroll', () => window.__scrolls.push(Math.round(scrollY)), { passive: true });
  });
  await openLibrary(page, R);
  await expect(cards(page)).toHaveCount(5, { timeout: 120000 });
  const card = cards(page).filter({ hasText: 'The Fresh Tale' });
  await expect(card.locator('a')).toHaveAttribute('href', `/stories/${FRESH}${RESUME_HASH}`);
  await card.locator('a').click();
  await page.waitForURL(`**/stories/${FRESH}`, { timeout: 120000 });
  await expect.poll(() => fractionNow(page), { timeout: 60000 }).toBeGreaterThan(0.55);
  await page.waitForTimeout(800);
  expect(Math.abs((await fractionNow(page)) - 0.6)).toBeLessThan(0.01);
  expect(page.url()).not.toContain('#');
  // No animation: every scroll position the page passed through (bar the top) IS the destination.
  const at = await page.evaluate(() => Math.round(scrollY));
  const passed = (await page.evaluate(() => window.__scrolls)).filter((y) => y > 0);
  expect(passed.length).toBeGreaterThan(0);
  for (const y of passed) expect(Math.abs(y - at)).toBeLessThanOrEqual(2);

  // A visit WITHOUT the card's hash stays at the top.
  await page.goto(`/stories/${FRESH}`);
  await expect(page.locator('article.story-body p').first()).toBeVisible({ timeout: 120000 });
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('saving on the page: the first write at 25%, then 0.02 AND 15 s; the end of the story removes it', async ({ page, context }) => {
  await reset({ positions: false });
  const refused = await fence(context);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/stories/${FRESH}`);
  await decline(page);
  await signIn(page, R);
  await expect(page.locator('article.story-body p').first()).toBeVisible({ timeout: 120000 });
  await page.waitForTimeout(2000);

  await scrollToFraction(page, 0.2);
  await page.waitForTimeout(2500);
  expect(await positionOf(R, FRESH)).toBeNull();                    // under both thresholds: nothing

  await scrollToFraction(page, 0.4);
  await expect.poll(() => positionOf(R, FRESH), { timeout: 20000 }).not.toBeNull();
  const first = await positionOf(R, FRESH);
  expect(Math.abs(first.fraction - 0.4)).toBeLessThan(0.01);
  expect(Math.abs(first.updatedAt - Date.now())).toBeLessThan(60000);   // the server's time

  await scrollToFraction(page, 0.45);                                 // moved 0.05, but too soon
  await page.waitForTimeout(5000);
  expect(await positionOf(R, FRESH)).toEqual(first);
  await expect.poll(async () => (await positionOf(R, FRESH)).fraction, { timeout: 25000 }).toBeGreaterThan(0.44);   // 15 s on

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await expect.poll(() => positionOf(R, FRESH), { timeout: 20000 }).toBeNull();   // the end-of-story marker
  noProduction(refused);
  expect(errors).toEqual([]);
});

test('a refused write fails quietly: the page reads exactly as before', async ({ page, context }) => {
  await reset({ positions: false });
  const refused = await fence(context);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/stories/${UNINDEXED}`);
  await decline(page);
  await signIn(page, R);
  await expect(page.locator('article.story-body p').first()).toBeVisible({ timeout: 120000 });
  const paras = await page.locator('article.story-body p').count();
  await scrollToFraction(page, 0.5);
  await page.waitForTimeout(4000);
  expect(await positionOf(R, UNINDEXED)).toBeNull();               // refused by the rules: not in the index
  expect(await page.locator('article.story-body p').count()).toBe(paras);
  await expect(page.locator('article.story-body')).toBeVisible();
  noProduction(refused);
  expect(errors).toEqual([]);
});
