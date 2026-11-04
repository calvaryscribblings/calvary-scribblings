// NOTIF-B2 — THE ONE LIST (rulings 305, 325, 326, 327), as data. Pure: no Firebase, no React.
//
// The bell, the panel, /notifications and the Square's bell all draw from what this file makes of
// four bounded reads (app/lib/useBell.js):
//
//   inbox/{uid}                    the new list, server-written (P1), newest N by `at`
//   announcements                  one shared item per new story or instalment (P3, ruling 308)
//   library_notifications/{uid}    the app's old Home bell, newest N by createdAt
//   notifications/{uid}            the app's old Square bell, newest N by createdAt
//
// EACH EVENT ONCE:
//   · an old note with `nid` is the server's mirror of an inbox record (for the app's old bells):
//     the inbox record is shown, the mirror never;
//   · an old `new_story` note is one follower's copy of an announcement: shown only when no
//     announcement for that story is in the list, and then once per story;
//   · an old `square_post` note is never shown (ruling 320);
//   · a note from a reader the viewer has blocked or muted is not shown, from any source.
//
// THE COUNT (ruling 326): what arrived after inbox_state/{uid}/seenAt. Opening the panel or the page
// sets seenAt to now. A reader with no seenAt yet: an old note counts while it is unread (its own
// `read` flag, which the old panels kept), anything new counts if it came after they joined.
//
// NAMES are never stored copies: an item names its sender by uid, and the row draws them live
// (identityOf). No sender at all is the house: "Calvary Scribblings". A sender with no profile is
// "Reader".

export const HOUSE_NAME = 'Calvary Scribblings';
export const NO_PROFILE_NAME = 'Reader';

/**
 * How many of each source the bell reads. Every read is bounded; nothing reads a whole node.
 * The inbox and the two old nodes read one more than the badge's ceiling (BADGE_CAP), so a count
 * past 99 always shows as "99+" and never stops short at the window's edge.
 */
export const READ_LIMITS = Object.freeze({ inbox: 100, announcements: 30, library: 100, square: 100, following: 1000 });
/** The panel's rows. */
export const PANEL_ROWS = 5;
/** The badge's ceiling: above it, "99+". */
export const BADGE_CAP = 99;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v) => (typeof v === 'string' && v ? v : null);

// ── the kinds, as the rows draw them ──────────────────────────────────────────────────────────
// badge: the 18px (16px in the panel) circle on the avatar. tile: a sender-less item drawn as a
// gold tile instead of an avatar.
export const BADGES = Object.freeze({
  heart: { ground: '#A92339', glyph: 'heart', ink: '#F6F1E7' },     // reactions
  violet: { ground: '#6E45C8', glyph: 'speech', ink: '#F6F1E7' },   // replies, mentions, responses
  slate: { ground: '#4A5578', glyph: 'envelope', ink: '#F6F1E7' },  // messages and follows
  gold: { ground: '#C9A84C', glyph: 'book', ink: '#14121C' },       // new stories
});

const LEGACY_REACTIONS = new Set(['heart', 'fire', 'clap', 'quill', 'like']);

/** The DRAFT words for each row (house style, rule 13; for Ikenna's review). `n` = others. */
export const WORDS = Object.freeze({
  reply_story: 'replied to your response',
  reply_square: 'replied to your post',
  reply_square_you: 'replied to you',
  reply_open_pages: 'replied to you on Open Pages',
  mention_story: 'mentioned you in a response',
  mention_square: 'mentioned you in the Square',
  quote: 'quoted your post',
  message_one: 'sent you a message',
  message_many: (count) => `sent you ${count} messages`,
  follow: 'started following you',
  reaction_response: 'liked your response',
  reaction_post: 'liked your post',
  story_reaction: 'liked your story',
  response: 'responded to your story',
  new_story: 'A new story by',
  new_instalment: 'A new instalment by',
  from_followed: 'FROM A WRITER YOU FOLLOW',
  badge: 'You earned a new badge',
  tier_up: 'You reached a new tier',
  open_pages_live: 'Your Open Pages piece is live',
  open_pages_declined: 'Your Open Pages piece was not published',
  square_opens: 'The Square is open',
  others: (n) => (n === 1 ? '1 other' : `${n} others`),
});

// ── normalising the four sources into rows ────────────────────────────────────────────────────

/**
 * One row: { key, source, kind, at, actor, actors, actorCount, count, badge, tile, verb, quote,
 * title, slug, href, cover, legacyRead, raw }.
 */
function row(over) {
  return { actor: null, actors: [], actorCount: 0, count: 1, badge: null, tile: null, verb: '', quote: null, title: null, slug: null, href: null, legacyRead: null, ...over };
}

