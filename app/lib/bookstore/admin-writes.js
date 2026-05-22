// Admin-only write helpers for bookstore_publishers/ and bookstore_titles/.
// Every function:
//   - checks auth.currentUser.uid against the admin UID before writing
//   - validates via validateTitle / validatePublisher and refuses to write on validation errors
//   - never throws — returns { ok: true, ... } or { ok: false, errors: [...] }

import { ref, get, set, update, increment } from 'firebase/database';
import { db, auth, storage } from '../firebase';
import {
  validatePublisher,
  validateTitle,
  SCHEMA_VERSION,
  PUBLISHER_STATUSES,
  TITLE_STATUSES,
} from './schema';

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
    prices: input.prices || {},
    genre: input.genre,
    publishedDate: input.publishedDate,
    addedAt: now,
    updatedAt: now,
    status: input.status || 'draft',
    featured: !!input.featured,
    bestseller: !!input.bestseller,
    territoriesAllowed: input.territoriesAllowed ?? '*',
    salesCount: 0,
    ratingAverage: null,
    ratingCount: 0,
  };

  // Optional fields — only include if present.
  if (input.isbn) doc.isbn = String(input.isbn).trim();
  if (input.excerpt) doc.excerpt = String(input.excerpt).trim();
  if (Array.isArray(input.tags) && input.tags.length) doc.tags = input.tags.filter((t) => typeof t === 'string' && t.length > 0);
  if (Number.isInteger(input.pageCount) && input.pageCount > 0) doc.pageCount = input.pageCount;

  const result = validateTitle(doc);
  if (!result.valid) return { ok: false, errors: result.errors };

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
