// W55.2 — IMAGES IN MESSAGES (ruling 222). Sent through the server; only readers granted image
// posting can send them.
//
// Before this round the web uploaded straight to dm_images/{convId}/… from the browser. storage.rules
// had no rule for that path, so every upload was refused and the send failed without a word (audit
// SQ-02). Storage rules cannot read the database, so they cannot ask "does this reader hold the
// grant?" — R43's note in app/square/page.js. So the bytes go to functions/api/square/dm-image.js,
// which checks, uploads with the admin credential, and answers with the image's address. The client
// then writes the message, and the dm_messages rules accept that imageUrl only from a granted reader,
// only pointing at their own upload in that conversation's folder.
//
//   POST /api/square/dm-image?conv=<convId>
//     Authorization: Bearer <Firebase ID token>    (the header ONLY)
//     Content-Type:  image/jpeg | image/png | image/webp | image/gif
//     body:          the image's bytes, at most DM_IMAGE_MAX_BYTES
//   → 200 { ok: true, url }
//   → 4xx/5xx { ok: false, code, error }
//
// The checks, in order: the token (401 signed_out) · the conversation is the caller's (403
// not_in_conversation) · the grant, users/{uid}/canPostImages === true, the test can() applies
// (403 no_grant) · no block either way (403 blocked) · an image, by its first bytes as well as its
// declared type (415 not_image) · the size cap (413 too_large).
//
// Pure apart from sendDmImage() and prepareImage(), which run in the browser.

export const DM_IMAGE_ENDPOINT = '/api/square/dm-image';

// W55.2 (amended) — THE SHRINK, then THE CAP. Before upload the browser redraws every image but a GIF
// at most DM_IMAGE_LONG_EDGE px on its long side, as a JPEG at DM_IMAGE_QUALITY (prepareImage).
// Measured in Chromium on three real 12-megapixel photos (4032×3024, Wikimedia Commons), W55.2:
//   3.19 MB → 0.46 MB · 5.30 MB (iPhone XS) → 0.48 MB · 9.78 MB → 0.27 MB, all 1600×1200, EXIF gone.
// The cap is checked by the Function on the bytes it receives, i.e. AFTER the shrink, so it only
// ever bites on a GIF (sent as it is, so it keeps moving) or a file the browser could not draw.
// 2 MiB: four times the largest shrunk photo measured, and it bounds what a GIF can cost. The redraw
// also drops the photo's EXIF — on a phone that includes where it was taken.
export const DM_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const DM_IMAGE_LONG_EDGE = 1600;
export const DM_IMAGE_QUALITY = 0.8;

export const DM_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const BUCKET = 'calvary-scribblings.firebasestorage.app';

// The folder a conversation's images live in, and the stem every object a reader sends starts with:
// dm_images/{convId}/{senderUid}_{id}. The sender is in the name so the rules can hold a message to
// its sender's own upload, and so the images a reader sent can be found by name.
export const dmImageObject = (convId, uid, id) => `dm_images/${convId}/${uid}_${id}`;

// What the dm_messages rules check an imageUrl begins with. encodeURIComponent of a convId or a uid
// changes nothing (they are letters, digits, '-' and '_'), so the rules can build it by concatenation.
export const dmImageUrlPrefix = (convId, uid) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/dm_images%2F${convId}%2F${uid}_`;

export const dmImageUrl = (objectName, token) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(objectName)}?alt=media&token=${token}`;

/** The two uids of a conversation id ("a_b", sorted), or null when it is not one of `uid`'s. */
export function otherInConversation(convId, uid) {
  if (typeof convId !== 'string' || !uid || convId.length > 260 || !/^[A-Za-z0-9_-]+$/.test(convId)) return null;
  if (convId.startsWith(`${uid}_`)) { const o = convId.slice(uid.length + 1); return o && o !== uid ? o : null; }
  if (convId.endsWith(`_${uid}`)) { const o = convId.slice(0, -(uid.length + 1)); return o && o !== uid ? o : null; }
  return null;
}

/** The image type its first bytes say it is, or null. A declared type alone is never trusted. */
export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export const DM_IMAGE_COPY = Object.freeze({
  bad_request: 'That couldn’t be sent.',
  signed_out: 'Your session has expired. Please sign in again.',
  not_in_conversation: 'That couldn’t be sent.',
  no_grant: 'Images aren’t on for your account.',
  blocked: 'You can’t message this reader.',
  not_image: 'That file isn’t an image we can send.',
  too_large: 'That image is too large to send.',
  unavailable: 'That couldn’t be sent just now.',
});

// The refusals a reader can act on, whose words "Not sent." carries; everything else says only that.
export const DM_IMAGE_SHOWN = Object.freeze(['no_grant', 'not_image', 'too_large']);

