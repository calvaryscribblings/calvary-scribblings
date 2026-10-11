// W38 — THE SERIES ADMIN, DRIVEN THROUGH ITS SCREENS (ruling 140).
//
//   npm run test:series-admin     (Firebase emulators + `next dev`; hermetic — see ./harness.mjs)
//
// Emulators and stubs only, never production. /api/rebuild is stubbed (202, or 500 for the
// failure case) and counted; the page check's fetches of /series/... are stubbed to answer 200.
//
// Carries the R31 suite's claims onto the new screens as well (that suite drove the old ones and
// is retired with them): a delete takes the artefacts and burns the number, the next number skips
// it, and a tier change on a live instalment changes who the grant lets in.
import { test, expect } from '@playwright/test';
import { writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase } from 'firebase-admin/database';
import {
  adminApp, closeApp, seedFixture, adminToken, rowRef, detailRef, seriesRef, tombstoneRef, putObject, objectExists, listPrefix,
  SERIES_ID, INSTALMENT_ID,
} from './harness.mjs';
import { londonFieldsToMs, londonFields, londonShort, londonLongDate } from '../../app/lib/londonTime.js';
import { grantForInstalment } from '../../app/lib/series/access.js';
import { PROVISIONAL_RELEASE_MS } from '../../app/lib/series/schema.js';

const PNG = join(tmpdir(), 'w38-cover.png');
writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const EPUB = fileURLToPath(new URL('../fixtures/harness-book.epub', import.meta.url));
if (!existsSync(EPUB)) execFileSync('node', [fileURLToPath(new URL('../fixtures/make-epub.mjs', import.meta.url))]);
const I2 = `${SERIES_ID}-i2`;
const DAY = 86400000;

let app;
test.beforeAll(async () => { app = adminApp('w38-harness'); });
test.afterAll(async () => { if (app) await closeApp(app); });
test.beforeEach(async () => { await seedFixture(app); });

// ── FIXTURES ─────────────────────────────────────────────────────────────────────────────
const db = () => getDatabase(app);
const COVER = 'https://example.test/cover.png';
async function liveSeries() { await seriesRef(app).update({ status: 'published', coverUrl: 'https://example.test/poster.png' }); }
async function liveInstalment(id = INSTALMENT_ID, extra = {}) {
  await rowRef(app, id).update({ status: 'published', releaseAtMs: Date.now() - DAY, freeForGold: false, ...extra });
  await db().ref(`series_instalments_detail/${id}`).update({ coverUrl: COVER, epubPath: `series_epubs/${id}/master.epub`, wordCount: 4400 });
}
async function newDraftReady(id = I2) {
  // A draft as the editor makes it, files already up, both choices still open.
  const now = Date.now();
  await db().ref().update({
    [`series_instalments/${id}`]: { schemaVersion: 1, seriesId: SERIES_ID, ordinal: 2, releaseAtMs: PROVISIONAL_RELEASE_MS, freeForGold: false, status: 'draft', addedAt: now, updatedAt: now },
    [`series_instalments_detail/${id}`]: {
      schemaVersion: 1, title: 'The Second', author: 'Fixture Author', authorUid: 'fixture-uid', authorHandle: 'fixture',
      coverUrl: COVER, epubPath: `series_epubs/${id}/master.epub`, wordCount: 2200,
      choicesPending: { freeForGold: true, releaseAtMs: true }, updatedAt: now,
    },
  });
}

// ── THE SITE, STUBBED ────────────────────────────────────────────────────────────────────
async function stubSite(page, { rebuild = 202, delayMs = 1200 } = {}) {
  const calls = { rebuild: 0, checked: [] };
  await page.route('**/api/rebuild', async (route) => {
    calls.rebuild++;
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: rebuild, contentType: 'application/json', body: rebuild === 202 ? '{}' : JSON.stringify({ error: 'The build hook refused.' }) });
  });
  await page.route((url) => url.pathname.startsWith('/series/'), async (route) => {
    calls.checked.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ok</title>' });
  });
  return calls;
}

