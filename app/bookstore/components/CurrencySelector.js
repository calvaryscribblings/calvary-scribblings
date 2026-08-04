'use client';
// THE CURRENCY LINE — R8.3, the approved mock.
//
//   PRICES IN   £ GBP · ₦ NGN · $ USD
//
// A CATALOGUE LINE, NOT A FORM CONTROL. The mock has no <select>, no chevron and no box, and
// that is the whole point: a native dropdown drops a system widget in the browser's own font
// into the middle of a page of hand-set type, and the shop stops looking like a shop. So the
// three currencies are set as a line of type with interpuncts between them, the active one in
// gold and underscored, exactly as the storefront sets its other catalogue lines.
//
// THEY ARE STILL REAL BUTTONS. Everything the native control would have given away is put back
// by hand rather than abandoned:
//   · <button> elements, so they are in the tab order and fire on Enter and Space for free
//   · role="group" with an accessible name, so the three read as one control
//   · aria-pressed on each, so a screen reader announces which currency is in force —
//     'pressed' is the right state here because these are three toggles of one setting, and
//     unlike aria-current it is announced by every major screen reader on a button
//   · a visible :focus-visible ring in the storefront's gold, because the underline alone
//     marks the SELECTED one and would say nothing about where the keyboard is
//
// THE UNDERLINE IS NOT THE ONLY SIGNAL. Colour plus an underscore plus aria-pressed means the
// active currency survives greyscale, colour-blindness and having the stylesheet fail.

import { CURRENCIES, CURRENCY_LABELS, CURRENCY_NAMES } from '../../lib/bookstore/currency';

export const CURRENCY_SELECTOR_CSS = `
  .cur-line{display:flex;align-items:baseline;justify-content:center;flex-wrap:wrap;
    gap:.55rem;margin:0 auto}
  .cur-eyebrow{font-family:'Cinzel',serif;font-size:.54rem;letter-spacing:.28em;
    text-transform:uppercase;color:rgba(240,234,216,.5)}
  .cur-opts{display:flex;align-items:baseline;gap:.4rem;flex-wrap:wrap;justify-content:center}
  .cur-sep{color:rgba(201,164,76,.35);font-size:.7rem;line-height:1}
  .cur-btn{background:none;border:none;padding:.15rem .1rem;cursor:pointer;
    font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.14em;text-transform:uppercase;
    color:rgba(240,234,216,.5);border-bottom:1px solid transparent;
    transition:color .2s,border-color .2s}
  .cur-btn:hover{color:rgba(240,234,216,.8)}
  /* The active one: gold, and underscored. Two signals, not one. */
  .cur-btn[aria-pressed="true"]{color:#c9a44c;border-bottom-color:rgba(201,164,76,.65)}
  .cur-btn:focus-visible{outline:1px solid #c9a44c;outline-offset:3px;border-radius:2px}

  /* The quiet line. Italic and muted — it is an aside, and it must never compete with the
     shelf beneath it. Its height is reserved in both states so switching currency does not
     shift the catalogue below by a line. */
  .cur-note{margin:.55rem 0 0;text-align:center;
    font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:.82rem;
    line-height:1.5;color:rgba(240,234,216,.42)}

  @media (prefers-reduced-motion:reduce){ .cur-btn{transition:none} }
`;

export default function CurrencySelector({ currency, onChange, chosen }) {
  return (
    <div className="cur-wrap">
      <div className="cur-line">
        <span className="cur-eyebrow" id="cur-label">Prices in</span>
        <div className="cur-opts" role="group" aria-labelledby="cur-label">
          {CURRENCIES.map((c, i) => (
            <span key={c} style={{ display: 'contents' }}>
              {i > 0 && <span className="cur-sep" aria-hidden="true">·</span>}
              <button
                type="button"
                className="cur-btn"
                aria-pressed={currency === c}
                onClick={() => onChange(c)}
                data-testid={`currency-${c}`}
              >
                {CURRENCY_LABELS[c]}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* TWO STATES, and the difference is whether the reader has ever chosen.
          Before: the line explains where the default came from, and that it is theirs to
          change — a price in the wrong currency with no visible cause is unsettling, and
          "we guessed from your connection" is the missing sentence.
          After: it confirms the choice stuck, so nobody has to come back next visit to find
          out whether it did.
          role="status" so the change is announced rather than silently repainted. */}
      <p className="cur-note" role="status" data-testid="currency-note">
        {chosen
          ? `Showing prices in ${CURRENCY_NAMES[currency]}. Remembered for next time.`
          : 'Set from where you are — change it whenever you like.'}
      </p>
    </div>
  );
}
