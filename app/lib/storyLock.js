// THE STORY PAGE'S OWN REFUSAL — W4. Pure, so the built-HTML check and the tests share it.
//
// The site is a static export. A story page built on a Thursday carries that week's story in
// full, correctly — it is free until Sunday 23:59:59.999 London. At Monday 00:00 the story goes
// to the archive, and the page's HTML does not change until the scheduled rebuild lands a few
// minutes later. This closes those minutes: the build records, on every page whose body it
// inlined in full, the instant a signed-out reader stops being entitled to it (`lockAtMs`) and
// the preview to show from then on. Two things read them:
//
//   lockScript()          an inline script in the page, run by the browser while it parses the
//                         static HTML — before paint and before any JavaScript bundle — which
//                         swaps #story-content for the preview once the clock is past lockAtMs.
//   lockedForFirstPaint() the client's first render, which must produce the same preview so
//                         hydration finds the DOM it expects.
//
// Members lose nothing: /api/story answers them with the full body a moment later, exactly as
// it does on a page built after the switch.

import { grantFor, freeUntilFor, GATE_ON_MS } from './storyAccess.js';

// Longer than any build (a few minutes) plus the gap to the scheduled rebuild after a London
// Monday midnight (the calvary-newsletter Worker's */15 tick fires the deploy hook).
export const BUILD_LOOKAHEAD_MS = 3 * 3600000;

/**
 * What the static build may put in a story's HTML, decided at build time `now`.
 *
 *   inlineFull  the whole body — only if a SIGNED-OUT reader may read it in full both now AND
 *               BUILD_LOOKAHEAD_MS later, so a build that deploys after a boundary cannot carry
 *               a body that has just gone to the archive
 *   lockAtMs    for a full page: the instant a signed-out reader stops being entitled to it
 *               (its week's end, or the 30 Sept switch, whichever is later); null for poetry,
 *               which never locks
 */
export function buildInlinePlan(rec, now = Date.now()) {
  const openAt = (t) => grantFor(rec, { tier: 'free', now: t }).access === 'full';
  const inlineFull = openAt(now) && openAt(now + BUILD_LOOKAHEAD_MS);
  if (!inlineFull || (rec && rec.category === 'poetry')) return { inlineFull, lockAtMs: null };
  const freeUntil = freeUntilFor(rec);
  return { inlineFull, lockAtMs: Math.max(GATE_ON_MS, freeUntil === null ? GATE_ON_MS : freeUntil + 1) };
}

/** The story as it should first render at `now`: the preview once past its lock instant. */
export function lockedForFirstPaint(initialStory, now) {
  const s = initialStory;
  if (!s || s.contentIsPreview || typeof s.lockAtMs !== 'number' || typeof s.previewHtml !== 'string') return s;
  if (now < s.lockAtMs) return s;
  return { ...s, content: s.previewHtml, contentIsPreview: true, lockedByClock: true };
}

/** JSON that is safe inside a <script> element: no </script>, no <!--, no U+2028/9. */
export function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The inline script. Swallows its own errors: a failed swap must never break the page. */
export function lockScript(lockAtMs, previewHtml) {
  const at = Number(lockAtMs);
  if (!Number.isFinite(at)) return '';
  return `(function(){try{if(Date.now()>=${at}){var c=document.getElementById('story-content');`
    + `if(c){c.innerHTML=${scriptSafeJson(String(previewHtml || ''))};c.setAttribute('data-locked-by-clock','1');}}}catch(e){}})();`;
}
