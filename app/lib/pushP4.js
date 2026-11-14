// P4-B1 — PERSONAL PUSHES: every number and every decision, as pure functions of (data, now).
//
// The drain (functions/api/push/drain.js) reads the database and calls Expo; everything it DECIDES
// is here, so tests/ci/p4-push.test.mjs can hand it a world and a clock and watch. The plan is
// docs/PUSH-P4.md (P4-R0, option d).
//
// THE SWITCHES. Rulings 365–369 were ruled yes on 14 Nov (docs/COPY-RULINGS.md); each is one
// constant below. Switch-on (docs/PUSH-P4.md, "Switch-on") flips FOUNDERS_ONLY and P4_ARMED, in one commit
// with CARD_LIVE in app/lib/notifySettings.js, the day the Worker's cron is added.
//
// Plain data and arithmetic, no network: the client, the Functions (bundled) and node --test all
// load it.

import { INBOX_KINDS, PUSH, PREFS, QUIET_HOURS, GROUPED_PUSH_INTERVAL_MS } from './notificationKinds.js';
import { FOUNDER_UIDS } from './founders.js';

// ── the switches ─────────────────────────────────────────────────────────────────────────────

/** Until switch-on, the drain sends only to the founders' own devices (P4-B1 item 9). */
export const FOUNDERS_ONLY = true;
/** Switch-on: the launch check expects the drain's heartbeat (scripts/launch-check.mjs). */
export const P4_ARMED = false;
/**
 * P4-B3: whether a call that queued a push (notify, /api/push/seen) sends it itself, at once. Only
 * once armed (the cron's own switch), and only where the drain could run at all: both its secrets
 * set, so a preview deployment, which has neither, never sends.
 */
export const sendsNow = (env, armed = P4_ARMED) => !!(armed && env?.PUSH_DRAIN_SECRET && env?.EXPO_ACCESS_TOKEN);
/** Ruling 365 (ruled 14 Nov): a push reads exactly as its row, quoted words included; a message names only the sender. false: titles only. */
export const PUSH_QUOTED_WORDS = true;

// ── the numbers ──────────────────────────────────────────────────────────────────────────────

/** Ruling 366 (ruled 14 Nov): at 08:00, at most this many waiting pushes per reader, oldest first. */
export const MORNING_CAP = 3;
/** Ruling 367 (ruled 14 Nov): a conversation pushes at once, then at most once in this long. */
export const CONVERSATION_INTERVAL_MS = 2 * 60 * 1000;
/** Ruling 369 (ruled 14 Nov): at most this many personal pushes per reader per London day. */
export const DAILY_CAP = 20;
/** Ruling 368 (ruled 14 Nov; the names are the app's): the Android channel each switch's pushes use. */
export const CHANNEL_FOR_PREF = Object.freeze({
  replies_mentions: 'people', messages: 'people', followers: 'people', reactions: 'people',
  responses: 'your_writing', open_pages: 'your_writing',
});
/** A chosen number: a push more than this long past when it should have gone is dropped, never sent late. */
export const STALE_MS = 2 * 60 * 60 * 1000;
/** A device row is eligible only when the app (A60) has written this capability or higher. */
export const PUSH_CAPS_MIN = 1;
/** The launch check turns red when the drain's last run is older than this (once P4_ARMED). */
export const DRAIN_STALE_MS = 5 * 60 * 1000;
/** One drain at a time: a run holds the lease this long. */
export const LEASE_MS = 55 * 1000;
/** Due entries one drain reads in one request (ordered by dueAt). */
export const QUEUE_READ_LIMIT = 200;
/** Expo's per-request message cap. */
export const EXPO_BATCH = 100;

/**
 * P4-B3 item 4: a badge-only push (the reader read their list somewhere; their phones' number
 * follows). Its queue entry is {uid}~_badge, its kind '_badge' (not an inbox kind: 'badge' is one).
 */
export const BADGE_KIND = '_badge';
export const BADGE_KEY = '_badge';
/** A chosen number: at most one badge-only push a minute per reader. The last read inside it wins. */
export const BADGE_INTERVAL_MS = 60 * 1000;

export const QUEUE = 'push_queue';
export const STATE = 'push_state';
export const DAY_KEY = '_day';
export const DRAIN_OPS = 'ops/push_drain';

const MIN = 60000;

// ── London's clock ───────────────────────────────────────────────────────────────────────────

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: QUIET_HOURS.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
/** { day: 'YYYY-MM-DD', hour, minute } on London's wall clock at `ms`. */
export function london(ms) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}
export const londonDay = (ms) => london(ms).day;
/** Ruling 311: 00:00 to 08:00 London. */
export const inQuietHours = (ms) => london(ms).hour >= QUIET_HOURS.from && london(ms).hour < QUIET_HOURS.to;

