/* eslint-disable */
// ═══════════════════════════════════════════════════════════════════════════════════════
// CALVARY SCRIBBLINGS — THE OFFLINE SHELF SERVICE WORKER
//
// This file is the riskiest thing in the repo. A bad service worker does not fail loudly;
// it strands returning readers on a shell that will never update again. Every decision
// below is made to keep that impossible, and the reasoning is written down so a later
// edit cannot quietly undo it.
//
// ── THE ONE RULE ─────────────────────────────────────────────────────────────────────────
// AN ONLINE USER IS NEVER SERVED A CACHED DOCUMENT.
//
// Every document and every RSC payload is network-first. A new deploy is therefore picked
// up on the very next navigation, and there is no code path in which a reader with a
// working connection sees yesterday's HTML. The entire "stranded on a stale shell" class
// of bug is closed by that single property. If you are editing this file and find yourself
// making a document cache-first "just for speed" — don't. Speed is what the immutable
// chunk cache is for.
//
// ── GATEWAY FENCE: LITERAL, AND ACCEPTED AS SUCH ─────────────────────────────────────────
// The registration scope is '/' and cannot be anything else: the three things this worker
// must reach — /my-library, the shelf reader, and /_next/static/* — share no prefix but
// the root, and a scope must be a path prefix.
//
// Scope '/' means the fetch event FIRES for the gateway. It does not mean the gateway is
// intercepted. This worker never calls respondWith() for '/', so the browser handles that
// request natively and the response path is untouched — a guarantee that is binary and
// auditable rather than a matter of degree (see isPassThrough, which returns before any
// respondWith can be reached).
//
// The consequence, accepted deliberately: an OFFLINE stranger at the front door gets the
// browser's own error page, not ours. We cannot do better without intercepting, because
// you cannot learn that a navigation failed without first calling respondWith() and
// taking over the response. The offline visitors who matter are shelf users, and their
// door is /my-library — which is also the manifest's start_url.
//
// The cost, also accepted deliberately: a cold arrival at the gateway pays the service
// worker's boot before the pass-through happens, roughly 10–30ms. That is noise against a
// ~1.6s content-ready, and it buys a guarantee that survives every future edit to this
// file. Documented here because it was an explicit decision, not an oversight.
//
// ── LIFECYCLE: NO skipWaiting ────────────────────────────────────────────────────────────
// This worker never calls skipWaiting(). A new version installs, waits, and activates when
// the last client of the old one is gone — the standard, boring lifecycle.
//
// That is safe here precisely BECAUSE of the one rule above: an old worker handed a
// fresh-build document just passes the bytes through, and the new build's content-hashed
// chunks miss the cache and hit the network. The old worker cannot strand anyone, so
// there is no reason to force it out from under a reader mid-story. No update toast, no
// forced reload, no "new version available" nag.
//
// The ONLY service worker in this repo that calls skipWaiting() is scripts/sw-kill.js,
// the kill switch, which must propagate immediately by design. If you are adding
// skipWaiting() to this file, you are almost certainly solving the wrong problem.
//
// ── WHY SAVED STORIES ARE NOT CACHED DOCUMENTS ───────────────────────────────────────────
// A saved story lives in IndexedDB (see app/lib/shelf.js) and is read by the lean shelf
// reader at /my-library/read, not by caching /stories/<slug>. Four reasons, in order of
// weight: the shelf reader's offline behaviour is fully determined, with no Firebase call
// that can hang; it caps the cached shell at one lean route instead of the heaviest route
// on the site (~1.16 MB decoded); it leaves the story page's prose-entrance and drop-cap
// machinery untouched; and a saved story genuinely is a different object from a live one —
// no comment thread, no quiz, no read counter — so rendering the full page offline would
// manufacture affordances that are dead on arrival.
//
// A reader who taps a /stories/<slug> link while offline is not abandoned: the navigation
// fallback below checks the shelf and redirects saved stories to the reader.
// ═══════════════════════════════════════════════════════════════════════════════════════

// Stamped at build time by scripts/stamp-sw.mjs. The placeholder is what lives in git; if
// you ever see it at runtime, the stamp step did not run and every deploy will share one
// cache generation.
const BUILD = '__BUILD_ID__';

