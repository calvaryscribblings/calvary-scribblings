// READERS' NOTES — the endpoint. Cloudflare Pages Function. W46, rulings 157–166.
//
// POST /api/series/notes
//   credential:  Authorization: Bearer <Firebase ID token>   (the header ONLY — never the body)
//   body:        { action, inst, … }
//
//   reader actions:   side · note · reply · remove
//   founder actions:  review · draft-questions · publish-questions
//
//   → 200 { ok: true, … }
//   → 4xx/5xx { ok: false, code, error }      error = NOTES_ERRORS[code], app/lib/series/notes.js
//
// THE CONTRACT IS docs/series-notes.md. The paths, limits, words and every pure rule are
// app/lib/series/notes.js; the rules that make every node below `.write: false` to clients
// (founders included) are database.rules.json. This file is the only writer of the room.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// THE ORDER OF THE CHECKS — every reader action, and why each sits where it does
// ═══════════════════════════════════════════════════════════════════════════════════════
//
//   1. THE FLAG (notesEnabled)            → 404 not_enabled
//      First, before identity: while Readers' Notes are unannounced, the endpoint answers as
//      though the room did not exist, to anyone. The founders' actions skip it — the questions
//      are drafted, edited and published before the doors open (docs §"The flag").
//   2. THE TOKEN                          → 401 signed_out
//      The uid comes from a VERIFIED ID token in the Authorization header and from nowhere
//      else. A body `uid` is never read.
//   3. THE LIMITER (_ratelimit.js)        → 429 limit · 503 limiter_unavailable
//      Before any read that costs, and before the model. It FAILS CLOSED, which is its whole
//      point. The buckets are NOTES_CAPS; see THE DERIVATION there.
//   4. RELEASE                            → 409 not_released
//      The public row, read with the admin token: published and released, on the server clock.
//   5. ACCESS                             → 403 no_access
//      THE SAME POLICY AS /api/series/stream, line for line: while seriesGateOn(now) is false
//      everyone is granted; after, users/{uid}/membership + memberships/{uid} feed
//      policyGrantForInstalment. A reader who cannot read the instalment cannot join the room
//      about it — joining would hand them the conversation instead of the book. Founders always
//      pass, and the founder PREVIEW (the non-member view) is deliberately ignored here: it
//      exists to look at the locks, and a founder posting in a room is not looking at a lock.
//   6. FINISHED (series_finished/{uid}/{inst}) → 403 not_finished
//      Ruling 160. The rules already refuse every gated read without it; this refuses the
//      WRITES, which the rules cannot see because the endpoint writes as admin.
//
// A read failure anywhere in 4–6 FAILS CLOSED (502 unavailable): an unknown entitlement is
// indistinguishable from none, the same ruling as stream.js.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// SCREENING (ruling 166) — AND THE ONE DIRECTION IT MAY FAIL
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// Every note and every reply is screened by Haiku (app/lib/series/notesScreening.js) before it
// is written. Flagged → series_notes_held/{inst}/{id}, with its `reason` from the closed list;
// nothing goes live and the room does not count it. Clear → live.
//
// ⚠ A MODERATION FAILURE NEVER BLOCKS A READER. That is the rule in functions/api/comments/
// screen.js, carried over word for word. No key, a timeout (8s), a non-2xx, an unparseable
// answer — every one of them posts the note LIVE, marked `unscreened: true`, so a founder can
// find what went in unchecked. The opposite choice would turn an Anthropic outage into a room
// nobody can speak in.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// THE SUMMARY NEVER FAILS AN ACTION
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// series_notes_summary/{sid} is the public face of the room — counts, timestamps, faces, never
// a word. It is RECOMPUTED for the changed instalment from its gated nodes (instStats +
// foldSummary) and written with an ETag-conditional PUT. If any of that fails, the reader's
// note is already safely written: the failure is logged by code, and the next change heals it.
//
// ── LOGGING ────────────────────────────────────────────────────────────────────────────
// Codes and counts. Never a reader's text, name, handle or email. A uid appears only where
// stream.js already logs one (a refusal), and nowhere else.