async function open(page, query) {
  const token = await adminToken(app);
  await page.goto(`/admin/series${query ? `?${query}` : ''}`);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, { timeout: 60000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
  await expect(page.getByText('Not authorised')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Loading', { timeout: 60000 });
}
const panel = (page) => page.locator('aside.sa-panel');
const filesCard = (page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Files' }) });
const row = async (id = I2) => (await rowRef(app, id).get()).val();
const detail = async (id = I2) => (await db().ref(`series_instalments_detail/${id}`).get()).val();

// ═════════════════════════════════════════════════════════════════════════════════════════
test('type a title, upload an EPUB and a cover, choose who can read it, schedule', async ({ page }) => {
  await liveSeries(); await liveInstalment();
  const calls = await stubSite(page);
  await open(page, `s=${SERIES_ID}`);
  await page.getByRole('button', { name: 'Add instalment 2' }).click();
  await expect(page.getByText('Instalment 2', { exact: true }).first()).toBeVisible();

  // The draft exists the moment a title is typed: provisional row, both choices open, writer copied.
  await page.getByLabel('Title', { exact: true }).fill('The Second');
  await expect.poll(row, { timeout: 20000 }).toMatchObject({ status: 'draft', freeForGold: false, releaseAtMs: PROVISIONAL_RELEASE_MS, ordinal: 2 });
  expect(await detail()).toMatchObject({ title: 'The Second', author: 'Fixture Author', authorUid: 'fixture-uid', choicesPending: { freeForGold: true, releaseAtMs: true } });
  await expect(page).toHaveURL(new RegExp(`i=${I2}`));
  await expect(panel(page).getByRole('button', { name: '4 things left' })).toBeDisabled();

  await filesCard(page).locator('input[type=file]').nth(0).setInputFiles(EPUB);
  await expect(filesCard(page).getByText('Uploaded')).toBeVisible({ timeout: 30000 });
  await filesCard(page).locator('input[type=file]').nth(1).setInputFiles(PNG);
  await expect(filesCard(page).getByText('Added')).toBeVisible({ timeout: 30000 });
  expect((await detail()).wordCount).toBeGreaterThan(0);

  await page.getByRole('radio', { name: /Gold and Platinum/ }).click();
  await expect.poll(async () => (await detail()).choicesPending).toEqual({ releaseAtMs: true });
  expect((await row()).freeForGold).toBe(true);
  await expect(panel(page).getByRole('button', { name: '1 thing left' })).toBeDisabled();

  const [date] = londonFields(Date.now() + 4 * DAY);
  const ms = londonFieldsToMs(date, '08:00');
  await page.getByRole('radio', { name: 'On a date' }).click();
  await page.getByLabel('Date', { exact: true }).fill(date);
  await page.getByLabel('Time', { exact: true }).fill('08:00');
  await expect(page.getByText('London time', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Goes live in \d+ days, at 08:00 London time\.$/)).toBeVisible();
  const schedule = panel(page).getByRole('button', { name: `Schedule for ${londonShort(ms)}` });
  await expect(schedule).toBeEnabled({ timeout: 15000 });
  await expect(panel(page).getByText(`Opens it to readers at 08:00 London on ${londonLongDate(ms)}.`)).toBeVisible();

  await schedule.click();
  await expect(panel(page).getByText('Saved as scheduled')).toBeVisible();
  await expect(panel(page).getByText(`Instalment 2 goes live on ${londonLongDate(ms)} at 08:00 London time.`)).toBeVisible({ timeout: 30000 });
  await expect(panel(page).getByText('Its page is built and waiting. Nothing else to do.')).toBeVisible();

  const r = await row();
  expect(r).toMatchObject({ status: 'published', releaseAtMs: ms, freeForGold: true });
  const d = await detail();
  expect(d.choicesPending).toBeUndefined();
  expect(d.releaseWhen).toBeUndefined();
  expect(calls.rebuild, 'one rebuild per action').toBe(1);
  expect(calls.checked).toContain(`/series/instalment/${I2}`);
});

test('publish now: the release is the server clock, and it says Live', async ({ page }) => {
  await liveSeries(); await liveInstalment(); await newDraftReady();
  const calls = await stubSite(page);
  await open(page, `s=${SERIES_ID}&i=${I2}`);
  await page.getByRole('radio', { name: /Platinum only/ }).click();
  await page.getByRole('radio', { name: 'As soon as I publish' }).click();
  await expect(page.getByText('It goes live the moment you press Publish.')).toBeVisible();
  const start = Date.now();
  await panel(page).getByRole('button', { name: 'Publish now' }).click();
  await expect(panel(page).getByText('Instalment 2 is live on the site.')).toBeVisible({ timeout: 30000 });
  await expect(panel(page).getByText('Its page opens. Checked just now.')).toBeVisible();
  const r = await row();
  expect(r.status).toBe('published');
  expect(r.freeForGold).toBe(false);
  expect(r.releaseAtMs).toBeGreaterThan(start - 60000);
  expect(r.releaseAtMs).toBeLessThanOrEqual(Date.now() + 5000);
  expect(calls.rebuild).toBe(1);
});

test('a first instalment publishes its series with it, in the same write', async ({ page }) => {
  await seriesRef(app).update({ coverUrl: 'https://example.test/poster.png' });         // still a draft
  await db().ref(`series_instalments_detail/${INSTALMENT_ID}`).update({ coverUrl: COVER, epubPath: `series_epubs/${INSTALMENT_ID}/master.epub`, releaseWhen: 'publish' });
  const calls = await stubSite(page, { delayMs: 2500 });
  await open(page, `s=${SERIES_ID}&i=${INSTALMENT_ID}`);
  await expect(panel(page).getByText('Series poster')).toBeVisible();
  await expect(panel(page).getByText('Series synopsis')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Publish now' }).click();
  await expect(panel(page).getByText('The series is live too. It was still a draft.')).toBeVisible();
  await expect(panel(page).getByText('Instalment 1 is live on the site.')).toBeVisible({ timeout: 30000 });
  expect((await seriesRef(app).get()).val().status).toBe('published');
  expect((await row(INSTALMENT_ID)).status).toBe('published');
  expect(calls.rebuild).toBe(1);
  expect(calls.checked).toEqual(expect.arrayContaining([`/series/instalment/${INSTALMENT_ID}`, `/series/${SERIES_ID}`]));
});

test('nothing can be pressed until the cover is there (141)', async ({ page }) => {
  await liveSeries(); await newDraftReady();
  await db().ref(`series_instalments_detail/${I2}`).update({ coverUrl: null, choicesPending: null, releaseWhen: 'publish' });
  await stubSite(page);
  await open(page, `s=${SERIES_ID}&i=${I2}`);
  await expect(panel(page).getByRole('button', { name: '1 thing left' })).toBeDisabled();
  await expect(filesCard(page).getByText('No cover yet')).toBeVisible();
});

test('a failed rebuild says so, keeps the publish, and offers the rebuild again', async ({ page }) => {
  await liveSeries(); await newDraftReady();
  await db().ref(`series_instalments_detail/${I2}`).update({ choicesPending: null, releaseWhen: 'publish' });
  await stubSite(page, { rebuild: 500, delayMs: 100 });
  await open(page, `s=${SERIES_ID}&i=${I2}`);
  await panel(page).getByRole('button', { name: 'Publish now' }).click();
  await expect(panel(page).getByText('Not on the site yet')).toBeVisible({ timeout: 30000 });
  await expect(panel(page).getByText('Nothing is lost.')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Rebuild the site' })).toBeVisible();
  expect((await row()).status).toBe('published');
});

test('take down, with its confirmation, asks for one rebuild', async ({ page }) => {
  await liveSeries(); await liveInstalment();
  const calls = await stubSite(page, { delayMs: 100 });
  await open(page, `s=${SERIES_ID}&i=${INSTALMENT_ID}`);
  await expect(panel(page).getByText(/^Live since /)).toBeVisible();
  await expect(panel(page).getByText('Platinum members can read it.')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Delete instalment…' })).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Take it down…' }).click();
  await expect(panel(page).getByText('Take instalment 1 down?')).toBeVisible();
  for (const line of ['Readers lose it straight away, until you publish it again.', 'Their saved place is kept.', 'The site rebuilds without its page, in about two minutes.']) {
    await expect(panel(page).getByText(line)).toBeVisible();
  }
  await panel(page).getByRole('button', { name: 'Take it down', exact: true }).click();
  await expect(panel(page).getByText('Instalment 1 is off the site. Nothing is deleted.')).toBeVisible({ timeout: 20000 });
  expect((await row(INSTALMENT_ID)).status).toBe('unpublished');
  expect(calls.rebuild).toBe(1);
  await expect(panel(page).getByRole('button', { name: 'Publish it again' })).toBeVisible();
});

test('delete is offered only for a draft or a taken-down instalment, and it burns the number', async ({ page }) => {
  await liveSeries(); await liveInstalment();
  await rowRef(app, INSTALMENT_ID).update({ status: 'unpublished' });
  await putObject(app, `series_epubs/${INSTALMENT_ID}/master.epub`, Buffer.from('PK'), 'application/epub+zip');
  await putObject(app, `series_covers/${INSTALMENT_ID}/cover/1-c.png`, Buffer.from('x'), 'image/png');
  await stubSite(page, { delayMs: 50 });
  await open(page, `s=${SERIES_ID}&i=${INSTALMENT_ID}`);
  await panel(page).getByRole('button', { name: 'Delete instalment…' }).click();
  const del = panel(page).getByRole('button', { name: 'Delete instalment 1' });
  await expect(del).toBeDisabled();
  await panel(page).getByLabel('Type the number (1) to confirm').fill('1');
  await del.click();
  await expect(page.getByText('Instalment 1 deleted. Its number is retired and cannot be reused.')).toBeVisible({ timeout: 20000 });
  expect((await rowRef(app, INSTALMENT_ID).get()).exists()).toBe(false);
  expect((await tombstoneRef(app, INSTALMENT_ID).get()).exists()).toBe(true);
  expect(await objectExists(app, `series_epubs/${INSTALMENT_ID}/master.epub`)).toBe(false);
  expect(await listPrefix(app, `series_covers/${INSTALMENT_ID}/`)).toEqual([]);
  // The number is skipped silently: the next one offered is 2, not 1.
  await expect(page.getByRole('button', { name: 'Add instalment 2' })).toBeVisible();
});

test('a draft offers delete too; a scheduled one does not', async ({ page }) => {
  await liveSeries(); await newDraftReady();
  await stubSite(page);
  await open(page, `s=${SERIES_ID}&i=${I2}`);
  await expect(panel(page).getByRole('button', { name: 'Delete instalment…' })).toBeVisible();
  await rowRef(app, I2).update({ status: 'published', releaseAtMs: Date.now() + 3 * DAY });
  await db().ref(`series_instalments_detail/${I2}/choicesPending`).set(null);
  await page.reload();
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__);
  await page.evaluate(async (t) => window.__FB_EMULATOR_SIGNIN__(t), await adminToken(app));
  await expect(panel(page).getByText(/goes live on/)).toBeVisible({ timeout: 60000 });
  await expect(panel(page).getByRole('button', { name: 'Delete instalment…' })).toHaveCount(0);
});

test('edits to a live instalment wait for "Save changes"; Discard puts them back', async ({ page }) => {
  await liveSeries(); await liveInstalment();
  await stubSite(page);
  await open(page, `s=${SERIES_ID}&i=${INSTALMENT_ID}`);
  const title = page.getByLabel('Title', { exact: true });
  await title.fill('Half-typed');
  await page.waitForTimeout(1800);
  expect((await detail(INSTALMENT_ID)).title).toBe('Harness Instalment');
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(title).toHaveValue('Harness Instalment');
  await title.fill('A Better Title');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await detail(INSTALMENT_ID)).title, { timeout: 15000 }).toBe('A Better Title');
  await expect(page.getByText('Saved. It shows on the site straight away.')).toBeVisible();
});

test('a tier change on a live instalment changes who the grant lets in (R31, carried over)', async ({ page }) => {
  await liveSeries(); await liveInstalment();
  await stubSite(page);
  await open(page, `s=${SERIES_ID}&i=${INSTALMENT_ID}`);
  const gold = { subscriptionTier: 'gold', effectiveTier: 'gold', signedIn: true, forceGate: true };
  expect(grantForInstalment({ id: INSTALMENT_ID, ...(await row(INSTALMENT_ID)) }, gold).access).not.toBe('granted');
  await page.getByRole('radio', { name: /Gold and Platinum/ }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await row(INSTALMENT_ID)).freeForGold, { timeout: 15000 }).toBe(true);
  expect(grantForInstalment({ id: INSTALMENT_ID, ...(await row(INSTALMENT_ID)) }, gold).access).toBe('granted');
  // The £1 day pass still does not count, whichever way it is set.
  const pass = { subscriptionTier: 'free', effectiveTier: 'gold', signedIn: true, forceGate: true };
  expect(grantForInstalment({ id: INSTALMENT_ID, ...(await row(INSTALMENT_ID)) }, pass).access).not.toBe('granted');
});

