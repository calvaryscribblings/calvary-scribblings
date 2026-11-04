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

const KIND = {
  heart: (c) => <path d="M12 19.2s-6.8-4.2-6.8-9a3.7 3.7 0 0 1 6.8-2 3.7 3.7 0 0 1 6.8 2c0 4.8-6.8 9-6.8 9Z" fill={c} />,
  speech: (c) => <path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-7.5L7.5 19.6V16.5H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5Z" fill={c} />,
  envelope: (c) => <g fill="none" stroke={c} strokeWidth="2.2" strokeLinejoin="round"><rect x="4" y="6.5" width="16" height="11" rx="1.6" /><path d="m4.5 7.5 7.5 6 7.5-6" /></g>,
  person: (c) => <g fill={c}><circle cx="12" cy="8.6" r="3.4" /><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0Z" /></g>,
  // An open book: two pages from a spine, outlined, so it reads at 11px.
  book: (c) => <g fill="none" stroke={c} strokeWidth="2.3" strokeLinejoin="round"><path d="M12 7.2C10.2 5.7 7 5.4 3.8 6.4v11.4c3.2-1 6.4-.7 8.2.8 1.8-1.5 5-1.8 8.2-.8V6.4C17 5.4 13.8 5.7 12 7.2Z" /><path d="M12 7.2v11.4" /></g>,
};

/** The 18px (16px in the panel) kind badge: a coloured disc with its glyph. */
export function KindBadge({ badge, kind, size = 18, ring = '#0A0A0A', colors }) {
  const b = colors[badge];
  if (!b) return null;
  const glyph = badge === 'slate' && kind === 'follow' ? 'person' : b.glyph;
  return (
    <span data-kind-badge={badge} style={{ position: 'absolute', right: -3, bottom: -3, width: size, height: size, borderRadius: '50%', background: b.ground, boxShadow: `0 0 0 2px ${ring}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <S size={Math.round(size * 0.62)}>{KIND[glyph](b.ink)}</S>
    </span>
  );
}

/** The sender-less tiles: the Square's diamond, a tier-up's star, Open Pages' feather. Gold. */
export function Tile({ tile, size = 40 }) {
  const g = '#C9A84C', ink = '#14121C';
  const glyph = {
    diamond: <path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" fill={ink} />,
    star: <path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6Z" fill={ink} />,
    feather: <g fill="none" stroke={ink} strokeWidth="1.9" strokeLinecap="round"><path d="M19 5c-6 0-11 4.5-12.5 13" /><path d="M19 5c0 6-4 10.5-10 11.3M11.5 12.5H16" /></g>,
  }[tile];
  return (
    <span data-tile={tile} style={{ width: size, height: size, borderRadius: 10, background: g, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <S size={Math.round(size * 0.55)}>{glyph}</S>
    </span>
  );
}