import {
  dbBase,
  verifyIdToken,
  mintAccessToken,
  SCOPES,
  STORAGE_BUCKET,
  STORAGE_READ_SCOPE,
  FIREBASE_TIMEOUT_MS,
} from '../bookstore/_lib.js';
import { consume, limitResponse } from '../_ratelimit.js';
import { effectiveTier, normaliseTier } from '../../../app/lib/membership.js';
import { grantForInstalment, policyGrantForInstalment, seriesGateOn } from '../../../app/lib/series/access.js';
import { isFounder } from '../../../app/lib/founders.js';
import { epubObjectPath, INSTALMENT_ID_RE, INSTALMENTS_PATH, INSTALMENTS_DETAIL_PATH, SERIES_PATH } from '../../../app/lib/series/schema.js';
import {
  notesEnabled,
  NOTES_PATHS as P,
  NOTES_CAPS,
  NOTES_ERRORS,
  NOTE_KINDS,
  checkNoteInput,
  checkReplyInput,
  authorSnapshot,
  instStats,
  foldSummary,
  moveTally,
  publishableQuestions,
  sideOptions,
} from '../../../app/lib/series/notes.js';
import { buildNoteScreeningRequest, parseNoteScreeningResponse } from '../../../app/lib/series/notesScreening.js';
import { buildQuestionDraftRequest, parseQuestionDraftResponse, draftRecord } from '../../../app/lib/series/questionDrafting.js';
import { epubPlainText, TEXT_CAP } from '../../../app/lib/series/epubText.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const SCREEN_TIMEOUT_MS = 8_000;
// One Sonnet call over up to 150,000 characters. A Pages Function is billed on CPU, not on the
// wall clock it spends waiting for a fetch, so a long wait here costs nothing but the founder's
// patience — and a draft that times out is a draft they have to ask for again.
const DRAFT_TIMEOUT_MS = 120_000;
// The ETag loop's attempts. A 412 means somebody else's write landed between our read and ours;
// five tries is several concurrent writers on ONE instalment's tally at once.
const CAS_TRIES = 5;

// One token for every Google call this endpoint makes: the database and, for draft-questions,
// the instalment's EPUB. stream.js mints the same pair for the same reason.
const NOTES_SCOPES = `${SCOPES} ${STORAGE_READ_SCOPE}`;

