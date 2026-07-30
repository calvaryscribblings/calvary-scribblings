// R7.4 §D — SELECTION → CHIP → defineWord, at the host.
//
// WHAT IS SYNTHETIC HERE, AND WHAT IS NOT. Playwright cannot perform a real iOS long-press:
// the gesture that produces a word selection is the platform's, not the page's, and driving
// it would be testing WebKit rather than the Reading Room. So the selection is made
// programmatically — doc.getSelection().addRange(...) over a real word in a real EPUB — and
// everything downstream of that is production code: the selectionchange listener, the settle
// debounce, the single-word gate, the sentence extraction, the rect mapping, the chip, and
// the message that leaves for the parent.
//
// The long-press FEEL — how long the press must be, whether iOS extends to the word or the
// paragraph, the magnifier — stays on the glass list. It is a platform behaviour we
// deliberately do not fight, so there is nothing of ours to assert about it.
//
// THE OTHER HALF OF THIS FILE is the collision proof. The contract calls the R7.2.3
// ownership bands inviolate, so the chip is tested not only for what it does but for what it
// must never cause: a page turn or a chrome toggle.
import { test, expect } from '@playwright/test';
import { openReader, settle, msgs, clearMsgs, roomFrame, geometry } from './helpers.mjs';

/**
 * Select one real word inside the section document, the way a long-press would leave it.
 * Returns what was selected so the assertions can be about the book's actual text.
 */
async function selectWord(page, which = 0) {
  return roomFrame(page).evaluate((n) => {
    const view = document.querySelector('foliate-view');
    const doc = view.renderer.getContents()[0].doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (!text || text.trim().length < 20) continue;
      // Find the (n+1)-th word of four or more letters — long enough to be a real word,
      // and far enough in that it has a sentence around it.
      const re = /\b[A-Za-z]{4,}\b/g;
      let m, seen = 0;
      while ((m = re.exec(text))) {
        if (seen++ < n) continue;
        const range = doc.createRange();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const sel = doc.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return { word: m[0], blockText: (node.parentElement?.textContent || '').slice(0, 200) };
      }
    }
    throw new Error('no suitable word found in the section document');
  }, which);
}

/**
 * Select a word inside a PARAGRAPH rather than a heading, so the sentence scan has real
 * terminators to find. The fixture's paragraphs open "Chapter N paragraph M." — a genuine
 * full stop the extraction must cut at.
 */
async function selectWordInParagraph(page) {
  return roomFrame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    const doc = view.renderer.getContents()[0].doc;
    const p = doc.querySelector('p');
    if (!p) throw new Error('no paragraph in this section');
    const node = [...p.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim().length > 40);
    if (!node) throw new Error('no text node in the paragraph');
    const text = node.nodeValue;
    // A word AFTER the first full stop, so the sentence must start somewhere > 0.
    const stop = text.indexOf('.');
    const m = /\b[A-Za-z]{4,}\b/g;
    m.lastIndex = stop + 1;
    const hit = m.exec(text);
    if (!hit) throw new Error('no word after the first stop');
    const range = doc.createRange();
    range.setStart(node, hit.index);
    range.setEnd(node, hit.index + hit[0].length);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return { word: hit[0], fullText: text, stopAt: stop };
  });
}

/** Select a RANGE spanning several words — the case the chip must decline. */
async function selectPhrase(page) {
  return roomFrame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    const doc = view.renderer.getContents()[0].doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.trim().length > 60) {
        const range = doc.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 40);
        const sel = doc.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return String(sel);
      }
    }
    throw new Error('no long text node');
  });
}

async function collapseSelection(page) {
  await roomFrame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    view.renderer.getContents()[0].doc.getSelection().removeAllRanges();
  });
}

/** The chip's own state, read from the host document. */
async function chipState(page) {
  return roomFrame(page).evaluate(() => {
    const el = document.getElementById('define-chip');
    const r = el.getBoundingClientRect();
    return {
      shown: el.classList.contains('show'),
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      width: r.width, height: r.height,
      text: (el.textContent || '').trim(),
    };
  });
}

// The settle debounce is 220 ms in the host; give it room without making the suite slow.
const SETTLED = 500;