// The story page has no per-response anchor yet, so a response row opens the story itself.
const storyHref = (slug) => (slug ? `/stories/${encodeURIComponent(slug)}` : null);
const threadHref = (rootId, replyId = null) => {
  if (!rootId) return null;
  const base = `/square/p?id=${encodeURIComponent(rootId)}`;
  return replyId && replyId !== rootId ? `${base}&reply=${encodeURIComponent(replyId)}` : base;
};

/** An inbox record (P1) as a row. Unknown kinds are dropped, never drawn as something else. */
export function fromInbox(id, r) {
  if (!isObj(r) || !str(r.kind)) return null;
  const s = isObj(r.subject) ? r.subject : {};
  const grouped = Array.isArray(r.recent);
  const actors = grouped ? r.recent.filter((u) => typeof u === 'string') : (str(r.actor) ? [r.actor] : []);
  const base = {
    key: `inbox:${id}`, source: 'inbox', kind: r.kind, at: num(r.at), actor: actors[0] || null, actors,
    actorCount: grouped ? Math.max(num(r.actorCount), actors.length) : (actors.length ? 1 : 0),
    count: grouped ? Math.max(1, num(r.count)) : 1, subject: s, raw: r,
  };
  const square = !!s.postId;
  switch (r.kind) {
    case 'reply':
      if (s.pieceId) return row({ ...base, badge: 'violet', verb: WORDS.reply_open_pages, href: `/open-pages/${encodeURIComponent(s.pieceId)}` });
      if (square) return row({ ...base, badge: 'violet', verb: s.to === 'you' ? WORDS.reply_square_you : WORDS.reply_square, href: threadHref(s.threadId, s.postId) });
      return row({ ...base, badge: 'violet', verb: WORDS.reply_story, slug: s.slug, href: storyHref(s.slug, s.commentId), needsQuote: s.slug && s.commentId ? { slug: s.slug, commentId: s.commentId } : null });
    case 'mention':
      if (square) return row({ ...base, badge: 'violet', verb: WORDS.mention_square, href: threadHref(s.threadId, s.postId) });
      return row({ ...base, badge: 'violet', verb: WORDS.mention_story, slug: s.slug, href: storyHref(s.slug, s.commentId), needsQuote: s.slug && s.commentId ? { slug: s.slug, commentId: s.commentId } : null });
    case 'quote':
      return row({ ...base, badge: 'violet', verb: WORDS.quote, href: threadHref(s.threadId, s.postId) });
    case 'message':
      return row({ ...base, badge: 'slate', verb: base.count > 1 ? WORDS.message_many(base.count) : WORDS.message_one, actorCount: Math.min(base.actorCount, 1), href: base.actor ? `/square?dm=${encodeURIComponent(base.actor)}` : '/square' });
    case 'follow':
      return row({ ...base, badge: 'slate', verb: WORDS.follow, href: base.actor ? `/user?id=${encodeURIComponent(base.actor)}` : null });
    case 'reaction':
      return row({ ...base, badge: 'heart', verb: square ? WORDS.reaction_post : WORDS.reaction_response, slug: s.slug || null, href: square ? threadHref(s.threadId, s.postId) : storyHref(s.slug, s.commentId) });
    case 'story_reaction':
      return row({ ...base, badge: 'heart', verb: WORDS.story_reaction, slug: s.slug, href: storyHref(s.slug), needsTitle: s.slug || null });
    case 'response':
      return row({ ...base, badge: 'violet', verb: WORDS.response, slug: s.slug, href: storyHref(s.slug), needsTitle: s.slug || null });
    case 'badge':
      return row({ ...base, actor: null, actors: [], tile: 'star', verb: WORDS.badge, href: '/profile' });
    case 'tier_up':
      return row({ ...base, actor: null, actors: [], tile: 'star', verb: WORDS.tier_up, href: '/profile' });
    case 'open_pages_live':
    case 'open_pages_declined':
      return row({ ...base, actor: null, actors: [], tile: 'feather', verb: WORDS[r.kind], href: s.pieceId ? `/open-pages/${encodeURIComponent(s.pieceId)}` : '/open-pages' });
    case 'square_opens':
      return row({ ...base, actor: null, actors: [], tile: 'diamond', verb: WORDS.square_opens, href: '/square' });
    default:
      return null;
  }
}

