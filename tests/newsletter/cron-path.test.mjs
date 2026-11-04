// Cron acceptance for the newsletter Worker.
//
//   node --test tests/newsletter/cron-path.test.mjs
//
// The inbox verification of cs-inline-v1 was done through POST /send. That is
// NOT the path a scheduled issue takes: the cron fires scheduled() ->
// processScheduled(), which reads newsletter_drafts, sends the due ones, and
// flips due stories live. Nothing had ever exercised it, so "the mail renders"
// was proven for the button and assumed for the clock.
//
// This drives the real Worker module with a stubbed fetch and a fixture
// database, and asserts the two paths produce the SAME bytes — which is what
// lets the inbox check transfer to scheduled sends — plus the cron's own
// obligations: which drafts go, which do not, per-recipient unsubscribe tokens,
// the archive census, the atomic publish flip, and the deploy hook.
//
// It writes nothing and touches no network: every fetch is intercepted.

import { test, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { onRequestPost as buildIndexEndpoint } from '../../functions/api/story-index/build.js';
import { buildIndexRecord } from '../../app/lib/storyIndex.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER = resolve(ROOT, 'workers-external/calvary-newsletter.worker.js');

// The repo is CommonJS (no "type":"module"), so the Worker's `export default`
// cannot be imported from its .js path. Copy it verbatim to a .mjs and import
// that — the source is unmodified, unlike a source-slicing approach.
let worker;
let tmpDir;
before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'cron-acceptance-'));
  const copy = join(tmpDir, 'worker.mjs');
  await writeFile(copy, await readFile(WORKER, 'utf8'));
  worker = (await import(`file://${copy}`)).default;
});
after(async () => { if (tmpDir) await rm(tmpDir, { recursive: true, force: true }); });

// ── EVERY TEST ON A PINNED CLOCK, AND NO TEST SEES ANOTHER'S CALLS ────────────────────────
// The Worker reads the wall clock: on the first tick after London midnight (00:00–00:14) it
// fires the deploy hook whether or not anything was published (the free-week / archive rebuild,
// isFirstTickAfterLondonMidnight). This file used to run on the real clock, so a CI run that
// started between 00:00 and 00:14 London failed "the deploy hook does not fire when nothing was
// published" (3 Nov 2026, 00:12, on 7a266023): the Worker was right and the test was not
// time-proof. Every test now runs with Date pinned to a midday instant, and the midnight rule has
// its own test below, on its own pinned time.
//
// Between tests, fetch is a TRAP, not the real fetch: a call a test started but didn't finish
// (a promise not awaited, a waitUntil not drained) lands in the trap after its test returns,
// fails that test in afterEach, and can never reach the next test's stub or the network.
export const MIDDAY_LONDON = Date.parse('2026-11-03T12:00:00Z');
const realFetch = globalThis.fetch;
let strays = 0;
const trap = async (url) => { strays++; throw new Error(`stray fetch after its test finished: ${new URL(String(url)).host}`); };
before(() => { globalThis.fetch = trap; });
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => { strays = 0; mock.timers.enable({ apis: ['Date'], now: MIDDAY_LONDON }); });
afterEach(async () => {
  await new Promise((r) => setImmediate(r));   // let anything still queued surface before checking
  mock.timers.reset();
  assert.equal(strays, 0, `${strays} call(s) made after the test had finished`);
});

const DB = 'https://calvary.firebaseio.test';
const ENV = {
  FIREBASE_DATABASE_URL: DB,
  FIREBASE_SECRET: 'secret',
  RESEND_API_KEY: 'resend-key',
  FROM_EMAIL: 'hello@calvaryscribblings.co.uk',
  NEWSLETTER_SEND_SECRET: 'send-secret',
  // A FABRICATED hook — the shape only. W1 moved the Worker's hook from a literal to this secret.
  CMS_DEPLOY_HOOK_URL: 'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/fixture-not-a-hook',
};

const PAST = '2026-07-30T09:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