test('the writer is chosen by name, or found by handle, and all three fields are written', async ({ page }) => {
  await db().ref().update({
    'cms_stories/w38-probe': { authorUid: 'wren-uid', title: 'x' },
    'users/wren-uid': { displayName: 'Wren Writer', username: 'wren' },
    'users/hana-uid': { displayName: 'Hana Handle', username: 'hana' },
    'usernames/hana': 'hana-uid',
  });
  await stubSite(page);
  await open(page, `s=${SERIES_ID}&i=${INSTALMENT_ID}`);
  await expect(page.getByText('The series’ writer')).toBeVisible();
  await page.getByRole('button', { name: 'Change' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose the writer' });
  await dialog.getByLabel('Search writers').fill('wren');
  await dialog.getByRole('radio', { name: /Wren Writer/ }).click();
  await expect(dialog.getByText('Their account and handle come with the name. You never type them.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Use Wren Writer' }).click();
  await expect.poll(async () => { const d = await detail(INSTALMENT_ID); return [d.author, d.authorUid, d.authorHandle]; }, { timeout: 15000 })
    .toEqual(['Wren Writer', 'wren-uid', 'wren']);

  await page.getByRole('button', { name: 'Change' }).click();
  await dialog.getByPlaceholder('@handle').fill('@Hana');
  await dialog.getByRole('button', { name: 'Find' }).click();
  await dialog.getByRole('button', { name: 'Use Hana Handle' }).click();
  await expect.poll(async () => { const d = await detail(INSTALMENT_ID); return [d.author, d.authorUid, d.authorHandle]; }, { timeout: 15000 })
    .toEqual(['Hana Handle', 'hana-uid', 'hana']);
  await expect(page.getByText('Chosen for this instalment')).toBeVisible();
});

test('a new series: title and writer, poster once a title is typed; it lands on its own page', async ({ page }) => {
  await db().ref().update({ 'cms_stories/w38-probe': { authorUid: 'wren-uid' }, 'users/wren-uid': { displayName: 'Wren Writer', username: 'wren' } });
  await stubSite(page);
  await open(page, 'new=series');
  const create = page.getByRole('button', { name: 'Create series' });
  await expect(create).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Choose image' })).toBeDisabled();
  await page.getByLabel('Title', { exact: true }).fill('W38 Probe Series');
  await expect(page.getByRole('button', { name: 'Choose image' })).toBeEnabled();
  await page.locator('input[type=file]').setInputFiles(PNG);
  await expect(page.getByRole('button', { name: 'Replace image' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Choose the writer' }).click();
  await page.getByRole('radio', { name: /Wren Writer/ }).click();
  await page.getByRole('button', { name: 'Use Wren Writer' }).click();
  await create.click();
  await expect(page).toHaveURL(/s=w38-probe-series/, { timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'W38 Probe Series' })).toBeVisible();
  const s = (await db().ref('series/w38-probe-series').get()).val();
  expect(s).toMatchObject({ status: 'draft', author: 'Wren Writer', authorUid: 'wren-uid', authorHandle: 'wren', synopsis: '' });
  expect(s.coverUrl).toContain('http');
  await expect(page.getByRole('button', { name: 'Add instalment 1' })).toBeVisible();
});

test('Back and Forward move between the screens; no id, epoch or raw status is printed', async ({ page }) => {
  await liveSeries(); await liveInstalment(); await newDraftReady();
  await stubSite(page);
  await open(page, '');
  const clean = async () => {
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/harness-series-i\d/);
    expect(text).not.toMatch(/\b\d{12,}\b/);
    expect(text).not.toMatch(/\bunpublished\b|\bpublished\b/);
  };
  await expect(page.getByRole('heading', { name: 'The Series' })).toBeVisible();
  await expect(page.getByText('1 instalment live · instalment 2 in draft')).toBeVisible();
  await clean();
  await page.locator(`[data-series="${SERIES_ID}"]`).click();
  await expect(page.getByRole('heading', { name: 'Harness Series' })).toBeVisible();
  await expect(page.locator(`[data-instalment="${I2}"]`)).toContainText('Not chosen');
  await clean();
  await page.locator(`[data-instalment="${I2}"]`).click();
  await expect(page.getByText('Before it goes live')).toBeVisible();
  await clean();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Harness Series' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'The Series' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Harness Series' })).toBeVisible();
});

