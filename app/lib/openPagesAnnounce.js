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
// 114 of them were past the horizon and unpinned. ⚠ THAT PARAGRAPH IS NOW OUT OF DATE
// AND IS CORRECTED RATHER THAN DELETED: R33.2 built the horizon for real
// (scripts/square/horizon.mjs on a GitHub Actions cron) and R43's round found the dead
// route it replaced still sitting in app/api/ and removed it. The horizon is NOT ARMED
// — the cron ships commented out, pending Ikenna — so an announcement written today
// still sits in the room indefinitely. The moment it is armed, announcements age out
// with everything else, which this record was always written to survive: short, dated
// by its own createdAt, and NEVER pinned, so it cannot grant itself permanence.

// R43 — the cap is IMPORTED now. This file used to declare its own `SQUARE_MAX =
// 500`, app/square/page.js declared its own, and database.rules.json held a third.
// Three copies that happened to agree is not one number.
import { MAX_POST_CHARS } from './squarePostBody.js';

/** The Square's own cap, from database.rules.json via the contract module. */
export const SQUARE_MAX = MAX_POST_CHARS;
export const ANNOUNCE_TITLE_MAX = 120;   // leaves room for the frame
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
// ⚠ R43 — THE URL CAME OUT OF THE BODY AND BECAME A CARD.
//
// This used to end `\n\n${SITE}/open-pages/${postId}`. Under Ikenna's no-links
// ruling (see app/lib/squarePostBody.js) that URL renders as DEAD TEXT — and the
// announcement's entire purpose is to send someone to the piece, so it would have
// posted an unreachable pointer into the room. The announcer has never fired, so
// nothing live was damaged; the first approved piece would have been the first
// broken one.
//
// The destination moved to `attachedOpenPage`, drawn by AttachmentCard — a link the
// HOUSE authored, rendered as a card, the same machinery attachedStory already uses
// on 15 of the 118 live posts. The ruling holds exactly: no reader link is ever
// rendered and the room gains no moderation surface.
//
// `postId` is still taken so the signature does not change under its callers, and
// because the id is what the card points at.
export function announcementText(title) {
  const t = String(title || '').trim();
  const short = t.length > ANNOUNCE_TITLE_MAX ? `${t.slice(0, ANNOUNCE_TITLE_MAX - 1)}…` : t;
  const text = `New on Open Pages — “${short}”`;
  // A belt-and-braces clamp: if the frame ever grows, the post is still legal
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
    text: announcementText(title),
    // ⚠ THE PIECE IS NOT SHAPED LIKE A STORY — no category, no cover guaranteed, and
    // the author is the writer rather than a byline field. attachmentOf() normalises
    // the two into the one shape AttachmentCard draws, so the card does not have to
    // learn about two record layouts.
    attachedOpenPage: { id: postId, title: String(title || '').trim() || 'Untitled', author: name },
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
