// NOTIF-B1 — EVERY KIND OF NOTIFICATION, IN ONE PLACE.
//
// Two halves, one file, so the rules, the Function and the tests all read the same list.
//
//   1. LEGACY_KINDS (P0, the stopgap). The two inboxes clients write today, library_notifications
//      and notifications, accept a FIXED list of `type`s. database.rules.json carries the list as
//      a regex; tests/rules/notif-b1.test.mjs fails if the two differ by a kind.
//
//   2. INBOX_KINDS (P1, the server writer). inbox/{uid}/{id} is written only by
//      functions/api/_notify.js. Each kind records, as data, which Settings switch governs its push
//      (notify_prefs/{uid}) and how it pushes. Sending is P4: nothing here sends anything yet.
//
// Plain data, no imports, so the client, the Functions (bundled) and node --test all load it.

// ── 1. THE STOPGAP: the two old inboxes ───────────────────────────────────────────────────────
//
// Drafted on 3 Nov 2026 from a counts-only read of production (every type present, with its last
// date) and from every writer in this repo. `source` says where each kind is known from:
//   web   a writer in this repo writes it today
//   prod  present in production
//   app   present in production with fields only the app writes (fromHandle, storyTitle,
//         fromAvatarUrl on a story notification), or never written by the web at all
//
// ⚠ THE APP'S HALF IS UNCONFIRMED. The app repo cannot be seen from this one. The app session is
// answering which kinds it writes, and whether a refused notification would sink the write it
// rides with. Until it answers, every kind production holds is on the list, so no kind the app
// has ever written is refused. A kind the app writes that production has never seen would be.
export const LEGACY_KINDS = {
  library_notifications: {
    heart: 'web+prod+app — a reaction on your response',
    fire: 'web+prod+app — a reaction on your response',
    clap: 'web+prod — a reaction on your response (none since May 2026)',
    quill: 'prod, app only — a reaction on your response; the web never writes it',
    reply: 'web+prod+app — a reply to your response',
    mention: 'web+prod+app — an @mention in a response',
    follow: 'web+prod+app — a new follower',
    new_story: 'web (CMS) + reconciler + prod — FOUNDERS OR THE OWNER ONLY',
    reward: 'web+prod — your own milestone (Scribbles) — FOUNDERS OR THE OWNER ONLY',
  },
  notifications: {
    like: 'web+prod — a reaction on your Square post',
    clap: 'web+prod — a reaction on your Square post',
    fire: 'web+prod — a reaction on your Square post',
    heart: 'prod — a reaction on your Square post (none since Apr 2026)',
    reply: 'prod — an older Square reply (none since 17 Oct 2026)',
    mention: 'web+prod — an @mention in the Square',
    square_post: 'web+prod — follower fan-out (ruling 320 retires it in a later stage)',
    square_quote: 'web+prod — your post was quoted',
    square_reply: 'web+prod — a reply to your post',
    square_reply_to_you: 'web — a reply to your reply (none in production yet)',
    open_pages_reply: 'web+prod — a reply to your Open Pages comment',
    follow: 'drawn by the Square panel; no writer seen — kept for the app (unconfirmed)',
    new_story: 'drawn by the Square panel; no writer seen — FOUNDERS OR THE OWNER ONLY',
    reward: 'drawn by the Square panel; no writer seen — FOUNDERS OR THE OWNER ONLY',
  },
};

/** Only a founder, or the inbox's owner writing to themselves, may write these (P0). */
export const FOUNDER_OR_OWNER_KINDS = Object.freeze(['reward', 'new_story']);

/** The `type` pattern the rules carry for `node`, exactly as it appears in database.rules.json. */
export function legacyKindPattern(node) {
  const kinds = Object.keys(LEGACY_KINDS[node] || {});
  if (!kinds.length) throw new Error(`legacyKindPattern: unknown node ${node}`);
  return `/^(${kinds.join('|')})$/`;
}

// ── 2. THE SERVER WRITER: inbox/{uid}/{id} ────────────────────────────────────────────────────

/** How a kind pushes (rulings 308–311, 318, 321). Recorded now; sending is P4. */
export const PUSH = Object.freeze({
  AT_ONCE: 'at_once',               // ruling 311: at once, but held 00:00–08:00 London, then together at 08:00
  GROUPED_HOURLY: 'grouped_hourly', // rulings 310, 318: one grouped line, at most once an hour per post / story
  LIST_ONLY: 'list_only',           // rulings 309, 321: never pushes
  OPT_IN: 'opt_in',                 // the Square opening: off unless the reader turns it on
  ANNOUNCER: 'announcer',           // ruling 308: the existing push-announce job, under docs/PUSH-GO-LIVE.md
});