// The four formats, the escapes, and a story card — the same shapes that were
// checked in the inbox.
const INLINE_BLOCKS = [
  {
    type: 'text', id: 't1', format: 'cs-inline-v1',
    content:
      'A **bold** and *italic* and __underlined__ line with [a link](https://calvaryscribblings.co.uk/x).\n\n' +
      'A literal \\*asterisk\\* and a raw <script>tag</script> & ampersand.',
  },
  { type: 'divider', id: 'd1' },
  {
    type: 'story', id: 's1', slug: 'the-rescue', title: "Basil's Rescue",
    author: 'A. Writer', category: 'Short Story',
    cover: 'https://cdn.test/cover.webp', excerpt: 'An excerpt that sits under the title.',
  },
];

function makeDb() {
  return {
    subscribers: {
      a: { email: 'reader.one@example.com', status: 'active' },
      b: { email: 'reader.two@example.com', status: 'active' },
      c: { email: 'gone@example.com', status: 'unsubscribed' },
    },
    cms_stories: {
      'due-story': {
        title: 'The Due One', author: 'A. Writer', authorUid: 'uid1', authorHandle: 'awriter',
        // W6: a due story publishes only onto a GENERATED cover (the Worker's publishDecision);
        // the coverless and held cases are tests/ci/w6-worker.test.mjs.
        category: 'short', categoryName: 'Short Stories', cover: 'https://cdn.test/covers-typographic/d.webp',
        date: '2026-07-30', published: false, publishAt: PAST,
        content: '<p>one two three four five</p>',
      },
      'also-due': {
        title: 'Also Due', author: 'B. Writer', published: false, publishAt: PAST,
        cover: 'https://cdn.test/covers-typographic/a.webp', content: 'words words',
      },
      'not-yet': { title: 'Not Yet', published: false, publishAt: FUTURE, content: 'x' },
      'already-live': { title: 'Live', published: true, content: 'x' },
    },
    // Draft keys are Date.now() strings, the only shape the Worker makes (LIVE-PATHS-1 skips others).
    newsletter_drafts: {
      '1758790800011': {
        status: 'scheduled', scheduledAt: PAST, subject: 'Issue 8 — the inline one',
        issueNumber: 8, blocks: INLINE_BLOCKS,
      },
      '1758790800012': {
        status: 'scheduled', scheduledAt: PAST, subject: 'Issue 9 — the legacy one',
        issueNumber: 9,
        intro: 'Legacy **stays** literal & <b>escaped</b>.',
        stories: [{ slug: 'old-tale', title: 'Old Tale', author: 'C. Writer' }],
      },
      '1758790800013': {
        status: 'scheduled', scheduledAt: FUTURE, subject: 'Issue 10 — later',
        issueNumber: 10, blocks: INLINE_BLOCKS,
      },
      '1758790800014': {
        status: 'draft', scheduledAt: PAST, subject: 'Never sent',
        issueNumber: 11, blocks: INLINE_BLOCKS,
      },
    },
  };
}

// Intercepts every fetch the Worker makes, serves the fixture DB, and records
// the calls. Resend and the Cloudflare deploy hook are answered, never called.
// LIMITS-1: the site's index builder (POST /api/story-index/build) is answered by the REAL Pages
// Function, unless `builder` says otherwise: 'down' (500), 'odd' (an implausible 200), 'throw'.
function stubFetch(db, { resendOk = true, builder = 'real' } = {}) {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });

    if (u === 'https://calvaryscribblings.co.uk/api/story-index/build') {
      if (builder === 'down') return new Response('{"code":"x"}', { status: 500 });
      if (builder === 'odd') return new Response('{"record":{"title":"x"}}', { status: 200 });
      if (builder === 'throw') throw new TypeError('network');
      return buildIndexEndpoint({ request: new Request(u, { method, headers: init.headers, body: init.body }) });
    }

    if (u.startsWith('https://api.resend.com/')) {
      return new Response(JSON.stringify({ data: [] }), { status: resendOk ? 200 : 422 });
    }
    if (u.startsWith('https://api.cloudflare.com/')) {
      return new Response('{}', { status: 200 });
    }
    if (u.startsWith(DB)) {
      const path = new URL(u).pathname.replace(/^\/|\.json$/g, '');
      if (method === 'GET') {
        return new Response(JSON.stringify(db[path] ?? null), { status: 200 });
      }
      return new Response('{"name":"-x"}', { status: 200 });
    }
    throw new Error(`unstubbed fetch: ${method} ${u}`);
  };
  return { calls, fetchStub };
}

