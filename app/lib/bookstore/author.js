// R18 — THE AUTHOR ON THE BOOK STORE DETAIL PAGE.
//
// The Book Store's own author block: a name, a bio and a photograph, stored on
// bookstore_titles and printed under the synopsis. This is the BOOK STORE's CMS. It does not
// read from, write to, or reference the platform's /admin contributor records — different
// product, different infrastructure, its own fields. Nothing here should ever grow an import
// from app/lib/authors or a lookup against `users`.
//
// ── SCHEMA-EXTERNAL, LIKE EVERY FIELD ADDED SINCE v2 ──────────────────────────────────────
// TITLE_SCHEMA in schema.js stays LOCKED at v2. These four ride the samplePath / glossary /
// territoriesExcluded precedent: validateTitle ignores them, and their shape is checked here,
// at the last gate before the database, by validateAuthorFields — which admin-writes.js runs
// on every create and every update.
//
// ── authorName IS NOT THE BYLINE, AND MAY DISAGREE WITH IT ────────────────────────────────
// `author` (schema-locked) is the BYLINE: an editorial decision about whose name sits under
// the title on the cover and the shelf. On an anthology it deliberately reads "Calvary
// Scribblings" so that no single contributor takes the attention, even though the book has
// eight writers.
//
// `authorName` is a PERSON, for the author block below the synopsis.
//
// The two are allowed to disagree, and disagreement is a normal state rather than a mistake.
// NEVER derive one from the other, never sync them, and never warn when they differ — a
// "helpful" reconciliation here would overwrite an editorial decision with a guess. There is
// a test pinning exactly this: tests/bookstore/author.test.mjs.
//
// ── THE PHOTOGRAPH LIVES BESIDE THE COVER, AND FLATLY ─────────────────────────────────────
// storage.rules has `match /bookstore_covers/{titleId} { allow read: if true; }` — public
// read, admin-uid-only write, image/* — which is what a photograph printed on a public page
// needs, and it is the reason the block can store a PATH rather than a tokenised download URL
// (see publicPhotoUrl below).
//
// ⚠ THAT MATCH IS SINGLE-SEGMENT. `{titleId}` captures ONE path segment, so
// `bookstore_covers/<id>/author.jpg` does NOT match it — a nested photo would fall through to
// no rule at all and be denied on both read and write. The cover itself is stored flat
// (admin-writes.js: `bookstore_covers/${titleId}.${ext}`), so the photo goes beside it flatly
// too, as a sibling KEY rather than a child folder.
//
// The suffix is `_author` and the underscore is load-bearing. SLUG_RE in schema.js is
// /^[a-z0-9]+(-[a-z0-9]+)*$/ — a title id can carry hyphens but never an underscore. So
// `jane_author.jpg` cannot collide with the cover of a title legitimately slugged
// `jane-author`, which `jane-author.jpg` would have done.

export const AUTHOR_PHOTO_PREFIX = 'bookstore_covers';
export const AUTHOR_PHOTO_SUFFIX = '_author';

// 3 MB, per the round's brief. The storage rule for this prefix caps at 5 MB because it is the
// COVER's rule and covers are allowed more; the tighter number is the client's, applied here
// so both writers (admin form, any future tool) get the same refusal.
export const MAX_AUTHOR_PHOTO_BYTES = 3 * 1024 * 1024;

// The bounds, in one place, so the form's counter, the write-time validator and the RTDB
// .validate rules cannot drift. tests/rules/database.test.mjs reads this table and proves the
// rule half matches it in both directions.
export const AUTHOR_CAPS = {
  authorName: 120,
  authorBio: 800,
  authorPhotoAlt: 160,
  authorPhotoPath: 200,
};

export const AUTHOR_FIELDS = ['authorName', 'authorBio', 'authorPhotoPath', 'authorPhotoAlt'];

const isStr = (v) => typeof v === 'string' && v.length > 0;

