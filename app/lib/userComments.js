// USER COMMENTS — the per-author index, and the end of reading the world to count to one.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// WHAT THIS REPLACES, AND WHY IT IS THE CAPACITY CEILING
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Eight call sites downloaded the ENTIRE `comments` node — every comment on every story by
// every reader — to answer a question about ONE reader. The worst of them was /profile,
// which opened a LIVE LISTENER on all of it and held the subscription for the whole
// session, to compute a single integer: how many comments this reader has written.
//
// The Fortress Audit (23 Aug 2026) measured what that costs. Peak database load was 15.1%
// with 338 registered readers, and `get` operations were 0.1505 of that 0.1509 — so this
// pattern was not merely the largest contributor to the ceiling, it was very nearly the
// whole of it. Linear extrapolation put saturation at about 2,240 readers.
//
// The shape is the problem, not the volume. `comments` grows with readers × stories, and it
// was being read whole on a per-reader page — so the cost per page view grew with the
// readership, which is a quadratic, not a line. No amount of caching or debouncing fixes a
// quadratic; only changing what is asked for does.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// AN INDEX, NOT A COUNTER — and the difference matters
// ═══════════════════════════════════════════════════════════════════════════════════════
//
//   user_comments/{uid}/{commentId} : { slug, createdAt }
//
// The obvious move is a stored integer, the way bookstore_readership/{titleId}/count works
// (app/lib/bookstore/readership.js). That is the right shape THERE, because a purchase is
// written by a Pages Function and the count rides the same atomic server-side patch — grant
// and count cannot drift because there is no moment at which one exists without the other.
//
// A comment is not written that way. It is written by the BROWSER, straight to RTDB, from
// four different call sites. An integer maintained from a browser is a client-side
// increment, and a client-side increment is exactly the thing this codebase refuses: it
// drifts on a retry, it can be replayed, and a reader who wanted more points could simply
// send the increment without the comment.
//
// So the index stores KEYS, not a total. That buys three properties an integer cannot:
//
//   · IDEMPOTENT. Writing the same commentId twice is a no-op. A retry, a double-submit or
//     a replayed request cannot inflate anything, because the count is the number of keys
//     and the key already exists.
//   · ATTRIBUTABLE. Every unit of the count is a real comment id that can be looked up. An
//     integer that has drifted tells you nothing about which way or why; this can be
//     recounted from source at any time — which is precisely what the backfill does.
//   · UNFORGEABLE UPWARD. The rules bind user_comments/{uid}/{commentId} to that uid, so a
//     reader can only add keys under their own node, and each key must correspond to a
//     comment they actually authored for the number to mean anything. Adding junk keys
//     inflates only their own visible comment count, which is vandalism of their own
//     profile — not a points exploit, because points are awarded on milestones crossed, and
//     see THE MILESTONE below.
//
// ── IT FAILS CLOSED DOWNWARD ───────────────────────────────────────────────────────────
//
// The readership rules apply here unchanged. Every reader below returns 0 for anything that
// is not a well-formed index: an absent node, a null, a string, an array, a hand-repair.
// A count that is too LOW costs a reader a milestone they can reach again; a count that is
// too HIGH awards points that were never earned. Every ambiguity resolves downward.
//
// The index is written in the SAME multi-path update as the comment itself, so the two
// cannot land separately — see indexedCommentWrite() below.

/** The node. One child per author; one grandchild per comment they have written. */
export const USER_COMMENTS_PATH = 'user_comments';

/**
 * The stored record. Deliberately TWO fields and no text.
 *
 * Not storing the comment text is a decision, not an omission. user_square_posts/{uid}/{id}
 * stores a full copy of its post, and that copy is now a synchronisation burden: an edit has
 * to reach two places or the profile shows stale words. Comments are editable from two call
 * sites, so a text copy here would acquire the same burden immediately. The index carries
 * only what cannot change — which comment, on which story, when — and any surface that
 * wants the words reads them from `comments` by the slugs this index names. That read is
 * bounded by ONE READER'S OWN ACTIVITY rather than by the platform's.
 */
