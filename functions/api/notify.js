// NOTIF-B1 (P1) — POST /api/notify { event, subjectId }
//
//   credential:  Authorization: Bearer <Firebase ID token>   (the header only)
//   → 200 { ok: true }                    whoever was told, or nobody (the caller is never told which)
//   → 400 bad_request · 401 signed_out · 403 not_yours · 404 missing · 502/503 unavailable
//
// The client names WHAT happened, never WHO hears. The server reads the event, checks that its
// author is the caller, and works out the recipients itself. Records go through
// functions/api/_notify.js (blocks both ways, the recipient's mute, grouping, the budget).
//
//   event              subjectId                            who is told
//   comment            {slug}/{commentId}                   the parent's author (reply), up to 6
//                                                           @mentions, the story's writer (response,
//                                                           grouped per story, ruling 307)
//   comment_reaction   {slug}/{commentId}/{type}            the response's author (grouped per response)
//   story_reaction     {slug}/{type}                        the story's writer (grouped per story, 307)
//   follow             {targetUid}                          the reader followed
//   square_post        {postId}                             a reply: the author replied to, the thread's
//                                                           author; a quote: the quoted author; up to 6
//                                                           @mentions. Never followers (ruling 320).
//   square_reaction    {postId}/{type}                      the post's author (grouped per post)
//   message            {convId}/{messageId}                 the other participant (grouped per conversation)
//   open_pages_reply   {pieceId}/{commentPath}              the author of the comment replied to
//
// NOTIF-B2: every web writer calls this after its event lands (app/lib/notifyClient.js), and no
// longer writes the old inboxes itself. The app still does, until it reads inbox/ (P5). So that an
// app reader keeps everything they had, this also writes the old note the web used to write, in
// the old shape, to library_notifications or notifications (functions/api/_notify.js, THE APP'S
// TWO OLD BELLS). Messages, responses on your story and story reactions never had an old note.
//
// LOGGING: codes and counts only.

import { lookupUser, mintAccessToken, SCOPES } from './bookstore/_lib.js';
import { deliver, notifyDb, newBudget, recordId } from './_notify.js';
import { SUBREQUEST_BUDGET } from './_budget.js';
import { isId } from '../../app/lib/ids.js';
import { INDEX_PATH } from '../../app/lib/storyIndex.js';
import { mentionHandles } from '../../app/lib/squareHandles.js';
import { MENTION_CAP } from '../../app/lib/notificationKinds.js';

const LABEL = 'notify';
const PUSH_ID = /^-?[A-Za-z0-9_-]{1,64}$/;
const isKey = (v) => typeof v === 'string' && PUSH_ID.test(v);
const COMMENT_REACTIONS = new Set(['heart', 'fire', 'clap', 'quill']);
const SQUARE_REACTIONS = new Set(['like', 'clap', 'fire', 'heart']);
const STORY_REACTIONS_RE = /^[a-z_]{1,32}$/;
/** An Open Pages comment path: {commentId}(/replies/{replyId})*, at most 8 deep. */
const OP_PATH_RE = /^[A-Za-z0-9_-]{1,64}(?:\/replies\/[A-Za-z0-9_-]{1,64}){1,8}$/;

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const fail = (code, status) => reply({ ok: false, code }, status);

class Refusal extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }
const refuse = (code, status) => { throw new Refusal(code, status); };
const live = (rec) => rec && typeof rec === 'object' && rec.deleted !== true && rec.withdrawn !== true;
const clip = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);

// The old notes (NOTIF-B2). `lib` goes to the app's Home bell (library_notifications), `sq` to its
// Square bell (notifications). The sender's fields are added once per call from their LIVE record
// (withSender), so a server-written old note can't carry a name the sender typed into it.
const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const lib = (record) => ({ node: 'library_notifications', record: drop(record) });
const sq = (record) => ({ node: 'notifications', record: drop(record) });

