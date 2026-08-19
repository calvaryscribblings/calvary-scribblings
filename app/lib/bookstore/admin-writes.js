// Admin-only write helpers for bookstore_publishers/ and bookstore_titles/.
// Every function:
//   - checks auth.currentUser.uid against the admin UID before writing
//   - validates via validateTitle / validatePublisher and refuses to write on validation errors
//   - never throws — returns { ok: true, ... } or { ok: false, errors: [...] }

import { ref, get, set, update, remove, increment, query, orderByChild, equalTo } from 'firebase/database';
import { db, auth, storage } from '../firebase';
import {
  validatePublisher,
  validateTitle,
  SCHEMA_VERSION,
  PUBLISHER_STATUSES,
  TITLE_STATUSES,
} from './schema';
// R7.4 — the glossary's shape rule lives with the reader that consumes it, so the writer
// and the lookup can never disagree about what a valid entry is.
import { validateGlossary } from '../dictionary';
// R8.4 — same precedent: the rule about what a licence may LOOK like lives beside the rule
// about what one MEANS, so the till and the till's editor cannot disagree.
import { assertTerritories, WORLDWIDE } from './territory';
// R13 — the taxonomy and the curation system. Same discipline as the two imports above: the
// rule about what a section may LOOK like lives beside the rule about what one MEANS, so the
// panel and the shop cannot disagree about which claims exist.
import { validateGenre } from './genres';
import {
  validateSection,
  buildGenreMigration,
  buildWindowMigration,
  SECTION_TYPES,
  SECTION_STATUSES,
} from './sections';

const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const PUBLISHERS_PATH = 'bookstore_publishers';
const PUBLISHERS_PRIVATE_PATH = 'bookstore_publishers_private';
const TITLES_PATH = 'bookstore_titles';

// Fields that live in the public node. Everything else on a publisher doc
// (contactEmail, paymentDetails) lives in the private sibling node.
const PUBLIC_PUBLISHER_FIELDS = [
  'schemaVersion',
  'slug',
  'name',
  'status',
  'salesSplit',
  'titlesCount',
  'addedAt',
  'updatedAt',
];

function splitPublisherDoc(merged) {
  const pub = {};
  for (const k of PUBLIC_PUBLISHER_FIELDS) {
    if (merged[k] !== undefined) pub[k] = merged[k];
  }
  const priv = {};
  if (typeof merged.contactEmail === 'string' && merged.contactEmail.length > 0) {
    priv.contactEmail = merged.contactEmail;
  }
  if (merged.paymentDetails && typeof merged.paymentDetails === 'object') {
    const pd = merged.paymentDetails;
    const cleaned = {};
    if (pd.method) cleaned.method = pd.method;
    if (typeof pd.notes === 'string' && pd.notes.length > 0) cleaned.notes = pd.notes;
    if (Object.keys(cleaned).length > 0) priv.paymentDetails = cleaned;
  }
  return { pub, priv };
}

function isAdmin() {
  const uid = auth?.currentUser?.uid;
  return !!uid && ADMIN_UIDS.includes(uid);
}

// The Bookseller's Fields (R4b) — schema-external optional metadata (schema.js is locked,
// following the samplePath precedent). validateTitle ignores them, so we type/length-check
// them inline. Returns an array of error strings (empty === ok). Expects already-normalised
// values (empty string → null).
const BOOKSELLER_CAPS = { backCoverBlurb: 280, shelfCard: 160 };
function validateBooksellerFields(doc) {
  const errors = [];
  for (const k of ['backCoverBlurb', 'openingLine', 'shelfCard']) {
    const v = doc[k];
    if (v === null || v === undefined) continue;
    if (typeof v !== 'string' || v.length === 0) { errors.push(`${k} must be a non-empty string or null`); continue; }
    if (BOOKSELLER_CAPS[k] && v.length > BOOKSELLER_CAPS[k]) errors.push(`${k} must be ${BOOKSELLER_CAPS[k]} characters or fewer`);
  }
  const cn = doc.catalogueNumber;
  if (cn !== null && cn !== undefined && (!Number.isInteger(cn) || cn <= 0)) {
    errors.push('catalogueNumber must be a positive integer or null');
  }
  return errors;
}

