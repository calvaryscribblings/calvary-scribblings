// W46 — READERS' NOTES, THE READER'S SCREENS (the door, the room, the composer, the last page).
//
//   npm run test:series-notes:ui      (Firebase emulators + `next dev` with the preview flag)
//
// Layout at 390, 834 and 1280px with screenshots saved LOCALLY under test-results/ (gitignored),
// and the claims the brief makes of these screens:
//   · under 720px the door is exactly the card's height; at 720px and up exactly its width;
//   · no horizontal scroll; every target 44px or more; bars carry their words;
//   · reduced motion turns the motion off;
//   · a sealed room (signed out, or signed in and unfinished) asks for NO gated path — the
//     recorder sees every listen/get frame the page sends the emulator.
// See fixture.mjs for what is seeded and the endpoint stand-in.
import { test, expect } from '@playwright/test';
import { getDatabase } from 'firebase-admin/database';
import { adminApp, closeApp, borrowSlug, ids, seed, fence, recordPaths, gatedOf, signIn, READER } from './fixture.mjs';

const SHOTS = new URL('../../../test-results/series-notes-ui/', import.meta.url).pathname;
const WIDTHS = [390, 834, 1280];
let app, slug, I;

test.beforeAll(async () => {
  slug = await borrowSlug();
  I = ids(slug);
  app = adminApp('w46-notes-ui');
});
test.afterAll(async () => { if (app) await closeApp(app); });

const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true });

async function noHorizontalScroll(page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, 'no horizontal scroll').toBeLessThanOrEqual(iw);
}