/** The sender, as the old notes carried them, from users/{uid}: the one extra read a call makes. */
export function senderFields(uid, user, node) {
  const u = user && typeof user === 'object' ? user : {};
  const handle = clip(u.username || u.handle, 64);
  const name = clip(u.displayName || u.handle || u.username, 128) || 'Reader';
  const avatar = clip(u.avatarUrl || u.photoURL, 512);
  return drop(node === 'notifications'
    ? { fromUid: uid, fromName: name, fromUsername: handle, fromHandle: handle, fromAvatarUrl: avatar }
    : { fromUid: uid, fromName: name, fromHandle: handle, fromAvatarUrl: avatar });
}
const uidOrNull = (v) => (isId('uid', v) ? v : null);

/** Up to MENTION_CAP handles in `text`, resolved through the usernames index. */
async function mentioned(db, text) {
  const handles = mentionHandles(text).filter((h) => /^[a-z0-9_]{1,30}$/.test(h)).slice(0, MENTION_CAP);
  const uids = await Promise.all(handles.map((h) => db.get(`usernames/${h}`)));
  return uids.map(uidOrNull).filter(Boolean);
}

// ── the events ────────────────────────────────────────────────────────────────────────────────
// Each returns the recipients, nearest fact first. Each refuses with not_yours unless the record it
// reads was written by `uid`, and with missing when that record is not there.