// R8.4 — THE TERRITORY PAIR, as it must look on the way into RTDB.
//
// `territoriesAllowed` is schema-locked ('*' | array<alpha-2>) and validateTitle already checks
// it. `territoriesExcluded` is schema-external — the samplePath / glossary precedent again,
// TITLE_SCHEMA stays at v2 — so its shape is checked here, at the last gate before the
// database, and nowhere else writes it.
//
// Three storable states, and only three:
//
//   worldwide         territoriesAllowed '*'            (no territoriesExcluded key)
//   worldwide-except  territoriesAllowed '*'            territoriesExcluded ['CA','US']
//   only-in           territoriesAllowed ['GB','NG']    (no territoriesExcluded key)
//
// THE KEY IS OMITTED, NOT NULLED AND NOT EMPTY-ARRAYED, when there are no exclusions. "No
// exclusions" is the absence of a claim, and the absence of a claim is said by the absence of
// a field — every existing record in the catalogue already says it that way by predating the
// field entirely, and a mixture of `undefined`, `null` and `[]` all meaning the same thing is
// three shapes for every reader to handle forever. RTDB drops an undefined key on write, which
// is exactly the behaviour wanted; updateTitle uses set() (a full overwrite), so DELETING the
// key from the merged doc genuinely removes it rather than leaving the old value behind.
//
// Codes are tidied (trimmed, uppercased) before validation so an editor's 'gb' is stored as
// 'GB', and sorted after it so two spellings of one licence produce one document — a diff in
// this field should mean the rights changed, not that the boxes were ticked in another order.
// Tidying is NOT the same as repairing: assertTerritories still rejects anything that is not a
// real ISO country, a duplicate, or the contradictory allow-list-plus-exclusions pair.
function normaliseTerritoryFields(doc) {
  const tidy = (v) => (Array.isArray(v)
    ? v.map((c) => (typeof c === 'string' ? c.trim().toUpperCase() : c))
    : v);

  const allowed = doc.territoriesAllowed === undefined || doc.territoriesAllowed === null
    ? WORLDWIDE
    : tidy(doc.territoriesAllowed);

  const rawExcluded = doc.territoriesExcluded;
  const excluded = rawExcluded === undefined || rawExcluded === null || rawExcluded === ''
    || (Array.isArray(rawExcluded) && rawExcluded.length === 0)
    ? undefined
    : tidy(rawExcluded);

  const verdict = assertTerritories(allowed, excluded);
  if (!verdict.ok) return { errors: [verdict.error] };

  doc.territoriesAllowed = Array.isArray(allowed) ? [...allowed].sort() : allowed;
  if (excluded === undefined) delete doc.territoriesExcluded;
  else doc.territoriesExcluded = [...excluded].sort();

  return { errors: [] };
}

// R7.4 — the glossary as it must look on the way into RTDB. Accepts what the admin form
// hands over (already a map) and reduces every "there isn't one" spelling to null, so a
// title either HAS a glossary or carries the field as null and never as an empty husk.
// Keys are lowercased here as well as in the parser: this is the last gate before the
// database, and the reader's lookup assumes lowercased keys.
function normaliseGlossaryField(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) return value; // let the validator name it
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k !== 'string' || typeof v !== 'string') { out[k] = v; continue; } // ditto
    const key = k.trim().toLowerCase();
    const def = v.trim();
    if (!key || !def) continue;      // an empty key or definition is dropped, not written
    out[key] = def;
  }
  return Object.keys(out).length ? out : null;
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLISHERS
// ─────────────────────────────────────────────────────────────────────────────

