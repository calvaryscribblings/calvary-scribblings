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
      // The host places the chip using offsetWidth/offsetHeight, which are INTEGERS, not the
      // fractional box the rect reports. Recomputing its arithmetic with the rect's width
      // lands a pixel off — so the exactness assertions must read the same numbers it did.
      offsetWidth: el.offsetWidth, offsetHeight: el.offsetHeight,
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

// ── R7.4.1 — CHIP GEOMETRY vs THE iOS CALLOUT ────────────────────────────────
//
// Glass found the collision: on iOS the system selection menu (Copy / Look Up / Translate)
// is drawn directly ABOVE the selection, which is where R7.4 put the chip. The callout is
// owned by the OS and drawn above the web view, so no z-index reaches it and no CSS
// suppresses it without also breaking the selection. The chip moves; the callout does not.
//
// WHAT CAN AND CANNOT BE ASSERTED HERE. Playwright is not an iPhone, and the callout does
// not exist in Chromium — so this file cannot prove the two no longer overlap. What it CAN
// prove, and does, is the geometry policy that makes them not overlap: that on an Apple
// touch platform the chip lands below the selection with clearance, that it flips above only
// when there is no room, that clamping still holds, and — the assertion that protects the
// green surface — that non-Apple placement is byte-for-byte what R7.4 shipped.
//
// The platform is emulated by overriding what isAppleTouch() reads. That exercises the REAL
// detection function rather than a test hatch: production code has no idea it is being
// tested, and a change to the detection breaks these tests, which is the point.

/** Make the host believe it is an iPhone. Must be called BEFORE the reader is opened. */
async function asIPhone(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'iPhone', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5, configurable: true });
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
  });
}

/** iPadOS 13+, which lies and calls itself a Mac. Only maxTouchPoints gives it away. */
async function asIPadOS(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5, configurable: true });
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      configurable: true,
    });
  });
}

/**
 * The selection's rect in HOST coordinates, unrounded — computed exactly as the host
 * computes it, so an assertion about the chip's position can be exact rather than fuzzy.
 * (The `rect` on the wordSelected message is rounded for the wire; this is not.)
 */
async function selectionHostRect(page) {
  return roomFrame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    const doc = view.renderer.getContents()[0].doc;
    const sel = doc.getSelection();
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const f = doc.defaultView.frameElement.getBoundingClientRect();
    return {
      left: r.left + f.left, top: r.top + f.top,
      right: r.right + f.left, bottom: r.bottom + f.top,
      width: r.width, height: r.height,
      vw: window.innerWidth, vh: window.innerHeight,
    };
  });
}

/** Is anything selected anywhere — host document or any section document? */
async function selectionLiveAnywhere(page) {
  return roomFrame(page).evaluate(() => {
    const live = (d) => {
      try { const s = d.getSelection(); return !!s && !s.isCollapsed && String(s).trim().length > 0; }
      catch (e) { return false; }
    };
    if (live(document)) return true;
    const view = document.querySelector('foliate-view');
    for (const c of view?.renderer?.getContents?.() || []) if (c.doc && live(c.doc)) return true;
    return false;
  });
}

/**
 * Show the chip once and throw the result away, so its webfont is loaded before any
 * measurement that matters.
 *
 * WHY THIS IS NEEDED, and why document.fonts.ready is not enough. The chip's horizontal
 * position derives from its OWN width at the instant it is first shown, and it is set in
 * Cinzel. But the chip is `display:none` until the first selection settles — a never-rendered
 * element requests no font, so fonts.ready resolves without Cinzel in it. On the first show
 * the browser measures with the fallback serif (93 px), places the chip from that, and only
 * then swaps in Cinzel (95 px). Net effect: the chip's first appearance sits ~1 px off the
 * position its finished width implies.
 *
 * That is a real product nuance, and it is being left alone: one pixel, once, on the first
 * definition of a session. Pre-warming the font in the host would be code written for a
 * measurement error nobody can see. What it WOULD do is make an exact-pixel assertion flip
 * between 8 and 9 depending on timing — so the harness warms it instead, and then asserts
 * the arithmetic exactly.
 */
