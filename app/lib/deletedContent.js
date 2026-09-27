// W17 — WHAT A THREAD SHOWS WHERE A DELETED READER'S WORDS WERE (ruling 30, Ikenna, 26 Sep 2026).
//
// When an account is deleted, its comments and Square posts are deleted with it (ruling 29). But a
// comment or post of theirs that has another reader's reply beneath it is kept as a TOMBSTONE, so
// the other reader's words keep their thread: scripts/account/scrub-plan.mjs writes
// { deleted: true, deletedAt, createdAt, parentId, replies } — no words, no author, no counts.
// Every surface that draws a thread draws a tombstone in these words, with no name, no avatar, no
// reactions and no Reply. The words are ruled; changing them needs a new ruling.

export const DELETED_RESPONSE = 'This response was deleted.';
export const DELETED_POST = 'This post was deleted.';

/** Is this comment or post a deleted reader's tombstone? */
export const isTombstone = (node) => node?.deleted === true;

// W19 — A LINK TO A DELETED OPEN PAGES PIECE (ruling 47, Ikenna, 27 Sep 2026).
//
// The piece's own page, and anything that quotes it or links to it, shows exactly this line, drawn
// like the site's empty-state notes: no link and no byline. Lists of pieces leave it out, as they
// already did. The words are ruled; changing them needs a new ruling.
export const DELETED_PIECE = 'This piece was deleted.';

// A piece id is a database push id: '-' and 19 more of [A-Za-z0-9_-]. Only an address of THAT shape
// is read as "a piece that was deleted"; /open-pages/none (the build's placeholder) or a mangled id
// keeps the ordinary not-found page, because nothing says a piece ever lived there.
export const PIECE_ID_RE = /^-[A-Za-z0-9_-]{19}$/;
export const PIECE_PATH_RE = /^\/open-pages\/(-[A-Za-z0-9_-]{19})\/?$/;

/** The piece id an address points at, or null. */
export const pieceIdFromPath = (pathname) => (typeof pathname === 'string' && PIECE_PATH_RE.exec(pathname)?.[1]) || null;

/** The piece a Square post announces, or null. Only the Open Pages announcer writes attachedOpenPage. */
export const announcedPieceOf = (post) => {
  const id = post?.attachedOpenPage?.id;
  return typeof id === 'string' && PIECE_ID_RE.test(id) ? id : null;
};