export async function createPublisher(input) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!input || typeof input !== 'object') return { ok: false, errors: ['Publisher payload is required'] };

  const slug = (input.slug && input.slug.trim()) || slugify(input.name);
  if (!slug) return { ok: false, errors: ['Cannot derive a slug from the supplied name'] };

  const now = Date.now();
  const merged = {
    schemaVersion: SCHEMA_VERSION,
    name: (input.name || '').trim(),
    slug,
    contactEmail: (input.contactEmail || '').trim(),
    paymentDetails: input.paymentDetails ?? null,
    salesSplit: typeof input.salesSplit === 'number' ? input.salesSplit : 0.7,
    status: input.status || 'active',
    titlesCount: 0,
    addedAt: now,
    updatedAt: now,
  };

  if (merged.paymentDetails === null) delete merged.paymentDetails;

  const result = validatePublisher(merged);
  if (!result.valid) return { ok: false, errors: result.errors };

  try {
    const existing = await get(ref(db, `${PUBLISHERS_PATH}/${slug}`));
    if (existing.exists()) return { ok: false, errors: [`A publisher with slug '${slug}' already exists`] };

    const { pub, priv } = splitPublisherDoc(merged);
    const writes = { [`${PUBLISHERS_PATH}/${slug}`]: pub };
    if (Object.keys(priv).length > 0) {
      writes[`${PUBLISHERS_PRIVATE_PATH}/${slug}`] = priv;
    }
    await update(ref(db), writes);
    return { ok: true, slug };
  } catch (err) {
    console.error('[bookstore.admin-writes] createPublisher failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

export async function updatePublisher(slug, partial) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!slug) return { ok: false, errors: ['Slug is required'] };
  if (!partial || typeof partial !== 'object') return { ok: false, errors: ['Update payload is required'] };

  try {
    const [pubSnap, privSnap] = await Promise.all([
      get(ref(db, `${PUBLISHERS_PATH}/${slug}`)),
      get(ref(db, `${PUBLISHERS_PRIVATE_PATH}/${slug}`)),
    ]);
    if (!pubSnap.exists()) return { ok: false, errors: [`Publisher '${slug}' not found`] };

    const existingPub = pubSnap.val() || {};
    const existingPriv = privSnap.exists() ? privSnap.val() : {};
    const existing = { ...existingPub, ...existingPriv };

    // Caller's fields win; we lock slug, addedAt, schemaVersion, titlesCount.
    const merged = {
      ...existing,
      ...partial,
      slug: existingPub.slug || slug,
      schemaVersion: existingPub.schemaVersion ?? SCHEMA_VERSION,
      addedAt: existingPub.addedAt,
      titlesCount: existingPub.titlesCount ?? 0,
      updatedAt: Date.now(),
    };

    const result = validatePublisher(merged);
    if (!result.valid) return { ok: false, errors: result.errors };

    const { pub, priv } = splitPublisherDoc(merged);

    // If the private node now has no fields, write null at its path to delete it
    // (RTDB convention). Otherwise write the new shape.
    const writes = { [`${PUBLISHERS_PATH}/${slug}`]: pub };
    writes[`${PUBLISHERS_PRIVATE_PATH}/${slug}`] = Object.keys(priv).length > 0 ? priv : null;

    await update(ref(db), writes);
    return { ok: true, slug };
  } catch (err) {
    console.error('[bookstore.admin-writes] updatePublisher failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

// Public-only path — touches status + updatedAt. No private read/write needed,
// so this remains cheap and avoids a permission-denied surface area.
export async function setPublisherStatus(slug, status) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!slug) return { ok: false, errors: ['Slug is required'] };
  if (!PUBLISHER_STATUSES.includes(status)) {
    return { ok: false, errors: [`Status must be one of: ${PUBLISHER_STATUSES.join(', ')}`] };
  }
  try {
    const snap = await get(ref(db, `${PUBLISHERS_PATH}/${slug}`));
    if (!snap.exists()) return { ok: false, errors: [`Publisher '${slug}' not found`] };
    await update(ref(db, `${PUBLISHERS_PATH}/${slug}`), {
      status,
      updatedAt: Date.now(),
    });
    return { ok: true, slug };
  } catch (err) {
    console.error('[bookstore.admin-writes] setPublisherStatus failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

// Returns the title IDs whose publisher just got suspended. Does NOT modify the titles —
// the loader's defence-in-depth filter is what hides them on the storefront.
// Used by /admin/publishers' confirm-and-cascade dialog to show the admin a count.
export async function cascadePublisherSuspension(publisherId) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'], affectedTitles: [] };
  if (!publisherId) return { ok: false, errors: ['publisherId is required'], affectedTitles: [] };
  try {
    const { query, orderByChild, equalTo } = await import('firebase/database');
    const snap = await get(query(ref(db, TITLES_PATH), orderByChild('publisherId'), equalTo(publisherId)));
    const ids = [];
    snap.forEach((child) => {
      const t = child.val();
      if (t && t.status === 'published') ids.push(child.key);
      return false;
    });
    return { ok: true, affectedTitles: ids };
  } catch (err) {
    console.error('[bookstore.admin-writes] cascadePublisherSuspension failed', err);
    return { ok: false, errors: [`Read failed: ${err.message || 'unknown error'}`], affectedTitles: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TITLES
// ─────────────────────────────────────────────────────────────────────────────

export async function createTitle(input) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!input || typeof input !== 'object') return { ok: false, errors: ['Title payload is required'] };

  const slug = (input.slug && input.slug.trim()) || slugify(input.title);
  if (!slug) return { ok: false, errors: ['Cannot derive a slug from the supplied title'] };
  if (!input.publisherId) return { ok: false, errors: ['publisherId is required'] };

  const now = Date.now();
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    slug,
    title: (input.title || '').trim(),
    author: (input.author || '').trim(),
    publisherId: input.publisherId,
    synopsis: (input.synopsis || '').trim(),
    // v2: assets may be null for drafts/unpublished. Validator gates on status === 'published'.
    coverUrl: typeof input.coverUrl === 'string' && input.coverUrl.trim() ? input.coverUrl.trim() : null,
    epubPath: typeof input.epubPath === 'string' && input.epubPath.trim() ? input.epubPath.trim() : null,
    // samplePath is optional and lives OUTSIDE schema.js's TITLE_SCHEMA (schema.js is locked).
    // validateTitle ignores it, so we type-check it inline below. null when no sample is uploaded.
    samplePath: typeof input.samplePath === 'string' && input.samplePath.trim() ? input.samplePath.trim() : null,
    // The Bookseller's Fields (R4b) — schema-external; normalised here, checked below.
    backCoverBlurb: typeof input.backCoverBlurb === 'string' && input.backCoverBlurb.trim() ? input.backCoverBlurb.trim() : null,
    openingLine: typeof input.openingLine === 'string' && input.openingLine.trim() ? input.openingLine.trim() : null,
    shelfCard: typeof input.shelfCard === 'string' && input.shelfCard.trim() ? input.shelfCard.trim() : null,
    catalogueNumber: Number.isInteger(input.catalogueNumber) && input.catalogueNumber > 0 ? input.catalogueNumber : null,
    // R7.4 — THE HOUSE GLOSSARY. Schema-external, same precedent as samplePath and the
    // Bookseller's Fields: TITLE_SCHEMA is locked, so validateTitle ignores this and the
    // shape is checked inline below. A flat map { lowercasedWord: definition }; null when
    // the editor left the field empty, never {} — an empty object would ride into RTDB as
    // a key with nothing under it, which RTDB drops anyway, so null says it plainly.
    glossary: normaliseGlossaryField(input.glossary),
    prices: input.prices || {},
    genre: input.genre,
    publishedDate: input.publishedDate,
    addedAt: now,
    updatedAt: now,
    status: input.status || 'draft',
    featured: !!input.featured,
    bestseller: !!input.bestseller,
    territoriesAllowed: input.territoriesAllowed ?? WORLDWIDE,
    // R8.4 — schema-external, checked by normaliseTerritoryFields below, which also DELETES
    // this key when there are no exclusions. Present here so the field survives the object
    // literal; absent from the written document unless it says something.
    territoriesExcluded: input.territoriesExcluded,
    salesCount: 0,
    ratingAverage: null,
    ratingCount: 0,
  };

  // Optional fields — only include if present.
  if (input.isbn) doc.isbn = String(input.isbn).trim();
  if (input.excerpt) doc.excerpt = String(input.excerpt).trim();
  if (Array.isArray(input.tags) && input.tags.length) doc.tags = input.tags.filter((t) => typeof t === 'string' && t.length > 0);
  if (Number.isInteger(input.pageCount) && input.pageCount > 0) doc.pageCount = input.pageCount;

  // R8.4 — BEFORE validateTitle, because it tidies territoriesAllowed into the shape
  // validateTitle then checks, and because a contradictory pair must be reported as the
  // licence problem it is rather than as whatever validateTitle happens to say about the half
  // of it that it can see.
  const terrErrors = normaliseTerritoryFields(doc).errors;
  if (terrErrors.length) return { ok: false, errors: terrErrors };

  const result = validateTitle(doc);
  if (!result.valid) return { ok: false, errors: result.errors };
  // Inline check for the schema-external samplePath (see note above).
  if (doc.samplePath !== null && (typeof doc.samplePath !== 'string' || doc.samplePath.length === 0)) {
    return { ok: false, errors: ['samplePath must be a non-empty string or null'] };
  }
  const bfErrors = validateBooksellerFields(doc);
  if (bfErrors.length) return { ok: false, errors: bfErrors };
  const glErrors = validateGlossary(doc.glossary);
  if (glErrors.length) return { ok: false, errors: glErrors };

  try {
    const existing = await get(ref(db, `${TITLES_PATH}/${slug}`));
    if (existing.exists()) return { ok: false, errors: [`A title with id '${slug}' already exists`] };

    // Verify the publisher exists before incrementing its counter.
    const pubSnap = await get(ref(db, `${PUBLISHERS_PATH}/${doc.publisherId}`));
    if (!pubSnap.exists()) return { ok: false, errors: [`Publisher '${doc.publisherId}' not found`] };

    // Atomic multi-path: write the title doc and bump the publisher's titlesCount.
    await update(ref(db), {
      [`${TITLES_PATH}/${slug}`]: doc,
      [`${PUBLISHERS_PATH}/${doc.publisherId}/titlesCount`]: increment(1),
      [`${PUBLISHERS_PATH}/${doc.publisherId}/updatedAt`]: now,
    });
    return { ok: true, titleId: slug, slug };
  } catch (err) {
    console.error('[bookstore.admin-writes] createTitle failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

export async function updateTitle(titleId, partial) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!titleId) return { ok: false, errors: ['titleId is required'] };
  if (!partial || typeof partial !== 'object') return { ok: false, errors: ['Update payload is required'] };

  try {
    const snap = await get(ref(db, `${TITLES_PATH}/${titleId}`));
    if (!snap.exists()) return { ok: false, errors: [`Title '${titleId}' not found`] };

    const existing = snap.val();
    // Caller's fields win, except we lock slug / publisherId / addedAt / schemaVersion / counters.
    // Reassigning a publisher requires a manual operation so titlesCount stays consistent.
    const merged = {
      ...existing,
      ...partial,
      slug: existing.slug,
      publisherId: existing.publisherId,
      schemaVersion: existing.schemaVersion ?? SCHEMA_VERSION,
      addedAt: existing.addedAt,
      salesCount: existing.salesCount ?? 0,
      ratingAverage: existing.ratingAverage ?? null,
      ratingCount: existing.ratingCount ?? 0,
      updatedAt: Date.now(),
    };

    // samplePath rides through the spread above. It's schema-external (schema.js is locked),
    // so normalise empty string → null and type-check it inline rather than in validateTitle.
    if (merged.samplePath === '' || merged.samplePath === undefined) merged.samplePath = null;
    if (merged.samplePath !== null && typeof merged.samplePath !== 'string') {
      return { ok: false, errors: ['samplePath must be a string or null'] };
    }

    // The Bookseller's Fields (R4b) — normalise empty/undefined → null, coerce a stray float
    // catalogueNumber to an integer, then validate inline (schema.js is locked).
    for (const k of ['backCoverBlurb', 'openingLine', 'shelfCard']) {
      if (merged[k] === '' || merged[k] === undefined) merged[k] = null;
    }
    if (merged.catalogueNumber === '' || merged.catalogueNumber === undefined) merged.catalogueNumber = null;
    if (typeof merged.catalogueNumber === 'number' && Number.isFinite(merged.catalogueNumber) && !Number.isInteger(merged.catalogueNumber)) {
      merged.catalogueNumber = Math.trunc(merged.catalogueNumber);
    }
    const bfErrors = validateBooksellerFields(merged);
    if (bfErrors.length) return { ok: false, errors: bfErrors };

    // R7.4 — the glossary rides through the spread; normalise then check inline. An edit
    // that clears the textarea must be able to REMOVE a glossary, so '' / {} / undefined all
    // become null rather than being skipped as "no change".
    merged.glossary = normaliseGlossaryField(merged.glossary);
    const glErrors = validateGlossary(merged.glossary);
    if (glErrors.length) return { ok: false, errors: glErrors };

    // R8.4 — the territory pair rides through the spread like the glossary. An edit that
    // switches a title back to "Sold worldwide" must be able to REMOVE the exclusions, so ''
    // / [] / null / undefined all delete the key rather than being skipped as "no change" —
    // and set() below is a full overwrite, so a deleted key really does leave the record.
    const terrErrors = normaliseTerritoryFields(merged).errors;
    if (terrErrors.length) return { ok: false, errors: terrErrors };

    const result = validateTitle(merged);
    if (!result.valid) return { ok: false, errors: result.errors };

    await set(ref(db, `${TITLES_PATH}/${titleId}`), merged);
    return { ok: true, titleId };
  } catch (err) {
    console.error('[bookstore.admin-writes] updateTitle failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

export async function setTitleStatus(titleId, status) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!titleId) return { ok: false, errors: ['titleId is required'] };
  if (!TITLE_STATUSES.includes(status)) {
    return { ok: false, errors: [`Status must be one of: ${TITLE_STATUSES.join(', ')}`] };
  }
  try {
    const snap = await get(ref(db, `${TITLES_PATH}/${titleId}`));
    if (!snap.exists()) return { ok: false, errors: [`Title '${titleId}' not found`] };
    await update(ref(db, `${TITLES_PATH}/${titleId}`), {
      status,
      updatedAt: Date.now(),
    });
    return { ok: true, titleId };
  } catch (err) {
    console.error('[bookstore.admin-writes] setTitleStatus failed', err);
    return { ok: false, errors: [`Write failed: ${err.message || 'unknown error'}`] };
  }
}

// Soft delete: never removes the title doc, just flips status to 'unpublished'.
// Hard delete is a manual Firebase Console operation.
export async function deleteTitle(titleId) {
  return setTitleStatus(titleId, 'unpublished');
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE UPLOADS
// ─────────────────────────────────────────────────────────────────────────────

function extOf(file) {
  const name = (file && file.name) || '';
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return (m ? m[1] : 'bin').toLowerCase();
}

const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MAX_EPUB_BYTES = 50 * 1024 * 1024;
const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;

export async function uploadCover(titleId, file, onProgress) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!titleId) return { ok: false, errors: ['titleId is required'] };
  if (!file) return { ok: false, errors: ['No file selected'] };
  if (file.size > MAX_COVER_BYTES) return { ok: false, errors: [`Cover must be under 5 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB)`] };
  if (!file.type || !file.type.startsWith('image/')) return { ok: false, errors: ['Cover must be an image file'] };

  try {
    const { ref: sref, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
    const path = `bookstore_covers/${titleId}.${extOf(file)}`;
    const storageRef = sref(storage, path);
    const task = uploadBytesResumable(storageRef, file, { contentType: file.type });

    await new Promise((resolve, reject) => {
      task.on(
        'state_changed',
        (snap) => {
          if (typeof onProgress === 'function' && snap.totalBytes) {
            onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
          }
        },
        (err) => reject(err),
        () => resolve()
      );
    });

    const url = await getDownloadURL(task.snapshot.ref);
    return { ok: true, url, path };
  } catch (err) {
    console.error('[bookstore.admin-writes] uploadCover failed', err);
    return { ok: false, errors: [`Cover upload failed: ${err.message || 'unknown error'}`] };
  }
}

export async function uploadEpub(titleId, file, onProgress) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!titleId) return { ok: false, errors: ['titleId is required'] };
  if (!file) return { ok: false, errors: ['No file selected'] };
  if (file.size > MAX_EPUB_BYTES) return { ok: false, errors: [`EPUB must be under 50 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB)`] };
  const isEpub = (file.type === 'application/epub+zip') || /\.epub$/i.test(file.name || '');
  if (!isEpub) return { ok: false, errors: ['File must be an EPUB (.epub / application/epub+zip)'] };

  try {
    const { ref: sref, uploadBytesResumable } = await import('firebase/storage');
    const path = `bookstore_epubs/${titleId}/master.epub`;
    const storageRef = sref(storage, path);
    const task = uploadBytesResumable(storageRef, file, { contentType: 'application/epub+zip' });

    await new Promise((resolve, reject) => {
      task.on(
        'state_changed',
        (snap) => {
          if (typeof onProgress === 'function' && snap.totalBytes) {
            onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
          }
        },
        (err) => reject(err),
        () => resolve()
      );
    });

    return { ok: true, path };
  } catch (err) {
    console.error('[bookstore.admin-writes] uploadEpub failed', err);
    return { ok: false, errors: [`EPUB upload failed: ${err.message || 'unknown error'}`] };
  }
}

// Sample EPUB — the free "first chapter or two" that powers the Read Sample button on the
// detail page. Unlike the master EPUB, this file is PUBLIC-READ (see the storage rules
// fragment) so the reader can stream it without a purchase. Path: bookstore_epubs/{titleId}/sample.epub.
export async function uploadSampleEpub(titleId, file, onProgress) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!titleId) return { ok: false, errors: ['titleId is required'] };
  if (!file) return { ok: false, errors: ['No file selected'] };
  if (file.size > MAX_SAMPLE_BYTES) return { ok: false, errors: [`Sample EPUB must be under 10 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB)`] };
  const isEpub = (file.type === 'application/epub+zip') || /\.epub$/i.test(file.name || '');
  if (!isEpub) return { ok: false, errors: ['Sample must be an EPUB (.epub / application/epub+zip)'] };

  try {
    const { ref: sref, uploadBytesResumable } = await import('firebase/storage');
    const path = `bookstore_epubs/${titleId}/sample.epub`;
    const storageRef = sref(storage, path);
    const task = uploadBytesResumable(storageRef, file, { contentType: 'application/epub+zip' });

    await new Promise((resolve, reject) => {
      task.on(
        'state_changed',
        (snap) => {
          if (typeof onProgress === 'function' && snap.totalBytes) {
            onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
          }
        },
        (err) => reject(err),
        () => resolve()
      );
    });

    return { ok: true, path };
  } catch (err) {
    console.error('[bookstore.admin-writes] uploadSampleEpub failed', err);
    return { ok: false, errors: [`Sample EPUB upload failed: ${err.message || 'unknown error'}`] };
  }
}


// ═════════════════════════════════════════════════════════════════════════════════════════
// R13 — THE GENRE TAXONOMY
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// Same three guarantees as every writer above: admin-checked, validated, never throws.
//
// THE ONE EXTRA RULE IS AT DELETION. A genre with titles on it cannot be deleted, and the
// refusal names them. RTDB has no foreign keys, and a deleted genre does not orphan a title —
// it orphans a SHELF: the title keeps its slug, genreLabel() prints the raw slug because the
// taxonomy no longer knows the word, and the tab it used to sit under disappears while the
// book stays in the catalogue below. That is a screen nobody would read as "a genre was
// deleted", so the deletion is refused where it can still be explained.

const GENRES_PATH = 'bookstore_genres';
const SECTIONS_PATH = 'bookstore_sections';

/** Create or overwrite one genre. The slug IS the key, so this is an upsert by slug. */
export async function saveGenre(input) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  const slug = String(input?.slug || '').trim();
  const now = Date.now();

  let addedAt = now;
  try {
    const existing = await get(ref(db, `${GENRES_PATH}/${slug}`));
    if (existing.exists() && Number.isInteger(existing.val()?.addedAt)) addedAt = existing.val().addedAt;
  } catch {
    // A read failure here costs an addedAt that says "now" on a record that is older. The
    // alternative is refusing the edit, which is worse: the field is provenance, not data
    // anybody renders.
  }

  const doc = {
    schemaVersion: 1,
    slug,
    label: String(input?.label || '').trim(),
    group: input?.group,
    order: Number.isInteger(input?.order) ? input.order : Number.parseInt(input?.order, 10),
    addedAt,
    updatedAt: now,
  };

  const { valid, errors } = validateGenre(doc);
  if (!valid) return { ok: false, errors };

  try {
    await set(ref(db, `${GENRES_PATH}/${doc.slug}`), doc);
    return { ok: true, slug: doc.slug };
  } catch (err) {
    console.error('[bookstore.admin-writes] saveGenre failed', err);
    return { ok: false, errors: [err.message || 'Genre save failed'] };
  }
}

