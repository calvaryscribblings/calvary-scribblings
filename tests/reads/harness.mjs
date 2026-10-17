// W49 — THE READ COUNTERS, RUN FOR REAL AGAINST THE DATABASE EMULATOR.
//
// The endpoints (functions/api/hit.js, functions/api/series/read.js) run unmodified. Their database
// calls are REAL REST calls to the RTDB emulator — ETags, if-match, 412s, server increments and
// timestamps all come from the emulator, so a race is a real race. Only Google is stood in for:
//
//   oauth2.googleapis.com/token        → a dummy access token (the emulator accepts "Bearer owner")
//   identitytoolkit accounts:lookup    → `tok-<uid>` verifies as <uid>; anything else does not
//
// The endpoints are pointed at https://w49.test; this rewrites that host to the emulator's
// namespace. No request leaves the machine: anything else is refused.
//
// Run inside `firebase emulators:exec --only database` (npm run test:reads:emulator).
import { generateKeyPairSync } from 'node:crypto';

const EMU = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}`;
export const NS = 'w49reads';
const FAKE = 'https://w49.test';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

export const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_DATABASE_URL: FAKE,
};
export const tokenFor = (uid) => `tok-${uid}`;

const realFetch = globalThis.fetch;
export const counters = { identity: 0 };

/** The emulator URL for a database path. */
export const emu = (path, q = '') => `${EMU}/${path}.json?ns=${NS}${q ? `&${q}` : ''}`;

export function install() {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'owner', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      counters.identity++;
      const { idToken } = JSON.parse(init.body || '{}');
      const m = /^tok-(.+)$/.exec(idToken || '');
      return m
        ? new Response(JSON.stringify({ users: [{ localId: m[1], email: `${m[1]}@example.test` }] }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }), { status: 400 });
    }
    if (url.startsWith(FAKE)) {
      const u = new URL(url);
      const target = `${EMU}${u.pathname}?ns=${NS}${u.search ? `&${u.search.slice(1)}` : ''}`;
      const headers = { ...(init.headers || {}), Authorization: 'Bearer owner' };
      const { signal, ...rest } = init;
      return realFetch(target, { ...rest, headers });
    }
    throw new Error(`harness: refused an outbound call to ${url}`);
  };
}
export function uninstall() { globalThis.fetch = realFetch; }

// ── the emulator, as admin ─────────────────────────────────────────────────────────────────
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
export async function get(path) { return (await realFetch(emu(path), { headers: H })).json(); }
export async function set(path, value) {
  const r = await realFetch(emu(path), { method: 'PUT', headers: H, body: JSON.stringify(value) });
  if (!r.ok) throw new Error(`emulator PUT ${path} ${r.status}`);
}
export async function patch(updates) {
  const r = await realFetch(emu(''), { method: 'PATCH', headers: H, body: JSON.stringify(updates) });
  if (!r.ok) throw new Error(`emulator PATCH ${r.status}`);
}
export async function wipe() { await set('', null); }

/** A Pages Function request, as Cloudflare would hand it over. */
export function request(path, { method = 'POST', body, token, ip = '203.0.113.7' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://calvaryscribblings.co.uk${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
export const context = (req, env = ENV) => {
  const pending = [];
  return { ctx: { request: req, env, waitUntil: (p) => pending.push(p) }, settle: () => Promise.allSettled(pending) };
};
