// W46 §2 — POST /api/series/notes, run for real against a fake host.
//
//   npm run test:series-notes          (node --test "tests/series-notes/*.test.mjs")
//
// The endpoint's onRequestPost with EVERY outbound call stubbed, as tests/ci/w40-stream-free
// does: identity (identitytoolkit), the admin token (oauth2), the database (an in-memory RTDB
// over REST — GET/PUT/PATCH/DELETE, multi-path PATCH at the root, `X-Firebase-ETag` and
// `if-match` with 412 semantics, the limiter's `.sv increment`), Cloud Storage, and the model
// (api.anthropic.com is STUBBED — nothing here ever reaches a network). A real RSA key so the
// token-minting path runs its own code.
//
// tests/series-notes/mutations.mjs breaks the endpoint's checks one at a time and asserts this
// file notices each one.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';

import { onRequestPost } from '../../functions/api/series/notes.js';
import { NOTES_ERRORS, NOTE_MAX, REPLY_MAX } from '../../app/lib/series/notes.js';
import { FOUNDER_UIDS } from '../../app/lib/founders.js';
import { GATE_ON_MS } from '../../app/lib/storyAccess.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const DB = 'https://fake-rtdb.test';
const BASE_ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_DATABASE_URL: DB,
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  SERIES_NOTES_TEST: '1',
};

const READER = 'readerUidW46';
const OTHER = 'otherUidW46';
const FREE = 'freeUidW46';
const WRITER = 'writerUidW46';
const FOUNDER = FOUNDER_UIDS[0];
const INST = 'probe-series-i1';
const INST2 = 'probe-series-i2';
const SID = 'probe-series';
const PAST = Date.now() - 86_400_000;
const FUTURE = Date.now() + 30 * 86_400_000;

const row = (over = {}) => ({ schemaVersion: 1, seriesId: SID, ordinal: 1, releaseAtMs: PAST, freeForGold: true, status: 'published', addedAt: 1, updatedAt: 1, ...over });
const QUESTIONS = { sit: 'When did you last keep a promise that cost you?', side: { text: 'Was she right to leave?', options: { a: 'Stay', b: 'Go' } }, line: 'Which line will you carry?', publishedAt: PAST };

// ── the fake RTDB ─────────────────────────────────────────────────────────────────────────
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
function prune(v) {
  if (v === null || typeof v !== 'object') return v;
  const out = {};
  for (const [k, c] of Object.entries(v)) { const p = prune(c); if (p !== null && p !== undefined) out[k] = p; }
  return Object.keys(out).length ? out : null;
}
const segs = (path) => path.split('/').filter(Boolean);
function getAt(tree, path) {
  let cur = tree.root;
  for (const s of segs(path)) { if (!cur || typeof cur !== 'object') return null; cur = cur[s]; }
  return cur === undefined ? null : clone(cur);
}
function setAt(tree, path, value) {
  const parts = segs(path);
  if (!parts.length) { tree.root = prune(clone(value)) || {}; return; }
  if (!tree.root || typeof tree.root !== 'object') tree.root = {};
  let cur = tree.root;
  for (const s of parts.slice(0, -1)) { if (!cur[s] || typeof cur[s] !== 'object') cur[s] = {}; cur = cur[s]; }
  const leaf = parts[parts.length - 1];
  const v = prune(clone(value));
  if (v === null) delete cur[leaf]; else cur[leaf] = v;
  tree.root = prune(tree.root) || {};
}
const etagOf = (v) => createHash('sha1').update(JSON.stringify(v ?? null)).digest('hex');

// ── a tiny EPUB ───────────────────────────────────────────────────────────────────────────
function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const { name, text, method = 8 } of entries) {
    const raw = Buffer.from(text, 'utf8');
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(data.length, 18); loc.writeUInt32LE(raw.length, 22); loc.writeUInt16LE(n.length, 26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(offset, 42);
    locals.push(loc, n, data); centrals.push(cen, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const CHAPTER = 'The rain came in sideways over the lagoon, and Ama counted the boats twice. '.repeat(20);
const EPUB = zip([
  { name: 'mimetype', text: 'application/epub+zip', method: 0 },
  { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
  { name: 'OEBPS/content.opf', text: '<package><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>' },
  { name: 'OEBPS/ch1.xhtml', text: `<html><head><title>x</title></head><body><p>${CHAPTER}</p></body></html>` },
]);

// ── the host ──────────────────────────────────────────────────────────────────────────────
let host;
let realFetch;

function screenAnswer(input) {
  return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'screen_note', input }] }), { status: 200 });
}
function draftAnswer() {
  return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'draft_questions', input: {
    sit: 'When did you last wait for someone who might not come?',
    side: { text: 'Should Ama have gone out in the storm?', options: ['Yes, she had to', 'No, it was reckless'] },
    line: 'Which line from the lagoon will stay with you?',
  } }] }), { status: 200 });
}

