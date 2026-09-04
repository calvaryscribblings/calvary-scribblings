// Open Pages — AI moderation Pages Function (Stage 2).
//
// POST /api/open-pages/moderate   body: { title, body, coverImage?, genre?, postId? }
//                                 (body is Markdown; postId means EDIT this post)
//
// Reads a submitted post, asks Claude (Haiku) to moderate it, and routes it:
//   pass  -> public open_pages/{postId} (status:'live')   + user_open_pages mirror -> { status:'published' }
//   flag  -> open_pages_pending/{postId} (status:'flagged') for admin review        -> { status:'pending' }
//   block -> stored nowhere; generic rejection returned                             -> { status:'rejected' }
//
// Before any of that, a per-account rate limit is consulted (see _rate-limit.js):
//   over limit -> HTTP 429, nothing stored, NO model call -> { status:'rate_limited' }
//
// FAIL CLOSED: if the Claude call fails or returns unparseable output, the post is
// routed to open_pages_pending (status:'flagged', reason:'moderation-unavailable').
// Nothing un-screened ever reaches the public feed.
//
// This is a Cloudflare Pages Function (onRequestPost), modelled on the working
// functions/api/generate-quiz.js — it reads env via context.env and calls Anthropic
// with x-api-key.
//
// AUTH: the caller must present a Firebase ID token as `Authorization: Bearer
// <idToken>` and the uid is derived from THAT, via the same verifyToken() path
// record-attempt.js and hit.js use. Any verified signed-in user may post; this
// endpoint's audience is every reader, not just admins.
//
// It previously took `uid` from the request body and verified nothing. The note
// here used to argue that was acceptable because the RTDB rules are the real
// boundary — clients cannot write to the public open_pages node, only this
// function can, using the service-account credentials in the Pages env — so a
// forged uid "could mis-attribute a post, but cannot bypass moderation or
// publish directly". Both halves of that were true and it was still the wrong
// trade. Mis-attribution IS the attack: anyone could publish under any reader's
// name, to the public feed, with that reader's real name, handle and avatar
// attached by the trustworthy-snapshot lookup below — which made the forgery
// MORE convincing, not less. It also let an unauthenticated caller spend the
// platform's Anthropic budget at will. The body uid is now ignored entirely.
//
// Trustworthy snapshot: the author's name/handle/avatar are fetched server-side from
// users/{uid} — client-sent author fields are ignored, and the uid is the verified one.

import {
  OPEN_PAGES_NODE,
  OPEN_PAGES_PENDING_NODE,
  USER_OPEN_PAGES_NODE,
  OPEN_PAGE_STATUS,
  buildAuthorSnapshot,
  buildPendingPost,
  normalizeGenre,
} from '../../../app/lib/openPages.js';
import { resolveHook, fire } from '../_deploy-hooks.js';
import { consume, refusalMessage } from './_rate-limit.js';
// R38 — the Square announcement. Pure builder; the write happens below, inside the same
// atomic PATCH that publishes the piece.
import { buildAnnouncement } from '../../../app/lib/openPagesAnnounce.js';

// Same budget the rebuild endpoint uses for the same third party. Stated here rather than
// imported from bookstore/_lib.js so this file keeps its one-directory import surface.
const HOOK_TIMEOUT_MS = 10_000;

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

// The Open Pages deploy hook is POSTed whenever a post goes live, so the static export
// rebuilds and pre-renders the new /open-pages/[id].
//
// ⚠ R19.7 — IT USED TO BE A LITERAL HERE, AND THAT LITERAL IS NOW DEAD. This file is server
// side, so its copy never shipped to a browser — but app/admin/forum/page.jsx carried the SAME
// UUID as a client constant and did ship it, which is why the hook was rotated on 26 Aug 2026.
// A rotated hook answers 404 forever and nothing upstream would have noticed: the status was
// only ever reported into a diagnostic field. So the URL now comes from the environment,
// through the one table that owns identifier → env var, and a missing variable is a stated
// outcome rather than a silent no-op.

const MODEL = 'claude-haiku-4-5';
const TITLE_MAX = 200;
const BODY_MAX = 50000;
const COVER_MAX = 2000; // download URL length cap

