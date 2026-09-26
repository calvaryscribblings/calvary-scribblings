// W17 — THE LIVE WRITE FIREWALL. One guard for every harness that runs a signed-in browser against
// the LIVE site. It replaces the per-harness socket proxies of W9, W11, W13 and W16.
//
// THE GAP IT CLOSES (found in W15). Those proxies watched only the database's WebSocket. The
// Firebase SDK has a second transport: when a WebSocket fails to connect, it records
// localStorage['firebase:previous_websocket_failure'] and reconnects by LONG-POLLING — plain HTTP
// requests to <db>/.lp, whose `d` parameters carry the same write frames. It also RE-SENDS every
// write it is still waiting on when it reconnects, and a write a proxy dropped is one it is still
// waiting on. So a proxied socket that failed once, or a network cut and restored, could put a
// dropped write back on the wire by a route the proxy never saw.
//
// THE RULE NOW: NOTHING LEAVES THE BROWSER THAT COULD WRITE, BY ANY ROUTE.
//   1. The database WebSocket is proxied, and every write frame (set, update, onDisconnect…) is
//      stopped at the proxy. mode 'drop' swallows it; mode 'answer' acks it locally, after
//      echoing the value to listeners as the server would (W13 needs the page to see a save).
//   2. Long-polling is ABORTED — every request to /.lp on a database host, reads included. The
//      fallback does not exist for a harness. If the socket fails, the page has no database and
//      the harness fails loudly; it can never write quietly.
//   3. Every other request that is not a GET is ABORTED, anywhere, unless it is on ALLOW_POST:
//      a short list of requests that only read (token refresh, the account lookup, and the three
//      endpoints that take a POST body to return content). The database REST API, Storage
//      uploads, every other /api endpoint, analytics beacons — all refused.
//   4. /api/hit is aborted whatever its method: a GET that increments.
// Every refusal is counted in `stats`; a harness prints the counts and never a URL's query (tokens).
//
// Use liveContext() — it also blocks service workers, because a context route cannot see a
// worker's own fetches.

export const DB_HOST = /(^|\.)(firebasedatabase\.app|firebaseio\.com)$/;
const WS_DB = /firebasedatabase\.app|firebaseio\.com/;
const WRITE_ACTIONS = new Set(['p', 'm', 'o', 'om', 'oc', 'on']);

// Requests that are not GETs but only READ. Anything else that is not a GET is refused.
export const ALLOW_POST = [
  { host: 'securetoken.googleapis.com', path: /^\/v1\/token$/ },                        // ID-token refresh
  { host: 'identitytoolkit.googleapis.com', path: /^\/v1\/accounts:lookup$/ },          // who am I
  { site: true, path: /^\/api\/story$/ },                                               // the story body
  { site: true, path: /^\/api\/series\/stream$/ },                                      // an instalment's bytes
  { site: true, path: /^\/api\/bookstore\/stream$/ },                                   // a book's bytes
  { site: true, path: /^\/api\/membership\/return-status$/ },                           // a read of the tier
];

export const newStats = () => ({ requestsSeen: 0, wsWritesStopped: 0, lpAborted: 0, restAborted: 0, apiAborted: 0, hitAborted: 0, otherAborted: 0, refused: [] });

/**
 * Is this request allowed out? Pure, so the CI suite can pin it.
 * @returns {null|'lp'|'rest'|'api'|'hit'|'other'} null = allowed, else the reason it is refused.
 */
export function refusal({ url, method, siteOrigin }) {
  const u = new URL(url);
  const site = siteOrigin && u.origin === new URL(siteOrigin).origin;
  if (site && /^\/api\/hit(\/|$)/.test(u.pathname)) return 'hit';
  if (DB_HOST.test(u.hostname) && (u.pathname === '/.lp' || u.pathname.startsWith('/.lp'))) return 'lp';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const ok = ALLOW_POST.some((a) => (a.site ? site : u.hostname === a.host) && a.path.test(u.pathname));
  if (ok) return null;
  if (DB_HOST.test(u.hostname)) return 'rest';
  if (site && u.pathname.startsWith('/api/')) return 'api';
  return 'other';
}