test('a settled single-word selection posts wordSelected with the word and its sentence', async ({ page }) => {
  await openReader(page);
  await clearMsgs(page);

  const { word } = await selectWord(page);
  await page.waitForTimeout(SETTLED);

  const [msg] = await msgs(page, 'wordSelected');
  console.log(`\n=== wordSelected ===\nselected "${word}"\n${JSON.stringify(msg)}\n`);

  expect(msg, 'a settled selection must be reported').toBeTruthy();
  expect(msg.word).toBe(word);
  // THE ANCHORED QUOTE: the word's own sentence, from the book, containing the word.
  expect(msg.sentence.length, 'the sentence must not be empty').toBeGreaterThan(0);
  expect(msg.sentence.toLowerCase()).toContain(word.toLowerCase());
  expect(msg.sentence.length, 'a sentence, not a chapter').toBeLessThan(400);
  // The rect must be in the READER's coordinates, not the column strip's (R7.2.1).
  const g = await geometry(page);
  expect(msg.rect.left).toBeGreaterThanOrEqual(0);
  expect(msg.rect.left).toBeLessThan(g.hostInnerWidth);
});

test('the anchored quote is the word\'s own SENTENCE, cut at the full stop', async ({ page }) => {
  // The heading case above has no punctuation to cut at, so it proves the fallback rather
  // than the rule. This is the rule: a word inside a paragraph must come back with the
  // sentence it sits in, not the paragraph it sits in.
  await openReader(page);
  await clearMsgs(page);

  const { word, fullText, stopAt } = await selectWordInParagraph(page);
  await page.waitForTimeout(SETTLED);

  const [msg] = await msgs(page, 'wordSelected');
  console.log(`\n=== anchored quote ===\nword "${word}", first stop at ${stopAt}\nparagraph: "${fullText.slice(0, 90)}…"\nsentence:  "${msg.sentence}"\n`);

  expect(msg.sentence.toLowerCase()).toContain(word.toLowerCase());
  // It must have cut AFTER the opening "Chapter N paragraph M." — i.e. it is not simply
  // handing back the whole block.
  expect(msg.sentence.startsWith('Chapter'), 'the sentence must start after the preceding full stop').toBe(false);
  expect(msg.sentence.length).toBeLessThan(fullText.length);
});

test('the chip appears near the word and inside the viewport', async ({ page }) => {
  await openReader(page);
  await selectWord(page);
  await page.waitForTimeout(SETTLED);

  const chip = await chipState(page);
  const g = await geometry(page);
  console.log(`\n=== chip ===\n${JSON.stringify(chip)}\nviewport ${g.hostInnerWidth}x${g.hostInnerHeight}\n`);

  expect(chip.shown, 'a single-word selection must offer the chip').toBe(true);
  expect(chip.text.toLowerCase()).toContain('define');
  // NEVER OFF-VIEWPORT — the contract's words. Asserted on all four edges.
  expect(chip.left).toBeGreaterThanOrEqual(0);
  expect(chip.top).toBeGreaterThanOrEqual(0);
  expect(chip.right).toBeLessThanOrEqual(g.hostInnerWidth);
  expect(chip.bottom).toBeLessThanOrEqual(g.hostInnerHeight);
  // A phone-sized touch target, whatever the visible chip looks like.
  expect(chip.height).toBeGreaterThanOrEqual(40);
});

test('a multi-word selection is declined — the chip is single-word only', async ({ page }) => {
  await openReader(page);
  await clearMsgs(page);

  const phrase = await selectPhrase(page);
  await page.waitForTimeout(SETTLED);

  console.log(`\n=== multi-word ===\nselected "${phrase.slice(0, 60)}…"\n`);
  expect((await chipState(page)).shown, 'a phrase must not summon the chip').toBe(false);
  expect(await msgs(page, 'wordSelected'), 'and must not be reported as a word').toHaveLength(0);
});

test('collapsing the selection removes the chip', async ({ page }) => {
  await openReader(page);
  await selectWord(page);
  await page.waitForTimeout(SETTLED);
  expect((await chipState(page)).shown).toBe(true);

  await collapseSelection(page);
  await page.waitForTimeout(SETTLED);
  expect((await chipState(page)).shown, 'no selection, no chip').toBe(false);
});

