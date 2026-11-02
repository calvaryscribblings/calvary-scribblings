// LIVE-PATHS-2 — the two Pages Functions, UNMODIFIED, against a real Realtime Database (the emulator).
// EMULATOR ONLY.
//
//   npm run test:live-paths:emulator
//
// #8 functions/api/open-pages/moderate.js, EDIT mode. The interfering write lands DURING the model
//    call (the Anthropic stub makes it before answering), which is the real window: seconds.
// #7 functions/api/record-attempt.js: only an approved quiz on a story that exists is counted.
//
// RED ON MAIN: copy this file into a checkout of origin/main and run it there; the [hole] cases
// fail (the removed piece comes back, reads are lost, junk story nodes appear).
//
// Every request is routed: Google's token and lookup endpoints and Anthropic are answered here,
// the fake database host goes to the emulator, and anything else throws. Nothing leaves.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= '127.0.0.1:9471';
const EMU = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}`;
const NS = 'demo-live-paths';
const OWNER = { Authorization: 'Bearer owner' };
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIREBASE_DATABASE_EMULATOR_HOST)) {
  throw new Error('this suite runs against the emulator only');
}

const realFetch = globalThis.fetch;
const emu = (path, init = {}) => realFetch(`${EMU}/${path}.json?ns=${NS}`, { ...init, headers: { ...OWNER, ...(init.headers || {}) } });
const get = async (p) => (await emu(p)).json();
const put = (p, v) => emu(p, { method: 'PUT', body: JSON.stringify(v) });

const FAKE_DB = 'https://db.live-paths-2.test';
const WRITER = 'AAAAwriter000000000000000001';
let state;
const router = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = init.method || 'GET';
  if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'svc-token' });
  if (url.hostname === 'identitytoolkit.googleapis.com') return Response.json({ users: [{ localId: state.uid }] });
  if (url.hostname === 'api.anthropic.com') {
    state.modelCalls++;
    if (state.duringModel) await state.duringModel();
    return Response.json({ content: [{ type: 'tool_use', name: 'moderate_post', input: { decision: 'pass', categories: [], reason: 'clean' } }] });
  }
  if (url.origin !== FAKE_DB) throw new Error(`blocked: a request to ${url.origin}`);
  // Forward as the emulator owner, keeping the query (shallow) and the conditional-request headers.
  const q = new URLSearchParams(url.search);
  q.set('ns', NS);
  const h = { ...OWNER, 'Content-Type': 'application/json' };
  const src = new Headers(init.headers || {});
  for (const k of ['x-firebase-etag', 'if-match']) if (src.get(k)) h[k] = src.get(k);
  state.sent.push(`${method} ${url.pathname}`);
  return realFetch(`${EMU}${url.pathname}?${q}`, { method, body: init.body, headers: h });
};

let PRIVATE_KEY;
before(async () => {
  PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  globalThis.fetch = router;
  const r = await emu('', { method: 'DELETE' });
  assert.ok(r.ok, 'emulator reachable');
});
after(async () => { globalThis.fetch = realFetch; await emu('', { method: 'DELETE' }); });
beforeEach(async () => {
  state = { uid: WRITER, modelCalls: 0, duringModel: null, sent: [] };
  await emu('', { method: 'DELETE' });
});

const ENV = () => ({
  NEXT_PUBLIC_FIREBASE_API_KEY: 'web-key', FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: PRIVATE_KEY, FIREBASE_DATABASE_URL: FAKE_DB, ANTHROPIC_API_KEY: 'sk-test',
});
const call = async (handler, body) => {
  const res = await handler({ request: new Request('https://site.test/api', { method: 'POST', headers: { authorization: 'Bearer reader-token', 'content-type': 'application/json' }, body: JSON.stringify(body) }), env: ENV() });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// ── #8 moderate.js EDIT ─────────────────────────────────────────────────────────────────────────
const { onRequestPost: moderate } = await import('../../functions/api/open-pages/moderate.js');
const PID = '-Nlp2Piece000000001';
const PIECE = {
  authorUid: WRITER, authorName: 'A Writer', title: 'The title', body: 'The first body.', genre: 'Poetry',
  status: 'live', createdAt: 1761000000000, readCount: 10, moderation: { decision: 'pass', checkedAt: 1761000000000 },
};
const seedPiece = async () => {
  await put(`open_pages/${PID}`, PIECE);
  await put(`user_open_pages/${WRITER}/${PID}`, PIECE);
  await put(`users/${WRITER}`, { displayName: 'A Writer' });
};
const edit = () => call(moderate, { title: 'The title', body: 'The second body.', genre: 'Poetry', postId: PID });

describe('LIVE-PATHS-2 #8 · an Open Pages edit writes only over the version it was built from', () => {
  test('control: an edit with nothing in the way publishes, re-screened, mirrored', async () => {
    await seedPiece();
    const r = await edit();
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'published');
    const got = await get(`open_pages/${PID}`);
    assert.equal(got.body, 'The second body.');
    assert.equal(got.moderation.decision, 'pass');
    assert.ok(got.updatedAt);
    assert.deepEqual(await get(`user_open_pages/${WRITER}/${PID}`), got);
  });

  test('[hole] a piece removed while the edit was being screened stays removed', async () => {
    await seedPiece();
    state.duringModel = async () => { // a founder's Remove, from the Reported tab
      await emu('', { method: 'PATCH', body: JSON.stringify({ [`open_pages/${PID}`]: null, [`user_open_pages/${WRITER}/${PID}`]: null }) });
    };
    const r = await edit();
    assert.equal(r.status, 409);
    assert.equal(r.body.status, 'conflict');
    assert.equal(await get(`open_pages/${PID}`), null, 'the removed piece did not come back');
    assert.equal(await get(`user_open_pages/${WRITER}/${PID}`), null);
  });

  test('[hole] reads counted while the edit was being screened are kept', async () => {
    await seedPiece();
    state.duringModel = async () => {
      for (let i = 0; i < 3; i++) await emu(`open_pages/${PID}/readCount`, { method: 'PUT', body: JSON.stringify(11 + i) });
    };
    const r = await edit();
    assert.equal(r.status, 200);
    const got = await get(`open_pages/${PID}`);
    assert.equal(got.body, 'The second body.');
    assert.equal(got.readCount, 13, 'the three reads survive the edit');
    assert.equal((await get(`user_open_pages/${WRITER}/${PID}`)).readCount, 13);
  });

  test('[hole] a revision approved while the edit was being screened is not overwritten', async () => {
    await seedPiece();
    const approved = { ...PIECE, body: 'The approved revision.', approvedBy: 'founder', approvedAt: 1762000000000 };
    state.duringModel = async () => { await put(`open_pages/${PID}`, approved); };
    const r = await edit();
    assert.equal(r.status, 409);
    assert.deepEqual(await get(`open_pages/${PID}`), approved);
  });

  test('the emulator honours if-match (so the cases above prove the code, not the harness)', async () => {
    await put('etag-probe', { v: 1 });
    const r1 = await emu('etag-probe', { headers: { 'X-Firebase-ETag': 'true' } });
    const tag = r1.headers.get('ETag');
    assert.ok(tag);
    await put('etag-probe', { v: 2 });
    const r2 = await emu('etag-probe', { method: 'PUT', headers: { 'if-match': tag }, body: JSON.stringify({ v: 3 }) });
    assert.equal(r2.status, 412);
    assert.deepEqual(await get('etag-probe'), { v: 2 });
  });
});

// ── #7 record-attempt.js ────────────────────────────────────────────────────────────────────────
const { onRequestPost: recordAttempt } = await import('../../functions/api/record-attempt.js');
const READER = 'BBBBreader000000000000000002';
const attempt = (slug) => { state.uid = READER; return call(recordAttempt, { slug }); };

describe('LIVE-PATHS-2 #7 · record-attempt counts only an approved quiz on a story that exists', () => {
  test('[hole] no quiz and no story: refused, and no story node is made out of nothing', async () => {
    const r = await attempt('no-such-story');
    assert.equal(r.status, 404);
    assert.equal(await get('cms_stories/no-such-story'), null);
    assert.equal(await get(`quizAttemptCounted/${READER}`), null);
  });
  test('[hole] a draft quiz (never approved, or saved back to draft): refused, nothing counted', async () => {
    await put('cms_stories/drafted', { title: 'D', quizMeta: { hasQuiz: false, attemptCount: 4 } });
    await put('cms_quizzes/drafted', { mcqs: [], approvedAt: null });
    const r = await attempt('drafted');
    assert.equal(r.status, 404);
    assert.equal(await get('cms_stories/drafted/quizMeta/attemptCount'), 4);
    assert.equal(await get(`quizAttemptCounted/${READER}`), null);
  });
  test('[hole] an approved quiz whose story is gone: refused, no junk node', async () => {
    await put('cms_quizzes/orphan', { mcqs: [], approvedAt: 1762000000000 });
    const r = await attempt('orphan');
    assert.equal(r.status, 404);
    assert.equal(await get('cms_stories/orphan'), null);
  });
  test('an approved quiz on a live story is counted once', async () => {
    await put('cms_stories/live-one', { title: 'L', quizMeta: { hasQuiz: true, attemptCount: 4 } });
    await put('cms_quizzes/live-one', { mcqs: [], approvedAt: 1762000000000 });
    const r1 = await attempt('live-one');
    assert.equal(r1.status, 200);
    assert.equal(r1.body.counted, true);
    const r2 = await attempt('live-one');
    assert.equal(r2.body.counted, false);
    assert.equal(await get('cms_stories/live-one/quizMeta/attemptCount'), 5);
  });
});
