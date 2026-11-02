// EDGE-2 — A PAGE WE TAKE DOWN STOPS ANSWERING AT ITS ADDRESS STRAIGHT AWAY (ruling 265).
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
// 1. Each build publishes /_edge/ledger.json: the pages THIS deployment serves in the guarded
//    families (all live, all already public), plus the guarded pages carried forward, each
//    ENCRYPTED (AES-256-GCM) under EDGE_LEDGER_KEY, a secret only the build has. The ledger names
//    no page that is not live and cannot confirm a guessed one; the entries are padded to a
//    multiple of 8, so it gives the count only roughly.
// 2. The next build reads the LIVE deployment's ledger and decrypts it. Any page it listed that
//    this build does not have is guarded from now; a guarded page stays guarded for GUARD_MS
//    (7 days of s-maxage + 1 day of margin), unless its page comes back.
// 3. The build writes out/_routes.json: the Functions' own routes plus one rule per guarded
//    page. Only those addresses invoke a Function. Live page views never do.
// 4. functions/<family>/[[path]].js answer a guarded address with the site's 404 page and status
//    404 (so NotFoundOrLiveStory still draws a story that has just gone live), or a bare 404 for
//    page data (.txt). If ever handed an address of a page this deployment HAS (a missing or
//    default _routes.json), they pass it through.
//
// This file is imported by the build step (scripts/generate-edge-guard.mjs), by the Functions and
// by the tests. It must stay free of Node imports: the Functions run on workerd.

/**
 * The page families: every page under these directories of out/, at any depth, is a page the
 * guard tracks (a story, its reading room, a book and the shop's rooms, a series, its notes and
 * instalments, an author).
 */
export const PAGE_FAMILIES = ['stories', 'reader', 'bookstore', 'series', 'voices'];

/** Preservation entries carry s-maxage=604800 from their last write (handler.ts). */
export const PRESERVATION_MS = 604800 * 1000;
/** Margin over the 7 days: the gap between a build and its deployment going live, and clock skew. */
export const GUARD_MARGIN_MS = 24 * 3600 * 1000;
export const GUARD_MS = PRESERVATION_MS + GUARD_MARGIN_MS;

/** _routes.json limits (wrangler src/pages/constants.ts; validateRoutes fails the deploy past them). */
export const MAX_ROUTE_RULES = 100;
export const MAX_RULE_LENGTH = 100;

export const LEDGER_PATH = '/_edge/ledger.json';
export const LEDGER_VERSION = 2;
/** Guarded entries are padded with decoys to a multiple of this. */
export const LEDGER_PAD = 8;

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

/**
 * The page a URL path belongs to, as a key ("series/instalment/abc"), or null. A page's addresses
 * are the page itself (with or without a trailing slash), its .html, its .txt, and its segment
 * data (`<page>/__next…`). Raw path, as _routes.json matches it.
 */
export function pageKeyOf(pathname) {
  const m = /^\/([a-z]+)\/(.+)$/.exec(pathname || '');
  if (!m || !PAGE_FAMILIES.includes(m[1])) return null;
  let rest = m[2];
  const seg = rest.indexOf('/__next');
  if (seg >= 0) rest = rest.slice(0, seg);
  else rest = rest.replace(/\/$/, '').replace(/\.(html|txt)$/, '');
  if (!rest || rest.split('/').some((s) => !s || s === '.' || s === '..' || s.startsWith('__next'))) return null;
  return `${m[1]}/${rest}`;
}

/** Is `pathname` one of the addresses of the page `key`? */
export function isOwnAddress(key, pathname) {
  const p = `/${key}`;
  return pathname === p || pathname === `${p}/` || pathname === `${p}.html` || pathname === `${p}.txt` || pathname.startsWith(`${p}/__next`);
}

// ── The ledger's secret ──────────────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

/**
 * The ledger key, from EDGE_LEDGER_KEY (any string of at least 32 characters; `openssl rand
 * -base64 32` makes one). HKDF-SHA-256 derives the AES-GCM key and a separate key id, so the
 * secret itself is never used directly and a rotated secret is recognised rather than misread.
 * Returns { aes, kid }. Throws, naming the variable and never its value, when it is unusable.
 */
