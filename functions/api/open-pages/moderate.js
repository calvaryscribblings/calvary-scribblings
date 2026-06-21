// Open Pages — AI moderation Pages Function (Stage 2).
//
// POST /api/open-pages/moderate   body: { uid, title, body }  (body is Markdown)
//
// Reads a submitted post, asks Claude (Haiku) to moderate it, and routes it:
//   pass  -> public open_pages/{postId} (status:'live')   + user_open_pages mirror -> { status:'published' }
//   flag  -> open_pages_pending/{postId} (status:'flagged') for admin review        -> { status:'pending' }
//   block -> stored nowhere; generic rejection returned                             -> { status:'rejected' }
//
// FAIL CLOSED: if the Claude call fails or returns unparseable output, the post is
// routed to open_pages_pending (status:'flagged', reason:'moderation-unavailable').
// Nothing un-screened ever reaches the public feed.
//
// This is a Cloudflare Pages Function (onRequestPost), modelled on the working
// functions/api/generate-quiz.js — it reads env via context.env and calls Anthropic
// with x-api-key. It does NOT verify a Firebase token (the token-verify path had
// runtime issues); the `uid` is taken from the body. The real security boundary is
// the RTDB rules: clients cannot write to the public open_pages node — only this
// function can, using the Firebase Admin service-account credentials in the Pages
// env (FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL / FIREBASE_DATABASE_URL), the
// same credentials record-attempt.js / the admin functions use. A forged `uid`
// could mis-attribute a post, but cannot bypass moderation or publish directly.
//
// Trustworthy snapshot: the author's name/handle/avatar are fetched server-side from
// users/{uid} — client-sent author fields are ignored beyond `uid`.

import {
  OPEN_PAGES_NODE,
  OPEN_PAGES_PENDING_NODE,
  USER_OPEN_PAGES_NODE,
  OPEN_PAGE_STATUS,
  buildAuthorSnapshot,
  buildPendingPost,
} from '../../../app/lib/openPages.js';

const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';

const MODEL = 'claude-haiku-4-5';
const TITLE_MAX = 200;
const BODY_MAX = 50000;

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

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { uid, title, body: postBody } = body || {};
  console.log('[open-pages/moderate] uid:', uid, '| ANTHROPIC set:', !!env.ANTHROPIC_API_KEY);

  // Server-side validation.
  if (!uid || typeof uid !== 'string') return json({ error: 'uid required.' }, 400);
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
  const postId = generatePushId(now);

  // Base record (status PENDING, moderation null) — status + moderation set per decision below.
  const base = buildPendingPost(snapshot, { title: cleanTitle, body: cleanBody }, now);

  // Moderate — fail closed on any error.
  let mod;
  try {
    mod = await moderateWithClaude(env, cleanTitle, cleanBody);
  } catch (e) {
    console.error('[open-pages/moderate] moderation failed, failing closed to pending:', e.message);
    const record = {
      ...base,
      status: OPEN_PAGE_STATUS.FLAGGED,
      moderation: {
        decision: 'flag',
        categories: ['moderation-unavailable'],
        reason: 'moderation-unavailable',
        checkedAt: now,
        model: MODEL,
      },
    };
    try {
      await writePaths(fbDb, accessToken, { [`${OPEN_PAGES_PENDING_NODE}/${postId}`]: record });
    } catch (writeErr) {
      console.error('[open-pages/moderate] fail-closed write failed:', writeErr.message);
      return json({ error: 'Failed to store submission.' }, 500);
    }
    return json({ status: 'pending', postId });
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
    const record = { ...base, status: OPEN_PAGE_STATUS.FLAGGED, moderation };
    try {
      await writePaths(fbDb, accessToken, { [`${OPEN_PAGES_PENDING_NODE}/${postId}`]: record });
    } catch (e) {
      console.error('[open-pages/moderate] pending write failed:', e.message);
      return json({ error: 'Failed to store submission.' }, 500);
    }
    return json({ status: 'pending', postId });
  }

  // pass -> publish to public feed + mirror to the per-author index.
  const record = { ...base, status: OPEN_PAGE_STATUS.LIVE, moderation };
  try {
    await writePaths(fbDb, accessToken, {
      [`${OPEN_PAGES_NODE}/${postId}`]: record,
      [`${USER_OPEN_PAGES_NODE}/${uid}/${postId}`]: record,
    });
  } catch (e) {
    console.error('[open-pages/moderate] publish write failed:', e.message);
    return json({ error: 'Failed to publish post.' }, 500);
  }
  return json({ status: 'published', postId });
}

// users/{uid} profile path helper (kept inline so the function is self-describing).
function USER_PROFILE_PATH(uid) {
  return `users/${uid}`;
}