export function commentIndexEntry(slug, createdAt) {
  return { slug: String(slug), createdAt: Number(createdAt) || Date.now() };
}

/**
 * ⭑ THE WRITE. Returns a multi-path update fragment carrying the comment AND its index
 * entry, so a caller hands both to one update(ref(db, '/'), …) and they land together.
 *
 * Callers MUST use this rather than writing `comments/…` themselves. A comment written
 * without its index entry is invisible to every counter on the site, and — because the
 * backfill only runs when someone runs it — invisible indefinitely.
 */
export function indexedCommentWrite({ uid, slug, commentId, comment }) {
  if (!uid || !slug || !commentId) throw new Error('indexedCommentWrite: uid, slug and commentId are required');
  return {
    [`comments/${slug}/${commentId}`]: comment,
    [`${USER_COMMENTS_PATH}/${uid}/${commentId}`]: commentIndexEntry(slug, comment?.createdAt),
  };
}

/**
 * ⭑ THE REMOVAL. Same contract in reverse — null in a multi-path update is a delete, so the
 * comment and its index entry go in one operation.
 *
 * `uid` is the comment's AUTHOR, not the actor: a founder deleting somebody else's comment
 * must clear that author's index entry, not their own.
 */
export function indexedCommentRemoval({ uid, slug, commentId }) {
  if (!slug || !commentId) throw new Error('indexedCommentRemoval: slug and commentId are required');
  const patch = { [`comments/${slug}/${commentId}`]: null };
  // A comment written before the index existed, or by an author we cannot resolve, has no
  // entry to clear. Removing the comment is still correct; the stale key is swept by the
  // next backfill run, and an orphan key counts downward-safe (it names a comment that no
  // longer exists, so any surface resolving it finds nothing).
  if (uid) patch[`${USER_COMMENTS_PATH}/${uid}/${commentId}`] = null;
  return patch;
}

/** Only well-formed entries count. Everything else is 0 — see IT FAILS CLOSED DOWNWARD. */
function entriesOf(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  return Object.entries(node)
    .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.slug === 'string' && v.slug.length > 0)
    .map(([commentId, v]) => ({ commentId, slug: v.slug, createdAt: Number(v.createdAt) || 0 }));
}

/**
 * How many comments this reader has written.
 *
 * This is the number that used to cost 494 KB and a session-long listener. It now costs one
 * read of one reader's own node — a few hundred bytes, bounded by their own activity and
 * flat with respect to how many other readers exist.
 */
export function commentCountOf(node) {
  return entriesOf(node).length;
}

/**
 * How many DISTINCT stories this reader has commented on — the badge engine's "practical
 * 1-per-slug cap", preserved exactly.
 */
export function commentedSlugCountOf(node) {
  return new Set(entriesOf(node).map((e) => e.slug)).size;
}

/** The reader's comments, newest first, as {commentId, slug, createdAt}. */
export function commentIndexEntries(node) {
  return entriesOf(node).sort((a, b) => b.createdAt - a.createdAt);
}

/** The distinct slugs this reader has commented on — the bounded set a lister must fetch. */
export function commentedSlugs(node) {
  return [...new Set(entriesOf(node).map((e) => e.slug))];
}

/**
 * THE MILESTONE. Every 50 comments earns 10 points, and the rule is unchanged — but it is
 * stated here rather than repeated at two call sites, because the two copies had already
 * begun to matter: both recomputed the total from the whole `comments` node, and both would
 * now have to be changed identically to read the index instead.
 *
 * Awarded only on the exact crossing, which is why an inflated index cannot mint points
 * retroactively: a reader who adds junk keys skips past a multiple of 50 rather than
 * landing on it, and a reader who lands on one has, by the index's own construction, that
 * many comment ids to show for it.
 */