async function runCron(db, opts) {
  const { calls, fetchStub } = stubFetch(db, opts);
  const real = globalThis.fetch;
  globalThis.fetch = fetchStub;
  const pending = [];
  try {
    await worker.scheduled({ cron: '*/5 * * * *' }, ENV, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  } finally {
    globalThis.fetch = real;
  }
  return calls;
}

async function runSendEndpoint(db, payload) {
  const { calls, fetchStub } = stubFetch(db);
  const real = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    const res = await worker.fetch(new Request('https://w.dev/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${ENV.NEWSLETTER_SEND_SECRET}` },
      body: JSON.stringify(payload),
    }), ENV);
    return { calls, result: await res.json() };
  } finally {
    globalThis.fetch = real;
  }
}

const resendBatches = (calls) => calls.filter((c) => c.url === 'https://api.resend.com/emails/batch');
const mailsFor = (calls, subject) =>
  resendBatches(calls).flatMap((c) => c.body).filter((m) => m.subject === subject);

// ── which drafts go ──────────────────────────────────────────────────────────

test('the cron sends due scheduled drafts and nothing else', async () => {
  const calls = await runCron(makeDb());
  const subjects = resendBatches(calls).flatMap((c) => c.body).map((m) => m.subject);
  assert.deepEqual([...new Set(subjects)].sort(), [
    'Issue 8 — the inline one',
    'Issue 9 — the legacy one',
  ], 'a future draft or a non-scheduled draft was mailed');
});

test('a sent draft is deleted and an unsent one is left alone', async () => {
  const calls = await runCron(makeDb());
  const deleted = calls.filter((c) => c.method === 'DELETE').map((c) => new URL(c.url).pathname);
  assert.deepEqual(deleted.sort(), [
    '/newsletter_drafts/1758790800011.json',
    '/newsletter_drafts/1758790800012.json',
  ]);
});

test('the whole active list is mailed, and unsubscribed addresses are not', async () => {
  const calls = await runCron(makeDb());
  const to = mailsFor(calls, 'Issue 8 — the inline one').flatMap((m) => m.to);
  assert.deepEqual(to.sort(), ['reader.one@example.com', 'reader.two@example.com']);
});

test('a scheduled send is live, not a [TEST] send', async () => {
  const calls = await runCron(makeDb());
  const subjects = resendBatches(calls).flatMap((c) => c.body).map((m) => m.subject);
  assert.ok(!subjects.some((s) => s.startsWith('[TEST]')), 'the cron sent in test mode');
});

// ── the bytes are the same as the verified path ──────────────────────────────

test('the cron mail is byte-identical to POST /send for the same blocks', async () => {
  const cronCalls = await runCron(makeDb());
  const cronMail = mailsFor(cronCalls, 'Issue 8 — the inline one')[0];

  const { calls: sendCalls } = await runSendEndpoint(makeDb(), {
    subject: 'Issue 8 — the inline one', issueNumber: 8, blocks: INLINE_BLOCKS,
  });
  const sendMail = mailsFor(sendCalls, 'Issue 8 — the inline one')[0];

  assert.ok(cronMail && sendMail, 'one of the two paths produced no mail');
  assert.equal(cronMail.html, sendMail.html, 'html/part differs between cron and /send');
  assert.equal(cronMail.text, sendMail.text, 'text/part differs between cron and /send');
  assert.equal(cronMail.from, sendMail.from);
});

// ── cs-inline-v1 survives the cron ───────────────────────────────────────────