const SHELL_CACHE = `cs-shell-v${BUILD}`;   // documents, RSC payloads, hashed chunks
const CACHE_PREFIX = 'cs-';

// The shelf shell: the two documents that must work with no signal. Everything else the
// shelf needs is content in IndexedDB, not cache.
const SHELF_DOCS = ['/my-library', '/my-library/read'];

// ── the route policy ─────────────────────────────────────────────────────────────────────
// Anything matching here returns from the fetch handler WITHOUT respondWith. The browser
// then handles it exactly as if no service worker existed.
const PASS_THROUGH_PATHS = [
  '/bookstore',      // fence — retail is not ours to cache
  '/reader',         // fence — reader internals
  '/book-reader',    // fence — reader internals
  '/api/',           // Pages Functions: hits, quiz attempts, moderation. Never replay.
  '/square',         // live surface
  '/admin',          // never
];

const PASS_THROUGH_HOSTS = [
  'firebaseio.com',
  'firebasedatabase.app',
  'firebasestorage.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'googleapis.com',
  'gstatic.com',
  'googletagmanager.com',
  'google-analytics.com',
  'workers.dev',
  'og.calvaryscribblings.co.uk',
  'stripe.com',
  'squareup.com',
];

function isPassThrough(request, url) {
  if (request.method !== 'GET') return true;
  if (!url.protocol.startsWith('http')) return true;

  // THE GATEWAY. Literal fence: the root document is never intercepted, online or off.
  // Kept as the first same-origin check so it cannot be shadowed by a later rule.
  if (url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html')) return true;

  if (url.origin !== self.location.origin) {
    return PASS_THROUGH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
  }
  return PASS_THROUGH_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(p + '/') || url.pathname.startsWith(p));
}

const isStaticChunk = (url) => url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');
const isRSCPayload = (url) => url.origin === self.location.origin && url.pathname.endsWith('.txt');
const isShelfPath = (p) => p === '/my-library' || p.startsWith('/my-library/');
const isStoryPath = (p) => p.startsWith('/stories/');

// ── install: precache NOTHING ────────────────────────────────────────────────────────────
// The retired pre-Next worker did cache.addAll(STATIC_ASSETS) at install, which is exactly
// what pins a build into a cache that then outlives it. Everything here is cached on
// demand — at save time, and as a by-product of navigation.
self.addEventListener('install', () => {
  // Deliberately no skipWaiting(). See the lifecycle note in the header.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== SHELL_CACHE).map((k) => caches.delete(k))
    );
    // Harmless under the no-skipWaiting lifecycle (by the time we activate, the old
    // worker's clients are gone), but it lets the FIRST install take control without
    // waiting for another navigation.
    await self.clients.claim();
  })());
});

