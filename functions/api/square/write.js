// THE SQUARE — the write Function. Cloudflare Pages Function. W54, rulings 210–211.
//
// POST /api/square/write
//   credential:  Authorization: Bearer <Firebase ID token>   (the header ONLY — never the body)
//   body:        { action: 'post',  text, attachedStory?, quotedPostId?, poll? }
//                { action: 'reply', text, parentId, replyToId? }
//                { action: 'edit',  id, text }
//
//   → 200 { ok: true, id, record }        record = exactly what was written to square_posts/{id}
//   → 4xx/5xx { ok: false, code, error }
//
// The web's posts, replies and edits come here. The client then writes the user_square_posts
// mirror from `record` and sends the notifications, as it did before (W51: a save is finished the
// moment it is written; nothing after it can undo it).
//
// The pure rules — hours, pace, edit window, shapes, snapshot, and the copy — are
// app/lib/squareWrite.js. The app keeps writing directly until A44; W56 then tightens the rules so
// this Function is the only way in. Until then nothing here is the platform's boundary.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// THE ORDER OF THE CHECKS
// ═══════════════════════════════════════════════════════════════════════════════════════
//
//   1. THE TOKEN                       → 401 signed_out
//      accounts:lookup, as /api/hit and /api/account/delete verify (bookstore/_lib.js). The uid
//      and the display name come from the verified account; any author field in the body is
//      never read.
//   2. THE HOURS (ruling 210)          → 403 closed    "The Square opens at 8pm."
//      Posts and replies, 20:00–00:05 London on the SERVER's clock. Founders are exempt. Edits
//      are not checked: they are already bound to five minutes after a post that was in hours.
//   3. THE RECORD                      → 400 invalid · 403 poll · 404 missing · 404 story
//      The text caps again (refusalFor), the attachment and poll shapes, the thread a reply
//      belongs to. Built on the server: createdAt is the server's time, the author snapshot comes
//      from users/{uid}, and no count is written (counts are who reacted — square_reactions).
//   4. THE PACE (ruling 211)           → 429 rate      "Too much at once. Try again in a minute."
//      5 posts and 30 replies per reader in any 10 minutes, in square_rate/{uid} (no client can
//      read or write it). Recorded BEFORE the write, under the node's ETag, so a burst of
//      simultaneous requests cannot all read the same count and all pass. A refused record never
//      spends a slot; a write that then fails has spent one — the safe direction to be wrong in.
//   5. THE WRITE
//
// A database read or write that fails anywhere FAILS CLOSED (502 unavailable): the post is not
// written, and the web shows "Not sent." with Try again. That includes the pace counter — a
// limiter that lets everything through when it cannot count is not a limiter, and the write it
// guards needs the same database anyway.
//
// ── LOGGING ────────────────────────────────────────────────────────────────────────────
// Codes only. Never a reader's text, name, handle or email, and never an env value.

import { dbBase, lookupUser, mintAccessToken, SCOPES, FIREBASE_TIMEOUT_MS } from '../bookstore/_lib.js';
import { isFounder } from '../../../app/lib/founders.js';
import { isReadableStory } from '../../../app/lib/storyAccess.js';
import { INDEX_PATH } from '../../../app/lib/storyIndex.js';
import {
  SQUARE_WRITE_COPY,
  RATE_NODE,
  withinHours,
  evaluateRate,
  editRefusal,
  editText,
  authorSnapshot,
  buildRecord,
  isPostId,
} from '../../../app/lib/squareWrite.js';

const LABEL = 'square/write';
const ACTIONS = new Set(['post', 'reply', 'edit']);
// The ETag loops' attempts. A 412 on the pace counter is another write from the SAME reader landing
// in between (the node is per reader). Measured on the emulator: six posts fired at once from one
// reader needed up to six rounds — four tries answered two of them 502 — so eight.
const CAS_TRIES = 8;

const ERRORS = {
  bad_request: 'That couldn’t be sent.',
  signed_out: 'Your session has expired. Please sign in again.',
  closed: SQUARE_WRITE_COPY.closed,
  rate: SQUARE_WRITE_COPY.tooMuch,
  unavailable: 'That couldn’t be sent just now.',
  story: 'That story isn’t on the site.',
};

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const fail = (code, status, error = ERRORS[code]) => reply({ ok: false, code, error: error || ERRORS.unavailable }, status);

// ── the database, over REST with the admin token ──────────────────────────────────────

const enc = (path) => path.split('/').map(encodeURIComponent).join('/');

function rtdb(env, token) {
  const base = dbBase(env);
  const url = (path) => `${base}/${enc(path)}.json`;
  const auth = { Authorization: `Bearer ${token}` };
  const timeout = () => AbortSignal.timeout(FIREBASE_TIMEOUT_MS);
  async function get(path) {
    const res = await fetch(url(path), { headers: auth, signal: timeout() });
    if (!res.ok) throw new Error(`RTDB GET ${res.status}`);
    return res.json();
  }
  async function getWithEtag(path) {
    const res = await fetch(url(path), { headers: { ...auth, 'X-Firebase-ETag': 'true' }, signal: timeout() });
    if (!res.ok) throw new Error(`RTDB GET(etag) ${res.status}`);
    const etag = res.headers.get('ETag') || res.headers.get('etag');
    if (!etag) throw new Error('RTDB answered without an ETag');
    return { value: await res.json(), etag };
  }
  /** PUT, conditional when `ifMatch` is given. Returns 'ok' | 'stale'; throws otherwise. */
  async function put(path, value, ifMatch = null) {
    const headers = { ...auth, 'Content-Type': 'application/json' };
    if (ifMatch) headers['if-match'] = ifMatch;
    const res = await fetch(url(path), { method: 'PUT', headers, body: JSON.stringify(value), signal: timeout() });
    if (res.status === 412) return 'stale';
    if (!res.ok) throw new Error(`RTDB PUT ${res.status}`);
    return 'ok';
  }
  return { get, getWithEtag, put };
}