test('all four formats render in the cron mail', async () => {
  const calls = await runCron(makeDb());
  const { html } = mailsFor(calls, 'Issue 8 — the inline one')[0];
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<u style="text-decoration:underline;">underlined<\/u>/);
  assert.match(html, /<a href="https:\/\/calvaryscribblings\.co\.uk\/x" style="color:#6b2fad;">a link<\/a>/);
});

test('escapes hold in the cron mail', async () => {
  const calls = await runCron(makeDb());
  const { html, text } = mailsFor(calls, 'Issue 8 — the inline one')[0];
  assert.ok(html.includes('*asterisk*'), 'a backslash-escaped asterisk did not survive');
  assert.ok(!html.includes('<em>asterisk</em>'), 'an escaped asterisk was still parsed');
  assert.ok(html.includes('&lt;script&gt;'), 'a raw tag was not escaped');
  assert.ok(!html.includes('<script>'), 'a raw tag reached the mail');
  assert.ok(html.includes('&amp; ampersand'), 'a bare ampersand was not escaped');
  assert.ok(!text.includes('**bold**'), 'markers leaked into the text part');
  assert.ok(text.includes('a link (https://calvaryscribblings.co.uk/x)'), 'link text/plain form missing');
});

test('the story card is intact in the cron mail', async () => {
  const calls = await runCron(makeDb());
  const { html, text } = mailsFor(calls, 'Issue 8 — the inline one')[0];
  assert.ok(html.includes('https://calvaryscribblings.co.uk/stories/the-rescue'), 'story link missing');
  assert.ok(html.includes('Basil&#39;s Rescue'), 'story title missing or unescaped');
  assert.ok(html.includes('https://cdn.test/cover.webp'), 'story cover missing');
  assert.ok(text.includes('https://calvaryscribblings.co.uk/stories/the-rescue'), 'story link missing from text part');
});

test('a legacy draft with no format field still escapes everything', async () => {
  const calls = await runCron(makeDb());
  const { html } = mailsFor(calls, 'Issue 9 — the legacy one')[0];
  assert.ok(html.includes('**stays**'), 'legacy markers were parsed by the cron');
  assert.ok(!html.includes('<strong>'), 'a legacy block was rendered as cs-inline-v1');
  assert.ok(html.includes('&lt;b&gt;escaped&lt;/b&gt;'), 'legacy escaping changed');
});

test('both mail parts are present on the cron path', async () => {
  const calls = await runCron(makeDb());
  for (const m of mailsFor(calls, 'Issue 8 — the inline one')) {
    assert.ok(m.html && m.html.length > 0, 'no html part');
    assert.ok(m.text && m.text.length > 0, 'no text part');
  }
});

test('each recipient gets their own unsubscribe token', async () => {
  const calls = await runCron(makeDb());
  for (const m of mailsFor(calls, 'Issue 8 — the inline one')) {
    const token = Buffer.from(m.to[0]).toString('base64');
    assert.ok(m.html.includes(`token=${token}`), `html token not personalised for ${m.to[0]}`);
    assert.ok(m.text.includes(`token=${token}`), `text token not personalised for ${m.to[0]}`);
    assert.ok(!m.html.includes('token=TOKEN'), 'an unreplaced token placeholder shipped in the html');
    assert.ok(!m.text.includes('token=TOKEN'), 'an unreplaced token placeholder shipped in the text');
  }
});

// ── the archive ──────────────────────────────────────────────────────────────

test('a scheduled send is archived with its blocks and a format census', async () => {
  const calls = await runCron(makeDb());
  const sends = calls.filter((c) => c.url.startsWith(`${DB}/newsletter_sends.json`) && c.method === 'POST');
  assert.equal(sends.length, 2, 'expected one archive record per scheduled send');

  const inline = sends.find((c) => c.body.subject === 'Issue 8 — the inline one').body;
  assert.deepEqual(inline.formats, ['cs-inline-v1'], 'format census wrong for an inline issue');
  assert.deepEqual(inline.blocks, INLINE_BLOCKS, 'the archived blocks are not the blocks that were sent');
  assert.deepEqual(inline.storySlugs, ['the-rescue']);
  assert.equal(inline.recipientCount, 2);

  const legacy = sends.find((c) => c.body.subject === 'Issue 9 — the legacy one').body;
  assert.deepEqual(legacy.formats, ['legacy-escaped'], 'a legacy issue was censused as inline');
});

