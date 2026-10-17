// W51 — the Square's handle lookups, without the founder-only users root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mentionHandles, resolveHandle, matchReaders, replyPrefill } from '../../app/lib/squareHandles.js';

test('mentions are lowercased and de-duplicated', () => {
  assert.deepEqual(mentionHandles('hi @Bee and @bee, also @Cee_2!'), ['bee', 'cee_2']);
  assert.deepEqual(mentionHandles('no mentions'), []);
});

test('a handle resolves through the lowercase index, and a miss is null', async () => {
  const index = { bee: 'uid-b' };
  const asked = [];
  const read = async (h) => { asked.push(h); return index[h] ?? null; };
  assert.equal(await resolveHandle('Bee', read), 'uid-b');
  assert.equal(await resolveHandle('nobody', read), null);
  assert.deepEqual(asked, ['bee', 'nobody']);
});

test('readers match on the index, excluding the reader themselves', () => {
  const idx = { a: { username: 'ay', displayName: 'Reader Ay' }, b: { username: 'bee', displayName: 'Reader Bee' } };
  assert.deepEqual(matchReaders(idx, 'BE').map((r) => r.uid), ['b']);
  assert.deepEqual(matchReaders(idx, 'reader', { fields: ['displayName', 'username'], exclude: 'a' }).map((r) => r.uid), ['b']);
  assert.deepEqual(matchReaders(idx, ''), []);
});

test('the reply-on-a-reply prefill', () => {
  assert.equal(replyPrefill('bee'), '@bee ');
  assert.equal(replyPrefill('@bee'), '@bee ');
  assert.equal(replyPrefill(''), '');
});

test('the Square never reads the users root from the client', () => {
  const src = readFileSync(new URL('../../app/square/page.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /ref\(\s*db\s*,\s*['"`]users['"`]\s*\)/);
});
