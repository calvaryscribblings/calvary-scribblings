// W46 §5 — THE LAST PAGE, IN THE SERIES READER (app/series/read/[instalmentId]/page-reader.js).
//
//   npm run test:series-notes:reader     (Firebase emulators + `next dev`, twice; hermetic)
//
// Two projects over the same spec, one per build of the flag:
//   · notes-off  — `next dev` with NEXT_PUBLIC_SERIES_NOTES_PREVIEW=0: forced off, the rollback state. The
//                  Series reader must behave exactly as before W46: no line chip, no finished
//                  write, no sheet, ?at= ignored, and the frame's `ended` still retires the
//                  furniture as it always has.
//   · notes-on   — the preview build: the line is saved to series_margin, the end writes
//                  series_finished and only then mounts the EndSheet, Not now returns to the book,
//                  and ?at=&v= opens at the CFI only when v is the file on screen.
//
// THE FIXTURE. As tests/series/w40-free.spec.mjs does, the static route only exists for ids the
// build knows, so the suite BORROWS one published instalment id from production (a public,
// signed-out GET; nothing is written there) and seeds the emulator under it. Every non-GET and
// every off-host request is refused. The stream endpoint is stubbed to hand the reader the
// harness EPUB and a fixed version.
//
// THE SHEET IS A PLACEHOLDER in this worker's tree (app/components/seriesNotes/EndSheet.js
// returns null), so "the sheet is up" is the wrap's data-series-endsheet attribute, and "Not now"
// is the sheet's onClose prop called from the React fiber. If the real sheet is present (after
// the lead's merge) its own "Not now" button is used instead.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { getDatabase } from 'firebase-admin/database';
import { adminApp, closeApp, adminToken } from '../../series/harness.mjs';

const PROD = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const READER = 'w46-last-page-reader';
const VERSION = '1700000000000001';
const DAY = 86_400_000;
const BOOK = readFileSync(new URL('../../fixtures/harness-book.epub', import.meta.url));
const SETTLED = 500;
let app, ids;

const notesOn = () => test.info().project.metadata.notes === true;

test.beforeAll(async () => {
  const rows = await (await fetch(`${PROD}/series_instalments.json`)).json();
  const [id, row] = Object.entries(rows || {}).find(([, r]) => r?.status === 'published') || [];
  if (!id) throw new Error('no published instalment id to borrow');
  ids = { inst: id, seriesId: row.seriesId };
  app = adminApp(`w46-last-page-${process.pid}`);
});
test.afterAll(async () => { if (app) await closeApp(app); });

const db = () => getDatabase(app);
const val = async (path) => (await db().ref(path).get()).val();

async function seed({ progress = null } = {}) {
  const { inst, seriesId } = ids;
  const now = Date.now();
  await db().ref('series').set(null);
  await db().ref('series_instalments').set(null);
  await db().ref('series_instalments_detail').set(null);
  await db().ref(`series_finished/${READER}`).set(null);
  await db().ref(`series_margin/${READER}`).set(null);
  await db().ref(`series_reading_progress/${READER}`).set(null);
  await db().ref().update({
    [`users/${READER}/displayName`]: 'Last Page Reader',
    [`users/${READER}/username`]: 'w46lastpage',
    [`usernames/w46lastpage`]: READER,
    [`series/${seriesId}`]: { schemaVersion: 1, slug: seriesId, title: 'W46 Fixture Series', synopsis: 'A fixture, not a book.', coverUrl: null, status: 'published', addedAt: now, updatedAt: now },
    [`series_instalments/${inst}`]: { schemaVersion: 1, seriesId, ordinal: 3, releaseAtMs: now - DAY, freeForGold: true, status: 'published', addedAt: now, updatedAt: now },
    [`series_instalments_detail/${inst}`]: {
      schemaVersion: 1, title: 'W46 Fixture Instalment', synopsis: null, logline: null, author: 'Fixture Author',
      authorUid: 'fixture-uid', authorHandle: 'fixture', coverUrl: null, epubPath: null, sponsorName: null, sponsorLogoUrl: null,
      wordCount: null, updatedAt: now,
    },
    ...(progress ? { [`series_reading_progress/${READER}/${inst}`]: progress } : {}),
  });
}