// Cover image must be a Firebase Storage (or other https) download URL, or absent.
function cleanCoverImage(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return null;
  if (v.length > COVER_MAX) return null;
  return /^https?:\/\//i.test(v.trim()) ? v.trim() : null;
}

// ---------------------------------------------------------------------------
// Moderation tool (structured output via forced tool_use).
// ---------------------------------------------------------------------------

const MODERATION_TOOL = {
  name: 'moderate_post',
  description: 'Return a moderation decision for a community post on a creative-writing platform.',
  input_schema: {
    type: 'object',
    properties: {
      decision: {
        type: 'string',
        enum: ['pass', 'flag', 'block'],
        description:
          "'pass' = ordinary creative writing, publish immediately. 'flag' = explicit-but-legal, hold for human review. 'block' = clearly harmful or illegal, reject entirely.",
      },
      categories: {
        type: 'array',
        items: { type: 'string' },
        description: 'Short category labels for any concerns found (empty array if none).',
      },
      reason: {
        type: 'string',
        description: 'One concise sentence explaining the decision.',
      },
    },
    required: ['decision', 'categories', 'reason'],
  },
};

const SYSTEM_PROMPT = `You are the moderation gate for "Open Pages", a community publishing space on a CREATIVE-WRITING platform. Members post stories, poetry, and other fiction. Your job is to let good-faith creative work through while catching genuinely harmful content and routing explicit material to human review.

You MUST call the moderate_post tool with a three-way decision:

- "pass" — publish immediately to the public feed. This is the DEFAULT for legitimate creative writing, including dark themes, romance, conflict, tragedy, mild mature content, strong language, and emotional intensity. This is a literary platform: DO NOT flag fiction merely for being intense, sad, dark, violent-in-passing, or mature. Err toward "pass" for any plausible good-faith creative work.

- "flag" — store for human admin review, do NOT auto-publish. Use for content that is legitimate to write but should not auto-appear on a public feed: explicit/graphic sexual content; graphic or extreme violence and gore; or genuinely borderline cases that need a human judgement call.

- "block" — reject entirely; the post is not stored. Reserve this for clearly harmful or illegal content: any sexual content involving minors (ZERO TOLERANCE); credible threats or incitement to real-world violence; doxxing or release of private personal information; clearly malicious spam, scams, or phishing; other plainly illegal content.

Decision guidance:
- Only "flag" for genuinely EXPLICIT sex or GRAPHIC violence — not for the existence of a sex scene, a death, or a fight in a story.
- When a legitimate creative piece is merely intense or mature, choose "pass".
- When unsure between pass and flag for explicit material, choose "flag" (a human will decide).
- When content is clearly harmful/illegal per the block list, choose "block" regardless of literary framing.

Always populate categories (empty array if clean) and give one concise reason sentence.`;

// ---------------------------------------------------------------------------
// Response helper.
// ---------------------------------------------------------------------------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Firebase push-id generator (canonical algorithm) — chronological, URL-safe.
// Generated server-side so the same postId keys both the public/pending node and
// the per-author mirror in one atomic PATCH.
// ---------------------------------------------------------------------------

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

function generatePushId(now) {
  let timeStampChars = new Array(8);
  let ts = now;
  for (let i = 7; i >= 0; i--) {
    timeStampChars[i] = PUSH_CHARS.charAt(ts % 64);
    ts = Math.floor(ts / 64);
  }
  let id = timeStampChars.join('');
  const rand = new Uint8Array(12);
  crypto.getRandomValues(rand);
  for (let i = 0; i < 12; i++) {
    id += PUSH_CHARS.charAt(rand[i] % 64);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Service-account auth — mint an OAuth access token for the Firebase Admin REST
// API (copied from functions/api/record-attempt.js). Lets this function write to
// the locked open_pages node (clients can't, per the RTDB rules).
// ---------------------------------------------------------------------------

function base64url(arrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken(clientEmail, privateKeyPem) {
  const pemBody = privateKeyPem.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g,
    ''
  );
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(
    enc.encode(
      JSON.stringify({
        iss: clientEmail,
        sub: clientEmail,
        aud: 'https://oauth2.googleapis.com/token',
        scope:
          'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
        iat: now,
        exp: now + 3600,
      })
    )
  );

  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput));
  const jwt = `${signingInput}.${base64url(sig)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`);
  }

  const { access_token } = await tokenRes.json();
  return access_token;
}

