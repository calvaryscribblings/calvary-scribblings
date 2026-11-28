// BAR-1 — the site bar (.cs-nav) on /public-library, replayed on an iPhone profile in WebKit, through
// every state the page passes through. Each test samples the bar on every frame AND on every
// window / viewport event, and asserts on each sample:
//   · ON THE GLASS: a painted bar's top is at the top of the screen, (rect.top − vv.offsetTop) ×
//     scale within 1px of 0, and while not zoomed the bar IS painted (Ikenna's ruling: the bar stays
//     at the top, it does not hide);
//   · NO CONTAINING BLOCK: no ancestor carries a transform, filter, contain, will-change … (W16's
//     containingBlockAncestor, the same function the founder readout runs, from app/lib/storyBar.js);
//   · after hydration, its ancestors are exactly the body host, <body> and <html>.
//
// The visual viewport is REPLAYED, as W16 did: no engine this repo can run has iOS's viewport, so a
// stand-in visualViewport reports what an iPhone reports, and the on-screen top is computed from it.
// The replayed faults are the ones Apple's forums and WebKit's tracker describe for iOS 26 (thread
// 800125, bug 300523): after the keyboard closes, or a swipe-back, the visual viewport is left
// offset from the layout viewport at scale 1 — and NO viewport event says so.
//
// Against the EMULATORS and `next dev`, invented records only. Every request off localhost is refused.
//   npm run test:bar-1
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { adminApp, closeApp, FOUNDER_A } from '../series/harness.mjs';

const app = adminApp('bar-1');
const db = getDatabase(app);
test.afterAll(() => closeApp(app));

// storyBar.js has no imports: its source runs in the page as is, minus `export`.
const STORYBAR_SRC = readFileSync(new URL('../../app/lib/storyBar.js', import.meta.url), 'utf8').replace(/^export /gm, '');

const R = 'bar1testreader';
const DAY = 86400000;
const svg = (fill) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="30"><rect width="20" height="30" fill="${fill}"/></svg>`)}`;