// W49 — the instalment read. /api/series/read is a Pages Function `next dev` does not run, so it
// is stood in for here: every call is recorded, and it answers counted:true or false as told.
const readCalls = [];
let readCounted = true;

async function fence(page) {
  await page.addInitScript(() => { try { localStorage.setItem('cs_cookie_consent', 'accepted'); } catch {} });
  await page.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/api/series/read') {
      readCalls.push({ auth: r.request().headers().authorization || '', body: JSON.parse(r.request().postData() || '{}') });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 5, counted: readCounted }) });
    }
    if (u.pathname === '/api/series/stream') {
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/__w46/book.epub', version: VERSION }) });
    }
    if (u.pathname === '/__w46/book.epub') return r.fulfill({ status: 200, contentType: 'application/epub+zip', body: BOOK });
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (!local && !/fonts\.(googleapis|gstatic)/.test(u.hostname)) return r.abort();
    if (!local && r.request().method() !== 'GET') return r.abort();
    return r.continue();
  });
}

/** Sign in on a light page first, so the reader opens signed in (no re-mint on sign-in). */
async function openSignedIn(page, query = '') {
  await fence(page);
  await page.goto('/series');
  const token = await adminToken(app, READER);
  await page.waitForFunction(() => !!window.__FB_EMULATOR_SIGNIN__, { timeout: 90000 });
  await page.evaluate((t) => window.__FB_EMULATOR_SIGNIN__(t), token);
  await page.goto(`/series/read/${ids.inst}${query}`);
  await waitForBook(page);
}

function frame(page) {
  const f = page.frames().find((fr) => fr.url().includes('/reading-room.html'));
  if (!f) throw new Error('reading-room frame not found');
  return f;
}

async function waitForBook(page) {
  await expect.poll(() => page.frames().some((fr) => fr.url().includes('/reading-room.html')), { timeout: 90000 }).toBe(true);
  await expect.poll(() => frame(page).evaluate(() => {
    const v = document.querySelector('foliate-view');
    return !!(document.getElementById('loading')?.classList.contains('hidden') && v?.renderer?.getContents?.()[0]?.doc && v.lastLocation);
  }).catch(() => false), { timeout: 60000 }).toBe(true);
  await page.waitForTimeout(800);
}

async function selectPhrase(page) {
  return frame(page).evaluate(() => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const p = [...doc.querySelectorAll('p')].find((x) => x.textContent.length > 80);
    const node = [...p.childNodes].find((x) => x.nodeType === 3 && x.nodeValue.trim().length > 60);
    const start = node.nodeValue.indexOf('.') + 2;
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 40);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return String(sel);
  });
}

async function selectWord(page) {
  return frame(page).evaluate(() => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const p = [...doc.querySelectorAll('p')].find((x) => x.textContent.length > 80);
    const node = [...p.childNodes].find((x) => x.nodeType === 3 && x.nodeValue.trim().length > 60);
    const re = /\b[A-Za-z]{4,}\b/g;
    re.lastIndex = node.nodeValue.indexOf('.') + 1;
    const m = re.exec(node.nodeValue);
    const range = doc.createRange();
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return m[0];
  });
}

const chipShown = (page, id) => frame(page).evaluate((i) => document.getElementById(i)?.classList.contains('show') || false, id);
const fractionNow = (page) => frame(page).evaluate(() => document.querySelector('foliate-view').lastLocation?.fraction ?? null);

/** Turn pages until the frame reports the last page (fraction >= 0.999, the `ended` threshold). */
async function toEnd(page) {
  await frame(page).evaluate(() => document.querySelector('foliate-view').goToFraction(0.97));
  await page.waitForTimeout(600);
  for (let i = 0; i < 80; i++) {
    if ((await fractionNow(page)) >= 0.999) return;
    await frame(page).evaluate(() => document.querySelector('foliate-view').renderer.next());
    await page.waitForTimeout(420);
  }
  throw new Error(`never reached the last page (at ${await fractionNow(page)})`);
}
async function prevPage(page) {
  await frame(page).evaluate(() => document.querySelector('foliate-view').renderer.prev());
  await page.waitForTimeout(600);
}
async function nextPage(page) {
  await frame(page).evaluate(() => document.querySelector('foliate-view').renderer.next());
  await page.waitForTimeout(600);
}

