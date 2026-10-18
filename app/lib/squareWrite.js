// THE SQUARE'S WRITE CONTRACT — W54.
//
// Posts, replies and edits from the web go through one server Function,
// functions/api/square/write.js, which enforces what the rules cannot: the hours (ruling 210),
// the pace (ruling 211), the server's clock and the author snapshot. This file is the PURE half —
// no clock, no network — so every decision can be tested at its edges, and the copy the web shows
// is the copy the server sends.
//
// ⚠ THE RULES ARE NOT TIGHTENED YET. Until A44 moves the app onto the Function, the app keeps
// writing square_posts directly and the rules still allow it. W55 closes the direct path once
// both clients use this. So for now this is the WEB's boundary, not the platform's.

import { refusalFor, slimAttachedStory } from './squarePostBody.js';

export const SQUARE_WRITE_ENDPOINT = '/api/square/write';

// Rulings 210 and 211, and the W54 brief's refusal for the hours.
export const SQUARE_WRITE_COPY = Object.freeze({
  closed: 'The Square opens at 8pm.',
  tooMuch: 'Too much at once. Try again in a minute.',
});

// ── The hours (ruling 210) ────────────────────────────────────────────────────────────────
//
// 20:00 to midnight London, with five minutes' grace after midnight for a sentence typed at
// 23:59. 00:05:00 is still inside; 00:05:01 is not. Founders are exempt (the server decides who
// is a founder; nothing here trusts the client).
//
// London, not UTC: the clock change on 25 Oct moves 20:00 London from 19:00 UTC to 20:00 UTC, and
// the doors move with it. Intl does the zone arithmetic (workerd ships full ICU).
export const OPENS_AT_S = 20 * 3600;
export const GRACE_S = 5 * 60;

export function londonSecondOfDay(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const n = (t) => Number(parts.find((p) => p.type === t)?.value || 0);
  return (n('hour') % 24) * 3600 + n('minute') * 60 + n('second');
}

export function withinHours(now) {
  const s = londonSecondOfDay(now);
  return s >= OPENS_AT_S || s <= GRACE_S;
}

// ── The pace (ruling 211) ─────────────────────────────────────────────────────────────────
//
// A sliding window, not a clock bucket: a bucket lets five posts land at 21:09 and five more at
// 21:10. The stored list is the reader's recent write times per kind, pruned to the window, so
// it can never hold more than the limit.
export const RATE_WINDOW_MS = 10 * 60 * 1000;
export const RATE_LIMITS = Object.freeze({ post: 5, reply: 30 });
export const RATE_NODE = 'square_rate';

/**
 * @param {{post?: number[], reply?: number[]}|null} stored  the reader's square_rate record
 * @param {'post'|'reply'} kind
 * @returns {{ok: boolean, next: {post: number[], reply: number[]}}}  `next` is what to store on ok
 */
export function evaluateRate(stored, kind, now) {
  const clean = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [])
    // ⚠ NO UPPER BOUND. A slot stamped a few ms "after" now was taken by a request whose clock
    // read later — another isolate, or the same burst. Dropping it as "future" let all six of six
    // simultaneous posts through on the emulator (W54). It still leaves the window on time.
    .filter((t) => typeof t === 'number' && Number.isFinite(t) && t > now - RATE_WINDOW_MS)
    .sort((a, b) => a - b);
  const next = { post: clean(stored?.post), reply: clean(stored?.reply) };
  if (next[kind].length >= RATE_LIMITS[kind]) return { ok: false, next };
  next[kind] = [...next[kind], now];
  return { ok: true, next };
}

// ── Edits ─────────────────────────────────────────────────────────────────────────────────
//
// Your own post or reply, within five minutes of when the SERVER says it was written, text only.
// The same window SquarePostMenu.js already uses to show Edit.
export const EDIT_WINDOW_MS = 5 * 60 * 1000;

export function editRefusal(record, uid, now) {
  if (!record || typeof record !== 'object') return { status: 404, code: 'missing', message: 'That post is no longer in the Square.' };
  if (record.authorUid !== uid) return { status: 403, code: 'not_yours', message: 'You can only edit your own posts.' };
  if (record.withdrawn === true) return { status: 409, code: 'withdrawn', message: 'That post was withdrawn.' };
  if (typeof record.createdAt !== 'number' || now - record.createdAt > EDIT_WINDOW_MS) {
    return { status: 409, code: 'edit_window', message: 'Posts can be edited for five minutes.' };
  }
  return null;
}

// ── The author snapshot ───────────────────────────────────────────────────────────────────
//
// From the VERIFIED account and users/{uid}, never from the request — the shape Open Pages'
// buildAuthorSnapshot uses, plus the badge's two fields. The name is the account's display name
// first, as the web wrote it before (user.displayName || 'Reader').
export function authorSnapshot(uid, account = {}, profile = {}) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const name = String(account?.displayName || p.displayName || 'Reader').slice(0, 128);
  const snap = {
    authorUid: uid,
    authorName: name,
    authorInitials: name.split(' ').map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || 'R',
    authorHandle: typeof p.username === 'string' ? p.username.slice(0, 32) : '',
    authorReadCount: typeof p.readCount === 'number' && p.readCount >= 0 ? p.readCount : 0,
    isAuthor: p.isAuthor === true,
  };
  if (typeof p.avatarUrl === 'string' && p.avatarUrl && p.avatarUrl.length <= 2048) snap.authorAvatarUrl = p.avatarUrl;
  return snap;
}

