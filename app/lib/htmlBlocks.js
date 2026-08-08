// HTML → top-level blocks, and the validation gate that refuses malformed bodies.
//
// No DOM, no dependencies, no imports. It has to run in three places that share
// nothing: the composer (browser), the audit script (bare Node) and the serving
// endpoint (a Cloudflare Worker). parse5 is present in node_modules only as a
// transitive dependency of something else, and a validation gate whose correctness
// rests on a package nobody declared is not a gate.
//
// ── WHAT IT IS, AND WHAT IT IS DELIBERATELY NOT ──────────────────────────────────
//
// This is NOT a general HTML parser and must never grow into one. It answers two
// questions about the ONE dialect of HTML that lives in cms_stories/<slug>/content —
// a flat sequence of block elements produced by convertToHTML() in the admin
// composer:
//
//   1. Where does each top-level block start and end, and what is in it?
//   2. Is every tag properly closed and properly nested?
//
// Anything it cannot answer with certainty, it REFUSES. See §4.2 rule 4 and §5.5 of
// STORY-SERVING-CONTRACT.md: a preview must be provably well-formed because the
// client drops it straight into a prose container with dangerouslySetInnerHTML, and
// unbalanced tags there do not stay inside the story. Guessing is the one thing this
// file is not allowed to do.

// Elements that never have a closing tag. `<br>` and `<img>` are the two that
// actually occur in story bodies; the rest are here so that a body which acquires
// one does not fail validation for a reason that is not a defect.
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// The block-level elements a story body is made of. Everything else encountered at
// the top level is inline content, which gets wrapped into an implicit block so no
// text is ever silently dropped.
const BLOCK_TAGS = new Set([
  'p', 'blockquote', 'figure', 'figcaption', 'ul', 'ol', 'li', 'div',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'pre', 'section', 'aside',
]);

/** Thrown by parseBlocks when the body cannot be trusted. Carries a machine code. */
export class MalformedHtmlError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'MalformedHtmlError';
    this.code = 'malformed_html';
    this.detail = detail || null;
  }
}

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

/** Class names off a raw attribute string, without a DOM. */
function classesFrom(attrs) {
  const m = /\bclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs || '');
  if (!m) return [];
  const raw = m[2] ?? m[3] ?? m[4] ?? '';
  return raw.split(/\s+/).filter(Boolean);
}

