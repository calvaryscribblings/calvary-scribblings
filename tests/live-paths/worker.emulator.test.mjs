// LIVE-PATHS-1 — the traversals, against a real Realtime Database (the emulator). EMULATOR ONLY.
//
// Each case seeds fixtures (no production data: invented drafts, invented subscribers at
// example.test), fires the traversal, and then compares EVERY node with what was seeded. On the
// pre-LIVE-PATHS-1 code (origin/main) these cases destroy data: DELETE /draft/. removes every
// draft, a save with id "../subscribers" replaces the subscriber list, and Hide on a record whose
// stored id is '' nulls the whole index. On this branch each is refused and nothing changes.
//
// The Worker runs in-process. Its database URL is a fake host; the fetch shim below parses each
// URL the way a real request would (so `newsletter_drafts/../subscribers.json` normalises to
// `/subscribers.json` exactly as it would on the wire), forwards it to the emulator as owner,
// and records it. Anything that isn't the fake database host (mail, say) throws: nothing leaves.
//
// Run: npm run test:live-paths:emulator

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= '127.0.0.1:9471';
const EMU = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}`;
const NS = 'demo-live-paths';
const OWNER = { Authorization: 'Bearer owner' };
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_DATABASE_EMULATOR_HOST)) {
  throw new Error('this suite runs against the emulator only');
}

const realFetch = globalThis.fetch;
const emu = (path, init = {}) => realFetch(`${EMU}/${path}.json?ns=${NS}`, { ...init, headers: { ...OWNER, ...(init.headers || {}) } });
const dump = async () => (await emu('')).json();
const put = (path, v) => emu(path, { method: 'PUT', body: JSON.stringify(v) });

const FAKE_DB = 'https://db.live-paths.test';
let sent = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url); // the wire's own normalisation
  if (url.origin !== FAKE_DB) throw new Error(`blocked: a request to ${url.origin} left the Worker`);
  const method = init.method || 'GET';
  sent.push(`${method} ${url.pathname}`);
  return realFetch(`${EMU}${url.pathname}?ns=${NS}`, { method, body: init.body, headers: { ...OWNER, 'Content-Type': 'application/json' } });
};
after(() => { globalThis.fetch = realFetch; });

const ENV = { FIREBASE_DATABASE_URL: FAKE_DB, FIREBASE_SECRET: 'fixture', NEWSLETTER_SEND_SECRET: 'nss', RESEND_API_KEY: 'none' };
const worker = (await import('../../workers-external/calvary-newsletter.worker.js')).default;
const call = (method, path, body) => worker.fetch(new Request(`https://calvary-newsletter.test${path}`, {
  method, headers: { authorization: 'Bearer nss', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
}), ENV);

const SEED = {
  newsletter_drafts: {
    1758790800001: { id: '1758790800001', subject: 'Draft one', blocks: [], status: 'draft', savedAt: '2026-10-01T00:00:00Z' },
    1758790800002: { id: '1758790800002', subject: 'Draft two', blocks: [], status: 'scheduled', scheduledAt: '2099-01-01T08:00:00Z', savedAt: '2026-10-02T00:00:00Z' },
  },
  subscribers: {
    s1: { email: 'reader.one@example.test', subscribedAt: '2026-01-01', status: 'active' },
    s2: { email: 'reader.two@example.test', subscribedAt: '2026-01-02', status: 'active' },
  },
  cms_stories: {
    'fixture-story': { title: 'Fixture', cover: '/covers-typographic/f.jpg', published: true, id: '' },
    'other-story': { title: 'Other', cover: '/covers-typographic/o.jpg', published: true },
  },
  cms_stories_index: { 'fixture-story': { title: 'Fixture' }, 'other-story': { title: 'Other' } },
  story_bodies: { 'fixture-story': { content: '<p>x</p>' }, 'other-story': { content: '<p>y</p>' } },
};

// The baseline is the emulator's own read-back of the seed (RTDB drops empty arrays and the like),
// taken before each case; every node is compared with it afterwards.
let baseline;
async function assertUntouched(label) {
  assert.deepEqual(await dump(), baseline, `${label}: the database changed`);
}

