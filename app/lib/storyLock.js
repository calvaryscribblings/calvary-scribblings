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
  if (!inlineFull || (rec && rec.category === 'poetry')) return { inlineFull, lockAtMs: null, previewLockAtMs: null };
  const freeUntil = freeUntilFor(rec);
  const weekEnd = freeUntil === null ? 0 : freeUntil + 1;
  // previewLockAtMs (W4b): the same instant with the 30 Sept switch taken away — the end of the
  // story's own London week. The founder preview locks from there, before paint, exactly as
  // grantFor(…, { forceGate: true }) does on the server.
  return { inlineFull, lockAtMs: Math.max(GATE_ON_MS, weekEnd || GATE_ON_MS), previewLockAtMs: weekEnd };
}

/**
 * The story as it should first render at `now`: the preview once past its lock instant — or,
 * under the founder preview (`preview`: this browser's copy of the flag), once past the end of
 * its week. The preview can only lock: a reader who is entitled gets the whole body back from
 * /api/story a moment later, as on any locked page.
 */
export function lockedForFirstPaint(initialStory, now, { preview = false } = {}) {
  const s = initialStory;
  if (!s || s.contentIsPreview || typeof s.lockAtMs !== 'number' || typeof s.previewHtml !== 'string') return s;
  const byClock = now >= s.lockAtMs;
  const byPreview = preview === true && typeof s.previewLockAtMs === 'number' && now >= s.previewLockAtMs;
  if (!byClock && !byPreview) return s;
  return { ...s, content: s.previewHtml, contentIsPreview: true, lockedByClock: true };
}

/** JSON that is safe inside a <script> element: no </script>, no <!--, no U+2028/9. */
export function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * The inline script. Swallows its own errors: a failed swap must never break the page.
 *
 * W4b: it also reads the founder preview's local copy (localStorage 'cs:gatePreview', see
 * app/lib/gatePreview.js) and locks from `previewLockAtMs` when it is set. W4's script read only
 * the clock, so with the preview on, the page painted the whole story and waited on a network
 * round-trip to take it back.
 */
export function lockScript(lockAtMs, previewHtml, previewLockAtMs = null) {
  const at = Number(lockAtMs);
  if (!Number.isFinite(at)) return '';
  const pat = Number(previewLockAtMs);
  const previewTerm = previewLockAtMs !== null && Number.isFinite(pat)
    ? `||(n>=${pat}&&(function(){try{return localStorage.getItem(${JSON.stringify(GATE_PREVIEW_STORAGE_KEY)})==='1';}catch(e){return false;}})())`
    : '';
  return `(function(){try{var n=Date.now();if(n>=${at}${previewTerm}){var c=document.getElementById('story-content');`
    + `if(c){c.innerHTML=${scriptSafeJson(String(previewHtml || ''))};c.setAttribute('data-locked-by-clock','1');}}}catch(e){}})();`;
}

/** The founder preview's localStorage key. Mirrors GATE_PREVIEW_KEY in app/lib/gatePreview.js
 *  (a client module this pure one cannot import); tests/ci/w4b-preview.test.mjs asserts they match. */
export const GATE_PREVIEW_STORAGE_KEY = 'cs:gatePreview';
