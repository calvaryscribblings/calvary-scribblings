// ─────────────────────────────────────────────────────────────────────────────
// W24 — PRINTING AND COPYING IN THE READING ROOM (ruling 93, 28 Sep 2026).
//
// A book in the Reading Room does not print, and a copy of it is short and credited:
//   • PRINT (and Save as PDF, which is print): the reader page and the reader frame print ONE
//     line instead of the book — PRINT_LINE.
//   • COPY: up to COPY_MAX_WORDS words pass as selected; a longer selection copies its first
//     COPY_MAX_WORDS words. Either way the credit follows on its own line.
//   • SELECTING is untouched, so Define keeps working. Samples follow the same rules.
//
// This file is the authority. The reader frame (public/reading-room.html) cannot import it, so the
// parent SENDS the frame the credit line and the word limit (setCopyRule), and the frame's copy
// handler applies them with the same arithmetic as copyText below; the print line is repeated in
// the frame's print CSS, and tests/ci/w24-reader-print-copy.test.mjs holds the two equal.
//
// Plain ESM, no imports, so the harness can run it under Node.
// ─────────────────────────────────────────────────────────────────────────────

// DRAFT — Ikenna rules the wording.
export const PRINT_LINE = 'Books in the Reading Room can’t be printed.';

// RULED as a number (93): 50 words.
export const COPY_MAX_WORDS = 50;

export const HOUSE_NAME = 'Calvary Scribblings';

/** Is this author the house itself? Case, spacing and stray punctuation aside. */
export const isHouseAuthor = (author) =>
  typeof author === 'string' && author.toLowerCase().replace(/[^a-z]+/g, ' ').trim() === HOUSE_NAME.toLowerCase();

/**
 * DRAFT — "— from {Title} by {Author} · Calvary Scribblings". Ikenna rules the wording.
 * RULED (104, 28 Sep): when the author IS the house, "by …" is dropped — "— from {Title} ·
 * Calvary Scribblings" — so a house title never reads "by Calvary Scribblings · Calvary Scribblings".
 */
export function creditLine({ title, author } = {}) {
  const t = typeof title === 'string' ? title.trim() : '';
  const a = typeof author === 'string' ? author.trim() : '';
  if (!t) return `— from ${HOUSE_NAME}`;
  return a && !isHouseAuthor(a) ? `— from ${t} by ${a} · ${HOUSE_NAME}` : `— from ${t} · ${HOUSE_NAME}`;
}

/**
 * The text that reaches the clipboard. The selection as selected when it is COPY_MAX_WORDS words
 * or fewer — line breaks and all — and otherwise its first COPY_MAX_WORDS words, cut where the
 * last of them ends. Then the credit, on its own line. An empty selection copies nothing.
 */
export function copyText(selected, credit, maxWords = COPY_MAX_WORDS) {
  const text = String(selected == null ? '' : selected).trim();
  if (!text) return '';
  const re = /\S+/g;
  let m, n = 0, end = text.length;
  while ((m = re.exec(text))) {
    n++;
    if (n === maxWords) { end = m.index + m[0].length; break; }
  }
  return `${text.slice(0, end)}\n${credit}`;
}
