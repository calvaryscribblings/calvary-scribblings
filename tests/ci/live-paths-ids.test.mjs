// LIVE-PATHS-1 — an id is checked before it becomes a database address.
//
// 1. The check on its own (app/lib/ids.js): every live id passes; '.', '..', '../x', '%2e%2e',
//    a slash, '' and an over-long id fail, for every kind.
// 2. The Worker's copy of the rules is byte-identical to app/lib/ids.js.
// 3. Each server call site: a traversal id is refused with a 400 and NO request leaves the handler
//    (fetch is stubbed; the only call allowed through is the identity lookup that proves who is
//    asking, and that carries no id). No network, no database: the emulator half of this round is
//    tests/live-paths/*.emulator.test.mjs.
// 4. The path helpers the CMS uses throw before returning a path.
// 5. Source pins for the client call sites that can't run in node.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isId, assertId, IdError, ID_RULES } from '../../app/lib/ids.js';
import { hidePaths, unhidePlan, hideUpdate, unhideUpdate } from '../../app/lib/storyState.js';
import { placementPaths, recordSavePaths, extractTextPaths } from '../../app/lib/storyText.js';
import { indexUpdatePaths } from '../../app/lib/storyIndex.js';
import { newStorySlug } from '../../app/lib/storySlug.js';
import { planOwned, runDeletion } from '../../functions/api/account/_deletion.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const LIVE = JSON.parse(src('tests/ci/fixtures/live-slugs.json'));

const ADMIN = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const READER = 'Zq3XbXrT0aQwPp9LmN2kVc7sJd41'; // 28 alphanumerics, the shape Firebase Auth makes

// The traversal set the brief names, plus the near misses a cleaner would "fix".
const BAD = ['.', '..', '../x', '../subscribers', '%2e%2e', '%2E%2E', '.%2e', 'a/b', '/', 'a/', '/a', '',
  ' ', '\t', 'a b', 'a#b', 'a$b', 'a[b]', 'a?b', 'a\u0000b', '..\\x'];
const NOT_STRINGS = [null, undefined, 0, 1758790800001, true, {}, [], ['a']];

describe('1 · the check on its own', () => {
  test('every live story slug passes (213 keys of cms_stories_index)', () => {
    assert.equal(LIVE.slugs.length, LIVE.count);
    assert.ok(LIVE.count > 200);
    for (const s of LIVE.slugs) assert.ok(isId('slug', s), s);
  });

  test('real ids of the other kinds pass', () => {
    assert.ok(isId('draftId', Date.now().toString()), 'a draft id is Date.now().toString()');
    assert.ok(isId('draftId', '1758790800001'));
    assert.ok(isId('uid', READER));
    assert.ok(isId('uid', ADMIN));
    assert.ok(isId('sendId', '-OAbCdEfGhIjKlMnOp_r'), 'an RTDB push id is 20 characters');
  });

  for (const kind of Object.keys(ID_RULES)) {
    test(`${kind}: dots, slashes, percent-encoded dots, empty and over-long all fail`, () => {
      for (const v of BAD) assert.equal(isId(kind, v), false, `${kind} ${JSON.stringify(v)}`);
      for (const v of NOT_STRINGS) assert.equal(isId(kind, v), false, `${kind} ${String(v)}`);
      const long = 'a'.repeat(ID_RULES[kind].max + 1);
      assert.equal(isId(kind, long), false, `${kind} over-long`);
    });
  }

  test('a bad id is refused, never cleaned: nothing that merely contains a valid id passes', () => {
    for (const v of ['-story', 'story-', 'Story', 'a--b', ' story', 'story ', 'story\n', 'story.json']) {
      assert.equal(isId('slug', v), false, JSON.stringify(v));
    }
    for (const v of ['0758790800001', '175879080000', '17587908000011', ' 1758790800001', '1758790800001\n']) {
      assert.equal(isId('draftId', v), false, JSON.stringify(v));
    }
  });

  test('assertId returns the id unchanged, or throws an IdError carrying 400', () => {
    assert.equal(assertId('slug', 'the-call'), 'the-call');
    assert.throws(() => assertId('slug', '../x'), IdError);
    assert.throws(() => assertId('slug', ''), (err) => err instanceof IdError && err.status === 400 && err.kind === 'slug');
    assert.throws(() => isId('nope', 'x'), /unknown id kind/);
  });
});

