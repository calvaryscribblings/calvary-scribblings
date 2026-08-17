// HOUSE GOLD — the editorial-furniture colour, as a TONE PAIR.
//
// ── THE RULING (R12.5) ───────────────────────────────────────────────────────────────────
// Gold is the editorial-furniture colour; violet stays a UI/brand accent. That is ONE
// decision — a decision about HUE — and it is not up for re-litigation per surface.
//
// What IS per-surface is TONE. The same hue that reads as antique gold on a near-black
// ground reads as washed-out sand on cream, and the story reading surface is cream. So the
// hue ruling is expressed as two tones of one hue, and each ground takes the tone that
// serves it. Callers pick by GROUND, never by taste.
//
// ── ON_DARK — unchanged, exact ───────────────────────────────────────────────────────────
// #c9a84c is house gold as it has always been, and it stays byte-exact. The app repo's dark
// reading surface consumes this value unchanged; do not "improve" it here, because parity
// with the app is a cross-repo contract and this constant is one half of it.
//
//   #c9a84c on #0a0a0a (page chrome) = 8.66:1
//
// ── ON_LIGHT — DERIVED, not eyeballed ────────────────────────────────────────────────────
// The story reading surface is #f0ead8 cream (app/stories/[slug]/page-client.js
// `.story-body-wrap`, and app/my-library/read/page.js `.sr-page`). House gold on it:
//
//   #c9a84c on #f0ead8 = 1.90:1   — below even the 3:1 large-text floor.
//
// An in-story subheading is 1.15rem (18.4px) at weight 400. That is NORMAL text by WCAG —
// the 3:1 large-text exemption needs >=24px, or >=18.66px BOLD — so the floor is 4.5:1.
//
// ON_LIGHT is therefore the LIGHTEST tone of the SAME hue that clears 4.5:1 on #f0ead8,
// found by arithmetic rather than by eye:
//
//   #c9a84c  ->  H 44.16deg   S 53.65%   L 54.31%
//   hold H and S FIXED, walk L down until contrast >= 4.5
//   -> L 32.36%  =  #7f6726  =  4.513:1   PASSES AA
//
//   confirmation that this is the BOUNDARY and not merely a safe guess:
//   one step lighter (L 32.41%, #7f6826) = 4.466:1 — fails. There is no lighter tone of
//   this hue that clears AA, so ON_LIGHT is as close to house gold as the surface permits.
//
// Hue drift through the round trip is -0.34deg (44.16 -> 43.82) and saturation lands at
// 53.94% against 53.65% — both well inside a just-noticeable difference. It is the same
// gold, dimmed to the point cream can carry it, and not one degree further.
//
// ── WHAT IS DELIBERATELY NOT USING THIS YET ──────────────────────────────────────────────
// The drop cap. It renders #c9a84c on the SAME cream surface at 1.90:1 and so has the same
// problem, but it was explicitly held back from this round for a separate ruling: it is
// 4.2em display type, where the argument that it is decoration rather than text is at least
// arguable. See app/lib/proseCSS.js, where its literal is left standing on purpose.
export const HOUSE_GOLD_ON_DARK = '#c9a84c';
export const HOUSE_GOLD_ON_LIGHT = '#7f6726';
