// PARAGRAPH TAGGING — which story paragraphs start flush left (Ikenna's ruling 22, 26 Sep 2026).
//
// ── THE RULING ───────────────────────────────────────────────────────────────────────────
// The opening paragraph, and the first paragraph after a scene break or a heading, are flush
// left, with or without a drop cap. Every other paragraph is indented, including one after a
// list, a blockquote or a figure. An indent written inline into a story body still wins.
//
//   scene break  the CMS's section-break paragraph, a bare "***", "* * *" or "— ✦ —"
//                paragraph, and <hr>
//   heading      h1–h6, and a poem's numeral (p.poem-numeral)
//
// A bold-paragraph subheading (p.prose-subhead, app/lib/subheadTag.js) is NOT a heading by
// this ruling, so the paragraph after one is indented. That is the ruling's list, kept as
// written.
//
// ── WHY A STRING TRANSFORM ───────────────────────────────────────────────────────────────
// For the reason subheadTag.js gives: story prose renders in the static export, on the client
// and in the offline shelf reader, and all three must agree before any script runs. So this is
// a pure string → string function applied inside the render, after tagSubheads (which only
// recognises a bare <p>, so it has to see the body before a class is added here).
//
// It adds one class, `para-flush`, to the paragraphs the ruling makes flush. proseCSS.js does
// the rest: an indent on every other top-level paragraph, 0 on `para-flush`. Inline styles
// outrank both, which is "an indent written inline still wins". The stored HTML is never
// touched; re-running this on its own output changes nothing.
//
// ── SCOPE ────────────────────────────────────────────────────────────────────────────────
// TOP-LEVEL paragraphs only: the story's own sequence of blocks. A paragraph inside a
// blockquote, a list item or a wrapper keeps the rule it always had (indented when it follows
// another paragraph), because the ruling is about the story's paragraphs, not a quotation's.
//
// Empty paragraphs (<p></p>, <p>&nbsp;</p>) are spacing, not paragraphs, so they are skipped
// when asking what came before: a heading, a spacer, then a paragraph is still "the first
// paragraph after a heading".
//
// The opening paragraph is the one the drop cap would take: prosePredicate.js's walk over the
// blocks htmlBlocks.js parses, past content notes, epigraphs and numerals. The drop-cap tagger
// (dropcap.js) runs the same predicate on the DOM, so the two agree; this one is what makes the
// opener flush when the punctuation guard withholds the cap, and before any script has run.
//
// A body the block parser refuses (unbalanced tags) gets no opener tag, and a body this
// scanner cannot follow is returned unchanged. The CSS then falls back to the paragraph after
// a paragraph being indented, which is what it did before this ruling.

import { parseBlocks } from './htmlBlocks.js';
import { isExcludedBlock, walkToProse } from './prosePredicate.js';

export const FLUSH_CLASS = 'para-flush';

// A bare scene-break paragraph: its whole text is one of these.
export const BREAK_TEXT_RE = /^(\*\*\*|\* \* \*|— ✦ —)$/;
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

