// PROOFS-R1 · ruling 255 — the scheduled-publish Worker and the Square's write Function, both
// UNMODIFIED, their REST calls pointed at the emulator (the CMS paths: proofs-r1.test.mjs).
//
//   npm run test:rules        (emulator; demo project; no production data, no network)
//
// Every path that writes a story's text, and every path that makes a story live or takes it
// down, runs here against the emulator: as a FOUNDER under the real rules for the CMS's own
// writes, past the rules for the server-side ones. The scheduled-publish Worker and the Square's
// write Function run UNMODIFIED, their REST calls pointed at the emulator. The invariant checked
// after each one is the ruling itself:
//
//   a story that is not live has no `content` and no `extractedText` on cms_stories/<slug>;
//   a story that is live has both there, identical to story_bodies/<slug>.
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { makeEnv, seed, assertSucceeds, FOUNDER_A, OWNER } from './helpers.mjs';
import { recordSavePaths, placementPaths } from '../../app/lib/storyText.js';
import { buildIndexRecord } from '../../app/lib/storyIndex.js';
import { planRepairs } from '../../scripts/reconcile-index.mjs';
import { handleWrite } from '../../functions/api/square/write.js';

// rules-unit-testing sets the namespace to the project id (its database() helper), not <project>-default-rtdb.
const NS = 'demo-calvary-rules';
const EMU = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}`;
const FAKE = 'https://proofs-r1.test';
const TYPO = 'https://firebasestorage.googleapis.com/v0/b/x/o/covers-typographic%2Fs%2Fabc%2Fcover.png';
const PAST = '2026-10-30T06:30:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

// Synthetic text. Two paragraphs so the index's opening line has something to choose.
const BODY = {
  content: '<p>Content note: synthetic.</p><p>The first real sentence of the fixture story, long enough to be an opening line.</p>',
  extractedText: 'The extracted plain text of the fixture.',
};
const record = (extra = {}) => ({
  title: 'A Fixture', author: 'W. Riter', authorUid: 'writer-1', category: 'short', categoryName: 'Short Story',
  date: 'Oct 30, 2026', url: '/stories/s', cover: TYPO, ...extra,
});

let env, founder, anon;
before(async () => {
  env = await makeEnv();
  founder = env.authenticatedContext(FOUNDER_A).database();
  anon = env.unauthenticatedContext().database();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const admin = async (fn) => { let out; await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.database()); }); return out; };
const read = (path) => admin(async (db) => (await db.ref(path).get()).val());

/** The ruling, asserted. */
async function assertPlaced(slug, { live }) {
  const [rec, copy] = [await read(`cms_stories/${slug}`), await read(`story_bodies/${slug}`)];
  assert.ok(copy && typeof copy.content === 'string', `${slug}: story_bodies holds the text`);
  if (live) {
    assert.equal(rec.content, copy.content, `${slug}: a live story's public text equals story_bodies'`);
    assert.equal(rec.extractedText, copy.extractedText);
  } else {
    assert.equal(rec?.content, undefined, `${slug}: a story that isn't live has NO public content`);
    assert.equal(rec?.extractedText, undefined, `${slug}: …and no public extractedText`);
    // and a signed-out reader reading the field directly gets nothing
    assert.equal((await anon.ref(`cms_stories/${slug}/content`).get()).val(), null);
  }
}

// ── the Worker, run for real ──────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
const patches = [];
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
function shim() {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return realFetch(input, init); // the test harness's own calls
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'owner', expires_in: 3600 }), { status: 200 });
    }
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      const m = /^tok-(.+)$/.exec(JSON.parse(init.body || '{}').idToken || '');
      return m ? new Response(JSON.stringify({ users: [{ localId: m[1], email: `${m[1]}@example.test` }] }), { status: 200 })
        : new Response('{}', { status: 400 });
    }
    if (url.startsWith(FAKE)) {
      const u = new URL(url);
      u.searchParams.delete('auth');
      const q = u.searchParams.toString();
      if ((init.method || 'GET') === 'PATCH') patches.push(JSON.parse(init.body));
      const { signal: _s, ...rest } = init;
      return realFetch(`${EMU}${u.pathname}?ns=${NS}${q ? `&${q}` : ''}`, { ...rest, headers: { ...(init.headers || {}), Authorization: 'Bearer owner' } });
    }
    throw new Error(`refused an outbound call to ${url.split('?')[0]}`);
  };
}