/** Ruling 311's quiet hours, London time. A push due inside them waits until `to`. */
export const QUIET_HOURS = Object.freeze({ from: 0, to: 8, timeZone: 'Europe/London' });
/** Rulings 310 and 318: a grouped line pushes at most once in this long, per post or story. */
export const GROUPED_PUSH_INTERVAL_MS = 60 * 60 * 1000;
/** At most this many readers are told about one post's or response's @mentions. */
export const MENTION_CAP = 6;
/** A grouped record keeps the latest few actors, for "Ada and 4 others". Uids only, never names. */
export const RECENT_ACTORS = 3;
/** A grouped record counts distinct actors in a map this large; beyond it, the count still grows. */
export const ACTOR_SET_CAP = 200;

/**
 * Ruling 312: one push switch per kind, in Settings. notify_prefs/{uid}/{key} = boolean, owner only.
 * An absent key means its default. The list always shows everything; these only govern push.
 */
export const PREFS = Object.freeze({
  stories: { label: 'New stories and instalments', default: true },
  replies_mentions: { label: 'Replies and mentions', default: true },
  messages: { label: 'Messages', default: true },
  followers: { label: 'New followers', default: true },
  reactions: { label: 'Reactions', default: true },
  responses: { label: 'Responses on your stories', default: true },
  open_pages: { label: 'Your Open Pages pieces', default: true },
  square_opens: { label: 'When the Square opens', default: false },
});

/** Whether `kind` may push to a reader whose switches are `prefs` (notify_prefs/{uid}, or null). */
export function pushAllowed(kind, prefs) {
  const k = INBOX_KINDS[kind];
  if (!k || k.push === PUSH.LIST_ONLY || !k.pref) return false;
  const v = prefs && typeof prefs === 'object' ? prefs[k.pref] : undefined;
  return typeof v === 'boolean' ? v : PREFS[k.pref].default;
}

/**
 * Every kind the server writer knows. `group` names what a grouped record collects under (one
 * record per recipient per group, updated in place); null means one record per event.
 * `written` says which stage writes it: P1 = /api/notify today; later stages are recorded so the
 * catalogue is complete, and nothing writes them yet.
 */
export const INBOX_KINDS = Object.freeze({
  reply: { pref: 'replies_mentions', push: PUSH.AT_ONCE, group: null, written: 'P1', ruling: '306, 311' },
  mention: { pref: 'replies_mentions', push: PUSH.AT_ONCE, group: null, written: 'P1', ruling: '306, 311' },
  quote: { pref: 'replies_mentions', push: PUSH.AT_ONCE, group: null, written: 'P1', ruling: '306, 311' },
  message: { pref: 'messages', push: PUSH.AT_ONCE, group: 'conversation', written: 'P1', ruling: '306, 311' },
  follow: { pref: 'followers', push: PUSH.AT_ONCE, group: 'follower', written: 'P1', ruling: '306, 311' },
  reaction: { pref: 'reactions', push: PUSH.GROUPED_HOURLY, group: 'post', written: 'P1', ruling: '306, 310' },
  response: { pref: 'responses', push: PUSH.GROUPED_HOURLY, group: 'story', written: 'P1', ruling: '307, 318' },
  story_reaction: { pref: 'reactions', push: PUSH.GROUPED_HOURLY, group: 'story', written: 'P1', ruling: '307, 310' },
  new_story: { pref: 'stories', push: PUSH.ANNOUNCER, group: null, written: 'P3 (one shared record, no fan-out)', ruling: '308, 323' },
  badge: { pref: null, push: PUSH.LIST_ONLY, group: null, written: 'P7', ruling: '309' },
  tier_up: { pref: null, push: PUSH.LIST_ONLY, group: null, written: 'P7', ruling: '309' },
  reward: { pref: null, push: PUSH.LIST_ONLY, group: null, written: 'P7', ruling: '309' },
  open_pages_live: { pref: 'open_pages', push: PUSH.AT_ONCE, group: null, written: 'P7', ruling: '309' },
  open_pages_declined: { pref: null, push: PUSH.LIST_ONLY, group: null, written: 'P7', ruling: '321' },
  square_opens: { pref: 'square_opens', push: PUSH.OPT_IN, group: null, written: 'P7', ruling: '199' },
});
