// THE ONE RENDERER EVERY SQUARE SURFACE DRAWS THROUGH — R43.
//
// Before this there were EIGHT independent draws of a post's text, each with its
// own font stack and its own opinion, and they disagreed in both directions: the
// feed rendered @mentions but collapsed every newline into one run-on line, while
// the permalink rendered paragraphs but drew mentions as plain text. Nothing was
// shared, so "fix the Square's paragraphs" meant finding eight divs, and the next
// person would have had to find them again.
//
// ⚠ WRITTEN WITH React.createElement AND NOT JSX, ON PURPOSE. A node --test file
// cannot import JSX, and the requirement for this round was to RENDER each of the
// eight surfaces rather than assert about them. Keeping this one file free of JSX
// is what lets tests/square/postbody.test.mjs import it and put real markup
// through react-dom/server. It is the same reason app/lib/composerRail.js is split
// out from app/components/ComposerRail.js — there, the contract is separated from
// the JSX; here, the renderer is small enough to simply have no JSX in it.
//
// The rules it enforces live in app/lib/squarePostBody.js, with the reasoning.

import { createElement as h } from 'react';
import { BODY_FONT, SURFACES, bodyOf, mentionHref } from '../../lib/squarePostBody.js';

const MENTION_COLOR = '#9b6dff';

/**
 * @param {string}  text     the post's stored text
 * @param {string}  surface  a key of SURFACES — the draw site names itself
 * @param {object}  style    per-site overrides (size only; never the paragraph rule)
 */
export default function PostBody({ text, surface, withdrawn = false, style }) {
  const spec = SURFACES[surface];
  // ⚠ AN UNKNOWN KEY IS A HARD FAILURE, NOT A FALLBACK. A ninth surface that
  // forgets to register itself in SURFACES must not be able to quietly render
  // with default styling and no paragraphs — that is precisely how the eight got
  // out of step. Loud in development, and the test walks SURFACES so a registered
  // key without a draw site is caught too.
  if (!spec) throw new Error(`PostBody: unknown surface "${surface}". Register it in SURFACES.`);

  // ⚠ THE WITHDRAWN CASE IS DECIDED HERE, ONCE, FOR ALL EIGHT. R33.2 claimed the
  // feed drew a tombstone; it drew an empty div, because the branch existed only on
  // the permalink. Eight copies of a branch is how that happened, so there is one.
  const paragraphs = withdrawn ? [] : bodyOf(text, { excerpt: spec.excerpt || null });

  const base = {
    fontFamily: BODY_FONT,
    fontSize: spec.fontSize,
    lineHeight: spec.lineHeight,
    color: spec.color,
    wordBreak: 'break-word',
    ...(spec.italic ? { fontStyle: 'italic' } : null),
    ...style,
  };

  if (withdrawn) {
    return h(
      'div',
      { style: { ...base, fontStyle: 'italic', color: 'rgba(245,240,232,0.35)' }, 'data-postbody': surface, 'data-withdrawn': 'true' },
      spec.withdrawnNote
    );
  }

  // An empty body still draws its container, so a blank record keeps its place in
  // the column rather than collapsing the card around it.
  if (paragraphs.length === 0) return h('div', { style: base, 'data-postbody': surface });

  return h(
    'div',
    { style: base, 'data-postbody': surface },
    paragraphs.map((segments, i) =>
      h(
        'p',
        {
          key: i,
          // The gap between thoughts, and nothing else. First paragraph flush so a
          // one-paragraph post — which is most of them — sits exactly where it sat
          // before this existed.
          style: { margin: i === 0 ? 0 : '0.62em 0 0' },
        },
        segments.map((seg, j) =>
          seg.type === 'mention'
            ? h(
                'a',
                {
                  key: j,
                  href: mentionHref(seg.handle),
                  style: { color: MENTION_COLOR, textDecoration: 'none', fontWeight: 500 },
                },
                seg.value
              )
            : seg.value
        )
      )
    )
  );
}
