// COMMENT SCREENING — the write-time check, and the only place a verdict is minted.
//
// POST /api/comments/screen   body: { slug, commentId }   auth: Bearer <Firebase id token>
//
// R32. A story-trailer card in the home carousel quotes a real reader's comment beside the
// house's own pull-quote. A comment on that surface is being PROMOTED BY THE HOUSE on the
// first screen a new reader sees, so it is screened — once, ever, here.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// WHERE THIS SITS, AND WHY IT IS NOT IN THE WRITE PATH
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// A comment is written by the BROWSER, straight to RTDB, in one atomic multi-path update
// carrying the comment and its user_comments index entry. That does not change and must not:
// ⚠ A MODERATION FAILURE MUST NEVER BLOCK SOMEBODY FROM COMMENTING. So the browser writes the
// comment exactly as before and then fires this endpoint and forgets it — no await, no error
// surfaced, no spinner. If this endpoint is down, slow, misconfigured or removed, comments
// keep working perfectly and simply never become promotable.
//
// The endpoint never trusts the client for anything except "look at this id":
//   · the uid comes from the verified token, never from the body;
//   · the TEXT is re-read from RTDB, never accepted from the caller — so nobody can get one
//     string screened and a different one stored;
//   · the story's trailerQuote is read server-side, so "is this even a carousel story" is
//     not the caller's claim to make.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ONCE, EVER — WHICH IS ALSO THE ABUSE ANSWER
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// The verdict is read before the model is called, and an existing verdict returns
// immediately. So a retry, a double-submit, a replay, or somebody hammering this endpoint
// with a valid token cannot spend anything twice: each comment costs at most one call in its
// lifetime. Combined with the pre-spend filter (isScreenable), the reachable spend from an
// authenticated attacker is bounded by the number of comments they can actually write, which
// the comment rules already bound to their own uid.
//
// ⚠ FAIL CLOSED AND QUIETLY. Any error at all — no key, model unreachable, unparseable
// output, RTDB refusing the write — writes NO verdict. No verdict means not promotable,
// permanently, until something re-runs. The caller is told nothing useful and the reader is
// told nothing at all, because from the reader's side nothing has gone wrong: their comment
// is on the story page, exactly where they put it.

import { json, dbBase, verifyIdToken, mintAccessToken } from '../bookstore/_lib.js';
import { isScreenable, SCREENING_NODE } from '../../../app/lib/trailerVoices.js';
import {
  buildScreeningRequest,
  parseScreeningResponse,
  screeningRow,
} from '../../../app/lib/voiceScreening.js';

const ANTHROPIC_TIMEOUT_MS = 15_000;
const FIREBASE_TIMEOUT_MS = 5_000;
const SCOPE =
  'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database';

// Slugs and push ids are the only two things this endpoint accepts, and both are shapes.
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function readNode(base, token, path) {
  const res = await fetch(`${base}/${path}.json`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`read ${path}: ${res.status}`);
  return res.json();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Authenticate before reading the body, so a forged identity never reaches a variable.
  const header = request.headers.get('authorization') ?? '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!idToken) return json({ ok: false }, 401);

  const uid = await verifyIdToken(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return json({ ok: false }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false }, 400);
  }
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  const commentId = typeof body?.commentId === 'string' ? body.commentId.trim() : '';
  if (!SLUG_RE.test(slug) || !ID_RE.test(commentId)) return json({ ok: false }, 400);

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  if (!clientEmail || !privateKey || !env.ANTHROPIC_API_KEY) {
    // Misconfiguration fails exactly like a model outage: no verdict, nothing promoted.
    console.error('[comments/screen] missing service credentials or ANTHROPIC_API_KEY');
    return json({ ok: false, screened: false }, 200);
  }

  const base = dbBase(env);
  let accessToken;
  try {
    accessToken = await mintAccessToken(clientEmail, privateKey, SCOPE);
  } catch (e) {
    console.error('[comments/screen] token exchange failed:', e.message);
    return json({ ok: false, screened: false }, 200);
  }

  try {
    // ── already screened? Return before anything is spent. ───────────────────────────────
    const existing = await readNode(base, accessToken, `${SCREENING_NODE}/${slug}/${commentId}`);
    if (existing && typeof existing === 'object') {
      return json({ ok: true, screened: true, cached: true }, 200);
    }

    // ── the comment, from the database, never from the caller ───────────────────────────
    const comment = await readNode(base, accessToken, `comments/${slug}/${commentId}`);
    if (!comment || typeof comment !== 'object') return json({ ok: false }, 404);

    // The caller must be the comment's author. A founder screening somebody else's comment
    // is not a thing this endpoint does — the backfill script does that, with the service
    // account, deliberately and in bulk.
    if (comment.authorUid !== uid) return json({ ok: false }, 403);

    // ── the pre-spend filter ────────────────────────────────────────────────────────────
    const story = await readNode(base, accessToken, `cms_stories_index/${slug}/trailerQuote`);
    const hasTrailerQuote = typeof story === 'string' && story.trim().length > 0;
    if (!isScreenable({ text: comment.text, parentId: comment.parentId, hasTrailerQuote })) {
      // Not an error and not a verdict: this comment could never have appeared on a card, so
      // there is nothing to decide and nothing to record.
      return json({ ok: true, screened: false, reason: 'not-eligible' }, 200);
    }

    // ── one model call ──────────────────────────────────────────────────────────────────
    const text = comment.text.trim();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildScreeningRequest(text)),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const verdict = parseScreeningResponse(await res.json());

    const row = screeningRow({ ...verdict, uid, text });
    const patch = await fetch(`${base}/${SCREENING_NODE}/${slug}/${commentId}.json`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(FIREBASE_TIMEOUT_MS),
    });
    if (!patch.ok) throw new Error(`verdict write: ${patch.status}`);

    return json({ ok: true, screened: true, promotable: row.promotable }, 200);
  } catch (e) {
    // ⚠ THE ONE BRANCH THAT MATTERS. Nothing was written, so nothing is promotable. The
    // comment is a perfectly normal comment on its story page and always was.
    console.error('[comments/screen] failed closed:', e.message);
    return json({ ok: false, screened: false }, 200);
  }
}