before(async () => { const r = await emu('', { method: 'DELETE' }); assert.ok(r.ok, 'emulator reachable'); });
beforeEach(async () => { await put('', SEED); baseline = await dump(); sent = []; });
after(async () => { await emu('', { method: 'DELETE' }); });

describe('newsletter Worker, audit #1 and #2', () => {
  test('DELETE /draft/. (normalised to /draft/) does not delete every draft', async () => {
    const res = await call('DELETE', '/draft/.');
    assert.notEqual(res.status, 200, 'refused');
    assert.deepEqual(sent, [], 'no database request');
    await assertUntouched('DELETE /draft/.');
  });

  test('DELETE /draft/%2e does not delete every draft', async () => {
    await call('DELETE', '/draft/%2e');
    assert.deepEqual(sent, []);
    await assertUntouched('DELETE /draft/%2e');
  });

  test('a save with id "../subscribers" does not replace the subscriber list', async () => {
    const res = await call('POST', '/draft', { id: '../subscribers', subject: 'x', blocks: [] });
    assert.equal(res.status, 400);
    assert.deepEqual(sent, []);
    await assertUntouched('save ../subscribers');
  });

  test('a save with id "../cms_stories_index" does not replace a top-level node', async () => {
    const res = await call('POST', '/draft', { id: '../cms_stories_index', subject: 'x', blocks: [] });
    assert.equal(res.status, 400);
    assert.deepEqual(sent, []);
    await assertUntouched('save ../cms_stories_index');
  });

  test('ids that are empty, dotted, slashed, percent-encoded or over-long: refused, nothing written', async () => {
    for (const id of ['', '.', '..', '1758790800001/x', '%2e%2e', '1'.repeat(65), 'd1']) {
      sent = [];
      const res = await call('POST', '/draft', { id, subject: 'x', blocks: [] });
      assert.equal(res.status, 400, JSON.stringify(id));
      assert.deepEqual(sent, [], JSON.stringify(id));
    }
    await assertUntouched('bad ids');
  });

  test('control: a valid save and delete touch exactly their own draft', async () => {
    const saved = await (await call('POST', '/draft', { subject: 'New', blocks: [] })).json();
    assert.ok(saved.success);
    const after1 = await dump();
    assert.equal(after1.newsletter_drafts[saved.id].subject, 'New');
    delete after1.newsletter_drafts[saved.id];
    assert.deepEqual(after1, baseline, 'nothing else moved');
    const del = await call('DELETE', `/draft/${saved.id}`);
    assert.equal(del.status, 200);
    await assertUntouched('save + delete');
  });
});

describe('CMS Hide, audit #3', () => {
  test("Hide with the id a stored `id: ''` used to supply does not null the whole index", async () => {
    const { hideUpdate } = await import('../../app/lib/storyState.js');
    // The pre-fix list spread `({ id, ...s })`, so this record's stored id:'' became the id.
    const stored = { id: 'fixture-story', ...SEED.cms_stories['fixture-story'] };
    const id = stored.id;
    let update = null;
    try { update = hideUpdate(id, SEED.cms_stories['fixture-story'], SEED.story_bodies['fixture-story'], 1); } catch { /* refused */ }
    if (update) {
      // The admin's update(ref(db), …): the SDK drops empty path segments, so `cms_stories_index/`
      // is `cms_stories_index`, the whole node. Reproduced here, then sent as one multi-path PATCH.
      const sdk = Object.fromEntries(Object.entries(update).map(([k, v]) => [k.split('/').filter(Boolean).join('/'), v]));
      await emu('', { method: 'PATCH', body: JSON.stringify(sdk) });
    }
    const now = await dump();
    assert.ok(now.cms_stories_index && now.cms_stories_index['other-story'], 'the rest of the index survives');
    assert.ok(now.story_bodies && now.story_bodies['other-story'], 'the rest of story_bodies survives');
  });

  test('the CMS list puts the key last, so the stored field cannot become the id', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync(new URL('../../app/admin/page.js', import.meta.url), 'utf8');
    assert.match(page, /Object\.entries\(data\)\.map\(\(\[id, s\]\) => \(\{ \.\.\.s, id \}\)\)/);
  });
});
