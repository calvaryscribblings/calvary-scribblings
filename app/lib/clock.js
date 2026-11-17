// CLOCK-1 (ruling 399) — THE CLOCK'S SWITCH AND ITS HEARTBEAT, for scripts/launch-check.mjs.
//
// calvary-clock (workers-external/calvary-clock/) dispatches the scheduled workflows on time. Its
// heartbeat is the Worker's own GET /heartbeat: when it last ticked, its mode, and when GitHub last
// accepted a dispatch from it. The launch check reads it the way it reads the drain's.
//
// ARMED in CLOCK-4 (17 Nov 2026): CLOCK_MODE is 'live' on the Worker and its cron runs every minute. The
// first live dispatches (04:30 and 04:37 London) were accepted by GitHub. Set CLOCK_ARMED back to false
// only together with unsetting CLOCK_MODE (docs/CLOCK-1.md).
//
// Plain data and arithmetic, no network.

/** Armed with the Worker's cron, in the go-live round. */
export const CLOCK_ARMED = true;
/** The Worker's heartbeat address (https://…/heartbeat). Set with CLOCK_ARMED. */
export const CLOCK_HEARTBEAT_URL = 'https://calvary-clock.calvarymediauk.workers.dev/heartbeat';

/** The clock ticks every minute, and some workflow is due at least every 8 minutes (:00 :05 :07 :15
 *  :22 :30 :37 :45 :52), so the last ACCEPTED dispatch is never more than ~8 minutes old when well.
 *  Red after 20: two missed proofs-mail slots and a missed quarter-hour, not one slow answer. */
export const CLOCK_STALE_MS = 20 * 60 * 1000;
/** And the clock itself must have ticked within this. */
export const CLOCK_TICK_STALE_MS = 5 * 60 * 1000;

/**
 * Judge the heartbeat. `hb` is the parsed JSON (or null when it could not be read). Returns
 * { ok, evidence } — times and a status code only.
 */
export function judgeClockHeartbeat(hb, now, { staleMs = CLOCK_STALE_MS, tickStaleMs = CLOCK_TICK_STALE_MS } = {}) {
  if (!hb || typeof hb !== 'object') return { ok: false, evidence: 'heartbeat unreadable' };
  const tickAt = Number(hb.tickAt), okAt = Number(hb.lastOkAt), failAt = Number(hb.lastFailAt);
  const age = (t) => (Number.isFinite(t) ? `${Math.round((now - t) / 60000)} min ago` : 'never');
  const parts = [`ticked ${age(tickAt)}`, `mode ${hb.mode ?? '?'}`, `GitHub last accepted ${age(okAt)}`];
  if (Number.isFinite(failAt) && (!Number.isFinite(okAt) || failAt > okAt)) parts.push(`last refusal ${age(failAt)} (${hb.lastFailStatus ?? '?'})`);
  const ok = hb.mode === 'live'
    && Number.isFinite(tickAt) && now - tickAt <= tickStaleMs
    && Number.isFinite(okAt) && now - okAt <= staleMs;
  return { ok, evidence: `${parts.join('; ')}; stale after ${Math.round(staleMs / 60000)} min` };
}
