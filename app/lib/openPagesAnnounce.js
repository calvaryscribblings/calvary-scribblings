// Open Pages → the Square (R38). Building the announcement, as a pure function.
//
// WHY THE SQUARE. It is the island's only daily habit — the room people come back to.
// A piece that publishes into silence reaches whoever happens to scroll the feed; a
// piece announced in the room reaches the people already here today.
//
// ⚠ IT IS POSTED BY THE SERVER, NEVER BY A CLIENT. The write happens inside
// functions/api/open-pages/moderate.js, in the SAME atomic PATCH that publishes the
// piece, using the author snapshot that function already rebuilds from users/{uid}
// with service credentials. Two consequences, both deliberate:
//   · The announcement cannot exist without the piece. The brief's constraint — "no
//     round may make the Square post before the piece is live" — is satisfied
//     structurally rather than by ordering two calls and hoping.
//   · It is attributed to the WRITER, from the same trustworthy snapshot the piece
//     carries. R33.1's impersonation attack is not reopened: the uid comes from the
//     verified token, never from the request body.
//
// ⚠ ONLY ON `published`. A flagged, pending, blocked or rate-limited submission never
// reaches this code, because it lives in the pass branch. Nothing unscreened is ever
// announced — that is the constraint the whole distribution round runs under.
//
// ⚠ THE HORIZON, MEASURED AND REPORTED RATHER THAN ASSUMED. The Square's stated
// horizon is two days (app/api/square-cleanup/route.js, TWO_DAYS). It has never run:
// measured on live 4 Sep 2026, the room holds 118 posts, the oldest 152 days old, and
// 114 of them are past the horizon and unpinned. That route is one of the stale Next
// Route Handlers CLAUDE.md names — `output: 'export'` means it is not in the deployed
// build, so there is nothing to execute it. So an announcement written today will sit
// in the room indefinitely, exactly like every other post. It is written to be
// horizon-SAFE anyway — short, dated by its own createdAt, never pinned — so that if
// the cleanup is ever made real, announcements age out with everything else.

/** The Square's own caps, from database.rules.json. A top-level post is 500. */
export const SQUARE_MAX = 500;
export const ANNOUNCE_TITLE_MAX = 120;   // leaves room for the URL and the frame
export const SITE = 'https://calvaryscribblings.co.uk';

/**
 * The text of the announcement.
 *
 * Deliberately NOT in the first person. The writer did not type this, so putting "I've
 * just published…" in their mouth would be words they did not write appearing under
 * their name — on a platform whose entire argument this round is that writing is taken
 * seriously. A plain announcement reads correctly whoever is credited with it.
 *
 * Truncation is on the TITLE only and is measured against the real cap, so a
 * 200-character title (the publish limit) cannot push the post past the Square's 500.
 */
export function announcementText(title, postId) {
  const t = String(title || '').trim();
  const short = t.length > ANNOUNCE_TITLE_MAX ? `${t.slice(0, ANNOUNCE_TITLE_MAX - 1)}…` : t;
  const text = `New on Open Pages — “${short}”\n\n${SITE}/open-pages/${postId}`;
  // A belt-and-braces clamp: if the URL shape ever grows, the post is still legal
  // rather than silently refused by the rules at the moment of publishing.
  return text.length <= SQUARE_MAX ? text : `${text.slice(0, SQUARE_MAX - 1)}…`;
}

/**
 * The full square_posts record. Field names and shapes match what app/square/page.js
 * writes, so an announcement renders identically to a human post — anything missing
 * shows up as a broken card rather than a styled one.
 *
 * @param {object} snapshot  buildAuthorSnapshot() output — the rebuilt, trustworthy one.
 * @param {object} profile   users/{uid}, for readCount and isAuthor.
 */
export function buildAnnouncement(snapshot, profile, { title, postId, now }) {
  const name = snapshot?.authorName || 'Reader';
  return {
    text: announcementText(title, postId),
    authorUid: snapshot?.authorUid || '',
    authorName: name,
    authorInitials: name.split(' ').map((n) => n[0]).filter(Boolean).join('').slice(0, 2).toUpperCase() || 'R',
    authorAvatarUrl: snapshot?.authorAvatarUrl || null,
    authorHandle: snapshot?.authorHandle || '',
    authorReadCount: Number(profile?.readCount) || 0,
    isAuthor: profile?.isAuthor === true,
    parentId: null,
    likeCount: 0,
    // NEVER pinned. Under the horizon a pin confers permanence (R33.2), and an
    // automated post must not be able to grant itself that.
    pinned: false,
    unpinnedAt: null,
    quotedPostId: null,
    attachedStory: null,
    createdAt: now,
  };
}
