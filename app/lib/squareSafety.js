// W53 — MUTE AND BLOCK in the Square. The words and the decisions, as plain functions, so
// `node --test` can reach every one of them. The reading and writing is in
// app/components/square/useSafety.js; the card is app/components/square/ReaderCard.js.
//
// ⭑ TWO LISTS, BOTH THE READER'S OWN.
//   muted_users/{uid}/{otherUid} = true     W53, new. Only its owner reads or writes it.
//   dm_muted/{uid}/{convId} = true          W55.1. One conversation, muted: no unread count.
//   blocked_users/{uid}/{otherUid} = true   The list Open Pages comments already use. One list
//                                           everywhere (ruling 209): a block made there applies
//                                           here, and the reverse.
// The rules read both block lists to stop messages either way and notifications from a blocked
// reader (database.rules.json). Nothing publishes who blocked whom: the lists stay owner-only,
// so a blocked reader is never told why (ruling 208).
//
// ⭑ WHAT EACH ONE DOES FOR THE READER WHO SET IT.
//   Mute   their posts leave your feed, their replies are hidden in threads (ruling 207), their
//          notifications stop showing. Never messages. They aren't told.
//   Block  all of that, and no messages either way, and the rules refuse their notifications.

export const SAFETY_COPY = {
  mute: 'Mute in the Square',
  muteHint: 'Their posts stop showing for you. They won’t know.',
  unmute: 'Unmute',
  block: (h) => `Block @${h}`,
  blockHint: 'They can’t message you, and their posts leave your Square.',
  unblock: (h) => `Unblock @${h}`,
  message: 'Message',
  profile: 'Profile',
  hiddenReply: 'A reply you’ve hidden.',
  cantMessage: 'You can’t message this reader.',
  youBlocked: (h) => `You’ve blocked @${h}.`,
  reportMessage: 'Report a message',
  reportMessageHint: 'Pick the message. A moderator sees only that one.',
  reported: 'Reported. A moderator sees only this message.',
  // W55.1 — the conversation's menu (ruling 217) and the report step (220).
  viewProfile: 'View profile',
  muteConversation: 'Mute this conversation',
  unmuteConversation: 'Unmute this conversation',
  cancel: 'Cancel',
  reportHeading: 'The message a moderator will see',
};

/** The uids whose posts, replies and notifications this reader doesn't see. */
export function hiddenUids(muted, blocked) {
  return new Set([...Object.keys(muted || {}), ...Object.keys(blocked || {})]);
}

/**
 * When a reader joined, from their record. W55.1: joinDate first (what the profile page shows),
 * then createdAt; the card used to read createdAt alone, which many records don't carry. A value
 * that isn't a plausible millisecond time (a number, or a string Date can read) is passed over.
 */
export function joinedAt(rec) {
  for (const v of [rec?.joinDate, rec?.createdAt]) {
    let t = NaN;
    if (typeof v === 'number') t = v;
    else if (typeof v === 'string' && v.trim()) t = /^\d+$/.test(v.trim()) ? Number(v.trim()) : Date.parse(v);
    if (Number.isFinite(t) && t >= 1e11 && t <= 8.64e15) return t;
  }
  return null;
}

/** " · reading since October 2026", or nothing: no date, or one that can't be formatted. */
export function readingSince(rec) {
  const t = joinedAt(rec);
  if (t === null) return '';
  try {
    return ` · reading since ${new Date(t).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' })}`;
  } catch {
    return '';
  }
}

/**
 * W55.1 / ruling 218 — Mute this conversation. A muted conversation's unread count is never
 * shown or counted: not on its row, not in any total. Its messages still arrive and show.
 */
export function unreadShown(conv, mutedConvs) {
  if (!conv || (mutedConvs && mutedConvs[conv.convId] === true)) return 0;
  const n = Number(conv.unread);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The other reader in a conversation id ([a, b].sort().join('_')). */
export function otherInConversation(convId, me) {
  const [x, y] = String(convId || '').split('_');
  return x === me ? y : x;
}

/**
 * Was this write refused by the rules? Firebase rejects with PERMISSION_DENIED; a network failure
 * never says that. A refused message between two readers is the block (ruling 208).
 */
export function isPermissionDenied(err) {
  const s = `${err?.code || ''} ${err?.message || ''}`.toLowerCase();
  return s.includes('permission_denied') || s.includes('permission denied');
}