async function warmChipFont(page) {
  await selectWordInParagraph(page);
  await page.waitForTimeout(SETTLED);
  await collapseSelection(page);
  await page.waitForTimeout(SETTLED);
}

const CLAMP = 8;          // CHIP_MARGIN in the host
const GAP = 8;            // CHIP_GAP
const IOS_CLEARANCE = 18; // IOS_HANDLE_CLEARANCE

test('iOS: the chip sits BELOW the selection, clear of the grab-dots', async ({ page }) => {
  await asIPhone(page);
  await openReader(page);
  await warmChipFont(page);
  await selectWordInParagraph(page);
  await page.waitForTimeout(SETTLED);

  const rect = await selectionHostRect(page);
  const chip = await chipState(page);
  console.log(`\n=== iOS placement ===\nselection ${JSON.stringify({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })}\nchip      ${JSON.stringify({ top: chip.top, bottom: chip.bottom, left: chip.left, right: chip.right })}\n`);

  expect(chip.shown).toBe(true);
  // THE FIX, stated as one assertion: the chip's top edge is below the selection's bottom.
  expect(chip.top, 'on iOS the chip must clear the selection downwards').toBeGreaterThan(rect.bottom);
  // And by enough to clear the handle knob that hangs below the rect.
  expect(chip.top - rect.bottom, 'it must clear the grab-dots, not merely the text')
    .toBeGreaterThanOrEqual(IOS_CLEARANCE - 1);
  // It is genuinely below, not merely overlapping lower down.
  expect(chip.top).toBeGreaterThanOrEqual(rect.bottom);

  // Horizontally near the selection's END, not centred on it.
  const chipCentre = chip.left + chip.width / 2;
  const clamped = chip.left <= CLAMP + 0.5 || chip.right >= rect.vw - CLAMP - 0.5;
  if (!clamped) {
    expect(Math.abs(chipCentre - rect.right), 'the chip is centred on the selection END')
      .toBeLessThanOrEqual(1);
  }
});

test('iPadOS is detected too, though it calls itself a Mac', async ({ page }) => {
  // The case that is easy to miss: iPadOS 13+ reports platform 'MacIntel' and a Macintosh
  // UA. It raises the same callout an iPhone does, and it is the device most likely to be
  // reading a book, so getting this wrong would leave the collision exactly where it hurts.
  await asIPadOS(page);
  await openReader(page);
  await warmChipFont(page);
  await selectWordInParagraph(page);
  await page.waitForTimeout(SETTLED);

  const rect = await selectionHostRect(page);
  const chip = await chipState(page);
  console.log(`\n=== iPadOS placement ===\nchip.top ${chip.top} vs selection.bottom ${rect.bottom}\n`);
  expect(chip.top, 'an iPad must get the iOS placement').toBeGreaterThan(rect.bottom);
});

test('NON-iOS placement is byte-for-byte what R7.4 shipped', async ({ page }) => {
  // The regression guard for a surface glass called PERFECT on Android. This does not assert
  // "above the word" loosely — it recomputes R7.4's exact arithmetic and demands the same
  // pixel, so any drift in the shared clamp or the gap shows up here first.
  await openReader(page);                      // no platform override: plain Chromium
  await warmChipFont(page);
  await selectWordInParagraph(page);
  await page.waitForTimeout(SETTLED);

  const rect = await selectionHostRect(page);
  const chip = await chipState(page);

  const cw = chip.offsetWidth;
  const ch = chip.offsetHeight;
  const expectedTop = Math.round(Math.min(
    Math.max(CLAMP, rect.top - ch - GAP),
    Math.max(CLAMP, rect.vh - ch - CLAMP),
  ));
  const expectedLeft = Math.round(Math.min(
    Math.max(CLAMP, rect.left + rect.width / 2 - cw / 2),
    Math.max(CLAMP, rect.vw - cw - CLAMP),
  ));
  console.log(`\n=== non-iOS placement ===\nselection left ${rect.left} width ${rect.width} | chip ${cw}x${ch}\nexpected top ${expectedTop} left ${expectedLeft}\nactual   top ${Math.round(chip.top)} left ${Math.round(chip.left)}\n`);

  expect(Math.round(chip.top), 'R7.4 placed the chip ABOVE the word — unchanged').toBe(expectedTop);
  expect(Math.round(chip.left), 'R7.4 centred the chip on the word — unchanged').toBe(expectedLeft);
  expect(chip.bottom, 'and it is above the selection, as before').toBeLessThanOrEqual(rect.top + 1);
});