function classesOf(attrs) {
  const m = /\bclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs || '');
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').split(/\s+/).filter(Boolean) : [];
}
function textOf(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;| /g, ' ')
    .replace(/&[a-zA-Z#0-9]+;/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Is this top-level element a scene break? */
export function isSceneBreak(el) {
  if (el.tag === 'hr') return true;
  if (el.tag !== 'p') return false;
  return el.classes.includes('section-break') || BREAK_TEXT_RE.test(el.text);
}
/** Is this top-level element a heading? */
export function isHeading(el) {
  return HEADING_TAGS.has(el.tag) || (el.tag === 'p' && el.classes.includes('poem-numeral'));
}

/** The top-level elements of a body, in order, with where each opening tag sits. null if unfollowable. */
function topLevel(src) {
  const els = [];
  const stack = [];
  let open = null;
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(src)) !== null) {
    const tag = m[1].toLowerCase();
    const isClose = m[0][1] === '/';
    const selfClosing = /\/\s*>$/.test(m[0]);
    if (VOID_TAGS.has(tag) || selfClosing) {
      if (!stack.length) els.push({ tag, attrs: m[2], at: m.index, end: TAG_RE.lastIndex, classes: classesOf(m[2]), text: '', hasImg: tag === 'img' });
      continue;
    }
    if (!isClose) {
      if (!stack.length) open = { tag, attrs: m[2], at: m.index, openEnd: TAG_RE.lastIndex };
      stack.push(tag);
    } else {
      if (!stack.length || stack[stack.length - 1] !== tag) return null;
      stack.pop();
      if (!stack.length && open) {
        const inner = src.slice(open.openEnd, m.index);
        els.push({ ...open, end: TAG_RE.lastIndex, classes: classesOf(open.attrs), text: textOf(inner), hasImg: /<img\b/i.test(inner) });
        open = null;
      }
    }
  }
  return stack.length ? null : els;
}

/** The source offset of the opening paragraph's tag, or null. Same walk as the drop cap. */
function openerAt(src) {
  let blocks;
  try { blocks = parseBlocks(src); } catch { return null; }
  // Each block's html is a verbatim slice, in order: find each one's offset from a cursor.
  let cursor = 0;
  const located = [];
  for (const b of blocks) {
    const at = src.indexOf(b.html, cursor);
    if (at < 0) return null;
    located.push({ ...b, at });
    cursor = at + b.html.length;
  }
  const candidates = located.filter((b) => !isExcludedBlock(b));
  const { targetIndex } = walkToProse(candidates);
  if (targetIndex === null) return null;
  const target = candidates[targetIndex];
  return target.tag === 'p' ? target.at : null;
}

/** The ruling as a list: for each top-level <p> with text, is it flush, and why. */
export function classifyParagraphs(html) {
  const src = String(html || '');
  const els = topLevel(src);
  if (!els) return null;
  const opener = openerAt(src);
  const out = [];
  let prev = null;
  for (const el of els) {
    const empty = el.tag === 'p' && !el.text && !el.hasImg;
    if (empty) continue;
    if (el.tag === 'p') {
      let why = null;
      if (el.at === opener) why = 'opening';
      else if (!prev) why = 'first';
      else if (isSceneBreak(prev)) why = 'after a scene break';
      else if (isHeading(prev)) why = 'after a heading';
      out.push({ at: el.at, attrs: el.attrs, text: el.text, flush: !!why, why });
    }
    prev = el;
  }
  return out;
}

/** The render-time transform: `para-flush` on every paragraph the ruling makes flush. */
export function tagParagraphs(html) {
  const src = String(html || '');
  const list = classifyParagraphs(src);
  if (!list) return src;
  let out = '';
  let cursor = 0;
  for (const p of list) {
    if (!p.flush) continue;
    // '<' + 'p' + its attributes + '>': the attribute string is exactly what the scanner read.
    const tagEnd = p.at + 2 + p.attrs.length;
    const openTag = src.slice(p.at, tagEnd + 1);
    if (!/^<p\b/i.test(openTag) || openTag[openTag.length - 1] !== '>') continue;
    let tagged;
    if (classesOf(p.attrs).includes(FLUSH_CLASS)) tagged = openTag;
    else if (/\bclass\s*=\s*"/i.test(openTag)) tagged = openTag.replace(/\bclass\s*=\s*"/i, (c) => `${c}${FLUSH_CLASS} `);
    else if (/\bclass\s*=\s*'/i.test(openTag)) tagged = openTag.replace(/\bclass\s*=\s*'/i, (c) => `${c}${FLUSH_CLASS} `);
    else tagged = openTag.replace(/^<p\b/i, `<p class="${FLUSH_CLASS}"`);
    out += src.slice(cursor, p.at) + tagged;
    cursor = tagEnd + 1;
  }
  return out + src.slice(cursor);
}
