// POST /api/account/delete — delete the signed-in reader's account. Web and app alike.
//
//   Authorization: Bearer <Firebase ID token>      (or body { idToken })
//
//   200 { deleted: true, uid, scrub: 'queued' }
//   401 { code: 'signed_out' }                     no token, or one Google does not accept
//   401 { code: 'requires_recent_login', maxAgeSeconds: 300 }
//                                                  → reauthenticate, then call again
//   403 { code: 'house_account' }                  a founder account; never deleted from here
//   429 / 503                                      the house limiter (limitResponse)
//   500 { code: 'delete_failed', step }            a step failed; NOTHING is claimed. Calling
//                                                  again resumes from that step.
//
// The whole sequence and its reasons are in ./_deletion.js.

import { consume, limitResponse, capFromEnv } from '../_ratelimit.js';
import {
  json, lookupUser, mintAccessToken, decodeJwtPayload, judgeIdentity, runDeletion, realIo,
  ADMIN_SCOPES, StepError, RECENT_LOGIN_S,
} from './_deletion.js';

const LABEL = 'account/delete';

// THE DERIVATION. A reader deletes their account once. A retry after a failed step, or after a
// reauthentication, makes it a handful. 5 a minute and 20 a day per uid is several times that;
// 200 a day across everyone is far above any real day and still bounds what a flood of fresh
// accounts could make this endpoint spend.
export const DELETE_CAPS = (env, uid) => ([
  { scope: 'acctdel', period: 'minute', id: uid, limit: capFromEnv(env, 'ACCOUNT_DELETE_MINUTE_CAP', 5) },
  { scope: 'acctdel', period: 'day', id: uid, limit: capFromEnv(env, 'ACCOUNT_DELETE_DAY_CAP', 20) },
  { scope: 'acctdel', period: 'day', limit: capFromEnv(env, 'ACCOUNT_DELETE_GLOBAL_DAY_CAP', 200) },
]);

function readIdToken(request, body) {
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('Authorization') || '').trim());
  if (m && m[1].trim()) return m[1].trim();
  return typeof body?.idToken === 'string' && body.idToken ? body.idToken : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error(`[${LABEL}] credentials not configured`);
    return json({ error: 'Account deletion is unavailable right now. Please try again later.', code: 'not_configured' }, 500);
  }

  let body = {};
  const raw = await request.text().catch(() => '');
  if (raw && raw.trim()) { try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid request body.' }, 400); } }

  const idToken = readIdToken(request, body);
  if (!idToken) return json({ error: 'Sign in to delete your account.', code: 'signed_out' }, 401);

  // accounts:lookup is the verification: Google refuses a forged, expired or revoked token.
  // Only after it has accepted this one is the payload read, for auth_time.
  const user = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);

  // THE LOST RESPONSE. If the last run deleted the Auth account and the answer never reached the
  // client, its retry carries a token Google now rejects. Answer that retry truthfully rather
  // than with 'signed_out', which a client would show as a failure: the record says whether the
  // Auth step completed. (It tells a caller only that a uid finished deleting — which the
  // absence of its public profile already says.)
  if (!user) {
    const claimed = decodeJwtPayload(idToken)?.sub;
    if (typeof claimed === 'string' && /^[A-Za-z0-9]{1,128}$/.test(claimed)) {
      try {
        const t = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'), ADMIN_SCOPES);
        const rec = await realIo(env, t).get(`deletions/${claimed}`);
        if (rec?.steps?.auth) return json({ deleted: true, uid: claimed, scrub: rec.steps.scrub ? 'done' : 'queued', already: true });
      } catch (e) { console.error(`[${LABEL}] lost-response probe failed:`, e?.message); }
    }
  }

  const verdict = judgeIdentity({ user, payload: user ? decodeJwtPayload(idToken) : null, nowS: Math.floor(Date.now() / 1000) });
  if (!verdict.ok) {
    const { status, ...rest } = verdict;
    delete rest.ok;
    return json(rest, status);
  }
  const { uid, email } = verdict;

  const limit = await consume(context, DELETE_CAPS(env, uid));
  if (!limit.ok) {
    console.warn(`[${LABEL}] refused | uid: ${uid} | ${limit.reason}`);
    return limitResponse(limit);
  }

  let token;
  try {
    token = await mintAccessToken(env.FIREBASE_CLIENT_EMAIL, (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'), ADMIN_SCOPES);
  } catch (e) {
    console.error(`[${LABEL}] could not mint a credential:`, e?.message);
    return json({ error: 'Account deletion is unavailable right now. Please try again later.', code: 'delete_failed', step: 'credential' }, 500);
  }

  try {
    await runDeletion(uid, email, realIo(env, token));
  } catch (e) {
    const step = e instanceof StepError ? e.step : 'unknown';
    console.error(`[${LABEL}] FAILED uid=${uid} step=${step}:`, e?.message || e);
    return json({
      error: 'We could not finish deleting your account. Please try again — it will pick up where it stopped.',
      code: 'delete_failed', step,
    }, 500);
  }

  console.log(`[${LABEL}] deleted uid=${uid}; scrub queued`);
  return json({ deleted: true, uid, scrub: 'queued', recentLoginSeconds: RECENT_LOGIN_S });
}