const READER_ACTIONS = new Set(['side', 'note', 'reply', 'remove']);
const FOUNDER_ACTIONS = new Set(['review', 'draft-questions', 'publish-questions']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ── responses ──────────────────────────────────────────────────────────────────────────

function reply(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
const ok = (data = {}) => reply({ ok: true, ...data }, 200);

/** The default status for each refusal, as docs/series-notes.md gives it. */
const STATUS = {
  not_enabled: 404,
  signed_out: 401,
  bad_request: 400,
  empty: 400,
  too_long: 400,
  bad_kind: 400,
  no_side: 400,
  bad_line: 400,
  not_released: 409,
  no_questions: 409,
  not_ready: 409,
  no_access: 403,
  not_finished: 403,
  forbidden: 403,
  not_found: 404,
  unavailable: 502,
};
function fail(code, status = STATUS[code] || 400) {
  return reply({ ok: false, code, error: NOTES_ERRORS[code] || NOTES_ERRORS.unavailable }, status);
}

/**
 * The limiter's refusal, in this endpoint's vocabulary. limitResponse() owns the status, the
 * Retry-After header and the global bucket's words ("busier than usual" — about us, not the
 * reader); the code becomes the contract's `limit`, and an actor's own cap is worded from
 * NOTES_ERRORS.
 */
async function limitRefusal(verdict) {
  const res = limitResponse(verdict);
  const body = await res.json().catch(() => ({}));
  const code = body.code === 'rate_limited' ? 'limit' : 'limiter_unavailable';
  const error = code === 'limit' && verdict.bucket !== 'global' ? NOTES_ERRORS.limit : (body.error || NOTES_ERRORS[code]);
  const out = { ok: false, code, error };
  if (typeof body.retryAfter === 'number') out.retryAfter = body.retryAfter;
  return reply(out, res.status, { 'Retry-After': res.headers.get('Retry-After') || '30' });
}

/** The buckets per action, from NOTES_CAPS. Scopes are short because they are RTDB keys. */
function bucketsFor(action, uid) {
  if (action === 'note' || action === 'reply') {
    const c = NOTES_CAPS.post;
    return [
      { scope: 'snpost', period: 'minute', id: uid, limit: c.minute },
      { scope: 'snpost', period: 'day', id: uid, limit: c.day },
      { scope: 'snpost', period: 'day', limit: c.globalDay },
    ];
  }
  if (action === 'side') {
    const c = NOTES_CAPS.side;
    return [
      { scope: 'snside', period: 'minute', id: uid, limit: c.minute },
      { scope: 'snside', period: 'day', id: uid, limit: c.day },
    ];
  }
  if (action === 'remove') {
    const c = NOTES_CAPS.remove;
    return [
      { scope: 'snremove', period: 'minute', id: uid, limit: c.minute },
      { scope: 'snremove', period: 'day', id: uid, limit: c.day },
    ];
  }
  if (action === 'draft-questions') return [{ scope: 'sndraft', period: 'day', limit: NOTES_CAPS.draft.globalDay }];
  return [];
}

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
    return { value: await res.json(), etag: res.headers.get('ETag') || res.headers.get('etag') };
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
  /** ONE multi-path update at the root: every key is a full path, a null deletes. Atomic. */
  async function update(paths) {
    const res = await fetch(`${base}/.json`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(paths),
      signal: timeout(),
    });
    if (!res.ok) throw new Error(`RTDB PATCH ${res.status}`);
  }
  /** PATCH one node: a shallow merge, so children not named are kept. */
  async function patch(path, value) {
    const res = await fetch(url(path), {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      signal: timeout(),
    });
    if (!res.ok) throw new Error(`RTDB PATCH ${res.status}`);
  }
  /**
   * Read-modify-write under the node's ETag. `fn(current)` returns the next value. A 412 means
   * another writer landed in between: read again and recompute. An ABSENT node has an ETag too
   * (RTDB hashes null), so the first write to a tally is just as conditional as the hundredth.
   */
  async function transact(path, fn) {
    for (let i = 0; i < CAS_TRIES; i++) {
      const { value, etag } = await getWithEtag(path);
      const next = fn(value);
      if (!etag) throw new Error('RTDB answered without an ETag');
      if ((await put(path, next, etag)) === 'ok') return next;
    }
    throw new Error('RTDB conditional write kept losing');
  }
  return { token, get, getWithEtag, put, update, patch, transact };
}

// ── ids ────────────────────────────────────────────────────────────────────────────────
//
// Firebase-style push ids, minted HERE: 8 characters of the millisecond clock (so they sort by
// time, which is what orderByKey and "Newest" lean on) and 12 random ones. The same generator
// as functions/api/open-pages/moderate.js. Not monotonic within one millisecond, and it need not
// be: two notes in one millisecond from one Worker are not a real case, and createdAt breaks
// ties everywhere a list is ordered.
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
export function pushId(now = Date.now()) {
  let ts = now;
  const head = new Array(8);
  for (let i = 7; i >= 0; i--) { head[i] = PUSH_CHARS.charAt(ts % 64); ts = Math.floor(ts / 64); }
  const rand = new Uint8Array(12);
  crypto.getRandomValues(rand);
  let id = head.join('');
  for (let i = 0; i < 12; i++) id += PUSH_CHARS.charAt(rand[i] % 64);
  return id;
}

// ── screening ──────────────────────────────────────────────────────────────────────────

/**
 * { flagged, category, reason } — or null when screening COULD NOT RUN, which the caller posts
 * live with `unscreened: true`. Never throws.
 */
