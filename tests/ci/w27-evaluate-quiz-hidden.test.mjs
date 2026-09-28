// W27 §4 — a hidden story's body must never reach an answer. /api/evaluate-quiz read a story's
// body whenever the record existed, so a story with published:false could have its text quoted
// back into a quiz evaluation. It now answers 404 with story.js's own rule and body.
//
// LOCAL FIXTURES ONLY. globalThis.fetch is replaced for the whole file: the token mint, the
// identity lookup, the rate-limit counter, the story record, the body and the model are all
// answered here, and any request the stub does not recognise throws — nothing reaches a network,
// production least of all.
//
//   node --test tests/ci/w27-evaluate-quiz-hidden.test.mjs          (npm run test:ci)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { onRequestPost } from '../../functions/api/evaluate-quiz.js';
import { STORY_NOT_FOUND } from '../../functions/api/_story-body.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const ENV = {
  FIREBASE_CLIENT_EMAIL: 'test@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_DATABASE_URL: 'https://db.test', NEXT_PUBLIC_FIREBASE_API_KEY: 'k', ANTHROPIC_API_KEY: 'x',
};
const BODY = '<p>The ferryman waited at the crossing, and the river said nothing at all.</p>';

let realFetch, calls, stories;
before(() => { realFetch = globalThis.fetch; });
after(() => { globalThis.fetch = realFetch; });

function stub() {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    const json = (v, status = 200) => new Response(JSON.stringify(v), { status });
    if (/oauth2\.googleapis\.com/.test(u)) return json({ access_token: 't' });
    if (/identitytoolkit\.googleapis\.com/.test(u)) return json({ users: [{ localId: 'fixtureReader01' }] });
    if (/\/rate_limits\//.test(u)) return init.method === 'DELETE' ? json(null) : new Response('1', { status: 200 });
    const rec = /\/cms_stories\/([^/.]+)\.json/.exec(u);
    if (rec) return json(stories[decodeURIComponent(rec[1])] ?? null);
    if (/\/story_bodies\//.test(u)) return json({ content: BODY, extractedText: '' });
    if (/api\.anthropic\.com/.test(u)) return json({ content: [{ type: 'text', text: '{"score":1,"feedback":"ok"}' }] });
    throw new Error(`unexpected request in a local-fixture test: ${u}`);
  };
}

const call = (slug) => onRequestPost({
  env: ENV,
  waitUntil: () => {},
  request: new Request('https://site.test/api/evaluate-quiz', {
    method: 'POST',
    headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
    body: JSON.stringify({ slug, type: 'hardball', hardball: { question: 'Q?', keywords: ['a', 'b', 'c'] }, answer: 'an answer' }),
  }),
});

test('a HIDDEN story answers 404 with story.js\'s own body, and its body is never read', async () => {
  stories = { 'the-crossing': { title: 'The Crossing', author: 'A. N. Other', published: false } };
  stub();
  const res = await call('the-crossing');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), STORY_NOT_FOUND);
  assert.equal(calls.filter((u) => /story_bodies/.test(u)).length, 0, 'the body must not even be fetched');
  assert.equal(calls.filter((u) => /anthropic/.test(u)).length, 0, 'and nothing is sent to a model');
});

test('a MISSING story answers the same 404', async () => {
  stories = {};
  stub();
  const res = await call('nowhere');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), STORY_NOT_FOUND);
});

test('a PUBLISHED story still reads its body and is evaluated', async () => {
  stories = { 'the-crossing': { title: 'The Crossing', author: 'A. N. Other', published: true } };
  stub();
  const res = await call('the-crossing');
  assert.notEqual(res.status, 404);
  assert.equal(calls.filter((u) => /story_bodies/.test(u)).length, 1);
  assert.equal(calls.filter((u) => /anthropic/.test(u)).length, 1);
});

test('a record with no published field reads as published, as story.js has it', async () => {
  stories = { 'old-one': { title: 'Old', author: 'A' } };
  stub();
  const res = await call('old-one');
  assert.notEqual(res.status, 404);
});