test('tapping the chip posts defineWord carrying the word and the sentence', async ({ page }) => {
  await openReader(page);
  await clearMsgs(page);

  const { word } = await selectWord(page);
  await page.waitForTimeout(SETTLED);
  const chip = await chipState(page);

  // Tap it where it actually is. The frame is inset in the harness page, so the chip's
  // host-document coordinates are offset by the frame's own box.
  const frameBox = await page.locator('iframe').boundingBox();
  await page.touchscreen.tap(
    frameBox.x + chip.left + chip.width / 2,
    frameBox.y + chip.top + chip.height / 2,
  );
  await settle(page);

  const [msg] = await msgs(page, 'defineWord');
  console.log(`\n=== defineWord ===\n${JSON.stringify(msg)}\n`);
  expect(msg, 'the chip must ask the parent to define the word').toBeTruthy();
  expect(msg.word).toBe(word);
  expect(msg.sentence.toLowerCase()).toContain(word.toLowerCase());

  // It fires ONCE. pointerup and the click that follows are one intent.
  expect(await msgs(page, 'defineWord'), 'exactly one request per tap').toHaveLength(1);
  // And it retires itself, so it cannot sit on top of the modal about to open.
  expect((await chipState(page)).shown).toBe(false);
});

// ── THE COLLISION PROOF (the contract's first requirement) ───────────────────
// The chip exists only while a selection is live, and a live selection is exactly the state
// in which both tap paths already bail: touchend checks hasLiveSelection before either band
// test, and onTap checks it again before the thirds. These two tests assert the consequence
// rather than the mechanism — that nothing the define path does can move the reader.

test('tapping the chip neither turns the page nor toggles the chrome', async ({ page }) => {
  await openReader(page);
  const before = await geometry(page);

  await selectWord(page);
  await page.waitForTimeout(SETTLED);
  await clearMsgs(page);

  const chip = await chipState(page);
  const frameBox = await page.locator('iframe').boundingBox();
  await page.touchscreen.tap(
    frameBox.x + chip.left + chip.width / 2,
    frameBox.y + chip.top + chip.height / 2,
  );
  await settle(page, 600);

  const after = await geometry(page);
  const all = await msgs(page);
  console.log(`\n=== chip vs bands ===\nstart ${before.start} → ${after.start}\nmessages: ${JSON.stringify(all.map((m) => m.type))}\n`);

  expect(after.start, 'the chip must not turn the page').toBe(before.start);
  expect(all.filter((m) => m.type === 'toggleChrome'), 'the chip is not a centre tap').toHaveLength(0);
  expect(all.filter((m) => m.type === 'defineWord'), 'it did what it is for').toHaveLength(1);
});

test('a tap on the page while a word is selected is inert — Band A stays closed', async ({ page }) => {
  await openReader(page);
  const before = await geometry(page);

  await selectWord(page);
  await page.waitForTimeout(SETTLED);
  await clearMsgs(page);

  // The RIGHT third — the page-turn band. With a selection live this must do nothing at
  // all: it is the reader dismissing a selection, not asking for the next page.
  const frameBox = await page.locator('iframe').boundingBox();
  await page.touchscreen.tap(frameBox.x + (before.hostInnerWidth * 5) / 6, frameBox.y + 420);
  await settle(page, 600);

  const after = await geometry(page);
  const all = await msgs(page);
  console.log(`\n=== band A with a live selection ===\nstart ${before.start} → ${after.start}\nmessages: ${JSON.stringify(all.map((m) => m.type))}\n`);

  expect(after.start, 'a selection makes the page-turn band inert').toBe(before.start);
  expect(all.filter((m) => m.type === 'toggleChrome')).toHaveLength(0);
});

test('with NO selection the tap bands still work exactly as before', async ({ page }) => {
  // The regression guard the contract asks for in one sentence: the define feature must be
  // invisible when nobody is defining anything. (tap-zones.spec.mjs is the full proof; this
  // is the one that runs in the same file as the chip, so a change here cannot pass alone.)
  await openReader(page);
  const before = await geometry(page);
  await clearMsgs(page);

  const frameBox = await page.locator('iframe').boundingBox();
  await page.touchscreen.tap(frameBox.x + (before.hostInnerWidth * 5) / 6, frameBox.y + 420);
  await settle(page, 600);

  const after = await geometry(page);
  console.log(`\n=== bands, no selection ===\nstart ${before.start} → ${after.start}\n`);
  expect(after.start, 'the right third must still turn the page').toBeGreaterThan(before.start);
  expect((await chipState(page)).shown, 'and no chip appears from a plain tap').toBe(false);
});