describe('PROOFS-R1 · the scheduled-publish Worker (unmodified, against the emulator)', () => {
  let worker, dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'proofs-r1-'));
    await writeFile(join(dir, 'worker.mjs'), await readFile(new URL('../../workers-external/calvary-newsletter.worker.js', import.meta.url), 'utf8'));
    worker = (await import(`file://${join(dir, 'worker.mjs')}`)).default;
    shim();
  });
  after(async () => { globalThis.fetch = realFetch; await rm(dir, { recursive: true, force: true }); });

  const tick = async () => {
    const pending = [];
    patches.length = 0;
    await worker.scheduled({}, { FIREBASE_DATABASE_URL: FAKE, FIREBASE_SECRET: 'owner' }, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  };

  test('a story scheduled, then due: its text reaches cms_stories IN THE FLIP\'S OWN WRITE, and the index is right', async () => {
    // Scheduled through the CMS, so its text was only ever written to story_bodies.
    await assertSucceeds(founder.ref().update(recordSavePaths('due', { ...record(), ...BODY, published: false, publishAt: FUTURE })));
    await assertPlaced('due', { live: false });
    await tick();
    assert.equal(await read('cms_stories/due/published'), false, 'not due yet: not flipped');
    await assertPlaced('due', { live: false });

    await seed(env, { 'cms_stories/due/publishAt': PAST });
    await tick();
    await assertPlaced('due', { live: true });
    const flip = patches.find((p) => p['cms_stories/due/published'] === true);
    assert.ok(flip, 'the flip was one PATCH');
    assert.equal(flip['cms_stories/due/content'], BODY.content, 'and the text travelled in that same PATCH');
    assert.equal(flip['cms_stories/due/extractedText'], BODY.extractedText);
    // the Worker's hand copy writes exactly what app/lib/storyText.js would
    for (const [k, v] of Object.entries(placementPaths('due', BODY, true))) assert.equal(flip[k], v, k);
    const idx = await read('cms_stories_index/due');
    const want = buildIndexRecord('due', { ...record(), ...BODY, published: true, publishAt: PAST });
    assert.equal(idx.published, true);
    assert.equal(idx.readTime, want.readTime, 'the read time came from the text, in the flip');
    assert.ok(idx.readTime > 0);
    // `opening` is the Worker's one ruled gap (tests/ci/index-mirror.test.mjs, KNOWN_GAPS): the
    // */15 index reconciler projects it from cms_stories. That now works only because the flip put
    // the text there, so run the reconciler's own planning over the database as the flip left it.
    assert.equal(idx.opening, undefined, 'if the Worker ever carries opening, retire this half and KNOWN_GAPS together');
    const plan = planRepairs(await read('cms_stories'), await read('cms_stories_index'), { slug: 'due' });
    const repair = plan.repairs.find((r) => r.slug === 'due');
    assert.ok(repair, 'the reconciler re-projects the flipped story');
    assert.equal(repair.want.opening, want.opening);
    assert.ok(want.opening.length > 0, 'and the opening line comes from the text');
  });

  test('a hidden story with a past publishAt is not flipped and keeps no public text', async () => {
    await seed(env, { 'cms_stories/hd': { ...record(), published: false, publishAt: PAST, hiddenAt: 5 }, 'story_bodies/hd': BODY });
    await tick();
    await assertPlaced('hd', { live: false });
  });
});

// ── 3. the Square ────────────────────────────────────────────────────────────────────────────
describe('PROOFS-R1 · the Square refuses a card for a story that is not live', () => {
  const ENV = { NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey, FIREBASE_DATABASE_URL: FAKE };
  const OPEN = Date.parse('2026-10-24T19:30:00Z'); // 20:30 London: inside the hours
  before(shim);
  after(() => { globalThis.fetch = realFetch; });
  const post = async (attachedStory) => {
    const req = new Request('https://calvaryscribblings.co.uk/api/square/write', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer tok-${OWNER}`, 'CF-Connecting-IP': '203.0.113.7' },
      body: JSON.stringify({ action: 'post', text: 'Read this.', attachedStory }),
    });
    const res = await handleWrite({ request: req, env: ENV, waitUntil: () => {} }, { now: OPEN });
    return { status: res.status, ...(await res.json()) };
  };
  const card = (id) => ({ id, title: 'A Fixture', author: 'W. Riter', url: `/stories/${id}` });

  test('scheduled, hidden and missing are refused, and nothing is written', async () => {
    await seed(env, {
      [`users/${OWNER}`]: { displayName: 'Reader', username: 'reader' },
      'cms_stories/sq-sched': { ...record(), published: false, publishAt: FUTURE },
      'cms_stories/sq-hid': { ...record(), published: false, hiddenAt: 5 },
    });
    for (const id of ['sq-sched', 'sq-hid', 'sq-none']) {
      const r = await post(card(id));
      assert.equal(r.status, 404, id);
      assert.equal(r.code, 'story', id);
    }
    assert.equal(await read('square_posts'), null, 'no post landed');
    assert.equal(await read(`square_rate/${OWNER}`), null, 'and no slot was spent');
  });

  test('a live story\'s card is accepted', async () => {
    await seed(env, { [`users/${OWNER}`]: { displayName: 'Reader', username: 'reader' } });
    await admin((db) => db.ref().update(recordSavePaths('sq-live', { ...record(), ...BODY, published: true })));
    await seed(env, { 'cms_stories_index/sq-live': buildIndexRecord('sq-live', { ...record(), ...BODY, published: true }) });
    const r = await post(card('sq-live'));
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.record.attachedStory.id, 'sq-live');
  });
});