/** An announcement (P3) as a row. `followed` is the reader's following list. */
export function fromAnnouncement(id, a, followed) {
  if (!isObj(a) || !str(a.id) || (a.kind !== 'story' && a.kind !== 'instalment')) return null;
  const story = a.kind === 'story';
  return row({
    key: `ann:${id}`, source: 'announcement', kind: 'new_story', at: num(a.at),
    writer: str(a.authorUid), fromFollowed: !!(a.authorUid && followed?.[a.authorUid]),
    badge: 'gold', verb: story ? WORDS.new_story : WORDS.new_instalment,
    slug: story ? a.id : null, instalmentId: story ? null : a.id, seriesId: str(a.seriesId),
    href: story ? storyHref(a.id) : `/series/instalment/${encodeURIComponent(a.id)}`,
    needsStory: story ? a.id : null, needsInstalment: story ? null : { id: a.id, seriesId: str(a.seriesId) },
    raw: a,
  });
}

/** An old note (either old node) as a row, or null when the list must not show it. */
export function fromLegacy(node, id, n) {
  if (!isObj(n) || !str(n.type)) return null;
  if (str(n.nid)) return null;                 // the server's mirror: its inbox record is the row
  if (n.type === 'square_post') return null;   // ruling 320
  const from = str(n.fromUid);
  const base = {
    key: `${node === 'library_notifications' ? 'lib' : 'sq'}:${id}`, source: node, kind: n.type, at: num(n.createdAt),
    actor: from, actors: from ? [from] : [], actorCount: from ? 1 : 0, legacyRead: n.read === true, legacyId: id, raw: n,
    quote: str(n.commentText),
  };
  const square = node === 'notifications';
  const sqHref = n.postId ? (n.threadId ? threadHref(n.threadId, n.postId) : threadHref(n.postId)) : null;
  switch (n.type) {
    case 'reply':
      if (square && n.slug) return row({ ...base, badge: 'violet', verb: WORDS.reply_story, slug: n.slug, href: storyHref(n.slug) });
      if (square) return row({ ...base, badge: 'violet', verb: WORDS.reply_square, href: sqHref });
      return row({ ...base, badge: 'violet', verb: WORDS.reply_story, slug: str(n.slug), href: storyHref(n.slug, n.commentId) });
    case 'square_reply':
      return row({ ...base, badge: 'violet', verb: WORDS.reply_square, href: sqHref });
    case 'square_reply_to_you':
      return row({ ...base, badge: 'violet', verb: WORDS.reply_square_you, href: sqHref });
    case 'square_quote':
      return row({ ...base, badge: 'violet', verb: WORDS.quote, href: sqHref });
    case 'mention':
      return square
        ? row({ ...base, badge: 'violet', verb: WORDS.mention_square, href: sqHref })
        : row({ ...base, badge: 'violet', verb: WORDS.mention_story, slug: str(n.slug), href: storyHref(n.slug) });
    case 'open_pages_reply':
      return row({ ...base, badge: 'violet', verb: WORDS.reply_open_pages, href: n.postId ? `/open-pages/${encodeURIComponent(n.postId)}` : '/open-pages' });
    case 'follow':
      return row({ ...base, badge: 'slate', verb: WORDS.follow, href: from ? `/user?id=${encodeURIComponent(from)}` : null });
    case 'new_story': {
      const slug = str(n.storySlug) || str(n.slug);
      return row({ ...base, kind: 'new_story', badge: 'gold', verb: WORDS.new_story, writer: from, actor: null, actors: [], actorCount: 0, slug, title: str(n.storyTitle), href: storyHref(slug), needsStory: slug });
    }
    case 'reward':
      // The house's own note: never a stored name. The words are the reader's own milestone.
      return row({ ...base, actor: null, actors: [], actorCount: 0, house: true, verb: str(n.message) || 'You earned Scribbles', quote: null, href: '/profile' });
    default:
      if (LEGACY_REACTIONS.has(n.type)) {
        return square
          ? row({ ...base, kind: 'reaction', badge: 'heart', verb: n.slug ? WORDS.reaction_response : WORDS.reaction_post, href: n.slug ? storyHref(n.slug) : sqHref })
          : row({ ...base, kind: 'reaction', badge: 'heart', verb: WORDS.reaction_response, slug: str(n.slug), href: storyHref(n.slug, n.commentId) });
      }
      return null;
  }
}

// ── the list ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every source, merged, each event once, newest first.
 * @param src { inbox, announcements, library, square }: { id: record } each (already bounded)
 * @param opts { hidden: Set<uid>, followed: { uid: true } }
 */