test('the preview draws the instalment page from the form, with the read button', async ({ page }) => {
  await liveSeries(); await newDraftReady();
  await db().ref(`series_instalments_detail/${I2}`).update({ logline: 'A line in italic.' });
  await stubSite(page);
  await open(page, `s=${SERIES_ID}&i=${I2}`);
  await panel(page).getByRole('button', { name: 'Preview the page' }).click();
  const pv = page.getByRole('dialog', { name: 'Preview' });
  await expect(pv.getByRole('heading', { name: 'The Second' })).toBeVisible();
  await expect(pv.getByText('A line in italic.')).toBeVisible();
  await expect(pv.getByRole('button', { name: /Read/ })).toBeVisible();
  await pv.getByRole('button', { name: 'Close preview' }).click();
  await expect(pv).toHaveCount(0);
});

test('phone, iPad portrait and landscape, laptop: no sideways scroll, 44px targets, the panel drops below the form', async ({ page }) => {
  await liveSeries(); await liveInstalment(); await newDraftReady();
  await stubSite(page);
  const shots = process.env.W38_SHOTS;
  for (const [w, h] of [[390, 844], [768, 1024], [1024, 768], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const q of ['', `s=${SERIES_ID}`, `s=${SERIES_ID}&i=${I2}`]) {
      await open(page, q);
      await expect(page.locator('main h1').first()).toBeVisible();
      const m = await page.evaluate(() => {
        const small = [...document.querySelectorAll('main button, main a, main input, main [role=radio]')]
          .filter((el) => el.offsetParent !== null && !el.hidden && el.type !== 'file')
          .map((el) => ({ t: (el.innerText || el.getAttribute('aria-label') || el.id || el.tagName).slice(0, 30), h: el.getBoundingClientRect().height }))
          .filter((x) => x.h < 44);
        return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, small };
      });
      expect(m.over, `${w}px ${q || 'list'}: sideways scroll`).toBeLessThanOrEqual(0);
      expect(m.small, `${w}px ${q || 'list'}: targets under 44px`).toEqual([]);
      if (q.includes('&i=')) {
        const form = await page.locator('.sa-form').boundingBox();
        const side = await page.locator('aside.sa-panel').boundingBox();
        if (w < 900) expect(side.y, `${w}px: the panel drops below the form`).toBeGreaterThan(form.y + form.height - 1);
        else expect(Math.abs(side.y - form.y), `${w}px: two columns`).toBeLessThan(2);
      }
      if (shots) await page.screenshot({ path: join(shots, `${w}-${q.includes('&i=') ? 'editor' : q ? 'series' : 'list'}.png`), fullPage: true });
    }
  }
});