const EVENTS = {
  async comment(db, uid, parts) {
    const [slug, commentId] = parts;
    if (parts.length !== 2 || !isId('slug', slug) || !isKey(commentId)) refuse('bad_request', 400);
    const c = await db.get(`comments/${slug}/${commentId}`);
    if (!live(c)) refuse('missing', 404);
    if (c.authorUid !== uid) refuse('not_yours', 403);
    const parentId = isKey(c.parentId) ? c.parentId : null;
    const [story, parent, mentions] = await Promise.all([
      db.get(`${INDEX_PATH}/${slug}`),
      parentId ? db.get(`comments/${slug}/${parentId}`) : null,
      mentioned(db, c.text),
    ]);
    const writer = story?.authorUid;
    const storyTitle = clip(story?.title, 200);
    const subject = { slug, commentId, ...(parentId ? { parentId } : {}) };
    return [
      // The old notes, as the story page wrote them: a reply names the response replied to and
      // quotes it; a mention quotes the new words.
      parent?.authorUid && { uid: uidOrNull(parent.authorUid), kind: 'reply', subject, id: recordId('reply', slug, commentId),
        legacy: lib({ type: 'reply', slug, commentId: parentId, commentText: clip(parent.text, 120), storyTitle }) },
      ...mentions.map((m) => ({ uid: m, kind: 'mention', subject, id: recordId('mention', slug, commentId),
        legacy: lib({ type: 'mention', slug, commentText: clip(c.text, 140), storyTitle }) })),
      // Responses on your story are new (ruling 307): there was never an old note for them.
      writer && { uid: uidOrNull(writer), kind: 'response', subject: { slug }, group: recordId('response', slug), eventKey: commentId },
    ];
  },

  async comment_reaction(db, uid, parts) {
    const [slug, commentId, type] = parts;
    if (parts.length !== 3 || !isId('slug', slug) || !isKey(commentId) || !COMMENT_REACTIONS.has(type)) refuse('bad_request', 400);
    const [mine, c] = await Promise.all([
      db.get(`comment_reactions/${slug}/${uid}/${commentId}/${type}`),
      db.get(`comments/${slug}/${commentId}`),
    ]);
    if (mine !== true) refuse('not_yours', 403);
    if (!c?.authorUid) refuse('missing', 404);
    // The group counts each reader once (eventKey: the reader); the old note is one per reaction, as
    // the web wrote it, so it is keyed by the reaction too.
    const group = recordId('reaction', 'c', slug, commentId);
    return [{ uid: uidOrNull(c.authorUid), kind: 'reaction', subject: { slug, commentId }, group, eventKey: uid,
      legacyKey: recordId('nb2', group, uid, type), legacy: lib({ type, slug, commentId, commentText: clip(c.text, 120) }) }];
  },

  async story_reaction(db, uid, parts) {
    const [slug, type] = parts;
    if (parts.length !== 2 || !isId('slug', slug) || !STORY_REACTIONS_RE.test(type || '')) refuse('bad_request', 400);
    const [mine, writer] = await Promise.all([
      db.get(`storyReactionUsers/${slug}/${uid}/${type}`),
      db.get(`${INDEX_PATH}/${slug}/authorUid`),
    ]);
    if (!mine) refuse('not_yours', 403);
    if (!writer) refuse('missing', 404);
    return [{ uid: uidOrNull(writer), kind: 'story_reaction', subject: { slug }, group: recordId('story_reaction', slug), eventKey: uid }];
  },

  async follow(db, uid, parts) {
    const [target] = parts;
    if (parts.length !== 1 || !isId('uid', target)) refuse('bad_request', 400);
    if ((await db.get(`followers/${target}/${uid}`)) !== true) refuse('not_yours', 403);
    return [{ uid: target, kind: 'follow', subject: { uid }, group: recordId('follow', uid), eventKey: uid, legacy: lib({ type: 'follow' }) }];
  },

  async square_post(db, uid, parts) {
    const [postId] = parts;
    if (parts.length !== 1 || !isKey(postId)) refuse('bad_request', 400);
    const p = await db.get(`square_posts/${postId}`);
    if (!live(p)) refuse('missing', 404);
    if (p.authorUid !== uid) refuse('not_yours', 403);
    const rootId = isKey(p.parentId) ? p.parentId : null;
    const replyToId = rootId && isKey(p.replyToId) && p.replyToId !== rootId ? p.replyToId : null;
    const quotedId = !rootId && isKey(p.quotedPostId) ? p.quotedPostId : null;
    const [rootAuthor, replyToAuthor, quotedAuthor, mentions] = await Promise.all([
      rootId ? db.get(`square_posts/${rootId}/authorUid`) : null,
      replyToId ? db.get(`square_posts/${replyToId}/authorUid`) : null,
      quotedId ? db.get(`square_posts/${quotedId}/authorUid`) : null,
      mentioned(db, p.text),
    ]);
    const subject = { postId, threadId: rootId || postId };
    // The old notes, as the feed and the thread page wrote them. Ruling 320: never the followers'
    // "posted" note (square_post), here or anywhere.
    const thread = rootId ? { threadId: rootId } : {};
    return [
      replyToAuthor && { uid: uidOrNull(replyToAuthor), kind: 'reply', subject: { ...subject, to: 'you' }, id: recordId('reply', 'sq', postId),
        legacy: sq({ type: 'square_reply_to_you', postId, ...thread }) },
      rootAuthor && { uid: uidOrNull(rootAuthor), kind: 'reply', subject, id: recordId('reply', 'sq', postId),
        legacy: sq({ type: 'square_reply', postId, ...thread }) },
      quotedAuthor && { uid: uidOrNull(quotedAuthor), kind: 'quote', subject: { ...subject, quotedPostId: quotedId }, id: recordId('quote', postId),
        legacy: sq({ type: 'square_quote', postId, quotedPostId: quotedId }) },
      ...mentions.map((m) => ({ uid: m, kind: 'mention', subject, id: recordId('mention', 'sq', postId),
        legacy: sq({ type: 'mention', postId, ...thread }) })),
    ];
  },

  async square_reaction(db, uid, parts) {
    const [postId, type] = parts;
    if (parts.length !== 2 || !isKey(postId) || !SQUARE_REACTIONS.has(type)) refuse('bad_request', 400);
    const [mine, p] = await Promise.all([
      db.get(`square_reactions/${postId}/${type}/${uid}`),
      db.get(`square_posts/${postId}`),
    ]);
    if (mine !== true) refuse('not_yours', 403);
    if (!live(p)) refuse('missing', 404);
    const subject = { postId, threadId: isKey(p.parentId) ? p.parentId : postId };
    const group = recordId('reaction', 'sq', postId);
    return [{ uid: uidOrNull(p.authorUid), kind: 'reaction', subject, group, eventKey: uid,
      legacyKey: recordId('nb2', group, uid, type), legacy: sq({ type, postId, ...(isKey(p.parentId) ? { threadId: p.parentId } : {}) }) }];
  },

  async message(db, uid, parts) {
    const [convId, messageId] = parts;
    if (parts.length !== 2 || typeof convId !== 'string' || !isKey(messageId)) refuse('bad_request', 400);
    const pair = convId.split('_');
    if (pair.length !== 2 || !pair.every((u) => isId('uid', u)) || [...pair].sort().join('_') !== convId || !pair.includes(uid)) refuse('bad_request', 400);
    const other = pair[0] === uid ? pair[1] : pair[0];
    if (other === uid) refuse('bad_request', 400);
    const m = await db.get(`dm_messages/${convId}/${messageId}`);
    if (!m || typeof m !== 'object') refuse('missing', 404);
    if (m.senderUid !== uid) refuse('not_yours', 403);
    return [{
      uid: other, kind: 'message', subject: { convId }, group: recordId('message', convId), eventKey: messageId,
      silenceIf: [`dm_muted/${other}/${convId}`], freshAfterSeen: true,
    }];
  },

  async open_pages_reply(db, uid, parts) {
    const [pieceId, ...rest] = parts;
    const path = rest.join('/');
    if (!isKey(pieceId) || !OP_PATH_RE.test(path)) refuse('bad_request', 400);
    const r = await db.get(`comments/${pieceId}/${path}`);
    if (!live(r)) refuse('missing', 404);
    if (r.authorUid !== uid) refuse('not_yours', 403);
    const parentPath = path.replace(/\/replies\/[A-Za-z0-9_-]+$/, '');
    const parentAuthor = await db.get(`comments/${pieceId}/${parentPath}/authorUid`);
    const replyId = path.split('/').pop();
    return [parentAuthor && { uid: uidOrNull(parentAuthor), kind: 'reply', subject: { pieceId, path }, id: recordId('reply', 'op', pieceId, replyId),
      legacy: sq({ type: 'open_pages_reply', postId: pieceId }) }];
  },
};
export const EVENT_NAMES = Object.freeze(Object.keys(EVENTS));

