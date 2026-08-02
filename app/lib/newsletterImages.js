// Newsletter image uploads.
//
// Cloned from uploadCover() in app/lib/bookstore/admin-writes.js: admin guard
// before anything else, progress callback, never throws — returns
// { ok: true, url, path } or { ok: false, errors: [...] }.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE PERMANENCE RULE
//
// Objects under newsletter/ are NEVER deleted, renamed, or re-uploaded in
// place. Not by this module, not by the studio, not by hand in the console.
//
// A sent email cannot be patched. It carries an absolute URL to the storage
// object, and every copy of that mail — in every inbox, for as long as anyone
// keeps it — fetches the picture from that URL on open. Replacing the object
// changes the picture inside mail that has already landed. Deleting it leaves a
// permanent broken image in the archive of every reader who kept the issue.
// Neither is recoverable, because there is no recall.
//
// There is a second, quieter reason. getDownloadURL() mints a download token
// that lives in the object's metadata. Delete the object and that token dies
// with it, so even re-uploading identical bytes to the same path yields a
// DIFFERENT URL — the old link 404s forever. "Just re-upload it" does not
// restore anything.
//
// The storage rules cannot enforce this: delete is a client operation, and the
// admin UID is allowed to perform it. So enforcement is here, structurally —
// this module has no delete function, and uploadNewsletterImage() only ever
// mints a fresh, collision-proof path. There is no code path that writes twice
// to the same object.
//
// Superseding an image means uploading a NEW one and pointing the block at it.
// The old object stays where it is, serving the issues that already shipped.
// ─────────────────────────────────────────────────────────────────────────────

import { auth, storage } from './firebase';

const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];

// Mirrors the storage rule for newsletter/{issueId}/{file}: 5 MB, image/* only.
// Checked here so the author gets a sentence instead of a rules rejection.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function isAdmin() {
  const uid = auth?.currentUser?.uid;
  return !!uid && ADMIN_UIDS.includes(uid);
}

function extOf(file) {
  const name = (file && file.name) || '';
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return (m ? m[1] : 'bin').toLowerCase();
}

// Storage object names are opaque, but these paths end up inside a URL in mail
// that outlives the studio, so keep them boring: lowercase, no spaces, nothing
// that needs escaping.
function slugOf(file) {
  const name = ((file && file.name) || 'image').replace(/\.[a-zA-Z0-9]+$/, '');
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'image';
}

// The collision-proof half of the permanence rule. Two files named cover.jpg in
// one issue must not become one object — the second would overwrite the first
// and change the picture in whatever already shipped. A unique suffix makes
// every upload a create, never a replace.
function uniqueToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Upload one image for an issue.
 *
 * @param issueId  the draft or issue id — the folder under newsletter/
 * @param file     a File from an <input type="file">
 * @param onProgress  called with 0-100 as the upload runs
 * @returns { ok: true, url, path } | { ok: false, errors: [string] }
 */
export async function uploadNewsletterImage(issueId, file, onProgress) {
  if (!isAdmin()) return { ok: false, errors: ['Not authorised'] };
  if (!issueId) return { ok: false, errors: ['issueId is required'] };
  if (!file) return { ok: false, errors: ['No file selected'] };
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, errors: [`Image must be under 5 MB (got ${(file.size / 1024 / 1024).toFixed(1)} MB)`] };
  }
  if (!file.type || !file.type.startsWith('image/')) {
    return { ok: false, errors: ['File must be an image'] };
  }

  try {
    const { ref: sref, uploadBytesResumable, getDownloadURL } = await import('firebase/storage');
    // Fresh path every time — see THE PERMANENCE RULE above.
    const path = `newsletter/${issueId}/${slugOf(file)}-${uniqueToken()}.${extOf(file)}`;
    const task = uploadBytesResumable(sref(storage, path), file, { contentType: file.type });

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
    console.error('[newsletterImages] uploadNewsletterImage failed', err);
    return { ok: false, errors: [`Image upload failed: ${err.message || 'unknown error'}`] };
  }
}
