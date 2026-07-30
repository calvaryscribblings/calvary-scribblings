// ─────────────────────────────────────────────────────────────────────────────
// R7.3 §D — PER-SECTION PAGE WIDTH, and the ribbon decision that rides on it.
//
// THE DEFECT THIS FILE EXISTS FOR. Until R7.3 the host reported `minStep` — the smallest
// forward fraction step it had ever observed — as the width of a page, and the parent
// derived the ribbon epsilon (pageSpan / 2) from it. That is not a ruler. foliate's
// whole-book fraction is SIZE-weighted (progress.js:73-83) while pagination is measured in
// screenfuls, so a page is worth `(sectionSize / bookSize) / pagesInSection`. In an EVEN
// book the two terms cancel and every page is the same width — which is exactly why
// harness-book.epub never caught this. In an uneven one they do not: a one-line half-title
// occupies a whole page and almost none of the book's weight, so its page is a sliver, and
// minStep latches onto that sliver on the very first turn and then describes the entire
// book with it.
//
// WHAT GOES WRONG FOR A READER. The epsilon exists because a stored ribbon's fraction and
// the current page's fraction stop agreeing the moment the book re-paginates — a Typesetter
// tap, a rotation, a different phone. With the epsilon computed from a sliver, the tab fails
// to light on a page the reader has genuinely marked, so the ribbon they can see in Contents
// is invisible on the page it belongs to. The last test in this file is that reader,
// measured both ways.
//
// The predicate under test is imported from app/lib/ribbonGeometry.js — the real one the
// component uses, not a copy. That module is plain ESM with no imports precisely so this
// file can hold it to account under Node.
// ─────────────────────────────────────────────────────────────────────────────
import { test, expect } from '@playwright/test';
import { findRibbonOnPage, ribbonEpsilonFor } from '../../app/lib/ribbonGeometry.js';
import {
  openReader, settle, msgs, clearMsgs, post, currentFraction,
  sectionGeometry, UNEVEN_BOOK_URL,
} from './helpers.mjs';

/**
 * Walk the whole book one page at a time, recording every step and every reported span.
 * Turn 0 is where the reader already is when the book opens — the opening section's own
 * page width is reported there and nowhere else, and on this fixture that is the sliver.
 */
async function walk(page, turns) {
  const rows = [];
  const opening = await msgs(page, 'relocate');
  let prev = await currentFraction(page);
  if (opening.length) {
    const last = opening[opening.length - 1];
    const geo = await sectionGeometry(page);
    rows.push({
      turn: 0, fraction: last.fraction, step: null,
      reportedSpan: last.pageSpan, expectedSpan: geo.expectedSpan,
      section: geo.index, pageInSection: geo.page, contentPages: geo.contentPages,
      pageCurrent: last.pageCurrent, pageTotal: last.pageTotal, chapter: last.chapterLabel,
    });
  }
  for (let i = 0; i < turns; i++) {
    await clearMsgs(page);
    await post(page, { type: 'next' });
    await settle(page, 260);
    const rel = await msgs(page, 'relocate');
    if (!rel.length) continue;
    const last = rel[rel.length - 1];
    const geo = await sectionGeometry(page);
    rows.push({
      turn: i + 1,
      fraction: last.fraction,
      step: prev == null ? null : last.fraction - prev,
      reportedSpan: last.pageSpan,
      expectedSpan: geo.expectedSpan,
      section: geo.index,
      pageInSection: geo.page,
      contentPages: geo.contentPages,
      pageCurrent: last.pageCurrent,
      pageTotal: last.pageTotal,
      chapter: last.chapterLabel,
    });
    prev = last.fraction;
  }
  return rows;
}