async function screen(env, { text, line = null }) {
  if (!env.ANTHROPIC_API_KEY) {
    console.error('[series/notes] screening skipped: ANTHROPIC_API_KEY is not set');
    return null; // screening could not run
  }
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildNoteScreeningRequest({ text, line })),
      signal: AbortSignal.timeout(SCREEN_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    return parseNoteScreeningResponse(await res.json());
  } catch (e) {
    console.error('[series/notes] screening could not run:', e?.name === 'TimeoutError' ? 'timed out' : e?.message);
    return null; // screening could not run
  }
}

// ── the summary ────────────────────────────────────────────────────────────────────────

/**
 * Recompute one instalment's stats and fold them into series_notes_summary/{sid}, under the
 * summary's ETag. NEVER THROWS: the reader's action has already happened.
 *
 *   leadInst — publish-questions passes the instalment the door should now lead with; every
 *              other caller passes null and the summary keeps its lead (foldSummary).
 */
async function refreshSummary(db, { sid, inst, ordinal, leadInst = null, sit = null }) {
  if (!sid) return;
  try {
    const [notes, members, sides, pub] = await Promise.all([
      db.get(`${P.notes}/${inst}`),
      db.get(`${P.members}/${inst}`),
      db.get(`${P.sides}/${inst}`),
      sit == null ? db.get(`${P.questionsPublic}/${inst}`) : Promise.resolve(null),
    ]);
    const theSit = sit != null ? sit : (pub && typeof pub.sit === 'string' ? pub.sit : null);
    const stats = instStats({ ordinal, notes: notes || {}, members: members || {}, sides: sides || {} });
    await db.transact(`${P.summary}/${sid}`, (prev) =>
      foldSummary(prev, { inst, stats, notes: notes || {}, sit: theSit, leadInst }));
  } catch (e) {
    console.error('[series/notes] summary refresh failed (the action stands):', e?.message);
  }
}

/** Join the room: series_room_members/{inst}/{uid}, only if absent (the first answer's time). */
async function membershipPath(db, inst, uid, now) {
  const joined = await db.get(`${P.members}/${inst}/${uid}`);
  return joined ? {} : { [`${P.members}/${inst}/${uid}`]: now };
}

/** The reader's profile, as the Square resolves it (app/lib/squareIdentity.js identityOf). */
async function authorFor(db, uid) {
  let p = null;
  try { p = await db.get(`users/${uid}`); }
  catch (e) { console.error('[series/notes] profile read failed; snapshot falls back:', e?.message); }
  const r = p && typeof p === 'object' ? p : {};
  return authorSnapshot({
    displayName: r.displayName || r.handle || r.username,
    handle: r.username || r.handle,
    avatarUrl: r.avatarUrl || r.photoURL,
    readCount: typeof r.readCount === 'number' ? r.readCount : undefined,
    isAuthor: r.isAuthor === true,
  }, uid);
}

// ── the handler ────────────────────────────────────────────────────────────────────────

