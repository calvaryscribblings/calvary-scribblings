// A LINK THE HOUSE AUTHORED — R43.
//
// The Square renders no reader link, ever (see app/lib/squarePostBody.js for the
// ruling and the reason). An ATTACHMENT is the exception that proves it: the
// destination is chosen by the house — a published story, or an Open Pages piece
// the moderation flow has just approved — and it is drawn as a card rather than as
// a URL sitting in someone's sentence. Nothing a reader types can produce one.
//
// This replaces the old StoryEmbed, which knew only about stories and about the
// story record's exact field names. attachmentOf() in the contract module
// normalises a story and a piece into one shape first, so this file draws one
// thing. ⚠ An Open Pages piece is NOT shaped like a story — no category, no cover
// guaranteed, the author is the writer rather than a byline field — which is
// exactly why the normalising happens somewhere a test can reach.
//
// No JSX, for the same reason as PostBody: the test renders this.

import { createElement as h } from 'react';
import { BODY_FONT } from '../../lib/squarePostBody.js';

const EXTERNAL_ARROW = 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6';

export default function AttachmentCard({ attachment, compact = false }) {
  if (!attachment) return null;
  const { kind, href, eyebrow, title, byline, cover } = attachment;

  return h(
    'a',
    {
      href,
      'data-attachment': kind,
      style: {
        display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 10, padding: '9px 12px', marginTop: 8,
      },
    },
    h(
      'div',
      {
        style: {
          width: 32, height: 46, borderRadius: 3, overflow: 'hidden', flexShrink: 0,
          background: 'rgba(107,47,173,0.2)',
          // A piece usually has no cover. The well stays, so a card with art and a
          // card without are the same object at the same size rather than two
          // different-looking rows in one column.
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
      },
      cover
        ? h('img', { src: cover, alt: title, style: { width: '100%', height: '100%', objectFit: 'cover' } })
        // ❦ is a typographic mark from the font, not an icon and not an emoji —
        // R39 keeps it and requires it pinned to a text presentation, hence the
        // variant property, the U+FE0E selector and the serif stack.
        : h('span', {
            style: { fontFamily: BODY_FONT, fontVariantEmoji: 'text', fontSize: '0.9rem', color: 'rgba(155,109,255,0.7)' },
            'aria-hidden': 'true',
          }, '❦︎')
    ),
    h(
      'div',
      { style: { flex: 1, minWidth: 0 } },
      h('div', { style: { fontFamily: BODY_FONT, fontSize: '0.62rem', color: 'rgba(155,109,255,0.6)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 } }, eyebrow),
      h('div', { style: { fontFamily: BODY_FONT, fontSize: compact ? '0.78rem' : '0.82rem', color: '#f5f0e8', lineHeight: 1.3 } }, title),
      byline ? h('div', { style: { fontFamily: BODY_FONT, fontSize: '0.68rem', color: 'rgba(255,255,255,0.55)', marginTop: 1 } }, byline) : null
    ),
    h(
      'svg',
      { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: '#f5f0e8', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
      h('path', { d: EXTERNAL_ARROW }),
      h('polyline', { points: '15 3 21 3 21 9' }),
      h('line', { x1: 10, y1: 14, x2: 21, y2: 3 })
    )
  );
}
