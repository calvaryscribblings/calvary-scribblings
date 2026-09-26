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
