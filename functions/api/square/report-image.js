// THE SQUARE — a reported image, held. Cloudflare Pages Function. W55.2, ruling 225.
//
// POST /api/square/report-image
//   credential:  Authorization: Bearer <Firebase ID token>   (the header ONLY)
//   body:        { action: 'hold' | 'release', contentKey: 'dm_<convId>' }
//
//   → 200 { ok: true, ... }
//   → 4xx/5xx { ok: false, code }
//
// An image in a message lasts 24 hours (ruling 224): storage/lifecycle.json deletes everything
// under dm_images/ once it is a day old. A REPORTED image must outlast that, so a moderator sees
// what was sent however long the report waits.
//
//   hold     by the REPORTER, after their report is written (the rules have already checked its
//            imageUrl is exactly the reported message's). The server copies that object to
//            dm_reported/{contentKey}/{reporterUid}_{name}, a prefix the lifecycle rule does not
//            match, with a fresh download token, and repoints the report's imageUrl at the copy.
//            Repeating it is harmless: a report already pointing at its copy answers ok.
//            → 404 no_report · 409 no_image · 410 gone (the original was already cleared out)
//   release  by a MODERATOR (users/{uid}/canRemovePosts === true, the grant /admin/reports and the
//            content_reports rules use), once the report is resolved: deletes every object under
//            dm_reported/{contentKey}/ and NOTHING ELSE. → 403 not_moderator · 409 open
//
// Clients cannot read or write dm_reported/ at all (storage.rules); the report's address carries
// a download token, which is how /admin/reports draws it.
//
// ── LOGGING ────────────────────────────────────────────────────────────────────────────
// Codes only. Never a reader's uid, the conversation, or an env value.

import { dbBase, lookupUser, mintAccessToken, SCOPES, FIREBASE_TIMEOUT_MS, PROVIDER_TIMEOUT_MS } from '../bookstore/_lib.js';
import { BUCKET, DM_HELD_PREFIX, dmImageUrl, heldImageObject, objectFromDmImageUrl, otherInConversation } from '../../../app/lib/dmImages.js';

const LABEL = 'square/report-image';
const STORAGE_SCOPES = `${SCOPES} https://www.googleapis.com/auth/devstorage.read_write`;
const GCS = 'https://storage.googleapis.com/storage/v1';

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const fail = (code, status) => reply({ ok: false, code }, status);

const enc = (path) => path.split('/').map(encodeURIComponent).join('/');
const timeout = (ms) => AbortSignal.timeout(ms);

async function dbGet(env, token, path) {
  const res = await fetch(`${dbBase(env)}/${enc(path)}.json`, { headers: { Authorization: `Bearer ${token}` }, signal: timeout(FIREBASE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`RTDB GET ${res.status}`);
  return res.json();
}
async function dbPut(env, token, path, value) {
  const res = await fetch(`${dbBase(env)}/${enc(path)}.json`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RTDB PUT ${res.status}`);
}

/** dm_<convId>, where the conversation is a well-formed one; else null. */
const convOfKey = (contentKey) => (typeof contentKey === 'string' && /^dm_[A-Za-z0-9_-]{3,260}$/.test(contentKey) ? contentKey.slice(3) : null);

async function hold(env, token, uid, contentKey) {
  const convId = convOfKey(contentKey);
  if (!convId || !otherInConversation(convId, uid)) return fail('not_in_conversation', 403);
  const rec = await dbGet(env, token, `content_reports/${contentKey}/${uid}`);
  if (!rec || rec.kind !== 'dm' || rec.reporterUid !== uid) return fail('no_report', 404);
  const heldStem = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`${DM_HELD_PREFIX}${contentKey}/`)}`;
  if (typeof rec.imageUrl === 'string' && rec.imageUrl.startsWith(heldStem)) return reply({ ok: true, held: true });
  const source = objectFromDmImageUrl(rec.imageUrl);
  // The report's image must be the offender's own upload in this conversation — what the rules held
  // the message to — and still the message's image.
  if (!source || !source.startsWith(`dm_images/${convId}/${rec.offenderUid}_`)) return fail('no_image', 409);
  if (typeof rec.contextPath !== 'string' || !rec.contextPath.startsWith(`dm_messages/${convId}/`)) return fail('no_image', 409);
  const message = await dbGet(env, token, rec.contextPath);
  if (!message || message.imageUrl !== rec.imageUrl) return fail('no_image', 409);

  const dest = heldImageObject(contentKey, uid, source);
  const downloadToken = crypto.randomUUID();
  const res = await fetch(`${GCS}/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(source)}/copyTo/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(dest)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: { firebaseStorageDownloadTokens: downloadToken } }),
    signal: timeout(PROVIDER_TIMEOUT_MS),
  });
  if (res.status === 404) return fail('gone', 410);
  if (!res.ok) throw new Error(`copy ${res.status}`);
  await dbPut(env, token, `content_reports/${contentKey}/${uid}/imageUrl`, dmImageUrl(dest, downloadToken));
  return reply({ ok: true, held: true });
}

async function release(env, token, uid, contentKey) {
  if (!convOfKey(contentKey)) return fail('bad_request', 400);
  const [grant, resolved] = await Promise.all([
    dbGet(env, token, `users/${uid}/canRemovePosts`),
    dbGet(env, token, `content_reports/${contentKey}/resolved`),
  ]);
  if (grant !== true) return fail('not_moderator', 403);
  if (resolved !== true) return fail('open', 409);
  const prefix = `${DM_HELD_PREFIX}${contentKey}/`;
  let deleted = 0;
  let pageToken = '';
  do {
    const list = await fetch(`${GCS}/b/${encodeURIComponent(BUCKET)}/o?prefix=${encodeURIComponent(prefix)}&fields=items(name),nextPageToken${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!list.ok) throw new Error(`list ${list.status}`);
    const data = await list.json();
    for (const { name } of data.items || []) {
      if (!name.startsWith(prefix)) continue;
      const del = await fetch(`${GCS}/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, signal: timeout(PROVIDER_TIMEOUT_MS) });
      if (!del.ok && del.status !== 404) throw new Error(`delete ${del.status}`);
      deleted += 1;
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return reply({ ok: true, deleted });
}

export async function handleReportImage(context) {
  const { request, env } = context;
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

  let body;
  try { body = await request.json(); } catch { return fail('bad_request', 400); }
  const { action, contentKey } = body || {};
  if (action !== 'hold' && action !== 'release') return fail('bad_request', 400);

  let token;
  try {
    token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, STORAGE_SCOPES);
  } catch {
    console.error(`[${LABEL}] admin token mint failed`);
    return fail('unavailable', 502);
  }
  try {
    return action === 'hold' ? await hold(env, token, uid, contentKey) : await release(env, token, uid, contentKey);
  } catch (e) {
    console.error(`[${LABEL}] ${action} failed: ${e?.message || 'error'}`);
    return fail('unavailable', 502);
  }
}

export async function onRequestPost(context) {
  return handleReportImage(context);
}