/** Refuses while any title — of any status — still carries the slug. See the note above. */
export async function deleteGenre(slug) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!slug) return { ok: false, errors: ['slug is required'] };
  try {
    const snap = await get(query(ref(db, TITLES_PATH), orderByChild('genre'), equalTo(slug)));
    if (snap.exists()) {
      const names = [];
      snap.forEach((c) => { names.push(c.val()?.title || c.key); return false; });
      return { ok: false, errors: [`${names.length} ${names.length === 1 ? 'title is' : 'titles are'} on this genre: ${names.join(', ')}. Move them first.`] };
    }
    await remove(ref(db, `${GENRES_PATH}/${slug}`));
    return { ok: true };
  } catch (err) {
    console.error('[bookstore.admin-writes] deleteGenre failed', err);
    return { ok: false, errors: [err.message || 'Genre delete failed'] };
  }
}

/**
 * THE MIGRATION, AS A BUTTON. Writes every record buildGenreMigration produces, and writes
 * them with update() against the node root so a genre the curator has already edited by hand
 * is overwritten by the seed only for the keys the seed carries — which is all of them, and
 * is why the panel asks first. It exists so the taxonomy can be established without a
 * service-account key on somebody's laptop.
 */
export async function seedGenres() {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  const payload = buildGenreMigration(Date.now());
  const patch = {};
  for (const g of payload) {
    const { valid, errors } = validateGenre(g);
    if (!valid) return { ok: false, errors: [`seed record ${g.slug} is invalid: ${errors.join('; ')}`] };
    patch[g.slug] = g;
  }
  try {
    await update(ref(db, GENRES_PATH), patch);
    return { ok: true, count: payload.length };
  } catch (err) {
    console.error('[bookstore.admin-writes] seedGenres failed', err);
    return { ok: false, errors: [err.message || 'Genre seed failed'] };
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// R13 — THE CURATED SECTIONS
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ THE WRITER IS WHERE "NEVER SIMULATE IT" IS ENFORCED. validateSection refuses a hand-typed
// `slugs` list on a data-driven type, and this function refuses to fabricate one. A dormant
// section can be created, ordered, titled and retired; it cannot be given books. The only
// thing that can put a book in a Readers' Choice is an aggregate written by a job that read
// what readers actually did.

/** Create a section. `id` is generated from the type so the node reads as a shelf plan. */
export async function createSection(input) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  const spec = SECTION_TYPES[input?.type];
  if (!spec) return { ok: false, errors: [`Unknown section type: ${input?.type}`] };

  const now = Date.now();
  const id = String(input?.id || '').trim() || `${spec.key}-${now.toString(36)}`;
  const doc = buildSectionDoc(input, spec, { addedAt: now, updatedAt: now });

  const { valid, errors } = validateSection(doc);
  if (!valid) return { ok: false, errors };

  try {
    const existing = await get(ref(db, `${SECTIONS_PATH}/${id}`));
    if (existing.exists()) return { ok: false, errors: [`A section with id "${id}" already exists`] };
    await set(ref(db, `${SECTIONS_PATH}/${id}`), doc);
    return { ok: true, id };
  } catch (err) {
    console.error('[bookstore.admin-writes] createSection failed', err);
    return { ok: false, errors: [err.message || 'Section create failed'] };
  }
}

/** Full overwrite, like updateTitle — so clearing a month genuinely removes the key. */
export async function updateSection(id, input) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!id) return { ok: false, errors: ['id is required'] };
  const spec = SECTION_TYPES[input?.type];
  if (!spec) return { ok: false, errors: [`Unknown section type: ${input?.type}`] };

  let addedAt = Date.now();
  try {
    const existing = await get(ref(db, `${SECTIONS_PATH}/${id}`));
    if (!existing.exists()) return { ok: false, errors: [`No section with id "${id}"`] };
    // THE TYPE IS LOCKED AFTER CREATION, mirroring updateTitle's treatment of publisherId and
    // updateInstalment's of seriesId. A section that changes type carries a claim whose size,
    // date and rank all mean something different, and there is no honest way to reinterpret
    // one as the other — a Book of the Month becoming a Top of the Shelf takes its month with
    // it into a type that has none.
    const prevType = existing.val()?.type;
    if (prevType && prevType !== input.type) {
      return { ok: false, errors: [`A section's type cannot change (${prevType} → ${input.type}). Retire it and create the new one.`] };
    }
    if (Number.isInteger(existing.val()?.addedAt)) addedAt = existing.val().addedAt;
  } catch (err) {
    console.error('[bookstore.admin-writes] updateSection read failed', err);
    return { ok: false, errors: [err.message || 'Section read failed'] };
  }

  const doc = buildSectionDoc(input, spec, { addedAt, updatedAt: Date.now() });
  const { valid, errors } = validateSection(doc);
  if (!valid) return { ok: false, errors };

  try {
    await set(ref(db, `${SECTIONS_PATH}/${id}`), doc);
    return { ok: true, id };
  } catch (err) {
    console.error('[bookstore.admin-writes] updateSection failed', err);
    return { ok: false, errors: [err.message || 'Section save failed'] };
  }
}

