// THE SQUARE'S REACTION COUNTS ARE WHO REACTED — W54.
//
// A count is the number of readers under square_reactions/{postId}/{type} (square_archive_reactions
// once the horizon has moved the thread). The stored likeCount / fireCount / clapCount on the post
// were a second copy that any client could nudge by one, and drifted from the list they summarised;
// the web no longer reads or writes them. Reactions themselves stay direct writes, one leaf per
// reader, which the rules already hold to the reader's own uid.
//
// The app still writes the stored counts until A44; nothing on the web reads them, so they are
// harmless until W55 decides what to do with them.

export const REACTION_TYPES = Object.freeze(['like', 'clap', 'fire']);

/** { likeCount, clapCount, fireCount } from one post's square_reactions node. */
export function reactionCounts(node) {
  const n = node && typeof node === 'object' ? node : {};
  const out = {};
  for (const t of REACTION_TYPES) {
    const who = n[t] && typeof n[t] === 'object' ? n[t] : {};
    out[`${t}Count`] = Object.values(who).filter((v) => v === true).length;
  }
  return out;
}

/** The post with its counts drawn from the reactions node (and none of its stored ones). */
export function withReactionCounts(post, node) {
  return { ...post, ...reactionCounts(node) };
}

/** One post's reactions node: the room's, or the archive's once the horizon has moved it. */
export async function reactionsOf(db, ref, get, postId) {
  try {
    const live = await get(ref(db, `square_reactions/${postId}`));
    if (live.exists()) return live.val();
    const archived = await get(ref(db, `square_archive_reactions/${postId}`));
    return archived.exists() ? archived.val() : null;
  } catch {
    return null;
  }
}