/** The instant London's wall clock reads `hour`:00 on London day `day` ('YYYY-MM-DD'). */
export function londonInstant(day, hour) {
  const [y, m, d] = day.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, hour);
  let t = target;
  // London is UTC or UTC+1; two corrections settle it on either side of a clock change.
  for (let i = 0; i < 2; i++) {
    const c = london(t);
    const [cy, cm, cd] = c.day.split('-').map(Number);
    t -= Date.UTC(cy, cm - 1, cd, c.hour, c.minute) - target;
  }
  return t;
}
/** The 08:00 London that ends the quiet hours `ms` falls in. */
export const morningAfter = (ms) => londonInstant(londonDay(ms), QUIET_HOURS.to);

// ── when ─────────────────────────────────────────────────────────────────────────────────────

/** The gap a kind keeps between two pushes of one group: an hour (310, 318), two minutes (367), or none. */
export function intervalFor(kind) {
  const k = INBOX_KINDS[kind];
  if (!k) return 0;
  if (kind === 'message') return CONVERSATION_INTERVAL_MS;
  return k.push === PUSH.GROUPED_HOURLY ? GROUPED_PUSH_INTERVAL_MS : 0;
}

/**
 * When a record's push is due. `at` is the record's newest event; `last` is what was pushed for it
 * before ({ pushedAt }), or nothing. The first push of a group goes at once (310 read so); a later
 * one waits for the interval. Anything due in the quiet hours waits for 08:00 (`held`).
 */
export function dueTime(kind, at, last = null) {
  const interval = intervalFor(kind);
  const base = interval && last?.pushedAt ? Math.max(at, last.pushedAt + interval) : at;
  return inQuietHours(base) ? { dueAt: morningAfter(base), held: true } : { dueAt: base, held: false };
}

// ── who ──────────────────────────────────────────────────────────────────────────────────────

/** The kinds that push one by one through the drain (not the list-only ones, the announcer or the Square's opt-in). */
export const pushesPersonally = (kind) => [PUSH.AT_ONCE, PUSH.GROUPED_HOURLY].includes(INBOX_KINDS[kind]?.push);

/**
 * Ruling 359 and 362: what a reader's switch reads. `prefs` is notify_prefs/{uid}; `legacy` is the
 * app's old fields on users/{uid}: { storyNotifications, mentionNotifications }.
 *   stories           on only when neither field is off (359)
 *   replies_mentions  notify_prefs's own value; without one, off when the old mention switch is off (362)
 *   the rest          notify_prefs's value, else the default
 */
export function prefOn(key, prefs, legacy = {}) {
  const own = prefs && typeof prefs === 'object' ? prefs[key] : undefined;
  if (key === 'stories') return own !== false && legacy?.storyNotifications !== false;
  if (typeof own === 'boolean') return own;
  if (key === 'replies_mentions' && legacy?.mentionNotifications === false) return false;
  return PREFS[key]?.default ?? false;
}
/** Whether `kind` may push to this reader: its switch, read as prefOn reads it. */
export function kindAllowed(kind, prefs, legacy) {
  const k = INBOX_KINDS[kind];
  if (!k || !pushesPersonally(kind) || !k.pref) return false;
  return prefOn(k.pref, prefs, legacy);
}
/** The writes a switch makes (359: the Stories switch sets both fields; the rest, notify_prefs only). */
export function prefWrites(uid, key, on) {
  const w = { [`notify_prefs/${uid}/${key}`]: on };
  if (key === 'stories') w[`users/${uid}/storyNotifications`] = on;
  return w;
}

export const isFounder = (uid) => FOUNDER_UIDS.includes(uid);

/**
 * The devices that speak for `uid`: one per token, and only where this account's row is that
 * token's NEWEST row across every account (a phone signed into a second account belongs to the
 * second), and only where the app has written pushCaps (A60). `tokens` is push_tokens.
 */
export function devicesFor(uid, tokens) {
  const newest = new Map();
  for (const [u, rows] of Object.entries(tokens || {})) {
    for (const [tokenKey, row] of Object.entries(rows || {})) {
      if (typeof row?.token !== 'string' || !row.token) continue;
      const at = Number(row.updatedAt) || 0;
      const prev = newest.get(row.token);
      if (!prev || at > prev.at) newest.set(row.token, { uid: u, tokenKey, at, row });
    }
  }
  return [...newest.values()]
    .filter((n) => n.uid === uid && Number(n.row.pushCaps) >= PUSH_CAPS_MIN)
    .map((n) => ({ uid, tokenKey: n.tokenKey, token: n.row.token, platform: n.row.platform }))
    .sort((a, b) => (a.token < b.token ? -1 : 1));
}
/** Every row holding one of `tokens` (a device Expo no longer knows comes off every account). */
export function rowsHolding(deadTokens, tokens) {
  const dead = new Set(deadTokens);
  const out = [];
  for (const [uid, rows] of Object.entries(tokens || {})) {
    for (const [tokenKey, row] of Object.entries(rows || {})) if (dead.has(row?.token)) out.push({ uid, tokenKey });
  }
  return out;
}

