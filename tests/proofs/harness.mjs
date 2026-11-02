// PROOFS — the Functions, run unmodified against the RTDB EMULATOR (its own port, 9410, from
// firebase.proofs-test.json, so a second session's emulator on 9000 is never touched).
//
// Built on the W49 pattern (tests/reads/harness.mjs). Only Google and Resend are stood in for:
//   oauth2.googleapis.com/token      → a dummy admin token (the emulator accepts "Bearer owner")
//   identitytoolkit accounts:lookup  → `tok-<uid>` verifies as <uid>; anything else does not
//   api.resend.com/emails            → counted, answered 200; never sent
// Everything else outbound is REFUSED, so nothing here can reach production.
//
// NO FOUNDER ACCOUNT, even here (standing rule). The founder branch is exercised by injecting a
// stand-in check, `founders: (uid) => uid === STAND_IN_FOUNDER`, into the handlers — the same
// seam the production code calls with the real isFounder.
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9410';
const EMU = `http://${HOST}`;
export const NS = 'proofs-r2';
const FAKE = 'https://proofs.test';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });

export const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_DATABASE_URL: FAKE,
  RESEND_API_KEY: 'test-resend',
  FROM_EMAIL: 'alerts@example.test',
  LAUNCH_ALERT_EMAIL: 'editors@example.test',
};
export const STAND_IN_FOUNDER = 'proofs-stand-in-founder';
export const founders = (uid) => uid === STAND_IN_FOUNDER;
export const tokenFor = (uid) => `tok-${uid}`;

const realFetch = globalThis.fetch;
export const sent = [];   // the emails that WOULD have gone: { subject, text, to, from }
/** Invented Auth accounts for the admin lookup (PROOFS-R3): uid → { email, emailVerified, disabled }. */
export const ACCOUNTS = {};
/** Set `next` to an HTTP status to make the next Resend call fail with it. */
export const resendFails = { next: 0 };

export function install() {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'owner', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      const { idToken, localId } = JSON.parse(init.body || '{}');
      // PROOFS-R3: the admin lookup by uid (the writer emails) answers from ACCOUNTS, invented.
      if (Array.isArray(localId)) {
        return new Response(JSON.stringify({ users: localId.filter((u) => ACCOUNTS[u]).map((u) => ({ localId: u, ...ACCOUNTS[u] })) }), { status: 200 });
      }
      const m = /^tok-(.+)$/.exec(idToken || '');
      return m
        ? new Response(JSON.stringify({ users: [{ localId: m[1], ...(ACCOUNTS[m[1]] || {}) }] }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: 'INVALID_ID_TOKEN' } }), { status: 400 });
    }
    if (url === 'https://api.resend.com/emails') {
      const b = JSON.parse(init.body || '{}');
      if (resendFails.next) { const st = resendFails.next; resendFails.next = 0; return new Response('{}', { status: st }); }
      sent.push({ subject: b.subject, text: b.text, to: b.to, from: b.from });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200 });
    }
    if (url.startsWith(FAKE)) {
      const u = new URL(url);
      const target = `${EMU}${u.pathname}?ns=${NS}${u.search ? `&${u.search.slice(1)}` : ''}`;
      const headers = { ...(init.headers || {}), Authorization: 'Bearer owner' };
      const { signal, ...rest } = init;
      return realFetch(target, { ...rest, headers });
    }
    throw new Error(`proofs harness: refused an outbound call to ${new URL(url).host}`);
  };
}
export function uninstall() { globalThis.fetch = realFetch; }

const emu = (path) => `${EMU}/${path}.json?ns=${NS}`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
export async function get(path) { return (await realFetch(emu(path), { headers: H })).json(); }
export async function set(path, value) {
  const r = await realFetch(emu(path), { method: 'PUT', headers: H, body: JSON.stringify(value) });
  if (!r.ok) throw new Error(`emulator PUT ${path} ${r.status}`);
}
export async function wipe() { await set('', null); sent.length = 0; resendFails.next = 0; }

/** This namespace gets the repo's real rules (the server's queries need their .indexOn). */
export async function loadRules() {
  const rules = readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8');
  const r = await realFetch(`${EMU}/.settings/rules.json?ns=${NS}`, { method: 'PUT', headers: H, body: rules });
  if (!r.ok) throw new Error(`emulator rules PUT ${r.status}`);
}

export function request(path, { body, token, method = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://calvaryscribblings.co.uk${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
export const context = (req, env = ENV) => {
  const pending = [];
  return { ctx: { request: req, env, waitUntil: (p) => pending.push(p) }, settle: () => Promise.allSettled(pending) };
};
