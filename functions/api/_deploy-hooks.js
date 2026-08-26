// THE DEPLOY HOOKS — identifier → environment variable, in exactly one place. R19.7.
//
// NOT A ROUTE. Cloudflare Pages excludes underscore-prefixed files from Functions routing, and
// this module exports no onRequest* handler — the same convention as _lib.js and _ratelimit.js.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠ WHY A CLIENT MAY NAME A HOOK BUT MAY NEVER HOLD ONE
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// A Cloudflare Pages deploy hook is an UNAUTHENTICATED TRIGGER: POST to the URL and a build
// starts, with no token, no signature, no origin check and no expiry. Possession IS
// authorisation, and there is nothing to revoke short of destroying the hook.
//
// R19.6 measured what that costs when the rule is not enforced: TWO live hook URLs were
// hardcoded in client components and had been shipping in out/_next/static/chunks to every
// visitor of the site. Both were rotated on 26 Aug 2026 and are dead. This module exists so the
// shape that produced them cannot come back — the browser sends 'bookstore', 'cms' or
// 'openPages', a SERVER maps that to an environment variable, and no URL crosses the boundary
// in either direction.
//
// The env var NAMES below are not secrets (they are configuration, and they are in this repo).
// The VALUES never leave the worker: not in a response body, not in a log line, not in an error
// message. `fire()` returns a status and nothing else, deliberately.

/**
 * The whole mapping. Adding a hook is one line here plus one identifier in app/lib/rebuild.js
 * — and tests/ci/rebuild.test.mjs fails if those two ever disagree, which is the only way this
 * table can rot.
 */
export const HOOK_ENV = Object.freeze({
  bookstore: 'DEPLOY_HOOK_URL',            // Bookstore Publish — titles, /bookstore/{slug}
  cms: 'CMS_DEPLOY_HOOK_URL',              // stories and voices — /stories/{slug}, /voices/{slug}
  openPages: 'OPEN_PAGES_DEPLOY_HOOK_URL', // Open Pages — /open-pages/{id}
});

/** The allowed identifiers, in a stable order, for the 400 that names the set. */
export const HOOK_IDS = Object.freeze(Object.keys(HOOK_ENV));

/**
 * Resolve an identifier to a hook URL against the worker's environment.
 *
 * THREE OUTCOMES, and they are three different HTTP answers upstream:
 *   { ok: true, url }              → fire it
 *   { ok: false, reason: 'unknown' }       → 400. The caller asked for a hook that is not a hook.
 *   { ok: false, reason: 'unconfigured', envVar } → 503. The hook is real; nobody has set it.
 *
 * The distinction is the whole point. Collapsing them would mean a typo in the admin and a
 * missing Cloudflare variable produced the same message, and only one of those is fixable by
 * the person reading it.
 */
export function resolveHook(env, id) {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(HOOK_ENV, id)) {
    return { ok: false, reason: 'unknown' };
  }
  const envVar = HOOK_ENV[id];
  const url = env?.[envVar];
  if (!url) return { ok: false, reason: 'unconfigured', envVar };
  return { ok: true, url, envVar };
}

/**
 * POST the hook. Never throws, and never returns the URL.
 *
 * LB-10: fetch has no default timeout, so a hook that accepts the connection and then stops
 * talking would hold the invocation until Cloudflare kills it by wall-clock — which no catch
 * block upstream can observe.
 *
 * @returns {Promise<{ ok: boolean, status: number|null, reason?: 'unreachable'|'refused' }>}
 */
export async function fire(url, timeoutMs) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    // The message, not the URL: a fetch error can embed the request target.
    console.error('[deploy-hooks] hook unreachable:', e?.name || 'Error');
    return { ok: false, status: null, reason: 'unreachable' };
  }
  if (!res.ok) {
    console.error(`[deploy-hooks] hook refused: HTTP ${res.status}`);
    return { ok: false, status: res.status, reason: 'refused' };
  }
  return { ok: true, status: res.status };
}
