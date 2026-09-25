// THE FOUNDER PREVIEW'S POLICY — pure, shared by /api/story, /api/series/stream and the tests.
//
// W4b (25 Sep 2026). W4 kept the preview in ONE place: this browser's localStorage, sent to the
// endpoints as `previewGate: true`. Ikenna turned it on in /admin on his iPad and nothing locked,
// while the same path in WebKit here did. Anything that gives the story pages a different store
// from the /admin page loses a browser-only flag without a word: a Home Screen copy of the site
// (the manifest is `display: standalone`, and iPadOS gives that its own storage), a second browser,
// another device. So the flag now belongs to the ACCOUNT: founder_preview/{uid} = true, written by
// the toggle, read by the endpoints themselves from the verified uid. The request flag stays too,
// and either one turns the preview on. Both are founders-only, both only ever LOCK.
//
// And the preview shows the NON-MEMBER view (the ruling: "exactly what a non-member will see after
// 30 Sept"), so the endpoints judge it at tier 'free' and skip the founder's own membership.

import { isFounder } from './founders.js';
import { gatingOn } from './storyAccess.js';

export const FOUNDER_PREVIEW_ROOT = 'founder_preview';
export const founderPreviewPath = (uid) => `${FOUNDER_PREVIEW_ROOT}/${uid}`;

/**
 * Is the founder preview in force for this request?
 *   uid          the VERIFIED uid (never a claimed one), or null
 *   requested    body.previewGate
 *   accountFlag  the value at founder_preview/{uid} (true, or null/absent)
 * After the switch there is nothing left to preview: the gate itself is on.
 */
export function previewInForce({ uid, requested = false, accountFlag = null, now = Date.now() }) {
  if (!isFounder(uid) || gatingOn(now)) return false;
  return requested === true || accountFlag === true;
}
