// THE SQUARE — an image in a message. Cloudflare Pages Function. W55.2, ruling 222.
//
// POST /api/square/dm-image?conv=<convId>
//   credential:  Authorization: Bearer <Firebase ID token>   (the header ONLY)
//   body:        the image's bytes; Content-Type image/jpeg | image/png | image/webp | image/gif
//
//   → 200 { ok: true, url }                 url = the stored image's address
//   → 4xx/5xx { ok: false, code, error }
//
// Why a server at all: storage.rules cannot read the database, so no storage rule can ask whether a
// reader holds the image grant (R43's note in app/square/page.js). Clients cannot write dm_images/
// at all (storage.rules); this Function uploads with the admin credential after its checks. The
// client then writes the message, and the dm_messages rules accept its imageUrl only from a granted
// reader, and only pointing at that reader's own upload in that conversation's folder. The shared
// pieces (the cap, the names, the copy) are app/lib/dmImages.js.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// THE ORDER OF THE CHECKS
// ═══════════════════════════════════════════════════════════════════════════════════════
//
//   1. THE TOKEN                    → 401 signed_out          accounts:lookup, as write.js does
//   2. THE CONVERSATION             → 403 not_in_conversation the caller is one of its two readers
//   3. THE GRANT                    → 403 no_grant            users/{uid}/canPostImages === true,
//                                                             the test can() applies; no founder
//                                                             exemption, as can() has none
//   4. THE BARRIER                  → 403 blocked             blocked_users either way (ruling 208)
//   5. THE FILE                     → 415 not_image · 413 too_large
//      Its first bytes must be a JPEG, PNG, WebP or GIF, and agree with the declared type; at most
//      DM_IMAGE_MAX_BYTES (2 MiB, after the browser's shrink). A declared Content-Length over the cap is refused before reading.
//   6. THE UPLOAD                   dm_images/{convId}/{uid}_{id}, with a download token
//
// A database read or the upload failing FAILS CLOSED (502 unavailable): no image, and the message
// shows "Not sent." with Try again.
//
// ── LOGGING ────────────────────────────────────────────────────────────────────────────
// Codes only. Never a reader's uid, the conversation, the bytes, or an env value.

import { dbBase, lookupUser, mintAccessToken, SCOPES, FIREBASE_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from '../bookstore/_lib.js';
import {
  BUCKET, DM_IMAGE_COPY, DM_IMAGE_MAX_BYTES, DM_IMAGE_TYPES,
  dmImageObject, dmImageUrl, otherInConversation, sniffImageType,
} from '../../../app/lib/dmImages.js';

const LABEL = 'square/dm-image';
const STORAGE_SCOPES = `${SCOPES} https://www.googleapis.com/auth/devstorage.read_write`;

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const fail = (code, status) => reply({ ok: false, code, error: DM_IMAGE_COPY[code] || DM_IMAGE_COPY.unavailable }, status);

const enc = (path) => path.split('/').map(encodeURIComponent).join('/');

async function dbGet(env, token, path) {
  const res = await fetch(`${dbBase(env)}/${enc(path)}.json`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`RTDB GET ${res.status}`);
  return res.json();
}

const randomId = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return `${Date.now().toString(36)}${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
};

// One multipart upload: the object's metadata (its type and a Firebase download token, which is what
// makes the returned address readable by an <img>), then the bytes.
async function upload(token, name, bytes, contentType) {
  const boundary = `cs-${randomId()}`;
  const downloadToken = crypto.randomUUID();
  const meta = JSON.stringify({ name, contentType, metadata: { firebaseStorageDownloadTokens: downloadToken } });
  const te = new TextEncoder();
  const head = te.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = te.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(BUCKET)}/o?uploadType=multipart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`upload ${res.status}`);
  return dmImageUrl(name, downloadToken);
}

export async function handleDmImage(context) {
  const { request, env } = context;

  // ── 1. the token ── the header, never the body ─────────────────────────────────────
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  const idToken = m ? m[1].trim() : '';
  if (!idToken) return fail('signed_out', 401);
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error(`[${LABEL}] missing NEXT_PUBLIC_FIREBASE_API_KEY / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY`);
    return fail('unavailable', 503);
  }
  const account = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
  const uid = account?.localId;
  if (!uid) return fail('signed_out', 401);

  // ── 2. the conversation ────────────────────────────────────────────────────────────
  let convId = '';
  try { convId = new URL(request.url).searchParams.get('conv') || ''; } catch { /* refused below */ }
  const other = otherInConversation(convId, uid);
  if (!other) return fail('not_in_conversation', 403);

  // Before any bytes are read: a declared length over the cap is refused outright.
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > DM_IMAGE_MAX_BYTES) return fail('too_large', 413);

  let token;
  try {
    token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, STORAGE_SCOPES);
  } catch {
    console.error(`[${LABEL}] admin token mint failed`);
    return fail('unavailable', 502);
  }

  try {
    // ── 3. the grant ── and 4. the barrier, read together ─────────────────────────────
    const [grant, iBlocked, theyBlocked] = await Promise.all([
      dbGet(env, token, `users/${uid}/canPostImages`),
      dbGet(env, token, `blocked_users/${uid}/${other}`),
      dbGet(env, token, `blocked_users/${other}/${uid}`),
    ]);
    if (grant !== true) return fail('no_grant', 403);
    if (iBlocked != null || theyBlocked != null) return fail('blocked', 403);

    // ── 5. the file ──────────────────────────────────────────────────────────────────
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > DM_IMAGE_MAX_BYTES) return fail('too_large', 413);
    const declaredType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const type = sniffImageType(bytes);
    if (!type || !DM_IMAGE_TYPES.includes(declaredType) || type !== declaredType) return fail('not_image', 415);

    // ── 6. the upload ────────────────────────────────────────────────────────────────
    const url = await upload(token, dmImageObject(convId, uid, randomId()), bytes, type);
    return reply({ ok: true, url });
  } catch (e) {
    console.error(`[${LABEL}] failed: ${e?.message || 'error'}`);
    return fail('unavailable', 502);
  }
}

export async function onRequestPost(context) {
  return handleDmImage(context);
}