/**
 * Retire / restore. A SOFT SWITCH and never a delete, matching setTitleStatus: a retired
 * section keeps its claim, so putting last month's shelf back is one click and not a
 * re-typing of what the curator chose. resolveSections drops anything not 'live'.
 */
export async function setSectionStatus(id, status) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!SECTION_STATUSES.includes(status)) return { ok: false, errors: [`status must be one of: ${SECTION_STATUSES.join(', ')}`] };
  try {
    await update(ref(db, `${SECTIONS_PATH}/${id}`), { status, updatedAt: Date.now() });
    return { ok: true };
  } catch (err) {
    console.error('[bookstore.admin-writes] setSectionStatus failed', err);
    return { ok: false, errors: [err.message || 'Status change failed'] };
  }
}

/** Genuine removal, for a section created by mistake. */
export async function deleteSection(id) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!id) return { ok: false, errors: ['id is required'] };
  try {
    await remove(ref(db, `${SECTIONS_PATH}/${id}`));
    return { ok: true };
  } catch (err) {
    console.error('[bookstore.admin-writes] deleteSection failed', err);
    return { ok: false, errors: [err.message || 'Section delete failed'] };
  }
}

/** Re-order in one write, so the shop never renders a half-applied ordering. */
export async function reorderSections(idsInOrder) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!Array.isArray(idsInOrder) || idsInOrder.length === 0) return { ok: false, errors: ['Nothing to order'] };
  const now = Date.now();
  const patch = {};
  idsInOrder.forEach((id, i) => {
    patch[`${id}/order`] = i;
    patch[`${id}/updatedAt`] = now;
  });
  try {
    await update(ref(db, SECTIONS_PATH), patch);
    return { ok: true };
  } catch (err) {
    console.error('[bookstore.admin-writes] reorderSections failed', err);
    return { ok: false, errors: [err.message || 'Reorder failed'] };
  }
}

