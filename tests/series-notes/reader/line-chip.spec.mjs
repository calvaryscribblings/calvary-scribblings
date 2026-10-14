// W46 §5 — "THIS IS MY LINE", at the reading-room FRAME (public/reading-room.html).
//
//   npm run test:series-notes:reader      (this file runs in Chromium AND WebKit)
//
// The frame's line chip is OPT-IN: it does nothing until the parent posts
// {type:'setLineChip', enabled:true, maxChars}. So the first block proves the OFF state is the
// pre-W46 frame (no chip on a phrase, Define alone on a word), and the rest prove the ON state:
// which selections are offered the chip, that it sits beside Define when both apply, that it is
// a 44px target inside the viewport, and that a tap posts {type:'lineChosen', text, cfi} with a
// CFI that resolves back to the very words selected.
//
// Selections are made programmatically, as tests/reader/define-chip.spec.mjs explains: the
// long-press is the platform's, everything downstream of the selection is ours.
import { test, expect } from '@playwright/test';
import { openReader, settle, msgs, clearMsgs, roomFrame, post } from '../../reader/helpers.mjs';

const SETTLED = 500;
const LINE_ON = { type: 'setLineChip', enabled: true, maxChars: 400, label: 'This is my line' };

/** One word in the first paragraph, after its first full stop. */
async function selectWord(page) {
  return roomFrame(page).evaluate(() => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const p = doc.querySelector('p');
    const node = [...p.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim().length > 40);
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

/** Several words (the first `len` characters after the first full stop of the first paragraph). */
async function selectPhrase(page, len = 40) {
  return roomFrame(page).evaluate((n) => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const p = doc.querySelector('p');
    const node = [...p.childNodes].find((x) => x.nodeType === 3 && x.nodeValue.trim().length > n + 10);
    const start = node.nodeValue.indexOf('.') + 2;
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, Math.min(node.nodeValue.length, start + n));
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return String(sel);
  }, len);
}

/** The first two words after the first full stop: the glossary-phrase case. */
async function selectTwoWords(page) {
  return roomFrame(page).evaluate(() => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const p = doc.querySelector('p');
    const node = [...p.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim().length > 40);
    const m = /\. ([a-z]+ [a-z]+)/.exec(node.nodeValue);
    const range = doc.createRange();
    range.setStart(node, m.index + 2);
    range.setEnd(node, m.index + 2 + m[1].length);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return m[1];
  });
}

async function chips(page) {
  return roomFrame(page).evaluate(() => {
    const box = (id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      return { shown: el.classList.contains('show'), left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, text: (el.textContent || '').trim() };
    };
    return { define: box('define-chip'), line: box('line-chip'), vw: window.innerWidth, vh: window.innerHeight };
  });
}

async function selectionLive(page) {
  return roomFrame(page).evaluate(() => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const s = doc.getSelection();
    return !!s && !s.isCollapsed && String(s).trim().length > 0;
  });
}

// ── OFF: the frame as it was before W46 ──────────────────────────────────────────────────
test('off by default: a phrase gets no chip at all, and a word gets Define alone', async ({ page }) => {
  await openReader(page);
  await clearMsgs(page);
  await selectPhrase(page);
  await page.waitForTimeout(SETTLED);
  let c = await chips(page);
  expect(c.line.shown, 'no setLineChip, no line chip').toBe(false);
  expect(c.define.shown).toBe(false);

  await selectWord(page);
  await page.waitForTimeout(SETTLED);
  c = await chips(page);
  expect(c.define.shown).toBe(true);
  expect(c.line.shown).toBe(false);
  expect(await msgs(page, 'lineChosen')).toHaveLength(0);
});

test('a disabled setLineChip keeps it off, and switching it off again hides it', async ({ page }) => {
  await openReader(page);
  await post(page, { type: 'setLineChip', enabled: false, maxChars: 400 });
  await selectPhrase(page);
  await page.waitForTimeout(SETTLED);
  expect((await chips(page)).line.shown).toBe(false);

  await post(page, LINE_ON);
  await selectPhrase(page, 44);
  await page.waitForTimeout(SETTLED);
  expect((await chips(page)).line.shown).toBe(true);
  await post(page, { type: 'setLineChip', enabled: false });
  await settle(page, 150);
  expect((await chips(page)).line.shown, 'switched off, it goes at once').toBe(false);
});

// ── ON ───────────────────────────────────────────────────────────────────────────────────
test('on: a phrase gets "This is my line" alone, a 44px target inside the viewport', async ({ page }) => {
  await openReader(page);
  await post(page, LINE_ON);
  await clearMsgs(page);
  await selectPhrase(page);
  await page.waitForTimeout(SETTLED);
  const c = await chips(page);
  console.log(`\n=== line chip ===\n${JSON.stringify(c.line)}\n`);
  expect(c.line.shown).toBe(true);
  expect(c.define.shown, 'a phrase that is not a glossary phrase is not Define\'s').toBe(false);
  expect(c.line.text).toContain('This is my line');
  expect(c.line.height).toBeGreaterThanOrEqual(44);
  expect(c.line.left).toBeGreaterThanOrEqual(8);
  expect(c.line.top).toBeGreaterThanOrEqual(8);
  expect(c.line.right).toBeLessThanOrEqual(c.vw - 8 + 0.5);
  expect(c.line.bottom).toBeLessThanOrEqual(c.vh - 8 + 0.5);
  expect(await msgs(page, 'wordSelected'), 'nothing was offered Define, so nothing reports a word').toHaveLength(0);
});

