// W54 — functions/api/square/write.js against the RTDB EMULATOR.
//
//   npm run test:square:write:emulator
//
// Named .emulator.mjs, not .test.mjs, so `npm run test:square` (no emulator) does not pick it up.
// The Function runs unmodified; its database calls are real REST calls to the emulator, so the
// ETags, the conditional PUTs and their 412s are the emulator's. Only Google is stood in for, by
// the W49 harness (tests/reads/harness.mjs): `tok-<uid>` verifies as <uid>. Nothing leaves the
// machine. What this adds to the unit suite is a REAL race:
//   · six posts at once from one reader: exactly five land (ruling 211), the sixth is refused;
//   · an edit racing a withdrawal never brings the withdrawn words back.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { install, uninstall, wipe, get, set, request, context, tokenFor } from '../reads/harness.mjs';
import { handleWrite } from '../../functions/api/square/write.js';

const READER = 'w54-test-reader';
const OPEN = Date.parse('2026-10-24T19:30:00Z');   // 20:30 London

async function call(body, { uid = READER, now = OPEN } = {}) {
  const { ctx } = context(request('/api/square/write', { body, token: tokenFor(uid) }));
  const res = await handleWrite(ctx, { now });
  return { status: res.status, ...(await res.json()) };
}

before(install);
after(uninstall);
beforeEach(async () => {
  await wipe();
  await set(`users/${READER}`, { displayName: 'Reader Ay', username: 'ay', readCount: 3 });
});

describe('W54 · /api/square/write on the emulator', () => {
  test('a post lands in square_posts exactly as answered, with the server’s clock', async () => {
    const r = await call({ action: 'post', text: 'Hello, room.', authorName: 'Forged', createdAt: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(await get(`square_posts/${r.id}`), r.record);
    assert.equal(r.record.createdAt, OPEN);
    assert.equal(r.record.authorName, 'Reader Ay');
  });

  test('six posts at once: exactly five land, the sixth is refused with ruling 211', async () => {
    const results = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => call({ action: 'post', text: `burst ${i}` }, { now: OPEN + i })));
    const ok = results.filter((r) => r.status === 200);
    const refused = results.filter((r) => r.status === 429);
    assert.equal(ok.length, 5, JSON.stringify(results.map((r) => r.status)));
    assert.equal(refused.length, 1);
    assert.equal(refused[0].error, 'Too much at once. Try again in a minute.');
    assert.equal(Object.keys(await get('square_posts')).length, 5);
    assert.equal(Object.keys((await get(`square_rate/${READER}`)).post).length, 5);
  });

  test('an edit after a withdrawal is refused, and the withdrawn words stay gone', async () => {
    const r = await call({ action: 'post', text: 'soon withdrawn' });
    await set(`square_posts/${r.id}/withdrawn`, true);
    await set(`square_posts/${r.id}/text`, '');
    const e = await call({ action: 'edit', id: r.id, text: 'back again' }, { now: OPEN + 1000 });
    assert.equal(e.code, 'withdrawn');
    assert.equal(await get(`square_posts/${r.id}/text`), '');
  });

  test('a reply to a reply in the same thread lands with parentId = the root', async () => {
    await set('square_posts/-Root', { authorUid: 'someone', text: 'root', createdAt: OPEN - 1000 });
    const a = await call({ action: 'reply', text: 'first reply', parentId: '-Root' });
    const b = await call({ action: 'reply', text: 'answering it', parentId: '-Root', replyToId: a.id });
    assert.equal(b.status, 200);
    assert.deepEqual([b.record.parentId, b.record.replyToId], ['-Root', a.id]);
  });
});