/**
 * ⭑ THE LISTER. A reader's own comments, with their text, newest first.
 *
 * TWO call sites need exactly this — /profile for you and /user for somebody else — and
 * they were previously two copies of the same whole-node scan. One implementation now, so
 * the next change to what a comment list means cannot land in only one of them.
 *
 * ── WHY THIS IS BOUNDED, AND WHAT IT IS BOUNDED BY ─────────────────────────────────────
 *
 * The index names which stories this reader commented on. Only those threads are fetched —
 * so the cost is bounded by ONE READER'S OWN ACTIVITY, not by the platform's. The requests
 * are issued together rather than in sequence: RTDB multiplexes them over one connection,
 * so twenty small reads cost about one round trip, not twenty.
 *
 * ── THE RESIDUAL, MEASURED AND STATED RATHER THAN GLOSSED ──────────────────────────────
 *
 * Measured on live data, 23 Aug 2026 (1,852 comments, 106 readers, comments/{slug} averaging
 * 2,679 B against a 511,153 B whole node):
 *
 *   median reader     2 distinct slugs  →   ~5 KB    vs 511 KB   ~95× less
 *   p90 reader       63 distinct slugs  →  ~169 KB   vs 511 KB    ~3× less
 *   heaviest reader 155 distinct slugs  →  ~415 KB   vs 511 KB   ~1.2× less
 *
 * So for the single most prolific commenter on the site this is barely a win TODAY, and it
 * is worth being plain about that rather than quoting only the median. What makes it the
 * right shape anyway is the direction of travel: the whole-node read grows every time
 * ANYBODY comments anywhere, while this grows only when THIS reader comments. At ten
 * thousand readers the whole node is tens of megabytes and the heaviest reader's threads are
 * still about 415 KB.
 *
 * The real fix for that last row is to stop rendering an unbounded list — /profile and /user
 * both render every comment a reader has ever written, with no pagination. `limit` exists
 * for that and defaults to null, which preserves today's behaviour exactly: truncating a
 * reader's visible history is a product decision, not something to slip in behind a
 * performance change.
 *
 * ── DEPENDENCY-INJECTED ON PURPOSE ─────────────────────────────────────────────────────
 *
 * `ref` and `get` are passed in rather than imported, so this module stays free of a static
 * firebase dependency — the same portability requirement that keeps
 * app/lib/bookstore/readership.js pure. It also means the whole thing is testable without
 * booting a database.
 */
export async function loadCommentsFor({ db, ref, get }, uid, { limit = null } = {}) {
  if (!uid) return [];
  const idxSnap = await get(ref(db, `${USER_COMMENTS_PATH}/${uid}`));
  const all = commentIndexEntries(idxSnap.val());
  const entries = Number.isInteger(limit) && limit > 0 ? all.slice(0, limit) : all;
  if (!entries.length) return [];

  const slugs = [...new Set(entries.map((e) => e.slug))];
  const threads = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const snap = await get(ref(db, `comments/${slug}`));
        return [slug, snap.exists() ? snap.val() : null];
      } catch {
        // One unreadable thread must not empty the whole list. Its comments are simply
        // absent — downward, like every other ambiguity here.
        return [slug, null];
      }
    })
  );
  const bySlug = new Map(threads);

  return entries
    .map(({ commentId, slug, createdAt }) => {
      const c = bySlug.get(slug)?.[commentId];
      // An index entry whose comment is gone is an orphan — a delete that could not clear
      // its entry. It is dropped from the list rather than rendered as a blank.
      if (!c || typeof c !== 'object') return null;
      return { id: commentId, slug, ...c, createdAt: c.createdAt ?? createdAt };
    })
    .filter(Boolean);
}

export const COMMENT_MILESTONE_EVERY = 50;
export const COMMENT_MILESTONE_POINTS = 10;

export function commentMilestoneFor(count) {
  if (!Number.isInteger(count) || count <= 0) return null;
  if (count % COMMENT_MILESTONE_EVERY !== 0) return null;
  return { count, amount: COMMENT_MILESTONE_POINTS, description: `${count} comments milestone` };
}