/** One parsed client frame → is it a write? */
export const isWriteFrame = (f) => f?.t === 'd' && WRITE_ACTIONS.has(f?.d?.a);

/**
 * Install on a BrowserContext (covers every page and frame in it).
 * @param opts.site   the site origin under test (for /api rules)
 * @param opts.mode   'drop' (default) or 'answer'
 * @param opts.deny   () => boolean — in 'answer' mode, answer set/update with permission_denied
 * @param opts.socket 'proxy' (default) or 'refuse' — refuse closes every database socket, which
 *                    is how the proof forces the SDK onto long-polling
 */
export async function installFirewall(ctx, { site, mode = 'drop', deny = () => false, socket = 'proxy', stats = newStats() } = {}) {
  await ctx.route('**/*', (route) => {
    const req = route.request();
    stats.requestsSeen++;
    const why = refusal({ url: req.url(), method: req.method(), siteOrigin: site });
    if (!why) return route.fallback();
    stats[{ lp: 'lpAborted', rest: 'restAborted', api: 'apiAborted', hit: 'hitAborted', other: 'otherAborted' }[why]]++;
    const u = new URL(req.url());
    if (stats.refused.length < 50) stats.refused.push(`${why} ${req.method()} ${u.host}${u.pathname}`);
    return route.abort();
  });
  await ctx.routeWebSocket(WS_DB, (ws) => {
    if (socket === 'refuse') { ws.close(); return; }
    const server = ws.connectToServer();
    let pending = 0, parts = [];
    const handle = (text, raw) => {
      let f; try { f = JSON.parse(text); } catch { f = null; }
      if (isWriteFrame(f)) {
        stats.wsWritesStopped++;
        if (mode === 'answer') {
          const refuse = deny() && (f.d.a === 'p' || f.d.a === 'm');
          // The server pushes an accepted write to listeners BEFORE it acks, and the SDK relies on
          // that (W13): on the ack it drops its local copy and shows the server's.
          if (!refuse && (f.d.a === 'p' || f.d.a === 'm')) ws.send(JSON.stringify({ t: 'd', d: { a: f.d.a === 'p' ? 'd' : 'm', b: { p: f.d.b.p, d: f.d.b.d } } }));
          ws.send(JSON.stringify({ t: 'd', d: { r: f.d.r, b: refuse ? { s: 'permission_denied', d: 'Permission denied' } : { s: 'ok', d: '' } } }));
        }
        return;
      }
      if (raw !== undefined) server.send(raw); else { server.send(String(parts.length)); parts.forEach((p) => server.send(p)); }
    };
    ws.onMessage((m) => {
      const text = typeof m === 'string' ? m : m.toString();
      // The SDK splits a large frame: first a bare count, then that many chunks.
      if (pending === 0 && /^\d+$/.test(text) && Number(text) > 1) { pending = Number(text); parts = []; return; }
      if (pending > 0) { parts.push(text); pending--; if (pending === 0) handle(parts.join('')); return; }
      handle(text, m);
    });
    server.onMessage((m) => ws.send(m));
  });
  return stats;
}

/** A context for a live harness: service workers blocked, firewall installed. */
export async function liveContext(browser, contextOptions = {}, firewallOptions = {}) {
  const ctx = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
  const stats = await installFirewall(ctx, firewallOptions);
  return { ctx, stats };
}

/** A one-line account of what the firewall refused. No URLs, no queries. */
export const statsLine = (s) => `socket writes stopped ${s.wsWritesStopped} · long-poll aborted ${s.lpAborted} · database REST aborted ${s.restAborted} · /api aborted ${s.apiAborted} · /api/hit aborted ${s.hitAborted} · other non-GET aborted ${s.otherAborted}`;