// ── W55.2, rulings 224 and 225 — an image lasts 24 hours ───────────────────────────────────
//
// 224: a message's image lasts 24 hours. storage/lifecycle.json deletes every object under
// dm_images/ once Cloud Storage counts it a day old, and the conversation stops asking for it at
// the same mark: past DM_IMAGE_TTL_MS from the message's createdAt the image is drawn as
// DM_IMAGE_EXPIRED and its address is never requested. The words in the message stay.
// 225: a reported image is copied (functions/api/square/report-image.js) to DM_HELD_PREFIX, which
// the lifecycle rule does not match, and the report points at the copy until a moderator resolves
// it in /admin/reports, which deletes the copy and nothing else.
export const DM_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;
export const DM_IMAGE_EXPIRED = 'This image has expired.';
export const DM_IMAGE_PREVIEW_NOTE = 'Images disappear after 24 hours.';

/**
 * True once a message is MORE than 24 hours old: exactly 24 hours is still shown. A message with no
 * usable createdAt is treated as expired, so an address of unknown age is never requested.
 */
export function imageExpired(createdAt, now = Date.now()) {
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return true;
  return now - createdAt > DM_IMAGE_TTL_MS;
}

export const DM_IMAGES_PREFIX = 'dm_images/';
export const DM_HELD_PREFIX = 'dm_reported/';
export const REPORT_IMAGE_ENDPOINT = '/api/square/report-image';

/** The object name inside a dm_images address this module built (dmImageUrl), or null. */
export function objectFromDmImageUrl(url) {
  const head = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/`;
  if (typeof url !== 'string' || !url.startsWith(head)) return null;
  let name;
  try { name = decodeURIComponent(url.slice(head.length).split('?')[0]); } catch { return null; }
  if (!name.startsWith(DM_IMAGES_PREFIX) || name.includes('..') || name.split('/').length !== 3) return null;
  return name;
}

/** Where a report holds its copy: dm_reported/{contentKey}/{reporterUid}_{the original's file name}. */
export const heldImageObject = (contentKey, reporterUid, originalName) =>
  `${DM_HELD_PREFIX}${contentKey}/${reporterUid}_${originalName.split('/').pop()}`;

// ── the browser's half ──────────────────────────────────────────────────────────────────

/**
 * Redraw an image at most DM_IMAGE_LONG_EDGE on its long side, as a JPEG at DM_IMAGE_QUALITY. Every
 * image is redrawn, however small, so none leaves the phone with its EXIF. A transparent PNG is laid
 * on white (a JPEG has no transparency). A GIF is sent as it is (a canvas would stop it moving), and
 * so is anything the browser cannot draw — the Function then judges it, cap and all.
 */
export async function prepareImage(file) {
  if (!file || file.type === 'image/gif' || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, DM_IMAGE_LONG_EDGE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', DM_IMAGE_QUALITY));
    return blob || file;
  } catch {
    return file;
  }
}

/**
 * Resolves the image's address once the Function has stored it; throws otherwise. The error carries
 * `code` and `shown` (the Function's words when the reader can act on them, else null).
 */
export async function sendDmImage(user, convId, file, { fetchImpl = (...a) => fetch(...a) } = {}) {
  if (!user) throw Object.assign(new Error('signed_out'), { code: 'signed_out', shown: null });
  const token = await user.getIdToken();
  let res;
  try {
    res = await fetchImpl(`${DM_IMAGE_ENDPOINT}?conv=${encodeURIComponent(convId)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', Authorization: `Bearer ${token}` },
      body: file,
    });
  } catch {
    throw Object.assign(new Error('network'), { code: 'network', shown: null });
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data?.ok && typeof data.url === 'string') return data.url;
  const code = data?.code || `http_${res.status}`;
  throw Object.assign(new Error(code), { code, shown: DM_IMAGE_SHOWN.includes(code) ? (data?.error || null) : null });
}

/**
 * 225 — ask the server to hold a reported image ('hold', by the reporter, after the report is
 * written) or to delete a resolved report's held copies ('release', by a moderator). Resolves the
 * server's answer; throws with `code` when it refuses or cannot be reached.
 */
export async function reportImage(user, action, contentKey, { fetchImpl = (...a) => fetch(...a) } = {}) {
  if (!user) throw Object.assign(new Error('signed_out'), { code: 'signed_out' });
  const token = await user.getIdToken();
  let res;
  try {
    res = await fetchImpl(REPORT_IMAGE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, contentKey }),
    });
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' });
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data?.ok) return data;
  const code = data?.code || `http_${res.status}`;
  throw Object.assign(new Error(code), { code });
}
