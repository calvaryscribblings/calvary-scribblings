// PROOFS-R3 / R3.1 (rulings 290–292) — POST /api/proofs/writers. FOUNDERS ONLY.
//
//   credential: Authorization: Bearer <Firebase ID token>, and isFounder(uid) on the server
//   body:  { action: 'list' }                 → { open, queued, writers: [{ uid, name, scheduled, hasAddress, state, emailedAt, openingSent }] }
//          { action: 'open', include: [uid] } → ONE atomic write: the ticked queued, the rest excluded, the switch open
//          { action: 'send' }                 → one budgeted batch of emails → { …counts, more }; the page calls it until more is false
//          { action: 'close' }                → closes Proofs (sends nothing)
//          { action: 'include', uid }         → "Email them": queues one writer (the page then runs send)
//          { action: 'sample' }               → every writer email, with invented stories, to the
//                                               signed-in founder's OWN address (from their Auth record)
//
// R3.1: every call fits in 50 subrequests (functions/api/proofs/_mail.js, Budget). Every failure
// answers JSON { error, code } with status 500, never 502, so the page can always show both.
import { readBody, readIdToken, respond, configured } from './_proofs.js';
import { lookupUser } from '../bookstore/_lib.js';
import { isFounder } from '../../../app/lib/founders.js';
import { isId } from '../../../app/lib/ids.js';
import { mailable } from '../../../app/lib/proofMail.js';
import { Budget, mintMailToken, writerList, openProofs, closeProofs, includeWriter, runSend, sendSamples } from './_mail.js';

const FAIL = (code, error, status) => respond({ error, code }, status);
const ACTIONS = ['list', 'open', 'send', 'close', 'include', 'sample'];

export async function handleWriters(context, { now = Date.now(), founders = isFounder, pause, limit } = {}) {
  const { request, env } = context;
  if (!configured(env)) return FAIL('misconfigured', 'Proofs isn’t configured yet.', 500);
  const body = await readBody(request);
  if (body === null) return FAIL('bad_request', 'Invalid request body.', 400);
  const action = body.action;
  if (!ACTIONS.includes(action)) return FAIL('bad_request', 'Unknown action.', 400);
  if (action === 'open' && (!Array.isArray(body.include) || body.include.length > 1000 || !body.include.every((u) => isId('uid', u)))) {
    return FAIL('bad_request', 'include must be a list of account ids.', 400);
  }
  if (action === 'include' && !isId('uid', body.uid)) return FAIL('bad_request', 'uid required.', 400);

  const budget = new Budget(limit);
  const idToken = readIdToken(request, body);
  if (!idToken) return FAIL('signed_out', 'Please sign in.', 401);
  budget.take(1);
  const me = await lookupUser(idToken, env.NEXT_PUBLIC_FIREBASE_API_KEY).catch(() => null);
  if (!me?.localId) return FAIL('signed_out', 'Your session has expired. Please sign in again.', 401);
  if (founders(me.localId) !== true) return FAIL('forbidden', 'This is for the founders.', 403);
  const by = me.localId;

  try {
    if (action === 'sample') {
      // The founder's own address, from Google's answer to their own token — never from the body.
      if (!mailable(me)) return FAIL('no_address', 'Your account has no verified email address.', 409);
      const r = await sendSamples(env, budget, { to: me.email, now, pause });
      console.log(`[proofs-mail] samples: ${JSON.stringify({ ...r, used: budget.used })}`);
      return respond(r);
    }
    const token = await mintMailToken(env, budget);
    if (action === 'list') return respond(await writerList(env, token, budget, now));
    if (action === 'open') return respond(await openProofs(env, token, budget, { by, include: body.include, now }));
    if (action === 'send') return respond(await runSend(env, token, budget, { now, pause }));
    if (action === 'close') return respond(await closeProofs(env, token, budget, { by, now }));
    if (action === 'include') return respond(await includeWriter(env, token, budget, { by, uid: body.uid, now }));
  } catch (e) {
    const code = e?.code === 'budget' ? 'budget' : 'unavailable';
    console.error(`[proofs-mail] ${action} failed (${code}, ${e?.name || 'Error'}: ${String(e?.message || '').slice(0, 80)}, used ${budget.used})`);
    return FAIL(code, String(e?.message || 'That couldn’t be done just now.').slice(0, 120), 500);
  }
  return FAIL('bad_request', 'Unknown action.', 400);
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return handleWriters(context);
  return respond({ error: 'Use POST.', code: 'method_not_allowed' }, 405);
}