export function buildList(src, { hidden = new Set(), followed = {} } = {}) {
  const out = [];
  const isHidden = (r) => r.actors.some((u) => hidden.has(u)) || (r.actor && hidden.has(r.actor));
  for (const [id, r] of Object.entries(src.inbox || {})) { const x = fromInbox(id, r); if (x) out.push(x); }
  const announced = new Set();
  for (const [id, a] of Object.entries(src.announcements || {})) {
    const x = fromAnnouncement(id, a, followed);
    if (!x) continue;
    if (x.writer && hidden.has(x.writer)) continue;
    announced.add(x.slug || `i:${x.instalmentId}`);
    out.push(x);
  }
  const legacyStories = new Set();
  for (const [node, list] of [['library_notifications', src.library], ['notifications', src.square]]) {
    for (const [id, n] of Object.entries(list || {})) {
      const x = fromLegacy(node, id, n);
      if (!x) continue;
      if (x.kind === 'new_story') {
        // One per story: the announcement if there is one, else the first old copy.
        if (!x.slug || announced.has(x.slug) || legacyStories.has(x.slug)) continue;
        legacyStories.add(x.slug);
        x.fromFollowed = true;   // an old copy only ever went to the writer's followers
        if (x.writer && hidden.has(x.writer)) continue;
      }
      out.push(x);
    }
  }
  return out.filter((r) => !isHidden(r)).sort((a, b) => b.at - a.at || (a.key < b.key ? -1 : 1));
}

/**
 * Is this row new to the reader? `seenAt` is inbox_state/{uid}/seenAt (null: never opened);
 * `joinedAt` is when their account was made (the floor for anything new before the first open).
 */
export function isUnread(r, seenAt, joinedAt = 0) {
  if (typeof seenAt === 'number' && seenAt > 0) return r.at > seenAt;
  if (r.legacyRead !== null && r.legacyRead !== undefined) return r.legacyRead === false;
  return r.at > num(joinedAt);
}

export const unreadCount = (list, seenAt, joinedAt) => list.reduce((n, r) => n + (isUnread(r, seenAt, joinedAt) ? 1 : 0), 0);

/** "99+" above the cap; null at zero (no badge). */
export function badgeText(n) {
  if (!n || n < 0) return null;
  return n > BADGE_CAP ? `${BADGE_CAP}+` : String(n);
}

export const ariaLabel = (n) => `Notifications, ${Math.max(0, n || 0)} unread`;

// ── time ──────────────────────────────────────────────────────────────────────────────────────

const LONDON = 'Europe/London';
const dayKey = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));

/** "now", "12m", "1h", "Mon", "28 Oct". */
export function timeLabel(at, now = Date.now()) {
  const d = Math.max(0, now - at);
  if (d < 60000) return 'now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  if (d < 7 * 86400000) return new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, weekday: 'short' }).format(new Date(at));
  return new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, day: 'numeric', month: 'short' }).format(new Date(at));
}

/** TODAY (London's calendar day), THIS WEEK (the six days before), EARLIER. */
export function sectionOf(at, now = Date.now()) {
  if (dayKey(at) === dayKey(now)) return 'TODAY';
  if (now - at < 7 * 86400000) return 'THIS WEEK';
  return 'EARLIER';
}

export function sections(list, now = Date.now()) {
  const order = ['TODAY', 'THIS WEEK', 'EARLIER'];
  const by = { TODAY: [], 'THIS WEEK': [], EARLIER: [] };
  for (const r of list) by[sectionOf(r.at, now)].push(r);
  return order.filter((k) => by[k].length).map((k) => ({ label: k, rows: by[k] }));
}

// ── the words of a row ────────────────────────────────────────────────────────────────────────

/**
 * The display name for a uid, live: their name, else "Reader". `null` uid: the house. A profile
 * still being read (`undefined` in `users`) draws a quiet placeholder, never "Reader": a reader
 * whose record simply hasn't arrived must not be misnamed, even for a moment.
 */
export const LOADING_NAME = '\u2026';
export function nameOf(uid, users) {
  if (!uid) return HOUSE_NAME;
  const u = users?.[uid];
  if (u === undefined) return LOADING_NAME;
  const n = u && (u.displayName || u.handle || u.username);
  return (typeof n === 'string' && n.trim()) ? n : NO_PROFILE_NAME;
}

/**
 * The first line as parts: [{ name }, { text }]. Grouped: "Ada Obi and 4 others liked your response".
 * New stories: "A new story by {writer}".
 */
export function headline(r, users) {
  if (r.kind === 'new_story') return [{ text: `${r.verb} ` }, { name: nameOf(r.writer, users) }];
  if (r.house || (!r.actor && !r.tile)) return [{ name: HOUSE_NAME }, { text: ` ${r.verb}` }];
  if (r.tile) return [{ text: r.verb }];
  const first = nameOf(r.actor, users);
  const others = Math.max(0, (r.actorCount || 1) - 1);
  return others > 0
    ? [{ name: first }, { text: ` and ${WORDS.others(others)} ${r.verb}` }]
    : [{ name: first }, { text: ` ${r.verb}` }];
}
