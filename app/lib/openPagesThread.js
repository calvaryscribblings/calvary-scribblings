// Open Pages — comment-thread helpers (R36).
//
// Extracted from app/open-pages/[id]/page-client.js so the blocking filter can be
// tested directly. A filter that decides what one reader may see is not something to
// assert by reading the JSX.

/**
 * R36 — BLOCKING IS A READ-SIDE FILTER, AND THIS IS THE WHOLE OF IT.
 *
 * Ikenna's ruling: blocking means THIS PERSON CANNOT REACH ME. Their comments on my
 * work are hidden from me. Their WRITING STAYS PUBLIC — hiding someone's published
 * piece from a reader sounds kind and is not, because it means two readers see
 * different feeds and a conversation about a piece can happen where one party cannot
 * see the piece. Publishing is addressed to everyone; a block is about the reader,
 * not about the work.
 *
 * So this prunes the COMMENT TREE and nothing else. Nothing in this module touches a
 * post, a feed or a listing, and the test suite asserts that a blocked author's PIECE
 * is still returned.
 *
 * It is deliberately not a write barrier. Stopping the blocked account from POSTING a
 * reply would mean their client had to know it was blocked, which means publishing who
 * has blocked whom — blocked_users/$uid is readable only by its owner, and that is the
 * right shape. So the reply is written and simply never reaches the blocker. A block
 * is a social boundary, not a security one, and pretending otherwise would cost every
 * reader the privacy of their own block list.
 *
 * The prune is recursive: a blocked author's reply is hidden wherever it sits in the
 * thread, not only at the top level. Replies UNDER a blocked comment go with it — the
 * blocker cannot see what those replies are answering, so showing them orphaned would
 * be worse than hiding them.
 *
 * @param {Array} nodes  Comment tree ({ authorUid, replies: [...] }).
 * @param {Set<string>} blocked  uids this reader has blocked.
 * @returns {Array} A new tree; the input is never mutated.
 */
export function pruneBlocked(nodes, blocked) {
  if (!Array.isArray(nodes)) return [];
  if (!blocked || blocked.size === 0) return nodes;
  return nodes
    .filter((n) => !blocked.has(n.authorUid))
    .map((n) => (n.replies && n.replies.length ? { ...n, replies: pruneBlocked(n.replies, blocked) } : n));
}

/** Total nodes in a tree, replies included — so a heading agrees with what renders. */
export function countNodes(nodes) {
  if (!Array.isArray(nodes)) return 0;
  return nodes.reduce((sum, n) => sum + 1 + (n.replies ? countNodes(n.replies) : 0), 0);
}
