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

import { ref, get, update, serverTimestamp } from 'firebase/database';
import { db, auth, storage } from '../firebase';
import {
  SCHEMA_VERSION,
  SERIES_PATH,
  INSTALMENTS_PATH,
  INSTALMENTS_DETAIL_PATH,
  INSTALMENTS_DELETED_PATH,
  SERIES_STATUSES,
  INSTALMENT_STATUSES,
  PROVISIONAL_RELEASE_MS,
  epubObjectPath,
  instalmentImageKey,
  validateSeries,
  validateInstalment,
  validateInstalmentDetail,
  bareHandle,
} from './schema';
import { deletionPlan } from './deletion';
import { needsFor } from './publishing';

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
    // W38 — the series' writer, all three or none (validateSeries says which).
    ...writerOf(input),
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
      ...(partial.authorUid !== undefined ? writerOf(partial) : {}),
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

/**
 * W38 — the writer trio from a picker result or a payload. The handle is stored without its @,
 * because two instalments were saved by hand as "@name" and no usernames/ entry answers to that.
 */
function writerOf(input) {
  if (!input || input.authorUid === undefined) return {};
  return {
    author: input.author || '',
    authorUid: input.authorUid || '',
    authorHandle: bareHandle(input.authorHandle),
  };
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
    authorHandle: bareHandle(input.authorHandle),
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
    // W38 — a new draft's open choices. See PROVISIONAL_RELEASE_MS in schema.js.
    ...(input.choicesPending ? { choicesPending: input.choicesPending } : {}),
    updatedAt: now,
  };

  // ── IDENTITY BEFORE CONTENT, AND THE ORDER IS DELIBERATE (R31) ─────────────────────────
  //
  // The three checks below are about WHICH RECORD THIS IS; the validators after them are about
  // what is in it. Running the validators first — which is how this shipped — meant an editor
  // who typed a retired ordinal was told 'title is required', filled the form in, and only
  // then learned the number was impossible. Answering the smaller question first is the same
  // discipline the release gate follows in access.js: a refusal that a better-filled form
  // cannot fix should not wait behind one that it can.
  //
  // It costs one extra read on the failure path only — the reads were happening anyway.
  try {
    const seriesSnap = await get(ref(db, `${SERIES_PATH}/${seriesId}`));
    if (!seriesSnap.exists()) return { ok: false, errors: [`Series '${seriesId}' not found`] };

    const existing = await get(ref(db, `${INSTALMENTS_PATH}/${id}`));
    if (existing.exists()) return { ok: false, errors: [`Instalment '${id}' already exists`] };

    // ⚠ R31 — A BURNED ID IS NEVER REISSUED. Deleting instalment 3 leaves a tombstone, and
    // the ordinal gap it opens is permanent: the id is derived from the ordinal, and a reader
    // whose saved position still names this key would be re-pointed at a different story by a
    // reuse. See app/lib/series/deletion.js, ruling 2. This is the check the ordinal gap
    // actually rests on — not renumbering is necessary and is not sufficient.
    const dead = await get(ref(db, `${INSTALMENTS_DELETED_PATH}/${id}`));
    if (dead.exists()) {
      return { ok: false, errors: [
        `Instalment ${ordinal} of this series was deleted and its number cannot be reused. `
        + 'Ordinals are accession marks — the gap is permanent. Use the next free number.',
      ] };
    }

    const rowCheck = validateInstalment(row);
    if (!rowCheck.valid) return { ok: false, errors: rowCheck.errors };
    const detailCheck = validateInstalmentDetail(detail, { publishing: row.status === 'published' });
    if (!detailCheck.valid) return { ok: false, errors: detailCheck.errors };

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
export async function updateInstalment(id, partial, { releaseNow = false } = {}) {
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
      ...pick(partial, ['releaseAtMs', 'freeForGold', 'openToFree', 'status']),
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
        // W38 — a draft's open choices, and its answer to "When it goes live".
        'choicesPending', 'releaseWhen',
      ]),
      schemaVersion: existingDetail.schemaVersion ?? SCHEMA_VERSION,
      updatedAt: now,
    };
    // W39 — strip on every save, so a record stored as "@name" is mended by its next edit.
    if (typeof detail.authorHandle === 'string') detail.authorHandle = bareHandle(detail.authorHandle);

    const rowCheck = validateInstalment(row);
    if (!rowCheck.valid) return { ok: false, errors: rowCheck.errors };
    const detailCheck = validateInstalmentDetail(detail, { publishing: row.status === 'published' });
    if (!detailCheck.valid) return { ok: false, errors: detailCheck.errors };

    // W38 — "as soon as I publish" on an instalment that is already scheduled: the server's own
    // clock, never the device's, so a fast clock cannot hold a release back.
    const rowOut = releaseNow ? { ...row, releaseAtMs: serverTimestamp() } : row;
    await update(ref(db), {
      [`${INSTALMENTS_PATH}/${id}`]: rowOut,
      [`${INSTALMENTS_DETAIL_PATH}/${id}`]: dropEmptyPending(detail),
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

/**
 * ⚠ DELETE AN INSTALMENT. Permanent, and it takes the artefacts with it.
 *
 * The DECISION lives in deletionPlan() — a pure function this executes and does not second-
 * guess. Its header carries the four rulings; the notes here are only about the ORDER, which
 * is the part a plan cannot express.
 *
 * ── THE RECORDS GO FIRST, AND THE FILES SECOND ──────────────────────────────────────────
 *
 * The reverse order is the tempting one — remove the bytes, then the pointer — and it is
 * wrong. Between the two writes it would leave a PUBLISHED, RELEASED instalment whose record
 * says it has an EPUB and whose bucket does not: every reader who opened it would get a
 * signed URL to a missing object, which surfaces as a broken download rather than as an
 * absence. Records first means the failure window shows a deleted instalment (correct) with
 * an orphaned file behind it (invisible, and reported below so a human can sweep it).
 *
 * The RTDB half is one multi-path update — row, detail and tombstone together — so the burn
 * and the removal cannot come apart. If that update fails, nothing has happened at all.
 *
 * ── A FILE THAT WILL NOT DELETE IS REPORTED, NOT RAISED ─────────────────────────────────
 *
 * By the time the objects are being removed the instalment is already gone from every node an
 * editor or a reader can see. Failing the whole call there would tell them the delete did not
 * happen, which is false and would invite a retry against records that no longer exist. So
 * storage failures come back in `warnings` with the paths, exactly as uploadInstalmentEpub()
 * reports a count it could not take.
 *
 * ⚠ If storage.rules ever loses the create/update-vs-delete split on series_epubs/ and
 * series_covers/, EVERY file here fails and only these warnings will say so — a single
 * `allow write` guarded on request.resource.size denies deletes outright, because
 * request.resource is null on a delete. That is R21's lesson and R31 paid for it again.
 */
export async function deleteInstalment(id) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!id) return { ok: false, errors: ['instalmentId is required'] };

  let plan;
  try {
    const rowSnap = await get(ref(db, `${INSTALMENTS_PATH}/${id}`));
    if (!rowSnap.exists()) return { ok: false, errors: [`Instalment '${id}' not found`] };
    const row = rowSnap.val();
    plan = deletionPlan({ id, seriesId: row.seriesId, ordinal: row.ordinal });

    const patch = {};
    for (const path of plan.dbPaths) patch[path] = null;
    patch[plan.tombstonePath] = plan.tombstone;
    // The parent's own updatedAt, mirroring createInstalment(). There is no instalmentCount to
    // adjust and there never was — see the schema header on why the field was rejected:
    // releasedCount() derives the number from the rows at read time, so REMOVING THE ROW IS
    // THE RECOUNT. A stored counter here would now be one too high and nothing would say so.
    patch[`${SERIES_PATH}/${row.seriesId}/updatedAt`] = plan.tombstone.deletedAt;

    await update(ref(db), patch);
  } catch (err) {
    console.error('[series.admin-writes] deleteInstalment records failed', err);
    return { ok: false, errors: [`Delete failed: ${err.message || 'unknown error'}`] };
  }

  const warnings = [];
  try {
    const { ref: sref, deleteObject, listAll } = await import('firebase/storage');

    // The EPUB. `storage/object-not-found` is not a failure: an instalment created and deleted
    // without one is an ordinary state, and so is a second click on the delete button.
    try {
      await deleteObject(sref(storage, plan.epubPath));
    } catch (err) {
      if (err?.code !== 'storage/object-not-found') warnings.push(`Could not delete ${plan.epubPath} (${err?.code || err?.message}).`);
    }

    // The cover and the sponsor logo. Enumerated rather than derived — the object name carries
    // a Date.now() the record never stored. Every historical upload under the prefix goes, not
    // just the one the record happens to name: re-uploading a cover leaves the previous object
    // in place, so the prefix is where the orphans actually are.
    for (const prefix of plan.storagePrefixes) {
      try {
        const listing = await listAll(sref(storage, prefix));
        await Promise.all(listing.items.map(async (item) => {
          try {
            await deleteObject(item);
          } catch (err) {
            if (err?.code !== 'storage/object-not-found') warnings.push(`Could not delete ${item.fullPath} (${err?.code || err?.message}).`);
          }
        }));
      } catch (err) {
        warnings.push(`Could not list ${prefix} (${err?.code || err?.message}).`);
      }
    }
  } catch (err) {
    console.error('[series.admin-writes] deleteInstalment artefacts failed', err);
    warnings.push(`Artefacts may remain in Storage (${err.message || 'unknown error'}).`);
  }

  return { ok: true, instalmentId: id, plan, warnings };
}