const sheet = (page) => page.locator('[data-series-endsheet]');

/** "Not now": the real sheet's button if it exists, else the placeholder's onClose prop. */
async function notNow(page) {
  const button = sheet(page).getByRole('button', { name: 'Not now' });
  if (await button.count()) { await button.click(); return 'button'; }
  const called = await page.evaluate(() => {
    const wrap = document.querySelector('[data-series-endsheet]');
    const key = Object.keys(wrap).find((k) => k.startsWith('__reactFiber$'));
    let f = wrap[key]?.child;
    while (f && typeof f.memoizedProps?.onClose !== 'function') f = f.child;
    if (!f) return false;
    f.memoizedProps.onClose();
    return true;
  });
  expect(called, 'the sheet carries onClose').toBe(true);
  return 'onClose';
}

// ── W49 — THE READ (rulings 176, 179) ─────────────────────────────────────────────────────
// Not behind the notes flag, so both builds must do it: once per load, after the first page is
// shown, with the reader's ID token; the readCount credit follows a COUNTED read only.
test('the read: fired once after the first page, with the token; the credit only when counted', async ({ page }) => {
  await seed();
  await db().ref(`users/${READER}/readCount`).set(9);
  await db().ref(`points/${READER}`).set(null);
  await db().ref(`library_notifications/${READER}`).set(null);
  await db().ref(`users/${READER}/readInstalments`).set(null);
  readCalls.length = 0;
  readCounted = true;
  await openSignedIn(page);
  await expect.poll(() => readCalls.length, { timeout: 15000 }).toBe(1);
  expect(readCalls[0].auth).toMatch(/^Bearer .+/);
  expect(readCalls[0].body).toEqual({ inst: ids.inst });
  await expect.poll(() => val(`users/${READER}/readCount`), { timeout: 15000 }).toBe(10);
  expect(await val(`users/${READER}/readInstalments/${ids.inst}`)).toBe(true);
  expect(await val(`users/${READER}/readStories/${ids.inst}`), 'never into readStories').toBeNull();
  // The tenth read pays, exactly as a story's does.
  await expect.poll(() => val(`points/${READER}/total`), { timeout: 15000 }).toBe(5);
  await page.waitForTimeout(13000); // past the 12 s dwell: still one call
  expect(readCalls.length).toBe(1);

  // A later open the server does not count (a seeded reader, or a second read): no credit.
  await db().ref(`users/${READER}/readInstalments`).set(null);
  readCounted = false;
  await page.reload();
  await waitForBook(page);
  await expect.poll(() => readCalls.length, { timeout: 15000 }).toBe(2);
  await page.waitForTimeout(1500);
  expect(await val(`users/${READER}/readCount`)).toBe(10);
  expect(await val(`users/${READER}/readInstalments/${ids.inst}`)).toBeNull();
});

