// PUSH — the pure half. No network, no credentials, no clock of its own.
//
// Every decision the announcer makes is a function here of (data, now), so the suite can hand
// it a corpus and watch what it decides — the same split as scripts/reconcile-index.mjs, and
// for the same reason: a sender that finds nothing to send on a quiet day is indistinguishable
// from one that cannot see, and most days are quiet.
//
// ── WHAT "BECOMES VISIBLE" MEANS, TRACED ─────────────────────────────────────────────────
//
// A STORY (cms_stories/{slug}) is visible to readers when
//     published !== false  AND  publishAt is absent or not in the future.
// That is isIndexed() from app/lib/storyIndex.js plus the publishAt future-gate every
// listing applies on the client. The four ways a record gets there:
//   · published now from the CMS — saved published:true, no publishAt.
//   · scheduled — saved published:false + a future publishAt; the calvary-newsletter
//     Worker flips published:true when the time comes. Nothing in this repo writes at
//     that moment, which is why this is a scan and not a hook.
//   · held for its cover — saved published:false + coverHold:true; covers.yml publishes it
//     in the same patch that gives it a cover.
//   · un-hidden — an editor's Unhide on a story that was hidden.
// And the ways it stops being visible: Hide (published:false), delete.
//
// AN INSTALMENT (series_instalments/{id}) is visible when
//     status === 'published'  AND  releaseAtMs <= now  AND  its series' status === 'published'.
// isReleased() from app/lib/series/access.js plus the parent check the /series pages make.
// Release is CLOCK-DRIVEN: nothing writes at releaseAtMs, so again only a scan can see it.
//
// ── ONCE PER ITEM, EVER ──────────────────────────────────────────────────────────────────
//
// The announced set (push_announced/{kind}/{id}) is the whole memory. An item is due when it
// is visible and has no entry there — so an edit never re-sends (the entry exists), a draft
// or a hidden story never sends (not visible), and a story hidden then un-hidden does not
// send twice. Nothing about the record's CONTENT is consulted to decide whether it is new.

import { formFor } from './forms.mjs';

export const KINDS = ['story', 'instalment'];

export const EXPO_BATCH = 100;                       // Expo's per-request message cap
export const RECEIPT_BATCH = 1000;                   // Expo's per-request receipt-id cap
export const RECEIPT_MIN_AGE_MS = 15 * 60 * 1000;    // Expo: receipts are ready ~15 min later
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // Expo keeps receipts for 24 h
export const TOKEN_STALE_MS = 60 * 24 * 60 * 60 * 1000;
// A mass diff is a missing seed or a broken predicate, never a busy afternoon: the busiest
// day in the last 30 published two items. Refuse and let a human read the plan.
export const DEFAULT_MAX_PER_RUN = 5;
// A scheduled story whose publishAt passed less than this long ago but is still
// published:false is the Worker about to flip it — pending, not hidden. See planSeed().
export const SCHEDULE_GRACE_MS = 60 * 60 * 1000;

// ── WHEN, AND HOW MANY (RULED, Ikenna, 25 Sep 2026) ─────────────────────────────────────
//
// NOTHING BEFORE 08:00 LONDON. An item that goes live earlier is held, and goes out on the
// first run at or after 08:00 London; an item that goes live later goes at once. London, not
// UTC: the hold is 07:00Z in summer and 08:00Z in winter, and the offset comes from the tz
// database via Intl, never from a hard-coded hour.
//
// AT MOST TWO PER READER PER LONDON DAY. Every reader with notifications on gets every
// announcement, so "per reader" is "per day": the day's count is what push_announced records as
// sent (or partly sent) since London midnight. A third that day is NOT SENT — it is recorded
// as `capped`, and like every entry that means never. It is not carried to tomorrow, where it
// would take a slot from tomorrow's own stories.
export const LONDON = 'Europe/London';
export const QUIET_UNTIL_HOUR = 8;
export const DAILY_CAP = 2;

const londonFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
/** { day: 'YYYY-MM-DD', hour: 0–23 } on London's wall clock at `ms`. */
export function londonClock(ms) {
  const p = Object.fromEntries(londonFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}
export const londonDay = (ms) => londonClock(ms).day;
export const isQuietHour = (now) => londonClock(now).hour < QUIET_UNTIL_HOUR;

/** How many items went out (in whole or part) on the London day that contains `now`. */
export function sentOnLondonDay(announced, now) {
  const today = londonDay(now);
  let n = 0;
  for (const kind of KINDS) {
    for (const e of Object.values(announced?.[kind] || {})) {
      if ((e?.state === 'sent' || e?.state === 'partial') && typeof e.sentAt === 'number' && londonDay(e.sentAt) === today) n++;
    }
  }
  return n;
}

/**
 * Of the items ready to send (built, not refused, oldest first), which go now.
 *   before 08:00 London → { send: [], held: all }        — they go on the 08:00 run
 *   otherwise           → the first (DAILY_CAP − sent today) go; the rest are `capped`
 */
export function planSendWindow(ready, announced, now) {
  if (isQuietHour(now)) return { send: [], held: ready.slice(), capped: [], sentToday: sentOnLondonDay(announced, now) };
  const sentToday = sentOnLondonDay(announced, now);
  const room = Math.max(0, DAILY_CAP - sentToday);
  return { send: ready.slice(0, room), held: [], capped: ready.slice(room), sentToday };
}

const parseMs = (iso) => {
  const t = typeof iso === 'string' && iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

export function isStoryVisible(story, now) {
  if (!story || story.published === false) return false;
  const at = parseMs(story.publishAt);
  return !(at !== null && at > now);
}

export function isInstalmentVisible(row, series, now) {
  if (!row || row.status !== 'published') return false;
  if (typeof row.releaseAtMs !== 'number' || !Number.isFinite(row.releaseAtMs)) return false;
  if (row.releaseAtMs > now) return false;
  return !!series && series.status === 'published';
}

/**
 * Everything visible and not yet announced, oldest first.
 *
 * `announced` is { story: { slug: entry }, instalment: { id: entry } } — any entry at all,
 * in any state, means "never again".
 */
export function planAnnouncements({ stories = {}, instalments = {}, series = {}, announced = {} }, now) {
  const due = [];
  const seen = (kind, id) => !!announced?.[kind]?.[id];
  for (const [slug, s] of Object.entries(stories || {})) {
    if (!isStoryVisible(s, now) || seen('story', slug)) continue;
    due.push({ kind: 'story', id: slug, visibleSince: parseMs(s.publishAt) ?? s.publishedAtMs ?? 0 });
  }
  for (const [id, row] of Object.entries(instalments || {})) {
    if (!isInstalmentVisible(row, series?.[row?.seriesId], now) || seen('instalment', id)) continue;
    due.push({ kind: 'instalment', id, visibleSince: row.releaseAtMs });
  }
  return due.sort((a, b) => (a.visibleSince - b.visibleSince) || a.id.localeCompare(b.id));
}

/**
 * THE SEED. Which items to mark announced BEFORE the job's first real run.
 *
 * Without it the first run finds 183 visible stories and 4 released instalments with no
 * entry, and notifies every reader about the entire back catalogue.
 *
 * It marks MORE than what is visible, on purpose. The only items it leaves unmarked are the
 * ones provably on their way IN — a future schedule, a cover hold, a draft instalment, a
 * future release. Everything else is marked, visible or not, because a story that is hidden
 * today was, in this CMS, almost certainly live once: a new story saves published:true unless
 * it is scheduled or held (app/admin/page.js), so published:false with neither is Hide. If
 * the seed skipped those, the day an editor un-hid one it would go out as "new".
 */
export function planSeed({ stories = {}, instalments = {}, series = {}, announced = {} }, now) {
  const mark = [], pending = [];
  for (const [slug, s] of Object.entries(stories || {})) {
    if (announced?.story?.[slug]) continue;
    const at = parseMs(s?.publishAt);
    const onItsWay = s?.published === false
      && (s.coverHold === true || (at !== null && at > now - SCHEDULE_GRACE_MS));
    (onItsWay ? pending : mark).push({ kind: 'story', id: slug });
  }
  for (const [id, row] of Object.entries(instalments || {})) {
    if (announced?.instalment?.[id]) continue;
    const parent = series?.[row?.seriesId];
    const onItsWay = row?.status === 'draft'
      || (row?.status === 'published' && !(row.releaseAtMs <= now))
      || (row?.status === 'published' && parent?.status === 'draft');
    (onItsWay ? pending : mark).push({ kind: 'instalment', id });
  }
  return { mark, pending };
}

// ── THE PAYLOAD ─────────────────────────────────────────────────────────────────────────
//
// RULED (Ikenna): title = the story's title. body = "New {form} by {author} · {trailer quote}",
// BYLINE FIRST, because a collapsed Android notification shows one line and the byline is what
// a reader decides on. No quote → the body ends at the byline; never an invented line.
// data.url = the item's path. NO images. The {form} phrases are ./forms.mjs, ruled as drafted.
//
// RULED (25 Sep): an instalment's title = the SERIES name; body = "{part} by {author} · {logline}",
// where {part} is the instalment's own title — "Part Three", "Chapter I: It's Monday Again" —
// naming the part as the series names it.
//
// SOUND (RULED): the phone's default sound, on both platforms. iOS plays it from `sound`.
// Android 8+ ignores `sound` and plays whatever the CHANNEL says, so every push names one
// channel: "stories", which the app creates ("New stories", default importance) before it
// registers a token (app A12, baa3c1a). No build ever created a channel called "default", so a
// push naming "default" lands on expo's unconfigured fallback channel. See docs/PUSH-GO-LIVE.md.
export const PUSH_SOUND = 'default';
export const ANDROID_CHANNEL_ID = 'stories';
const DELIVERY = { sound: PUSH_SOUND, channelId: ANDROID_CHANNEL_ID };

// NEVER, in any push: a price, a purchase, or the Book Store — App Store Review Guideline
// 3.1.1. Only story and instalment paths may be the destination. The guard below is
// deliberately blunt: it cannot tell "₦2,200 and one egg" in a logline from a price, so a
// quote or logline that trips it is DROPPED (the body ends at the byline, which is the ruled
// no-quote shape) and a title that trips it refuses the item outright.

// Two lists. The STRICT one runs over a quote, a logline and the finished body, where the
// cost of a false hit is only that the tail is dropped. The TITLE list is narrower: a title is
// ruled content, and refusing "Bought and Sold" or "The Price of Silence" over a word would
// cost a story its announcement — so a title is refused only for an actual amount, the Book
// Store, or the word purchase.
const TITLE_FORBIDDEN = [
  /[£$€₦]\s?\d/,                                          // a currency amount
  /\d\s?(naira|pounds?|dollars?|euros?|NGN|GBP|USD|EUR)\b/i,
  /\bpurchas\w*/i,
  /\bbook\s?-?(store|shop)\b/i,
];
const FORBIDDEN = [
  ...TITLE_FORBIDDEN,
  /\b(buy|buying|bought|price[sd]?|pricing)\b/i,
];
const firstHit = (list, text) => {
  const t = String(text || '');
  for (const re of list) { const m = re.exec(t); if (m) return m[0]; }
  return null;
};
export const forbiddenIn = (text) => firstHit(FORBIDDEN, text);
export const forbiddenInTitle = (text) => firstHit(TITLE_FORBIDDEN, text);

const URL_OK = /^\/(stories\/[A-Za-z0-9_-]+|series\/instalment\/[A-Za-z0-9_-]+)$/;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** "New {form} by {author}" — or "New {form}" when there is genuinely no author. */
function byline(form, author) {
  const a = clean(author);
  return a ? `New ${form} by ${a}` : `New ${form}`;
}

function withTail(head, tail) {
  const t = clean(tail);
  if (!t) return { body: head, dropped: null };
  const hit = forbiddenIn(t);
  if (hit) return { body: head, dropped: hit };
  return { body: `${head} · ${t}`, dropped: null };
}

export function storyMessage(slug, story) {
  const s = story || {};
  const title = clean(s.title);
  if (!title) return { refused: 'no title' };
  const titleHit = forbiddenInTitle(title);
  if (titleHit) return { refused: `title carries "${titleHit}"` };
  const head = byline(formFor(s.category, s.subcategory), s.author);
  const headHit = forbiddenIn(head);
  if (headHit) return { refused: `byline carries "${headHit}"` };
  const { body, dropped } = withTail(head, s.trailerQuote);
  const msg = { title, body, data: { url: `/stories/${slug}` }, ...DELIVERY };
  assertSafe(msg);
  return { message: msg, dropped };
}

/** "{series}" / "{part} by {author} · {logline}". */
export function instalmentMessage(id, row, detail, series) {
  const d = detail || {};
  const part = clean(d.title);
  if (!part) return { refused: 'no instalment title' };
  const title = clean(series?.title);
  if (!title) return { refused: 'no series title' };
  const titleHit = forbiddenInTitle(title);
  if (titleHit) return { refused: `series title carries "${titleHit}"` };
  const partHit = forbiddenInTitle(part);
  if (partHit) return { refused: `part title carries "${partHit}"` };
  const a = clean(d.author);
  const head = a ? `${part} by ${a}` : part;
  const headHit = forbiddenIn(head);
  if (headHit) return { refused: `byline carries "${headHit}"` };
  const { body, dropped } = withTail(head, d.logline);
  const msg = { title, body, data: { url: `/series/instalment/${id}` }, ...DELIVERY };
  assertSafe(msg);
  return { message: msg, dropped };
}

/** The last gate before anything leaves. Throws — a push that fails this is a bug, not a skip. */
export function assertSafe(msg) {
  const keys = Object.keys(msg).sort().join(',');
  if (keys !== 'body,channelId,data,sound,title') throw new Error(`push payload has unexpected keys: ${keys}`);
  if (msg.sound !== PUSH_SOUND || msg.channelId !== ANDROID_CHANNEL_ID) throw new Error('push sound/channel is not the ruled default');
  if (Object.keys(msg.data).join(',') !== 'url') throw new Error('push data carries more than url');
  if (!URL_OK.test(msg.data.url)) throw new Error(`push url is not a story or instalment: ${msg.data.url}`);
  const titleHit = forbiddenInTitle(msg.title);
  if (titleHit) throw new Error(`push title carries forbidden "${titleHit}"`);
  // The body is the byline plus a tail already screened; screening the whole of it again
  // catches an AUTHOR or SERIES name that would slip a forbidden term in by the side door.
  const bodyHit = forbiddenIn(msg.body);
  if (bodyHit) throw new Error(`push body carries forbidden "${bodyHit}"`);
  if (msg.data.url.startsWith('/stories/') && !msg.body.startsWith('New ')) throw new Error('push body must open on the byline');
  return true;
}

// ── THE AUDIENCE ────────────────────────────────────────────────────────────────────────

/**
 * Every live token whose owner has not switched story notifications off (absent = on).
 *
 * `tokens` is push_tokens: { uid: { tokenKey: { token, platform, appVersion, updatedAt } } }.
 * `prefs` is { uid: storyNotifications } for the uids that hold tokens.
 *
 * ONE DEVICE, ONE NOTIFICATION. A phone that signed out of A and into B carries the same
 * token under both uids; only the most recently refreshed row speaks for the device, and its
 * owner's preference is the one that applies. Otherwise a reader who switched off would still
 * be notified through the account they used last month.
 */
export function buildAudience(tokens, prefs, now) {
  const stale = [];
  const byToken = new Map();
  for (const [uid, rows] of Object.entries(tokens || {})) {
    for (const [tokenKey, row] of Object.entries(rows || {})) {
      const updatedAt = typeof row?.updatedAt === 'number' ? row.updatedAt : 0;
      if (now - updatedAt > TOKEN_STALE_MS) { stale.push({ uid, tokenKey }); continue; }
      if (typeof row?.token !== 'string' || !row.token) continue;
      const prev = byToken.get(row.token);
      if (!prev || updatedAt > prev.updatedAt) byToken.set(row.token, { uid, tokenKey, token: row.token, updatedAt });
    }
  }
  const recipients = [];
  let optedOut = 0;
  for (const r of byToken.values()) {
    if (prefs?.[r.uid] === false) { optedOut++; continue; }
    recipients.push({ uid: r.uid, tokenKey: r.tokenKey, token: r.token });
  }
  recipients.sort((a, b) => a.token.localeCompare(b.token));
  return { recipients, stale, optedOut };
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Expo messages for one item, one per recipient, in batches of EXPO_BATCH. */
export function messagesFor(message, recipients) {
  assertSafe(message);
  return chunk(recipients.map((r) => ({ to: r.token, ...message })), EXPO_BATCH);
}

// ── TICKETS, RECEIPTS, PRUNING ──────────────────────────────────────────────────────────

const isDead = (x) => x?.details?.error === 'DeviceNotRegistered';

/**
 * Expo answers a send with one ticket per message, IN ORDER. An ok ticket has an id whose
 * receipt is fetched later; an error ticket is final now.
 */
export function planTickets(tickets, batchRecipients, meta = {}) {
  const pending = [], dead = [], errors = [];
  (tickets || []).forEach((t, i) => {
    const r = batchRecipients[i];
    if (!r) return;
    if (t?.status === 'ok' && t.id) pending.push({ ticketId: t.id, uid: r.uid, tokenKey: r.tokenKey, ...meta });
    else if (isDead(t)) dead.push({ uid: r.uid, tokenKey: r.tokenKey });
    else errors.push({ uid: r.uid, tokenKey: r.tokenKey, error: t?.details?.error || t?.message || 'unknown' });
  });
  return { pending, dead, errors };
}

/**
 * `stored` is push_receipts: { ticketId: { uid, tokenKey, at, ... } }.
 * Returns which ticket ids to ask about now, and — given Expo's answer — what to do.
 */
export function receiptsToFetch(stored, now) {
  return Object.entries(stored || {})
    .filter(([, r]) => now - (r?.at || 0) >= RECEIPT_MIN_AGE_MS)
    .map(([id]) => id);
}

export function planReceipts(stored, answers, asked, now) {
  const clear = [], dead = [], errors = [];
  let ok = 0;
  for (const id of asked) {
    const rec = stored?.[id];
    const ans = answers?.[id];
    if (!ans) {
      // Not ready, or already expired at Expo. Keep asking until Expo's own retention ends.
      if (now - (rec?.at || 0) > RECEIPT_MAX_AGE_MS) clear.push(id);
      continue;
    }
    clear.push(id);
    if (ans.status === 'ok') { ok++; continue; }
    if (isDead(ans) && rec) dead.push({ uid: rec.uid, tokenKey: rec.tokenKey });
    else errors.push({ ticketId: id, error: ans?.details?.error || ans?.message || 'unknown' });
  }
  return { clear, dead, errors, ok };
}