/** Every visible button and link inside `scope` is at least 44 x 44 CSS px. */
async function targets(page, scope) {
  const small = await page.evaluate((sel) => {
    const out = [];
    for (const root of document.querySelectorAll(sel)) {
      for (const el of root.querySelectorAll('button, a[href], [role="tab"]')) {
        if (el.closest('.sn-sr') || el.closest('.auth-modal')) continue;
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') continue;
        if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  }, scope);
  expect(small, 'targets under 44px').toEqual([]);
}

test.describe('the door on /series', () => {
  test('open, soft, faint and closed doors; height = card under 720px, width = card at 720px+', async ({ page }) => {
    await seed(app, slug);
    await fence(page, app);
    // Last stepped inside 90 minutes ago: two of the summary's stamps are newer.
    await page.addInitScript((k) => { try { localStorage.setItem(k, String(Date.now() - 90 * 60_000)); } catch { /* */ } }, `cs_notes_seen_${slug}`);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/series');
    const open = page.locator(`[data-series-unit="${slug}"] .sn-door`);
    await expect(open).toHaveAttribute('data-door', 'open', { timeout: 90000 });
    await expect(open).toContainText('READERS’ NOTES');
    await expect(open).toContainText('INSTALMENT II');
    await expect(open.locator('[data-door-sit]')).toHaveText(/What did the river take/);
    await expect(open.locator('[data-face]')).toHaveCount(4);
    await expect(open).toContainText('2 answers');
    await expect(open.locator('[data-door-new]')).toHaveText('2 new');
    await expect(open).toContainText('Step inside');
    await expect(open).toHaveAttribute('data-light', 'bright');
    await expect(open).toHaveAttribute('data-breathes', 'true');
    await expect(open).toHaveAttribute('href', `/series/${slug}/notes?i=${encodeURIComponent(I.i2)}`);

    const soft = page.locator('[data-series-unit="notes-w46-soft"] .sn-door');
    await expect(soft).toHaveAttribute('data-light', 'soft');
    await expect(soft).toHaveAttribute('data-breathes', 'false');
    const faint = page.locator('[data-series-unit="notes-w46-faint"] .sn-door');
    await expect(faint).toHaveAttribute('data-light', 'faint');
    await expect(faint, 'no question yet: the counts, without a question').toContainText('4 notes · 3 readers');
    await expect(faint.locator('[data-door-sit]')).toHaveCount(0);
    const closed = page.locator('[data-series-unit="notes-w46-closed"] .sn-door');
    await expect(closed).toHaveAttribute('data-door', 'closed');
    await expect(closed).toContainText(/Opens (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
    await expect(closed).toContainText(/The first three questions arrive with instalment I, on \d{1,2} \w+\./);
    await expect(closed.locator('.sn-door-light')).toHaveCount(0);
    await expect(closed.locator('button')).toHaveCount(0);

    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(250);
      const units = await page.locator('.sn-unit').evaluateAll((els) => els.map((u) => {
        const c = u.querySelector('.sr-card').getBoundingClientRect();
        const d = u.querySelector('.sn-door').getBoundingClientRect();
        return { c: { w: c.width, h: c.height, x: c.x, y: c.y }, d: { w: d.width, h: d.height, x: d.x, y: d.y } };
      }));
      expect(units.length).toBe(4);
      for (const { c, d } of units) {
        if (w < 720) {
          expect(Math.abs(d.h - c.h), `door height = card height at ${w}`).toBeLessThanOrEqual(1);
          expect(d.x, 'door beside the card').toBeGreaterThan(c.x + c.w - 1);
          expect(Math.abs(c.w - (w - 32 - 14) / 2), 'the card at today’s 2-column size').toBeLessThanOrEqual(1);
        } else {
          expect(Math.abs(d.w - c.w), `door width = card width at ${w}`).toBeLessThanOrEqual(1);
          expect(d.y, 'door beneath the card').toBeGreaterThan(c.y + c.h - 1);
        }
      }
      await noHorizontalScroll(page);
      await targets(page, '.sn-door');
      await shot(page, `door-${w}`);
    }
  });
});

test.describe('the room', () => {
  test('sealed, signed out: no gated read; sign-in in a modal; Sit shown, the others under seals', async ({ page }) => {
    await seed(app, slug);
    await fence(page, app);
    const paths = recordPaths(page);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`/series/${slug}/notes?i=${I.i2}`);
      const room = page.locator('[data-room="sealed"]');
      await expect(room).toBeVisible({ timeout: 90000 });
      await expect(page.locator('[data-hero-counts]')).toHaveText('11 notes · 9 readers');
      await expect(room).toContainText('The room opens on the last page, so nothing in here can spoil it. 8 notes are waiting for you.');
      await expect(room.locator('[data-question="sit"]')).toContainText('What did the river take');
      await expect(room.locator('[data-question="side"][data-sealed="true"]')).toContainText('12 answers');
      await expect(room.locator('[data-question="line"][data-sealed="true"]')).toContainText('3 answers');
      await expect(room).not.toContainText('Was Ama right');
      await expect(page.locator('[data-strip]')).toHaveCount(w >= 1024 ? 2 : 2);
      await noHorizontalScroll(page);
      await targets(page, '.sn-room');
      await shot(page, `room-sealed-signed-out-${w}`);
    }
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.auth-modal')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(gatedOf(paths), 'a sealed room asks for no gated path').toEqual([]);
    expect(paths.length, 'the recorder saw the public reads').toBeGreaterThan(0);
  });

  test('sealed, signed in and partway: the progress rule and Continue reading; still no gated read', async ({ page }) => {
    await seed(app, slug, { reader: 'sealed' });
    await fence(page, app);
    const paths = recordPaths(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}`);
    await signIn(page, app);
    const room = page.locator('[data-room="sealed"]');
    await expect(room).toContainText('You’re partway through Instalment II.', { timeout: 90000 });
    await expect(room.locator('[data-progress]')).toHaveAttribute('data-progress', '42');
    await expect(room.getByRole('link', { name: /Continue reading Instalment II/ })).toHaveAttribute('href', `/series/read/${I.i2}`);
    await expect(page.locator(`[data-strip="${I.i2}"]`)).toContainText('Sealed');
    await shot(page, 'room-sealed-partway-390');
    await page.setViewportSize({ width: 1280, height: 900 });
    await shot(page, 'room-sealed-partway-1280');
    await page.waitForTimeout(1500);
    expect(gatedOf(paths)).toEqual([]);
  });

  test('finished, not joined: the three questions; one tap on a side opens the notes', async ({ page }) => {
    await seed(app, slug, { reader: 'finished' });
    const calls = await fence(page, app);
    await page.setViewportSize({ width: 834, height: 1000 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}`);
    await signIn(page, app);
    const room = page.locator('[data-room="joining"]');
    await expect(room).toBeVisible({ timeout: 90000 });
    await expect(room.locator('[data-question="side"]')).toContainText('Was Ama right');
    await expect(room.locator('[data-question="sit"]')).toContainText('What did the river take');
    await expect(room.locator('[data-question="line"]')).toContainText('Which line did you carry');
    await expect(room.locator('[data-question="else"]')).toHaveText('Or tell us about anything else from Instalment II that stayed with you.');
    await expect(page.locator('[data-notes]')).toHaveCount(0);
    await noHorizontalScroll(page);
    await targets(page, '.sn-room');
    for (const w of WIDTHS) { await page.setViewportSize({ width: w, height: 1000 }); await shot(page, `room-joining-${w}`); }
    await room.locator('[data-side-option="b"]').click();
    await expect(page.locator('[data-room="open"]')).toBeVisible({ timeout: 30000 });
    expect(calls.map((c) => c.action)).toEqual(['side']);
    await expect(page.locator('[data-question="side"] [data-bar][data-mine="true"]')).toContainText('Duty');
  });

  test('open: writer pinned, filters, underline, replies fold, Read more, held note, line quote', async ({ page }) => {
    await seed(app, slug, { reader: 'member' });
    await fence(page, app);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}`);
    await signIn(page, app);
    const room = page.locator('[data-room="open"]');
    await expect(room).toBeVisible({ timeout: 90000 });
    const list = page.locator('[data-notes] > article');
    await expect(list.first()).toHaveAttribute('data-note', 'h1');
    await expect(list.first()).toContainText('Waiting for a quick review');
    await expect(list.nth(1)).toHaveAttribute('data-note', 'nw');
    await expect(list.nth(1).locator('[data-writer-mark]')).toHaveText('WRITER');
    // Most underlined next: n1 (3), then n4 (2, one of them mine).
    await expect(list.nth(2)).toHaveAttribute('data-note', 'n1');
    await expect(list.nth(3)).toHaveAttribute('data-note', 'n4');
    await expect(page.locator('[data-filter="all"]')).toContainText('8');
    await expect(page.locator('[data-filter="line"]')).toContainText('3');
    // Every note shows its question above the reader.
    await expect(page.locator('[data-note="n2"] header')).toContainText('TOOK A SIDE · FREEDOM');
    await expect(page.locator('[data-note="n2"] header')).toContainText('Was Ama right');
    await expect(page.locator('[data-note="n7"] header')).toContainText('Something else from Instalment II that stayed with them');
    const n4 = page.locator('[data-note="n4"]');
    await expect(n4.locator('blockquote')).toHaveText('The river keeps what the city forgets.');
    await expect(n4.getByRole('link', { name: 'Read it in its place' })).toHaveAttribute('href', /\/series\/read\/.+\?at=epubcfi.+&v=17/);
    // W48 §3 — once underlined it reads "Underlined · n", as on the approved canvas.
    await expect(n4.locator('[data-underline]')).toHaveText('Underlined · 2');
    // Underline n1: "Underline · 3" becomes "Underlined · 4", and the emulator holds it.
    const n1 = page.locator('[data-note="n1"]');
    await expect(n1.locator('[data-underline]')).toHaveText('Underline · 3');
    await n1.locator('[data-underline]').click();
    await expect(n1.locator('[data-underline]')).toHaveText('Underlined · 4');
    await expect(n1.locator('[data-underline] span')).toHaveCSS('text-decoration-line', 'underline');
    await expect.poll(async () => (await getDatabase(app).ref(`series_note_underlines/${I.i2}/n1/${READER}`).get()).val()).toBe(true);
    await n1.locator('[data-underline]').click();
    await expect(n1.locator('[data-underline]')).toHaveText('Underline · 3');
    await n1.locator('[data-underline]').click();
    await expect(n1.locator('[data-underline]')).toHaveText('Underlined · 4');
    // Replies: oldest first, two shown, the rest folded.
    await expect(n1.locator('[data-reply]')).toHaveCount(2);
    await expect(n1).toContainText('Replying to @ben');
    await n1.getByRole('button', { name: 'View 2 more replies' }).click();
    await expect(n1.locator('[data-reply="removed"]')).toHaveText('This reply was removed.');
    // The long note folds.
    const n7 = page.locator('[data-note="n7"]');
    await expect(n7.getByRole('button', { name: 'Read more' })).toBeVisible();
    // Filters.
    await page.locator('[data-filter="side"]').click();
    await expect(list).toHaveCount(2);
    await page.locator('[data-filter="all"]').click();
    await page.getByRole('button', { name: 'Newest' }).click();
    await expect(list.nth(2)).toHaveAttribute('data-note', 'n7');
    await noHorizontalScroll(page);
    await targets(page, '.sn-room');
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(200);
      await noHorizontalScroll(page);
      await shot(page, `room-open-${w}`);
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    await expect(page.locator('.sn-rail')).toBeVisible();
    await expect(page.locator('.sn-rail')).toContainText('Fixture Instalment 2');
    await expect(page.locator('.sn-rail').getByRole('button', { name: 'Leave a note' })).toBeVisible();
    await targets(page, '.sn-room');
  });

  test('a reply posts at once; a failed one says Not sent with Try again and Remove', async ({ page }) => {
    await seed(app, slug, { reader: 'member' });
    await fence(page, app, { endpoint: { mode: 'fail' } });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}`);
    await signIn(page, app);
    const n2 = page.locator('[data-note="n2"]');
    await expect(n2).toBeVisible({ timeout: 90000 });
    await n2.getByRole('button', { name: 'Reply', exact: true }).click();
    await n2.getByRole('textbox', { name: 'Reply' }).fill('I am not sure about that.');
    await n2.getByRole('button', { name: 'Post' }).click();
    await expect(n2.locator('[data-reply="failed"]')).toContainText('Not sent.');
    await expect(n2.locator('[data-reply="failed"]').getByRole('button', { name: 'Try again' })).toBeVisible();
    await n2.locator('[data-reply="failed"]').getByRole('button', { name: 'Remove' }).click();
    await expect(n2.locator('[data-reply]')).toHaveCount(0);
  });

  test('question views: the split with tabs per side; the lines ranked', async ({ page }) => {
    await seed(app, slug, { reader: 'member' });
    await fence(page, app);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}&q=side`);
    await signIn(page, app);
    const side = page.locator('[data-room="side"]');
    await expect(side).toBeVisible({ timeout: 90000 });
    const bars = side.locator('[data-bar]');
    await expect(bars).toHaveCount(2);
    await expect(bars.nth(0).locator('.sn-sr')).toHaveText('Freedom, 62 percent, your side');
    await expect(bars.nth(1).locator('.sn-sr')).toHaveText('Duty, 38 percent');
    await expect(side.getByRole('tab', { name: 'Freedom' })).toHaveAttribute('aria-selected', 'true');
    await expect(side.locator('[role="tabpanel"] article')).toHaveCount(1);
    await side.getByRole('tab', { name: 'Duty' }).click();
    await expect(side.locator('[role="tabpanel"] [data-note="n3"]')).toBeVisible();
    await targets(page, '.sn-room');
    for (const w of WIDTHS) { await page.setViewportSize({ width: w, height: 900 }); await noHorizontalScroll(page); await shot(page, `room-q-side-${w}`); }
    await page.goto(`/series/${slug}/notes?i=${I.i2}&q=line`);
    const line = page.locator('[data-room="line"]');
    await expect(line).toBeVisible({ timeout: 90000 });
    const ranked = line.locator('li[data-line-rank]');
    await expect(ranked).toHaveCount(2);
    await expect(ranked.first()).toContainText('The river keeps what the city forgets.');
    await expect(ranked.first().locator('[data-most-chosen]')).toHaveText('Most chosen');
    await expect(ranked.first()).toContainText('2 answers');
    await expect(ranked.first().getByRole('link', { name: 'Read it in its place' })).toBeVisible();
    for (const w of WIDTHS) { await page.setViewportSize({ width: w, height: 900 }); await noHorizontalScroll(page); await shot(page, `room-q-line-${w}`); }
  });
});

test.describe('the composer', () => {
  test('a sheet on phones, a dialog on wide screens; posts at once; the margin’s line attaches', async ({ page }) => {
    await seed(app, slug, { reader: 'member' });
    const calls = await fence(page, app);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}`);
    await signIn(page, app);
    await expect(page.locator('[data-room="open"]')).toBeVisible({ timeout: 90000 });
    await page.locator('[data-composer-bar]').click();
    const sheet = page.locator('[data-composer]');
    await expect(sheet).toHaveAttribute('data-composer', 'sheet');
    await expect(sheet).toContainText('What would you like to write about?');
    await expect(sheet.locator('[data-choice]')).toHaveCount(4);
    await targets(page, '[data-composer]');
    await shot(page, 'composer-sheet-chooser-390');
    await sheet.locator('[data-choice="SIT WITH THIS"]').click();
    const field = sheet.getByRole('textbox');
    await expect(field).toHaveCSS('font-size', '20px');
    await expect(sheet).toContainText('Only readers who’ve finished Instalment II will see this.');
    await expect(sheet.locator('[data-counter]')).toHaveCount(0);
    await field.fill('x'.repeat(420));
    await expect(sheet.locator('[data-counter]')).toHaveText('420 / 500');
    await field.fill('The river took her patience.');
    await shot(page, 'composer-sheet-field-390');
    await sheet.getByRole('button', { name: 'Post' }).click();
    await expect(page.locator('[data-composer]')).toHaveCount(0);
    await expect(page.locator('[data-notes]')).toContainText('The river took her patience.');
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)).toMatchObject({ action: 'note', kind: 'sit', text: 'The river took her patience.' });

    // The line: the margin's line can be attached.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('.sn-rail').getByRole('button', { name: 'Leave a note' }).click();
    const dialog = page.locator('[data-composer]');
    await expect(dialog).toHaveAttribute('data-composer', 'dialog');
    await dialog.locator('[data-choice="THE LINE"]').click();
    await expect(dialog.getByRole('button', { name: 'Add a line from Instalment II' })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('textbox').fill('This one.');
    await shot(page, 'composer-dialog-line-1280');
    await targets(page, '[data-composer]');
    await dialog.getByRole('button', { name: 'Post' }).click();
    await expect.poll(() => calls.at(-1)?.kind).toBe('line');
    expect(calls.at(-1)).toMatchObject({ action: 'note', kind: 'line', line: { text: 'The river keeps what the city forgets.', epubVersion: '17' } });
  });

  test('a held note shows to its author, marked, and is announced politely', async ({ page }) => {
    await seed(app, slug, { reader: 'member' });
    await fence(page, app, { endpoint: { mode: 'held' } });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}`);
    await signIn(page, app);
    await expect(page.locator('[data-room="open"]')).toBeVisible({ timeout: 90000 });
    await page.locator('[data-question="else"]').click();
    await page.locator('[data-composer]').getByRole('textbox').fill('Something that may be held.');
    await page.locator('[data-composer]').getByRole('button', { name: 'Post' }).click();
    const held = page.locator('[data-notes] article', { hasText: 'Something that may be held.' });
    await expect(held).toContainText('Waiting for a quick review');
    await expect(page.locator('[data-notes-announce]')).toHaveText('Waiting for a quick review');
  });

  test('a failed post shows Not sent with Try again and Remove', async ({ page }) => {
    await seed(app, slug, { reader: 'member' });
    await fence(page, app, { endpoint: { mode: 'fail' } });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}`);
    await signIn(page, app);
    await expect(page.locator('[data-room="open"]')).toBeVisible({ timeout: 90000 });
    await page.locator('[data-question="else"]').click();
    await page.locator('[data-composer]').getByRole('textbox').fill('This will not send.');
    await page.locator('[data-composer]').getByRole('button', { name: 'Post' }).click();
    const failed = page.locator('[data-notes] article[data-local="failed"]');
    await expect(failed).toContainText('Not sent.');
    await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible();
    await failed.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('[data-notes] article[data-local]')).toHaveCount(0);
  });
});

