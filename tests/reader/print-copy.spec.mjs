// W24 — PRINTING AND COPYING, at the reader FRAME (ruling 93). Runs in Chromium and WebKit from
// playwright.print-copy.config.mjs (and in Chromium with the rest of the harness suite).
//
// PRINT is proven by emulating print media and reading what would be laid out: the frame's own
// content is hidden and its one line is shown; a section document printed on its own shows nothing.
// COPY is proven by dispatching a copy event at the section document, carrying a real DataTransfer,
// over a real selection in a real EPUB — the event a keyboard copy or a context-menu Copy fires.
// What the handler put on the clipboard is read back from that DataTransfer. The OS clipboard is
// not read: that is the browser's half, and it differs by engine and by permission, not by us.
//
// The reader PAGE's print line is proven over the built app, in app.spec.mjs ("W24 print").
import { test, expect } from '@playwright/test';
import { openReader, roomFrame, post, settle } from './helpers.mjs';
import { PRINT_LINE, COPY_MAX_WORDS, copyText, creditLine } from '../../app/lib/readerCopy.js';

const CREDIT = creditLine({ title: 'The Harness Book', author: 'A. Fixture' });

/** Select `words` consecutive words of prose (whole text nodes, across paragraphs if need be). */
async function selectWords(page, words) {
  return roomFrame(page).evaluate((n) => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const ps = [...doc.querySelectorAll('p')];
    const first = ps[0].firstChild;
    const range = doc.createRange();
    range.setStart(first, 0);
    // Walk paragraphs until n words are covered, and end the range after the n-th.
    let seen = 0;
    for (const p of ps) {
      const node = p.firstChild;
      const re = /\S+/g;
      let m;
      while ((m = re.exec(node.nodeValue))) {
        if (++seen === n) {
          range.setEnd(node, m.index + m[0].length);
          const sel = doc.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return String(sel);
        }
      }
    }
    throw new Error(`the section has fewer than ${n} words`);
  }, words);
}

/** Fire a copy at the section document; return what reached the DataTransfer, and whether it was taken over. */
async function copyFromSection(page, type = 'copy') {
  return roomFrame(page).evaluate((t) => {
    const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
    const dt = new DataTransfer();
    const ev = new ClipboardEvent(t, { clipboardData: dt, bubbles: true, cancelable: true });
    doc.body.dispatchEvent(ev);
    return { text: ev.clipboardData.getData('text/plain'), prevented: ev.defaultPrevented, stillSelected: String(doc.getSelection()).length > 0 };
  }, type);
}

test.describe('W24 copy', () => {
  test.beforeEach(async ({ page }) => {
    await openReader(page);
    await post(page, { type: 'setCopyRule', credit: CREDIT, maxWords: COPY_MAX_WORDS });
    await settle(page, 150);
  });

  test('a copy of fifty words or fewer passes whole, with the credit on its own line', async ({ page }) => {
    const selected = await selectWords(page, 12);
    const out = await copyFromSection(page);
    console.log(`\n=== copy, 12 words ===\n${out.text}\n`);
    expect(out.prevented).toBe(true);
    expect(out.text).toBe(`${selected.trim()}\n${CREDIT}`);
    expect(out.text.split('\n').at(-1)).toBe('— from The Harness Book by A. Fixture · Calvary Scribblings');
    expect(out.stillSelected, 'copying leaves the selection as it was').toBe(true);
  });

  test('exactly fifty words pass whole', async ({ page }) => {
    const selected = await selectWords(page, COPY_MAX_WORDS);
    const out = await copyFromSection(page);
    expect(out.text).toBe(`${selected.trim()}\n${CREDIT}`);
  });

  test('a longer selection copies its first fifty words, then the credit', async ({ page }) => {
    const selected = await selectWords(page, 90);
    const out = await copyFromSection(page);
    const [body, credit] = [out.text.slice(0, out.text.lastIndexOf('\n')), out.text.slice(out.text.lastIndexOf('\n') + 1)];
    console.log(`\n=== copy, 90 words selected ===\n${body.split(/\s+/).length} words copied\n${credit}\n`);
    expect(body.split(/\s+/)).toHaveLength(COPY_MAX_WORDS);
    expect(credit).toBe(CREDIT);
    expect(out.text).toBe(copyText(selected, CREDIT));
    expect(selected.trim().startsWith(body), 'the first fifty, in order, as selected').toBe(true);
  });

  test('a cut is held to the same rule (the book cannot be edited, but the event can fire)', async ({ page }) => {
    await selectWords(page, 90);
    const out = await copyFromSection(page, 'cut');
    expect(out.text.split('\n').at(-1)).toBe(CREDIT);
  });

  test('selecting is untouched: a single word still offers Define', async ({ page }) => {
    await roomFrame(page).evaluate(() => {
      const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
      const node = doc.querySelector('p').firstChild;
      const m = /\b[a-z]{4,}\b/.exec(node.nodeValue);
      const r = doc.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
      const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    });
    await settle(page, 500);
    await expect(roomFrame(page).locator('#define-chip.show')).toBeVisible();
  });
});

test.describe('W24 print', () => {
  test('the frame prints one line instead of the book', async ({ page }) => {
    await openReader(page);
    await page.emulateMedia({ media: 'print' });
    const frame = await roomFrame(page).evaluate(() => ({
      line: getComputedStyle(document.body, '::before').content,
      view: getComputedStyle(document.querySelector('foliate-view')).display,
      chip: getComputedStyle(document.getElementById('define-chip')).display,
    }));
    console.log(`\n=== frame, print media ===\n${JSON.stringify(frame)}\n`);
    expect(frame.line).toBe(JSON.stringify(PRINT_LINE));
    expect(frame.view, 'the book is not laid out for print').toBe('none');
    expect(frame.chip).toBe('none');
  });

  test('a section document printed on its own prints nothing', async ({ page }) => {
    await openReader(page);
    await page.emulateMedia({ media: 'print' });
    const body = await roomFrame(page).evaluate(() => {
      const doc = document.querySelector('foliate-view').renderer.getContents()[0].doc;
      return doc.defaultView.getComputedStyle(doc.body).display;
    });
    expect(body).toBe('none');
  });

  test('on screen, nothing changes', async ({ page }) => {
    await openReader(page);
    const frame = await roomFrame(page).evaluate(() => ({
      line: getComputedStyle(document.body, '::before').content,
      view: getComputedStyle(document.querySelector('foliate-view')).display,
    }));
    expect(frame.line === 'none' || frame.line === 'normal').toBe(true);
    expect(frame.view).toBe('block');
  });
});
