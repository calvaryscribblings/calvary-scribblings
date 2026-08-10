// §6h — THE CROSS-SURFACE CFI EXCHANGE, web side.
//
// Two surfaces read the same book. A position taken on one must mean the same place on the
// other, or "continue reading" is a lie told by whichever device you picked up second. This
// module is the web half: it EMITS four positions as CFIs, and it SEEKS the app's four and
// reports where it landed.
//
// ── WHAT IS COMPARED, AND WHY IT IS NOT THE PAGE ─────────────────────────────
// The obvious comparison — seek the CFI, report the text of the resulting PAGE — is wrong,
// and wrong in the way that produces false failures rather than misses.
//
// A page is a VIEWPORT ARTEFACT. The app is a phone at 400 CSS px; this surface is whatever
// the reader's window is, at whatever type size and leading they chose, in one or two
// columns. The same CFI resolves to the same character on both and still yields completely
// different page text, because the two surfaces broke the section into pages differently.
// Comparing page text would report a mismatch on a book both surfaces are reading correctly,
// and false failures teach people to ignore the test.
//
// So the comparison is over what the CFI RESOLVES TO IN THE DOCUMENT:
//
//     sectionIndex   — which spine document
//     resolvedText   — the text at the resolved range's start, read from the section DOM
//
// Both are properties of the book and the CFI. Neither knows the viewport exists. This is
// also the reason the exchange can be two small lists rather than a shared harness: there is
// nothing to keep in step except the book.
//
// ── AND NOT STRING EQUALITY OF CFIs ──────────────────────────────────────────
// Two CFIs can differ as strings and resolve to the same place: range form versus point
// form, an ID assertion present or absent, an offset normalised into the next text node.
// Nothing here compares CFI strings. `sameLanding()` is the only comparison, and it asks
// where they land.
import { createHash } from 'node:crypto';

/** The four positions, by INTENT. Indices are resolved against the real book at run time. */
export const POSITIONS = [
  { key: 'mid-section-1', section: 0, at: 'middle',
    why: 'an ordinary interior position — the case that must simply work' },
  { key: 'last-page-section-2', section: 1, at: 'end',
    why: 'the far edge of a section: the offset most likely to normalise differently' },
  { key: 'first-page-section-3', section: 2, at: 'start',
    why: 'THE BOUNDARY. The position either surface is most likely to attribute to the '
       + 'previous section, because it is the first thing after one ends' },
  { key: 'inside-degenerate-section-3', section: 2, at: 'middle',
    why: 'inside the one-screen section. Its first page and its last page are the same '
       + 'page, so a surface that derives position from pagination has nowhere to hide' },
];

/**
 * Normalise text for comparison. Whitespace only — never case, never punctuation: a CFI that
 * lands on a different word must not be able to pass by looking similar.
 */
export const normalise = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** The comparison window. Long enough to be unambiguous in a real book, short enough to read. */
export const WINDOW = 60;

/**
 * Did two records land in the same place? The ONLY comparison in this exchange.
 *
 * Section must match exactly. Text is compared over the window, and one is allowed to be a
 * prefix of the other — a range that stops at a node boundary yields less text than one that
 * runs on, and that is a difference in how much was captured, not in where it started.
 */
export function sameLanding(a, b) {
  if (!a || !b) return { ok: false, why: 'a record is missing' };
  if (a.sectionIndex !== b.sectionIndex) {
    return { ok: false, why: `section ${a.sectionIndex} vs ${b.sectionIndex}` };
  }
  const x = normalise(a.resolvedText);
  const y = normalise(b.resolvedText);
  if (!x || !y) return { ok: false, why: 'one side resolved to no text at all' };
  if (x === y || x.startsWith(y) || y.startsWith(x)) return { ok: true };
  return { ok: false, why: `text differs\n      ours:   ${JSON.stringify(x.slice(0, WINDOW))}\n      theirs: ${JSON.stringify(y.slice(0, WINDOW))}` };
}