/**
 * FOLD THE WINDOW IN — the migration, by hand, from the panel.
 *
 * Reads the published catalogue, asks buildWindowMigration what the Window's claim is today,
 * and writes it. Refuses if bookstore_sections already holds anything, because the second
 * press of this button would silently overwrite whatever the curator has since arranged.
 */
export async function migrateWindowSection() {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  try {
    const existing = await get(ref(db, SECTIONS_PATH));
    if (existing.exists()) return { ok: false, errors: ['Sections already exist — the Window has been folded in already.'] };

    const snap = await get(query(ref(db, TITLES_PATH), orderByChild('status'), equalTo('published')));
    const titles = [];
    snap.forEach((c) => { titles.push({ id: c.key, ...c.val() }); return false; });

    const payload = buildWindowMigration(titles, Date.now());
    if (payload.length === 0) {
      return { ok: false, errors: ['No published title carries `featured`, so there is no Window claim to fold in.'] };
    }
    const patch = {};
    for (const sec of payload) {
      const { id, ...doc } = sec;
      const { valid, errors } = validateSection(doc);
      if (!valid) return { ok: false, errors };
      patch[id] = doc;
    }
    await update(ref(db, SECTIONS_PATH), patch);
    return { ok: true, count: payload.length, slug: payload[0].slugs[0] };
  } catch (err) {
    console.error('[bookstore.admin-writes] migrateWindowSection failed', err);
    return { ok: false, errors: [err.message || 'Window migration failed'] };
  }
}

