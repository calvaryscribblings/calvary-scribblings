// W52 — THE SQUARE'S THREADS. The shape of a thread, decided once, for the thread page, the feed's
// latest-reply line, the notifications and the tests.
//
// Plain functions, no JSX and no Firebase, so `node --test` can import every one of them.
//
// ⭑ THE DATA. A reply is a square_posts record whose parentId is the ROOT, always, at every depth.
// That is what the horizon moves by (scripts/square/horizon.mjs groups on parentId), and why a
// thread never splits between the room and the archive. W52 adds one optional field:
//
//   replyToId   the reply being answered: a reply in the same thread, never the root.
//               (database.rules.json, square_posts/$postId/replyToId)
//
// A reply without replyToId is a top-level reply. That includes every reply the app writes before
// A42, so an old client's reply simply lands at the top level of the thread.
//
// ⭑ TWO LEVELS, WHATEVER THE DEPTH. A reply to a reply sits one level in, under its TOP-LEVEL
// ancestor, however long the chain above it. It says who it answers ("Replying to @handle"), so
// nothing is lost by flattening the depth, and a phone never runs out of width.
//
// ⭑ NEVER HARD-DELETED. Withdrawing or removing a reply writes a tombstone: withdrawn: true plus
// removedBy ('author' | 'moderator'), and the words go. A tombstone is drawn only while replies
// hang beneath it. A legacy withdrawn record with no removedBy reads as the author's.

export const NESTED_SHOWN = 2;

export const THREAD_COPY = {
  back: 'Back to the Square',
  heading: 'Replies',
  removedByModerator: 'This reply was removed.',
  removedByAuthor: 'The author withdrew this reply.',
  replyingTo: (handle) => `Replying to @${handle}`,
  viewMore: (n) => (n === 1 ? 'View 1 more reply' : `View ${n} more replies`),
  hiddenReply: 'A reply you\u2019ve hidden.',   // ruling 207: a muted or blocked reader's reply
  notSent: 'Not sent.',
  tryAgain: 'Try again',
  remove: 'Remove',
};

// Ruling 30's account-deletion tombstone and W52's withdrawn tombstone. Both keep the record and
// drop the person's words; both are drawn only with replies beneath.
export const isRemoved = (r) => !!r && (r.withdrawn === true || r.deleted === true);

export function removedNote(r) {
  return r?.removedBy === 'moderator' ? THREAD_COPY.removedByModerator : THREAD_COPY.removedByAuthor;
}

const byTime = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id));

/**
 * The top-level ancestor of a reply: follow replyToId up until a reply with none. A replyToId that
 * names nothing in this thread (a reply hard-deleted before W52) ends the walk there, and so does
 * a cycle, which the rules cannot produce but historical data is not owed our assumptions.
 */
export function topAncestorOf(reply, byId) {
  let cur = reply;
  const seen = new Set([cur.id]);
  while (cur.replyToId && byId.has(cur.replyToId) && !seen.has(cur.replyToId)) {
    cur = byId.get(cur.replyToId);
    seen.add(cur.id);
  }
  return cur;
}

// W53 / ruling 207 — a reply by a reader you've muted or blocked is hidden like a removed one:
// it leaves the thread unless replies you can see hang beneath it, and then it is drawn as
// "A reply you've hidden." It never counts.
export const isHiddenBy = (hidden, r) => !!(hidden && r && !isRemoved(r) && hidden.has(r.authorUid));

/**
 * Build a thread from its root's replies.
 *
 * @param {Array}  replies  every record with parentId === root.id (any order)
 * @param {object} opts
 * @param {Set}    opts.hidden  uids this reader has muted or blocked (W53)
 * @returns {{ groups: Array<{ top, nested: Array }>, count: number, byId: Map }}
 *   groups   top-level replies oldest first, each with its nested replies oldest first. A removed
 *            reply is left out unless a reply that is not left out hangs beneath it.
 *   count    replies that are not removed: what the heading, the feed and the badge show.
 */