// ---------------------------------------------------------------------------
// Anthropic moderation call. Returns the parsed { decision, categories, reason }
// tool input, or throws (caller fails closed).
// ---------------------------------------------------------------------------

async function moderateWithClaude(env, title, body) {
  const prompt = `Moderate the following Open Pages submission. Call the moderate_post tool.

Title:
"""
${title}
"""

Body (Markdown):
"""
${body}
"""`;

  const aRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [MODERATION_TOOL],
      tool_choice: { type: 'tool', name: 'moderate_post' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const aText = await aRes.text();
  if (!aRes.ok) throw new Error(`Anthropic API error ${aRes.status}: ${aText.slice(0, 300)}`);

  const aData = JSON.parse(aText);
  const toolBlock = aData.content?.find(
    (b) => b.type === 'tool_use' && b.name === 'moderate_post'
  );
  if (!toolBlock || !toolBlock.input) throw new Error('No moderate_post tool_use in response.');

  const { decision, categories, reason } = toolBlock.input;
  if (!['pass', 'flag', 'block'].includes(decision)) {
    throw new Error(`Invalid decision: ${JSON.stringify(decision)}`);
  }
  return {
    decision,
    categories: Array.isArray(categories) ? categories : [],
    reason: typeof reason === 'string' ? reason : '',
  };
}

// ---------------------------------------------------------------------------
// RTDB write — atomic multi-path PATCH at the database root.
// ---------------------------------------------------------------------------

async function writePaths(fbDb, accessToken, paths) {
  const res = await fetch(`${fbDb}/.json`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(paths),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firebase PATCH failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// Handler.
// ---------------------------------------------------------------------------

// Verbatim from functions/api/record-attempt.js — exchanges a Firebase ID token
// for the uid Google says it belongs to, or null if it is absent, expired,
// forged or malformed.
async function verifyToken(token, apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.users?.[0]?.localId ?? null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Authenticate BEFORE reading the body, so a forged uid never reaches a
  // variable. Any verified signed-in user may post — see the AUTH note above.
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);

  const uid = await verifyToken(token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!uid) return json({ error: 'Unauthorised.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  // `uid` is deliberately NOT destructured from the body. A client that still
  // sends one is ignored; every use of `uid` below is the verified one.
  const { title, body: postBody, coverImage, genre, postId: editId } = body || {};
  console.log('[open-pages/moderate] uid:', uid, '(verified) | ANTHROPIC set:', !!env.ANTHROPIC_API_KEY);

  // Server-side validation.
  if (!title || typeof title !== 'string' || !title.trim())
    return json({ error: 'title required.' }, 400);
  if (!postBody || typeof postBody !== 'string' || !postBody.trim())
    return json({ error: 'body required.' }, 400);
  if (title.length > TITLE_MAX)
    return json({ error: `title exceeds ${TITLE_MAX} characters.` }, 400);
  if (postBody.length > BODY_MAX)
    return json({ error: `body exceeds ${BODY_MAX} characters.` }, 400);

  const cleanTitle = title.trim();
  const cleanBody = postBody.trim();
  const cover = cleanCoverImage(coverImage);

  // Service credentials.
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const fbDb = (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');

  if (!clientEmail || !privateKey) {
    console.error('[open-pages/moderate] Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY');
    return json({ error: 'Server misconfigured.' }, 500);
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(clientEmail, privateKey);
  } catch (e) {
    console.error('[open-pages/moderate] token exchange failed:', e.message);
    return json({ error: 'Failed to obtain service credentials.' }, 500);
  }

  // Trustworthy author snapshot from users/{uid} (ignore any client-sent author fields).
  let profile = {};
  try {
    const profRes = await fetch(`${fbDb}/${USER_PROFILE_PATH(uid)}.json`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (profRes.ok) {
      const p = await profRes.json();
      if (p && typeof p === 'object') profile = p;
    }
  } catch (e) {
    console.warn('[open-pages/moderate] profile read failed; using minimal snapshot:', e.message);
  }

  const now = Date.now();
  const snapshot = buildAuthorSnapshot({ uid }, profile);

  // -------------------------------------------------------------------------
  // CREATE or EDIT.
  //
  // R35. An edit used to be a client write: /open-pages/edit/[id] called this
  // endpoint purely as an oracle, deleted the throwaway post the "published"
  // verdict had just created, and then wrote title/body/genre/coverImage
  // straight into open_pages/{id} itself — WITHOUT a moderation field. The
  // record kept the verdict its ORIGINAL body earned. The rules permitted it
  // (the author held .write on their own published post), so the re-screening
  // was only as good as the client that happened to be used: anything speaking
  // to the RTDB with the author's token could rewrite a screened piece into
  // anything at all and leave the old "pass" sitting underneath it.
  //
  // The rules now refuse every client write to open_pages except the readCount
  // leaf, which is the only enforceable form of "must re-screen": a rule cannot
  // tell a real verdict from a typed one, because whatever moderation object it
  // demands, the client being constrained can simply write. So the screening had
  // to move to where the credentials are — here.
  //
  // An edit therefore re-enters the SAME gate as a new post, and only a `pass`
  // reaches the public node. Anything else leaves the live piece exactly as it
  // was: the endpoint is fail-closed for edits in the strong sense that failure
  // changes nothing rather than publishing something unscreened.
  // -------------------------------------------------------------------------
  const isEdit = typeof editId === 'string' && editId.length > 0;

  let existing = null;
  if (isEdit) {
    if (editId.length > 64 || /[.#$\[\]/]/.test(editId)) {
      return json({ error: 'Invalid postId.' }, 400);
    }
    try {
      const exRes = await fetch(`${fbDb}/${OPEN_PAGES_NODE}/${editId}.json`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (exRes.ok) {
        const v = await exRes.json();
        if (v && typeof v === 'object') existing = v;
      }
    } catch (e) {
      console.error('[open-pages/moderate] edit: existing read failed:', e.message);
      return json({ error: 'Could not load the post to edit.' }, 500);
    }
    if (!existing) return json({ error: 'Post not found.' }, 404);
    // Authorship is decided here, from the stored record and the VERIFIED uid —
    // never from the request.
    if (existing.authorUid !== uid) return json({ error: 'Not your post.' }, 403);
  }

  const postId = isEdit ? editId : generatePushId(now);

  // Base record. On create: a fresh pending record (genre normalised inside
  // buildPendingPost, which falls back to 'General'). On edit: the STORED record
  // with only the four editable fields overlaid — so createdAt, readCount and the
  // author snapshot survive the edit rather than being rebuilt from a profile
  // that may since have lost its displayName.
  const base = isEdit
    ? {
        ...existing,
        title: cleanTitle,
        body: cleanBody,
        coverImage: cover,
        genre: normalizeGenre(genre),
        updatedAt: now,
      }
    : buildPendingPost(snapshot, { title: cleanTitle, body: cleanBody, coverImage: cover, genre }, now);

  // -------------------------------------------------------------------------
  // R36 — AN EDIT THAT CHANGES NO SCREENED TEXT NEEDS NO SCREEN.
  //
  // The gate reads title + body and nothing else, so an edit that leaves both
  // byte-identical and only swaps the cover or the genre has nothing new to
  // screen. Publishing it directly is not a hole: the comparison is made
  // server-side against the STORED record, so the verdict stays attached to
  // exactly the text it was issued for, and the write still goes through service
  // credentials. It also keeps the commonest honest edit — fixing a cover — from
  // spending a slot of the limiter below, which is what would otherwise make five
  // an hour bite a writer who is polishing rather than posting.
  // -------------------------------------------------------------------------
  if (isEdit && existing.title === cleanTitle && existing.body === cleanBody) {
    const record = { ...base, status: OPEN_PAGE_STATUS.LIVE };
    try {
      await writePaths(fbDb, accessToken, {
        [`${OPEN_PAGES_NODE}/${postId}`]: record,
        [`${USER_OPEN_PAGES_NODE}/${uid}/${postId}`]: record,
      });
    } catch (e) {
      console.error('[open-pages/moderate] unchanged-text edit write failed:', e.message);
      return json({ error: 'Failed to save your changes.' }, 500);
    }
    return json({ status: 'published', postId, edited: true, rescreened: false });
  }

  // -------------------------------------------------------------------------
  // R36 — THE RATE LIMIT, AND IT IS CHECKED HERE FOR A REASON.
  //
  // Everything above this line is free: parsing, validation, the authorship read.
  // Everything below it costs money. So the check sits exactly at that seam — a
  // limiter placed after the Anthropic call would refuse the response while still
  // having paid for it, which protects nothing at all.
  //
  // A 400 or a 403 above therefore never consumes a slot, and neither does the
  // unchanged-text edit, because neither of them reaches the model.
  // -------------------------------------------------------------------------
  const gate = await consume(fbDb, accessToken, uid, now);
  if (!gate.ok) {
    console.log('[open-pages/moderate] RATE LIMITED', uid, gate.scope, 'until', gate.retryAt);
    return json(
      {
        status: 'rate_limited',
        scope: gate.scope,
        retryAt: gate.retryAt,
        reason: refusalMessage(gate.scope, gate.retryAt, now),
      },
      429,
    );
  }

  // A pending record, for either mode. On an EDIT this is a PROPOSED REVISION filed
  // under the live post's own id, so the admin queue's existing approve() — which
  // writes open_pages_pending/{id} wholesale to open_pages/{id} — publishes the
  // revision over the original with no new machinery. approvedBy/approvedAt are
  // dropped because a revision has not been approved; `revision: true` is what lets
  // the queue say "edit to a live post" rather than "new post". Note that the live
  // readCount is carried in `base` and therefore snapshot at edit time: reads that
  // accrue while a revision waits for review are lost when it is approved. That is
  // a stated cost, not an oversight — the alternative is a per-field merge the
  // admin queue has no way to express.
  function pendingRecord(moderationValue) {
    const rec = { ...base, status: OPEN_PAGE_STATUS.FLAGGED, moderation: moderationValue };
    if (isEdit) {
      delete rec.approvedBy;
      delete rec.approvedAt;
      rec.revision = true;
    }
    return rec;
  }

  // Moderate — fail closed on any error.
  let mod;
  try {
    mod = await moderateWithClaude(env, cleanTitle, cleanBody);
  } catch (e) {
    console.error('[open-pages/moderate] moderation failed, failing closed to pending:', e.message);
    // THE ANSWER TO "what happens mid-edit when the screen is unavailable": the
    // revision is stored for a human, and open_pages/{postId} is not written at
    // all. The live piece keeps the body and the verdict it already had. Nothing
    // publishes unscreened — an unreachable screen costs the EDIT, never the gate.
    const record = pendingRecord({
      decision: 'flag',
      categories: ['moderation-unavailable'],
      reason: 'moderation-unavailable',
      checkedAt: now,
      model: MODEL,
    });
    try {
      await writePaths(fbDb, accessToken, { [`${OPEN_PAGES_PENDING_NODE}/${postId}`]: record });
    } catch (writeErr) {
      console.error('[open-pages/moderate] fail-closed write failed:', writeErr.message);
      return json({ error: 'Failed to store submission.' }, 500);
    }
    return json({ status: 'pending', postId, edited: isEdit });
  }

  const moderation = {
    decision: mod.decision,
    categories: mod.categories,
    reason: mod.reason,
    checkedAt: now,
    model: MODEL,
  };

  // Route by decision.
  if (mod.decision === 'block') {
    // Store nothing. Generic safety message — do not echo specifics.
    console.log('[open-pages/moderate] BLOCK | categories:', JSON.stringify(mod.categories));
    return json({
      status: 'rejected',
      reason: 'This post can’t be published because it appears to violate our community guidelines.',
    });
  }

  if (mod.decision === 'flag') {
    const record = pendingRecord(moderation);
    try {
      await writePaths(fbDb, accessToken, { [`${OPEN_PAGES_PENDING_NODE}/${postId}`]: record });
    } catch (e) {
      console.error('[open-pages/moderate] pending write failed:', e.message);
      return json({ error: 'Failed to store submission.' }, 500);
    }
    return json({ status: 'pending', postId, edited: isEdit });
  }

  // pass -> publish to public feed + mirror to the per-author index.
  //
  // On an EDIT this is the ONLY path that writes open_pages/{postId}, and it writes
  // the new body and the FRESH verdict in the same atomic PATCH — the two can never
  // again come apart, which is the whole of R35's serious fix.
  const record = { ...base, status: OPEN_PAGE_STATUS.LIVE, moderation };
  const paths = {
    [`${OPEN_PAGES_NODE}/${postId}`]: record,
    [`${USER_OPEN_PAGES_NODE}/${uid}/${postId}`]: record,
  };

  // R38 — ANNOUNCE IT IN THE SQUARE, IN THIS SAME PATCH.
  //
  // The room is the island's only daily habit, and a piece that publishes into silence
  // reaches only whoever happens to scroll. Putting the write in the SAME multi-path
  // PATCH as the publish is what makes the round's hard constraint structural rather
  // than hopeful: the announcement cannot land before the piece, because it lands WITH
  // it or not at all. And it is only ever reached on a `pass` — a flagged, pending,
  // blocked or rate-limited submission returns long before this line, so nothing
  // unscreened is ever announced.
  //
  // An EDIT is not announced. The room is told when a piece arrives, not every time its
  // author fixes a typo — R37 made editing cheap on purpose, and an announcement per
  // save would turn the one daily habit into a changelog.
  if (!isEdit) {
    const squareId = generatePushId(now);
    const announcement = buildAnnouncement(snapshot, profile, { title: cleanTitle, postId, now });
    paths[`square_posts/${squareId}`] = announcement;
    // The per-author mirror holds the WHOLE record, exactly as app/square/page.js's
    // mirrorToUserPosts does (it sets postData, not a stub) — a mirror row with a
    // different shape from the client's is a divergence waiting to be found by a
    // profile page rendering half a card.
    paths[`user_square_posts/${uid}/${squareId}`] = announcement;
  }
  // A passing edit supersedes any revision of the same post still sitting in the
  // queue. Left behind, an admin could later approve the stale one and silently
  // revert the piece to an older body.
  if (isEdit) paths[`${OPEN_PAGES_PENDING_NODE}/${postId}`] = null;
  try {
    await writePaths(fbDb, accessToken, paths);
  } catch (e) {
    console.error('[open-pages/moderate] publish write failed:', e.message);
    return json({ error: 'Failed to publish post.' }, 500);
  }

  // A new post is now live — kick the Cloudflare deploy hook so the static export
  // rebuilds and the post's /open-pages/[id] URL is pre-rendered (never 404s).
  // TEMP DIAGNOSTIC: await the hook and surface its outcome in the response body
  // (hookStatus) so we can confirm whether it fires — Pages Functions have no
  // dashboard-accessible console logs without Workers Logs. A hook failure still
  // must not fail the response, so the call is wrapped in try/catch.
  let hookStatus = 'not_called';
  const hook = resolveHook(env, 'openPages');
  if (!hook.ok) {
    // Named, not swallowed. 'unconfigured' here means OPEN_PAGES_DEPLOY_HOOK_URL is absent from
    // the Pages environment and every auto-published post will 404 on its detail page until
    // some unrelated deploy runs — which is exactly the class of silence this round exists to
    // end. It still must not fail the publish: the post IS live.
    console.error('[open-pages/moderate] no deploy hook:', hook.reason);
    hookStatus = 'unconfigured';
  } else {
    const shot = await fire(hook.url, HOOK_TIMEOUT_MS);
    hookStatus = shot.ok ? 'ok_' + shot.status : (shot.reason === 'refused' ? 'fail_' + shot.status : 'error_unreachable');
  }

  return json({ status: 'published', postId, hookStatus, edited: isEdit });
}

// users/{uid} profile path helper (kept inline so the function is self-describing).
function USER_PROFILE_PATH(uid) {
  return `users/${uid}`;
}
