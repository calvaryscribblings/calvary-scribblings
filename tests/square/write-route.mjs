// W54 — /api/square/write for the Playwright suites, run FOR REAL against the emulators.
//
// The pages are served by `next dev`, which serves no Pages Functions. So the browser's request
// to /api/square/write is intercepted (page.route) and handed to the Function itself —
// functions/api/square/write.js, unmodified — in the test process. Its calls go:
//
//   identitytoolkit accounts:lookup → the AUTH EMULATOR (it verifies the page's real emulator
//                                     ID token; a token it refuses is refused)
//   oauth2 token                    → a dummy admin token ("owner", which the emulator accepts)
//   the database                    → the DATABASE EMULATOR, namespace DB_NAMESPACE
//
// Anything else is refused. Nothing reaches production.
//
// The server's clock is the page's: the suites shift the browser's Date to an evening instant, and
// the Function is handed the same shifted time, so the hours (ruling 210) see what the page sees —
// unless a test passes its own `now`, which is how "the page thinks it's open, the server knows
// it isn't" is proven.
import { generateKeyPairSync } from 'node:crypto';
import { handleWrite } from '../../functions/api/square/write.js';
import { DB_NAMESPACE } from '../series/harness.mjs';

const FAKE = 'https://w54-square.test';
const DB = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'emulator-api-key',
  FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_DATABASE_URL: FAKE,
};

let installed = false;
function installFetch() {
  if (installed) return;
  installed = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'owner', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      const { signal, ...rest } = init;
      return realFetch(`${AUTH}/${url.slice('https://'.length)}`, rest);
    }
    if (url.startsWith(FAKE)) {
      const u = new URL(url);
      const { signal, ...rest } = init;
      return realFetch(`${DB}${u.pathname}?ns=${DB_NAMESPACE}${u.search ? `&${u.search.slice(1)}` : ''}`, { ...rest, headers: { ...(init.headers || {}), Authorization: 'Bearer owner' } });
    }
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return realFetch(input, init);
    throw new Error(`write-route: refused an outbound call to ${new URL(url).host}`);
  };
}

/**
 * Serve /api/square/write on this page.
 *   at      the instant the page's clock was moved to (its Date at load); the server follows it
 *   now     a fixed server time instead (a number), for the hours
 *   fail    answer every request with this status and no reason, as an outage would
 * Returns { calls, hold(), release() }: `calls` are the answered bodies; hold() parks requests
 * until release(), to see what the page does before a save is written.
 */
export async function routeSquareWrite(page, { at, now = null, fail = null } = {}) {
  installFetch();
  const shift = (at ?? Date.now()) - Date.now();
  const calls = [];
  let held = null;
  const control = {
    calls,
    hold() { if (!held) { let open; held = { wait: new Promise((r) => { open = r; }), open }; } },
    release() { if (held) { held.open(); held = null; } },
  };
  await page.route('**/api/square/write', async (route) => {
    if (held) await held.wait;
    if (fail) {
      return route.fulfill({ status: fail, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'unavailable', error: 'That couldn’t be sent just now.' }) });
    }
    const req = route.request();
    const request = new Request('https://calvaryscribblings.co.uk/api/square/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: req.headers().authorization || '' },
      body: req.postData() || '',
    });
    const res = await handleWrite({ request, env: ENV }, { now: now ?? Date.now() + shift });
    const body = await res.text();
    calls.push({ status: res.status, body: JSON.parse(body) });
    return route.fulfill({ status: res.status, contentType: 'application/json', body });
  });
  return control;
}
