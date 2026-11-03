// PROOFS-R3 (ruling 291) — the */15 poke behind the writer emails.
//
//   node scripts/proofs/mail-tick.mjs
//
// Signs the ops service token (the launch check's, verified by functions/api/ops/_opsAuth.js) and
// POSTs /api/proofs/mail-tick (again while it answers more: true; each call is one batch within 50
// subrequests), which does the work in the Pages project, where the mail credentials
// and the ledger code live (functions/api/proofs/_mail.js says why). This script reads and writes no
// database itself, so SAFETY-1's guard has nothing to wrap here: every ledger write is the
// Function's, one record at a time, by compare-and-swap.
//
// Prints counts only (W12: the Actions log is public).
import { pathToFileURL } from 'node:url';
import { readServiceAccountFile, readSaKeySecret } from '../security/service-account.mjs';
import { opsToken } from '../launch-check.mjs';

export const SITE = process.env.SITE_URL || 'https://calvaryscribblings.co.uk';
const KEYS = ['open', 'writers', 'opening', 'scheduled', 'changed', 'reminder', 'failed', 'excluded', 'noAddress', 'raced', 'interrupted', 'more', 'used'];
/** R3.1: each call is one budgeted batch; call again while it answers more: true, up to this many. */
export const MAX_CALLS = 40;

/** Only the counts, whatever the endpoint answers: nothing else from it reaches the log. */
export const countsLine = (j) => KEYS.map((k) => `${k}=${typeof j?.[k] === 'number' || typeof j?.[k] === 'boolean' ? j[k] : '?'}`).join(' ');

function serviceAccount() {
  if (process.env.PROOFS_SERVICE_ACCOUNT) return readServiceAccountFile(process.env.PROOFS_SERVICE_ACCOUNT);
  if (process.env.FIREBASE_SA_KEY) return readSaKeySecret(process.env.FIREBASE_SA_KEY);
  return readServiceAccountFile('serviceAccountKey.json');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const sa = serviceAccount();
  let ok = true;
  for (let call = 1; call <= MAX_CALLS; call++) {
    const res = await fetch(`${SITE}/api/proofs/mail-tick`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${opsToken(sa)}` },   // fresh token each call
      body: '{}',
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    console.log(`[proofs-mail] call ${call} HTTP ${res ? res.status : 'unreachable'} ${countsLine(j)}`);
    if (!res || !res.ok) { ok = false; break; }
    if (j.more !== true) break;
    if (call === MAX_CALLS) console.log('[proofs-mail] stopped at the call cap with more to do; the next run continues');
  }
  if (!ok) process.exit(1);
}
