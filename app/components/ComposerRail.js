'use client';

// The Open Pages composer's TOOLBAR — a vertical rail in the left margin (R39).
//
// ═══════════════════════════════════════════════════════════════════════════════════
// WHY A RAIL AND NOT A BAR, and it is why the two surfaces differ
// ═══════════════════════════════════════════════════════════════════════════════════
// On a phone the toolbar belongs above the keyboard, because that is where a thumb
// already is. On a laptop the keyboard IS already there and markdown shortcuts do most
// of the work, so a bar across the top of the writing area buys nothing and costs the
// one thing the surface is for: it puts furniture in the reading path, above the words,
// on a page whose argument is that the type is the interface.
//
// So the rail is present, out of the reading path, and NEVER crosses the measure. It is
// absolutely positioned in the left margin; below the width where a margin exists it is
// not rendered at all rather than being allowed to overlap the words.
//
// ═══════════════════════════════════════════════════════════════════════════════════
// ⚠ SVG ONLY, NO EMOJI — house rule, and this file is where it starts on the web
// ═══════════════════════════════════════════════════════════════════════════════════
// B, I, H and the quotation mark are SET IN CORMORANT, not drawn and not iconised. The
// house's own faces are more Calvary than any icon set, and a letter is not an emoji: a
// bold B rendered in the face the piece publishes in says "bold" better than a picture
// of a B ever could. Only the three glyphs with NO letterform — list, link, image — are
// drawn, and they are drawn to one specification so the set reads as one hand:
//
//   ONE stroke width (RAIL_STROKE), ONE size (RAIL_ICON), one linecap, one linejoin,
//   currentColor only. A second stroke width anywhere in this file is a bug.
//
// ⚠ ❦ and ✦ are typographic marks from the font, not emoji, and stay.
//
// ⚠ MARKDOWN, NEVER HTML. Every control inserts markdown text into the textarea. There
// is no rich-text model, no contentEditable and no sanitiser in this repo — R38 recorded
// that and it has not changed.
//
// ⚠ ACCESSIBILITY IS NOT OPTIONAL ON A WRITING SURFACE. Every control is a real
// <button> with a real accessible name, in the tab order, operable by Enter and Space
// for free. The rail is a <div role="toolbar"> with a label so a screen reader announces
// what the group is before its seven buttons.

import {
  RAIL_ICON, RAIL_STROKE, RAIL_BUTTON, RAIL_LEFT, RAIL_MIN_WIDTH,
  RAIL_CONTROLS, applyControl,
} from '../lib/composerRail';

export { RAIL_ICON, RAIL_STROKE, RAIL_BUTTON, RAIL_LEFT, RAIL_MIN_WIDTH, RAIL_CONTROLS, applyControl };

const svg = (paths) => (
  <svg
    width={RAIL_ICON}
    height={RAIL_ICON}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={RAIL_STROKE}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {paths}
  </svg>
);

// The three that have no letterform.
const IconList = svg(<><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.2 6h.01M3.2 12h.01M3.2 18h.01" /></>);
const IconLink = svg(<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>);
const IconImage = svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.4" /><path d="m21 16-4.5-4.5L7 20" /></>);

// The four that DO have a letterform, set in the house face.
function Letter({ children, style }) {
  return (
    <span
      aria-hidden="true"
      style={{
        fontFamily: "Cormorant Garamond, Georgia, serif",
        fontSize: 19,
        lineHeight: 1,
        display: 'block',
        ...style,
      }}
    >
      {children}
    </span>
  );
}

// data -> glyph. The three drawn ones by key; everything else is a letterform.
const DRAWN = { list: IconList, link: IconLink, image: IconImage };
const glyphFor = (c) => (c.drawn ? DRAWN[c.drawn] : (
  <Letter style={{ fontWeight: c.weight, fontStyle: c.italic ? 'italic' : undefined, fontSize: c.size }}>
    {c.letter}
  </Letter>
));

export function ComposerRail({ onControl, disabled, imageBusy, style, className }) {
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="vertical"
      data-composer-rail
      className={className}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, ...style }}
    >
      {RAIL_CONTROLS.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onControl(c)}
          disabled={disabled || (c.action === 'image' && imageBusy)}
          aria-label={c.name}
          title={c.name}
          data-rail-control={c.key}
          style={{
            width: RAIL_BUTTON,
            height: RAIL_BUTTON,
            display: 'grid',
            placeItems: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            padding: 0,
            // 4.07:1 on the ink ground — above the 3:1 UI minimum, and it lifts to full
            // cream on hover and focus. A rail that is legible at rest would compete
            // with the words, and a rail that is illegible is not a control.
            color: 'rgba(245,240,232,0.45)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.4 : 1,
            transition: 'color 140ms ease, background 140ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#c9a84c'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(245,240,232,0.45)'; }}
          onFocus={(e) => { e.currentTarget.style.color = '#c9a84c'; e.currentTarget.style.outline = '1px solid rgba(201,168,76,0.5)'; }}
          onBlur={(e) => { e.currentTarget.style.color = 'rgba(245,240,232,0.45)'; e.currentTarget.style.outline = 'none'; }}
        >
          {glyphFor(c)}
        </button>
      ))}
    </div>
  );
}
