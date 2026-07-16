// Timing for the gateway door transition, in ms. Both halves live here so the whole
// journey can be read — and tuned — in one place: Gateway.js plays the exit, ArrivalVeil.js
// plays the arrival on /public-library.
//
//   0ms                          the door is tapped: it swells and brightens,
//                                the rest of the room fades away
//   VEIL_AT                      the veil starts closing, a hairline of light under it
//   PUSH_AT                      navigate (the veil is fully opaque by now — pushing
//                                earlier would swap routes mid-fade and show a seam)
//   + ~70ms                      React unmounts the gateway and mounts the library
//   ARRIVE_HOLD                  a beat of full black at the threshold — the FLOOR, not
//                                the whole wait: the veil also waits for real content
//   lift                         at max(ARRIVE_HOLD, content-ready), capped at
//                                ARRIVE_MAX_WAIT so a slow connection can't trap anyone
//                                in the dark
//   ARRIVE_FADE                  the veil lifts and the page settles into place

// ── Exit (Gateway.js) ──
export const VEIL_AT = 100;
export const PUSH_AT = 650;
export const VEIL_FADE = 500;

// ── Arrival (ArrivalVeil.js) ──
// The minimum beat of black. The veil never lifts before this, and won't lift after it
// until the library has real content to reveal.
export const ARRIVE_HOLD = 250;
export const ARRIVE_FADE = 950;
// The escape hatch. If content still hasn't landed by now, lift anyway — onto the
// skeleton if need be. Degraded, but never stuck in black.
export const ARRIVE_MAX_WAIT = 1400;
export const ARRIVE_RISE_PX = 14;
// Symmetric ease-in-out: the black lingers, then lifts, then settles. A quint ease-out
// sheds most of its opacity in the first third, which reads as a rush no matter how long
// the duration is.
export const ARRIVE_EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