// An emptied choicesPending is removed rather than stored as {} — RTDB drops an empty object
// anyway, and a record that says "nothing pending" should look like one that never had any.
function dropEmptyPending(detail) {
  const p = detail.choicesPending;
  if (p && typeof p === 'object' && !Object.keys(p).length) return { ...detail, choicesPending: null };
  return detail;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// ── W38: DRAFT, PUBLISH, TAKE DOWN ───────────────────────────────────────────────────────

/**
 * A new draft, the moment its title is typed (ruling 140: "uploads are enabled once the draft
 * exists, which is as soon as a title is typed"). The writer is COPIED from the series; the row
 * holds the provisional values and the detail record marks both choices as not made. See the
 * W38 note in schema.js.
 */
export async function createDraftInstalment({ seriesId, ordinal, title }) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  let series;
  try {
    const snap = await get(ref(db, `${SERIES_PATH}/${seriesId}`));
    if (!snap.exists()) return { ok: false, errors: [`Series '${seriesId}' not found`] };
    series = snap.val();
  } catch (err) {
    return { ok: false, errors: [`Read failed: ${err.message || 'unknown error'}`] };
  }
  if (!series.authorUid) return { ok: false, errors: ['Choose the series’ writer first.'] };
  return createInstalment({
    seriesId, ordinal, title,
    status: 'draft',
    freeForGold: false,
    releaseAtMs: PROVISIONAL_RELEASE_MS,
    author: series.author, authorUid: series.authorUid, authorHandle: series.authorHandle,
    choicesPending: { freeForGold: true, releaseAtMs: true },
  });
}

