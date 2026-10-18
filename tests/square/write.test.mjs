// W54 — the Square's write Function, unit by unit (npm run test:square).
//
//   · the hours (ruling 210) at 19:59, 20:00, 00:05 and 00:06 London, on BOTH sides of the clock
//     change on 25 Oct 2026, and founders exempt;
//   · the pace (ruling 211) at its edges: the 5th post and the 30th reply pass, the next is
//     refused, and a slot frees exactly when the oldest leaves the 10-minute window;
//   · the edit window: own post only, 5 minutes from the SERVER's createdAt, text only;
//   · client author fields, createdAt and counts are ignored;
//   · the caps (500 / 300), again on the server, and the attachment and poll shapes.
//
// The handler runs unmodified against an in-memory database that speaks the REST subset it uses
// (GET with ETag, conditional PUT). Google is stood in for: `tok-<uid>` verifies as <uid>. No
// request leaves the process. The real-database run is tests/square/write.emulator.test.mjs.
import { test, describe, beforeEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { handleWrite } from '../../functions/api/square/write.js';
import {
  withinHours, londonSecondOfDay, evaluateRate, editRefusal, buildRecord, authorSnapshot,
  RATE_LIMITS, RATE_WINDOW_MS, EDIT_WINDOW_MS, SQUARE_WRITE_COPY, cleanAttachedStory,
} from '../../app/lib/squareWrite.js';

const FOUNDER = 'XaG6bTGqdDXh7VkBTw4y1H2d2s82';
const READER = 'w54-test-reader';
const OTHER = 'w54-reader-b';
const Z = (iso) => Date.parse(iso);

// ── the clock change ────────────────────────────────────────────────────────────────────
// BST until 01:00 UTC on Sun 25 Oct 2026, GMT after. 20:00 London is 19:00Z on the 24th and
// 20:00Z on the 25th; the grace after the 24th's midnight falls at 23:05Z, still in BST.
const SIDES = {
  'BST (Sat 24 Oct → Sun 25)': { '19:59': '2026-10-24T18:59:00Z', '20:00': '2026-10-24T19:00:00Z', '00:05': '2026-10-24T23:05:00Z', '00:06': '2026-10-24T23:06:00Z' },
  'GMT (Sun 25 Oct → Mon 26)': { '19:59': '2026-10-25T19:59:00Z', '20:00': '2026-10-25T20:00:00Z', '00:05': '2026-10-26T00:05:00Z', '00:06': '2026-10-26T00:06:00Z' },
};

describe('W54 · the hours (ruling 210)', () => {
  for (const [side, at] of Object.entries(SIDES)) {
    test(`${side}: 19:59 shut, 20:00 open, 00:05 open, 00:06 shut`, () => {
      assert.equal(withinHours(Z(at['19:59'])), false, '19:59');
      assert.equal(withinHours(Z(at['20:00'])), true, '20:00');
      assert.equal(withinHours(Z(at['00:05'])), true, '00:05');
      assert.equal(withinHours(Z(at['00:06'])), false, '00:06');
    });
  }
  test('the edges to the second: 00:05:00 is in, 00:05:01 is out; 19:59:59 is out', () => {
    assert.equal(withinHours(Z('2026-10-26T00:05:00Z')), true);
    assert.equal(withinHours(Z('2026-10-26T00:05:01Z')), false);
    assert.equal(withinHours(Z('2026-10-25T19:59:59Z')), false);
  });
  test('London, not a fixed offset: 19:00Z opens the doors on the 24th and not on the 25th', () => {
    assert.equal(withinHours(Z('2026-10-24T19:00:00Z')), true);
    assert.equal(withinHours(Z('2026-10-25T19:00:00Z')), false);
    assert.equal(londonSecondOfDay(Z('2026-10-25T01:30:00Z')), 1 * 3600 + 30 * 60, '01:30 GMT after the change');
  });
});

describe('W54 · the pace (ruling 211)', () => {
  const NOW = Z('2026-10-24T20:00:00Z');
  test('the 5th post passes and the 6th is refused; the 30th reply passes and the 31st is refused', () => {
    let stored = null;
    for (let i = 0; i < RATE_LIMITS.post; i++) {
      const v = evaluateRate(stored, 'post', NOW + i);
      assert.equal(v.ok, true, `post ${i + 1}`);
      stored = v.next;
    }
    assert.equal(evaluateRate(stored, 'post', NOW + 10).ok, false, 'post 6');
    for (let i = 0; i < RATE_LIMITS.reply; i++) {
      const v = evaluateRate(stored, 'reply', NOW + 100 + i);
      assert.equal(v.ok, true, `reply ${i + 1}`);
      stored = v.next;
    }
    assert.equal(evaluateRate(stored, 'reply', NOW + 200).ok, false, 'reply 31');
    assert.equal(stored.post.length, 5, 'posts and replies are counted apart');
  });
  test('a slot frees exactly when the oldest leaves the 10-minute window', () => {
    const stored = { post: [0, 1, 2, 3, 4].map((i) => NOW + i * 1000) };
    assert.equal(evaluateRate(stored, 'post', NOW + RATE_WINDOW_MS - 1).ok, false, 'one ms before the oldest expires');
    assert.equal(evaluateRate(stored, 'post', NOW + RATE_WINDOW_MS).ok, true, 'the moment it expires');
  });
  test('a slot stamped a few ms after now still counts (another isolate’s clock; found on the emulator)', () => {
    const stored = { post: [1, 2, 3, 4, 5].map((i) => NOW + i) };
    assert.equal(evaluateRate(stored, 'post', NOW).ok, false);
  });
  test('stored as RTDB hands arrays back (an object of numbers) and pruned to the window', () => {
    const v = evaluateRate({ post: { 0: NOW - RATE_WINDOW_MS - 1, 1: NOW - 5 }, reply: 'junk' }, 'post', NOW);
    assert.deepEqual(v.next, { post: [NOW - 5, NOW], reply: [] });
  });
});

describe('W54 · the edit window', () => {
  const NOW = Z('2026-10-24T20:30:00Z');
  const rec = (over = {}) => ({ authorUid: READER, text: 'hello', createdAt: NOW - 60000, ...over });
  test('own post, inside five minutes: allowed; at exactly five minutes: allowed; a ms later: refused', () => {
    assert.equal(editRefusal(rec(), READER, NOW), null);
    assert.equal(editRefusal(rec({ createdAt: NOW - EDIT_WINDOW_MS }), READER, NOW), null);
    assert.equal(editRefusal(rec({ createdAt: NOW - EDIT_WINDOW_MS - 1 }), READER, NOW).code, 'edit_window');
  });
  test('someone else’s, withdrawn, or missing: refused', () => {
    assert.equal(editRefusal(rec(), OTHER, NOW).code, 'not_yours');
    assert.equal(editRefusal(rec({ withdrawn: true }), READER, NOW).code, 'withdrawn');
    assert.equal(editRefusal(null, READER, NOW).code, 'missing');
  });
});

describe('W54 · the record (pure)', () => {
  const NOW = Z('2026-10-24T20:30:00Z');
  const snapshot = authorSnapshot(READER, { displayName: 'Reader Ay' }, { username: 'ay', readCount: 7 });
  test('the caps: 500 for a post, 300 for a reply, with the writer-facing words', () => {
    assert.equal(buildRecord('post', { text: 'x'.repeat(500) }, { snapshot, now: NOW }).ok, true);
    const over = buildRecord('post', { text: 'x'.repeat(501) }, { snapshot, now: NOW });
    assert.equal(over.ok, false);
    assert.equal(over.message, '1 character over. The Square holds 500.');
    const root = { authorUid: OTHER, text: 'root', createdAt: 1 };
    assert.equal(buildRecord('reply', { text: 'x'.repeat(300), parentId: '-Root' }, { snapshot, now: NOW, root }).ok, true);
    assert.equal(buildRecord('reply', { text: 'x'.repeat(301), parentId: '-Root' }, { snapshot, now: NOW, root }).ok, false);
    assert.equal(buildRecord('post', { text: '   ' }, { snapshot, now: NOW }).ok, false);
  });
  test('an attachment is the seven fields and a /stories/ address, or nothing', () => {
    const ok = cleanAttachedStory({ id: 'a-story', title: 'T', author: 'A', content: 'THE WHOLE BODY', epubUrl: 'x', url: 'https://evil.example' });
    assert.deepEqual(ok, { ok: true, value: { title: 'T', author: 'A', url: '/stories/a-story', id: 'a-story' } });
    assert.equal(cleanAttachedStory({ id: '../x', title: 'T' }).ok, false);
    assert.equal(cleanAttachedStory('a string').ok, false);
  });
  test('a poll only from a moderator, two to six options, closing within a day', () => {
    const poll = { question: 'Which?', options: ['a', 'b'], closesAt: NOW + 3600000 };
    assert.equal(buildRecord('post', { text: 'vote', poll }, { snapshot, now: NOW }).code, 'poll');
    assert.deepEqual(buildRecord('post', { text: 'vote', poll }, { snapshot, now: NOW, canPoll: true }).record.poll, poll);
    assert.equal(buildRecord('post', { text: 'vote', poll: { ...poll, options: ['a'] } }, { snapshot, now: NOW, canPoll: true }).ok, false);
    assert.equal(buildRecord('post', { text: 'vote', poll: { ...poll, closesAt: NOW + 2 * 86400000 } }, { snapshot, now: NOW, canPoll: true }).ok, false);
  });
  test('a reply answers a reply in the same thread, never the root or another thread', () => {
    const root = { authorUid: OTHER, createdAt: 1 };
    const ctx = { snapshot, now: NOW, root };
    assert.equal(buildRecord('reply', { text: 'hi', parentId: '-R', replyToId: '-r1' }, { ...ctx, replyTo: { parentId: '-R' } }).record.replyToId, '-r1');
    assert.equal(buildRecord('reply', { text: 'hi', parentId: '-R', replyToId: '-r1' }, { ...ctx, replyTo: { parentId: '-Other' } }).ok, false);
    assert.equal(buildRecord('reply', { text: 'hi', parentId: '-R', replyToId: '-R' }, { ...ctx, replyTo: { } }).ok, false);
    assert.equal(buildRecord('reply', { text: 'hi', parentId: '-R' }, { snapshot, now: NOW, root: { parentId: '-X' } }).code, 'missing', 'a reply is never the root');
    assert.equal(buildRecord('reply', { text: 'hi', parentId: '-R' }, { snapshot, now: NOW, root: null }).code, 'missing');
  });
});

// ── the handler, over an in-memory database ──────────────────────────────────────────────

const FAKE = 'https://w54.test';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const ENV = { NEXT_PUBLIC_FIREBASE_API_KEY: 'k', FIREBASE_CLIENT_EMAIL: 'svc@example.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey, FIREBASE_DATABASE_URL: FAKE };

let store = {};
const at = (path) => path.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), store);
function put(path, value) {
  const keys = path.split('/').filter(Boolean);
  let o = store;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {});
  if (value === null) delete o[keys.at(-1)]; else o[keys.at(-1)] = JSON.parse(JSON.stringify(value));
}
const etagOf = (v) => createHash('sha1').update(JSON.stringify(v ?? null)).digest('hex');
const writes = [];
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'owner' }), { status: 200 });
    if (url.startsWith('https://identitytoolkit.googleapis.com/')) {
      const m = /^tok-(.+)$/.exec(JSON.parse(init.body || '{}').idToken || '');
      return m ? new Response(JSON.stringify({ users: [{ localId: m[1], displayName: m[1] === READER ? 'Reader Ay' : '' }] }), { status: 200 }) : new Response('{}', { status: 400 });
    }
    if (url.startsWith(FAKE)) {
      const path = decodeURIComponent(new URL(url).pathname.replace(/\.json$/, ''));
      const h = init.headers || {};
      if (!init.method || init.method === 'GET') {
        const v = at(path) ?? null;
        return new Response(JSON.stringify(v), { status: 200, headers: { ETag: etagOf(v) } });
      }
      if (init.method === 'PUT') {
        if (h['if-match'] && h['if-match'] !== etagOf(at(path) ?? null)) return new Response('{}', { status: 412 });
        writes.push(path);
        put(path, JSON.parse(init.body));
        return new Response(init.body, { status: 200 });
      }
    }
    throw new Error(`refused an outbound call to ${url}`);
  };
});
after(() => { globalThis.fetch = realFetch; });

