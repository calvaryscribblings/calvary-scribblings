// STORY-W1 / RULING 328 — blocking or muting someone also hides their responses under stories,
// for the reader who blocked or muted them, as the Square already does (ruling 207, W53).
//
// The lists are the Square's own: muted_users/{uid} and blocked_users/{uid}, both owner-read only,
// read by app/components/square/useSafety.js and merged by hiddenUids() in app/lib/squareSafety.js.
// Nothing here writes, and nothing tells the hidden reader anything.
//
// Story responses are a flat list under comments/{slug}, each with an optional parentId, drawn as a
// tree (app/stories/[slug]/page-client.js and app/reader/[slug]/page-reader.js). What this reader
// is shown, when `hidden` holds the uids they muted or blocked:
//
//   A TOP-LEVEL response by a hidden reader leaves with its whole thread, the replies under it
//   included, as the Square's feed drops a hidden reader's post and Open Pages prunes a blocked
//   comment's subtree (app/lib/openPagesThread.js): what those replies answer is gone.
//
//   A REPLY by a hidden reader, anywhere under someone else's response, leaves, unless a reply this
//   reader can see hangs beneath it. Then it is drawn as a stand-in, "A reply you've hidden." (the
//   Square's ruled words), with no name, no words and no reactions, so the visible reply keeps its
//   place. That is ruling 207 exactly.
//
//   A deleted reader's tombstone (ruling 30) keeps its current treatment, except that one whose
//   every reply is now hidden is not drawn: it would stand over nothing.
//
//   THE COUNT ("N responses") leaves out every hidden reader's response and every response inside
//   a thread that left, and never counts a stand-in, as the Square's counts never count a hidden
//   reply. With nobody hidden it is exactly what it was: every response that is not a tombstone.

import { SAFETY_COPY } from './squareSafety.js';
import { isTombstone } from './deletedContent.js';

/** The words a stand-in shows. The Square's, ruled (207). */
export const HIDDEN_RESPONSE = SAFETY_COPY.hiddenReply;

/** Is this response's author one this reader has muted or blocked? A tombstone has no author. */
const byHidden = (c, hidden) => !!(hidden && hidden.size && c && !isTombstone(c) && c.authorUid && hidden.has(c.authorUid));

/**
 * What this reader is shown of a story's responses, and the count that agrees with it.
 *
 * @param {Array}  comments  every response under the story ({ id, parentId?, authorUid, ... }), any order
 * @param {Set}    hidden    uids this reader has muted or blocked (empty, or null, when signed out)
 * @returns {{ shown: Array, count: number }}
 *   shown  the responses to draw, in the input's order. A hidden reply holding up a visible one is
 *          replaced by { id, parentId, createdAt, hiddenByYou: true } and nothing else.
 *   count  responses to show in the heading.
 */
export function shownResponses(comments, hidden) {
  const list = Array.isArray(comments) ? comments.filter(Boolean) : [];
  if (!hidden || hidden.size === 0) {
    return { shown: list, count: list.filter((c) => !isTombstone(c)).length };
  }

  const byId = new Map(list.map((c) => [c.id, c]));
  const children = new Map();
  for (const c of list) {
    if (!c.parentId) continue;
    if (!children.has(c.parentId)) children.set(c.parentId, []);
    children.get(c.parentId).push(c);
  }

  // A response sits in a thread that left when its top-level ancestor is by a hidden reader. A
  // chain that ends at a parent that is not here (an orphan, never drawn) is not in such a thread.
  const inLeftThread = (c) => {
    let cur = c;
    const seen = new Set([cur.id]);
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
      cur = byId.get(cur.parentId);
      seen.add(cur.id);
    }
    return !cur.parentId && byHidden(cur, hidden);
  };

  // Walk c's descendants (a cycle, which the data should never hold, ends the walk) and ask: does
  // any reply this reader can see hang beneath it? Is any reply beneath it by a hidden reader?
  const below = (c, pred) => {
    const seen = new Set([c.id]);
    const stack = [...(children.get(c.id) || [])];
    while (stack.length) {
      const k = stack.pop();
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      if (pred(k)) return true;
      stack.push(...(children.get(k.id) || []));
    }
    return false;
  };
  const visible = (k) => !isTombstone(k) && !byHidden(k, hidden);
  const own = (c) => {
    if (!c.parentId && byHidden(c, hidden)) return false;            // the whole thread leaves
    if (byHidden(c, hidden)) return below(c, visible);               // a stand-in, or gone
    if (isTombstone(c)) return !below(c, (k) => byHidden(k, hidden)) || below(c, visible);
    return true;
  };
  // Drawn: its own test passes and so does every ancestor's, so nothing in the list is left
  // hanging under a response that is not drawn.
  const drawn = (c) => {
    let cur = c;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      if (!own(cur)) return false;
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return true;
  };

  const shown = [];
  let count = 0;
  for (const c of list) {
    if (inLeftThread(c)) continue;
    if (!byHidden(c, hidden) && !isTombstone(c)) count += 1;
    if (!drawn(c)) continue;
    shown.push(byHidden(c, hidden)
      ? { id: c.id, parentId: c.parentId, createdAt: c.createdAt, hiddenByYou: true }
      : c);
  }
  return { shown, count };
}
