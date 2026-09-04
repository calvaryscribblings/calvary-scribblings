// Open Pages — shared data-model contract (Stage 1).
//
// "Open Pages" is a community publishing space: any logged-in account-holder
// writes a post, an AI moderation gate screens it, clean posts publish to a
// public feed, flagged posts go to an admin review queue. This module is the
// single source of truth for node names + the post shape so every later stage
// (composer, moderation function, public feed, admin queue) imports the same
// keys instead of re-typing string literals.
//
// TRUST MODEL — "Option A":
//   - Clients can ONLY write to `open_pages_pending` (their own post).
//   - The public `open_pages` node is written EXCLUSIVELY by the server-side
//     moderation function using Firebase Admin credentials (which bypass RTDB
//     rules). RTDB rules deny all client writes to `open_pages`.
//   - Therefore the public feed structurally cannot contain unmoderated content.
//
// BODY FORMAT: Markdown (rendered to React via remark-gfm in a later stage).
//   NEVER raw HTML, NEVER dangerouslySetInnerHTML — the repo has no sanitiser.
//
// IDENTITY: posts carry a DENORMALIZED author snapshot (authorName, authorHandle,
//   authorAvatarUrl) for resilience/offline, but display surfaces should RESOLVE
//   LIVE from users/{authorUid} (see resolveAuthorNames.js / the Comment* helpers
//   in app/stories/[slug]/page-client.js). The snapshot is a fallback, not the
//   source of truth at render time.
//
// CONVENTIONS (match square_posts):
//   - push-id keys, createdAt: Date.now() (integer ms).
//   - mirror to user_open_pages/{authorUid}/{postId} for per-author listing
//     (parallels user_square_posts).

// ---------------------------------------------------------------------------
// Node names — import these instead of hardcoding path strings.
// ---------------------------------------------------------------------------

/** Public feed. MODERATED posts only. Admin-SDK writes only; client read-only. */
export const OPEN_PAGES_NODE = 'open_pages';

/** Pending/flagged posts. Author + admin only. Clients write here, never to OPEN_PAGES_NODE. */
export const OPEN_PAGES_PENDING_NODE = 'open_pages_pending';

/** Per-author index of a user's own posts (parallels user_square_posts). */
export const USER_OPEN_PAGES_NODE = 'user_open_pages';

// ---------------------------------------------------------------------------
// Status enum.
// ---------------------------------------------------------------------------

/**
 * Post lifecycle status.
 *   pending  — written by client to open_pages_pending, awaiting moderation.
 *   live     — passed moderation; copied to public open_pages by the function.
 *   flagged  — failed/uncertain moderation; held in open_pages_pending for admin review.
 *   removed  — soft-deleted (by author or admin).
 */
export const OPEN_PAGE_STATUS = Object.freeze({
  PENDING: 'pending',
  LIVE: 'live',
  FLAGGED: 'flagged',
  REMOVED: 'removed',
});

const VALID_STATUSES = new Set(Object.values(OPEN_PAGE_STATUS));

/** True if `s` is one of the four valid lifecycle statuses. */
export function isValidOpenPageStatus(s) {
  return VALID_STATUSES.has(s);
}

// ---------------------------------------------------------------------------
// Genres — the six categories a post can be filed under. Shared by the composer
// picker, the moderation function (which persists the value), and the public
// feed's filter bar so they can never drift. 'General' is the default/fallback
// and is listed last (it's the catch-all).
// ---------------------------------------------------------------------------

export const OPEN_PAGE_GENRES = Object.freeze([
  'Literary',
  'Flash',
  'Short Story',
  'Poetry',
  'Inspiring',
  'General',
]);

export const DEFAULT_GENRE = 'General';

const VALID_GENRES = new Set(OPEN_PAGE_GENRES);

/** Coerce any input to one of the six valid genres, defaulting to 'General'. */
export function normalizeGenre(g) {
  return typeof g === 'string' && VALID_GENRES.has(g) ? g : DEFAULT_GENRE;
}