test('iOS: clamping still holds on all four edges', async ({ page }) => {
  await asIPhone(page);
  await openReader(page);
  await warmChipFont(page);
  await selectWordInParagraph(page);
  await page.waitForTimeout(SETTLED);

  const rect = await selectionHostRect(page);
  const chip = await chipState(page);
  expect(chip.left).toBeGreaterThanOrEqual(CLAMP - 0.5);
  expect(chip.top).toBeGreaterThanOrEqual(CLAMP - 0.5);
  expect(chip.right).toBeLessThanOrEqual(rect.vw - CLAMP + 0.5);
  expect(chip.bottom).toBeLessThanOrEqual(rect.vh - CLAMP + 0.5);
});

test('the define tap clears the selection, so the platform menu goes with it', async ({ page }) => {
  // Universal — asserted here in PLAIN Chromium, because it is not an iOS workaround. The
  // system menu (iOS callout, Android action bar) is tied to the selection and is drawn above
  // the web view; collapsing the selection is the only instruction that dismisses it.
  await openReader(page);
  await clearMsgs(page);
  await warmChipFont(page);
  await selectWordInParagraph(page);
  await page.waitForTimeout(SETTLED);
  expect(await selectionLiveAnywhere(page), 'a selection must exist to begin with').toBe(true);

  const chip = await chipState(page);
  const frameBox = await page.locator('iframe').boundingBox();
  await page.touchscreen.tap(frameBox.x + chip.left + chip.width / 2, frameBox.y + chip.top + chip.height / 2);
  await settle(page, 400);

  console.log(`\n=== selection after define ===\nmessages: ${JSON.stringify((await msgs(page)).map((m) => m.type))}\n`);
  expect(await msgs(page, 'defineWord'), 'the define still fires').toHaveLength(1);
  expect(await selectionLiveAnywhere(page), 'and the selection is released').toBe(false);
});

test('iOS: the define tap clears the selection there too', async ({ page }) => {
  await asIPhone(page);
  await openReader(page);
  await clearMsgs(page);
  await warmChipFont(page);
  await selectWordInParagraph(page);
  await page.waitForTimeout(SETTLED);

  const chip = await chipState(page);
  const frameBox = await page.locator('iframe').boundingBox();
  await page.touchscreen.tap(frameBox.x + chip.left + chip.width / 2, frameBox.y + chip.top + chip.height / 2);
  await settle(page, 400);

  expect(await msgs(page, 'defineWord')).toHaveLength(1);
  expect(await selectionLiveAnywhere(page)).toBe(false);
});

