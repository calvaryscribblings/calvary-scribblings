// calvary-clock — the tick: what is due, claimed in the record, then dispatched. Imported by worker.mjs
// (the entry point, which exports only the handlers and the Durable Object, as workerd expects) and by
// tests/ci/clock-1.test.mjs.

import { due, slotKey } from './clock.mjs';

export const REPO = 'calvaryscribblings/calvary-scribblings';
export const DISPATCH_TIMEOUT_MS = 10_000;
const API = 'https://api.github.com';

export const isLive = (env) => env?.CLOCK_MODE === 'live';
const iso = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';

/** POST one workflow_dispatch. Returns the HTTP status, or 'unreachable'. Never throws. */
export async function dispatch(fetchImpl, token, { workflow, inputs }) {
  try {
    const res = await fetchImpl(`${API}/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'calvary-clock',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
    return res.status;
  } catch {
    return 'unreachable';
  }
}
const accepted = (status) => typeof status === 'number' && status >= 200 && status < 300;

/**
 * ONE TICK. `storage` is the Durable Object's storage (get/put); `at` the minute the cron meant.
 * Returns what it did, for the tests. Dry run: the record still advances, so the log shows each slot
 * exactly once, as live would; nothing is sent.
 */
export async function tick(storage, env, at, { fetchImpl = fetch, log = console.log, now = Date.now() } = {}) {
  const state = (await storage.get('state')) || {};
  const hb = (await storage.get('heartbeat')) || {};
  const plan = due(at, state);
  const live = isLive(env);
  hb.tickAt = now;
  hb.mode = live ? 'live' : 'dry-run';
  const out = { mode: hb.mode, fired: [], failed: [] };

  if (!plan.fire.length) { await storage.put('heartbeat', hb); return out; }

  if (!live) {
    for (const f of plan.fire) log(`calvary-clock: dry run — would dispatch ${f.workflow} for ${iso(f.slot)}`);
    await storage.put({ state: plan.state, heartbeat: hb });
    out.fired = plan.fire.map((f) => f.workflow);
    return out;
  }

  if (!env.GITHUB_DISPATCH_TOKEN) {
    // Nothing is claimed: when the secret arrives, the next tick inside the window fires the slot.
    console.error('calvary-clock: no GITHUB_DISPATCH_TOKEN — nothing dispatched');
    hb.lastFailAt = now; hb.lastFailStatus = 'no-token';
    await storage.put('heartbeat', hb);
    out.failed = plan.fire.map((f) => f.workflow);
    return out;
  }

  // Claim first. A second tick that reads the record while these dispatches are in flight sees the
  // slots as taken and does not send them again.
  await storage.put('state', plan.state);
  const results = await Promise.all(plan.fire.map(async (f) => ({ f, status: await dispatch(fetchImpl, env.GITHUB_DISPATCH_TOKEN, f) })));

  // Read both again: another tick may have written while these were in flight.
  const after = (await storage.get('state')) || {};
  const hbNow = (await storage.get('heartbeat')) || {};
  Object.assign(hbNow, { tickAt: Math.max(Number(hbNow.tickAt) || 0, now), mode: hb.mode });
  for (const { f, status } of results) {
    log(`calvary-clock: ${f.workflow} for ${iso(f.slot)} → ${status}`);
    if (accepted(status)) { out.fired.push(f.workflow); hbNow.lastOkAt = Math.max(Number(hbNow.lastOkAt) || 0, now); continue; }
    out.failed.push(f.workflow);
    hbNow.lastFailAt = now; hbNow.lastFailStatus = status;
    // Release the claim, if it is still this tick's: the next tick inside the window tries again.
    const key = slotKey(f.workflow, f.cron);
    if (after[key] === f.slot) {
      if (Number.isFinite(state[key])) after[key] = state[key]; else delete after[key];
    }
  }
  await storage.put({ state: after, heartbeat: hbNow });
  return out;
}

/** The public face of the heartbeat: times, the mode and a status code. Nothing else leaves. */
export function publicHeartbeat(hb) {
  if (!hb) return { tickAt: null, mode: null, lastOkAt: null, lastFailAt: null, lastFailStatus: null };
  return {
    tickAt: hb.tickAt ?? null,
    mode: hb.mode ?? null,
    lastOkAt: hb.lastOkAt ?? null,
    lastFailAt: hb.lastFailAt ?? null,
    lastFailStatus: hb.lastFailStatus ?? null,
  };
}

