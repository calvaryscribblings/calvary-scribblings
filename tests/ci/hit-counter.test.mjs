// R9.6 — THE HIT COUNTER, DRIVEN AGAINST A STUBBED RTDB.
//
//   node --test tests/ci/hit-counter.test.mjs      (npm run test:ci)
//
// workers-external/calvary-hit-counter.worker.js is a mirror of a DASHBOARD-MANAGED
// Worker. It is not built, not bundled, and not deployed from this repo — which for
// two days meant nothing anywhere could tell us it had stopped working. It owns
// stories/{slug}/hitsByDay, which nothing else writes, and top_stories/weekly, which
// app/public-library/page.js:1093 renders.
//
// So the mirror gets the coverage the deployment pipeline cannot give it. The Worker's
// entry points are plain functions over `fetch`, so stubbing global fetch drives the
// real module: no network, no emulator, no secrets, milliseconds.
//
// WHAT THIS SUITE IS FOR, precisely: it encodes the 3 Aug stoppage. Run against the
// as-found source (commit 2b34921) SEVEN of these fail, including the one that matters
// most — a denied `stories` read did not stop the rebuild, so it went on to overwrite
// a live top-10 with an empty list. Run against the repaired source, none do.
//
// The mirror must equal the dashboard for any of this to mean anything. That is
// scripts/worker-mirror-check.mjs's job, not this file's.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../workers-external/calvary-hit-counter.worker.js';

const utcDay = (o = 0) => new Date(Date.now() - o * 86400000).toISOString().slice(0, 10);

const ENV = { FIREBASE_SECRET: 'test-secret' };

// Two stories with real day buckets plus one with none, so the window sum, the
// zero-filter and the prune all have something to bite on.
const STORIES = JSON.stringify({
  a: { hits: 10, hitsByDay: { [utcDay(0)]: 3, [utcDay(1)]: 2, [utcDay(8)]: 99 } },
  b: { hits: 5, hitsByDay: { [utcDay(0)]: 1, [utcDay(12)]: 50 } },
  c: { hits: 0, hitsByDay: {} },
});

const reply = (status, body) => () => new Response(body, { status });
const DENIED = reply(401, '{"error":"Permission denied"}');

let realFetch, logs, calls;

before(() => { realFetch = globalThis.fetch; });
after(() => { globalThis.fetch = realFetch; });

beforeEach(() => { logs = []; calls = []; });

// Routes are [regex, responder] pairs, first match wins.
function stubFetch(routes) {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ u, method: init.method || 'GET', body: init.body });
    for (const [re, responder] of routes) if (re.test(u)) return responder(u, init);
    return new Response('null', { status: 200 });
  };
}

// The Worker reports through console; capture it rather than assert on side effects
// we cannot see. "It logged" IS the behaviour under test for half this suite.
function captureConsole(fn) {
  const e = console.error, l = console.log;
  console.error = (...a) => logs.push(`ERR ${a.join(' ')}`);
  console.log = (...a) => logs.push(`LOG ${a.join(' ')}`);
  return Promise.resolve(fn()).finally(() => { console.error = e; console.log = l; });
}

// scheduled() hands its work to ctx.waitUntil; collect and await it.
async function runCron(env = ENV) {
  const pending = [];
  await captureConsole(async () => {
    await worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  });
}

const putCall = () => calls.find((c) => /top_stories/.test(c.u));