test('on: a single word still gets Define only', async ({ page }) => {
  await openReader(page);
  await post(page, LINE_ON);
  await selectWord(page);
  await page.waitForTimeout(SETTLED);
  const c = await chips(page);
  expect(c.define.shown).toBe(true);
  expect(c.line.shown).toBe(false);
});

test('on: a glossary phrase gets BOTH, side by side, neither overlapping nor off the glass', async ({ page }) => {
  await openReader(page);
  const phrase = await roomFrame(page).evaluate(() => {
    const p = document.querySelector('foliate-view').renderer.getContents()[0].doc.querySelector('p');
    return /\. ([a-z]+ [a-z]+)/.exec(p.textContent)[1];
  });
  await post(page, { type: 'setPhrases', phrases: [phrase] });
  await post(page, LINE_ON);
  await selectTwoWords(page);
  await page.waitForTimeout(SETTLED);
  const c = await chips(page);
  console.log(`\n=== both ===\ndefine ${JSON.stringify(c.define)}\nline   ${JSON.stringify(c.line)}\n`);
  expect(c.define.shown).toBe(true);
  expect(c.line.shown).toBe(true);
  expect(Math.round(c.define.top), 'one row').toBe(Math.round(c.line.top));
  expect(c.line.left, 'the line chip sits to the right of Define, with daylight').toBeGreaterThanOrEqual(c.define.right + 4);
  for (const b of [c.define, c.line]) {
    expect(b.left).toBeGreaterThanOrEqual(8);
    expect(b.right).toBeLessThanOrEqual(c.vw - 8 + 0.5);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
});

test('on: longer than maxChars is not a line', async ({ page }) => {
  await openReader(page);
  await post(page, { ...LINE_ON, maxChars: 20 });
  await selectPhrase(page, 40);
  await page.waitForTimeout(SETTLED);
  expect((await chips(page)).line.shown).toBe(false);
});

test('on: the tap posts ONE lineChosen whose CFI resolves to the words selected; no turn, no chrome', async ({ page }) => {
  await openReader(page);
  await post(page, LINE_ON);
  const selected = await selectPhrase(page);
  await page.waitForTimeout(SETTLED);
  await clearMsgs(page);
  const startBefore = await roomFrame(page).evaluate(() => document.querySelector('foliate-view').renderer.start);
  const c = await chips(page);
  const frameBox = await page.locator('iframe').boundingBox();
  await page.touchscreen.tap(frameBox.x + c.line.left + c.line.width / 2, frameBox.y + c.line.top + c.line.height / 2);
  await settle(page, 600);

  const chosen = await msgs(page, 'lineChosen');
  console.log(`\n=== lineChosen ===\n${JSON.stringify(chosen)}\n`);
  expect(chosen, 'exactly one per tap').toHaveLength(1);
  expect(chosen[0].text).toBe(selected.replace(/\s+/g, ' ').trim());
  expect(chosen[0].cfi).toMatch(/^epubcfi\(.+\)$/);

  const resolved = await roomFrame(page).evaluate((cfi) => {
    const view = document.querySelector('foliate-view');
    const { index, anchor } = view.resolveCFI(cfi);
    const c = view.renderer.getContents().find((x) => x.index === index);
    return c ? anchor(c.doc).toString() : null;
  }, chosen[0].cfi);
  expect(resolved, 'the CFI is the RANGE, not the page').toBe(selected);

  expect(await msgs(page, 'toggleChrome')).toHaveLength(0);
  expect(await msgs(page, 'defineWord')).toHaveLength(0);
  const startAfter = await roomFrame(page).evaluate(() => document.querySelector('foliate-view').renderer.start);
  expect(startAfter, 'the page did not turn').toBe(startBefore);
  expect((await chips(page)).line.shown, 'the chip retires').toBe(false);
  expect(await selectionLive(page), 'and lets the selection go, so the platform menu goes too').toBe(false);
});

test('on, iOS: the line chip takes Define\'s placement, BELOW the selection', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'iPhone', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5, configurable: true });
  });
  await openReader(page);
  await post(page, LINE_ON);
  await selectPhrase(page);
  await page.waitForTimeout(SETTLED);
  const rect = await roomFrame(page).evaluate(() => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const r = doc.getSelection().getRangeAt(0).getBoundingClientRect();
    const f = doc.defaultView.frameElement.getBoundingClientRect();
    return { top: r.top + f.top, bottom: r.bottom + f.top };
  });
  const c = await chips(page);
  expect(c.line.shown).toBe(true);
  // Below the selection's grab-dots (IOS_HANDLE_CLEARANCE), unless the shared clamp intervened.
  expect(c.line.top).toBeGreaterThanOrEqual(Math.min(rect.bottom + 18, c.vh - c.line.height - 8) - 1);
});