async function seed() {
  const now = Date.now();
  const story = (i) => {
    const at = now - (i + 1) * DAY;
    return { title: `Bar Fixture ${i}`, author: 'Ada Fixture', authorUid: 'bar1author', category: 'short', subcategory: '', cover: svg(['#3a2a5a', '#2a3a5a', '#5a2a3a'][i % 3]),
      published: true, publishAt: new Date(at).toISOString(), publishedAtMs: at, date: new Date(at).toDateString(), trailerQuote: 'A line from the fixture.', readTime: 6 };
  };
  const ids = Array.from({ length: 8 }, (_, i) => `bar1-tale-${i}`);
  const body = Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i + 1}. ${'The tide came in over the stones. '.repeat(8)}</p>`).join('');
  await db.ref().set({
    cms_stories_index: Object.fromEntries(ids.map((id, i) => [id, { ...story(i), url: `/stories/${id}` }])),
    cms_stories: Object.fromEntries(ids.map((id, i) => [id, { ...story(i), content: body }])),
    story_bodies: Object.fromEntries(ids.map((id) => [id, { content: body }])),
    users: { bar1author: { displayName: 'Ada Fixture', username: 'adafixture' }, [R]: { displayName: 'Reader Bar', username: 'readerbar', createdAt: now - 90 * DAY },
      [FOUNDER_A]: { displayName: 'Emulator Founder', username: 'emufounder', createdAt: now - 90 * DAY } },
    series: { bar1series: { schemaVersion: 1, slug: 'bar1series', title: 'The Bar Series', synopsis: '', coverUrl: svg('#222'), author: 'S', status: 'published', addedAt: 1, updatedAt: 1 } },
    series_instalments: { 'bar1series-i1': { schemaVersion: 1, seriesId: 'bar1series', ordinal: 1, releaseAtMs: now - DAY, freeForGold: true, openToFree: true, status: 'published', addedAt: 1, updatedAt: 1 } },
    series_instalments_detail: { 'bar1series-i1': { schemaVersion: 1, title: 'One', author: 'S', authorUid: 'bar1author', authorHandle: 'adafixture', wordCount: 2200, updatedAt: 1 } },
    reading_position: { [R]: { stories: { [ids[1]]: { fraction: 0.4, updatedAt: now - 60000 }, [ids[2]]: { fraction: 0.7, updatedAt: now - 30000 } } } },
    series_reading_progress: { [R]: { 'bar1series-i1': { fraction: 0.3, updatedAt: now - 10000 } } },
  });
  return ids;
}

// ── IN THE PAGE: the stand-in visualViewport and the sampler, before any page script ─────────────
function installProbe(storyBarSrc) {
  const sb = new Function(`${storyBarSrc}; return { containingBlockAncestor };`)();
  const fake = new EventTarget();
  let st = {};
  const val = (k) => (k in st ? st[k] : k === 'height' ? window.innerHeight : k === 'width' ? window.innerWidth : k === 'scale' ? 1 : 0);
  for (const k of ['offsetTop', 'offsetLeft', 'scale', 'height', 'width']) Object.defineProperty(fake, k, { get: () => val(k) });
  Object.defineProperty(fake, 'pageTop', { get: () => window.scrollY + val('offsetTop') });
  Object.defineProperty(fake, 'pageLeft', { get: () => window.scrollX });
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  window.addEventListener('resize', () => fake.dispatchEvent(new Event('resize')));
  // set(o, fire): change what the viewport reports; fire=false is iOS 26's fault — no event at all.
  window.__vv = { set(o, fire = true) { st = o ? { ...st, ...o } : {}; if (fire) { fake.dispatchEvent(new Event('resize')); fake.dispatchEvent(new Event('scroll')); } } };

  window.__samples = [];
  window.__phase = 'load';
  const sample = (why) => {
    const nav = document.querySelector('nav.cs-nav');
    if (!nav) return;
    const r = nav.getBoundingClientRect();
    const scale = fake.scale, vvTop = fake.offsetTop;
    const anc = sb.containingBlockAncestor(nav, (el) => getComputedStyle(el));
    const chain = [];
    for (let a = nav.parentElement; a; a = a.parentElement) chain.push(a.id ? `${a.tagName.toLowerCase()}#${a.id}` : a.tagName.toLowerCase());
    window.__samples.push({ phase: window.__phase, why, t: performance.now(), screenTop: (r.top - vvTop) * scale, painted: getComputedStyle(nav).visibility !== 'hidden',
      state: nav.getAttribute('data-state'), zoomed: scale > 1.01, anc: anc ? `${anc.tag} → ${anc.reason}` : null, chain: chain.join('>'), shift: nav.getAttribute('data-shift') });
  };
  window.__sampleNow = () => sample('final');
  const frame = () => { sample('frame'); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  for (const ev of ['scroll', 'resize', 'pageshow', 'focusin', 'focusout', 'orientationchange', 'popstate']) window.addEventListener(ev, () => sample(ev), { capture: true, passive: true });
  fake.addEventListener('resize', () => sample('vv'));
}

async function open(page, context, path = '/public-library', { uid = null, arriving = false } = {}) {
  const refused = [];
  await context.route('**/*', (r) => { const h = new URL(r.request().url()).hostname; if (h === 'localhost' || h === '127.0.0.1') return r.continue(); refused.push(h); return r.abort(); });
  await page.addInitScript(installProbe, STORYBAR_SRC);
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  if (arriving) await page.addInitScript(() => { if (!sessionStorage.getItem('bar1_arrived')) { sessionStorage.setItem('bar1_arrived', '1'); sessionStorage.setItem('cs_arriving', '/public-library'); } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path);
  await page.locator('nav.cs-nav').waitFor({ timeout: 180000 });
  if (uid) {
    await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, null, { timeout: 120000 });
    await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), await getAuth(app).createCustomToken(uid));
  }
  return { refused, errors };
}
const phase = (page, p) => page.evaluate((x) => { window.__phase = x; }, p);

// How long a fault may show before the guard has answered it. A script-driven follow always
// costs the frame the fault arrives in; under software rendering here a frame callback can lag
// past a second behind a backdrop blur, so the bound is generous. What it catches is a bar that
// is NOT answered: one that stays off the glass, or comes back only because something else moved.
const RECOVER_MS = 2500;