test('MEASUREMENT: what a page is actually worth, section by section', async ({ page }) => {
  await openReader(page, { book: UNEVEN_BOOK_URL });
  const geo = await sectionGeometry(page);
  const rows = await walk(page, 20);

  const spans = rows.map((r) => r.reportedSpan).filter((s) => s > 0);
  const steps = rows.map((r) => r.step).filter((s) => s > 1e-9);

  console.log('\n=== THE UNEVEN BOOK ===');
  console.log(`section weights: ${geo.sizes.join(' / ')}  (total ${geo.total})`);
  console.log('\nturn  sec  page/of  step      reported span  expected span  footer');
  for (const r of rows) {
    console.log(
      `${String(r.turn).padStart(4)}  ${String(r.section).padStart(3)}  `
      + `${String(r.pageInSection).padStart(4)}/${String(r.contentPages).padEnd(2)} `
      + `${(r.step ?? 0).toFixed(5)}   ${(r.reportedSpan ?? 0).toFixed(5)}        `
      + `${(r.expectedSpan ?? 0).toFixed(5)}        `
      + `${r.pageCurrent ?? '-'} of ${r.pageTotal ?? '-'}`,
    );
  }
  console.log(`\nspans reported: min ${Math.min(...spans).toFixed(5)} max ${Math.max(...spans).toFixed(5)}`
    + `  (spread ${(Math.max(...spans) / Math.min(...spans)).toFixed(1)}x)`);
  console.log(`minStep (the OLD ruler): ${Math.min(...steps).toFixed(5)}`);
  console.log(`epsilon from minStep: ${ribbonEpsilonFor(Math.min(...steps)).toFixed(5)}`
    + `  vs from the widest real page: ${ribbonEpsilonFor(Math.max(...spans)).toFixed(5)}\n`);

  // The fixture must actually be uneven, or nothing below means anything.
  expect(rows.length, 'the walk must produce pages').toBeGreaterThan(8);
  expect(Math.max(...spans) / Math.min(...spans),
    'the fixture must make a page worth several-fold more in one section than another')
    .toBeGreaterThan(2);
});

test('the reported pageSpan is this section’s real page width, not the book’s smallest', async ({ page }) => {
  await openReader(page, { book: UNEVEN_BOOK_URL });
  const rows = await walk(page, 18);
  const measured = rows.filter((r) => r.reportedSpan > 0 && r.expectedSpan > 0);
  expect(measured.length, 'the host must report a span').toBeGreaterThan(6);

  // Hop 1: what the host says a page is worth equals what the paginator's own arithmetic
  // says, computed independently in sectionGeometry(). Exact to floating point.
  for (const r of measured) {
    expect(Math.abs(r.reportedSpan - r.expectedSpan),
      `section ${r.section}: reported ${r.reportedSpan} vs geometry ${r.expectedSpan}`)
      .toBeLessThan(1e-9);
  }

  // Hop 2: and it is a real ruler — a step taken INSIDE a section is one page of that
  // section. Steps that cross a section boundary are one page of the DESTINATION section
  // (progress.js:73-83), so they are compared against the span reported after the turn,
  // which is the destination's. Either way the same identity must hold.
  const turnsWithStep = measured.filter((r) => r.step > 1e-9);
  for (const r of turnsWithStep) {
    expect(Math.abs(r.step - r.reportedSpan) / r.reportedSpan,
      `a page turn must move the reader by one page: step ${r.step.toFixed(6)} vs span ${r.reportedSpan.toFixed(6)}`)
      .toBeLessThan(0.02);
  }

  // Hop 3: the old ruler really was wrong here. The smallest step in this book is a
  // half-title page, and it is not what a page is worth where the reader spends their time.
  const minStep = Math.min(...turnsWithStep.map((r) => r.step));
  const widest = Math.max(...measured.map((r) => r.reportedSpan));
  console.log(`\nminStep ${minStep.toFixed(5)} vs widest real page ${widest.toFixed(5)}`
    + ` → the old ruler was ${(widest / minStep).toFixed(1)}x too small\n`);
  expect(widest / minStep, 'minStep must be demonstrably wrong on this book').toBeGreaterThan(2);
});

