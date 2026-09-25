// W6 — the calvary-newsletter Worker tells the truth. Driven for real: the Worker module is
// imported and its fetch/scheduled handlers run against an in-memory database and a fake Resend,
// so what is asserted is what the Worker DID, not what its source says.
//
//   ADM-04  a hidden story is never republished by the tick
//   ADM-05  a coverless (or held) story is skipped, and an alert is written
//   ADM-03  a refused send is a refusal on the wire; a partial send reports both counts
//   ADM-22  scheduling is right across BST/GMT; a sent draft cannot be sent twice
//
//   node --test tests/ci/w6-worker.test.mjs          (npm run test:ci)

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { londonWallToUtcMs as clientWall, londonWallToUtcIso, utcToLondonWall, scheduledMs as clientScheduled } from '../../app/lib/londonTime.js';

const worker = (await import('../../workers-external/calvary-newsletter.worker.js')).default;

// ── a fake world ──────────────────────────────────────────────────────────────────────────
const DB = 'https://db.test';
let data;           // the database, as a plain object
let resend;         // { calls: [[emails]], fail: (emails) => bool }
const ENV = {
  FIREBASE_DATABASE_URL: DB, FIREBASE_SECRET: 's', RESEND_API_KEY: 'r', FROM_EMAIL: 'from@x',
  NEWSLETTER_SEND_SECRET: 'nss', TEST_SEND_ALLOWLIST: 'Ikennaworksfromhome@gmail.com',
  CMS_DEPLOY_HOOK_URL: 'https://hook.test/fire',
};
const getAt = (path) => path.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), data);
const setAt = (path, v) => {
  const keys = path.split('/').filter(Boolean);
  let o = data;
  for (const k of keys.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  if (v === null || v === undefined) delete o[keys.at(-1)]; else o[keys.at(-1)] = v;
};
let pushN = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  const ok = (j, status = 200) => new Response(JSON.stringify(j ?? null), { status, headers: { 'content-type': 'application/json' } });
  if (u.origin === 'https://api.resend.com') {
    const batch = JSON.parse(init.body).map((m) => m.to[0]);
    resend.calls.push(batch);
    return resend.fail(batch) ? ok({ error: 'rate' }, 429) : ok({ data: batch.map(() => ({ id: 'x' })) });
  }
  if (u.origin === 'https://hook.test') return ok({ ok: true });
  if (u.origin === DB) {
    const path = decodeURIComponent(u.pathname.replace(/\.json$/, '')).replace(/^\//, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === 'GET') return ok(path ? getAt(path) ?? null : data);
    if (method === 'PUT') { setAt(path, body); return ok(body); }
    if (method === 'DELETE') { setAt(path, null); return ok(null); }
    if (method === 'PATCH') {
      for (const [k, v] of Object.entries(body)) setAt(path ? `${path}/${k}` : k, v);
      return ok(body);
    }
    if (method === 'POST') { const id = `-P${++pushN}`; setAt(`${path}/${id}`, body); return ok({ name: id }); }
  }
  throw new Error(`unexpected fetch ${method} ${url}`);
};

const COVER = 'https://storage.test/covers-typographic/x.webp';
const PAST = new Date(Date.now() - 60_000).toISOString();
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const tick = () => new Promise((resolve) => worker.scheduled({}, ENV, { waitUntil: (p) => p.then(resolve, resolve) }));
const post = (path, body) => worker.fetch(new Request(`https://w.test${path}`, {
  method: 'POST', headers: { authorization: 'Bearer nss', 'content-type': 'application/json' }, body: JSON.stringify(body),
}), ENV);
const subscribers = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, { email: `r${i}@x.test`, status: 'active', subscribedAt: '2026-01-01' }]));
const ISSUE = { subject: 'Issue 9', blocks: [{ type: 'text', id: '1', content: 'Hello' }] };

beforeEach(() => { data = {}; resend = { calls: [], fail: () => false }; pushN = 0; });