/** Every sample, judged. Returns the offenders, grouped, for a readable failure. */
async function judge(page) {
  await page.evaluate(() => window.__sampleNow());
  const s = (await page.evaluate(() => window.__samples)).slice().sort((a, b) => a.t - b.t);
  // A fault is a RUN of consecutive bad samples. It is an offence only if the guard never answers
  // it, or takes longer than RECOVER_MS to.
  const runsOf = (bad) => {
    const runs = [];
    let run = null;
    for (const x of s) {
      if (bad(x)) { if (!run) run = { start: x, end: x }; else run.end = x; }
      else if (run) { runs.push({ ...run, recovered: true }); run = null; }
    }
    if (run) runs.push({ ...run, recovered: false });
    return runs;
  };
  const runs = runsOf((x) => x.painted && x.state !== 'hidden' && Math.abs(x.screenTop) > 1);
  const hiddenRuns = runsOf((x) => !x.zoomed && !x.painted);
  const label = (x) => `${x.phase}/${x.why}: top ${x.screenTop.toFixed(0)} ${x.state}${x.anc ? ` ${x.anc}` : ''}`;
  const offences = (rs) => rs.filter((r) => !r.recovered || r.end.t - r.start.t > RECOVER_MS)
    .map((r) => `${label(r.start)} for ${Math.round(r.end.t - r.start.t)}ms${r.recovered ? '' : ', never recovered'}`);
  const ancestor = s.filter((x) => x.anc);
  const uniq = (xs) => [...new Set(xs)].slice(0, 8);
  return {
    n: s.length,
    offGlass: uniq(offences(runs)),
    hiddenUnzoomed: uniq(offences(hiddenRuns)), ancestor: uniq(ancestor.map(label)),
    transients: runs.length, longestMs: Math.round(Math.max(0, ...runs.map((r) => r.end.t - r.start.t))),
    last: s[s.length - 1],
  };
}
async function expectClean(page) {
  const j = await judge(page);
  expect(j.n).toBeGreaterThan(1);
  expect({ offGlass: j.offGlass, hiddenUnzoomed: j.hiddenUnzoomed, ancestor: j.ancestor }).toEqual({ offGlass: [], hiddenUnzoomed: [], ancestor: [] });
  test.info().annotations.push({ type: 'samples', description: `${j.n} samples; ${j.transients} fault frames answered, longest ${j.longestMs}ms` });
  return j;
}
/** Wait until the guard has answered: the bar's translate is `shift` (null = none). */
const shiftIs = (page, shift) => expect.poll(() => page.evaluate(() => document.querySelector('nav.cs-nav').getAttribute('data-shift')), { timeout: 15000 }).toBe(shift);
const settled = (page) => page.waitForTimeout(1800);   // past the guard's last re-read (1500ms)
const inHost = async (page) => expect(await page.evaluate(() => {
  const chain = []; for (let a = document.querySelector('nav.cs-nav').parentElement; a; a = a.parentElement) chain.push(a.id ? `${a.tagName.toLowerCase()}#${a.id}` : a.tagName.toLowerCase());
  return [chain.join('>'), document.body.firstElementChild?.id, getComputedStyle(document.getElementById('cs-bar-host')).display];
})).toEqual(['div#cs-bar-host>body>html', 'cs-bar-host', 'contents']);

test.beforeAll(async () => { await seed(); });

test('first load, the hero carousel and scrolling the rows: on the glass, no containing block, only <body> above it', async ({ page, context }) => {
  const { refused, errors } = await open(page, context);
  await page.locator('.just-added-scroll a').first().waitFor({ timeout: 180000 });
  await inHost(page);
  await phase(page, 'hero');
  await page.waitForTimeout(9000);                               // the hero rotates under the bar
  await phase(page, 'scroll');
  for (const y of [300, 900, 1600, 2400, 900, 0]) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(400); }
  await expectClean(page);
  expect(refused.filter((h) => /firebase/.test(h))).toEqual([]);
  expect(errors).toEqual([]);
});

test('arriving through the door (the veil\'s lift): NO ancestor is ever a containing block — this failed before BAR-1', async ({ page, context }) => {
  await open(page, context, '/public-library', { arriving: true });
  await phase(page, 'arrival');
  // The lift runs ~1.2–2.4s from first paint; sample well past it.
  await page.waitForTimeout(6000);
  const saw = await page.evaluate(() => window.__samples.some((x) => x.phase === 'arrival'));
  expect(saw).toBe(true);
  expect(await page.evaluate(() => document.querySelector('[data-arrival]') !== null)).toBe(true);   // the veil really played
  await expectClean(page);
});