// ---------------------------------------------------------------------------
// Post shape (documentation — both nodes share this shape).
// ---------------------------------------------------------------------------
//
// open_pages/{postId} and open_pages_pending/{postId} both hold records of:
//
//   {
//     authorUid:       string,          // identity anchor — resolve live from users/{uid}
//     authorName:      string,          // denormalized snapshot (fallback only)
//     authorHandle:    string,          // denormalized snapshot — users/{uid}/username ('' if none)
//     authorAvatarUrl: string | null,   // denormalized snapshot — users/{uid}/avatarUrl
//     title:           string,
//     body:            string,          // MARKDOWN (never HTML); inline images are ![alt](url)
//     coverImage:      string | null,   // optional hero image — Firebase Storage download URL
//     status:          'pending' | 'live' | 'flagged' | 'removed',
//     moderation:      { result, reason, checkedAt, model } | null,
//     createdAt:       number,          // Date.now() (ms)
//     updatedAt:       number,          // Date.now() on a published edit; ABSENT if never edited
//   }
//
// R36 — THERE IS ONE NAME FOR THIS AND IT IS `updatedAt`. This block used to document
// an `editedAt` that no record has ever carried: buildPendingPost set it to null, RTDB
// drops nulls, and the field never landed — measured at 0 of 7 live pieces on
// 2026-09-04, while `updatedAt`, written by the edit path, was on 3 of 7 and greater
// than createdAt on all three. Two names for one idea is how a reader-facing "edited"
// mark ends up reading the field that is always empty, so the unused one is gone.
//
// `moderation` is null until the function screens the post. After screening:
//   { result: 'clean'|'flagged'|'error', reason: string, checkedAt: number (ms),
//     model: string (e.g. the Claude model id used) }

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * R36 — THE EDIT MARK. True when a reader should be told this piece has been edited.
 *
 * Ikenna's ruling is that a published piece stays editable FOREVER — Open Pages is a
 * writing platform and writers fix things; a typo found six months later should be
 * fixable, and R35 already guarantees every published edit passes back through the
 * moderation function. What matters is not whether they edited but that a reader can
 * see they did.
 *
 * Reads `updatedAt` and nothing else. The `> createdAt` comparison is load-bearing
 * twice over: it keeps a record whose updatedAt was written equal to createdAt from
 * claiming an edit, and it is what leaves the three founder-APPROVED live pieces
 * unmarked — they carry `approvedAt`, not `updatedAt`, and approval by an admin is
 * not an edit by the author.
 */
export function isEdited(post) {
  const created = post?.createdAt;
  const updated = post?.updatedAt;
  return typeof created === 'number' && typeof updated === 'number' && updated > created;
}

/**
 * Build the denormalized author snapshot from a Firebase auth user + their
 * users/{uid} profile object. Mirrors exactly the fields square_posts stores:
 *   authorUid, authorName, authorHandle, authorAvatarUrl.
 *
 * @param {{ uid: string, displayName?: string }} authUser  Firebase auth user.
 * @param {object} [profile]  The users/{uid} profile snapshot (.val()).
 * @returns {{ authorUid: string, authorName: string, authorHandle: string, authorAvatarUrl: string|null }}
 */
export function buildAuthorSnapshot(authUser, profile = {}) {
  const p = profile || {};
  return {
    authorUid: authUser?.uid || '',
    authorName: authUser?.displayName || p.displayName || 'Reader',
    authorHandle: p.username || '',
    authorAvatarUrl: p.avatarUrl || null,
  };
}

/**
 * Build a complete pending-post record ready to push() to open_pages_pending.
 * Status is always PENDING and moderation is null at creation — the server
 * function fills moderation and decides live/flagged. There is no editedAt: a
 * record that has never been edited simply has no updatedAt (see the shape note
 * above).
 *
 * @param {object} snapshot  Result of buildAuthorSnapshot().
 * @param {{ title: string, body: string, coverImage?: string|null, genre?: string }} content
 *        Post title + Markdown body, plus an optional cover image download URL
 *        (Firebase Storage) and a genre (one of OPEN_PAGE_GENRES, defaults to
 *        'General'). Inline images live inside `body` as Markdown image syntax —
 *        only the hero/cover lives in its own field.
 * @param {number} now  Date.now() — pass in so callers control the clock.
 * @returns {object} A full post record.
 */
export function buildPendingPost(snapshot, { title, body, coverImage, genre }, now) {
  return {
    authorUid: snapshot.authorUid,
    authorName: snapshot.authorName,
    authorHandle: snapshot.authorHandle,
    authorAvatarUrl: snapshot.authorAvatarUrl,
    title: title || '',
    body: body || '',
    coverImage: coverImage || null,
    genre: normalizeGenre(genre),
    status: OPEN_PAGE_STATUS.PENDING,
    moderation: null,
    createdAt: now,
  };
}
