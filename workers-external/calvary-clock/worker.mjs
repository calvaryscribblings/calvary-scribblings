// calvary-clock — Cloudflare Worker (CLOCK-1, ruling 399). Code goes up from this directory, never
// pasted in the dashboard; docs/CLOCK-1.md is the go-live plan.
//
// ONE CRON TRIGGER, every minute (* * * * *). Each tick asks clock.mjs what is due and asks GitHub to
// run it NOW, with workflow_dispatch on main. The workflows keep their own schedules as the fallback.
//
// ONE SECRET, GITHUB_DISPATCH_TOKEN: a fine-grained token for this repository only, Actions read and
// write, added by Ikenna in the dashboard. Nothing here prints it, and nothing logs more than a
// workflow file name, a slot time and an HTTP status.
//
// DRY RUN UNLESS TOLD OTHERWISE. CLOCK_MODE (a plain variable) must be exactly 'live' for the clock to
// dispatch; anything else, or nothing, logs what it would dispatch and sends nothing.
//
// THE RECORD is a Durable Object (ClockState, one instance), not KV: KV is eventually consistent for up
// to a minute across locations, and a cron tick lands wherever Cloudflare puts it, so a KV record could
// read stale on the very next tick and fire a slot twice. A Durable Object is one place with one
// order. The slot is CLAIMED (written) before the dispatch leaves; a dispatch GitHub refuses or never
// answers releases its claim, so the next tick inside the catch-up window tries again.
//
// THE HEARTBEAT is GET /heartbeat: when the clock last ticked, its mode, and when GitHub last accepted
// a dispatch. Times and status codes only. scripts/launch-check.mjs watches it (app/lib/clock.js).

import { tick, publicHeartbeat } from './tick.mjs';

/** The record. One instance, named 'clock'. Reached only through the binding below, never the web. */
export class ClockState {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/tick') {
      const at = Number(url.searchParams.get('at'));
      if (!Number.isFinite(at)) return new Response('bad tick', { status: 400 });
      await tick(this.ctx.storage, this.env, at);
      return new Response('ok');
    }
    if (url.pathname === '/heartbeat') return Response.json(publicHeartbeat(await this.ctx.storage.get('heartbeat')));
    return new Response('not found', { status: 404 });
  }
}

const stub = (env) => env.CLOCK.get(env.CLOCK.idFromName('clock'));

const clock = {
  async scheduled(event, env) {
    const res = await stub(env).fetch(`https://clock/tick?at=${event.scheduledTime}`);
    if (!res.ok) console.error(`calvary-clock: tick ${res.status}`);
  },
  // The web reaches the heartbeat and nothing else: never /tick.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/heartbeat') {
      const res = await stub(env).fetch('https://clock/heartbeat');
      return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    return new Response('not found', { status: 404 });
  },
};

export default clock;
