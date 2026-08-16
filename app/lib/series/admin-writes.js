// Admin-only write helpers for series/, series_instalments/ and series_instalments_detail/.
//
// Same three rules as app/lib/bookstore/admin-writes.js, and they are the reason this file
// exists rather than the admin page writing paths directly:
//   - checks auth.currentUser.uid against the admin UIDs before writing
//   - validates via validateSeries / validateInstalment / validateInstalmentDetail and
//     refuses to write on any error
//   - never throws — returns { ok: true, ... } or { ok: false, errors: [...] }
//
// ── THE ROW AND THE DETAIL ARE ONE ATOMIC WRITE, ALWAYS ──────────────────────────────────
//
// An instalment is two nodes with two visibilities, and they must land together or not at
// all. RTDB applies a multi-path update atomically, which is the entire reason the pair can
// be trusted to agree — the same argument functions/api/membership/_membership.js makes for
// the scalar and the billing record.
//
// Written separately, the failure is not symmetric and both directions are bad. Row without
// detail: a released instalment with no title, no author and no file — a card that opens
// nothing. Detail without row: content sitting in the database with no releaseAtMs, which
// means the release rule has nothing to compare against and the record is denied forever
// while looking, to an editor, as though it were published.
//
// ── seriesId IS LOCKED AFTER CREATION ────────────────────────────────────────────────────
//
// updateInstalment() carries the existing seriesId through and ignores any in the payload,
// mirroring updateTitle()'s treatment of publisherId. The bookstore's reason was a counter
// ("reassigning a publisher requires a manual operation so titlesCount stays consistent").
// The reason here is larger, because there is no counter to keep consistent and the damage
// is to readers rather than to a number: an instalment that changes parent carries its
// ordinal into a run where that ordinal is already taken, its releaseAtMs into a schedule it
// was not written for, and every reader's stored position at
// series_reading_progress/{uid}/{instalmentId} into a series they were not reading. A
// reparent is a delete and a create, done deliberately, by a person.

import { ref, get, update } from 'firebase/database';
import { db, auth, storage } from '../firebase';
import {
  SCHEMA_VERSION,
  SERIES_PATH,
  INSTALMENTS_PATH,
  INSTALMENTS_DETAIL_PATH,
  SERIES_STATUSES,
  INSTALMENT_STATUSES,
  epubObjectPath,
  instalmentImageKey,
  validateSeries,
  validateInstalment,
  validateInstalmentDetail,
} from './schema';

const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];

const MAX_EPUB_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function isAdmin() {
  const uid = auth?.currentUser?.uid;
  return !!uid && ADMIN_UIDS.includes(uid);
}

export function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * An instalment's key. `<seriesSlug>-i<ordinal>` — flat, derivable, and readable in a log.
 *
 * FLAT rather than nested under the series because the release rule in database.rules.json
 * looks the row up by id from the detail node's own path
 * (`root.child('series_instalments').child($instalmentId)`), and a nested key would put the
 * seriesId in the path where that expression cannot reach it without knowing it in advance.
 *
 * It also has to satisfy INSTALMENT_ID_RE, which is what stops a crafted id walking out of
 * series_epubs/ in the signing endpoint.
 */
export function instalmentId(seriesSlug, ordinal) {
  return `${seriesSlug}-i${ordinal}`;
}

// ── SERIES ───────────────────────────────────────────────────────────────────────────────