// ── the story-publish half of the same cron ──────────────────────────────────

test('a due story flips published and its index record in ONE atomic patch', async () => {
  const calls = await runCron(makeDb());
  const patches = calls.filter((c) => c.method === 'PATCH');
  const due = patches.find((c) => c.body['cms_stories/due-story/published'] !== undefined);
  assert.ok(due, 'the due story never flipped');
  assert.equal(new URL(due.url).pathname, '/.json', 'the flip was not a root multi-path patch');
  assert.equal(due.body['cms_stories/due-story/published'], true);

  const rec = due.body['cms_stories_index/due-story'];
  assert.ok(rec, 'the flip shipped without an index record — the story would be invisible');
  assert.equal(rec.published, true, 'the index record went live saying published:false');
  assert.equal(rec.title, 'The Due One');
  assert.equal(rec.authorHandle, 'awriter');
  assert.equal(rec.url, '/stories/due-story');
  assert.equal(rec.readTime, 1);
});

// ── LIMITS-1: the complete record at go-live ─────────────────────────────────

const flipOf = (calls, slug) => calls.find((c) => c.method === 'PATCH' && c.body[`cms_stories/${slug}/published`] !== undefined);

test('LIMITS-1: the flip carries the REAL builder\'s record, opening line included, in the same patch', async () => {
  const db = makeDb();
  const calls = await runCron(db);
  const due = flipOf(calls, 'due-story');
  const rec = due.body['cms_stories_index/due-story'];
  const story = db.cms_stories['due-story'];
  assert.equal(rec.opening, 'one two three four five');
  assert.deepEqual(rec, buildIndexRecord('due-story', { ...story, published: true }), 'the record is exactly what the app\'s builder makes');
  assert.ok(calls.some((c) => c.url.endsWith('/api/story-index/build')), 'the builder was asked');
  const asked = calls.findIndex((c) => c.url.endsWith('/api/story-index/build'));
  assert.ok(asked < calls.indexOf(due), 'asked BEFORE the flip, so the flip can carry it');
});

for (const mode of ['down', 'odd', 'throw']) {
  test(`LIMITS-1: builder ${mode} → the story still goes live, with the mirror's record (the reconciler completes it)`, async () => {
    const realErr = console.error; console.error = () => {};
    try {
      const calls = await runCron(makeDb(), { builder: mode });
      const due = flipOf(calls, 'due-story');
      assert.ok(due, 'the story did not go live');
      const rec = due.body['cms_stories_index/due-story'];
      assert.equal(rec.title, 'The Due One');
      assert.equal(rec.published, true);
      assert.equal(rec.opening, undefined, 'the mirror has no opening; the reconciler adds it');
    } finally { console.error = realErr; }
  });
}

test('LIMITS-1: at most 8 stories a tick ask the builder; the rest go live on the mirror\'s record', async () => {
  const db = makeDb();
  for (let i = 0; i < 11; i++) {
    db.cms_stories[`batch-${i}`] = { title: `Batch ${i}`, published: false, publishAt: PAST, cover: 'https://cdn.test/covers-typographic/b.webp', content: `<p>Batch ${i} opens here.</p>` };
  }
  const calls = await runCron(db);
  const flips = calls.filter((c) => c.method === 'PATCH' && Object.keys(c.body).some((k) => k.startsWith('cms_stories_index/')));
  assert.equal(flips.length, 13, 'every due story went live');
  assert.equal(calls.filter((c) => c.url.endsWith('/api/story-index/build')).length, 8);
  const withOpening = flips.filter((c) => Object.entries(c.body).some(([k, v]) => k.startsWith('cms_stories_index/') && typeof v.opening === 'string'));
  assert.equal(withOpening.length, 8);
});