function seed() {
  return {
    [`series_instalments`]: { [INST]: row(), [INST2]: row({ ordinal: 2 }) },
    series: { [SID]: { title: 'Probe', authorUid: WRITER, status: 'published' } },
    series_instalments_detail: { [INST]: { title: 'One' } },
    users: {
      [READER]: { displayName: 'Ada Reader', username: 'ada', readCount: 3, membership: 'platinum' },
      [OTHER]: { displayName: 'Bo Other', username: 'bo', membership: 'platinum' },
      [FREE]: { displayName: 'Free Reader', membership: 'free' },
      [WRITER]: { displayName: 'The Writer', username: 'writer', membership: 'platinum' },
    },
    series_finished: {
      [READER]: { [INST]: PAST, [INST2]: PAST },
      [OTHER]: { [INST]: PAST },
      [FREE]: { [INST]: PAST },
      [WRITER]: { [INST]: PAST },
      [FOUNDER]: { [INST]: PAST },
    },
    series_questions: { [INST]: QUESTIONS },
    series_questions_public: { [INST]: { sit: QUESTIONS.sit, publishedAt: PAST } },
  };
}

function install(over = {}) {
  host = {
    tree: { root: seed() },
    writes: [],
    limiter: 'ok',          // 'ok' | 'limit' | 'down'
    stale: {},              // path → how many conditional PUTs to refuse with 412
    screen: () => screenAnswer({ hold: false, reason: 'fine' }),
    draft: () => draftAnswer(),
    anthropicCalls: [],
    epub: EPUB,
    ...over,
  };
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const okJson = (body, extra = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', ...extra } });

    if (u.hostname === 'identitytoolkit.googleapis.com') {
      const { idToken } = JSON.parse(init.body);
      const m = /^tok:(.+)$/.exec(idToken);
      return okJson({ users: m ? [{ localId: m[1] }] : [] });
    }
    if (u.hostname === 'oauth2.googleapis.com') return okJson({ access_token: 'stub-admin-token' });
    if (u.hostname === 'storage.googleapis.com') {
      host.storageReads = (host.storageReads || 0) + 1;
      if (!host.epub) return new Response('no such object', { status: 404 });
      return new Response(host.epub, { status: 200 });
    }
    if (u.hostname === 'api.anthropic.com') {
      const body = JSON.parse(init.body);
      host.anthropicCalls.push(body);
      return body.tool_choice?.name === 'draft_questions' ? host.draft(body) : host.screen(body);
    }
    if (`${u.protocol}//${u.host}` === DB) {
      const path = decodeURIComponent(u.pathname.replace(/\.json$/, '')).replace(/^\//, '');
      if (path.startsWith('rate_limits/')) {
        if (host.limiter === 'down') return new Response('nope', { status: 500 });
        if (method === 'DELETE') return okJson(null);
        if (host.limiter === 'limit') return okJson(999_999);
        const cur = Number(getAt(host.tree, path)) || 0;
        setAt(host.tree, path, cur + 1);
        return okJson(cur + 1);
      }
      if (host.failGet && method === 'GET' && path.startsWith(host.failGet)) return new Response('down', { status: 503 });
      const current = getAt(host.tree, path);
      if (method === 'GET') {
        const extra = headers.get('X-Firebase-ETag') === 'true' ? { ETag: etagOf(current) } : {};
        return okJson(current, extra);
      }
      const body = init.body ? JSON.parse(init.body) : null;
      host.writes.push({ method, path, body });
      if (method === 'PUT') {
        const ifMatch = headers.get('if-match');
        if (ifMatch) {
          if (host.stale[path] > 0) { host.stale[path] -= 1; return new Response(JSON.stringify(current), { status: 412, headers: { ETag: etagOf(current) } }); }
          if (ifMatch !== etagOf(current)) return new Response(JSON.stringify(current), { status: 412, headers: { ETag: etagOf(current) } });
        }
        setAt(host.tree, path, body);
        return okJson(body);
      }
      if (method === 'PATCH') {
        for (const [k, v] of Object.entries(body || {})) setAt(host.tree, path ? `${path}/${k}` : k, v);
        return okJson(body);
      }
      if (method === 'DELETE') { setAt(host.tree, path, null); return okJson(null); }
    }
    throw new Error(`unstubbed fetch: ${method} ${u.href}`);
  };
}
beforeEach(() => install());
afterEach(() => { globalThis.fetch = realFetch; });

const at = (path) => getAt(host.tree, path);
const put = (path, v) => setAt(host.tree, path, v);
const wrote = (prefix) => host.writes.some((w) => w.path === prefix || w.path.startsWith(`${prefix}/`)
  || (w.path === '' && Object.keys(w.body || {}).some((k) => k === prefix || k.startsWith(`${prefix}/`))));

async function call(body, { uid = READER, env = {}, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = token !== undefined ? token : (uid ? `tok:${uid}` : null);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await onRequestPost({
    request: new Request('https://x.test/api/series/notes', { method: 'POST', headers, body: JSON.stringify(body) }),
    env: { ...BASE_ENV, ...env },
    waitUntil: () => {},
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}
const note = (over = {}, opts) => call({ action: 'note', inst: INST, kind: 'sit', text: 'It stayed with me all night.', ...over }, opts);

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W46 · the order of the checks', () => {
  test('the tier gate is on (these are the after-launch answers)', () => {
    assert.ok(Date.now() >= GATE_ON_MS);
  });

  test('1. flag off → 404 not_enabled, before identity, for every reader action', async () => {
    for (const action of ['side', 'note', 'reply', 'remove', 'nonsense']) {
      const r = await call({ action, inst: INST }, { env: { SERIES_NOTES_TEST: '0' }, uid: null });
      assert.equal(r.status, 404, action);
      assert.equal(r.body.code, 'not_enabled');
      assert.equal(r.body.error, NOTES_ERRORS.not_enabled);
    }
    assert.equal(host.writes.length, 0);
  });

  test('flag off: the founders\' actions still work', async () => {
    put(`series_question_drafts/${INST}`, { sit: 'A?', side: { text: 'B?', options: { a: 'x', b: 'y' } }, line: 'C?' });
    const r = await call({ action: 'publish-questions', inst: INST2 }, { uid: FOUNDER, env: { SERIES_NOTES_TEST: '0' } });
    assert.equal(r.body.code, 'not_ready'); // reached the action, past the flag
    const p = await call({ action: 'publish-questions', inst: INST }, { uid: FOUNDER, env: { SERIES_NOTES_TEST: '0' } });
    assert.equal(p.status, 200);
  });

  test('2. no token → 401 signed_out; a bad token → 401; a body uid is never read', async () => {
    const a = await note({}, { uid: null });
    assert.equal(a.status, 401); assert.equal(a.body.code, 'signed_out');
    const b = await note({ uid: READER }, { token: 'garbage' });
    assert.equal(b.status, 401);
    assert.equal(wrote('series_notes'), false);
  });

  test('3. the limiter refuses → 429 limit with Retry-After; limiter down → 503, fail closed', async () => {
    host.limiter = 'limit';
    const a = await note();
    assert.equal(a.status, 429); assert.equal(a.body.code, 'limit'); assert.ok(Number(a.headers.get('Retry-After')) >= 1);
    host.limiter = 'down';
    const b = await note();
    assert.equal(b.status, 503); assert.equal(b.body.code, 'limiter_unavailable');
    assert.equal(at(`series_notes/${INST}`), null);
    assert.equal(host.anthropicCalls.length, 0, 'the model is never called past a refusal');
  });

  test('4. unreleased or unpublished or missing → 409 not_released', async () => {
    put(`series_instalments/${INST}`, row({ releaseAtMs: FUTURE }));
    assert.equal((await note()).body.code, 'not_released');
    put(`series_instalments/${INST}`, row({ status: 'draft' }));
    const r = await note();
    assert.equal(r.status, 409); assert.equal(r.body.code, 'not_released');
    const missing = await note({ inst: 'no-such-inst' });
    assert.equal(missing.body.code, 'not_released');
  });

  test('5. no access under the tier gate → 403 no_access (a Free reader, a Platinum-only instalment)', async () => {
    put(`series_instalments/${INST}`, row({ freeForGold: false, openToFree: false }));
    const r = await note({}, { uid: FREE });
    assert.equal(r.status, 403); assert.equal(r.body.code, 'no_access');
    assert.equal(at(`series_notes/${INST}`), null);
    // control: Platinum passes the same instalment, and a free-to-read one opens to Free.
    assert.equal((await note()).status, 200);
    put(`series_instalments/${INST}`, row({ openToFree: true }));
    assert.equal((await note({}, { uid: FREE })).status, 200);
  });

  test('5. a day pass does not open a Platinum-only instalment (the subscription decides)', async () => {
    put(`series_instalments/${INST}`, row({ freeForGold: false }));
    put(`memberships/${FREE}`, { pass: { tier: 'platinum', expiresAt: Date.now() + 3_600_000 } });
    const r = await note({}, { uid: FREE });
    assert.equal(r.body.code, 'no_access');
  });

  test('5. a membership read failure fails closed (502)', async () => {
    host.failGet = 'memberships/';
    const r = await note();
    assert.equal(r.status, 502); assert.equal(r.body.code, 'unavailable');
  });

  test('founders pass the access policy', async () => {
    put(`series_instalments/${INST}`, row({ freeForGold: false, openToFree: false }));
    put(`users/${FOUNDER}`, { displayName: 'Founder', membership: 'free' });
    assert.equal((await note({}, { uid: FOUNDER })).status, 200);
  });

  test('6. not finished → 403 not_finished, for side, note and reply', async () => {
    put(`series_finished/${READER}/${INST}`, null);
    for (const body of [{ action: 'side', option: 'a' }, { action: 'note', kind: 'else', text: 'x' }, { action: 'reply', noteId: 'abc', text: 'x' }]) {
      const r = await call({ inst: INST, ...body });
      assert.equal(r.status, 403, body.action); assert.equal(r.body.code, 'not_finished');
    }
    assert.equal(at(`series_room_members/${INST}`), null);
    assert.equal(at(`series_side_tallies/${INST}`), null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W46 · side', () => {
  test('no published questions → 409 no_questions', async () => {
    const r = await call({ action: 'side', inst: INST2, option: 'a' });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'no_questions');
  });

  test('an option outside the question → 400', async () => {
    const r = await call({ action: 'side', inst: INST, option: 'c' });
    assert.equal(r.status, 400);
    assert.equal(at(`series_sides/${INST}/${READER}`), null);
  });

  test('a first side records, tallies, joins the room and refreshes the summary', async () => {
    const r = await call({ action: 'side', inst: INST, option: 'a' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, side: 'a', tally: { a: 1 } });
    assert.equal(at(`series_sides/${INST}/${READER}`), 'a');
    assert.equal(typeof at(`series_room_members/${INST}/${READER}`), 'number');
    const s = at(`series_notes_summary/${SID}`);
    assert.equal(s.byInst[INST].kinds.side, 1);
    assert.equal(s.byInst[INST].readers, 1);
  });

  test('changing side moves the tally across, never below zero; the same side moves nothing', async () => {
    await call({ action: 'side', inst: INST, option: 'a' });
    await call({ action: 'side', inst: INST, option: 'a', }, { uid: OTHER });
    const joined = at(`series_room_members/${INST}/${READER}`);
    const r = await call({ action: 'side', inst: INST, option: 'b' });
    assert.deepEqual(r.body.tally, { a: 1, b: 1 });
    const again = await call({ action: 'side', inst: INST, option: 'b' });
    assert.deepEqual(again.body.tally, { a: 1, b: 1 });
    assert.equal(at(`series_room_members/${INST}/${READER}`), joined, 'joined once, at the first answer');
    // a tally that drifted to zero is not driven negative
    put(`series_side_tallies/${INST}`, { a: 0, b: 1 });
    put(`series_sides/${INST}/${READER}`, 'a');
    const r2 = await call({ action: 'side', inst: INST, option: 'b' });
    assert.deepEqual(r2.body.tally, { a: 0, b: 2 });
  });

  test('a 412 (another writer between our read and our write) is retried', async () => {
    host.stale[`series_side_tallies/${INST}`] = 2;
    const r = await call({ action: 'side', inst: INST, option: 'a' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.tally, { a: 1 });
    assert.deepEqual(at(`series_side_tallies/${INST}`), { a: 1 });
    assert.equal(host.stale[`series_side_tallies/${INST}`], 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W46 · note', () => {
  test('a clear note posts live, with the author snapshot, joins the room, and the summary holds no words', async () => {
    const r = await note();
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'live');
    const n = at(`series_notes/${INST}/${r.body.noteId}`);
    assert.equal(n.uid, READER); assert.equal(n.kind, 'sit'); assert.equal(n.text, 'It stayed with me all night.');
    assert.deepEqual(n.author, { name: 'Ada Reader', handle: 'ada', badge: 3 });
    assert.equal(n.writer, undefined); assert.equal(n.unscreened, undefined);
    assert.ok(/^[-0-9A-Za-z_]{20}$/.test(r.body.noteId), 'a push-style id');
    assert.equal(typeof at(`series_room_members/${INST}/${READER}`), 'number');
    const s = at(`series_notes_summary/${SID}`);
    assert.equal(s.byInst[INST].notes, 1); assert.equal(s.byInst[INST].kinds.sit, 1);
    assert.equal(s.inst, INST); assert.equal(s.sit, QUESTIONS.sit);
    assert.equal(JSON.stringify(s).includes('stayed with me'), false);
    assert.equal(host.anthropicCalls.length, 1);
    assert.equal(host.anthropicCalls[0].model, 'claude-haiku-4-5');
  });

  test('ids sort by time', async () => {
    const a = await note();
    await new Promise((r) => setTimeout(r, 5));
    const b = await note();
    assert.ok(a.body.noteId < b.body.noteId);
  });

  test('kinds side/sit/line need published questions; else does not', async () => {
    for (const kind of ['sit', 'side', 'line']) {
      const r = await note({ inst: INST2, kind });
      assert.equal(r.status, 409, kind); assert.equal(r.body.code, 'no_questions');
    }
    const e = await note({ inst: INST2, kind: 'else' });
    assert.equal(e.status, 200);
  });

  test('a bad kind, an empty note, a note over 500 → 400 with the contract\'s codes', async () => {
    assert.equal((await note({ kind: 'rant' })).body.code, 'bad_kind');
    assert.equal((await note({ text: '   ' })).body.code, 'empty');
    const long = await note({ text: 'x'.repeat(NOTE_MAX + 1) });
    assert.equal(long.status, 400); assert.equal(long.body.code, 'too_long');
    assert.equal((await note({ text: 'x'.repeat(NOTE_MAX) })).status, 200);
    assert.equal(host.anthropicCalls.length, 1, 'a refused note is never screened');
  });

  test('a side note takes the RECORDED side, never one from the body', async () => {
    const none = await note({ kind: 'side', side: 'a' });
    assert.equal(none.status, 400); assert.equal(none.body.code, 'no_side');
    put(`series_sides/${INST}/${READER}`, 'b');
    const r = await note({ kind: 'side', side: 'a' });
    assert.equal(r.status, 200);
    assert.equal(at(`series_notes/${INST}/${r.body.noteId}`).side, 'b');
  });

  test('a line note carries its line; a line on another kind is refused', async () => {
    const line = { text: 'The boats came home empty.', cfi: 'epubcfi(/6/2!/4/2)', epubVersion: '123' };
    const r = await note({ kind: 'line', line });
    assert.equal(r.status, 200);
    assert.deepEqual(at(`series_notes/${INST}/${r.body.noteId}`).line, line);
    assert.equal((await note({ kind: 'sit', line })).body.code, 'bad_line');
  });

  test('writer: true for the series authorUid (ruling 163), and for nobody else', async () => {
    const w = await note({}, { uid: WRITER });
    assert.equal(w.status, 200);
    assert.equal(at(`series_notes/${INST}/${w.body.noteId}`).writer, true);
    const r = await note();
    assert.equal(at(`series_notes/${INST}/${r.body.noteId}`).writer, undefined);
  });

  test('flagged → series_notes_held only, with the reason; no live note, no membership, no summary', async () => {
    host.screen = () => screenAnswer({ hold: true, category: 'personal-data', reason: 'a phone number' });
    const r = await note();
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'held');
    const h = at(`series_notes_held/${INST}/${r.body.noteId}`);
    assert.equal(h.reason, 'personal-data'); assert.equal(h.uid, READER);
    assert.equal(at(`series_notes/${INST}`), null);
    assert.equal(at(`series_room_members/${INST}/${READER}`), null);
    assert.equal(at(`series_notes_summary/${SID}`), null);
  });

  test('an off-list category is held as other', async () => {
    host.screen = () => screenAnswer({ hold: true, category: 'rudeness', reason: 'x' });
    const r = await note();
    assert.equal(at(`series_notes_held/${INST}/${r.body.noteId}`).reason, 'other');
  });

  for (const [what, setup] of [
    ['the model throws', () => { host.screen = () => { throw new Error('network down'); }; }],
    ['the model answers 500', () => { host.screen = () => new Response('overloaded', { status: 529 }); }],
    ['the model answers prose', () => { host.screen = () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'fine' }] }), { status: 200 }); }],
  ]) {
    test(`screening cannot run (${what}) → posted LIVE, unscreened: true`, async () => {
      setup();
      const r = await note();
      assert.equal(r.status, 200);
      assert.equal(r.body.status, 'unscreened');
      const n = at(`series_notes/${INST}/${r.body.noteId}`);
      assert.equal(n.unscreened, true);
      assert.equal(at(`series_notes_held/${INST}`), null);
    });
  }

  test('no ANTHROPIC_API_KEY → posted live, unscreened, and the model is never called', async () => {
    const r = await note({}, { env: { ANTHROPIC_API_KEY: undefined } });
    assert.equal(r.body.status, 'unscreened');
    assert.equal(host.anthropicCalls.length, 0);
    assert.equal(at(`series_notes/${INST}/${r.body.noteId}`).unscreened, true);
  });

  test('a summary failure never fails the note', async () => {
    host.stale[`series_notes_summary/${SID}`] = 99;
    const r = await note();
    assert.equal(r.status, 200);
    assert.ok(at(`series_notes/${INST}/${r.body.noteId}`));
  });

  test('the profile read failing still posts, as "Reader"', async () => {
    // A founder, so the access gate reads no membership and only the profile read fails.
    host.failGet = `users/${FOUNDER}`;
    const r = await note({}, { uid: FOUNDER });
    assert.equal(r.status, 200);
    assert.deepEqual(at(`series_notes/${INST}/${r.body.noteId}`).author, { name: 'Reader' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W46 · reply', () => {
  async function liveNote(uid = OTHER) {
    const r = await note({}, { uid });
    return r.body.noteId;
  }

  test('a reply under a live note posts, joins, and replyTo must be in the same thread', async () => {
    const nid = await liveNote();
    const r = await call({ action: 'reply', inst: INST, noteId: nid, text: 'Yes, exactly.' });
    assert.equal(r.status, 200); assert.equal(r.body.status, 'live');
    const rep = at(`series_note_replies/${INST}/${nid}/${r.body.replyId}`);
    assert.equal(rep.text, 'Yes, exactly.'); assert.equal(rep.uid, READER); assert.equal(rep.author.name, 'Ada Reader');
    assert.ok(at(`series_room_members/${INST}/${READER}`));
    const r2 = await call({ action: 'reply', inst: INST, noteId: nid, text: 'And again.', replyTo: r.body.replyId }, { uid: OTHER });
    assert.equal(at(`series_note_replies/${INST}/${nid}/${r2.body.replyId}`).replyTo, r.body.replyId);
    const bad = await call({ action: 'reply', inst: INST, noteId: nid, text: 'x', replyTo: 'not-in-thread' });
    assert.equal(bad.status, 404); assert.equal(bad.body.code, 'not_found');
  });

  test('no live parent → 404; too long → 400', async () => {
    const r = await call({ action: 'reply', inst: INST, noteId: 'gone', text: 'x' });
    assert.equal(r.status, 404); assert.equal(r.body.code, 'not_found');
    const nid = await liveNote();
    const long = await call({ action: 'reply', inst: INST, noteId: nid, text: 'y'.repeat(REPLY_MAX + 1) });
    assert.equal(long.status, 400); assert.equal(long.body.code, 'too_long');
  });

  test('a flagged reply is held with kind reply and its parent', async () => {
    const nid = await liveNote();
    host.screen = () => screenAnswer({ hold: true, category: 'abuse', reason: 'x' });
    const r = await call({ action: 'reply', inst: INST, noteId: nid, text: 'nasty' });
    assert.equal(r.body.status, 'held');
    const h = at(`series_notes_held/${INST}/${r.body.replyId}`);
    assert.equal(h.kind, 'reply'); assert.equal(h.noteId, nid); assert.equal(h.reason, 'abuse');
    assert.equal(at(`series_note_replies/${INST}`), null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W46 · remove', () => {
  test('your own note goes with its replies, underlines and reports, in ONE write', async () => {
    const nid = (await note()).body.noteId;
    await call({ action: 'reply', inst: INST, noteId: nid, text: 'a reply' }, { uid: OTHER });
    put(`series_note_underlines/${INST}/${nid}/${OTHER}`, true);
    put(`series_note_reports/${INST}/${nid}/${OTHER}`, { at: Date.now() });
    const before = host.writes.length;
    const r = await call({ action: 'remove', inst: INST, noteId: nid });
    assert.equal(r.status, 200);
    for (const p of ['series_notes', 'series_note_replies', 'series_note_underlines', 'series_note_reports']) {
      assert.equal(at(`${p}/${INST}/${nid}`), null, p);
    }
    const cascade = host.writes.slice(before).filter((w) => w.path === '' && Object.keys(w.body).includes(`series_notes/${INST}/${nid}`));
    assert.equal(cascade.length, 1);
    assert.equal(Object.keys(cascade[0].body).length, 4);
    assert.equal(at(`series_notes_summary/${SID}`).byInst[INST].notes, 0);
  });

  test('someone else\'s note → 403 forbidden; a founder may remove any, unfinished or not', async () => {
    const nid = (await note({}, { uid: OTHER })).body.noteId;
    const r = await call({ action: 'remove', inst: INST, noteId: nid });
    assert.equal(r.status, 403); assert.equal(r.body.code, 'forbidden');
    assert.ok(at(`series_notes/${INST}/${nid}`));
    put(`series_finished/${FOUNDER}`, null);
    const f = await call({ action: 'remove', inst: INST, noteId: nid }, { uid: FOUNDER });
    assert.equal(f.status, 200);
    assert.equal(at(`series_notes/${INST}/${nid}`), null);
  });

  test('a reply\'s removal keeps the row and strips the text', async () => {
    const nid = (await note({}, { uid: OTHER })).body.noteId;
    const rid = (await call({ action: 'reply', inst: INST, noteId: nid, text: 'my reply' })).body.replyId;
    const no = await call({ action: 'remove', inst: INST, noteId: nid, replyId: rid }, { uid: OTHER });
    assert.equal(no.status, 403);
    const r = await call({ action: 'remove', inst: INST, noteId: nid, replyId: rid });
    assert.equal(r.status, 200);
    const row2 = at(`series_note_replies/${INST}/${nid}/${rid}`);
    assert.equal(row2.removed, true);
    assert.equal(row2.uid, READER);
    assert.equal(row2.text, '');
  });

  test('the author may remove their own HELD note; nobody else may', async () => {
    host.screen = () => screenAnswer({ hold: true, category: 'spam', reason: 'x' });
    const nid = (await note()).body.noteId;
    assert.equal((await call({ action: 'remove', inst: INST, noteId: nid }, { uid: OTHER })).status, 403);
    assert.equal((await call({ action: 'remove', inst: INST, noteId: nid })).status, 200);
    assert.equal(at(`series_notes_held/${INST}/${nid}`), null);
  });

  test('nothing there → 404', async () => {
    const r = await call({ action: 'remove', inst: INST, noteId: 'nothing' });
    assert.equal(r.status, 404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W46 · review (founders)', () => {
  async function held(uid = READER, text = 'held one') {
    host.screen = () => screenAnswer({ hold: true, category: 'other', reason: 'x' });
    const id = (await note({ text }, { uid })).body.noteId;
    host.screen = () => screenAnswer({ hold: false, reason: 'ok' });
    return id;
  }

  test('a non-founder cannot review → 403 forbidden', async () => {
    const nid = await held();
    const r = await call({ action: 'review', inst: INST, noteId: nid, decision: 'approve' });
    assert.equal(r.status, 403); assert.equal(r.body.code, 'forbidden');
    assert.ok(at(`series_notes_held/${INST}/${nid}`));
    assert.equal(at(`series_notes/${INST}/${nid}`), null);
  });

  test('approve moves held → live, drops the reason, joins the author, refreshes the summary', async () => {
    const nid = await held();
    const r = await call({ action: 'review', inst: INST, noteId: nid, decision: 'approve' }, { uid: FOUNDER });
    assert.equal(r.status, 200);
    const n = at(`series_notes/${INST}/${nid}`);
    assert.equal(n.uid, READER); assert.equal(n.kind, 'sit'); assert.equal(n.reason, undefined);
    assert.equal(at(`series_notes_held/${INST}/${nid}`), null);
    assert.ok(at(`series_room_members/${INST}/${READER}`));
    assert.equal(at(`series_notes_summary/${SID}`).byInst[INST].notes, 1);
  });

  test('approve a held reply puts it under its note', async () => {
    const nid = (await note({}, { uid: OTHER })).body.noteId;
    host.screen = () => screenAnswer({ hold: true, category: 'other', reason: 'x' });
    const rid = (await call({ action: 'reply', inst: INST, noteId: nid, text: 'r' })).body.replyId;
    const r = await call({ action: 'review', inst: INST, noteId: rid, decision: 'approve' }, { uid: FOUNDER });
    assert.equal(r.status, 200);
    const rep = at(`series_note_replies/${INST}/${nid}/${rid}`);
    assert.equal(rep.text, 'r'); assert.equal(rep.kind, undefined); assert.equal(rep.noteId, undefined);
  });

  test('remove deletes from held, or a live note with its cascade', async () => {
    const nid = await held();
    assert.equal((await call({ action: 'review', inst: INST, noteId: nid, decision: 'remove' }, { uid: FOUNDER })).status, 200);
    assert.equal(at(`series_notes_held/${INST}/${nid}`), null);
    const live = (await note()).body.noteId;
    put(`series_note_reports/${INST}/${live}/${OTHER}`, { at: 1 });
    assert.equal((await call({ action: 'review', inst: INST, noteId: live, decision: 'remove' }, { uid: FOUNDER })).status, 200);
    assert.equal(at(`series_notes/${INST}/${live}`), null);
    assert.equal(at(`series_note_reports/${INST}/${live}`), null);
  });

  test('dismiss clears the reports and keeps the note', async () => {
    const live = (await note()).body.noteId;
    put(`series_note_reports/${INST}/${live}/${OTHER}`, { at: 1 });
    const r = await call({ action: 'review', inst: INST, noteId: live, decision: 'dismiss' }, { uid: FOUNDER });
    assert.equal(r.status, 200);
    assert.equal(at(`series_note_reports/${INST}/${live}`), null);
    assert.ok(at(`series_notes/${INST}/${live}`));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W46 · publish-questions (founders)', () => {
  const READY = { sit: 'What would you wait for?', side: { text: 'Stay or go?', options: { a: 'Stay', b: 'Go', c: 'Neither' } }, line: 'Which line stays?' };

  test('a non-founder cannot publish', async () => {
    put(`series_question_drafts/${INST2}`, READY);
    const r = await call({ action: 'publish-questions', inst: INST2 });
    assert.equal(r.status, 403);
    assert.equal(at(`series_questions/${INST2}`), null);
  });

  test('two of three ready → 409 and NOTHING is written', async () => {
    put(`series_question_drafts/${INST2}`, { ...READY, line: '' });
    const r = await call({ action: 'publish-questions', inst: INST2 }, { uid: FOUNDER });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'not_ready');
    assert.equal(at(`series_questions/${INST2}`), null);
    assert.equal(at(`series_questions_public/${INST2}`), null);
    assert.equal(wrote('series_questions'), false);
    assert.equal(wrote('series_questions_public'), false);
  });

  test('all three → series_questions + series_questions_public in ONE write; the door leads with the latest', async () => {
    put(`series_question_drafts/${INST2}`, READY);
    const before = host.writes.length;
    const r = await call({ action: 'publish-questions', inst: INST2 }, { uid: FOUNDER });
    assert.equal(r.status, 200);
    assert.deepEqual(at(`series_questions/${INST2}`).side.options, READY.side.options);
    assert.equal(at(`series_questions_public/${INST2}`).sit, READY.sit);
    assert.equal(Object.keys(at(`series_questions_public/${INST2}`)).sort().join(), 'publishedAt,sit');
    const one = host.writes.slice(before).filter((w) => w.path === '' && `series_questions/${INST2}` in w.body && `series_questions_public/${INST2}` in w.body);
    assert.equal(one.length, 1);
    const s = at(`series_notes_summary/${SID}`);
    assert.equal(s.inst, INST2); assert.equal(s.sit, READY.sit); assert.equal(s.ordinal, 2);
  });

  test('publishing an EARLIER instalment does not take the door from the latest', async () => {
    put(`series_question_drafts/${INST2}`, READY);
    await call({ action: 'publish-questions', inst: INST2 }, { uid: FOUNDER });
    put(`series_question_drafts/${INST}`, { ...READY, sit: 'Earlier?' });
    await call({ action: 'publish-questions', inst: INST }, { uid: FOUNDER });
    const s = at(`series_notes_summary/${SID}`);
    assert.equal(s.inst, INST2); assert.equal(s.sit, READY.sit);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
describe('W46 · draft-questions (founders)', () => {
  test('a non-founder cannot draft, and nothing is read from Storage', async () => {
    const r = await call({ action: 'draft-questions', inst: INST });
    assert.equal(r.status, 403);
    assert.equal(host.storageReads, undefined);
  });

  test('reads the EPUB, asks the quiz\'s model, writes DRAFTS only — never series_questions', async () => {
    put(`series_question_drafts/${INST2}`, { editorNote: 'keep me' });
    const r = await call({ action: 'draft-questions', inst: INST2 }, { uid: FOUNDER, env: { SERIES_NOTES_TEST: '0' } });
    assert.equal(r.status, 200);
    const d = at(`series_question_drafts/${INST2}`);
    assert.equal(d.editorNote, 'keep me', 'PATCH, so nothing else in the draft is lost');
    assert.deepEqual(d.side.options, { a: 'Yes, she had to', b: 'No, it was reckless' });
    assert.equal(d.model, 'claude-sonnet-4-6');
    assert.equal(typeof d.draftedAt, 'number');
    assert.deepEqual(r.body.draft.sit, d.sit);
    const call0 = host.anthropicCalls[0];
    assert.equal(call0.model, 'claude-sonnet-4-6');
    assert.equal(call0.tool_choice.name, 'draft_questions');
    assert.ok(call0.messages[0].content.includes('Ama counted the boats twice'), 'the EPUB text reached the prompt');
    assert.equal(at(`series_questions/${INST2}`), null);
    assert.equal(at(`series_questions_public/${INST2}`), null);
    assert.equal(wrote('series_questions'), false);
    assert.equal(wrote('series_questions_public'), false);
  });

  test('no EPUB → 404; a model failure → 502 and no draft', async () => {
    host.epub = null;
    assert.equal((await call({ action: 'draft-questions', inst: INST2 }, { uid: FOUNDER })).status, 404);
    host.epub = EPUB;
    host.draft = () => new Response('nope', { status: 500 });
    const r = await call({ action: 'draft-questions', inst: INST2 }, { uid: FOUNDER });
    assert.equal(r.status, 502);
    assert.equal(at(`series_question_drafts/${INST2}`), null);
  });

  test('the global draft cap is charged (and refuses at its limit)', async () => {
    host.limiter = 'limit';
    const r = await call({ action: 'draft-questions', inst: INST2 }, { uid: FOUNDER });
    assert.equal(r.status, 429);
    assert.equal(host.anthropicCalls.length, 0);
  });
});
