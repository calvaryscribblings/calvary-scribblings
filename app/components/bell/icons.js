// NOTIF-B2 — the bell's glyphs. SVG only (house rule: no emoji, R39). Each takes size and colour;
// strokes are drawn at the sizes the design names.

const S = ({ size, children, viewBox = '0 0 24 24', title }) => (
  <svg width={size} height={size} viewBox={viewBox} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} focusable="false" style={{ display: 'block' }}>
    {title ? <title>{title}</title> : null}
    {children}
  </svg>
);

/** The bell, outline, stroke 1.8. */
export function BellGlyph({ size = 18, color = '#EFE8DA', stroke = 1.8 }) {
  return (
    <S size={size}>
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 1.9H4.4L6 16.5Z" fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round" />
      <path d="M9.8 20.6a2.4 2.4 0 0 0 4.4 0" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" />
    </S>
  );
}

export function SlidersGlyph({ size = 14, color = '#A9A4B5', stroke = 1.7 }) {
  return (
    <S size={size}>
      <g fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round">
        <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
        <circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
      </g>
    </S>
  );
}

export function MoonGlyph({ size = 16, color = '#A39CB2' }) {
  return <S size={size}><path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1Z" fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" /></S>;
}

// ── BELL-1: the kind badges and the sender-less tiles, as Ikenna's approved canvas draws them ───
// Glyphs on a 24 viewBox, round caps and joins. Paths exactly as the canvas gives them.
const GLYPHS = {
  heart: { fill: true, d: ['M12 20.5s-7.5-4.6-7.5-10.4A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.7c0 5.8-7.5 10.4-7.5 10.4z'] },
  arrow: { d: ['M10 7L5 12l5 5 M5 12h9a5 5 0 0 1 5 5v1'] },
  at: { circle: [12, 12, 3.5], d: ['M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7'] },
  bubble: { d: ['M5 5h14v10H10l-5 4z'] },
  message: { d: ['M4 5h16v11H11l-5 4v-4H4z'] },
  follow: { circle: [9, 8, 3.5], d: ['M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5 M18 8v6M15 11h6'] },
  book: { d: ['M3.5 6c2.8-1.2 5.8-1 8.5 1 2.7-2 5.7-2.2 8.5-1v12.5c-2.8-1.2-5.8-1-8.5 1-2.7-2-5.7-2.2-8.5-1z M12 7v12.5'] },
  diamond: { d: ['M12 3.5l8.5 8.5-8.5 8.5L3.5 12z'] },
  feather: { d: ['M19.5 4.5C13 5 8.5 9.5 7 16l-1.5 3.5 M19.5 4.5c.4 5.6-3 10-9.8 11.3 M8.6 12.6h6'] },
  star: { d: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'] },
};

/** One glyph: filled, or stroked with round caps and joins. */
function Glyph({ name, size, color, stroke }) {
  const g = GLYPHS[name];
  if (!g) return null;
  const paint = g.fill ? { fill: color, stroke: 'none' } : { fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <S size={size}>
      {g.circle ? <circle cx={g.circle[0]} cy={g.circle[1]} r={g.circle[2]} {...paint} /> : null}
      {g.d.map((d) => <path key={d} d={d} {...paint} />)}
    </S>
  );
}

/** Each kind's badge glyph: replies the arrow, mentions the @, responses and quotes the bubble. */
const GLYPH_OF_KIND = {
  reply: 'arrow', square_reply: 'arrow', square_reply_to_you: 'arrow', open_pages_reply: 'arrow',
  mention: 'at', quote: 'bubble', square_quote: 'bubble', response: 'bubble',
  message: 'message', follow: 'follow',
  reaction: 'heart', story_reaction: 'heart', new_story: 'book',
};

/**
 * The kind badge: a coloured circle (16px in the panel, 18px on the page) at right −4, bottom −4 of
 * the picture's box, ringed 2px in the row's ground, with a 9px (10px) glyph.
 */
export function KindBadge({ badge, kind, size = 18, glyph = 10, ring = '#0A0A0A', colors }) {
  const b = colors[badge];
  if (!b) return null;
  const name = GLYPH_OF_KIND[kind] || b.glyph;
  return (
    <span data-kind-badge={badge} data-glyph={name} style={{ position: 'absolute', right: -4, bottom: -4, width: size, height: size, borderRadius: '50%', background: b.ground, boxShadow: `0 0 0 2px ${ring}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Glyph name={name} size={glyph} color={b.ink} stroke={b.stroke} />
    </span>
  );
}

/** The sender-less tiles: dark circles with a 1px inner ring. The Square, Open Pages, and tier-ups, badges and rewards. */
export const TILES = Object.freeze({
  diamond: { ground: '#1A1728', ring: '#2A2640', ink: '#C9A84C', stroke: 1.8 },
  feather: { ground: '#1C1A26', ring: '#2A2640', ink: '#EFE8DA', stroke: 1.7 },
  star: { ground: '#241E10', ring: '#4A3D1C', ink: '#C9A84C', stroke: 1.7 },
});

export function Tile({ tile, size = 40, glyph = 18 }) {
  const t = TILES[tile];
  if (!t) return null;
  return (
    <span data-tile={tile} style={{ width: size, height: size, borderRadius: '50%', background: t.ground, boxShadow: `inset 0 0 0 1px ${t.ring}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Glyph name={tile} size={glyph} color={t.ink} stroke={t.stroke} />
    </span>
  );
}