/** Stable digest over the records, so a list mangled in transit is a finding about the list. */
export function listDigest(records) {
  const canonical = records
    .map((r) => `${r.key}|${r.sectionIndex}|${normalise(r.resolvedText).slice(0, WINDOW)}`)
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// The two browser-side halves. Both run INSIDE the reading-room frame, so they use
// foliate's own emitter and resolver rather than reimplementing CFI arithmetic.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a collapsed Range at a place in a section document, and hand foliate that range to
 * turn into a CFI. `view.getCFI(index, range)` is the SAME call the reader uses for a
 * bookmark, which is the point: the exchange must exercise the production emitter, not a
 * test-only path that could be correct while the real one is not.
 *
 * Returned as a string of source so it can be page.evaluate()'d.
 */
export const EMIT_IN_PAGE = `async ({ index, at, window: WIN }) => {
  const view = document.querySelector('foliate-view');
  await view.goTo(index);
  await new Promise((r) => setTimeout(r, 400));
  const contents = view.renderer.getContents();
  const entry = contents.find((c) => c.index === index) || contents[0];
  if (!entry) return { error: 'section ' + index + ' is not loaded' };
  const doc = entry.doc;

  // Every text node with actual text, in document order. This is the section's text as the
  // CFI sees it — element structure and all — not innerText, which collapses and reorders.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let total = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    nodes.push({ node: n, start: total, len: n.nodeValue.length });
    total += n.nodeValue.length;
  }
  if (!nodes.length) return { error: 'section ' + index + ' has no text' };

  // 'start' is not offset 0: offset 0 of the first text node is a position every surface
  // agrees on trivially, which would make the boundary case pass without testing anything.
  // A little way in is the honest version of "the first page".
  const target = at === 'start' ? Math.min(20, total - 1)
    : at === 'end' ? Math.max(0, total - 40)
    : Math.floor(total / 2);

  const hit = nodes.find((e) => target < e.start + e.len) || nodes[nodes.length - 1];
  const range = doc.createRange();
  range.setStart(hit.node, Math.max(0, Math.min(target - hit.start, hit.len - 1)));
  range.collapse(true);

  const cfi = view.getCFI(index, range);

  // The comparison text, read forward from the resolved point through the section's text
  // nodes. Document order, viewport irrelevant.
  let text = '';
  for (let i = nodes.indexOf(hit); i < nodes.length && text.length < WIN * 3; i++) {
    text += (i === nodes.indexOf(hit)
      ? nodes[i].node.nodeValue.slice(range.startOffset)
      : nodes[i].node.nodeValue) + ' ';
  }
  return { cfi, sectionIndex: index, resolvedText: text };
}`;

/**
 * Seek a CFI and report where it landed — foliate's own resolver, then the same forward read.
 * Deliberately does NOT report the page: see the header.
 */
export const SEEK_IN_PAGE = `async ({ cfi, window: WIN }) => {
  const view = document.querySelector('foliate-view');
  let resolved;
  try { resolved = await view.resolveCFI(cfi); } catch (e) { return { error: 'unresolvable: ' + e }; }
  if (!resolved || typeof resolved.index !== 'number') return { error: 'resolved to no section' };
  const index = resolved.index;

  await view.goTo(cfi);
  await new Promise((r) => setTimeout(r, 400));

  const contents = view.renderer.getContents();
  const entry = contents.find((c) => c.index === index) || contents[0];
  if (!entry) return { error: 'section ' + index + ' did not load' };
  const doc = entry.doc;

  let range;
  try { range = resolved.anchor(doc); } catch (e) { return { error: 'anchor failed: ' + e }; }
  if (!range) return { error: 'anchor produced no range' };

  const startNode = range.startContainer;
  const startOffset = range.startOffset;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue && n.nodeValue.trim()) nodes.push(n);
  }
  // A CFI can resolve to an ELEMENT boundary rather than into a text node; fall forward to
  // the next text node, which is the character a reader would actually see there.
  let i = nodes.indexOf(startNode);
  let first = '';
  if (i === -1) {
    i = nodes.findIndex((n) => startNode.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (i === -1) i = 0;
    first = nodes[i] ? nodes[i].nodeValue : '';
  } else {
    first = nodes[i].nodeValue.slice(startOffset);
  }
  let text = first + ' ';
  for (let j = i + 1; j < nodes.length && text.length < WIN * 3; j++) text += nodes[j].nodeValue + ' ';
  return { cfi, sectionIndex: index, resolvedText: text };
}`;
