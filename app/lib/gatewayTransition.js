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
//   ARRIVE_HOLD                  a beat of full black at the threshold
//   ARRIVE_FADE                  the veil lifts and the page settles into place

// ── Exit (Gateway.js) ──
export const VEIL_AT = 100;
export const PUSH_AT = 650;
export const VEIL_FADE = 500;

// ── Arrival (ArrivalVeil.js) ──
export const ARRIVE_HOLD = 150;
export const ARRIVE_FADE = 750;
export const ARRIVE_RISE_PX = 14;
// Soft landing — decelerates into place instead of arriving at a constant clip.
export const ARRIVE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
