'use client';
// THE BAR — a hairline on the ground, the fill in gold, the label in Cinzel beside it. One
// component, drawn by My Library (a held book's progress) and Continue Reading (a started piece's),
// lifted out of app/my-library/page.js in CR-2 so the two cannot drift. Its arithmetic is
// app/lib/readingBar.js.
//
// The row is a fixed 12px whether or not the label has text, so an untouched book's hairline sits
// exactly where a started one's does: the label keeps its line even when empty (the app's A-round
// finding: an empty label collapses). The bar sets no margin of its own; where it sits is the
// caller's (My Library: 8px under the author; Continue Reading: pinned to the card's foot).
//
// The stylesheet is one React 19 hoisted <style> (href + precedence), so twenty bars on a page put
// one rule set in the head, not twenty.
import { barFor, barLabel } from '../lib/readingBar';

const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

export const READING_BAR_CSS = `
        .ml-bar { display: flex; align-items: center; gap: 7px; height: 12px; }
        .ml-bar-track { position: relative; flex: 1; height: 2px; border-radius: 1px; overflow: hidden; background: rgba(245,240,232,.16); }
        .ml-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 1px; background: linear-gradient(90deg, #a8842f, #e2c876); }
        .ml-bar-l { font-family: ${LABEL}; font-size: 7.5px; letter-spacing: .12em; line-height: 12px; color: rgba(245,240,232,.72); white-space: nowrap; }
`;

export default function ReadingBar({ progress, className }) {
  const bar = barFor(progress);
  return (
    <div className={className ? `ml-bar ${className}` : 'ml-bar'} data-bar={bar.kind}>
      <style href="cs-reading-bar" precedence="default">{READING_BAR_CSS}</style>
      <span className="ml-bar-track" aria-hidden="true">
        {bar.kind !== 'unstarted' && (
          <span className="ml-bar-fill" style={{ width: bar.kind === 'finished' ? '100%' : `${bar.percent}%` }} />
        )}
      </span>
      <span className="ml-bar-l">{barLabel(bar) || ' '}</span>
    </div>
  );
}