describe('W6 · the scheduled publisher', () => {
  test('ADM-04: a HIDDEN story with a past publishAt stays hidden, tick after tick', async () => {
    data.cms_stories = { gone: { title: 'Gone', published: false, publishAt: PAST, cover: COVER, hiddenAt: Date.now() - 1000 } };
    await tick(); await tick();
    assert.equal(data.cms_stories.gone.published, false);
    assert.equal(data.cms_stories_index?.gone, undefined);
  });

  test('a due story WITH its cover is published, index and all', async () => {
    data.cms_stories = { due: { title: 'Due', published: false, publishAt: PAST, cover: COVER, category: 'short' } };
    await tick();
    assert.equal(data.cms_stories.due.published, true);
    assert.ok(data.cms_stories_index.due, 'index record written in the same patch');
  });

  test('ADM-05: a due story still HELD for its cover is skipped, and an alert is written once', async () => {
    data.cms_stories = { bare: { title: 'Bare', published: false, publishAt: PAST, cover: '/placeholder.jpg', coverHold: true } };
    await tick();
    assert.equal(data.cms_stories.bare.published, false, 'not published coverless');
    assert.equal(data.ops.publish_skips.bare.reason, 'held_for_cover');
    const firstAt = data.ops.publish_skips.bare.at;
    await tick();
    assert.equal(data.ops.publish_skips.bare.at, firstAt, 'one alert, not one per tick');
  });

  test('ADM-05: a due story with NO generated cover (and no hold) is skipped too', async () => {
    data.cms_stories = { slipped: { title: 'Slipped', published: false, publishAt: PAST, cover: '/old-art.jpg' } };
    await tick();
    assert.equal(data.cms_stories.slipped.published, false);
    assert.equal(data.ops.publish_skips.slipped.reason, 'no_generated_cover');
  });

  test('when the cover lands, the publish clears the alert', async () => {
    data.cms_stories = { late: { title: 'Late', published: false, publishAt: PAST, cover: '/p.jpg', coverHold: true } };
    await tick();
    Object.assign(data.cms_stories.late, { cover: COVER, coverHold: null });
    delete data.cms_stories.late.coverHold;
    await tick();
    assert.equal(data.cms_stories.late.published, true);
    assert.equal(data.ops.publish_skips?.late, undefined);
  });

  test('not yet due: untouched', async () => {
    data.cms_stories = { soon: { title: 'Soon', published: false, publishAt: FUTURE, cover: COVER } };
    await tick();
    assert.equal(data.cms_stories.soon.published, false);
  });
});

describe('W6 · /send — refusals are refusals, partials are partial', () => {
  test('ADM-03: a test to an address NOT on the allowlist is a 403, and nothing is mailed', async () => {
    data.subscribers = subscribers(3);
    const res = await post('/send', { ...ISSUE, testEmail: 'stranger@x.test' });
    const j = await res.json();
    assert.equal(res.status, 403);
    assert.match(j.error, /not on TEST_SEND_ALLOWLIST/);
    assert.equal(resend.calls.length, 0);
  });

  test('a test to the allowlisted address mails exactly that address', async () => {
    data.subscribers = subscribers(3);
    const res = await post('/send', { ...ISSUE, testEmail: 'ikennaworksfromhome@gmail.com' });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual([j.sent, j.failed, j.mode], [1, 0, 'test']);
    assert.deepEqual(resend.calls, [['ikennaworksfromhome@gmail.com']]);
    assert.equal(data.newsletter_sends, undefined, 'a test is not archived');
  });

  test('a partial send reports both counts, and records WHO failed for the retry', async () => {
    data.subscribers = subscribers(120);          // three batches of 50/50/20
    let batch = 0;
    resend.fail = () => ++batch === 2;            // the middle batch is refused
    const res = await post('/send', ISSUE);
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual([j.sent, j.failed], [70, 50]);
    assert.equal(j.failedRecipients, undefined, 'addresses are not echoed to the admin');
    const rec = data.newsletter_sends[j.sendId];
    assert.equal(rec.failedRecipients.length, 50);
    assert.equal(rec.failedCount, 50);
    const owed = rec.failedRecipients.slice();

    // The retry mails those 50 and nobody else, and settles the record.
    resend.calls = []; resend.fail = () => false;
    const r2 = await post('/retry', { sendId: j.sendId });
    const j2 = await r2.json();
    assert.equal(r2.status, 200);
    assert.equal(j2.sent, 50);
    assert.deepEqual(resend.calls.flat().sort(), owed.sort());
    assert.equal(data.newsletter_sends[j.sendId].failedCount, 0);
    assert.equal(data.newsletter_sends[j.sendId].recipientCount, 120);
    assert.equal(Object.keys(data.newsletter_sends).length, 1, 'the retry does not archive a second issue');
    // A second retry has nobody to mail.
    const r3 = await post('/retry', { sendId: j.sendId });
    assert.equal(r3.status, 409);
  });

  test('every batch refused: an error status, with the counts', async () => {
    data.subscribers = subscribers(10);
    resend.fail = () => true;
    const res = await post('/send', ISSUE);
    const j = await res.json();
    assert.equal(res.status, 502);
    assert.deepEqual([j.sent, j.failed], [0, 10]);
  });

  test('no subscribers: a refusal, not a 200', async () => {
    const res = await post('/send', ISSUE);
    assert.equal(res.status, 409);
  });
});

