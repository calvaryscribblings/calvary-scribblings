// The composer rail's CONTRACT — geometry, the control set, and what each inserts.
//
// Pure: no JSX, no React, no DOM. Split from app/components/ComposerRail.js so the
// geometry that keeps the rail out of the reading path, and the markdown each control
// produces, can be TESTED rather than described. The component adds the glyphs.

export const RAIL_ICON = 17;      // px — the ONE size for a drawn glyph
export const RAIL_STROKE = 1.25;  // px — the ONE stroke width
export const RAIL_BUTTON = 32;    // px — the hit target, and half of the geometry below

// THE GEOMETRY THAT KEEPS THE RAIL OUT OF THE READING PATH. The rail is absolutely
// positioned at this offset from the measure's left edge; negative, so it sits in the
// margin. RAIL_LEFT + RAIL_BUTTON <= 0 is the invariant — the moment it goes positive
// the rail is inside the measure and crossing the words, which is the one thing it must
// never do. Exported so the test computes it rather than trusting a comment.
export const RAIL_LEFT = -64;

// Below this width the measure needs the whole window, so the rail is ABSENT rather
// than overlapped. Kept here so the CSS media query and the test read one number.
export const RAIL_MIN_WIDTH = 901;

// ═══════════════════════════════════════════════════════════════════════════════════
// THE SECOND TREATMENT — the phone bar. R41.
// ═══════════════════════════════════════════════════════════════════════════════════
// R39 built the rail and specified that it hides below RAIL_MIN_WIDTH because there is
// no margin to hold it. That was correct and it was half a design: a writer on a phone
// got NO formatting controls at all.
//
// ⚠ THE TWO TREATMENTS ARE NOT A PRIMARY AND A FALLBACK. They answer different
// questions. On a pointer surface the keyboard is already present and the margin is
// free, so the controls sit out of the reading path in the margin. On a phone there is
// no margin and the thumb is at the bottom of the device, so the controls go where the
// thumb already is. Same seven controls, same order, same weight — a different place,
// for a reason that belongs to the device and not to the screen size.
//
// 48px targets. Apple's HIG and the WCAG 2.2 target-size minimum both land at ~44–48;
// the rail's 32px is a pointer target and would be a miss on a thumb.
export const BAR_BUTTON = 48;
export const BAR_HEIGHT = 52;   // the button plus a hairline and a little air

/**
 * ⚠ HOW FAR THE KEYBOARD HAS COVERED THE PAGE — the whole of the phone treatment.
 *
 * A bar at `position: fixed; bottom: 0` sits at the bottom of the LAYOUT viewport,
 * which on iOS Safari does NOT shrink when the keyboard opens. So the naive bar is
 * underneath the keyboard and invisible, and that is the commonest way this is got
 * wrong. What shrinks is the VISUAL viewport.
 *
 * The inset is the strip of layout viewport that the visual viewport no longer covers:
 *
 *     innerHeight ──────────── bottom of the layout viewport
 *        ↑ inset               (the keyboard is in here)
 *     offsetTop + height ───── bottom of the visual viewport   ← the bar goes here
 *
 * Pure so the arithmetic can be tested, because the thing it is protecting against is
 * invisible in any harness without a real soft keyboard.
 *
 * @returns {number} px to lift the bar by; 0 when no keyboard is up.
 */
export function keyboardInset({ innerHeight, height, offsetTop } = {}) {
  if (![innerHeight, height, offsetTop].every((n) => typeof n === 'number' && Number.isFinite(n))) return 0;
  const inset = innerHeight - (offsetTop + height);
  // Negative means the visual viewport extends past the layout viewport — overscroll
  // rubber-banding does this on iOS. Never lift the bar off the bottom of the screen.
  // A tiny positive value is browser chrome settling, not a keyboard.
  return inset > 1 ? Math.round(inset) : 0;
}

// The seven controls, as data. `wrap` is [before, after] around the selection; `line`
// is a prefix applied at the start of the line; `action` is handled by the composer.
// `letter` is the character to set in Cormorant — a letter is not an emoji, and the
// house's own face says "bold" better than a picture of a B. The three with no
// letterform are drawn, and only those three.
export const RAIL_CONTROLS = Object.freeze([
  { key: 'bold',   name: 'Bold',         letter: 'B', weight: 700, wrap: ['**', '**'] },
  { key: 'italic', name: 'Italic',       letter: 'I', italic: true, wrap: ['*', '*'] },
  { key: 'head',   name: 'Heading',      letter: 'H', weight: 600, line: '## ' },
  { key: 'quote',  name: 'Quotation',    letter: '“', weight: 600, size: 23, line: '> ' },
  { key: 'list',   name: 'List',         drawn: 'list' },
  { key: 'link',   name: 'Link',         drawn: 'link', wrap: ['[', '](url)'] },
  { key: 'image',  name: 'Insert image', drawn: 'image', action: 'image' },
]);

// The `list` control's prefix lives here rather than inline so every control's markdown
// is in one table.
export const LIST_PREFIX = '- ';

/**
 * Apply a control to a textarea's current selection. PURE — given the text and the
 * selection it returns the next text and where the caret should land, so the behaviour
 * is testable without a DOM.
 *
 * ⚠ IT PRODUCES MARKDOWN, NEVER HTML. There is no sanitiser in this repo and R38
 * recorded that; a rich-text model here would be a security decision disguised as a
 * design one.
 */
export function applyControl(control, text, selStart, selEnd) {
  const before = text.slice(0, selStart);
  const sel = text.slice(selStart, selEnd);
  const after = text.slice(selEnd);

  if (control.wrap) {
    const [a, b] = control.wrap;
    return { text: `${before}${a}${sel}${b}${after}`, caret: selStart + a.length + sel.length };
  }
  const line = control.line || (control.key === 'list' ? LIST_PREFIX : null);
  if (line) {
    // Walk back to the start of the line so a prefix lands where a prefix belongs,
    // rather than in the middle of the sentence the caret happens to be inside.
    const lineStart = before.lastIndexOf('\n') + 1;
    const head = text.slice(0, lineStart);
    const rest = text.slice(lineStart);
    return { text: `${head}${line}${rest}`, caret: selStart + line.length };
  }
  return { text, caret: selEnd };
}