test('the ribbon tab lights on a re-paginated page — the case minStep gets wrong', async ({ page }) => {
  // THE READER'S STORY, in one test.
  //
  // They drop a ribbon on a page in a long chapter. Later they open the Typesetter and go
  // up two sizes, so the book re-paginates and every fraction shifts: the ribbon's stored
  // fraction now sits somewhere inside the page they are looking at rather than exactly on
  // its edge. The tab must still light — that is the whole ribbon principle. Whether it does
  // is decided by findRibbonOnPage(list, fraction, pageSpan), so we hand it the two spans
  // and watch them disagree.
  await openReader(page, { book: UNEVEN_BOOK_URL });

  // Walk out of the front matter and into the long chapter, collecting steps on the way so
  // the pre-R7.3 ruler is measured rather than assumed.
  const rows = await walk(page, 12);
  const inLongChapter = rows.filter((r) => r.contentPages >= 3 && r.reportedSpan > 0);
  expect(inLongChapter.length, 'the walk must reach a chapter with real pages').toBeGreaterThan(0);

  const here = inLongChapter[inLongChapter.length - 1];
  const realSpan = here.reportedSpan;
  const minStep = Math.min(...rows.map((r) => r.step).filter((s) => s > 1e-9));

  // The ribbon: dropped on THIS page, but recorded before a re-pagination that has since
  // moved the page's own boundaries. A third of a page away is well inside the page it
  // marks, and is the ordinary consequence of a Typesetter tap.
  const drift = realSpan / 3;
  const ribbon = { id: 'r1', fraction: here.fraction - drift, cfi: 'epubcfi(/6/4!/4/2/1:0)' };
  // And its neighbour, a full page back — this one must NEVER light the tab.
  const neighbour = { id: 'r2', fraction: here.fraction - realSpan, cfi: 'epubcfi(/6/4!/4/4/1:0)' };

  const withReal = findRibbonOnPage([ribbon, neighbour], here.fraction, realSpan);
  const withMinStep = findRibbonOnPage([ribbon, neighbour], here.fraction, minStep);

  console.log('\n=== the ribbon decision ===');
  console.log(`at fraction        ${here.fraction.toFixed(5)} (section ${here.section}, page ${here.pageInSection}/${here.contentPages})`);
  console.log(`real page span     ${realSpan.toFixed(5)}  → epsilon ${ribbonEpsilonFor(realSpan).toFixed(5)}`);
  console.log(`minStep (old)      ${minStep.toFixed(5)}  → epsilon ${ribbonEpsilonFor(minStep).toFixed(5)}`);
  console.log(`ribbon is          ${drift.toFixed(5)} away (a third of a page)`);
  console.log(`tab with real span: ${withReal ? 'LIT (' + withReal.id + ')' : 'dark'}`);
  console.log(`tab with minStep:   ${withMinStep ? 'LIT (' + withMinStep.id + ')' : 'dark'}\n`);

  // THE ASSERTION. Real geometry lights the tab for the ribbon on this page.
  expect(withReal, 'the tab must light for a ribbon on this page after re-pagination').toBeTruthy();
  expect(withReal.id, 'and it must be the ribbon on THIS page, not its neighbour').toBe('r1');

  // THE REGRESSION GUARD. The old ruler does not — this is the bug, stated as a fact about
  // this fixture, so a return to minStep fails here rather than silently on a phone.
  expect(withMinStep, 'minStep’s epsilon is too small to see it — this is the defect').toBeNull();

  // And the neighbour is still excluded under real geometry: the epsilon is half a page, so
  // a full page away can never match. A ruler that is too WIDE is the other failure mode.
  const neighbourAlone = findRibbonOnPage([neighbour], here.fraction, realSpan);
  expect(neighbourAlone, 'a ribbon a full page away must never light the tab').toBeNull();
});

