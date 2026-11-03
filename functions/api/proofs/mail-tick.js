// PROOFS-R3 (ruling 291) — POST /api/proofs/mail-tick: the scheduled, date-changed and 48-hour
// writer emails. Called every 15 minutes by .github/workflows/proofs-mail.yml with the ops service
// token (functions/api/ops/_opsAuth.js), or by a founder by hand. Takes no input: what is due is
// read from the database, so a caller can't steer who is emailed or about what.
//   → 200 { open, writers, opening, scheduled, changed, reminder, failed, excluded, noAddress, raced }
import { respond, configured } from './_proofs.js';
import { authoriseOps } from '../ops/_opsAuth.js';
import { mintMailToken, runTick } from './_mail.js';

export async function handleTick(context, { now = Date.now(), authorise = authoriseOps, pause } = {}) {
  const { request, env } = context;
  if (!configured(env)) return respond({ error: 'Proofs isn’t configured yet.', code: 'misconfigured' }, 500);
  const who = await authorise(request, env);
  if (!who?.ok) return respond({ error: 'Not authorised.', code: 'forbidden' }, who?.status || 403);
  try {
    return respond(await runTick(env, await mintMailToken(env), { now, pause }));
  } catch (e) {
    console.error(`[proofs-mail] tick failed (${e?.name || 'Error'}: ${String(e?.message || '').slice(0, 80)})`);
    return respond({ error: 'The tick failed.', code: 'unavailable' }, 502);
  }
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return handleTick(context);
  return respond({ error: 'Use POST.', code: 'method_not_allowed' }, 405);
}