describe('W6 · drafts — scheduled right, sent once', () => {
  test('ADM-22: a Send on a scheduled draft locks it, so the tick cannot mail it again', async () => {
    data.subscribers = subscribers(2);
    data.newsletter_drafts = { d1: { id: 'd1', ...ISSUE, status: 'scheduled', scheduledAt: PAST } };
    const res = await post('/send', { ...ISSUE, draftId: 'd1' });
    assert.equal(res.status, 200);
    assert.equal(data.newsletter_drafts?.d1, undefined, 'a clean send removes the draft');
    const before = resend.calls.length;
    await tick();
    assert.equal(resend.calls.length, before, 'the tick sent nothing more');
  });

  test('a scheduled draft whose send partly fails is kept, marked failed, and NOT resent by the next tick', async () => {
    data.subscribers = subscribers(60);
    let batch = 0;
    resend.fail = () => ++batch === 1;
    data.newsletter_drafts = { d2: { id: 'd2', ...ISSUE, status: 'scheduled', scheduledAt: PAST } };
    await tick();
    assert.equal(data.newsletter_drafts.d2.status, 'failed');
    assert.equal(data.newsletter_drafts.d2.failedCount, 50);
    const calls = resend.calls.length;
    await tick();
    assert.equal(resend.calls.length, calls);
  });

  test('a draft save the database refuses is reported as not saved', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => (String(url).startsWith(DB) && init?.method === 'PUT'
      ? new Response('{"error":"Permission denied"}', { status: 401 }) : realFetch(url, init));
    try {
      const res = await post('/draft', { ...ISSUE });
      assert.equal(res.status, 502);
      assert.match((await res.json()).error, /not saved/);
    } finally { globalThis.fetch = realFetch; }
  });
});

describe('W6 · London time — BST and GMT, and the two copies agree', () => {
  // The Worker's copy, for drafts saved before W6 (zoneless strings).
  const CASES = [
    ['2026-10-01T09:00', '2026-10-01T08:00:00.000Z', 'BST: 09:00 London is 08:00 UTC'],
    ['2026-10-24T23:30', '2026-10-24T22:30:00.000Z', 'the last BST evening'],
    ['2026-10-25T00:30', '2026-10-24T23:30:00.000Z', 'Sun 25 Oct 00:30, still BST'],
    ['2026-10-25T02:30', '2026-10-25T02:30:00.000Z', 'after the clocks go back: GMT'],
    ['2026-11-02T09:00', '2026-11-02T09:00:00.000Z', 'GMT: 09:00 London is 09:00 UTC'],
    ['2027-03-28T03:30', '2027-03-28T02:30:00.000Z', 'after the clocks go forward: BST'],
    ['2027-01-15T18:45', '2027-01-15T18:45:00.000Z', 'midwinter'],
  ];
  for (const [wall, iso, why] of CASES) {
    test(`${why}`, () => {
      assert.equal(new Date(clientWall(wall)).toISOString(), iso, 'the admin');
      assert.equal(londonWallToUtcIso(wall), iso);
      // The Worker reads a zoneless (pre-W6) draft the same way, and an ISO one as itself.
      assert.equal(clientScheduled(wall), Date.parse(iso));
      assert.equal(clientScheduled(iso), Date.parse(iso));
      assert.equal(utcToLondonWall(iso), wall, 'round trip for the editor');
    });
  }

  test('the Worker schedules a zoneless BST draft at 08:00 UTC — NOT an hour late', async () => {
    data.subscribers = subscribers(1);
    const wall = '2026-10-01T09:00';
    data.newsletter_drafts = { d3: { id: 'd3', ...ISSUE, status: 'scheduled', scheduledAt: wall } };
    const RealDate = Date;
    const at = (iso) => {
      const fixed = RealDate.parse(iso);
      globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
    };
    try {
      at('2026-10-01T07:59:00Z'); await tick();
      assert.equal(resend.calls.length, 0, '07:59 UTC = 08:59 London: not yet');
      at('2026-10-01T08:00:30Z'); await tick();
      assert.equal(resend.calls.length, 1, '08:00 UTC = 09:00 London: sent');
    } finally { globalThis.Date = RealDate; }
  });

  test('the Worker and the admin carry the same conversion (a transcription drift fails here)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('workers-external/calvary-newsletter.worker.js', 'utf8');
    assert.match(src, /function londonWallToUtcMs\(wall\)/);
    assert.match(src, /function scheduledMs\(value\)/);
    assert.match(src, /const at = scheduledMs\(draft\.scheduledAt\);/);
  });
});
