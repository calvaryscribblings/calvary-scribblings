// THE LIBRARY'S ROW CHROME — Just Added's header, side margins, 14px gap and horizontal scroll, and
// the card text styles every row on /public-library sets. Lifted out of app/public-library/page.js
// in CR-2 so Continue Reading (loaded on its own, by dynamic()) reuses them instead of restating
// them: a row that copies Just Added's numbers is a row that drifts from it.

// ── Typography system ───────────────────────────────────────────────────────
// DISPLAY for headings/titles, LABEL for kickers/badges/controls, BODY for meta.
export const DISPLAY = "'Cormorant Garamond', Georgia, serif";
export const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
export const BODY = "Cormorant Garamond, Georgia, serif";

// ── Unified section-header styles (used by every content row) ────────────────
export const kickerStyle = { fontFamily: LABEL, fontSize: '0.6rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 6, display: 'block' };
export const sectionTitleStyle = { fontFamily: DISPLAY, fontSize: '1.6rem', fontWeight: 600, color: '#f5f0e8', lineHeight: 1, margin: '4px 0 0' };

/** A card's writer line, as every library card sets it (Just Added adds its 0.65rem). */
export const cardAuthorStyle = { fontFamily: BODY, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(245,240,232,0.7)' };
/** Just Added's writer line exactly: 0.65rem (10.4px), 0.08em, uppercase, 70% cream. */
export const justAddedWriterStyle = { ...cardAuthorStyle, fontSize: '0.65rem' };

/** Just Added's section: its vertical air. */
export const SHELF_SECTION_STYLE = { padding: '0.75rem 0' };
/** Just Added's strip: 4% side margins, 14px between cards, scrolling sideways, no scrollbar. */
export const SHELF_STRIP_STYLE = { display: 'flex', gap: 14, overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '0.5rem', scrollbarWidth: 'none' };

/** Just Added's header: kicker over title, on the strip's left margin, 1rem above the cards. */
export function ShelfRowHeader({ kicker, title }) {
  return (
    <div data-reveal="up" style={{ paddingLeft: '4%', marginBottom: '1rem' }}>
      <span style={kickerStyle}>{kicker}</span>
      <h3 style={sectionTitleStyle}>{title}</h3>
    </div>
  );
}