export async function onRequestPost(context) {
  const { request, env } = context;
  const now = Date.now();

  let body = {};
  try {
    const raw = await request.text();
    body = raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return fail('bad_request');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('bad_request');
  const action = typeof body.action === 'string' ? body.action : '';
  const founderAction = FOUNDER_ACTIONS.has(action);

  // ── 1. the flag ── reader actions only ─────────────────────────────────────────────
  if (!founderAction) {
    if (!notesEnabled(env)) return fail('not_enabled');
  }

  // ── 2. the token ── the header, never the body ─────────────────────────────────────
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  const idToken = m ? m[1].trim() : '';
  if (!idToken) return fail('signed_out');
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error('[series/notes] missing NEXT_PUBLIC_FIREBASE_API_KEY / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY');
    return fail('unavailable', 503);
  }
  const uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
  if (!uid) return fail('signed_out');
  const founder = isFounder(uid);

  if (!READER_ACTIONS.has(action) && !founderAction) return fail('bad_request');
  const inst = body.inst;
  if (typeof inst !== 'string' || !INSTALMENT_ID_RE.test(inst)) return fail('bad_request');

  if (founderAction) {
    if (!isFounder(uid)) return fail('forbidden');
  }

  // ── 3. the limiter ── fails closed ─────────────────────────────────────────────────
  const buckets = bucketsFor(action, uid);
  if (buckets.length) {
    const verdict = await consume(context, buckets);
    if (!verdict.ok) return limitRefusal(verdict);
  }

  let db;
  try {
    db = rtdb(env, await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY, NOTES_SCOPES));
  } catch (e) {
    console.error('[series/notes] admin token mint failed:', e?.message);
    return fail('unavailable');
  }

  try {
    if (founderAction) return await founderDispatch({ action, body, inst, uid, db, env, now });

    // ── 4. release ─────────────────────────────────────────────────────────────────────
    const row = await db.get(`${INSTALMENTS_PATH}/${inst}`);
    if (!row || typeof row !== 'object') return fail('not_released');
    const releaseGrant = grantForInstalment(row, { signedIn: true, now });
    if (releaseGrant.reason === 'not_released') return fail('not_released');

    // ── 5. access ── the stream's policy; founders always pass ─────────────────────────
    if (!founder && seriesGateOn(now)) {
      const [scalar, detail] = await Promise.all([
        db.get(`users/${uid}/membership`),
        db.get(`memberships/${uid}`),
      ]);
      const grant = policyGrantForInstalment(row, {
        subscriptionTier: normaliseTier(scalar),
        effectiveTier: effectiveTier(scalar, detail, now),
        signedIn: true,
        now,
      });
      if (grant.access !== 'granted') {
        console.log(`[series/notes] no_access uid=${uid} reason=${grant.reason}`);
        return fail('no_access');
      }
    }

    // ── 6. finished ── ruling 160; a founder removing someone's note is moderating ─────
    const moderating = founder && action === 'remove';
    if (!moderating) {
      const finished = await db.get(`${P.finished}/${uid}/${inst}`);
      if (!finished) return fail('not_finished');
    }

    const ctx = { body, inst, uid, founder, db, env, now, row, sid: typeof row.seriesId === 'string' ? row.seriesId : null };
    if (action === 'side') return await doSide(ctx);
    if (action === 'note') return await doNote(ctx);
    if (action === 'reply') return await doReply(ctx);
    return await doRemove(ctx);
  } catch (e) {
    // FAIL CLOSED: a read or write that failed is not a permission to proceed.
    console.error(`[series/notes] ${action} failed:`, e?.message);
    return fail('unavailable');
  }
}

// ── side ───────────────────────────────────────────────────────────────────────────────

async function doSide({ body, inst, uid, db, now, row, sid }) {
  const questions = await db.get(`${P.questions}/${inst}`);
  if (!questions || typeof questions !== 'object') return fail('no_questions');
  const option = body.option;
  const keys = sideOptions(questions.side).map(([k]) => k);
  if (typeof option !== 'string' || !keys.includes(option)) return fail('bad_request');

  const prev = await db.get(`${P.sides}/${inst}/${uid}`);
  const join = await membershipPath(db, inst, uid, now);
  let tally;
  if (prev !== option) {
    // The side first, then the tally under its ETag. If the tally write lost every race the
    // side still stands and the tally is one off until the next move — logged, not hidden.
    await db.update({ [`${P.sides}/${inst}/${uid}`]: option, ...join });
    try {
      tally = await db.transact(`${P.tallies}/${inst}`, (cur) => moveTally(cur, prev, option));
    } catch (e) {
      console.error('[series/notes] tally write failed:', e?.message);
      tally = await db.get(`${P.tallies}/${inst}`).catch(() => null);
    }
  } else {
    // Choosing the side you already hold moves nothing — but still opens the room (161).
    if (Object.keys(join).length) await db.update(join);
    tally = await db.get(`${P.tallies}/${inst}`);
  }
  await refreshSummary(db, { sid, inst, ordinal: row.ordinal });
  return ok({ side: option, tally: tally || {} });
}

// ── note ───────────────────────────────────────────────────────────────────────────────