describe('the scheduled top_stories rebuild', () => {
  test('THE 3 AUG BUG: a denied stories read aborts instead of publishing an empty top-10', async () => {
    stubFetch([[/\/stories\.json/, DENIED]]);
    await runCron();
    // The as-found source walked the error OBJECT as "zero valid stories" and carried
    // on to PUT. A permission failure would have destroyed the live surface silently.
    assert.equal(putCall(), undefined, 'no top_stories write may follow a failed read');
    assert.ok(logs.some((l) => /read stories FAILED 401/.test(l)), 'and it must say so');
  });

  test('the happy path publishes, and says it published', async () => {
    stubFetch([
      [/\/stories\.json\?auth=[^&]*&nc/, reply(200, STORIES)],
      [/top_stories\/weekly\.json/, reply(200, '{}')],
      [/\/stories\.json\?auth=[^&]*$/, reply(200, '{}')],
    ]);
    await runCron();
    const put = putCall();
    assert.ok(put, 'top_stories/weekly must be written');
    assert.ok(logs.some((l) => /top_stories\/weekly written/.test(l)),
      'the success line is how the cadence is confirmed without guessing from generatedAt');
  });

  test('it authenticates with the secret, never a web API key', async () => {
    stubFetch([
      [/\/stories\.json\?auth=[^&]*&nc/, reply(200, STORIES)],
      [/top_stories\/weekly\.json/, reply(200, '{}')],
      [/\/stories\.json\?auth=[^&]*$/, reply(200, '{}')],
    ]);
    await runCron();
    // The whole stoppage: a web API key is not RTDB auth, so RTDB read every call as
    // unauthenticated and f8f547d's .write:false denied the lot.
    for (const c of calls) {
      assert.match(c.u, /auth=test-secret/, `call missing the secret: ${c.u}`);
      assert.ok(!/AIzaSy/.test(c.u), `a web API key reached an RTDB URL: ${c.u}`);
    }
  });

  test('the window is the last 7 calendar days, not the whole bucket history', async () => {
    stubFetch([
      [/\/stories\.json\?auth=[^&]*&nc/, reply(200, STORIES)],
      [/top_stories\/weekly\.json/, reply(200, '{}')],
      [/\/stories\.json\?auth=[^&]*$/, reply(200, '{}')],
    ]);
    await runCron();
    const body = JSON.parse(putCall().body);
    // a has 3 + 2 in-window and 99 at day-8, which must NOT count. This is the same
    // derivation the live probe reproduced from data before the source was in hand.
    assert.equal(body.items.find((i) => i.slug === 'a').count, 5);
    assert.equal(body.windowDays, 7);
  });

  test('stories with no hits are left out', async () => {
    stubFetch([
      [/\/stories\.json\?auth=[^&]*&nc/, reply(200, STORIES)],
      [/top_stories\/weekly\.json/, reply(200, '{}')],
      [/\/stories\.json\?auth=[^&]*$/, reply(200, '{}')],
    ]);
    await runCron();
    assert.ok(!JSON.parse(putCall().body).items.some((i) => i.slug === 'c'));
  });

  test('buckets older than the keep window are pruned', async () => {
    stubFetch([
      [/\/stories\.json\?auth=[^&]*&nc/, reply(200, STORIES)],
      [/top_stories\/weekly\.json/, reply(200, '{}')],
      [/\/stories\.json\?auth=[^&]*$/, reply(200, '{}')],
    ]);
    await runCron();
    const prune = calls.find((c) => c.method === 'PATCH' && /\/stories\.json/.test(c.u));
    assert.ok(prune, 'a prune PATCH must be issued');
    assert.match(prune.body, /hitsByDay/);
  });

  test('a denied top_stories write is logged and does not throw', async () => {
    stubFetch([
      [/\/stories\.json\?auth=[^&]*&nc/, reply(200, STORIES)],
      [/top_stories/, DENIED],
      [/\/stories\.json/, reply(200, '{}')],
    ]);
    await runCron();  // waitUntil swallows rejections; the catch in scheduled() is why this is visible
    assert.ok(logs.some((l) => /write top_stories\/weekly FAILED 401/.test(l)));
  });

  test('a missing FIREBASE_SECRET is loud, and makes no RTDB calls at all', async () => {
    stubFetch([]);
    await runCron({});
    assert.equal(calls.length, 0);
    assert.ok(logs.some((l) => /FIREBASE_SECRET is not set/.test(l)),
      'an unset secret must never look like a working Worker again');
  });
});

describe('the POST increment', () => {
  const post = (slug, env = ENV) => captureConsole(() =>
    worker.fetch(new Request(`https://x/?slug=${slug}`, { method: 'POST' }), env, { waitUntil: () => {} }));

  test('it writes TODAY\'s UTC bucket alongside the cumulative counter', async () => {
    stubFetch([
      [/\/stories\/village-people\.json\?auth=[^&]*$/, reply(200, '{}')],
      [/hits\.json/, reply(200, '42')],
    ]);
    const res = await post('village-people');
    const patch = calls.find((c) => c.method === 'PATCH');
    const body = JSON.parse(patch.body);
    assert.ok(body[`hitsByDay/${utcDay(0)}`], 'today\'s bucket must be in the PATCH');
    assert.ok(body.hits, 'and the cumulative counter with it');
    assert.equal((await res.json()).count, 42, 'the resolved count is read back for display');
  });

  test('a denied increment returns 502 AND logs it', async () => {
    stubFetch([[/\/stories\/village-people\.json/, DENIED]]);
    const res = await post('village-people');
    // The 502 was always there. The LOG is what was missing, and the log is the half
    // anyone investigating from the Cloudflare side can actually see — two days of
    // rejection produced no line anywhere.
    assert.equal(res.status, 502);
    assert.ok(logs.some((l) => /increment\(village-people/.test(l)));
  });

  test('a denied read-back is not reported as an empty counter', async () => {
    stubFetch([
      [/\/stories\/village-people\.json\?auth=[^&]*$/, reply(200, '{}')],
      [/hits\.json/, DENIED],
    ]);
    const res = await post('village-people');
    // It still answers null — but now there is a line saying why, instead of a value
    // indistinguishable from "no hits yet".
    assert.equal((await res.json()).count, null);
    assert.ok(logs.some((l) => /readCount\(village-people\) FAILED 401/.test(l)));
  });
});