/** Text with tags stripped and entities decoded well enough to measure and match. */
function textOf(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&[a-zA-Z#0-9]+;/g, ' ');
}

/**
 * Split a story body into top-level blocks, validating as it goes.
 *
 * Returns an array of:
 *
 *   {
 *     html,        // the block's complete source, opening tag through closing tag
 *     tag, classes, text, hasImg, ancestors, soleChild,   // the prosePredicate shape
 *   }
 *
 * `ancestors` is always `[]` on a top-level block by definition; it is present
 * because prosePredicate.js requires every field, and because nested blocks
 * (`blockquote > p`) are NOT returned as separate entries — a blockquote is one
 * block, and the exclusion rules match it on its own tag. That is exactly the
 * behaviour `.closest('blockquote')` gives the drop-cap tagger.
 *
 * THROWS MalformedHtmlError on:
 *   - a closing tag with no matching opener
 *   - a closing tag that does not match the innermost open element (crossed nesting)
 *   - any element still open at the end of the body
 *
 * It does NOT throw on stray `<` or `>` in text, unknown element names, or missing
 * quotes on attributes. Those are ugly and harmless; the gate is about balance,
 * because balance is what decides whether a prefix can be closed cleanly.
 */
export function parseBlocks(html) {
  const src = String(html || '');
  const blocks = [];

  let depth = 0;
  const stack = [];
  let blockStart = -1;      // index in src where the current top-level block began
  let inlineStart = -1;     // index where loose inline content began, if any
  let cursor = 0;

  const pushBlock = (start, end) => {
    const raw = src.slice(start, end);
    if (!raw.trim()) return;
    const open = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/.exec(raw);
    const tag = open ? open[1].toLowerCase() : 'p';
    const attrs = open ? open[2] : '';
    const text = textOf(raw);
    if (!text.trim() && !/<img\b/i.test(raw)) return;   // whitespace-only, nothing to show

    // soleChild: exactly one element child inside the block, covering the whole of it.
    // Only the shallow case matters — isEntirelyItalic asks "is this paragraph one
    // <em>?" — so this looks for a single child element wrapping all the text.
    let soleChild = null;
    const inner = open ? raw.slice(open.index + open[0].length).replace(/<\/[a-zA-Z][^>]*>\s*$/, '') : raw;
    const only = /^\s*<([a-zA-Z][a-zA-Z0-9-]*)[^>]*>([\s\S]*)<\/\1>\s*$/.exec(inner);
    if (only && !/<[a-zA-Z]/.test(only[2].replace(/<\/?(b|i|em|strong|span)\b[^>]*>/gi, ''))) {
      soleChild = { tag: only[1].toLowerCase(), textLength: textOf(only[2]).trim().length };
    }

    blocks.push({
      html: raw,
      tag,
      classes: classesFrom(attrs),
      text,
      hasImg: /<img\b/i.test(raw),
      ancestors: [],
      soleChild,
    });
  };

  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(src)) !== null) {
    const tag = m[1].toLowerCase();
    const isClose = m[0][1] === '/';
    const selfClosing = /\/\s*>$/.test(m[0]);

    // Loose text before this tag, at the top level, becomes an implicit block so that
    // a body written without wrapping paragraphs still previews rather than vanishing.
    if (depth === 0 && !isClose && inlineStart === -1 && src.slice(cursor, m.index).trim()) {
      inlineStart = cursor;
    }

    if (VOID_TAGS.has(tag) || selfClosing) {
      if (depth === 0 && inlineStart === -1 && blockStart === -1) inlineStart = m.index;
      cursor = TAG_RE.lastIndex;
      continue;
    }

    if (!isClose) {
      if (depth === 0) {
        if (inlineStart !== -1) { pushBlock(inlineStart, m.index); inlineStart = -1; }
        blockStart = m.index;
      }
      stack.push({ tag, at: m.index });
      depth++;
    } else {
      if (!stack.length) {
        throw new MalformedHtmlError(
          `closing </${tag}> with nothing open`,
          { tag, offset: m.index, excerpt: src.slice(Math.max(0, m.index - 60), m.index + 40) },
        );
      }
      const top = stack[stack.length - 1];
      if (top.tag !== tag) {
        throw new MalformedHtmlError(
          `closing </${tag}> does not match open <${top.tag}> (crossed nesting)`,
          { tag, expected: top.tag, offset: m.index, excerpt: src.slice(Math.max(0, m.index - 60), m.index + 40) },
        );
      }
      stack.pop();
      depth--;
      if (depth === 0 && blockStart !== -1) {
        pushBlock(blockStart, TAG_RE.lastIndex);
        blockStart = -1;
      }
    }
    cursor = TAG_RE.lastIndex;
  }

  if (stack.length) {
    const open = stack[stack.length - 1];
    throw new MalformedHtmlError(
      `<${open.tag}> is never closed`,
      { tag: open.tag, offset: open.at, excerpt: src.slice(Math.max(0, open.at - 20), open.at + 80) },
    );
  }

  // Trailing loose text.
  if (src.slice(cursor).trim()) pushBlock(inlineStart === -1 ? cursor : inlineStart, src.length);
  else if (inlineStart !== -1) pushBlock(inlineStart, src.length);

  return blocks;
}

/**
 * The gate, as a boolean-with-a-reason, for callers that want to report rather than
 * throw — the composer's save path and the corpus audit both want the message.
 *
 *   { ok: true, blocks } | { ok: false, error, detail }
 */
export function validateBody(html) {
  try {
    return { ok: true, blocks: parseBlocks(html) };
  } catch (e) {
    if (e instanceof MalformedHtmlError) return { ok: false, error: e.message, detail: e.detail };
    throw e;
  }
}