async function doNote({ body, inst, uid, db, env, now, row, sid }) {
  const kind = body.kind;
  if (!NOTE_KINDS.includes(kind)) return fail('bad_kind');
  // 'side', 'sit' and 'line' answer a published question; 'else' needs none.
  if (kind !== 'else') {
    const questions = await db.get(`${P.questions}/${inst}`);
    if (!questions || typeof questions !== 'object') return fail('no_questions');
  }
  // A 'side' note carries the side the reader RECORDED — never a side named in the body.
  const mySide = kind === 'side' ? await db.get(`${P.sides}/${inst}/${uid}`) : null;
  const checked = checkNoteInput({ kind, text: body.text, line: body.line }, { recordedSide: mySide });
  if (!checked.ok) return fail(checked.error);

  const [author, writerUid] = await Promise.all([
    authorFor(db, uid),
    sid ? db.get(`${SERIES_PATH}/${sid}/authorUid`).catch(() => null) : Promise.resolve(null),
  ]);
  const note = { uid, ...checked.note, author, createdAt: now };
  if (typeof writerUid === 'string' && writerUid && uid === writerUid) note.writer = true;

  const noteId = pushId(now);
  const verdict = await screen(env, { text: note.text, line: note.line || null });
  if (verdict && verdict.flagged) {
    await db.put(`${P.held}/${inst}/${noteId}`, { ...note, reason: verdict.category });
    console.log(`[series/notes] note held category=${verdict.category}`);
    return ok({ noteId, status: 'held', note });
  }
  if (!verdict) note.unscreened = true;
  const join = await membershipPath(db, inst, uid, now);
  await db.update({ [`${P.notes}/${inst}/${noteId}`]: note, ...join });
  await refreshSummary(db, { sid, inst, ordinal: row.ordinal });
  return ok({ noteId, status: verdict ? 'live' : 'unscreened', note });
}

// ── reply ──────────────────────────────────────────────────────────────────────────────

async function doReply({ body, inst, uid, db, env, now, row, sid }) {
  const noteId = body.noteId;
  if (typeof noteId !== 'string' || !ID_RE.test(noteId)) return fail('bad_request');
  const replyTo = body.replyTo == null ? null : body.replyTo;
  if (replyTo !== null && (typeof replyTo !== 'string' || !ID_RE.test(replyTo))) return fail('bad_request');

  const parent = await db.get(`${P.notes}/${inst}/${noteId}`);
  if (!parent || typeof parent !== 'object') return fail('not_found');
  if (replyTo) {
    const target = await db.get(`${P.replies}/${inst}/${noteId}/${replyTo}`);
    if (!target || typeof target !== 'object') return fail('not_found');
  }
  const checked = checkReplyInput({ text: body.text });
  if (!checked.ok) return fail(checked.error);

  const author = await authorFor(db, uid);
  const theReply = { uid, text: checked.text, author, createdAt: now };
  if (replyTo) theReply.replyTo = replyTo;

  const replyId = pushId(now);
  const verdict = await screen(env, { text: theReply.text });
  if (verdict && verdict.flagged) {
    await db.put(`${P.held}/${inst}/${replyId}`, { ...theReply, kind: 'reply', noteId, reason: verdict.category });
    console.log(`[series/notes] reply held category=${verdict.category}`);
    return ok({ replyId, status: 'held', reply: theReply });
  }
  if (!verdict) theReply.unscreened = true;
  const join = await membershipPath(db, inst, uid, now);
  await db.update({ [`${P.replies}/${inst}/${noteId}/${replyId}`]: theReply, ...join });
  await refreshSummary(db, { sid, inst, ordinal: row.ordinal });
  return ok({ replyId, status: verdict ? 'live' : 'unscreened', reply: theReply });
}

// ── remove ─────────────────────────────────────────────────────────────────────────────