// LIMITS-1 (ship) — THE TICK'S SUBREQUESTS. A Worker invocation has the same 50 as a Pages Function,
// and the builder calls add to it. Counted from this Worker, per tick:
//   publish half      1 (cms_stories) + per due story: 1 body read + 1 builder (first 8 only) + 1 flip
//                     (+1 GET, +1 PUT the first time, per due story still without a cover)
//   newsletter half   1 (drafts) + per due issue: 1 lock + 1 subscribers + ceil(N/50) Resend batches
//                     + 1 archive + 1 settle
//   end               1 deploy hook (if anything went live, or the first tick after London midnight)
//                     + 1 heartbeat
// At 8 due stories that is 27 + the newsletter half. Today (4 Nov 2026) there are 56 active
// subscribers and no scheduled issue; one due issue costs 6, so 34. Planned like every Function, to
// 45 of the 50: these pin 8 stories with two issues due at today's list (40) and with one issue due
// at ten times today's list (44). INDEX_BUILDER_PER_TICK stays 8.
const subscribersOf = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, { email: `invented${i}@example.com`, status: 'active' }]));
for (const [label, subscribers, issues, expected] of [['two issues due, today\'s list (56)', 56, 2, 40], ['one issue due, ten times today\'s list (560)', 560, 1, 44]]) {
  test(`LIMITS-1: a tick with 8 stories going live and ${label} stays within 45 subrequests`, async () => {
    const db = makeDb();
    db.subscribers = subscribersOf(subscribers);
    db.cms_stories = {};
    for (let i = 0; i < 8; i++) {
      db.cms_stories[`tick-${i}`] = { title: `Tick ${i}`, published: false, publishAt: PAST, cover: 'https://cdn.test/covers-typographic/t.webp', content: `<p>Tick ${i} opens here.</p>` };
    }
    const due = Object.entries(db.newsletter_drafts).filter(([, d]) => d.status === 'scheduled' && d.scheduledAt === PAST);
    for (const [id] of due.slice(issues)) delete db.newsletter_drafts[id];
    const calls = await runCron(db);
    assert.equal(calls.filter((c) => c.url.endsWith('/api/story-index/build')).length, 8, 'all 8 asked the builder');
    assert.equal(calls.length, expected, `the tick made ${calls.length} subrequests`);
    assert.ok(calls.length <= 45);
    console.log(`# Worker tick, 8 stories, ${label}: ${calls.length} subrequests`);
  });
}

test('a story whose publishAt is still ahead does not flip', async () => {
  const calls = await runCron(makeDb());
  const touched = calls.filter((c) => c.method === 'PATCH')
    .some((c) => JSON.stringify(c.body).includes('not-yet'));
  assert.ok(!touched, 'a future-dated story was published early');
});

test('the deploy hook fires once when stories went live', async () => {
  const calls = await runCron(makeDb());
  const hooks = calls.filter((c) => c.url.startsWith('https://api.cloudflare.com/'));
  assert.equal(hooks.length, 1, 'expected exactly one rebuild per cron run');
});