// Firebase-style push ids, minted here: 8 characters of the clock, so they sort by time as the
// client's push() ids did, and 12 random. The generator series/notes.js and open-pages use.
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
function pushId(now) {
  const head = new Array(8);
  let ts = now;
  for (let i = 7; i >= 0; i--) { head[i] = PUSH_CHARS.charAt(ts % 64); ts = Math.floor(ts / 64); }
  let id = head.join('');
  const rand = new Uint8Array(12);
  crypto.getRandomValues(rand);
  for (let i = 0; i < 12; i++) id += PUSH_CHARS.charAt(rand[i] % 64);
  return id;
}

/**
 * Ruling 211. true = a slot was taken; false = over the limit. Throws if it cannot count.
 * Losing the race CAS_TRIES times means that many of this reader's writes landed while this one
 * was deciding — itself a burst — so it is refused as one (Open Pages' limiter does the same).
 */
async function takeSlot(db, uid, kind, now) {
  const path = `${RATE_NODE}/${uid}`;
  for (let i = 0; i < CAS_TRIES; i++) {
    const { value, etag } = await db.getWithEtag(path);
    const verdict = evaluateRate(value, kind, now);
    if (!verdict.ok) return false;
    if ((await db.put(path, verdict.next, etag)) === 'ok') return true;
  }
  return false;
}

// ── the handler ────────────────────────────────────────────────────────────────────────

/**
 * The handler, with the clock injectable so the hours can be tested at their edges.
 * onRequestPost passes Date.now(); nothing a client sends can move it.
 */
export async function handleWrite(context, { now = Date.now() } = {}) {
  const { request, env } = context;

  let body;
  try {
    const raw = await request.text();
    body = raw && raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return fail('bad_request', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.has(body.action)) return fail('bad_request', 400);
  const action = body.action;

  // ── 1. the token ── the header, never the body ─────────────────────────────────────
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  const idToken = m ? m[1].trim() : '';
  if (!idToken) return fail('signed_out', 401);
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error(`[${LABEL}] missing NEXT_PUBLIC_FIREBASE_API_KEY / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY`);
    return fail('unavailable', 503);
  }
  const account = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
  const uid = account?.localId;
  if (!uid) return fail('signed_out', 401);
  const founder = isFounder(uid);

  // ── 2. the hours ── ruling 210, founders exempt ────────────────────────────────────
  if (action !== 'edit' && !founder && !withinHours(now)) return fail('closed', 403);

  let db;
  try {
    db = rtdb(env, await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, SCOPES));
  } catch (e) {
    console.error(`[${LABEL}] admin token mint failed`);
    return fail('unavailable', 502);
  }

  try {
    if (action === 'edit') return await doEdit({ body, uid, db, now });

    // ── 3. the record ────────────────────────────────────────────────────────────────
    const profile = (await db.get(`users/${uid}`)) || {};
    let root = null;
    let replyTo = null;
    if (action === 'reply' && isPostId(body.parentId)) {
      [root, replyTo] = await Promise.all([
        db.get(`square_posts/${body.parentId}`),
        isPostId(body.replyToId) ? db.get(`square_posts/${body.replyToId}`) : Promise.resolve(null),
      ]);
    }
    const built = buildRecord(action, body, {
      snapshot: authorSnapshot(uid, account, profile),
      now,
      canPoll: founder || profile.canPin === true || profile.canRemovePosts === true,
      root,
      replyTo,
    });
    if (!built.ok) return fail(built.code, built.status, built.message);

    // PROOFS-R1 (ruling 255): a card may point only at a story that is LIVE. A scheduled, held,
    // hidden or deleted one is refused, so a post can't announce a title before its time. Read
    // from the index, which holds exactly the live stories (isIndexed is isReadableStory) at a
    // few hundred bytes each, rather than a record that carries the whole text.
    const slug = built.record.attachedStory?.id;
    if (slug && !isReadableStory(await db.get(`${INDEX_PATH}/${slug}`))) return fail('story', 404);

    // ── 4. the pace ── ruling 211 ────────────────────────────────────────────────────
    if (!(await takeSlot(db, uid, action, now))) return fail('rate', 429);

    // ── 5. the write ─────────────────────────────────────────────────────────────────
    const id = pushId(now);
    await db.put(`square_posts/${id}`, built.record);
    return reply({ ok: true, id, record: built.record });
  } catch (e) {
    console.error(`[${LABEL}] ${action} failed: ${e?.message || 'error'}`);
    return fail('unavailable', 502);
  }
}

// Your own post or reply, inside five minutes of its createdAt, text only — written under the
// record's ETag, so a withdrawal or a moderator's removal that lands first is never overwritten
// by an edit that read the record before it.
async function doEdit({ body, uid, db, now }) {
  if (!isPostId(body.id)) return fail('bad_request', 400);
  for (let i = 0; i < CAS_TRIES; i++) {
    const { value: record, etag } = await db.getWithEtag(`square_posts/${body.id}`);
    const refusal = editRefusal(record, uid, now);
    if (refusal) return fail(refusal.code, refusal.status, refusal.message);
    const next = editText(body, record);
    if (!next.ok) return fail(next.code, next.status, next.message);
    const written = { ...record, text: next.text, edited: true };
    if ((await db.put(`square_posts/${body.id}`, written, etag)) === 'ok') return reply({ ok: true, id: body.id, record: written });
  }
  throw new Error('edit kept losing');
}

export async function onRequestPost(context) {
  return handleWrite(context, { now: Date.now() });
}