const OPEN = Z('2026-10-24T19:30:00Z');   // 20:30 London, BST
const SHUT = Z('2026-10-24T17:00:00Z');   // 18:00 London
async function call(body, { uid = READER, now = OPEN, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = token ?? (uid ? `tok-${uid}` : null);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await handleWrite({ request: new Request('https://calvaryscribblings.co.uk/api/square/write', { method: 'POST', headers, body: JSON.stringify(body) }), env: ENV }, { now });
  return { status: res.status, ...(await res.json()) };
}

beforeEach(() => {
  writes.length = 0;
  store = {
    users: {
      [READER]: { displayName: 'Stored Name', username: 'ay', readCount: 12, isAuthor: false, avatarUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/avatars%2Fw54-test-reader.jpg' },
      [OTHER]: { displayName: 'Reader Bee', username: 'bee' },
      [FOUNDER]: { displayName: 'Founder', username: 'founder' },
    },
    square_posts: { '-Root': { authorUid: OTHER, text: 'a root', createdAt: OPEN - 60000 } },
  };
});

describe('W54 · /api/square/write', () => {
  test('client author fields, createdAt and counts are ignored: the server builds them', async () => {
    const r = await call({
      action: 'post', text: 'Hello, room.',
      authorUid: OTHER, authorName: 'Ikenna', authorHandle: 'founder', authorAvatarUrl: 'https://evil.example/x.png',
      authorReadCount: 99999, isAuthor: true, createdAt: 1, likeCount: 500, pinned: true,
    });
    assert.equal(r.status, 200);
    const saved = store.square_posts[r.id];
    assert.deepEqual(saved, r.record, 'the answer is exactly what was written');
    assert.equal(saved.authorUid, READER);
    assert.equal(saved.authorName, 'Reader Ay', 'the verified account’s display name');
    assert.equal(saved.authorHandle, 'ay');
    assert.equal(saved.authorReadCount, 12);
    assert.equal(saved.isAuthor, false);
    assert.match(saved.authorAvatarUrl, /avatars%2Fw54-test-reader/);
    assert.equal(saved.createdAt, OPEN, 'the server’s clock');
    assert.equal(saved.pinned, false);
    for (const k of ['likeCount', 'fireCount', 'clapCount']) assert.equal(saved[k], undefined, k);
    assert.match(r.id, /^[-0-9A-Za-z_]{20}$/);
  });

  test('outside the hours: "The Square opens at 8pm.", nothing written, no slot spent; founders exempt', async () => {
    const r = await call({ action: 'post', text: 'too early' }, { now: SHUT });
    assert.equal(r.status, 403);
    assert.equal(r.code, 'closed');
    assert.equal(r.error, SQUARE_WRITE_COPY.closed);
    const rr = await call({ action: 'reply', text: 'too early', parentId: '-Root' }, { now: SHUT });
    assert.equal(rr.code, 'closed');
    assert.deepEqual(writes, []);
    const f = await call({ action: 'post', text: 'house notice' }, { uid: FOUNDER, now: SHUT });
    assert.equal(f.status, 200);
  });

  test('the hours on the handler, both sides of the clock change', async () => {
    for (const side of Object.values(SIDES)) {
      for (const [hhmm, want] of [['19:59', 403], ['20:00', 200], ['00:05', 200], ['00:06', 403]]) {
        store.square_rate = {};
        const r = await call({ action: 'post', text: `at ${hhmm}` }, { now: Z(side[hhmm]) });
        assert.equal(r.status, want, `${side[hhmm]} (${hhmm} London)`);
      }
    }
  });

  test('the pace: the 6th post in ten minutes is refused with ruling 211’s words; replies count apart', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await call({ action: 'post', text: `post ${i}` }, { now: OPEN + i * 1000 })).status, 200);
    const sixth = await call({ action: 'post', text: 'one too many' }, { now: OPEN + 6000 });
    assert.equal(sixth.status, 429);
    assert.equal(sixth.code, 'rate');
    assert.equal(sixth.error, 'Too much at once. Try again in a minute.');
    assert.equal(Object.keys(store.square_posts).length, 6, 'the root and five posts');
    assert.equal((await call({ action: 'reply', text: 'a reply still goes', parentId: '-Root' }, { now: OPEN + 7000 })).status, 200);
    assert.equal((await call({ action: 'post', text: 'ten minutes on' }, { now: OPEN + RATE_WINDOW_MS })).status, 200);
  });

  test('a refused record never spends a slot', async () => {
    for (let i = 0; i < 8; i++) await call({ action: 'post', text: 'x'.repeat(501) });
    assert.equal(store.square_rate, undefined);
  });

  test('the caps again on the server: 501 on a post and 301 on a reply are refused', async () => {
    const p = await call({ action: 'post', text: 'x'.repeat(501) });
    assert.equal(p.status, 400);
    assert.equal(p.error, '1 character over. The Square holds 500.');
    const r = await call({ action: 'reply', text: 'y'.repeat(301), parentId: '-Root' });
    assert.equal(r.status, 400);
    assert.equal((await call({ action: 'reply', text: 'y'.repeat(300), parentId: '-Root' })).status, 200);
  });

  test('a reply to a post that is not in the room is refused', async () => {
    assert.equal((await call({ action: 'reply', text: 'hi', parentId: '-Gone' })).status, 404);
  });

  test('edits: own post, inside five minutes, text only, marked edited', async () => {
    const r = await call({ action: 'post', text: 'first words' });
    const e = await call({ action: 'edit', id: r.id, text: 'second words', authorName: 'Someone Else', pinned: true }, { now: OPEN + 60000 });
    assert.equal(e.status, 200);
    assert.deepEqual(store.square_posts[r.id], { ...r.record, text: 'second words', edited: true });
    assert.equal((await call({ action: 'edit', id: r.id, text: 'late' }, { now: OPEN + EDIT_WINDOW_MS + 1 })).code, 'edit_window');
    assert.equal((await call({ action: 'edit', id: r.id, text: 'not mine' }, { uid: OTHER, now: OPEN + 1000 })).code, 'not_yours');
    assert.equal(store.square_posts[r.id].text, 'second words');
  });

  test('an edit is not bound by the hours (it is bound by the five minutes)', async () => {
    const r = await call({ action: 'post', text: 'at 00:04' }, { now: Z('2026-10-24T23:04:00Z') });
    assert.equal(r.status, 200);
    assert.equal((await call({ action: 'edit', id: r.id, text: 'fixed at 00:07' }, { now: Z('2026-10-24T23:07:00Z') })).status, 200);
  });

  test('no token, or one Google refuses: 401 and nothing written', async () => {
    assert.equal((await call({ action: 'post', text: 'hi' }, { uid: null })).status, 401);
    assert.equal((await call({ action: 'post', text: 'hi' }, { token: 'forged' })).status, 401);
    assert.equal((await call({ action: 'delete', id: '-Root' })).status, 400);
    assert.deepEqual(writes, []);
  });

  test('a missing environment answers 503 and names the variables, never their values', async () => {
    const logged = [];
    const orig = console.error;
    console.error = (...a) => logged.push(a.join(' '));
    try {
      const res = await handleWrite({ request: new Request('https://x/api/square/write', { method: 'POST', headers: { Authorization: 'Bearer tok-a' }, body: '{"action":"post","text":"hi"}' }), env: { ...ENV, FIREBASE_PRIVATE_KEY: '' } }, { now: OPEN });
      assert.equal(res.status, 503);
    } finally { console.error = orig; }
    assert.equal(logged.some((l) => l.includes('BEGIN PRIVATE KEY') || l.includes('svc@example')), false);
  });
});
