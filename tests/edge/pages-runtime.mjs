// EDGE-2 — a Cloudflare Pages deployment, run on the REAL asset server.
//
// The asset server is wrangler 4.81.0's pages-shared/asset-server/handler.ts, vendored verbatim by
// scripts/edge/extract-asset-server.mjs (tests/edge/vendor/pages-asset-server.mjs), with the real
// _redirects/_headers parsers feeding its metadata. The _routes.json decision is wrangler's own
// isRoutingRuleMatch (vendor/pages-dev-util.mjs) applied in the order templates/pages-dev-pipeline.ts
// applies it: exclude → assets, include → Functions, otherwise assets.
//
// What is NOT Cloudflare's code, because it is the platform rather than the asset server:
//   • the Cache API. `caches` is an in-memory CacheStorage that honours s-maxage against a clock
//     the test controls. It is shared by every deployment, as the per-colo store is.
//   • the asset store. Assets are kept by content hash and stay fetchable after a deployment is
//     replaced — which is what lets the preservation store serve an old page at all.
//   • the Functions router. The Functions are called with the documented context
//     ({ request, env, params, waitUntil, next }); /api/story is the real functions/api/story.js
//     (wired by the caller), the guard is the real functions/{stories,reader}/[[path]].js.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { generateHandler, createMetadataObject, parseRedirects, parseHeaders } from './vendor/pages-asset-server.mjs';
import { isRoutingRuleMatch } from './vendor/pages-dev-util.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml',
};
// wrangler's upload ignore list (src/pages/validate.ts): these never become assets.
const NOT_ASSETS = new Set(['_worker.js', '_redirects', '_headers', '_routes.json']);

/** The test's clock. Every cache decision reads it. */
export const clock = { now: Date.now() };

class MemoryCache {
  constructor() { this.entries = new Map(); }
  async match(req) {
    const url = typeof req === 'string' ? req : req.url;
    const e = this.entries.get(url);
    if (!e) return undefined;
    const age = Math.floor((clock.now - e.storedAt) / 1000);
    const ttl = Number(/s-maxage=(\d+)/.exec(e.headers['cache-control'] || '')?.[1] ?? /max-age=(\d+)/.exec(e.headers['cache-control'] || '')?.[1] ?? 0);
    if (age >= ttl) { this.entries.delete(url); return undefined; }
    return new Response(e.body, { status: e.status, headers: { ...e.headers, age: String(age) } });
  }
  async put(req, res) {
    const url = typeof req === 'string' ? req : req.url;
    this.entries.set(url, { body: await res.arrayBuffer(), status: res.status, headers: Object.fromEntries(res.headers), storedAt: clock.now });
  }
}
/** One per colo; shared by every deployment. */
export function cacheStorage() {
  const named = new Map();
  return { named, async open(name) { if (!named.has(name)) named.set(name, new MemoryCache()); return named.get(name); } };
}

/** Assets by content hash: what a deployment uploaded stays fetchable after it is replaced. */
const assetStore = new Map();

function walk(dir, rel = '', out = new Map()) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const r = `${rel}/${name}`;
    if (statSync(p).isDirectory()) walk(p, r, out);
    else if (!(rel === '' && NOT_ASSETS.has(name))) out.set(r, p);
  }
  return out;
}

/**
 * A deployment of `dir` (an out/ directory). `functions` maps a pathname test to a Pages Function
 * onRequest; it is consulted only for requests _routes.json sends to Functions.
 */
export function deployment(dir, { functions = [], useRoutes = true } = {}) {
  const files = walk(dir);
  const manifest = new Map();
  for (const [path, file] of files) {
    const body = readFileSync(file);
    const key = createHash('sha256').update(body).digest('hex').slice(0, 32);
    assetStore.set(key, { body, contentType: TYPES[extname(path)] || 'application/octet-stream' });
    manifest.set(path, key);
  }
  const text = (n) => (existsSync(join(dir, n)) ? readFileSync(join(dir, n), 'utf8') : null);
  const metadata = createMetadataObject({
    redirects: text('_redirects') !== null ? parseRedirects(text('_redirects')) : undefined,
    headers: text('_headers') !== null ? parseHeaders(text('_headers')) : undefined,
  });
  const routesText = useRoutes ? text('_routes.json') : null;
  const routes = routesText ? JSON.parse(routesText) : null;
  return { dir, manifest, metadata, routes, functions };
}

/** A colo: one preservation store, serving whichever deployment is active. */
export function colo() {
  const caches = cacheStorage();
  const stats = { functionCalls: [] };
  let active = null;

  async function assets(request) {
    const pending = [];
    const res = await generateHandler({
      request,
      metadata: active.metadata,
      xServerEnvHeader: undefined,
      xDeploymentIdHeader: false,
      logError: () => {},
      findAssetEntryForPath: async (path) => (active.manifest.has(path) ? path : null),
      getAssetKey: (entry) => active.manifest.get(entry),
      negotiateContent: () => ({ encoding: null }),
      fetchAsset: async (key) => {
        const a = assetStore.get(key);
        if (!a) throw new Error(`no asset ${key}`);
        return { body: a.body, contentType: a.contentType };
      },
      caches,
      waitUntil: (p) => pending.push(p),
    });
    await Promise.all(pending);                       // the preservation write lands before the next request
    return res;
  }

  const env = { ASSETS: { fetch: (req) => assets(req instanceof Request ? req : new Request(req)) } };

  async function fetch(request) {
    const req = request instanceof Request ? request : new Request(request);
    const { pathname } = new URL(req.url);
    const routes = active.routes;
    if (routes) {
      for (const ex of routes.exclude) if (isRoutingRuleMatch(pathname, ex)) return env.ASSETS.fetch(req);
      for (const inc of routes.include) {
        if (isRoutingRuleMatch(pathname, inc)) {
          stats.functionCalls.push(pathname);
          const fn = active.functions.find((f) => f.match(pathname));
          if (!fn) return env.ASSETS.fetch(req);      // the router finds no Function: next()
          const pending = [];
          const r = await fn.onRequest({ request: req, env: { ...env, ...(fn.env || {}) }, params: {}, waitUntil: (p) => pending.push(p), next: () => env.ASSETS.fetch(req) });
          await Promise.all(pending);
          return r;
        }
      }
    }
    return env.ASSETS.fetch(req);
  }

  return {
    caches, stats, env, fetch,
    activate(d) { active = d; },
    get active() { return active; },
  };
}

/** Serve a colo over HTTP for a browser. Resolves to { url, close }. */
export function listen(c) {
  const srv = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const host = `http://${req.headers.host}`;
      const body = chunks.length && !['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined;
      const r = await c.fetch(new Request(host + req.url, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')), body }));
      const headers = Object.fromEntries(r.headers);
      delete headers['content-encoding'];
      delete headers['content-length'];
      res.writeHead(r.status, headers).end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined);
    } catch (e) {
      res.writeHead(500).end(String(e?.stack || e));
    }
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)),
  })));
}
