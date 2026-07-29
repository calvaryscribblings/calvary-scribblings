// REPRODUCTION TEST for glass bug (b): "ribbon jump from Contents does nothing".
//
// The full path, one hop at a time:
//   requestBookmark → host → bookmarkCFI {cfi, fraction, excerpt}
//   → (stored) → goTo{cfi} → host → view.goTo → relocate
// Each hop is asserted on its own, so a failure names the hop that died.
import { test, expect } from '@playwright/test';
import { openReader, settle, msgs, clearMsgs, post, gotoPage, currentFraction, roomFrame } from './helpers.mjs';

test('hop 1: requestBookmark returns a cfi, a fraction and a non-empty excerpt', async ({ page }) => {
  await openReader(page);
  const at = await gotoPage(page, 5);
  await clearMsgs(page);

  await post(page, { type: 'requestBookmark' });
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'bookmarkCFI'));
  const [bm] = await msgs(page, 'bookmarkCFI');

  console.log('\n=== bookmarkCFI ===\n' + JSON.stringify(bm, null, 2) + '\n');

  expect(typeof bm.cfi, 'cfi must be a string').toBe('string');
  expect(bm.cfi.length, 'cfi must not be empty').toBeGreaterThan(0);
  expect(typeof bm.fraction, 'fraction must be a number').toBe('number');
  expect(Math.abs(bm.fraction - at), 'fraction must be where we are').toBeLessThan(1e-6);
  expect(typeof bm.excerpt, 'excerpt must be a string').toBe('string');
  expect(bm.excerpt.trim().length, 'excerpt must not be empty').toBeGreaterThan(0);
  // The fixture names its own paragraphs, so the excerpt must be recognisable prose.
  expect(bm.excerpt).toMatch(/\w/);
});

test('hop 2: the host can resolve the cfi it just handed out', async ({ page }) => {
  // Isolates resolution from messaging: call view.goTo directly, inside the host.
  await openReader(page);
  await gotoPage(page, 5);
  await clearMsgs(page);
  await post(page, { type: 'requestBookmark' });
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'bookmarkCFI'));
  const [bm] = await msgs(page, 'bookmarkCFI');

  const resolution = await roomFrame(page).evaluate(async (cfi) => {
    const view = document.querySelector('foliate-view');
    try {
      const resolved = view.resolveNavigation ? view.resolveNavigation(cfi) : '(no resolveNavigation)';
      return { ok: true, resolved: JSON.stringify(resolved, (k, v) => (typeof v === 'function' ? '[fn]' : v)) };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }, bm.cfi);

  console.log('\n=== resolveNavigation ===\n' + JSON.stringify(resolution, null, 2) + '\n');
  expect(resolution.ok, `the cfi must resolve: ${resolution.error || ''}`).toBe(true);
});

test('hop 3: goTo(cfi) from the parent lands back on the bookmarked page', async ({ page }) => {
  await openReader(page);
  const at = await gotoPage(page, 5);
  await clearMsgs(page);
  await post(page, { type: 'requestBookmark' });
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'bookmarkCFI'));
  const [bm] = await msgs(page, 'bookmarkCFI');

  // Walk well away — several pages, into another chapter if possible.
  for (let i = 0; i < 6; i++) { await post(page, { type: 'next' }); await settle(page, 220); }
  const away = await currentFraction(page);
  expect(Math.abs(away - at), 'the test must actually have moved away').toBeGreaterThan(0.01);

  await clearMsgs(page);
  await post(page, { type: 'goTo', cfi: bm.cfi });
  await settle(page, 800);

  const back = await currentFraction(page);
  const relocates = await msgs(page, 'relocate');

  console.log(`\n=== jump ===\nbookmarked at ${at}\nwalked to     ${away}\njumped to     ${back}`
    + `\nrelocates after goTo: ${relocates.length}\n`);

  expect(relocates.length, 'goTo must produce at least one relocate').toBeGreaterThan(0);
  expect(back, 'goTo must land back on the bookmarked page').not.toBeNull();
  expect(Math.abs(back - at), 'landing must be within one page of the bookmark').toBeLessThan(0.02);
});

test('hop 3 (legacy): an R4a-shape record — cfi only, no fraction — still jumps', async ({ page }) => {
  // R4a stored { cfi, label, createdAt } from the same lastCFI source, so the cfi STRING is
  // identical in shape. This test proves the jump depends on nothing R7.2 added.
  await openReader(page);
  const at = await gotoPage(page, 4);
  await clearMsgs(page);
  await post(page, { type: 'requestBookmark' });
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'bookmarkCFI'));
  const [bm] = await msgs(page, 'bookmarkCFI');

  const legacyRecord = { cfi: bm.cfi, label: 'Chapter', createdAt: 1700000000000 };

  for (let i = 0; i < 5; i++) { await post(page, { type: 'next' }); await settle(page, 220); }
  await clearMsgs(page);
  await post(page, { type: 'goTo', cfi: legacyRecord.cfi });
  await settle(page, 800);

  const back = await currentFraction(page);
  expect(back, 'a legacy record must still jump').not.toBeNull();
  expect(Math.abs(back - at)).toBeLessThan(0.02);
});

