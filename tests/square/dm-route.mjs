// W55.2 — /api/square/dm-image and /api/square/report-image for the Playwright suites, run FOR REAL
// against the emulators, as write-route.mjs does for /api/square/write.
//
// `next dev` serves no Pages Functions, so the browser's request is intercepted (page.route) and
// handed to the Function itself, unmodified, in the test process. Its calls go:
//
//   identitytoolkit accounts:lookup         → the AUTH EMULATOR (the page's real emulator ID token)
//   oauth2 token                            → a dummy admin token ("owner", which the emulators accept)
//   the database                            → the DATABASE EMULATOR, namespace DB_NAMESPACE
//   storage.googleapis.com (upload, copy,   → the STORAGE EMULATOR
//     list, delete)
//
// And the page's own requests for an image's address (firebasestorage.googleapis.com/v0/…) are
// answered by the storage emulator, which honours the download token. Anything else is refused.
// Nothing reaches production.
import { generateKeyPairSync } from 'node:crypto';
import { handleDmImage } from '../../functions/api/square/dm-image.js';
import { handleReportImage } from '../../functions/api/square/report-image.js';
import { DB_NAMESPACE } from '../series/harness.mjs';

const FAKE = 'https://w552-square.test';
const DB = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
export const STORAGE = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199'}`;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'emulator-api-key',
  FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_DATABASE_URL: FAKE,
};

/** Google's storage addresses, on the storage emulator. copyTo is mounted at /b/…, not /storage/v1/b/…. */
export function storageTarget(url) {
  if (url.startsWith('https://storage.googleapis.com/upload/storage/v1/')) return `${STORAGE}${url.slice('https://storage.googleapis.com'.length)}`;
  if (url.startsWith('https://storage.googleapis.com/storage/v1/')) return `${STORAGE}/${url.slice('https://storage.googleapis.com/storage/v1/'.length)}`;
  if (url.startsWith('https://firebasestorage.googleapis.com/')) return `${STORAGE}${url.slice('https://firebasestorage.googleapis.com'.length)}`;
  return null;
}

let installed = false;
export function installFetch({ db = DB, ns = DB_NAMESPACE } = {}) {
  if (installed) return;
  installed = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const { signal, ...rest } = init;
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'owner', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) return realFetch(`${AUTH}/${url.slice('https://'.length)}`, rest);
    if (url.startsWith(FAKE)) {
      const u = new URL(url);
      return realFetch(`${db}${u.pathname}?ns=${ns}${u.search ? `&${u.search.slice(1)}` : ''}`, { ...rest, headers: { ...(init.headers || {}), Authorization: 'Bearer owner' } });
    }
    const st = storageTarget(url);
    if (st) return realFetch(st, { ...rest, headers: { ...(init.headers || {}), Authorization: 'Bearer owner' } });
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return realFetch(input, init);
    throw new Error(`dm-route: refused an outbound call to ${new URL(url).host}`);
  };
}

async function hand(route, handler) {
  const req = route.request();
  const headers = new Headers(req.headers());
  const body = req.postDataBuffer();
  const res = await handler({ request: new Request(req.url(), { method: req.method(), headers, body }), env: ENV, waitUntil: () => {} });
  return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
}

/**
 * Serve both Functions, and the stored images, on this page.
 *   failImage  answer /api/square/dm-image with this status (an outage); change it via control.failImage
 * Returns a control: { images: [answered bodies], imageRequests: [urls the page asked for], failImage }.
 */
export async function routeDmFunctions(page, { failImage = null } = {}) {
  installFetch();
  const control = { images: [], imageRequests: [], failImage };
  await page.route('**/api/square/dm-image**', async (route) => {
    if (control.failImage) {
      return route.fulfill({ status: control.failImage, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'unavailable', error: 'That couldn’t be sent just now.' }) });
    }
    const r = await hand(route, handleDmImage);
    return r;
  });
  await page.route('**/api/square/report-image', (route) => hand(route, handleReportImage));
  await page.route('https://firebasestorage.googleapis.com/**', async (route) => {
    control.imageRequests.push(route.request().url());
    const res = await fetch(storageTarget(route.request().url()));
    return route.fulfill({ status: res.status, headers: { 'Content-Type': res.headers.get('content-type') || 'application/octet-stream' }, body: Buffer.from(await res.arrayBuffer()) });
  });
  return control;
}

// ── the storage emulator, as admin ───────────────────────────────────────────────────────────
const OWNER = { Authorization: 'Bearer owner' };
const BUCKET_NAME = 'calvary-scribblings.firebasestorage.app';
export async function putObject(name, bytes, token, contentType = 'image/jpeg') {
  const boundary = 'w552';
  const meta = JSON.stringify({ name, contentType, metadata: { firebaseStorageDownloadTokens: token } });
  const te = new TextEncoder();
  const head = te.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = te.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const r = await fetch(`${STORAGE}/upload/storage/v1/b/${BUCKET_NAME}/o?uploadType=multipart`, { method: 'POST', headers: { ...OWNER, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  if (!r.ok) throw new Error(`emulator upload ${r.status}`);
}
export async function listNames(prefix) {
  const r = await fetch(`${STORAGE}/b/${BUCKET_NAME}/o?prefix=${encodeURIComponent(prefix)}`, { headers: OWNER });
  return ((await r.json()).items || []).map((i) => i.name).sort();
}
export async function wipeObjects(...prefixes) {
  for (const p of prefixes) for (const n of await listNames(p)) await fetch(`${STORAGE}/b/${BUCKET_NAME}/o/${encodeURIComponent(n)}`, { method: 'DELETE', headers: OWNER });
}
