// LIMITS-1 — Cloudflare's subrequest limit, counted before every outbound call.
//
// A Pages Function may make 50 subrequests per request on the plan this site is built for, and
// holds at most 6 connections open at once (the rest wait). The 51st fetch throws "Too many
// subrequests" and the request dies wherever it was. PROOFS-R3.1 found that limit the hard way and
// built the pattern in functions/api/proofs/_mail.js; this is that Budget, now the ONLY one: Proofs
// (_mail.js re-exports it), admin/reset-attempt (bulk) and account/delete all plan to it.
//
// THE HEADROOM (LIMITS-1, ship). Every budgeted call is PLANNED to SUBREQUEST_BUDGET = 45, not to the
// platform's 50. The 5 left over are for what the counter cannot see: a key fetch on a cold start, a
// retry inside a library, anything the runtime adds. SUBREQUEST_LIMIT stays 50 because it is the
// platform's figure, and the limit shims enforce exactly that; tests assert every request <= 45.
//
//   const budget = new Budget();
//   budget.take(1); await fetch(…)      // or: await budget.fetch(url, init)
//   if (!budget.fits(n)) → stop, answer { more: true }, and let the caller call again.
//
// A request that runs out stops before the call that would overrun, never after it.

/** The platform's hard limit (what the test shims enforce). Never plan to it. */
export const SUBREQUEST_LIMIT = 50;
/** What every budgeted call plans to: 5 under the limit. The one constant; change it here only. */
export const SUBREQUEST_BUDGET = 45;
/** The 5 subrequests no Budget counts. */
export const SUBREQUEST_HEADROOM = SUBREQUEST_LIMIT - SUBREQUEST_BUDGET;

export class BudgetExceeded extends Error {
  constructor() { super('subrequest budget exceeded'); this.name = 'BudgetExceeded'; this.code = 'budget'; }
}

export class Budget {
  constructor(limit = SUBREQUEST_BUDGET) { this.limit = limit; this.used = 0; }
  get left() { return this.limit - this.used; }
  fits(n) { return this.used + n <= this.limit; }
  take(n = 1) { if (!this.fits(n)) throw new BudgetExceeded(); this.used += n; }
  /** Charged first, then made. */
  fetch(url, init) { this.take(1); return fetch(url, init); }
}

/** Run `fn` over `items`, at most `width` at a time (workerd allows 6 open connections). */
export async function pooled(items, width, fn) {
  const out = new Array(items.length);
  let next = 0;
  const lane = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
  return out;
}
