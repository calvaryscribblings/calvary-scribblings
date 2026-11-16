// CLOCK-1.1 — ONCE. A scheduled job that the clock (workers-external/calvary-clock) and GitHub's own
// schedule can both start claims what it is about to do, in the database, before doing it. The claim
// is a transaction, so of two runs at once exactly one wins; the other sees the claim and stands down.
//
// A claim records a state:
//   claimed   a run is doing it now (or died doing it: after LEASE_MS another run may take it over)
//   failed    the run that claimed it could not finish: a later run may take it at once
//   done / sent / quiet   finished: nobody takes it again
//
// The lease is longer than the job can live (each workflow that uses this sets timeout-minutes
// below it), so a claim that is still inside its lease belongs to a run that may yet finish.
//
// Pure: the functions below are what goes inside db.ref(path).transaction(…). The callers write
// through scripts/safety/guard.mjs.

export const LEASE_MS = 15 * 60 * 1000;

/** May this run take a claim whose current value is `cur`? */
export function claimable(cur, now, leaseMs = LEASE_MS) {
  if (!cur || typeof cur !== 'object') return true;
  if (cur.state === 'failed') return true;
  if (cur.state === 'claimed') return now - (Number(cur.at) || 0) >= leaseMs;
  return false;
}

/** The transaction that takes the claim: `record` if free, else abort (undefined). */
export const takeFn = (record, now, { leaseMs = LEASE_MS, free = () => false } = {}) =>
  (cur) => (free(cur) || claimable(cur, now, leaseMs) ? record : undefined);

/** The transaction that settles it, only if it is still this run's. */
export const settleFn = (runId, patch) =>
  (cur) => (cur && typeof cur === 'object' && cur.runId === runId ? { ...cur, ...patch } : undefined);

/** A run id for the record: the Actions run where there is one. Not a secret, and not a person. */
export const runIdOf = (env = process.env, now = Date.now()) =>
  `${String(env.GITHUB_RUN_ID || 'local').replace(/[^0-9a-z-]/gi, '')}-${process.pid}-${now}`;