/** The storage key for a title's author photograph. Flat sibling of the cover — see header. */
export function authorPhotoPathFor(titleId, ext) {
  const e = String(ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `${AUTHOR_PHOTO_PREFIX}/${titleId}${AUTHOR_PHOTO_SUFFIX}.${e}`;
}

/** Exactly the shape the rule enforces: one flat key under the public-read cover prefix. */
export function isAuthorPhotoPath(v) {
  return isStr(v)
    && v.length <= AUTHOR_CAPS.authorPhotoPath
    && /^bookstore_covers\/[A-Za-z0-9._-]+$/.test(v);
}

// A STORAGE PATH, NOT A DOWNLOAD URL, is what gets stored — and that is only renderable
// because the prefix is `allow read: if true`. Firebase's REST download endpoint evaluates the
// Storage rules for an unauthenticated GET, so `?alt=media` with no token is served to anyone
// for an object under a public-read prefix, and refused for one that is not. The cover stores
// a getDownloadURL() string (a permanent, token-bearing link) for historical reasons; the
// photo does not need one, and a path is the smaller thing to keep correct.
const BUCKET = 'calvary-scribblings.firebasestorage.app';

export function publicPhotoUrl(path) {
  if (!isAuthorPhotoPath(path)) return null;
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
}

/**
 * Reduce every "there isn't one" spelling to null, in place, on the doc about to be written.
 * Same contract as normaliseGlossaryField: a title either HAS a field or carries it as null,
 * never as an empty husk. RTDB drops a null key on write, and .validate never runs on a null,
 * which is how ABSENCE stays expressible for four fields that are all optional.
 */
export function normaliseAuthorFields(doc) {
  for (const k of AUTHOR_FIELDS) {
    const v = doc[k];
    if (v === undefined || v === null) { doc[k] = null; continue; }
    if (typeof v === 'string') { doc[k] = v.trim() || null; continue; }
    // Leave a non-string alone so the validator can name it rather than silently coercing.
  }
  return doc;
}

/**
 * Shape check for already-normalised values ('' → null). Returns an array of error strings,
 * empty when the doc is fine. Absent (null) is always valid: all four fields are optional and
 * a title with no author block is a normal title.
 */
export function validateAuthorFields(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['doc is not an object'];

  for (const k of ['authorName', 'authorBio', 'authorPhotoAlt']) {
    const v = doc[k];
    if (v === null || v === undefined) continue;
    if (typeof v !== 'string' || v.length === 0) { errors.push(`${k} must be a non-empty string or null`); continue; }
    if (v.length > AUTHOR_CAPS[k]) errors.push(`${k} must be ${AUTHOR_CAPS[k]} characters or fewer`);
  }

  const p = doc.authorPhotoPath;
  if (p !== null && p !== undefined && !isAuthorPhotoPath(p)) {
    errors.push(`authorPhotoPath must be a path under ${AUTHOR_PHOTO_PREFIX}/ or null`);
  }

  return errors;
}

/**
 * THE ONE DECISION THE PAGE MAKES, and it is here rather than inside the component so it can
 * be asserted without a browser.
 *
 * NO FALLBACK. A title with no author block is a NORMAL state, not a missing one — an
 * anthology has no single author, and eleven Linea House titles landing with bios does not
 * make the twelfth title's silence a gap. So: no bio and no photo → null, and the caller
 * renders NOTHING. Not a label, not a placeholder, not an empty frame, not "no bio available".
 *
 * A NAME ALONE IS NOT A BLOCK. `authorName` without a bio or a photograph would print a
 * section heading over a single line already said by the byline three inches above it. The
 * gate is bio-or-photo, exactly as the brief states it.
 *
 * A photo without a bio, and a bio without a photo, each return a block — the component lays
 * both out sensibly, and there are tests for both.
 */
export function authorBlockOf(title) {
  if (!title || typeof title !== 'object') return null;

  const name = isStr(title.authorName) ? title.authorName.trim() : null;
  const bio = isStr(title.authorBio) ? title.authorBio.trim() : null;
  const path = isAuthorPhotoPath(title.authorPhotoPath) ? title.authorPhotoPath : null;
  const photoUrl = path ? publicPhotoUrl(path) : null;

  if (!bio && !photoUrl) return null;

  // The alt text falls back to the name and then to a plain description. This is NOT the
  // forbidden fallback — that ruling is about inventing a SECTION, and this is about not
  // shipping an unlabelled image to a screen reader.
  const alt = isStr(title.authorPhotoAlt)
    ? title.authorPhotoAlt.trim()
    : (name ? `Photograph of ${name}` : 'Photograph of the author');

  return { name, bio, photoUrl, alt: photoUrl ? alt : null };
}
