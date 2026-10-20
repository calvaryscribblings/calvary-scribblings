// THE EIGHT MOTIF GLYPHS — hairline drawings, one stroke width, one size.
//
// House rule (R39): SVG only, never emoji. Each glyph is a list of SVG path strings on a
// 24 × 24 box, stroked and never filled, with round caps and joins. The same paths draw onto
// the card raster (Path2D) and into cards/glyphs/*.svg, so the review files and the print are
// one drawing.
//
// ONE SIZE: every glyph is drawn into a GLYPH_MM square (6 mm). ONE STROKE: GLYPH_STROKE_MM
// (0.15 mm, 0.43 pt) at that size, which is 0.6 units of the 24-unit box. Neither is varied per
// glyph, and neither is scaled when a card draws a glyph. The Ending cards and the Ring draw
// them at the same 6 mm as the corner indices.
//
// The drawings, as the brief proposed: Letter a sealed envelope · Secret a keyhole · Child a
// kite · Storm a rain cloud · Road a road narrowing to the horizon · House a pitched-roof house
// · Debt a cowrie shell · Fire a flame.
import { Path2D } from '@napi-rs/canvas';
import { GLYPH_MM, GLYPH_STROKE_MM } from './geometry.mjs';

export const BOX = 24;
export const STROKE_UNITS = (GLYPH_STROKE_MM / GLYPH_MM) * BOX;   // 0.6

export const GLYPHS = Object.freeze({
  Letter: [
    'M3 6.5 H21 V18.5 H3 Z',                    // the envelope
    'M3 6.5 L12 13.2 L21 6.5',                  // the flap
    'M3 18.5 L9.6 11.4 M21 18.5 L14.4 11.4',    // the folds
    'M12 11.4 A1.8 1.8 0 1 1 11.99 11.4 Z',     // the seal, on the flap's point
  ],
  Secret: [
    'M7 2.5 H17 A2 2 0 0 1 19 4.5 V19.5 A2 2 0 0 1 17 21.5 H7 A2 2 0 0 1 5 19.5 V4.5 A2 2 0 0 1 7 2.5 Z', // the plate
    'M10.6 11.6 A2.9 2.9 0 1 1 13.4 11.6 L14.6 17.6 H9.4 Z',                                            // the keyhole
  ],
  Child: [
    'M12 2 L18 8.5 L12 16 L6 8.5 Z',            // the kite
    'M12 2 V16 M6 8.5 H18',                     // the spars
    'M12 16 C10.2 17.6 13.8 18.8 12 20.4 C10.8 21.5 12.6 22.4 13.4 22.6', // the tail
    'M10.9 17.6 L12.3 17 M12.4 19.6 L13.6 20.4', // two bows on the tail
  ],
  Storm: [
    'M7 14.5 A3.8 3.8 0 0 1 6.6 7 A5.2 5.2 0 0 1 16.6 6.2 A3.9 3.9 0 0 1 17.4 14.5 Z', // the cloud
    'M8.2 16.8 L7 20 M12.2 16.8 L11 21.4 M16.2 16.8 L15 20',                           // the rain
  ],
  Road: [
    'M2 9 H22',                                 // the horizon
    'M3.5 22 L11 9.4 M20.5 22 L13 9.4',         // the edges, narrowing
    'M12 21.5 V19 M12 16.6 V14.9 M12 13.1 V12 M12 10.8 V10.2', // the centre line, shortening
  ],
  House: [
    'M3.5 11.5 L12 4 L20.5 11.5',               // the roof
    'M6 9.6 V21 H18 V9.6',                      // the walls
    'M10.4 21 V15.6 H13.6 V21',                 // the door
    'M15.6 7.2 V4.6 H17.4 V8.8',                // the chimney
  ],
  Debt: [
    'M12 2.5 C17 2.5 18.6 7.5 18.6 12 C18.6 16.5 17 21.5 12 21.5 C7 21.5 5.4 16.5 5.4 12 C5.4 7.5 7 2.5 12 2.5 Z', // the shell
    'M12 5.2 C11 8 13 10 12 12 C11 14 13 16 12 18.8',                                                            // the aperture
    'M11.5 7 H10.2 M12.5 9 H13.8 M11.5 11 H10.2 M12.5 13 H13.8 M11.5 15 H10.2 M12.5 17 H13.8',                     // its teeth
  ],
  Fire: [
    'M12 2.4 C14.6 6.4 18.4 9.4 18 15 C17.6 19.2 15 21.6 12 21.6 C9 21.6 6.4 19.2 6 15 C5.7 11.4 8 9.4 9.2 6.6 C10.2 9 10.4 10.6 11 11.8 C12 9.4 12.6 6 12 2.4 Z', // the flame
    'M12 21.6 C10.2 21.6 9.2 20 9.4 18.2 C9.6 16.4 11 15.6 11.6 13.8 C13.4 15.6 14.8 16.8 14.6 18.6 C14.4 20.4 13.4 21.6 12 21.6 Z', // the heart of it
  ],
});

export const GLYPH_NAMES = Object.freeze(Object.keys(GLYPHS));

/**
 * Draw `motif` with the glyph box's top-left at (x, y) in the CURRENT transform's units, the box
 * being `size` of those units. Stroke is set so it prints at GLYPH_STROKE_MM whatever the size.
 */
export function drawGlyph(ctx, motif, x, y, size, colour) {
  const paths = GLYPHS[motif];
  if (!paths) throw new Error(`no glyph for ${motif}`);
  const s = size / BOX;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = colour;
  ctx.lineWidth = STROKE_UNITS;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of paths) ctx.stroke(new Path2D(d));
  ctx.restore();
}

/** The standalone SVG for one glyph, at its print size. */
export function glyphSVG(motif, colour = '#1C1418') {
  const paths = GLYPHS[motif].map((d) => `  <path d="${d}"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GLYPH_MM}mm" height="${GLYPH_MM}mm" viewBox="0 0 ${BOX} ${BOX}" fill="none" stroke="${colour}" stroke-width="${STROKE_UNITS}" stroke-linecap="round" stroke-linejoin="round">
  <title>${motif}</title>
${paths}
</svg>
`;
}