test('W1: the hook POSTed is the CMS_DEPLOY_HOOK_URL secret, not a literal', async () => {
  const calls = await runCron(makeDb());
  const hooks = calls.filter((c) => c.url.startsWith('https://api.cloudflare.com/'));
  assert.deepEqual(hooks.map((c) => [c.method, c.url]), [['POST', ENV.CMS_DEPLOY_HOOK_URL]]);
  assert.doesNotMatch(await readFile(WORKER, 'utf8'), /deploy_hooks\//, 'the Worker mirror must not name a deploy hook');
});

test('W1: with no secret set, nothing is POSTed and the miss is logged, not swallowed', async () => {
  const errors = [];
  const realErr = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const saved = ENV.CMS_DEPLOY_HOOK_URL;
  delete ENV.CMS_DEPLOY_HOOK_URL;
  try {
    const calls = await runCron(makeDb());
    assert.equal(calls.filter((c) => c.url.startsWith('https://api.cloudflare.com/')).length, 0);
  } finally {
    ENV.CMS_DEPLOY_HOOK_URL = saved;
    console.error = realErr;
  }
  assert.ok(errors.some((e) => /CMS_DEPLOY_HOOK_URL is not set/.test(e)), `no log line named the miss: ${errors.join(' | ')}`);
});

test('the deploy hook does not fire when nothing was published', async () => {
  const db = makeDb();
  db.cms_stories = { 'already-live': { title: 'Live', published: true, content: 'x' } };
  const calls = await runCron(db);
  assert.equal(calls.filter((c) => c.url.startsWith('https://api.cloudflare.com/')).length, 0);
});

test('…except on the first tick after London midnight, when it fires anyway (the free-week rebuild)', async () => {
  const db = makeDb();
  db.cms_stories = { 'already-live': { title: 'Live', published: true, content: 'x' } };
  for (const [iso, fires] of [['2026-11-03T00:05:00Z', 1], ['2026-11-03T00:14:59Z', 1], ['2026-11-03T00:15:00Z', 0], ['2026-07-30T23:05:00Z', 1], ['2026-07-30T00:05:00Z', 0]]) {
    mock.timers.setTime(Date.parse(iso));   // GMT in November, BST in July: 23:05 UTC is 00:05 London
    const calls = await runCron(db);
    assert.equal(calls.filter((c) => c.url.startsWith('https://api.cloudflare.com/')).length, fires, iso);
  }
});

// ── failure behaviour ────────────────────────────────────────────────────────

test('a Resend rejection does not lose the issue body', async () => {
  // Documents current behaviour: the draft is deleted even when every batch
  // fails, so the archive record is the ONLY surviving copy. If that record
  // ever stops carrying blocks, a failed scheduled send becomes unrecoverable.
  const calls = await runCron(makeDb(), { resendOk: false });
  const archived = calls.find((c) => c.url.startsWith(`${DB}/newsletter_sends.json`)
    && c.body.subject === 'Issue 8 — the inline one');
  assert.ok(archived, 'a failed send was not archived at all');
  assert.deepEqual(archived.body.blocks, INLINE_BLOCKS, 'the body of a failed send is unrecoverable');
  assert.equal(archived.body.recipientCount, 0);
  assert.equal(archived.body.failedCount, 2);
});

// FAILING — see the cron acceptance note. processScheduled() does the story half
// first and the newsletter half second, inside ONE try and behind one early
// `return`. Anything that makes the cms_stories read come back empty, or throw,
// skips every due newsletter for that tick. The drafts are not deleted, so the
// next tick retries — the issue is late, not lost — but a persistent fault on
// the stories read holds the mail indefinitely and logs it as "Cron error".
test('an empty cms_stories read does not stop the newsletter half of the cron', async () => {
  const db = makeDb();
  db.cms_stories = null;
  const calls = await runCron(db);
  const subjects = resendBatches(calls).flatMap((c) => c.body).map((m) => m.subject);
  assert.ok(subjects.includes('Issue 8 — the inline one'), 'scheduled mail was skipped');
});

test('a throwing cms_stories read does not stop the newsletter half of the cron', async () => {
  const db = makeDb();
  const { calls, fetchStub } = stubFetch(db);
  const real = globalThis.fetch;
  // A Firebase 5xx answers with HTML, not JSON — res.json() throws.
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(`${DB}/cms_stories.json`)) {
      return new Response('<html>502 Bad Gateway</html>', { status: 502 });
    }
    return fetchStub(url, init);
  };
  const pending = [];
  try {
    await worker.scheduled({ cron: '*/5 * * * *' }, ENV, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  } finally {
    globalThis.fetch = real;
  }
  const subjects = resendBatches(calls).flatMap((c) => c.body).map((m) => m.subject);
  assert.ok(subjects.includes('Issue 8 — the inline one'), 'scheduled mail was skipped');
});