/**
 * The form's shape → the record's shape. One place, so create and update cannot store two
 * different documents for the same screen. Keys the type does not carry are OMITTED rather
 * than nulled, for the reason normaliseTerritoryFields gives above: the absence of a claim is
 * said by the absence of a field, and set() genuinely removes what the merged doc leaves out.
 */
function buildSectionDoc(input, spec, stamps) {
  const doc = {
    schemaVersion: 1,
    type: spec.key,
    displayTitle: String(input?.displayTitle || '').trim(),
    order: Number.isInteger(input?.order) ? input.order : (Number.parseInt(input?.order, 10) || 0),
    status: input?.status === 'retired' ? 'retired' : 'live',
    addedAt: stamps.addedAt,
    updatedAt: stamps.updatedAt,
  };

  // ⚠ A DATA-DRIVEN SECTION IS NEVER GIVEN SLUGS, whatever the form sent.
  doc.slugs = spec.dataDriven ? [] : (Array.isArray(input?.slugs) ? input.slugs.map((s) => String(s).trim()).filter(Boolean) : []);
  if (spec.dataDriven) delete doc.slugs;

  const line = String(input?.curatorLine || '').trim();
  if (line) doc.curatorLine = line;

  if (spec.dated) doc.monthKey = String(input?.monthKey || '').trim();
  if (spec.rankable) doc.ranked = !!input?.ranked;

  return doc;
}