export async function createSeries(input) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!input || typeof input !== 'object') return { ok: false, errors: ['Payload is required'] };

  const now = Date.now();
  const slug = input.slug ? slugify(input.slug) : slugify(input.title);
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    slug,
    title: input.title || '',
    synopsis: input.synopsis || '',
    coverUrl: input.coverUrl || null,
    status: input.status || 'draft',
    addedAt: now,
    updatedAt: now,
  };

  const { valid, errors } = validateSeries(doc);
  if (!valid) return { ok: false, errors };

  try {
    const existing = await get(ref(db, `${SERIES_PATH}/${slug}`));
    if (existing.exists()) return { ok: false, errors: [`A series with id '${slug}' already exists`] };
    await update(ref(db), { [`${SERIES_PATH}/${slug}`]: doc });
    return { ok: true, seriesId: slug, slug };
  } catch (err) {
    console.error('[series.admin-writes] createSeries failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

export async function updateSeries(seriesId, partial) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!seriesId) return { ok: false, errors: ['seriesId is required'] };
  if (!partial || typeof partial !== 'object') return { ok: false, errors: ['Update payload is required'] };

  try {
    const snap = await get(ref(db, `${SERIES_PATH}/${seriesId}`));
    if (!snap.exists()) return { ok: false, errors: [`Series '${seriesId}' not found`] };
    const existing = snap.val();

    // Caller's fields win, except slug / schemaVersion / addedAt, which are identity.
    const merged = {
      ...existing,
      ...partial,
      slug: existing.slug,
      schemaVersion: existing.schemaVersion ?? SCHEMA_VERSION,
      addedAt: existing.addedAt,
      updatedAt: Date.now(),
    };

    const { valid, errors } = validateSeries(merged);
    if (!valid) return { ok: false, errors };

    await update(ref(db), { [`${SERIES_PATH}/${seriesId}`]: merged });
    return { ok: true, seriesId };
  } catch (err) {
    console.error('[series.admin-writes] updateSeries failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

export async function setSeriesStatus(seriesId, status) {
  if (!SERIES_STATUSES.includes(status)) return { ok: false, errors: [`status must be one of: ${SERIES_STATUSES.join(', ')}`] };
  return updateSeries(seriesId, { status });
}

// ── INSTALMENTS ──────────────────────────────────────────────────────────────────────────

/**
 * Create an instalment: the public row and the private detail, in ONE atomic update.
 *
 * `ordinal` uniqueness within the series is enforced here rather than by a rule, because a
 * rules expression cannot query siblings. The check is a read-then-write and therefore not
 * race-proof against two admins creating instalment 3 at the same second — accepted, because
 * there are two admin UIDs on this project and the failure is a visible duplicate an editor
 * fixes, not a silent corruption.
 */
export async function createInstalment(input) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!input || typeof input !== 'object') return { ok: false, errors: ['Payload is required'] };

  const { seriesId, ordinal } = input;
  if (!seriesId) return { ok: false, errors: ['seriesId is required'] };
  if (!Number.isInteger(ordinal) || ordinal < 1) return { ok: false, errors: ['ordinal must be a positive integer'] };

  const now = Date.now();
  const id = instalmentId(seriesId, ordinal);

  const row = {
    schemaVersion: SCHEMA_VERSION,
    seriesId,
    ordinal,
    releaseAtMs: input.releaseAtMs,
    // NOT `|| false`. An undefined here must reach the validator and be rejected, so that a
    // form which forgot the field fails loudly instead of silently shipping an instalment
    // that no Gold member can ever open. See the schema note.
    freeForGold: input.freeForGold,
    status: input.status || 'draft',
    addedAt: now,
    updatedAt: now,
  };

  const detail = {
    schemaVersion: SCHEMA_VERSION,
    title: input.title || '',
    synopsis: input.synopsis ?? null,
    logline: input.logline ?? null,
    author: input.author || '',
    authorUid: input.authorUid || '',
    authorHandle: input.authorHandle || '',
    coverUrl: input.coverUrl ?? null,
    // Recorded, never read at serve time — the endpoint derives it. Written through the same
    // one definition the uploader uses so the two cannot disagree.
    epubPath: input.epubPath ?? null,
    sponsorName: input.sponsorName ?? null,
    sponsorLogoUrl: input.sponsorLogoUrl ?? null,
    // Never from `input` at creation, and there is no path by which it could be: the count
    // comes out of uploadInstalmentEpub(), which needs an id, which does not exist until this
    // function returns. A new instalment is created uncounted and gains its count with its
    // file — which is the correct order, since the count describes the file.
    wordCount: null,
    updatedAt: now,
  };

  const rowCheck = validateInstalment(row);
  if (!rowCheck.valid) return { ok: false, errors: rowCheck.errors };
  const detailCheck = validateInstalmentDetail(detail, { publishing: row.status === 'published' });
  if (!detailCheck.valid) return { ok: false, errors: detailCheck.errors };

  try {
    const seriesSnap = await get(ref(db, `${SERIES_PATH}/${seriesId}`));
    if (!seriesSnap.exists()) return { ok: false, errors: [`Series '${seriesId}' not found`] };

    const existing = await get(ref(db, `${INSTALMENTS_PATH}/${id}`));
    if (existing.exists()) return { ok: false, errors: [`Instalment '${id}' already exists`] };

    // Atomic: row + detail together. See the header.
    await update(ref(db), {
      [`${INSTALMENTS_PATH}/${id}`]: row,
      [`${INSTALMENTS_DETAIL_PATH}/${id}`]: detail,
      [`${SERIES_PATH}/${seriesId}/updatedAt`]: now,
    });
    return { ok: true, instalmentId: id, epubPath: epubObjectPath(id) };
  } catch (err) {
    console.error('[series.admin-writes] createInstalment failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

/**
 * Update an instalment. seriesId, ordinal, schemaVersion and addedAt are LOCKED — see header.
 *
 * ordinal is locked alongside seriesId because the id is derived from the pair: changing the
 * ordinal would leave the record sitting at a key that no longer describes it, and the next
 * create for that number would collide with it.
 */
export async function updateInstalment(id, partial) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!id) return { ok: false, errors: ['instalmentId is required'] };
  if (!partial || typeof partial !== 'object') return { ok: false, errors: ['Update payload is required'] };

  try {
    const [rowSnap, detailSnap] = await Promise.all([
      get(ref(db, `${INSTALMENTS_PATH}/${id}`)),
      get(ref(db, `${INSTALMENTS_DETAIL_PATH}/${id}`)),
    ]);
    if (!rowSnap.exists()) return { ok: false, errors: [`Instalment '${id}' not found`] };

    const existingRow = rowSnap.val();
    const existingDetail = detailSnap.exists() ? detailSnap.val() : {};
    const now = Date.now();

    const row = {
      ...existingRow,
      ...pick(partial, ['releaseAtMs', 'freeForGold', 'status']),
      seriesId: existingRow.seriesId,
      ordinal: existingRow.ordinal,
      schemaVersion: existingRow.schemaVersion ?? SCHEMA_VERSION,
      addedAt: existingRow.addedAt,
      updatedAt: now,
    };

    const detail = {
      ...existingDetail,
      ...pick(partial, [
        'title', 'synopsis', 'logline', 'author', 'authorUid', 'authorHandle',
        'coverUrl', 'epubPath', 'sponsorName', 'sponsorLogoUrl',
        // wordCount IS updatable, but only ever by uploadInstalmentEpub()'s caller passing
        // what that function returned. No admin input is bound to it — see the schema note.
        'wordCount',
      ]),
      schemaVersion: existingDetail.schemaVersion ?? SCHEMA_VERSION,
      updatedAt: now,
    };

    const rowCheck = validateInstalment(row);
    if (!rowCheck.valid) return { ok: false, errors: rowCheck.errors };
    const detailCheck = validateInstalmentDetail(detail, { publishing: row.status === 'published' });
    if (!detailCheck.valid) return { ok: false, errors: detailCheck.errors };

    await update(ref(db), {
      [`${INSTALMENTS_PATH}/${id}`]: row,
      [`${INSTALMENTS_DETAIL_PATH}/${id}`]: detail,
    });
    return { ok: true, instalmentId: id };
  } catch (err) {
    console.error('[series.admin-writes] updateInstalment failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

export async function setInstalmentStatus(id, status) {
  if (!INSTALMENT_STATUSES.includes(status)) {
    return { ok: false, errors: [`status must be one of: ${INSTALMENT_STATUSES.join(', ')}`] };
  }
  return updateInstalment(id, { status });
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ── THE EPUB ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a series poster or an instalment cover. PUBLIC read by rule, deliberately: a locked
 * instalment still shows its art, and a shelf of grey rectangles would tell a reader nothing
 * about whether Platinum is worth paying for. Only the FILE is gated.
 *
 * Returns a download URL, unlike the EPUB uploader below — this one is meant to be public and
 * a permanent URL is the correct output for it.
 */
export async function uploadSeriesImage(key, file, onProgress) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!key) return { ok: false, errors: ['key is required'] };
  if (!file) return { ok: false, errors: ['No file selected'] };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, errors: [`Image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB`] };

  try {
    const { ref: sref, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
    const objectRef = sref(storage, `series_covers/${key}/${Date.now()}-${file.name}`);
    const task = uploadBytesResumable(objectRef, file, { contentType: file.type });
    await new Promise((resolve, reject) => {
      task.on('state_changed',
        (snap) => { if (onProgress) onProgress(snap.bytesTransferred / snap.totalBytes); },
        reject, resolve);
    });
    return { ok: true, url: await getDownloadURL(objectRef) };
  } catch (err) {
    console.error('[series.admin-writes] uploadSeriesImage failed', err);
    return { ok: false, errors: [`Upload failed: ${err.message || 'unknown error'}`] };
  }
}

/**
 * Upload an instalment's master EPUB to the gated prefix.
 *
 * The path comes from epubObjectPath() and is NOT caller-chosen. storage.rules keeps
 * `series_epubs/{instalmentId}/master.epub` at `allow read: if false` for every client
 * including this one — the admin can write it and cannot read it back, which is correct and
 * occasionally surprising. The only path to the bytes is a signed URL from
 * functions/api/series/stream.js.
 *
 * Returns the object path so the caller can store it as epubPath. It is stored for the
 * admin's benefit and for a human reading the record; the endpoint never consults it.
 *
 * ── IT ALSO RETURNS wordCount, AND THIS IS THE ONLY PLACE IT CAN BE TAKEN ────────────────
 *
 * The reading time on the instalment page is derived from the EPUB's own words rather than
 * typed by an editor, because a typed figure is wrong from the first chapter revision onward
 * and nothing in the record admits it. Deriving it needs the words, and the words are
 * reachable for exactly as long as this function holds the File: the moment those bytes land
 * at series_epubs/{id}/master.epub they are `allow read: if false` to every client on the
 * platform, this one included, and the only way back to them is a signed URL the stream
 * endpoint mints for an entitled reader after release. So the count is taken HERE, from the
 * same File, in the same call — and it is refreshed by the only event that can invalidate it,
 * which is somebody uploading a new file.
 *
 * COUNT BEFORE UPLOAD. If the file is not a readable EPUB we would rather find out before
 * 50 MB have gone into the bucket than after.
 *
 * A COUNT FAILURE IS NOT AN UPLOAD FAILURE. If the spine will not parse but the bytes are
 * fine, the upload proceeds and wordCount comes back null with a warning in `warnings` — null
 * means "not counted", the page drops the reading-time credit, and the editor is told. The
 * alternative, refusing the upload, would make a cosmetic label a gate on publishing an
 * instalment. What must NEVER happen is the third option: returning the previous count
 * alongside new bytes, which is a number confidently describing a file that no longer exists.
 */
export async function uploadInstalmentEpub(id, file, onProgress) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!id) return { ok: false, errors: ['instalmentId is required'] };
  if (!file) return { ok: false, errors: ['No file selected'] };
  if (file.size > MAX_EPUB_BYTES) return { ok: false, errors: [`EPUB exceeds ${MAX_EPUB_BYTES / 1024 / 1024} MB`] };

  const warnings = [];
  let wordCount = null;
  try {
    const { countEpubWords } = await import('../epubExtract');
    const words = await countEpubWords(file);
    wordCount = words > 0 ? words : null;
    if (wordCount === null) warnings.push('The EPUB parsed but contained no words — no reading time will show.');
  } catch (err) {
    console.warn('[series.admin-writes] word count failed; uploading anyway', err);
    warnings.push(`Could not count words (${err.message || 'unknown error'}) — no reading time will show.`);
  }

  const objectPath = epubObjectPath(id);
  try {
    const { ref: sref, uploadBytesResumable } = await import('firebase/storage');
    const task = uploadBytesResumable(sref(storage, objectPath), file, { contentType: 'application/epub+zip' });
    await new Promise((resolve, reject) => {
      task.on(
        'state_changed',
        (snap) => { if (onProgress) onProgress(snap.bytesTransferred / snap.totalBytes); },
        reject,
        resolve,
      );
    });
    // No getDownloadURL(). A download URL for this object would be a public, permanent,
    // token-bearing link to a gated file — precisely the shape the Book Reader Collection
    // shipped with, and the reason none of it could ever be gated.
    return { ok: true, epubPath: objectPath, wordCount, warnings };
  } catch (err) {
    console.error('[series.admin-writes] uploadInstalmentEpub failed', err);
    return { ok: false, errors: [`Upload failed: ${err.message || 'unknown error'}`] };
  }
}

/**
 * An instalment's own cover art, or its sponsor's logo. Thin over uploadSeriesImage() — the
 * value it adds is the KEY, which comes from instalmentImageKey() rather than from a call
 * site, so the two kinds cannot end up sharing a folder or landing outside series_covers/**.
 *
 * The existing image path needed no extension to carry a sponsor logo: storage.rules matches
 * `series_covers/{allPaths=**}` at public read, admin-only write, 5 MB, `image/*` — a nested
 * key matches, an SVG or PNG or WebP all match, and the returned download URL is the same
 * unguessable, token-bearing kind the instalment cover already stores. Which is the point: the
 * sponsor logo's URL is protected exactly as the cover's is — by living on the detail node
 * the release rule denies — and it inherits that rather than inventing it.
 */
export async function uploadInstalmentImage(id, kind, file, onProgress) {
  if (!id) return { ok: false, errors: ['instalmentId is required'] };
  let key;
  try {
    key = instalmentImageKey(id, kind);
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }
  return uploadSeriesImage(key, file, onProgress);
}
