// PROOFS-R3.1 — the writer emails under Cloudflare's real limits: 50 subrequests per request and
// 6 simultaneous connections, enforced on every outbound call (harness.mjs installLimits). At
// production size (10 writer-badge holders, 6 with scheduled stories, 35 stories) and at ten times
// that (100, 60, 350). Every simulated request must stay within 50, or the shim throws exactly as
// workerd does and the test fails.
//
// Invented writers, stories and addresses only.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, installLimits, loadRules, wipe, get, set, request, context, tokenFor, founders, STAND_IN_FOUNDER, sent, ACCOUNTS } from './harness.mjs';
import { handleWriters } from '../../functions/api/proofs/writers.js';
import { handleTick } from '../../functions/api/proofs/mail-tick.js';
import { handleProofs } from '../../functions/api/proofs/index.js';
import { BudgetExceeded, SUBREQUEST_LIMIT } from '../../functions/api/proofs/_mail.js';
import { REMINDER_LEAD_MS } from '../../app/lib/proofMail.js';

const NOW = Date.parse('2026-11-03T10:00:00Z');
const D = 864e5;
const iso = (ms) => new Date(ms).toISOString();
let L;

/** A catalogue of `writers` badge holders, the first `withStories` of them sharing `stories`. */
async function seed({ writers, withStories, stories }) {
  await wipe();
  for (const k of Object.keys(ACCOUNTS)) delete ACCOUNTS[k];
  const W = Array.from({ length: writers }, (_, i) => `limitWriter${String(i).padStart(3, '0')}`);
  const cms = {};
  for (let j = 0; j < stories; j++) {
    const w = W[j % withStories];
    cms[`lim-${j}`] = { title: `Invented ${j}`, authorUid: w, published: false, publishAt: iso(NOW + (3 + (j % 20)) * D) };
  }
  await set('cms_stories', cms);
  await set('users', Object.fromEntries(W.map((w) => [w, { displayName: 'Invented', isAuthor: true }])));
  for (const w of W) ACCOUNTS[w] = { email: `${w.toLowerCase()}@example.test`, emailVerified: true };
  ACCOUNTS[STAND_IN_FOUNDER] = { email: 'founder@example.test', emailVerified: true };
  await set('proofs_access', { open: false, changedAt: NOW - D, changedBy: STAND_IN_FOUNDER });
  sent.length = 0;
  return W;
}

/** One simulated request to /api/proofs/writers, inside the limit. */
async function writers(body, now = NOW) {
  L.begin();
  const { ctx } = context(request('/api/proofs/writers', { body, token: tokenFor(STAND_IN_FOUNDER) }));
  const res = await handleWriters(ctx, { now, founders, pause: 0 });
  L.end();
  return { status: res.status, ...(await res.json()) };
}
async function tick(now = NOW) {
  L.begin();
  const { ctx } = context(request('/api/proofs/mail-tick', { body: {} }));
  const res = await handleTick(ctx, { now, authorise: async () => ({ ok: true }), pause: 0 });
  L.end();
  return { status: res.status, ...(await res.json()) };
}
/** Call until nothing is left, as /admin/proofs (send) and the Actions job (tick) do. */
async function drain(fn, cap = 200) {
  const total = { calls: 0, opening: 0, scheduled: 0, changed: 0, reminder: 0, failed: 0, interrupted: 0, raced: 0 };
  for (let i = 0; i < cap; i++) {
    const r = await fn();
    assert.equal(r.status, 200, `call ${i + 1}: ${r.code} ${r.error}`);
    total.calls++;
    for (const k of ['opening', 'scheduled', 'changed', 'reminder', 'failed', 'interrupted', 'raced']) total[k] += r[k] || 0;
    if (!r.more) return total;
  }
  throw new Error('never finished');
}
const perAddress = () => sent.reduce((m, e) => m.set(e.to[0], (m.get(e.to[0]) || 0) + 1), new Map());
const within = (label) => {
  assert.equal(L.refused, 0, `${label}: a request went past ${SUBREQUEST_LIMIT} subrequests`);
  assert.ok(Math.max(...L.calls) <= SUBREQUEST_LIMIT, `${label}: worst request used ${Math.max(...L.calls)}`);
};