test('signed in: Continue Reading and the Series rows mount under the bar; scrolling through them', async ({ page, context }) => {
  await open(page, context, '/public-library', { uid: R });
  await phase(page, 'rows');
  await page.locator('[data-continue-reading] .cr-card').first().waitFor({ timeout: 120000 });
  await page.locator('[data-series-row]').waitFor({ timeout: 120000 });
  for (const y of [500, 1200, 2000, 0]) { await page.evaluate((v) => window.scrollTo(0, v), y); await page.waitForTimeout(400); }
  await inHost(page);
  await expectClean(page);
});

test('the drawer and the sign-in box, with the keyboard replayed: up, panned, closed — and left stuck with no viewport event', async ({ page, context }) => {
  await open(page, context);
  await page.locator('.just-added-scroll a').first().waitFor({ timeout: 180000 });
  await page.evaluate(() => window.scrollTo(0, 700));
  await phase(page, 'drawer');
  await page.locator('.cs-hamburger').click();
  await page.locator('.cs-drawer').waitFor();
  await page.waitForTimeout(500);
  await phase(page, 'signin');
  await page.locator('.cs-drawer-signin').click();
  const email = page.locator('input.auth-input[type="email"]').first();
  await email.waitFor({ timeout: 30000 });
  await phase(page, 'keyboard');
  await email.focus();
  await page.evaluate(() => window.__vv.set({ offsetTop: 280, height: 420 }));   // the keyboard pans the page
  await page.keyboard.type('reader@example.com');
  await shiftIs(page, '280');
  // The keyboard goes; iOS 26 leaves the viewport offset with NO resize or scroll event.
  await phase(page, 'stuck+');
  await page.evaluate(() => { window.__vv.set({ offsetTop: 120, height: window.innerHeight - 120 }, false); document.activeElement.blur(); });
  await shiftIs(page, '120');
  await phase(page, 'stuck-');
  await page.evaluate(() => { document.querySelector('input.auth-input').focus(); });
  await page.evaluate(() => { window.__vv.set({ offsetTop: -240, height: window.innerHeight }, false); document.activeElement.blur(); });
  await shiftIs(page, '-240');                                          // followed, not hidden
  await settled(page);
  await expectClean(page);
});

test('back from a story (bfcache or a fresh load): the viewport comes back stuck 240 off, with only pageshow to say so', async ({ page, context }) => {
  const { errors } = await open(page, context);
  await page.locator('.just-added-scroll a').first().waitFor({ timeout: 180000 });
  await page.evaluate(() => window.scrollTo(0, 650));
  // On THIS document (a bfcache restore re-runs no init script) and on any fresh load of it.
  const stuckOnShow = () => window.addEventListener('pageshow', (e) => { if (location.pathname !== '/public-library') return; window.__phase = e.persisted ? 'back(bfcache)' : 'back(load)'; window.__vv.set({ offsetTop: -240, height: window.innerHeight }, false); }, { capture: true });
  await page.evaluate(stuckOnShow);
  await page.addInitScript(stuckOnShow);
  await page.locator('.just-added-scroll a').first().click();
  await page.waitForURL(/\/stories\//, { timeout: 180000 });
  await page.locator('article').first().waitFor({ timeout: 180000 });
  await page.goBack({ waitUntil: 'commit' });
  await page.locator('nav.cs-nav').waitFor({ timeout: 180000 });
  await shiftIs(page, '-240');
  await settled(page);
  test.info().annotations.push({ type: 'came back as', description: await page.evaluate(() => window.__phase) });
  await expectClean(page);
  // `next dev` serves no Pages Function: the story page's /api/story call fails, by design of the
  // harness, and leaving the page cancels it. Nothing else may throw.
  expect(errors.filter((e) => !/\/api\/story/.test(e))).toEqual([]);
});

test('client-side navigation (the Series row) and back (popstate): the bar re-enters its host and keeps the glass', async ({ page, context }) => {
  await open(page, context);
  await page.locator('[data-series-row] a[href^="/series/"]').first().waitFor({ timeout: 180000 });
  await phase(page, 'link');
  await page.locator('[data-series-row] a[href^="/series/"]').first().click();
  await page.waitForURL(/\/series\//, { timeout: 180000 });
  await page.waitForTimeout(1500);
  await phase(page, 'popstate');
  await page.goBack();
  await page.locator('nav.cs-nav').waitFor({ timeout: 180000 });
  await page.evaluate(() => window.__vv.set({ offsetTop: 90 }, false));
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await shiftIs(page, '90');
  await settled(page);
  await inHost(page);
  await expectClean(page);
});

test('rotation, and a pinch zoom: landscape and back keep the glass; zoomed the bar is hidden, and comes back at the top', async ({ page, context }) => {
  await open(page, context);
  await page.locator('.just-added-scroll a').first().waitFor({ timeout: 180000 });
  await phase(page, 'rotate');
  await page.setViewportSize({ width: 664, height: 390 });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await settled(page);
  await page.setViewportSize({ width: 390, height: 664 });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await settled(page);
  await phase(page, 'zoom');
  await page.evaluate(() => window.__vv.set({ scale: 1.8, offsetTop: 300 }));
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('nav.cs-nav')).visibility), { timeout: 15000 }).toBe('hidden');
  await page.evaluate(() => window.__vv.set(null));
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('nav.cs-nav')).visibility), { timeout: 15000 }).toBe('visible');
  await settled(page);
  await expectClean(page);
});

