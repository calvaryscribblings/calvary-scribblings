// EDGE-2 — A STORY WE TAKE DOWN STOPS ANSWERING AT ITS ADDRESS STRAIGHT AWAY (ruling 265).
//
// ── WHY THERE IS ANYTHING TO GUARD ───────────────────────────────────────────────────────────
// Cloudflare Pages' asset server keeps an ASSET PRESERVATION store (pages-shared/asset-server/
// handler.ts, read from wrangler 4.81.0 and unchanged in 4.156.2). Every time it serves an asset
// — any GET or HEAD it answers from the deployment, HTML or .txt alike — it writes the asset's key
// into Cache API storage `assetPreservationCacheV2`, keyed by the EXACT request URL (query string
// included), with `cache-control: public, s-maxage=604800`. When a later deployment has no file
// at that address, notFound() consults the store BEFORE the site's 404.html, and serves the old
// bytes. So a page removed from the build keeps answering 200 for up to 7 days, at every URL a
// reader fetched while it was live. A zone purge does not reach this store (EDGE-1, measured).
//
// What can act before the store, from the same source:
//   _redirects  — YES. Redirect rules are matched first in generateResponse(); a 3xx returns
//                 without touching the store. But a redirect is not a 404, and a 200 rewrite
//                 to a path that does not exist falls into notFound() and reads the store
//                 under the ORIGINAL request URL anyway.
//   _headers    — NO. attachHeaders() runs on the response notFound() already produced; it can
//                 change headers, never the status.
//   a Function  — YES. Requests _routes.json sends to Functions never reach the asset server
//                 unless the Function asks for them.
//
// ── THE GUARD ────────────────────────────────────────────────────────────────────────────────
// 1. Each build publishes /_edge/ledger.json: the per-story pages THIS deployment serves (all
//    live, all already public), plus the guarded addresses carried forward — HASHED when the next
//    build can recover them from the catalogue it reads anyway, so the file is not a public list
//    of what we took down.
// 2. The next build reads the LIVE deployment's ledger. Any page it listed that this build does
//    not have is guarded from now; a guarded address stays guarded for GUARD_MS (7 days of
//    s-maxage + 1 day of margin), unless its page comes back.
// 3. The build writes out/_routes.json: the Functions' own routes plus one rule per guarded
//    address. Only those addresses invoke a Function. Live story views never do.
// 4. functions/stories/[[path]].js and functions/reader/[[path]].js answer a guarded address with
//    the site's 404 page and status 404 (so NotFoundOrLiveStory still draws a story that has
//    just gone live), or a bare 404 for page data (.txt). If they are ever handed an address the
//    deployment DOES have a page for (a missing or default _routes.json), they pass it through.
//
// This file is imported by the build step (scripts/generate-edge-guard.mjs), by both Functions
// and by the tests. It must stay free of Node imports: the Functions run on workerd.

/** The per-story page families. A removed story leaves both behind. */
export const PAGE_FAMILIES = ['stories', 'reader'];

/** Preservation entries carry s-maxage=604800 from their last write (handler.ts). */
export const PRESERVATION_MS = 604800 * 1000;
/** Margin over the 7 days: the gap between a build and its deployment going live, and clock skew. */
export const GUARD_MARGIN_MS = 24 * 3600 * 1000;
export const GUARD_MS = PRESERVATION_MS + GUARD_MARGIN_MS;

/** _routes.json limits (wrangler src/pages/constants.ts; validateRoutes fails the deploy past them). */
export const MAX_ROUTE_RULES = 100;
export const MAX_RULE_LENGTH = 100;

export const LEDGER_PATH = '/_edge/ledger.json';
export const LEDGER_VERSION = 1;

/**
 * UNRELEASED-1 went live at 03:13 UTC on 31 Oct 2026. Before it, a scheduled story got a page,
 * so the first EDGE-2 build (which finds no ledger on the live site) seeds every story the old
 * rule built and the new one does not, from that moment. The seed lapses on its own at
 * 03:13 UTC on 8 Nov 2026.
 */
export const UNRELEASED_1_LIVE_MS = Date.UTC(2026, 9, 31, 3, 13);

/** The page rule as it stood before UNRELEASED-1 (bca482d1^:app/lib/storyAccess.js). */
export function hadPageBeforeUnreleased1(story) {
  const s = story || {};
  if (s.published !== false) return true;
  if (s.hiddenAt) return false;
  return typeof s.publishAt === 'string' && !!s.publishAt;
}

/** "stories/<slug>" for a URL path inside a page family, else null. Raw path, as _routes.json matches it. */
export function pageKeyOf(pathname) {
  const m = /^\/(stories|reader)\/([^/.]+)(?:\.html|\.txt|\/.*)?$/.exec(pathname || '');
  if (!m || !PAGE_FAMILIES.includes(m[1])) return null;
  return `${m[1]}/${m[2]}`;
}

/** Is `pathname` one of the addresses the page `key` occupies (the page, its .html/.txt, its segment data)? */
export function isOwnAddress(key, pathname) {
  const p = `/${key}`;
  return pathname === p || pathname === `${p}.html` || pathname === `${p}.txt` || pathname.startsWith(`${p}/`);
}

/** sha-256 of the page key, hex, first 32 characters. Web Crypto, so it runs in a Function too. */
export async function hashKey(key) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`edge-ledger:${key}`));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fold the live deployment's ledger into this build's guard set.
 *
 *   prev        the ledger the live deployment serves, or null (none yet: bootstrap)
 *   pages       Set of page keys THIS build serves
 *   candidates  Set of page keys the build can name from the catalogue it read (to undo hashes)
 *   seed        [{ key, since }] — bootstrap only (prev === null)
 *
 * Returns { guarded: [{ key, since }], unresolved: [{ h, since }] } — unresolved are hashed
 * entries no candidate matches; they are carried forward but cannot be routed.
 */