before(async () => { install(); L = installLimits({ limit: SUBREQUEST_LIMIT, connections: 6 }); await loadRules(); });
after(() => { L.uninstall(); uninstall(); });
beforeEach(() => { L.calls.length = 0; L.refused = 0; L.peak = 0; L.killAt = null; });

for (const [label, size] of [['production size', { writers: 10, withStories: 6, stories: 35 }], ['ten times production size', { writers: 100, withStories: 60, stories: 350 }]]) {
  describe(`the opening at ${label} (${size.writers} writers, ${size.withStories} with stories, ${size.stories} stories)`, () => {
    let W;
    beforeEach(async () => { W = await seed(size); });

    test('the list, Open and every send batch each stay within 50; every writer gets exactly one opening email', async () => {
      const list = await writers({ action: 'list' });
      assert.equal(list.writers.length, size.writers);
      const open = await writers({ action: 'open', include: W });
      assert.equal(open.status, 200);
      assert.equal(open.queued, size.writers);
      assert.equal(sent.length, 0, 'Open itself sends nothing');
      assert.equal((await get('proofs_access')).open, true, 'Open opened the switch in its one write');
      assert.equal(Object.keys(await get('proofs_mail/queue')).length, size.writers, '…and queued every ticked writer in the same write');
      const t = await drain(() => writers({ action: 'send' }));
      assert.equal(t.opening, size.writers);
      assert.equal(sent.length, size.writers);
      assert.ok([...perAddress().values()].every((n) => n === 1), 'one opening email per writer');
      assert.equal(await get('proofs_mail/queue'), null, 'the queue is empty');
      const ledger = await get('proofs_mail/writers');
      assert.equal(Object.values(ledger).reduce((a, w) => a + Object.keys(w.stories || {}).length, 0), size.stories, 'every story recorded with its opening');
      within(label);
      assert.ok(L.peak <= 6, 'never more than 6 connections at once');
      console.log(`# ${label}: list ${L.calls[0]}, open ${L.calls[1]}, ${t.calls} send calls, worst ${Math.max(...L.calls)} subrequests`);
      // Nothing more to send: a further tick is a no-op.
      const again = await tick();
      assert.equal(again.opening + again.scheduled + again.changed + again.reminder, 0);
      assert.equal(sent.length, size.writers);
    });

    test('an Open over a mix of ticked and unticked writers is still one write', async () => {
      const half = W.slice(0, Math.ceil(W.length / 2));
      const o = await writers({ action: 'open', include: half });
      assert.equal(o.queued, half.length);
      assert.equal(o.excluded, W.length - half.length);
      within(label);
      assert.equal(L.calls.at(-1) <= 6, true, `Open used ${L.calls.at(-1)}: auth, token, two reads, one write`);
    });

    test('the scheduled, date-changed and 48-hour emails: each once, every batch within 50', async () => {
      await writers({ action: 'open', include: W });
      await drain(() => writers({ action: 'send' }));
      sent.length = 0;
      const cms = await get('cms_stories');
      const slugs = Object.keys(cms);
      const moved = slugs.slice(0, Math.floor(slugs.length / 2));
      for (const s of moved) await set(`cms_stories/${s}/publishAt`, iso(Date.parse(cms[s].publishAt) + D));
      const added = Array.from({ length: Math.ceil(size.stories / 5) }, (_, j) => `lim-new-${j}`);
      for (const [j, s] of added.entries()) await set(`cms_stories/${s}`, { title: 'New', authorUid: W[j % size.withStories], published: false, publishAt: iso(NOW + 30 * D) });
      const t = await drain(() => tick());
      assert.equal(t.changed, moved.length);
      assert.equal(t.scheduled, added.length);
      assert.equal(sent.length, moved.length + added.length);
      assert.equal((await drain(() => tick())).changed, 0, 'a rerun sends nothing');
      // 48 hours before the soonest stories.
      const first = Math.min(...Object.values(await get('cms_stories')).map((r) => Date.parse(r.publishAt)));
      const r = await drain(() => tick(first - REMINDER_LEAD_MS + 60_000));
      assert.ok(r.reminder > 0);
      assert.equal((await drain(() => tick(first - REMINDER_LEAD_MS + 120_000))).reminder, 0, 'once');
      within(label);
    });

    test('the founders’ /api/proofs list stays within 50', async () => {
      await set('proofs_access', { open: true, changedAt: NOW, changedBy: STAND_IN_FOUNDER });
      L.begin();
      const { ctx } = context(request('/api/proofs', { body: { action: 'list' }, token: tokenFor(STAND_IN_FOUNDER) }));
      const res = await handleProofs(ctx, { now: NOW, founders });
      L.end();
      assert.equal(res.status, 200);
      assert.equal((await res.json()).stories.length, size.stories);
      within(label);
    });
  });
}