// ── W48 ────────────────────────────────────────────────────────────────────────────────────

/**
 * Every author line inside `scope`: the badge sits on the name's line when name + badge fit the
 * line's width, and wraps beneath the name when they don't; nothing pokes past its card.
 */
async function authorLines(page, scope, w) {
  const bad = await page.evaluate((sel) => {
    const out = [];
    for (const who of document.querySelectorAll(`${sel} [data-author]`)) {
      const line = who.lastElementChild;
      const name = line.firstElementChild.getBoundingClientRect();
      const mark = line.querySelector('[data-badge], [data-writer-mark]');
      const card = who.closest('.sn-card').getBoundingClientRect();
      const box = line.getBoundingClientRect();
      // The room clips horizontal overflow (overflow-x: clip), so scrollWidth alone cannot see a
      // card wider than the screen. Measure the card against the viewport too.
      if (card.right > document.documentElement.clientWidth + 0.5) out.push(`${who.dataset.author}: card ${Math.round(card.width)}px overflows the ${document.documentElement.clientWidth}px viewport`);
      if (box.right > card.right + 0.5) out.push(`${who.dataset.author}: line overflows its card`);
      if (!mark) continue;
      const m = mark.getBoundingClientRect();
      if (m.right > card.right + 0.5) out.push(`${who.dataset.author}: badge overflows its card`);
      const fits = name.width + 8 + m.width <= box.width + 0.5;
      const same = Math.abs((m.top + m.bottom) / 2 - (name.top + name.bottom) / 2) < name.height / 2;
      if (fits && !same) out.push(`${who.dataset.author}: fits but wrapped`);
      if (!fits && m.top < name.bottom - 2) out.push(`${who.dataset.author}: does not fit yet overlaps the name`);
    }
    return out;
  }, scope);
  expect(bad, `author lines at ${w}px`).toEqual([]);
}

