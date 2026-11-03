import { isId } from '../../../app/lib/ids.js';
import { Budget, BudgetExceeded, SUBREQUEST_LIMIT, pooled } from '../_budget.js';
const FB_DB = 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app';
const ADMIN_UIDS = ['XaG6bTGqdDXh7VkBTw4y1H2d2s82', 'GfXFIc0dThZ1cs2SBBQIFao4aSz1'];
const ADMIN_EMAILS = ['ikennaworksfromhome@gmail.com', 'fynbecki@gmail.com'];

// Authorise by UID OR admin email — matches the app's admin rule (commit 3293247).
function isAdmin(caller) {
  if (!caller) return false;
  if (ADMIN_UIDS.includes(caller.uid)) return true;
  const email = caller.email?.toLowerCase();
  return !!email && ADMIN_EMAILS.includes(email);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyAdminToken(budget, token, apiKey) {
  const res = await budget.fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const u = data?.users?.[0];
  return u ? { uid: u.localId ?? null, email: u.email ?? null } : null;
}

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(budget, clientEmail, privateKeyPem) {
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, false, ['sign']
  );
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const header  = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64url(enc.encode(JSON.stringify({
    iss: clientEmail, sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
    iat: now, exp: now + 3600,
  })));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(signingInput));
  const jwt = `${signingInput}.${base64url(sig)}`;
  const tokenRes = await budget.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 200)}`);
  }
  const { access_token } = await tokenRes.json();
  return access_token;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
//
// LIMITS-1. Every outbound call goes through a Budget of 50 (functions/api/_budget.js), counted
// before it is made. PROOFS-R3.1's audit found the bulk reset cost 4 + 2 per reader: from the
// 24th reader on, audit entries were dropped silently, and at 47 the reset itself failed. Now:
//
//   · ONE ATOMIC WRITE PER BATCH. A batch's resets, its attemptCount decrement and one audit entry
//     per reader go in a single multi-path PATCH, so they land together or not at all. A dropped
//     audit entry is no longer possible.
//   · BATCHED UNDER THE BUDGET. 5 fixed (sign-in check, token, the submissions read, this run's
//     audit read, the PATCH) + 1 handle read per reader, so a batch is at most 45 readers. The
//     answer carries { more, runId }; /admin/quiz-resets calls again with the runId until more is
//     false, as /admin/proofs does.
//   · NOTHING DONE TWICE. A run's audit entries are keyed `<runId>-<uid>`, and each batch skips a
//     reader the run has already logged. A reader who retakes the quiz between two batches keeps
//     the new attempt. An interrupted batch either landed whole (its readers are logged, so the
//     next call skips them) or not at all (the next call does it).

const HANDLE_WIDTH = 6;          // connections at once
const BULK_FIXED = 5;            // auth lookup, token, submissions read, run-log read, PATCH
const RUN_ID = /^[-0-9A-Za-z_]{20}$/;
const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
/** A Firebase-style push id: chronological, so the log keeps its order. */
export function pushId(now) {
  let ts = now; const head = new Array(8);
  for (let i = 7; i >= 0; i--) { head[i] = PUSH_CHARS.charAt(ts % 64); ts = Math.floor(ts / 64); }
  const rand = new Uint8Array(12); crypto.getRandomValues(rand);
  return head.join('') + Array.from(rand, (b) => PUSH_CHARS.charAt(b % 64)).join('');
}

async function lookupUsername(budget, fbDb, bearer, uid) {
  try {
    const res = await budget.fetch(`${fbDb}/users/${uid}/username.json`, { headers: bearer });
    if (!res.ok) return null;
    return await res.json() ?? null;
  } catch (e) {
    if (e instanceof BudgetExceeded) throw e;
    return null;
  }
}

async function patchRoot(budget, fbDb, bearer, patch, what) {
  const res = await budget.fetch(`${fbDb}/.json`, {
    method: 'PATCH',
    headers: { ...bearer, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${what} PATCH failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

// ── Single reset / unlock ─────────────────────────────────────────────────────

async function resetSingle(budget, fbDb, bearer, adminUid, targetUid, slug, action, reason, now) {
  const checkRes = await budget.fetch(`${fbDb}/quiz_submissions/${targetUid}/${slug}.json`, { headers: bearer });
  if (!checkRes.ok) throw new Error(`Submission read failed (${checkRes.status})`);
  if ((await checkRes.json()) === null) return { wasReset: false };

  const targetHandle = await lookupUsername(budget, fbDb, bearer, targetUid);

  // One atomic PATCH: null the three paths, decrement attemptCount, and the audit entry with them.
  await patchRoot(budget, fbDb, bearer, {
    [`quiz_submissions/${targetUid}/${slug}`]:   null,
    [`quizAttemptCounted/${targetUid}/${slug}`]: null,
    [`userStoryTiers/${targetUid}/${slug}`]:     null,
    [`cms_stories/${slug}/quizMeta/attemptCount`]: { '.sv': { 'increment': -1 } },
    [`quizResetLog/${pushId(now)}`]: {
      adminUid, targetUid, targetHandle, slug,
      action, reason: reason || null, timestamp: now,
    },
  }, 'Reset');

  console.log(`[admin/reset-attempt] ${action} | 1 reset`);
  return { wasReset: true };
}

// ── Bulk reset, one batch per call ──────────────────────────────────────────────

/** Which readers this batch takes: unlogged by this run, sorted, as many as the budget allows. */
export function planBatch(all, slug, logged, room) {
  const due = Object.keys(all || {}).filter((uid) => all[uid]?.[slug] && !logged.has(uid)).sort();
  return { batch: due.slice(0, Math.max(0, room)), due: due.length };
}

async function resetBulk(budget, fbDb, bearer, adminUid, slug, reason, runId, now) {
  const run = runId || pushId(now);
  const [dbRes, logRes] = await Promise.all([
    budget.fetch(`${fbDb}/quiz_submissions.json`, { headers: bearer }),
    budget.fetch(`${fbDb}/quizResetLog.json?orderBy=${encodeURIComponent('"$key"')}&startAt=${encodeURIComponent(`"${run}-"`)}&endAt=${encodeURIComponent(`"${run}-\uf8ff"`)}`, { headers: bearer }),
  ]);
  if (!dbRes.ok) throw new Error(`Submissions read failed (${dbRes.status})`);
  if (!logRes.ok) throw new Error(`Reset log read failed (${logRes.status})`);
  const all = await dbRes.json();
  const logged = new Set(Object.keys((await logRes.json()) || {}).map((k) => k.slice(run.length + 1)));

  // What is left after the reads: one per handle, and the PATCH.
  const { batch, due } = planBatch(all, slug, logged, budget.left - 1);
  if (batch.length === 0) return { resetCount: 0, remaining: 0, more: false, runId: run };

  const handles = await pooled(batch, HANDLE_WIDTH, (uid) => lookupUsername(budget, fbDb, bearer, uid));

  const patch = {};
  batch.forEach((uid, i) => {
    patch[`quiz_submissions/${uid}/${slug}`]   = null;
    patch[`quizAttemptCounted/${uid}/${slug}`] = null;
    patch[`userStoryTiers/${uid}/${slug}`]     = null;
    patch[`quizResetLog/${run}-${uid}`] = {
      adminUid, targetUid: uid, targetHandle: handles[i], slug,
      action: 'bulk', reason: reason || null, timestamp: now, runId: run,
    };
  });
  patch[`cms_stories/${slug}/quizMeta/attemptCount`] = { '.sv': { 'increment': -batch.length } };
  await patchRoot(budget, fbDb, bearer, patch, 'Bulk');

  const remaining = due - batch.length;
  console.log(`[admin/reset-attempt] bulk batch | ${batch.length} reset, ${remaining} left, ${budget.used} subrequests`);
  return { resetCount: batch.length, remaining, more: remaining > 0, runId: run };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const onRequestPost = (context) => handleReset(context);

/** `opts` is the test seam: `admin` (who may call), `now`, `limit` (the budget). */
export async function handleReset(context, { admin = isAdmin, now = Date.now(), limit = SUBREQUEST_LIMIT } = {}) {
  const { request, env } = context;
  const budget = new Budget(limit);

  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ error: 'Unauthorised.' }, 401);

  const caller = await verifyAdminToken(budget, token, env.NEXT_PUBLIC_FIREBASE_API_KEY);
  if (!admin(caller)) return json({ error: 'Unauthorised.' }, 401);
  const adminUid = caller.uid;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request body.' }, 400); }

  const { uid: targetUid, slug, action = 'reset', reason, runId = null } = body;

  // LIVE-PATHS-1 (SAFETY-1 audit #6): slug '/' collapsed quiz_submissions/<uid>/<slug> onto the
  // reader's whole node. Both ids are checked before any path is built.
  if (!isId('slug', slug)) return json({ error: 'slug required.' }, 400);
  if (!['reset', 'unlock', 'bulk'].includes(action)) return json({ error: 'Invalid action.' }, 400);
  if (action !== 'bulk' && !isId('uid', targetUid)) {
    return json({ error: 'uid required.' }, 400);
  }
  // LIMITS-1: the run id becomes part of an audit key, so it is checked like any other id.
  if (runId !== null && !(typeof runId === 'string' && RUN_ID.test(runId))) {
    return json({ error: 'Invalid runId.' }, 400);
  }

  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const fbDb        = (env.FIREBASE_DATABASE_URL ?? FB_DB).replace(/\/$/, '');

  if (!clientEmail || !privateKey) return json({ error: 'Server misconfigured.' }, 500);

  let accessToken;
  try {
    accessToken = await getAccessToken(budget, clientEmail, privateKey);
  } catch (e) {
    console.error('[admin/reset-attempt] JWT error:', e.message);
    return json({ error: 'Failed to obtain service credentials.' }, 500);
  }

  const bearer = { Authorization: `Bearer ${accessToken}` };

  try {
    if (action === 'bulk') {
      const result = await resetBulk(budget, fbDb, bearer, adminUid, slug, reason, runId, now);
      return json({ ok: true, ...result });
    } else {
      const result = await resetSingle(budget, fbDb, bearer, adminUid, targetUid, slug, action, reason, now);
      return json({ ok: true, ...result });
    }
  } catch (e) {
    console.error('[admin/reset-attempt] error:', e.message);
    return json({ error: e instanceof BudgetExceeded ? 'Out of subrequests; call again.' : e.message, code: e.code || null }, 500);
  }
}