// ── THE FLIP: no room below ──────────────────────────────────────────────────
//
// A FINDING FIRST, because it shapes the test. At the harness's 400x800 the lowest line of a
// page ends 70.2 px above the viewport floor, and the iOS placement needs exactly 70
// (18 clearance + 44 chip + 8 margin). Shrinking the viewport does not help: foliate's own
// bottom margin scales with it, so at 400x400 the gap is 79.6 px — LARGER. The fixture
// cannot produce a natural no-room case, which is itself the useful news: with foliate's
// margins, a word on the last line normally DOES have room beneath it, and the flip is a
// safety net rather than a routine path.
//
// So the condition is manufactured the only way that is still faithful to the rule under
// test — the rule is "does the chip fit below", and the chip is made too tall to fit. The
// selection is a real word on the real last line; only the chip's height is synthetic.
test('iOS: with no room below, the chip flips ABOVE the selection', async ({ page }) => {
  await asIPhone(page);
  await openReader(page);
  await warmChipFont(page);

  const TALL = 120;
  await roomFrame(page).evaluate((h) => {
    const style = document.createElement('style');
    style.textContent = `#define-chip{height:${h}px !important}`;
    document.head.appendChild(style);
  }, TALL);

  // A real word on the real last line of the page — the bottom-line case the flip is for.
  const picked = await roomFrame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    const doc = view.renderer.getContents()[0].doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    let node, best = null;
    while ((node = walker.nextNode())) {
      const t = node.nodeValue;
      if (!t || !t.trim()) continue;
      const re = /\b[A-Za-z]{4,}\b/g;
      let m;
      while ((m = re.exec(t))) {
        const r = doc.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        const b = r.getBoundingClientRect();
        if (!b.height) continue;
        if (!best || b.bottom > best.bottom) best = { node, index: m.index, len: m[0].length, word: m[0], bottom: b.bottom };
      }
    }
    const r = doc.createRange();
    r.setStart(best.node, best.index);
    r.setEnd(best.node, best.index + best.len);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return best.word;
  });
  await page.waitForTimeout(SETTLED);

  const rect = await selectionHostRect(page);
  const chip = await chipState(page);
  const roomBelow = rect.vh - CLAMP - (rect.bottom + IOS_CLEARANCE);
  console.log(`\n=== iOS flip ===\nword "${picked}" on the last line, selection bottom ${rect.bottom.toFixed(1)} of ${rect.vh}\nroom below: ${roomBelow.toFixed(1)} px for a ${chip.offsetHeight} px chip\nchip top ${chip.top} bottom ${chip.bottom}, selection top ${rect.top.toFixed(1)}\n`);

  // The premise must actually hold, or the test proves nothing.
  expect(chip.offsetHeight, 'the chip must really be too tall to fit below').toBe(TALL);
  expect(roomBelow, 'there must genuinely be no room below').toBeLessThan(chip.offsetHeight);

  // THE FLIP.
  expect(chip.bottom, 'with no room below, the chip must go above the selection')
    .toBeLessThanOrEqual(rect.top + 1);
  // And the clamp survives it.
  expect(chip.top).toBeGreaterThanOrEqual(CLAMP - 0.5);
  expect(chip.bottom).toBeLessThanOrEqual(rect.vh - CLAMP + 0.5);
});

// The companion to the above: at the ordinary chip size the last line does NOT flip, because
// it does not need to. Stated as a test so the finding above is recorded in the suite and not
// only in a comment.
test('iOS: the last line does NOT flip at the real chip size — there is room', async ({ page }) => {
  await asIPhone(page);
  await openReader(page);
  await warmChipFont(page);

  await roomFrame(page).evaluate(() => {
    const view = document.querySelector('foliate-view');
    const doc = view.renderer.getContents()[0].doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    let node, best = null;
    while ((node = walker.nextNode())) {
      const t = node.nodeValue;
      if (!t || !t.trim()) continue;
      const re = /\b[A-Za-z]{4,}\b/g;
      let m;
      while ((m = re.exec(t))) {
        const r = doc.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        const b = r.getBoundingClientRect();
        if (!b.height) continue;
        if (!best || b.bottom > best.bottom) best = { node, index: m.index, len: m[0].length, bottom: b.bottom };
      }
    }
    const r = doc.createRange();
    r.setStart(best.node, best.index);
    r.setEnd(best.node, best.index + best.len);
    const sel = doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.waitForTimeout(SETTLED);

  const rect = await selectionHostRect(page);
  const chip = await chipState(page);
  console.log(`\n=== iOS last line, normal chip ===\nselection bottom ${rect.bottom.toFixed(1)} of ${rect.vh}, chip top ${chip.top}\n`);
  expect(chip.top, 'there is room below the last line, so the chip stays below')
    .toBeGreaterThan(rect.bottom);
  expect(chip.bottom).toBeLessThanOrEqual(rect.vh - CLAMP + 0.5);
});