/** Everything a note takes with it: its replies, its underlines, its reports. One write. */
const noteCascade = (inst, noteId) => ({
  [`${P.notes}/${inst}/${noteId}`]: null,
  [`${P.replies}/${inst}/${noteId}`]: null,
  [`${P.underlines}/${inst}/${noteId}`]: null,
  [`${P.reports}/${inst}/${noteId}`]: null,
});

async function doRemove({ body, inst, uid, founder, db, row, sid }) {
  const noteId = body.noteId;
  const replyId = body.replyId == null ? null : body.replyId;
  if (typeof noteId !== 'string' || !ID_RE.test(noteId)) return fail('bad_request');
  if (replyId !== null && (typeof replyId !== 'string' || !ID_RE.test(replyId))) return fail('bad_request');
  const mayRemove = (rec) => founder || rec.uid === uid;

  if (replyId) {
    const live = await db.get(`${P.replies}/${inst}/${noteId}/${replyId}`);
    if (live && typeof live === 'object') {
      if (!mayRemove(live)) return fail('forbidden');
      // The row stays, so the thread's "Replying to" chain still reads; the words go.
      await db.update({
        [`${P.replies}/${inst}/${noteId}/${replyId}/text`]: '',
        [`${P.replies}/${inst}/${noteId}/${replyId}/removed`]: true,
      });
    } else {
      const held = await db.get(`${P.held}/${inst}/${replyId}`);
      if (!held || held.kind !== 'reply' || held.noteId !== noteId) return fail('not_found');
      if (!mayRemove(held)) return fail('forbidden');
      await db.update({ [`${P.held}/${inst}/${replyId}`]: null });
    }
  } else {
    const live = await db.get(`${P.notes}/${inst}/${noteId}`);
    if (live && typeof live === 'object') {
      if (!mayRemove(live)) return fail('forbidden');
      await db.update(noteCascade(inst, noteId));
    } else {
      const held = await db.get(`${P.held}/${inst}/${noteId}`);
      if (!held || typeof held !== 'object' || held.kind === 'reply') return fail('not_found');
      if (!mayRemove(held)) return fail('forbidden');
      await db.update({ [`${P.held}/${inst}/${noteId}`]: null });
    }
  }
  await refreshSummary(db, { sid, inst, ordinal: row.ordinal });
  return ok();
}

// ── the founders' actions ──────────────────────────────────────────────────────────────

async function founderDispatch({ action, body, inst, db, env, now }) {
  // No release check: the questions are drafted and published BEFORE an instalment releases.
  const row = await db.get(`${INSTALMENTS_PATH}/${inst}`);
  if (!row || typeof row !== 'object') return fail('not_found');
  const sid = typeof row.seriesId === 'string' ? row.seriesId : null;
  if (action === 'review') return doReview({ body, inst, db, now, row, sid });
  if (action === 'publish-questions') return doPublish({ inst, db, now, row, sid });
  return doDraft({ inst, db, env, now, row, sid });
}

async function doReview({ body, inst, db, now, row, sid }) {
  const noteId = body.noteId;
  const decision = body.decision;
  if (typeof noteId !== 'string' || !ID_RE.test(noteId)) return fail('bad_request');
  if (!['approve', 'remove', 'dismiss'].includes(decision)) return fail('bad_request');

  if (decision === 'dismiss') {
    // The note stays exactly as it is; only the reports on it go.
    await db.update({ [`${P.reports}/${inst}/${noteId}`]: null });
    return ok();
  }

  const held = await db.get(`${P.held}/${inst}/${noteId}`);
  if (decision === 'approve') {
    if (!held || typeof held !== 'object') return fail('not_found');
    const { kind, noteId: parentId, ...rest } = held;
    delete rest.reason;
    const join = await membershipPath(db, inst, held.uid, now);
    if (kind === 'reply') {
      const parent = await db.get(`${P.notes}/${inst}/${parentId}`);
      if (!parent) return fail('not_found');
      await db.update({
        [`${P.replies}/${inst}/${parentId}/${noteId}`]: rest,
        [`${P.held}/${inst}/${noteId}`]: null,
        ...join,
      });
    } else {
      await db.update({
        [`${P.notes}/${inst}/${noteId}`]: { ...rest, kind },
        [`${P.held}/${inst}/${noteId}`]: null,
        ...join,
      });
    }
    await refreshSummary(db, { sid, inst, ordinal: row.ordinal });
    return ok();
  }

  // remove
  if (held && typeof held === 'object') {
    await db.update({ [`${P.held}/${inst}/${noteId}`]: null });
  } else {
    const live = await db.get(`${P.notes}/${inst}/${noteId}`);
    if (!live) return fail('not_found');
    await db.update(noteCascade(inst, noteId));
  }
  await refreshSummary(db, { sid, inst, ordinal: row.ordinal });
  return ok();
}

