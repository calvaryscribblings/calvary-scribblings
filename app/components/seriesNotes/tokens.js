// READERS' NOTES — the approved canvas as constants (W46). No JSX, no backticks in CSS comments.
export const DISPLAY = "'Cormorant Garamond', Georgia, serif";
export const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

export const C = Object.freeze({
  ground: '#080610',
  headerTop: '#14082a',
  card: '#0d0a18',
  border: 'rgba(255,255,255,0.10)',
  gold: '#c9a84c',
  goldTint: '#e2c47a',
  cream: '#f5f0e8',
  muted: 'rgba(245,240,232,0.72)',
  quiet: 'rgba(245,240,232,0.64)',
  link: '#c4b5fd',
  violet: '#7c3aed',
  violetHi: '#a855f7',
  seal: '#5a1d2a',
  sealRim: '#7a2c3b',
  sealInk: '#f3d9b0',
});

export const PRIMARY_BG = `linear-gradient(135deg, ${C.violet}, ${C.violetHi})`;

/** Small Cinzel label, 9–10px, tracked (the canvas). */
export const labelStyle = (color = C.gold, size = 9.5) => ({
  fontFamily: LABEL, fontSize: size, letterSpacing: '0.28em', textTransform: 'uppercase', color, fontWeight: 600,
});

/** The question, italic 500 at 19–27px. */
export const questionStyle = (size = 21) => ({
  fontFamily: DISPLAY, fontStyle: 'italic', fontWeight: 500, fontSize: size, lineHeight: 1.3, color: C.cream, margin: 0,
});

/**
 * The shared stylesheet for every Readers' Notes surface. Motion lives here so the one
 * prefers-reduced-motion block turns all of it off.
 */
export const NOTES_CSS = `
.sn-btn { min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 999px; cursor: pointer; font-family: ${LABEL}; font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; font-weight: 600; padding: 0 18px; border: 1px solid transparent; text-decoration: none; }
.sn-btn:focus-visible, .sn-text:focus-visible, .sn-card-btn:focus-visible, .sn-door:focus-visible { outline: 2px solid ${C.link}; outline-offset: 2px; }
.sn-primary { background: ${PRIMARY_BG}; color: #fff; }
.sn-primary[disabled] { opacity: 0.5; cursor: default; }
.sn-secondary { background: transparent; color: ${C.cream}; border-color: rgba(255,255,255,0.22); }
.sn-gold { background: transparent; color: ${C.goldTint}; border-color: rgba(201,168,76,0.5); }
.sn-text { min-height: 44px; min-width: 44px; background: none; border: none; cursor: pointer; color: ${C.quiet}; font-family: ${DISPLAY}; font-size: 16px; padding: 0 8px; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
.sn-link { color: ${C.link}; }
.sn-card { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 14px; }
.sn-card-btn { all: unset; box-sizing: border-box; cursor: pointer; display: block; width: 100%; }
.sn-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.sn-bar-fill { transition: width 600ms cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes sn-rise { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes sn-fade { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes sn-breathe { 0%, 100% { opacity: var(--sn-light, 1); } 50% { opacity: calc(var(--sn-light, 1) * 0.55); } }
@keyframes sn-shimmer { 0% { opacity: 0.5; } 50% { opacity: 0.8; } 100% { opacity: 0.5; } }
.sn-rise { animation: sn-rise 320ms cubic-bezier(0.16, 1, 0.3, 1); }
.sn-pop { animation: sn-fade 320ms cubic-bezier(0.16, 1, 0.3, 1); }
.sn-breathes { animation: sn-breathe 5.5s ease-in-out infinite; }
.sn-skel { animation: sn-shimmer 1.6s ease-in-out infinite; background: rgba(255,255,255,0.05); border-radius: 6px; }
@media (prefers-reduced-motion: reduce) {
  .sn-bar-fill, .sn-rise, .sn-pop, .sn-breathes, .sn-skel { animation: none !important; transition: none !important; }
}
`;
