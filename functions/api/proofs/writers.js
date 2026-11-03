// PROOFS-R3 (rulings 290–292) — POST /api/proofs/writers. FOUNDERS ONLY.
//
//   credential: Authorization: Bearer <Firebase ID token>, and isFounder(uid) on the server
//   body:  { action: 'list' }                → { open, writers: [{ uid, name, scheduled, hasAddress, state, emailedAt, openingSent }] }
//          { action: 'open', include: [uid] } → opens Proofs and sends the opening email to the ticked
//                                              writers (functions/api/proofs/_mail.js, openProofs)
//          { action: 'close' }               → closes Proofs (sends nothing)
//          { action: 'include', uid }        → "Email them": the opening email to one writer not yet sent it
//          { action: 'sample' }              → every writer email, with invented stories, to the
//                                              signed-in founder's OWN address (from their Auth record)
//
// The switch is server-written now (proofs_access .write false for every client), so Open can't
// skip the list: opening and the opening emails are one step. No address ever leaves this handler.
import { readBody, readIdToken, respond, configured } from './_proofs.js';
import { lookupUser } from '../bookstore/_lib.js';
import { isFounder } from '../../../app/lib/founders.js';
import { isId } from '../../../app/lib/ids.js';
import { mailable } from '../../../app/lib/proofMail.js';
import { mintMailToken, writerList, openProofs, closeProofs, includeWriter, sendSamples } from './_mail.js';

const FAIL = (code, error, status) => respond({ error, code }, status);

export async function handleWriters(context, { now = Date.now(), founders = isFounder, pause } = {}) {
  const { request, env } = context;
  if (!configured(env)) return FAIL('misconfigured', 'Proofs isn’t configured yet.', 500);
  const body = await readBody(request);
  if (body === null) return FAIL('bad_request', 'Invalid request body.', 400);
  const action = body.action;
  if (!['list', 'open', 'close', 'include', 'sample'].includes(action)) return FAIL('bad_request', 'Unknown action.', 400);
  if (action === 'open' && (!Array.isArray(body.include) || body.include.length > 200 || !body.include.every((u) => isId('uid', u)))) {
    return FAIL('bad_request', 'include must be a list of account ids.', 400);
  }
  if (action === 'include' && !isId('uid', body.uid)) return FAIL('bad_request', 'uid required.', 400);

  const idToken = readIdToken(request, body);
  if (!idToken) return FAIL('signed_out', 'Please sign in.', 401);
  const me = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
  if (!me?.localId) return FAIL('signed_out', 'Your session has expired. Please sign in again.', 401);
  if (founders(me.localId) !== true) return FAIL('forbidden', 'This is for the founders.', 403);
  const by = me.localId;

  try {
    if (action === 'sample') {
      // The founder's own address, from Google's answer to their own token — never from the body.
      if (!mailable(me)) return FAIL('no_address', 'Your account has no verified email address.', 409);
      const r = await sendSamples(env, { to: me.email, now, pause });
      console.log(`[proofs-mail] samples: ${JSON.stringify(r)}`);
      return respond(r);
    }
    const token = await mintMailToken(env);
    if (action === 'list') return respond(await writerList(env, token, now));
    if (action === 'open') return respond(await openProofs(env, token, { by, include: body.include, now, pause }));
    if (action === 'close') return respond(await closeProofs(env, token, { by, now }));
    if (action === 'include') return respond(await includeWriter(env, token, { by, uid: body.uid, now }));
  } catch (e) {
    console.error(`[proofs-mail] ${action} failed (${e?.name || 'Error'}: ${String(e?.message || '').slice(0, 80)})`);
    return FAIL('unavailable', String(e?.message || 'That couldn’t be done just now.').slice(0, 120), 502);
  }
  return FAIL('bad_request', 'Unknown action.', 400);
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return handleWriters(context);
  return respond({ error: 'Use POST.', code: 'method_not_allowed' }, 405);
}