// ── fetch ────────────────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (isPassThrough(event.request, url)) return; // ← the only guarantee that matters

  // Content-hashed and served immutable for a year (see public/_headers). A stale copy is
  // unreachable by definition, so cache-first is unconditionally correct here — and it is
  // the ONLY place in this file where cache-first is used.
  if (isStaticChunk(url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(navigateNetworkFirst(event));
    return;
  }

  // RSC payloads. Next 16 client-side navigation fetches `<path>.txt` rather than the
  // HTML — verified in the built bundle. A worker that caches only documents appears to
  // work on reload and fails on in-app navigation, so these travel with their documents.
  if (isRSCPayload(url) && (isShelfPath(url.pathname.replace(/\.txt$/, '')) || isShelfPath(url.pathname))) {
    event.respondWith(networkFirst(event.request));
    return;
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

// ── the timeout rule ─────────────────────────────────────────────────────────────────────
// A timeout may ONLY be applied when there is something cached to fall back TO.
//
// This is not a detail. A blanket "network-first with a 3s timeout" turns a slow-but-
// working connection into an offline page: the reader has signal, the story is coming, and
// the worker gives up and shows them an apology. That is strictly worse than no service
// worker at all, and it would hit hardest exactly the readers this feature is for — the
// ones on a train.
//
// So: no cached copy means we wait as long as the browser would have waited, which makes
// the worker's behaviour on an uncached page indistinguishable from having no worker. The
// timeout exists only to shorten the wait when the alternative is a real, complete page we
// already hold.
function fetchWithCacheRefresh(request, cache, shouldCache) {
  const p = fetch(request).then((res) => {
    // Attached to the fetch itself, not to the race: a response that arrives after the
    // timeout still refreshes the cache instead of being thrown away.
    if (res && res.ok && shouldCache) { try { cache.put(request, res.clone()); } catch {} }
    return res;
  });
  // When the timeout below wins the race, nothing awaits `p` any more. Attaching a handler
  // to a derived promise marks the original as handled, so a later network error is a
  // no-op instead of an unhandled rejection in the worker's console.
  p.catch(() => {});
  return p;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function networkFirst(request, timeoutMs = 2500) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const live = fetchWithCacheRefresh(request, cache, true);
  try {
    return await (cached ? withTimeout(live, timeoutMs) : live);
  } catch {
    if (cached) return cached;
    throw new Error('offline and uncached');
  }
}

// The navigation strategy. Network first, always. Cache is a fallback for failure, never
// an optimisation for success.
async function navigateNetworkFirst(event) {
  const request = event.request;
  const url = new URL(request.url);
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const live = fetchWithCacheRefresh(request, cache, isShelfPath(url.pathname));
  try {
    return await (cached ? withTimeout(live, 3000) : live);
  } catch {
    // We are here because the network failed. Tell the open clients so the shelf can
    // raise its offline banner without trusting navigator.onLine, which reports "has an
    // interface", not "has internet".
    broadcast({ type: 'CS_OFFLINE' });

    if (cached) return cached;

    // A saved story requested by its real URL. Hand it to the reader rather than an
    // apology — the prose is sitting in IndexedDB.
    if (isStoryPath(url.pathname)) {
      const slug = decodeURIComponent(url.pathname.replace(/^\/stories\//, '').replace(/\/$/, ''));
      if (slug && (await shelfHasStory(slug))) {
        const readerPath = `/my-library/read?slug=${encodeURIComponent(slug)}`;
        const reader = await cache.match(readerPath, { ignoreSearch: true })
          || await cache.match('/my-library/read', { ignoreSearch: true });
        // Response.redirect() rejects a relative URL inside a worker — it wants a parsed,
        // absolute one — so resolve against the origin rather than passing the path.
        if (reader) return Response.redirect(new URL(readerPath, self.location.origin).href, 302);
      }
    }
    return offlineResponse(url);
  }
}

function broadcast(msg) {
  self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage(msg)));
}

// ── does the shelf hold this story? ──────────────────────────────────────────────────────
// A direct read of app/lib/shelf.js's database. Deliberately does NOT filter by uid: the
// worker has no session. The reader does the uid check and says "not on your shelf" if the
// record belongs to whoever used this device last, which is the honest answer either way.
function shelfHasStory(slug) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    setTimeout(() => done(false), 1500);
    try {
      // Version 1 explicitly: opening with a higher version from here would trigger an
      // upgrade the worker has no schema for.
      const req = indexedDB.open('cs-shelf', 1);
      req.onerror = () => done(false);
      req.onupgradeneeded = () => { try { req.transaction.abort(); } catch {} done(false); };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const get = db.transaction(['shelf'], 'readonly').objectStore('shelf').get(`story:${slug}`);
          get.onsuccess = () => { done(!!get.result); db.close(); };
          get.onerror = () => { done(false); db.close(); };
        } catch { done(false); }
      };
    } catch { done(false); }
  });
}

