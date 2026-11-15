// push-drain-ping — Cloudflare Worker (P4-B1, docs/PUSH-P4.md). DASHBOARD-PASTED: keep byte-identical.
// Its cron (* * * * *) is THE SWITCH for personal pushes. It holds one secret, PUSH_DRAIN_SECRET,
// set in the dashboard and never written here. It calls the drain until there's nothing more, at most
// 20 times a minute (each call answers in about a second), and logs status codes only.
//
// P4-B5 (ruling 373): it is also the consumer of the push-wake queue. notify sends one wake-up when
// its own instant send leaves entries behind; queue() runs the same loop at once, marked ?via=wake so
// the drain writes lastWake, not the cron's heartbeat. The wake-up names nobody: the drain reads its
// own queue. Lease held (409) or the drain unreachable: try again in WAKE_RETRY_S, at most
// WAKE_ATTEMPTS tries (app/lib/pushP4.js keeps the same numbers), then leave it to the cron. The
// drain's lease and claims mean nothing is ever sent twice, whoever calls.
const DRAIN = 'https://calvaryscribblings.co.uk/api/push/drain';
const WAKE_ATTEMPTS = 3;
const WAKE_RETRY_S = 15;

/** Call the drain until it has nothing more: 'done', 'more' (20 calls), a failing status, or 'error'. */
async function drainLoop(env, url) {
  for (let i = 0; i < 20; i++) {
    let res;
    try { res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${env.PUSH_DRAIN_SECRET}` } }); } catch { console.error('push-drain-ping: unreachable'); return 'error'; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { console.error(`push-drain-ping: ${res.status}`); return res.status; }
    if (body.more !== true) return 'done';
  }
  return 'more';
}

export default {
  async scheduled(event, env) {
    if (!env.PUSH_DRAIN_SECRET) { console.error('push-drain-ping: no PUSH_DRAIN_SECRET'); return; }
    await drainLoop(env, DRAIN);
  },
  async queue(batch, env) {
    if (!env.PUSH_DRAIN_SECRET) { console.error('push-drain-ping: no PUSH_DRAIN_SECRET'); batch.ackAll(); return; }
    const out = await drainLoop(env, `${DRAIN}?via=wake`);
    const tries = Math.max(1, ...batch.messages.map((m) => Number(m.attempts) || 1));
    const again = out === 'error' || out === 409 || (typeof out === 'number' && out >= 500);
    if (again && tries < WAKE_ATTEMPTS) batch.retryAll({ delaySeconds: WAKE_RETRY_S });
    else batch.ackAll();
  },
};