// ── the handler ───────────────────────────────────────────────────────────────────────────────

/**
 * @param opts.now     the clock (tests pin it)
 * @param opts.limit   the budget (SUBREQUEST_BUDGET, 45)
 * @param opts.stats   an object the call fills with what happened, for tests: never sent to the client
 */
export async function handleNotify(context, { now = Date.now(), limit = SUBREQUEST_BUDGET, stats = null } = {}) {
  const { request, env } = context;
  let body;
  try {
    const raw = await request.text();
    body = raw && raw.trim() ? JSON.parse(raw) : null;
  } catch { return fail('bad_request', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('bad_request', 400);
  const { event, subjectId } = body;
  if (!Object.hasOwn(EVENTS, event) || typeof subjectId !== 'string' || !subjectId || subjectId.length > 400) return fail('bad_request', 400);

  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  const idToken = m ? m[1].trim() : '';
  if (!idToken) return fail('signed_out', 401);
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error(`[${LABEL}] missing configuration`);
    return fail('unavailable', 503);
  }

  const budget = newBudget(limit);
  try {
    budget.take(1);
    const account = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
    const uid = account?.localId;
    if (!isId('uid', uid)) return fail('signed_out', 401);

    budget.take(1);
    const db = notifyDb(env, await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, SCOPES), budget);

    const recipients = (await EVENTS[event](db, uid, subjectId.split('/'))).filter(Boolean).filter((r) => r.uid && r.uid !== uid);
    // The old notes need the sender's live name: one read, only when a recipient has an old note.
    if (recipients.some((r) => r.legacy)) {
      const user = await db.get(`users/${uid}`).catch(() => null);
      for (const r of recipients) if (r.legacy) r.legacy = { node: r.legacy.node, record: { ...r.legacy.record, ...senderFields(uid, user, r.legacy.node) } };
    }
    const result = await deliver(db, { actor: uid, recipients, now });
    if (stats) Object.assign(stats, result, { used: budget.used });
    return reply({ ok: true });
  } catch (e) {
    if (stats) stats.used = budget.used;
    if (e instanceof Refusal) return fail(e.code, e.status);
    console.error(`[${LABEL}] ${event} failed: ${e?.code || e?.message || 'error'}`);
    return fail('unavailable', 502);
  }
}

export async function onRequestPost(context) {
  return handleNotify(context, { now: Date.now() });
}