export function buildThread(replies, { hidden = null } = {}) {
  const list = [...(replies || [])].filter(Boolean).sort(byTime);
  const byId = new Map(list.map((r) => [r.id, r]));

  // Which removed (or hidden) replies have a living reply somewhere beneath them? Walk every
  // living reply's chain upward and mark what it passes. A tombstone with only tombstones (or
  // hidden replies) beneath is not drawn.
  const gone = (r) => isRemoved(r) || isHiddenBy(hidden, r);
  const holdsUp = new Set();
  for (const r of list) {
    if (gone(r)) continue;
    const seen = new Set([r.id]);
    let cur = r;
    while (cur.replyToId && byId.has(cur.replyToId) && !seen.has(cur.replyToId)) {
      cur = byId.get(cur.replyToId);
      seen.add(cur.id);
      holdsUp.add(cur.id);
    }
  }
  const drawn = (r) => !gone(r) || holdsUp.has(r.id);

  const groups = [];
  const groupOf = new Map();
  for (const r of list) {
    const top = topAncestorOf(r, byId);
    if (top.id === r.id) {
      if (!drawn(r)) continue;
      const g = { top: r, nested: [] };
      groups.push(g);
      groupOf.set(r.id, g);
    }
  }
  for (const r of list) {
    const top = topAncestorOf(r, byId);
    if (top.id === r.id || !drawn(r)) continue;
    const g = groupOf.get(top.id);
    if (g) g.nested.push(r);
  }
  return { groups, count: list.filter((r) => !gone(r)).length, byId };
}

/**
 * The fold. A group shows its first NESTED_SHOWN nested replies and "View N more replies" for the
 * rest — except a reply the reader has just sent, which stays visible wherever it falls, so a
 * reader never sends a reply and watches it vanish behind a fold.
 *
 * @param {Array}   nested    the group's nested replies, oldest first
 * @param {object}  opts
 * @param {boolean} opts.expanded   the reader pressed "View N more replies"
 * @param {Set}     opts.keep       ids that must stay visible (the reader's own, just sent)
 * @returns {{ shown: Array, hidden: number }}
 */
export function foldNested(nested, { expanded = false, keep = new Set() } = {}) {
  if (expanded || nested.length <= NESTED_SHOWN) return { shown: nested, hidden: 0 };
  const shown = nested.filter((r, i) => i < NESTED_SHOWN || keep.has(r.id));
  return { shown, hidden: nested.length - shown.length };
}

/** The latest living reply in a thread, for the feed's one line under a post. */
export function latestReply(replies, hidden = null) {
  let best = null;
  for (const r of replies || []) {
    if (!r || isRemoved(r) || isHiddenBy(hidden, r)) continue;
    if (!best || byTime(r, best) > 0) best = r;
  }
  return best;
}

/**
 * Who a new reply notifies, and with which words. The root's author hears "replied to your post";
 * the author of the reply being answered hears "replied to you". Never the same person twice,
 * never yourself. Mentions come after and skip anyone already told.
 *
 * @returns {Array<{ uid, type }>}  type is 'square_reply' or 'square_reply_to_you' or 'mention'
 */
export function replyNotifications({ me, rootAuthorUid, replyToAuthorUid = null, mentionedUids = [] }) {
  const out = [];
  const told = new Set([me]);
  const tell = (uid, type) => { if (uid && !told.has(uid)) { told.add(uid); out.push({ uid, type }); } };
  // "replied to you" is the nearer fact, so it wins when the two authors are one person.
  tell(replyToAuthorUid, 'square_reply_to_you');
  tell(rootAuthorUid, 'square_reply');
  for (const uid of mentionedUids) tell(uid, 'mention');
  return out;
}

export const NOTIFICATION_WORDS = {
  square_reply: ' replied to your post',
  square_reply_to_you: ' replied to you',
};

/** The thread's address, opening at a reply where there is one. */
export function threadHref(rootId, replyId = null) {
  if (!rootId) return null;
  const base = `/square/p?id=${encodeURIComponent(rootId)}`;
  return replyId && replyId !== rootId ? `${base}&reply=${encodeURIComponent(replyId)}` : base;
}

/** Where a Square post record (a root or a reply) opens: its thread, at itself. */
export const postHref = (p) => (p ? threadHref(p.parentId || p.id, p.parentId ? p.id : null) : null);

/**
 * Where a notification opens, if it is about the Square. Story notifications carry a slug and
 * Open Pages replies their own type; everything else with a postId came from the Square. Older
 * notifications carry only postId (sometimes a reply's id): /square/p resolves a reply to its
 * root and opens at it, so they land in the right place too.
 */
export function squareNotificationHref(n) {
  if (!n || n.slug || n.type === 'open_pages_reply' || !n.postId) return null;
  return n.threadId ? threadHref(n.threadId, n.postId) : threadHref(n.postId);
}
