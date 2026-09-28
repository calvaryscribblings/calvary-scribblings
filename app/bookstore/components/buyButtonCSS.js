// W24 — THE BUY BUTTON'S STYLES, IN ONE PLACE.
//
// The book page (app/bookstore/[slug]/page-detail.js) and the Desiderata room
// (app/bookstore/components/RoomRow.js) both render BuyButton. Until W24 the room restated the
// book page's face and livery as .rr-buy, "because the book page's stylesheet is not on this
// page" — two copies of one button. Both now interpolate this.
//
//   .bd-cta  the face: the book page's buy AND sample controls share it (the R19.8 height rule —
//            see the note above its interpolation in page-detail.js).
//   .bd-buy  the BUY livery: gold, its hover, pending and unavailable states.
//
// The rules are byte for byte what stood in page-detail.js, so the book page is unchanged; the
// room takes both classes and states only its own SIZE (.rr-buy in RoomRow.js).
// ⚠ Template literal: no backticks in these comments or rules.
export const BUY_CSS = `
          .bd-cta{
            box-sizing:border-box;
            display:inline-flex;align-items:center;justify-content:center;
            font-family:'Cinzel',serif;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;font-weight:600;
            line-height:1.5;
            padding:.95rem 2.2rem;
            border:1px solid transparent;
            border-radius:3px;
            cursor:pointer;text-decoration:none}
          /* Livery only below — no padding, no border-width, no font metric. */
          .bd-buy{background:linear-gradient(135deg,#c9a44c,#a8842f);color:#0a0a0a;transition:filter .25s,opacity .25s}
          .bd-buy:hover{filter:brightness(1.08)}
          .bd-buy:disabled{cursor:progress;opacity:.6;filter:none}
          /* R8.4 — see the twin rule in app/bookstore/page.js. Unavailable is not pending.
             R19.8 — border-color, not border. See the height note above .bd-cta in page-detail.js. */
          .bd-buy[data-unavailable]{cursor:not-allowed;opacity:.55;background:none;border-color:rgba(201,164,76,.28);color:rgba(240,234,216,.55)}
`;

// W27 — THE GHOST FACE, beside the filled one. The book page's Read sample livery (.bd-sample),
// moved here verbatim so /membership's ghost buttons (CHOOSE PLATINUM, SWITCH TO, MANAGE, the
// pass BUYs) wear it without restating it. page-detail.js interpolates it where the rules stood.
export const GHOST_CSS = `
          .bd-sample{background:rgba(201,164,76,.04);border-color:rgba(201,164,76,.4);color:#c9a44c;transition:all .25s}
          .bd-sample:hover{background:rgba(201,164,76,.1);border-color:rgba(201,164,76,.7)}
`;