async function doPublish({ inst, db, now, row, sid }) {
  const draft = await db.get(`${P.drafts}/${inst}`);
  // All three or none (ruling 159).
  const pub = publishableQuestions(draft, now);
  if (pub.error) return fail('not_ready');
  // ONE write: the room's questions and the door's Sit question cannot disagree, even briefly.
  await db.update({
    [`${P.questions}/${inst}`]: pub.questions,
    [`${P.questionsPublic}/${inst}`]: pub.public,
  });

  // The door leads with the LATEST instalment that has published questions. If that is this
  // one, it becomes the lead now; otherwise the summary keeps the lead it has.
  let leadInst = null;
  try {
    if (sid) {
      const [rows, publics] = await Promise.all([db.get(INSTALMENTS_PATH), db.get(P.questionsPublic)]);
      const withQ = Object.entries(rows || {})
        .filter(([id, r]) => r && r.seriesId === sid && (id === inst || (publics && publics[id])))
        .sort((a, b) => (Number(b[1].ordinal) || 0) - (Number(a[1].ordinal) || 0));
      if (withQ.length && withQ[0][0] === inst) leadInst = inst;
    }
  } catch (e) {
    console.error('[series/notes] lead lookup failed:', e?.message);
  }
  await refreshSummary(db, { sid, inst, ordinal: row.ordinal, leadInst, sit: pub.public.sit });
  return ok({ questions: pub.questions });
}

async function doDraft({ inst, db, env, now, row, sid }) {
  if (!env.ANTHROPIC_API_KEY) {
    console.error('[series/notes] draft-questions: ANTHROPIC_API_KEY is not set');
    return fail('unavailable', 503);
  }
  // The EPUB, with the service account. series_epubs/** is `allow read: if false` to every
  // client; this read is the endpoint's, after the founder check, and the bytes never leave it.
  const bucket = env.FIREBASE_STORAGE_BUCKET || STORAGE_BUCKET;
  const objectPath = epubObjectPath(inst);
  const file = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`,
    { headers: { Authorization: `Bearer ${db.token}` }, signal: AbortSignal.timeout(30_000) },
  );
  if (file.status === 404) return fail('not_found');
  if (!file.ok) throw new Error(`GCS GET ${file.status}`);
  const text = await epubPlainText(new Uint8Array(await file.arrayBuffer()), { max: TEXT_CAP });
  if (text.length < 200) {
    console.error(`[series/notes] draft-questions: the EPUB yielded ${text.length} characters`);
    return fail('unavailable');
  }

  const [detail, series] = await Promise.all([
    db.get(`${INSTALMENTS_DETAIL_PATH}/${inst}/title`).catch(() => null),
    sid ? db.get(`${SERIES_PATH}/${sid}/title`).catch(() => null) : Promise.resolve(null),
  ]);
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildQuestionDraftRequest({
      seriesTitle: typeof series === 'string' ? series : '',
      title: typeof detail === 'string' ? detail : '',
      ordinal: row.ordinal,
      text,
    })),
    signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const draft = draftRecord(parseQuestionDraftResponse(await res.json()), now);
  // DRAFTS ONLY (ruling 164). PATCH, so anything else kept in the draft survives.
  await db.patch(`${P.drafts}/${inst}`, draft);
  console.log(`[series/notes] draft-questions wrote a draft from ${text.length} characters`);
  return ok({ draft });
}