describe('an interrupted batch resumes without a double send', () => {
  let W;
  beforeEach(async () => { W = await seed({ writers: 10, withStories: 6, stories: 35 }); });

  test('a request that dies between a claim and its send: that writer is recorded "interrupted", never emailed twice; the rest go once', async () => {
    await writers({ action: 'open', include: W });
    let resendCalls = 0;
    // Kill the request at the 3rd send of the first batch, as if the isolate died there.
    L.killAt = (url) => (url === 'https://api.resend.com/emails' && ++resendCalls === 3 ? new BudgetExceeded() : null);
    const dead = await writers({ action: 'send' });
    assert.equal(dead.status, 500);
    assert.equal(dead.code, 'budget');
    assert.equal(sent.length, 2, 'two went before it died');
    L.killAt = null;
    const t = await drain(() => writers({ action: 'send' }));
    assert.equal(t.interrupted, 1, 'the claimed one is found and recorded');
    assert.equal(sent.length, W.length - 1, 'every other writer gets theirs');
    assert.ok([...perAddress().values()].every((n) => n === 1), 'nobody twice');
    const opened = Object.values(await get('proofs_mail/writers')).map((w) => w.opening.status).sort();
    assert.deepEqual([...new Set(opened)].sort(), ['interrupted', 'sent']);
    within('interrupted');
  });

  test('the page’s loop and the quarter-hourly job interleaved on one queue: each writer once', async () => {
    await writers({ action: 'open', include: W });
    // Interleaved, call by call (the shim counts one request at a time). Truly simultaneous ticks
    // are covered in mail.emulator.mjs ("two ticks at once send each email once").
    for (let i = 0; i < 20; i++) {
      const a = await writers({ action: 'send' });
      const b = await tick();
      if (!a.more && !b.more) break;
    }
    assert.equal(sent.length, W.length);
    assert.ok([...perAddress().values()].every((n) => n === 1));
    within('two loops');
  });

  test('a tighter budget (30) still finishes, in more calls, each writer once', async () => {
    await writers({ action: 'open', include: W });
    const t30 = [];
    for (let i = 0; i < 50; i++) {
      L.begin();
      const { ctx } = context(request('/api/proofs/writers', { body: { action: 'send' }, token: tokenFor(STAND_IN_FOUNDER) }));
      const res = await handleWriters(ctx, { now: NOW, founders, pause: 0, limit: 30 });
      L.end();
      const j = await res.json();
      assert.equal(res.status, 200);
      t30.push(L.calls.at(-1));
      if (!j.more) break;
    }
    assert.ok(Math.max(...t30) <= 30);
    assert.equal(sent.length, W.length);
    assert.ok([...perAddress().values()].every((n) => n === 1));
  });
});