// ── THE LINE ─────────────────────────────────────────────────────────────────────────────
test('the line: a phrase offers "This is my line" only with notes on, and the tap saves it to series_margin', async ({ page }) => {
  await seed();
  await openSignedIn(page);
  const selected = await selectPhrase(page);
  await page.waitForTimeout(SETTLED);
  const shown = await chipShown(page, 'line-chip');
  if (!notesOn()) {
    expect(shown, 'flag off: no line chip, ever').toBe(false);
    expect(await chipShown(page, 'define-chip')).toBe(false);
    await expect(page.locator('[data-line-notice]')).toHaveCount(0);
    expect(await val(`series_margin/${READER}/${ids.inst}`)).toBeNull();
    return;
  }
  expect(shown, 'flag on: the line chip is offered').toBe(true);
  const box = await frame(page).evaluate(() => {
    const r = document.getElementById('line-chip').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const frameBox = await page.locator('iframe.rr-frame').boundingBox();
  await page.mouse.click(frameBox.x + box.x, frameBox.y + box.y);

  await expect.poll(() => val(`series_margin/${READER}/${ids.inst}`), { timeout: 15000 }).not.toBeNull();
  const saved = await val(`series_margin/${READER}/${ids.inst}`);
  console.log(`\n=== series_margin ===\n${JSON.stringify(saved)}\n`);
  expect(saved.text).toBe(selected.replace(/\s+/g, ' ').trim());
  expect(saved.cfi).toMatch(/^epubcfi\(.+\)$/);
  expect(saved.epubVersion).toBe(VERSION);
  expect(typeof saved.savedAt).toBe('number');
  await expect(page.locator('[data-line-notice]')).toHaveText('Saved as your line.');
  await expect(page.locator('[data-line-notice]')).toHaveAttribute('aria-live', 'polite');
});

// W48 §1 — the way back. Sent here by the composer's "Choose it in the book" (?from=notes), the
// notice after "This is my line" carries "Back to your note" to the room with The line's composer
// open; it stays up (a link must not time out). Without ?from=notes the notice is the plain one.
test('the line: from the composer, the notice carries "Back to your note" to the room', async ({ page }) => {
  test.skip(!notesOn(), 'the way back exists only with notes on');
  for (const from of [true, false]) {
    await seed();
    await openSignedIn(page, from ? '?from=notes' : '');
    await selectPhrase(page);
    await page.waitForTimeout(SETTLED);
    expect(await chipShown(page, 'line-chip')).toBe(true);
    const box = await frame(page).evaluate(() => {
      const r = document.getElementById('line-chip').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const frameBox = await page.locator('iframe.rr-frame').boundingBox();
    await page.mouse.click(frameBox.x + box.x, frameBox.y + box.y);
    await expect.poll(() => val(`series_margin/${READER}/${ids.inst}`), { timeout: 15000 }).not.toBeNull();
    const notice = page.locator('[data-line-notice]');
    const back = notice.getByRole('link', { name: 'Back to your note' });
    if (!from) {
      await expect(notice).toHaveText('Saved as your line.');
      await expect(back).toHaveCount(0);
      continue;
    }
    await expect(notice).toHaveText('Saved as your line.Back to your note');
    await expect(back).toHaveAttribute('href', `/series/${ids.seriesId}/notes?i=${encodeURIComponent(ids.inst)}&compose=line`);
    const r = await back.boundingBox();
    expect(r.height, 'the way back is a full target').toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(4000); // past the plain notice's 3.2s
    await expect(back, 'the way back does not time out').toBeVisible();
    await page.screenshot({ path: new URL('../../../test-results/series-notes-reader/w48-back-to-note.png', import.meta.url).pathname });
  }
});

test('the line: a single word is still Define\'s alone', async ({ page }) => {
  await seed();
  await openSignedIn(page);
  await selectWord(page);
  await page.waitForTimeout(SETTLED);
  expect(await chipShown(page, 'define-chip')).toBe(true);
  expect(await chipShown(page, 'line-chip')).toBe(false);
});

// ── THE END ──────────────────────────────────────────────────────────────────────────────
test('the end: series_finished is written, THEN the sheet mounts; Not now returns to the book; it rises again only after leaving', async ({ page }) => {
  await seed();
  await openSignedIn(page);
  await expect(page.locator('.rr-thread')).toHaveCount(1);
  await toEnd(page);

  if (!notesOn()) {
    await page.waitForTimeout(1500);
    await expect(sheet(page), 'flag off: no sheet').toHaveCount(0);
    expect(await val(`series_finished/${READER}/${ids.inst}`), 'flag off: no finished write').toBeNull();
    // Byte-identical: the frame's `ended` retires the furniture exactly as it did before W46.
    await expect(page.locator('.rr-thread')).toHaveCount(0);
    return;
  }

  await expect(sheet(page)).toHaveCount(1, { timeout: 15000 });
  // The write had landed by the time the sheet mounted (raiseEnd awaits the server's ack).
  const finished = await val(`series_finished/${READER}/${ids.inst}`);
  console.log(`\n=== series_finished ===\n${finished}\n`);
  expect(typeof finished).toBe('number');
  expect(finished).toBeGreaterThan(Date.now() - 120000);
  // The reader is still in the book behind the sheet: the furniture stays (keepChromeAtEnd).
  await expect(page.locator('.rr-thread')).toHaveCount(1);

  const how = await notNow(page);
  console.log(`Not now via ${how}`);
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('iframe.rr-frame')).toBeVisible();

  // Still on the last page: a fresh relocate there must not raise it a second time.
  await frame(page).evaluate(() => document.querySelector('foliate-view').goToFraction(1));
  await page.waitForTimeout(1500);
  expect(await fractionNow(page)).toBeGreaterThanOrEqual(0.999);
  await expect(sheet(page), 'not twice in a row on the same last page').toHaveCount(0);

  // Leave the last page, come back: it rises again.
  await prevPage(page);
  expect(await fractionNow(page)).toBeLessThan(0.999);
  await expect(sheet(page)).toHaveCount(0);
  await nextPage(page);
  await expect(sheet(page)).toHaveCount(1, { timeout: 15000 });
});

// ── IN ITS PLACE ─────────────────────────────────────────────────────────────────────────
/** A CFI from the middle of the book: the RANGE of a phrase selected around fraction 0.5. */
async function middleCfi(page) {
  await frame(page).evaluate(() => document.querySelector('foliate-view').goToFraction(0.55));
  await page.waitForTimeout(900);
  return frame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    const { doc, index } = view.renderer.getContents()[0];
    const p = [...doc.querySelectorAll('p')].find((x) => x.textContent.length > 80);
    const node = [...p.childNodes].find((x) => x.nodeType === 3);
    const range = doc.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 30);
    return { cfi: view.getCFI(index, range), index, fraction: view.lastLocation.fraction };
  });
}

