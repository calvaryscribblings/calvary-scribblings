// HOUSE MOTION — the ladder, and the press.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────
//
// The app repo collapsed 161 bespoke transform scales at eight different numbers onto ONE
// press token, and that collapse is most of why the app reads as one surface rather than a
// pile of screens. The web has been drifting the same way: PRESS_SCALE / PRESS_MS are
// written out twice today, byte-identical but unlinked —
//
//   app/components/Gateway.js:42-44
//   app/voices/voices-client.js:36-38
//
// Two copies that agree are one rename away from two copies that do not. This module is the
// third caller declining to become the third copy.
//
// ⚠ THE TWO EXISTING COPIES ARE NOT COLLAPSED YET. Both sit on launch-critical surfaces
// (the gateway is the entry door, /voices carries a view transition) and neither has a test
// that would catch a regression from the edit. Collapsing them is a real follow-up, not a
// no-op — do it with the render check, not as a drive-by.
//
// ── THE PRESS ────────────────────────────────────────────────────────────────────────────
//
// One value. A row yields 1.5% under the finger for 90ms. It is not tuned per surface and
// there is no second number for "bigger" or "smaller" things.
export const PRESS_SCALE = 0.985;
export const PRESS_MS = 90;

// ── THE LADDER ───────────────────────────────────────────────────────────────────────────
//
// Every duration on this platform comes from these five rungs. They are shared with the app
// repo, where they were derived; a new duration is a new rung and a new rung is a decision,
// not a convenience. If a stagger or an entrance wants a number that is not here, the
// answer is one of these or the motion does not ship.
//
//   hair   135   a hairline appearing, a colour turning
//   quick  180   a mark, a caret, a small element arriving
//   base   240   the default — a row, a block, a group
//   slow   320   a section, something with weight
//   veil   427   a curtain, a whole-screen change
export const MOTION = { hair: 135, quick: 180, base: 240, slow: 320, veil: 427 };

// The damping ratio for anything spring-shaped. Under 1, so it settles rather than snapping,
// but high enough that it never visibly overshoots twice.
export const ZETA = 0.820;

// ── REDUCED MOTION IS A DIFFERENT PATH, NOT THE SAME PATH RUN FAST ───────────────────────
//
// The wrong implementation is `duration: prefersReduced ? 0 : 240` — that is the same
// animation, rushed, and it still moves. The right one is a path BORN AT ITS FINAL VALUE:
// no translate, no scale, opacity only if anything at all.
//
// ⚠ PRESS FEEDBACK SURVIVES IT. A control that stops answering the finger is broken, not
// calm — reduced motion means "do not move the page at me", never "stop telling me the tap
// landed". So the press transform is deliberately NOT inside the reduced-motion guard, and
// any future @media (prefers-reduced-motion: reduce) block on this surface must leave
// .is-pressable:active alone.
export const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