export async function foldLedger({ prev, pages, candidates, seed = [], now }) {
  const byKey = new Map();
  const unresolved = [];
  const keep = (key, since) => {
    if (pages.has(key)) return;                         // its page is back: nothing to guard
    if (since + GUARD_MS <= now) return;                 // every preserved copy has expired
    const had = byKey.get(key);
    if (had === undefined || since > had) byKey.set(key, since);
  };
  if (prev) {
    for (const key of prev.pages || []) keep(key, now);  // a page the live deployment serves, gone from this one
    const lookup = new Map();
    const need = (prev.guarded || []).some((g) => g.h);
    if (need) for (const key of candidates) lookup.set(await hashKey(key), key);
    for (const g of prev.guarded || []) {
      if (typeof g.since !== 'number') continue;
      if (g.key) keep(g.key, g.since);
      else if (g.h) {
        const key = lookup.get(g.h);
        if (key) keep(key, g.since);
        else if (g.since + GUARD_MS > now) unresolved.push({ h: g.h, since: g.since });
      }
    }
  } else {
    for (const s of seed) keep(s.key, s.since);
  }
  const guarded = [...byKey].map(([key, since]) => ({ key, since })).sort((a, b) => b.since - a.since || (a.key < b.key ? -1 : 1));
  return { guarded, unresolved };
}

/** The ledger this build publishes. A key the next build can recover from the catalogue is hashed. */
export async function ledgerFor({ pages, guarded, unresolved, candidates, builtAt }) {
  const entries = [];
  for (const g of guarded) {
    entries.push(candidates.has(g.key) ? { h: await hashKey(g.key), since: g.since } : { key: g.key, since: g.since });
  }
  for (const u of unresolved) entries.push(u);
  return { v: LEDGER_VERSION, builtAt, pages: [...pages].sort(), guarded: entries };
}

/**
 * The routing rules for one guarded page. One rule (`/stories/<slug>*`) covers the page, its
 * .html, its .txt, its segment data and any query string — unless some page THIS build serves
 * also starts with that prefix (`<slug>-part-two`), in which case the page's own four forms are
 * listed instead, so the live one never invokes the Function.
 */
export function rulesFor(key, builtPaths) {
  const p = `/${key}`;
  const prefix = p.length + 1 > MAX_RULE_LENGTH ? p.slice(0, MAX_RULE_LENGTH - 1) : p;
  const collides = builtPaths.some((b) => b.startsWith(prefix) && !isOwnAddress(key, b));
  if (!collides) return [`${prefix}*`];
  const exact = [p, `${p}.html`, `${p}.txt`, `${p}/*`];
  if (exact.some((r) => r.length > MAX_RULE_LENGTH)) return null;    // cannot be routed exactly
  return exact;
}

/**
 * out/_routes.json. `functionIncludes` are the Functions' own routes (from functions/). Guarded
 * pages are taken newest-removal first while they fit; what does not fit is returned in `dropped`.
 */
export function routesFor({ functionIncludes, guarded, builtPaths }) {
  const include = [...functionIncludes];
  const routed = [];
  const dropped = [];
  for (const g of guarded) {
    const rules = rulesFor(g.key, builtPaths);
    if (!rules || include.length + rules.length > MAX_ROUTE_RULES) { dropped.push(g); continue; }
    include.push(...rules);
    routed.push(g);
  }
  return {
    routes: { version: 1, description: 'EDGE-2: the Functions, plus every address that may hold a preserved copy of a page this deployment no longer has.', include, exclude: [] },
    routed,
    dropped,
  };
}

// ── THE FUNCTION ─────────────────────────────────────────────────────────────────────────────

const GONE_HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

let _live = null;
/** The page keys this deployment serves, read once per isolate from its own ledger. */
async function livePages(env, origin) {
  if (!_live) {
    _live = (async () => {
      const r = await env.ASSETS.fetch(new Request(new URL(LEDGER_PATH, origin)));
      if (!r.ok) throw new Error(`ledger ${r.status}`);
      const j = await r.json();
      return new Set(j.pages || []);
    })();
    _live.catch(() => { _live = null; });
  }
  return _live;
}

/**
 * The guard. Pages Functions context in, Response out. Only addresses _routes.json lists reach
 * it, and those have no page in this deployment by construction — but if it is ever handed one
 * that does (no custom _routes.json, say), it serves the page as the asset server would.
 */
export async function guardRequest({ request, env }) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const key = pageKeyOf(url.pathname);
  if (!key || (method !== 'GET' && method !== 'HEAD')) return env.ASSETS.fetch(request);
  let live;
  try { live = await livePages(env, url.origin); } catch { return env.ASSETS.fetch(request); }
  if (live.has(key)) return env.ASSETS.fetch(request);

  const isPage = url.pathname === `/${key}` || url.pathname === `/${key}/` || url.pathname === `/${key}.html`;
  if (!isPage) {
    return new Response(method === 'HEAD' ? null : 'Not found', {
      status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...GONE_HEADERS },
    });
  }
  // The site's own 404 page (which, on /stories/<slug>, asks /api/story and draws a story that
  // has just gone live). '/404' resolves to out/404.html in the asset server; it always exists.
  const nf = await env.ASSETS.fetch(new Request(new URL('/404', url.origin)));
  const headers = new Headers(nf.headers);
  headers.delete('etag');
  headers.delete('content-length');
  for (const [k, v] of Object.entries(GONE_HEADERS)) headers.set(k, v);
  return new Response(method === 'HEAD' ? null : nf.body, { status: 404, headers });
}

/** For tests: forget the per-isolate ledger read. */
export function _resetGuardForTests() { _live = null; }