const PROGRESS = () => ({ fraction: 0.12, updatedAt: Date.now() - 3600_000 });
const sectionNow = (page) => frame(page).evaluate(() => document.querySelector('foliate-view').renderer.getContents()[0]?.index ?? null);

test('in its place: ?at=&v= opens at the CFI when v is the file on screen, and the saved place stands until the reader moves', async ({ page }) => {
  await seed();
  await openSignedIn(page);
  const target = await middleCfi(page);
  console.log(`\n=== target ===\n${JSON.stringify(target)}\n`);

  const progress = PROGRESS();
  await seed({ progress });
  await page.goto(`/series/read/${ids.inst}?at=${encodeURIComponent(target.cfi)}&v=${VERSION}`);
  await waitForBook(page);
  await page.waitForTimeout(1200);

  const index = await sectionNow(page);
  const fraction = await fractionNow(page);
  console.log(`opened at section ${index}, fraction ${fraction}`);
  if (!notesOn()) {
    expect(index, 'flag off: ?at= is ignored, the saved place wins').not.toBe(target.index);
    expect(Math.abs(fraction - progress.fraction)).toBeLessThan(0.08);
    return;
  }
  expect(index, 'opened in the section the line was taken from').toBe(target.index);
  // No "continue where you left off": this open is not a resume.
  await expect(page.locator('.rr-resume-toast')).toHaveCount(0);

  // The landing is not a move: the saved place is untouched past the 2s save debounce.
  await page.waitForTimeout(3500);
  expect(await val(`series_reading_progress/${READER}/${ids.inst}`)).toEqual(progress);

  // The reader turns a page: their place is theirs again, and it is saved.
  await nextPage(page);
  await expect.poll(async () => (await val(`series_reading_progress/${READER}/${ids.inst}`))?.updatedAt, { timeout: 15000 }).toBeGreaterThan(progress.updatedAt);
  const saved = await val(`series_reading_progress/${READER}/${ids.inst}`);
  expect(saved.fraction).toBeGreaterThan(0.3);
});

test('in its place: a different v (or none) ignores ?at= and opens at the reader\'s own place', async ({ page }) => {
  await seed();
  await openSignedIn(page);
  const target = await middleCfi(page);
  const progress = PROGRESS();

  for (const q of [`?at=${encodeURIComponent(target.cfi)}&v=999`, `?at=${encodeURIComponent(target.cfi)}`]) {
    await seed({ progress });
    await page.goto(`/series/read/${ids.inst}${q}`);
    await waitForBook(page);
    await page.waitForTimeout(1200);
    const index = await sectionNow(page);
    const fraction = await fractionNow(page);
    console.log(`${q.includes('v=') ? 'v mismatch' : 'no v'}: section ${index}, fraction ${fraction}`);
    expect(index, 'a CFI from other bytes is not followed').not.toBe(target.index);
    expect(Math.abs(fraction - progress.fraction)).toBeLessThan(0.08);
  }
});
