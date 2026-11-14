// push-drain-ping — Cloudflare Worker (P4-B1, docs/PUSH-P4.md). DASHBOARD-PASTED: keep byte-identical.
// Its cron (* * * * *) is THE SWITCH for personal pushes. It holds one secret, PUSH_DRAIN_SECRET,
// set in the dashboard and never written here. It calls the drain until there's nothing more, at most
// 20 times a minute (each call answers in about a second), and logs status codes only.
const DRAIN = 'https://calvaryscribblings.co.uk/api/push/drain';
export default {
  async scheduled(event, env) {
    if (!env.PUSH_DRAIN_SECRET) { console.error('push-drain-ping: no PUSH_DRAIN_SECRET'); return; }
    for (let i = 0; i < 20; i++) {
      const res = await fetch(DRAIN, { method: 'POST', headers: { Authorization: `Bearer ${env.PUSH_DRAIN_SECRET}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.more !== true) { if (!res.ok) console.error(`push-drain-ping: ${res.status}`); return; }
    }
  },
};