test('goTo a TOC href (the other thing jumpTo sends) also lands', async ({ page }) => {
  // ContentsPanel routes chapter hrefs through the SAME message as ribbons, so a break in
  // goTo would take the table of contents with it.
  await openReader(page);
  await settle(page);
  const [ready] = await msgs(page, 'ready');
  expect(ready.toc.length, 'the fixture must expose a TOC').toBeGreaterThan(2);

  const target = ready.toc[3];
  await clearMsgs(page);
  await post(page, { type: 'goTo', cfi: target.href });
  await settle(page, 800);

  const relocates = await msgs(page, 'relocate');
  expect(relocates.length, `goTo('${target.href}') must relocate`).toBeGreaterThan(0);
});

// ── The parent's ACTUAL sequence ─────────────────────────────────────────────
// ReadingRoom.jumpTo does two things in one tick: post goTo, then closePanel — which
// itself posts clearSearch. These replay that pair, and the two states a real ribbon is
// most likely to be jumped from: after the reader has re-typeset the book (which
// re-paginates), and after a flow switch. If the jump dies anywhere reachable from the
// parent, it dies here.
test('parent sequence: goTo immediately followed by clearSearch still lands', async ({ page }) => {
  await openReader(page);
  const at = await gotoPage(page, 5);
  await clearMsgs(page);
  await post(page, { type: 'requestBookmark' });
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'bookmarkCFI'));
  const [bm] = await msgs(page, 'bookmarkCFI');

  for (let i = 0; i < 5; i++) { await post(page, { type: 'next' }); await settle(page, 220); }
  await clearMsgs(page);

  // Exactly what jumpTo + closePanel put on the wire, in the same order, same tick.
  await page.evaluate((cfi) => {
    window.__post({ type: 'goTo', cfi });
    window.__post({ type: 'clearSearch' });
  }, bm.cfi);
  await settle(page, 900);

  const back = await currentFraction(page);
  console.log(`\n=== goTo + clearSearch ===\nbookmarked ${at} → landed ${back}\n`);
  expect(Math.abs(back - at), 'clearSearch must not cancel the navigation').toBeLessThan(0.02);
});

test('a ribbon dropped before a re-typeset still jumps after it', async ({ page }) => {
  // The realistic failure: pagination changes under a stored CFI. A CFI is supposed to be
  // pagination-independent; this proves it for our own setStyles path.
  await openReader(page);
  const at = await gotoPage(page, 5);
  await clearMsgs(page);
  await post(page, { type: 'requestBookmark' });
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'bookmarkCFI'));
  const [bm] = await msgs(page, 'bookmarkCFI');

  // The reader opens the Typesetter and goes bigger — foliate re-paginates.
  await post(page, {
    type: 'applyStyles', bg: '#f2ecd9', fg: '#2b2418',
    face: 'literata', sizePct: 140, leading: 1.9, justify: true,
  });
  await settle(page, 1200);
  for (let i = 0; i < 3; i++) { await post(page, { type: 'next' }); await settle(page, 220); }

  await clearMsgs(page);
  await post(page, { type: 'goTo', cfi: bm.cfi });
  await settle(page, 1000);

  const relocates = await msgs(page, 'relocate');
  const back = await currentFraction(page);
  console.log(`\n=== jump after re-typeset ===\nbookmarked at ${at} (100%) → landed ${back} (140%)`
    + `\nrelocates: ${relocates.length}\n`);

  expect(relocates.length, 'the jump must relocate even after re-pagination').toBeGreaterThan(0);
  // The fraction legitimately shifts when the book re-paginates; what must hold is that we
  // are near the same place in the text, not at an unrelated one.
  expect(Math.abs(back - at), 'must land near the bookmarked passage').toBeLessThan(0.06);
});

test('goTo with no cfi is a silent no-op — the shape a missing record would take', async ({ page }) => {
  // Documents the one way the host can swallow a jump: `if (!d.cfi) break`. A stored record
  // without a cfi produces exactly this, and exactly the glass symptom "does nothing".
  await openReader(page);
  await gotoPage(page, 4);
  const before = await currentFraction(page);
  await clearMsgs(page);

  await post(page, { type: 'goTo', cfi: undefined });
  await post(page, { type: 'goTo', cfi: '' });
  await post(page, { type: 'goTo' });
  await settle(page, 600);

  const after = await currentFraction(page);
  expect(after ?? before, 'an empty cfi must not move the reader').toBe(before);
});