/**
 * ⭑ PUBLISH OR SCHEDULE — ONE ATOMIC WRITE (ruling 140, §1.4).
 *
 * The instalment's row (status and release), its detail record (the open-choice marks cleared),
 * and — when the series is still a draft — the series' own status go in ONE multi-path update.
 * A series that went live without its first instalment, or an instalment published under a
 * series nobody can see, is not a state this function can leave behind.
 *
 * The checklist is needsFor(), the same function the panel draws, so nothing can be pressed that
 * this refuses and nothing this accepts was shown as missing. The series' own needs (poster,
 * synopsis) are on that list when it is a draft, and validateSeries() checks them again.
 *
 * "As soon as I publish" is serverTimestamp(): the release is the RTDB server's clock at the
 * moment of the write, which is the same clock the release rule compares against.
 *
 * `republish` is "Publish it again" on a taken-down instalment: its release time was chosen
 * the first time and is kept, so a past one goes live at once.
 */
export async function publishInstalment(id, { republish = false } = {}) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  try {
    const [rowSnap, detailSnap] = await Promise.all([
      get(ref(db, `${INSTALMENTS_PATH}/${id}`)),
      get(ref(db, `${INSTALMENTS_DETAIL_PATH}/${id}`)),
    ]);
    if (!rowSnap.exists() || !detailSnap.exists()) return { ok: false, errors: ['That instalment couldn’t be found.'] };
    const row = rowSnap.val();
    const detail = detailSnap.val();
    const seriesSnap = await get(ref(db, `${SERIES_PATH}/${row.seriesId}`));
    if (!seriesSnap.exists()) return { ok: false, errors: ['Its series couldn’t be found.'] };
    const series = seriesSnap.val();

    const now = Date.now();
    const needs = needsFor({ series, row, detail, now });
    const missing = needs.needed.filter((n) => !n.done && !(republish && n.key === 'when'));
    if (missing.length) return { ok: false, errors: [`Still needed: ${missing.map((n) => n.label.toLowerCase()).join(', ')}.`] };

    const releaseNow = !republish && needs.mode === 'publish';
    const nextRow = { ...row, status: 'published', updatedAt: now };
    const nextDetail = { ...detail, choicesPending: null, releaseWhen: null, updatedAt: now };
    if (typeof nextDetail.authorHandle === 'string') nextDetail.authorHandle = bareHandle(nextDetail.authorHandle);
    // Validated with a stand-in for the server's timestamp: it is a positive integer either way.
    const rowCheck = validateInstalment(releaseNow ? { ...nextRow, releaseAtMs: now } : nextRow);
    if (!rowCheck.valid) return { ok: false, errors: rowCheck.errors };
    const detailCheck = validateInstalmentDetail(nextDetail, { publishing: true });
    if (!detailCheck.valid) return { ok: false, errors: detailCheck.errors };

    const patch = {
      [`${INSTALMENTS_PATH}/${id}`]: releaseNow ? { ...nextRow, releaseAtMs: serverTimestamp() } : nextRow,
      [`${INSTALMENTS_DETAIL_PATH}/${id}`]: nextDetail,
    };
    const seriesWentLive = series.status === 'draft';
    if (seriesWentLive) {
      const nextSeries = { ...series, status: 'published', updatedAt: now };
      const seriesCheck = validateSeries(nextSeries);
      if (!seriesCheck.valid) return { ok: false, errors: seriesCheck.errors };
      patch[`${SERIES_PATH}/${row.seriesId}`] = nextSeries;
    } else {
      patch[`${SERIES_PATH}/${row.seriesId}/updatedAt`] = now;
    }
    await update(ref(db), patch);
    return { ok: true, instalmentId: id, seriesWentLive, scheduled: !releaseNow && row.releaseAtMs > now };
  } catch (err) {
    console.error('[series.admin-writes] publishInstalment failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

/** Take a scheduled or live instalment off the site. Nothing is deleted; the reader's place is kept. */
export async function takeDownInstalment(id) {
  return setInstalmentStatus(id, 'unpublished');
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

/**
 * W46 §7 — READERS' NOTES: save the instalment's three question slots as a DRAFT.
 *
 * series_question_drafts/{inst} is founder read/write and judged by no shape rule: a draft may
 * be half-typed. It is an update(), never a set(): `side` is replaced whole (so a removed option
 * goes with it), and the endpoint's own fields (draftedAt, model) survive beside the slots.
 * Nothing a reader can see is touched — publishing is the endpoint's `publish-questions`.
 * `fields` is { sit, side: { text, options: { a, b, c?, d? } }, line }.
 */
export async function saveQuestionDraft(inst, fields) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!inst || typeof inst !== 'string' || /[.#$[\]/]/.test(inst)) return { ok: false, errors: ['instalmentId is required'] };
  const f = fields || {};
  const s = (v) => (typeof v === 'string' ? v : '');
  const options = {};
  for (const k of ['a', 'b', 'c', 'd']) if (typeof f.side?.options?.[k] === 'string') options[k] = f.side.options[k];
  try {
    await update(ref(db, `series_question_drafts/${inst}`), {
      sit: s(f.sit),
      side: { text: s(f.side?.text), options },
      line: s(f.line),
      updatedAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (err) {
    console.error('[series.admin-writes] saveQuestionDraft failed', err?.code || err?.message);
    return { ok: false, errors: ['The questions didn’t save. Check the connection and try again.'] };
  }
}
