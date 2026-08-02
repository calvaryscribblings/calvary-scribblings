// cs-inline-v1 — the newsletter's inline formatting contract.
//
// ⚠ MIRRORED INTO THE WORKER. workers-external/calvary-newsletter.worker.js
// carries a hand-copy of escapeHtml / renderInlineHtml / renderInlineText under
// the same lockstep rule as buildIndexRecordMirror: the Worker is
// dashboard-managed and single-file, so it cannot import this module. If the
// grammar changes here it MUST change there in the same commit, or the admin
// preview and the delivered mail disagree — and mail, once sent, cannot be
// patched. tests/newsletter/render.test.mjs is the contract; it runs against
// this copy, and the Worker copy must stay character-identical to it.
//
// WHY A HAND-WRITTEN PARSER AND NOT MARKDOWN
//
// The Worker is pasted into a dashboard textarea as one file. A markdown
// library cannot go there without bundling, which that workflow does not
// support. A purpose-built parser is small enough to mirror by hand, and — more
// importantly — it emits ONLY the tags in the table below. Output is constrained
// by construction, so there is no sanitiser to get wrong.
//
// THE GRAMMAR
//
//   **bold**            <strong>
//   *italic*            <em>
//   __underline__       <u style="text-decoration:underline;">
//   [text](https://…)   <a href style="color:#6b2fad;">
//   \* \_ \[ \] \\      the literal character
//
// `__` is underline rather than a second spelling of bold precisely because
// this parser is ours: there is no CommonMark ambiguity to inherit. A single
// _underscore_ is not a marker at all and survives as itself, which matters
// because file_names and snake_case appear in copy.
//
// ESCAPE FIRST, THEN SUBSTITUTE. The source is HTML-escaped in full before any
// marker is looked at, and the parser only ever re-introduces tags for markers
// it positively recognised. Anything it does not recognise — a stray `<`, an
// unclosed `**`, a [link](javascript:…) — stays escaped as literal text. There
// is no path by which author input becomes markup it did not ask for.

export const TEXT_FORMAT = 'cs-inline-v1';

// Placeholder sentinels. Stripped from the input first, so no author can forge
// one; U+0000/U+0001 have no business in newsletter copy in any case.
const L0 = '\u0000';
const E0 = '\u0001';
const SENTINELS = /[\u0000\u0001]/g;
const LINK_SLOT = /\u0000(\d+)\u0000/g;
const ESC_SLOT = /\u0001(\d+)\u0001/g;

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only http(s). A [text](javascript:…) or [text](data:…) is not a recognised
// marker, so it falls through and renders as the literal characters the author
// typed — visible, harmless, and obviously wrong to whoever is previewing it.
const SAFE_URL = /^https?:\/\//i;
const LINK = /\[([^\]\n]*)\]\(([^\s)]+)\)/g;
const BACKSLASH = /\\([*_[\]\\])/g;

// Order matters: ** before *, or `**x**` parses as an empty italic either side
// of x. __ is disjoint from both but runs in the middle for readability.
function emphasisHtml(s) {
  return s
    .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^\n]+?)__/g, '<u style="text-decoration:underline;">$1</u>')
    .replace(/\*([^\n*]+?)\*/g, '<em>$1</em>');
}

function emphasisStrip(s) {
  return s
    .replace(/\*\*([^\n]+?)\*\*/g, '$1')
    .replace(/__([^\n]+?)__/g, '$1')
    .replace(/\*([^\n*]+?)\*/g, '$1');
}

// Shared front half of both renderers: pull backslash escapes and links out
// into placeholder slots so neither can be touched by the emphasis pass. A URL
// containing ** or __ is not hypothetical — query strings and storage keys do
// it — and emphasis running inside an href would corrupt the link silently.
function extract(src) {
  let s = String(src ?? '').replace(SENTINELS, '');
  const escaped = [];
  s = s.replace(BACKSLASH, (_m, ch) => `${E0}${escaped.push(ch) - 1}${E0}`);
  const links = [];
  s = s.replace(LINK, (m, text, url) => {
    if (!SAFE_URL.test(url)) return m;
    return `${L0}${links.push({ text, url }) - 1}${L0}`;
  });
  return { s, escaped, links };
}

/**
 * One paragraph of cs-inline-v1 source → inline HTML.
 * Paragraph splitting and <p> wrapping belong to the caller — buildEmail keeps
 * its existing \n\n split — so this stays purely inline.
 */
export function renderInlineHtml(src) {
  const { s: raw, escaped, links } = extract(src);

  // Escape AFTER extraction so the escaper cannot mangle a URL's & into &amp;
  // twice, and BEFORE emphasis so no author markup survives as markup.
  let s = emphasisHtml(escapeHtml(raw));

  s = s.replace(LINK_SLOT, (_m, i) => {
    const { text, url } = links[Number(i)];
    return `<a href="${escapeHtml(url)}" style="color:#6b2fad;">${emphasisHtml(escapeHtml(text))}</a>`;
  });

  return s.replace(ESC_SLOT, (_m, i) => escapeHtml(escaped[Number(i)]));
}

/**
 * The same source → plain text, for the mail's text/plain part. Derived from
 * the identical string the HTML came from, so the two parts cannot drift.
 * Not escaped — this is text, not markup.
 */
export function renderInlineText(src) {
  const { s: raw, escaped, links } = extract(src);

  let s = emphasisStrip(raw);

  s = s.replace(LINK_SLOT, (_m, i) => {
    const { text, url } = links[Number(i)];
    return `${emphasisStrip(text)} (${url})`;
  });

  return s.replace(ESC_SLOT, (_m, i) => escaped[Number(i)]);
}

// ── Block-level projection ───────────────────────────────────────────────────
//
// Everything above is inline-only. These two are what the admin preview needs
// to stop lying, and they exist because the preview and the mail were reaching
// the same content by different routes.
//
// buildEmail — and its Worker mirror — splits a text block's SOURCE on blank
// lines, trims each piece, drops the empties, and renders what remains through
// the format gate. The preview used to render `content` verbatim under
// `white-space: pre-wrap`, which got both halves wrong: markers showed as
// literal asterisks, and a SINGLE newline looked like a line break when in the
// mail it collapses to a space. Same source, two different pictures.
//
// The Worker keeps this segmentation inline inside buildEmail rather than in a
// function, so there is nothing there to mirror by name. What pins the two
// together is tests/newsletter/preview-parity.test.mjs, which asserts the
// paragraphs produced here are exactly the paragraphs buildEmail emits.

export function splitParagraphs(content) {
  return String(content ?? '')
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * A text block → its paragraphs as inline HTML, format gate applied.
 *
 * The gate is the whole reason this is one function and not a call site: a
 * block WITHOUT a format field — every saved draft and every one of the seven
 * sent issues predating cs-inline-v1 — is escaped, never parsed. An
 * unrecognised format value fails CLOSED to escaping for the same reason. This
 * is the same branch the Worker's buildEmail takes; if the preview chose
 * differently, it would show formatting on blocks that mail out as literal
 * asterisks, or vice versa.
 */
export function renderTextBlockParagraphs(block) {
  const b = block || {};
  const inline = b.format === TEXT_FORMAT ? renderInlineHtml : escapeHtml;
  return splitParagraphs(b.content).map((p) => inline(p));
}