test.describe('W48 · the badge follows the reader', () => {
  // The Square draws <UserBadge readCount={identity.readCount} isAuthor={identity.isAuthor} />
  // from the LIVE record (squareIdentity). The fixture's stored snapshots all claim 1000 reads, so
  // each expectation below is reachable only from the live record — what the Square shows.
  const TITLE = { reader: 'Reader', island: 'Island Reader', legend: 'Legend of the Island', immortal: 'Immortal of the Island', writer: 'Writer' };
  const expectBadge = async (who, tier) => {
    await expect(who.locator('[data-badge]')).toHaveAttribute('data-badge', tier);
    await expect(who.locator('[data-badge]')).toHaveText(TITLE[tier]);
    await expect(who.locator('[data-writer-mark]')).toHaveCount(0);
  };

  test('a note, a reply, Why they chose and the line view draw the Square’s badge; the series’ writer keeps WRITER', async ({ page }) => {
    await seed(app, slug, { reader: 'member' });
    await fence(page, app);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}`);
    await signIn(page, app);
    await expect(page.locator('[data-room="open"]')).toBeVisible({ timeout: 90000 });
    // A note.
    await expectBadge(page.locator('[data-note="n1"] > [data-author]'), 'reader');
    await expectBadge(page.locator('[data-note="h1"] > [data-author]'), 'immortal');
    // A writer who is not this series' writer: the Square's Writer badge, and the writer's ring.
    await expectBadge(page.locator('[data-note="n5"] > [data-author]'), 'writer');
    // The series' own writer: the WRITER mark in place of the badge (ruling 163).
    const nw = page.locator('[data-note="nw"] > [data-author]');
    await expect(nw.locator('[data-writer-mark]')).toHaveText('WRITER');
    await expect(nw.locator('[data-badge]')).toHaveCount(0);
    // A reply.
    const n1 = page.locator('[data-note="n1"]');
    await expectBadge(n1.locator('[data-reply]').first().locator('[data-author]'), 'island');
    await expectBadge(n1.locator('[data-reply]').nth(1).locator('[data-author]'), 'legend');
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.waitForTimeout(250);
      await noHorizontalScroll(page);
      await authorLines(page, '[data-notes]', w);
      await shot(page, `w48-badges-open-${w}`);
    }

    // Take a side's "Why they chose".
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}&q=side`);
    const side = page.locator('[data-room="side"]');
    await expect(side).toBeVisible({ timeout: 90000 });
    await expectBadge(side.locator('[data-note="n2"] > [data-author]'), 'island');
    await side.getByRole('tab', { name: 'Duty' }).click();
    await expectBadge(side.locator('[data-note="n3"] > [data-author]'), 'legend');
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(200);
      await noHorizontalScroll(page);
      await authorLines(page, '[data-room="side"]', w);
      await shot(page, `w48-badges-side-${w}`);
    }

    // The line's view: the readers who chose each line.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}&q=line`);
    const line = page.locator('[data-room="line"]');
    await expect(line).toBeVisible({ timeout: 90000 });
    const first = line.locator('li[data-line-rank]').first().locator('[data-line-readers] [data-author]');
    await expect(first).toHaveCount(2);
    await expectBadge(line.locator('[data-author="w46-ui-ada"]'), 'reader');
    await expectBadge(line.locator('[data-author="w46-ui-dee"]'), 'writer');
    await expectBadge(line.locator('[data-author="w46-ui-ben"]'), 'island');
    await targets(page, '.sn-room');
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(200);
      await noHorizontalScroll(page);
      await authorLines(page, '[data-room="line"]', w);
      await shot(page, `w48-badges-line-${w}`);
    }
  });
});