test('the footer’s page arithmetic is per-section, and survives a re-typeset', async ({ page }) => {
  // Page X of Y used to be round(1/minStep) — the shortest section in the book, applied to
  // all of it. On the uneven fixture that is wrong by the same factor the ribbon epsilon was.
  await openReader(page, { book: UNEVEN_BOOK_URL });
  const rows = await walk(page, 14);
  const numbered = rows.filter((r) => r.pageCurrent != null && r.pageTotal != null);
  expect(numbered.length, 'the footer must report a page number').toBeGreaterThan(6);

  // X must never exceed Y, must never go backwards while reading forwards, and must advance.
  let lastCur = 0;
  for (const r of numbered) {
    expect(r.pageCurrent, `page ${r.pageCurrent} must fit inside ${r.pageTotal}`).toBeLessThanOrEqual(r.pageTotal);
    expect(r.pageCurrent, 'reading forwards must not move the page number backwards').toBeGreaterThanOrEqual(lastCur);
    lastCur = r.pageCurrent;
  }
  expect(lastCur, 'the page number must actually advance').toBeGreaterThan(numbered[0].pageCurrent);

  // The total must be in the right order of magnitude for a book we can count by hand:
  // 20-odd pages, not the 70+ that dividing by the half-title's span would produce.
  const total = numbered[numbered.length - 1].pageTotal;
  const oldRuler = Math.round(1 / Math.min(...rows.map((r) => r.step).filter((s) => s > 1e-9)));
  console.log(`\n=== footer ===\ntotal now ${total} pages · the old 1/minStep estimate would say ${oldRuler}\n`);
  expect(total, 'the book is not hundreds of pages long').toBeLessThan(oldRuler);

  // A Typesetter tap re-paginates everything. The counts learned before it are dropped
  // (forgetPageGeometry), so this asserts the footer comes BACK rather than going quiet.
  await post(page, {
    type: 'applyStyles', bg: '#f2ecd9', fg: '#2b2418',
    face: 'literata', sizePct: 150, leading: 1.9, justify: true,
  });
  await settle(page, 1200);
  await clearMsgs(page);
  await post(page, { type: 'next' });
  await settle(page, 500);
  const rel = await msgs(page, 'relocate');
  const after = rel[rel.length - 1];
  console.log(`after 150%: page ${after.pageCurrent} of ${after.pageTotal}, span ${after.pageSpan?.toFixed(5)}`);
  expect(after.pageTotal, 'the footer must recover its numbering after a re-typeset').toBeGreaterThan(0);
  expect(after.pageSpan, 'and report a span for the new pagination').toBeGreaterThan(0);
  expect(after.pageTotal, 'bigger type means more pages').toBeGreaterThan(total);
});

test('chapterHref rides on every relocate (§E, host end)', async ({ page }) => {
  // The parent has compared chapterHref against its TOC since R7.2; the field was simply
  // never sent, so ContentsPanel's .current could not fire. This is the host half.
  await openReader(page, { book: UNEVEN_BOOK_URL });
  const [ready] = await msgs(page, 'ready');
  const hrefs = ready.toc.map((t) => t.href).filter(Boolean);
  expect(hrefs.length, 'the fixture must expose a TOC with hrefs').toBeGreaterThan(2);

  await clearMsgs(page);
  await post(page, { type: 'goTo', cfi: hrefs[2] });
  await settle(page, 900);
  const rel = await msgs(page, 'relocate');
  expect(rel.length, 'the jump must relocate').toBeGreaterThan(0);
  const last = rel[rel.length - 1];

  console.log(`\n=== chapterHref ===\njumped to ${hrefs[2]}\nreported  ${last.chapterHref}\nlabel     ${last.chapterLabel}\n`);
  expect(typeof last.chapterHref, 'chapterHref must be a string').toBe('string');
  // It must be one of the TOC's own hrefs, or the panel's === comparison can never match.
  expect(hrefs, 'chapterHref must be comparable to the TOC the parent was given').toContain(last.chapterHref);
  expect(last.chapterHref).toBe(hrefs[2]);
});