export async function ledgerKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('EDGE_LEDGER_KEY is missing or shorter than 32 characters (value withheld)');
  }
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const hkdf = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('calvary-edge-ledger'), info: enc.encode(info) });
  const aes = await crypto.subtle.deriveKey(hkdf('aes-256-gcm v2'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const kidBits = new Uint8Array(await crypto.subtle.deriveBits(hkdf('key id v2'), base, 64));
  return { aes, kid: [...kidBits].map((b) => b.toString(16).padStart(2, '0')).join('') };
}

async function seal(k, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.aes, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64u(out);
}
async function open(k, c) {
  const bytes = unb64u(c);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, k.aes, bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

/**
 * The guarded pages a ledger carries, decrypted. Returns { entries: [{ key, since }], status }:
 * 'ok', or 'other-key' when it was sealed under a different EDGE_LEDGER_KEY (a rotation) — then
 * nothing can be read back and the caller falls back to its bootstrap seed. A sealed entry that
 * fails to open under the right key is an error: the file was altered.
 */
export async function readLedgerEntries(ledger, k) {
  if (ledger.kid !== k.kid) return { entries: [], status: 'other-key' };
  const entries = [];
  for (const g of ledger.guarded || []) {
    const e = await open(k, g.c);
    if (e && typeof e.k === 'string' && typeof e.s === 'number') entries.push({ key: e.k, since: e.s });
  }
  return { entries, status: 'ok' };
}

/**
 * Fold the live deployment's ledger into this build's guard set.
 *
 *   prevPages   pages the live deployment serves (its ledger's plain list), or null on bootstrap
 *   carried     [{ key, since }] decrypted from the live ledger
 *   pages       Set of page keys THIS build serves
 *   seed        [{ key, since }] — added on bootstrap, or when the live ledger cannot be read back
 */
export function foldLedger({ prevPages = null, carried = [], pages, seed = [], now }) {
  const byKey = new Map();
  const keep = (key, since) => {
    if (pages.has(key)) return;                         // its page is back: nothing to guard
    if (since + GUARD_MS <= now) return;                 // every preserved copy has expired
    const had = byKey.get(key);
    if (had === undefined || since > had) byKey.set(key, since);
  };
  for (const key of prevPages || []) keep(key, now);    // a page the live deployment serves, gone from this one
  for (const g of carried) keep(g.key, g.since);
  for (const s of seed) keep(s.key, s.since);
  return [...byKey].map(([key, since]) => ({ key, since })).sort((a, b) => b.since - a.since || (a.key < b.key ? -1 : 1));
}

/** The ledger this build publishes: live pages in the clear, guarded pages sealed and padded. */
export async function ledgerFor({ pages, guarded, k, builtAt }) {
  const sealed = [];
  for (const g of guarded) sealed.push({ c: await seal(k, { k: g.key, s: g.since }) });
  const target = Math.max(LEDGER_PAD, Math.ceil(sealed.length / LEDGER_PAD) * LEDGER_PAD);
  while (sealed.length < target) sealed.push({ c: await seal(k, { d: b64u(crypto.getRandomValues(new Uint8Array(24))) }) });
  for (let i = sealed.length - 1; i > 0; i--) {                       // decoys are not all at the end
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [sealed[i], sealed[j]] = [sealed[j], sealed[i]];
  }
  return { v: LEDGER_VERSION, builtAt, kid: k.kid, pages: [...pages].sort(), guarded: sealed };
}

/**
 * The routing rules for one guarded page. One rule (`/stories/<slug>*`) covers the page, its
 * .html, its .txt, its segment data and any query string — unless some other page THIS build
 * serves also starts with that prefix (`<slug>-part-two`, `<slug>/notes`), in which case the
 * page's own forms are listed instead, so the live one never invokes the Function.
 */
export function rulesFor(key, builtPaths) {
  const p = `/${key}`;
  const prefix = p.length + 1 > MAX_RULE_LENGTH ? p.slice(0, MAX_RULE_LENGTH - 1) : p;
  const collides = builtPaths.some((b) => b.startsWith(prefix) && !isOwnAddress(key, b));
  if (!collides) return [`${prefix}*`];
  const exact = [p, `${p}.html`, `${p}.txt`, `${p}/__next*`];
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