test.describe('W48 · The line with an empty margin (ruling 175)', () => {
  const LINE = { text: 'The river keeps what the city forgets.', cfi: 'epubcfi(/6/4!/4/2/1:0)', epubVersion: '17' };

  test('guidance, the way to the book, Post dimmed; back with a line it posts the line and the draft', async ({ page }) => {
    await seed(app, slug, { reader: 'member' });
    const db = getDatabase(app);
    await db.ref(`series_margin/${READER}/${I.i2}`).set(null);
    const calls = await fence(page, app);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}`);
    await signIn(page, app);
    await expect(page.locator('[data-room="open"]')).toBeVisible({ timeout: 90000 });
    await page.locator('[data-composer-bar]').click();
    const sheet = page.locator('[data-composer]');
    await sheet.locator('[data-choice="THE LINE"]').click();
    const first = sheet.locator('[data-line-first]');
    await expect(first).toHaveText('Choose your line in the book first: press on it and tap “This is my line”.');
    const field = sheet.getByRole('textbox');
    const guide = await first.boundingBox();
    const fieldBox = await field.boundingBox();
    expect(guide.y + guide.height, 'the guidance sits above the field').toBeLessThanOrEqual(fieldBox.y + 1);
    const go = sheet.getByRole('link', { name: 'Choose it in the book' });
    await expect(go).toHaveAttribute('href', `/series/read/${encodeURIComponent(I.i2)}?from=notes`);
    expect((await go.boundingBox()).y, 'the button sits beneath the field').toBeGreaterThan(fieldBox.y + fieldBox.height);
    await expect(sheet.getByRole('button', { name: /Add a line from/ })).toHaveCount(0);
    await field.fill('I carried the ferry one.');
    const post = sheet.getByRole('button', { name: 'Post' });
    await expect(post, 'no line, no Post').toBeDisabled();
    await expect(post).toHaveCSS('opacity', '0.5');
    await targets(page, '[data-composer]');
    for (const w of WIDTHS) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(200); await noHorizontalScroll(page); await shot(page, `w48-line-first-${w}`); }
    await post.click({ force: true });
    expect(calls.filter((c) => c.action === 'note'), 'nothing was sent').toEqual([]);

    // "Choose it in the book" → "This is my line" saves the margin (the reader suite proves that
    // half) → "Back to your note" lands on ?compose=line. Stand in for the book's write here.
    await page.keyboard.press('Escape');
    await db.ref(`series_margin/${READER}/${I.i2}`).set({ ...LINE, savedAt: Date.now() });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/series/${slug}/notes?i=${I.i2}&compose=line`);
    const back = page.locator('[data-composer] [data-field-kind="line"]');
    await expect(back, 'The line’s composer opens by itself').toBeVisible({ timeout: 90000 });
    await expect(back.getByRole('button', { name: 'Add a line from Instalment II' })).toHaveAttribute('aria-pressed', 'true');
    await expect(back.locator('blockquote')).toHaveText(LINE.text);
    await expect(back.getByRole('textbox'), 'the draft is kept').toHaveValue('I carried the ferry one.');
    await expect(back.locator('[data-line-first]')).toHaveCount(0);
    await expect(back.locator('[data-choose-in-book]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.location.search), 'the parameter is dropped').not.toContain('compose');
    await shot(page, 'w48-line-back-390');
    await back.getByRole('button', { name: 'Post' }).click();
    await expect.poll(() => calls.filter((c) => c.action === 'note').length).toBe(1);
    expect(calls.at(-1)).toMatchObject({ action: 'note', kind: 'line', text: 'I carried the ferry one.', line: LINE });
    // A reload does not reopen it.
    await page.reload();
    await expect(page.locator('[data-room="open"]')).toBeVisible({ timeout: 90000 });
    await page.waitForTimeout(1000);
    await expect(page.locator('[data-composer]')).toHaveCount(0);
  });
});