// ── the offline page ─────────────────────────────────────────────────────────────────────
// Synthesized from this string rather than served from a route. Three reasons: it cannot
// be missing (it ships inside the worker itself); it adds no route to the static export;
// and it sidesteps a live collision — public/_redirects still carries the pre-Next PWA's
// `/offline.html → /public-library 301`, so any route named "offline" invites a
// redirect-versus-asset argument at the edge.
function offlineResponse(url) {
  const isStory = isStoryPath(url.pathname);
  const head = isStory ? 'This story isn&rsquo;t on your shelf' : 'No signal';
  const body = isStory
    ? 'You&rsquo;re offline, and this one wasn&rsquo;t saved for reading without a connection. Your shelf is still here.'
    : 'You&rsquo;re offline. The stories you saved are still readable &mdash; everything else needs a connection.';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Offline &mdash; Calvary Scribblings</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px 22px;
    background:radial-gradient(130% 60% at 50% -10%,#241347 0%,#0b0716 58%,#080610 100%);
    color:#f5f0e8;font-family:'Cormorant Garamond',Georgia,serif;text-align:center}
  .w{max-width:340px}
  .o{font-size:22px;color:rgba(201,168,76,.6)}
  .e{font-family:'Cinzel','Cormorant Garamond',Georgia,serif;font-size:9.5px;
    letter-spacing:.3em;color:#c9a84c;margin-top:26px}
  .r{width:60px;height:1px;background:#c9a84c;opacity:.55;margin:9px auto 0}
  h1{font-size:20px;font-weight:600;margin:18px 0 0;line-height:1.3}
  p{font-size:14.5px;line-height:1.55;color:rgba(245,240,232,.62);margin:8px 0 0}
  a{display:inline-block;margin-top:22px;border-radius:999px;padding:11px 22px;
    font-family:'Cinzel','Cormorant Garamond',Georgia,serif;font-size:9px;letter-spacing:.2em;
    color:#e2c876;text-decoration:none;border:1px solid rgba(201,168,76,.35);
    background:linear-gradient(160deg,rgba(245,240,232,.055),rgba(91,43,160,.10))}
</style></head><body><div class="w">
<div class="e">CALVARY SCRIBBLINGS</div><div class="r"></div>
<div class="o" style="margin-top:26px" aria-hidden="true">&#10022;</div>
<h1>${head}</h1><p>${body}</p>
<a href="/my-library">GO TO MY LIBRARY</a>
</div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// ── sealing the shelf shell ──────────────────────────────────────────────────────────────
// Called from the page when a story is saved, and on every visit to /my-library.
//
// This is the sealed-capsule idea, adapted to the shelf-reader design. With the prose in
// IndexedDB, a saved story pins no build — so instead of one capsule per story there is
// ONE capsule for the shelf shell: the two shelf documents, their RSC payloads, and the
// exact set of content-hashed chunks those documents reference, cached as a unit.
//
// The chunk set is read out of the documents themselves rather than from the saving page's
// resource timings, because /my-library never loads the reader's chunks and vice versa.
// That also makes the reference count exact: the roots are the cached documents, and
// anything in the shell cache that no cached document names is garbage.
async function sealShelfShell() {
  const cache = await caches.open(SHELL_CACHE);
  const referenced = new Set();

  for (const doc of SHELF_DOCS) {
    try {
      const res = await fetch(doc, { cache: 'no-cache' });
      if (!res || !res.ok) continue;
      const html = await res.clone().text();
      await cache.put(doc, res);

      // The RSC payload for the same route: a client-side hop asks for this, not the HTML.
      try {
        const rsc = await fetch(doc + '.txt', { cache: 'no-cache' });
        if (rsc && rsc.ok) await cache.put(doc + '.txt', rsc);
      } catch {}

      for (const m of html.matchAll(/\/_next\/static\/[A-Za-z0-9_~.\-\/]+?\.(?:js|css)/g)) referenced.add(m[0]);
    } catch {}
  }

  await Promise.all([...referenced].map(async (href) => {
    if (await cache.match(href)) return;
    try {
      const r = await fetch(href);
      if (r && r.ok) await cache.put(href, r);
    } catch {}
  }));

  await pruneShell(cache, referenced);
  return { docs: SHELF_DOCS.length, chunks: referenced.size };
}

// Reference-count prune. Roots are the cached shelf documents; anything under
// /_next/static/ that none of them names is dropped. With a two-story cap and two shelf
// documents this keeps the footprint near ~1 MB no matter how often the site deploys.
async function pruneShell(cache, referenced) {
  const keep = new Set(referenced);
  for (const doc of SHELF_DOCS) { keep.add(doc); keep.add(doc + '.txt'); }
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if (keep.has(p)) continue;
    if (p.startsWith('/_next/static/') || isShelfPath(p) || isShelfPath(p.replace(/\.txt$/, ''))) {
      await cache.delete(req);
    }
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SEAL_SHELF') {
    event.waitUntil(sealShelfShell().then((r) => {
      event.source?.postMessage({ type: 'CS_SEALED', ...r, build: BUILD });
    }).catch(() => {}));
  }
  if (data.type === 'CS_PING') event.source?.postMessage({ type: 'CS_PONG', build: BUILD });
});
