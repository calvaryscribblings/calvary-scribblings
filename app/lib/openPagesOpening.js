// WHAT AN ENTRY SHOWS — the opening of a piece, taken the way the drop cap takes it.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭑⭑ EVERY ENTRY SHOWS THE WRITING.
// ═══════════════════════════════════════════════════════════════════════════════════
// Not a summary and not a truncated blurb — the piece's ACTUAL OPENING LINES, set in
// the reading face. Nobody taps an unknown writer because of a thumbnail; they tap
// because of a sentence. That is also why the feed cannot lean on covers: a design
// built around images looks broken on every piece that has none.
//
// ⚠ THIS IS A THIRD ADAPTER FOR app/lib/prosePredicate.js, NOT A SECOND EXCERPT RULE.
// That module already holds the only correct answer in this codebase to "which
// paragraph is the piece actually starting at?" — measured against 162 live story
// bodies and guarded by tests/ci/dropcap-openers.test.mjs. It skips content notes,
// epigraphs and section numerals. It operates on plain-object BLOCKS, and each caller
// supplies its own adapter:
//
//   dropcap.js          DOM element   → blockFromElement()
//   htmlBlocks.js       HTML string   → parseBlocks()
//   THIS FILE           MARKDOWN      → markdownBlocks()
//
// The old feed did `stripMarkdown(body).slice(0, 150)`. On "THE SHAPE I BECAME" that
// spends the whole excerpt on the section marker `**I. UNREAD**` and shows the reader
// nothing — measured, and it is exactly the failure prosePredicate exists to prevent.
//
// ⚠ AND IT NEVER STRIPS A WRITER'S OWN EMOJI. Today's no-emoji rule is about the
// house's CHROME. What a writer puts in their poem is their writing.

import { walkToProse } from './prosePredicate.js';

// ── VERSE OR PROSE ───────────────────────────────────────────────────────────────
// ⭑ THE PIECE'S OWN SHAPE SETS THE ENTRY'S SHAPE. Two treatments, not six: it gives
// the column a rhythm and it is honest about what the reader is about to meet.
//
// The test is SHAPE, not the genre field, because the genre is a label the writer
// picked from a menu and the line breaks are what they actually wrote. Measured
// against all seven live pieces on 4 Sep 2026, this classifies exactly the two poems
// as verse and the five prose pieces as prose — with the marker skip doing real work
// on the second poem, whose first block is `**I. UNREAD**`.
//
//   VERSE_MIN_LINES  a single line is a sentence, however short
//   VERSE_MAX_AVG    live poems average 26 and 34 characters a line; live prose
//                    blocks average 60, 106, 416, 546 and 1,828. The gap is wide,
//                    which is why a crude threshold is safe here.
export const VERSE_MIN_LINES = 2;
export const VERSE_MAX_AVG = 60;

/** Split markdown into top-level blocks: runs separated by a blank line. */
export function markdownBlocks(md) {
  return String(md || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** Strip the markdown furniture from ONE line, leaving the words. */
export function plainLine(line) {
  return String(line || '')
    .replace(/!\[[^\]]*\]\([^)\s]*\)/g, '')          // images vanish
    .replace(/\[([^\]]*)\]\([^)\s]*\)/g, '$1')        // links keep their text
    .replace(/^\s{0,3}#{1,6}\s+/, '')                 // heading marker
    .replace(/^\s{0,3}>\s?/, '')                      // blockquote marker
    .replace(/^\s{0,3}[-*+]\s+/, '')                  // list marker
    .replace(/^\s{0,3}\d+\.\s+/, '')                  // ordered list marker
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * Adapt a markdown block to the plain-object shape prosePredicate expects.
 *
 * ⚠ EVERY FIELD IS REQUIRED. prosePredicate's own note says an adapter that cannot
 * supply one is an adapter that will disagree with the other adapters, which is the
 * failure it exists to prevent. Markdown has no classes, so `classes` is always empty
 * and the exclusion work is done by `tag` and by isMarkerish() — which is the half
 * that catches `**I. UNREAD**`.
 */
export function blockFromMarkdown(raw) {
  const src = String(raw || '');
  const text = src.split('\n').map(plainLine).join(' ').trim();
  const tag = /^\s{0,3}>/.test(src) ? 'blockquote'
    : /^\s{0,3}#{1,6}\s/.test(src) ? 'h2'
    : /^\s{0,3}([-*+]|\d+\.)\s/.test(src) ? 'li'
    : 'p';
  const hasImg = /!\[[^\]]*\]\([^)\s]*\)/.test(src);
  // A block that is wholly wrapped in emphasis is markdown's epigraph — the same
  // thing `soleChild: {tag:'em'}` means to the DOM adapter.
  const whollyItalic = /^\*[^*]+\*$/.test(src.trim()) || /^_[^_]+_$/.test(src.trim());
  return {
    tag,
    classes: [],
    text,
    hasImg,
    ancestors: [],
    soleChild: whollyItalic ? { tag: 'em', textLength: text.length } : null,
  };
}

/**
 * The opening of a piece, ready to render.
 *
 * @returns {{kind:'verse'|'prose', lines:string[], skipped:number}}
 *   `lines` is already plain text — the entry sets it in the reading face and never
 *   renders markdown, because an entry is a taste of the piece and not the piece.
 */
export function openingOf(body, { maxLines = 4, maxChars = 260 } = {}) {
  const raw = markdownBlocks(body);
  if (!raw.length) return { kind: 'prose', lines: [], skipped: 0 };

  const blocks = raw.map(blockFromMarkdown);
  const { targetIndex } = walkToProse(blocks);
  // Every block was front matter — a piece that is nothing but markers. Show the
  // first block rather than nothing: something the writer typed beats an empty entry.
  const i = targetIndex == null ? 0 : targetIndex;

  const lines = raw[i].split('\n').map(plainLine).filter(Boolean);
  if (!lines.length) return { kind: 'prose', lines: [], skipped: i };

  const avg = lines.reduce((s, l) => s + l.length, 0) / lines.length;
  const kind = lines.length >= VERSE_MIN_LINES && avg <= VERSE_MAX_AVG ? 'verse' : 'prose';

  if (kind === 'verse') {
    // A stanza keeps its line breaks; showing four lines of a poem is showing the poem.
    return { kind, lines: lines.slice(0, maxLines), skipped: i };
  }

  // Prose runs. Cut on a word boundary and only when there is more to come — an
  // ellipsis on a complete opening is a lie about the length of the sentence.
  const text = lines.join(' ');
  if (text.length <= maxChars) return { kind, lines: [text], skipped: i };
  return { kind, lines: [`${text.slice(0, maxChars).replace(/\s+\S*$/, '')}…`], skipped: i };
}

/** Estimated reading time in whole minutes (~200 wpm), floored at 1. */
export function readingTime(body) {
  const words = String(body || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