test.describe('the last-page sheet', () => {
  test('before choosing, after choosing, and opening on its results once answered', async ({ page }) => {
    await seed(app, slug, { reader: 'finished' });
    const calls = await fence(page, app);
    for (const w of [390, 1280]) {
      await seed(app, slug, { reader: 'finished' });
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(`/series/${slug}/notes?i=${I.i2}&endsheet=1`);
      if (w === 390) await signIn(page, app);
      const sheet = page.locator('[data-end-sheet]');
      await expect(sheet).toHaveAttribute('data-end-sheet', 'choose', { timeout: 90000 });
      await expect(sheet).toContainText('END OF INSTALMENT II');
      await expect(sheet).toContainText('❦');
      await expect(sheet).toContainText('TAKE A SIDE · 1 OF 3');
      await expect(sheet).toContainText('Choose, and see how 12 readers split.');
      await targets(page, '[data-end-sheet]');
      await shot(page, `endsheet-before-${w}`);
      await sheet.locator('[data-side-option="a"]').click();
      await expect(sheet).toHaveAttribute('data-end-sheet', 'result');
      await expect(sheet.locator('[data-bar][data-mine="true"] .sn-sr')).toHaveText('Freedom, 62 percent, your side');
      await expect(sheet.locator('[data-youre-with] .sn-sr')).toHaveText('You’re with 62% of 13 readers.');
      await expect(sheet.getByRole('button', { name: 'Say why you chose Freedom' })).toBeVisible();
      await expect(sheet.getByRole('link', { name: 'Step inside: two more questions, 8 notes' })).toHaveAttribute('href', `/series/${slug}/notes?i=${encodeURIComponent(I.i2)}`);
      await expect(sheet.getByRole('button', { name: 'Choose again' })).toBeVisible();
      await page.waitForTimeout(800);
      await targets(page, '[data-end-sheet]');
      await shot(page, `endsheet-after-${w}`);
    }
    expect(calls.filter((c) => c.action === 'side')).toHaveLength(2);
    // Answered: it opens on its results; "Say why" opens the composer on Take a side.
    await page.reload();
    const sheet = page.locator('[data-end-sheet]');
    await expect(sheet).toHaveAttribute('data-end-sheet', 'result', { timeout: 90000 });
    await sheet.getByRole('button', { name: 'Say why you chose Freedom' }).click();
    await expect(page.locator('[data-composer] [data-field-kind="side"]')).toContainText('TOOK A SIDE · FREEDOM');
    await page.keyboard.press('Escape');
    await sheet.getByRole('button', { name: 'Not now' }).last().click();
    await expect(page.locator('[data-end-sheet]')).toHaveCount(0);
  });
});

