// ─────────────────────────────────────────────────────────────────────────────
// THE RIBBON PRINCIPLE (R7.2, geometry corrected in R7.3)
//
// The tab is not a button that adds things — it IS the current page's bookmark state.
// Deciding whether a stored ribbon belongs to the page in front of the reader is a
// fraction-proximity test, because a CFI cannot be compared for "same page": pagination
// depends on the reader's type size, leading, flow and screen, so the same CFI lands on a
// different page for a different reader — and for the same reader after a Typesetter tap.
//
// THE RULE. `pageSpan` is ONE PAGE OF THE SECTION THE READER IS IN, expressed as a
// fraction of the whole book. A ribbon is on the current page when
// |ribbon.fraction − currentFraction| < pageSpan / 2. Half a page either side of the
// reader's position is exactly the span the current page occupies, so the neighbouring
// pages — a full pageSpan away — can never match, and no page can match two ribbons.
//
// WHY THIS FILE IS PLAIN ESM. It carries no React and no imports, so the reader harness
// can import it directly under Node and assert the ribbon decision against real measured
// geometry (tests/reader/page-geometry.spec.mjs). Before R7.3 these two functions lived
// inside ReadingRoom.js, where a test could only reach them through a browser — so the
// one rule that decides whether the tab lights was the one rule no test could see.
// ReadingRoom re-exports both, so every call site is unchanged.
//
// WHAT R7.3 CHANGED. pageSpan used to be the host's `minStep`: the smallest forward
// fraction step it had ever observed. That is not a ruler. Every step foliate reports
// equals one page OF THE DESTINATION SECTION (progress.js:80 — a page's whole-book width
// is `1/(pages−2) × sectionSize/bookSize`), so a single short section — a half-title, a
// one-page interlude — permanently dragged minStep down to ITS page width and the epsilon
// with it. The reader then re-typesets the book, every stored fraction shifts by up to a
// page, and the tab fails to light on a page that is genuinely marked. The host now
// computes the current section's real page width instead, and this file simply believes it.
//
// Legacy records (R4a-era, cfi + label only) carry no fraction and therefore never match.
// They render in the Contents list and jump correctly; they simply cannot light the tab.
// ─────────────────────────────────────────────────────────────────────────────

// The floor, for the beat before the host has reported any geometry at all — the very
// first paint, before the paginator has laid out a section. 0.2% of the book is well
// under one page on anything longer than a pamphlet, so it errs toward "no ribbon here":
// the safe direction, since the cost is a duplicate the dedupe still catches on write.
export const RIBBON_MIN_SPAN = 0.002;

export function ribbonEpsilonFor(pageSpan) {
  return Math.max(typeof pageSpan === 'number' ? pageSpan : 0, RIBBON_MIN_SPAN) / 2;
}

export function findRibbonOnPage(list, fraction, pageSpan) {
  if (!Array.isArray(list) || typeof fraction !== 'number') return null;
  const eps = ribbonEpsilonFor(pageSpan);
  let best = null;
  let bestD = Infinity;
  for (const r of list) {
    if (!r || typeof r.fraction !== 'number') continue;
    const d = Math.abs(r.fraction - fraction);
    if (d < eps && d < bestD) { best = r; bestD = d; }
  }
  return best;
}