// ── The shapes ────────────────────────────────────────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const isPostId = (v) => typeof v === 'string' && ID_RE.test(v);

// The seven fields the rules allow under attachedStory, each at its rule's length, and only ever
// a house /stories/ address (the no-links ruling).
const STORY_CAPS = { title: 300, author: 128, cover: 2048, url: 256, id: 200, categoryName: 64, subcategory: 64 };
export function cleanAttachedStory(v) {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== 'object' || Array.isArray(v)) return { ok: false };
  const s = slimAttachedStory(v);
  if (!s || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s.id)) return { ok: false };
  for (const [k, max] of Object.entries(STORY_CAPS)) if (String(s[k] ?? '').length > max) return { ok: false };
  const out = {};
  for (const [k, val] of Object.entries(s)) if (val !== '') out[k] = val;
  return { ok: true, value: out };
}

// A poll is a moderator's (the web shows the creator only to canPin / canRemovePosts): a question
// (optional), two to six options, a closing time no more than a day away. Votes start empty.
export const POLL_MAX_OPTIONS = 6;
export const POLL_MAX_MS = 24 * 3600 * 1000;
export function cleanPoll(v, now) {
  if (v == null) return { ok: true, value: null };
  if (typeof v !== 'object' || Array.isArray(v)) return { ok: false };
  const question = typeof v.question === 'string' ? v.question.trim() : '';
  const options = Array.isArray(v.options) ? v.options.map((o) => (typeof o === 'string' ? o.trim() : '')).filter(Boolean) : [];
  if (question.length > 200 || options.length < 2 || options.length > POLL_MAX_OPTIONS || options.some((o) => o.length > 100)) return { ok: false };
  if (typeof v.closesAt !== 'number' || v.closesAt <= now || v.closesAt > now + POLL_MAX_MS) return { ok: false };
  return { ok: true, value: { question, options, closesAt: v.closesAt } };
}

const bad = (message = 'That couldn’t be posted.') => ({ ok: false, status: 400, code: 'invalid', message });

/**
 * The record a post or reply writes, or why not. `input` is the request body; only the fields
 * named here are read from it — author fields, createdAt and counts are never taken from a client.
 *
 * @param {'post'|'reply'} kind
 * @param {object} ctx  { snapshot, now, canPoll, root (the parent record, for a reply), replyTo }
 */
export function buildRecord(kind, input, { snapshot, now, canPoll = false, root = null, replyTo = null }) {
  const body = input && typeof input === 'object' ? input : {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const verdict = refusalFor(text, { isReply: kind === 'reply' });
  if (!verdict.ok) return bad(verdict.message);

  const record = { ...snapshot, text, createdAt: now, pinned: false };

  if (kind === 'post') {
    const story = cleanAttachedStory(body.attachedStory);
    if (!story.ok) return bad();
    if (story.value) record.attachedStory = story.value;
    if (body.quotedPostId != null) {
      if (!isPostId(body.quotedPostId)) return bad();
      record.quotedPostId = body.quotedPostId;
    }
    if (body.poll != null) {
      if (!canPoll) return { ok: false, status: 403, code: 'poll', message: 'Only moderators can post a poll.' };
      const poll = cleanPoll(body.poll, now);
      if (!poll.ok) return bad();
      record.poll = poll.value;
    }
    return { ok: true, record };
  }

  // A reply: parentId is the ROOT, always (squareThreads.js), and replyToId — if any — is another
  // reply in the same thread. The same conditions database.rules.json puts on replyToId.
  if (!isPostId(body.parentId) || !root || root.parentId) return { ok: false, status: 404, code: 'missing', message: 'That post is no longer in the Square.' };
  record.parentId = body.parentId;
  if (body.replyToId != null) {
    if (!isPostId(body.replyToId) || body.replyToId === body.parentId || !replyTo || replyTo.parentId !== body.parentId) return bad();
    record.replyToId = body.replyToId;
  }
  return { ok: true, record };
}

/** The edit's text, checked as the rules check it (an over-cap record may shrink, never grow). */
export function editText(input, record) {
  const text = typeof input?.text === 'string' ? input.text.trim() : '';
  const verdict = refusalFor(text, { isReply: !!record?.parentId, previousLength: String(record?.text ?? '').length });
  return verdict.ok ? { ok: true, text } : bad(verdict.message);
}

// ── The web's call ────────────────────────────────────────────────────────────────────────
//
// Resolves { id, record } once the Function has written; throws otherwise. The error carries
// `shown`: the Function's own words when the refusal is the hours or the pace (the two a reader
// can act on), and null for everything else — the failure states then say only "Not sent."
export const SHOWN_CODES = Object.freeze(['closed', 'rate']);

export async function sendSquareWrite(user, payload, { fetchImpl = (...a) => fetch(...a) } = {}) {
  if (!user) throw Object.assign(new Error('signed out'), { code: 'signed_out', shown: null });
  const token = await user.getIdToken();
  let res;
  try {
    res = await fetchImpl(SQUARE_WRITE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw Object.assign(new Error('network'), { code: 'network', shown: null });
  }
  const data = await res.json().catch(() => null);
  if (res.ok && data?.ok && typeof data.id === 'string' && data.record) return { id: data.id, record: data.record };
  const code = data?.code || `http_${res.status}`;
  throw Object.assign(new Error(code), { code, shown: SHOWN_CODES.includes(code) ? data.error : null, message: data?.error || code });
}