test.describe('motion', () => {
  test('reduced motion turns off the sheet’s rise, the bars’ fill and the door’s breath', async ({ browser }) => {
    await seed(app, slug, { reader: 'finished' });
    for (const reduce of ['no-preference', 'reduce']) {
      const ctx = await browser.newContext({ reducedMotion: reduce, serviceWorkers: 'block', viewport: { width: 390, height: 900 } });
      const page = await ctx.newPage();
      await fence(page, app);
      await page.goto('/series');
      const door = page.locator(`[data-series-unit="${slug}"] .sn-door-light`);
      await expect(door).toHaveCount(1, { timeout: 90000 });
      const breath = await door.evaluate((el) => getComputedStyle(el).animationName);
      await page.goto(`/series/${slug}/notes?i=${I.i2}&endsheet=1`);
      await signIn(page, app);
      const panel = page.locator('[data-end-sheet] section');
      await expect(panel).toBeVisible({ timeout: 90000 });
      const rise = await panel.evaluate((el) => getComputedStyle(el).animationName);
      if (reduce === 'reduce') {
        expect(breath).toBe('none');
        expect(rise).toBe('none');
      } else {
        expect(breath).toBe('sn-breathe');
        expect(rise).toBe('sn-rise');
      }
      await ctx.close();
    }
  });
});