test('the founder readout: ?debug=bar stays on across navigation, keeps the readings, and FREEZES when the bar is pushed off the glass', async ({ page, context }) => {
  await open(page, context, '/public-library?debug=bar', { uid: FOUNDER_A });
  await page.locator('[data-bar-readout]').waitFor({ timeout: 120000 });
  // Client-side navigation to a page whose address has no ?debug: still on there, and on the way back.
  await page.locator('[data-series-row] a[href^="/series/"]').first().click();
  await page.waitForURL(/\/series\/[^/?]+$/, { timeout: 180000 });
  await page.locator('[data-bar-readout]').waitFor({ timeout: 120000 });
  await page.goBack();
  await page.locator('[data-bar-readout]').waitFor({ timeout: 120000 });
  // A full page load, no flag in the address: still on (sessionStorage).
  await page.goto('/public-library');
  await page.locator('[data-bar-readout]').waitFor({ timeout: 180000 });
  // The fault: stuck 240 off with no viewport event. The guard follows; the readout freezes on it.
  await page.evaluate(() => { window.__vv.set({ offsetTop: -240 }, false); window.dispatchEvent(new Event('focusout')); });
  await expect(page.locator('[data-bar-readout]')).toContainText('FROZEN', { timeout: 10000 });
  await expect(page.locator('[data-bar-readout]')).toContainText('FOLLOWING');
  const frozen = await page.evaluate(() => JSON.parse(sessionStorage.getItem('cs_debug_bar_frozen')));
  // The frozen rows end at the faulty reading itself: vv top −240, translate −240 (row: ms, y,
  // innerH, vvTop, vvH, scale, barOnScreen, state, shift, …). How many rows precede it depends on
  // the frame rate, which under software rendering here can be one in four seconds.
  const lastRow = frozen.samples[frozen.samples.length - 1];
  expect([lastRow[3], lastRow[8]]).toEqual([-240, -240]);
  expect(frozen.trigger).toBe('FOLLOWING');
  expect(frozen.events.some(([, e]) => e === 'focusout')).toBe(true);
  // It survives the next page.
  await page.goto('/about');
  await page.locator('[data-bar-readout]').waitFor({ timeout: 180000 });
  await expect(page.locator('[data-bar-readout]')).toContainText('FROZEN');
});

test('a reader who is not a founder never gets the readout, flag or not', async ({ page, context }) => {
  await open(page, context, '/public-library?debug=bar', { uid: R });
  await page.locator('[data-continue-reading] .cr-card').first().waitFor({ timeout: 120000 });   // signed in, settled
  await page.waitForTimeout(2000);
  await expect(page.locator('[data-bar-readout]')).toHaveCount(0);
});

