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

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const DB = 'https://calvary.firebaseio.test';
const ENV = {
  FIREBASE_DATABASE_URL: DB,
  FIREBASE_SECRET: 'secret',
  RESEND_API_KEY: 'resend-key',
  FROM_EMAIL: 'hello@calvaryscribblings.co.uk',
  NEWSLETTER_SEND_SECRET: 'send-secret',
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
        category: 'short', categoryName: 'Short Stories', cover: 'https://cdn.test/d.webp',
        date: '2026-07-30', published: false, publishAt: PAST,
        content: '<p>one two three four five</p>',
      },
      'also-due': {
        title: 'Also Due', author: 'B. Writer', published: false, publishAt: PAST,
        content: 'words words',
      },
      'not-yet': { title: 'Not Yet', published: false, publishAt: FUTURE, content: 'x' },
      'already-live': { title: 'Live', published: true, content: 'x' },
    },
    newsletter_drafts: {
      'due-inline': {
        status: 'scheduled', scheduledAt: PAST, subject: 'Issue 8 — the inline one',
        issueNumber: 8, blocks: INLINE_BLOCKS,
      },
      'due-legacy': {
        status: 'scheduled', scheduledAt: PAST, subject: 'Issue 9 — the legacy one',
        issueNumber: 9,
        intro: 'Legacy **stays** literal & <b>escaped</b>.',
        stories: [{ slug: 'old-tale', title: 'Old Tale', author: 'C. Writer' }],
      },
      'not-due': {
        status: 'scheduled', scheduledAt: FUTURE, subject: 'Issue 10 — later',
        issueNumber: 10, blocks: INLINE_BLOCKS,
      },
      'still-a-draft': {
        status: 'draft', scheduledAt: PAST, subject: 'Never sent',
        issueNumber: 11, blocks: INLINE_BLOCKS,
      },
    },
  };
}

// Intercepts every fetch the Worker makes, serves the fixture DB, and records
// the calls. Resend and the Cloudflare deploy hook are answered, never called.
function stubFetch(db, { resendOk = true } = {}) {
  const calls = [];
  const fetchStub = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });

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
    '/newsletter_drafts/due-inline.json',
    '/newsletter_drafts/due-legacy.json',
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

test('the deploy hook does not fire when nothing was published', async () => {
  const db = makeDb();
  db.cms_stories = { 'already-live': { title: 'Live', published: true, content: 'x' } };
  const calls = await runCron(db);
  assert.equal(calls.filter((c) => c.url.startsWith('https://api.cloudflare.com/')).length, 0);
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