/** The uids a record names in its words: the actor, and a second only when the row names two (340). */
export function namedActors(record) {
  const recent = Array.isArray(record?.recent) ? record.recent : [];
  const first = record?.actor || recent[0] || null;
  const second = record?.actorCount === 2 && recent[1] && recent[1] !== first ? recent[1] : null;
  return [first, second].filter(Boolean);
}

// ── the decision ─────────────────────────────────────────────────────────────────────────────

/**
 * One queued entry, decided. Every input is already read. Returns
 *   { action: 'send', held, dueAt }  ·  { action: 'later', dueAt }  ·  { action: 'drop', reason }
 *
 * @param e        the queue entry { uid, rid, kind, at, dueAt }
 * @param record   inbox/{uid}/{rid}, or null
 * @param state    push_state/{uid} (per record: { pushedAt, recAt }; under DAY_KEY: { day, n, morning })
 * @param reader   { prefs, legacy, devices, muted, blocked, actorBlocks: {uid: their blocked list},
 *                   dmMuted: boolean }
 * @param counts   this run's running counts per uid { n, morning } (for the caps across one run)
 * @param opts     { foundersOnly } — tests only; production always reads FOUNDERS_ONLY
 */
export function decide(e, record, state, reader, now, counts = {}, { foundersOnly = FOUNDERS_ONLY } = {}) {
  if (!record || typeof record !== 'object') return { action: 'drop', reason: 'gone' };
  const kind = record.kind || e.kind;
  if (!pushesPersonally(kind)) return { action: 'drop', reason: 'not_pushed' };
  if (foundersOnly && !isFounder(e.uid)) return { action: 'drop', reason: 'founders_only' };
  if (!reader.devices?.length) return { action: 'drop', reason: 'no_device' };
  if (!kindAllowed(kind, reader.prefs, reader.legacy)) return { action: 'drop', reason: 'switched_off' };
  const last = state?.[e.rid] || null;
  const at = Number(record.at) || Number(e.at) || 0;
  if (last && Number(last.recAt) >= at) return { action: 'drop', reason: 'nothing_new' };
  const { dueAt, held } = dueTime(kind, at, last);
  if (dueAt > now) return { action: 'later', dueAt };
  if (now - dueAt > STALE_MS) return { action: 'drop', reason: 'stale' };
  // Re-checked at send time (319): a block either way, a mute, a muted conversation.
  for (const a of namedActors(record)) {
    if (reader.blocked?.[a] || reader.muted?.[a] || reader.actorBlocks?.[a]?.[e.uid]) return { action: 'drop', reason: 'silenced' };
  }
  if (kind === 'message' && reader.dmMuted) return { action: 'drop', reason: 'silenced' };
  const day = state?.[DAY_KEY]?.day === londonDay(now) ? state[DAY_KEY] : { n: 0, morning: 0 };
  const c = counts[e.uid] || { n: 0, morning: 0 };
  if ((day.n || 0) + c.n >= DAILY_CAP) return { action: 'drop', reason: 'daily_cap' };
  if (held && (day.morning || 0) + c.morning >= MORNING_CAP) return { action: 'drop', reason: 'morning_cap' };
  return { action: 'send', held, dueAt };
}

/**
 * A badge-only entry, decided: at most one a minute per reader (a later one waits for the minute,
 * and carries the count as it stands when it goes); none for a reader who has never opened a list.
 * Not held for the quiet hours: it shows nothing and makes no sound, it only clears a number.
 * Not one of the twenty a day.
 */
export function decideBadge(e, state, seenAt, now) {
  if (!(typeof seenAt === 'number' && seenAt > 0)) return { action: 'drop', reason: 'never_seen' };
  const last = Number(state?.[BADGE_KEY]?.pushedAt) || 0;
  if (last && now < last + BADGE_INTERVAL_MS) return { action: 'later', dueAt: last + BADGE_INTERVAL_MS };
  return { action: 'send' };
}

/** The day counter after `sent` pushes (of which `morning` were held for 08:00) went out today. */
export function nextDay(state, now, sent, morning) {
  const d = state?.[DAY_KEY]?.day === londonDay(now) ? state[DAY_KEY] : { n: 0, morning: 0 };
  return { day: londonDay(now), n: (d.n || 0) + sent, morning: (d.morning || 0) + morning };
}

/** A queue entry's key: the reader and the record, so a repeat event rewrites one entry. */
export const queueKey = (uid, rid) => `${uid}~${rid}`;

/**
 * Entries a run finished with carry { state, claimedFor: the `at` it handled }. A later run deletes
 * them, unless notify has rewritten the entry since (its `at` moved on), which makes it new.
 */
export const finishedWith = (entry) => !!(entry && entry.state && entry.claimedFor === entry.at);

export { MIN };