describe('2 · the Worker carries the same rules, byte for byte', () => {
  const block = (text) => {
    const a = text.indexOf('// ── ID RULES MIRROR');
    const b = text.indexOf('// ── END ID RULES MIRROR ──');
    assert.ok(a >= 0 && b > a, 'markers present');
    return text.slice(a, b);
  };
  test('app/lib/ids.js ⇄ workers-external/calvary-newsletter.worker.js', () => {
    assert.equal(block(src('workers-external/calvary-newsletter.worker.js')), block(src('app/lib/ids.js')));
  });
  test('every newsletter_drafts/<id> URL in the Worker is built in draftUrl() alone', () => {
    const w = src('workers-external/calvary-newsletter.worker.js');
    assert.equal(w.match(/newsletter_drafts\/\$\{/g).length, 1);
    assert.match(w, /function draftUrl\(env, id\) \{\n {2}if \(!isId\("draftId", id\)\) throw/);
  });
});

// ── 3 · call sites, with every outgoing request recorded ────────────────────────────────────
let left; let realFetch;
const IDENTITY = /^https:\/\/identitytoolkit\.googleapis\.com\//;
function stubFetch(asUid) {
  left = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (IDENTITY.test(url)) return Response.json({ users: [{ localId: asUid, email: null }] });
    left.push(`${init.method || 'GET'} ${url}`);
    return Response.json({});
  };
}
const quiet = () => { const o = { log: console.log, warn: console.warn, error: console.error }; console.log = console.warn = console.error = () => {}; return () => Object.assign(console, o); };
let unquiet;
beforeEach(() => { unquiet = quiet(); });
afterEach(() => { if (realFetch) globalThis.fetch = realFetch; realFetch = null; unquiet(); });

const ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'k', NEWSLETTER_SEND_SECRET: 'nss',
  FIREBASE_DATABASE_URL: 'https://db.test', FIREBASE_CLIENT_EMAIL: 'sa@test', FIREBASE_PRIVATE_KEY: 'pk',
  FIREBASE_SECRET: 'fs', ANTHROPIC_API_KEY: 'a',
};
const post = (path, body) => new Request(`https://site.test${path}`, {
  method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const del = (path) => new Request(`https://site.test${path}`, { method: 'DELETE', headers: { authorization: 'Bearer t' } });

async function refused(res, label) {
  assert.equal(res.status, 400, `${label}: status`);
  assert.deepEqual(left, [], `${label}: a request left the handler`);
}

const SLUG_BAD = [...BAD, 'a'.repeat(129)];
const DRAFT_BAD = [...BAD.filter((v) => v !== ''), '1'.repeat(14), 'd1'];

describe('3 · the newsletter proxy refuses before the Worker is called', () => {
  test('POST /api/newsletter/draft with a traversal id', async () => {
    const { onRequestPost } = await import('../../functions/api/newsletter/draft.js');
    for (const id of [...DRAFT_BAD, '']) {
      stubFetch(ADMIN);
      await refused(await onRequestPost({ request: post('/api/newsletter/draft', { id, subject: 's', blocks: [] }), env: ENV }), `save ${JSON.stringify(id)}`);
    }
  });
  test('DELETE /api/newsletter/draft?id=… with a traversal id', async () => {
    const { onRequestDelete } = await import('../../functions/api/newsletter/draft.js');
    for (const id of [...DRAFT_BAD, '']) {
      stubFetch(ADMIN);
      await refused(await onRequestDelete({ request: del(`/api/newsletter/draft?id=${encodeURIComponent(id)}`), env: ENV }), `delete ${JSON.stringify(id)}`);
    }
    stubFetch(ADMIN);
    await refused(await onRequestDelete({ request: del('/api/newsletter/draft'), env: ENV }), 'delete with no id');
  });
  test('a valid id still goes through (the stub sees the Worker call)', async () => {
    const { onRequestPost, onRequestDelete } = await import('../../functions/api/newsletter/draft.js');
    stubFetch(ADMIN);
    await onRequestDelete({ request: del('/api/newsletter/draft?id=1758790800001'), env: ENV });
    assert.deepEqual(left, ['DELETE https://calvary-newsletter.calvarymediauk.workers.dev/draft/1758790800001']);
    stubFetch(ADMIN);
    await onRequestPost({ request: post('/api/newsletter/draft', { subject: 's', blocks: [] }), env: ENV });
    assert.deepEqual(left, ['POST https://calvary-newsletter.calvarymediauk.workers.dev/draft'], 'a new draft carries no id');
  });
  test('/api/newsletter/send with a traversal draftId mails nobody', async () => {
    const { onRequestPost } = await import('../../functions/api/newsletter/send.js');
    for (const draftId of DRAFT_BAD) {
      stubFetch(ADMIN);
      await refused(await onRequestPost({ request: post('/api/newsletter/send', { subject: 's', blocks: [], draftId }), env: ENV }), `send ${JSON.stringify(draftId)}`);
    }
  });
  test('/api/newsletter/retry with a traversal sendId', async () => {
    const { onRequestPost } = await import('../../functions/api/newsletter/retry.js');
    for (const sendId of BAD) {
      stubFetch(ADMIN);
      await refused(await onRequestPost({ request: post('/api/newsletter/retry', { sendId }), env: ENV }), `retry ${JSON.stringify(sendId)}`);
    }
  });
});

describe('3 · the Worker refuses before the database is called', () => {
  const W = 'https://calvary-newsletter.test';
  const wreq = (method, path, body) => new Request(`${W}${path}`, {
    method, headers: { authorization: 'Bearer nss', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const worker = async () => (await import('../../workers-external/calvary-newsletter.worker.js')).default;

  test('DELETE /draft/<traversal>: refused, or not a route at all; never a database call', async () => {
    const w = await worker();
    // `/draft/.` and `/draft/%2e` reach the Worker as `/draft/` (an empty id): audit #1.
    for (const path of ['/draft/.', '/draft/%2e', '/draft/', '/draft/..%2fsubscribers', '/draft/d1', '/draft/1758790800001%2f..', `/draft/${'1'.repeat(14)}`]) {
      stubFetch(ADMIN);
      const res = await w.fetch(wreq('DELETE', path), ENV);
      assert.ok(res.status === 400 || res.status === 404, `${path}: ${res.status}`);
      assert.deepEqual(left, [], `${path}: a request left`);
    }
    for (const path of ['/draft/..', '/draft/%2e%2e', '/draft/../subscribers']) {
      stubFetch(ADMIN); // normalised out of /draft/ entirely: no route
      assert.equal((await w.fetch(wreq('DELETE', path), ENV)).status, 404, path);
      assert.deepEqual(left, []);
    }
  });
  test('POST /draft with a traversal id: 400, nothing written (audit #2)', async () => {
    const w = await worker();
    for (const id of [...DRAFT_BAD, '']) {
      stubFetch(ADMIN);
      await refused(await w.fetch(wreq('POST', '/draft', { id, subject: 's', blocks: [] }), ENV), `save ${JSON.stringify(id)}`);
    }
  });
  test('POST /send and /retry with a traversal id: 400, nobody mailed', async () => {
    const w = await worker();
    for (const draftId of DRAFT_BAD) {
      stubFetch(ADMIN);
      await refused(await w.fetch(wreq('POST', '/send', { subject: 's', blocks: [{ type: 'text', id: '1', content: 'x' }], draftId }), ENV), `send ${JSON.stringify(draftId)}`);
    }
    for (const sendId of BAD) {
      stubFetch(ADMIN);
      await refused(await w.fetch(wreq('POST', '/retry', { sendId }), ENV), `retry ${JSON.stringify(sendId)}`);
    }
  });
  test('the cron leaves a due draft whose key is not a draftId alone: no lock, no mail, no delete', async () => {
    const w = await worker();
    left = []; realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = init.method || 'GET';
      left.push(`${method} ${url}`);
      if (method === 'GET' && url.startsWith('https://db.test/newsletter_drafts.json')) {
        return Response.json({ 'legacy-key': { status: 'scheduled', scheduledAt: '2020-01-01T00:00:00Z', subject: 's', blocks: [{ type: 'text', id: '1', content: 'x' }] } });
      }
      if (method === 'GET') return Response.json(null);
      return Response.json({});
    };
    const pending = [];
    await w.scheduled({ cron: '*/5 * * * *' }, ENV, { waitUntil: (p) => pending.push(p) });
    await Promise.allSettled(pending);
    assert.deepEqual(left.filter((l) => /newsletter_drafts\/|resend|subscribers/.test(l)), [], 'nothing touched that draft or the list');
  });

  test('a valid save and delete still reach the database, at exactly their own path', async () => {
    const w = await worker();
    stubFetch(ADMIN);
    await w.fetch(wreq('DELETE', '/draft/1758790800001'), ENV);
    assert.deepEqual(left, ['DELETE https://db.test/newsletter_drafts/1758790800001.json?auth=fs']);
    stubFetch(ADMIN);
    const r = await (await w.fetch(wreq('POST', '/draft', { subject: 's', blocks: [] }), ENV)).json();
    assert.ok(isId('draftId', r.id));
    assert.deepEqual(left, [`PUT https://db.test/newsletter_drafts/${r.id}.json?auth=fs`]);
  });
});

describe('3 · the other Functions', () => {
  test('/api/record-attempt (audit #7)', async () => {
    const { onRequestPost } = await import('../../functions/api/record-attempt.js');
    for (const slug of SLUG_BAD) {
      stubFetch(READER);
      await refused(await onRequestPost({ request: post('/api/record-attempt', { slug }), env: ENV }), `record ${JSON.stringify(slug)}`);
    }
  });
  test('/api/admin/reset-attempt (audit #6): slug and uid', async () => {
    const { onRequestPost } = await import('../../functions/api/admin/reset-attempt.js');
    for (const slug of SLUG_BAD) {
      stubFetch(ADMIN);
      await refused(await onRequestPost({ request: post('/api/admin/reset-attempt', { slug, uid: READER }), env: ENV }), `slug ${JSON.stringify(slug)}`);
      stubFetch(ADMIN);
      await refused(await onRequestPost({ request: post('/api/admin/reset-attempt', { slug, action: 'bulk' }), env: ENV }), `bulk ${JSON.stringify(slug)}`);
    }
    for (const uid of BAD) {
      stubFetch(ADMIN);
      await refused(await onRequestPost({ request: post('/api/admin/reset-attempt', { slug: 'the-call', uid }), env: ENV }), `uid ${JSON.stringify(uid)}`);
    }
  });
  test('/api/evaluate-quiz: refused before the rate limiter writes', async () => {
    const { onRequestPost } = await import('../../functions/api/evaluate-quiz.js');
    for (const slug of SLUG_BAD) {
      stubFetch(READER);
      await refused(await onRequestPost({ request: post('/api/evaluate-quiz', { slug, type: 'essays' }), env: ENV }), `evaluate ${JSON.stringify(slug)}`);
    }
  });
  test('/api/generate-quiz', async () => {
    const { onRequestPost } = await import('../../functions/api/generate-quiz.js');
    for (const slug of SLUG_BAD) {
      stubFetch(ADMIN);
      await refused(await onRequestPost({ request: post('/api/generate-quiz', { slug, mode: 'story' }), env: ENV }), `generate ${JSON.stringify(slug)}`);
    }
  });
  test('/og/image: a slug that walks out of cms_stories/<slug>/cover is refused', async () => {
    const { onRequest } = await import('../../functions/og/image.js');
    for (const slug of [...SLUG_BAD, 'x/../../users/abc/photoURL', 'a?shallow=true']) {
      stubFetch(READER);
      await refused(await onRequest({ request: new Request(`https://site.test/og/image?slug=${encodeURIComponent(slug)}`) }), `og ${JSON.stringify(slug)}`);
    }
  });
  test('readStoryBody throws before minting a token or reading', async () => {
    const { readStoryBody } = await import('../../functions/api/_story-body.js');
    for (const slug of SLUG_BAD) {
      stubFetch(ADMIN);
      await assert.rejects(readStoryBody(ENV, slug), IdError);
      assert.deepEqual(left, []);
    }
  });
  test('account deletion (audit #9): planOwned and runDeletion refuse a non-uid', async () => {
    for (const uid of BAD) {
      assert.throws(() => planOwned(uid, {}, null), IdError, JSON.stringify(uid));
      const io = { now: () => 1, get: async () => { throw new Error('read'); }, patch: async () => { throw new Error('write'); } };
      await assert.rejects(runDeletion(uid, null, io), IdError);
    }
    assert.ok(planOwned(READER, {}, null)[`users/${READER}`] === null);
  });
});

describe('3 · Proofs (PROOFS-R2): slugs and report ids go through app/lib/ids.js', () => {
  test('POST /api/proofs {action:"proof"} with a traversal slug: 400 before identity is even asked', async () => {
    const { onRequest } = await import('../../functions/api/proofs/index.js');
    for (const slug of [...SLUG_BAD, 'The-Call', 'the_call', 'a'.repeat(129), 'x/../../users']) {
      left = []; realFetch = globalThis.fetch;
      globalThis.fetch = async (input, init = {}) => { left.push(`${init.method || 'GET'} ${typeof input === 'string' ? input : input.url}`); return Response.json({}); };
      await refused(await onRequest({ request: post('/api/proofs', { action: 'proof', slug }), env: ENV }), `proof ${JSON.stringify(slug)}`);
    }
  });
  test('POST /api/proofs/report with a traversal slug: 400, nothing counted, nothing written, nobody mailed', async () => {
    const { onRequest } = await import('../../functions/api/proofs/report.js');
    for (const slug of [...SLUG_BAD, 'The-Call', 'x/../../users']) {
      left = []; realFetch = globalThis.fetch;
      globalThis.fetch = async (input, init = {}) => { left.push(`${init.method || 'GET'} ${typeof input === 'string' ? input : input.url}`); return Response.json({}); };
      await refused(await onRequest({ request: post('/api/proofs/report', { slug, message: 'a long enough message' }), env: ENV }), `report ${JSON.stringify(slug)}`);
    }
  });
  test('a valid slug is not refused by the check (it reaches identity)', async () => {
    const { onRequest } = await import('../../functions/api/proofs/index.js');
    stubFetch(READER);
    const res = await onRequest({ request: post('/api/proofs', { action: 'proof', slug: 'the-call' }), env: ENV });
    assert.notEqual(res.status, 400);
  });
  test('the predicates are the site\'s own: isProofSlug = slug, isReportId = an RTDB push id', async () => {
    const { isProofSlug, isReportId } = await import('../../app/lib/proofs.js');
    for (const s of LIVE.slugs) assert.ok(isProofSlug(s), s);
    for (const v of SLUG_BAD) assert.equal(isProofSlug(v), false, JSON.stringify(v));
    assert.ok(isReportId('-OAbCdEfGhIjKlMnOp_r'));
    for (const v of BAD) assert.equal(isReportId(v), false, JSON.stringify(v));
    assert.ok(!src('app/lib/proofs.js').includes('SLUG_RE'), 'no private slug pattern');
  });
  test('/admin/proofs: the key is the id, and every address it builds is checked first', () => {
    const p = src('app/admin/proofs/page.js');
    assert.ok(!p.includes('({ id, ...r })'));
    assert.ok(p.includes('.filter(([id, r]) => isReportId(id) && r && typeof r === \'object\')'));
    assert.ok(p.includes('.map(([id, r]) => ({ ...r, id }))'));
    assert.ok(p.includes('.filter(isProofSlug)'));
    assert.ok(p.includes(".filter((u) => isId('uid', u))"));
    const body = p.slice(p.indexOf('const setStatus = async (id, status)'));
    assert.ok(body.indexOf('if (!isReportId(id)) return;') >= 0 && body.indexOf('if (!isReportId(id)) return;') < body.indexOf('await update('));
  });
});

describe('4 · the CMS path helpers throw before returning a path (audit #3)', () => {
  const rec = { title: 't', cover: '/covers-typographic/x.jpg', published: true };
  const helpers = {
    hidePaths: (s) => hidePaths(s, 1),
    unhidePlan: (s) => unhidePlan(s, rec),
    hideUpdate: (s) => hideUpdate(s, rec, { content: 'x' }, 1),
    unhideUpdate: (s) => unhideUpdate(s, rec, { content: 'x' }),
    placementPaths: (s) => placementPaths(s, { content: 'x' }, true),
    recordSavePaths: (s) => recordSavePaths(s, { title: 't', published: true }),
    extractTextPaths: (s) => extractTextPaths(s, 'x', true),
    indexUpdatePaths: (s) => indexUpdatePaths(s, rec),
  };
  for (const [name, fn] of Object.entries(helpers)) {
    test(`${name}`, () => {
      for (const s of SLUG_BAD) assert.throws(() => fn(s), IdError, `${name}(${JSON.stringify(s)})`);
      const out = fn('the-call');
      const keys = Object.keys(out.paths || out);
      assert.ok(keys.length > 0);
      for (const k of keys) assert.match(k, /\/the-call(\/|$)/, k);
    });
  }
  test('newStorySlug refuses an address over 128 characters with its own reason', async () => {
    const v = await newStorySlug({ title: 'word '.repeat(40), isTaken: () => false });
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'invalid');
    assert.deepEqual(await newStorySlug({ title: 'The Call', isTaken: () => false }), { ok: true, slug: 'the-call' });
  });
});

describe('5 · client call sites (source pins: these run in a browser)', () => {
  test('the CMS list: the KEY is the id, a stored `id` field never overrides it', () => {
    const p = src('app/admin/page.js');
    assert.ok(!p.includes('({ id, ...s })'));
    assert.ok(p.includes('({ ...s, id })'));
    for (const fn of ['async function deleteStory(id)', 'async function hideStory(id)', 'async function unhideStory(id)']) {
      const body = p.slice(p.indexOf(fn), p.indexOf(fn) + 2500);
      assert.ok(body.indexOf("assertId('slug', id)") > 0 && body.indexOf("assertId('slug', id)") < body.indexOf('await update('), fn);
    }
  });
  test('the newsletter admin: ids from the keys, checked before every request', () => {
    const p = src('app/admin/newsletter/page.js');
    assert.ok(p.includes('Object.entries(data).map(([id, d]) => ({ ...d, id }))'));
    assert.ok(!/Object\.values\(data\)\.sort/.test(p));
    for (const [fn, call] of [['async function deleteDraft(d)', '/api/newsletter/draft?id='], ['async function retryFailed(sendId)', '/api/newsletter/retry'], ['async function doSend(isTest)', '/api/newsletter/send']]) {
      const body = p.slice(p.indexOf(fn), p.indexOf(fn) + 2500);
      assert.ok(body.indexOf('isId(') > 0 && body.indexOf('isId(') < body.indexOf(call), fn);
    }
  });
  test('reader-written fields never override keys in the lists that build write paths', () => {
    for (const f of ['app/square/page.js', 'app/profile/page.js', 'app/stories/[slug]/page-client.js', 'app/reader/[slug]/page-reader.js']) {
      const p = src(f);
      assert.ok(!/=> \(\{ id, \.\.\.(n|c) \}\)/.test(p), f);
    }
    for (const f of ['app/admin/exercises/page.js', 'app/admin/submissions/page.js']) {
      assert.ok(src(f).includes('all.push({ displayName, ...sub, uid, slug });'), f);
    }
    assert.ok(src('scripts/square/horizon.mjs').includes('({ ...p, id })'));
    assert.ok(src('scripts/bookstore/withdrawals.mjs').includes("({ ...(doc || {}), id })"));
  });
  test('URL- and field-built paths go through a check', () => {
    assert.match(src('app/square/p/page.js'), /if \(!isPostId\(id\)\) \{ setState\(\{ phase: 'gone' \}\); return; \}/);
    assert.match(src('app/square/p/page.js'), /const rootId = parentOk \? post\.parentId : id;/);
    assert.match(src('app/user/page.js'), /if \(id && isId\('uid', id\)\) \{/);
    assert.match(src('app/open-pages/[id]/page-client.js'), /if \(!user \|\| !isId\('uid', uid\) \|\| uid === user\.uid\) return;/);
    assert.match(src('app/components/square/MessagesPanel.js'), /if \(!isId\('uid', otherUid\)\) return;/);
    assert.match(src('scripts/square/horizon.mjs'), /if \(isId\('uid', p\.authorUid\)\) patch\[`user_square_posts/);
    assert.match(src('scripts/covers/on-publish.mjs'), /if \(!isId\('uid', uid\)\) throw/);
  });
});
