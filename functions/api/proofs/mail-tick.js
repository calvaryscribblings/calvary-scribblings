// PROOFS-R3 / R3.1 (ruling 291) — POST /api/proofs/mail-tick: one budgeted batch of writer emails
// (queued openings first, then scheduled / date changed / 48 hours). Called by
// .github/workflows/proofs-mail.yml with the ops service token (functions/api/ops/_opsAuth.js), in a
// loop until it answers more: false; or by a founder by hand. Takes no input: what is due is read
// from the database, so a caller can't steer who is emailed or about what.
//   → 200 { open, writers, opening, scheduled, changed, reminder, failed, excluded, noAddress, raced, interrupted, more, used }
import { respond, configured } from './_proofs.js';
import { authoriseOps } from '../ops/_opsAuth.js';
import { Budget, mintMailToken, runSend } from './_mail.js';

/** authoriseOps makes at most 2 subrequests (Google's key list, or the founder's token lookup). */
export const AUTH_COST = 2;

export async function handleTick(context, { now = Date.now(), authorise = authoriseOps, pause, limit } = {}) {
  const { request, env } = context;
  if (!configured(env)) return respond({ error: 'Proofs isn’t configured yet.', code: 'misconfigured' }, 500);
  const budget = new Budget(limit);
  budget.take(AUTH_COST);
  const who = await authorise(request, env);
  if (!who?.ok) return respond({ error: 'Not authorised.', code: 'forbidden' }, who?.status || 403);
  try {
    return respond(await runSend(env, await mintMailToken(env, budget), budget, { now, pause }));
  } catch (e) {
    const code = e?.code === 'budget' ? 'budget' : 'unavailable';
    console.error(`[proofs-mail] tick failed (${code}, ${e?.name || 'Error'}: ${String(e?.message || '').slice(0, 80)}, used ${budget.used})`);
    return respond({ error: 'The tick failed.', code }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return handleTick(context);
  return respond({ error: 'Use POST.', code: 'method_not_allowed' }, 405);
}
