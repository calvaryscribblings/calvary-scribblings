// P4-B1 — A PERSONAL PUSH READS EXACTLY AS ITS ROW (ruling 365, awaiting).
//
// The words are the bell's own: fromInbox makes the row, headline() its first line, secondLine() its
// second (app/lib/bell.js). Nothing here writes a word of its own, so a ruling on the bell's words
// (338–343) is a ruling on the push's. The title is the headline; the body is the second line; a row
// with no second line pushes its headline as the body alone. data.url is the row's href (360: the
// app opens any page it has no screen for inside itself).
//
// The story pushes' guard applies (App Store Review Guideline 3.1.1, scripts/push/lib.mjs): a second
// line carrying an amount, a purchase or the Book Store is dropped, and a headline carrying one
// refuses the push.
//
// The badge is the bell's own count too: unreadCount over buildList, from the inbox records and the
// shared story announcements newer than the reader's seenAt, without anyone they mute or block.

import { fromInbox, headline, secondLine, buildList, unreadCount } from './bell.js';
import { hiddenUids } from './squareSafety.js';
import { INBOX_KINDS } from './notificationKinds.js';
import { CHANNEL_FOR_PREF, PUSH_QUOTED_WORDS, namedActors } from './pushP4.js';
import { forbiddenIn, forbiddenInTitle } from '../../scripts/push/lib.mjs';

/** Where a row with no href of its own opens. */
export const FALLBACK_URL = '/notifications';
/** Quoted words longer than this are cut, as a lock screen would cut them anyway. */
export const QUOTE_MAX = 160;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The row an inbox record draws as, or null. */
export const rowFor = (rid, record) => fromInbox(rid, record);

/**
 * What the words need read, beyond the record: the names (first actor, and a second when two are
 * named, 340), a story's title, a response's words, a Square post's words, a piece's title.
 */
export function needs(row, record) {
  const out = { users: namedActors(record), story: null, quote: null, post: null, piece: null };
  if (!row) return out;
  out.story = row.needsTitle || row.needsStory || null;
  if (row.needsQuote && !row.quote) out.quote = row.needsQuote;
  if (row.needsPost && !row.quote) out.post = row.needsPost;
  if (row.needsPiece) out.piece = row.needsPiece;
  return out;
}

/**
 * The push for a row: { title?, body, url, channelId, dropped } or null when it must not go.
 * `details` holds what needs() asked for: { users: {uid: record|null}, stories: {slug: record},
 * quotes: {'slug/commentId': text}, posts: {id: {text, withdrawn, removedBy}}, pieces: {id: {title}} }.
 */
export function pushWords(row, details = {}) {
  if (!row) return null;
  const users = details.users || {};
  const text = clean(headline(row, users).map((p) => p.text ?? p.name ?? '').join(''));
  if (!text || forbiddenInTitle(text)) return null;
  const d = {
    story: (s) => details.stories?.[s] ?? null,
    quote: (s, c) => details.quotes?.[`${s}/${c}`] ?? null,
    post: (id) => details.posts?.[id] ?? null,
    piece: (id) => details.pieces?.[id] ?? null,
  };
  let line = secondLine(row, d);
  let dropped = null;
  if (line && line.quoted && !PUSH_QUOTED_WORDS) { line = null; dropped = 'quoted_words_off'; }
  if (line) {
    const hit = forbiddenIn(line.text);
    if (hit) { line = null; dropped = 'money_guard'; }
  }
  const lineText = line ? clean(line.text) : '';
  const pref = INBOX_KINDS[row.kind]?.pref;
  const base = { url: row.href || FALLBACK_URL, channelId: CHANNEL_FOR_PREF[pref] || 'people', dropped };
  if (!lineText) return { ...base, body: text };
  return { ...base, title: text, body: line.quoted ? `“${clip(lineText, QUOTE_MAX)}”` : lineText };
}

/**
 * The icon's number: the bell's unread count (305, 313, 326), or null when the reader has never
 * opened a list (no seenAt), so the push leaves the icon as it is rather than guess.
 */
export function badgeFor({ inbox = {}, announcements = {}, muted = {}, blocked = {}, seenAt = null }) {
  if (typeof seenAt !== 'number' || !(seenAt > 0)) return null;
  const list = buildList({ inbox, announcements }, { hidden: hiddenUids(muted, blocked) });
  return unreadCount(list, seenAt);
}
